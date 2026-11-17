// Fixture determinística do contrato #70/#77/#66/#71/#78/#204, só usada com VITE_CORE_MOCK + editor-test.
import type { ExportRequest } from './core';
import { sourceToSplicedUs, splicedToSourceUs, type KeptSegment, type MontageBlock, type MontageState, type MontageWarning, type SilenceInterval, type SilencesState } from '@/features/editor/timelineMath';
import {
  defaultPanelRect,
  interpolateCrop,
  panelHeights,
  resolveCrop,
  resolveCropPlan,
  splitBounds,
  type CropKeyframe,
  type CropLayout,
  type DualCropPanels,
  type SuggestedCrop,
} from '@/features/editor/cropMath';

type Range = { startUs: number; endUs: number };
type MockSilences = { thresholdUs: number; intervals: SilenceInterval[] };
type CropDoc = {
  layout: CropLayout | null;
  splitRatio: number | null;
  suggested: SuggestedCrop | null;
  edits: CropKeyframe[];
  gameplayWebcam: DualCropPanels | null;
  twoPeople: DualCropPanels | null;
};
type Snapshot = {
  range: Range;
  silences: MockSilences | null;
  cropLayout: CropLayout | null;
  cropSplitRatio: number | null;
  cropEdits: CropKeyframe[];
  gameplayWebcamEdits: [CropKeyframe[], CropKeyframe[]] | null;
  twoPeopleEdits: [CropKeyframe[], CropKeyframe[]] | null;
  narrationStarts: Record<number, number>;
};
type Clip = { id: number; request: ExportRequest; range: Range; silences: MockSilences | null; undo: Snapshot[]; redo: Snapshot[]; revision: number; crop: CropDoc; narrationStarts: Record<number, number> };
type ReframeJob = {
  id: number;
  job: number;
  source: number;
  startUs: number;
  endUs: number;
  layout: 'face' | 'gameplay_webcam' | 'two_people';
  splitRatio: number | null;
  polls: number;
  revision: number;
  timeline: SuggestedCrop | null;
  secondaryTimeline: SuggestedCrop | null;
};

const clips = new Map<string, Clip>();
const reframeJobs = new Map<number, ReframeJob>();
let nextReframeId = 1;
const fail = (code: string) => { throw { code }; };
const ids = (r: Range) => ({ start_id: Math.floor(r.startUs / 10_000_000) + 1, end_id: Math.ceil(r.endUs / 10_000_000) });
const cloneSilences = (s: MockSilences | null): MockSilences | null => s ? { thresholdUs: s.thresholdUs, intervals: s.intervals.map(i => ({ ...i })) } : null;
const cloneEdits = (edits: CropKeyframe[]): CropKeyframe[] => edits.map(k => ({ ...k }));
const cloneStarts = (starts: Record<number, number>): Record<number, number> => ({ ...starts });
const cloneDual = (d: DualCropPanels | null): DualCropPanels | null => d ? { top: { suggested: d.top.suggested, edits: cloneEdits(d.top.edits) }, bottom: { suggested: d.bottom.suggested, edits: cloneEdits(d.bottom.edits) } } : null;
const cropTest = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('crop-test');
const montageTest = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('montage-test');

const MOCK_BLOCK_GAP_US = 300_000;
const MOCK_LONG_FREEZE_US = 5_000_000;
const MOCK_SCRIPT_BLOCKS = [
  { blockId: 101, position: 1, title: 'Gancho', refs: [361], durationUs: 12_000_000 },
  { blockId: 102, position: 2, title: 'Contexto', refs: [362], durationUs: 10_000_000 },
  { blockId: 103, position: 3, title: 'Fecho', refs: [], durationUs: 15_000_000 },
];

