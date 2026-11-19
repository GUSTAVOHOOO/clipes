import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '~/App'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import { Shell } from '~/shell/Shell'
import {
  criarStoreFontesProjeto,
  type FonteProjeto,
  type StoreFontesProjeto,
} from '~/stores/fontesProjeto'
import type {
  AngulosDoc,
  CatalogoTtsDoc,
  NarracaoDoc,
  RoteiroDoc,
  StatusPocketTts,
} from '~/stores/transformarCorte'
import { ContextoCorteConectado } from '~/telas/corte/ContextoCorteConectado'
import { TransformarCorte } from '~/telas/corte/transformar/TransformarCorte'

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
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
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
    origin_url: null,
    language: 'pt',
    permission: { status: 'granted', who: 'Criador', where: 'YouTube', scope: 'cortes,traducao' },
  },
  {
    id: 2,
    path: '/videos/Live_offline.mp4',
    status: 'offline',
    available: false,
    verified: false,
    audio_track: 1,
    origin_url: null,
    language: 'pt',
    permission: { status: 'none' },
  },
]

const CATALOGO_TTS: CatalogoTtsDoc = {
  componentInstalled: true,
  activeModels: { pt: 'portuguese_24l', en: 'english' },
  engines: [
    {
      id: 'pocket-tts',
      label: 'Pocket TTS (Kyutai)',
      componentId: 'pocket-tts',
      codeLicense: 'MIT',
      sourceUrl: 'https://github.com/kyutai-labs/pocket-tts',
      prohibitedUse: {
        textEn: 'Do not clone voices.',
        summaryPt: 'Sem clonagem sem consentimento.',
        version: 'v1',
      },
    },
  ],
  models: [
    {
      id: 'portuguese_24l',
      engineId: 'pocket-tts',
      language: 'pt',
      label: 'Pocket TTS PT-BR',
      description: 'Modelo padrão PT-BR',
      defaultForLanguage: true,
      lightweight: false,
      active: true,
      installed: true,
      updateAvailable: false,
      termsAccepted: true,
      license: 'CC-BY-4.0',
      size: 700_000_000,
    },
  ],
  voices: [
    {
      id: '13063',
      engineId: 'pocket-tts',
      language: 'pt',
      gender: 'neutral',
      label: 'Voz Padrão',
      defaultForLanguage: true,
      license: 'CC-BY-4.0',
      attribution: 'Kyutai',
      sourceUrl: 'https://huggingface.co',
      models: ['portuguese_24l'],
    },
  ],
}

const POCKET_OK: StatusPocketTts = {
  installed: true,
  version: '3.3.0',
  pinned: '3.3.0',
  outdated: false,
}

function criarAngulosVazio(): AngulosDoc {
  return {
    schemaVersion: 1,
    revision: 1,
    detectedLanguage: 'pt-BR',
    languageRequired: false,
    selected: null,
    angles: [],
    generations: [],
    job: null,
  }
}

function criarRoteiroVazio(): RoteiroDoc {
  return {
    schemaVersion: 1,
    revision: 1,
    detectedLanguage: 'pt-BR',
    languageRequired: false,
    angle: null,
    current: null,
    narrationAllowed: false,
    busy: false,
    job: null,
    generations: [],
    limits: { titleChars: 80, narrationChars: 800, scriptChars: 6000, refs: 50 },
  }
}

function criarNarracaoTravada(gateReason: 'no_script' | 'pending_blocks' = 'no_script'): NarracaoDoc {
  return {
    candidate: 201,
    narrationAllowed: false,
    gateReason,
    language: 'pt-BR',
    defaultVoiceId: '13063',
    activeModelId: 'portuguese_24l',
    busy: false,
    job: null,
    importBusy: false,
    importJob: null,
    alignBusy: false,
    alignJob: null,
    alignPrerequisitesReady: true,
    vadReady: true,
    blocks: [],
    totalDurationUs: 0,
  }
}

