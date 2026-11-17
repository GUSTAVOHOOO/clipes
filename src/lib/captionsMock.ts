// Fixture determinística do contrato #65/#77 (VITE_CORE_MOCK + editor-test). O núcleo real está em core/src/caption_style.
import { getMockClipSplice } from './editorEditsMock';
import { getMockActiveTranslation } from './translationMock';
import { sourceToSplicedUs } from '@/features/editor/timelineMath';

type Style = { schemaVersion: 1; revision: number; preset: string; font: string; fontSize: number; color: string; activeColor: string; dimColor: string; outlineColor: string; outline: number; shadow: number; x: number; y: number; highlight: boolean };
type Override = { color?: string; activeColor?: string; highlight?: boolean; hidden?: boolean };
const base = (preset: string): Style => ({ schemaVersion: 1, revision: 0, preset, font: preset === 'cinema' ? 'Noto Serif' : 'Noto Sans', fontSize: preset === 'vertical' ? 64 : 56, color: '#FFFFFF', activeColor: '#FACC15', dimColor: '#FFFFFF', outlineColor: '#101010', outline: preset === 'cinema' ? 3 : 6, shadow: 0, x: 540, y: 1440, highlight: preset !== 'simple' });
let projectDefault: Style | null = null;
export function getDefaultCaptionStyleMock(): Style {
  return { ...(projectDefault ?? base('vertical')) };
}
export function setDefaultCaptionStyleMock(style: Style): Style {
  projectDefault = { ...style, revision: (projectDefault?.revision ?? 0) + 1 };
  return { ...projectDefault };
}
const styles = new Map<number, Style>();
const overrides = new Map<number, Override>();
const emoji = /[\u200d\ufe0e\ufe0f\u20e3\u00a9\u00ae\u2300-\u23ff\u2600-\u27ff\u{1f000}-\u{1faff}]/u;
const unsupportedGlyph = /[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]/u;

export function captionsMock(name: string, a: Record<string, any>, textOf: (position: number) => string): unknown {
  if (name === 'captions.remap_status') return { discarded: 0 };
  if (!name.startsWith('captions.') && name !== 'export.captions') return undefined;
  const current = (clip: number) => { let s = styles.get(clip); if (!s) { s = { ...(projectDefault ?? base('vertical')), revision: 0 }; styles.set(clip, s); } return s; };
  if (name === 'captions.style.get') return current(a.clip_id);
  if (name === 'captions.style.set' || name === 'captions.style.preset') {
    const old = current(a.clip_id);
    const next = name === 'captions.style.preset' ? base(a.preset) : { ...a.style };
    if ((name === 'captions.style.preset' ? a.revision : next.revision) !== old.revision) throw { code: 'caption_style_conflict', message: 'O estilo mudou. Reabra a legenda antes de editar.' };
    next.revision = old.revision + 1; styles.set(a.clip_id, next); return next;
  }
  if (name === 'captions.style.default') { projectDefault = { ...current(a.clip_id) }; return projectDefault; }
  if (name === 'captions.override') { if (Object.keys(a.overrides).length) overrides.set(a.position, a.overrides); else overrides.delete(a.position); return { position: a.position, overrides: a.overrides }; }
  if (name === 'captions.overrides') return [...overrides].map(([position, o]) => ({ position, overrides: o }));
  const style = typeof a.clip_id === 'number' ? current(a.clip_id) : getDefaultCaptionStyleMock();
  const startBase = a.start_us ?? 0;
  const endBase = a.end_us ?? startBase + 4_500_000;
  const splice = getMockClipSplice(a.clip_id, startBase, endBase);
  const translated = getMockActiveTranslation(a.clip_id);
  const rawWords = translated
    ? (() => {
        const out: { position: number; text: string; startUs: number; endUs: number; sourceStartUs: number; overrides: Override }[] = [];
        let idx = 0;
        const step = Math.max(1, Math.floor((endBase - startBase) / translated.lines.length));
        translated.lines.forEach((line, li) => {
          const tokens = line.text.trim().split(/\s+/).filter(Boolean);
          const sStart = startBase + li * step;
          const sEnd = li + 1 === translated.lines.length ? endBase : startBase + (li + 1) * step;
          const total = tokens.reduce((acc, tok) => acc + Math.max(1, [...tok].length), 0) || 1;
          let cum = 0;
          tokens.forEach((tok, ti) => {
            const wStart = sStart + Math.floor(((sEnd - sStart) * cum) / total);
            cum += Math.max(1, [...tok].length);
            const wEnd = ti + 1 === tokens.length ? sEnd : sStart + Math.floor(((sEnd - sStart) * cum) / total);
            idx += 1;
            out.push({
              position: -idx,
              text: ' ' + tok,
              startUs: sourceToSplicedUs(wStart, splice.segments, startBase),
              endUs: sourceToSplicedUs(Math.max(wStart + 10_000, wEnd), splice.segments, startBase),
              sourceStartUs: wStart,
              overrides: {},
            });
          });
        });
        return out;
      })()
    : Array.from({ length: 9 }, (_, p) => {
        const absStart = startBase + p * 500_000;
        const absEnd = absStart + 450_000;
        return {
          position: p,
          text: ' ' + textOf(p),
          startUs: sourceToSplicedUs(absStart, splice.segments, startBase),
          endUs: sourceToSplicedUs(absEnd, splice.segments, startBase),
          sourceStartUs: absStart,
          overrides: overrides.get(p) ?? {},
        };
      });
  const missingGlyphs = rawWords.filter(w => !w.overrides.hidden).flatMap(w => {
    const visible = w.text.replace(/\p{Extended_Pictographic}/gu, '').trim();
    const match = unsupportedGlyph.exec(visible);
    if (!match) return [];
    const ch = match[0];
    return [{ position: w.position, sentence_id: 1, word: visible, char: ch, codepoint: `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`, start_us: w.sourceStartUs }];
  });
  const words = rawWords.map(w => ({ ...w, missingGlyph: missingGlyphs.find(m => m.position === w.position) ?? null }));
  const visible = words.filter(w => !w.overrides.hidden).map(w => ({ ...w, text: w.text.replace(/\p{Extended_Pictographic}/gu, '').trim(), color: w.overrides.color ?? style.color, activeColor: w.overrides.activeColor ?? style.activeColor, highlight: style.highlight && (w.overrides.highlight ?? true) }));
  const cues: { startUs: number; endUs: number; lines: typeof visible[] }[] = [];
  for (let i = 0; i < visible.length; i += 3) {
    const slice = visible.slice(i, i + 3);
    cues.push({ startUs: slice[0].startUs, endUs: slice[slice.length - 1].endUs, lines: [slice] });
  }
  return { ass: '', style, cues, emojiRemoved: words.filter(w => emoji.test(w.text)).length, words, transcriptId: 1, start_us: startBase, end_us: endBase, durationUs: splice.effectiveDurationUs, segments: splice.segments, lines: [], missingGlyphs };
}
