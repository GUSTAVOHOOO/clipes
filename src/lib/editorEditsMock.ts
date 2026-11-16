// Fixture determinística do contrato #70/#66, só usada com VITE_CORE_MOCK + editor-test.
import type { ExportRequest } from './core';
import { interpolateCrop, type CropKeyframe, type CropSegment } from '@/features/editor/cropMath';
type Range = { startUs: number; endUs: number };
type Suggested = { schemaVersion: number; revision: number; status: string; segments: CropSegment[] };
type CropDoc = { suggested: Suggested | null; edits: CropKeyframe[] };
type Clip = { id: number; request: ExportRequest; range: Range; undo: Range[]; redo: Range[]; revision: number; crop: CropDoc };
const clips = new Map<string, Clip>();
const fail = (code: string) => { throw { code }; };
const ids = (r: Range) => ({ start_id: Math.floor(r.startUs / 10_000_000) + 1, end_id: Math.ceil(r.endUs / 10_000_000) });
const cropTest = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('crop-test');
function exampleCrop(startUs: number, endUs: number): Suggested {
  const w = 9 / 16 / (16 / 9);
  const mid = startUs + Math.floor((endUs - startUs) / 2);
  const panEnd = startUs + Math.floor(((endUs - startUs) * 2) / 5);
  return {
    schemaVersion: 1, revision: 1, status: 'suggestion',
    segments: [
      { startUs, endUs: mid, reason: 'start', keyframes: [{ timeUs: startUs, x: 0, y: 0, width: w, height: 1, confidence: 0.95 }, { timeUs: panEnd, x: (1 - w) * 0.5, y: 0, width: w, height: 1, confidence: 0.95 }] },
      { startUs: mid, endUs, reason: 'scene', keyframes: [{ timeUs: mid, x: 1 - w, y: 0, width: w, height: 1, confidence: 0.9 }] },
    ],
  };
}
function resolveCrop(crop: CropDoc): CropSegment[] {
  const sug = crop.suggested;
  if (!sug || sug.segments.length === 0) {
    if (crop.edits.length === 0) return [];
    return [{ startUs: crop.edits[0].timeUs, endUs: crop.edits[crop.edits.length - 1].timeUs + 1, reason: 'start', keyframes: crop.edits }];
  }
  return sug.segments.flatMap((seg, i) => {
    const low = i === 0 ? -Infinity : seg.startUs;
    const high = i + 1 === sug.segments.length ? Infinity : seg.endUs;
    const edited = crop.edits.filter(k => k.timeUs >= low && k.timeUs < high);
    return edited.length === 0 ? [seg] : [{ startUs: Math.min(seg.startUs, edited[0].timeUs), endUs: Math.max(seg.endUs, edited[edited.length - 1].timeUs + 1), reason: seg.reason, keyframes: edited }];
  });
}
const cropView = (crop: CropDoc) => { const resolved = resolveCrop(crop); return { suggested: crop.suggested, edits: crop.edits, resolved, hasCrop: resolved.length > 0 }; };
const answer = (c: Clip, r = c.range) => ({ clipId: c.id, schemaVersion: 2, request: { ...c.request, ...ids(r) }, ...r, revision: c.revision, undoCount: c.undo.length, redoCount: c.redo.length, crop: cropView(c.crop) });

export function editorEditsMock(name: string, a: Record<string, unknown>): unknown {
  if (name === 'editor.flush') return null;
  if (name === 'editor.open') {
    const request = a as ExportRequest;
    const key = request.candidate_id ? `candidate:${request.candidate_id}` : `${request.source_id}:${request.start_id}:${request.end_id}`;
    let c = clips.get(key);
    if (!c) {
      const startUs = (request.start_id - 1) * 10_000_000, endUs = request.end_id * 10_000_000;
      c = { id: clips.size + 1, request, range: { startUs, endUs }, undo: [], redo: [], revision: 0, crop: { suggested: cropTest() ? exampleCrop(startUs, endUs) : null, edits: [] } };
      clips.set(key, c);
    }
    return { ...answer(c), windowStartUs: Math.max(0, c.range.startUs - 120_000_000), windowEndUs: c.range.endUs + 120_000_000, fps: 24 };
  }
  if (name.startsWith('editor.crop.')) {
    const c = [...clips.values()].find(item => item.id === a.clip_id);
    if (!c) return fail('invalid_clip');
    if (name === 'editor.crop.get') return { clipId: c.id, schemaVersion: 2, revision: c.revision, ...cropView(c.crop) };
    if (name === 'editor.crop.evaluate') return { clipId: c.id, timeUs: Number(a.time_us), rect: interpolateCrop(resolveCrop(c.crop), Number(a.time_us)) };
    if (name === 'editor.crop.set_suggested') { c.crop.suggested = (a.suggested as Suggested | null) ?? null; c.revision++; return { clipId: c.id, schemaVersion: 2, revision: c.revision, ...cropView(c.crop) }; }
    if (name === 'editor.crop.set_edits') { c.crop.edits = (a.edits as CropKeyframe[]) ?? []; c.revision++; return { clipId: c.id, schemaVersion: 2, revision: c.revision, ...cropView(c.crop) }; }
    if (name === 'editor.crop.example') { c.crop.suggested = exampleCrop(c.range.startUs, c.range.endUs); c.revision++; return { clipId: c.id, schemaVersion: 2, revision: c.revision, ...cropView(c.crop) }; }
  }
  if (!['editor.adjust', 'editor.undo', 'editor.redo'].includes(name)) return undefined;
  const c = [...clips.values()].find(c => c.id === a.clip_id);
  if (!c) return fail('invalid_clip');
  if (name !== 'editor.adjust') {
    const from = name === 'editor.undo' ? c.undo : c.redo, to = name === 'editor.undo' ? c.redo : c.undo;
    const next = from.pop();
    if (next) { to.push(c.range); c.range = next; c.revision++; }
    return answer(c);
  }
  const start = a.edge === 'start';
  const edge = start ? 'startUs' : 'endUs';
  let time: number;
  if (typeof a.sentence_delta === 'number') {
    const current = ids(c.range)[start ? 'start_id' : 'end_id'];
    const next = current + a.sentence_delta;
    if (next < 1 || next > 720) return answer(c);
    time = (next - (start ? 1 : 0)) * 10_000_000;
  } else if (typeof a.sentence_id === 'number') time = (a.sentence_id - (start ? 1 : 0)) * 10_000_000;
  else {
    const requested = Math.max(0, Math.min(7_200_000_000, Number(a.time_us)));
    time = a.free ? Math.round(Math.round(requested * 24 / 1_000_000) * 1_000_000 / 24) : Math.floor((requested + 4_999_999) / 10_000_000) * 10_000_000;
  }
  const next = { ...c.range, [edge]: time };
  if (next.endUs <= next.startUs) return fail('adjust_empty');
  if (next.endUs - next.startUs < 20_000_000) return fail('adjust_too_short');
  if (next.endUs - next.startUs > 180_000_000) return fail('adjust_too_long');
  if (a.preview) return answer(c, next);
  if (next.startUs !== c.range.startUs || next.endUs !== c.range.endUs) {
    c.undo.push(c.range); if (c.undo.length > 100) c.undo.shift(); c.redo = []; c.range = next; c.revision++;
  }
  return answer(c);
}
