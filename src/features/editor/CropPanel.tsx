import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Plus, RefreshCw, RotateCcw, Scissors, Sparkles, Trash2 } from 'lucide-react';
import { coreDispatch } from '@/lib/core';
import { mediaUrl as buildMediaUrl } from '@/lib/media';
import { useText } from '@/lib/i18n';
import { Button, IconButton } from '@/components/ui/Button';
import { clock, fill } from '@/features/projects/selectionFormat';
import { toProxySeconds, type PreviewProxyInfo } from '@/features/projects/CutPreview';
import {
  clampCropRect,
  defaultPanelRect,
  effectiveCropLayout,
  fitZoomFactor,
  interpolateCrop,
  panelZoomFactor,
  removeCropKeyframe,
  resolveCropPlan,
  splitBounds,
  toggleCropKeyframeCut,
  upsertCropKeyframe,
  zoomFitRect,
  zoomPanelRect,
  type ClipCrop,
  type CropKeyframe,
  type CropLayout,
  type CropRect,
} from './cropMath';

export type CropAnswer = ClipCrop & {
  clipId: number;
  schemaVersion: number;
  revision: number;
  undoCount: number;
  redoCount: number;
};

type ReframeStatus = {
  id: number;
  job: number;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  error: { code: string; message: string } | null;
};

export type CropPanelSlot = 'primary' | 'top' | 'bottom';

const LAYOUT_ORDER: CropLayout[] = ['face', 'fit', 'gameplay_webcam', 'two_people', 'fullscreen_roi'];

