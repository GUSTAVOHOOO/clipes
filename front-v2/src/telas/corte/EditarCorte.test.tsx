import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import { usePreferencias } from '~/preferencias/preferencias'
import { useRota } from '~/rotas/useRota'
import { Shell } from '~/shell/Shell'
import { criarStoreEditorCorte, type EditorDocumento, type StoreEditorCorte } from '~/stores/editorCorte'
import {
  criarStoreFontesProjeto,
  type FonteProjeto,
  type StoreFontesProjeto,
} from '~/stores/fontesProjeto'
import { App } from '~/App'
import { ContextoCorteConectado } from '~/telas/corte/ContextoCorteConectado'
import { EditarCorte } from '~/telas/corte/EditarCorte'

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
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      width: 480,
      height: 520,
      top: 0,
      left: 0,
      bottom: 520,
      right: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
  }
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return 520
    },
  })
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {}
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
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

function criarDoc(parcial: Partial<EditorDocumento> = {}): EditorDocumento {
  return {
    clipId: 11,
    schemaVersion: 2,
    request: { source_id: 4, start_id: 10, end_id: 14, candidate_id: 201 },
    startUs: 90_000_000,
    endUs: 140_000_000,
    windowStartUs: 0,
    windowEndUs: 260_000_000,
    fps: 24,
    sourceAspect: 16 / 9,
    revision: 1,
    undoCount: 1,
    redoCount: 0,
    silences: {
      enabled: true,
      thresholdUs: 600_000,
      intervals: [
        {
          id: 1,
          startUs: 100_120_000,
          endUs: 100_920_000,
          gapStartUs: 100_000_000,
          gapEndUs: 101_000_000,
          status: 'active',
        },
      ],
      segments: [
        { sourceStartUs: 90_000_000, sourceEndUs: 100_120_000, outputStartUs: 0, outputEndUs: 10_120_000 },
        { sourceStartUs: 100_920_000, sourceEndUs: 140_000_000, outputStartUs: 10_120_000, outputEndUs: 49_200_000 },
      ],
      removedUs: 800_000,
      effectiveDurationUs: 49_200_000,
    },
    crop: {
      layout: 'face',
      explicitLayout: 'face',
      splitRatio: undefined,
      suggested: null,
      edits: [{ timeUs: 95_000_000, x: 0.34, y: 0, width: 0.32, height: 1, cut: false }],
      gameplayWebcam: null,
      twoPeople: null,
      resolved: [],
      hasCrop: true,
    },
    montage: null,
    audioMix: {
      soundtrack: null,
      sfx: [],
      speechIntervals: [{ startUs: 0, endUs: 20_000_000 }],
      totalDurationUs: 49_200_000,
      unverifiedCount: 0,
      warnings: [],
    },
    ...parcial,
  }
}

