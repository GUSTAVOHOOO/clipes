import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarFila, type EventoProgresso } from '~/core/progresso'
import {
  criarStoreSelecaoProjeto,
  resolverDestinoSelecao,
  useSelecaoProjeto,
  type PerfilProvedorLista,
  type RespostaTarefasAssistente,
} from '~/stores/selecaoProjeto'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

const PERFIS_EXEMPLO: PerfilProvedorLista[] = [
  {
    id: 'local-ollama',
    label: 'Ollama Local',
    kind: 'ollama',
    endpoint: 'http://127.0.0.1:11434/v1',
    model: 'qwen3:8b',
    local: true,
    cli: false,
  },
  {
    id: 'remoto-openai',
    label: 'OpenAI GPT-4o',
    kind: 'openai',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    local: false,
    cli: false,
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    kind: 'codex',
    endpoint: null,
    model: null,
    local: false,
    cli: true,
  },
  {
    id: 'claude',
    label: 'Claude Code CLI',
    kind: 'claude',
    endpoint: null,
    model: 'sonnet',
    local: false,
    cli: true,
  },
  {
    id: 'opencode',
    label: 'OpenCode CLI',
    kind: 'opencode',
    endpoint: null,
    model: 'opencode/big-pickle',
    local: false,
    cli: true,
  },
]

const TAREFAS_BASE: RespostaTarefasAssistente = {
  projectLocalOnly: false,
  tasks: [
    {
      task: 'selection',
      choice: 'profile:remoto-openai',
      source: 'task',
      profile: {
        id: 'remoto-openai',
        label: 'OpenAI GPT-4o',
        kind: 'openai',
        local: false,
      },
      localOnly: false,
      blocked: false,
      missing: null,
    },
  ],
}

describe('resolverDestinoSelecao', () => {
  it('distingue perfil local (loopback), remoto (HTTPS com host) e CLIs (codex/claude/opencode)', () => {
    const local = resolverDestinoSelecao('local-ollama', PERFIS_EXEMPLO, TAREFAS_BASE)
    expect(local.localidade).toBe('local')
    expect(local.saiDaMaquina).toBe(false)
    expect(local.perfil).toEqual({
      id: 'local-ollama',
      label: 'Ollama Local',
      kind: 'local',
      model: 'qwen3:8b',
    })
    expect(local.bloqueadoSomenteLocal).toBe(false)

    const remoto = resolverDestinoSelecao('remoto-openai', PERFIS_EXEMPLO, TAREFAS_BASE)
    expect(remoto.localidade).toBe('remoto')
    expect(remoto.saiDaMaquina).toBe(true)
    expect(remoto.host).toBe('api.openai.com')
    expect(remoto.perfil.kind).toBe('api')
    expect(remoto.bloqueadoSomenteLocal).toBe(false)

    for (const cliId of ['codex', 'claude', 'opencode']) {
      const cli = resolverDestinoSelecao(cliId, PERFIS_EXEMPLO, TAREFAS_BASE)
      expect(cli.localidade).toBe('cli')
      expect(cli.saiDaMaquina).toBe(true)
      expect(cli.perfil.kind).toBe('cli')
    }
  })

  it('sinaliza bloqueadoSomenteLocal para destinos externos quando projectLocalOnly ou task.localOnly está ativo', () => {
    const tarefasSomenteLocal: RespostaTarefasAssistente = {
      projectLocalOnly: true,
      tasks: [{ ...TAREFAS_BASE.tasks[0], blocked: true }],
    }

    expect(resolverDestinoSelecao('remoto-openai', PERFIS_EXEMPLO, tarefasSomenteLocal).bloqueadoSomenteLocal).toBe(true)
    expect(resolverDestinoSelecao('codex', PERFIS_EXEMPLO, tarefasSomenteLocal).bloqueadoSomenteLocal).toBe(true)
    expect(resolverDestinoSelecao('local-ollama', PERFIS_EXEMPLO, tarefasSomenteLocal).bloqueadoSomenteLocal).toBe(false)
  })
})

