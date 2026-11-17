/**
 * Tipos, resolução e interpolação de crop (#66/#71/#78) espelhando exatamente `core/src/editor/crop.rs`.
 * Coordenadas normalizadas (0–1) e tempos em µs relativos à Fonte.
 */

export type CropLayout = 'fit' | 'face' | 'gameplay_webcam' | 'two_people' | 'fullscreen_roi';
export type PanelFitMode = 'fit' | 'fill';
export type CropRect = { x: number; y: number; width: number; height: number };
export type CropKeyframe = CropRect & { timeUs: number; confidence?: number | null; cut?: boolean };
export type CropSegment = { startUs: number; endUs: number; reason: string; keyframes: CropKeyframe[] };
export type SuggestedCrop = { schemaVersion: number; revision: number; status: string; segments: CropSegment[]; metrics?: unknown };
export type CropPanelDoc = { suggested: SuggestedCrop | null; edits: CropKeyframe[] };
export type DualCropPanels = { top: CropPanelDoc; bottom: CropPanelDoc };
export type PanelPlan = { targetWidth: number; targetHeight: number; fitMode: PanelFitMode; segments: CropSegment[] };
export type ResolvedCropPlan = { layout: CropLayout; splitRatio: number; panels: PanelPlan[] };
export type ClipCrop = {
  layout?: CropLayout;
  explicitLayout?: CropLayout | null;
  splitRatio?: number;
  suggested: SuggestedCrop | null;
  edits: CropKeyframe[];
  gameplayWebcam?: DualCropPanels | null;
  twoPeople?: DualCropPanels | null;
  resolved: CropSegment[];
  hasCrop: boolean;
  plan?: ResolvedCropPlan;
};

const TARGET_ASPECT = 9 / 16;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function sanitizeAspect(aspect: number): number {
  return Number.isFinite(aspect) && aspect >= 0.1 && aspect <= 10 ? aspect : 16 / 9;
}

export function splitBounds(layout: CropLayout): [number, number, number] | null {
  if (layout === 'gameplay_webcam') return [0.30, 0.20, 0.50];
  if (layout === 'two_people') return [0.50, 0.30, 0.70];
  return null;
}

export function panelHeights(layout: CropLayout, splitRatio?: number | null): [number, number] {
  const bounds = splitBounds(layout);
  if (!bounds) return [1920, 0];
  const [def, min, max] = bounds;
  const ratio = clamp(splitRatio ?? def, min, max);
  const minPx = Math.round(1920 * min);
  const maxPx = Math.round(1920 * max);
  const topH = clamp(Math.round((1920 * ratio) / 2) * 2, minPx, maxPx);
  return [topH, 1920 - topH];
}

export function effectiveSplitRatio(layout: CropLayout, splitRatio?: number | null): number {
  return panelHeights(layout, splitRatio)[0] / 1920;
}

export function panelCropBaseSize(sourceAspect: number, panelAspect: number): { width: number; height: number } {
  const aspect = sanitizeAspect(sourceAspect);
  const target = Number.isFinite(panelAspect) && panelAspect > 0.05 ? panelAspect : TARGET_ASPECT;
  const ratio = target / aspect;
  return {
    width: clamp(ratio, 0.05, 1),
    height: clamp(1 / ratio, 0.05, 1),
  };
}

export function baseCropSize(sourceAspect: number): { width: number; height: number } {
  return panelCropBaseSize(sourceAspect, TARGET_ASPECT);
}

export function defaultPanelRect(
  sourceAspect: number,
  panelAspect: number,
  zoom = 1,
  cx = 0.5,
  cy = 0.5,
  maxZoom = 8,
): CropRect {
  const base = panelCropBaseSize(sourceAspect, panelAspect);
  const z = clamp(zoom, 1, maxZoom);
  const width = clamp(base.width / z, 0.05, 1);
  const height = clamp(base.height / z, 0.05, 1);
  return {
    x: clamp(cx - width / 2, 0, Math.max(0, 1 - width)),
    y: clamp(cy - height / 2, 0, Math.max(0, 1 - height)),
    width,
    height,
  };
}