function configurarMocksBase(opcoes?: {
  doc?: EditorDocumento
  fontes?: FonteProjeto[]
  flushErro?: boolean
  proxyState?: 'ready' | 'running'
}) {
  let docAtual = opcoes?.doc ?? criarDoc()
  let fontesAtuais = opcoes?.fontes ?? FONTES_PADRAO
  let flushFalha = Boolean(opcoes?.flushErro)

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
    if (comando === 'transcription.status') {
      return { language: 'pt', transcript: { id: 4, state: 'complete', resume_us: 3_600_000_000, duration_us: 3_600_000_000, engine: 'local', words: 300 }, job: null }
    }
    if (comando === 'batches.list') return []
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
            { id: 102, startId: 40, endId: 41, startUs: 390_000_000, endUs: 410_000_000, title: 'Corte direto aprovado' },
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
    if (comando === 'editor.open') {
      docAtual = criarDoc({
        ...docAtual,
        request: {
          source_id: Number(args.source_id),
          start_id: Number(args.start_id),
          end_id: Number(args.end_id),
          ...(typeof args.candidate_id === 'number' ? { candidate_id: args.candidate_id } : {}),
        },
      })
      return docAtual
    }
    if (comando === 'editor.sentences') {
      return [
        { id: 9, startUs: 80_000_000, endUs: 89_000_000, text: 'Frase anterior fora.' },
        { id: 10, startUs: 90_000_000, endUs: 100_000_000, text: 'Primeira frase do corte.' },
        { id: 14, startUs: 130_000_000, endUs: 140_000_000, text: 'Última frase do corte.' },
      ]
    }
    if (comando === 'export.captions') {
      return {
        track: 'original',
        style: {
          fontFamily: 'Noto Sans',
          fontSize: 64,
          primaryColor: '#ffffff',
          activeColor: '#ffd23f',
          spokenColor: '#ffffff',
          outline: 4,
          outlineColor: '#000000',
          shadow: 2,
          posX: 540,
          posY: 1480,
          highlight: true,
          preset: 'vertical',
          revision: 1,
        },
        words: [],
        cues: [],
        missingGlyphs: [],
        emojiRemoved: 0,
      }
    }
    if (comando === 'audio.list') return []
    if (comando === 'translation.get') {
      return {
        clipId: docAtual.clipId,
        sourceId: docAtual.request.source_id,
        permitted: true,
        permissionError: null,
        activeTrack: 'original',
        hasTranslation: false,
        sentences: [],
      }
    }
    if (comando === 'captions.remap_status') return { discarded: 0 }
    if (comando === 'proxy.request') {
      if (opcoes?.proxyState === 'running') {
        return { state: 'running', key: null, job: 77, progress: 45, error: null }
      }
      return { state: 'ready', key: 'proxy-4-90-140', job: null, progress: 100, error: null }
    }
    if (comando === 'editor.timeline') {
      return {
        state: 'ready',
        key: 'tl-4-90-140',
        job: null,
        progress: 100,
        error: null,
        thumbs: { id: 'tl-4', count: 5, intervalUs: 2_000_000, width: 96, height: 54, columns: 20 },
      }
    }
    if (comando === 'editor.wave') return { blockUs: 100_000, values: [20, 40, 80, 60] }
    if (comando === 'editor.snapshots') return []
    if (comando === 'transcription.corrections') return { can_undo: true, can_redo: false }
    if (comando === 'transcription.undo') {
      return { changed: true, source_id: 4, transcript_id: 4, position: 100, sentence_id: 10, text: 'Primeira', corrected: false, can_undo: false, can_redo: true }
    }
    if (comando === 'editor.adjust') {
      docAtual = { ...docAtual, startUs: 85_000_000, undoCount: docAtual.undoCount + 1 }
      return docAtual
    }
    if (comando === 'editor.undo') {
      docAtual = { ...docAtual, undoCount: Math.max(0, docAtual.undoCount - 1), redoCount: docAtual.redoCount + 1 }
      return docAtual
    }
    if (comando === 'editor.redo') {
      docAtual = { ...docAtual, undoCount: docAtual.undoCount + 1, redoCount: Math.max(0, docAtual.redoCount - 1) }
      return docAtual
    }
    if (comando === 'editor.flush') {
      if (flushFalha) {
        throw new ErroCore('project_write', 'Disco bloqueado')
      }
      return { saved: true }
    }
    if (comando === 'jobs.cancel') return { cancelled: true }
    return {}
  })

  return {
    definirFlushFalha: (v: boolean) => {
      flushFalha = v
    },
  }
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

