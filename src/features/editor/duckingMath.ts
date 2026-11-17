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

export type SpeechInterval = {
  startUs: number;
  endUs: number;
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

/** Informa se algum intervalo de fala (Frases da Transcrição ou Narração) está ativo em `outputUs`. */
export function activeSpeechAt(intervals: SpeechInterval[], outputUs: number): boolean {
  for (const seg of intervals) {
    if (outputUs >= seg.startUs && outputUs < seg.endUs) return true;
  }
  return false;
}

/** Calcula o ganho instantâneo alvo sem rampa (usado em seek/pausa para paridade imediata). */
export function targetDuckGain(active: boolean): number {
  return active ? DUCKING_GAIN : 1;
}

/** Avança a envoltória de ganho da Fonte (ou trilha sonora) com ataque e liberação suaves. */
export function stepDuckGain(currentGain: number, active: boolean, dtMs: number): number {
  const target = targetDuckGain(active);
  if (dtMs <= 0) return currentGain;
  const durationMs = active ? DUCKING_ATTACK_MS : DUCKING_RELEASE_MS;
  const maxStep = ((1 - DUCKING_GAIN) * dtMs) / durationMs;
  if (currentGain > target) return Math.max(target, currentGain - maxStep);
  if (currentGain < target) return Math.min(target, currentGain + maxStep);
  return target;
}

/** Envoltória linear de fade de entrada e saída (`afade`) em [0, 1]. */
export function fadeEnvelope(elapsedUs: number, totalUs: number, fadeInUs: number, fadeOutUs: number): number {
  if (totalUs <= 0 || elapsedUs < 0 || elapsedUs >= totalUs) return 0;
  let gain = 1;
  const fi = Math.min(Math.max(0, fadeInUs), totalUs);
  if (fi > 0 && elapsedUs < fi) {
    gain = Math.min(gain, elapsedUs / fi);
  }
  const fo = Math.min(Math.max(0, fadeOutUs), totalUs);
  const foStart = totalUs - fo;
  if (fo > 0 && elapsedUs > foStart) {
    gain = Math.min(gain, Math.max(0, (totalUs - elapsedUs) / fo));
  }
  return Math.max(0, Math.min(1, gain));
}

/** Instante em segundos dentro do arquivo da trilha sonora (com repetição ou corte), ou `null` fora. */
export function soundtrackPlaybackSec(
  outputUs: number,
  startUs: number,
  playDurationUs: number,
  assetDurationUs: number,
  loopToFit: boolean,
): number | null {
  if (playDurationUs <= 0 || assetDurationUs <= 0) return null;
  const elapsed = outputUs - startUs;
  if (elapsed < 0 || elapsed >= playDurationUs) return null;
  const localUs = loopToFit ? elapsed % assetDurationUs : elapsed;
  return localUs / 1_000_000;
}

/** Ganho final da trilha sonora na prévia (volume base × fade × ducking sob fala). */
export function computeSoundtrackGain(
  baseVolume: number,
  elapsedUs: number,
  playDurationUs: number,
  fadeInUs: number,
  fadeOutUs: number,
  duckGain: number,
): number {
  const env = fadeEnvelope(elapsedUs, playDurationUs, fadeInUs, fadeOutUs);
  return Math.max(0, Math.min(1, baseVolume * env * duckGain));
}
