// Fixture determinística do contrato #65/#77 (VITE_CORE_MOCK + editor-test). O núcleo real está em core/src/caption_style.
import { getMockClipSplice } from './editorEditsMock';
import { sourceToSplicedUs } from '@/features/editor/timelineMath';

type Style = { schemaVersion: 1; revision: number; preset: string; font: string; fontSize: number; color: string; activeColor: string; dimColor: string; outlineColor: string; outline: number; shadow: number; x: number; y: number; highlight: boolean };
type Override = { color?: string; activeColor?: string; highlight?: boolean };
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
  const style = current(a.clip_id);
  const startBase = a.start_us ?? 0;
  const endBase = a.end_us ?? startBase + 4_500_000;
  const splice = getMockClipSplice(a.clip_id, startBase, endBase);
  const words = Array.from({ length: 9 }, (_, p) => {
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
  const visible = words.map(w => ({ ...w, text: w.text.replace(/\p{Extended_Pictographic}/gu, '').trim(), color: w.overrides.color ?? style.color, activeColor: w.overrides.activeColor ?? style.activeColor, highlight: style.highlight && (w.overrides.highlight ?? true) }));
  const cues = [0, 3, 6].map(i => ({ startUs: visible[i].startUs, endUs: visible[i + 2].endUs, lines: [visible.slice(i, i + 3)] }));
  return { ass: '', style, cues, emojiRemoved: words.filter(w => emoji.test(w.text)).length, words, transcriptId: 1, start_us: startBase, end_us: endBase, durationUs: splice.effectiveDurationUs, segments: splice.segments, lines: [] };
}
