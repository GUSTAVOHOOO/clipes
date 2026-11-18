import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import { usePreferencias } from '~/preferencias/preferencias'
import {
  criarStoreFontesProjeto,
  type FonteProjeto,
  type StoreFontesProjeto,
} from '~/stores/fontesProjeto'
import { Revisao } from '~/telas/cortes/Revisao'

const chamarMock = vi.fn()
let filaTeste: Fila = criarFila(() => 'demo')

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

vi.mock('~/core/progresso', async () => {
  const atual = await vi.importActual<typeof import('~/core/progresso')>('~/core/progresso')
  return {
    ...atual,
    useFila: () => atual.useFila(filaTeste),
  }
})

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute('data-index')) {
      return {
        width: 360,
        height: 56,
        top: 0,
        left: 0,
        bottom: 56,
        right: 360,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    }
    return {
      width: 380,
      height: 500,
      top: 0,
      left: 0,
      bottom: 500,
      right: 380,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
  }
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return 500
    },
  })
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {}
  }
  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }
})

const FONTES_PADRAO: FonteProjeto[] = [
  {
    id: 4,
    path: '/videos/Live_12_11_final.mp4',
    status: 'available',
    available: true,
    verified: true,
    audio_track: 1,
    origin_url: 'https://www.youtube.com/watch?v=live1211',
    language: 'pt',
    permission: { status: 'granted', who: 'Criador', where: 'YouTube', scope: 'Cortes' },
    metadata: { format: { duration: '3600.0' }, streams: [] },
  },
]

const PESOS_DIRETO = [
  { key: 'hook', weight: 0.3 },
  { key: 'selfContained', weight: 0.2 },
  { key: 'energy', weight: 0.2 },
  { key: 'value', weight: 0.15 },
  { key: 'closing', weight: 0.15 },
]

function criarRunBase(override: Record<string, unknown> = {}) {
  return {
    id: 1,
    transcriptId: 4,
    state: 'completed',
    minUs: 20_000_000,
    maxUs: 60_000_000,
    planState: 'full',
    revision: 2,
    revisions: [1, 2],
    videoKind: 'direct',
    profile: 'remoto-rapido',
    budgetPause: null,
    weights: PESOS_DIRETO,
    counts: { windows: 4, completed: 4, failed: 0, kept: 3, discarded: 0, merged: 0 },
    ...override,
  }
}

function criarJanelasPadrao(uncertain = false) {
  return [
    {
      index: 0,
      firstId: 1,
      lastId: 90,
      startUs: 0,
      endUs: 900_000_000,
      jobId: 10,
      state: 'completed',
      code: null,
      resetAtMs: null,
      profile: 'remoto-rapido',
    },
    {
      index: 1,
      firstId: 91,
      lastId: 180,
      startUs: 720_000_000,
      endUs: 1_620_000_000,
      jobId: 11,
      state: uncertain ? 'uncertain' : 'completed',
      code: uncertain ? 'timeout_uncertain' : null,
      resetAtMs: null,
      profile: 'remoto-rapido',
    },
  ]
}

function criarCandidatosPadrao(rev = 2) {
  return [
    {
      id: rev * 100 + 1,
      rank: 0,
      startId: 10,
      endId: 14,
      startUs: 90_000_000,
      endUs: 140_000_000,
      total: 8.8,
      title: 'A virada do jogo',
      windows: [0, 1],
      profile: 'remoto-rapido',
      revision: rev,
      adjusted: false,
      adjust: null,
      chat: [{ ratio: 3.1, reaction: 'laugh', atUs: 95_000_000 }],
      axes: {
        hook: { score: 9.2, why: 'Abre com tensão imediata.' },
        selfContained: { score: 8.5, why: 'História fechada.' },
        energy: { score: 8.4, why: 'Fala intensa.' },
        value: { score: 8.8, why: 'Lição clara.' },
        closing: { score: 8.1, why: 'Fechamento firme.' },
      },
    },
    {
      id: rev * 100 + 2,
      rank: 1,
      startId: 40,
      endId: 41,
      startUs: 390_000_000,
      endUs: 410_000_000,
      total: 7.5,
      title: '',
      windows: [0],
      profile: 'legacy',
      revision: rev,
      adjusted: true,
      adjust: { extendedAfter: 1 },
      chat: [],
      axes: {
        hook: { score: 7.5, why: 'Bom trecho.' },
        selfContained: { score: 7.5, why: 'Completo.' },
        energy: { score: 7.5, why: 'Estável.' },
        value: { score: 7.5, why: 'Útil.' },
        closing: { score: 7.5, why: 'Direto.' },
      },
    },
    {
      id: rev * 100 + 3,
      rank: 2,
      startId: 200,
      endId: 203,
      startUs: 1_990_000_000,
      endUs: 2_030_000_000,
      total: 5.2,
      title: 'Piada longa',
      windows: [1],
      profile: 'remoto-rapido',
      revision: rev,
      adjusted: false,
      adjust: null,
      chat: [],
    },
  ]
}

