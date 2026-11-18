import {
  BannerErroCore,
  BarraAcoes,
  Botao,
  Progresso,
  Segmentado,
  Status,
  Transporte,
  cn,
  tcLongo,
  type AcaoBarra,
} from '@ds'
import { FileQuestion } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { drawCaption, loadCaptionFonts } from '../../../../src/features/captions/render'
import {
  clampCropRect,
  defaultPanelRect,
  effectiveCropLayout,
  interpolateCrop,
  panelHeights,
  panelZoomFactor,
  resolveCropPlan,
  upsertCropKeyframe,
  zoomPanelRect,
  type CropKeyframe,
  type CropLayout,
  type CropRect,
} from '../../../../src/features/editor/cropMath'
import {
  activeNarrationAt,
  activeSpeechAt,
  computeSoundtrackGain,
  soundtrackPlaybackSec,
  targetDuckGain,
  type PreviewNarrationSegment,
} from '../../../../src/features/editor/duckingMath'
import {
  sourceToSplicedUs,
  splicedToSourceUs,
} from '../../../../src/features/editor/timelineMath'
import { mediaUrl } from '../../../../src/lib/media'
import { chamar, ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila } from '~/core/progresso'
import { useEditorCorte } from '~/stores/editorCorte'

export type SessaoEditorCorte = ReturnType<typeof useEditorCorte>

/** Resolve e assina a sessão ativa do Editor, mantendo reatividade mesmo com `estadoEditor` injetado. */
export function useSessaoEditorCorte(
  projetoPath: string | null,
  corteId: string | null,
  estadoEditor?: SessaoEditorCorte,
): SessaoEditorCorte {
  const editorHook = useEditorCorte(projetoPath, corteId)
  const storeAtivo = estadoEditor?.store ?? editorHook.store
  const estadoVivo = useSyncExternalStore(
    storeAtivo.assinar,
    storeAtivo.obterSnapshot,
    storeAtivo.obterSnapshot,
  )
  return useMemo(
    () => ({
      ...(estadoEditor ?? editorHook),
      ...estadoVivo,
      documentoAtivo:
        estadoVivo.previaLocal ?? estadoVivo.oficial ?? estadoEditor?.documentoAtivo ?? null,
      store: storeAtivo,
    }),
    [estadoEditor, editorHook, estadoVivo, storeAtivo],
  )
}

export type OverlayBorda = {
  edge: 'start' | 'end'
  timeUs: number
  livrePorQuadro: boolean
}

export type PainelCropAtivo = 'top' | 'bottom'

export type PalcoEditorProps = {
  projetoPath?: string | null
  corteId?: string | null
  estadoEditor?: SessaoEditorCorte
  tempoUs?: number
  reproduzindo?: boolean
  taxa?: number
  mudo?: boolean
  volume?: number
  overlayBorda?: OverlayBorda | null
  painelCropAtivo?: PainelCropAtivo
  aoMudarPainelCropAtivo?: (painel: PainelCropAtivo) => void
  acoesBarra: AcaoBarra[]
  popoverAberto: string | null
  aoMudarPopoverAberto: (id: string | null) => void
  aoMudarTempoUs?: (us: number) => void
  aoMudarReproduzindo?: (tocando: boolean) => void
  aoIrParaInicio?: () => void
  aoIrParaFim?: () => void
  aoMarcarEntrada?: (free?: boolean) => void
  aoMarcarSaida?: (free?: boolean) => void
  aoAlternarMudo?: () => void
  aoRelocalizarFonte: () => void
  aoSolicitarFocoRef?: RefObject<HTMLDivElement | null>
  className?: string
}

type DirecaoAlca = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

const ALCAS_CROP: Array<{ dir: DirecaoAlca; rotulo: string; posClass: string; cursorClass: string }> = [
  { dir: 'nw', rotulo: 'Redimensionar canto superior esquerdo', posClass: '-top-3 -left-3', cursorClass: 'cursor-nwse-resize' },
  { dir: 'n', rotulo: 'Redimensionar borda superior', posClass: '-top-3 left-1/2 -translate-x-1/2', cursorClass: 'cursor-ns-resize' },
  { dir: 'ne', rotulo: 'Redimensionar canto superior direito', posClass: '-top-3 -right-3', cursorClass: 'cursor-nesw-resize' },
  { dir: 'e', rotulo: 'Redimensionar borda direita', posClass: 'top-1/2 -right-3 -translate-y-1/2', cursorClass: 'cursor-ew-resize' },
  { dir: 'se', rotulo: 'Redimensionar canto inferior direito', posClass: '-right-3 -bottom-3', cursorClass: 'cursor-nwse-resize' },
  { dir: 's', rotulo: 'Redimensionar borda inferior', posClass: '-bottom-3 left-1/2 -translate-x-1/2', cursorClass: 'cursor-ns-resize' },
  { dir: 'sw', rotulo: 'Redimensionar canto inferior esquerdo', posClass: '-bottom-3 -left-3', cursorClass: 'cursor-nesw-resize' },
  { dir: 'w', rotulo: 'Redimensionar borda esquerda', posClass: 'top-1/2 -left-3 -translate-y-1/2', cursorClass: 'cursor-ew-resize' },
]

