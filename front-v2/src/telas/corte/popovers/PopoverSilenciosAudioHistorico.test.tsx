import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { criarFila, type Fila } from '~/core/progresso'
import { criarStoreEditorCorte, type AudioAsset, type EditorDocumento } from '~/stores/editorCorte'
import { PopoverAudio } from '~/telas/corte/popovers/PopoverAudio'
import { PopoverHistorico } from '~/telas/corte/popovers/PopoverHistorico'
import { PopoverSilencios } from '~/telas/corte/popovers/PopoverSilencios'

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
    revision: 2,
    undoCount: 3,
    redoCount: 1,
    silences: {
      enabled: true,
      thresholdUs: 600_000,
      intervals: [
        {
          id: 1,
          startUs: 15_120_000,
          endUs: 16_020_000,
          gapStartUs: 15_000_000,
          gapEndUs: 16_100_000,
          status: 'active',
        },
      ],
      segments: [],
      removedUs: 900_000,
      effectiveDurationUs: 29_100_000,
    },
    crop: {
      layout: 'face',
      explicitLayout: 'face',
      splitRatio: 0.3,
      suggested: null,
      edits: [],
      gameplayWebcam: null,
      twoPeople: null,
      resolved: [],
      hasCrop: true,
    },
    montage: null,
    audioMix: {
      soundtrack: {
        assetId: 5,
        name: 'Fundo Lo-fi',
        mediaId: 'audio/5',
        assetDurationUs: 30_000_000,
        startUs: 0,
        playDurationUs: 29_100_000,
        endUs: 29_100_000,
        volume: 0.3,
        fadeInUs: 0,
        fadeOutUs: 0,
        loopToFit: true,
        licenseKind: 'cc0',
        licenseAttribution: '',
        licenseVerified: true,
      },
      sfx: [
        {
          id: 9,
          assetId: 6,
          name: 'Whoosh',
          mediaId: 'audio/6',
          assetDurationUs: 1_200_000,
          anchor: { kind: 'moment', sourceUs: 12_000_000 },
          startUs: 2_000_000,
          endUs: 3_200_000,
          sourceStartUs: 12_000_000,
          volume: 0.8,
          fadeInUs: 0,
          fadeOutUs: 0,
          outsideClip: false,
          licenseKind: 'cc0',
          licenseAttribution: '',
          licenseVerified: true,
        },
      ],
      speechIntervals: [],
      totalDurationUs: 29_100_000,
      unverifiedCount: 0,
      warnings: [],
    },
    ...parcial,
  }
}

const BIBLIOTECA_PADRAO: AudioAsset[] = [
  {
    id: 5,
    kind: 'music',
    name: 'Fundo Lo-fi',
    durationUs: 30_000_000,
    sampleRate: 48_000,
    channels: 2,
    bytes: 65_536,
    sha256: 'abc',
    licenseKind: 'cc0',
    licenseAttribution: '',
    licenseVerified: true,
    mediaId: 'audio/5',
    createdAt: '2026-11-18T10:00:00Z',
  },
  {
    id: 6,
    kind: 'sfx',
    name: 'Whoosh',
    durationUs: 1_200_000,
    sampleRate: 48_000,
    channels: 2,
    bytes: 16_000,
    sha256: 'def',
    licenseKind: 'cc0',
    licenseAttribution: '',
    licenseVerified: true,
    mediaId: 'audio/6',
    createdAt: '2026-11-18T10:00:00Z',
  },
]

