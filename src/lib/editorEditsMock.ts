// Fixture determinística do contrato #70/#77, só usada com VITE_CORE_MOCK + editor-test.
import type { ExportRequest } from './core';
import type { KeptSegment, SilenceInterval, SilencesState } from '@/features/editor/timelineMath';

type Range = { startUs: number; endUs: number };
type MockSilences = { thresholdUs: number; intervals: SilenceInterval[] };
type Snapshot = { range: Range; silences: MockSilences | null };
type Clip = { id: number; request: ExportRequest; range: Range; silences: MockSilences | null; undo: Snapshot[]; redo: Snapshot[]; revision: number };

const clips = new Map<string, Clip>();
const fail = (code: string) => { throw { code }; };
const ids = (r: Range) => ({ start_id: Math.floor(r.startUs / 10_000_000) + 1, end_id: Math.ceil(r.endUs / 10_000_000) });
const cloneSilences = (s: MockSilences | null): MockSilences | null => s ? { thresholdUs: s.thresholdUs, intervals: s.intervals.map(i => ({ ...i })) } : null;

export function buildMockSplice(range: Range, silences: MockSilences | null): { segments: KeptSegment[]; removedUs: number; effectiveDurationUs: number } {
  const active = (silences?.intervals ?? [])
    .filter(i => i.status === 'active')
    .map(i => [Math.max(range.startUs, i.startUs), Math.min(range.endUs, i.endUs)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const segments: KeptSegment[] = [];
  let cursor = range.startUs;
  let outCursor = 0;
  for (const [cs, ce] of active) {
    if (cs > cursor) {
      const dur = cs - cursor;
      segments.push({ sourceStartUs: cursor, sourceEndUs: cs, outputStartUs: outCursor, outputEndUs: outCursor + dur });
      outCursor += dur;
    }
    cursor = Math.max(cursor, ce);
  }
  if (range.endUs > cursor) {
    const dur = range.endUs - cursor;
    segments.push({ sourceStartUs: cursor, sourceEndUs: range.endUs, outputStartUs: outCursor, outputEndUs: outCursor + dur });
    outCursor += dur;
  }
  const orig = Math.max(0, range.endUs - range.startUs);
  return { segments, removedUs: Math.max(0, orig - outCursor), effectiveDurationUs: outCursor };
}

function silencesView(range: Range, silences: MockSilences | null): SilencesState {
  const { segments, removedUs, effectiveDurationUs } = buildMockSplice(range, silences);
  return {
    enabled: silences !== null,
    thresholdUs: silences?.thresholdUs ?? 600_000,
    intervals: silences?.intervals ?? [],
    segments,
    removedUs,
    effectiveDurationUs,
  };
}

function detectMockSilences(range: Range, thresholdUs: number): MockSilences {
  if (thresholdUs < 300_000 || thresholdUs > 2_000_000) fail('invalid_silence_threshold');
  const intervals: SilenceInterval[] = [];
  let nextId = 1;
  const firstSentence = Math.floor(range.startUs / 10_000_000);
  const lastSentence = Math.ceil(range.endUs / 10_000_000);
  for (let s = firstSentence; s < lastSentence; s++) {
    const base = s * 10_000_000;
    for (const [gs, ge] of [[base + 2_000_000, base + 2_450_000], [base + 5_000_000, base + 5_800_000], [base + 7_500_000, base + 8_700_000]]) {
      if (gs < range.startUs || ge > range.endUs) continue;
      if (ge - gs >= thresholdUs) {
        intervals.push({ id: nextId++, startUs: gs + 120_000, endUs: ge - 80_000, gapStartUs: gs, gapEndUs: ge, status: 'active' });
      }
    }
  }
  return { thresholdUs, intervals };
}

export function getMockClipSplice(clipId: number | undefined, startUs: number, endUs: number) {
  const c = [...clips.values()].find(item => item.id === clipId);
  if (!c) return buildMockSplice({ startUs, endUs }, null);
  return buildMockSplice(c.range, c.silences);
}

const answer = (c: Clip, r = c.range, s = c.silences) => ({
  clipId: c.id,
  request: { ...c.request, ...ids(r) },
  ...r,
  revision: c.revision,
  undoCount: c.undo.length,
  redoCount: c.redo.length,
  silences: silencesView(r, s),
});

export function editorEditsMock(name: string, a: Record<string, unknown>): unknown {
  if (name === 'editor.flush') return null;
  if (name === 'editor.open') {
    const request = a as ExportRequest;
    const key = request.candidate_id ? `candidate:${request.candidate_id}` : `${request.source_id}:${request.start_id}:${request.end_id}`;
    let c = clips.get(key);
    if (!c) {
      c = { id: clips.size + 1, request, range: { startUs: (request.start_id - 1) * 10_000_000, endUs: request.end_id * 10_000_000 }, silences: null, undo: [], redo: [], revision: 0 };
      clips.set(key, c);
    }
    return { ...answer(c), windowStartUs: Math.max(0, c.range.startUs - 120_000_000), windowEndUs: c.range.endUs + 120_000_000, fps: 24 };
  }
  if (!['editor.adjust', 'editor.undo', 'editor.redo', 'editor.silences.detect', 'editor.silences.toggle', 'editor.silences.revert_all', 'editor.silences.apply_all'].includes(name)) return undefined;
  const c = [...clips.values()].find(c => c.id === a.clip_id);
  if (!c) return fail('invalid_clip');
  if (name === 'editor.undo' || name === 'editor.redo') {
    const from = name === 'editor.undo' ? c.undo : c.redo, to = name === 'editor.undo' ? c.redo : c.undo;
    const next = from.pop();
    if (next) { to.push({ range: c.range, silences: cloneSilences(c.silences) }); c.range = next.range; c.silences = next.silences; c.revision++; }
    return answer(c);
  }
  if (name === 'editor.silences.detect') {
    const thresholdUs = typeof a.threshold_us === 'number' ? a.threshold_us : (c.silences?.thresholdUs ?? 600_000);
    const next = detectMockSilences(c.range, thresholdUs);
    if (a.preview) return answer(c, c.range, next);
    c.undo.push({ range: c.range, silences: cloneSilences(c.silences) });
    if (c.undo.length > 100) c.undo.shift();
    c.redo = [];
    c.silences = next;
    c.revision++;
    return answer(c);
  }
  if (name === 'editor.silences.toggle') {
    if (!c.silences) return fail('invalid_silence_interval');
    const next = cloneSilences(c.silences)!;
    const item = next.intervals.find(i => i.id === a.id);
    if (!item) return fail('invalid_silence_interval');
    const targetStatus = a.status === 'active' || a.status === 'reverted' ? a.status : (item.status === 'active' ? 'reverted' : 'active');
    if (item.status !== targetStatus) {
      item.status = targetStatus;
      c.undo.push({ range: c.range, silences: cloneSilences(c.silences) });
      if (c.undo.length > 100) c.undo.shift();
      c.redo = [];
      c.silences = next;
      c.revision++;
    }
    return answer(c);
  }
  if (name === 'editor.silences.revert_all' || name === 'editor.silences.apply_all') {
    if (c.silences) {
      const targetStatus = name === 'editor.silences.revert_all' ? 'reverted' : 'active';
      if (c.silences.intervals.some(i => i.status !== targetStatus)) {
        const next = cloneSilences(c.silences)!;
        for (const item of next.intervals) item.status = targetStatus;
        c.undo.push({ range: c.range, silences: cloneSilences(c.silences) });
        if (c.undo.length > 100) c.undo.shift();
        c.redo = [];
        c.silences = next;
        c.revision++;
      }
    }
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
  const clipped = c.silences ? { thresholdUs: c.silences.thresholdUs, intervals: c.silences.intervals.filter(i => i.gapStartUs >= next.startUs && i.gapEndUs <= next.endUs) } : null;
  if (a.preview) return answer(c, next, clipped);
  if (next.startUs !== c.range.startUs || next.endUs !== c.range.endUs) {
    c.undo.push({ range: c.range, silences: cloneSilences(c.silences) }); if (c.undo.length > 100) c.undo.shift(); c.redo = []; c.range = next; c.silences = clipped; c.revision++;
  }
  return answer(c);
}