function criarItensRevisaoPadrao(rev = 2) {
  return [
    {
      candidate: rev * 100 + 1,
      status: 'pending' as const,
      adjusted: false,
      startId: 10,
      endId: 14,
      startUs: 90_000_000,
      endUs: 140_000_000,
      startText: 'Primeira frase 10 do Corte.',
      endText: 'Última frase 14 do Corte.',
      moves: { startEarlier: true, startLater: true, endEarlier: true, endLater: true },
    },
    {
      candidate: rev * 100 + 2,
      status: 'approved' as const,
      adjusted: false,
      startId: 40,
      endId: 41,
      startUs: 390_000_000,
      endUs: 410_000_000,
      startText: 'Primeira frase 40 do Corte.',
      endText: 'Última frase 41 do Corte.',
      moves: { startEarlier: true, startLater: false, endEarlier: false, endLater: true },
    },
    {
      candidate: rev * 100 + 3,
      status: 'rejected' as const,
      adjusted: false,
      startId: 200,
      endId: 203,
      startUs: 1_990_000_000,
      endUs: 2_030_000_000,
      startText: 'Primeira frase 200 do Corte.',
      endText: 'Última frase 203 do Corte.',
      moves: { startEarlier: true, startLater: true, endEarlier: true, endLater: true },
    },
  ]
}

function mockRevisaoBase(overrides: Partial<Record<string, (args: unknown) => unknown>> = {}) {
  let revAtiva = 2
  chamarMock.mockImplementation(async (cmd: string, args: unknown) => {
    if (Object.hasOwn(overrides, cmd)) {
      return overrides[cmd]!(args)
    }
    const a = (args ?? {}) as Record<string, unknown>
    switch (cmd) {
      case 'sources.list':
        return FONTES_PADRAO
      case 'batches.list':
        return []
      case 'transcription.status':
        return {
          language: 'pt',
          transcript: {
            id: 4,
            state: 'complete',
            resume_us: 3_600_000_000,
            duration_us: 3_600_000_000,
            model: 'whisper-turbo',
            engine: 'local',
            words: 30000,
          },
          job: null,
        }
      case 'selection.get': {
        if (typeof a.revision === 'number') revAtiva = a.revision
        return {
          run: criarRunBase({ revision: revAtiva }),
          windows: criarJanelasPadrao(),
          candidates: criarCandidatosPadrao(revAtiva),
        }
      }
      case 'selection.review':
        return {
          run: Number(a.run ?? 1),
          items: criarItensRevisaoPadrao(revAtiva),
          canUndo: true,
        }
      case 'proxy.request':
        return {
          state: 'ready',
          key: '0004abab',
          job: null,
          progress: 100,
          error: null,
          windowStartUs: 0,
          windowEndUs: 300_000_000,
        }
      case 'proxy.map_time':
        return { proxyUs: 90_000_000 }
      case 'guardrails.check':
        return {
          scope: 'single',
          directMonetizationAck: false,
          needsDirectNotice: true,
          over60s: false,
          permission: { status: 'granted', who: 'Criador', where: 'YouTube', scope: 'Cortes' },
        }
      case 'guardrails.ack_direct_notice':
        return { directMonetizationAck: true }
      case 'angles.get':
        return { angles: [], generation: null, selected: null, busy: false, job: null }
      case 'provider.profiles.list':
        return {
          profiles: [
            {
              id: 'remoto-rapido',
              label: 'Perfil Rápido',
              kind: 'openai',
              endpoint: 'https://api.openai.com/v1',
              model: 'gpt-4o-mini',
              local: false,
              cli: false,
            },
            {
              id: 'remoto-forte',
              label: 'Perfil Forte',
              kind: 'openai',
              endpoint: 'https://api.openai.com/v1',
              model: 'gpt-4o',
              local: false,
              cli: false,
            },
          ],
        }
      case 'assistant.tasks':
        return { projectLocalOnly: false, tasks: [] }
      case 'selection.estimate':
        return {
          run: Number(a.run ?? 1),
          windows: a.windows ?? [0, 1],
          profile: { id: String(a.profileId ?? 'remoto-forte'), label: 'Perfil Forte', kind: 'openai', model: 'gpt-4o' },
          paid: true,
          leavesMachine: true,
          estimate: { kind: 'usd', minMicroUsd: 2000, maxMicroUsd: 8000 },
        }
      case 'selection.redo':
        return { run: Number(a.run ?? 1), windows: a.windows ?? [0, 1], profile: { id: a.profileId } }
      default:
        return {}
    }
  })
}

