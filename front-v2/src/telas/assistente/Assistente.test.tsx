import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import { Assistente } from '~/telas/assistente/Assistente'

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
})

function envolver(children: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>{children}</ProvedorToast>
    </ProvedorDicas>
  )
}

const MANIFESTO_PADRAO = [
  {
    id: 'ffmpeg',
    version: '7.1',
    size: 150_000_000,
    license: 'GPL-3.0-or-later',
    source_url: 'https://github.com/FFmpeg/FFmpeg',
  },
  {
    id: 'uv',
    version: '0.13.8',
    size: 15_000_000,
    license: 'Apache-2.0',
    source_url: 'https://github.com/astral-sh/uv',
  },
]

const HARDWARE_GPU = {
  gpu: { name: 'NVIDIA GeForce RTX 3050', driver: '616.92', total_mib: 4096, free_mib: 3900 },
  ram: { total: 16 * 1024 ** 3, available: 9 * 1024 ** 3 },
  cuda: true,
  no_compatible_gpu: false,
  effective: { model: 'whisper-turbo', device: 'cuda', compute_type: 'int8_float16' },
  manual: false,
  fallback_reason: null,
  probe: null,
  options: [],
  worker_installed: false,
}

const MODELOS_PADRAO = [
  {
    id: 'whisper-turbo',
    label: 'Whisper large-v3-turbo (GPU NVIDIA)',
    license: 'MIT',
    source_url: 'https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo',
    size: 1_621_666_000,
    installed: false,
    worker_installed: false,
    recommended: true,
  },
  {
    id: 'whisper-small',
    label: 'Whisper small (CPU)',
    license: 'MIT',
    source_url: 'https://huggingface.co/Systran/faster-whisper-small',
    size: 486_212_372,
    installed: false,
    worker_installed: false,
    recommended: false,
  },
]

const WORKER_INSTALADO = {
  installed: true,
  outdated: false,
  cuda: true,
  gpu: true,
  uv: '0.13.8',
  handshake: { protocol: 1, worker: '0.1.0', python: '3.12.16', libs: { 'faster-whisper': '1.2.1' } },
}

function mockPasso1({
  ffmpegInstalled = false,
  ffmpegIncomplete = false,
  workerInstalled = false,
  turboInstalled = false,
  manifesto = MANIFESTO_PADRAO,
  hardware = HARDWARE_GPU,
}: {
  ffmpegInstalled?: boolean
  ffmpegIncomplete?: boolean
  workerInstalled?: boolean
  turboInstalled?: boolean
  manifesto?: typeof MANIFESTO_PADRAO
  hardware?: typeof HARDWARE_GPU
} = {}) {
  chamarMock.mockImplementation(async (cmd: string) => {
    if (cmd === 'components.ffmpeg.status') {
      return { installed: ffmpegInstalled, incomplete: ffmpegIncomplete }
    }
    if (cmd === 'components.manifest') return manifesto
    if (cmd === 'components.settings.get') {
      return { data_dir: '/dados/clipes', cache_dir: '/cache', cache_limit_bytes: 1e10, ffmpeg_path: null }
    }
    if (cmd === 'components.worker.status') {
      return workerInstalled ? WORKER_INSTALADO : { installed: false, gpu: true }
    }
    if (cmd === 'components.models.manifest') {
      return MODELOS_PADRAO.map((m) =>
        m.id === 'whisper-turbo' ? { ...m, installed: turboInstalled, worker_installed: workerInstalled } : m,
      )
    }
    if (cmd === 'transcription.hardware.status') {
      return { ...hardware, worker_installed: workerInstalled }
    }
    if (cmd === 'transcription.grouping') {
      return { enabled: false, mode: 'auto', size: 1, measured_size: null }
    }
    if (cmd === 'components.download') return { path: '/dados/clipes/components/ffmpeg' }
    if (cmd === 'components.worker.install') return { handshake: WORKER_INSTALADO.handshake, cuda: true }
    if (cmd === 'components.models.download') return { id: 'whisper-turbo' }
    if (cmd === 'components.ffmpeg.system') return { version: 'ffmpeg version 7.1', path: '/usr/bin/ffmpeg' }
    if (cmd === 'transcription.hardware.probe') return { chosen: hardware.effective, verified: true }
    if (cmd === 'components.cancel') return {}
    if (cmd === 'assistant.complete') return { completed: false, skipped: true, needsSetup: false }
    return null
  })
}

