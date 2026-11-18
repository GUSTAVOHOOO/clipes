import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assinarProgressoMock, coreDispatch } from '@core'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { InstaladorJustInTime } from '~/componentes/InstaladorJustInTime'
import { ErroCore } from '~/core/cliente'
import { criarFila, type EventoProgresso, type Fila } from '~/core/progresso'

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
    id: 'yt-dlp',
    version: '2026.11',
    size: 12_000_000,
    license: 'Unlicense',
    source_url: 'https://github.com/yt-dlp/yt-dlp',
  },
  {
    id: 'deno',
    version: '2.9.8',
    size: 42_917_472,
    license: 'MIT',
    source_url: 'https://github.com/denoland/deno',
  },
  {
    id: 'pocket-tts',
    version: '3.3.0',
    size: 7_914_990,
    license: 'MIT',
    source_url: 'https://github.com/kyutai-labs/pocket-tts',
  },
  {
    id: 'uv',
    version: '0.13.8',
    size: 15_000_000,
    license: 'Apache-2.0',
    source_url: 'https://github.com/astral-sh/uv',
  },
]

const CATALOGO_TTS_BASE = {
  componentInstalled: false,
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
        version: 'v1',
      },
    },
  ],
  models: [
    {
      id: 'portuguese_24l',
      engineId: 'pocket-tts',
      language: 'pt',
      label: 'Pocket TTS PT-BR (24 camadas)',
      description: 'Qualidade superior em PT-BR.',
      defaultForLanguage: true,
      active: true,
      installed: false,
      updateAvailable: false,
      termsAccepted: false,
      license: 'CC-BY-4.0',
      sourceUrl: 'https://huggingface.co/kyutai/pocket-tts-without-voice-cloning',
      size: 701_332_218,
    },
  ],
  voices: [],
}