function calcularEstiloVideoCrop(rect: CropRect | null, fitMode: 'fit' | 'fill') {
  if (!rect || fitMode === 'fit') return undefined
  const w = Math.max(0.05, rect.width)
  const h = Math.max(0.05, rect.height)
  return {
    width: `${(1 / w) * 100}%`,
    height: `${(1 / h) * 100}%`,
    left: `${(-rect.x / w) * 100}%`,
    top: `${(-rect.y / h) * 100}%`,
  }
}

function ajustarRetanguloPorAlca(
  inicial: CropRect,
  dir: DirecaoAlca,
  dx: number,
  dy: number,
): CropRect {
  const MIN = 0.05
  if (dir === 'move') {
    return clampCropRect({
      ...inicial,
      x: inicial.x + dx,
      y: inicial.y + dy,
    })
  }

  let left = inicial.x
  let top = inicial.y
  let right = inicial.x + inicial.width
  let bottom = inicial.y + inicial.height

  if (dir.includes('w')) left = Math.min(right - MIN, Math.max(0, inicial.x + dx))
  if (dir.includes('e')) right = Math.max(left + MIN, Math.min(1, inicial.x + inicial.width + dx))
  if (dir.includes('n')) top = Math.min(bottom - MIN, Math.max(0, inicial.y + dy))
  if (dir.includes('s')) bottom = Math.max(top + MIN, Math.min(1, inicial.y + inicial.height + dy))

  return clampCropRect({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  })
}

