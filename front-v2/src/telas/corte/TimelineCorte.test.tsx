import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { criarStoreEditorCorte, type EditorDocumento, type StoreEditorCorte } from '~/stores/editorCorte'
import { TimelineCorte } from '~/telas/corte/TimelineCorte'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
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

function criarDocBase(parcial: Partial<EditorDocumento> = {}): EditorDocumento {
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
    undoCount: 0,
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
      suggested: null,
      edits: [
        { timeUs: 95_000_000, x: 0.2, y: 0, width: 0.32, height: 1, cut: false },
        { timeUs: 115_000_000, x: 0.4, y: 0, width: 0.32, height: 1, cut: true },
      ],
      gameplayWebcam: null,
      twoPeople: null,
      resolved: [],
      hasCrop: true,
    },
    montage: {
      schemaVersion: 1,
      blocks: [
        {
          blockId: 101,
          position: 1,
          title: 'Abertura',
          mode: 'manual',
          anchorSentenceId: 10,
          manualSourceStartUs: 92_000_000,
          autoStartUs: 0,
          desiredStartUs: 2_000_000,
          startUs: 2_000_000,
          endUs: 12_000_000,
          durationUs: 10_000_000,
          estimated: false,
          pushedUs: 300_000,
          overflowUs: 0,
          sourceStartUs: 92_000_000,
          audioId: 101,
        },
      ],
      clipDurationUs: 49_200_000,
      narrationEndUs: 55_000_000,
      freezeTailUs: 5_800_000,
      totalDurationUs: 55_000_000,
      totalPushedUs: 300_000,
      usesEstimatedDurations: false,
      scriptApproved: true,
      warnings: [
        { code: 'block_pushed', message: 'Bloco empurrado +0,3 s', blockId: 101, amountUs: 300_000 },
        { code: 'long_freeze_tail', message: 'Cauda congelada > 5 s', amountUs: 5_800_000 },
      ],
    },
    audioMix: {
      soundtrack: {
        assetId: 5,
        name: 'Noturno 02',
        mediaId: 'audio/5',
        assetDurationUs: 30_000_000,
        startUs: 0,
        playDurationUs: 49_200_000,
        endUs: 49_200_000,
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
          id: 7,
          assetId: 6,
          name: 'Whoosh',
          mediaId: 'audio/6',
          assetDurationUs: 1_200_000,
          anchor: { kind: 'moment', sourceUs: 105_000_000 },
          wordText: null,
          startUs: 14_200_000,
          endUs: 15_400_000,
          sourceStartUs: 105_000_000,
          volume: 0.8,
          fadeInUs: 0,
          fadeOutUs: 0,
          outsideClip: false,
          licenseKind: 'cc0',
          licenseAttribution: '',
          licenseVerified: true,
        },
      ],
      speechIntervals: [{ startUs: 0, endUs: 10_000_000 }],
      totalDurationUs: 49_200_000,
      unverifiedCount: 0,
      warnings: [],
    },
    ...parcial,
  }
}

const FRASES_BASE = Array.from({ length: 20 }, (_, i) => {
  const id = i + 5
  return {
    id,
    startUs: (id - 1) * 10_000_000,
    endUs: id * 10_000_000,
    text: `Frase ${id}`,
  }
})

