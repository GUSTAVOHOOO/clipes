import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import { criarStoreFontesProjeto, type FonteProjeto, type StoreFontesProjeto } from '~/stores/fontesProjeto'
import { Fontes } from '~/telas/fontes/Fontes'

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

const FONTES_MISTAS: FonteProjeto[] = [
  {
    id: 1,
    path: '/videos/Live_12_11_final.mp4',
    status: 'available',
    available: true,
    verified: true,
    audio_track: 1,
    origin_url: 'https://youtube.com/watch?v=live1',
    language: 'pt',
    permission: { status: 'granted', who: 'Criador', where: 'Discord', scope: 'cortes e tradução' },
    metadata: {
      format: { duration: '3600.0' },
      streams: [{ index: 0, codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '60/1' }],
    },
  },
  {
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
  },
  {
    id: 3,
    path: '/videos/Live_15_11_cortada.mp4',
    status: 'changed',
    available: false,
    verified: false,
    audio_track: 1,
    origin_url: null,
    language: 'en',
    permission: { status: 'none' },
    metadata: { format: { duration: '1800.0' }, streams: [] },
  },
]

function mockBase({
  fontes = FONTES_MISTAS,
  overrides,
}: {
  fontes?: FonteProjeto[]
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
        return []
      case 'transcription.status': {
        const sid = (args as { source_id: number }).source_id
        if (sid === 1 || sid === 2) {
          return {
            language: 'pt',
            transcript: { id: sid, state: 'complete', resume_us: 3600_000_000, duration_us: 3600_000_000, model: 'whisper-turbo', engine: 'local', words: 12500 },
            job: null,
          }
        }
        return { language: 'en', transcript: null, job: null }
      }
      case 'chat.status':
        return { state: 'none', canFetch: false, intervals: 0, messages: 0, peaks: 0, job: null }
      case 'energy.status':
        return { measured: false, marks: { high: 0, peak: 0 }, job: null }
      case 'channel_profile.get':
        return { videoKind: 'direct', language: 'pt', minUs: 20_000_000, maxUs: 60_000_000, allowedSources: [], narrationVoice: null, directMonetizationAck: false }
      case 'channel_profile.languages':
        return [
          { code: 'pt', name: 'portuguese' },
          { code: 'en', name: 'english' },
          { code: 'es', name: 'spanish' },
        ]
      case 'sources.url.settings.get':
        return { terms_accepted: true, download_dir: '/downloads/Clipes' }
      case 'components.ytdlp.status':
        return { installed: true, version: '2026.11' }
      default:
        return null
    }
  })
}

