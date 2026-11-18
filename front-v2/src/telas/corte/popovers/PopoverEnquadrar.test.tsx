import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { criarFila, type Fila } from '~/core/progresso'
import { criarStoreEditorCorte, type EditorDocumento } from '~/stores/editorCorte'
import { PopoverEnquadrar } from '~/telas/corte/popovers/PopoverEnquadrar'

const chamarMock = vi.fn()
let filaTeste: Fila = criarFila(() => '/projetos/demo.clipes')

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

function criarDoc(parcial: Partial<EditorDocumento> = {}): EditorDocumento {
  return {
    clipId: 1,
    schemaVersion: 2,
    request: { source_id: 1, start_id: 1, end_id: 3, candidate_id: 10 },
    startUs: 10_000_000,
    endUs: 40_000_000,
    windowStartUs: 0,
    windowEndUs: 120_000_000,
    fps: 24,
    sourceAspect: 16 / 9,
    revision: 0,
    undoCount: 0,
    redoCount: 0,
    silences: { enabled: true, thresholdUs: 600_000, intervals: [], segments: [], removedUs: 0, effectiveDurationUs: 30_000_000 },
    crop: {
      layout: 'face',
      explicitLayout: 'face',
      splitRatio: 0.3,
      suggested: null,
      edits: [{ timeUs: 12_000_000, x: 0.25, y: 0.1, width: 0.32, height: 0.8, cut: false }],
      gameplayWebcam: null,
      twoPeople: null,
      resolved: [],
      hasCrop: true,
    },
    montage: null,
    audioMix: { soundtrack: null, sfx: [], speechIntervals: [], totalDurationUs: 30_000_000, unverifiedCount: 0, warnings: [] },
    ...parcial,
  }
}

async function prepararSessao(opcoes: {
  doc?: EditorDocumento
  workerInstalado?: boolean
  yunetInstalado?: boolean
  fonteDisponivel?: boolean
} = {}) {
  const doc = opcoes.doc ?? criarDoc()
  const workerInst = opcoes.workerInstalado ?? true
  const yunetInst = opcoes.yunetInstalado ?? true

  chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === 'editor.open') return doc
    if (cmd === 'editor.sentences') return []
    if (cmd === 'export.captions') return { style: { revision: 0 }, cues: [], emojiRemoved: 0, words: [], transcriptId: 1, start_us: 10_000_000, end_us: 40_000_000 }
    if (cmd === 'audio.list') return []
    if (cmd === 'translation.get') return { clipId: 1, sourceId: 1, permitted: true, permissionError: null, activeTrack: 'original', hasTranslation: false, sentences: [] }
    if (cmd === 'captions.remap_status') return { discarded: 0 }
    if (cmd === 'proxy.request') return { state: 'ready', key: 'p1', job: null, progress: 100, error: null }
    if (cmd === 'editor.timeline') return { state: 'ready', key: 'tl1', job: null, progress: 100, error: null, thumbs: null }
    if (cmd === 'editor.wave') return { blockUs: 100_000, values: [] }
    if (cmd === 'components.manifest') return [{ id: 'uv', version: '0.5', size: 12_000_000, license: 'Apache-2.0', source_url: 'https://github.com/astral-sh/uv' }]
    if (cmd === 'components.settings.get') return { data_dir: 'C:\\Clipes\\data', cache_dir: 'C:\\Clipes\\cache', cache_limit_bytes: 0 }
    if (cmd === 'components.worker.status') return { installed: workerInst }
    if (cmd === 'components.models.manifest') {
      return [{ id: 'yunet', label: 'YuNet', license: 'MIT', source_url: 'https://huggingface.co/opencv/yunet', size: 232_589, installed: yunetInst, worker_installed: workerInst }]
    }
    if (cmd === 'editor.crop.set_layout') {
      return {
        clipId: doc.clipId,
        schemaVersion: 2,
        revision: doc.revision + 1,
        undoCount: doc.undoCount + (args.preview ? 0 : 1),
        redoCount: 0,
        ...doc.crop,
        layout: args.layout,
        explicitLayout: args.layout,
        splitRatio: typeof args.split_ratio === 'number' ? args.split_ratio : doc.crop.splitRatio,
      }
    }
    if (cmd === 'reframe.start') {
      return {
        id: 51,
        job: 6051,
        source: 1,
        startUs: 10_000_000,
        endUs: 40_000_000,
        layout: args.layout ?? 'face',
        splitRatio: args.splitRatio ?? null,
        state: 'completed',
        progress: 100,
        timeline: { schemaVersion: 1, revision: 1, status: 'completed', segments: [], metrics: { confidence: 0.42 } },
        secondaryTimeline: null,
        error: null,
      }
    }
    if (cmd === 'editor.crop.set_suggested') {
      return {
        clipId: doc.clipId,
        schemaVersion: 2,
        revision: doc.revision + 1,
        undoCount: doc.undoCount,
        redoCount: 0,
        ...doc.crop,
        suggested: { schemaVersion: 1, revision: 1, status: 'completed', segments: [] },
      }
    }
    if (cmd === 'editor.crop.set_edits') {
      return {
        clipId: doc.clipId,
        schemaVersion: 2,
        revision: doc.revision + 1,
        undoCount: doc.undoCount + (args.preview ? 0 : 1),
        redoCount: 0,
        ...doc.crop,
        edits: args.edits ?? [],
      }
    }
    return null
  })

  const store = criarStoreEditorCorte()
  store.definirProjeto('/projetos/demo.clipes')
  await store.abrir({
    corteId: '10',
    sourceId: 1,
    startId: 1,
    endId: 3,
    candidateId: 10,
    fonteDisponivel: opcoes.fonteDisponivel ?? true,
  })
  return store
}

