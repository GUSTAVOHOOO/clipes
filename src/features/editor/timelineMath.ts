// Contas puras da timeline do editor (#61): posição em pixels, janela visível e navegação por Frase.
// A timeline só monta o que está dentro da janela visível (mais uma folga): uma Fonte de 2 h nunca
// vira milhares de elementos, porque o editor já carrega só o Corte ±2 min do proxy.
export const PX_PER_SEC = 48;
export const BUFFER_PX = 480;

export type TimelineSentence = { id: number; startUs: number; endUs: number; text: string };
export type KeptSegment = { sourceStartUs: number; sourceEndUs: number; outputStartUs: number; outputEndUs: number };
export type SilenceInterval = { id: number; startUs: number; endUs: number; gapStartUs: number; gapEndUs: number; status: 'active' | 'reverted' };
export type SilencesState = {
  enabled: boolean;
  thresholdUs: number;
  intervals: SilenceInterval[];
  segments: KeptSegment[];
  removedUs: number;
  effectiveDurationUs: number;
};

export type MontageBlock = {
  blockId: number;
  position: number;
  title: string;
  mode: 'automatic' | 'manual';
  anchorSentenceId: number | null;
  manualSourceStartUs: number | null;
  autoStartUs: number;
  desiredStartUs: number;
  startUs: number;
  endUs: number;
  durationUs: number;
  estimated: boolean;
  pushedUs: number;
  overflowUs: number;
  sourceStartUs: number;
  audioId?: number | null;
};

export type MontageWarning = {
  code: string;
  message: string;
  blockId?: number | null;
  amountUs?: number | null;
};

export type MontageState = {
  schemaVersion: number;
  blocks: MontageBlock[];
  clipDurationUs: number;
  narrationEndUs: number;
  freezeTailUs: number;
  totalDurationUs: number;
  totalPushedUs: number;
  usesEstimatedDurations: boolean;
  scriptApproved?: boolean;
  warnings: MontageWarning[];
};

export type AudioKind = 'music' | 'sfx';
export type LicenseKind = 'unknown' | 'youtube_audio_library' | 'cc0' | 'cc_by' | 'purchased' | 'original';

export type AudioAsset = {
  id: number;
  kind: AudioKind;
  name: string;
  durationUs: number;
  sampleRate: number;
  channels: number;
  bytes: number;
  sha256: string;
  licenseKind: LicenseKind;
  licenseAttribution: string;
  licenseVerified: boolean;
  mediaId: string;
  createdAt: string;
};

export type SfxAnchor =
  | { kind: 'moment'; sourceUs: number }
  | { kind: 'word'; track: 'original' | 'narration'; position: number; blockId?: number | null; offsetUs: number };

export type ResolvedSoundtrack = {
  assetId: number;
  name: string;
  mediaId: string;
  assetDurationUs: number;
  startUs: number;
  playDurationUs: number;
  endUs: number;
  volume: number;
  fadeInUs: number;
  fadeOutUs: number;
  loopToFit: boolean;
  licenseKind: LicenseKind;
  licenseAttribution: string;
  licenseVerified: boolean;
};

export type ResolvedSfx = {
  id: number;
  assetId: number;
  name: string;
  mediaId: string;
  assetDurationUs: number;
  anchor: SfxAnchor;
  wordText?: string | null;
  startUs: number;
  endUs: number;
  sourceStartUs: number;
  volume: number;
  fadeInUs: number;
  fadeOutUs: number;
  outsideClip: boolean;
  licenseKind: LicenseKind;
  licenseAttribution: string;
  licenseVerified: boolean;
};

export type SpeechInterval = { startUs: number; endUs: number };

export type AudioMixWarning = {
  code: string;
  message: string;
  sfxId?: number | null;
  assetId?: number | null;
};

export type AudioMixState = {
  soundtrack: ResolvedSoundtrack | null;
  sfx: ResolvedSfx[];
  speechIntervals: SpeechInterval[];
  totalDurationUs: number;
  unverifiedCount: number;
  warnings: AudioMixWarning[];
};

