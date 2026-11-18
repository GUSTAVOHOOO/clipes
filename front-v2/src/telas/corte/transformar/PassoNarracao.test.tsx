import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import type {
  CatalogoTtsDoc,
  NarracaoDoc,
  RoteiroDoc,
  StatusPocketTts,
  useTransformarCorte,
} from '~/stores/transformarCorte'
import { PassoNarracao } from '~/telas/corte/transformar/PassoNarracao'

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
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {}
  }
})

function envolver(children: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>{children}</ProvedorToast>
    </ProvedorDicas>
  )
}

function instalarMockMicrofone() {
  const stopTrack = vi.fn()
  const stream = {
    getTracks: () => [{ stop: stopTrack }],
    getAudioTracks: () => [{ stop: stopTrack }],
  } as unknown as MediaStream

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(stream),
    },
  })

  class MockAudioContext {
    sampleRate = 48000
    state: AudioContextState = 'running'
    destination = {} as AudioDestinationNode
    createMediaStreamSource() {
      return { connect: vi.fn(), disconnect: vi.fn() }
    }
    createAnalyser() {
      return {
        fftSize: 256,
        frequencyBinCount: 128,
        getByteTimeDomainData: (arr: Uint8Array) => {
          arr.fill(140)
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
    }
    createScriptProcessor() {
      return {
        onaudioprocess: null as ((e: AudioProcessingEvent) => void) | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
    }
    async close() {
      this.state = 'closed'
    }
  }
  vi.stubGlobal('AudioContext', MockAudioContext)
}

const CATALOGO_PRONTO: CatalogoTtsDoc = {
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
        textEn: 'Prohibited use: Do not clone voices without consent.',
        summaryPt:
          'Uso proibido pelo autor (Kyutai): sem imitação ou clonagem de voz sem consentimento explícito.',
        version: 'mock',
      },
    },
  ],
  models: [
    {
      id: 'portuguese_24l',
      engineId: 'pocket-tts',
      language: 'pt',
      label: 'Pocket TTS PT-BR (24 camadas · padrão)',
      description: 'Qualidade superior em PT-BR.',
      defaultForLanguage: true,
      lightweight: false,
      active: true,
      installed: true,
      updateAvailable: false,
      termsAccepted: true,
      license: 'CC-BY-4.0',
      size: 701_332_218,
    },
    {
      id: 'portuguese',
      engineId: 'pocket-tts',
      language: 'pt',
      label: 'Pocket TTS PT-BR (6 camadas · leve)',
      description: 'Variante destilada mais rápida.',
      defaultForLanguage: false,
      lightweight: true,
      active: false,
      installed: true,
      updateAvailable: false,
      termsAccepted: true,
      license: 'CC-BY-4.0',
      size: 226_502_826,
    },
  ],
  voices: [
    {
      id: '13063',
      engineId: 'pocket-tts',
      language: 'pt',
      gender: 'male',
      label: 'Narrador PT-BR 13063 (masculina)',
      defaultForLanguage: true,
      license: 'CC-BY-4.0',
      attribution: 'BRSpeech-TTS / CML-TTS (CC-BY 4.0)',
      sourceUrl: 'https://huggingface.co/datasets/freds0/BRSpeech-TTS',
      models: ['portuguese_24l', 'portuguese'],
    },
  ],
}

const POCKET_INSTALADO: StatusPocketTts = {
  installed: true,
  version: '3.3.0',
  pinned: '3.3.0',
  outdated: false,
}

const ROTEIRO_APROVADO: RoteiroDoc = {
  schemaVersion: 1,
  revision: 2,
  detectedLanguage: 'pt-BR',
  languageRequired: false,
  angle: { name: 'Vazamento silencioso', promise: 'Explicar a falha em extensões.' },
  current: {
    generation: 1,
    language: 'pt',
    blocks: [
      {
        id: 101,
        position: 1,
        title: 'Abertura',
        intent: 'Gancho',
        refs: [10],
        narration: 'Você sabia que uma permissão banal expunha abas abertas?',
        status: 'aprovado',
        stale: false,
        version: 1,
        edited: false,
        job: null,
      },
      {
        id: 102,
        position: 2,
        title: 'Desenvolvimento',
        intent: 'Explicação',
        refs: [11],
        narration: 'A API antiga não isolava contexto de origem.',
        status: 'aprovado',
        stale: false,
        version: 1,
        edited: false,
        job: null,
      },
    ],
    totalChars: 101,
    pending: 0,
    approved: 2,
    complete: true,
  },
  narrationAllowed: true,
  busy: false,
  job: null,
  generations: [],
  limits: { titleChars: 80, narrationChars: 800, scriptChars: 6000, refs: 50 },
}