function resolveMockMontage(r: Range, s: MockSilences | null, starts: Record<number, number>): MontageState | null {
  if (!montageTest()) return null;
  const splice = buildMockSplice(r, s);
  const blocks: MontageBlock[] = [];
  const warnings: MontageWarning[] = [];
  let prevEnd: number | null = null;
  for (const b of MOCK_SCRIPT_BLOCKS) {
    const minStart = prevEnd === null ? 0 : prevEnd + MOCK_BLOCK_GAP_US;
    const anchorId = b.refs.find(id => (id - 1) * 10_000_000 < r.endUs && id * 10_000_000 > r.startUs) ?? null;
    const autoStart = anchorId !== null
      ? sourceToSplicedUs(Math.max(r.startUs, (anchorId - 1) * 10_000_000), splice.segments, r.startUs)
      : minStart;
    const manual = starts[b.blockId];
    const mode = manual !== undefined ? 'manual' : 'automatic';
    const desiredStart = manual !== undefined
      ? sourceToSplicedUs(Math.min(r.endUs, Math.max(r.startUs, manual)), splice.segments, r.startUs)
      : autoStart;
    const startUs = Math.max(desiredStart, minStart);
    const pushedUs = startUs - desiredStart;
    if (pushedUs > 0) warnings.push({ code: 'block_pushed', message: 'Bloco empurrado.', blockId: b.blockId, amountUs: pushedUs });
    const endUs = startUs + b.durationUs;
    const overflowUs = Math.max(0, endUs - splice.effectiveDurationUs);
    const sourceStartUs = startUs <= splice.effectiveDurationUs
      ? splicedToSourceUs(startUs, splice.segments, r.startUs, r.endUs)
      : r.endUs;
    prevEnd = endUs;
    blocks.push({
      blockId: b.blockId,
      position: b.position,
      title: b.title,
      mode,
      anchorSentenceId: anchorId,
      manualSourceStartUs: manual ?? null,
      autoStartUs: autoStart,
      desiredStartUs: desiredStart,
      startUs,
      endUs,
      durationUs: b.durationUs,
      estimated: true,
      pushedUs,
      overflowUs,
      sourceStartUs,
    });
  }
  const narrationEndUs = prevEnd ?? 0;
  const freezeTailUs = Math.max(0, narrationEndUs - splice.effectiveDurationUs);
  if (freezeTailUs > MOCK_LONG_FREEZE_US) warnings.push({ code: 'long_freeze_tail', message: 'Sobra > 5 s.', amountUs: freezeTailUs });
  else if (freezeTailUs > 0) warnings.push({ code: 'freeze_tail', message: 'Último quadro congelado.', amountUs: freezeTailUs });
  return {
    schemaVersion: 1,
    blocks,
    clipDurationUs: splice.effectiveDurationUs,
    narrationEndUs,
    freezeTailUs,
    totalDurationUs: splice.effectiveDurationUs + freezeTailUs,
    totalPushedUs: blocks.reduce((acc, item) => acc + item.pushedUs, 0),
    usesEstimatedDurations: true,
    scriptApproved: true,
    warnings,
  };
}

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

function exampleDualCrop(
  layout: 'gameplay_webcam' | 'two_people',
  startUs: number,
  endUs: number,
  splitRatio: number | null,
  revision = 1,
): { primary: SuggestedCrop; secondary: SuggestedCrop } {
  const [topH, botH] = panelHeights(layout, splitRatio);
  const topRect = layout === 'gameplay_webcam'
    ? defaultPanelRect(16 / 9, 1080 / topH, 3.2, revision > 1 ? 0.82 : 0.16, 0.22)
    : defaultPanelRect(16 / 9, 1080 / topH, 1.0, 0.22, 0.5);
  const botRect = layout === 'gameplay_webcam'
    ? defaultPanelRect(16 / 9, 1080 / botH, 1.0, 0.56, 0.5)
    : defaultPanelRect(16 / 9, 1080 / botH, 1.0, 0.78, 0.5);
  const conf = layout === 'gameplay_webcam' ? 0.48 : 0.91;
  return {
    primary: {
      schemaVersion: 1, revision, status: 'suggestion',
      segments: [{ startUs, endUs, reason: 'start', keyframes: [{ timeUs: startUs, ...topRect, confidence: conf }] }],
    },
    secondary: {
      schemaVersion: 1, revision, status: 'suggestion',
      segments: [{ startUs, endUs, reason: 'start', keyframes: [{ timeUs: startUs, ...botRect, confidence: conf }] }],
    },
  };
}