describe('<PopoverEnquadrar>', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => '/projetos/demo.clipes')
  })

  it('troca dos 5 layouts chama editor.crop.set_layout; fit exibe mensagem educativa; gameplay_webcam exibe slider 0.20–0.50 (preview true/false) e Topo/Base', async () => {
    const user = userEvent.setup()
    const store = await prepararSessao()
    const snap = store.obterSnapshot()

    const { rerender } = render(
      envolver(
        <PopoverEnquadrar
          estadoEditor={{
            ...snap,
            documentoAtivo: snap.previaLocal ?? snap.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
          tempoUs={12_000_000}
        />,
      ),
    )

    // 5 layouts disponíveis
    for (const rotulo of ['Rosto (9:16)', 'Fit / Centro', 'Jogo + Webcam', 'Duas pessoas', 'Tela cheia (ROI)']) {
      expect(screen.getByRole('radio', { name: rotulo })).toBeInTheDocument()
    }

    await user.click(screen.getByRole('radio', { name: 'Fit / Centro' }))
    expect(chamarMock).toHaveBeenCalledWith(
      'editor.crop.set_layout',
      expect.objectContaining({ clip_id: 1, layout: 'fit', preview: false }),
    )

    const snapFit = store.obterSnapshot()
    rerender(
      envolver(
        <PopoverEnquadrar
          estadoEditor={{
            ...snapFit,
            documentoAtivo: snapFit.previaLocal ?? snapFit.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
          tempoUs={12_000_000}
        />,
      ),
    )
    expect(screen.getByText(/barras laterais/i)).toBeInTheDocument()

    // Seleciona gameplay_webcam
    await user.click(screen.getByRole('radio', { name: 'Jogo + Webcam' }))
    expect(chamarMock).toHaveBeenCalledWith(
      'editor.crop.set_layout',
      expect.objectContaining({ clip_id: 1, layout: 'gameplay_webcam', preview: false }),
    )

    const snapGw = store.obterSnapshot()
    rerender(
      envolver(
        <PopoverEnquadrar
          estadoEditor={{
            ...snapGw,
            documentoAtivo: snapGw.previaLocal ?? snapGw.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
          tempoUs={12_000_000}
        />,
      ),
    )

    expect(screen.getByRole('radiogroup', { name: 'Painel ativo' })).toBeInTheDocument()
    const slider = screen.getByRole('slider', { name: 'Proporção vertical' })
    expect(slider).toHaveAttribute('min', '20')
    expect(slider).toHaveAttribute('max', '50')

    // Arrasto no slider envia preview: true e depois preview: false
    const wrapper = slider.closest('[data-slider-wrapper]')!
    fireEvent.pointerDown(wrapper)
    fireEvent.change(slider, { target: { value: '35' } })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.crop.set_layout',
        expect.objectContaining({ layout: 'gameplay_webcam', preview: true }),
      )
    })
    fireEvent.pointerUp(wrapper)
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.crop.set_layout',
        expect.objectContaining({ layout: 'gameplay_webcam', preview: false }),
      )
    })
  })

  it('quando yunet ausente renderiza <InstaladorJustInTime recurso="yunet" />; após reframe.start, aplicar sugestão exibe aviso fora do undo e mantém edits', async () => {
    const user = userEvent.setup()
    const storeFaltando = await prepararSessao({ workerInstalado: false, yunetInstalado: false })
    const snapFaltando = storeFaltando.obterSnapshot()

    const { unmount } = render(
      envolver(
        <PopoverEnquadrar
          estadoEditor={{
            ...snapFaltando,
            documentoAtivo: snapFaltando.previaLocal ?? snapFaltando.oficial,
            store: storeFaltando,
            abrir: storeFaltando.abrir,
            salvarAgora: storeFaltando.salvarAgora,
            garantirSalvoParaSaida: storeFaltando.garantirSalvoParaSaida,
          }}
          tempoUs={12_000_000}
        />,
      ),
    )

    await waitFor(() => {
      const regiao = screen.getByRole('region', { name: 'Instalação necessária' })
      expect(regiao).toBeInTheDocument()
      expect(regiao).toHaveTextContent(/YuNet/i)
    })
    unmount()

    // YuNet instalado: reframe.start -> aviso fora do undo -> editor.crop.set_suggested
    const store = await prepararSessao({ workerInstalado: true, yunetInstalado: true })
    const snap = store.obterSnapshot()
    const { rerender } = render(
      envolver(
        <PopoverEnquadrar
          estadoEditor={{
            ...snap,
            documentoAtivo: snap.previaLocal ?? snap.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
          tempoUs={12_000_000}
        />,
      ),
    )

    const btnAnalisar = await screen.findByRole('button', { name: 'Analisar enquadramento automático' })
    await user.click(btnAnalisar)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('reframe.start', expect.objectContaining({ source: 1, layout: 'face' }))
    })

    const snapPosReframe = store.obterSnapshot()
    rerender(
      envolver(
        <PopoverEnquadrar
          estadoEditor={{
            ...snapPosReframe,
            documentoAtivo: snapPosReframe.previaLocal ?? snapPosReframe.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
          tempoUs={12_000_000}
        />,
      ),
    )

    expect(screen.getByText(/não entra no Desfazer/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Aplicar sugestão automática' }))
    expect(chamarMock).toHaveBeenCalledWith('editor.crop.set_suggested', { clip_id: 1, reframe_id: 51 })
    expect(store.obterSnapshot().oficial?.crop.edits).toHaveLength(1)
  })

  it('Limpar todas as edições manuais abre ConfirmDialog com foco inicial em Cancelar', async () => {
    const user = userEvent.setup()
    const store = await prepararSessao()
    const snap = store.obterSnapshot()

    render(
      envolver(
        <PopoverEnquadrar
          estadoEditor={{
            ...snap,
            documentoAtivo: snap.previaLocal ?? snap.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
          tempoUs={12_000_000}
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Limpar todas as edições manuais' }))

    const dialog = await screen.findByRole('alertdialog')
    const btnCancelar = screen.getByRole('button', { name: 'Cancelar' })
    await waitFor(() => expect(btnCancelar).toHaveFocus())
    expect(dialog).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Limpar edições' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.crop.set_edits',
        expect.objectContaining({ clip_id: 1, panel: 'primary', edits: [], preview: false }),
      )
    })
  })
})
