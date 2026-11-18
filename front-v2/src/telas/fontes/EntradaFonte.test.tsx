import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import { EntradaFonte } from '~/telas/fontes/EntradaFonte'

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

const INSPECT_OBS = {
  format: { duration: '5400.0' },
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '60/1' },
    { index: 1, codec_type: 'audio', codec_name: 'aac', tags: { title: 'Mic OBS', language: 'por' } },
    { index: 2, codec_type: 'audio', codec_name: 'aac', tags: { title: 'Jogo', language: 'por' } },
    { index: 3, codec_type: 'audio', codec_name: 'aac', tags: { title: 'Discord', language: 'eng' } },
  ],
}

const MANIFESTO_COMPLETO = [
  { id: 'yt-dlp', version: '2026.11', size: 12_000_000, license: 'Unlicense', source_url: 'https://github.com/yt-dlp/yt-dlp' },
  { id: 'deno', version: '2.9.8', size: 42_917_472, license: 'MIT', source_url: 'https://github.com/denoland/deno' },
]

function configurarMocksPadrao(overrides?: Partial<Record<string, (...args: unknown[]) => unknown>>) {
  chamarMock.mockImplementation(async (cmd: string, args: unknown) => {
    if (overrides && Object.hasOwn(overrides, cmd)) {
      return overrides[cmd]!(args)
    }
    switch (cmd) {
      case 'channel_profile.get':
        return { videoKind: 'direct', language: 'en', minUs: 20_000_000, maxUs: 60_000_000, allowedSources: [], narrationVoice: null, directMonetizationAck: false }
      case 'channel_profile.languages':
        return [
          { code: 'pt', name: 'portuguese' },
          { code: 'en', name: 'english' },
          { code: 'es', name: 'spanish' },
        ]
      case 'sources.url.settings.get':
        return { terms_accepted: true, download_dir: '/downloads/Clipes' }
      case 'sources.url.settings.set':
        return { terms_accepted: true, download_dir: '/downloads/Clipes', ...(args as object) }
      case 'components.ytdlp.status':
        return { installed: true, version: '2026.11' }
      case 'components.deno.status':
        return { installed: true, version: '2.9.8' }
      case 'components.manifest':
        return MANIFESTO_COMPLETO
      case 'components.settings.get':
        return { data_dir: '/dados', cache_dir: '/cache', cache_limit_bytes: 1e10 }
      case 'sources.inspect':
        return INSPECT_OBS
      case 'sources.import': {
        const a = args as Record<string, unknown>
        return {
          id: 10,
          path: a.path,
          status: 'available',
          available: true,
          verified: Boolean(a.copy),
          audio_track: a.audio_track,
          origin_url: a.origin_url ?? null,
          language: a.language,
          permission: a.permission,
          metadata: INSPECT_OBS,
        }
      }
      case 'sources.hash':
        return { verified: true }
      default:
        return null
    }
  })
}

