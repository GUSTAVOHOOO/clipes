import { ProvedorDicas, ProvedorToast } from '@ds'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import { Shell } from '~/shell/Shell'
import { criarStoreFontesProjeto, type FonteProjeto } from '~/stores/fontesProjeto'
import { ContextoCorteConectado } from '~/telas/corte/ContextoCorteConectado'
import { EmpacotarCorte } from '~/telas/corte/empacotar/EmpacotarCorte'

const chamarMock = vi.fn()
let filaTeste: Fila = criarFila(() => 'demo')

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return { ...atual, chamar: (...args: unknown[]) => chamarMock(...args) }
})

vi.mock('~/core/progresso', async () => {
  const atual = await vi.importActual<typeof import('~/core/progresso')>('~/core/progresso')
  return { ...atual, useFila: () => atual.useFila(filaTeste) }
})

vi.mock('~/telas/corte/empacotar/dialogosNativos', () => ({
  salvarArquivo: vi.fn().mockResolvedValue(null),
  copiarTexto: vi.fn(),
}))

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => {}
  if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => []
})

const FONTES: FonteProjeto[] = [
  {
    id: 4,
    path: '/videos/Live.mp4',
    status: 'available',
    available: true,
    verified: true,
    audio_track: 1,
    origin_url: null,
    language: 'pt',
    permission: { status: 'granted', who: 'Criador', where: 'YouTube', scope: 'cortes' },
  },
  {
    id: 2,
    path: '/videos/Offline.mp4',
    status: 'offline',
    available: false,
    verified: false,
    audio_track: 1,
    origin_url: null,
    language: 'pt',
    permission: { status: 'none' },
  },
]

const CREDITO = 'Crédito: vídeo original de Criador.'

type Overrides = {
  packagingGet?: () => unknown
  extra?: (cmd: string, args: Record<string, unknown>) => unknown
}

function docPacote(comFicha: boolean, extra?: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    revision: 1,
    detectedLanguage: 'pt-BR',
    languageRequired: false,
    current: comFicha
      ? {
          generation: 1,
          language: 'pt-BR',
          edited: false,
          title: 'Como o streamer reagiu ao susto mais inesperado da live',
          description: 'Resumo do Corte.',
          tags: ['live'],
          hashtags: ['#live'],
          fullDescription: `Resumo do Corte.\n\n${CREDITO}`,
        }
      : null,
    credit: { text: CREDITO, warning: null },
    chapters: {
      applicable: false,
      status: 'not_transformed',
      canGenerate: false,
      count: 0,
      block: null,
      hasDelimiters: false,
      generationWarning: null,
      validationErrors: [],
    },
    job: null,
    limits: { titleChars: 100, descriptionBytes: 5000, tagsChars: 500, tags: 30, tagChars: 60, hashtags: 15 },
    source: 4,
    generations: [],
    ...extra,
  }
}