async function prepararSessao(opcoes: {
  doc?: EditorDocumento
  audioList?: AudioAsset[]
} = {}) {
  let doc = opcoes.doc ?? criarDoc()
  let biblioteca = [...(opcoes.audioList ?? BIBLIOTECA_PADRAO)]

  chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === 'editor.open') return doc
    if (cmd === 'editor.sentences') {
      return [
        { id: 1, startUs: 10_000_000, endUs: 15_000_000, text: 'Primeira frase antes' },
        { id: 2, startUs: 16_100_000, endUs: 25_000_000, text: 'Segunda frase depois' },
      ]
    }
    if (cmd === 'export.captions') return { style: { revision: 0 }, cues: [], emojiRemoved: 0, words: [], transcriptId: 1, start_us: 10_000_000, end_us: 40_000_000 }
    if (cmd === 'audio.list') return biblioteca
    if (cmd === 'translation.get') return { clipId: 1, sourceId: 1, permitted: true, permissionError: null, activeTrack: 'original', hasTranslation: false, sentences: [] }
    if (cmd === 'captions.remap_status') return { discarded: 0 }
    if (cmd === 'proxy.request') return { state: 'ready', key: 'p1', job: null, progress: 100, error: null }
    if (cmd === 'editor.timeline') return { state: 'ready', key: 'tl1', job: null, progress: 100, error: null, thumbs: null }
    if (cmd === 'editor.wave') return { blockUs: 100_000, values: [] }
    if (cmd === 'editor.silences.detect') {
      return { ...doc, silences: { ...doc.silences, thresholdUs: Number(args.threshold_us) } }
    }
    if (cmd === 'editor.silences.toggle') {
      return {
        ...doc,
        silences: {
          ...doc.silences,
          intervals: doc.silences.intervals.map((s) =>
            s.id === args.id ? { ...s, status: s.status === 'active' ? 'reverted' : 'active' } : s,
          ),
        },
      }
    }
    if (cmd === 'editor.silences.apply_all' || cmd === 'editor.silences.revert_all') return doc
    if (cmd === 'editor.audio.soundtrack.clear') {
      doc = { ...doc, audioMix: { ...doc.audioMix, soundtrack: null } }
      return doc
    }
    if (cmd === 'editor.audio.soundtrack.set') return doc
    if (cmd === 'editor.audio.sfx.remove') {
      doc = { ...doc, audioMix: { ...doc.audioMix, sfx: [] } }
      return doc
    }
    if (cmd === 'audio.import') {
      if (args.license_kind === 'cc_by' && !String(args.license_attribution ?? '').trim()) {
        throw { code: 'attribution_required', message: 'Informe a atribuição.' }
      }
      const novo: AudioAsset = {
        id: 99,
        kind: args.kind as 'music' | 'sfx',
        name: String(args.name ?? 'Nova trilha'),
        durationUs: 10_000_000,
        sampleRate: 48_000,
        channels: 2,
        bytes: 32_000,
        sha256: 'xyz',
        licenseKind: args.license_kind as AudioAsset['licenseKind'],
        licenseAttribution: String(args.license_attribution ?? ''),
        licenseVerified: args.license_kind !== 'unknown',
        mediaId: 'audio/99',
        createdAt: '2026-11-18T11:00:00Z',
      }
      biblioteca = [novo, ...biblioteca]
      return novo
    }
    if (cmd === 'audio.delete') {
      biblioteca = biblioteca.filter((a) => a.id !== args.id)
      return { deleted: true, id: args.id }
    }
    if (cmd === 'editor.undo') return { ...doc, undoCount: Math.max(0, doc.undoCount - 1), redoCount: doc.redoCount + 1 }
    if (cmd === 'editor.redo') return { ...doc, undoCount: doc.undoCount + 1, redoCount: Math.max(0, doc.redoCount - 1) }
    if (cmd === 'editor.flush') return null
    if (cmd === 'editor.snapshots') {
      return [
        {
          snapshot_id: 1,
          schemaVersion: 2,
          revision: 2,
          range: { startId: 1, endId: 3, startUs: 10_000_000, endUs: 40_000_000 },
          silences: { thresholdUs: 600_000, intervals: [{ id: 1 }] },
          crop: { layout: 'face', splitRatio: null },
        },
      ]
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
    fonteDisponivel: true,
  })
  return store
}

describe('<PopoverSilencios>', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => '/projetos/demo.clipes')
  })

  it('exibe regra 120/75/200 ms, slider 300–2000 ms (preview true/false), resumo tabular, Ouvir em contexto (1,5 s antes) e estado empty', async () => {
    const user = userEvent.setup()
    const aoOuvir = vi.fn()
    const store = await prepararSessao()
    const snap = store.obterSnapshot()

    const { unmount } = render(
      envolver(
        <PopoverSilencios
          aoOuvirEmContexto={aoOuvir}
          estadoEditor={{
            ...snap,
            documentoAtivo: snap.previaLocal ?? snap.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
        />,
      ),
    )

    expect(screen.getByText(/120 ms.*75 ms.*200 ms/i)).toBeInTheDocument()
    expect(screen.getByText('1 / 1')).toBeInTheDocument()

    const slider = screen.getByRole('slider', { name: 'Duração mínima da pausa' })
    expect(slider).toHaveAttribute('min', '300')
    expect(slider).toHaveAttribute('max', '2000')

    const wrapper = slider.closest('[data-slider-wrapper]')!
    fireEvent.pointerDown(wrapper)
    fireEvent.change(slider, { target: { value: '800' } })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.silences.detect',
        expect.objectContaining({ clip_id: 1, preview: true }),
      )
    })
    fireEvent.pointerUp(wrapper)
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.silences.detect',
        expect.objectContaining({ clip_id: 1, preview: false }),
      )
    })

    // Ouvir em contexto posiciona 1,5 s antes (15_120_000 - 1_500_000 = 13_620_000)
    await user.click(screen.getByRole('button', { name: /Ouvir em contexto/i }))
    expect(aoOuvir).toHaveBeenCalledWith(13_620_000)

    await user.click(screen.getByRole('button', { name: 'Manter pausa' }))
    expect(chamarMock).toHaveBeenCalledWith('editor.silences.toggle', { clip_id: 1, id: 1, preview: false })
    unmount()

    // Estado empty
    const docVazio = criarDoc({
      silences: { enabled: true, thresholdUs: 600_000, intervals: [], segments: [], removedUs: 0, effectiveDurationUs: 30_000_000 },
    })
    const storeVazio = await prepararSessao({ doc: docVazio })
    const snapVazio = storeVazio.obterSnapshot()
    render(
      envolver(
        <PopoverSilencios
          aoOuvirEmContexto={aoOuvir}
          estadoEditor={{
            ...snapVazio,
            documentoAtivo: snapVazio.previaLocal ?? snapVazio.oficial,
            store: storeVazio,
            abrir: storeVazio.abrir,
            salvarAgora: storeVazio.salvarAgora,
            garantirSalvoParaSaida: storeVazio.garantirSalvoParaSaida,
          }}
        />,
      ),
    )
    expect(screen.getByText(/Nenhuma pausa detectada/i)).toBeInTheDocument()
  })
})

