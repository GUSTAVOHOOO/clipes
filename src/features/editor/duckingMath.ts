// Contas puras da prévia do ducking da Narração (#82), espelhando os parâmetros
// documentados de `core/src/export/pipeline.rs` (-12 dB, ataque 40 ms, liberação 300 ms).

export const DUCKING_TARGET_DB = -12;
export const DUCKING_GAIN = Math.pow(10, DUCKING_TARGET_DB / 20);
export const DUCKING_ATTACK_MS = 40;
export const DUCKING_RELEASE_MS = 300;

export type PreviewNarrationSegment = {
  blockId: number;
  audioId: number;
  startUs: number;
  endUs: number;
  durationUs: number;
};

/** Devolve o segmento de Narração com áudio ativo no instante `outputUs` do Corte montado. */
export function activeNarrationAt(
  segments: PreviewNarrationSegment[],
  outputUs: number,
): PreviewNarrationSegment | null {
  for (const seg of segments) {
    if (outputUs >= seg.startUs && outputUs < seg.endUs) return seg;
  }
  return null;
}

/** Calcula o ganho instantâneo alvo sem rampa (usado em seek/pausa para paridade imediata). */
export function targetDuckGain(active: boolean): number {
  return active ? DUCKING_GAIN : 1;
}

/** Avança a envoltória de ganho da Fonte com ataque e liberação suaves. */
export function stepDuckGain(currentGain: number, active: boolean, dtMs: number): number {
  const target = targetDuckGain(active);
  if (dtMs <= 0) return currentGain;
  const durationMs = active ? DUCKING_ATTACK_MS : DUCKING_RELEASE_MS;
  const maxStep = ((1 - DUCKING_GAIN) * dtMs) / durationMs;
  if (currentGain > target) return Math.max(target, currentGain - maxStep);
  if (currentGain < target) return Math.min(target, currentGain + maxStep);
  return target;
}