function cropView(crop: CropDoc, range: Range) {
  const resolved = resolveCrop(crop.suggested, crop.edits);
  const plan = resolveCropPlan(
    {
      explicitLayout: crop.layout,
      splitRatio: crop.splitRatio ?? undefined,
      suggested: crop.suggested,
      edits: crop.edits,
      gameplayWebcam: crop.gameplayWebcam,
      twoPeople: crop.twoPeople,
    },
    16 / 9,
    range.startUs,
    range.endUs,
  );
  const hasCrop = crop.layout !== null || crop.suggested !== null || crop.edits.length > 0 || crop.gameplayWebcam !== null || crop.twoPeople !== null;
  return {
    layout: plan.layout,
    explicitLayout: crop.layout,
    splitRatio: plan.splitRatio,
    suggested: crop.suggested,
    edits: crop.edits,
    gameplayWebcam: crop.gameplayWebcam,
    twoPeople: crop.twoPeople,
    resolved,
    hasCrop,
    plan,
  };
}

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

const snapshotOf = (c: Clip): Snapshot => ({
  range: c.range,
  silences: cloneSilences(c.silences),
  cropLayout: c.crop.layout,
  cropSplitRatio: c.crop.splitRatio,
  cropEdits: cloneEdits(c.crop.edits),
  gameplayWebcamEdits: c.crop.gameplayWebcam ? [cloneEdits(c.crop.gameplayWebcam.top.edits), cloneEdits(c.crop.gameplayWebcam.bottom.edits)] : null,
  twoPeopleEdits: c.crop.twoPeople ? [cloneEdits(c.crop.twoPeople.top.edits), cloneEdits(c.crop.twoPeople.bottom.edits)] : null,
  narrationStarts: cloneStarts(c.narrationStarts),
});

const answer = (c: Clip, r = c.range, s = c.silences, crop = c.crop, ns = c.narrationStarts) => ({
  clipId: c.id,
  schemaVersion: 2,
  request: { ...c.request, ...ids(r) },
  ...r,
  revision: c.revision,
  undoCount: c.undo.length,
  redoCount: c.redo.length,
  silences: silencesView(r, s),
  crop: cropView(crop, r),
  montage: resolveMockMontage(r, s, ns),
});