describe('Tela EditarCorte (#/projeto/:id/corte/:corteId/editar)', () => {
  let storeFontes: StoreFontesProjeto
  let storeEditor: StoreEditorCorte

  beforeEach(() => {
    chamarMock.mockReset()
    localStorage.clear()
    filaTeste = criarFila(() => 'demo')
    storeFontes = criarStoreFontesProjeto()
    storeEditor = criarStoreEditorCorte()
    window.history.replaceState(null, '', '/')
    window.location.hash = '#/projeto/demo/corte/201/editar'
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
  })

  it('guarda de entrada redireciona Corte inválido, ausente ou não aprovado para #/projeto/:id/cortes com toast', async () => {
    configurarMocksBase()

    // Token inválido
    const { rerender } = render(
      envolver(
        <EditarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="invalido"
          storeFontes={storeFontes}
          storeEditor={storeEditor}
          fila={filaTeste}
        />,
      ),
    )

    await waitFor(() => {
      expect(window.location.hash).toBe('#/projeto/demo/cortes')
    })
    expect(await screen.findByText(/Este Corte não está disponível para edição/i)).toBeInTheDocument()

    // Candidato pendente (101)
    window.location.hash = '#/projeto/demo/corte/101/editar'
    rerender(
      envolver(
        <EditarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="101"
          storeFontes={storeFontes}
          storeEditor={storeEditor}
          fila={filaTeste}
        />,
      ),
    )

    await waitFor(() => {
      expect(window.location.hash).toBe('#/projeto/demo/cortes')
    })
  })

  it('abre Corte V1 existente (202) e Corte avulso (avulso-4-10-14) preservando sub-abas corretas no ContextoCorte', async () => {
    configurarMocksBase()
    window.location.hash = '#/projeto/demo/corte/avulso-4-10-14/editar'

    const { rerender } = render(
      envolver(
        <Shell
          projeto={{ id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }}
          rota={{ tela: 'corte', projeto: 'demo', corte: 'avulso-4-10-14', aba: 'editar' }}
          semPaddingConteudo
          meio={
            <ContextoCorteConectado
              projetoId="demo"
              corteId="avulso-4-10-14"
              subAbaAtiva="editar"
              fila={filaTeste}
            />
          }
          fila={filaTeste}
        >
          <EditarCorte
            projetoId="demo"
            projetoPath="/projetos/Demo.clipes"
            corteId="avulso-4-10-14"
            storeFontes={storeFontes}
            storeEditor={storeEditor}
            fila={filaTeste}
          />
        </Shell>,
      ),
    )

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('editor.open', {
        source_id: 4,
        start_id: 10,
        end_id: 14,
      })
    })
    const navAbas = screen.getByRole('navigation', { name: 'Etapas do Corte' })
    expect(within(navAbas).getByRole('link', { name: 'Editar' })).toBeInTheDocument()
    expect(within(navAbas).queryByRole('link', { name: 'Transformar' })).toBeNull()
    expect(within(navAbas).queryByRole('link', { name: 'Empacotar' })).toBeNull()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)

    // Corte V1 existente (202)
    window.location.hash = '#/projeto/demo/corte/202/editar'
    rerender(
      envolver(
        <Shell
          projeto={{ id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }}
          rota={{ tela: 'corte', projeto: 'demo', corte: '202', aba: 'editar' }}
          semPaddingConteudo
          meio={
            <ContextoCorteConectado
              projetoId="demo"
              corteId="202"
              subAbaAtiva="editar"
              fila={filaTeste}
            />
          }
          fila={filaTeste}
        >
          <EditarCorte
            projetoId="demo"
            projetoPath="/projetos/Demo.clipes"
            corteId="202"
            storeFontes={storeFontes}
            storeEditor={storeEditor}
            fila={filaTeste}
          />
        </Shell>,
      ),
    )

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('editor.open', {
        source_id: 4,
        start_id: 40,
        end_id: 41,
        candidate_id: 202,
      })
    })
    expect(within(screen.getByRole('navigation', { name: 'Etapas do Corte' })).getByRole('link', { name: 'Transformar' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Etapas do Corte' })).getByRole('link', { name: 'Empacotar' })).toBeInTheDocument()
  })

  it('cobre os 6 estados §6: loading, empty, error, ready, job_running e partial (Fonte offline)', async () => {
    const user = userEvent.setup()

    // 1. loading (?estado=carregando)
    configurarMocksBase()
    window.location.hash = '#/projeto/demo/corte/201/editar?estado=carregando'
    const { rerender } = render(
      envolver(
        <EditarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="201"
          storeFontes={storeFontes}
          storeEditor={storeEditor}
          fila={filaTeste}
        />,
      ),
    )
    expect(screen.getAllByRole('status', { name: /Carregando/i }).length).toBeGreaterThan(0)

    // 2. empty (?estado=vazio)
    window.location.hash = '#/projeto/demo/corte/201/editar?estado=vazio'
    rerender(
      envolver(
        <EditarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="201"
          storeFontes={storeFontes}
          storeEditor={storeEditor}
          fila={filaTeste}
        />,
      ),
    )
    expect(await screen.findByText(/Este Corte não está disponível/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Voltar para Cortes/i })).toBeInTheDocument()

    // 3. error (?estado=erro)
    window.location.hash = '#/projeto/demo/corte/201/editar?estado=erro'
    rerender(
      envolver(
        <EditarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="201"
          storeFontes={storeFontes}
          storeEditor={storeEditor}
          fila={filaTeste}
        />,
      ),
    )
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    // 4. job_running (proxy rodando) + 5. ready (4 zonas sem painel direito fixo)
    configurarMocksBase({ proxyState: 'running' })
    window.location.hash = '#/projeto/demo/corte/201/editar'
    rerender(
      envolver(
        <EditarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="201"
          storeFontes={storeFontes}
          storeEditor={storeEditor}
          fila={filaTeste}
        />,
      ),
    )
    expect(await screen.findByRole('progressbar')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Transcrição e Índice do Corte' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Timeline compacta do Corte' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: /Inspetor/i })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(chamarMock).toHaveBeenCalledWith('jobs.cancel', { id: 77 })

    // 6. partial / Fonte offline (?estado=offline ou candidato 301)
    configurarMocksBase()
    window.location.hash = '#/projeto/demo/corte/301/editar'
    rerender(
      envolver(
        <EditarCorte
          projetoId="demo"
          projetoPath="/projetos/Demo.clipes"
          corteId="301"
          storeFontes={storeFontes}
          storeEditor={storeEditor}
          fila={filaTeste}
        />,
      ),
    )
    expect(
      await screen.findByText(/O arquivo original da Fonte foi movido ou alterado/i),
    ).toBeInTheDocument()
    expect(document.querySelector('video')).toBeNull()
    expect(screen.getAllByRole('button', { name: /Relocalizar/i }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Recuar Entrada 1 Frase' })).toBeEnabled()
  })

  it('guarda de saída editor.flush cancela navegação quando falha, abre ConfirmDialog de 3 ações e conclui após retentativa ou descarte', async () => {
    const user = userEvent.setup()
    const ctrl = configurarMocksBase({ flushErro: true })
    window.location.hash = '#/projeto/demo/corte/201/editar'

    let guardaRef: (() => Promise<boolean>) | undefined

    function HarnessRota() {
      const rota = useRota({ projetoAberto: 'demo' })
      if (rota.tela !== 'corte') return <div>Outra rota: {rota.tela}</div>
      return (
        <Shell
          projeto={{ id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }}
          rota={rota}
          semPaddingConteudo
          meio={
            <ContextoCorteConectado
              projetoId="demo"
              corteId={rota.corte}
              subAbaAtiva={rota.aba}
              aoAntesDeNavegar={async () => (guardaRef ? guardaRef() : true)}
              fila={filaTeste}
            />
          }
          fila={filaTeste}
        >
          <EditarCorte
            projetoId="demo"
            projetoPath="/projetos/Demo.clipes"
            corteId={rota.corte}
            storeFontes={storeFontes}
            storeEditor={storeEditor}
            fila={filaTeste}
            aoRegistrarGuardaSaida={(fn) => {
              guardaRef = fn
            }}
          />
        </Shell>
      )
    }

    render(envolver(<HarnessRota />))

    await screen.findByRole('button', { name: 'Enquadrar' })

    // Tenta navegar para Empacotar -> editor.flush falha -> abre ConfirmDialog de 3 ações
    await user.click(screen.getByRole('link', { name: 'Empacotar' }))

    const dlg = await screen.findByRole('alertdialog')
    expect(within(dlg).getByRole('button', { name: 'Tentar salvar novamente' })).toBeInTheDocument()
    const btnContinuar = within(dlg).getByRole('button', { name: 'Continuar editando' })
    expect(btnContinuar).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Sair descartando alterações não salvas' })).toBeInTheDocument()
    await waitFor(() => expect(btnContinuar).toHaveFocus())
    expect(window.location.hash).toBe('#/projeto/demo/corte/201/editar')

    // Continuar editando mantém na tela
    await user.click(btnContinuar)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(window.location.hash).toBe('#/projeto/demo/corte/201/editar')

    // Tenta ir para Próximo aprovado > e corrige erro ao tentar salvar novamente
    await user.click(screen.getByRole('button', { name: /Próximo aprovado/i }))
    const dlg2 = await screen.findByRole('alertdialog')
    ctrl.definirFlushFalha(false)
    await user.click(within(dlg2).getByRole('button', { name: 'Tentar salvar novamente' }))

    await waitFor(() => {
      expect(window.location.hash).toBe('#/projeto/demo/corte/202/editar')
    })

    // Volta falha e clica em Sair descartando alterações não salvas
    ctrl.definirFlushFalha(true)
    await user.click(screen.getByRole('link', { name: 'Empacotar' }))
    const dlg3 = await screen.findByRole('alertdialog')
    await user.click(within(dlg3).getByRole('button', { name: 'Sair descartando alterações não salvas' }))

    await waitFor(() => {
      expect(window.location.hash).toBe('#/projeto/demo/corte/202/empacotar')
    })
  })

  it('suporta atalhos Ctrl+[, Ctrl+], Ctrl+S, Ctrl+F, Ctrl+Z contextual, teclas únicas WCAG 2.1.4 e ciclo F6/Shift+F6', async () => {
    const user = userEvent.setup()
    configurarMocksBase()
    window.location.hash = '#/projeto/demo/corte/201/editar'

    function ControlePreferencias() {
      const [, mudar] = usePreferencias()
      return (
        <button type="button" onClick={() => mudar({ modoTeclasUnicas: 'desligadas' })}>
          Desligar teclas únicas
        </button>
      )
    }

    render(
      envolver(
        <>
          <ControlePreferencias />
          <Shell
            projeto={{ id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }}
            rota={{ tela: 'corte', projeto: 'demo', corte: '201', aba: 'editar' }}
            semPaddingConteudo
            meio={
              <ContextoCorteConectado
                projetoId="demo"
                corteId="201"
                subAbaAtiva="editar"
                fila={filaTeste}
              />
            }
            fila={filaTeste}
          >
            <EditarCorte
              projetoId="demo"
              projetoPath="/projetos/Demo.clipes"
              corteId="201"
              storeFontes={storeFontes}
              storeEditor={storeEditor}
              fila={filaTeste}
            />
          </Shell>
        </>,
      ),
    )

    await screen.findByRole('button', { name: 'Enquadrar' })

    // Ctrl+[ recolhe e Ctrl+F abre focando busca
    expect(screen.getByRole('complementary', { name: 'Transcrição e Índice do Corte' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '[', ctrlKey: true })
    expect(screen.getByRole('complementary', { name: 'Transcrição recolhida' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    const buscaInput = await screen.findByRole('textbox', { name: 'Filtrar fala do Corte' })
    await waitFor(() => expect(buscaInput).toHaveFocus())

    // Tecla única não dispara dentro de campo de texto
    await user.type(buscaInput, 'ijlo')
    expect(chamarMock).not.toHaveBeenCalledWith('editor.adjust', expect.anything())
    await user.clear(buscaInput)

    // Ctrl+] abre e fecha popover
    fireEvent.keyDown(window, { key: ']', ctrlKey: true })
    expect(await screen.findByText('Rosto (9:16)')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: ']', ctrlKey: true })
    await waitFor(() => expect(screen.queryByText('Rosto (9:16)')).toBeNull())

    // Ctrl+S chama editor.flush
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('editor.flush', {})
    })

    // Ctrl+Z fora da Transcrição chama editor.undo; dentro da Transcrição chama transcription.undo
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('editor.undo', expect.anything())
    })

    const primeiraPalavra = screen.getByRole('button', { name: 'Primeira' })
    primeiraPalavra.focus()
    fireEvent.keyDown(primeiraPalavra, { key: 'z', ctrlKey: true })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('transcription.undo', {})
    })

    // Teclas únicas (I, +, -, Espaço/K/J/L) fora de campo de texto
    document.body.focus()
    fireEvent.keyDown(document.body, { key: 'i' })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('editor.adjust', expect.objectContaining({ edge: 'start' }))
    })
    fireEvent.keyDown(document.body, { key: '+' })
    expect(screen.getByText('150%')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: '-' })
    expect(screen.getByText('100%')).toBeInTheDocument()

    // Desligar teclas únicas WCAG 2.1.4 impede I
    chamarMock.mockClear()
    await user.click(screen.getByRole('button', { name: 'Desligar teclas únicas' }))
    document.body.focus()
    fireEvent.keyDown(document.body, { key: 'i' })
    expect(chamarMock).not.toHaveBeenCalledWith('editor.adjust', expect.anything())

    // Ciclo F6: Topo -> Painel Esquerdo -> Palco -> Timeline -> Barra de Status -> Topo
    const topo = document.querySelector('[data-regiao="topo"]')!
    const painel = screen.getByRole('complementary', { name: 'Transcrição e Índice do Corte' })
    const palco = screen.getByRole('region', { name: 'Palco de prévia' })
    const timeline = screen.getByRole('region', { name: 'Timeline compacta do Corte' })
    const rodape = document.querySelector('[data-regiao="rodape"]')!

    fireEvent.keyDown(window, { key: 'F6' })
    expect(topo.contains(document.activeElement)).toBe(true)

    // UI-72: contexto é parada própria entre topo e painel
    fireEvent.keyDown(window, { key: 'F6' })
    expect(document.querySelector('[data-regiao="contexto"]')!.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(painel.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(palco.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(timeline.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(rodape.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6', shiftKey: true })
    expect(timeline.contains(document.activeElement)).toBe(true)
  })

  it('integra rota #/projeto/demo/corte/201/editar no App com guarda de saída ao clicar em Fontes no Shell', async () => {
    const user = userEvent.setup()
    const ctrl = configurarMocksBase({ flushErro: true })
    window.location.hash = '#/projeto/demo/corte/201/editar'

    render(<App />)

    expect(await screen.findByRole('button', { name: 'Enquadrar' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const main = document.querySelector('main')!
    expect(main.className).toContain('overflow-hidden')
    expect(main.className).not.toContain('p-4')

    await user.click(screen.getByRole('link', { name: 'Fontes' }))
    const dlg = await screen.findByRole('alertdialog')
    expect(within(dlg).getByRole('button', { name: 'Tentar salvar novamente' })).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Sair descartando alterações não salvas' })).toBeInTheDocument()

    ctrl.definirFlushFalha(false)
    await user.click(within(dlg).getByRole('button', { name: 'Tentar salvar novamente' }))

    await waitFor(() => {
      expect(window.location.hash).toBe('#/projeto/demo/fontes')
    })
  })

  it('UI-60 / UI-64 / UI-66: Shell montado antes do EditarCorte não bloqueia F6 das 6 regiões (com popover aberto), Alt+I livre funciona no modo alt, Ctrl+] aparece na Paleta e ?estado=vazio mantém 1 bg-sinal', async () => {
    const user = userEvent.setup()
    configurarMocksBase()
    window.location.hash = '#/inicio'

    const { unmount } = render(<App />)

    // Aguarda Shell montar no #/inicio antes de navegar para o Editor
    await screen.findByRole('heading', { name: 'Projetos' })
    act(() => {
      window.location.hash = '#/projeto/demo/corte/201/editar'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    const btnEnquadrar = await screen.findByRole('button', { name: 'Enquadrar' })

    // UI-60: abre popover Enquadrar e cicla todas as 6 regiões via F6
    await user.click(btnEnquadrar)
    expect(await screen.findByText('Rosto (9:16)')).toBeInTheDocument()

    const topo = document.querySelector<HTMLElement>('[data-regiao="topo"]')!
    const painel = screen.getByRole('complementary', { name: 'Transcrição e Índice do Corte' })
    const palco = screen.getByRole('region', { name: 'Palco de prévia' })
    const popover = document.querySelector<HTMLElement>('[data-regiao="popover-editor"]')!
    const timeline = screen.getByRole('region', { name: 'Timeline compacta do Corte' })
    const rodape = document.querySelector<HTMLElement>('[data-regiao="rodape"]')!

    const gatilhoTopo = topo.querySelector('button, a') as HTMLElement
    gatilhoTopo.focus()

    // UI-72: contexto é parada própria logo após o topo (mesma ordem do Shell)
    const contexto = document.querySelector<HTMLElement>('[data-regiao="contexto"]')!
    fireEvent.keyDown(gatilhoTopo, { key: 'F6', bubbles: true, cancelable: true })
    expect(contexto.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document.activeElement!, { key: 'F6', bubbles: true, cancelable: true })
    expect(painel.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document.activeElement!, { key: 'F6', bubbles: true, cancelable: true })
    expect(palco.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document.activeElement!, { key: 'F6', bubbles: true, cancelable: true })
    expect(popover.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document.activeElement!, { key: 'F6', bubbles: true, cancelable: true })
    expect(timeline.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document.activeElement!, { key: 'F6', bubbles: true, cancelable: true })
    expect(rodape.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document.activeElement!, { key: 'F6', bubbles: true, cancelable: true })
    expect(topo.contains(document.activeElement)).toBe(true)

    // UI-72: Shift+F6 do topo volta ao rodapé
    fireEvent.keyDown(document.activeElement!, { key: 'F6', shiftKey: true, bubbles: true, cancelable: true })
    expect(rodape.contains(document.activeElement)).toBe(true)

    // UI-64: Ctrl+] aparece na Paleta
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const inputPaleta = await screen.findByRole('combobox')
    await user.type(inputPaleta, 'popover')
    const itemPopover = await screen.findByText('Abrir/fechar último popover da barra de ações')
    expect(itemPopover.closest('[cmdk-item]')?.textContent).toMatch(/Ctrl\+\]|⌘\]/)
    await user.keyboard('{Escape}')

    // UI-64: modo WCAG 2.1.4 'alt' -> Alt+I livre chama free: true, Shift+Alt+I chama free: false
    unmount()
    localStorage.setItem(
      'clipes.preferencias.v1',
      JSON.stringify({ modoTeclasUnicas: 'alt', teclasUnicas: true }),
    )
    configurarMocksBase()
    window.location.hash = '#/projeto/demo/corte/201/editar'
    const r2 = render(<App />)
    await screen.findByRole('button', { name: 'Enquadrar' })

    chamarMock.mockClear()
    document.body.focus()
    fireEvent.keyDown(document.body, { key: 'i', altKey: true, bubbles: true, cancelable: true })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.adjust',
        expect.objectContaining({ edge: 'start', free: true }),
      )
    })

    chamarMock.mockClear()
    fireEvent.keyDown(document.body, {
      key: 'i',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.adjust',
        expect.objectContaining({ edge: 'start', free: false }),
      )
    })

    // UI-66: ?estado=vazio mantém apenas 1 botão bg-sinal
    act(() => {
      window.location.hash = '#/projeto/demo/corte/201/editar?estado=vazio'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await screen.findByText(/Este Corte não está disponível para edição/i)
    const botoesSinal = Array.from(document.querySelectorAll('button.bg-sinal'))
    expect(botoesSinal).toHaveLength(1)

    r2.unmount()
    localStorage.clear()
  })

  it('sincroniza videoKind em EditarCorte e ContextoCorteConectado ao converter Corte direto para Vídeo transformado', async () => {
    const user = userEvent.setup()
    localStorage.clear()
    chamarMock.mockImplementation(async (comando: string, args: Record<string, unknown> = {}) => {
      if (comando === 'sources.list') {
        return [
          {
            id: 4,
            path: '/videos/Live_12_11_final.mp4',
            status: 'available',
            available: true,
            verified: true,
            audio_track: 1,
            origin_url: null,
            language: 'pt',
            permission: { status: 'granted', who: 'Criador', where: 'Discord', scope: 'cortes' },
          },
        ]
      }
      if (comando === 'batches.list') return []
      if (comando === 'transcription.status') {
        return { language: 'pt', transcript: { id: 4, state: 'complete', words: 1200 }, job: null }
      }
      if (comando === 'transcription.sentences') {
        return [
          { id: 40, startUs: 390_000_000, endUs: 400_000_000, text: 'Frase quarenta.' },
          { id: 41, startUs: 400_000_000, endUs: 410_000_000, text: 'Frase quarenta e um.' },
        ]
      }
      if (comando === 'selection.list') {
        return [{ id: 1, videoKind: 'direct', state: 'completed', revision: 1, revisions: [1] }]
      }
      if (comando === 'selection.get') {
        return {
          run: { id: 1, transcriptId: 4, videoKind: 'direct', revision: 1, revisions: [1] },
          windows: [],
          candidates: [
            { id: 102, startId: 40, endId: 41, startUs: 390e6, endUs: 410e6, title: 'Corte direto' },
          ],
        }
      }
      if (comando === 'selection.review') {
        return {
          run: 1,
          canUndo: false,
          items: [
            {
              candidate: 102,
              status: 'approved',
              adjusted: false,
              videoKind: 'direct',
              startId: 40,
              endId: 41,
              startUs: 390e6,
              endUs: 410e6,
            },
          ],
        }
      }
      if (comando === 'selection.candidate.set_kind') {
        return {
          run: 1,
          candidate: 102,
          videoKind: 'transformed',
          canUndo: false,
          item: {
            candidate: 102,
            status: 'approved',
            adjusted: false,
            videoKind: 'transformed',
            startId: 40,
            endId: 41,
            startUs: 390e6,
            endUs: 410e6,
          },
        }
      }
      if (comando === 'editor.open') {
        return {
          clipId: 102,
          sourceId: 4,
          startId: 40,
          endId: 41,
          startUs: 390e6,
          endUs: 410e6,
          cuts: [],
          montage: null,
          proxy: { state: 'ready', key: '0004key', job: null, progress: 100 },
          audioAssets: [],
        }
      }
      if (comando === 'editor.state') return null
      if (comando === 'captions.style.get') {
        return { preset: 'vertical', fontSize: 42, position: 'bottom', maxWords: 3, revision: 1 }
      }
      if (comando === 'captions.words') return []
      if (comando === 'translation.get') return { hasTranslation: false, targetLanguage: null }
      if (comando === 'energy.status') return { measured: false, marks: { high: 0, peak: 0 } }
      if (comando === 'chat.status') return { state: 'unavailable' }
      return null
    })

    const aoAtualizarMeta = vi.fn()
    const storeFontes = criarStoreFontesProjeto()
    storeFontes.definirProjeto('/projetos/Demo.clipes')
    const storeEditor = criarStoreEditorCorte()
    storeEditor.definirProjeto('/projetos/Demo.clipes')

    render(
      envolver(
        <Shell
          projeto={{ id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }}
          rota={{ tela: 'corte', projeto: 'demo', corte: '102', aba: 'editar', run: '1' }}
          semPaddingConteudo
          meio={
            <ContextoCorteConectado
              projetoId="demo"
              corteId="102"
              subAbaAtiva="editar"
              runId="1"
              fila={filaTeste}
            />
          }
          fila={filaTeste}
        >
          <EditarCorte
            projetoId="demo"
            projetoPath="/projetos/Demo.clipes"
            corteId="102"
            runId="1"
            aoAtualizarMeta={aoAtualizarMeta}
            storeFontes={storeFontes}
            storeEditor={storeEditor}
            fila={filaTeste}
          />
        </Shell>,
      ),
    )

    const btnConverter = await screen.findByRole('button', { name: 'Converter em Vídeo transformado' })
    await user.click(btnConverter)
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: 'Confirmar conversão' }))

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Transformar' })).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(aoAtualizarMeta).toHaveBeenLastCalledWith(
        expect.objectContaining({ videoKind: 'transformed' }),
      )
    })
  })
})