export function defaultCropRect(sourceAspect: number, zoom = 1): CropRect {
  return defaultPanelRect(sourceAspect, TARGET_ASPECT, zoom, 0.5, 0.5, 2.5);
}

export function clampCropRect(rect: CropRect): CropRect {
  const width = clamp(rect.width, 0.05, 1);
  const height = clamp(rect.height, 0.05, 1);
  const x = clamp(rect.x, 0, Math.max(0, 1 - width));
  const y = clamp(rect.y, 0, Math.max(0, 1 - height));
  return { x, y, width, height };
}

export function panelZoomFactor(
  rect: CropRect,
  sourceAspect: number,
  panelAspect: number,
  maxZoom = 8,
): number {
  const base = panelCropBaseSize(sourceAspect, panelAspect);
  if (rect.width <= 0) return 1;
  return clamp(base.width / rect.width, 1, maxZoom);
}

export function cropZoomFactor(rect: CropRect, sourceAspect: number): number {
  return panelZoomFactor(rect, sourceAspect, TARGET_ASPECT, 2.5);
}

export function zoomPanelRect(
  rect: CropRect,
  sourceAspect: number,
  panelAspect: number,
  zoom: number,
  maxZoom = 8,
): CropRect {
  const base = panelCropBaseSize(sourceAspect, panelAspect);
  const z = clamp(zoom, 1, maxZoom);
  const width = clamp(base.width / z, 0.05, 1);
  const height = clamp(base.height / z, 0.05, 1);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return clampCropRect({
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
  });
}

export function zoomCropRect(rect: CropRect, sourceAspect: number, zoom: number): CropRect {
  return zoomPanelRect(rect, sourceAspect, TARGET_ASPECT, zoom, 2.5);
}

export function zoomFitRect(rect: CropRect, zoom: number): CropRect {
  const z = clamp(zoom, 1, 2.5);
  const width = clamp(1 / z, 0.05, 1);
  const height = clamp(1 / z, 0.05, 1);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return clampCropRect({
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
  });
}

export function fitZoomFactor(rect: CropRect): number {
  if (rect.width <= 0) return 1;
  return clamp(1 / rect.width, 1, 2.5);
}

function splitManualCuts(startUs: number, endUs: number, firstReason: string, keyframes: CropKeyframe[]): CropSegment[] {
  const out: CropSegment[] = [];
  for (let i = 0; i < keyframes.length; i++) {
    const k = keyframes[i];
    if (i === 0) {
      out.push({ startUs: Math.min(startUs, k.timeUs), endUs, reason: firstReason, keyframes: [{ ...k }] });
    } else if (k.cut) {
      out[out.length - 1].endUs = k.timeUs;
      out.push({ startUs: k.timeUs, endUs, reason: 'manual', keyframes: [{ ...k }] });
    } else {
      out[out.length - 1].keyframes.push({ ...k });
    }
  }
  if (out.length > 0) {
    const last = out[out.length - 1];
    last.endUs = Math.max(endUs, last.keyframes[last.keyframes.length - 1].timeUs + 1);
  }
  return out;
}

/**
 * Combina `suggested` (#60) e `edits` (#66/#71), espelhando `crop::resolve`.
 * Um segmento com ao menos um keyframe em `edits` usa só os `edits` daquele segmento.
 */
export function resolveCrop(suggested: SuggestedCrop | null | undefined, edits: CropKeyframe[]): CropSegment[] {
  if (!suggested || suggested.segments.length === 0) {
    if (edits.length === 0) return [];
    const firstT = edits[0].timeUs;
    const lastT = edits[edits.length - 1].timeUs + 1;
    return splitManualCuts(firstT, lastT, 'start', edits);
  }
  const count = suggested.segments.length;
  const resolved: CropSegment[] = [];
  for (let i = 0; i < count; i++) {
    const seg = suggested.segments[i];
    const low = i === 0 ? -Infinity : seg.startUs;
    const high = i + 1 === count ? Infinity : seg.endUs;
    const edited = edits.filter(k => k.timeUs >= low && k.timeUs < high);
    if (edited.length === 0) {
      resolved.push(seg);
    } else {
      resolved.push(...splitManualCuts(seg.startUs, seg.endUs, seg.reason, edited));
    }
  }
  return resolved;
}

