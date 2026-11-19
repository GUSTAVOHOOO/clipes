import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { emitirProgressoMock } from '@core'
import {
  criarFila,
  definirProjetoDaFila,
  formatarTempoDecorrido,
  iniciarProgresso,
  useFila,
  useSalvamentoEditor,
  type EventoProgresso,
} from '~/core/progresso'

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

  it('componente montado antes de iniciarProgresso recebe eventos da fila padrão (inclusive por Projeto via definirProjetoDaFila)', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    mockIsTauri.mockReturnValue(false)

    // Simula outra fila usada antes em módulo/teste — não pode desviar useFila() da fila padrão única
    const filaIsolada = criarFila(() => 'outro')
    const pararIsolada = await iniciarProgresso(filaIsolada)
    pararIsolada()

    // Hook/componente monta e chama useFila() ANTES de iniciarProgresso()
    const { result } = renderHook(() => useFila())
    expect(result.current).toEqual([])

    definirProjetoDaFila('canal-a')
    const pararPadrao = await iniciarProgresso()

    act(() => {
      emitirProgressoMock(evento({ job: '88', project: 'canal-a', percentage: 45 }))
      emitirProgressoMock(evento({ job: 'ffmpeg', project: null, stage: 'download', percentage: 70 }))
      emitirProgressoMock(evento({ job: '99', project: 'canal-b', percentage: 30 }))
    })

    expect(result.current.map((j) => ({ id: j.id, percentual: j.percentual }))).toEqual([
      { id: '88', percentual: 45 },
      { id: 'ffmpeg', percentual: 70 },
    ])

    definirProjetoDaFila(null)
    pararPadrao()
    vi.unstubAllEnvs()
  })

  it('isola editor_saved e editor_save_failed da Fila Global e atualiza useSalvamentoEditor()', async () => {
    const fila = criarFila(() => 'canal-a', () => 0)
    const { result: resFila } = renderHook(() => useFila(fila))
    const { result: resSalv } = renderHook(() => useSalvamentoEditor(fila))

    expect(resSalv.current.estado).toBe('ocioso')

    act(() => {
      fila.aplicar(
        evento({
          job: 'editor:1',
          project: 'canal-a',
          stage: 'editor_saved',
          percentage: 100,
          message: 'Corte salvo.',
        }),
      )
    })

    expect(resFila.current).toEqual([])
    expect(resSalv.current.estado).toBe('salvo')
    expect(resSalv.current.clipId).toBe(1)
    expect(resSalv.current.erro).toBeUndefined()

    // Evento de outro Projeto não deve interferir no estado de salvamento do Projeto ativo
    act(() => {
      fila.aplicar(
        evento({
          job: 'editor:9',
          project: 'canal-b',
          stage: 'editor_saved',
          percentage: 100,
          message: 'Outro projeto.',
        }),
      )
    })
    expect(resSalv.current.clipId).toBe(1)

    act(() => {
      fila.aplicar(
        evento({
          job: 'editor',
          project: null,
          stage: 'editor_save_failed',
          percentage: 0,
          message: 'Não foi possível salvar o Corte.',
          error: { code: 'project_write', message: 'disco cheio' },
        }),
      )
    })

    expect(resFila.current).toEqual([])
    expect(resSalv.current.estado).toBe('erro')
    expect(resSalv.current.erro?.code).toBe('project_write')
    expect(resSalv.current.erro?.detalhe).toBe('disco cheio')

    act(() => {
      resSalv.current.limparErro()
    })
    expect(resSalv.current.estado).toBe('ocioso')
    expect(resSalv.current.erro).toBeUndefined()
  })

  it('sincronizarExterno hidrata jobs em voo para FechamentoJanela sem inventar ETA (#303) e limpa ao fechar Projeto', () => {
    let t = 5000
    const fila = criarFila(() => 'canal-a', () => t)

    // Evento global ao vivo deve permanecer após limpar externos de Projeto
    fila.aplicar(evento({ job: 'ffmpeg', project: null, stage: 'download', percentage: 30 }))

    // Hidrata jobs ativos após reload (sem passar por 0% nesta sessão)
    fila.sincronizarExterno?.([
      {
        id: '11',
        etapa: 'export',
        percentual: 45,
        mensagem: 'Exportando Corte',
        estado: 'rodando',
      },
      {
        id: 'export-batch-5',
        etapa: 'export_batch',
        percentual: 60,
        mensagem: 'Exportando lote',
        estado: 'rodando',
      },
    ])

    const job11 = fila.jobs().find((j) => j.id === '11')
    expect(job11).toMatchObject({ id: '11', etapa: 'export', percentual: 45, estado: 'rodando' })
    expect(job11?.etaMs).toBeUndefined()
    expect(fila.jobs().find((j) => j.id === 'export-batch-5')?.estado).toBe('rodando')

    // Mesmo se progredir depois via core-progress, não inventa ETA porque não foi visto desde 0%
    t = 15_000
    fila.aplicar(evento({ job: '11', project: 'canal-a', stage: 'export', percentage: 70 }))
    expect(fila.jobs().find((j) => j.id === '11')?.etaMs).toBeUndefined()

    // Ao fechar Projeto, limparProjeto remove jobs de Projeto mantendo o global ao vivo
    fila.limparProjeto?.()
    expect(fila.jobs().map((j) => j.id)).toEqual(['ffmpeg'])
  })

  it('formatarTempoDecorrido formata segundos, minutos e horas e ignora nulos ou inválidos', () => {
    expect(formatarTempoDecorrido(null, 50_000)).toBeNull()
    expect(formatarTempoDecorrido(undefined, 50_000)).toBeNull()
    expect(formatarTempoDecorrido(0, 50_000)).toBeNull()
    expect(formatarTempoDecorrido(60_000, 50_000)).toBe('0 s')
    expect(formatarTempoDecorrido(10_000, 55_000)).toBe('45 s')
    expect(formatarTempoDecorrido(1_000, 126_000)).toBe('2 min 5 s')
    expect(formatarTempoDecorrido(1_000, 121_000)).toBe('2 min')
    expect(formatarTempoDecorrido(1_000, 3_661_000)).toBe('1 h 1 min')
    expect(formatarTempoDecorrido(1_000, 7_201_000)).toBe('2 h')
  })

  it('sincronizarExterno propaga startedAtMs e alvo e aplicar preserva-os em core-progress', () => {
    let t = 100_000
    const fila = criarFila(() => 'canal-a', () => t)

    fila.sincronizarExterno?.([
      {
        id: '15',
        etapa: 'export',
        percentual: 20,
        mensagem: 'export',
        estado: 'rodando',
        startedAtMs: 55_000,
        alvo: 'Melhor jogada da live',
      },
    ])

    const hidratado = fila.jobs().find((j) => j.id === '15')
    expect(hidratado?.startedAtMs).toBe(55_000)
    expect(hidratado?.alvo).toBe('Melhor jogada da live')
    expect(hidratado?.inicioMs).toBe(55_000)
    expect(hidratado?.etaMs).toBeUndefined()

    t = 110_000
    fila.aplicar(evento({ job: '15', project: 'canal-a', stage: 'export', percentage: 60 }))
    const atualizado = fila.jobs().find((j) => j.id === '15')
    expect(atualizado?.percentual).toBe(60)
    expect(atualizado?.startedAtMs).toBe(55_000)
    expect(atualizado?.alvo).toBe('Melhor jogada da live')
  })
})
