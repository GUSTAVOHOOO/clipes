// Só o harness de navegador usa este módulo; o desktop sempre chama o núcleo.
type Mock = { job: number; state: string; progress: number; started: number; error: { code: string } | null; encoder: string | null; encoderFallback: { from: string; reason: string } | null };
type BatchItemMock = {
  position: number; sourceId: number; candidateId: number; clipId: number | null; jobId: number | null;
  title: string; filename: string; durationUs: number;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number; error: { code: string; message?: string } | null;
};
type BatchMock = {
  id: number; scope: 'source' | 'project'; sourceId: number | null; outputDir: string;
  state: 'running' | 'completed' | 'cancelled'; started: number; items: BatchItemMock[];
};
let serial = 5900;
let batchSerial = 6400;
const jobs = new Map<number, Mock>();
const batches = new Map<number, BatchMock>();
// Encoder do #62: o mock imita o cache do núcleo (lista que passou no teste e troca manual).
const encoder = { detected: false, passed: ['h264_nvenc', 'libx264'], manual: null as string | null };
const encoderView = () => ({ ffmpeg: true, detected: encoder.detected, stale: false, passed: encoder.detected ? encoder.passed : [], selected: 'h264_nvenc', manual: encoder.manual, effective: encoder.detected ? encoder.manual ?? 'h264_nvenc' : 'libx264' });
function batchView(b: BatchMock) {
  if (b.state === 'running') {
    const elapsed = Date.now() - b.started;
    const failSecond = new URLSearchParams(location.search).has('export-batch-fail');
    if (elapsed > 600) {
      b.items[0].state = 'completed';
      b.items[0].progress = 100;
      if (b.items[1]) {
        if (failSecond) {
          b.items[1].state = 'failed';
          b.items[1].progress = 0;
          b.items[1].error = { code: 'export_failed' };
        } else {
          b.items[1].state = 'running';
          b.items[1].progress = 50;
        }
      }
    }
    if (elapsed > 1400) {
      for (const item of b.items) {
        if (item.state === 'queued' || item.state === 'running') {
          item.state = 'completed';
          item.progress = 100;
        }
      }
      b.state = 'completed';
    }
  }
  const counts = {
    total: b.items.length,
    queued: b.items.filter(i => i.state === 'queued').length,
    running: b.items.filter(i => i.state === 'running').length,
    completed: b.items.filter(i => i.state === 'completed').length,
    failed: b.items.filter(i => i.state === 'failed').length,
    cancelled: b.items.filter(i => i.state === 'cancelled').length,
  };
  const totalWeight = b.items.reduce((acc, i) => acc + i.durationUs, 0) || 1;
  const doneWeight = b.items.reduce((acc, i) => {
    const pct = i.state === 'completed' || i.state === 'failed' ? 100 : i.state === 'running' ? i.progress : 0;
    return acc + i.durationUs * pct;
  }, 0);
  const progress = Math.min(100, Math.floor(doneWeight / totalWeight));
  const status = b.state === 'cancelled'
    ? 'cancelled'
    : counts.queued > 0 || counts.running > 0
      ? 'running'
      : counts.completed === counts.total
        ? 'completed'
        : counts.completed > 0
          ? 'partial'
          : 'failed';
  return { id: b.id, scope: b.scope, sourceId: b.sourceId, outputDir: b.outputDir, state: b.state, status, progress, counts, items: b.items };
}

export function exportMock(
  name: string,
  args: object,
  corrected?: (sourceId: number, position: number) => boolean,
): unknown {
  const a = args as { job?: number; id?: number; output?: string; start_id?: number; end_id?: number; source_id?: number; output_dir?: string; confirmed?: boolean };
  if (name === 'export.encoder.status') return encoderView();
  if (name === 'export.encoder.detect') { encoder.detected = true; return encoderView(); }
  if (name === 'export.encoder.set') { encoder.manual = (args as { encoder: string | null }).encoder; return encoderView(); }
  if (name === 'export.settings') return { last_directory: '/test/exports' };
  if (name === 'export.batch.start') {
    const params = new URLSearchParams(location.search);
    if (params.has('export-batch-empty')) throw { code: 'export_batch_empty' };
    if (params.has('export-batch-conflict') && !a.confirmed) throw { code: 'confirmation_required', usage: { conflicts: ['changed-01-01m30s.mp4', 'changed-02-06m30s.mp4'] } };
    const id = ++batchSerial;
    const scope = typeof a.source_id === 'number' ? 'source' : 'project';
    const items: BatchItemMock[] = [
      { position: 0, sourceId: a.source_id ?? 1, candidateId: 1, clipId: null, jobId: ++serial, title: 'A virada do jogo', filename: 'changed-01-01m30s.mp4', durationUs: 2_000_000, state: 'running', progress: 40, error: null },
      { position: 1, sourceId: a.source_id ?? 1, candidateId: 2, clipId: null, jobId: ++serial, title: 'Segundo corte', filename: 'changed-02-06m30s.mp4', durationUs: 6_000_000, state: 'queued', progress: 0, error: null },
    ];
    const batch: BatchMock = { id, scope, sourceId: a.source_id ?? null, outputDir: a.output_dir ?? '/test/exports', state: 'running', started: Date.now(), items };
    batches.set(id, batch);
    return batchView(batch);
  }
  if (name === 'export.batch.status') {
    const b = batches.get(a.id ?? -1);
    if (!b) throw { code: 'batch_not_found' };
    return batchView(b);
  }
  if (name === 'export.batch.list') {
    const all = [...batches.values()].reverse();
    const filtered = typeof a.source_id === 'number' ? all.filter(b => b.scope === 'source' && b.sourceId === a.source_id) : all;
    return filtered.map(batchView);
  }
  if (name === 'export.batch.cancel') {
    const b = batches.get(a.id ?? -1);
    if (!b) throw { code: 'batch_not_found' };
    b.state = 'cancelled';
    for (const item of b.items) {
      if (item.state === 'queued' || item.state === 'running') {
        item.state = 'cancelled';
        item.progress = 0;
      }
    }
    return batchView(b);
  }
  if (name === 'export.start') {
    if (!a.start_id || !a.end_id) throw { code: 'export_bounds' };
    if (new URLSearchParams(location.search).has('export-exists')) throw { code: 'export_exists' };
    if (new URLSearchParams(location.search).has('export-glyph-missing') && !corrected?.(a.source_id ?? 1, 10)) {
      throw {
        code: 'export_glyph_missing',
        message: 'A fonte da legenda (Noto Sans) não tem glifo para “来” (U+6765, Frase 1) em “来”. Corrija a palavra na Transcrição.',
        usage: {
          font: 'Noto Sans',
          missing_glyphs: [{ position: 10, sentence_id: 1, word: '来', char: '来', codepoint: 'U+6765', start_us: 90_000_000 }],
        },
      };
    }
    const job = ++serial;
    jobs.set(job, { job, state: 'running', progress: 35, started: Date.now(), error: null, encoder: null, encoderFallback: null });
    return { job, state: 'queued' };
  }
  const item = jobs.get(a.job ?? a.id ?? -1);
  if (!item) throw { code: 'invalid_job' };
  if (name === 'jobs.cancel') item.state = 'cancelled';
  if (item.state === 'running' && Date.now() - item.started > 1500) { item.state = 'completed'; item.progress = 100; item.encoder = 'h264_nvenc'; }
  if (item.state === 'completed' && new URLSearchParams(location.search).has('export-fallback')) return { ...item, encoder: 'libx264', encoderFallback: { from: 'h264_nvenc', reason: 'encoder_failed' } };
  return item;
}
