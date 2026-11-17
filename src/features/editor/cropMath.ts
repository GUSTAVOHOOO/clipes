/**
 * Tipos, resolução e interpolação de crop (#66/#71) espelhando exatamente `core/src/editor/crop.rs`.
 * Coordenadas normalizadas (0–1) e tempos em µs relativos à Fonte.
 */

export type CropRect = { x: number; y: number; width: number; height: number };
export type CropKeyframe = CropRect & { timeUs: number; confidence?: number | null; cut?: boolean };
export type CropSegment = { startUs: number; endUs: number; reason: string; keyframes: CropKeyframe[] };
export type SuggestedCrop = { schemaVersion: number; revision: number; status: string; segments: CropSegment[]; metrics?: unknown };
export type ClipCrop = { suggested: SuggestedCrop | null; edits: CropKeyframe[]; resolved: CropSegment[]; hasCrop: boolean };

const TARGET_ASPECT = 9 / 16;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function baseCropSize(sourceAspect: number): { width: number; height: number } {
  const aspect = Number.isFinite(sourceAspect) && sourceAspect > 0.1 && sourceAspect <= 10 ? sourceAspect : 16 / 9;
  return {
    width: clamp(TARGET_ASPECT / aspect, 0.05, 1),
    height: clamp(aspect / TARGET_ASPECT, 0.05, 1),
  };
}

export function defaultCropRect(sourceAspect: number, zoom = 1): CropRect {
  const base = baseCropSize(sourceAspect);
  const z = clamp(zoom, 1, 2.5);
  const width = clamp(base.width / z, 0.05, 1);
  const height = clamp(base.height / z, 0.05, 1);
  return {
    x: (1 - width) / 2,
    y: (1 - height) / 2,
    width,
    height,
  };
}

export function clampCropRect(rect: CropRect): CropRect {
  const width = clamp(rect.width, 0.05, 1);
  const height = clamp(rect.height, 0.05, 1);
  const x = clamp(rect.x, 0, Math.max(0, 1 - width));
  const y = clamp(rect.y, 0, Math.max(0, 1 - height));
  return { x, y, width, height };
}

export function cropZoomFactor(rect: CropRect, sourceAspect: number): number {
  const base = baseCropSize(sourceAspect);
  if (rect.width <= 0) return 1;
  return clamp(base.width / rect.width, 1, 2.5);
}

export function zoomCropRect(rect: CropRect, sourceAspect: number, zoom: number): CropRect {
  const base = baseCropSize(sourceAspect);
  const z = clamp(zoom, 1, 2.5);
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