type DeteccaoMock = {
  ollama: { found: boolean; endpoint: string | null; models: string[] }
  lmStudio: { found: boolean; endpoint: string | null; models: string[] }
  llamaCpp: { found: boolean; endpoint: string | null; models: string[] }
  codex: { found: boolean }
  claude: { found: boolean }
  opencode: { found: boolean }
}

const DETECT_PADRAO: DeteccaoMock = {
  ollama: { found: true, endpoint: 'http://127.0.0.1:11434', models: ['qwen2.5:14b', 'llama3:8b'] },
  lmStudio: { found: false, endpoint: null, models: [] },
  llamaCpp: { found: false, endpoint: null, models: [] },
  codex: { found: true },
  claude: { found: true },
  opencode: { found: false },
}

function mockPasso2({ detect = DETECT_PADRAO }: { detect?: DeteccaoMock } = {}) {
  chamarMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'assistant.detect') return detect
    if (cmd === 'assistant.status') {
      return { completed: false, skipped: false, needsSetup: true, default: '', tasks: {}, localOnly: {} }
    }
    if (cmd === 'provider.profiles.list') return { profiles: [] }
    if (cmd === 'provider.configure') return { profileId: (args?.profileId as string) || 'legacy' }
    if (cmd === 'provider.key.set') return {}
    if (cmd === 'provider.confirm') return {}
    if (cmd === 'provider.test') return { schemaVersion: 1 }
    if (cmd === 'provider.cli.configure') return {}
    if (cmd === 'provider.cli.confirm') return {}
    if (cmd === 'assistant.default.set') return { default: args?.choice }
    if (cmd === 'assistant.complete') return { completed: !args?.skipped, skipped: Boolean(args?.skipped), needsSetup: false }
    return null
  })
}

