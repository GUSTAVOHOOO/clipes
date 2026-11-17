// Fixture determinística do contrato #70/#77/#66/#71, só usada com VITE_CORE_MOCK + editor-test.
import type { ExportRequest } from './core';
import type { KeptSegment, SilenceInterval, SilencesState } from '@/features/editor/timelineMath';
import { interpolateCrop, resolveCrop, type CropKeyframe, type SuggestedCrop } from '@/features/editor/cropMath';

type Range = { startUs: number; endUs: number };
type MockSilences = { thresholdUs: number; intervals: SilenceInterval[] };
type Snapshot = { range: Range; silences: MockSilences | null; cropEdits: CropKeyframe[] };
type CropDoc = { suggested: SuggestedCrop | null; edits: CropKeyframe[] };
type Clip = { id: number; request: ExportRequest; range: Range; silences: MockSilences | null; undo: Snapshot[]; redo: Snapshot[]; revision: number; crop: CropDoc };
type ReframeJob = { id: number; job: number; source: number; startUs: number; endUs: number; polls: number; revision: number; timeline: SuggestedCrop | null };

const clips = new Map<string, Clip>();
const reframeJobs = new Map<number, ReframeJob>();
let nextReframeId = 1;
const fail = (code: string) => { throw { code }; };
const ids = (r: Range) => ({ start_id: Math.floor(r.startUs / 10_000_000) + 1, end_id: Math.ceil(r.endUs / 10_000_000) });
const cloneSilences = (s: MockSilences | null): MockSilences | null => s ? { thresholdUs: s.thresholdUs, intervals: s.intervals.map(i => ({ ...i })) } : null;
const cloneEdits = (edits: CropKeyframe[]): CropKeyframe[] => edits.map(k => ({ ...k }));
const cropTest = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('crop-test');

function exampleCrop(startUs: number, endUs: number, revision = 1): SuggestedCrop {
  const w = 9 / 16 / (16 / 9);
  const mid = startUs + Math.floor((endUs - startUs) / 2);
  const panEnd = startUs + Math.floor(((endUs - startUs) * 2) / 5);
  const secondX = revision > 1 ? (1 - w) * 0.75 : 1 - w;
  return {
    schemaVersion: 1, revision, status: 'suggestion',
    segments: [
      { startUs, endUs: mid, reason: 'start', keyframes: [{ timeUs: startUs, x: 0, y: 0, width: w, height: 1, confidence: 0.95 }, { timeUs: panEnd, x: (1 - w) * 0.5, y: 0, width: w, height: 1, confidence: 0.95 }] },
      { startUs: mid, endUs, reason: 'scene', keyframes: [{ timeUs: mid, x: secondX, y: 0, width: w, height: 1, confidence: 0.9 }] },
    ],
  };
}
const cropView = (crop: CropDoc) => { const resolved = resolveCrop(crop.suggested, crop.edits); return { suggested: crop.suggested, edits: crop.edits, resolved, hasCrop: resolved.length > 0 }; };

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
  schemaVersion: 2,
  request: { ...c.request, ...ids(r) },
  ...r,
  revision: c.revision,
  undoCount: c.undo.length,
  redoCount: c.redo.length,
  silences: silencesView(r, s),
  crop: cropView(c.crop),
});