function BotaoDesligarTeclasUnicas() {
  const [, mudar] = usePreferencias()
  return (
    <>
      <button
        type="button"
        onClick={() => mudar({ teclasUnicas: false, modoTeclasUnicas: 'desligadas' })}
      >
        Desligar teclas únicas
      </button>
      <button
        type="button"
        onClick={() => mudar({ teclasUnicas: true, modoTeclasUnicas: 'ativas' })}
      >
        Ligar teclas únicas
      </button>
    </>
  )
}

function envolver(children: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>{children}</ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>
  )
}

describe('Bancada de Revisão de Cortes (#/projeto/:id/cortes/revisao/:runId)', () => {
  let storeFontes: StoreFontesProjeto

  beforeEach(() => {
    localStorage.clear()
    filaTeste = criarFila(() => 'demo')
    storeFontes = criarStoreFontesProjeto()
    window.location.hash = '#/projeto/demo/cortes/revisao/1'
  })

  afterEach(() => {
    vi.clearAllMocks()
    window.location.hash = ''
  })

  it('redireciona para #/projeto/:id/cortes com toast quando :runId é inválido ou run_not_found', async () => {
    mockRevisaoBase({
      'selection.get': () => {
        throw new ErroCore('run_not_found', 'Execução não encontrada.')
      },
    })

    render(
      envolver(
        <Revisao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          runParam="999"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    await waitFor(() => {
      expect(window.location.hash).toBe('#/projeto/demo/cortes')
    })
    expect(await screen.findByText(/Esta execução de seleção não foi encontrada\./i)).toBeInTheDocument()
  })

  it('cobre estados §6: loading (<Esqueleto>), empty 0 candidatos e error', async () => {
    const user = userEvent.setup()

    // 1. loading forçado
    window.location.hash = '#/projeto/demo/cortes/revisao/1?estado=carregando'
    mockRevisaoBase()
    const { unmount } = render(
      envolver(
        <Revisao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          runParam="1"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )
    expect(screen.getByLabelText(/Carregando bancada de revisão/i)).toBeInTheDocument()
    unmount()

    // 2. empty 0 candidatos
    window.location.hash = '#/projeto/demo/cortes/revisao/1'
    mockRevisaoBase({
      'selection.get': () => ({
        run: criarRunBase({ counts: { windows: 2, completed: 2, failed: 0, kept: 0, discarded: 0, merged: 0 } }),
        windows: criarJanelasPadrao(),
        candidates: [],
      }),
      'selection.review': () => ({ run: 1, items: [], canUndo: false }),
    })
    const rEmpty = render(
      envolver(
        <Revisao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          runParam="1"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )
    expect(await screen.findByText('Nenhum candidato gerado nesta execução')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Voltar à seleção para tentar outro Perfil/i }))
    expect(window.location.hash).toMatch(/^#\/projeto\/demo\/cortes(\?|$)/)
    rEmpty.unmount()

    // 3. error via ?estado=erro
    window.location.hash = '#/projeto/demo/cortes/revisao/1?estado=erro'
    mockRevisaoBase()
    const rErro = render(
      envolver(
        <Revisao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          runParam="1"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    rErro.unmount()
  })

  it('cobre estado empty de filtro ("Limpar filtros") e estado partial com bloqueio de redo em janela uncertain', async () => {
    const user = userEvent.setup()

    // empty de filtro (Nota mínima / estado sem correspondência)
    window.location.hash = '#/projeto/demo/cortes/revisao/1'
    mockRevisaoBase()
    const rFiltroVazio = render(
      envolver(
        <Revisao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          runParam="1"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )
    const sliderNota = await screen.findByRole('slider', { name: /Nota mínima/i })
    fireEvent.change(sliderNota, { target: { value: '9.5' } })
    expect(await screen.findByText('Nenhum candidato corresponde aos filtros atuais')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'A virada do jogo' })).toBeInTheDocument()
    rFiltroVazio.unmount()

    // partial com link para C.1 e bloqueio de redo (UI-12)
    window.location.hash = '#/projeto/demo/cortes/revisao/1'
    mockRevisaoBase({
      'selection.get': () => ({
        run: criarRunBase({
          state: 'partial',
          counts: { windows: 4, completed: 3, failed: 1, kept: 3, discarded: 0, merged: 0 },
        }),
        windows: criarJanelasPadrao(true),
        candidates: criarCandidatosPadrao(2),
      }),
    })
    render(
      envolver(
        <Revisao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          runParam="1"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )
    expect(await screen.findByText(/Esta execução está parcial \(3\/4 Janelas\)/i)).toBeInTheDocument()

    // Botão Refazer bloqueado quando há janela uncertain e sem expor ticket (UI-12)
    const btnRefazer = screen.getByRole('button', { name: /Refazer com outro Perfil/i })
    expect(btnRefazer).toHaveAttribute('aria-disabled', 'true')
    const textoSemRunId = (document.body.textContent ?? '').replace(/Execução\s+#\d+/g, '')
    expect(textoSemRunId).not.toMatch(/#\d+/)

    await user.click(screen.getByRole('button', { name: /Retomar na tela de seleção/i }))
    expect(window.location.hash).toContain('#/projeto/demo/cortes?')
    expect(window.location.hash).toContain('run=1')
  })

  it('mantém revisão interativa durante job_running de proxy e redo em background via core-progress', async () => {
    mockRevisaoBase({
      'proxy.request': () => ({
        state: 'running',
        key: '0004abab',
        job: 7,
        progress: 35,
        error: null,
        windowStartUs: 0,
        windowEndUs: 300_000_000,
      }),
      'proxy.status': () => ({
        state: 'ready',
        key: '0004abab',
        job: 7,
        progress: 100,
        error: null,
      }),
    })

    render(
      envolver(
        <Revisao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          runParam="1"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    expect(await screen.findByRole('button', { name: /Cancelar preview/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Aprovar/i })).toBeEnabled()

    act(() => {
      filaTeste.aplicar({
        job: 'selection-1',
        project: 'demo',
        stage: 'selection:window',
        percentage: 50,
        message: 'Refazendo Janela',
        error: null,
      })
    })

    expect(
      await screen.findByText(/Gerando nova revisão da execução em segundo plano/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Aprovar/i })).toBeEnabled()

    act(() => {
      filaTeste.aplicar({
        job: 'selection-1',
        project: 'demo',
        stage: 'selection:done',
        percentage: 100,
        message: 'Nova revisão disponível',
        error: null,
      })
    })

    expect(await screen.findByText(/Nova revisão \(v2\) disponível/i)).toBeInTheDocument()
  })

  it('aplica atualização otimista com rollback em selection.decide e suporta selection.undo entre sessões', async () => {
    const user = userEvent.setup()
    let rejeitarDecide = true
    mockRevisaoBase({
      'selection.decide': () => {
        if (rejeitarDecide) {
          return Promise.reject(new ErroCore('project_busy', 'Projeto ocupado.'))
        }
        return Promise.resolve({
          run: 1,
          item: { ...criarItensRevisaoPadrao(2)[0], status: 'approved' },
          canUndo: true,
        })
      },
      'selection.undo': () => ({
        run: 1,
        item: { ...criarItensRevisaoPadrao(2)[1], status: 'pending' },
        canUndo: false,
      }),
    })

    let resolvePendente!: (v: unknown) => void

    // Reconfigura com controle manual da promise de decide para provar otimismo antes da resposta
    mockRevisaoBase({
      'selection.decide': () =>
        new Promise((resolve, reject) => {
          resolvePendente = rejeitarDecide ? reject : resolve
        }),
      'selection.undo': () => ({
        run: 1,
        item: { ...criarItensRevisaoPadrao(2)[1], status: 'pending' },
        canUndo: false,
      }),
    })

    render(
      envolver(
        <Revisao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          runParam="1"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    expect(await screen.findByRole('heading', { level: 2, name: 'A virada do jogo' })).toBeInTheDocument()
    expect(screen.getByText(/1 aprovados · 1 rejeitados · 1 pendentes/i)).toBeInTheDocument()

    // Desfazer já inicia habilitado quando canUndo: true da V1
    const btnDesfazer = screen.getByRole('button', { name: /Desfazer/i })
    expect(btnDesfazer).toBeEnabled()

    // Aprovação otimista atualiza contador antes da Promise rejeitar
    await user.click(screen.getByRole('button', { name: /Aprovar/i }))
    expect(screen.getByText(/2 aprovados · 1 rejeitados · 0 pendentes/i)).toBeInTheDocument()

    // Rollback ao rejeitar
    act(() => {
      resolvePendente(new ErroCore('project_busy', 'Projeto ocupado.'))
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(/tarefa ativa bloqueando/i)
    expect(screen.getByText(/1 aprovados · 1 rejeitados · 1 pendentes/i)).toBeInTheDocument()

    // Undo entre sessões reverte item 102 e seleciona-o na Bancada
    rejeitarDecide = false
    await user.click(btnDesfazer)
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.undo', { run: 1 })
    })
    expect(await screen.findByRole('heading', { level: 2, name: 'Sem título' })).toBeInTheDocument()
    expect(screen.getByText(/0 aprovados · 1 rejeitados · 2 pendentes/i)).toBeInTheDocument()
    expect(btnDesfazer).toHaveAttribute('aria-disabled', 'true')
  })

  it('alterna Revisão da execução (?rev=:n) chamando selection.get + selection.review e abre <SeletorPerfilRedo>', async () => {
    const user = userEvent.setup()
    mockRevisaoBase()

    render(
      envolver(
        <Revisao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          runParam="1"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    const selectRev = await screen.findByRole('combobox', { name: /Revisão da execução/i })
    await user.click(selectRev)
    await user.click(await screen.findByRole('option', { name: 'v1' }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.get', { run: 1, revision: 1 })
      expect(chamarMock).toHaveBeenCalledWith('selection.review', { run: 1 })
    })
    expect(window.location.hash).toContain('rev=1')

    // Abre "Refazer com outro Perfil…" via selection.redo (#304)
    await user.click(screen.getByRole('button', { name: /Refazer com outro Perfil/i }))
    const dlg = await screen.findByRole('alertdialog')
    await waitFor(() => {
      expect(within(dlg).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })
    await user.click(within(dlg).getByRole('button', { name: /Refazer com este perfil/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.redo', {
        run: 1,
        windows: [0, 1],
        profileId: 'remoto-forte',
        confirmed: true,
      })
    })
  })

  it('registra atalhos A, R, I/Shift+I, O/Shift+O, Ctrl+Z, Espaço/J/K/L/←/→ e F6 via useAtalhos', async () => {
    let statusCand1: 'pending' | 'approved' | 'rejected' = 'pending'
    mockRevisaoBase({
      'selection.decide': (args) => {
        const a = args as { candidate: number; decision: 'approved' | 'rejected' }
        if (a.candidate === 201) statusCand1 = a.decision
        return {
          run: 1,
          item: { ...criarItensRevisaoPadrao(2)[0], status: statusCand1 },
          canUndo: true,
        }
      },
      'selection.adjust': (args) => {
        const a = args as { edge: 'start' | 'end'; delta: number }
        if (a.edge === 'end' && a.delta === -1) {
          throw new ErroCore('adjust_too_short', 'Abaixo da duração mínima.')
        }
        return {
          run: 1,
          item: {
            ...criarItensRevisaoPadrao(2)[0],
            status: statusCand1,
            adjusted: true,
            startId: 9,
            startUs: 80_000_000,
            startText: 'Primeira frase 9 do Corte.',
          },
          canUndo: true,
        }
      },
      'selection.undo': () => {
        statusCand1 = 'pending'
        return {
          run: 1,
          item: { ...criarItensRevisaoPadrao(2)[0], status: 'pending' },
          canUndo: false,
        }
      },
    })

    render(
      envolver(
        <Revisao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          runParam="1"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    expect(await screen.findByRole('heading', { level: 2, name: 'A virada do jogo' })).toBeInTheDocument()

    // A aprova candidato
    fireEvent.keyDown(window, { key: 'a' })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.decide', {
        candidate: 201,
        decision: 'approved',
      })
    })

    // R rejeita candidato
    fireEvent.keyDown(window, { key: 'r' })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.decide', {
        candidate: 201,
        decision: 'rejected',
      })
    })

    // I / Shift+I / O / Shift+O ajustam bordas e erro adjust_too_short aparece inline
    fireEvent.keyDown(window, { key: 'i' })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.adjust', {
        candidate: 201,
        edge: 'start',
        delta: -1,
      })
    })
    expect(await screen.findByText('Primeira frase 9 do Corte.')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'I', shiftKey: true })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.adjust', {
        candidate: 201,
        edge: 'start',
        delta: 1,
      })
    })

    fireEvent.keyDown(window, { key: 'o' })
    expect(await screen.findByRole('alert')).toHaveTextContent(/abaixo da duração mínima/i)

    fireEvent.keyDown(window, { key: 'O', shiftKey: true })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.adjust', {
        candidate: 201,
        edge: 'end',
        delta: 1,
      })
    })

    // Ctrl+Z desfaz
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.undo', { run: 1 })
    })

    // Transporte: Espaço, L, →, J, ←, K
    const toolbar = screen.getByRole('toolbar', { name: /Controles de reprodução/i })
    fireEvent.keyDown(window, { key: ' ' })
    expect(within(toolbar).getByRole('button', { name: /Pausar/i })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'k' })
    expect(within(toolbar).getByRole('button', { name: /Reproduzir/i })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'l' })
    expect(within(toolbar).getByLabelText(/Posição 00:05,0/i)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(within(toolbar).getByLabelText(/Posição 00:06,0/i)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(within(toolbar).getByLabelText(/Posição 00:05,0/i)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'j' })
    expect(within(toolbar).getByLabelText(/Posição 00:00,0/i)).toBeInTheDocument()

    // F6 cicla Sub-cabeçalho -> Lista -> Detalhe -> Sub-cabeçalho
    fireEvent.keyDown(window, { key: 'F6' })
    expect(screen.getByRole('navigation', { name: /Controles da revisão/i }).contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(window, { key: 'F6' })
    expect(screen.getByRole('region', { name: /Lista de candidatos/i }).contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(window, { key: 'F6' })
    expect(screen.getByRole('region', { name: /Detalhe do Corte/i }).contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(window, { key: 'F6', shiftKey: true })
    expect(screen.getByRole('region', { name: /Lista de candidatos/i }).contains(document.activeElement)).toBe(true)
  })

  it('respeita campos de texto e modo WCAG 2.1.4 e só abre Editor com Enter quando aprovado', async () => {
    const user = userEvent.setup()
    mockRevisaoBase({
      'selection.decide': () => ({
        run: 1,
        item: { ...criarItensRevisaoPadrao(2)[0], status: 'approved' },
        canUndo: true,
      }),
    })

    render(
      envolver(
        <div>
          <input aria-label="Campo externo" />
          <BotaoDesligarTeclasUnicas />
          <Revisao
            projetoId="demo"
            projetoPath="/projetos/Demo.clipes"
            runParam="1"
            storeFontes={storeFontes}
            fila={filaTeste}
          />
        </div>,
      ),
    )

    expect(await screen.findByRole('heading', { level: 2, name: 'A virada do jogo' })).toBeInTheDocument()

    // Enter em pendente NÃO navega
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(window.location.hash).not.toContain('/editar')

    // Campo de texto bloqueia teclas únicas
    chamarMock.mockClear()
    const campo = screen.getByRole('textbox', { name: 'Campo externo' })
    campo.focus()
    await user.keyboard('arioljk ')
    expect(chamarMock).not.toHaveBeenCalledWith('selection.decide', expect.anything())
    expect(chamarMock).not.toHaveBeenCalledWith('selection.adjust', expect.anything())

    // WCAG 2.1.4: teclas únicas desligadas não disparam A/R/I/O/J/K/L/Espaço
    await user.click(screen.getByRole('button', { name: 'Desligar teclas únicas' }))
    campo.blur()
    fireEvent.keyDown(window, { key: 'a' })
    expect(chamarMock).not.toHaveBeenCalledWith('selection.decide', expect.anything())
    await user.click(screen.getByRole('button', { name: 'Ligar teclas únicas' }))

    // Reaprova por clique e pressiona Enter para navegar para o Editor
    await user.click(screen.getByRole('button', { name: /Aprovar/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Abrir no editor/i })).toBeEnabled()
    })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(window.location.hash).toBe('#/projeto/demo/corte/201/editar?run=1')
  })

  it('UI-31a: não exibe banner de redo quando há job ai:selection rodando de outro run ou janela cancelada', async () => {
    mockRevisaoBase()

    render(
      envolver(
        <Revisao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          runParam="1"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    expect(await screen.findByRole('heading', { level: 1, name: /Execução #1/i })).toBeInTheDocument()

    // Job de seleção de OUTRO run (Run #2, window jobId 99 e selection-2) rodando na Fila global
    act(() => {
      filaTeste.aplicar({
        job: '99',
        project: 'demo',
        stage: 'ai:selection:call',
        percentage: 10,
        message: 'Consultando Provedor',
        error: null,
      })
      filaTeste.aplicar({
        job: 'selection-2',
        project: 'demo',
        stage: 'selection:window',
        percentage: 50,
        message: 'Janela da seleção 2',
        error: null,
      })
    })

    expect(
      screen.queryByText(/Gerando nova revisão da execução em segundo plano/i),
    ).not.toBeInTheDocument()
  })

  it('UI-32b: substitui <span tabIndex={0}> por aria-disabled="true" direto nos botões Desfazer e Refazer bloqueados', async () => {
    const user = userEvent.setup()
    mockRevisaoBase({
      'selection.get': () => ({
        run: criarRunBase({ state: 'partial' }),
        windows: criarJanelasPadrao(true),
        candidates: criarCandidatosPadrao(2),
      }),
      'selection.review': () => ({
        run: 1,
        items: criarItensRevisaoPadrao(2),
        canUndo: false,
      }),
    })

    const { container } = render(
      envolver(
        <Revisao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          runParam="1"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    expect(await screen.findByRole('heading', { level: 1, name: /Execução #1/i })).toBeInTheDocument()
    expect(container.querySelector('span[tabindex="0"]')).toBeNull()

    const btnDesfazer = screen.getByRole('button', { name: /Desfazer/i })
    const btnRefazer = screen.getByRole('button', { name: /Refazer com outro Perfil/i })
    expect(btnDesfazer).toHaveAttribute('aria-disabled', 'true')
    expect(btnDesfazer).not.toBeDisabled()
    expect(btnRefazer).toHaveAttribute('aria-disabled', 'true')
    expect(btnRefazer).not.toBeDisabled()

    await user.click(btnDesfazer)
    await user.click(btnRefazer)
    expect(chamarMock).not.toHaveBeenCalledWith('selection.undo', expect.anything())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('UI-33c: mantém o sub-cabeçalho compacto sem rótulo "Revisão:" redundante e com flex-nowrap a partir de 1280px', async () => {
    mockRevisaoBase()

    render(
      envolver(
        <Revisao
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          runParam="1"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    const nav = await screen.findByRole('navigation', { name: /Controles da revisão/i })
    expect(nav.className).toContain('min-[1280px]:flex-nowrap')
    expect(within(nav).queryByText('Revisão:')).not.toBeInTheDocument()
  })
})
