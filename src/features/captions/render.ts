import sans from '../../../core/assets/fonts/NotoSans-Bold.ttf?url';
import serif from '../../../core/assets/fonts/NotoSerif-Bold.ttf?url';
import type { CaptionData } from './types';

let fonts: Promise<void> | undefined;
export function loadCaptionFonts() {
  return fonts ??= Promise.all([['Noto Sans', sans], ['Noto Serif', serif]].map(async ([name, url]) => {
    const face = new FontFace(`Clipes ${name}`, `url("${url}")`, { weight: '700' });
    (document.fonts as unknown as { add(face: FontFace): void }).add(await face.load());
  })).then(() => undefined);
}

/** Mesmo canvas 1080×1920, quebras e centésimos preparados no núcleo.
 * libass usa OS/2 WinAscent+WinDescent; ambos os TTF têm 1000/(1069+293).
 * https://github.com/libass/libass/blob/master/libass/ass_font.c (set_font_metrics).
 * O harness confere essas métricas e a rasterização CSS contra o libass real.
 */
export function drawCaption(root: HTMLElement, data: CaptionData, timeUs: number) {
  root.replaceChildren();
  const cue = data.cues.find(c => timeUs >= c.startUs && timeUs < c.endUs);
  if (!cue) return;
  const s = data.style;
  const block = document.createElement('div');
  Object.assign(block.style, { position: 'absolute', left: `${s.x}px`, top: `${s.y}px`, transform: 'translate(-50%, -100%)', fontFamily: `"Clipes ${s.font}"`, fontSize: `${s.fontSize * 1000 / 1362}px`, lineHeight: `${s.fontSize}px`, fontWeight: '700', fontKerning: 'normal', whiteSpace: 'pre', textAlign: 'center', color: s.color });
  block.dataset.captionCue = String(cue.startUs);
  if (s.preset === 'cinema') block.style.opacity = String(Math.max(0, Math.min(1, (timeUs - cue.startUs) / 120_000, (cue.endUs - timeUs) / 120_000)));
  for (const line of cue.lines) {
    const row = document.createElement('div');
    row.dataset.captionLine = '';
    for (const [i, w] of line.entries()) {
      if (i) row.append(document.createTextNode(' '));
      const span = document.createElement('span');
      span.dataset.captionWord = String(w.position);
      const past = timeUs >= w.endUs;
      const fill = w.highlight ? Math.max(0, Math.min(1, (timeUs - w.startUs) / (w.endUs - w.startUs))) : 0;
      Object.assign(span.style, { position: 'relative', display: 'inline-block', color: w.highlight && past ? s.dimColor : w.color, WebkitTextStroke: `${s.outline * 2}px ${s.outlineColor}`, paintOrder: 'stroke fill', textShadow: s.shadow ? `${s.shadow}px ${s.shadow}px 0 #000000` : 'none' });
      span.textContent = w.text;
      if (fill > 0 && !past) {
        const active = document.createElement('span');
        active.textContent = w.text;
        Object.assign(active.style, { position: 'absolute', inset: '0', color: w.activeColor, clipPath: `inset(-20px ${(1 - fill) * 100}% -20px -20px)` });
        span.append(active);
      }
      row.append(span);
    }
    block.append(row);
  }
  root.append(block);
}