export function editorEditsMock(name: string, a: Record<string, unknown>): unknown {
  if (name === 'editor.flush') return null;
  if (name === 'editor.open') {
    const request = a as ExportRequest;
    const key = request.candidate_id ? `candidate:${request.candidate_id}` : `${request.source_id}:${request.start_id}:${request.end_id}`;
    let c = clips.get(key);
    if (!c) {
      const startUs = (request.start_id - 1) * 10_000_000, endUs = request.end_id * 10_000_000;
      c = { id: clips.size + 1, request, range: { startUs, endUs }, silences: null, undo: [], redo: [], revision: 0, crop: { suggested: cropTest() ? exampleCrop(startUs, endUs) : null, edits: [] } };
      clips.set(key, c);
    }
    return { ...answer(c), windowStartUs: Math.max(0, c.range.startUs - 120_000_000), windowEndUs: c.range.endUs + 120_000_000, fps: 24 };
  }
  if (name === 'reframe.start') {
    const source = Number(a.source ?? 1);
    const startUs = Number(a.startUs ?? 0);
    const endUs = Number(a.endUs ?? 0);
    const force = Boolean(a.force);
    let existing = [...reframeJobs.values()].find(j => j.source === source && j.startUs === startUs && j.endUs === endUs);
    if (!existing) {
      const id = nextReframeId++;
      existing = { id, job: 6000 + id, source, startUs, endUs, polls: 0, revision: force ? 2 : 1, timeline: null };
      reframeJobs.set(id, existing);
    } else if (force) {
      existing.polls = 0;
      existing.revision += 1;
      existing.timeline = null;
    }
    return { id: existing.id, job: existing.job, source: existing.source, startUs: existing.startUs, endUs: existing.endUs, timeline: existing.timeline, error: null, state: existing.timeline ? 'completed' : 'queued', progress: existing.timeline ? 100 : 0 };
  }
  if (name === 'reframe.status') {
    const item = reframeJobs.get(Number(a.id));
    if (!item) return fail('reframe_not_found');
    item.polls += 1;
    if (!item.timeline && item.polls >= 1) {
      item.timeline = exampleCrop(item.startUs, item.endUs, item.revision);
    }
    return { id: item.id, job: item.job, source: item.source, startUs: item.startUs, endUs: item.endUs, timeline: item.timeline, error: null, state: item.timeline ? 'completed' : 'running', progress: item.timeline ? 100 : 50 };
  }
  if (name.startsWith('editor.crop.')) {
    const c = [...clips.values()].find(item => item.id === a.clip_id);
    if (!c) return fail('invalid_clip');
    const cropReply = (crop = c.crop) => ({ clipId: c.id, schemaVersion: 2, revision: c.revision, undoCount: c.undo.length, redoCount: c.redo.length, ...cropView(crop) });
    if (name === 'editor.crop.get') return cropReply();
    if (name === 'editor.crop.evaluate') return { clipId: c.id, timeUs: Number(a.time_us), rect: interpolateCrop(resolveCrop(c.crop.suggested, c.crop.edits), Number(a.time_us)) };
    if (name === 'editor.crop.set_suggested') {
      const reframeId = typeof a.reframe_id === 'number' ? a.reframe_id : null;
      const nextSuggested = reframeId !== null ? (reframeJobs.get(reframeId)?.timeline ?? fail('invalid_crop')) : ((a.suggested as SuggestedCrop | null) ?? null);
      c.crop.suggested = nextSuggested; c.revision++;
      return cropReply();
    }
    if (name === 'editor.crop.set_edits') {
      const nextEdits = cloneEdits((a.edits as CropKeyframe[]) ?? []);
      if (a.preview) return cropReply({ suggested: c.crop.suggested, edits: nextEdits });
      if (JSON.stringify(c.crop.edits) !== JSON.stringify(nextEdits)) {
        c.undo.push({ range: c.range, silences: cloneSilences(c.silences), cropEdits: cloneEdits(c.crop.edits) });
        if (c.undo.length > 100) c.undo.shift();
        c.redo = [];
        c.crop.edits = nextEdits;
        c.revision++;
      }
      return cropReply();
    }
    if (name === 'editor.crop.example') { c.crop.suggested = exampleCrop(c.range.startUs, c.range.endUs); c.revision++; return cropReply(); }
  }
  if (!['editor.adjust', 'editor.undo', 'editor.redo', 'editor.silences.detect', 'editor.silences.toggle', 'editor.silences.revert_all', 'editor.silences.apply_all'].includes(name)) return undefined;
  const c = [...clips.values()].find(c => c.id === a.clip_id);
  if (!c) return fail('invalid_clip');
  const pushUndo = () => {
    c.undo.push({ range: c.range, silences: cloneSilences(c.silences), cropEdits: cloneEdits(c.crop.edits) });
    if (c.undo.length > 100) c.undo.shift();
    c.redo = [];
  };
  if (name === 'editor.undo' || name === 'editor.redo') {
    const from = name === 'editor.undo' ? c.undo : c.redo, to = name === 'editor.undo' ? c.redo : c.undo;
    const next = from.pop();
    if (next) { to.push({ range: c.range, silences: cloneSilences(c.silences), cropEdits: cloneEdits(c.crop.edits) }); c.range = next.range; c.silences = next.silences; c.crop.edits = cloneEdits(next.cropEdits); c.revision++; }
    return answer(c);
  }
  if (name === 'editor.silences.detect') {
    const thresholdUs = typeof a.threshold_us === 'number' ? a.threshold_us : (c.silences?.thresholdUs ?? 600_000);
    const next = detectMockSilences(c.range, thresholdUs);
    if (a.preview) return answer(c, c.range, next);
    pushUndo();
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
      pushUndo();
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
        pushUndo();
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
    pushUndo(); c.range = next; c.silences = clipped; c.revision++;
  }
  return answer(c);
}