describe('criarStoreSelecaoProjeto e useSelecaoProjeto', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('invalida e recarrega selection.get/list/review ao receber selection:window, selection:done, ai:selection:*:done/paused, energy/chat complete e proxy complete/failed', async () => {
    let revisaoAtual = 1
    let estadoRun = 'running'

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'selection.list') {
        return [{ id: 1, state: estadoRun, revision: revisaoAtual, revisions: [1] }]
      }
      if (cmd === 'selection.get') {
        return {
          run: { id: 1, state: estadoRun, revision: revisaoAtual, revisions: [1] },
          windows: [{ index: 0, state: estadoRun === 'completed' ? 'completed' : 'running', jobId: 10, profile: 'local-ollama' }],
          candidates: [],
        }
      }
      if (cmd === 'selection.review') {
        return { run: 1, items: [], canUndo: false }
      }
      return null
    })

    const fila = criarFila(() => null)
    const store = criarStoreSelecaoProjeto()
    store.definirProjeto('/projetos/Demo.clipes')

    await store.carregarRuns(4)
    await store.carregarExecucao(1)
    await store.carregarRevisao(1)

    expect(store.obterSnapshot().execucaoAtiva?.run.revision).toBe(1)

    revisaoAtual = 2
    estadoRun = 'completed'

    const enviarEvento = (ev: EventoProgresso) => {
      fila.aplicar(ev)
      store.registrarEventoProgresso(ev)
    }

    enviarEvento({
      job: '10',
      stage: 'selection:window',
      percentage: 50,
      message: 'Janela 1 concluída',
      error: null,
    })

    await waitFor(() => {
      expect(store.obterSnapshot().execucaoAtiva?.run.revision).toBe(2)
    })

    const chamadasAposWindow = chamarMock.mock.calls.filter((c) => c[0] === 'selection.get').length

    enviarEvento({
      job: '10',
      stage: 'selection:done',
      percentage: 100,
      message: 'Seleção concluída',
      error: null,
    })

    await waitFor(() => {
      expect(chamarMock.mock.calls.filter((c) => c[0] === 'selection.get').length).toBeGreaterThan(chamadasAposWindow)
    })

    const versaoAntesSinais = store.obterSnapshot().versaoInvalidacaoSinais
    store.sincronizarJobs([
      {
        id: '31',
        etapa: 'energy',
        percentual: 50,
        mensagem: 'Medindo energia',
        estado: 'rodando',
        inicioMs: 1,
      },
    ])
    store.sincronizarJobs([
      {
        id: '31',
        etapa: 'complete',
        percentual: 100,
        mensagem: 'Energia pronta',
        estado: 'concluido',
        inicioMs: 1,
      },
    ])
    expect(store.obterSnapshot().versaoInvalidacaoSinais).toBeGreaterThan(versaoAntesSinais)

    const versaoAntesProxy = store.obterSnapshot().versaoInvalidacaoSinais
    store.sincronizarJobs([
      {
        id: '7',
        etapa: 'proxy',
        percentual: 40,
        mensagem: 'Preparando proxy',
        estado: 'rodando',
        inicioMs: 1,
      },
    ])
    store.sincronizarJobs([
      {
        id: '7',
        etapa: 'failed',
        percentual: 0,
        mensagem: 'Proxy falhou',
        estado: 'falhou',
        inicioMs: 1,
      },
    ])
    expect(store.obterSnapshot().versaoInvalidacaoSinais).toBeGreaterThan(versaoAntesProxy)

    const chamadasAntesAi = chamarMock.mock.calls.filter((c) => c[0] === 'selection.get').length
    store.sincronizarJobs([
      {
        id: '11',
        etapa: 'ai:selection:janela-1:paused',
        percentual: 60,
        mensagem: 'Pausado por orçamento',
        estado: 'pausado',
        inicioMs: 1,
      },
    ])
    await waitFor(() => {
      expect(chamarMock.mock.calls.filter((c) => c[0] === 'selection.get').length).toBeGreaterThan(chamadasAntesAi)
    })
  })

  it('limpa integralmente o cache quando projetoPath muda ou vira null', async () => {
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'selection.list') return [{ id: 1, state: 'completed', revision: 1, revisions: [1] }]
      if (cmd === 'selection.get') {
        return { run: { id: 1, state: 'completed', revision: 1, revisions: [1] }, windows: [], candidates: [] }
      }
      if (cmd === 'selection.review') return { run: 1, items: [], canUndo: false }
      return null
    })

    const { result, rerender } = renderHook(
      ({ projetoPath }: { projetoPath: string | null }) => useSelecaoProjeto(projetoPath),
      { initialProps: { projetoPath: '/projetos/A.clipes' as string | null } },
    )

    await act(async () => {
      await result.current.carregarRuns(4)
      await result.current.carregarExecucao(1)
      await result.current.carregarRevisao(1)
    })

    expect(result.current.runsPorFonte[4]).toHaveLength(1)
    expect(result.current.execucaoAtiva?.run.id).toBe(1)
    expect(result.current.revisaoAtiva?.run).toBe(1)

    rerender({ projetoPath: '/projetos/B.clipes' })
    expect(result.current.runsPorFonte).toEqual({})
    expect(result.current.execucaoAtiva).toBeNull()
    expect(result.current.revisaoAtiva).toBeNull()

    await act(async () => {
      await result.current.carregarRuns(4)
    })
    expect(result.current.runsPorFonte[4]).toHaveLength(1)

    rerender({ projetoPath: null })
    expect(result.current.runsPorFonte).toEqual({})
    expect(result.current.execucaoAtiva).toBeNull()
    expect(result.current.revisaoAtiva).toBeNull()
  })

  it('preserva code e usage ao normalizar erro bruto sem propriedade message', async () => {
    const usage = { estimate: { kind: 'usd', minMicroUsd: 1000, maxMicroUsd: 2000 } }
    chamarMock.mockRejectedValueOnce({ code: 'window_uncertain', usage })

    const store = criarStoreSelecaoProjeto()
    store.definirProjeto('/projetos/Demo.clipes')

    expect(await store.carregarExecucao(7)).toBeNull()

    expect(store.obterSnapshot().erroExecucao).toMatchObject({
      code: 'window_uncertain',
      detalhe: '',
      usage,
    })
  })
})