async function abrirStore(
  doc = criarDocBase(),
  opcoes: { fonteDisponivel?: boolean; timelineState?: 'ready' | 'running' } = {},
): Promise<StoreEditorCorte> {
  const fonteDisponivel = opcoes.fonteDisponivel ?? true
  const tlState = opcoes.timelineState ?? 'ready'
  let docAtual = doc

  chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === 'editor.open') return docAtual
    if (cmd === 'editor.sentences') return FRASES_BASE
    if (cmd === 'export.captions') {
      return {
        style: {
          schemaVersion: 1,
          revision: 0,
          preset: 'vertical',
          font: 'Noto Sans',
          fontSize: 64,
          color: '#FFFFFF',
          activeColor: '#FACC15',
          dimColor: '#FFFFFF',
          outlineColor: '#101010',
          outline: 6,
          shadow: 0,
          x: 540,
          y: 1440,
          highlight: true,
        },
        cues: [],
        emojiRemoved: 0,
        words: [],
        transcriptId: 4,
        start_us: docAtual.startUs,
        end_us: docAtual.endUs,
        missingGlyphs: [],
        track: 'original',
        availableTracks: ['original'],
        narrationSummary: null,
      }
    }
    if (cmd === 'audio.list') return []
    if (cmd === 'translation.get') {
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
    if (cmd === 'captions.remap_status') return { discarded: 0 }
    if (cmd === 'proxy.request') return { state: 'ready', key: 'px-1', job: null, progress: 100, error: null }
    if (cmd === 'editor.timeline') {
      return {
        state: tlState,
        key: 'tl-1',
        job: tlState === 'running' ? 88 : null,
        progress: tlState === 'running' ? 45 : 100,
        error: null,
        thumbs: tlState === 'ready' ? { id: 'thumbs/tl-1', count: 130, intervalUs: 2_000_000, width: 96, height: 54, columns: 20 } : null,
      }
    }
    if (cmd === 'editor.wave') {
      return { blockUs: 100_000, values: Array.from({ length: 120 }, (_, i) => 40 + (i % 50)) }
    }
    if (cmd === 'editor.adjust') {
      const next = { ...docAtual }
      if (args.edge === 'start') {
        if (typeof args.sentence_delta === 'number') {
          next.startUs = Math.max(0, docAtual.startUs + args.sentence_delta * 10_000_000)
        } else if (typeof args.sentence_id === 'number') {
          next.startUs = (args.sentence_id - 1) * 10_000_000
        } else if (typeof args.time_us === 'number') {
          next.startUs = args.time_us
        }
      } else {
        if (typeof args.sentence_delta === 'number') {
          next.endUs = docAtual.endUs + args.sentence_delta * 10_000_000
        } else if (typeof args.sentence_id === 'number') {
          next.endUs = args.sentence_id * 10_000_000
        } else if (typeof args.time_us === 'number') {
          next.endUs = args.time_us
        }
      }
      if (!args.preview) docAtual = next
      return next
    }
    if (cmd === 'editor.montage.set_start') {
      return docAtual
    }
    if (cmd === 'editor.audio.sfx.update') {
      return docAtual
    }
    if (cmd === 'jobs.cancel') {
      return { cancelled: true }
    }
    return null
  })

  const store = criarStoreEditorCorte()
  store.definirProjeto('/projetos/Demo.clipes')
  await store.abrir({
    corteId: '201',
    sourceId: doc.request.source_id,
    startId: doc.request.start_id,
    endId: doc.request.end_id,
    candidateId: doc.request.candidate_id,
    fonteDisponivel,
  })
  return store
}

