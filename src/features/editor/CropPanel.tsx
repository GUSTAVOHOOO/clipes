import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { isTauri, convertFileSrc } from '@tauri-apps/api/core';
import { Plus, RefreshCw, RotateCcw, Scissors, Sparkles, Trash2 } from 'lucide-react';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button, IconButton } from '@/components/ui/Button';
import { clock, fill } from '@/features/projects/selectionFormat';
import { toProxySeconds, type PreviewProxyInfo } from '@/features/projects/CutPreview';
import {
  clampCropRect,
  cropZoomFactor,
  defaultCropRect,
  interpolateCrop,
  removeCropKeyframe,
  toggleCropKeyframeCut,
  upsertCropKeyframe,
  zoomCropRect,
  type ClipCrop,
  type CropKeyframe,
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

const texts = {
  'pt-BR': {
    sourceFrame: 'Quadro da Fonte',
    cropHandle: 'Área de recorte 9:16 na Fonte',
    sourceVideo: 'Vídeo da Fonte para enquadramento',
    hint: 'Arraste o recorte sobre a Fonte 16:9 ou use as setas com ele em foco (Shift para passo maior). Cada alteração cria um keyframe nesta posição.',
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
    suggestionAbsent: 'Sem sugestão automática. Sem correções manuais, o export usa Fit 9:16.',
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
    sourceFrame: 'Source frame',
    cropHandle: '9:16 crop area on Source',
    sourceVideo: 'Source video for framing',
    hint: 'Drag the crop over the 16:9 Source or use arrow keys when focused (Shift for larger step). Each change sets a keyframe at this time.',
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
    suggestionAbsent: 'No automatic suggestion. Without manual edits, export uses 9:16 Fit.',
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

const mediaUrl = (key: string) => (isTauri() ? convertFileSrc(`proxy/${key}`, 'clipes-media') : `/__clipes-media__/proxy/${key}`);
const msClock = (us: number) => `${clock(us)}.${String(Math.floor(Math.max(0, us % 1_000_000) / 1000)).padStart(3, '0')}`;
const errorCode = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '');

export function CropPanel({
  clipId,
  sourceId,
  range,
  sourceUs,
  fps,
  rate,
  proxy,
  crop,
  busy,
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
  proxy: PreviewProxyInfo | null;
  crop: ClipCrop;
  busy: boolean;
  onPreviewEdits: (edits: CropKeyframe[] | null) => void;
  onCommitEdits: (edits: CropKeyframe[]) => void;
  onSuggestionApplied: (answer: CropAnswer) => void;
  onSeek: (us: number) => void;
  onPause: () => void;
}) {
  const t = useText(texts);
  const videoRef = useRef<HTMLVideoElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const [sourceAspect, setSourceAspect] = useState(16 / 9);
  const [reframe, setReframe] = useState<ReframeStatus | null>(null);
  const [reframeError, setReframeError] = useState('');
  const zoomDragRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    rect: CropRect;
    lastRect: CropRect;
    timeUs: number;
    baseEdits: CropKeyframe[];
    moved: boolean;
  } | null>(null);

  const matchToleranceUs = useMemo(() => Math.max(10_000, Math.round(500_000 / Math.max(1, fps))), [fps]);

  const currentRect = useMemo(
    () => interpolateCrop(crop.resolved, sourceUs) ?? defaultCropRect(sourceAspect),
    [crop.resolved, sourceUs, sourceAspect],
  );
  const zoomPct = Math.round(cropZoomFactor(currentRect, sourceAspect) * 100);
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

  const commitAtPlayhead = (rect: CropRect, timeUs = Math.round(sourceUs)) => {
    onCommitEdits(upsertCropKeyframe(crop.edits, { timeUs, ...rect }, matchToleranceUs));
  };

  const previewAtTime = (baseEdits: CropKeyframe[], timeUs: number, rect: CropRect) => {
    onPreviewEdits(upsertCropKeyframe(baseEdits, { timeUs, ...rect }, matchToleranceUs));
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
    const onHandle = Boolean((e.target as HTMLElement).closest('[data-crop-handle]'));
    const offsetX = onHandle ? nx - currentRect.x : currentRect.width / 2;
    const offsetY = onHandle ? ny - currentRect.y : currentRect.height / 2;
    const timeUs = Math.round(sourceUs);
    const initialRect = onHandle
      ? currentRect
      : clampCropRect({ ...currentRect, x: nx - offsetX, y: ny - offsetY });
    dragRef.current = {
      pointerId: e.pointerId,
      offsetX,
      offsetY,
      rect: currentRect,
      lastRect: initialRect,
      timeUs,
      baseEdits: crop.edits,
      moved: !onHandle,
    };
    handleRef.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!onHandle) {
      previewAtTime(crop.edits, timeUs, initialRect);
    }
  };

  const onSourcePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const nextRect = computeRectFromPointer(e, drag.offsetX, drag.offsetY, drag.rect);
    drag.lastRect = nextRect;
    drag.moved = true;
    previewAtTime(drag.baseEdits, drag.timeUs, nextRect);
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
      onCommitEdits(upsertCropKeyframe(drag.baseEdits, { timeUs: drag.timeUs, ...finalRect }, matchToleranceUs));
    }
  };

  const startReframe = async () => {
    setReframeError('');
    try {
      const started = await coreDispatch<ReframeStatus>('reframe.start', {
        source: sourceId,
        startUs: range.startUs,
        endUs: range.endUs,
        requested: true,
        force: Boolean(crop.suggested),
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

  const suggestedSegmentsCount = crop.suggested?.segments?.length ?? 0;
  const analyzing = reframe?.state === 'queued' || reframe?.state === 'running';
  const centerPct = Math.round((currentRect.x + currentRect.width / 2) * 100);
  const proxyReady = proxy?.state === 'ready';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm" data-crop-panel>
      <section className="flex shrink-0 flex-col gap-2" aria-label={t.sourceFrame}>
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

          <div
            ref={handleRef}
            tabIndex={0}
            role="slider"
            data-foco-inicial
            data-crop-handle
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
              let next = { ...currentRect };
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
              9:16
            </span>
          </div>
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
            max={250}
            step={5}
            value={zoomUi}
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
                commitAtPlayhead(zoomCropRect(currentRect, sourceAspect, zoomUi / 100));
              }
            }}
            onPointerCancel={() => {
              zoomDragRef.current = false;
              onPreviewEdits(null);
            }}
            onChange={e => {
              const nextZoom = Number(e.target.value);
              setZoomUi(nextZoom);
              const nextRect = zoomCropRect(currentRect, sourceAspect, nextZoom / 100);
              if (zoomDragRef.current) {
                previewAtTime(crop.edits, Math.round(sourceUs), nextRect);
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
          {crop.suggested ? fill(t.suggestionPresent, { segments: suggestedSegmentsCount }) : t.suggestionAbsent}
        </p>
        <p className="font-mono text-xs text-fg-2" data-crop-edits-count={crop.edits.length}>
          {crop.edits.length > 0 ? fill(t.editsCount, { count: crop.edits.length }) : t.noEdits}
        </p>
        <div className="flex flex-wrap gap-2">
          {analyzing ? (
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
              icone={crop.suggested ? <RefreshCw size={13} /> : <Sparkles size={13} />}
              disabled={busy}
              onClick={() => void startReframe()}
            >
              {crop.suggested ? t.reanalyze : t.analyze}
            </Button>
          )}
          <Button
            tamanho="sm"
            variante="fantasma"
            icone={<RotateCcw size={13} />}
            disabled={busy || crop.edits.length === 0}
            onClick={() => onCommitEdits([])}
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
        {crop.edits.length === 0 ? (
          <p className="text-xs text-fg-3">{t.noEdits}</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {crop.edits.map((k, idx) => {
              const outside = k.timeUs < range.startUs || k.timeUs > range.endUs;
              const kCenter = Math.round((k.x + k.width / 2) * 100);
              const kZoom = Math.round(cropZoomFactor(k, sourceAspect) * 100);
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
                      onClick={() => onCommitEdits(toggleCropKeyframeCut(crop.edits, k.timeUs))}
                    >
                      {t.hardCut}
                    </Button>
                  )}
                  <IconButton
                    rotulo={fill(t.deleteKeyframe, { time: timeLabel })}
                    tamanho="sm"
                    disabled={busy}
                    onClick={() => onCommitEdits(removeCropKeyframe(crop.edits, k.timeUs))}
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
