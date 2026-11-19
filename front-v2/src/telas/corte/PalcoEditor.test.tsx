import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorDicas, ProvedorToast, type AcaoBarra } from '@ds'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import { criarStoreEditorCorte, type EditorDocumento } from '~/stores/editorCorte'
import { PalcoEditor } from '~/telas/corte/PalcoEditor'

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
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
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
    silences: {
      enabled: true,
      thresholdUs: 600_000,
      intervals: [
        {
          id: 1,
          startUs: 15_120_000,
          endUs: 15_920_000,
          gapStartUs: 15_000_000,
          gapEndUs: 16_000_000,
          status: 'active',
        },
      ],
      segments: [
        { sourceStartUs: 10_000_000, sourceEndUs: 15_120_000, outputStartUs: 0, outputEndUs: 5_120_000 },
        { sourceStartUs: 15_920_000, sourceEndUs: 40_000_000, outputStartUs: 5_120_000, outputEndUs: 29_200_000 },
      ],
      removedUs: 800_000,
      effectiveDurationUs: 29_200_000,
    },
    crop: {
      layout: 'face',
      explicitLayout: 'face',
      splitRatio: 0.3,
      suggested: null,
      edits: [{ timeUs: 10_000_000, x: 0.34, y: 0, width: 0.32, height: 1 }],
      gameplayWebcam: null,
      twoPeople: null,
      resolved: [],
      hasCrop: true,
    },
    montage: null,
    audioMix: {
      soundtrack: {
        assetId: 10,
        name: 'Noturno',
        mediaId: 'audio/10',
        assetDurationUs: 12_000_000,
        startUs: 0,
        playDurationUs: 29_200_000,
        endUs: 29_200_000,
        volume: 0.3,
        fadeInUs: 0,
        fadeOutUs: 0,
        loopToFit: true,
        licenseKind: 'cc0',
        licenseAttribution: '',
        licenseVerified: true,
      },
      sfx: [],
      speechIntervals: [{ startUs: 0, endUs: 5_000_000 }],
      totalDurationUs: 29_200_000,
      unverifiedCount: 0,
      warnings: [],
    },
    ...parcial,
  }
}