const NARRACAO_SEM_AUDIO: NarracaoDoc = {
  candidate: 201,
  narrationAllowed: true,
  gateReason: null,
  language: 'pt',
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
      blockId: 101,
      position: 1,
      title: 'Abertura',
      versionId: 1,
      narrationText: 'Você sabia que uma permissão banal expunha abas abertas?',
      audio: null,
      alignment: null,
    },
    {
      blockId: 102,
      position: 2,
      title: 'Desenvolvimento',
      versionId: 1,
      narrationText: 'A API antiga não isolava contexto de origem.',
      audio: null,
      alignment: null,
    },
  ],
  totalDurationUs: 0,
}

type StoreHook = ReturnType<typeof useTransformarCorte>

function criarStoreMock(overrides: Partial<StoreHook> = {}): StoreHook {
  return {
    candidateId: 201,
    carregando: false,
    erro: null,
    angulos: null,
    roteiro: ROTEIRO_APROVADO,
    narracao: NARRACAO_SEM_AUDIO,
    catalogoTts: CATALOGO_PRONTO,
    pocketTts: POCKET_INSTALADO,
    perfis: [],
    tarefas: null,
    orcamento: null,
    somenteLocal: false,
    recarregar: vi.fn().mockResolvedValue(undefined),
    recarregarAngulos: vi.fn().mockResolvedValue(undefined),
    recarregarRoteiro: vi.fn().mockResolvedValue(undefined),
    recarregarNarracao: vi.fn().mockResolvedValue(undefined),
    recarregarTts: vi.fn().mockResolvedValue(undefined),
    resolverDestino: vi.fn().mockReturnValue({
      perfilId: 'local-ollama',
      perfilRotulo: 'Ollama Local',
      localidade: 'local',
      saiDaMaquina: false,
      bloqueadoSomenteLocal: false,
    }),
    ...overrides,
  }
}

