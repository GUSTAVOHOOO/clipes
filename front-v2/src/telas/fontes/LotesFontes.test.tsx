import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import {
  criarStoreFontesProjeto,
  type FonteProjeto,
  type LoteFontes,
  type StoreFontesProjeto,
} from '~/stores/fontesProjeto'
import { Fontes } from '~/telas/fontes/Fontes'
import { LotesFontes } from '~/telas/fontes/LotesFontes'

const chamarMock = vi.fn()
let filaTeste: Fila = criarFila(() => null)

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
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {}
  }
  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }
})

function envolver(children: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>{children}</ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>
  )
}

function erroComUsage(code: string, message: string, usage?: unknown): ErroCore {
  return new ErroCore(code, message, usage)
}

const FONTES_LOTES: FonteProjeto[] = [
  {
    id: 1,
    path: '/videos/Live_12_11_final.mp4',
    status: 'available',
    available: true,
    verified: true,
    audio_track: 1,
    origin_url: null,
    language: 'pt',
    permission: { status: 'granted', who: 'Criador', where: 'Discord', scope: 'cortes e tradução' },
    metadata: { format: { duration: '3600.0' }, streams: [] },
  },
  {
    id: 2,
    path: '/videos/VOD_09_11_offline.mp4',
    status: 'offline',
    available: false,
    verified: false,
    audio_track: 1,
    origin_url: null,
    language: 'pt',
    permission: { status: 'none' },
    metadata: { format: { duration: '6600.0' }, streams: [] },
  },
  {
    id: 3,
    path: '/videos/Live_15_11_cortada.mp4',
    status: 'available',
    available: true,
    verified: true,
    audio_track: 1,
    origin_url: null,
    language: 'pt',
    permission: { status: 'none' },
    metadata: { format: { duration: '1800.0' }, streams: [] },
  },
]

const LOTE_RUNNING: LoteFontes = {
  id: 4,
  key: 'sources-4',
  state: 'running',
  status: 'running',
  engine: 'local',
  videoKind: 'direct',
  minUs: 20_000_000,
  maxUs: 60_000_000,
  pause: null,
  budget: {
    scope: 'batch',
    key: 'sources-4',
    maxCostMicroUsd: 2_000_000,
    unknownConfirmed: false,
    paused: null,
    usage: { microUsd: 140_000, costLabel: null },
  },
  counts: { total: 2, completed: 0, paused: 0, active: 1, pending: 1, cancelled: 0 },
  items: [
    {
      position: 0,
      sourceId: 1,
      name: 'Live_12_11_final.mp4',
      state: 'transcribing',
      error: null,
      progress: 62,
      transcriptionJob: 401,
      selectionRun: null,
    },
    {
      position: 1,
      sourceId: 3,
      name: 'Live_15_11_cortada.mp4',
      state: 'pending',
      error: null,
      progress: 0,
      transcriptionJob: null,
      selectionRun: null,
    },
  ],
}

const LOTE_ATTENTION: LoteFontes = {
  id: 3,
  key: 'sources-3',
  state: 'running',
  status: 'attention',
  engine: 'groq',
  videoKind: 'transformed',
  minUs: 15_000_000,
  maxUs: 90_000_000,
  pause: null,
  budget: null,
  counts: { total: 2, completed: 1, paused: 1, active: 0, pending: 0, cancelled: 0 },
  items: [
    {
      position: 0,
      sourceId: 1,
      name: 'Live_12_11_final.mp4',
      state: 'completed',
      error: null,
      progress: 100,
      transcriptionJob: null,
      selectionRun: 7,
    },
    {
      position: 1,
      sourceId: 3,
      name: 'Live_15_11_cortada.mp4',
      state: 'paused',
      error: 'rate_limit',
      progress: 80,
      transcriptionJob: null,
      selectionRun: 8,
    },
  ],
}