export function PalcoEditor({
  projetoPath = null,
  corteId = null,
  estadoEditor,
  tempoUs: tempoProp,
  reproduzindo: reproduzindoProp,
  taxa = 1,
  mudo: mudoProp,
  volume = 1,
  overlayBorda = null,
  painelCropAtivo: painelProp,
  aoMudarPainelCropAtivo,
  acoesBarra,
  popoverAberto,
  aoMudarPopoverAberto,
  aoMudarTempoUs,
  aoMudarReproduzindo,
  aoIrParaInicio,
  aoIrParaFim,
  aoMarcarEntrada,
  aoMarcarSaida,
  aoAlternarMudo,
  aoRelocalizarFonte,
  aoSolicitarFocoRef,
  className,
}: PalcoEditorProps) {
  const editor = useSessaoEditorCorte(projetoPath, corteId, estadoEditor)
  const doc = editor.documentoAtivo
  const jobs = useFila()

  const [modo, setModo] = useState<'previa_9_16' | 'fonte_16_9'>('previa_9_16')
  const [painelInterno, setPainelInterno] = useState<PainelCropAtivo>('top')
  const [tempoLocalUs, setTempoLocalUs] = useState<number>(doc?.startUs ?? 0)
  const [reproduzindoLocal, setReproduzindoLocal] = useState(false)
  const [mudoLocal, setMudoLocal] = useState(false)
  const [escalaLegenda, setEscalaLegenda] = useState(0.32)

  const painelAtivo = painelProp ?? painelInterno
  const definirPainelAtivo = useCallback(
    (p: PainelCropAtivo) => {
      if (aoMudarPainelCropAtivo) aoMudarPainelCropAtivo(p)
      else setPainelInterno(p)
    },
    [aoMudarPainelCropAtivo],
  )

  const tempoUs = tempoProp ?? tempoLocalUs
  const reproduzindo = reproduzindoProp ?? reproduzindoLocal
  const mudo = mudoProp ?? mudoLocal

  const definirTempoUs = useCallback(
    (us: number) => {
      if (aoMudarTempoUs) aoMudarTempoUs(us)
      else setTempoLocalUs(us)
    },
    [aoMudarTempoUs],
  )

  const definirReproduzindo = useCallback(
    (tocando: boolean) => {
      if (aoMudarReproduzindo) aoMudarReproduzindo(tocando)
      else setReproduzindoLocal(tocando)
    },
    [aoMudarReproduzindo],
  )

  const alternarMudo = useCallback(() => {
    if (aoAlternarMudo) aoAlternarMudo()
    else setMudoLocal((v) => !v)
  }, [aoAlternarMudo])

  const refQuadro = useRef<HTMLDivElement>(null)
  const refQuadroFonte = useRef<HTMLDivElement>(null)
  const refCamadaLegendas = useRef<HTMLDivElement>(null)
  const refVideoPrincipal = useRef<HTMLVideoElement>(null)
  const refVideoSecundario = useRef<HTMLVideoElement>(null)
  const refVideoFonte = useRef<HTMLVideoElement>(null)
  const refAudioTrilha = useRef<HTMLAudioElement>(null)
  const refAudioNarracao = useRef<HTMLAudioElement>(null)

  const arrastoCropRef = useRef<{
    dir: DirecaoAlca
    panel: 'primary' | 'top' | 'bottom'
    startX: number
    startY: number
    inicial: CropRect
    editsBase: CropKeyframe[]
    layout: CropLayout
    ultimoRect: CropRect
  } | null>(null)

  useEffect(() => {
    if (typeof FontFace !== 'undefined' && typeof document !== 'undefined' && 'fonts' in document) {
      void loadCaptionFonts().catch(() => {})
    }
  }, [])

  // Escala dinâmica da camada 1080×1920 para caber no quadro 9:16
  useEffect(() => {
    const el = refQuadro.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const atualizarEscala = () => {
      const w = el.clientWidth
      if (w > 0) setEscalaLegenda(w / 1080)
    }
    atualizarEscala()
    const obs = new ResizeObserver(atualizarEscala)
    obs.observe(el)
    return () => obs.disconnect()
  }, [modo])

  const layout = useMemo(() => (doc ? effectiveCropLayout(doc.crop) : 'fit'), [doc])
  const ehDuplo = layout === 'gameplay_webcam' || layout === 'two_people'
  const sourceAspect = doc?.sourceAspect ?? 16 / 9
  const startUs = doc?.startUs ?? 0
  const endUs = doc?.endUs ?? 0
  const duracaoEfetivaUs = doc?.silences.effectiveDurationUs ?? Math.max(0, endUs - startUs)

  const tempoSplicedUs = useMemo(() => {
    if (!doc) return 0
    return Math.max(0, sourceToSplicedUs(tempoUs, doc.silences.segments, doc.startUs))
  }, [doc, tempoUs])

  // Desenha legendas ao vivo via src/features/captions/render.ts
  useEffect(() => {
    const root = refCamadaLegendas.current
    if (!root) return
    if (!editor.legendas || editor.modoSomenteLeituraMidia || modo !== 'previa_9_16') {
      root.replaceChildren()
      return
    }
    drawCaption(root, editor.legendas, tempoSplicedUs)
  }, [editor.legendas, editor.modoSomenteLeituraMidia, modo, tempoSplicedUs])

  // Plano de crop e retângulos interpolados
  const planoCrop = useMemo(() => {
    if (!doc) return null
    return resolveCropPlan(doc.crop, sourceAspect, doc.startUs, doc.endUs)
  }, [doc, sourceAspect])

  const rectsAtuais = useMemo(() => {
    if (!planoCrop) return []
    return planoCrop.panels.map((p) => interpolateCrop(p.segments, tempoUs))
  }, [planoCrop, tempoUs])

  const heightsDuplo = useMemo(
    () => (ehDuplo && doc ? panelHeights(layout, doc.crop.splitRatio) : [1920, 0]),
    [doc, ehDuplo, layout],
  )

  // Mixagem de áudio (duckingMath.ts)
  const segmentosNarracao = useMemo<PreviewNarrationSegment[]>(() => {
    if (!doc?.montage?.blocks) return []
    return doc.montage.blocks
      .filter((b): b is typeof b & { audioId: number } => typeof b.audioId === 'number' && b.audioId > 0)
      .map((b) => ({
        blockId: b.blockId,
        audioId: b.audioId,
        startUs: b.startUs,
        endUs: b.endUs,
        durationUs: b.durationUs,
      }))
  }, [doc?.montage?.blocks])

  const narracaoAtiva = useMemo(
    () => activeNarrationAt(segmentosNarracao, tempoSplicedUs),
    [segmentosNarracao, tempoSplicedUs],
  )

  const falaAtiva = useMemo(
    () => activeSpeechAt(doc?.audioMix.speechIntervals ?? [], tempoSplicedUs),
    [doc?.audioMix.speechIntervals, tempoSplicedUs],
  )

  const ganhoProxy = useMemo(() => {
    if (mudo) return 0
    return Math.max(0, Math.min(1, volume * targetDuckGain(Boolean(narracaoAtiva))))
  }, [mudo, narracaoAtiva, volume])

  const ganhoTrilha = useMemo(() => {
    const st = doc?.audioMix.soundtrack
    if (!st || mudo) return 0
    const elapsed = tempoSplicedUs - st.startUs
    const duck = targetDuckGain(falaAtiva || Boolean(narracaoAtiva))
    return Math.max(
      0,
      Math.min(
        1,
        volume * computeSoundtrackGain(st.volume, elapsed, st.playDurationUs, st.fadeInUs, st.fadeOutUs, duck),
      ),
    )
  }, [doc?.audioMix.soundtrack, falaAtiva, mudo, narracaoAtiva, tempoSplicedUs, volume])

  const trilhaSec = useMemo(() => {
    const st = doc?.audioMix.soundtrack
    if (!st) return null
    return soundtrackPlaybackSec(tempoSplicedUs, st.startUs, st.playDurationUs, st.assetDurationUs, st.loopToFit)
  }, [doc?.audioMix.soundtrack, tempoSplicedUs])

  // Sincronização de elementos <video> / <audio>
  const urlProxy = editor.proxy.key ? mediaUrl(`proxy/${editor.proxy.key}`) : null

  useEffect(() => {
    const videos = [refVideoPrincipal.current, refVideoSecundario.current, refVideoFonte.current]
    const targetSec = Math.max(0, tempoUs / 1_000_000)
    for (const v of videos) {
      if (!v) continue
      v.muted = mudo || v !== refVideoPrincipal.current
      if (v === refVideoPrincipal.current) {
        try {
          v.volume = ganhoProxy
        } catch {
          // jsdom pode limitar atribuição
        }
      }
      if (typeof v.playbackRate === 'number' && taxa > 0) {
        try {
          v.playbackRate = taxa
        } catch {
          // ignora em ambiente sem suporte
        }
      }
      if (Math.abs((v.currentTime || 0) - targetSec) > 0.12) {
        try {
          v.currentTime = targetSec
        } catch {
          // ignora em jsdom
        }
      }
      if (reproduzindo) {
        v.play?.().catch(() => {})
      } else {
        v.pause?.()
      }
    }
  }, [ganhoProxy, mudo, reproduzindo, taxa, tempoUs, urlProxy, modo])

  useEffect(() => {
    const audio = refAudioTrilha.current
    if (!audio) return
    try {
      audio.volume = ganhoTrilha
      audio.muted = mudo
    } catch {
      // ignora em jsdom
    }
    if (trilhaSec !== null && Math.abs((audio.currentTime || 0) - trilhaSec) > 0.15) {
      try {
        audio.currentTime = trilhaSec
      } catch {
        // ignora
      }
    }
    if (reproduzindo && trilhaSec !== null && !mudo) {
      audio.play?.().catch(() => {})
    } else {
      audio.pause?.()
    }
  }, [ganhoTrilha, mudo, reproduzindo, trilhaSec])

  useEffect(() => {
    const audioNarr = refAudioNarracao.current
    if (!audioNarr) return
    try {
      audioNarr.muted = mudo
      audioNarr.volume = mudo ? 0 : volume
    } catch {
      // ignora
    }
    if (reproduzindo && narracaoAtiva && !mudo) {
      const localSec = Math.max(0, (tempoSplicedUs - narracaoAtiva.startUs) / 1_000_000)
      if (Math.abs((audioNarr.currentTime || 0) - localSec) > 0.15) {
        try {
          audioNarr.currentTime = localSec
        } catch {
          // ignora
        }
      }
      audioNarr.play?.().catch(() => {})
    } else {
      audioNarr.pause?.()
    }
  }, [mudo, narracaoAtiva, reproduzindo, tempoSplicedUs, volume])

  // Progresso do proxy via useFila() + fallback do estado
  const jobProxyFila = useMemo(() => {
    if (editor.proxy.job === null) return null
    return jobs.find((j) => j.id === String(editor.proxy.job)) ?? null
  }, [editor.proxy.job, jobs])

  const percentualProxy = jobProxyFila?.percentual ?? editor.proxy.progress

  const erroProxyObjeto = useMemo(() => {
    if (editor.proxy.state !== 'failed') return null
    const raw = editor.proxy.error
    return {
      code: raw?.code || 'proxy_failed',
      message: raw?.message || 'Falha ao preparar a prévia rápida.',
    }
  }, [editor.proxy.error, editor.proxy.state])

  // Helpers para o modo Enquadrar na Fonte 16:9
  const obterEditsDoPainel = useCallback(
    (panel: 'primary' | 'top' | 'bottom'): CropKeyframe[] => {
      if (!doc) return []
      if (panel === 'primary') return doc.crop.edits
      const dual = layout === 'gameplay_webcam' ? doc.crop.gameplayWebcam : doc.crop.twoPeople
      if (!dual) return []
      return panel === 'top' ? dual.top.edits : dual.bottom.edits
    },
    [doc, layout],
  )

  const painelEditavelAtual: 'primary' | 'top' | 'bottom' = ehDuplo ? painelAtivo : 'primary'

  const rectAtivoFonte = useMemo<CropRect>(() => {
    if (!doc) return { x: 0.34, y: 0, width: 0.32, height: 1 }
    if (ehDuplo) {
      const idx = painelAtivo === 'top' ? 0 : 1
      const r = rectsAtuais[idx]
      if (r) return r
      const panelAspect = 1080 / Math.max(1, heightsDuplo[idx])
      return defaultPanelRect(sourceAspect, panelAspect)
    }
    return rectsAtuais[0] ?? defaultPanelRect(sourceAspect, 9 / 16)
  }, [doc, ehDuplo, heightsDuplo, painelAtivo, rectsAtuais, sourceAspect])

  const confirmarRectCrop = useCallback(
    (
      panel: 'primary' | 'top' | 'bottom',
      editsBase: CropKeyframe[],
      rect: CropRect,
      preview: boolean,
      layoutAlvo: CropLayout,
    ) => {
      const nextEdits = upsertCropKeyframe(editsBase, { timeUs: tempoUs, ...rect }, 40_000)
      void editor.store.definirEditsCrop(panel, nextEdits, preview, layoutAlvo)
    },
    [editor.store, tempoUs],
  )

  const iniciarArrastoCrop = (dir: DirecaoAlca, panel: 'primary' | 'top' | 'bottom', rectInicial: CropRect) =>
    (e: ReactPointerEvent<HTMLElement>) => {
      e.stopPropagation()
      e.preventDefault()
      const layoutAlvo: CropLayout = layout === 'fit' ? 'fullscreen_roi' : layout
      arrastoCropRef.current = {
        dir,
        panel,
        startX: e.clientX,
        startY: e.clientY,
        inicial: rectInicial,
        editsBase: obterEditsDoPainel(panel),
        layout: layoutAlvo,
        ultimoRect: rectInicial,
      }
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }

  const moverArrastoCrop = (e: ReactPointerEvent<HTMLElement>) => {
    const arr = arrastoCropRef.current
    const quadro = refQuadroFonte.current
    if (!arr || !quadro) return
    const bounds = quadro.getBoundingClientRect()
    const w = bounds.width || 640
    const h = bounds.height || 360
    const dx = (e.clientX - arr.startX) / w
    const dy = (e.clientY - arr.startY) / h
    const prox = ajustarRetanguloPorAlca(arr.inicial, arr.dir, dx, dy)
    arr.ultimoRect = prox
    confirmarRectCrop(arr.panel, arr.editsBase, prox, true, arr.layout)
  }

  const finalizarArrastoCrop = (e: ReactPointerEvent<HTMLElement>) => {
    const arr = arrastoCropRef.current
    if (!arr) return
    arrastoCropRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    confirmarRectCrop(arr.panel, arr.editsBase, arr.ultimoRect, false, arr.layout)
  }

  const teclasCrop = (panel: 'primary' | 'top' | 'bottom', rectAtual: CropRect) =>
    (e: ReactKeyboardEvent<HTMLElement>) => {
      const passo = e.shiftKey ? 0.005 : 0.02
      let next: CropRect | null = null
      if (e.key === 'ArrowLeft') next = clampCropRect({ ...rectAtual, x: rectAtual.x - passo })
      else if (e.key === 'ArrowRight') next = clampCropRect({ ...rectAtual, x: rectAtual.x + passo })
      else if (e.key === 'ArrowUp') next = clampCropRect({ ...rectAtual, y: rectAtual.y - passo })
      else if (e.key === 'ArrowDown') next = clampCropRect({ ...rectAtual, y: rectAtual.y + passo })
      else if (e.key === 'PageUp' || e.key === 'PageDown') {
        const panelAspect = ehDuplo
          ? 1080 / Math.max(1, heightsDuplo[panel === 'top' ? 0 : 1])
          : 9 / 16
        const zoomAtual = panelZoomFactor(rectAtual, sourceAspect, panelAspect)
        const novoZoom = e.key === 'PageUp' ? zoomAtual + 0.15 : zoomAtual - 0.15
        next = zoomPanelRect(rectAtual, sourceAspect, panelAspect, novoZoom)
      }
      if (!next) return
      e.preventDefault()
      const layoutAlvo: CropLayout = layout === 'fit' ? 'fullscreen_roi' : layout
      confirmarRectCrop(panel, obterEditsDoPainel(panel), next, false, layoutAlvo)
    }

  const tentarNovamenteProxy = () => {
    if (!doc) return
    void chamar('proxy.request', {
      source_id: doc.request.source_id,
      start_us: doc.startUs,
      end_us: doc.endUs,
    })
  }

  const cancelarProxy = () => {
    if (editor.proxy.job === null) return
    void chamar('jobs.cancel', { id: editor.proxy.job })
  }

  const irParaInicio = () => {
    if (aoIrParaInicio) aoIrParaInicio()
    else definirTempoUs(startUs)
  }

  const irParaFim = () => {
    if (aoIrParaFim) aoIrParaFim()
    else definirTempoUs(endUs)
  }

  const marcarEntrada = () => {
    if (aoMarcarEntrada) aoMarcarEntrada()
    else if (doc) {
      const clamped = Math.min(tempoUs, doc.endUs - 1_000_000)
      void editor.store.ajustarBorda({ edge: 'start', timeUs: clamped, preview: false })
    }
  }

  const marcarSaida = () => {
    if (aoMarcarSaida) aoMarcarSaida()
    else if (doc) {
      const clamped = Math.max(tempoUs, doc.startUs + 1_000_000)
      void editor.store.ajustarBorda({ edge: 'end', timeUs: clamped, preview: false })
    }
  }

  const frameVazioOuIndisponivel = () => {
    if (editor.modoSomenteLeituraMidia) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
          <FileQuestion className="size-5 stroke-[1.5] text-t3" aria-hidden />
          <p className="text-pequeno text-t2">A Fonte está offline ou foi alterada.</p>
          <Botao tamanho="p" variante="secundario" onClick={aoRelocalizarFonte}>
            Relocalizar arquivo
          </Botao>
        </div>
      )
    }
    if (editor.proxy.state === 'queued' || editor.proxy.state === 'running') {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-5">
          <Progresso valor={percentualProxy} rotulo="Preparando prévia rápida…" className="max-w-[220px]" />
          {editor.proxy.job !== null && (
            <Botao tamanho="p" variante="fantasma" onClick={cancelarProxy}>
              Cancelar
            </Botao>
          )}
        </div>
      )
    }
    if (editor.proxy.state === 'failed' && erroProxyObjeto) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
          <BannerErroCore
            erro={erroProxyObjeto}
            traduzir={(code) => mensagemDeErro(new ErroCore(code, erroProxyObjeto.message))}
            acaoRecuperacao={{ rotulo: 'Tentar novamente', aoAcionar: tentarNovamenteProxy }}
          />
        </div>
      )
    }
    return null
  }

  const estadoBloqueadoFrame =
    editor.modoSomenteLeituraMidia ||
    editor.proxy.state === 'queued' ||
    editor.proxy.state === 'running' ||
    editor.proxy.state === 'failed'

  return (
    <section
      ref={aoSolicitarFocoRef}
      tabIndex={-1}
      aria-label="Palco de prévia"
      className={cn('flex min-h-0 min-w-0 flex-1 flex-col items-center justify-between gap-2 outline-none', className)}
    >
      {/* Topo do palco: alternador Prévia 9:16 | Enquadrar na Fonte 16:9 (+ Topo/Base em layouts duplos) */}
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
        <Segmentado
          rotulo="Modo do palco"
          valor={modo}
          aoMudar={setModo}
          opcoes={[
            { valor: 'previa_9_16', rotulo: 'Prévia 9:16' },
            { valor: 'fonte_16_9', rotulo: 'Enquadrar na Fonte 16:9' },
          ]}
        />
        {ehDuplo && (
          <Segmentado
            rotulo="Painel ativo"
            valor={painelAtivo}
            aoMudar={definirPainelAtivo}
            opcoes={[
              { valor: 'top', rotulo: 'Topo' },
              { valor: 'bottom', rotulo: 'Base' },
            ]}
          />
        )}
      </div>

      {/* Área do quadro */}
      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
        {modo === 'previa_9_16' ? (
          <div
            ref={refQuadro}
            data-testid="quadro-previa-9-16"
            className="relative aspect-[9/16] h-full max-h-full overflow-hidden rounded-area bg-preto"
          >
            {estadoBloqueadoFrame ? (
              frameVazioOuIndisponivel()
            ) : (
              <>
                {ehDuplo && planoCrop ? (
                  <div className="flex h-full w-full flex-col">
                    {planoCrop.panels.map((p, idx) => {
                      const pctAltura = (p.targetHeight / 1920) * 100
                      const rect = rectsAtuais[idx] ?? null
                      const estilo = calcularEstiloVideoCrop(rect, p.fitMode)
                      return (
                        <div
                          key={idx}
                          className="relative w-full overflow-hidden bg-preto"
                          style={{ height: `${pctAltura}%` }}
                        >
                          {urlProxy && (
                            <video
                              ref={idx === 0 ? refVideoPrincipal : refVideoSecundario}
                              src={urlProxy}
                              playsInline
                              className={cn(
                                'pointer-events-none block',
                                estilo ? 'absolute max-w-none' : 'h-full w-full object-contain',
                              )}
                              style={estilo}
                            />
                          )}
                        </div>
                      )
                    })}
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 h-px bg-branco/30"
                      style={{ top: `${(heightsDuplo[0] / 1920) * 100}%` }}
                    />
                  </div>
                ) : (
                  urlProxy && (
                    <video
                      ref={refVideoPrincipal}
                      src={urlProxy}
                      playsInline
                      className={cn(
                        'pointer-events-none block',
                        layout === 'fit'
                          ? 'h-full w-full object-contain'
                          : 'absolute max-w-none',
                      )}
                      style={
                        layout === 'fit'
                          ? undefined
                          : calcularEstiloVideoCrop(rectsAtuais[0] ?? null, 'fill')
                      }
                    />
                  )
                )}
              </>
            )}

            {/* Camada de legendas ao vivo 1080×1920 escalada */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden"
            >
              <div
                ref={refCamadaLegendas}
                data-testid="camada-legendas"
                className="relative origin-top-left"
                style={{
                  width: 1080,
                  height: 1920,
                  transform: `scale(${escalaLegenda})`,
                }}
              />
            </div>
          </div>
        ) : (
          <div
            ref={(node) => {
              refQuadroFonte.current = node
              refQuadro.current = node
            }}
            data-testid="quadro-fonte-16-9"
            className="relative aspect-video h-full max-h-full max-w-full overflow-hidden rounded-area bg-preto select-none"
          >
            {estadoBloqueadoFrame ? (
              frameVazioOuIndisponivel()
            ) : (
              <>
                {urlProxy && (
                  <video
                    ref={refVideoFonte}
                    src={urlProxy}
                    playsInline
                    className="pointer-events-none block h-full w-full object-contain"
                  />
                )}
                {/* Máscara escurecida + retângulo(s) de crop manipuláveis */}
                {ehDuplo && (() => {
                  const outroPainel: PainelCropAtivo = painelAtivo === 'top' ? 'bottom' : 'top'
                  const idxOutro = outroPainel === 'top' ? 0 : 1
                  const panelAspectOutro = 1080 / Math.max(1, heightsDuplo[idxOutro])
                  const rectOutro =
                    rectsAtuais[idxOutro] ?? defaultPanelRect(sourceAspect, panelAspectOutro)
                  return (
                    <button
                      type="button"
                      data-testid="retangulo-crop-secundario"
                      aria-label={`Selecionar retângulo ${outroPainel === 'top' ? 'Topo' : 'Base'}`}
                      onClick={() => definirPainelAtivo(outroPainel)}
                      className="foco-interno absolute cursor-pointer border border-dashed border-t2/70 bg-transparent p-0"
                      style={{
                        left: `${rectOutro.x * 100}%`,
                        top: `${rectOutro.y * 100}%`,
                        width: `${rectOutro.width * 100}%`,
                        height: `${rectOutro.height * 100}%`,
                      }}
                    />
                  )
                })()}
                <div
                  data-testid="retangulo-crop-ativo"
                  role="application"
                  tabIndex={0}
                  aria-label={
                    ehDuplo
                      ? `Retângulo de enquadramento (${painelAtivo === 'top' ? 'Topo' : 'Base'}). Use as setas para mover e PageUp/PageDown para zoom.`
                      : 'Retângulo de enquadramento. Use as setas para mover e PageUp/PageDown para zoom.'
                  }
                  onKeyDown={teclasCrop(painelEditavelAtual, rectAtivoFonte)}
                  onPointerDown={iniciarArrastoCrop('move', painelEditavelAtual, rectAtivoFonte)}
                  onPointerMove={moverArrastoCrop}
                  onPointerUp={finalizarArrastoCrop}
                  className="foco-interno absolute cursor-move border-2 border-sinal shadow-[0_0_0_9999px_rgb(0_0_0/0.52)]"
                  style={{
                    left: `${rectAtivoFonte.x * 100}%`,
                    top: `${rectAtivoFonte.y * 100}%`,
                    width: `${rectAtivoFonte.width * 100}%`,
                    height: `${rectAtivoFonte.height * 100}%`,
                  }}
                >
                  {ALCAS_CROP.map((a) => (
                    <button
                      key={a.dir}
                      type="button"
                      data-alca-crop={a.dir}
                      aria-label={a.rotulo}
                      tabIndex={-1}
                      onPointerDown={iniciarArrastoCrop(a.dir, painelEditavelAtual, rectAtivoFonte)}
                      onPointerMove={moverArrastoCrop}
                      onPointerUp={finalizarArrastoCrop}
                      className={cn(
                        'absolute grid min-h-6 min-w-6 place-items-center border-0 bg-transparent p-0',
                        a.posClass,
                        a.cursorClass,
                      )}
                    >
                      <span className="size-2.5 rounded-mini border border-chao bg-t1" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Overlay ao vivo durante arrasto de borda na Timeline */}
        {overlayBorda && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-area bg-elevado px-3 py-1.5 text-pequeno shadow-flutuante"
          >
            <span className="text-t2">
              {overlayBorda.edge === 'start' ? 'Entrada' : 'Saída'}
            </span>
            <span className="num font-medio text-t1">{tcLongo(overlayBorda.timeUs)}</span>
            <Status tom="info">
              {overlayBorda.livrePorQuadro ? 'Livre por quadro (Alt)' : 'Encaixe em Frase'}
            </Status>
          </div>
        )}
      </div>

      {/* Áudio oculto para trilha sonora e narração mixadas com duckingMath.ts */}
      {doc?.audioMix.soundtrack && !editor.modoSomenteLeituraMidia && (
        <audio
          ref={refAudioTrilha}
          data-testid="audio-trilha-previa"
          src={mediaUrl(doc.audioMix.soundtrack.mediaId)}
          loop={doc.audioMix.soundtrack.loopToFit}
        />
      )}
      {narracaoAtiva && !editor.modoSomenteLeituraMidia && (
        <audio
          ref={refAudioNarracao}
          data-testid="audio-narracao-previa"
          src={mediaUrl(`narration/${narracaoAtiva.audioId}`)}
        />
      )}
      {!editor.modoSomenteLeituraMidia &&
        doc?.audioMix.sfx
          .filter((s) => tempoSplicedUs >= s.startUs && tempoSplicedUs < s.endUs)
          .map((s) => (
            <audio
              key={s.id}
              data-testid={`audio-sfx-${s.id}`}
              src={mediaUrl(s.mediaId)}
              autoPlay={reproduzindo && !mudo}
              muted={mudo}
            />
          ))}

      {/* Linha de controles sob o vídeo: <Transporte> + <BarraAcoes> */}
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-2.5">
        <Transporte
          tempoUs={splicedToSourceUs(tempoSplicedUs, doc?.silences.segments, startUs, endUs) - startUs}
          duracaoUs={duracaoEfetivaUs}
          reproduzindo={reproduzindo}
          mudo={mudo}
          aoAlternar={() => definirReproduzindo(!reproduzindo)}
          aoInicio={irParaInicio}
          aoFim={irParaFim}
          aoMarcarEntrada={marcarEntrada}
          aoMarcarSaida={marcarSaida}
          aoAlternarMudo={alternarMudo}
        />
        <BarraAcoes
          acoes={acoesBarra}
          aberta={popoverAberto}
          aoMudarAberta={aoMudarPopoverAberto}
          ancora={refQuadro}
        />
      </div>
    </section>
  )
}