const texts = {
  'pt-BR': {
    layoutTitle: 'Layout do Corte',
    layouts: {
      face: 'Rosto',
      fit: 'Fit / centro',
      gameplay_webcam: 'Jogo + webcam',
      two_people: 'Duas pessoas',
      fullscreen_roi: 'Tela cheia (área)',
    } as Record<CropLayout, string>,
    layoutDesc: {
      face: 'Fill 9:16 seguindo o rosto com sugestão automática e correção manual.',
      fit: 'Fonte inteira centralizada com barras pretas e zoom/pan manuais opcionais.',
      gameplay_webcam: 'Webcam no topo e jogo embaixo. Posicione o retângulo da webcam manualmente ou use a sugestão de baixa confiança.',
      two_people: 'Duas janelas empilhadas com pan e zoom próprios por pessoa.',
      fullscreen_roi: 'Fill 9:16 com área de interesse manual (mover e zoom, sem rastreio de rosto).',
    } as Record<CropLayout, string>,
    panelSelector: 'Painel ativo',
    panelNames: {
      gameplay_webcam: { top: 'Webcam', bottom: 'Jogo' },
      two_people: { top: 'Pessoa 1 (topo)', bottom: 'Pessoa 2 (base)' },
    } as Record<'gameplay_webcam' | 'two_people', { top: string; bottom: string }>,
    splitLabelWebcam: 'Altura da webcam',
    splitLabelTwoPeople: 'Divisão superior',
    webcamLowConfidence: 'Caminho principal: posicione ou redimensione o retângulo da webcam manualmente. A detecção automática tem baixa confiança.',
    sourceFrame: 'Quadro da Fonte',
    cropHandle: 'Área de recorte na Fonte',
    sourceVideo: 'Vídeo da Fonte para enquadramento',
    hint: 'Arraste o retângulo sobre a Fonte 16:9, clique para posicionar ou use as setas (Shift para passo maior).',
    preparingPreview: 'Aguardando o preview da Fonte…',
    zoom: 'Zoom do recorte',
    center: 'Centralizar',
    addKeyframe: 'Adicionar keyframe',
    analyze: 'Sugerir enquadramento',
    reanalyze: 'Refazer análise',
    analyzing: 'Analisando enquadramento… {progress}%',
    cancelAnalysis: 'Cancelar análise',
    clearEdits: 'Limpar correções',
    statusTitle: 'Sugestão e correções',
    suggestionPresent: 'Sugestão automática: {segments} segmento(s). Segmentos sem keyframe manual seguem a sugestão.',
    suggestionLowConf: 'Sugestão automática de baixa confiança aplicada ({confidence}%). Ajuste o retângulo manualmente se necessário.',
    suggestionAbsent: 'Sem sugestão automática. Sem correções manuais, usa o enquadramento padrão do layout.',
    manualOnlyHint: 'Layout manual: sem rastreio automático de rosto.',
    editsCount: '{count} keyframe(s) manual(is)',
    noEdits: 'Nenhuma correção manual gravada.',
    keyframesTitle: 'Keyframes manuais',
    hardCut: 'Corte seco',
    linearPan: 'Transição linear',
    outsideClip: 'fora do Corte',
    seekKeyframe: 'Ir para o keyframe em {time}',
    deleteKeyframe: 'Excluir keyframe em {time}',
    errors: {
      model_missing: 'Instale o modelo YuNet em Componentes para analisar o enquadramento.',
      component_missing: 'Instale o Componente FFmpeg para analisar o enquadramento.',
      cancelled: 'Análise de enquadramento cancelada.',
      default: 'Não foi possível analisar o enquadramento.',
    } as Record<string, string>,
  },
  en: {
    layoutTitle: 'Clip layout',
    layouts: {
      face: 'Face',
      fit: 'Fit / center',
      gameplay_webcam: 'Game + webcam',
      two_people: 'Two people',
      fullscreen_roi: 'Fullscreen (ROI)',
    } as Record<CropLayout, string>,
    layoutDesc: {
      face: '9:16 Fill following the face with automatic suggestion and manual edits.',
      fit: 'Entire Source centered with black bars and optional manual pan/zoom.',
      gameplay_webcam: 'Webcam on top and gameplay below. Position the webcam rectangle manually or use the low-confidence suggestion.',
      two_people: 'Two stacked panels with independent pan and zoom per person.',
      fullscreen_roi: '9:16 Fill with manual area of interest (move and zoom, no face tracking).',
    } as Record<CropLayout, string>,
    panelSelector: 'Active panel',
    panelNames: {
      gameplay_webcam: { top: 'Webcam', bottom: 'Game' },
      two_people: { top: 'Person 1 (top)', bottom: 'Person 2 (bottom)' },
    } as Record<'gameplay_webcam' | 'two_people', { top: string; bottom: string }>,
    splitLabelWebcam: 'Webcam height',
    splitLabelTwoPeople: 'Top split',
    webcamLowConfidence: 'Primary path: position or resize the webcam rectangle manually. Automatic detection is low-confidence.',
    sourceFrame: 'Source frame',
    cropHandle: 'Crop area on Source',
    sourceVideo: 'Source video for framing',
    hint: 'Drag the rectangle over the 16:9 Source, click to place, or use arrow keys (Shift for larger step).',
    preparingPreview: 'Waiting for Source preview…',
    zoom: 'Crop zoom',
    center: 'Center',
    addKeyframe: 'Add keyframe',
    analyze: 'Suggest framing',
    reanalyze: 'Re-run analysis',
    analyzing: 'Analyzing framing… {progress}%',
    cancelAnalysis: 'Cancel analysis',
    clearEdits: 'Clear edits',
    statusTitle: 'Suggestion and edits',
    suggestionPresent: 'Automatic suggestion: {segments} segment(s). Segments without manual keyframes keep the suggestion.',
    suggestionLowConf: 'Low-confidence automatic suggestion applied ({confidence}%). Adjust the rectangle manually if needed.',
    suggestionAbsent: 'No automatic suggestion. Without manual edits, uses the layout default.',
    manualOnlyHint: 'Manual layout: no automatic face tracking.',
    editsCount: '{count} manual keyframe(s)',
    noEdits: 'No manual edits recorded.',
    keyframesTitle: 'Manual keyframes',
    hardCut: 'Hard cut',
    linearPan: 'Linear pan',
    outsideClip: 'outside Clip',
    seekKeyframe: 'Jump to keyframe at {time}',
    deleteKeyframe: 'Delete keyframe at {time}',
    errors: {
      model_missing: 'Install the YuNet model in Components to analyze framing.',
      component_missing: 'Install the FFmpeg Component to analyze framing.',
      cancelled: 'Framing analysis cancelled.',
      default: 'Could not analyze framing.',
    } as Record<string, string>,
  },
};

const mediaUrl = (key: string) => buildMediaUrl(`proxy/${key}`);
const msClock = (us: number) => `${clock(us)}.${String(Math.floor(Math.max(0, us % 1_000_000) / 1000)).padStart(3, '0')}`;
const errorCode = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '');