describe('<EntradaFonte>', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => null)
    delete window.__CLIPES_E2E__
  })

  afterEach(() => {
    delete window.__CLIPES_E2E__
    vi.clearAllMocks()
  })

  it('alterna entre Arquivo local e URL (VOD) via radiogroup', async () => {
    const user = userEvent.setup()
    configurarMocksPadrao()

    render(
      envolver(
        <EntradaFonte
          projetoPath="/projetos/Canal.clipes"
          copiaEmAndamento={false}
          aoImportar={vi.fn()}
          aoMudarCopiaAtiva={vi.fn()}
        />,
      ),
    )

    const grupo = screen.getByRole('radiogroup', { name: /Modo de entrada/i })
    const radioLocal = within(grupo).getByRole('radio', { name: /Arquivo local/i })
    const radioUrl = within(grupo).getByRole('radio', { name: /URL \(VOD\)/i })

    expect(radioLocal).toHaveAttribute('aria-checked', 'true')
    expect(radioUrl).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('textbox', { name: /Arquivo de vídeo/i })).toBeInTheDocument()

    await user.click(radioUrl)
    expect(radioUrl).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('textbox', { name: /URL do vídeo/i })).toBeInTheDocument()
  })

  it('escolher arquivo chama sources.inspect, lista faixas multipista do OBS e pré-seleciona idioma de channel_profile.get', async () => {
    const user = userEvent.setup()
    configurarMocksPadrao()
    window.__CLIPES_E2E__ = {
      dialogQueue: ['/videos/live_obs.mkv'],
      dialogCalls: [],
    }

    render(
      envolver(
        <EntradaFonte
          projetoPath="/projetos/Canal.clipes"
          copiaEmAndamento={false}
          aoImportar={vi.fn()}
          aoMudarCopiaAtiva={vi.fn()}
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: /Escolher arquivo/i }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('sources.inspect', { path: '/videos/live_obs.mkv' })
    })

    expect(await screen.findByText(/01:30:00/)).toBeInTheDocument()
    expect(screen.getByText(/1920×1080/)).toBeInTheDocument()

    const selectFaixa = screen.getByRole('combobox', { name: /Faixa de áudio/i })
    expect(selectFaixa).toHaveTextContent(/1 · Mic OBS/)
    await user.click(selectFaixa)
    expect(await screen.findByRole('option', { name: /2 · Jogo/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /3 · Discord/i })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /2 · Jogo/i }))

    const selectIdioma = screen.getByRole('combobox', { name: /Idioma falado/i })
    expect(selectIdioma).toHaveTextContent(/English|Inglês/i)
  })

  it('bloqueia Importar Fonte quando Permissão granted tem campos vazios e dispara import + hash após preencher', async () => {
    const user = userEvent.setup()
    const aoImportar = vi.fn()
    configurarMocksPadrao()
    window.__CLIPES_E2E__ = {
      dialogQueue: ['/videos/live_obs.mkv'],
      dialogCalls: [],
    }

    render(
      envolver(
        <EntradaFonte
          projetoPath="/projetos/Canal.clipes"
          copiaEmAndamento={false}
          aoImportar={aoImportar}
          aoMudarCopiaAtiva={vi.fn()}
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: /Escolher arquivo/i }))
    const btnImportar = await screen.findByRole('button', { name: 'Importar Fonte' })

    // Seleciona "Tenho permissão do criador" sem preencher campos
    await user.click(screen.getByRole('radio', { name: /Tenho permissão do criador/i }))
    expect(btnImportar).toBeDisabled()

    await user.type(screen.getByLabelText(/Quem autorizou/i), 'Streamer X')
    expect(btnImportar).toBeDisabled()

    await user.type(screen.getByLabelText(/Onde foi autorizada/i), 'Discord')
    await user.type(screen.getByLabelText(/Escopo/i), 'cortes e tradução')
    expect(btnImportar).toBeEnabled()

    await user.click(btnImportar)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('sources.import', {
        project: '/projetos/Canal.clipes',
        path: '/videos/live_obs.mkv',
        audio_track: 1,
        language: 'en',
        copy: false,
        origin_url: null,
        permission: {
          status: 'granted',
          who: 'Streamer X',
          where: 'Discord',
          scope: 'cortes e tradução',
        },
      })
      expect(chamarMock).toHaveBeenCalledWith('sources.hash', {
        project: '/projetos/Canal.clipes',
        id: 10,
        job: 'source-hash-10',
      })
      expect(aoImportar).toHaveBeenCalled()
    })
  })

  it('no modo URL com terms_accepted: false, abre ConfirmDialog de Termos antes de salvar e baixar', async () => {
    const user = userEvent.setup()
    configurarMocksPadrao({
      'sources.url.settings.get': () => ({ terms_accepted: false, download_dir: '/downloads/Clipes' }),
      'sources.url.download': () => ({ path: '/downloads/Clipes/vod.mp4', url: 'https://youtube.com/watch?v=123' }),
    })

    render(
      envolver(
        <EntradaFonte
          projetoPath="/projetos/Canal.clipes"
          copiaEmAndamento={false}
          aoImportar={vi.fn()}
          aoMudarCopiaAtiva={vi.fn()}
        />,
      ),
    )

    await user.click(screen.getByRole('radio', { name: /URL \(VOD\)/i }))
    const campoUrl = await screen.findByRole('textbox', { name: /URL do vídeo/i })
    await user.type(campoUrl, 'https://youtube.com/watch?v=123')
    await user.click(screen.getByRole('button', { name: 'Baixar por URL' }))

    const dialogoTermos = await screen.findByRole('alertdialog')
    expect(dialogoTermos).toHaveTextContent(/Termos do YouTube/i)
    expect(within(dialogoTermos).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    expect(chamarMock).not.toHaveBeenCalledWith('sources.url.download', expect.anything())

    await user.click(within(dialogoTermos).getByRole('button', { name: /Aceitar e baixar/i }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('sources.url.settings.set', {
        terms_accepted: true,
        download_dir: '/downloads/Clipes',
      })
      expect(chamarMock).toHaveBeenCalledWith('sources.url.download', expect.objectContaining({
        project: '/projetos/Canal.clipes',
        url: 'https://youtube.com/watch?v=123',
      }))
      expect(chamarMock).toHaveBeenCalledWith('sources.inspect', {
        path: '/downloads/Clipes/vod.mp4',
      })
    })

    // Após download por URL, checkbox de copiar vídeo fica oculto
    expect(screen.queryByRole('checkbox', { name: /Copiar vídeo para dentro do Projeto/i })).not.toBeInTheDocument()
  })

  it('exibe InstaladorJustInTime com trava #301 quando yt-dlp falta no manifesto e trata js_runtime_missing e age_restricted', async () => {
    const user = userEvent.setup()

    // 1) yt-dlp ausente e fora do manifesto (#301)
    configurarMocksPadrao({
      'components.ytdlp.status': () => ({ installed: false }),
      'components.deno.status': () => ({ installed: false }),
      'components.manifest': () => MANIFESTO_COMPLETO.filter((i) => i.id !== 'yt-dlp'),
    })

    const r1 = render(
      envolver(
        <EntradaFonte
          projetoPath="/projetos/Canal.clipes"
          copiaEmAndamento={false}
          aoImportar={vi.fn()}
          aoMudarCopiaAtiva={vi.fn()}
        />,
      ),
    )

    await user.click(screen.getByRole('radio', { name: /URL \(VOD\)/i }))
    const btnInstalar = await screen.findByRole('button', { name: /Baixar e continuar/i })
    expect(btnInstalar).toBeDisabled()
    expect(screen.getByText(/#301/)).toBeInTheDocument()
    r1.unmount()

    // 2) js_runtime_missing e age_restricted
    configurarMocksPadrao({
      'components.deno.status': () => ({ installed: false }),
      'sources.url.download': (args) => {
        const u = (args as { url: string }).url
        if (u.includes('js-test')) throw new ErroCore('js_runtime_missing', 'deno required')
        throw new ErroCore('age_restricted', '18+')
      },
    })

    render(
      envolver(
        <EntradaFonte
          projetoPath="/projetos/Canal.clipes"
          copiaEmAndamento={false}
          aoImportar={vi.fn()}
          aoMudarCopiaAtiva={vi.fn()}
        />,
      ),
    )

    await user.click(screen.getByRole('radio', { name: /URL \(VOD\)/i }))
    const campoUrl = await screen.findByRole('textbox', { name: /URL do vídeo/i })
    await user.type(campoUrl, 'https://youtube.com/watch?v=js-test')
    await user.click(screen.getByRole('button', { name: 'Baixar por URL' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/deno/i)
    expect(await screen.findByRole('region', { name: /Instalação necessária/i })).toBeInTheDocument()

    await user.clear(campoUrl)
    await user.type(campoUrl, 'https://youtube.com/watch?v=age-test')
    await user.click(screen.getByRole('button', { name: 'Baixar por URL' }))

    const alertaIdade = await screen.findByRole('alert')
    expect(alertaIdade).toHaveTextContent(/restrição de idade/i)
    await user.click(within(alertaIdade).getByRole('button', { name: 'Importar arquivo local' }))

    expect(
      within(screen.getByRole('radiogroup', { name: /Modo de entrada/i })).getByRole('radio', {
        name: /Arquivo local/i,
      }),
    ).toHaveAttribute('aria-checked', 'true')
  })

  it('cancela download URL com sources.url.cancel e aplica trava de cópia simultânea #307', async () => {
    const user = userEvent.setup()
    let rejeitarDownload!: (e: unknown) => void
    let jobEnviado = ''

    configurarMocksPadrao({
      'sources.url.download': (args) => {
        jobEnviado = (args as { job: string }).job
        return new Promise((_res, rej) => {
          rejeitarDownload = rej
        })
      },
      'sources.url.cancel': () => ({}),
    })

    const r1 = render(
      envolver(
        <EntradaFonte
          projetoPath="/projetos/Canal.clipes"
          copiaEmAndamento={false}
          aoImportar={vi.fn()}
          aoMudarCopiaAtiva={vi.fn()}
        />,
      ),
    )

    await user.click(screen.getByRole('radio', { name: /URL \(VOD\)/i }))
    await user.type(await screen.findByRole('textbox', { name: /URL do vídeo/i }), 'https://youtube.com/watch?v=live')
    await user.click(screen.getByRole('button', { name: 'Baixar por URL' }))

    await waitFor(() => expect(jobEnviado).toBeTruthy())
    act(() => {
      filaTeste.aplicar({
        job: jobEnviado,
        project: null,
        stage: 'download',
        percentage: 42,
        message: 'Baixando Fonte',
        error: null,
      })
    })

    expect(await screen.findByText(/42%/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Cancelar download/i }))
    expect(chamarMock).toHaveBeenCalledWith('sources.url.cancel', { job: jobEnviado })
    rejeitarDownload(new ErroCore('cancelled', 'cancelado'))
    r1.unmount()

    // Trava #307: copiaEmAndamento: true + copy: true desabilita Importar Fonte com Dica citando #307
    configurarMocksPadrao()
    window.__CLIPES_E2E__ = {
      dialogQueue: ['/videos/outra_live.mkv'],
      dialogCalls: [],
    }

    render(
      envolver(
        <EntradaFonte
          projetoPath="/projetos/Canal.clipes"
          copiaEmAndamento
          aoImportar={vi.fn()}
          aoMudarCopiaAtiva={vi.fn()}
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: /Escolher arquivo/i }))
    const chkCopiar = await screen.findByRole('checkbox', { name: /Copiar vídeo para dentro do Projeto/i })
    await user.click(chkCopiar)

    const btnImportar = screen.getByRole('button', { name: 'Importar Fonte' })
    expect(btnImportar).toBeDisabled()
    await user.hover(btnImportar.parentElement as HTMLElement)
    expect(await screen.findByText(/#307/)).toBeInTheDocument()
  })
})