function staticSegment(startUs: number, endUs: number, rect: CropRect): CropSegment {
  return {
    startUs,
    endUs: Math.max(endUs, startUs + 1),
    reason: 'start',
    keyframes: [{ timeUs: startUs, ...rect }],
  };
}

export function effectiveCropLayout(crop: Partial<ClipCrop>): CropLayout {
  if (crop.explicitLayout) return crop.explicitLayout;
  if (crop.layout) return crop.layout;
  if (crop.suggested || (crop.edits && crop.edits.length > 0)) return 'face';
  return 'fit';
}

export function resolveCropPlan(
  crop: Partial<ClipCrop>,
  sourceAspect: number,
  clipStartUs: number,
  clipEndUs: number,
): ResolvedCropPlan {
  const layout = effectiveCropLayout(crop);
  const aspect = sanitizeAspect(sourceAspect);
  if (layout === 'fit') {
    const edits = crop.edits ?? [];
    const segments = edits.length > 0 ? resolveCrop(null, edits) : [staticSegment(clipStartUs, clipEndUs, { x: 0, y: 0, width: 1, height: 1 })];
    return { layout, splitRatio: 1, panels: [{ targetWidth: 1080, targetHeight: 1920, fitMode: 'fit', segments }] };
  }
  if (layout === 'face') {
    let segments = resolveCrop(crop.suggested, crop.edits ?? []);
    if (segments.length === 0) {
      segments = [staticSegment(clipStartUs, clipEndUs, defaultPanelRect(aspect, TARGET_ASPECT, 1, 0.5, 0.5))];
    }
    return { layout, splitRatio: 1, panels: [{ targetWidth: 1080, targetHeight: 1920, fitMode: 'fill', segments }] };
  }
  if (layout === 'fullscreen_roi') {
    const edits = crop.edits ?? [];
    const segments = edits.length > 0 ? resolveCrop(null, edits) : [staticSegment(clipStartUs, clipEndUs, defaultPanelRect(aspect, TARGET_ASPECT, 1, 0.5, 0.5))];
    return { layout, splitRatio: 1, panels: [{ targetWidth: 1080, targetHeight: 1920, fitMode: 'fill', segments }] };
  }
  const [topH, botH] = panelHeights(layout, crop.splitRatio);
  const dual = layout === 'gameplay_webcam' ? crop.gameplayWebcam : crop.twoPeople;
  let topSegs = dual ? resolveCrop(dual.top.suggested, dual.top.edits) : [];
  if (topSegs.length === 0) {
    const rect = layout === 'gameplay_webcam'
      ? defaultPanelRect(aspect, 1080 / topH, 3.0, 0.18, 0.22)
      : defaultPanelRect(aspect, 1080 / topH, 1.0, 0.25, 0.5);
    topSegs = [staticSegment(clipStartUs, clipEndUs, rect)];
  }
  let botSegs = dual ? resolveCrop(dual.bottom.suggested, dual.bottom.edits) : [];
  if (botSegs.length === 0) {
    const rect = layout === 'gameplay_webcam'
      ? defaultPanelRect(aspect, 1080 / botH, 1.0, 0.5, 0.5)
      : defaultPanelRect(aspect, 1080 / botH, 1.0, 0.75, 0.5);
    botSegs = [staticSegment(clipStartUs, clipEndUs, rect)];
  }
  return {
    layout,
    splitRatio: topH / 1920,
    panels: [
      { targetWidth: 1080, targetHeight: topH, fitMode: 'fill', segments: topSegs },
      { targetWidth: 1080, targetHeight: botH, fitMode: 'fill', segments: botSegs },
    ],
  };
}