function criarEstadoV1(candidate = 202): {
  angulos: AngulosDoc
  roteiro: RoteiroDoc
  narracao: NarracaoDoc
} {
  const angle = {
    name: 'Por que a jogada virou o jogo',
    promise: 'Mostra o detalhe de decisão que mudou o placar.',
    audience: 'Jogadores competitivos',
    sentence_ids: [40, 41],
  }
  return {
    angulos: {
      schemaVersion: 1,
      revision: 1,
      detectedLanguage: 'pt-BR',
      languageRequired: false,
      selected: angle,
      angles: [angle],
      generations: [1],
      job: null,
    },
    roteiro: {
      schemaVersion: 1,
      revision: 1,
      detectedLanguage: 'pt-BR',
      languageRequired: false,
      angle,
      current: {
        generation: 1,
        language: 'pt-BR',
        blocks: [
          {
            id: 2021,
            position: 1,
            title: 'Abertura',
            intent: 'Gancho',
            refs: [40],
            narration: 'Olha o momento exato em que o jogo virou.',
            status: 'aprovado',
            stale: false,
            version: 1,
            edited: false,
            job: null,
          },
          {
            id: 2022,
            position: 2,
            title: 'Virada',
            intent: 'Desenvolvimento',
            refs: [41],
            narration: 'Ele segurou o recurso em vez de gastar cedo.',
            status: 'aprovado',
            stale: false,
            version: 1,
            edited: false,
            job: null,
          },
        ],
        totalChars: 88,
        pending: 0,
        approved: 2,
        complete: true,
      },
      narrationAllowed: true,
      busy: false,
      job: null,
      generations: [1],
      limits: { titleChars: 80, narrationChars: 800, scriptChars: 6000, refs: 50 },
    },
    narracao: {
      candidate,
      narrationAllowed: true,
      gateReason: null,
      language: 'pt-BR',
      defaultVoiceId: '13063',
      activeModelId: 'portuguese_24l',
      busy: false,
      job: null,
      importBusy: false,
      importJob: null,
      alignBusy: false,
      alignJob: null,
      alignPrerequisitesReady: true,
      vadReady: true,
      blocks: [
        {
          blockId: 2021,
          position: 1,
          title: 'Abertura',
          versionId: 1,
          narrationText: 'Olha o momento exato em que o jogo virou.',
          audio: {
            id: 1,
            versionId: 1,
            voiceId: 'recorded',
            modelId: 'silero-vad',
            engineId: 'recorded',
            relPath: 'narrations/c202/b2021.wav',
            durationUs: 12_000_000,
            sampleRate: 24000,
            channels: 1,
            bytes: 576_000,
            stale: false,
            trimmed: true,
            cleanup: {
              applicable: true,
              enabled: true,
              ready: false,
              noiseFloorDb: -44,
              noiseFloorSource: 'vad',
              warningCode: null,
              warning: null,
            },
          },
          alignment: {
            status: 'aligned',
            choice: null,
            activeTrack: 'script',
            substitutions: 0,
            insertions: 0,
            deletions: 0,
            maxConsecutiveInsertions: 0,
            errorCode: null,
            modelId: 'whisper-turbo',
            spokenText: null,
            wordCount: 9,
          },
        },
        {
          blockId: 2022,
          position: 2,
          title: 'Virada',
          versionId: 1,
          narrationText: 'Ele segurou o recurso em vez de gastar cedo.',
          audio: null,
          alignment: null,
        },
      ],
      totalDurationUs: 12_000_000,
    },
  }
}

