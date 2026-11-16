// Fixture determinística do contrato #70, só usada com VITE_CORE_MOCK + editor-test.
import type { ExportRequest } from './core';
type Range = { startUs: number; endUs: number };
type Clip = { id: number; request: ExportRequest; range: Range; undo: Range[]; redo: Range[]; revision: number };
const clips = new Map<string, Clip>();
const fail = (code: string) => { throw { code }; };
const ids = (r: Range) => ({ start_id: Math.floor(r.startUs / 10_000_000) + 1, end_id: Math.ceil(r.endUs / 10_000_000) });
const answer = (c: Clip, r = c.range) => ({ clipId: c.id, request: { ...c.request, ...ids(r) }, ...r, revision: c.revision, undoCount: c.undo.length, redoCount: c.redo.length });

export function editorEditsMock(name: string, a: Record<string, unknown>): unknown {
  if (name === 'editor.flush') return null;
  if (name === 'editor.open') {
    const request = a as ExportRequest;
    const key = request.candidate_id ? `candidate:${request.candidate_id}` : `${request.source_id}:${request.start_id}:${request.end_id}`;
    let c = clips.get(key);
    if (!c) {
      c = { id: clips.size + 1, request, range: { startUs: (request.start_id - 1) * 10_000_000, endUs: request.end_id * 10_000_000 }, undo: [], redo: [], revision: 0 };
      clips.set(key, c);
    }
    return { ...answer(c), windowStartUs: Math.max(0, c.range.startUs - 120_000_000), windowEndUs: c.range.endUs + 120_000_000, fps: 24 };
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