describe('Tela Fontes (#/projeto/:id/fontes)', () => {
  let store: StoreFontesProjeto

  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => 'demo')
    store = criarStoreFontesProjeto()
    window.history.replaceState(null, '', '/')
    window.location.hash = '#/projeto/demo/fontes'
    delete window.__CLIPES_E2E__
  })

  afterEach(() => {
    delete window.__CLIPES_E2E__
    vi.clearAllMocks()
  })

  it('cobre estados §6: loading, empty, error em role="alert", ready, job_running e partial', async () => {
    // 1) loading sem exibir texto de vazio
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
      envolver(<Fontes projetoId="demo" projetoPath="/projetos/Demo.clipes" sub="fontes" store={store} />),
    )

    expect(
      screen.getByRole('status', { name: /Carregando Fontes do Projeto/i }),
    ).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText(/Nenhuma Fonte importada ainda/i)).not.toBeInTheDocument()
    resolverLista([])
    rLoading.unmount()

    // 2) empty com CTA "Importar primeira Fonte"
    store = criarStoreFontesProjeto()
    mockBase({ fontes: [] })
    const rEmpty = render(
      envolver(<Fontes projetoId="demo" projetoPath="/projetos/Demo.clipes" sub="fontes" store={store} />),
    )
    expect(await screen.findByText('Nenhuma Fonte importada ainda')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Importar primeira Fonte' })).toBeInTheDocument()
    rEmpty.unmount()

    // 3) error em role="alert"
    store = criarStoreFontesProjeto()
    mockBase({
      overrides: {
        'sources.list': () => {
          throw new ErroCore('project_not_open', 'no project')
        },
      },
    })
    const rError = render(
      envolver(<Fontes projetoId="demo" projetoPath="/projetos/Demo.clipes" sub="fontes" store={store} />),
    )
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/Nenhum Projeto está aberto/i)
    rError.unmount()

    // 4) ready + partial + job_running
    store = criarStoreFontesProjeto()
    mockBase({ fontes: FONTES_MISTAS })
    render(
      envolver(<Fontes projetoId="demo" projetoPath="/projetos/Demo.clipes" sub="fontes" store={store} />),
    )

    expect(await screen.findByText('Live_12_11_final.mp4')).toBeInTheDocument()
    expect(screen.getByText(/2 Fontes precisam de verificação ou relocalização no disco/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ver apenas com pendência/i })).toBeInTheDocument()

    act(() => {
      filaTeste.aplicar({
        job: 'source-hash',
        project: 'demo',
        stage: 'hash',
        percentage: 68,
        message: 'Verificando Fonte',
        error: null,
      })
    })
    expect(await screen.findByText(/68%/)).toBeInTheDocument()
  })

  it('Fonte V1 offline mantém Abrir habilitado e relocaliza tratando confirmation_required via ConfirmDialog', async () => {
    const user = userEvent.setup()
    let chamadasRelocate = 0
    mockBase({
      overrides: {
        'sources.relocate': (args) => {
          chamadasRelocate += 1
          const a = args as { confirmed?: boolean; path: string }
          if (!a.confirmed) {
            throw new ErroCore('confirmation_required', 'confirmar sem hash completo')
          }
          return { ...FONTES_MISTAS[1], path: a.path, status: 'available', available: true, verified: true }
        },
      },
    })
    window.__CLIPES_E2E__ = {
      dialogQueue: ['/backup/VOD_09_11_v1.mp4'],
      dialogCalls: [],
    }

    render(
      envolver(<Fontes projetoId="demo" projetoPath="/projetos/Demo.clipes" sub="fontes" store={store} />),
    )

    const cardOffline = (await screen.findByText('VOD_09_11_v1.mp4')).closest('li') as HTMLElement
    expect(within(cardOffline).getByText('Offline')).toBeInTheDocument()
    const btnAbrir = within(cardOffline).getByRole('button', { name: /^Abrir$/i })
    expect(btnAbrir).toBeEnabled()

    await user.click(within(cardOffline).getByRole('button', { name: /Relocalizar arquivo/i }))

    const dlgReloc = await screen.findByRole('dialog', { name: /Relocalizar arquivo/i })
    await user.click(within(dlgReloc).getByRole('button', { name: /Escolher arquivo/i }))
    await user.click(within(dlgReloc).getByRole('button', { name: /Confirmar|Relocalizar/i }))

    const confirmDlg = await screen.findByRole('alertdialog')
    expect(confirmDlg).toHaveTextContent(/mesma Fonte/i)
    await user.click(within(confirmDlg).getByRole('button', { name: /Confirmar relocalização/i }))

    await waitFor(() => {
      expect(chamadasRelocate).toBe(2)
      expect(chamarMock).toHaveBeenCalledWith('sources.relocate', expect.objectContaining({
        project: '/projetos/Demo.clipes',
        id: 2,
        path: '/backup/VOD_09_11_v1.mp4',
        confirmed: true,
      }))
    })
  })

  it('Fonte changed/!verified aciona Verificar identidade tratando confirmation_required e Excluir Fonte cita #295', async () => {
    const user = userEvent.setup()
    let chamadasHash = 0
    mockBase({
      overrides: {
        'sources.hash': (args) => {
          chamadasHash += 1
          const a = args as { confirmed?: boolean }
          if (!a.confirmed) {
            throw new ErroCore('confirmation_required', 'hash divergiu')
          }
          return { verified: true }
        },
        'sources.permission.set': (args) => {
          const a = args as { id: number; permission: FonteProjeto['permission'] }
          return { ...FONTES_MISTAS[2], permission: a.permission }
        },
        'sources.language.set': (args) => {
          const a = args as { id: number; language: string }
          return { ...FONTES_MISTAS[2], language: a.language }
        },
      },
    })

    render(
      envolver(<Fontes projetoId="demo" projetoPath="/projetos/Demo.clipes" sub="fontes" store={store} />),
    )

    const cardChanged = (await screen.findByText('Live_15_11_cortada.mp4')).closest('li') as HTMLElement
    expect(within(cardChanged).getByText('Alterada')).toBeInTheDocument()

    // Botão Excluir Fonte desabilitado com Dica citando #295
    const btnExcluir = within(cardChanged).getByRole('button', { name: /Excluir Fonte/i })
    expect(btnExcluir).toBeDisabled()
    await user.hover(btnExcluir.parentElement as HTMLElement)
    expect(await screen.findByText(/#295/)).toBeInTheDocument()

    // Verificar identidade com confirmation_required
    await user.click(within(cardChanged).getByRole('button', { name: /Verificar identidade/i }))
    const confirmDlg = await screen.findByRole('alertdialog')
    await user.click(within(confirmDlg).getByRole('button', { name: /Confirmar verificação/i }))
    await waitFor(() => {
      expect(chamadasHash).toBe(2)
      expect(chamarMock).toHaveBeenCalledWith('sources.hash', expect.objectContaining({
        project: '/projetos/Demo.clipes',
        id: 3,
        confirmed: true,
      }))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })

  it('edita Permissão de Fonte não transcrita', async () => {
    const user = userEvent.setup()
    mockBase({
      overrides: {
        'sources.permission.set': (args) => {
          const a = args as { id: number; permission: FonteProjeto['permission'] }
          return { ...FONTES_MISTAS[2], permission: a.permission }
        },
      },
    })

    render(
      envolver(<Fontes projetoId="demo" projetoPath="/projetos/Demo.clipes" sub="fontes" store={store} />),
    )

    const cardParaPerm = (await screen.findByText('Live_15_11_cortada.mp4')).closest('li') as HTMLElement
    await user.click(within(cardParaPerm).getByRole('button', { name: /^Permissão$/i }))
    const dlgPerm = await screen.findByRole('dialog', { name: /Editar Permissão/i })
    await user.click(within(dlgPerm).getByRole('radio', { name: /Tenho permissão do criador/i }))
    await user.type(within(dlgPerm).getByLabelText(/Quem autorizou/i), 'Criador Y')
    await user.type(within(dlgPerm).getByLabelText(/Onde foi autorizada/i), 'Email')
    await user.type(within(dlgPerm).getByLabelText(/Escopo/i), 'cortes')
    await user.click(within(dlgPerm).getByRole('button', { name: /Salvar Permissão/i }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('sources.permission.set', {
        project: '/projetos/Demo.clipes',
        id: 3,
        permission: { status: 'granted', who: 'Criador Y', where: 'Email', scope: 'cortes' },
      })
      expect(screen.queryByRole('dialog', { name: /Editar Permissão/i })).not.toBeInTheDocument()
    })
  })

  it('altera Idioma de Fonte não transcrita', async () => {
    const user = userEvent.setup()
    mockBase({
      overrides: {
        'sources.language.set': (args) => {
          const a = args as { id: number; language: string }
          return { ...FONTES_MISTAS[2], language: a.language }
        },
      },
    })

    render(
      envolver(<Fontes projetoId="demo" projetoPath="/projetos/Demo.clipes" sub="fontes" store={store} />),
    )

    const cardParaIdioma = (await screen.findByText('Live_15_11_cortada.mp4')).closest('li') as HTMLElement
    await user.click(within(cardParaIdioma).getByRole('button', { name: /^Idioma$/i }))
    const dlgIdioma = await screen.findByRole('dialog', { name: /Alterar idioma/i })
    await user.click(within(dlgIdioma).getByRole('combobox', { name: /Idioma falado/i }))
    await user.click(await screen.findByRole('option', { name: /Español/i }))
    await user.click(within(dlgIdioma).getByRole('button', { name: /Salvar idioma/i }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('sources.language.set', {
        project: '/projetos/Demo.clipes',
        id: 3,
        language: 'es',
      })
    })
  })

  it('seleciona 2 Fontes, habilita Processar 2 Fontes em lote e navega para ?sub=lotes', async () => {
    const user = userEvent.setup()
    mockBase({ fontes: FONTES_MISTAS })

    render(
      envolver(<Fontes projetoId="demo" projetoPath="/projetos/Demo.clipes" sub="fontes" store={store} />),
    )

    const chk1 = await screen.findByRole('checkbox', { name: /Selecionar Live_12_11_final\.mp4 para lote/i })
    const chk2 = screen.getByRole('checkbox', { name: /Selecionar VOD_09_11_v1\.mp4 para lote/i })

    await user.click(chk1)
    await user.click(chk2)

    const btnLote = screen.getByRole('button', { name: 'Processar 2 Fontes em lote' })
    expect(btnLote).toBeEnabled()
    await user.click(btnLote)

    expect(store.estado().selecionadasParaLote).toEqual([1, 2])
    expect(window.location.hash).toBe('#/projeto/demo/fontes?sub=lotes')
  })

  it('Ctrl+F foca busca global FTS5, chama transcription.search e clicar no resultado navega para ?frase=&row=', async () => {
    const user = userEvent.setup()
    mockBase({
      fontes: FONTES_MISTAS,
      overrides: {
        'transcription.search': () => [
          {
            transcript_id: 1,
            source_id: 1,
            source: 'Live_12_11_final.mp4',
            sentence_id: 142,
            start_us: 142_000_000,
            end_us: 143_000_000,
            row: 142,
            snippet: [
              { text: 'Presta atenção nessa ', match: false },
              { text: 'jogada', match: true },
              { text: ' aqui', match: false },
            ],
          },
        ],
      },
    })

    render(
      envolver(<Fontes projetoId="demo" projetoPath="/projetos/Demo.clipes" sub="fontes" store={store} />),
    )

    await screen.findByText('Live_12_11_final.mp4')

    await user.keyboard('{Control>}f{/Control}')
    const campoBusca = screen.getByRole('searchbox', {
      name: /Buscar falas em todas as Transcrições do Projeto/i,
    })
    expect(campoBusca).toHaveFocus()

    await user.type(campoBusca, 'jogada{Enter}')

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('transcription.search', {
        query: 'jogada',
        limit: 50,
      })
    })

    const gaveta = await screen.findByRole('complementary', { name: /Resultados da busca/i })
    expect(within(gaveta).getByText('jogada').tagName.toLowerCase()).toBe('mark')

    await user.click(within(gaveta).getByRole('button', { name: /Live_12_11_final\.mp4/i }))
    expect(window.location.hash).toBe('#/projeto/demo/fontes/1?frase=142&row=142')
  })

  it('renderiza <ListaVirtual> (role="listbox") quando há mais de 30 Fontes', async () => {
    const muitas: FonteProjeto[] = Array.from({ length: 32 }, (_, idx) => ({
      id: idx + 1,
      path: `/videos/Live_${idx + 1}.mp4`,
      status: 'available',
      available: true,
      verified: true,
      audio_track: 1,
      origin_url: null,
      language: 'pt',
      permission: { status: 'none' },
      metadata: { format: { duration: '600.0' }, streams: [] },
    }))
    mockBase({ fontes: muitas })

    render(
      envolver(<Fontes projetoId="demo" projetoPath="/projetos/Demo.clipes" sub="fontes" store={store} />),
    )

    const listbox = await screen.findByRole('listbox', { name: /Fontes do Projeto/i })
    expect(listbox).toBeInTheDocument()
  })

  it('exibe exatamente um <h1> visível "Fontes e Transcrição" (UI-10 / WCAG)', async () => {
    mockBase({ fontes: FONTES_MISTAS })

    render(
      envolver(<Fontes projetoId="demo" projetoPath="/projetos/Demo.clipes" sub="fontes" store={store} />),
    )

    const h1 = await screen.findByRole('heading', { level: 1, name: 'Fontes e Transcrição' })
    expect(h1).toBeVisible()
    expect(document.querySelectorAll('h1')).toHaveLength(1)
  })
})