function configurarMocks(opcoes?: {
  fontes?: FonteProjeto[]
  angulos201?: AngulosDoc
  roteiro201?: RoteiroDoc
  narracao201?: NarracaoDoc
  erroAnglesGet?: ErroCore
}) {
  let fontesAtuais = opcoes?.fontes ?? FONTES_PADRAO
  let angulos201 = opcoes?.angulos201 ?? criarAngulosVazio()
  let roteiro201 = opcoes?.roteiro201 ?? criarRoteiroVazio()
  let narracao201 = opcoes?.narracao201 ?? criarNarracaoTravada('no_script')
  const estado202 = criarEstadoV1(202)
  const estado301 = criarEstadoV1(301)

  chamarMock.mockImplementation(async (comando: string, args: Record<string, unknown> = {}) => {
    if (comando === 'projects.current') {
      return { id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes', warning: null }
    }
    if (comando === 'projects.recent') return []
    if (comando === 'projects.local_only.get') return { enabled: false }
    if (comando === 'sources.list') return fontesAtuais
    if (comando === 'sources.relocate') {
      fontesAtuais = fontesAtuais.map((f) =>
        f.id === args.id ? { ...f, path: String(args.path), status: 'available', available: true } : f,
      )
      return fontesAtuais.find((f) => f.id === args.id)
    }
    if (comando === 'selection.list') {
      if (args.source_id === 4) {
        return [
          { id: 1, videoKind: 'direct', state: 'completed', revision: 1, revisions: [1] },
          { id: 2, videoKind: 'transformed', state: 'completed', revision: 1, revisions: [1] },
        ]
      }
      if (args.source_id === 2) {
        return [{ id: 3, videoKind: 'transformed', state: 'completed', revision: 1, revisions: [1] }]
      }
      return []
    }
    if (comando === 'selection.get') {
      if (args.run === 1) {
        return {
          run: { id: 1, transcriptId: 4, videoKind: 'direct', revision: 1, revisions: [1] },
          windows: [],
          candidates: [
            { id: 101, startId: 10, endId: 14, startUs: 90_000_000, endUs: 140_000_000, title: 'Pendente' },
            { id: 102, startId: 40, endId: 41, startUs: 390_000_000, endUs: 410_000_000, title: 'Corte direto' },
          ],
        }
      }
      if (args.run === 2) {
        return {
          run: { id: 2, transcriptId: 4, videoKind: 'transformed', revision: 1, revisions: [1] },
          windows: [],
          candidates: [
            { id: 201, startId: 10, endId: 14, startUs: 90_000_000, endUs: 140_000_000, title: 'A virada do jogo' },
            { id: 202, startId: 40, endId: 41, startUs: 390_000_000, endUs: 410_000_000, title: 'Corte V1 existente' },
          ],
        }
      }
      if (args.run === 3) {
        return {
          run: { id: 3, transcriptId: 2, videoKind: 'transformed', revision: 1, revisions: [1] },
          windows: [],
          candidates: [
            { id: 301, startId: 10, endId: 14, startUs: 90_000_000, endUs: 140_000_000, title: 'Corte offline V1' },
          ],
        }
      }
    }
    if (comando === 'selection.review') {
      if (args.run === 1) {
        return {
          run: 1,
          canUndo: false,
          items: [
            { candidate: 101, status: 'pending', adjusted: false, videoKind: 'direct', startId: 10, endId: 14, startUs: 90_000_000, endUs: 140_000_000 },
            { candidate: 102, status: 'approved', adjusted: false, videoKind: 'direct', startId: 40, endId: 41, startUs: 390_000_000, endUs: 410_000_000 },
          ],
        }
      }
      if (args.run === 2) {
        return {
          run: 2,
          canUndo: false,
          items: [
            { candidate: 201, status: 'approved', adjusted: false, videoKind: 'transformed', startId: 10, endId: 14, startUs: 90_000_000, endUs: 140_000_000 },
            { candidate: 202, status: 'approved', adjusted: false, videoKind: 'transformed', startId: 40, endId: 41, startUs: 390_000_000, endUs: 410_000_000 },
          ],
        }
      }
      if (args.run === 3) {
        return {
          run: 3,
          canUndo: false,
          items: [
            { candidate: 301, status: 'approved', adjusted: false, videoKind: 'transformed', startId: 10, endId: 14, startUs: 90_000_000, endUs: 140_000_000 },
          ],
        }
      }
    }
    if (comando === 'transcription.sentences') {
      return [
        { id: 10, start_us: 90_000_000, end_us: 100_000_000, text: 'Primeira frase do corte.' },
        { id: 11, start_us: 100_000_000, end_us: 110_000_000, text: 'Segunda frase com detalhe chave.' },
      ]
    }
    if (comando === 'tts.catalog') return CATALOGO_TTS
    if (comando === 'components.pocket_tts.status') return POCKET_OK
    if (comando === 'provider.profiles.list') {
      return {
        profiles: [
          {
            id: 'openai-gpt4o',
            label: 'OpenAI GPT-4o',
            kind: 'openai',
            endpoint: 'https://api.openai.com/v1',
            model: 'gpt-4o',
            local: false,
            cli: false,
          },
        ],
      }
    }
    if (comando === 'assistant.tasks') {
      return {
        projectLocalOnly: false,
        tasks: [{ task: 'script', profile: { id: 'openai-gpt4o', label: 'OpenAI GPT-4o', kind: 'openai', model: 'gpt-4o', local: false, cli: false } }],
      }
    }
    if (comando === 'jobs.budget.get') return { limitMicroUsd: 1_000_000, spentMicroUsd: 0, remainingMicroUsd: 1_000_000, paused: false }
    if (comando === 'jobs.list') return []
    if (comando === 'jobs.cancel') return { cancelled: true }
    if (comando === 'angles.get') {
      if (opcoes?.erroAnglesGet) throw opcoes.erroAnglesGet
      if (args.candidate === 202) return estado202.angulos
      if (args.candidate === 301) return estado301.angulos
      return angulos201
    }
    if (comando === 'script.get') {
      if (args.candidate === 202) return estado202.roteiro
      if (args.candidate === 301) return estado301.roteiro
      return roteiro201
    }
    if (comando === 'narration.get') {
      if (args.candidate === 202) return estado202.narracao
      if (args.candidate === 301) return estado301.narracao
      return narracao201
    }
    if (comando === 'script.edit') {
      const target = roteiro201.current?.blocks.find((b) => b.id === args.block)
      if (target) {
        if (typeof args.title === 'string') target.title = args.title
        if (typeof args.narration === 'string') target.narration = args.narration
        if (Array.isArray(args.refs)) target.refs = args.refs as number[]
        target.edited = true
        target.status = 'pendente'
        target.version += 1
        roteiro201.narrationAllowed = false
        roteiro201.current!.pending = roteiro201.current!.blocks.filter((b) => b.status !== 'aprovado').length
        roteiro201.current!.approved = roteiro201.current!.blocks.filter((b) => b.status === 'aprovado').length
      }
      return roteiro201
    }
    if (comando === 'script.approve') {
      const target = roteiro201.current?.blocks.find((b) => b.id === args.block)
      if (target) {
        target.status = 'aprovado'
        roteiro201.current!.pending = roteiro201.current!.blocks.filter((b) => b.status !== 'aprovado').length
        roteiro201.current!.approved = roteiro201.current!.blocks.filter((b) => b.status === 'aprovado').length
        roteiro201.narrationAllowed = roteiro201.current!.pending === 0
      }
      return roteiro201
    }
    if (comando === 'script.narration_allowed') {
      return { allowed: roteiro201.narrationAllowed }
    }
    if (comando === 'script.estimate') {
      return { paid: false, profile: 'local', estimate: { kind: 'zero', minMicroUsd: 0, maxMicroUsd: 0 } }
    }
    if (comando === 'script.generate') {
      return { job: 55 }
    }
    if (comando === 'guardrails.check') {
      return {
        scope: 'single',
        directMonetizationAck: false,
        needsDirectNotice: false,
        videoKind: 'transformed',
        hasDirect: false,
        hasTransformed: true,
        totalCuts: 1,
        durationUs: 50_000_000,
        over60s: false,
        over60sCount: 0,
        permission: { granted: true },
        script: { approved: true, pendingBlocks: 0 },
        narration: { hasTts: false, voices: [], freezeTailUs: 0, longFreezeTail: false },
        audio: { hasAudio: false, unverifiedCount: 0 },
      }
    }
    return {}
  })
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

describe('Tela TransformarCorte (#/projeto/:id/corte/:corteId/transformar)', () => {
  let storeFontes: StoreFontesProjeto

  beforeEach(() => {
    chamarMock.mockReset()
    localStorage.clear()
    filaTeste = criarFila(() => 'demo')
    storeFontes = criarStoreFontesProjeto()
    window.innerWidth = 1366
    window.history.replaceState(null, '', '/')
    window.location.hash = '#/projeto/demo/corte/201/transformar'
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
  })

  it('guardas de entrada redirecionam Corte direto e avulso-* para /editar com toast, e corteId ausente para /cortes', async () => {
    configurarMocks()

    // 1. Corte direto (102) -> /editar com toast específico
    window.location.hash = '#/projeto/demo/corte/102/transformar'
    const { rerender } = render(
      envolver(
        <TransformarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="102"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    await waitFor(() => {
      expect(window.location.hash).toBe('#/projeto/demo/corte/102/editar')
    })
    expect(
      await screen.findByText(/Transformar está disponível apenas para Vídeo transformado/i),
    ).toBeInTheDocument()

    // 2. avulso-* -> /editar com toast
    window.location.hash = '#/projeto/demo/corte/avulso-4-10-14/transformar'
    rerender(
      envolver(
        <TransformarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="avulso-4-10-14"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    await waitFor(() => {
      expect(window.location.hash).toBe('#/projeto/demo/corte/avulso-4-10-14/editar')
    })

    // 3. corteId inexistente/inválido -> /cortes
    window.location.hash = '#/projeto/demo/corte/999/transformar'
    rerender(
      envolver(
        <TransformarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="999"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    await waitFor(() => {
      expect(window.location.hash).toBe('#/projeto/demo/cortes')
    })
  })

  it('abre Corte V1 existente (202) com ângulo, Roteiro e Narração preservados', async () => {
    const user = userEvent.setup()
    configurarMocks()
    window.location.hash = '#/projeto/demo/corte/202/transformar'

    render(
      envolver(
        <TransformarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="202"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    const stepper = await screen.findByRole('navigation', { name: 'Etapas da Transformação' })
    expect(within(stepper).getByText(/Por que a jogada virou o jogo/i)).toBeInTheDocument()
    expect(within(stepper).getByText(/Todos aprovados/i)).toBeInTheDocument()

    // Passo 3 (Narração) preservado
    expect(await screen.findByText(/Bloco 1 · Abertura/i)).toBeInTheDocument()
    expect(screen.getByText(/Bloco 2 · Virada/i)).toBeInTheDocument()

    // Navegar para Passo 1 e Passo 2 preserva ângulo e blocos
    await user.click(within(stepper).getByRole('button', { name: /1\.?\s*Ângulo/i }))
    expect(await screen.findByRole('heading', { name: /1\. Escolha o ângulo/i })).toBeInTheDocument()

    await user.click(within(stepper).getByRole('button', { name: /2\.?\s*Roteiro/i }))
    expect(await screen.findByDisplayValue('Abertura')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Olha o momento exato em que o jogo virou.')).toBeInTheDocument()
  })

  it('cobre todos os 6 estados §6: loading, empty, error (local_only_violation e script_requires_transformed), ready, job_running e partial (Fonte offline editável)', async () => {
    const user = userEvent.setup()

    // 1. loading (?estado=carregando)
    configurarMocks()
    window.location.hash = '#/projeto/demo/corte/201/transformar?estado=carregando'
    const { rerender } = render(
      envolver(
        <TransformarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="201"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )
    expect(screen.getByRole('status', { name: /Carregando Transformação/i })).toHaveAttribute(
      'aria-busy',
      'true',
    )

    // 2. empty (?estado=vazio) -> Passo 1 vazio e Passos 2-3 travados
    window.location.hash = '#/projeto/demo/corte/202/transformar?estado=vazio'
    rerender(
      envolver(
        <TransformarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="202"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )
    expect(await screen.findByText(/Nenhum ângulo sugerido ainda/i)).toBeInTheDocument()
    const stepperVazio = screen.getByRole('navigation', { name: 'Etapas da Transformação' })
    expect(within(stepperVazio).getByRole('button', { name: /2\.?\s*Roteiro/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    // 3a. error local_only_violation
    configurarMocks({
      erroAnglesGet: new ErroCore('local_only_violation', 'Provedor remoto vetado.'),
    })
    window.location.hash = '#/projeto/demo/corte/201/transformar'
    rerender(
      envolver(
        <TransformarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="201"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )
    const alertLocal = await screen.findByRole('alert')
    expect(within(alertLocal).getByText(/Somente local/i)).toBeInTheDocument()

    // 3b. error script_requires_transformed
    filaTeste = criarFila(() => 'demo')
    configurarMocks({
      erroAnglesGet: new ErroCore('script_requires_transformed', 'Apenas Vídeo transformado.'),
    })
    rerender(
      envolver(
        <TransformarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="201"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )
    const alertDireto = await screen.findByRole('alert')
    expect(within(alertDireto).getByRole('button', { name: /Voltar para Editar/i })).toBeInTheDocument()

    // 4. ready + 5. job_running (ai:angles)
    filaTeste = criarFila(() => 'demo')
    configurarMocks()
    window.location.hash = '#/projeto/demo/corte/201/transformar'
    rerender(
      envolver(
        <TransformarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="201"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )
    expect(await screen.findByRole('heading', { name: /1\. Escolha o ângulo/i })).toBeInTheDocument()

    act(() => {
      filaTeste.aplicar({
        job: '81',
        project: 'demo',
        stage: 'ai:angles:call',
        percentage: 35,
        message: 'Consultando Provedor',
        error: null,
      })
    })
    expect(await screen.findByRole('progressbar')).toBeInTheDocument()
    expect(screen.getByText(/Sugerindo ângulos/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(chamarMock).toHaveBeenCalledWith('jobs.cancel', { id: 81 })

    // 6. partial / Fonte offline (301) preserva edição textual e oferece Relocalizar Fonte
    window.location.hash = '#/projeto/demo/corte/301/transformar'
    rerender(
      envolver(
        <TransformarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="301"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )
    expect(await screen.findByText(/Fonte offline/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Relocalizar Fonte/i })).toBeInTheDocument()
    // Continua totalmente utilizável via SQLite (Passo 2 editável)
    const stepper301 = screen.getByRole('navigation', { name: 'Etapas da Transformação' })
    await user.click(within(stepper301).getByRole('button', { name: /2\.?\s*Roteiro/i }))
    expect(await screen.findByDisplayValue('Introdução V1')).toBeEnabled()
  })

  it('Stepper respeita travas: selected === null impede Passo 2; Passo 3 exibe explicação ADR-0001 quando narrationAllowed === false', async () => {
    const user = userEvent.setup()
    configurarMocks({
      angulos201: {
        ...criarAngulosVazio(),
      },
      roteiro201: criarRoteiroVazio(),
      narracao201: criarNarracaoTravada('no_script'),
    })
    window.location.hash = '#/projeto/demo/corte/201/transformar'

    const { rerender } = render(
      envolver(
        <TransformarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="201"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    const stepper = await screen.findByRole('navigation', { name: 'Etapas da Transformação' })
    const btnPasso1 = within(stepper).getByRole('button', { name: /1\.?\s*Ângulo/i })
    const btnPasso2 = within(stepper).getByRole('button', { name: /2\.?\s*Roteiro/i })
    const btnPasso3 = within(stepper).getByRole('button', { name: /3\.?\s*Narração/i })

    expect(btnPasso1).toHaveAttribute('aria-current', 'step')
    expect(btnPasso2).toHaveAttribute('aria-disabled', 'true')
    expect(btnPasso2).toHaveAttribute('aria-describedby')

    // Clicar no Passo 2 travado não muda do Passo 1
    await user.click(btnPasso2)
    expect(btnPasso1).toHaveAttribute('aria-current', 'step')
    expect(screen.queryByRole('heading', { name: /2\. Roteiro em blocos/i })).toBeNull()

    // Clicar no Passo 3 abre explicação pedagógica ADR-0001
    expect(btnPasso3).toHaveTextContent(/Travado/i)
    await user.click(btnPasso3)
    expect(await screen.findByText(/Gere e aprove o Roteiro antes de narrar/i)).toBeInTheDocument()

    // Agora com ângulo definido e 1 bloco pendente no Roteiro
    filaTeste = criarFila(() => 'demo')
    configurarMocks({
      angulos201: {
        ...criarAngulosVazio(),
        selected: { name: 'Ângulo teste', promise: 'Promessa clara' },
      },
      roteiro201: {
        ...criarRoteiroVazio(),
        angle: { name: 'Ângulo teste', promise: 'Promessa clara' },
        narrationAllowed: false,
        current: {
          generation: 1,
          language: 'pt-BR',
          blocks: [
            {
              id: 501,
              position: 1,
              title: 'Bloco 1',
              intent: 'Gancho',
              refs: [10],
              narration: 'Texto pendente de aprovação.',
              status: 'pendente',
              stale: false,
              version: 1,
              edited: false,
              job: null,
            },
          ],
          totalChars: 28,
          pending: 1,
          approved: 0,
          complete: true,
        },
      },
      narracao201: criarNarracaoTravada('pending_blocks'),
    })
    rerender(
      envolver(
        <TransformarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="201"
          storeFontes={storeFontes}
          fila={filaTeste}
        />,
      ),
    )

    const stepper2 = await screen.findByRole('navigation', { name: 'Etapas da Transformação' })
    const btnPasso3b = within(stepper2).getByRole('button', { name: /3\.?\s*Narração/i })
    expect(btnPasso3b).toHaveTextContent(/Travado · 1 bloco/i)
    await user.click(btnPasso3b)
    expect(await screen.findByText(/Narração travada: ainda há 1 bloco\(s\) pendente\(s\)/i)).toBeInTheDocument()

    // Botão "Voltar ao próximo bloco pendente" retorna para Passo 2 focando o bloco
    await user.click(screen.getByRole('button', { name: /Voltar ao próximo bloco pendente/i }))
    expect(await screen.findByRole('heading', { name: /2\. Roteiro em blocos/i })).toBeInTheDocument()
  })

  it('suporta Ctrl+[ à esquerda, Ctrl+S contextual, ciclo F6/Shift+F6 e Paleta Ctrl+K', async () => {
    const user = userEvent.setup()
    configurarMocks({
      angulos201: {
        ...criarAngulosVazio(),
        selected: { name: 'Ângulo ativo', promise: 'Promessa clara' },
      },
      roteiro201: {
        ...criarRoteiroVazio(),
        angle: { name: 'Ângulo ativo', promise: 'Promessa clara' },
        narrationAllowed: false,
        current: {
          generation: 1,
          language: 'pt-BR',
          blocks: [
            {
              id: 501,
              position: 1,
              title: 'Bloco inicial',
              intent: 'Gancho',
              refs: [10],
              narration: 'Texto original do bloco.',
              status: 'aprovado',
              stale: false,
              version: 1,
              edited: false,
              job: null,
            },
          ],
          totalChars: 24,
          pending: 0,
          approved: 1,
          complete: true,
        },
      },
      narracao201: {
        ...criarNarracaoTravada('pending_blocks'),
        narrationAllowed: true,
        gateReason: null,
        blocks: [
          {
            blockId: 501,
            position: 1,
            title: 'Bloco inicial',
            versionId: 1,
            narrationText: 'Texto original do bloco.',
            audio: null,
            alignment: null,
          },
        ],
      },
    })

    // Simula largura < 1440 para iniciar com Transcrição recolhida
    window.innerWidth = 1366
    window.location.hash = '#/projeto/demo/corte/201/transformar'

    render(
      envolver(
        <Shell
          projeto={{ id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }}
          rota={{ tela: 'corte', projeto: 'demo', corte: '201', aba: 'transformar' }}
          semPaddingConteudo
          meio={
            <ContextoCorteConectado
              projetoId="demo"
              corteId="201"
              subAbaAtiva="transformar"
              fila={filaTeste}
            />
          }
          fila={filaTeste}
        >
          <TransformarCorte
            projetoId="demo"
            projetoPath="/projetos/Demo.clipes"
            corteId="201"
            storeFontes={storeFontes}
            fila={filaTeste}
          />
        </Shell>,
      ),
    )

    // Transcrição inicia recolhida em 1366 px
    expect(
      await screen.findByRole('complementary', { name: 'Transcrição do Corte recolhida' }),
    ).toBeInTheDocument()

    // Ctrl+[ abre Transcrição à esquerda e carrega Frases
    fireEvent.keyDown(window, { key: '[', ctrlKey: true })
    const painelEsq = await screen.findByRole('complementary', { name: 'Transcrição do Corte' })
    expect(await within(painelEsq).findByText('Primeira frase do corte.')).toBeInTheDocument()

    // Paleta Ctrl+K lista comandos de Transformar e executa "Passo 2: Roteiro"
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const paleta = await screen.findByRole('dialog')
    expect(within(paleta).getByText('Passo 1: Ângulo')).toBeInTheDocument()
    expect(within(paleta).getByText('Passo 2: Roteiro')).toBeInTheDocument()
    expect(within(paleta).getByText('Passo 3: Narração')).toBeInTheDocument()
    expect(within(paleta).getByText('Sugerir Roteiro')).toBeInTheDocument()
    expect(within(paleta).getByText('Aprovar bloco atual')).toBeInTheDocument()
    expect(within(paleta).getByText('Abrir gravador')).toBeInTheDocument()

    await user.click(within(paleta).getByText('Passo 2: Roteiro'))
    const campoNarracao = await screen.findByDisplayValue('Texto original do bloco.')

    // Edita campo e pressiona Ctrl+S -> salva edição via script.edit
    await user.clear(campoNarracao)
    await user.type(campoNarracao, 'Texto editado via teclado.')
    fireEvent.keyDown(campoNarracao, { key: 's', ctrlKey: true })

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'script.edit',
        expect.objectContaining({
          candidate: 201,
          block: 501,
          narration: 'Texto editado via teclado.',
        }),
      )
    })

    // Clicar em uma Frase na Transcrição alterna sua referência no bloco em foco
    const btnFrase11 = within(painelEsq).getByRole('button', { name: /#11/i })
    await user.click(btnFrase11)
    expect(screen.getByText('#11')).toBeInTheDocument()

    // Ciclo F6: Topo -> Transcrição -> Área da Transformação -> Barra de Status -> Topo
    const topo = document.querySelector('[data-regiao="topo"]')!
    const areaTransf = document.querySelector('[data-regiao="transformar-principal"]')!
    const rodape = document.querySelector('[data-regiao="rodape"]')!

    fireEvent.keyDown(window, { key: 'F6' })
    expect(topo.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(painelEsq.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(areaTransf.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(rodape.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6', shiftKey: true })
    expect(areaTransf.contains(document.activeElement)).toBe(true)
  })

  it('integra rota #/projeto/demo/corte/201/transformar no App com ContextoCorteConectado e único h1', async () => {
    configurarMocks()
    window.location.hash = '#/projeto/demo/corte/201/transformar'

    render(<App />)

    expect(
      await screen.findByRole('navigation', { name: 'Etapas da Transformação' }),
    ).toBeInTheDocument()
    const navAbas = screen.getByRole('navigation', { name: 'Etapas do Corte' })
    expect(within(navAbas).getByRole('link', { name: 'Transformar' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const main = document.querySelector('main')!
    expect(main.className).toContain('overflow-hidden')
    expect(main.className).not.toContain('p-4')
  })
})
