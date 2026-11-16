// Contas puras da timeline do editor (#61): posição em pixels, janela visível e navegação por Frase.
// A timeline só monta o que está dentro da janela visível (mais uma folga): uma Fonte de 2 h nunca
// vira milhares de elementos, porque o editor já carrega só o Corte ±2 min do proxy.
export const PX_PER_SEC = 48;
export const BUFFER_PX = 480;

export type TimelineSentence = { id: number; startUs: number; endUs: number; text: string };

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