const LOTE_BUDGET_UNKNOWN: LoteFontes = {
  id: 5,
  key: 'sources-5',
  state: 'running',
  status: 'budget_paused',
  engine: 'local',
  videoKind: 'direct',
  minUs: 20_000_000,
  maxUs: 60_000_000,
  pause: 'cost_unknown',
  budget: {
    scope: 'batch',
    key: 'sources-5',
    maxCostMicroUsd: 1_000_000,
    unknownConfirmed: false,
    paused: 'cost_unknown',
    usage: { microUsd: 0, unknownCostCalls: 1, costLabel: 'custo desconhecido' },
  },
  counts: { total: 2, completed: 1, paused: 0, active: 0, pending: 1, cancelled: 0 },
  items: [
    {
      position: 0,
      sourceId: 1,
      name: 'Live_12_11_final.mp4',
      state: 'completed',
      error: null,
      progress: 100,
      transcriptionJob: null,
      selectionRun: 10,
    },
    {
      position: 1,
      sourceId: 3,
      name: 'Live_15_11_cortada.mp4',
      state: 'pending',
      error: null,
      progress: 0,
      transcriptionJob: null,
      selectionRun: null,
    },
  ],
}

function mockBase({
  fontes = FONTES_LOTES,
  lotes = [] as LoteFontes[],
  localOnly = false,
  selecaoPerfil = {
    id: 'legacy',
    label: 'OpenAI Rápido',
    kind: 'openai',
    model: 'gpt-4o-mini',
    local: false,
    cli: false,
    cost: { kind: 'unknown' },
  },
  overrides,
}: {
  fontes?: FonteProjeto[]
  lotes?: LoteFontes[]
  localOnly?: boolean
  selecaoPerfil?: {
    id: string
    label: string
    kind: string
    model: string | null
    local: boolean
    cli: boolean
    cost: { kind: string }
  } | null
  overrides?: Partial<Record<string, (args: unknown) => unknown>>
} = {}) {
  chamarMock.mockImplementation(async (cmd: string, args: unknown) => {
    if (overrides && Object.hasOwn(overrides, cmd)) {
      return overrides[cmd]!(args)
    }
    switch (cmd) {
      case 'sources.list':
        return fontes
      case 'batches.list':
        return lotes
      case 'transcription.status':
        return { language: 'pt', transcript: null, job: null }
      case 'channel_profile.get':
        return {
          videoKind: 'direct',
          language: 'pt',
          minUs: 20_000_000,
          maxUs: 60_000_000,
          allowedSources: [],
          narrationVoice: null,
          directMonetizationAck: false,
          limits: { defaultMinUs: 20_000_000, defaultMaxUs: 60_000_000, maxUs: 180_000_000, technicalMaxUs: 300_000_000 },
        }
      case 'projects.local_only.get':
        return { open: true, enabled: localOnly }
      case 'assistant.tasks':
        return {
          projectLocalOnly: localOnly,
          tasks: [
            {
              task: 'selection',
              choice: selecaoPerfil ? `profile:${selecaoPerfil.id}` : '',
              source: selecaoPerfil ? 'default' : 'none',
              profile: selecaoPerfil,
              localOnly: false,
              blocked: Boolean(localOnly && selecaoPerfil && !selecaoPerfil.local),
              missing: null,
              suggestion: null,
            },
          ],
        }
      case 'transcription.groq.info':
        return {
          endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
          model: 'whisper-large-v3-turbo',
          configured: true,
          confirmed: true,
          local_only: localOnly,
        }
      default:
        return null
    }
  })
}

