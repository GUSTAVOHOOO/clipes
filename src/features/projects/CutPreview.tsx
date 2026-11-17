import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { coreDispatch } from '@/lib/core';
import { mediaUrl as buildMediaUrl } from '@/lib/media';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { CaptionOverlay } from '@/features/captions/CaptionOverlay';
import type { CaptionData } from '@/features/captions/types';
import { cropVideoTransform, interpolateCrop, type CropSegment, type ResolvedCropPlan } from '@/features/editor/cropMath';
import { sourceToSplicedUs, type KeptSegment, type MontageState } from '@/features/editor/timelineMath';
import { activeNarrationAt, stepDuckGain, targetDuckGain, type PreviewNarrationSegment } from '@/features/editor/duckingMath';

/** Corte (ou candidato da seleção) a pré-visualizar: tempos em µs da Fonte. */
export type CutRange = { sourceId: number; startUs: number; endUs: number };
/** Pede ao preview aberto da Fonte que vá ao tempo `us` (µs da Fonte); a Transcrição usa ao clicar numa palavra. */
export type PreviewSeekEvent = { source_id: number; us: number };
export const previewSeekEvent = 'clipes-preview-seek';
export const previewOpenEvent = 'clipes-preview-open';
/** O preview aberto avisa o instante em que está (µs da Fonte); a capa (#74) usa para marcar o quadro. */
export type PreviewTimeEvent = { source_id: number; us: number };
export const previewTimeEvent = 'clipes-preview-time';
/** Abre o preview de um Corte ou candidato no painel da Fonte (#55 usa isto a partir da lista de candidatos). */
export function openCutPreview(cut: CutRange) { window.dispatchEvent(new CustomEvent<CutRange>(previewOpenEvent, { detail: cut })); }

type Proxy = { state: 'queued' | 'running' | 'ready' | 'failed' | 'cancelled' | 'missing'; key: string; job: number | null; progress: number; error: string | null; windowStartUs: number; windowEndUs: number };
type Status = Omit<Proxy, 'windowStartUs' | 'windowEndUs'>;