export function editorEditsMock(name: string, a: Record<string, unknown>): unknown {
  if (name === 'editor.flush') return null;
  if (name === 'editor.open') {
    const request = a as ExportRequest;
    const key = request.candidate_id ? `candidate:${request.candidate_id}` : `${request.source_id}:${request.start_id}:${request.end_id}`;
    let c = clips.get(key);
    if (!c) {
      const startUs = (request.start_id - 1) * 10_000_000, endUs = request.end_id * 10_000_000;
      c = {
        id: clips.size + 1,
        request,
        range: { startUs, endUs },
        silences: null,
        undo: [],
        redo: [],
        revision: 0,
        crop: {
          layout: null,
          splitRatio: null,
          suggested: cropTest() ? exampleCrop(startUs, endUs) : null,
          edits: [],
          gameplayWebcam: null,
          twoPeople: null,
        },
        narrationStarts: {},
      };
      clips.set(key, c);
    }
    return { ...answer(c), windowStartUs: Math.max(0, c.range.startUs - 120_000_000), windowEndUs: c.range.endUs + 120_000_000, fps: 24, sourceAspect: 16 / 9 };
  }
  if (name === 'reframe.start') {
    const source = Number(a.source ?? 1);
    const startUs = Number(a.startUs ?? 0);
    const endUs = Number(a.endUs ?? 0);
    const layout = (a.layout as 'face' | 'gameplay_webcam' | 'two_people') ?? 'face';
    const splitRatio = typeof a.splitRatio === 'number' ? a.splitRatio : null;
    const force = Boolean(a.force);
    let existing = [...reframeJobs.values()].find(j => j.source === source && j.startUs === startUs && j.endUs === endUs);
    if (!existing) {
      const id = nextReframeId++;
      existing = { id, job: 6000 + id, source, startUs, endUs, layout, splitRatio, polls: 0, revision: force ? 2 : 1, timeline: null, secondaryTimeline: null };
      reframeJobs.set(id, existing);
    } else if (force || existing.layout !== layout || existing.splitRatio !== splitRatio) {
      existing.polls = 0;
      existing.layout = layout;
      existing.splitRatio = splitRatio;
      existing.revision += 1;
      existing.timeline = null;
      existing.secondaryTimeline = null;
    }
    return {
      id: existing.id, job: existing.job, source: existing.source, startUs: existing.startUs, endUs: existing.endUs,
      layout: existing.layout, splitRatio: existing.splitRatio, timeline: existing.timeline, secondaryTimeline: existing.secondaryTimeline,
      error: null, state: existing.timeline ? 'completed' : 'queued', progress: existing.timeline ? 100 : 0,
    };
  }
  if (name === 'reframe.status') {
    const item = reframeJobs.get(Number(a.id));
    if (!item) return fail('reframe_not_found');
    item.polls += 1;
    if (!item.timeline && item.polls >= 1) {
      if (item.layout === 'gameplay_webcam' || item.layout === 'two_people') {
        const dual = exampleDualCrop(item.layout, item.startUs, item.endUs, item.splitRatio, item.revision);
        item.timeline = dual.primary;
        item.secondaryTimeline = dual.secondary;
      } else {
        item.timeline = exampleCrop(item.startUs, item.endUs, item.revision);
        item.secondaryTimeline = null;
      }
    }
    return {
      id: item.id, job: item.job, source: item.source, startUs: item.startUs, endUs: item.endUs,
      layout: item.layout, splitRatio: item.splitRatio, timeline: item.timeline, secondaryTimeline: item.secondaryTimeline,
      error: null, state: item.timeline ? 'completed' : 'running', progress: item.timeline ? 100 : 50,
    };
  }
  if (name.startsWith('editor.crop.')) {
    const c = [...clips.values()].find(item => item.id === a.clip_id);
    if (!c) return fail('invalid_clip');
    const cropReply = (crop = c.crop) => ({ clipId: c.id, schemaVersion: 2, revision: c.revision, undoCount: c.undo.length, redoCount: c.redo.length, ...cropView(crop, c.range) });
    if (name === 'editor.crop.get') return cropReply();
    if (name === 'editor.crop.evaluate') {
      const plan = resolveCropPlan({ explicitLayout: c.crop.layout, splitRatio: c.crop.splitRatio ?? undefined, suggested: c.crop.suggested, edits: c.crop.edits, gameplayWebcam: c.crop.gameplayWebcam, twoPeople: c.crop.twoPeople }, 16 / 9, c.range.startUs, c.range.endUs);
      const panels = plan.panels.map(p => ({ targetWidth: p.targetWidth, targetHeight: p.targetHeight, fitMode: p.fitMode, rect: interpolateCrop(p.segments, Number(a.time_us)) }));
      return { clipId: c.id, timeUs: Number(a.time_us), rect: panels[0]?.rect ?? null, panels };
    }
    if (name === 'editor.crop.set_layout') {
      const layout = a.layout as CropLayout;
      const bounds = splitBounds(layout);
      const rawRatio = typeof a.split_ratio === 'number' ? a.split_ratio : null;
      const nextRatio = bounds ? (rawRatio !== null ? Math.min(bounds[2], Math.max(bounds[1], rawRatio)) : (c.crop.layout === layout && c.crop.splitRatio !== null ? c.crop.splitRatio : bounds[0])) : null;
      if (a.preview) {
        return cropReply({ ...c.crop, layout, splitRatio: nextRatio });
      }
      if (c.crop.layout !== layout || c.crop.splitRatio !== nextRatio) {
        c.undo.push(snapshotOf(c));
        if (c.undo.length > 100) c.undo.shift();
        c.redo = [];
        c.crop.layout = layout;
        c.crop.splitRatio = nextRatio;
        c.revision++;
      }
      return cropReply();
    }
    if (name === 'editor.crop.set_suggested') {
      const reframeId = typeof a.reframe_id === 'number' ? a.reframe_id : null;
      if (reframeId !== null) {
        const job = reframeJobs.get(reframeId);
        if (!job?.timeline) return fail('invalid_crop');
        if (job.layout === 'gameplay_webcam' || job.layout === 'two_people') {
          c.crop.layout = job.layout;
          if (job.splitRatio !== null) c.crop.splitRatio = job.splitRatio;
          const slotKey = job.layout === 'gameplay_webcam' ? 'gameplayWebcam' : 'twoPeople';
          const cur = c.crop[slotKey] ?? { top: { suggested: null, edits: [] }, bottom: { suggested: null, edits: [] } };
          c.crop[slotKey] = { top: { ...cur.top, suggested: job.timeline }, bottom: { ...cur.bottom, suggested: job.secondaryTimeline } };
        } else {
          c.crop.suggested = job.timeline;
        }
        c.revision++;
        return cropReply();
      }
      c.crop.suggested = (a.suggested as SuggestedCrop | null) ?? null; c.revision++;
      return cropReply();
    }
    if (name === 'editor.crop.set_edits') {
      const nextEdits = cloneEdits((a.edits as CropKeyframe[]) ?? []);
      const panel = (a.panel as 'primary' | 'top' | 'bottom') ?? 'primary';
      if (panel === 'primary') {
        if (a.preview) return cropReply({ ...c.crop, edits: nextEdits });
        if (JSON.stringify(c.crop.edits) !== JSON.stringify(nextEdits)) {
          c.undo.push(snapshotOf(c));
          if (c.undo.length > 100) c.undo.shift();
          c.redo = [];
          c.crop.edits = nextEdits;
          c.revision++;
        }
        return cropReply();
      }
      const targetLayout = (a.layout as CropLayout) ?? c.crop.layout;
      if (targetLayout !== 'gameplay_webcam' && targetLayout !== 'two_people') return fail('invalid_crop');
      const slotKey = targetLayout === 'gameplay_webcam' ? 'gameplayWebcam' : 'twoPeople';
      const curDual = c.crop[slotKey] ?? { top: { suggested: null, edits: [] }, bottom: { suggested: null, edits: [] } };
      const nextDual: DualCropPanels = {
        top: panel === 'top' ? { ...curDual.top, edits: nextEdits } : curDual.top,
        bottom: panel === 'bottom' ? { ...curDual.bottom, edits: nextEdits } : curDual.bottom,
      };
      if (a.preview) {
        return cropReply({ ...c.crop, layout: targetLayout, [slotKey]: nextDual });
      }
      if (JSON.stringify(curDual[panel].edits) !== JSON.stringify(nextEdits) || c.crop.layout !== targetLayout) {
        c.undo.push(snapshotOf(c));
        if (c.undo.length > 100) c.undo.shift();
        c.redo = [];
        c.crop.layout = targetLayout;
        c.crop[slotKey] = nextDual;
        c.revision++;
      }
      return cropReply();
    }
    if (name === 'editor.crop.example') { c.crop.suggested = exampleCrop(c.range.startUs, c.range.endUs); c.revision++; return cropReply(); }
  }
  if (name === 'editor.montage.get' || name === 'editor.montage.set_start') {
    const c = [...clips.values()].find(item => item.id === a.clip_id);
    if (!c) return fail('invalid_clip');
    if (name === 'editor.montage.get') {
      return { clipId: c.id, schemaVersion: 2, revision: c.revision, undoCount: c.undo.length, redoCount: c.redo.length, montage: resolveMockMontage(c.range, c.silences, c.narrationStarts) };
    }
    const currentMontage = resolveMockMontage(c.range, c.silences, c.narrationStarts);
    const blockId = Number(a.block_id);
    const idx = currentMontage?.blocks.findIndex(b => b.blockId === blockId) ?? -1;
    if (!currentMontage || idx < 0) return fail('block_not_found');
    const nextStarts = cloneStarts(c.narrationStarts);
    if (a.time_us === null || a.time_us === undefined) {
      delete nextStarts[blockId];
    } else {
      const requested = Math.max(c.range.startUs, Math.min(c.range.endUs, Number(a.time_us)));
      const splice = buildMockSplice(c.range, c.silences);
      const minOut = idx === 0 ? 0 : currentMontage.blocks[idx - 1].endUs + MOCK_BLOCK_GAP_US;
      let snapped = a.free
        ? Math.round((Math.round((requested * 24) / 1_000_000) * 1_000_000) / 24)
        : Math.max(c.range.startUs, Math.min(c.range.endUs, Math.floor((requested + 4_999_999) / 10_000_000) * 10_000_000));
      if (sourceToSplicedUs(snapped, splice.segments, c.range.startUs) < minOut) {
        snapped = Math.min(c.range.endUs, splicedToSourceUs(minOut, splice.segments, c.range.startUs, c.range.endUs));
      }
      nextStarts[blockId] = snapped;
    }
    if (a.preview) return answer(c, c.range, c.silences, c.crop, nextStarts);
    if (JSON.stringify(nextStarts) !== JSON.stringify(c.narrationStarts)) {
      c.undo.push(snapshotOf(c));
      if (c.undo.length > 100) c.undo.shift();
      c.redo = [];
      c.narrationStarts = nextStarts;
      c.revision++;
    }
    return answer(c);
  }
  if (!['editor.adjust', 'editor.undo', 'editor.redo', 'editor.silences.detect', 'editor.silences.toggle', 'editor.silences.revert_all', 'editor.silences.apply_all'].includes(name)) return undefined;
  const c = [...clips.values()].find(c => c.id === a.clip_id);
  if (!c) return fail('invalid_clip');
  const pushUndo = () => {
    c.undo.push(snapshotOf(c));
    if (c.undo.length > 100) c.undo.shift();
    c.redo = [];
  };
  if (name === 'editor.undo' || name === 'editor.redo') {
    const from = name === 'editor.undo' ? c.undo : c.redo, to = name === 'editor.undo' ? c.redo : c.undo;
    const next = from.pop();
    if (next) {
      to.push(snapshotOf(c));
      c.range = next.range;
      c.silences = next.silences;
      c.crop.layout = next.cropLayout;
      c.crop.splitRatio = next.cropSplitRatio;
      c.crop.edits = cloneEdits(next.cropEdits);
      const applyDual = (cur: DualCropPanels | null, edits: [CropKeyframe[], CropKeyframe[]] | null): DualCropPanels | null => {
        if (!edits && !cur) return null;
        const base = cur ?? { top: { suggested: null, edits: [] }, bottom: { suggested: null, edits: [] } };
        return { top: { ...base.top, edits: cloneEdits(edits?.[0] ?? []) }, bottom: { ...base.bottom, edits: cloneEdits(edits?.[1] ?? []) } };
      };
      c.crop.gameplayWebcam = applyDual(c.crop.gameplayWebcam, next.gameplayWebcamEdits);
      c.crop.twoPeople = applyDual(c.crop.twoPeople, next.twoPeopleEdits);
      c.narrationStarts = cloneStarts(next.narrationStarts);
      c.revision++;
    }
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