describe('<InstaladorJustInTime>', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => null)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('loading exibe <Esqueleto> enquanto consulta status e manifesto', async () => {
    let resolverStatus!: (v: unknown) => void
    chamarMock.mockImplementation((cmd: string) => {
      if (cmd === 'components.ytdlp.status') {
        return new Promise((res) => {
          resolverStatus = res
        })
      }
      if (cmd === 'components.deno.status') return Promise.resolve({ installed: false })
      if (cmd === 'components.manifest') return Promise.resolve(MANIFESTO_PADRAO)
      if (cmd === 'sources.url.settings.get') {
        return Promise.resolve({ terms_accepted: false, download_dir: '/downloads' })
      }
      if (cmd === 'components.settings.get') {
        return Promise.resolve({ data_dir: '/dados', cache_dir: '/cache', cache_limit_bytes: 1e10 })
      }
      return Promise.resolve(null)
    })

    render(envolver(<InstaladorJustInTime recurso="url_import" aoConcluir={vi.fn()} />))

    expect(
      screen.getByRole('status', { name: /Verificando requisitos/i }),
    ).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('button', { name: /Baixar e continuar/i })).not.toBeInTheDocument()

    resolverStatus({ installed: false })
    expect(await screen.findByRole('button', { name: /Baixar e continuar/i })).toBeInTheDocument()
  })

  it('ready (já instalado) não bloqueia e notifica aoConcluir imediatamente', async () => {
    const aoConcluir = vi.fn()
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'components.ytdlp.status') return { installed: true, version: '2026.11' }
      if (cmd === 'components.deno.status') return { installed: true, version: '2.9.8' }
      if (cmd === 'components.manifest') return MANIFESTO_PADRAO
      if (cmd === 'sources.url.settings.get') {
        return { terms_accepted: true, download_dir: '/downloads' }
      }
      if (cmd === 'components.settings.get') {
        return { data_dir: '/dados', cache_dir: '/cache', cache_limit_bytes: 1e10 }
      }
      return null
    })

    render(envolver(<InstaladorJustInTime recurso="url_import" aoConcluir={aoConcluir} />))

    await waitFor(() => {
      expect(aoConcluir).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByRole('button', { name: /Baixar e continuar/i })).not.toBeInTheDocument()
  })

  it('partial marca yt-dlp com Status "Instalado" e lista apenas deno pendente', async () => {
    const user = userEvent.setup()
    const aoConcluir = vi.fn()
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'components.ytdlp.status') return { installed: true, version: '2026.11' }
      if (cmd === 'components.deno.status') return { installed: false, version: null }
      if (cmd === 'components.manifest') return MANIFESTO_PADRAO
      if (cmd === 'sources.url.settings.get') {
        return { terms_accepted: true, download_dir: '/downloads' }
      }
      if (cmd === 'components.settings.get') {
        return { data_dir: '/dados', cache_dir: '/cache', cache_limit_bytes: 1e10 }
      }
      if (cmd === 'components.download') return { path: '/dados/components/deno' }
      return null
    })

    render(envolver(<InstaladorJustInTime recurso="url_import" aoConcluir={aoConcluir} />))

    expect(await screen.findByText('Instalado')).toBeInTheDocument()
    expect(screen.getByText(/deno/i)).toBeInTheDocument()
    expect(screen.getByText(/MIT/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Baixar e continuar/i }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('components.download', {
        id: 'deno',
        confirmed: true,
      })
      expect(chamarMock).not.toHaveBeenCalledWith('components.download', {
        id: 'yt-dlp',
        confirmed: true,
      })
      expect(aoConcluir).toHaveBeenCalledTimes(1)
    })
  })

  it('url_import exibe licenças Unlicense/MIT, exige aceite de termos e salva sources.url.settings.set antes de baixar', async () => {
    const user = userEvent.setup()
    const aoConcluir = vi.fn()
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'components.ytdlp.status') return { installed: false }
      if (cmd === 'components.deno.status') return { installed: false }
      if (cmd === 'components.manifest') return MANIFESTO_PADRAO
      if (cmd === 'sources.url.settings.get') {
        return { terms_accepted: false, download_dir: '/downloads' }
      }
      if (cmd === 'components.settings.get') {
        return { data_dir: '/dados', cache_dir: '/cache', cache_limit_bytes: 1e10 }
      }
      if (cmd === 'sources.url.settings.set') return { terms_accepted: true, download_dir: '/downloads' }
      if (cmd === 'components.download') return { path: '/dados/components/bin' }
      return null
    })

    render(envolver(<InstaladorJustInTime recurso="url_import" aoConcluir={aoConcluir} />))

    const btnBaixar = await screen.findByRole('button', { name: /Baixar e continuar/i })
    expect(screen.getByText(/Unlicense/)).toBeInTheDocument()
    expect(screen.getByText(/MIT/)).toBeInTheDocument()
    expect(btnBaixar).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))
    expect(btnBaixar).toBeEnabled()

    await user.click(btnBaixar)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('sources.url.settings.set', {
        terms_accepted: true,
        download_dir: '/downloads',
      })
      expect(chamarMock).toHaveBeenCalledWith('components.download', {
        id: 'yt-dlp',
        confirmed: true,
      })
      expect(chamarMock).toHaveBeenCalledWith('components.download', {
        id: 'deno',
        confirmed: true,
      })
      expect(aoConcluir).toHaveBeenCalledTimes(1)
    })
  })

  it('yunet encadeia components.worker.install -> components.models.download quando worker ausente', async () => {
    const user = userEvent.setup()
    const aoConcluir = vi.fn()
    const ordem: string[] = []
    chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'components.worker.status') return { installed: false, gpu: false }
      if (cmd === 'components.models.manifest') {
        return [
          {
            id: 'yunet',
            label: 'YuNet (reenquadramento)',
            license: 'MIT',
            source_url: 'https://github.com/opencv/opencv_zoo',
            size: 232_589,
            installed: false,
            worker_installed: false,
          },
        ]
      }
      if (cmd === 'components.manifest') return MANIFESTO_PADRAO
      if (cmd === 'components.settings.get') {
        return { data_dir: '/dados', cache_dir: '/cache', cache_limit_bytes: 1e10 }
      }
      if (cmd === 'components.worker.install') {
        ordem.push(`worker:${String(args.confirmed)}`)
        return { handshake: { protocol: 1 } }
      }
      if (cmd === 'components.models.download') {
        ordem.push(`model:${String(args.id)}:${String(args.confirmed)}`)
        return { id: 'yunet' }
      }
      return null
    })

    render(envolver(<InstaladorJustInTime recurso="yunet" aoConcluir={aoConcluir} />))

    const btn = await screen.findByRole('button', { name: /Baixar e continuar/i })
    await user.click(btn)

    await waitFor(() => {
      expect(ordem).toEqual(['worker:true', 'model:yunet:true'])
      expect(aoConcluir).toHaveBeenCalledTimes(1)
    })
  })

  it('tts exibe prohibitedUse.summaryPt, expansão de textEn, desabilita até aceite e cancela com tts.models.cancel', async () => {
    const user = userEvent.setup()
    let resolverDownload!: (v: unknown) => void
    chamarMock.mockImplementation((cmd: string) => {
      if (cmd === 'components.pocket_tts.status') return Promise.resolve({ installed: true, version: '3.3.0' })
      if (cmd === 'tts.catalog') return Promise.resolve(CATALOGO_TTS_BASE)
      if (cmd === 'components.manifest') return Promise.resolve(MANIFESTO_PADRAO)
      if (cmd === 'components.settings.get') {
        return Promise.resolve({ data_dir: '/dados', cache_dir: '/cache', cache_limit_bytes: 1e10 })
      }
      if (cmd === 'tts.models.download') {
        return new Promise((res) => {
          resolverDownload = res
        })
      }
      if (cmd === 'tts.models.cancel') return Promise.resolve({})
      return Promise.resolve(null)
    })

    render(envolver(<InstaladorJustInTime recurso="tts" idioma="pt" aoConcluir={vi.fn()} />))

    expect(
      await screen.findByText(/sem imitação ou clonagem de voz sem consentimento explícito/i),
    ).toBeInTheDocument()
    expect(screen.getByText('Instalado')).toBeInTheDocument()
    expect(screen.getByText(/Prohibited use: Do not clone voices/i)).toBeInTheDocument()

    const btnBaixar = screen.getByRole('button', { name: /Baixar e continuar/i })
    expect(btnBaixar).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))
    expect(btnBaixar).toBeEnabled()

    await user.click(btnBaixar)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('tts.models.download', {
        id: 'portuguese_24l',
        confirmed: true,
        termsAccepted: true,
      })
    })

    act(() => {
      const eventoOutro: EventoProgresso = {
        job: 'deno',
        project: null,
        stage: 'download',
        percentage: 88,
        message: 'Outro download',
        error: null,
      }
      const eventoTts: EventoProgresso = {
        job: 'tts:portuguese_24l',
        project: null,
        stage: 'download',
        percentage: 42,
        message: 'Baixando voz TTS',
        error: null,
      }
      filaTeste.aplicar(eventoOutro)
      filaTeste.aplicar(eventoTts)
    })

    expect(await screen.findByText(/42%/)).toBeInTheDocument()
    expect(screen.queryByText(/88%/)).not.toBeInTheDocument()
    expect(screen.getByText(/Baixando voz TTS/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(chamarMock).toHaveBeenCalledWith('tts.models.cancel', { id: 'portuguese_24l' })
    expect(chamarMock).not.toHaveBeenCalledWith('components.cancel', expect.anything())

    resolverDownload({ id: 'portuguese_24l' })
  })

  it('job_running de deno/yunet cancela com components.cancel { id }', async () => {
    const user = userEvent.setup()
    chamarMock.mockImplementation((cmd: string) => {
      if (cmd === 'components.ytdlp.status') return Promise.resolve({ installed: true, version: '2026.11' })
      if (cmd === 'components.deno.status') return Promise.resolve({ installed: false })
      if (cmd === 'components.manifest') return Promise.resolve(MANIFESTO_PADRAO)
      if (cmd === 'sources.url.settings.get') {
        return Promise.resolve({ terms_accepted: true, download_dir: '/downloads' })
      }
      if (cmd === 'components.settings.get') {
        return Promise.resolve({ data_dir: '/dados', cache_dir: '/cache', cache_limit_bytes: 1e10 })
      }
      if (cmd === 'components.download') return new Promise(() => {})
      if (cmd === 'components.cancel') return Promise.resolve({})
      return Promise.resolve(null)
    })

    render(envolver(<InstaladorJustInTime recurso="url_import" aoConcluir={vi.fn()} />))
    await user.click(await screen.findByRole('button', { name: /Baixar e continuar/i }))

    act(() => {
      filaTeste.aplicar({
        job: 'deno',
        project: null,
        stage: 'download',
        percentage: 55,
        message: 'Baixando deno',
        error: null,
      })
    })

    expect(await screen.findByText(/55%/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(chamarMock).toHaveBeenCalledWith('components.cancel', { id: 'deno' })
  })

  it('error traduz component_integrity (com Reinstalar yt-dlp), hash_mismatch, terms_acceptance_required e unknown_component (#301)', async () => {
    const user = userEvent.setup()

    // 1) component_integrity ao checar status do yt-dlp + hash_mismatch ao reinstalar
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'components.ytdlp.status') throw new ErroCore('component_integrity', 'sha256 mismatch')
      if (cmd === 'components.deno.status') return { installed: true, version: '2.9.8' }
      if (cmd === 'components.manifest') return MANIFESTO_PADRAO
      if (cmd === 'sources.url.settings.get') {
        return { terms_accepted: true, download_dir: '/downloads' }
      }
      if (cmd === 'components.settings.get') {
        return { data_dir: '/dados', cache_dir: '/cache', cache_limit_bytes: 1e10 }
      }
      if (cmd === 'components.download') throw new ErroCore('hash_mismatch', 'bad sha256')
      return null
    })

    const r1 = render(envolver(<InstaladorJustInTime recurso="url_import" aoConcluir={vi.fn()} />))
    const alertaIntegridade = await screen.findByRole('alert')
    expect(alertaIntegridade).toHaveTextContent(
      /O arquivo do yt-dlp não passou na verificação de integridade\. Reinstale para continuar\./i,
    )

    const btnReinstalar = screen.getByRole('button', { name: /Reinstalar yt-dlp/i })
    await user.click(btnReinstalar)

    const alertaHash = await screen.findByRole('alert')
    expect(alertaHash).toHaveTextContent(
      /Falha ao baixar ou verificar o arquivo\. Você pode retomar de onde parou\./i,
    )
    r1.unmount()

    // 2) terms_acceptance_required e unknown_component
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'components.ytdlp.status') return { installed: false }
      if (cmd === 'components.deno.status') return { installed: false }
      if (cmd === 'components.manifest') return MANIFESTO_PADRAO
      if (cmd === 'sources.url.settings.get') {
        return { terms_accepted: true, download_dir: '/downloads' }
      }
      if (cmd === 'components.settings.get') {
        return { data_dir: '/dados', cache_dir: '/cache', cache_limit_bytes: 1e10 }
      }
      if (cmd === 'components.download') throw new ErroCore('unknown_component', 'missing macos')
      return null
    })
    const r2 = render(envolver(<InstaladorJustInTime recurso="url_import" aoConcluir={vi.fn()} />))
    await user.click(await screen.findByRole('button', { name: /Baixar e continuar/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/#301/)
    r2.unmount()

    // 3) Desabilitação com Dica citando #301 quando ausente do manifesto
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'components.ytdlp.status') return { installed: false }
      if (cmd === 'components.deno.status') return { installed: false }
      if (cmd === 'components.manifest') return MANIFESTO_PADRAO.filter((c) => c.id !== 'yt-dlp')
      if (cmd === 'sources.url.settings.get') {
        return { terms_accepted: true, download_dir: '/downloads' }
      }
      if (cmd === 'components.settings.get') {
        return { data_dir: '/dados', cache_dir: '/cache', cache_limit_bytes: 1e10 }
      }
      return null
    })

    const r3 = render(envolver(<InstaladorJustInTime recurso="url_import" aoConcluir={vi.fn()} />))
    const btnMac = await screen.findByRole('button', { name: /Baixar e continuar/i })
    expect(btnMac).toBeDisabled()
    expect(screen.getByText(/#301/)).toBeInTheDocument()
    const gatilhoDica = btnMac.parentElement as HTMLElement
    await user.hover(gatilhoDica)
    expect(await screen.findByText(/aguarda manifesto macOS \(#301\)/i)).toBeInTheDocument()
    r3.unmount()
  })

  it('modo="modal" abre em <Dialogo> acessível e fecha com Esc quando ocioso', async () => {
    const user = userEvent.setup()
    const aoFechar = vi.fn()
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'components.pocket_tts.status') return { installed: false }
      if (cmd === 'tts.catalog') return CATALOGO_TTS_BASE
      if (cmd === 'components.manifest') return MANIFESTO_PADRAO
      if (cmd === 'components.settings.get') {
        return { data_dir: '/dados', cache_dir: '/cache', cache_limit_bytes: 1e10 }
      }
      return null
    })

    render(
      envolver(
        <InstaladorJustInTime
          recurso="tts"
          modo="modal"
          aberto
          aoFechar={aoFechar}
          aoConcluir={vi.fn()}
        />,
      ),
    )

    const dialogo = await screen.findByRole('dialog', { name: /Recurso necessário para esta ação/i })
    expect(within(dialogo).getByText(/Pocket TTS PT-BR/i)).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(aoFechar).toHaveBeenCalled()
  })
})