const texts = {
  'pt-BR': {
    title: 'Preview do Corte', video: 'Vídeo do preview em 9:16 com barras', play: 'Reproduzir', pause: 'Pausar', seek: 'Posição no preview', cancel: 'Cancelar preview', retry: 'Gerar de novo', close: 'Fechar preview',
    preparing: 'Preparando o preview do Corte', queued: 'Preview na fila', running: 'Gerando o preview', failed: 'Não foi possível gerar o preview.', cancelled: 'Preview cancelado.', outside: 'Esse trecho fica fora do preview deste Corte (a janela vai até 2 min antes e depois).', playError: 'O vídeo do preview não pôde ser tocado.', error: 'Não foi possível preparar o preview.',
    missingCodec: 'Faltam codecs GStreamer para H.264/AAC no sistema (comum no AppImage). Instale: sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav',
    code: { source_offline: 'A Fonte está offline: reconecte ou relocalize a Fonte para ver o preview.', source_changed: 'A Fonte foi alterada: verifique a identidade dela antes do preview.', component_missing: 'Instale o Componente FFmpeg para gerar o preview.', clip_too_long: 'O Corte é longo demais para o preview.', invalid_range: 'Intervalo do Corte inválido.' } as Record<string, string>,
  },
  en: {
    title: 'Clip preview', video: '9:16 preview video with bars', play: 'Play', pause: 'Pause', seek: 'Preview position', cancel: 'Cancel preview', retry: 'Generate again', close: 'Close preview',
    preparing: 'Preparing the Clip preview', queued: 'Preview queued', running: 'Generating the preview', failed: 'Could not generate the preview.', cancelled: 'Preview cancelled.', outside: 'That part is outside this Clip’s preview (the window spans 2 min before and after).', playError: 'The preview video could not be played.', error: 'Could not prepare the preview.',
    missingCodec: 'GStreamer codecs for H.264/AAC are missing on this system (common with AppImage). Install: sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav',
    code: { source_offline: 'The Source is offline: reconnect or relocate the Source to see the preview.', source_changed: 'The Source was changed: verify its identity before the preview.', component_missing: 'Install the FFmpeg Component to generate the preview.', clip_too_long: 'The Clip is too long for the preview.', invalid_range: 'Invalid Clip range.' } as Record<string, string>,
  },
};
function isLinuxMissingH264(): boolean {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return false;
  const platform = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  if (!/linux/i.test(platform) || /android/i.test(platform)) return false;
  const probe = document.createElement('video');
  return typeof probe.canPlayType === 'function' && probe.canPlayType('video/mp4; codecs="avc1.42E01E"') === '';
}
function clock(us: number) { const s = Math.max(0, Math.floor(us / 1_000_000)); const h = Math.floor(s / 3600); const m = String(Math.floor(s / 60) % 60).padStart(2, '0'); const ss = String(s % 60).padStart(2, '0'); return h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`; }
function code(error: unknown) { return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''; }
/** Tempo da Fonte (µs) para o do proxy (s); `null` fora da janela. Igual a `proxy::to_proxy_us` do núcleo. */
export function toProxySeconds(sourceUs: number, windowStartUs: number, windowEndUs: number): number | null {
  return sourceUs >= windowStartUs && sourceUs <= windowEndUs ? (sourceUs - windowStartUs) / 1_000_000 : null;
}
const mediaUrl = (key: string) => buildMediaUrl(`proxy/${key}`);
const narrationMediaUrl = (id: number) => buildMediaUrl(`narration/${id}`);

export type SkipInterval = { startUs: number; endUs: number };

/** Se `sourceUs` caiu dentro de um corte de silêncio ativo, devolve a borda de saída para pular. */
export function skipCutForward(sourceUs: number, intervals?: SkipInterval[]): number | null {
  if (!intervals || intervals.length === 0) return null;
  for (const cut of intervals) {
    if (sourceUs >= cut.startUs && sourceUs < cut.endUs - 5_000) return cut.endUs;
  }
  return null;
}

export type PreviewProxyInfo = { state: Proxy['state']; key: string; windowStartUs: number; windowEndUs: number };

/** Preview 9:16 em Fit (barras, sem corte) de um Corte, sobre o proxy de GOP curto gerado pelo núcleo. */
/** `rate` (editor, #61): 0 pausa, >0 toca nessa velocidade, <0 volta por passos. `onSourceTime` informa o tempo da Fonte a cada atualização. */
export function CutPreview({ sourceId, startUs, endUs, rate, onSourceTime, onProxyChange, captions, skipIntervals, crop, cropPlan, montage, keptSegments, clipStartUs, clipEndUs }: { sourceId: number; startUs: number; endUs: number; rate?: number; onSourceTime?: (sourceUs: number) => void; onProxyChange?: (proxy: PreviewProxyInfo | null) => void; captions?: CaptionData | null; skipIntervals?: SkipInterval[]; crop?: CropSegment[] | null; cropPlan?: ResolvedCropPlan | null; montage?: MontageState | null; keptSegments?: KeptSegment[]; clipStartUs?: number; clipEndUs?: number }) {
  const t = useText(texts);
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const bottomVideo = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef(new Map<number, HTMLAudioElement>());
  const duckGainRef = useRef(1);
  const tailRef = useRef({ active: false, tailUs: 0, lastTs: 0 });
  const pending = useRef<number | null>(null);
  const loadedWindow = useRef<{ sourceId: number; windowStartUs: number; windowEndUs: number } | null>(null);
  const [proxy, setProxy] = useState<Proxy | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [playing, setPlaying] = useState(false);
  const [tailActive, setTailActive] = useState(false);
  const [duckState, setDuckState] = useState<{ active: boolean; blockId: number | null; gain: number }>({ active: false, blockId: null, gain: 1 });
  const [time, setTime] = useState(0);
  const [lastSeekUs, setLastSeekUs] = useState<number | null>(null);
  const [missingH264] = useState(isLinuxMissingH264);

  const effectiveClipStartUs = clipStartUs ?? startUs;
  const effectiveClipEndUs = clipEndUs ?? endUs;
  const narrationSegments = useMemo<PreviewNarrationSegment[]>(() => {
    if (!montage?.blocks?.length) return [];
    return montage.blocks
      .filter((b): b is typeof b & { audioId: number } => typeof b.audioId === 'number' && b.durationUs > 0)
      .map(b => ({
        blockId: b.blockId,
        audioId: b.audioId,
        startUs: b.startUs,
        endUs: b.endUs,
        durationUs: b.durationUs,
      }));
  }, [montage]);
  const hasNarration = narrationSegments.length > 0;
  const clipDurationUs = useMemo(() => {
    if (montage) return montage.clipDurationUs;
    if (keptSegments && keptSegments.length > 0) return keptSegments[keptSegments.length - 1].outputEndUs;
    return Math.max(0, effectiveClipEndUs - effectiveClipStartUs);
  }, [montage, keptSegments, effectiveClipEndUs, effectiveClipStartUs]);
  const freezeTailUs = useMemo(() => {
    if (!hasNarration) return 0;
    const maxEnd = narrationSegments.reduce((acc, s) => Math.max(acc, s.endUs), 0);
    return Math.max(0, maxEnd - clipDurationUs);
  }, [hasNarration, narrationSegments, clipDurationUs]);

  const request = useCallback(async (active: () => boolean) => {
    setError(null); setNotice('');
    try {
      const next = await coreDispatch<Proxy>('proxy.request', { source_id: sourceId, start_us: startUs, end_us: endUs });
      if (active()) {
        loadedWindow.current = next.state === 'failed' || next.state === 'cancelled'
          ? null
          : { sourceId, windowStartUs: next.windowStartUs, windowEndUs: next.windowEndUs };
        setProxy(next);
      }
    } catch (e) {
      if (active()) { loadedWindow.current = null; setProxy(null); setError({ code: code(e), message: typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : '' }); }
    }
  }, [sourceId, startUs, endUs]);
  useEffect(() => {
    const win = loadedWindow.current;
    if (win && win.sourceId === sourceId && startUs >= win.windowStartUs && endUs <= win.windowEndUs) return;
    loadedWindow.current = null;
    let alive = true;
    tailRef.current = { active: false, tailUs: 0, lastTs: 0 };
    duckGainRef.current = 1;
    setProxy(null); setPlaying(false); setTailActive(false); setDuckState({ active: false, blockId: null, gain: 1 }); setTime(0); setLastSeekUs(null); pending.current = null;
    void request(() => alive);
    return () => { alive = false; };
  }, [sourceId, startUs, endUs, request]);

  useEffect(() => {
    onProxyChange?.(proxy ? { state: proxy.state, key: proxy.key, windowStartUs: proxy.windowStartUs, windowEndUs: proxy.windowEndUs } : null);
  }, [proxy?.state, proxy?.key, proxy?.windowStartUs, proxy?.windowEndUs, onProxyChange]);

  // Acompanha o job enquanto gera: evento do núcleo e uma checagem periódica de reserva.
  const working = proxy?.state === 'queued' || proxy?.state === 'running';
  useEffect(() => {
    if (!working || !proxy) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    const sync = () => {
      coreDispatch<Status>('proxy.status', { key: proxy.key }).then(next => {
        if (!alive) return;
        if (next.state === 'missing') {
          loadedWindow.current = null;
          void request(() => alive);
        } else {
          if (next.state === 'failed' || next.state === 'cancelled') loadedWindow.current = null;
          setProxy(current => (current && current.key === next.key ? { ...current, ...next } : current));
        }
      }).catch(() => { if (alive) setError({ code: '', message: '' }); });
    };
    if (isTauri()) listen('core-progress', sync).then(fn => { if (alive) unlisten = fn; else fn(); }).catch(() => {});
    const timer = window.setInterval(sync, 700);
    return () => { alive = false; unlisten?.(); window.clearInterval(timer); };
  }, [working, proxy?.key, request]);

  const skipRef = useRef(skipIntervals);
  skipRef.current = skipIntervals;

  const syncNarrationAndDuck = useCallback((dtMs: number, snap: boolean) => {
    const el = video.current;
    if (!el || !proxy || proxy.state !== 'ready') return;
    if (!hasNarration) {
      if (el.volume !== 1) el.volume = 1;
      duckGainRef.current = 1;
      for (const a of audioRefs.current.values()) {
        if (!a.paused) a.pause();
      }
      setDuckState(prev => (prev.active || prev.gain !== 1 || prev.blockId !== null ? { active: false, blockId: null, gain: 1 } : prev));
      return;
    }
    const outputUs = tailRef.current.active
      ? clipDurationUs + tailRef.current.tailUs
      : sourceToSplicedUs(proxy.windowStartUs + el.currentTime * 1_000_000, keptSegments, effectiveClipStartUs);
    const activeSeg = activeNarrationAt(narrationSegments, outputUs);
    const active = activeSeg !== null;
    const nextGain = snap ? targetDuckGain(active) : stepDuckGain(duckGainRef.current, active, dtMs);
    duckGainRef.current = nextGain;
    el.volume = nextGain;
    const activeBlockId = activeSeg?.blockId ?? null;
    setDuckState(prev => (
      prev.active === active && prev.blockId === activeBlockId && Math.abs(prev.gain - nextGain) < 0.001
        ? prev
        : { active, blockId: activeBlockId, gain: nextGain }
    ));

    const forwardPlaying = (!el.paused || tailRef.current.active) && !el.ended && (rate === undefined || rate >= 0);
    const playbackRate = rate && rate > 0 ? rate : (el.playbackRate || 1);
    for (const seg of narrationSegments) {
      const audioEl = audioRefs.current.get(seg.blockId);
      if (!audioEl) continue;
      if (forwardPlaying && activeSeg?.blockId === seg.blockId) {
        const desiredSec = Math.max(0, (outputUs - seg.startUs) / 1_000_000);
        if (audioEl.readyState >= 1 && Math.abs(audioEl.currentTime - desiredSec) > 0.08) {
          audioEl.currentTime = desiredSec;
        }
        if (audioEl.playbackRate !== playbackRate) audioEl.playbackRate = playbackRate;
        if (audioEl.paused) void audioEl.play().catch(() => {});
      } else if (!audioEl.paused) {
        audioEl.pause();
      }
    }
  }, [proxy, hasNarration, clipDurationUs, keptSegments, effectiveClipStartUs, narrationSegments, rate]);
  const syncNarrationRef = useRef(syncNarrationAndDuck);
  syncNarrationRef.current = syncNarrationAndDuck;

  // Velocidade pedida pelo editor. Para trás o `<video>` não toca: volta em passos de 100 ms.
  useEffect(() => {
    const el = video.current;
    if (rate === undefined || !el || proxy?.state !== 'ready') return;
    if (rate > 0) {
      tailRef.current = { active: false, tailUs: 0, lastTs: 0 };
      setTailActive(false);
      el.playbackRate = rate;
      el.play().catch(() => {});
      return;
    }
    tailRef.current = { active: false, tailUs: 0, lastTs: 0 };
    setTailActive(false);
    el.pause();
    syncNarrationAndDuck(0, true);
    if (rate === 0) return;
    const timer = window.setInterval(() => {
      let nextTime = Math.max(0, el.currentTime + rate * 0.1);
      const nextSource = proxy.windowStartUs + nextTime * 1_000_000;
      const cut = skipRef.current?.find(c => nextSource > c.startUs + 5_000 && nextSource <= c.endUs);
      if (cut) {
        const mapped = toProxySeconds(cut.startUs, proxy.windowStartUs, proxy.windowEndUs);
        if (mapped !== null) nextTime = mapped;
      }
      el.currentTime = nextTime;
      syncNarrationAndDuck(0, true);
      if (el.currentTime <= 0) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [rate, proxy?.state, proxy?.windowStartUs, proxy?.windowEndUs, syncNarrationAndDuck]);

  // Sincroniza áudio da Narração, envoltória de ducking (-12 dB) e congelamento de cauda (`tpad`).
  useEffect(() => {
    if (!hasNarration || !proxy || proxy.state !== 'ready') return;
    syncNarrationAndDuck(0, true);
    if (!playing && !tailActive) return;
    let alive = true, raf = 0;
    let lastTs = performance.now();
    const tick = (now: number) => {
      if (!alive) return;
      const dtMs = Math.min(100, Math.max(0, now - lastTs));
      lastTs = now;
      const el = video.current;
      if (el) {
        const playbackRate = rate && rate > 0 ? rate : (el.playbackRate || 1);
        if (tailRef.current.active) {
          tailRef.current.tailUs += dtMs * 1000 * playbackRate;
          if (tailRef.current.tailUs >= freezeTailUs) {
            tailRef.current = { active: false, tailUs: 0, lastTs: 0 };
            setTailActive(false);
            setPlaying(false);
          }
        } else if (freezeTailUs > 0 && !el.paused) {
          const curSourceUs = proxy.windowStartUs + el.currentTime * 1_000_000;
          if (curSourceUs >= effectiveClipEndUs - 20_000) {
            const clampedSec = toProxySeconds(effectiveClipEndUs, proxy.windowStartUs, proxy.windowEndUs);
            if (clampedSec !== null) {
              el.currentTime = clampedSec;
              setTime(clampedSec);
            }
            el.pause();
            onSourceTime?.(effectiveClipEndUs);
            tailRef.current = { active: true, tailUs: 0, lastTs: now };
            setTailActive(true);
            setPlaying(true);
          }
        }
      }
      syncNarrationAndDuck(dtMs, false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [hasNarration, proxy, playing, tailActive, freezeTailUs, effectiveClipEndUs, rate, onSourceTime, syncNarrationAndDuck]);

  // Pula silêncios ativos com latência de quadro enquanto o preview está reproduzindo.
  useEffect(() => {
    if (!playing || !proxy || proxy.state !== 'ready' || !skipIntervals?.length) return;
    let alive = true, frame = 0;
    const tick = () => {
      if (!alive) return;
      const el = video.current;
      if (el && !el.paused) {
        const cur = proxy.windowStartUs + el.currentTime * 1_000_000;
        const jumpTo = skipCutForward(cur, skipRef.current);
        if (jumpTo !== null) {
          const mapped = toProxySeconds(jumpTo, proxy.windowStartUs, proxy.windowEndUs);
          if (mapped !== null) {
            el.currentTime = mapped;
            setTime(mapped);
            onSourceTime?.(jumpTo);
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(frame); };
  }, [playing, proxy, skipIntervals, onSourceTime]);

  const windowSeconds = proxy ? (proxy.windowEndUs - proxy.windowStartUs) / 1_000_000 : 0;
  function seekProxy(seconds: number) {
    const el = video.current;
    tailRef.current = { active: false, tailUs: 0, lastTs: 0 };
    setTailActive(false);
    if (!el || el.readyState < 1) { pending.current = seconds; return; }
    el.currentTime = seconds;
    setTime(seconds);
    syncNarrationRef.current(0, true);
  }
  // Clique numa palavra da Transcrição: mapeia o tempo da Fonte para o do proxy.
  useEffect(() => {
    const onSeek = (event: Event) => {
      const e = (event as CustomEvent<PreviewSeekEvent>).detail;
      if (e.source_id !== sourceId || !proxy) return;
      const mapped = toProxySeconds(e.us, proxy.windowStartUs, proxy.windowEndUs);
      if (mapped === null) { setNotice(t.outside); return; }
      setNotice(''); setLastSeekUs(e.us);
      if (proxy.state === 'ready') seekProxy(mapped); else pending.current = mapped;
    };
    window.addEventListener(previewSeekEvent, onSeek);
    return () => window.removeEventListener(previewSeekEvent, onSeek);
  }, [sourceId, proxy, t.outside]);

  function onLoaded() {
    const el = video.current;
    if (!el || !proxy) return;
    const start = pending.current ?? toProxySeconds(startUs, proxy.windowStartUs, proxy.windowEndUs) ?? 0;
    pending.current = null;
    el.currentTime = start; setTime(start);
    syncNarrationAndDuck(0, true);
  }
  const isDual = !!(cropPlan && cropPlan.panels.length === 2);
  const effectiveSingleSegments = cropPlan && cropPlan.panels.length === 1 ? cropPlan.panels[0].segments : crop;
  const isFitDefault = !!(
    cropPlan &&
    cropPlan.layout === 'fit' &&
    cropPlan.panels.length === 1 &&
    cropPlan.panels[0].segments.length === 1 &&
    cropPlan.panels[0].segments[0].keyframes.length === 1 &&
    cropPlan.panels[0].segments[0].keyframes[0].x === 0 &&
    cropPlan.panels[0].segments[0].keyframes[0].y === 0 &&
    cropPlan.panels[0].segments[0].keyframes[0].width === 1 &&
    cropPlan.panels[0].segments[0].keyframes[0].height === 1
  );
  const hasCrop = isDual || (!isFitDefault && !!(effectiveSingleSegments && effectiveSingleSegments.length > 0));
  const splitRatio = cropPlan?.splitRatio ?? 0.5;

  useEffect(() => {
    const el = video.current;
    const botEl = bottomVideo.current;
    const box = frame.current;
    const resetEl = (v: HTMLVideoElement | null) => {
      if (!v) return;
      v.style.position = ''; v.style.left = ''; v.style.top = '';
      v.style.width = ''; v.style.height = ''; v.style.maxWidth = ''; v.style.maxHeight = '';
      v.style.objectFit = ''; v.style.transformOrigin = ''; v.style.transform = '';
      delete v.dataset.cropRect;
    };
    if (!el || !box || proxy?.state !== 'ready' || !hasCrop) {
      resetEl(el);
      resetEl(botEl);
      return;
    }
    const applyRect = (v: HTMLVideoElement, rect: { x: number; y: number; width: number; height: number }, panelW: number, panelH: number) => {
      if (!v.videoWidth || !v.videoHeight || panelW <= 0 || panelH <= 0) return;
      const { offsetX, offsetY, scaleX, scaleY } = cropVideoTransform(rect, panelW, panelH, v.videoWidth, v.videoHeight);
      v.style.position = 'absolute'; v.style.left = '0px'; v.style.top = '0px';
      v.style.width = `${panelW}px`; v.style.height = `${panelH}px`;
      v.style.maxWidth = 'none'; v.style.maxHeight = 'none';
      v.style.objectFit = 'fill'; v.style.transformOrigin = 'top left';
      v.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scaleX}, ${scaleY})`;
      v.dataset.cropRect = `${rect.x.toFixed(6)},${rect.y.toFixed(6)},${rect.width.toFixed(6)},${rect.height.toFixed(6)}`;
    };
    let alive = true, raf = 0, lastKey = '';
    const renderCrop = (force = false) => {
      if (!alive || !box.clientWidth || !box.clientHeight || !el.videoWidth || !el.videoHeight) return;
      if (isDual && botEl && cropPlan) {
        if (Math.abs(botEl.currentTime - el.currentTime) > 0.04 && botEl.readyState >= 1) {
          botEl.currentTime = el.currentTime;
        }
        if (el.paused && !botEl.paused) botEl.pause();
        else if (!el.paused && botEl.paused && botEl.readyState >= 1) {
          botEl.playbackRate = el.playbackRate;
          void botEl.play().catch(() => {});
        }
      }
      const sourceAt = proxy.windowStartUs + el.currentTime * 1_000_000;
      const key = `${Math.round(sourceAt)}:${box.clientWidth}x${box.clientHeight}:${el.videoWidth}x${el.videoHeight}:${splitRatio.toFixed(4)}:${isDual}`;
      if (!force && key === lastKey) return;
      lastKey = key;
      if (isDual && cropPlan && cropPlan.panels.length === 2) {
        const topH = box.clientHeight * cropPlan.splitRatio;
        const botH = box.clientHeight * (1 - cropPlan.splitRatio);
        const topRect = interpolateCrop(cropPlan.panels[0].segments, sourceAt);
        const botRect = interpolateCrop(cropPlan.panels[1].segments, sourceAt);
        if (topRect) applyRect(el, topRect, box.clientWidth, topH);
        if (botRect && botEl) applyRect(botEl, botRect, box.clientWidth, botH);
      } else if (effectiveSingleSegments) {
        const rect = interpolateCrop(effectiveSingleSegments, sourceAt);
        if (rect) applyRect(el, rect, box.clientWidth, box.clientHeight);
      }
    };
    const tick = () => {
      if (!alive) return;
      renderCrop();
      raf = requestAnimationFrame(tick);
    };
    const onEvent = () => renderCrop(true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => renderCrop(true));
    observer?.observe(box);
    el.addEventListener('loadedmetadata', onEvent);
    el.addEventListener('seeked', onEvent);
    botEl?.addEventListener('loadedmetadata', onEvent);
    tick();
    return () => {
      alive = false; cancelAnimationFrame(raf); observer?.disconnect();
      el.removeEventListener('loadedmetadata', onEvent);
      el.removeEventListener('seeked', onEvent);
      botEl?.removeEventListener('loadedmetadata', onEvent);
    };
  }, [cropPlan, effectiveSingleSegments, hasCrop, isDual, splitRatio, proxy?.state, proxy?.windowStartUs]);
  function toggle() {
    const el = video.current;
    if (!el) return;
    if (tailRef.current.active) {
      tailRef.current = { active: false, tailUs: 0, lastTs: 0 };
      setTailActive(false);
      setPlaying(false);
      syncNarrationAndDuck(0, true);
      return;
    }
    if (el.paused) el.play().catch(() => { if (isTauri()) setNotice(t.playError); }); else el.pause();
  }
  async function cancel() { if (proxy?.job != null) { try { await coreDispatch('jobs.cancel', { id: proxy.job }); } catch { setError({ code: '', message: '' }); } } }

  const sourceUs = proxy ? proxy.windowStartUs + time * 1_000_000 : startUs;
  const videoEl = (
    <video ref={video} src={proxy ? mediaUrl(proxy.key) : undefined} aria-label={t.video} className={hasCrop ? undefined : 'h-full w-full object-contain'} playsInline preload="auto"
      onLoadedMetadata={onLoaded} onTimeUpdate={e => {
        const curSec = e.currentTarget.currentTime;
        if (proxy && !e.currentTarget.paused) {
          const jumpTo = skipCutForward(proxy.windowStartUs + curSec * 1_000_000, skipRef.current);
          if (jumpTo !== null) {
            const mapped = toProxySeconds(jumpTo, proxy.windowStartUs, proxy.windowEndUs);
            if (mapped !== null) { e.currentTarget.currentTime = mapped; setTime(mapped); onSourceTime?.(jumpTo); syncNarrationAndDuck(0, true); return; }
          }
        }
        setTime(curSec);
        if (proxy) onSourceTime?.(proxy.windowStartUs + curSec * 1_000_000);
        if (e.currentTarget.paused && !tailRef.current.active) syncNarrationAndDuck(0, true);
      }} onPlay={() => setPlaying(true)} onPause={() => { if (!tailRef.current.active) { setPlaying(false); syncNarrationAndDuck(0, true); } }} onEnded={() => { setPlaying(false); syncNarrationAndDuck(0, true); }}
      onError={() => { if (isTauri() && !missingH264) setNotice(t.playError); }} />
  );
  return <section aria-label={t.title} data-preview-state={proxy?.state ?? (error ? 'error' : 'loading')} data-seek-us={lastSeekUs ?? undefined} data-crop-active={hasCrop ? 'true' : undefined} data-crop-layout={cropPlan?.layout} data-split-ratio={isDual ? splitRatio.toFixed(4) : undefined} data-ducking={hasNarration ? (duckState.active ? 'true' : 'false') : undefined} data-duck-gain={hasNarration ? duckState.gain.toFixed(3) : undefined} data-narration-active-block={duckState.blockId ?? undefined} data-freeze-tail-active={tailActive ? 'true' : undefined} className="flex w-full max-w-[18rem] flex-col gap-2 text-sm">
    {!proxy && !error && <p aria-live="polite" className="text-fg-2">{t.preparing}</p>}
    {error && <p role="alert" className="rounded-md border border-line bg-warning-subtle p-3 text-fg">{t.code[error.code] ?? t.error}</p>}
    {working && proxy && <div className="flex flex-col gap-2" aria-live="polite">
      <span>{proxy.state === 'queued' ? t.queued : `${t.running}: ${proxy.progress}%`}</span>
      <progress className="w-full" max={100} value={proxy.progress} aria-label={t.running} />
      <div><Button tamanho="sm" onClick={() => void cancel()}>{t.cancel}</Button></div>
    </div>}
    {(proxy?.state === 'failed' || proxy?.state === 'cancelled') && <div className="flex flex-col gap-2">
      <p role={proxy.state === 'failed' ? 'alert' : undefined}>{proxy.state === 'failed' ? (proxy.error && t.code[proxy.error]) || t.failed : t.cancelled}</p>
      <div><Button tamanho="sm" onClick={() => void request(() => true)}>{t.retry}</Button></div>
    </div>}
    {proxy?.state === 'ready' && <>
      <div ref={frame} className="relative aspect-[9/16] w-full overflow-hidden rounded-md border border-line bg-black">
        {isDual ? (
          <>
            <div data-preview-panel="top" className="absolute inset-x-0 top-0 overflow-hidden" style={{ height: `${splitRatio * 100}%` }}>
              {videoEl}
            </div>
            <div data-preview-panel="bottom" className="absolute inset-x-0 overflow-hidden" style={{ top: `${splitRatio * 100}%`, height: `${(1 - splitRatio) * 100}%` }}>
              <video ref={bottomVideo} src={mediaUrl(proxy.key)} aria-hidden muted playsInline preload="auto" data-crop-panel="bottom" />
            </div>
          </>
        ) : videoEl}
        {captions && <CaptionOverlay data={captions} video={video} windowStartUs={proxy.windowStartUs} />}
      </div>
      <div className="flex items-center gap-2">
        <Button tamanho="sm" onClick={toggle}>{playing || tailActive ? t.pause : t.play}</Button>
        <span className="font-mono text-xs text-fg-2" data-preview-clock>{clock(sourceUs)}</span>
      </div>
      {narrationSegments.map(seg => (
        <audio
          key={`${seg.blockId}:${seg.audioId}`}
          ref={node => {
            if (node) audioRefs.current.set(seg.blockId, node);
            else audioRefs.current.delete(seg.blockId);
          }}
          src={narrationMediaUrl(seg.audioId)}
          preload="auto"
          data-preview-narration-audio={seg.blockId}
          aria-hidden
        />
      ))}
      <input type="range" aria-label={t.seek} min={0} max={windowSeconds} step={0.01} value={Math.min(time, windowSeconds)} onChange={e => seekProxy(Number(e.target.value))} className="w-full" />
      {missingH264 && <p role="alert" data-missing-h264-codec className="rounded-md border border-line bg-warning-subtle p-3 text-fg">{t.missingCodec}</p>}
    </>}
    {notice && <p role="status" className="text-fg-2">{notice}</p>}
  </section>;
}

/** Painel da Fonte: abre o preview do Corte pedido por `openCutPreview` e o fecha. */
export function CutPreviewPanel({ sourceId }: { sourceId: number }) {
  const t = useText(texts);
  const [cut, setCut] = useState<CutRange | null>(null);
  useEffect(() => {
    const onOpen = (event: Event) => {
      const next = (event as CustomEvent<CutRange>).detail;
      if (next.sourceId === sourceId) setCut(next);
    };
    window.addEventListener(previewOpenEvent, onOpen);
    return () => window.removeEventListener(previewOpenEvent, onOpen);
  }, [sourceId]);
  if (!cut) return null;
  return <div className="mt-3 flex flex-col gap-2">
    <CutPreview key={`${cut.sourceId}:${cut.startUs}:${cut.endUs}`} sourceId={cut.sourceId} startUs={cut.startUs} endUs={cut.endUs} />
    <div><Button tamanho="sm" onClick={() => setCut(null)}>{t.close}</Button></div>
  </div>;
}