describe('<PassoNarracao>', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => 'demo')
    delete window.__CLIPES_E2E__
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete window.__CLIPES_E2E__
  })

  it('quando narrationAllowed === false, exibe trava pedagógica ADR-0001 e botão primário volta ao próximo bloco pendente', async () => {
    const user = userEvent.setup()
    const aoVoltarBlocoPendente = vi.fn()
    const roteiroComPendencia: RoteiroDoc = {
      ...ROTEIRO_APROVADO,
      narrationAllowed: false,
      current: {
        ...ROTEIRO_APROVADO.current!,
        pending: 1,
        approved: 1,
        blocks: [
          ROTEIRO_APROVADO.current!.blocks[0],
          { ...ROTEIRO_APROVADO.current!.blocks[1], status: 'pendente' },
        ],
      },
    }
    const store = criarStoreMock({
      roteiro: roteiroComPendencia,
      narracao: {
        ...NARRACAO_SEM_AUDIO,
        narrationAllowed: false,
        gateReason: 'pending_blocks',
        blocks: [],
      },
    })

    render(
      envolver(
        <PassoNarracao
          candidateId={201}
          store={store}
          aoVoltarBlocoPendente={aoVoltarBlocoPendente}
          aoIrParaEmpacotar={vi.fn()}
          aoIrParaEditar={vi.fn()}
        />,
      ),
    )

    expect(screen.getByText(/Narração travada: ainda há 1 bloco\(s\) pendente\(s\) no Roteiro\./i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Gerar voz de todos os blocos/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Gravar no microfone/i })).not.toBeInTheDocument()

    const btnVoltar = screen.getByRole('button', { name: /Voltar ao próximo bloco pendente/i })
    expect(btnVoltar.className).toContain('bg-sinal')
    await user.click(btnVoltar)
    expect(aoVoltarBlocoPendente).toHaveBeenCalledWith(102)
  })

  it('quando pocket-tts ou modelo TTS está ausente, acionar TTS exibe <InstaladorJustInTime recurso="tts" /> e recarrega ao concluir', async () => {
    const user = userEvent.setup()
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'components.pocket_tts.status') return { installed: false, version: null }
      if (cmd === 'tts.catalog') {
        return {
          ...CATALOGO_PRONTO,
          componentInstalled: false,
          models: [{ ...CATALOGO_PRONTO.models[0], installed: false, termsAccepted: false }],
        }
      }
      if (cmd === 'components.manifest') {
        return [
          {
            id: 'pocket-tts',
            version: '3.3.0',
            size: 7_914_990,
            license: 'MIT',
            source_url: 'https://github.com/kyutai-labs/pocket-tts',
          },
        ]
      }
      if (cmd === 'components.settings.get') {
        return { data_dir: '/dados', cache_dir: '/cache', cache_limit_bytes: 1e10 }
      }
      if (cmd === 'components.download') return { path: '/dados/pocket-tts' }
      if (cmd === 'tts.models.download') return { id: 'portuguese_24l' }
      return {}
    })

    const store = criarStoreMock({
      pocketTts: { installed: false, version: null, pinned: '3.3.0', outdated: false },
      catalogoTts: {
        ...CATALOGO_PRONTO,
        componentInstalled: false,
        models: [{ ...CATALOGO_PRONTO.models[0], installed: false, termsAccepted: false }],
      },
    })

    render(
      envolver(
        <PassoNarracao
          candidateId={201}
          store={store}
          aoVoltarBlocoPendente={vi.fn()}
          aoIrParaEmpacotar={vi.fn()}
          aoIrParaEditar={vi.fn()}
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: /Gerar voz de todos os blocos \(TTS\)/i }))

    const secaoJit = await screen.findByRole('region', { name: /Instalação necessária/i })
    expect(within(secaoJit).getByText(/pocket-tts — motor de voz local/i)).toBeInTheDocument()

    await user.click(within(secaoJit).getByRole('checkbox'))
    await user.click(within(secaoJit).getByRole('button', { name: /Baixar e continuar/i }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('components.download', { id: 'pocket-tts', confirmed: true })
      expect(chamarMock).toHaveBeenCalledWith('tts.models.download', {
        id: 'portuguese_24l',
        confirmed: true,
        termsAccepted: true,
      })
      expect(store.recarregarTts).toHaveBeenCalled()
    })
  })

  it('pede ConfirmDialog com foco inicial em Cancelar ao sobrescrever áudio gravado/importado com TTS', async () => {
    const user = userEvent.setup()
    chamarMock.mockResolvedValue({ job: 790, candidate: 201 })

    const store = criarStoreMock({
      narracao: {
        ...NARRACAO_SEM_AUDIO,
        blocks: [
          {
            ...NARRACAO_SEM_AUDIO.blocks[0],
            audio: {
              id: 101,
              versionId: 1,
              voiceId: 'recorded',
              modelId: 'silero-vad',
              engineId: 'recorded',
              relPath: 'narrations/c201/b101-v1.wav',
              durationUs: 2_400_000,
              sampleRate: 24000,
              channels: 1,
              bytes: 115244,
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
              wordCount: 8,
            },
          },
          NARRACAO_SEM_AUDIO.blocks[1],
        ],
        totalDurationUs: 2_400_000,
      },
    })

    render(
      envolver(
        <PassoNarracao
          candidateId={201}
          store={store}
          aoVoltarBlocoPendente={vi.fn()}
          aoIrParaEmpacotar={vi.fn()}
          aoIrParaEditar={vi.fn()}
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: /Gerar voz de todos os blocos \(TTS\)/i }))
    const dialog = await screen.findByRole('alertdialog')
    const btnCancelar = within(dialog).getByRole('button', { name: /Cancelar/i })
    await waitFor(() => expect(btnCancelar).toHaveFocus())
    expect(chamarMock).not.toHaveBeenCalledWith('narration.generate', expect.anything())

    await user.click(within(dialog).getByRole('button', { name: /Substituir por TTS/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('narration.generate', {
        candidate: 201,
        voiceId: '13063',
      })
      expect(store.recarregarNarracao).toHaveBeenCalled()
    })
  })

  it('grava via <GravadorTeleprompter> chamando narration.record_block e bloco gravado sem VAD exibe "Aparar silêncios agora" (narration.trim_block)', async () => {
    const user = userEvent.setup()
    instalarMockMicrofone()
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'narration.record_block') return { candidate: 201, blockId: 101, trimmed: false }
      if (cmd === 'narration.trim_block') return { candidate: 201, blockId: 101, trimmed: true }
      return {}
    })

    const store = criarStoreMock({
      narracao: {
        ...NARRACAO_SEM_AUDIO,
        blocks: [
          {
            ...NARRACAO_SEM_AUDIO.blocks[0],
            audio: {
              id: 101,
              versionId: 1,
              voiceId: 'recorded',
              modelId: 'untrimmed',
              engineId: 'recorded',
              relPath: 'narrations/c201/b101-v1.wav',
              durationUs: 3_500_000,
              sampleRate: 24000,
              channels: 1,
              bytes: 153644,
              stale: false,
              trimmed: false,
              cleanup: {
                applicable: true,
                enabled: true,
                ready: false,
                noiseFloorDb: -50,
                noiseFloorSource: 'default',
                warningCode: 'vad_unavailable',
                warning: null,
              },
            },
            alignment: {
              status: 'pending',
              choice: null,
              activeTrack: null,
              substitutions: 0,
              insertions: 0,
              deletions: 0,
              maxConsecutiveInsertions: 0,
              errorCode: null,
              modelId: '',
              spokenText: null,
              wordCount: 0,
            },
          },
          NARRACAO_SEM_AUDIO.blocks[1],
        ],
        totalDurationUs: 3_500_000,
      },
    })

    render(
      envolver(
        <PassoNarracao
          candidateId={201}
          store={store}
          aoVoltarBlocoPendente={vi.fn()}
          aoIrParaEmpacotar={vi.fn()}
          aoIrParaEditar={vi.fn()}
        />,
      ),
    )

    expect(screen.getByText(/Silêncios não foram aparados na gravação/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Aparar silêncios agora/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('narration.trim_block', {
        candidate: 201,
        block: 101,
      })
    })

    const botoesGravar = screen.getAllByRole('button', { name: /Gravar no microfone/i })
    await user.click(botoesGravar[0])

    const dialogo = await screen.findByRole('dialog', { name: /Gravar Narração/i })
    await user.click(within(dialogo).getByRole('button', { name: /^Gravar$/i }))
    await user.click(await within(dialogo).findByRole('button', { name: /Parar e salvar/i }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'narration.record_block',
        expect.objectContaining({
          candidate: 201,
          block: 101,
          mimeType: 'audio/wav',
          audioBase64: expect.any(String),
        }),
      )
      expect(store.recarregarNarracao).toHaveBeenCalled()
    })
  })

  it('alterna limpeza Antes/Depois via mediaUrl("narration-original/...") e ("narration-clean/...") com loading local em narration.cleanup.prepare', async () => {
    const user = userEvent.setup()
    let resolverPrepare!: (v: unknown) => void
    chamarMock.mockImplementation((cmd: string) => {
      if (cmd === 'narration.cleanup.prepare') {
        return new Promise((res) => {
          resolverPrepare = res
        })
      }
      if (cmd === 'narration.cleanup.set') return Promise.resolve({})
      return Promise.resolve({})
    })

    const store = criarStoreMock({
      narracao: {
        ...NARRACAO_SEM_AUDIO,
        blocks: [
          {
            ...NARRACAO_SEM_AUDIO.blocks[0],
            audio: {
              id: 101,
              versionId: 1,
              voiceId: 'recorded',
              modelId: 'silero-vad',
              engineId: 'recorded',
              relPath: 'narrations/c201/b101-v1.wav',
              durationUs: 2_400_000,
              sampleRate: 24000,
              channels: 1,
              bytes: 115244,
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
              wordCount: 8,
            },
          },
          NARRACAO_SEM_AUDIO.blocks[1],
        ],
        totalDurationUs: 2_400_000,
      },
    })

    const { rerender } = render(
      envolver(
        <PassoNarracao
          candidateId={201}
          store={store}
          aoVoltarBlocoPendente={vi.fn()}
          aoIrParaEmpacotar={vi.fn()}
          aoIrParaEditar={vi.fn()}
        />,
      ),
    )

    expect(screen.getByText(/Ruído medido nos silêncios/i)).toBeInTheDocument()
    const audioEl = document.querySelector('audio') as HTMLAudioElement
    expect(audioEl.getAttribute('src')).toContain('narration-original/101')

    await user.click(screen.getByRole('radio', { name: /Depois \(limpa\)/i }))
    expect(chamarMock).toHaveBeenCalledWith('narration.cleanup.prepare', {
      candidate: 201,
      block: 101,
    })
    expect(screen.getByText(/Preparando áudio limpo/i)).toBeInTheDocument()

    // Atualiza store simulando reload após prepare
    const storePronta = criarStoreMock({
      ...store,
      narracao: {
        ...store.narracao!,
        blocks: [
          {
            ...store.narracao!.blocks[0],
            audio: {
              ...store.narracao!.blocks[0].audio!,
              cleanup: {
                ...store.narracao!.blocks[0].audio!.cleanup!,
                ready: true,
              },
            },
          },
          store.narracao!.blocks[1],
        ],
      },
    })

    resolverPrepare({ ready: true })
    await waitFor(() => expect(store.recarregarNarracao).toHaveBeenCalled())

    rerender(
      envolver(
        <PassoNarracao
          candidateId={201}
          store={storePronta}
          aoVoltarBlocoPendente={vi.fn()}
          aoIrParaEmpacotar={vi.fn()}
          aoIrParaEditar={vi.fn()}
        />,
      ),
    )

    await waitFor(() => {
      const audioAtual = document.querySelector('audio') as HTMLAudioElement
      expect(audioAtual.getAttribute('src')).toContain('narration-clean/101')
    })

    await user.click(screen.getByRole('switch', { name: /Limpeza de voz/i }))
    expect(chamarMock).toHaveBeenCalledWith('narration.cleanup.set', {
      candidate: 201,
      block: 101,
      enabled: false,
    })
  })

  it('mantém "Remover áudio" desabilitado com <Dica> sem expor número de ticket (#\\d+) e resolve needs_review com narration.review', async () => {
    const user = userEvent.setup()
    chamarMock.mockResolvedValue({ candidate: 201, block: 101 })

    const store = criarStoreMock({
      narracao: {
        ...NARRACAO_SEM_AUDIO,
        blocks: [
          {
            ...NARRACAO_SEM_AUDIO.blocks[0],
            audio: {
              id: 101,
              versionId: 1,
              voiceId: 'imported',
              modelId: 'external',
              engineId: 'imported',
              relPath: 'narrations/c201/b101-v1.wav',
              durationUs: 2_800_000,
              sampleRate: 24000,
              channels: 1,
              bytes: 134444,
              stale: false,
              trimmed: true,
              cleanup: {
                applicable: true,
                enabled: true,
                ready: false,
                noiseFloorDb: -50,
                noiseFloorSource: 'default',
                warningCode: null,
                warning: null,
              },
            },
            alignment: {
              status: 'needs_review',
              choice: null,
              activeTrack: null,
              substitutions: 1,
              insertions: 2,
              deletions: 0,
              maxConsecutiveInsertions: 2,
              errorCode: null,
              modelId: 'whisper-turbo',
              spokenText: 'Você sabia que uma permissão banal expunha todas as abas abertas?',
              wordCount: 11,
            },
          },
          NARRACAO_SEM_AUDIO.blocks[1],
        ],
        totalDurationUs: 2_800_000,
      },
    })

    render(
      envolver(
        <PassoNarracao
          candidateId={201}
          store={store}
          aoVoltarBlocoPendente={vi.fn()}
          aoIrParaEmpacotar={vi.fn()}
          aoIrParaEditar={vi.fn()}
        />,
      ),
    )

    // Botão Remover áudio desabilitado + Dica UI-12 sem #\d+
    const btnRemover = screen.getByRole('button', { name: /Remover áudio/i })
    expect(btnRemover).toBeDisabled()
    await user.hover(btnRemover.parentElement as HTMLElement)
    expect(
      await screen.findByText(/Voltar a Sem áudio ainda não está disponível; substitua por TTS, gravação ou importação\./i),
    ).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/#\d+/)

    // Comparação needs_review e escolha spoken
    expect(screen.getByText(/Roteiro aprovado/i)).toBeInTheDocument()
    expect(screen.getByText(/Detectado na fala/i)).toBeInTheDocument()
    expect(screen.getByText(/expunha todas as abas abertas/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Usar texto falado/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('narration.review', {
        candidate: 201,
        block: 101,
        choice: 'spoken',
      })
      expect(store.recarregarNarracao).toHaveBeenCalled()
    })

    // Regra da Luz Única: exatamente 1 botão primário (bg-sinal)
    const primarios = screen
      .getAllByRole('button')
      .filter((b) => b.className.split(/\s+/).includes('bg-sinal'))
    expect(primarios).toHaveLength(1)
  })

  it('trata erros de importação (import_unsupported_format e import_file_too_large) em role="alert" e exibe progresso da fila', async () => {
    const user = userEvent.setup()
    chamarMock.mockImplementation(async (cmd: string, args: { path?: string }) => {
      if (cmd === 'narration.import') {
        if (args.path?.endsWith('.txt')) {
          throw new ErroCore('import_unsupported_format', 'Formato inválido')
        }
        throw new ErroCore('import_file_too_large', 'Arquivo excede 200 MiB')
      }
      return {}
    })

    const store = criarStoreMock()

    render(
      envolver(
        <PassoNarracao
          candidateId={201}
          store={store}
          aoVoltarBlocoPendente={vi.fn()}
          aoIrParaEmpacotar={vi.fn()}
          aoIrParaEditar={vi.fn()}
        />,
      ),
    )

    // Dispara job em andamento na Fila (e garante filtro do residual job "0" #293)
    act(() => {
      filaTeste.aplicar({
        job: '0',
        project: 'demo',
        stage: 'narration_record',
        percentage: 50,
        message: 'Residual',
        error: null,
      })
      filaTeste.aplicar({
        job: '790',
        project: 'demo',
        stage: 'narration',
        percentage: 45,
        message: 'Sintetizando bloco 1…',
        error: null,
      })
    })
    expect(await screen.findByText(/Sintetizando bloco 1/i)).toBeInTheDocument()
    expect(screen.queryByText('Residual')).not.toBeInTheDocument()

    // Importa .txt inválido -> role="alert"
    const botoesImportar = screen.getAllByRole('button', { name: /Importar áudio/i })
    await user.click(botoesImportar[0])
    const dlg = await screen.findByRole('dialog', { name: /Importar áudio/i })
    const input = within(dlg).getByRole('textbox')
    await user.type(input, '/tmp/ruim.txt')
    await user.click(within(dlg).getByRole('button', { name: /^Importar$/i }))

    const alerta1 = await screen.findByRole('alert')
    expect(alerta1).toHaveTextContent(/envie \.wav, \.mp3, \.m4a ou \.ogg/i)

    // Tenta outro arquivo -> import_file_too_large -> role="alert"
    await user.click(within(alerta1).getByRole('button', { name: /Escolher outro arquivo/i }))
    const dlg2 = await screen.findByRole('dialog', { name: /Importar áudio/i })
    const input2 = within(dlg2).getByRole('textbox')
    await user.clear(input2)
    await user.type(input2, '/tmp/too-large.wav')
    await user.click(within(dlg2).getByRole('button', { name: /^Importar$/i }))

    const alerta2 = await screen.findByRole('alert')
    expect(alerta2).toHaveTextContent(/envie \.wav, \.mp3, \.m4a ou \.ogg/i)
  })

  it('cobre alinhamento global/por bloco, troca de modelo TTS, confirmação ao importar sobre áudio existente, stale, alignPrerequisitesReady: false, cancelamento de job e estados loading/error', async () => {
    const user = userEvent.setup()
    const aoIrParaEmpacotar = vi.fn()
    const aoIrParaEditar = vi.fn()
    chamarMock.mockResolvedValue({})

    // 1) loading com narracao === null exibe <Esqueleto>
    const storeCarregando = criarStoreMock({ carregando: true, narracao: null })
    const rLoad = render(
      envolver(
        <PassoNarracao
          candidateId={201}
          store={storeCarregando}
          aoVoltarBlocoPendente={vi.fn()}
          aoIrParaEmpacotar={aoIrParaEmpacotar}
          aoIrParaEditar={aoIrParaEditar}
        />,
      ),
    )
    expect(screen.getByRole('status', { name: /Carregando etapa de Narração/i })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    rLoad.unmount()

    // 2) error com narracao === null exibe BannerErroCore e Tentar novamente
    const storeErro = criarStoreMock({
      narracao: null,
      erro: new ErroCore('project_not_open', 'Sem projeto'),
    })
    const rErr = render(
      envolver(
        <PassoNarracao
          candidateId={201}
          store={storeErro}
          aoVoltarBlocoPendente={vi.fn()}
          aoIrParaEmpacotar={aoIrParaEmpacotar}
          aoIrParaEditar={aoIrParaEditar}
        />,
      ),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/Nenhum Projeto está aberto/i)
    await user.click(screen.getByRole('button', { name: /Tentar novamente/i }))
    expect(storeErro.recarregar).toHaveBeenCalled()
    rErr.unmount()

    // 3) ready/partial com stale, alignPrerequisitesReady: false, troca de modelo, align, import overwrite e cancelamento
    const store = criarStoreMock({
      narracao: {
        ...NARRACAO_SEM_AUDIO,
        alignPrerequisitesReady: false,
        blocks: [
          {
            ...NARRACAO_SEM_AUDIO.blocks[0],
            audio: {
              id: 101,
              versionId: 1,
              voiceId: '13063',
              modelId: 'portuguese_24l',
              engineId: 'pocket-tts',
              relPath: 'narrations/c201/b101-v1.wav',
              durationUs: 3_200_000,
              sampleRate: 24000,
              channels: 1,
              bytes: 153644,
              stale: true,
              trimmed: true,
              cleanup: null,
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
              wordCount: 8,
            },
          },
          NARRACAO_SEM_AUDIO.blocks[1],
        ],
        totalDurationUs: 3_200_000,
      },
    })

    const { rerender } = render(
      envolver(
        <PassoNarracao
          candidateId={201}
          store={store}
          aoVoltarBlocoPendente={vi.fn()}
          aoIrParaEmpacotar={aoIrParaEmpacotar}
          aoIrParaEditar={aoIrParaEditar}
        />,
      ),
    )

    expect(screen.getByText(/Desatualizado \(Roteiro alterado\)/i)).toBeInTheDocument()
    const linkComp = screen.getByRole('link', { name: /Abrir Componentes/i })
    expect(linkComp).toHaveAttribute('href', '#/config/componentes')
    expect(screen.getByRole('button', { name: /Alinhar todos os blocos/i })).toBeDisabled()

    // Troca modelo TTS
    await user.click(screen.getByRole('combobox', { name: /Modelo ativo/i }))
    await user.click(await screen.findByText(/6 camadas · leve/i))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('tts.models.choose', {
        language: 'pt',
        modelId: 'portuguese',
      })
      expect(store.recarregarTts).toHaveBeenCalled()
    })

    // Navegação de saída
    await user.click(screen.getByRole('button', { name: /Ajustar na timeline \(Editar\)/i }))
    expect(aoIrParaEditar).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: /Avançar para Empacotar/i }))
    expect(aoIrParaEmpacotar).toHaveBeenCalledTimes(1)

    // Importar sobre bloco que já tem áudio -> pede confirmação
    const botoesImportar = screen.getAllByRole('button', { name: /Importar áudio/i })
    await user.click(botoesImportar[0])
    const dlgImp = await screen.findByRole('dialog', { name: /Importar áudio/i })
    await user.type(within(dlgImp).getByRole('textbox'), '/tmp/novo.wav')
    await user.click(within(dlgImp).getByRole('button', { name: /^Importar$/i }))

    const confirmDlg = await screen.findByRole('alertdialog')
    const btnCancelar = within(confirmDlg).getByRole('button', { name: /Cancelar/i })
    await waitFor(() => expect(btnCancelar).toHaveFocus())
    await user.click(within(confirmDlg).getByRole('button', { name: /Substituir áudio/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('narration.import', {
        candidate: 201,
        block: 101,
        path: '/tmp/novo.wav',
      })
    })

    // Com alignPrerequisitesReady: true, testa align e align_block e cancelamento de job
    rerender(
      envolver(
        <PassoNarracao
          candidateId={201}
          store={criarStoreMock({
            ...store,
            narracao: { ...store.narracao!, alignPrerequisitesReady: true },
          })}
          aoVoltarBlocoPendente={vi.fn()}
          aoIrParaEmpacotar={aoIrParaEmpacotar}
          aoIrParaEditar={aoIrParaEditar}
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: /Alinhar todos os blocos/i }))
    expect(chamarMock).toHaveBeenCalledWith('narration.align', { candidate: 201 })

    await user.click(screen.getByRole('button', { name: /Re-alinhar bloco/i }))
    expect(chamarMock).toHaveBeenCalledWith('narration.align_block', {
      candidate: 201,
      block: 101,
    })

    act(() => {
      filaTeste.aplicar({
        job: '791',
        project: 'demo',
        stage: 'aligning',
        percentage: 50,
        message: 'Alinhando blocos…',
        error: null,
      })
    })
    expect(await screen.findByText(/Alinhando blocos/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Cancelar$/i }))
    expect(chamarMock).toHaveBeenCalledWith('jobs.cancel', { id: 791 })
  })
})