describe('mock de componentes e progresso em src/lib/core.ts', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('components.download suporta ffmpeg/yt-dlp/uv emitindo core-progress e components.cancel interrompe', async () => {
    const eventos: EventoProgresso[] = []
    const parar = assinarProgressoMock((ev) => eventos.push(ev))

    const resFfmpeg = await coreDispatch<{ path: string }>('components.download', {
      id: 'ffmpeg',
      confirmed: true,
    })
    expect(resFfmpeg.path).toContain('ffmpeg')
    expect(eventos.some((e) => e.job === 'ffmpeg' && e.percentage === 100 && e.stage === 'complete')).toBe(
      true,
    )

    const pYtdlp = coreDispatch('components.download', { id: 'yt-dlp', confirmed: true })
    await coreDispatch('components.cancel', { id: 'yt-dlp' })
    await expect(pYtdlp).rejects.toMatchObject({ code: 'cancelled' })

    parar()
  })

  it('components.worker.install emite etapas 25/45/95/100 e components.ffmpeg.system valida caminho', async () => {
    const percentuais: number[] = []
    const parar = assinarProgressoMock((ev) => {
      if (ev.job === 'worker') percentuais.push(ev.percentage)
    })

    const worker = await coreDispatch<{ handshake: { protocol: number } }>('components.worker.install', {
      confirmed: true,
    })
    expect(worker.handshake.protocol).toBe(1)
    expect(percentuais).toEqual([25, 45, 95, 100])

    await expect(
      coreDispatch('components.ffmpeg.system', { path: '/caminho/invalido/ffmpeg' }),
    ).rejects.toMatchObject({ code: 'invalid_ffmpeg' })

    const sys = await coreDispatch<{ version: string; path: string }>('components.ffmpeg.system', {
      path: '/usr/bin/ffmpeg',
    })
    expect(sys.version).toMatch(/^ffmpeg version /)
    expect(sys.path).toBe('/usr/bin/ffmpeg')

    parar()
  })

  it('tts.models.download emite core-progress e tts.models.cancel interrompe', async () => {
    const pTts = coreDispatch('tts.models.download', {
      id: 'portuguese_24l',
      confirmed: true,
      termsAccepted: true,
    })
    await coreDispatch('tts.models.cancel', { id: 'portuguese_24l' })
    await expect(pTts).rejects.toMatchObject({ code: 'cancelled' })
  })
})