export function CropPanel({
  clipId,
  sourceId,
  range,
  sourceUs,
  fps,
  rate,
  sourceAspect: initialAspect,
  proxy,
  crop,
  busy,
  onPreviewLayout,
  onCommitLayout,
  onPreviewEdits,
  onCommitEdits,
  onSuggestionApplied,
  onSeek,
  onPause,
}: {
  clipId: number;
  sourceId: number;
  range: { startUs: number; endUs: number };
  sourceUs: number;
  fps: number;
  rate: number;
  sourceAspect?: number;
  proxy: PreviewProxyInfo | null;
  crop: ClipCrop;
  busy: boolean;
  onPreviewLayout: (next: { layout: CropLayout; splitRatio: number } | null) => void;
  onCommitLayout: (layout: CropLayout, splitRatio?: number) => void;
  onPreviewEdits: (next: { panel: CropPanelSlot; layout: CropLayout; edits: CropKeyframe[] } | null) => void;
  onCommitEdits: (edits: CropKeyframe[], panel: CropPanelSlot, layout: CropLayout) => void;
  onSuggestionApplied: (answer: CropAnswer) => void;
  onSeek: (us: number) => void;
  onPause: () => void;
}) {
  const t = useText(texts);
  const videoRef = useRef<HTMLVideoElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const [sourceAspect, setSourceAspect] = useState(initialAspect && initialAspect > 0.1 ? initialAspect : 16 / 9);
  const [activeSubPanel, setActiveSubPanel] = useState<'top' | 'bottom'>('top');
  const [reframe, setReframe] = useState<ReframeStatus | null>(null);
  const [reframeError, setReframeError] = useState('');
  const zoomDragRef = useRef(false);
  const splitDragRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    panel: CropPanelSlot;
    layout: CropLayout;
    offsetX: number;
    offsetY: number;
    rect: CropRect;
    lastRect: CropRect;
    timeUs: number;
    baseEdits: CropKeyframe[];
    moved: boolean;
  } | null>(null);

  const matchToleranceUs = useMemo(() => Math.max(10_000, Math.round(500_000 / Math.max(1, fps))), [fps]);
  const activeLayout = effectiveCropLayout(crop);
  const isDual = activeLayout === 'gameplay_webcam' || activeLayout === 'two_people';
  const activeSlot: CropPanelSlot = isDual ? activeSubPanel : 'primary';

  const plan = useMemo(
    () => crop.plan ?? resolveCropPlan(crop, sourceAspect, range.startUs, range.endUs),
    [crop, sourceAspect, range.startUs, range.endUs],
  );

  const bounds = splitBounds(activeLayout);
  const splitPct = Math.round(plan.splitRatio * 100);
  const [splitUi, setSplitUi] = useState(splitPct);
  useEffect(() => {
    if (!splitDragRef.current) setSplitUi(splitPct);
  }, [splitPct]);

  const topPanel = plan.panels[0];
  const botPanel = isDual ? plan.panels[1] : null;
  const topRect = useMemo(
    () => (topPanel ? interpolateCrop(topPanel.segments, sourceUs) : null) ?? defaultPanelRect(sourceAspect, 9 / 16),
    [topPanel, sourceUs, sourceAspect],
  );
  const botRect = useMemo(
    () => (botPanel ? interpolateCrop(botPanel.segments, sourceUs) : null),
    [botPanel, sourceUs],
  );

  const activePanelPlan = activeSlot === 'bottom' && botPanel ? botPanel : topPanel;
  const activePanelAspect = activePanelPlan ? activePanelPlan.targetWidth / activePanelPlan.targetHeight : 9 / 16;
  const currentRect = activeSlot === 'bottom' && botRect ? botRect : topRect;

  const activeEdits = useMemo(() => {
    if (activeLayout === 'gameplay_webcam') {
      const dual = crop.gameplayWebcam;
      return activeSubPanel === 'bottom' ? (dual?.bottom.edits ?? []) : (dual?.top.edits ?? []);
    }
    if (activeLayout === 'two_people') {
      const dual = crop.twoPeople;
      return activeSubPanel === 'bottom' ? (dual?.bottom.edits ?? []) : (dual?.top.edits ?? []);
    }
    return crop.edits;
  }, [activeLayout, activeSubPanel, crop.edits, crop.gameplayWebcam, crop.twoPeople]);

  const activeSuggested = useMemo(() => {
    if (activeLayout === 'gameplay_webcam') {
      const dual = crop.gameplayWebcam;
      return activeSubPanel === 'bottom' ? dual?.bottom.suggested : dual?.top.suggested;
    }
    if (activeLayout === 'two_people') {
      const dual = crop.twoPeople;
      return activeSubPanel === 'bottom' ? dual?.bottom.suggested : dual?.top.suggested;
    }
    if (activeLayout === 'face') return crop.suggested;
    return null;
  }, [activeLayout, activeSubPanel, crop.suggested, crop.gameplayWebcam, crop.twoPeople]);

  const maxZoom = activeLayout === 'gameplay_webcam' && activeSubPanel === 'top' ? 6 : isDual ? 4 : 2.5;
  const zoomPct = Math.round(
    (activeLayout === 'fit'
      ? fitZoomFactor(currentRect)
      : panelZoomFactor(currentRect, sourceAspect, activePanelAspect, maxZoom)) * 100,
  );
  const [zoomUi, setZoomUi] = useState(zoomPct);
  useEffect(() => {
    if (!zoomDragRef.current) setZoomUi(zoomPct);
  }, [zoomPct]);

  // Sincroniza o quadro do vídeo 16:9 da Fonte com o playhead atual do editor.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || proxy?.state !== 'ready') return;
    const targetSec = toProxySeconds(sourceUs, proxy.windowStartUs, proxy.windowEndUs);
    if (targetSec === null) return;
    if (rate > 0) {
      el.playbackRate = rate;
      if (Math.abs(el.currentTime - targetSec) > 0.35 && el.readyState >= 1) {
        el.currentTime = targetSec;
      }
      if (el.paused) void el.play().catch(() => {});
    } else {
      if (!el.paused) el.pause();
      if (el.readyState >= 1 && Math.abs(el.currentTime - targetSec) > 0.005) {
        el.currentTime = targetSec;
      }
    }
  }, [proxy?.state, proxy?.key, proxy?.windowStartUs, proxy?.windowEndUs, sourceUs, rate]);

  // Acompanha análise de reenquadramento quando iniciada neste painel.
  useEffect(() => {
    if (!reframe || (reframe.state !== 'queued' && reframe.state !== 'running')) return;
    let alive = true;
    const poll = async () => {
      try {
        const next = await coreDispatch<ReframeStatus>('reframe.status', { id: reframe.id });
        if (!alive) return;
        setReframe(next);
        if (next.state === 'completed') {
          const applied = await coreDispatch<CropAnswer>('editor.crop.set_suggested', { clip_id: clipId, reframe_id: next.id });
          if (alive) onSuggestionApplied(applied);
        } else if (next.state === 'failed' || next.state === 'cancelled') {
          setReframeError(t.errors[next.error?.code ?? ''] ?? t.errors.default);
        }
      } catch (e) {
        if (alive) {
          setReframe(null);
          setReframeError(t.errors[errorCode(e)] ?? t.errors.default);
        }
      }
    };
    const timer = window.setTimeout(() => void poll(), 120);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [reframe, clipId, onSuggestionApplied, t.errors]);

  const commitAtPlayhead = (rect: CropRect, timeUs = Math.round(sourceUs), slot = activeSlot, edits = activeEdits) => {
    onCommitEdits(upsertCropKeyframe(edits, { timeUs, ...rect }, matchToleranceUs), slot, activeLayout);
  };

  const previewAtTime = (baseEdits: CropKeyframe[], timeUs: number, rect: CropRect, slot: CropPanelSlot, layout: CropLayout) => {
    onPreviewEdits({ panel: slot, layout, edits: upsertCropKeyframe(baseEdits, { timeUs, ...rect }, matchToleranceUs) });
  };

  const computeRectFromPointer = (e: PointerEvent<HTMLDivElement>, offsetX: number, offsetY: number, baseRect: CropRect): CropRect => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return baseRect;
    const nx = (e.clientX - box.left) / box.width;
    const ny = (e.clientY - box.top) / box.height;
    return clampCropRect({
      ...baseRect,
      x: nx - offsetX,
      y: ny - offsetY,
    });
  };

  const onSourcePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || busy || dragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    onPause();
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    const nx = (e.clientX - box.left) / box.width;
    const ny = (e.clientY - box.top) / box.height;
    const hitSlotAttr = (e.target as HTMLElement).closest('[data-crop-rect-slot]')?.getAttribute('data-crop-rect-slot');
    let slot: CropPanelSlot = activeSlot;
    if (isDual && (hitSlotAttr === 'top' || hitSlotAttr === 'bottom')) {
      slot = hitSlotAttr;
      setActiveSubPanel(hitSlotAttr);
    }
    const targetRect = slot === 'bottom' && botRect ? botRect : topRect;
    const targetEdits = isDual
      ? (activeLayout === 'gameplay_webcam'
        ? (slot === 'bottom' ? (crop.gameplayWebcam?.bottom.edits ?? []) : (crop.gameplayWebcam?.top.edits ?? []))
        : (slot === 'bottom' ? (crop.twoPeople?.bottom.edits ?? []) : (crop.twoPeople?.top.edits ?? [])))
      : crop.edits;
    const onHandle = Boolean(hitSlotAttr);
    const offsetX = onHandle ? nx - targetRect.x : targetRect.width / 2;
    const offsetY = onHandle ? ny - targetRect.y : targetRect.height / 2;
    const timeUs = Math.round(sourceUs);
    const initialRect = onHandle
      ? targetRect
      : clampCropRect({ ...targetRect, x: nx - offsetX, y: ny - offsetY });
    dragRef.current = {
      pointerId: e.pointerId,
      panel: slot,
      layout: activeLayout,
      offsetX,
      offsetY,
      rect: targetRect,
      lastRect: initialRect,
      timeUs,
      baseEdits: targetEdits,
      moved: !onHandle,
    };
    handleRef.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!onHandle) {
      previewAtTime(targetEdits, timeUs, initialRect, slot, activeLayout);
    }
  };

  const onSourcePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const nextRect = computeRectFromPointer(e, drag.offsetX, drag.offsetY, drag.rect);
    drag.lastRect = nextRect;
    drag.moved = true;
    previewAtTime(drag.baseEdits, drag.timeUs, nextRect, drag.panel, drag.layout);
  };

  const finishDrag = (e: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    onPreviewEdits(null);
    if (commit && drag.moved) {
      const finalRect = computeRectFromPointer(e, drag.offsetX, drag.offsetY, drag.rect);
      onCommitEdits(upsertCropKeyframe(drag.baseEdits, { timeUs: drag.timeUs, ...finalRect }, matchToleranceUs), drag.panel, drag.layout);
    }
  };

  const startReframe = async () => {
    setReframeError('');
    try {
      const reframeLayout = isDual ? activeLayout : 'face';
      const started = await coreDispatch<ReframeStatus>('reframe.start', {
        source: sourceId,
        startUs: range.startUs,
        endUs: range.endUs,
        requested: true,
        layout: reframeLayout,
        ...(isDual ? { splitRatio: plan.splitRatio } : {}),
        force: Boolean(activeSuggested),
      });
      setReframe(started);
      if (started.state === 'completed') {
        const applied = await coreDispatch<CropAnswer>('editor.crop.set_suggested', { clip_id: clipId, reframe_id: started.id });
        onSuggestionApplied(applied);
      }
    } catch (e) {
      setReframeError(t.errors[errorCode(e)] ?? t.errors.default);
    }
  };

  const cancelReframe = async () => {
    if (!reframe) return;
    try {
      await coreDispatch('jobs.cancel', { id: reframe.job });
    } catch {
      /* tarefa já encerrou */
    }
  };

  const supportsAnalysis = activeLayout === 'face' || isDual;
  const suggestedSegmentsCount = activeSuggested?.segments?.length ?? 0;
  const firstSuggestedConf = activeSuggested?.segments?.[0]?.keyframes?.[0]?.confidence;
  const analyzing = reframe?.state === 'queued' || reframe?.state === 'running';
  const centerPct = Math.round((currentRect.x + currentRect.width / 2) * 100);
  const proxyReady = proxy?.state === 'ready';
  const panelNames = isDual ? t.panelNames[activeLayout] : null;

  const zoomFor = (z: number) => (
    activeLayout === 'fit'
      ? zoomFitRect(currentRect, z)
      : zoomPanelRect(currentRect, sourceAspect, activePanelAspect, z, maxZoom)
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm" data-crop-panel data-active-crop-layout={activeLayout}>
      <section className="flex shrink-0 flex-col gap-1.5" aria-label={t.layoutTitle}>
        <h4 className="text-xs font-medium text-fg-2">{t.layoutTitle}</h4>
        <div role="radiogroup" aria-label={t.layoutTitle} className="grid grid-cols-2 gap-1.5">
          {LAYOUT_ORDER.map(layout => {
            const selected = activeLayout === layout;
            return (
              <button
                key={layout}
                type="button"
                role="radio"
                aria-checked={selected}
                data-crop-layout-option={layout}
                disabled={busy}
                onClick={() => {
                  onPause();
                  setReframeError('');
                  onCommitLayout(layout);
                }}
                className={`foco rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                  selected ? 'border-accent bg-accent-subtle font-medium text-fg' : 'border-line bg-field text-fg-2 hover:bg-hover'
                }`}
              >
                {t.layouts[layout]}
              </button>
            );
          })}
        </div>
        <p className="text-xs leading-relaxed text-fg-3">{t.layoutDesc[activeLayout]}</p>
        {activeLayout === 'gameplay_webcam' && (
          <p className="rounded-md border border-line bg-warning-subtle px-2 py-1.5 text-xs text-fg" data-webcam-low-confidence-notice>
            {t.webcamLowConfidence}
          </p>
        )}
      </section>

      {isDual && bounds && panelNames && (
        <section className="flex shrink-0 flex-col gap-2 border-t border-line pt-2.5" aria-label={t.panelSelector}>
          <div className="flex gap-1.5" role="group" aria-label={t.panelSelector}>
            {(['top', 'bottom'] as const).map(slot => (
              <Button
                key={slot}
                tamanho="sm"
                variante={activeSubPanel === slot ? 'secundario' : 'fantasma'}
                data-crop-panel-tab={slot}
                aria-pressed={activeSubPanel === slot}
                onClick={() => setActiveSubPanel(slot)}
              >
                {panelNames[slot]}
              </Button>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="flex items-center justify-between text-xs text-fg-2">
              <span>{activeLayout === 'gameplay_webcam' ? t.splitLabelWebcam : t.splitLabelTwoPeople}</span>
              <span className="font-mono" data-crop-split-pct>{splitUi}%</span>
            </span>
            <input
              type="range"
              aria-label={activeLayout === 'gameplay_webcam' ? t.splitLabelWebcam : t.splitLabelTwoPeople}
              data-crop-split-slider
              min={Math.round(bounds[1] * 100)}
              max={Math.round(bounds[2] * 100)}
              step={1}
              value={splitUi}
              disabled={busy}
              className="foco w-full"
              onPointerDown={() => {
                splitDragRef.current = true;
                onPause();
              }}
              onPointerUp={() => {
                if (splitDragRef.current) {
                  splitDragRef.current = false;
                  onPreviewLayout(null);
                  onCommitLayout(activeLayout, splitUi / 100);
                }
              }}
              onPointerCancel={() => {
                splitDragRef.current = false;
                onPreviewLayout(null);
              }}
              onChange={e => {
                const next = Number(e.target.value);
                setSplitUi(next);
                if (splitDragRef.current) {
                  onPreviewLayout({ layout: activeLayout, splitRatio: next / 100 });
                } else {
                  onCommitLayout(activeLayout, next / 100);
                }
              }}
            />
          </label>
        </section>
      )}

      <section className="flex shrink-0 flex-col gap-2 border-t border-line pt-2.5" aria-label={t.sourceFrame}>
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-fg-2">{t.sourceFrame}</span>
          <span className="font-mono text-fg-2" data-crop-center-pct>{centerPct}% · {zoomUi}%</span>
        </div>

        <div
          data-crop-source
          data-crop-aspect={sourceAspect.toFixed(4)}
          className="relative w-full cursor-crosshair touch-none overflow-hidden rounded-md border border-line bg-letterbox select-none"
          style={{ aspectRatio: String(sourceAspect) }}
          onPointerDown={onSourcePointerDown}
          onPointerMove={onSourcePointerMove}
          onPointerUp={e => finishDrag(e, true)}
          onPointerCancel={e => finishDrag(e, false)}
          onLostPointerCapture={() => {
            if (dragRef.current) {
              dragRef.current = null;
              onPreviewEdits(null);
            }
          }}
        >
          {proxyReady ? (
            <video
              ref={videoRef}
              src={mediaUrl(proxy.key)}
              aria-label={t.sourceVideo}
              muted
              playsInline
              preload="auto"
              className="pointer-events-none h-full w-full object-fill"
              onLoadedMetadata={e => {
                const el = e.currentTarget;
                if (el.videoWidth > 0 && el.videoHeight > 0) {
                  setSourceAspect(el.videoWidth / el.videoHeight);
                }
                const targetSec = toProxySeconds(sourceUs, proxy.windowStartUs, proxy.windowEndUs);
                if (targetSec !== null) el.currentTime = targetSec;
              }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-3 text-center text-xs text-fg-3">
              {t.preparingPreview}
            </div>
          )}

          {isDual && botRect && panelNames ? (
            <>
              {(['top', 'bottom'] as const).map(slot => {
                const rect = slot === 'top' ? topRect : botRect;
                const isActive = activeSubPanel === slot;
                const slotCenter = Math.round((rect.x + rect.width / 2) * 100);
                return (
                  <div
                    key={slot}
                    ref={isActive ? handleRef : undefined}
                    tabIndex={isActive ? 0 : -1}
                    role={isActive ? 'slider' : undefined}
                    data-foco-inicial={isActive ? true : undefined}
                    data-crop-handle={isActive ? true : undefined}
                    data-crop-rect-slot={slot}
                    aria-label={isActive ? `${t.cropHandle} (${panelNames[slot]})` : panelNames[slot]}
                    aria-valuemin={isActive ? 0 : undefined}
                    aria-valuemax={isActive ? 100 : undefined}
                    aria-valuenow={isActive ? slotCenter : undefined}
                    aria-valuetext={isActive ? `${slotCenter}%` : undefined}
                    className={`foco absolute cursor-grab touch-none border-2 active:cursor-grabbing ${
                      isActive ? 'z-10 border-handle bg-accent-subtle/60 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]' : 'border-dashed border-line-strong bg-transparent opacity-80'
                    }`}
                    style={{
                      left: `${rect.x * 100}%`,
                      top: `${rect.y * 100}%`,
                      width: `${rect.width * 100}%`,
                      height: `${rect.height * 100}%`,
                    }}
                    onKeyDown={isActive ? e => {
                      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) {
                        return;
                      }
                      e.preventDefault();
                      e.stopPropagation();
                      onPause();
                      const step = e.shiftKey ? 0.05 : 0.01;
                      const next = { ...rect };
                      if (e.key === 'Home') next.x = 0;
                      else if (e.key === 'End') next.x = 1 - next.width;
                      else if (e.key === 'ArrowLeft') next.x -= step;
                      else if (e.key === 'ArrowRight') next.x += step;
                      else if (e.key === 'ArrowUp') next.y -= step;
                      else if (e.key === 'ArrowDown') next.y += step;
                      commitAtPlayhead(clampCropRect(next));
                    } : undefined}
                  >
                    <span className="pointer-events-none absolute top-1 left-1 rounded-xs bg-letterbox/90 px-1 text-[10px] font-medium text-white">
                      {panelNames[slot]}
                    </span>
                  </div>
                );
              })}
            </>
          ) : (
            <div
              ref={handleRef}
              tabIndex={0}
              role="slider"
              data-foco-inicial
              data-crop-handle
              data-crop-rect-slot="primary"
              aria-label={t.cropHandle}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={centerPct}
              aria-valuetext={`${centerPct}%`}
              className="foco absolute cursor-grab touch-none border-2 border-handle bg-accent-subtle shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] active:cursor-grabbing"
              style={{
                left: `${currentRect.x * 100}%`,
                top: `${currentRect.y * 100}%`,
                width: `${currentRect.width * 100}%`,
                height: `${currentRect.height * 100}%`,
              }}
              onKeyDown={e => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) {
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                onPause();
                const step = e.shiftKey ? 0.05 : 0.01;
                const next = { ...currentRect };
                if (e.key === 'Home') next.x = 0;
                else if (e.key === 'End') next.x = 1 - next.width;
                else if (e.key === 'ArrowLeft') next.x -= step;
                else if (e.key === 'ArrowRight') next.x += step;
                else if (e.key === 'ArrowUp') next.y -= step;
                else if (e.key === 'ArrowDown') next.y += step;
                commitAtPlayhead(clampCropRect(next));
              }}
            >
              <span className="pointer-events-none absolute top-1 left-1 rounded-xs bg-letterbox/90 px-1 text-[10px] font-medium text-white">
                {activeLayout === 'fit' ? 'Fit' : '9:16'}
              </span>
            </div>
          )}
        </div>

        <p className="text-xs leading-relaxed text-fg-3">{t.hint}</p>

        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between text-xs text-fg-2">
            <span>{t.zoom}</span>
            <span className="font-mono">{zoomUi}%</span>
          </span>
          <input
            type="range"
            aria-label={t.zoom}
            min={100}
            max={Math.round(maxZoom * 100)}
            step={5}
            value={Math.min(zoomUi, Math.round(maxZoom * 100))}
            disabled={busy}
            className="foco w-full"
            onPointerDown={() => {
              zoomDragRef.current = true;
              onPause();
            }}
            onPointerUp={() => {
              if (zoomDragRef.current) {
                zoomDragRef.current = false;
                onPreviewEdits(null);
                commitAtPlayhead(zoomFor(zoomUi / 100));
              }
            }}
            onPointerCancel={() => {
              zoomDragRef.current = false;
              onPreviewEdits(null);
            }}
            onChange={e => {
              const nextZoom = Number(e.target.value);
              setZoomUi(nextZoom);
              const nextRect = zoomFor(nextZoom / 100);
              if (zoomDragRef.current) {
                previewAtTime(activeEdits, Math.round(sourceUs), nextRect, activeSlot, activeLayout);
              } else {
                commitAtPlayhead(nextRect);
              }
            }}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            tamanho="sm"
            disabled={busy}
            onClick={() => {
              onPause();
              const centered = clampCropRect({
                ...currentRect,
                x: (1 - currentRect.width) / 2,
                y: (1 - currentRect.height) / 2,
              });
              commitAtPlayhead(centered);
            }}
          >
            {t.center}
          </Button>
          <Button
            tamanho="sm"
            variante="primario"
            icone={<Plus size={14} />}
            disabled={busy}
            onClick={() => {
              onPause();
              commitAtPlayhead(currentRect);
            }}
          >
            {t.addKeyframe}
          </Button>
        </div>
      </section>

      <section className="flex shrink-0 flex-col gap-2 border-t border-line pt-3" aria-label={t.statusTitle}>
        <h4 className="text-xs font-medium text-fg-2">{t.statusTitle}</h4>
        <p className="text-xs text-fg-3">
          {!supportsAnalysis
            ? t.manualOnlyHint
            : activeSuggested
              ? (activeLayout === 'gameplay_webcam' && typeof firstSuggestedConf === 'number'
                ? fill(t.suggestionLowConf, { confidence: Math.round(firstSuggestedConf * 100) })
                : fill(t.suggestionPresent, { segments: suggestedSegmentsCount }))
              : t.suggestionAbsent}
        </p>
        <p className="font-mono text-xs text-fg-2" data-crop-edits-count={activeEdits.length}>
          {activeEdits.length > 0 ? fill(t.editsCount, { count: activeEdits.length }) : t.noEdits}
        </p>
        <div className="flex flex-wrap gap-2">
          {supportsAnalysis && (analyzing ? (
            <>
              <span className="text-xs text-fg-2" role="status">
                {fill(t.analyzing, { progress: reframe?.progress ?? 0 })}
              </span>
              <Button tamanho="sm" onClick={() => void cancelReframe()}>
                {t.cancelAnalysis}
              </Button>
            </>
          ) : (
            <Button
              tamanho="sm"
              icone={activeSuggested ? <RefreshCw size={13} /> : <Sparkles size={13} />}
              disabled={busy}
              onClick={() => void startReframe()}
            >
              {activeSuggested ? t.reanalyze : t.analyze}
            </Button>
          ))}
          <Button
            tamanho="sm"
            variante="fantasma"
            icone={<RotateCcw size={13} />}
            disabled={busy || activeEdits.length === 0}
            onClick={() => onCommitEdits([], activeSlot, activeLayout)}
          >
            {t.clearEdits}
          </Button>
        </div>
        {reframeError && (
          <p role="alert" className="rounded-md border border-line bg-warning-subtle px-2.5 py-1.5 text-xs text-fg">
            {reframeError}
          </p>
        )}
      </section>

      <section className="flex shrink-0 flex-col gap-2 border-t border-line pt-3" aria-label={t.keyframesTitle}>
        <h4 className="text-xs font-medium text-fg-2">{t.keyframesTitle}</h4>
        {activeEdits.length === 0 ? (
          <p className="text-xs text-fg-3">{t.noEdits}</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {activeEdits.map((k, idx) => {
              const outside = k.timeUs < range.startUs || k.timeUs > range.endUs;
              const kCenter = Math.round((k.x + k.width / 2) * 100);
              const kZoom = Math.round(
                (activeLayout === 'fit'
                  ? fitZoomFactor(k)
                  : panelZoomFactor(k, sourceAspect, activePanelAspect, maxZoom)) * 100,
              );
              const timeLabel = msClock(k.timeUs);
              return (
                <li
                  key={k.timeUs}
                  data-crop-keyframe={k.timeUs}
                  data-crop-cut={k.cut ? 'true' : 'false'}
                  className="flex items-center justify-between gap-1.5 rounded-md border border-line bg-field px-2 py-1.5 text-xs"
                >
                  <button
                    type="button"
                    aria-label={fill(t.seekKeyframe, { time: timeLabel })}
                    className="foco flex min-w-0 flex-1 flex-col items-start rounded-xs px-1 text-left hover:bg-hover"
                    onClick={() => {
                      onPause();
                      onSeek(k.timeUs);
                    }}
                  >
                    <span className="font-mono text-fg">
                      {timeLabel}
                      {outside && <span className="ml-1.5 text-[11px] text-fg-3">({t.outsideClip})</span>}
                    </span>
                    <span className="font-mono text-[11px] text-fg-2">
                      {kCenter}% · {kZoom}% · {k.cut ? t.hardCut : t.linearPan}
                    </span>
                  </button>
                  {idx > 0 && (
                    <Button
                      tamanho="sm"
                      variante="fantasma"
                      aria-pressed={Boolean(k.cut)}
                      title={t.hardCut}
                      icone={<Scissors size={12} />}
                      disabled={busy}
                      onClick={() => onCommitEdits(toggleCropKeyframeCut(activeEdits, k.timeUs), activeSlot, activeLayout)}
                    >
                      {t.hardCut}
                    </Button>
                  )}
                  <IconButton
                    rotulo={fill(t.deleteKeyframe, { time: timeLabel })}
                    tamanho="sm"
                    disabled={busy}
                    onClick={() => onCommitEdits(removeCropKeyframe(activeEdits, k.timeUs), activeSlot, activeLayout)}
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
