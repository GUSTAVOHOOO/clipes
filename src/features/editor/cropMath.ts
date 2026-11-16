/**
 * Tipos e interpolação de crop (#66) espelhando exatamente `core/src/editor/crop.rs`.
 * Coordenadas normalizadas (0–1) e tempos em µs relativos à Fonte.
 */

export type CropRect = { x: number; y: number; width: number; height: number };
export type CropKeyframe = CropRect & { timeUs: number; confidence?: number | null; cut?: boolean };
export type CropSegment = { startUs: number; endUs: number; reason: string; keyframes: CropKeyframe[] };
export type ClipCrop = { suggested: unknown | null; edits: CropKeyframe[]; resolved: CropSegment[]; hasCrop: boolean };

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