/** Mapeia um tempo absoluto da Fonte (µs) para o tempo relativo no Corte emendado (µs),
 * espelhando `SpliceMap::source_to_output` do núcleo (#77). */
export function sourceToSplicedUs(sourceUs: number, segments: KeptSegment[] | undefined, fallbackStartUs: number): number {
  if (!segments || segments.length === 0) return sourceUs - fallbackStartUs;
  if (sourceUs <= segments[0].sourceStartUs) return 0;
  for (const seg of segments) {
    if (sourceUs < seg.sourceStartUs) return seg.outputStartUs;
    if (sourceUs <= seg.sourceEndUs) return seg.outputStartUs + (sourceUs - seg.sourceStartUs);
  }
  return segments[segments.length - 1].outputEndUs;
}

/** Mapeia um tempo do vídeo montado (µs) para o eixo da Fonte na timeline; sobra após o fim
 * do Corte estende além de `clipEndUs` para mostrar a cauda congelada (`tpad`). */
export function splicedToSourceUs(
  outputUs: number,
  segments: KeptSegment[] | undefined,
  clipStartUs: number,
  clipEndUs: number,
): number {
  if (!segments || segments.length === 0) {
    return clipStartUs + Math.max(0, outputUs);
  }
  if (outputUs <= 0) return segments[0].sourceStartUs;
  for (const seg of segments) {
    if (outputUs <= seg.outputEndUs) {
      return seg.sourceStartUs + (outputUs - seg.outputStartUs);
    }
  }
  const last = segments[segments.length - 1];
  return clipEndUs + (outputUs - last.outputEndUs);
}

export const usToPx = (us: number, windowStartUs: number) => ((us - windowStartUs) / 1_000_000) * PX_PER_SEC;
export const pxToUs = (px: number, windowStartUs: number) => Math.round(windowStartUs + (px / PX_PER_SEC) * 1_000_000);

/** Faixa de pixels a montar: a área rolada mais a folga nos dois lados, dentro de `[0, total]`. */
export function visiblePx(scrollLeft: number, width: number, total: number): [number, number] {
  return [Math.max(0, scrollLeft - BUFFER_PX), Math.min(total, scrollLeft + width + BUFFER_PX)];
}

/** Frases que tocam a faixa de pixels. */
export function visibleSentences(items: TimelineSentence[], windowStartUs: number, [from, to]: [number, number]) {
  return items.filter(s => usToPx(s.endUs, windowStartUs) >= from && usToPx(s.startUs, windowStartUs) <= to);
}

/** Índices das miniaturas (uma por `intervalUs`) que tocam a faixa de pixels. */
export function visibleThumbs(count: number, intervalUs: number, [from, to]: [number, number]) {
  const size = (intervalUs / 1_000_000) * PX_PER_SEC;
  const first = Math.max(0, Math.floor(from / size));
  const last = Math.min(count - 1, Math.floor(to / size));
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, n) => first + n);
}

/** Frase que contém o tempo (a última que começou); `null` antes da primeira. */
export function sentenceAt(items: TimelineSentence[], us: number) {
  let found: TimelineSentence | null = null;
  for (const s of items) { if (s.startUs <= us) found = s; else break; }
  return found;
}

/** Começo da Frase seguinte (ou anterior) ao tempo; `null` se não há. */
export function neighborStart(items: TimelineSentence[], us: number, direction: 1 | -1) {
  if (direction === 1) return items.find(s => s.startUs > us + 1)?.startUs ?? null;
  const before = items.filter(s => s.startUs < us - 1);
  return before.length ? before[before.length - 1].startUs : null;
}

/** Velocidades de reprodução do J/K/L: cada toque na mesma direção dobra, até 4×. */
export function nextRate(rate: number, key: 'j' | 'l'): number {
  const direction = key === 'l' ? 1 : -1;
  if (rate * direction <= 0) return direction;
  return direction * Math.min(4, Math.abs(rate) * 2);
}