function configurarMocks(o: Overrides = {}) {
  chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    const extra = o.extra?.(cmd, args)
    if (extra !== undefined) return extra
    switch (cmd) {
      case 'projects.current':
        return { id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes', warning: null }
      case 'projects.recent':
        return []
      case 'projects.local_only.get':
        return { enabled: false }
      case 'sources.list':
        return FONTES
      case 'selection.list':
        if (args.source_id === 4) return [{ id: 2, videoKind: 'transformed', state: 'completed', revision: 1, revisions: [1] }, { id: 1, videoKind: 'direct', state: 'completed', revision: 1, revisions: [1] }]
        if (args.source_id === 2) return [{ id: 3, videoKind: 'transformed', state: 'completed', revision: 1, revisions: [1] }]
        return []
      case 'selection.get':
        if (args.run === 1) {
          return {
            run: { id: 1, transcriptId: 4, videoKind: 'direct', revision: 1, revisions: [1] },
            windows: [],
            candidates: [{ id: 102, startId: 40, endId: 41, startUs: 390_000_000, endUs: 410_000_000, title: 'Corte direto' }],
          }
        }
        if (args.run === 2) {
          return {
            run: { id: 2, transcriptId: 4, videoKind: 'transformed', revision: 1, revisions: [1] },
            windows: [],
            candidates: [{ id: 201, startId: 10, endId: 14, startUs: 90_000_000, endUs: 140_000_000, title: 'A virada do jogo' }],
          }
        }
        return {
          run: { id: 3, transcriptId: 2, videoKind: 'transformed', revision: 1, revisions: [1] },
          windows: [],
          candidates: [{ id: 301, startId: 10, endId: 14, startUs: 90_000_000, endUs: 140_000_000, title: 'Corte offline V1' }],
        }
      case 'selection.review':
        if (args.run === 1) return { run: 1, canUndo: false, items: [{ candidate: 102, status: 'approved', adjusted: false, videoKind: 'direct', startId: 40, endId: 41, startUs: 390_000_000, endUs: 410_000_000 }] }
        if (args.run === 2) return { run: 2, canUndo: false, items: [{ candidate: 201, status: 'approved', adjusted: false, videoKind: 'transformed', startId: 10, endId: 14, startUs: 90_000_000, endUs: 140_000_000 }] }
        return { run: 3, canUndo: false, items: [{ candidate: 301, status: 'approved', adjusted: false, videoKind: 'transformed', startId: 10, endId: 14, startUs: 90_000_000, endUs: 140_000_000 }] }
      case 'thumbnail.get':
        return {
          current: { instantUs: args.candidate === 102 ? 395_000_000 : 95_000_000, origin: 'ai', why: 'Reação' },
          history: [],
          job: null,
          cut: args.candidate === 102 ? { startUs: 390_000_000, endUs: 410_000_000 } : { startUs: 90_000_000, endUs: 140_000_000 },
          suggestions: [],
          choices: [],
          maxWhyChars: 200,
        }
      case 'packaging.get':
        return o.packagingGet ? o.packagingGet() : docPacote(true)
      case 'packaging.edit':
        return docPacote(true)
      case 'guardrails.check':
        return {
          scope: 'single',
          needsDirectNotice: false,
          videoKind: (args.candidate_id ?? args.candidate) === 102 ? 'direct' : 'transformed',
          over60s: false,
          permission: { status: 'granted', who: 'Criador', where: 'YouTube' },
          script: { applicable: true, approved: true, pendingBlocks: 0 },
          narration: { applicable: true, hasTts: false, voices: [], freezeTailUs: 0, longFreezeTail: false },
          audio: { unverifiedCount: 0 },
        }
      case 'provider.profiles.list':
        return { profiles: [] }
      case 'assistant.tasks':
        return { tasks: [], default: null }
      case 'jobs.budget.get':
        return { limitMicroUsd: 1_000_000, spentMicroUsd: 0, remainingMicroUsd: 1_000_000, paused: false }
      case 'proxy.request':
        return { state: 'ready', key: 'abc', job: null, progress: 100 }
      case 'proxy.status':
        return { state: 'ready', key: 'abc', job: null, progress: 100 }
      case 'jobs.list':
        return []
      default:
        return {}
    }
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

function renderizar(corteId: string, hashExtra = '') {
  window.location.hash = `#/projeto/demo/corte/${corteId}/empacotar${hashExtra}`
  return render(
    envolver(
      <EmpacotarCorte
        projetoId="demo"
        projetoPath="/projetos/Demo.clipes"
        corteId={corteId}
        storeFontes={criarStoreFontesProjeto()}
        fila={filaTeste}
      />,
    ),
  )
}

describe('Tela EmpacotarCorte (#/projeto/:id/corte/:corteId/empacotar)', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    localStorage.clear()
    filaTeste = criarFila(() => 'demo')
    window.innerWidth = 1366
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
  })

  it('guardas: avulso-* redireciona para /editar e corteId ausente para /cortes', async () => {
    configurarMocks()
    const { unmount } = renderizar('avulso-4-10-14')
    await waitFor(() =>
      expect(window.location.hash).toBe('#/projeto/demo/corte/avulso-4-10-14/editar'),
    )
    unmount()
    renderizar('999')
    await waitFor(() => expect(window.location.hash).toBe('#/projeto/demo/cortes'))
  })

  it('estado loading (?estado=carregando) mostra esqueleto acessível', async () => {
    configurarMocks()
    renderizar('201', '?estado=carregando')
    expect(await screen.findByRole('status', { name: /Carregando Empacotamento/ })).toBeInTheDocument()
  })

  it('estado empty (?estado=vazio) mostra capa vazia e CTA "Sugerir Empacotamento"', async () => {
    configurarMocks()
    renderizar('201', '?estado=vazio')
    expect(await screen.findByText('Nenhum momento de capa escolhido ainda.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sugerir Empacotamento' })).toBeInTheDocument()
  })

  it('estado error mostra export_glyph_missing e local_only_violation em role="alert"', async () => {
    configurarMocks({
      packagingGet: () => {
        throw new ErroCore('export_glyph_missing', 'glifo')
      },
    })
    const { unmount } = renderizar('201')
    expect(await screen.findByRole('alert')).toHaveTextContent(/fonte da legenda não possui alguns caracteres/)
    unmount()

    configurarMocks({
      packagingGet: () => {
        throw new ErroCore('local_only_violation', 'veto')
      },
    })
    renderizar('201')
    expect(await screen.findByRole('alert')).toHaveTextContent(/Somente local/)
  })

  it('estado ready carrega capa e ficha de Corte V1 existente', async () => {
    configurarMocks()
    renderizar('201')
    expect(await screen.findByRole('textbox', { name: 'Título' })).toHaveValue(
      'Como o streamer reagiu ao susto mais inesperado da live',
    )
    expect(screen.getByRole('slider', { name: 'Instante da capa' })).toBeInTheDocument()
    expect(screen.getByText('Sugerido pelo Provedor')).toBeInTheDocument()
  })

  it('estado job_running mostra progresso da sugestão sem travar a edição', async () => {
    configurarMocks({
      packagingGet: () => docPacote(true, { job: { id: 9, state: 'running', code: null } }),
    })
    renderizar('201')
    expect(await screen.findByText('Sugerindo Empacotamento…')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Título' })).toBeEnabled()
  })

  it('estado partial com Fonte offline (SQLite) mantém a Ficha editável e bloqueia capa/exportação', async () => {
    configurarMocks()
    renderizar('301')
    const titulo = await screen.findByRole('textbox', { name: 'Título' })
    expect(titulo).toBeEnabled()
    expect(screen.getAllByText('Fonte offline').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Relocalizar Fonte' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar capa (PNG)' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Exportar vídeo (MP4)' })).toBeDisabled()
  })

  it('Ctrl+S chama packaging.edit e Ctrl+E abre o diálogo de exportação', async () => {
    const user = userEvent.setup()
    configurarMocks()
    renderizar('201')
    const titulo = await screen.findByRole('textbox', { name: 'Título' })
    await user.type(titulo, '!')
    await user.keyboard('{Control>}s{/Control}')
    await waitFor(() =>
      expect(chamarMock).toHaveBeenCalledWith('packaging.edit', expect.objectContaining({ candidate: 201 })),
    )
    await user.click(document.body)
    await user.keyboard('{Control>}e{/Control}')
    expect(await screen.findByText('Exportar Corte em MP4 (1080×1920)')).toBeInTheDocument()
  })

  it('Espaço e ←/→ controlam o preview só fora de campos de texto', async () => {
    const user = userEvent.setup()
    configurarMocks()
    renderizar('201')
    const titulo = await screen.findByRole('textbox', { name: 'Título' })
    const slider = await screen.findByRole('slider', { name: 'Instante da capa' })
    const inicial = Number(slider.getAttribute('aria-valuenow'))

    // dentro do campo de texto: Espaço não reproduz e setas não movem o scrubber
    await user.click(titulo)
    await user.keyboard(' ')
    await user.keyboard('{ArrowRight}')
    expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument()
    expect(Number(screen.getByRole('slider', { name: 'Instante da capa' }).getAttribute('aria-valuenow'))).toBe(inicial)

    // fora dos campos: seta direita avança um quadro e Espaço alterna reprodução
    await user.click(document.body)
    await user.keyboard('{ArrowRight}')
    await waitFor(() =>
      expect(
        Number(screen.getByRole('slider', { name: 'Instante da capa' }).getAttribute('aria-valuenow')),
      ).toBeGreaterThan(inicial),
    )
    await user.keyboard(' ')
    expect(await screen.findByRole('button', { name: 'Pausar' })).toBeInTheDocument()
    await user.keyboard(' ')
    expect(await screen.findByRole('button', { name: 'Reproduzir' })).toBeInTheDocument()
  })

  it('respeita WCAG 2.1.4: com teclas únicas desligadas, Espaço não reproduz', async () => {
    const user = userEvent.setup()
    localStorage.setItem('clipes.preferencias.v1', JSON.stringify({ teclasUnicas: false }))
    configurarMocks()
    renderizar('201')
    await screen.findByRole('slider', { name: 'Instante da capa' })
    await user.click(document.body)
    await user.keyboard(' ')
    expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument()
  })

  it('F6 e Shift+F6 ciclam entre as colunas Capa e Ficha', async () => {
    configurarMocks()
    renderizar('201')
    await screen.findByRole('textbox', { name: 'Título' })
    const capa = document.querySelector<HTMLElement>('[data-regiao="empacotar-capa"]')!
    const ficha = document.querySelector<HTMLElement>('[data-regiao="empacotar-ficha"]')!
    expect(capa).toBeTruthy()
    expect(ficha).toBeTruthy()

    capa.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
    fireEvent.keyDown(window, { key: 'F6' })
    await waitFor(() => expect(ficha.contains(document.activeElement)).toBe(true))
    fireEvent.keyDown(window, { key: 'F6', shiftKey: true })
    await waitFor(() => expect(capa.contains(document.activeElement)).toBe(true))
  })

  it('UI-100 / UI-101 / UI-103: F6 inclui contexto e fila, exatamente 1 .bg-sinal e sem salto de heading', async () => {
    configurarMocks()
    window.location.hash = '#/projeto/demo/corte/201/empacotar?run=2'

    render(
      envolver(
        <Shell
          projeto={{ id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }}
          rota={{ tela: 'corte', projeto: 'demo', corte: '201', aba: 'empacotar', run: '2' }}
          semPaddingConteudo
          meio={
            <ContextoCorteConectado
              projetoId="demo"
              corteId="201"
              subAbaAtiva="empacotar"
              runId="2"
              fila={filaTeste}
            />
          }
          fila={filaTeste}
        >
          <EmpacotarCorte
            projetoId="demo"
            projetoPath="/projetos/Demo.clipes"
            corteId="201"
            runId="2"
            storeFontes={criarStoreFontesProjeto()}
            fila={filaTeste}
          />
        </Shell>,
      ),
    )

    expect(await screen.findByRole('textbox', { name: 'Título' })).toBeInTheDocument()

    // UI-101: exatamente 1 botão bg-sinal ("Exportar Corte")
    expect(document.querySelectorAll('button.bg-sinal')).toHaveLength(1)

    // UI-103: h1 seguido de h2 antes de h3
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4')).map((h) =>
      Number(h.tagName[1]),
    )
    expect(headings.filter((l) => l === 1)).toHaveLength(1)
    for (let i = 1; i < headings.length; i += 1) {
      expect(headings[i] - headings[i - 1]).toBeLessThanOrEqual(1)
    }

    // UI-100: F6 inclui contexto e fila aberta (Ctrl+J)
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    const filaRegiao = await screen.findByRole('complementary', { name: 'Fila de Jobs' })
    const topo = document.querySelector('[data-regiao="topo"]')!
    const contexto = document.querySelector('[data-regiao="contexto"]')!
    const capa = document.querySelector('[data-regiao="empacotar-capa"]')!
    const ficha = document.querySelector('[data-regiao="empacotar-ficha"]')!
    const rodape = document.querySelector('[data-regiao="rodape"]')!

    topo.querySelector<HTMLElement>('button')?.focus()
    fireEvent.keyDown(window, { key: 'F6' })
    expect(contexto.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(capa.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(ficha.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(filaRegiao.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(rodape.contains(document.activeElement)).toBe(true)
  })

  it('UI-101 / UI-104: ?estado=vazio mesmo com selection.list vazio e fontes[0] offline não exibe Fonte offline e tem 1 .bg-sinal', async () => {
    configurarMocks({
      extra: (cmd) => {
        if (cmd === 'sources.list') return [FONTES[1], FONTES[0]]
        if (cmd === 'selection.list') return []
        return undefined
      },
    })
    window.location.hash = '#/projeto/demo/corte/201/empacotar?run=2&estado=vazio'

    render(
      envolver(
        <Shell
          projeto={{ id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }}
          rota={{ tela: 'corte', projeto: 'demo', corte: '201', aba: 'empacotar', run: '2' }}
          semPaddingConteudo
          meio={
            <ContextoCorteConectado
              projetoId="demo"
              corteId="201"
              subAbaAtiva="empacotar"
              runId="2"
              fila={filaTeste}
            />
          }
          fila={filaTeste}
        >
          <EmpacotarCorte
            projetoId="demo"
            projetoPath="/projetos/Demo.clipes"
            corteId="201"
            runId="2"
            storeFontes={criarStoreFontesProjeto()}
            fila={filaTeste}
          />
        </Shell>,
      ),
    )

    const btnSugerir = await screen.findByRole('button', { name: 'Sugerir Empacotamento' })
    expect(screen.queryByText('Fonte offline')).not.toBeInTheDocument()
    expect(btnSugerir.className.split(/\s+/)).toContain('bg-sinal')
    expect(document.querySelectorAll('button.bg-sinal')).toHaveLength(1)
  })
})