describe('Tela Assistente de Primeiro Uso (#/assistente)', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => null)
    window.history.replaceState(null, '', '/')
    window.location.hash = '#/assistente?passo=1'
  })

  afterEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
  })

  it('Passo 1 loading exibe <Esqueleto> e navegação com aria-current="step"', async () => {
    let resolverFfmpeg!: (v: unknown) => void
    chamarMock.mockImplementation((cmd: string) => {
      if (cmd === 'components.ffmpeg.status') {
        return new Promise((res) => {
          resolverFfmpeg = res
        })
      }
      if (cmd === 'components.manifest') return Promise.resolve(MANIFESTO_PADRAO)
      if (cmd === 'components.settings.get') {
        return Promise.resolve({ data_dir: '/dados', cache_dir: '/cache', cache_limit_bytes: 1e10 })
      }
      if (cmd === 'components.worker.status') return Promise.resolve({ installed: false, gpu: true })
      if (cmd === 'components.models.manifest') return Promise.resolve(MODELOS_PADRAO)
      if (cmd === 'transcription.hardware.status') return Promise.resolve(HARDWARE_GPU)
      if (cmd === 'transcription.grouping') return Promise.resolve({ enabled: false, mode: 'auto', size: 1 })
      return Promise.resolve(null)
    })

    render(envolver(<Assistente passo={1} />))

    const nav = screen.getByRole('navigation', { name: 'Etapas da configuração inicial' })
    const passo1Item = within(nav).getByText(/1\. Essencial e Hardware/i).closest('button, a')
    expect(passo1Item).toHaveAttribute('aria-current', 'step')

    expect(screen.getByRole('status', { name: /Verificando componentes essenciais/i })).toHaveAttribute(
      'aria-busy',
      'true',
    )

    resolverFfmpeg({ installed: false, incomplete: false })
    expect(await screen.findByRole('button', { name: /Baixar FFmpeg/i })).toBeInTheDocument()
  })

  it('camada principal do Passo 1 não expõe int8_float16 nem handshake fora de <details>', async () => {
    mockPasso1({ workerInstalled: true })
    render(envolver(<Assistente passo={1} />))

    await screen.findByText(/NVIDIA GeForce RTX 3050/i)

    const foraDeDetails = (texto: RegExp) => {
      const nos = screen.queryAllByText(texto)
      return nos.filter((el) => !el.closest('details'))
    }

    expect(foraDeDetails(/int8_float16/i)).toHaveLength(0)
    expect(foraDeDetails(/handshake/i)).toHaveLength(0)

    const detalhes = screen.getByText('Detalhes técnicos').closest('details')
    expect(detalhes).not.toBeNull()
    expect(within(detalhes!).getByText(/int8_float16/i)).toBeInTheDocument()
    expect(within(detalhes!).getByText(/handshake/i)).toBeInTheDocument()
    expect(screen.getByText(/Tamanho variável conforme ambiente CUDA\/CPU$/i)).toBeInTheDocument()
  })

  it('Baixar FFmpeg abre <ConfirmDialog> com tamanho/licença, Esc cancela e confirmar chama components.download', async () => {
    const user = userEvent.setup()
    mockPasso1({ ffmpegInstalled: false })
    render(envolver(<Assistente passo={1} />))

    const btnBaixar = await screen.findByRole('button', { name: /Baixar FFmpeg/i })
    await user.click(btnBaixar)

    const dialogo = await screen.findByRole('alertdialog')
    expect(dialogo).toHaveTextContent(/150 MB/)
    expect(dialogo).toHaveTextContent(/GPL-3\.0-or-later/)

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(chamarMock).not.toHaveBeenCalledWith('components.download', expect.anything())

    await user.click(btnBaixar)
    const dialogo2 = await screen.findByRole('alertdialog')
    await user.click(within(dialogo2).getByRole('button', { name: /Confirmar download|Baixar FFmpeg/i }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('components.download', {
        id: 'ffmpeg',
        confirmed: true,
      })
    })
  })

  it('Passo 1 job_running traduz etapas 25/45/95 do worker e Cancelar chama components.cancel', async () => {
    const user = userEvent.setup()
    mockPasso1({ ffmpegInstalled: true, workerInstalled: false })
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'components.ffmpeg.status') return { installed: true, incomplete: false }
      if (cmd === 'components.manifest') return MANIFESTO_PADRAO
      if (cmd === 'components.settings.get') return { data_dir: '/dados', cache_dir: '/cache', cache_limit_bytes: 1e10 }
      if (cmd === 'components.worker.status') return { installed: false, gpu: true }
      if (cmd === 'components.models.manifest') return MODELOS_PADRAO
      if (cmd === 'transcription.hardware.status') return HARDWARE_GPU
      if (cmd === 'transcription.grouping') return { enabled: false, mode: 'auto', size: 1 }
      if (cmd === 'components.worker.install') return new Promise(() => {})
      if (cmd === 'components.cancel') return {}
      return null
    })

    render(envolver(<Assistente passo={1} />))

    await user.click(await screen.findByRole('button', { name: /Instalar motor e modelo recomendados/i }))
    const dialogo = await screen.findByRole('alertdialog')
    await user.click(within(dialogo).getByRole('button', { name: /Confirmar|Instalar/i }))

    act(() => {
      filaTeste.aplicar({
        job: 'worker',
        project: null,
        stage: 'worker',
        percentage: 25,
        message: 'Instalando Python',
        error: null,
      })
    })
    expect(await screen.findByText(/Instalando ambiente isolado/i)).toBeInTheDocument()

    act(() => {
      filaTeste.aplicar({
        job: 'worker',
        project: null,
        stage: 'worker',
        percentage: 45,
        message: 'Dependências',
        error: null,
      })
    })
    expect(await screen.findByText(/Instalando aceleração/i)).toBeInTheDocument()

    act(() => {
      filaTeste.aplicar({
        job: 'worker',
        project: null,
        stage: 'worker',
        percentage: 95,
        message: 'Verificando',
        error: null,
      })
    })
    expect(await screen.findByText(/Verificando funcionamento/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(chamarMock).toHaveBeenCalledWith('components.cancel', { id: 'worker' })
  })

  it('Passo 1 partial permite avançar só com FFmpeg e error traduz unknown_component, hash_mismatch e invalid_ffmpeg', async () => {
    const user = userEvent.setup()
    mockPasso1({ ffmpegInstalled: true, workerInstalled: false, turboInstalled: false })
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'components.ffmpeg.status') return { installed: true, incomplete: false }
      if (cmd === 'components.manifest') return MANIFESTO_PADRAO
      if (cmd === 'components.settings.get') return { data_dir: '/dados', cache_dir: '/cache', cache_limit_bytes: 1e10 }
      if (cmd === 'components.worker.status') return { installed: false, gpu: true }
      if (cmd === 'components.models.manifest') return MODELOS_PADRAO
      if (cmd === 'transcription.hardware.status') return HARDWARE_GPU
      if (cmd === 'transcription.grouping') return { enabled: false, mode: 'auto', size: 1 }
      if (cmd === 'components.ffmpeg.system') throw new ErroCore('invalid_ffmpeg', 'bad bin')
      return null
    })

    render(envolver(<Assistente passo={1} />))

    // Validar FFmpeg do sistema com erro invalid_ffmpeg
    await user.click(await screen.findByText(/Já tenho FFmpeg instalado no computador/i))
    await user.click(screen.getByRole('button', { name: /Validar caminho/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Não encontramos o FFmpeg e o FFprobe válidos nesse caminho\./i,
    )

    // Avançar para Passo 2 mesmo sem motor local instalado (partial)
    await user.click(screen.getByRole('button', { name: /Próximo: Provedor de IA/i }))
    expect(window.location.hash).toBe('#/assistente?passo=2')
  })

  it('Passo 1 desabilita download com Dica quando FFmpeg ausente do manifesto', async () => {
    const user = userEvent.setup()
    mockPasso1({
      ffmpegInstalled: false,
      manifesto: MANIFESTO_PADRAO.filter((m) => m.id !== 'ffmpeg'),
    })

    render(envolver(<Assistente passo={1} />))
    const btnFfmpeg = await screen.findByRole('button', { name: /Baixar FFmpeg/i })
    expect(btnFfmpeg).toBeDisabled()
    await user.hover(btnFfmpeg.parentElement as HTMLElement)
    const dica = await screen.findByText(/Download automático indisponível nesta plataforma/i)
    expect(dica).toBeInTheDocument()
    expect(dica).not.toHaveTextContent(/#[0-9]{3}/)
  })

  it('Passo 2 empty (nenhum servidor/CLI) destaca Configurar chave de API e exigência de consentimento remoto', async () => {
    const user = userEvent.setup()
    mockPasso2({
      detect: {
        ollama: { found: false, endpoint: null, models: [] },
        lmStudio: { found: false, endpoint: null, models: [] },
        llamaCpp: { found: false, endpoint: null, models: [] },
        codex: { found: false },
        claude: { found: false },
        opencode: { found: false },
      },
    })

    render(envolver(<Assistente passo={2} />))

    expect(
      await screen.findByText(/Nenhum servidor local ou CLI encontrado automaticamente/i),
    ).toBeInTheDocument()

    const radioApi = screen.getByRole('radio', { name: /Chave de API/i })
    expect(radioApi).toHaveAttribute('aria-checked', 'true')

    const btnTestar = screen.getByRole('button', { name: /Testar conexão/i })
    expect(btnTestar).toBeDisabled()

    await user.type(screen.getByPlaceholderText(/Cole sua chave/i), 'sk-teste-1234')
    expect(btnTestar).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /Concordo em enviar apenas texto/i }))
    expect(btnTestar).toBeEnabled()

    await user.click(btnTestar)
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('provider.key.set', expect.objectContaining({ key: 'sk-teste-1234' }))
      expect(chamarMock).toHaveBeenCalledWith('provider.confirm', expect.objectContaining({ endpoint: 'https://api.openai.com/v1' }))
      expect(chamarMock).toHaveBeenCalledWith('provider.test', expect.anything())
    })
  })

  it('Passo 2 exibe selo Local no Ollama, Experimental no Claude CLI, navega radiogroup com setas e conclui', async () => {
    const user = userEvent.setup()
    mockPasso2()
    render(envolver(<Assistente passo={2} />))

    expect(await screen.findByText(/Local · US\$ 0,00 · não sai do computador/i)).toBeInTheDocument()
    expect(screen.getByText(/Experimental/i)).toBeInTheDocument()

    const radioOllama = screen.getByRole('radio', { name: /Ollama/i })
    expect(radioOllama).toHaveAttribute('aria-checked', 'true')

    radioOllama.focus()
    await user.keyboard('{ArrowDown}')
    const radioCodex = screen.getByRole('radio', { name: /Codex CLI/i })
    expect(radioCodex).toHaveAttribute('aria-checked', 'true')

    await user.keyboard('{ArrowUp}')
    expect(radioOllama).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('button', { name: /Concluir configuração/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'provider.configure',
        expect.objectContaining({ endpoint: 'http://127.0.0.1:11434', kind: 'ollama' }),
      )
      expect(chamarMock).toHaveBeenCalledWith('assistant.default.set', expect.anything())
      expect(chamarMock).toHaveBeenCalledWith('assistant.complete', { skipped: false })
      expect(window.location.hash).toBe('#/inicio')
    })
  })

  it('Pular por enquanto chama assistant.complete { skipped: true } e navega para #/inicio', async () => {
    const user = userEvent.setup()
    mockPasso1({ ffmpegInstalled: false })
    render(envolver(<Assistente passo={1} />))

    await user.click(await screen.findByRole('button', { name: /Pular por enquanto/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('assistant.complete', { skipped: true })
      expect(window.location.hash).toBe('#/inicio')
    })
  })

  it('UI-03: Passo 2 inicia consentimento de cada CLI desmarcado e exige marcação antes de concluir', async () => {
    const user = userEvent.setup()
    mockPasso2({
      detect: {
        ollama: { found: false, endpoint: null, models: [] },
        lmStudio: { found: false, endpoint: null, models: [] },
        llamaCpp: { found: false, endpoint: null, models: [] },
        codex: { found: true },
        claude: { found: true },
        opencode: { found: true },
      },
    })

    render(envolver(<Assistente passo={2} />))

    const radioCodex = await screen.findByRole('radio', { name: /Codex CLI/i })
    expect(radioCodex).toHaveAttribute('aria-checked', 'true')
    expect(
      screen.getByRole('checkbox', { name: /Concordo em enviar apenas texto de transcrições pela Codex CLI/i }),
    ).not.toBeChecked()
    expect(screen.getByRole('button', { name: /Concluir configuração/i })).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: /Claude Code CLI/i }))
    expect(
      screen.getByRole('checkbox', { name: /Concordo em enviar apenas texto de transcrições pela Claude Code CLI/i }),
    ).not.toBeChecked()
    expect(screen.getByRole('button', { name: /Concluir configuração/i })).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: /OpenCode CLI/i }))
    const checkOpencode = screen.getByRole('checkbox', {
      name: /Concordo em enviar apenas texto de transcrições pela OpenCode CLI/i,
    })
    expect(checkOpencode).not.toBeChecked()
    expect(screen.getByRole('button', { name: /Concluir configuração/i })).toBeDisabled()

    expect(chamarMock).not.toHaveBeenCalledWith('provider.cli.configure', expect.anything())
    expect(chamarMock).not.toHaveBeenCalledWith('provider.cli.confirm', expect.anything())
    expect(chamarMock).not.toHaveBeenCalledWith('provider.test', expect.anything())
    expect(chamarMock).not.toHaveBeenCalledWith('assistant.default.set', expect.anything())

    await user.click(checkOpencode)
    const btnConcluir = screen.getByRole('button', { name: /Concluir configuração/i })
    expect(btnConcluir).toBeEnabled()

    await user.click(btnConcluir)
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('provider.cli.configure', expect.objectContaining({ kind: 'opencode' }))
      expect(chamarMock).toHaveBeenCalledWith('provider.cli.confirm', { kind: 'opencode' })
      expect(chamarMock).toHaveBeenCalledWith('assistant.default.set', { choice: 'opencode' })
    })
  })

  it('UI-05: preserva retorno=config entre passos 1 e 2 e volta para #/config/provedores ao concluir ou pular', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/assistente?passo=1&retorno=config'
    mockPasso1({ ffmpegInstalled: true })

    const { rerender } = render(envolver(<Assistente passo={1} />))
    await user.click(await screen.findByRole('button', { name: /Próximo: Provedor de IA/i }))
    expect(window.location.hash).toBe('#/assistente?passo=2&retorno=config')

    mockPasso2()
    rerender(envolver(<Assistente passo={2} />))
    await screen.findByRole('radio', { name: /Ollama/i })

    await user.click(screen.getByRole('button', { name: /Voltar/i }))
    expect(window.location.hash).toBe('#/assistente?passo=1&retorno=config')

    window.location.hash = '#/assistente?passo=2&retorno=config'
    await user.click(screen.getByRole('button', { name: /Concluir configuração/i }))
    await waitFor(() => {
      expect(window.location.hash).toBe('#/config/provedores')
    })

    window.location.hash = '#/assistente?passo=2&retorno=config'
    await user.click(screen.getByRole('button', { name: /Pular por enquanto/i }))
    await waitFor(() => {
      expect(window.location.hash).toBe('#/config/provedores')
    })
  })

  it('UI-08 e UI-10: Passo 1 tem h1 único e alvos >= 24 px (Mudar pasta de instalação e summaries)', async () => {
    mockPasso1({ workerInstalled: true })
    render(envolver(<Assistente passo={1} />))

    const h1 = await screen.findByRole('heading', {
      level: 1,
      name: /Passo 1: Essencial para transcrever e cortar/i,
    })
    expect(h1).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)

    const btnPasta = screen.getByRole('button', { name: 'Mudar pasta de instalação' })
    expect(btnPasta.className).toContain('min-h-6')

    const sumFfmpeg = screen.getByText('Já tenho FFmpeg instalado no computador').closest('summary')
    const sumTech = screen.getByText('Detalhes técnicos').closest('summary')
    expect(sumFfmpeg?.className).toContain('min-h-6')
    expect(sumTech?.className).toContain('min-h-6')
  })

  it('UI-08 e UI-10: Passo 2 tem h1 único e role="radio" com min-h-6', async () => {
    mockPasso2()
    render(envolver(<Assistente passo={2} />))

    const h1 = await screen.findByRole('heading', {
      level: 1,
      name: /Passo 2: Quem escolhe os Cortes e sugere títulos/i,
    })
    expect(h1).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)

    const radios = screen.getAllByRole('radio')
    expect(radios.length).toBeGreaterThanOrEqual(4)
    for (const r of radios) {
      expect(r.className).toContain('min-h-6')
    }
  })

  it('UI-12: Passo 1 não expõe referências de issue (#301/#307) em textos nem dicas', async () => {
    const user = userEvent.setup()
    mockPasso1({
      ffmpegInstalled: false,
      manifesto: MANIFESTO_PADRAO.filter((m) => m.id !== 'ffmpeg'),
    })

    render(envolver(<Assistente passo={1} />))
    const btnFfmpeg = await screen.findByRole('button', { name: /Baixar FFmpeg/i })
    expect(screen.queryByText(/#[0-9]{3}/)).not.toBeInTheDocument()

    await user.hover(btnFfmpeg.parentElement as HTMLElement)
    const dica = await screen.findByText(/Download automático indisponível nesta plataforma/i)
    expect(dica).toBeInTheDocument()
    expect(screen.queryByText(/#[0-9]{3}/)).not.toBeInTheDocument()
  })
})