describe('Tela Lotes de Fontes (#/projeto/:id/fontes?sub=lotes)', () => {
  let store: StoreFontesProjeto

  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => 'demo')
    store = criarStoreFontesProjeto()
    window.history.replaceState(null, '', '/')
    window.location.hash = '#/projeto/demo/fontes?sub=lotes'
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('estado loading exibe Esqueleto sem mostrar estado vazio', async () => {
    let resolverFontes!: (v: unknown) => void
    mockBase({
      overrides: {
        'sources.list': () =>
          new Promise((res) => {
            resolverFontes = res
          }),
      },
    })
    render(
      envolver(<LotesFontes projetoId="demo" projetoPath="/projetos/Demo.clipes" store={store} />),
    )
    expect(screen.getByRole('status', { name: /Carregando Fontes para o lote/i })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getAllByRole('status', { name: /Carregando lotes do Projeto/i }).length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/Nenhum lote executado neste Projeto ainda/i)).not.toBeInTheDocument()
    resolverFontes([])
  })

  it('estados empty sem Fontes e empty sem Lotes oferecem CTAs acionáveis', async () => {
    const user = userEvent.setup()

    // Sem Fontes -> CTA "Voltar para Fontes"
    mockBase({ fontes: [], lotes: [] })
    const rSemFontes = render(
      envolver(<LotesFontes projetoId="demo" projetoPath="/projetos/Demo.clipes" store={store} />),
    )
    expect(await screen.findByText(/Importe ao menos uma Fonte antes de criar um Lote de Fontes/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Voltar para Fontes' }))
    expect(window.location.hash).toBe('#/projeto/demo/fontes')
    rSemFontes.unmount()

    // Sem Lotes -> CTA "Focar seleção de Fontes"
    window.location.hash = '#/projeto/demo/fontes?sub=lotes'
    store = criarStoreFontesProjeto()
    mockBase({ fontes: FONTES_LOTES, lotes: [] })
    render(
      envolver(<LotesFontes projetoId="demo" projetoPath="/projetos/Demo.clipes" store={store} />),
    )
    expect(await screen.findByText(/Nenhum lote executado neste Projeto ainda/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Focar seleção de Fontes' }))
    expect(screen.getByRole('checkbox', { name: /Live_12_11_final\.mp4/i })).toHaveFocus()
  })

  it.each<[string, RegExp]>([
    ['local_only_violation', /Somente local/i],
    ['profile_unavailable', /Perfil de Provedor/i],
    ['uncertain_job', /resultado incerto/i],
    ['invalid_batch', /Lote inválido/i],
    ['invalid_budget', /orçamento inválido/i],
  ])('estado error traduz %s em role="alert"', async (codigo, regex) => {
    const user = userEvent.setup()
    mockBase({
      fontes: FONTES_LOTES,
      lotes: [],
      overrides: {
        'batches.create': () => {
          throw erroComUsage(codigo, `erro ${codigo}`)
        },
      },
    })
    render(
      envolver(<LotesFontes projetoId="demo" projetoPath="/projetos/Demo.clipes" store={store} />),
    )
    const chk = await screen.findByRole('checkbox', { name: /Live_12_11_final\.mp4/i })
    await user.click(chk)
    await user.click(screen.getByRole('button', { name: /Iniciar lote com 1 Fonte/i }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(regex)
    if (codigo === 'local_only_violation') {
      expect(within(alerta).getByRole('button', { name: 'Escolher Perfil local' })).toBeInTheDocument()
      expect(within(alerta).getByRole('button', { name: 'Revisar Somente local' })).toBeInTheDocument()
    }
  })

  it('estados job_running e partial (attention/budget_paused) com progresso ao vivo via Fila', async () => {
    mockBase({
      fontes: FONTES_LOTES,
      lotes: [LOTE_RUNNING, LOTE_ATTENTION, LOTE_BUDGET_UNKNOWN],
    })
    render(
      envolver(<LotesFontes projetoId="demo" projetoPath="/projetos/Demo.clipes" store={store} />),
    )

    expect(await screen.findByText(/Em execução \(0\/2\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Requer atenção/i)).toBeInTheDocument()
    expect(screen.getByText(/Pausado por orçamento/i)).toBeInTheDocument()
    expect(screen.getByText(/1 Fonte já concluiu/i)).toBeInTheDocument()

    act(() => {
      filaTeste.aplicar({
        job: '401',
        project: 'demo',
        stage: 'transcribing',
        percentage: 78,
        message: 'Transcrevendo',
        error: null,
      })
    })
    expect(await screen.findByText('78%')).toBeInTheDocument()
  })

  it('desabilita Fontes offline no construtor e desabilita Iniciar lote quando todas estiverem offline', async () => {
    // Misto: offline fica desmarcada e desabilitada, mesmo se selecionadasParaLote continha id offline
    mockBase({ fontes: FONTES_LOTES, lotes: [] })
    await store.definirProjeto('/projetos/Demo.clipes')
    store.definirSelecionadasParaLote([1, 2])

    const rMisto = render(
      envolver(<LotesFontes projetoId="demo" projetoPath="/projetos/Demo.clipes" store={store} />),
    )
    const chkOffline = await screen.findByRole('checkbox', { name: /VOD_09_11_offline\.mp4/i })
    expect(chkOffline).toHaveAttribute('aria-disabled', 'true')
    expect(chkOffline).not.toBeChecked()
    expect(screen.getByText(/Offline — não pode ser transcrita agora/i)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Live_12_11_final\.mp4/i })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Iniciar lote com 1 Fonte' })).toBeEnabled()
    rMisto.unmount()

    // Todas offline -> botão Iniciar lote desabilitado e aviso claro
    store = criarStoreFontesProjeto()
    mockBase({ fontes: [FONTES_LOTES[1]], lotes: [] })
    render(
      envolver(<LotesFontes projetoId="demo" projetoPath="/projetos/Demo.clipes" store={store} />),
    )
    expect(await screen.findByText(/Relocalize uma Fonte offline para incluí-la num lote/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Iniciar lote com 0 Fontes/i })).toBeDisabled()
  })

  it('exibe <ResumoCustoPrivacidade>, trata confirmation_required com ConfirmDialog focado em Cancelar e reenvia confirmed: true', async () => {
    const user = userEvent.setup()
    let lotesAtuais: LoteFontes[] = []
    let chamadasCreate = 0

    mockBase({
      fontes: FONTES_LOTES,
      overrides: {
        'batches.list': () => lotesAtuais,
        'batches.create': (args) => {
          chamadasCreate += 1
          const a = args as { confirmed?: boolean; maxCostMicroUsd?: number }
          if (!a.confirmed) {
            throw erroComUsage('confirmation_required', 'confirme o custo', {
              selectionPaid: true,
              transcriptionPaid: true,
              audioEstimateMicroUsd: 120_000,
              profile: 'legacy',
              maxCostMicroUsd: a.maxCostMicroUsd ?? null,
              sources: 2,
            })
          }
          lotesAtuais = [LOTE_RUNNING]
          return LOTE_RUNNING
        },
      },
    })

    render(
      envolver(<LotesFontes projetoId="demo" projetoPath="/projetos/Demo.clipes" store={store} />),
    )

    expect(await screen.findByLabelText(/Resumo de custo e privacidade/i)).toBeInTheDocument()
    expect(screen.getByText('OpenAI Rápido')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /Live_12_11_final\.mp4/i }))
    await user.click(screen.getByRole('checkbox', { name: /Live_15_11_cortada\.mp4/i }))
    await user.click(screen.getByRole('radio', { name: /Groq \(remoto\)/i }))
    await user.type(screen.getByLabelText(/Teto de custo opcional/i), '2.5')

    await user.click(screen.getByRole('button', { name: 'Iniciar lote com 2 Fontes' }))

    const dlg = await screen.findByRole('alertdialog')
    expect(dlg).toHaveTextContent(/Groq/i)
    expect(dlg).toHaveTextContent(/OpenAI Rápido/i)
    await waitFor(() => {
      expect(within(dlg).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })

    await user.click(within(dlg).getByRole('button', { name: /Confirmar e iniciar lote/i }))

    await waitFor(() => {
      expect(chamadasCreate).toBe(2)
      expect(chamarMock).toHaveBeenCalledWith(
        'batches.create',
        expect.objectContaining({
          sourceIds: [1, 3],
          engine: 'groq',
          maxCostMicroUsd: 2_500_000,
          confirmed: true,
        }),
      )
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })

  it('pausa, retoma e cancela lote (com ConfirmDialog em batches.cancel)', async () => {
    const user = userEvent.setup()
    let loteState = { ...LOTE_RUNNING }

    mockBase({
      fontes: FONTES_LOTES,
      overrides: {
        'batches.list': () => [loteState],
        'batches.pause': () => {
          loteState = { ...loteState, state: 'paused', status: 'paused', pause: 'user' }
          return loteState
        },
        'batches.resume': () => {
          loteState = { ...loteState, state: 'running', status: 'running', pause: null }
          return loteState
        },
        'batches.cancel': () => {
          loteState = { ...loteState, state: 'cancelled', status: 'cancelled' }
          return loteState
        },
      },
    })

    render(
      envolver(<LotesFontes projetoId="demo" projetoPath="/projetos/Demo.clipes" store={store} />),
    )

    await user.click(await screen.findByRole('button', { name: 'Pausar lote' }))
    expect(await screen.findByText('Pausado pelo usuário')).toBeInTheDocument()
    expect(chamarMock).toHaveBeenCalledWith('batches.pause', { id: 4 })

    await user.click(screen.getByRole('button', { name: 'Retomar lote' }))
    await waitFor(() => expect(chamarMock).toHaveBeenCalledWith('batches.resume', { id: 4 }))

    await user.click(screen.getByRole('button', { name: 'Cancelar lote' }))
    const dlg = await screen.findByRole('alertdialog')
    await waitFor(() => {
      expect(within(dlg).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })
    await user.click(within(dlg).getByRole('button', { name: 'Cancelar lote' }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('batches.cancel', { id: 4 })
      expect(screen.getByText('Cancelado')).toBeInTheDocument()
    })
  })

  it('retoma item pausado com confirmation_required, trata uncertain_job para Fila e exige ciência em cost_unknown no jobs.budget.continue', async () => {
    const user = userEvent.setup()
    const aoAbrirFila = vi.fn()
    let loteAtencao = { ...LOTE_ATTENTION }
    let loteOrcamento = { ...LOTE_BUDGET_UNKNOWN }
    let retomadasItem = 0

    mockBase({
      fontes: FONTES_LOTES,
      overrides: {
        'batches.list': () => [loteAtencao, loteOrcamento],
        'batches.item.resume': (args) => {
          retomadasItem += 1
          const a = args as { sourceId: number; confirmed?: boolean }
          if (retomadasItem === 1 && !a.confirmed) {
            throw erroComUsage('confirmation_required', 'confirme retomada', {
              estimate: { kind: 'usd', minMicroUsd: 1200, maxMicroUsd: 5400 },
            })
          }
          if (retomadasItem === 3 && !a.confirmed) {
            throw erroComUsage('transcription_retry_confirmation', 'confirme repetição da transcrição')
          }
          if (retomadasItem >= 5) {
            throw erroComUsage('uncertain_job', 'chamada incerta')
          }
          return loteAtencao
        },
        'jobs.budget.continue': (args) => {
          const a = args as { confirmed?: boolean; maxCostMicroUsd?: number | null }
          if (!a.confirmed) {
            throw erroComUsage('confirmation_required', 'custo desconhecido', { reason: 'cost_unknown' })
          }
          loteOrcamento = { ...loteOrcamento, status: 'running', pause: null, budget: { ...loteOrcamento.budget!, paused: null, maxCostMicroUsd: a.maxCostMicroUsd ?? null } }
          return { budgets: [] }
        },
      },
    })

    render(
      envolver(
        <LotesFontes
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          store={store}
          aoAbrirFila={aoAbrirFila}
        />,
      ),
    )

    // Item pausado mostra causa traduzida e retoma após ConfirmDialog
    expect(await screen.findByText(/limite temporário/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retomar item' }))
    const dlgItem = await screen.findByRole('alertdialog')
    await user.click(within(dlgItem).getByRole('button', { name: /Confirmar e retomar/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('batches.item.resume', {
        id: 3,
        sourceId: 3,
        confirmed: true,
      })
    })

    // Segunda tentativa retorna transcription_retry_confirmation -> ConfirmDialog -> confirmed: true
    await user.click(screen.getByRole('button', { name: 'Retomar item' }))
    const dlgRetry = await screen.findByRole('alertdialog')
    expect(dlgRetry).toHaveTextContent(/Transcrição parcial/i)
    await user.click(within(dlgRetry).getByRole('button', { name: /Confirmar e retomar/i }))
    await waitFor(() => {
      expect(retomadasItem).toBe(4)
    })

    // Terceira tentativa retorna uncertain_job -> exibe "Resolver na Fila de Jobs"
    await user.click(screen.getByRole('button', { name: 'Retomar item' }))
    const btnFila = await screen.findByRole('button', { name: /Resolver na Fila de Jobs/i })
    await user.click(btnFila)
    expect(aoAbrirFila).toHaveBeenCalledTimes(1)

    // Lote budget_paused com cost_unknown exige checkbox de ciência antes de enviar confirmed: true
    await user.click(screen.getByRole('button', { name: /Ajustar orçamento e continuar/i }))
    const dlgOrc = await screen.findByRole('dialog', { name: /Ajustar orçamento/i })
    const campoTeto = within(dlgOrc).getByLabelText(/Novo teto de custo/i)
    await user.clear(campoTeto)
    await user.type(campoTeto, '3.50')

    const btnContinuar = within(dlgOrc).getByRole('button', { name: /Continuar lote/i })
    expect(btnContinuar).toBeDisabled()
    await user.click(within(dlgOrc).getByRole('checkbox', { name: /custo.*desconhecido/i }))
    expect(btnContinuar).toBeEnabled()
    await user.click(btnContinuar)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('jobs.budget.continue', {
        scope: 'batch',
        key: 'sources-5',
        maxCostMicroUsd: 3_500_000,
        confirmed: true,
      })
    })
  })

  it('navega por setas no <TabelaGrade> (role="grid") e exibe <Progresso> acessível por item e link Revisar Cortes', async () => {
    const user = userEvent.setup()
    mockBase({ fontes: FONTES_LOTES, lotes: [LOTE_RUNNING, LOTE_ATTENTION] })

    render(
      envolver(<Fontes projetoId="demo" projetoPath="/projetos/Demo.clipes" sub="lotes" store={store} />),
    )

    const grids = await screen.findAllByRole('grid')
    expect(grids.length).toBe(2)

    const primeiroGrid = grids[0]
    const celula00 = primeiroGrid.querySelector('[data-cel="0-0"]') as HTMLElement
    celula00.focus()
    expect(celula00).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(primeiroGrid.querySelector('[data-cel="0-1"]')).toHaveFocus()
    })

    await user.keyboard('{ArrowDown}')
    await waitFor(() => {
      expect(primeiroGrid.querySelector('[data-cel="1-1"]')).toHaveFocus()
    })

    const barras = within(primeiroGrid).getAllByRole('progressbar')
    expect(barras.length).toBe(2)
    expect(barras[0]).toHaveAttribute('aria-valuenow', '62')

    const btnRevisar = screen.getByRole('button', { name: /Revisar Cortes/i })
    await user.click(btnRevisar)
    expect(window.location.hash).toBe('#/projeto/demo/cortes?fonte=1&run=7')
  })

  it('UI-22: rola até o BannerErroCore e move o foco para ele ao ocorrer erro na criação do lote', async () => {
    const user = userEvent.setup()
    const scrollSpy = vi.fn()
    const scrollOriginal = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, arg?: boolean | ScrollIntoViewOptions) {
      scrollSpy(this, arg)
    }

    try {
      mockBase({
        fontes: FONTES_LOTES,
        lotes: [],
        localOnly: true,
        overrides: {
          'batches.create': () => {
            throw erroComUsage('local_only_violation', 'Bloqueado pelo modo Somente local.')
          },
        },
      })

      render(
        envolver(<LotesFontes projetoId="demo" projetoPath="/projetos/Demo.clipes" store={store} />),
      )

      await user.click(await screen.findByRole('checkbox', { name: /Live_12_11_final\.mp4/i }))
      await user.click(screen.getByRole('radio', { name: /Groq \(remoto\)/i }))
      await user.click(screen.getByRole('button', { name: /Iniciar lote com 1 Fonte/i }))

      const alerta = await screen.findByRole('alert')
      await waitFor(() => {
        const alvoFocado = document.activeElement
        expect(alvoFocado).not.toBeNull()
        expect(
          alvoFocado === alerta ||
            alerta.contains(alvoFocado) ||
            Boolean(alvoFocado?.contains(alerta)),
        ).toBe(true)
      })
      expect(
        scrollSpy.mock.calls.some(([el]) => el instanceof HTMLElement && (el === alerta || el.contains(alerta))),
      ).toBe(true)
    } finally {
      HTMLElement.prototype.scrollIntoView = scrollOriginal
    }
  })

  it('UI-25a: mantém hierarquia sem salto h1→h3 na lista de lotes', async () => {
    mockBase({ fontes: FONTES_LOTES, lotes: [LOTE_RUNNING] })

    render(
      envolver(<Fontes projetoId="demo" projetoPath="/projetos/Demo.clipes" sub="lotes" store={store} />),
    )

    expect(await screen.findByRole('heading', { level: 3, name: 'Lote #4' })).toBeInTheDocument()
    const listaRegiao = screen.getByRole('heading', { level: 3, name: 'Lote #4' }).closest('article')?.parentElement
    expect(listaRegiao).not.toBeNull()
    expect(within(listaRegiao!).getByRole('heading', { level: 2, name: /Lotes do Projeto/i })).toBeInTheDocument()

    const niveis = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) =>
      Number(h.tagName.slice(1)),
    )
    for (let i = 1; i < niveis.length; i += 1) {
      expect(niveis[i]).toBeLessThanOrEqual(niveis[i - 1] + 1)
    }
  })

  it('UI-28: não exibe "legacy" nem custo US$ 0,00 conflitante no ConfirmDialog quando seleção não tem perfil resolvido', async () => {
    const user = userEvent.setup()

    // Caso 1: rotaSelecao.profile === null e selectionPaid: false -> "Não configurado" + "Custo desconhecido"
    mockBase({
      fontes: FONTES_LOTES,
      selecaoPerfil: null,
      overrides: {
        'batches.create': () => {
          throw erroComUsage('confirmation_required', 'confirme o custo', {
            selectionPaid: false,
            transcriptionPaid: true,
            audioEstimateMicroUsd: 12_000,
            profile: 'legacy',
            maxCostMicroUsd: null,
            sources: 1,
          })
        },
      },
    })

    const rSemPerfil = render(
      envolver(<LotesFontes projetoId="demo" projetoPath="/projetos/Demo.clipes" store={store} />),
    )

    await user.click(await screen.findByRole('checkbox', { name: /Live_12_11_final\.mp4/i }))
    await user.click(screen.getByRole('radio', { name: /Groq \(remoto\)/i }))
    await user.click(screen.getByRole('button', { name: 'Iniciar lote com 1 Fonte' }))

    const dlg1 = await screen.findByRole('alertdialog')
    expect(dlg1).not.toHaveTextContent(/\blegacy\b/i)
    const resumoSel1 = within(dlg1).getByRole('region', {
      name: /Resumo de custo e privacidade: Seleção de Cortes/i,
    })
    expect(within(resumoSel1).getByText('Não configurado')).toBeInTheDocument()
    expect(within(resumoSel1).getByText('Custo desconhecido')).toBeInTheDocument()
    expect(within(resumoSel1).queryByText('US$ 0,00')).not.toBeInTheDocument()
    rSemPerfil.unmount()

    // Caso 2: rotaSelecao.profile === null mas selectionPaid: true e usage.profile: 'legacy' -> "Perfil configurado"
    store = criarStoreFontesProjeto()
    mockBase({
      fontes: FONTES_LOTES,
      selecaoPerfil: null,
      overrides: {
        'batches.create': () => {
          throw erroComUsage('confirmation_required', 'confirme o custo', {
            selectionPaid: true,
            transcriptionPaid: true,
            audioEstimateMicroUsd: 12_000,
            profile: 'legacy',
            maxCostMicroUsd: null,
            sources: 1,
          })
        },
      },
    })

    render(
      envolver(<LotesFontes projetoId="demo" projetoPath="/projetos/Demo.clipes" store={store} />),
    )

    await user.click(await screen.findByRole('checkbox', { name: /Live_12_11_final\.mp4/i }))
    await user.click(screen.getByRole('radio', { name: /Groq \(remoto\)/i }))
    await user.click(screen.getByRole('button', { name: 'Iniciar lote com 1 Fonte' }))

    const dlg2 = await screen.findByRole('alertdialog')
    expect(dlg2).not.toHaveTextContent(/\blegacy\b/i)
    const resumoSel2 = within(dlg2).getByRole('region', {
      name: /Resumo de custo e privacidade: Seleção de Cortes/i,
    })
    expect(within(resumoSel2).getByText('Perfil configurado')).toBeInTheDocument()
    expect(within(resumoSel2).getByText('Custo desconhecido')).toBeInTheDocument()
  })

  it('UI-40a: mantém apenas um botão bg-sinal quando há Fontes e nenhum lote criado (Luz Única)', async () => {
    const user = userEvent.setup()
    mockBase({ fontes: FONTES_LOTES, lotes: [] })
    const { container } = render(
      envolver(<LotesFontes projetoId="demo" projetoPath="/projetos/Demo.clipes" store={store} />),
    )

    expect(await screen.findByText(/Nenhum lote executado neste Projeto ainda/i)).toBeInTheDocument()
    const botoesSinal = Array.from(container.querySelectorAll<HTMLButtonElement>('button.bg-sinal'))
    expect(botoesSinal).toHaveLength(1)
    expect(botoesSinal[0]).toHaveTextContent(/Iniciar lote/i)

    const btnFocar = screen.getByRole('button', { name: 'Focar seleção de Fontes' })
    expect(btnFocar).not.toHaveClass('bg-sinal')
    await user.click(btnFocar)
    expect(screen.getByRole('checkbox', { name: /Live_12_11_final\.mp4/i })).toHaveFocus()
  })

  it('UI-42: botão Revisar Cortes usa ícone ArrowRight sem seta literal → no rótulo', async () => {
    mockBase({ fontes: FONTES_LOTES, lotes: [LOTE_ATTENTION] })
    render(
      envolver(<LotesFontes projetoId="demo" projetoPath="/projetos/Demo.clipes" store={store} />),
    )

    const btnRevisar = await screen.findByRole('button', { name: 'Revisar Cortes' })
    expect(btnRevisar.textContent?.trim()).toBe('Revisar Cortes')
    expect(btnRevisar.querySelector('svg')).not.toBeNull()
  })
})
