import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { emitirProgressoMock } from '@core'
import { criarFila, iniciarProgresso, useFila, type EventoProgresso } from '~/core/progresso'

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => false),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

const mockIsTauri = vi.mocked(isTauri)
const mockListen = vi.mocked(listen)

function evento(parcial: Partial<EventoProgresso> = {}): EventoProgresso {
  return {
    job: '42',
    project: 'canal-a',
    stage: 'transcribing',
    percentage: 0,
    message: 'Transcrevendo…',
    error: null,
    ...parcial,
  }
}

describe('Fila de jobs sobre core-progress (progresso.ts)', () => {
  beforeEach(() => {
    mockIsTauri.mockReset()
    mockIsTauri.mockReturnValue(false)
    mockListen.mockReset()
  })

  it('cria job rodando, conclui em 100%, e mapeia falha / incerto / pausado', () => {
    let t = 1000
    const fila = criarFila(() => 'canal-a', () => t)

    fila.aplicar(evento({ job: '1', percentage: 15, message: 'Bloco 1' }))
    expect(fila.jobs()).toEqual([
      {
        id: '1',
        etapa: 'transcribing',
        percentual: 15,
        mensagem: 'Bloco 1',
        estado: 'rodando',
        inicioMs: 1000,
      },
    ])

    t = 2000
    fila.aplicar(evento({ job: '1', stage: 'complete', percentage: 100, message: 'Pronto' }))
    expect(fila.jobs()[0]).toMatchObject({
      id: '1',
      etapa: 'complete',
      percentual: 100,
      mensagem: 'Pronto',
      estado: 'concluido',
    })
    expect(fila.jobs()[0].etaMs).toBeUndefined()

    fila.aplicar(
      evento({
        job: '2',
        stage: 'failed',
        percentage: 0,
        message: 'Falhou',
        error: { code: 'network', message: 'sem rede' },
      }),
    )
    expect(fila.jobs().find((j) => j.id === '2')).toMatchObject({
      estado: 'falhou',
      erro: { code: 'network', message: 'sem rede' },
    })

    fila.aplicar(
      evento({
        job: '3',
        stage: 'ai:selection:done',
        percentage: 0,
        message: 'Timeout',
        error: { code: 'timeout_uncertain', message: 'demorou' },
      }),
    )
    expect(fila.jobs().find((j) => j.id === '3')).toMatchObject({
      estado: 'incerto',
      erro: { code: 'timeout_uncertain', message: 'demorou' },
    })
  })

  it.each(['budget_calls', 'budget_cost', 'budget_tokens', 'time_budget_exhausted'])(
    'classifica erro %s como estado pausado',
    (code) => {
      const fila = criarFila(() => 'canal-a', () => 0)
      fila.aplicar(
        evento({
          job: '10',
          stage: 'ai:selection:paused',
          percentage: 0,
          message: 'Pausado por orçamento',
          error: { code, message: 'limite' },
        }),
      )
      expect(fila.jobs()[0]).toMatchObject({
        id: '10',
        estado: 'pausado',
        erro: { code, message: 'limite' },
      })
    },
  )

  it('Review Focus 1: percentual não regride e 100% antes de 40% mantém concluído em 100%', () => {
    const fila = criarFila(() => 'canal-a', () => 0)

    fila.aplicar(evento({ job: '7', percentage: 60, message: 'Em 60%' }))
    fila.aplicar(evento({ job: '7', percentage: 40, message: 'Atrasado 40%' }))

    expect(fila.jobs()[0]).toMatchObject({
      percentual: 60,
      mensagem: 'Em 60%',
      estado: 'rodando',
    })

    fila.aplicar(evento({ job: '8', stage: 'complete', percentage: 100, message: 'Concluído' }))
    fila.aplicar(evento({ job: '8', stage: 'transcribing', percentage: 40, message: 'Pacote antigo' }))

    expect(fila.jobs().find((j) => j.id === '8')).toMatchObject({
      percentual: 100,
      estado: 'concluido',
      mensagem: 'Concluído',
    })
  })

  it('Review Focus 1: ignora evento de outro Projeto e job "0" (#293), mas aceita globais (project null/undefined)', () => {
    let projeto: string | null = 'canal-a'
    const fila = criarFila(() => projeto, () => 0)
    const ouvinte = vi.fn()
    fila.assinar(ouvinte)

    fila.aplicar(evento({ job: '1', project: 'canal-b', percentage: 20 }))
    fila.aplicar(evento({ job: '0', project: 'canal-a', stage: 'narration_record', percentage: 100 }))
    expect(fila.jobs()).toEqual([])
    expect(ouvinte).not.toHaveBeenCalled()

    projeto = null
    fila.aplicar(evento({ job: '2', project: 'canal-a', percentage: 50 }))
    expect(fila.jobs()).toEqual([])
    expect(ouvinte).not.toHaveBeenCalled()

    fila.aplicar(evento({ job: 'ffmpeg', project: null, stage: 'download', percentage: 30 }))
    fila.aplicar(evento({ job: 'deno', project: undefined, stage: 'download', percentage: 70 }))
    expect(fila.jobs().map((j) => j.id)).toEqual(['ffmpeg', 'deno'])
    expect(ouvinte).toHaveBeenCalledTimes(2)
  })

  it('calcula ETA apenas quando visto desde 0% na sessão e etapa não começa com ai:', () => {
    let t = 0
    const fila = criarFila(() => 'canal-a', () => t)

    // Caso válido: visto desde 0% em t=0, 50% em t=10_000 -> etaMs === 10_000
    fila.aplicar(evento({ job: '1', stage: 'transcribing', percentage: 0 }))
    expect(fila.jobs()[0].etaMs).toBeUndefined()

    t = 10_000
    fila.aplicar(evento({ job: '1', stage: 'transcribing', percentage: 50 }))
    expect(fila.jobs().find((j) => j.id === '1')?.etaMs).toBe(10_000)

    t = 20_000
    fila.aplicar(evento({ job: '1', stage: 'complete', percentage: 100 }))
    expect(fila.jobs().find((j) => j.id === '1')?.etaMs).toBeUndefined()

    // Caso 2: não visto desde 0% (ex.: janela recarregada em 25%) -> nunca calcula ETA
    t = 0
    fila.aplicar(evento({ job: '2', stage: 'transcribing', percentage: 25 }))
    t = 10_000
    fila.aplicar(evento({ job: '2', stage: 'transcribing', percentage: 50 }))
    expect(fila.jobs().find((j) => j.id === '2')?.etaMs).toBeUndefined()

    // Caso 3: etapa ai:* -> nunca calcula ETA mesmo visto desde 0%
    t = 0
    fila.aplicar(evento({ job: '3', stage: 'ai:selection:prepare', percentage: 0 }))
    t = 10_000
    fila.aplicar(evento({ job: '3', stage: 'ai:selection:call', percentage: 50 }))
    expect(fila.jobs().find((j) => j.id === '3')?.etaMs).toBeUndefined()
  })

  it('assinar notifica a cada aplicar válido e respeita descadastro', () => {
    const fila = criarFila(() => 'canal-a', () => 0)
    const ouvinte = vi.fn()
    const cancelar = fila.assinar(ouvinte)

    fila.aplicar(evento({ job: '1', percentage: 10 }))
    fila.aplicar(evento({ job: '1', percentage: 20 }))
    expect(ouvinte).toHaveBeenCalledTimes(2)

    cancelar()
    fila.aplicar(evento({ job: '1', percentage: 30 }))
    expect(ouvinte).toHaveBeenCalledTimes(2)
  })

  it('useFila reage às atualizações da fila via useSyncExternalStore', () => {
    const fila = criarFila(() => 'canal-a', () => 0)
    const { result } = renderHook(() => useFila(fila))

    expect(result.current).toEqual([])

    act(() => {
      fila.aplicar(evento({ job: '5', percentage: 45, message: 'Em curso' }))
    })

    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({ id: '5', percentual: 45, estado: 'rodando' })
  })

  it('iniciarProgresso é no-op fora do Tauri e registra um único listen("core-progress") no Tauri', async () => {
    const fila = criarFila(() => 'canal-a', () => 0)

    mockIsTauri.mockReturnValue(false)
    const pararFora = await iniciarProgresso(fila)
    expect(mockListen).not.toHaveBeenCalled()
    pararFora()

    mockIsTauri.mockReturnValue(true)
    const unlisten = vi.fn()
    let handlerRegistrado: ((ev: { payload: EventoProgresso }) => void) | undefined
    mockListen.mockImplementation(async (_event, cb) => {
      handlerRegistrado = cb as (ev: { payload: EventoProgresso }) => void
      return unlisten
    })

    const parar1 = await iniciarProgresso(fila)
    const parar2 = await iniciarProgresso(fila)
    expect(mockListen).toHaveBeenCalledTimes(1)
    expect(mockListen).toHaveBeenCalledWith('core-progress', expect.any(Function))

    handlerRegistrado?.({ payload: evento({ job: '9', percentage: 80 }) })
    expect(fila.jobs()).toHaveLength(1)
    expect(fila.jobs()[0]).toMatchObject({ id: '9', percentual: 80 })

    parar1()
    parar2()
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('iniciarProgresso fora do Tauri com VITE_CORE_MOCK=1 assina o barramento simulado', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    mockIsTauri.mockReturnValue(false)

    const fila = criarFila(() => 'canal-a', () => 0)
    const parar = await iniciarProgresso(fila)

    emitirProgressoMock(evento({ job: '77', percentage: 65, message: 'Progresso mock' }))
    expect(fila.jobs()).toHaveLength(1)
    expect(fila.jobs()[0]).toMatchObject({ id: '77', percentual: 65, mensagem: 'Progresso mock' })

    parar()
    emitirProgressoMock(evento({ job: '77', percentage: 90, message: 'Após cancelar' }))
    expect(fila.jobs()[0]).toMatchObject({ id: '77', percentual: 65 })
    vi.unstubAllEnvs()
  })
})