export function upsertCropKeyframe(
  edits: CropKeyframe[],
  next: Omit<CropKeyframe, 'timeUs'> & { timeUs: number },
  matchToleranceUs: number,
): CropKeyframe[] {
  const timeUs = Math.max(0, Math.round(next.timeUs));
  const rect = clampCropRect(next);
  const existing = edits.find(k => Math.abs(k.timeUs - timeUs) <= matchToleranceUs);
  const targetTime = existing ? existing.timeUs : timeUs;
  const entry: CropKeyframe = {
    timeUs: targetTime,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    ...(next.cut ?? existing?.cut ? { cut: true } : {}),
  };
  return [...edits.filter(k => k.timeUs !== targetTime), entry].sort((a, b) => a.timeUs - b.timeUs);
}

export function removeCropKeyframe(edits: CropKeyframe[], timeUs: number): CropKeyframe[] {
  return edits.filter(k => k.timeUs !== timeUs);
}

export function toggleCropKeyframeCut(edits: CropKeyframe[], timeUs: number): CropKeyframe[] {
  return edits.map(k => (k.timeUs === timeUs ? { ...k, cut: !k.cut } : k));
}

function segmentAt(segments: CropSegment[], timeUs: number): CropSegment | null {
  if (segments.length === 0) return null;
  if (timeUs < segments[0].startUs) return segments[0];
  let lo = 0;
  let hi = segments.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].startUs <= timeUs) lo = mid + 1;
    else hi = mid;
  }
  return segments[Math.max(0, lo - 1)];
}

/**
 * Mesma função de interpolação linear do núcleo (`crop::interpolate`), com corte
 * seco nos limites de segmento (`scene` / `face_switch` / `manual`).
 */
export function interpolateCrop(segments: CropSegment[], timeUs: number): CropRect | null {
  const seg = segmentAt(segments, timeUs);
  if (!seg || seg.keyframes.length === 0) return null;
  const first = seg.keyframes[0];
  if (timeUs <= first.timeUs || seg.keyframes.length === 1) {
    return { x: first.x, y: first.y, width: first.width, height: first.height };
  }
  const last = seg.keyframes[seg.keyframes.length - 1];
  if (timeUs >= last.timeUs) {
    return { x: last.x, y: last.y, width: last.width, height: last.height };
  }
  let lo = 0;
  let hi = seg.keyframes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (seg.keyframes[mid].timeUs <= timeUs) lo = mid + 1;
    else hi = mid;
  }
  const a = seg.keyframes[lo - 1];
  const b = seg.keyframes[lo];
  const alpha = (timeUs - a.timeUs) / (b.timeUs - a.timeUs);
  return {
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    width: a.width + (b.width - a.width) * alpha,
    height: a.height + (b.height - a.height) * alpha,
  };
}

/**
 * Calcula o transform CSS para enquadrar `[rect.x, rect.x+rect.width] × [rect.y, rect.y+rect.height]`
 * em Fit centralizado dentro de um contêiner (ex.: 9:16), mantendo paridade geométrica com o export.
 */
export function cropVideoTransform(
  rect: CropRect,
  containerWidth: number,
  containerHeight: number,
  videoWidth: number,
  videoHeight: number,
): { offsetX: number; offsetY: number; scaleX: number; scaleY: number } {
  if (containerWidth <= 0 || containerHeight <= 0 || videoWidth <= 0 || videoHeight <= 0) {
    return { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
  }
  const containerAspect = containerWidth / containerHeight;
  const videoAspect = videoWidth / videoHeight;
  const cropAspect = (rect.width / rect.height) * videoAspect;
  const dispW = cropAspect >= containerAspect ? containerWidth : containerHeight * cropAspect;
  const dispH = cropAspect >= containerAspect ? containerWidth / cropAspect : containerHeight;
  const vidW = dispW / rect.width;
  const vidH = dispH / rect.height;
  return {
    offsetX: (containerWidth - dispW) / 2 - rect.x * vidW,
    offsetY: (containerHeight - dispH) / 2 - rect.y * vidH,
    scaleX: vidW / containerWidth,
    scaleY: vidH / containerHeight,
  };
}