describe('TimelineCorte', () => {
  beforeEach(() => {
    chamarMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renderiza por padrão 2 faixas (Vídeo e Áudio) e oculta as 3 extras até clicar em "+3 faixas"', async () => {
    const user = userEvent.setup()
    const store = await abrirStore()

    render(
      envolver(
        <TimelineCorte
          videoKind="transformed"
          fonteDisponivel={true}
          store={store}
          tempoAtualUs={105_000_000}
        />,
      ),
    )

    expect(screen.getByText('Vídeo')).toBeInTheDocument()
    expect(screen.getByText('Áudio')).toBeInTheDocument()
    expect(screen.queryByText('Frases & Keyframes')).not.toBeInTheDocument()
    expect(screen.queryByText('Narração')).not.toBeInTheDocument()
    expect(screen.queryByText('Trilha & SFX')).not.toBeInTheDocument()

    const btnExtras = screen.getByRole('button', { name: /\+3 faixas/i })
    expect(btnExtras).toHaveAttribute('aria-expanded', 'false')

    await user.click(btnExtras)
    expect(screen.getByText('Frases & Keyframes')).toBeInTheDocument()
    expect(screen.getByText('Narração')).toBeInTheDocument()
    expect(screen.getByText('Trilha & SFX')).toBeInTheDocument()
  })

  it('alças Entrada e Saída têm role="slider", aria-valuetext legível, alvo >= 24px e respondem a +/-1 Frase, Alt+/-1 quadro e PageUp/PageDown (5 Frases)', async () => {
    const user = userEvent.setup()
    const store = await abrirStore()

    render(
      envolver(
        <TimelineCorte
          videoKind="direct"
          fonteDisponivel={true}
          store={store}
        />,
      ),
    )

    const alcaEntrada = screen.getByRole('slider', { name: /alça entrada/i })
    const alcaSaida = screen.getByRole('slider', { name: /alça saída/i })

    expect(alcaEntrada).toHaveAttribute('aria-valuetext', expect.stringMatching(/Entrada em \d{2}:\d{2}:\d{2}\.\d{3} da Fonte/))
    expect(alcaSaida).toHaveAttribute('aria-valuetext', expect.stringMatching(/Saída em \d{2}:\d{2}:\d{2}\.\d{3} da Fonte/))
    expect(alcaEntrada.className).toContain('min-w-6')
    expect(alcaEntrada.className).toContain('min-h-6')

    alcaEntrada.focus()
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.adjust',
        expect.objectContaining({ edge: 'start', sentence_delta: -1, preview: false }),
      )
    })

    chamarMock.mockClear()
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}')
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.adjust',
        expect.objectContaining({ edge: 'start', free: true, preview: false }),
      )
    })

    chamarMock.mockClear()
    await user.keyboard('{PageUp}')
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.adjust',
        expect.objectContaining({ edge: 'start', sentence_id: 14, preview: false }),
      )
    })
  })

  it('arrastar alça Entrada envia editor.adjust preview:true (acionando aoMudarOverlayBorda com livrePorQuadro) e preview:false ao soltar', async () => {
    const store = await abrirStore()
    const aoMudarOverlayBorda = vi.fn()

    render(
      envolver(
        <TimelineCorte
          videoKind="direct"
          fonteDisponivel={true}
          store={store}
          aoMudarOverlayBorda={aoMudarOverlayBorda}
        />,
      ),
    )

    const pista = screen.getByTestId('timeline-pista')
    vi.spyOn(pista, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 1000,
      width: 1000,
      top: 0,
      bottom: 80,
      height: 80,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    const alcaEntrada = screen.getByRole('slider', { name: /alça entrada/i })
    fireEvent.pointerDown(alcaEntrada, { clientX: 350, pointerId: 1, altKey: true })
    fireEvent.pointerMove(alcaEntrada, { clientX: 300, pointerId: 1, altKey: true })

    await waitFor(() => {
      expect(aoMudarOverlayBorda).toHaveBeenCalledWith(
        expect.objectContaining({ lado: 'start', livrePorQuadro: true }),
      )
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.adjust',
        expect.objectContaining({ edge: 'start', free: true, preview: true }),
      )
    })

    fireEvent.pointerUp(alcaEntrada, { clientX: 300, pointerId: 1, altKey: true })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.adjust',
        expect.objectContaining({ edge: 'start', free: true, preview: false }),
      )
      expect(aoMudarOverlayBorda).toHaveBeenLastCalledWith(null)
    })
  })

  it('mini-mapa, agulha role="slider" e zoom funcionam; +3 faixas mostra Narração (block_pushed, Cauda > 5s) apenas em Vídeo transformado e Trilha/SFX', async () => {
    const user = userEvent.setup()
    const store = await abrirStore()
    const aoMudarTempoUs = vi.fn()

    const { rerender } = render(
      envolver(
        <TimelineCorte
          videoKind="transformed"
          fonteDisponivel={true}
          store={store}
          tempoAtualUs={100_000_000}
          aoMudarTempoUs={aoMudarTempoUs}
        />,
      ),
    )

    expect(screen.getByRole('region', { name: /mini-mapa/i })).toBeInTheDocument()
    const agulha = screen.getByRole('slider', { name: /agulha/i })
    agulha.focus()
    await user.keyboard('{ArrowRight}')
    expect(aoMudarTempoUs).toHaveBeenCalledWith(100_100_000, false)

    // Zoom
    await user.click(screen.getByRole('button', { name: /aumentar zoom/i }))
    expect(screen.getByText(/150%/i)).toBeInTheDocument()

    // Expandir +3 faixas em Vídeo transformado
    await user.click(screen.getByRole('button', { name: /\+3 faixas/i }))
    expect(screen.getByText(/empurrado/i)).toBeInTheDocument()
    expect(screen.getByText(/cauda congelada/i)).toBeInTheDocument()

    // Arrastar bloco de Narração envia editor.montage.set_start
    const blocoNar = screen.getByTestId('narracao-bloco-101')
    const pistaNar = blocoNar.parentElement!
    vi.spyOn(pistaNar, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 1000,
      width: 1000,
      top: 0,
      bottom: 30,
      height: 30,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent.pointerDown(blocoNar, { clientX: 350, pointerId: 1 })
    fireEvent.pointerMove(blocoNar, { clientX: 380, pointerId: 1 })
    fireEvent.pointerUp(blocoNar, { clientX: 380, pointerId: 1 })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.montage.set_start',
        expect.objectContaining({ block_id: 101, preview: false }),
      )
    })

    // Arrastar pino SFX envia editor.audio.sfx.update
    const pinoSfx = screen.getByTestId('sfx-pino-7')
    const pistaAudio = pinoSfx.parentElement!
    vi.spyOn(pistaAudio, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 1000,
      width: 1000,
      top: 0,
      bottom: 30,
      height: 30,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent.pointerDown(pinoSfx, { clientX: 400, pointerId: 2 })
    fireEvent.pointerMove(pinoSfx, { clientX: 450, pointerId: 2 })
    fireEvent.pointerUp(pinoSfx, { clientX: 450, pointerId: 2 })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.audio.sfx.update',
        expect.objectContaining({ id: 7, preview: false }),
      )
    })

    // Em Corte direto, oculta faixa Narração
    rerender(
      envolver(
        <TimelineCorte
          videoKind="direct"
          fonteDisponivel={true}
          store={store}
          tempoAtualUs={100_000_000}
        />,
      ),
    )
    expect(screen.queryByText('Narração')).not.toBeInTheDocument()
  })

  it('com Fonte offline, botões ±1 Frase continuam funcionando sem erro fatal por falta de thumbs', async () => {
    const user = userEvent.setup()
    const store = await abrirStore(criarDocBase(), { fonteDisponivel: false })

    render(
      envolver(
        <TimelineCorte
          videoKind="direct"
          fonteDisponivel={false}
          store={store}
        />,
      ),
    )

    expect(screen.getByText(/fonte offline — bordas por frase disponíveis/i)).toBeInTheDocument()
    const recuarEntrada = screen.getByRole('button', { name: /recuar entrada 1 frase/i })
    await user.click(recuarEntrada)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.adjust',
        expect.objectContaining({ edge: 'start', sentence_delta: -1, preview: false }),
      )
    })
  })

  it('quando timeline está running exibe Progresso inline e botão Cancelar chama jobs.cancel; clicar no mini-mapa reposiciona agulha', async () => {
    const user = userEvent.setup()
    const store = await abrirStore(criarDocBase(), { timelineState: 'running' })
    const aoMudarTempoUs = vi.fn()

    render(
      envolver(
        <TimelineCorte
          videoKind="direct"
          fonteDisponivel={true}
          store={store}
          aoMudarTempoUs={aoMudarTempoUs}
        />,
      ),
    )

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('jobs.cancel', { id: 88 })
    })

    const minimapa = screen.getByRole('region', { name: /mini-mapa/i })
    vi.spyOn(minimapa, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 1000,
      width: 1000,
      top: 0,
      bottom: 14,
      height: 14,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent.pointerDown(minimapa, { clientX: 500 })
    expect(aoMudarTempoUs).toHaveBeenCalledWith(130_000_000, false)
  })
})