describe('<PopoverAudio>', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => '/projetos/demo.clipes')
  })

  it('importar cc_by sem Atribuição bloqueia e foca campo; remover trilha/SFX é imediato sem ConfirmDialog; Excluir da biblioteca abre ConfirmDialog', async () => {
    const user = userEvent.setup()
    const store = await prepararSessao()
    const snap = store.obterSnapshot()

    render(
      envolver(
        <PopoverAudio
          tempoUs={14_000_000}
          estadoEditor={{
            ...snap,
            documentoAtivo: snap.previaLocal ?? snap.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
        />,
      ),
    )

    // Remover trilha imediato (sem ConfirmDialog)
    await user.click(screen.getByRole('button', { name: 'Remover trilha' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(chamarMock).toHaveBeenCalledWith('editor.audio.soundtrack.clear', { clip_id: 1, preview: false })

    // Remover SFX imediato (sem ConfirmDialog)
    await user.click(screen.getByRole('button', { name: 'Remover SFX Whoosh' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(chamarMock).toHaveBeenCalledWith('editor.audio.sfx.remove', { clip_id: 1, id: 9, preview: false })

    // Importar cc_by sem atribuição bloqueia e foca campo
    await user.click(screen.getByRole('button', { name: /Importar áudio/i }))
    await user.type(screen.getByLabelText('Arquivo de áudio'), 'C:\\musica.mp3')
    await user.click(screen.getByRole('combobox', { name: 'Origem / Licença' }))
    await user.click(await screen.findByRole('option', { name: /CC-BY/i }))
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))

    const campoAtribuicao = screen.getByLabelText('Atribuição')
    expect(campoAtribuicao).toHaveFocus()
    expect(screen.getByText(/Informe a atribuição/i)).toBeInTheDocument()
    expect(chamarMock).not.toHaveBeenCalledWith('audio.import', expect.anything())

    // Excluir da biblioteca abre ConfirmDialog com foco em Cancelar
    await user.click(screen.getByRole('button', { name: 'Excluir Fundo Lo-fi da biblioteca' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus())
    await user.click(screen.getByRole('button', { name: 'Excluir áudio' }))
    expect(chamarMock).toHaveBeenCalledWith('audio.delete', { id: 5 })
  })
})

describe('<PopoverHistorico>', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => '/projetos/demo.clipes')
  })

  it('exibe undo/redo, Salvar agora chama editor.flush e snapshots em somente leitura com Dica sem número de ticket (UI-12)', async () => {
    const user = userEvent.setup()
    const store = await prepararSessao()
    const snap = store.obterSnapshot()

    const { container } = render(
      envolver(
        <PopoverHistorico
          estadoEditor={{
            ...snap,
            documentoAtivo: snap.previaLocal ?? snap.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
        />,
      ),
    )

    expect(screen.getByText(/Fora do Desfazer do Corte/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Desfazer/i }))
    expect(chamarMock).toHaveBeenCalledWith('editor.undo', { clip_id: 1, preview: false })

    await user.click(screen.getByRole('button', { name: /Refazer/i }))
    expect(chamarMock).toHaveBeenCalledWith('editor.redo', { clip_id: 1, preview: false })

    await user.click(screen.getByRole('button', { name: /Salvar agora/i }))
    expect(chamarMock).toHaveBeenCalledWith('editor.flush', {})

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('editor.snapshots', { clip_id: 1 })
    })
    expect(await screen.findByText(/somente leitura/i)).toBeInTheDocument()
    const btnRestaurar = screen.getByRole('button', { name: 'Restaurar' })
    expect(btnRestaurar).toBeDisabled()

    await user.hover(btnRestaurar.parentElement!)
    const dica = await screen.findByText('Restaurar um ponto salvo ainda não está disponível.')
    expect(dica).toBeInTheDocument()
    expect(dica.textContent).not.toMatch(/#\d+/)
    expect(container.textContent).not.toMatch(/#\d+/)
  })
})