function criarLegendas() {
  return {
    style: {
      schemaVersion: 1 as const,
      revision: 0,
      preset: 'vertical' as const,
      font: 'Noto Sans' as const,
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
    cues: [
      {
        startUs: 0,
        endUs: 4_000_000,
        lines: [
          [
            {
              position: 1,
              text: 'Palavra',
              startUs: 0,
              endUs: 1_500_000,
              color: '#FFFFFF',
              activeColor: '#FACC15',
              highlight: true,
            },
            {
              position: 2,
              text: 'ativa',
              startUs: 1_500_000,
              endUs: 3_000_000,
              color: '#FFFFFF',
              activeColor: '#FACC15',
              highlight: true,
            },
          ],
        ],
      },
    ],
    emojiRemoved: 0,
    words: [],
    transcriptId: 1,
    start_us: 10_000_000,
    end_us: 40_000_000,
    missingGlyphs: [],
    track: 'original' as const,
    availableTracks: ['original' as const],
    narrationSummary: null,
  }
}

async function prepararSessao(opcoes: {
  doc?: EditorDocumento
  fonteDisponivel?: boolean
  proxyState?: { state: 'idle' | 'queued' | 'running' | 'ready' | 'failed' | 'offline'; key: string | null; job: number | null; progress: number; error: { code: string; message: string } | null }
} = {}) {
  const doc = opcoes.doc ?? criarDoc()
  const proxy = opcoes.proxyState ?? { state: 'ready', key: 'proxy-1', job: null, progress: 100, error: null }
  chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === 'editor.open') return doc
    if (cmd === 'editor.sentences') return [{ id: 1, startUs: 10_000_000, endUs: 20_000_000, text: 'Palavra ativa aqui' }]
    if (cmd === 'export.captions') return criarLegendas()
    if (cmd === 'audio.list') return []
    if (cmd === 'translation.get') return { clipId: 1, sourceId: 1, permitted: true, permissionError: null, activeTrack: 'original', hasTranslation: false, sentences: [] }
    if (cmd === 'captions.remap_status') return { discarded: 0 }
    if (cmd === 'proxy.request') return proxy
    if (cmd === 'editor.timeline') return { state: 'ready', key: 'tl-1', job: null, progress: 100, error: null, thumbs: null }
    if (cmd === 'editor.wave') return { blockUs: 100_000, values: [] }
    if (cmd === 'editor.crop.set_edits') {
      const edits = (args.edits as EditorDocumento['crop']['edits']) ?? []
      const panel = (args.panel as 'primary' | 'top' | 'bottom') ?? 'primary'
      if (panel === 'primary') {
        return { clipId: doc.clipId, schemaVersion: 2, revision: doc.revision + 1, undoCount: doc.undoCount + (args.preview ? 0 : 1), redoCount: 0, ...doc.crop, edits }
      }
      const dual = doc.crop.gameplayWebcam ?? {
        top: { suggested: null, edits: [] },
        bottom: { suggested: null, edits: [] },
      }
      return {
        clipId: doc.clipId,
        schemaVersion: 2,
        revision: doc.revision + 1,
        undoCount: doc.undoCount + (args.preview ? 0 : 1),
        redoCount: 0,
        ...doc.crop,
        gameplayWebcam: {
          top: panel === 'top' ? { ...dual.top, edits } : dual.top,
          bottom: panel === 'bottom' ? { ...dual.bottom, edits } : dual.bottom,
        },
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

const ACOES_EXEMPLO: AcaoBarra[] = [
  { id: 'enquadrar', rotulo: 'Enquadrar', icone: <span />, conteudo: <div>Conteúdo Enquadrar</div> },
  { id: 'legenda', rotulo: 'Legenda', icone: <span />, conteudo: <div>Conteúdo Legenda</div> },
  { id: 'silencios', rotulo: 'Silêncios', icone: <span />, conteudo: <div>Conteúdo Silêncios</div> },
  { id: 'audio', rotulo: 'Áudio', icone: <span />, conteudo: <div>Conteúdo Áudio</div> },
  { id: 'historico', rotulo: 'Histórico', icone: <span />, conteudo: <div>Conteúdo Histórico</div> },
]

describe('<PalcoEditor>', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => '/projetos/demo.clipes')
  })

  it('renderiza Prévia 9:16 com camada de legenda via render.ts e áudio com duckingMath.ts, e alterna para Enquadrar na Fonte 16:9 com 8 alças e Topo/Base em gameplay_webcam', async () => {
    const user = userEvent.setup()
    const docDual = criarDoc({
      crop: {
        layout: 'gameplay_webcam',
        explicitLayout: 'gameplay_webcam',
        splitRatio: 0.3,
        suggested: null,
        edits: [],
        gameplayWebcam: {
          top: { suggested: null, edits: [{ timeUs: 10_000_000, x: 0.05, y: 0.05, width: 0.3, height: 0.3 }] },
          bottom: { suggested: null, edits: [{ timeUs: 10_000_000, x: 0.2, y: 0.2, width: 0.6, height: 0.7 }] },
        },
        twoPeople: null,
        resolved: [],
        hasCrop: true,
      },
    })
    const store = await prepararSessao({ doc: docDual })
    const snap = store.obterSnapshot()

    render(
      envolver(
        <PalcoEditor
          projetoPath="/projetos/demo.clipes"
          corteId="10"
          estadoEditor={{
            ...snap,
            documentoAtivo: snap.previaLocal ?? snap.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
          tempoUs={10_500_000}
          reproduzindo={false}
          acoesBarra={ACOES_EXEMPLO}
          popoverAberto={null}
          aoMudarPopoverAberto={() => {}}
          aoMudarTempoUs={() => {}}
          aoMudarReproduzindo={() => {}}
          aoRelocalizarFonte={() => {}}
        />,
      ),
    )

    // Legenda ao vivo via render.ts (drawCaption)
    const camadaLegenda = screen.getByTestId('camada-legendas')
    expect(camadaLegenda.querySelector('[data-caption-cue]')).toBeTruthy()
    expect(within(camadaLegenda).getAllByText('Palavra').length).toBeGreaterThanOrEqual(1)
    expect(within(camadaLegenda).getByText('ativa')).toBeInTheDocument()

    // Indicador de ganho com ducking (-12 dB sob fala no instante 0.5 s)
    const audioSoundtrack = screen.getByTestId('audio-trilha-previa') as HTMLAudioElement
    expect(audioSoundtrack.volume).toBeLessThan(0.15)

    // Seletor Topo / Base visível para gameplay_webcam
    expect(screen.getByRole('radiogroup', { name: 'Painel ativo' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Topo' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Base' })).toBeInTheDocument()

    // Alterna para Enquadrar na Fonte 16:9
    await user.click(screen.getByRole('radio', { name: 'Enquadrar na Fonte 16:9' }))

    const quadroFonte = screen.getByTestId('quadro-fonte-16-9')
    expect(quadroFonte).toBeInTheDocument()
    // 8 alças de redimensionamento presentes
    const alcas = quadroFonte.querySelectorAll('[data-alca-crop]')
    expect(alcas).toHaveLength(8)
  })

  it('mover retângulo no modo Fonte 16:9 por ponteiro ou setas de teclado chama editor.crop.set_edits (preview: true/false)', async () => {
    const user = userEvent.setup()
    const store = await prepararSessao()
    const snap = store.obterSnapshot()

    render(
      envolver(
        <PalcoEditor
          projetoPath="/projetos/demo.clipes"
          corteId="10"
          estadoEditor={{
            ...snap,
            documentoAtivo: snap.previaLocal ?? snap.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
          tempoUs={10_000_000}
          reproduzindo={false}
          acoesBarra={ACOES_EXEMPLO}
          popoverAberto={null}
          aoMudarPopoverAberto={() => {}}
          aoMudarTempoUs={() => {}}
          aoMudarReproduzindo={() => {}}
          aoRelocalizarFonte={() => {}}
        />,
      ),
    )

    await user.click(screen.getByRole('radio', { name: 'Enquadrar na Fonte 16:9' }))
    const retangulo = screen.getByTestId('retangulo-crop-ativo')
    vi.spyOn(screen.getByTestId('quadro-fonte-16-9'), 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 640,
      height: 360,
      right: 640,
      bottom: 360,
      toJSON: () => {},
    })

    // Arrasto por ponteiro: preview: true no move e preview: false no pointerup
    fireEvent.pointerDown(retangulo, { clientX: 200, clientY: 180, pointerId: 1 })
    fireEvent.pointerMove(retangulo, { clientX: 232, clientY: 180, pointerId: 1 })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.crop.set_edits',
        expect.objectContaining({ clip_id: 1, panel: 'primary', preview: true }),
      )
    })

    fireEvent.pointerUp(retangulo, { clientX: 232, clientY: 180, pointerId: 1 })
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.crop.set_edits',
        expect.objectContaining({ clip_id: 1, panel: 'primary', preview: false }),
      )
    })

    // Movimento por teclado (setas)
    chamarMock.mockClear()
    retangulo.focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'editor.crop.set_edits',
        expect.objectContaining({ clip_id: 1, panel: 'primary', preview: false }),
      )
    })
  })

  it('overlayBorda exibe timecode na Fonte e selo Encaixe em Frase vs Livre por quadro (Alt)', async () => {
    const store = await prepararSessao()
    const snap = store.obterSnapshot()
    const baseProps = {
      projetoPath: '/projetos/demo.clipes',
      corteId: '10',
      estadoEditor: {
        ...snap,
        documentoAtivo: snap.previaLocal ?? snap.oficial,
        store,
        abrir: store.abrir,
        salvarAgora: store.salvarAgora,
        garantirSalvoParaSaida: store.garantirSalvoParaSaida,
      },
      tempoUs: 10_000_000,
      reproduzindo: false,
      acoesBarra: ACOES_EXEMPLO,
      popoverAberto: null,
      aoMudarPopoverAberto: () => {},
      aoMudarTempoUs: () => {},
      aoMudarReproduzindo: () => {},
      aoRelocalizarFonte: () => {},
    }

    const { rerender } = render(
      envolver(
        <PalcoEditor
          {...baseProps}
          overlayBorda={{ edge: 'start', timeUs: 65_000_000, livrePorQuadro: false }}
        />,
      ),
    )

    expect(screen.getByText('00:01:05')).toBeInTheDocument()
    expect(screen.getByText('Encaixe em Frase')).toBeInTheDocument()

    rerender(
      envolver(
        <PalcoEditor
          {...baseProps}
          overlayBorda={{ edge: 'end', timeUs: 125_000_000, livrePorQuadro: true }}
        />,
      ),
    )

    expect(screen.getByText('00:02:05')).toBeInTheDocument()
    expect(screen.getByText('Livre por quadro (Alt)')).toBeInTheDocument()
  })

  it('Fonte offline bloqueia <video> e exibe Relocalizar arquivo; proxy running exibe Progresso e Cancelar (jobs.cancel)', async () => {
    const user = userEvent.setup()
    const aoRelocalizar = vi.fn()
    const storeOffline = await prepararSessao({ fonteDisponivel: false })
    const snapOffline = storeOffline.obterSnapshot()

    const { unmount } = render(
      envolver(
        <PalcoEditor
          projetoPath="/projetos/demo.clipes"
          corteId="10"
          estadoEditor={{
            ...snapOffline,
            documentoAtivo: snapOffline.previaLocal ?? snapOffline.oficial,
            store: storeOffline,
            abrir: storeOffline.abrir,
            salvarAgora: storeOffline.salvarAgora,
            garantirSalvoParaSaida: storeOffline.garantirSalvoParaSaida,
          }}
          tempoUs={10_000_000}
          reproduzindo={false}
          acoesBarra={ACOES_EXEMPLO}
          popoverAberto={null}
          aoMudarPopoverAberto={() => {}}
          aoMudarTempoUs={() => {}}
          aoMudarReproduzindo={() => {}}
          aoRelocalizarFonte={aoRelocalizar}
        />,
      ),
    )

    expect(document.querySelector('video')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Relocalizar arquivo' }))
    expect(aoRelocalizar).toHaveBeenCalledTimes(1)
    unmount()

    // Proxy running + jobs.cancel
    const storeProxy = await prepararSessao({
      proxyState: { state: 'running', key: null, job: 88, progress: 42, error: null },
    })
    const snapProxy = storeProxy.obterSnapshot()

    render(
      envolver(
        <PalcoEditor
          projetoPath="/projetos/demo.clipes"
          corteId="10"
          estadoEditor={{
            ...snapProxy,
            documentoAtivo: snapProxy.previaLocal ?? snapProxy.oficial,
            store: storeProxy,
            abrir: storeProxy.abrir,
            salvarAgora: storeProxy.salvarAgora,
            garantirSalvoParaSaida: storeProxy.garantirSalvoParaSaida,
          }}
          tempoUs={10_000_000}
          reproduzindo={false}
          acoesBarra={ACOES_EXEMPLO}
          popoverAberto={null}
          aoMudarPopoverAberto={() => {}}
          aoMudarTempoUs={() => {}}
          aoMudarReproduzindo={() => {}}
          aoRelocalizarFonte={() => {}}
        />,
      ),
    )

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(chamarMock).toHaveBeenCalledWith('jobs.cancel', { id: 88 })

    // Proxy failed + Tentar novamente
    const storeFalha = await prepararSessao({
      proxyState: { state: 'failed', key: null, job: null, progress: 0, error: { code: 'proxy_failed', message: 'Falha' } },
    })
    const snapFalha = storeFalha.obterSnapshot()
    render(
      envolver(
        <PalcoEditor
          projetoPath="/projetos/demo.clipes"
          corteId="10"
          estadoEditor={{
            ...snapFalha,
            documentoAtivo: snapFalha.previaLocal ?? snapFalha.oficial,
            store: storeFalha,
            abrir: storeFalha.abrir,
            salvarAgora: storeFalha.salvarAgora,
            garantirSalvoParaSaida: storeFalha.garantirSalvoParaSaida,
          }}
          tempoUs={10_000_000}
          reproduzindo={false}
          acoesBarra={ACOES_EXEMPLO}
          popoverAberto={null}
          aoMudarPopoverAberto={() => {}}
          aoMudarTempoUs={() => {}}
          aoMudarReproduzindo={() => {}}
          aoRelocalizarFonte={() => {}}
        />,
      ),
    )
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(chamarMock).toHaveBeenCalledWith('proxy.request', expect.objectContaining({ source_id: 1 }))
  })

  it('<Transporte> e <BarraAcoes> ficam na mesma faixa, abrem um popover de cada vez ao lado do quadro e Ctrl+] alterna o último popover', async () => {
    const user = userEvent.setup()
    const store = await prepararSessao()
    const snap = store.obterSnapshot()
    const aoMudarPopover = vi.fn()

    const { rerender } = render(
      envolver(
        <PalcoEditor
          projetoPath="/projetos/demo.clipes"
          corteId="10"
          estadoEditor={{
            ...snap,
            documentoAtivo: snap.previaLocal ?? snap.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
          tempoUs={10_000_000}
          reproduzindo={false}
          acoesBarra={ACOES_EXEMPLO}
          popoverAberto={null}
          aoMudarPopoverAberto={aoMudarPopover}
          aoMudarTempoUs={() => {}}
          aoMudarReproduzindo={() => {}}
          aoRelocalizarFonte={() => {}}
        />,
      ),
    )

    const transporte = screen.getByRole('toolbar', { name: 'Controles de reprodução' })
    const barraAcoes = screen.getByRole('toolbar', { name: 'Ferramentas do Corte' })
    expect(transporte.parentElement).toBe(barraAcoes.parentElement)

    await user.click(within(barraAcoes).getByRole('button', { name: 'Enquadrar' }))
    expect(aoMudarPopover).toHaveBeenCalledWith('enquadrar')

    rerender(
      envolver(
        <PalcoEditor
          projetoPath="/projetos/demo.clipes"
          corteId="10"
          estadoEditor={{
            ...snap,
            documentoAtivo: snap.previaLocal ?? snap.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
          tempoUs={10_000_000}
          reproduzindo={false}
          acoesBarra={ACOES_EXEMPLO}
          popoverAberto="enquadrar"
          aoMudarPopoverAberto={aoMudarPopover}
          aoMudarTempoUs={() => {}}
          aoMudarReproduzindo={() => {}}
          aoRelocalizarFonte={() => {}}
        />,
      ),
    )

    expect(screen.getByText('Conteúdo Enquadrar')).toBeInTheDocument()

    // Ctrl+] fecha quando aberto
    fireEvent.keyDown(window, { key: ']', ctrlKey: true })
    expect(aoMudarPopover).toHaveBeenCalledWith(null)
  })

  it('UI-64 / UI-65: <Transporte> adapta tooltips ao modo WCAG 2.1.4 e <BarraAcoes> mantém cabeçalho fixo fora da rolagem', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'clipes.preferencias.v1',
      JSON.stringify({ modoTeclasUnicas: 'alt', teclasUnicas: true }),
    )
    const store = await prepararSessao()
    const snap = store.obterSnapshot()

    const { unmount } = render(
      envolver(
        <PalcoEditor
          projetoPath="/projetos/demo.clipes"
          corteId="10"
          estadoEditor={{
            ...snap,
            documentoAtivo: snap.previaLocal ?? snap.oficial,
            store,
            abrir: store.abrir,
            salvarAgora: store.salvarAgora,
            garantirSalvoParaSaida: store.garantirSalvoParaSaida,
          }}
          tempoUs={10_000_000}
          reproduzindo={false}
          acoesBarra={ACOES_EXEMPLO}
          popoverAberto="enquadrar"
          aoMudarPopoverAberto={() => {}}
          aoMudarTempoUs={() => {}}
          aoMudarReproduzindo={() => {}}
          aoRelocalizarFonte={() => {}}
        />,
      ),
    )

    // UI-65: cabeçalho do popover fica fora do container com overflow-y-auto
    const fecharBtn = screen.getByRole('button', { name: 'Fechar (Esc)' })
    const headerPopover = fecharBtn.parentElement!
    expect(headerPopover.parentElement?.className).not.toContain('overflow-y-auto')

    // UI-64: tooltips no Transporte adaptam ao modo 'alt'
    await user.hover(screen.getByRole('button', { name: 'Reproduzir' }))
    expect(await screen.findByText('Alt+Espaço')).toBeInTheDocument()

    await user.hover(screen.getByRole('button', { name: 'Definir Entrada' }))
    expect(await screen.findByText('Shift+Alt+I')).toBeInTheDocument()

    unmount()
    localStorage.clear()
  })

  it('posiciona <video> do proxy relativo a windowStartUs (e usa fallback max(0, startUs - 120 s) quando ausente)', async () => {
    const user = userEvent.setup()

    // 1) Corte depois de 2 min na Fonte com windowStartUs explícito (layout duplo cobre principal + secundário, e alterna para Fonte 16:9)
    const docComJanela = criarDoc({
      startUs: 600_000_000,
      endUs: 630_000_000,
      windowStartUs: 480_000_000,
      windowEndUs: 750_000_000,
      crop: {
        layout: 'gameplay_webcam',
        explicitLayout: 'gameplay_webcam',
        splitRatio: 0.3,
        suggested: null,
        edits: [],
        gameplayWebcam: {
          top: { suggested: null, edits: [{ timeUs: 600_000_000, x: 0.05, y: 0.05, width: 0.3, height: 0.3 }] },
          bottom: { suggested: null, edits: [{ timeUs: 600_000_000, x: 0.2, y: 0.2, width: 0.6, height: 0.7 }] },
        },
        twoPeople: null,
        resolved: [],
        hasCrop: true,
      },
    })
    const storeComJanela = await prepararSessao({ doc: docComJanela })
    const snapComJanela = storeComJanela.obterSnapshot()

    const { unmount: unmount1 } = render(
      envolver(
        <PalcoEditor
          projetoPath="/projetos/demo.clipes"
          corteId="10"
          estadoEditor={{
            ...snapComJanela,
            documentoAtivo: snapComJanela.previaLocal ?? snapComJanela.oficial,
            store: storeComJanela,
            abrir: storeComJanela.abrir,
            salvarAgora: storeComJanela.salvarAgora,
            garantirSalvoParaSaida: storeComJanela.garantirSalvoParaSaida,
          }}
          tempoUs={605_000_000}
          reproduzindo={false}
          acoesBarra={ACOES_EXEMPLO}
          popoverAberto={null}
          aoMudarPopoverAberto={() => {}}
          aoMudarTempoUs={() => {}}
          aoMudarReproduzindo={() => {}}
          aoRelocalizarFonte={() => {}}
        />,
      ),
    )

    const videosDuplo = Array.from(document.querySelectorAll('video'))
    expect(videosDuplo).toHaveLength(2)
    for (const v of videosDuplo) {
      expect(v.currentTime).toBeCloseTo(125, 3)
    }

    await user.click(screen.getByRole('radio', { name: 'Enquadrar na Fonte 16:9' }))
    const videoFonte = screen.getByTestId('quadro-fonte-16-9').querySelector('video')
    expect(videoFonte).not.toBeNull()
    expect(videoFonte!.currentTime).toBeCloseTo(125, 3)
    unmount1()

    // 2) Ausência de windowStartUs com startUs > 120 s (fallback: startUs - 120 s = 480 s)
    const docSemJanela = criarDoc({
      startUs: 600_000_000,
      endUs: 630_000_000,
      windowStartUs: undefined,
      windowEndUs: undefined,
    })
    const storeSemJanela = await prepararSessao({ doc: docSemJanela })
    const snapSemJanela = storeSemJanela.obterSnapshot()

    const { unmount: unmount2 } = render(
      envolver(
        <PalcoEditor
          projetoPath="/projetos/demo.clipes"
          corteId="10"
          estadoEditor={{
            ...snapSemJanela,
            documentoAtivo: snapSemJanela.previaLocal ?? snapSemJanela.oficial,
            store: storeSemJanela,
            abrir: storeSemJanela.abrir,
            salvarAgora: storeSemJanela.salvarAgora,
            garantirSalvoParaSaida: storeSemJanela.garantirSalvoParaSaida,
          }}
          tempoUs={605_000_000}
          reproduzindo={false}
          acoesBarra={ACOES_EXEMPLO}
          popoverAberto={null}
          aoMudarPopoverAberto={() => {}}
          aoMudarTempoUs={() => {}}
          aoMudarReproduzindo={() => {}}
          aoRelocalizarFonte={() => {}}
        />,
      ),
    )

    const videoFallback = document.querySelector('video')
    expect(videoFallback).not.toBeNull()
    expect(videoFallback!.currentTime).toBeCloseTo(125, 3)
    unmount2()

    // 3) Ausência de windowStartUs nos primeiros 2 min (fallback limitado a 0)
    const docInicio = criarDoc({
      startUs: 30_000_000,
      endUs: 60_000_000,
      windowStartUs: undefined,
      windowEndUs: undefined,
    })
    const storeInicio = await prepararSessao({ doc: docInicio })
    const snapInicio = storeInicio.obterSnapshot()

    const { unmount: unmount3 } = render(
      envolver(
        <PalcoEditor
          projetoPath="/projetos/demo.clipes"
          corteId="10"
          estadoEditor={{
            ...snapInicio,
            documentoAtivo: snapInicio.previaLocal ?? snapInicio.oficial,
            store: storeInicio,
            abrir: storeInicio.abrir,
            salvarAgora: storeInicio.salvarAgora,
            garantirSalvoParaSaida: storeInicio.garantirSalvoParaSaida,
          }}
          tempoUs={35_000_000}
          reproduzindo={false}
          acoesBarra={ACOES_EXEMPLO}
          popoverAberto={null}
          aoMudarPopoverAberto={() => {}}
          aoMudarTempoUs={() => {}}
          aoMudarReproduzindo={() => {}}
          aoRelocalizarFonte={() => {}}
        />,
      ),
    )

    const videoInicio = document.querySelector('video')
    expect(videoInicio).not.toBeNull()
    expect(videoInicio!.currentTime).toBeCloseTo(35, 3)
    unmount3()
  })
})
