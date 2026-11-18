import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { formatarTecla, ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import type { FonteProjeto } from '~/stores/fontesProjeto'
import { DetalheFonte } from '~/telas/fontes/DetalheFonte'

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
    private cb: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb
    }
    observe(target: Element) {
      this.cb(
        [
          {
            target,
            contentRect: {
              width: 800,
              height: 600,
              top: 0,
              left: 0,
              bottom: 600,
              right: 800,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            },
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          } as ResizeObserverEntry,
        ],
        this,
      )
    }
    unobserve() {}
    disconnect() {}
  }

  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute('data-index')) {
      return {
        width: 780,
        height: 76,
        top: 0,
        left: 0,
        bottom: 76,
        right: 780,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    }
    return {
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      bottom: 600,
      right: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
  }

  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return 600
    },
  })

  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return this.hasAttribute('data-index') ? 76 : 600
    },
  })

  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      const filho = this.firstElementChild as HTMLElement | null
      const h = filho?.style?.height ? parseFloat(filho.style.height) : 0
      return Number.isFinite(h) && h > 0 ? Math.max(h, 600) : 600
    },
  })

  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {}
  }
  HTMLElement.prototype.scrollTo = function (opts?: ScrollToOptions | number, y?: number) {
    const top = typeof opts === 'number' ? (y ?? 0) : (opts?.top ?? 0)
    this.scrollTop = top
    this.dispatchEvent(new Event('scroll'))
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

const FONTE_PRONTA: FonteProjeto = {
  id: 4,
  path: '/videos/Live_12_11_final.mp4',
  status: 'available',
  available: true,
  verified: true,
  audio_track: 1,
  origin_url: 'https://youtube.com/watch?v=live1211',
  language: 'pt',
  permission: { status: 'granted', who: 'Criador', where: 'Discord', scope: 'cortes e tradução' },
  metadata: {
    format: { duration: '3600.0' },
    streams: [
      { index: 0, codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '60/1' },
      { index: 1, codec_type: 'audio', codec_name: 'aac', tags: { title: 'Mic OBS' } },
    ],
  },
}

const FONTE_OFFLINE_V1: FonteProjeto = {
  id: 2,
  path: '/videos/VOD_09_11_v1.mp4',
  status: 'offline',
  available: false,
  verified: false,
  audio_track: 1,
  origin_url: null,
  language: 'pt',
  permission: { status: 'none' },
  metadata: { format: { duration: '6600.0' }, streams: [] },
}

function criarTimelineMock(corrigidas = new Map<number, string>()) {
  return Array.from({ length: 6 }, (_, i) => {
    if (i === 1) {
      return { type: 'silence' as const, start_us: 1_000_000, end_us: 3_800_000 }
    }
    const id = i === 0 ? 1 : i
    const pos0 = id * 10
    const pos1 = id * 10 + 1
    const w0Text = corrigidas.get(pos0) ?? 'Frase'
    const w1Text = corrigidas.get(pos1) ?? String(id)
    return {
      type: 'sentence' as const,
      id,
      start_us: i * 5_000_000,
      end_us: (i + 1) * 5_000_000,
      language: 'pt',
      text: `${w0Text} ${w1Text}`,
      first_position: pos0,
      last_position: pos1,
      words: [
        { position: pos0, text: w0Text, corrected: corrigidas.has(pos0), start_us: i * 5_000_000 },
        { position: pos1, text: w1Text, corrected: corrigidas.has(pos1), start_us: i * 5_000_000 + 500_000 },
      ],
    }
  })
}

function mockBase({
  fontes = [FONTE_PRONTA, FONTE_OFFLINE_V1],
  transcriptState = 'complete' as 'none' | 'running' | 'partial' | 'complete',
  overrides = {},
}: {
  fontes?: FonteProjeto[]
  transcriptState?: 'none' | 'running' | 'partial' | 'complete'
  overrides?: Partial<Record<string, (args: unknown) => unknown>>
} = {}) {
  const corrigidas = new Map<number, string>([[11, 'corrigida']])

  chamarMock.mockImplementation(async (cmd: string, args: unknown) => {
    if (Object.hasOwn(overrides, cmd)) {
      return overrides[cmd]!(args)
    }
    switch (cmd) {
      case 'sources.list':
        return fontes
      case 'projects.local_only.get':
        return { open: true, enabled: false }
      case 'channel_profile.languages':
        return [
          { code: 'pt', name: 'portuguese' },
          { code: 'en', name: 'english' },
        ]
      case 'transcription.status': {
        const sid = (args as { source_id: number }).source_id
        if (transcriptState === 'none') {
          return { language: 'pt', transcript: null, job: null }
        }
        if (transcriptState === 'running') {
          return {
            language: 'pt',
            transcript: {
              id: sid,
              state: 'running',
              resume_us: 1_200_000_000,
              duration_us: 3_600_000_000,
              model: 'whisper-turbo',
              engine: 'local',
              words: 0,
            },
            job: { id: 99, state: 'running', progress: 45, code: null },
          }
        }
        if (transcriptState === 'partial') {
          return {
            language: 'pt',
            transcript: {
              id: sid,
              state: 'running',
              resume_us: 1_200_000_000,
              duration_us: 3_600_000_000,
              model: 'whisper-turbo',
              engine: 'local',
              words: 0,
            },
            job: null,
          }
        }
        return {
          language: 'pt',
          transcript: {
            id: sid,
            state: 'complete',
            resume_us: 3_600_000_000,
            duration_us: 3_600_000_000,
            model: 'whisper-turbo',
            engine: 'local',
            words: 30000,
          },
          job: null,
        }
      }
      case 'transcription.hardware.status':
        return {
          gpu: { name: 'NVIDIA GeForce RTX 3050', driver: '616.92', total_mib: 4096, free_mib: 3962 },
          ram: { total: 16 * 1024 ** 3, available: 9 * 1024 ** 3 },
          cuda: true,
          no_compatible_gpu: false,
          effective: { model: 'whisper-turbo', device: 'cuda', compute_type: 'int8_float16' },
          manual: false,
          fallback_reason: null,
          probe: null,
          options: [],
          worker_installed: true,
        }
      case 'transcription.grouping':
        return { enabled: false, mode: 'auto', size: 1, measured_size: null }
      case 'transcription.groq.info':
        return {
          endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
          model: 'whisper-large-v3-turbo',
          configured: true,
          confirmed: false,
          local_only: false,
          prices: { minimum_seconds: 10 },
        }
      case 'transcription.groq.estimate':
        return { kind: 'usd', minMicroUsd: 35000, maxMicroUsd: 55000, audio_us: 3_600_000_000 }
      case 'transcription.blocks':
        return transcriptState === 'none'
          ? []
          : [{ start_us: 0, end_us: 600_000_000, device: 'cuda', compute_type: 'int8_float16' }]
      case 'energy.status':
        return { measured: false, marks: { high: 0, peak: 0 }, job: null }
      case 'chat.status':
        return { state: 'none', canFetch: true, intervals: 0, messages: 0, peaks: 0, job: null }
      case 'transcription.segment':
        return { transcript_id: 1, sentences: 5, changed: false }
      case 'transcription.corrections':
        return { can_undo: true, can_redo: true }
      case 'transcription.timeline': {
        const items = criarTimelineMock(corrigidas)
        return { total: items.length, offset: 0, items }
      }
      case 'transcription.correct': {
        const { source_id, position, text } = args as {
          source_id: number
          position: number
          text: string
        }
        corrigidas.set(position, text.trim())
        return {
          changed: true,
          source_id,
          transcript_id: 1,
          position,
          sentence_id: Math.floor(position / 10),
          text: ` ${text.trim()}`,
          corrected: true,
          can_undo: true,
          can_redo: false,
        }
      }
      case 'transcription.search':
        return []
      default:
        return null
    }
  })
}

describe('Tela DetalheFonte (#/projeto/:id/fontes/:fonteId)', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => 'demo')
    window.history.replaceState(null, '', '/')
    window.location.hash = '#/projeto/demo/fontes/4'
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('guarda de rota: redireciona para #/projeto/:id/fontes com toast de aviso (não sucesso) quando :fonteId não existe', async () => {
    mockBase({ fontes: [FONTE_PRONTA] })

    render(
      envolver(
        <DetalheFonte projetoId="demo" projetoPath="/projetos/Demo.clipes" fonteId="999" />,
      ),
    )

    await waitFor(() => {
      expect(window.location.hash).toBe('#/projeto/demo/fontes')
    })
    const tituloToast = await screen.findByText(
      /A Fonte selecionada não foi encontrada neste Projeto/i,
    )
    expect(tituloToast).toBeInTheDocument()
    const toastRoot = tituloToast.closest('[class*="rounded-controle"]')
    expect(toastRoot?.querySelector('.lucide-triangle-alert')).not.toBeNull()
    expect(toastRoot?.querySelector('.lucide-check')).toBeNull()
  })

  it('cobre todos os estados §6: loading, empty pré-transcrição, error, ready, job_running e partial com resume_us > 0', async () => {
    // 1) loading
    let resolverLista!: (v: unknown) => void
    mockBase({
      overrides: {
        'sources.list': () =>
          new Promise((res) => {
            resolverLista = res
          }),
      },
    })
    const rLoading = render(
      envolver(
        <DetalheFonte projetoId="demo" projetoPath="/projetos/Demo.clipes" fonteId="4" />,
      ),
    )
    expect(
      screen.getByRole('status', { name: /Carregando detalhes da Fonte/i }),
    ).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText(/Esta Fonte ainda não foi transcrita/i)).not.toBeInTheDocument()
    resolverLista([FONTE_PRONTA])
    rLoading.unmount()

    // 2) empty pré-transcrição + exatamente 1 <h1>
    mockBase({ transcriptState: 'none' })
    const rEmpty = render(
      envolver(
        <DetalheFonte projetoId="demo" projetoPath="/projetos/Demo.clipes" fonteId="4" />,
      ),
    )
    expect(await screen.findByText(/Esta Fonte ainda não foi transcrita/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Focar configuração do Motor/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Live_12_11_final.mp4' })).toBeVisible()
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Selecionar Cortes/i })).toBeDisabled()
    rEmpty.unmount()

    // 3) error em role="alert"
    mockBase({
      overrides: {
        'sources.list': () => {
          throw new ErroCore('out_of_memory', 'VRAM insuficiente')
        },
      },
    })
    const rErro = render(
      envolver(
        <DetalheFonte projetoId="demo" projetoPath="/projetos/Demo.clipes" fonteId="4" />,
      ),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/Faltou memória de vídeo\/RAM/i)
    rErro.unmount()

    // 4) job_running
    mockBase({ transcriptState: 'running' })
    const rRunning = render(
      envolver(
        <DetalheFonte projetoId="demo" projetoPath="/projetos/Demo.clipes" fonteId="4" />,
      ),
    )
    expect(await screen.findByText(/Transcrição em andamento/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Pausar \/ Cancelar mantendo blocos salvos/i }),
    ).toBeInTheDocument()
    rRunning.unmount()

    // 5) partial com resume_us > 0
    mockBase({ transcriptState: 'partial' })
    const rPartial = render(
      envolver(
        <DetalheFonte projetoId="demo" projetoPath="/projetos/Demo.clipes" fonteId="4" />,
      ),
    )
    expect(await screen.findByText(/Transcrição parcial salva até 00:20:00/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Retomar de 00:20:00/i }).length).toBeGreaterThanOrEqual(1)
    rPartial.unmount()

    // 6) ready
    mockBase({ transcriptState: 'complete' })
    render(
      envolver(
        <DetalheFonte projetoId="demo" projetoPath="/projetos/Demo.clipes" fonteId="4" />,
      ),
    )
    expect(await screen.findByRole('button', { name: /Selecionar Cortes/i })).toBeEnabled()
  })

  it('renderiza <ListaVirtual> com Silêncio clicável, alvos >= 24px, F2/Enter inline preservando foco, Esc, Ctrl+Z entre Fontes e busca Ctrl+F', async () => {
    const user = userEvent.setup()
    mockBase({
      transcriptState: 'complete',
      overrides: {
        'transcription.undo': () => ({
          changed: true,
          source_id: 2,
          transcript_id: 2,
          position: 20,
          sentence_id: 2,
          text: ' revertida',
          corrected: false,
          can_undo: false,
          can_redo: true,
        }),
        'transcription.search': (args) => {
          const q = (args as { query: string }).query
          if (q === 'inexistente') return []
          return [
            {
              transcript_id: 1,
              source_id: 4,
              source: 'Live_12_11_final.mp4',
              sentence_id: 3,
              start_us: 15_000_000,
              end_us: 20_000_000,
              row: 3,
              snippet: [{ text: 'Frase 3', match: true }],
            },
          ]
        },
      },
    })

    render(
      envolver(
        <DetalheFonte projetoId="demo" projetoPath="/projetos/Demo.clipes" fonteId="4" />,
      ),
    )

    // Palavra corrigida exibe indicador não só por cor e >= 24x24 (min-w-6 min-h-6)
    const palavraCorrigida = await screen.findByRole('button', { name: /corrigida/i })
    expect(palavraCorrigida).toHaveAttribute('aria-description', 'Palavra corrigida')
    expect(palavraCorrigida.className).toContain('min-w-6')
    expect(palavraCorrigida.className).toContain('min-h-6')

    // Silêncio clicável faz seek e não abre edição inline
    const btnSilencio = screen.getByRole('button', { name: /Silêncio · 2,8 s/i })
    await user.click(btnSilencio)
    const video = screen.getByLabelText(/Player de referência da Fonte/i) as HTMLVideoElement
    expect(video.currentTime).toBeCloseTo(1.0, 2)

    // F2 abre edição inline, Esc cancela mantendo foco
    const palavraAlvo = screen.getAllByRole('button', { name: 'Frase' })[0]
    palavraAlvo.focus()
    expect(palavraAlvo).toHaveFocus()
    await user.keyboard('{F2}')

    const inputEdicao = await screen.findByRole('textbox', { name: 'Corrigir palavra' })
    expect(inputEdicao).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Corrigir palavra' })).not.toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'Frase' })[0]).toHaveFocus()
    })

    // Enter na palavra abre edição inline e Enter confirma transcription.correct mantendo foco
    await user.keyboard('{Enter}')
    const input2 = await screen.findByRole('textbox', { name: 'Corrigir palavra' })
    await user.clear(input2)
    await user.type(input2, 'Fala{Enter}')

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('transcription.correct', {
        source_id: 4,
        position: 10,
        text: 'Fala',
      })
      expect(screen.getByRole('button', { name: 'Fala' })).toHaveFocus()
    })

    // UI-28: Tooltip de Desfazer/Refazer sem #302 e Ctrl+Z retornando outra Fonte exibe o nome da Fonte no toast
    const btnDesfazer = screen.getByRole('button', { name: /Desfazer/i })
    await user.hover(btnDesfazer)
    expect(
      await screen.findByText(/Desfaz a última correção de palavra no Projeto inteiro\./i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/#\d{2,4}\b/)).not.toBeInTheDocument()

    const btnRefazer = screen.getByRole('button', { name: /^Refazer(?!\s+transcrição)/i })
    await user.hover(btnRefazer)
    expect(
      await screen.findByText(/Refaz a última correção desfeita no Projeto inteiro\./i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/#\d{2,4}\b/)).not.toBeInTheDocument()

    await user.click(btnDesfazer)
    expect(await screen.findByRole('button', { name: /Ir para Fonte afetada/i })).toBeInTheDocument()
    expect(await screen.findByText('VOD_09_11_v1.mp4')).toBeInTheDocument()
    expect(screen.queryByText(/Fonte #2/)).not.toBeInTheDocument()

    // Busca Ctrl+F com empty state ("Nenhum trecho encontrado") e Limpar busca
    await user.keyboard('{Control>}f{/Control}')
    const busca = screen.getByRole('searchbox', { name: /Buscar na Transcrição/i })
    expect(busca).toHaveFocus()
    await user.type(busca, 'inexistente{Enter}')
    expect(
      await screen.findByText(/Nenhum trecho encontrado para 'inexistente'\./i),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Limpar busca/i }))
    expect(busca).toHaveValue('')
  })

  it('mantém Leitor, busca Ctrl+F e correção F2 100% funcionais em Fonte offline (inclusive V1)', async () => {
    const user = userEvent.setup()
    mockBase({ fontes: [FONTE_OFFLINE_V1], transcriptState: 'complete' })

    render(
      envolver(
        <DetalheFonte projetoId="demo" projetoPath="/projetos/Demo.clipes" fonteId="2" />,
      ),
    )

    // Player bloqueado com banner
    expect(await screen.findByText(/Vídeo indisponível no disco/i)).toBeInTheDocument()

    // Leitor continua editável via F2
    const palavras = await screen.findAllByRole('button', { name: 'Frase' })
    const palavra = palavras[0]
    palavra.focus()
    await user.keyboard('{F2}')
    const input = await screen.findByRole('textbox', { name: 'Corrigir palavra' })
    await user.clear(input)
    await user.type(input, 'OfflineEditada{Enter}')

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('transcription.correct', {
        source_id: 2,
        position: 10,
        text: 'OfflineEditada',
      })
    })
  })

  it('navega palavra a palavra (←/→/Home/End), refaz com Ctrl+Shift+Z e salta para ?frase=4&row=4', async () => {
    const user = userEvent.setup()
    mockBase({
      transcriptState: 'complete',
      overrides: {
        'transcription.redo': () => ({
          changed: true,
          source_id: 4,
          transcript_id: 1,
          position: 11,
          sentence_id: 1,
          text: ' refeita',
          corrected: true,
          can_undo: true,
          can_redo: false,
        }),
      },
    })

    render(
      envolver(
        <DetalheFonte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          fonteId="4"
          frase={4}
          row={4}
        />,
      ),
    )

    const artigoDestacado = await screen.findByRole('article', { name: 'Frase 4' })
    expect(artigoDestacado.className).toContain('marcado')

    const palavrasFrase1 = within(screen.getByRole('article', { name: 'Frase 1' })).getAllByRole(
      'button',
    )
    palavrasFrase1[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(palavrasFrase1[1]).toHaveFocus()
    await user.keyboard('{Home}')
    expect(palavrasFrase1[0]).toHaveFocus()
    await user.keyboard('{End}')
    expect(palavrasFrase1[1]).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(palavrasFrase1[0]).toHaveFocus()

    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('transcription.redo', {})
    })
  })

  it('UI-26: pré-transcrição respeita a Regra da Luz Única com apenas 1 botão bg-sinal e mantém foco no Motor', async () => {
    const user = userEvent.setup()
    mockBase({ transcriptState: 'none' })

    render(
      envolver(
        <DetalheFonte projetoId="demo" projetoPath="/projetos/Demo.clipes" fonteId="4" />,
      ),
    )

    expect(await screen.findByText(/Esta Fonte ainda não foi transcrita/i)).toBeInTheDocument()
    const botoesSinal = document.querySelectorAll('button.bg-sinal')
    expect(botoesSinal).toHaveLength(1)
    expect(botoesSinal[0]).toHaveTextContent(/Iniciar transcrição/i)

    const btnFocarMotor = screen.getByRole('button', { name: /Focar configuração do Motor/i })
    expect(btnFocarMotor.className).not.toContain('bg-sinal')
    await user.click(btnFocarMotor)
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /Local — US\$ 0,00/i })).toHaveFocus()
    })
  })

  it('UI-23: retomarParcial no banner parcial trata retry, confirmation_required e engine_change_confirmation com <ConfirmDialog>', async () => {
    const user = userEvent.setup()
    let modoErro: 'retry' | 'consent' | 'replace' = 'retry'
    let confirmadoGroq = false
    mockBase({
      overrides: {
        'transcription.status': (args) => ({
          language: 'pt',
          transcript: {
            id: (args as { source_id: number }).source_id,
            state: 'running',
            resume_us: 1_200_000_000,
            duration_us: 3_600_000_000,
            model: 'whisper-large-v3-turbo',
            engine: 'groq',
            words: 0,
          },
          job: null,
        }),
        'transcription.groq.info': () => ({
          endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
          model: 'whisper-large-v3-turbo',
          configured: true,
          confirmed: true,
          local_only: false,
          prices: { minimum_seconds: 10 },
        }),
        'transcription.groq.confirm': () => {
          confirmadoGroq = true
          return { confirmed: true }
        },
        'transcription.start': (args) => {
          const a = args as { retry_confirmed?: boolean; replace_confirmed?: boolean }
          if (modoErro === 'retry' && !a.retry_confirmed) {
            throw new ErroCore('transcription_retry_confirmation', 'Confirme retry', {
              estimate: { usd: 0.02 },
            })
          }
          if (modoErro === 'consent' && !confirmadoGroq) {
            throw new ErroCore('confirmation_required', 'Confirme envio remoto')
          }
          if (modoErro === 'replace' && !a.replace_confirmed) {
            throw new ErroCore('engine_change_confirmation', 'Confirme troca de motor', {
              blocks: 2,
              paid_audio_us: 600_000_000,
              paid_usd: 0.01,
            })
          }
          return { transcript_id: 4, state: 'running', job_id: 99, warnings: [] }
        },
      },
    })

    render(
      envolver(
        <DetalheFonte projetoId="demo" projetoPath="/projetos/Demo.clipes" fonteId="4" />,
      ),
    )

    const bannerParcial = await screen.findByRole('status')
    const btnRetomarBanner = within(bannerParcial).getByRole('button', {
      name: /Retomar de 00:20:00/i,
    })

    // 1) transcription_retry_confirmation
    await user.click(btnRetomarBanner)
    const dlgRetry = await screen.findByRole('alertdialog')
    expect(within(dlgRetry).getByText(/Repetir chamada paga no Groq/i)).toBeInTheDocument()
    await user.click(within(dlgRetry).getByRole('button', { name: /Repetir chamada/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'transcription.start',
        expect.objectContaining({ retry_confirmed: true, engine: 'groq' }),
      )
    })

    // 2) confirmation_required
    modoErro = 'consent'
    await user.click(btnRetomarBanner)
    const dlgConsent = await screen.findByRole('alertdialog')
    expect(within(dlgConsent).getByText(/Confirmar envio remoto para o Groq/i)).toBeInTheDocument()
    await user.click(within(dlgConsent).getByRole('button', { name: /Confirmar envio/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('transcription.groq.confirm', {
        endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
        confirmed: true,
      })
    })

    // 3) engine_change_confirmation
    modoErro = 'replace'
    await user.click(btnRetomarBanner)
    const dlgReplace = await screen.findByRole('alertdialog')
    expect(
      within(dlgReplace).getByText(/Trocar Motor e descartar progresso parcial/i),
    ).toBeInTheDocument()
    await user.click(within(dlgReplace).getByRole('button', { name: /Trocar Motor e recomeçar/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'transcription.start',
        expect.objectContaining({ replace_confirmed: true, engine: 'groq' }),
      )
    })
  })

  it('UI-29: Refazer exibe atalho Ctrl+Shift+Z e setas ←/→ cruzam a fronteira da janela DOM virtualizada', async () => {
    const user = userEvent.setup()
    const itens40 = Array.from({ length: 40 }, (_, i) => {
      const id = i + 1
      const pos0 = id * 10
      const pos1 = id * 10 + 1
      return {
        type: 'sentence' as const,
        id,
        start_us: i * 5_000_000,
        end_us: (i + 1) * 5_000_000,
        language: 'pt',
        text: `Linha${id}A Linha${id}B`,
        first_position: pos0,
        last_position: pos1,
        words: [
          { position: pos0, text: `Linha${id}A`, corrected: false, start_us: i * 5_000_000 },
          { position: pos1, text: `Linha${id}B`, corrected: false, start_us: i * 5_000_000 + 500_000 },
        ],
      }
    })

    mockBase({
      transcriptState: 'complete',
      overrides: {
        'transcription.timeline': (args) => {
          const { offset = 0, limit = 200 } = (args as { offset?: number; limit?: number }) ?? {}
          return {
            total: itens40.length,
            offset,
            items: itens40.slice(offset, offset + limit),
          }
        },
      },
    })

    render(
      envolver(
        <DetalheFonte projetoId="demo" projetoPath="/projetos/Demo.clipes" fonteId="4" />,
      ),
    )

    // 1) Botão Refazer exibe badge de atalho (Mod+Shift+Z)
    const btnRefazer = await screen.findByRole('button', { name: /^Refazer(?!\s+transcrição)/i })
    const kbdRefazer = btnRefazer.querySelector('kbd')
    expect(kbdRefazer).not.toBeNull()
    expect(kbdRefazer?.textContent).toBe(formatarTecla('Mod+Shift+Z'))

    // 2) ArrowRight na última palavra montada da janela DOM virtualizada rola e foca a primeira palavra da próxima Frase
    const regiao = await screen.findByRole('region', { name: 'Transcrição da Fonte' })
    await waitFor(() => {
      expect(regiao.querySelectorAll('button[data-word]').length).toBeGreaterThan(0)
    })
    const botoesMontadosInicio = Array.from(regiao.querySelectorAll<HTMLButtonElement>('button[data-word]'))
    const ultimoBotao = botoesMontadosInicio[botoesMontadosInicio.length - 1]
    const ultimaLinhaMontada = Number(ultimoBotao.closest('[data-index]')?.getAttribute('data-index'))
    const proxFraseId = ultimaLinhaMontada + 2
    expect(screen.queryByRole('article', { name: `Frase ${proxFraseId}` })).not.toBeInTheDocument()

    ultimoBotao.focus()
    expect(ultimoBotao).toHaveFocus()
    await user.keyboard('{ArrowRight}')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: `Linha${proxFraseId}A` })).toHaveFocus()
    })

    // 3) ArrowLeft na primeira palavra montada quando rolado para baixo rola para trás e foca a última palavra da Frase anterior
    regiao.scrollTo({ top: 2000 })
    await waitFor(() => {
      expect(screen.queryByRole('article', { name: 'Frase 1' })).not.toBeInTheDocument()
    })

    const botoesMontadosBaixo = Array.from(regiao.querySelectorAll<HTMLButtonElement>('button[data-word]'))
    const primeiroBotao = botoesMontadosBaixo[0]
    const primeiraLinhaMontada = Number(primeiroBotao.closest('[data-index]')?.getAttribute('data-index'))
    const prevFraseId = primeiraLinhaMontada
    expect(screen.queryByRole('article', { name: `Frase ${prevFraseId}` })).not.toBeInTheDocument()

    primeiroBotao.focus()
    expect(primeiroBotao).toHaveFocus()
    await user.keyboard('{ArrowLeft}')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: `Linha${prevFraseId}B` })).toHaveFocus()
    })
  })
})
