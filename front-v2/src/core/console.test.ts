import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { emitirConsoleMock, limparConsoleMock } from '@core'
import {
  criarStoreConsole,
  definirProjetoConsole,
  iniciarConsole,
  sanitizarLinhaDefensiva,
  useConsole,
  type EventoConsole,
} from '~/core/console'

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(async () => ({ items: [] })),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

const mockIsTauri = vi.mocked(isTauri)
const mockListen = vi.mocked(listen)

function ev(parcial: Partial<EventoConsole> = {}): EventoConsole {
  return {
    seq: 1,
    timestampMs: new Date(2026, 10, 19, 14, 5, 9).getTime(),
    job: 'worker',
    project: null,
    origin: 'uv',
    level: 'info',
    simple: 'Resolvendo dependências…',
    technical: 'uv: Resolved 42 packages',
    ...parcial,
  }
}

describe('Store do Console ao vivo (console.ts)', () => {
  beforeEach(() => {
    mockIsTauri.mockReset()
    mockIsTauri.mockReturnValue(false)
    mockListen.mockReset()
    limparConsoleMock()
    definirProjetoConsole(null)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('respeita buffer circular FIFO (padrão 500 e teto 1.000)', () => {
    const store500 = criarStoreConsole({ projetoAtual: () => null })
    for (let i = 1; i <= 540; i += 1) {
      store500.aplicar(ev({ seq: i, simple: `linha ${i}` }))
    }
    expect(store500.linhas()).toHaveLength(500)
    expect(store500.linhas()[0].simple).toBe('linha 41')
    expect(store500.linhas()[499].simple).toBe('linha 540')

    const storeTeto = criarStoreConsole({ limite: 2500, projetoAtual: () => null })
    for (let i = 1; i <= 1100; i += 1) {
      storeTeto.aplicar(ev({ seq: i, simple: `max ${i}` }))
    }
    expect(storeTeto.linhas()).toHaveLength(1000)
    expect(storeTeto.linhas()[0].simple).toBe('max 101')
  })

  it('deduplica por seq, filtra por Projeto ativo e isola limpeza de Projeto', () => {
    let projeto: string | null = 'canal-a'
    const store = criarStoreConsole({ projetoAtual: () => projeto })

    store.aplicar(ev({ seq: 1, project: null, simple: 'Global 1' }))
    store.aplicar(ev({ seq: 2, project: 'canal-a', simple: 'Projeto A' }))
    store.aplicar(ev({ seq: 3, project: 'canal-b', simple: 'Outro Projeto' }))
    store.aplicar(ev({ seq: 2, project: 'canal-a', simple: 'Duplicada' }))

    expect(store.linhas().map((l) => l.simple)).toEqual(['Global 1', 'Projeto A'])

    store.limparProjeto()
    expect(store.linhas().map((l) => l.simple)).toEqual(['Global 1'])

    projeto = 'canal-b'
    store.aplicarLote([
      ev({ seq: 1, project: null, simple: 'Global 1' }),
      ev({ seq: 3, project: 'canal-b', simple: 'Outro Projeto' }),
    ])
    expect(store.linhas().map((l) => l.simple)).toEqual(['Global 1', 'Outro Projeto'])
  })

  it('sanitiza defensivamente segredos, caminhos pessoais, ANSI, \\r e trunca em 512 chars', () => {
    expect(
      sanitizarLinhaDefensiva(
        '\x1b[32mAuth\x1b[0m Bearer supersecret123 sk-proj-abc1234567890 C:\\Users\\Maria\\clipes?token=xyz999',
      ),
    ).toBe('Auth Bearer [REDACTED] [REDACTED] ~\\clipes?token=[REDACTED]')

    expect(sanitizarLinhaDefensiva('10%\r50%\r100%\r')).toBe('100%')

    const longo = 'x'.repeat(600)
    const truncado = sanitizarLinhaDefensiva(longo)
    expect(truncado.length).toBeLessThanOrEqual(512)
    expect(truncado.endsWith('…')).toBe(true)
  })

  it('limpa linhas e impede reentrada de seq antigo vindo de console.history', () => {
    const store = criarStoreConsole({ projetoAtual: () => null })
    store.aplicar(ev({ seq: 10, simple: 'Antiga' }))
    store.limpar()
    expect(store.linhas()).toHaveLength(0)

    store.aplicarLote([
      ev({ seq: 10, simple: 'Antiga' }),
      ev({ seq: 11, simple: 'Nova' }),
    ])
    expect(store.linhas().map((l) => l.simple)).toEqual(['Nova'])
  })

  it('exporta texto plano em modo Simples e Técnico respeitando filtro de origem e job', () => {
    const store = criarStoreConsole({ projetoAtual: () => null })
    store.aplicarLote([
      ev({ seq: 1, job: 'ffmpeg', origin: 'ffmpeg', simple: 'Exportando 50%', technical: 'frame=500 speed=2.0x' }),
      ev({ seq: 2, job: 'worker', origin: 'uv', simple: 'Instalando pacotes', technical: 'uv: Installed 42 packages' }),
    ])

    const simples = store.exportarTexto({ filtroOrigem: 'ffmpeg', modo: 'simples' })
    expect(simples).toContain('14:05:09')
    expect(simples).toContain('Exportando 50%')
    expect(simples).not.toContain('Instalando pacotes')

    const tecnico = store.exportarTexto({ filtroOrigem: 'todas', modo: 'tecnico' })
    expect(tecnico).toContain('frame=500 speed=2.0x')
    expect(tecnico).toContain('uv: Installed 42 packages')
  })

  it('coalesce rajadas de eventos em até 80 ms sem perder a primeira notificação', () => {
    vi.useFakeTimers()
    const store = criarStoreConsole({ projetoAtual: () => null, throttleMs: 80 })
    const listener = vi.fn()
    store.assinar(listener)

    store.aplicar(ev({ seq: 1, simple: 'primeira' }))
    expect(listener).toHaveBeenCalledTimes(1)

    for (let i = 2; i <= 20; i += 1) {
      store.aplicar(ev({ seq: i, simple: `rajada ${i}` }))
    }
    expect(listener).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(80)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.linhas()).toHaveLength(20)
  })

  it('conecta iniciarConsole no mock TS (VITE_CORE_MOCK=1) e no listener Tauri', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    const storeMock = criarStoreConsole({ projetoAtual: () => null })
    const pararMock = await iniciarConsole(storeMock)

    const { result } = renderHook(() => useConsole(storeMock))
    act(() => {
      emitirConsoleMock({
        job: 'ffmpeg',
        origin: 'component',
        level: 'info',
        simple: 'Baixando FFmpeg…',
        technical: 'GET ffmpeg.zip',
      })
    })
    expect(result.current.linhas).toHaveLength(1)
    expect(result.current.linhas[0].simple).toBe('Baixando FFmpeg…')
    pararMock()

    // Modo Tauri
    mockIsTauri.mockReturnValue(true)
    const unlistenFn = vi.fn()
    let callback: ((e: { payload: EventoConsole }) => void) | undefined
    mockListen.mockImplementation(async (_ev, cb) => {
      callback = cb as (e: { payload: EventoConsole }) => void
      return unlistenFn
    })

    const storeTauri = criarStoreConsole({ projetoAtual: () => null })
    const pararTauri = await iniciarConsole(storeTauri)
    expect(mockListen).toHaveBeenCalledWith('core-console', expect.any(Function))

    act(() => {
      callback?.({
        payload: ev({ seq: 99, origin: 'worker', simple: 'Worker pronto' }),
      })
    })
    expect(storeTauri.linhas().some((l) => l.seq === 99)).toBe(true)
    pararTauri()
    expect(unlistenFn).toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith('core_dispatch', { name: 'console.history', arguments: {} })
  })
})
