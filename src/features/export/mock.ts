// Só o harness de navegador usa este módulo; o desktop sempre chama o núcleo.
type Mock = {
  job: number;
  state: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  progress: number;
  output: string;
  started: number;
  error: { code: string; message?: string } | null;
  encoder: string | null;
  encoderFallback: { from: string; reason: string } | null;
  timer?: ReturnType<typeof setTimeout> | null;
};
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

type ExportMockHooks = {
  emitProgress?: (evento: {
    job: string;
    project?: string | null;
    stage: string;
    percentage: number;
    message: string;
    error: { code: string; message: string } | null;
  }) => void;
  getProjectId?: () => string | null;
};

let hooks: ExportMockHooks = {};

export function configureExportMockHooks(next: ExportMockHooks): void {
  hooks = { ...hooks, ...next };
}

let serial = 5900;
let batchSerial = 6400;
const jobs = new Map<number, Mock>();
const batches = new Map<number, BatchMock>();
// Encoder do #62: o mock imita o cache do núcleo (lista que passou no teste e troca manual).
const encoder = {
  detected: false,
  staleCleared: false,
  passed: ['h264_nvenc', 'libx264'],
  manual: null as string | null,
  gpu: 'NVIDIA GeForce RTX 3050 Laptop GPU',
  detectedAt: null as number | null,
};
function readExportEstado(): string | null {
  if (typeof location === 'undefined') return null;
  const hash = location.hash ?? '';
  const qIdx = hash.indexOf('?');
  if (qIdx >= 0) {
    const v = new URLSearchParams(hash.slice(qIdx + 1)).get('estado');
    if (v) return v;
  }
  return new URLSearchParams(location.search).get('estado');
}
function hasExportFlag(flag: string): boolean {
  if (typeof location === 'undefined') return false;
  if (new URLSearchParams(location.search).has(flag)) return true;
  const hash = location.hash ?? '';
  const qIdx = hash.indexOf('?');
  return qIdx >= 0 && new URLSearchParams(hash.slice(qIdx + 1)).has(flag);
}
function isFallbackActive(): boolean {
  return readExportEstado() === 'fallback' || hasExportFlag('export-fallback');
}
function formatExportStatus(item: Mock) {
  if (item.state === 'running' && hasExportFlag('source-test') && Date.now() - item.started > 1500) {
    item.state = 'completed';
    item.progress = 100;
    item.encoder = isFallbackActive() ? 'libx264' : 'h264_nvenc';
    item.encoderFallback = isFallbackActive() ? { from: 'h264_nvenc', reason: 'encoder_failed' } : null;
  }
  const fallback =
    item.state === 'completed' && isFallbackActive()
      ? (item.encoderFallback ?? { from: 'h264_nvenc', reason: 'encoder_failed' })
      : item.encoderFallback;
  const effectiveEncoder =
    item.state === 'completed' && isFallbackActive() ? 'libx264' : item.encoder;
  return {
    job: item.job,
    state: item.state,
    progress: item.progress,
    output: item.output,
    error: item.error,
    encoder: effectiveEncoder,
    encoderFallback: fallback,
  };
}

const encoderView = () => {
  const estado = readExportEstado();
  const noFfmpeg = estado === 'erro' || hasExportFlag('components-missing') || hasExportFlag('encoder-no-ffmpeg');
  if (noFfmpeg) {
    return {
      ffmpeg: false,
      detected: false,
      stale: false,
      passed: [],
      selected: 'libx264',
      manual: null,
      effective: 'libx264',
      gpu: '',
      detected_at: null,
    };
  }
  const stale = !encoder.staleCleared && (estado === 'parcial' || hasExportFlag('encoder-stale'));
  const detected = stale ? false : encoder.detected;
  const temCache = detected || stale;
  return {
    ffmpeg: true,
    detected,
    stale,
    passed: temCache ? encoder.passed : [],
    selected: temCache ? 'h264_nvenc' : 'libx264',
    manual: encoder.manual,
    effective: temCache ? encoder.manual ?? 'h264_nvenc' : 'libx264',
    gpu: temCache ? encoder.gpu : '',
    detected_at: stale ? 1794942840 : encoder.detectedAt,
  };
};
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
  if (name === 'export.encoder.detect') {
    if (!encoderView().ffmpeg) {
      throw { code: 'component_missing', message: 'FFmpeg ou FFprobe ausente.' };
    }
    encoder.detected = true;
    encoder.staleCleared = true;
    encoder.detectedAt = Math.floor(Date.now() / 1000);
    return encoderView();
  }
  if (name === 'export.encoder.set') {
    const view = encoderView();
    const choice = (args as { encoder?: string | null }).encoder;
    if ((!view.detected && !view.stale) || (choice !== null && (typeof choice !== 'string' || !view.passed.includes(choice)))) {
      throw { code: 'encoder_invalid', message: 'Escolha um encoder da lista que passou no teste.' };
    }
    encoder.manual = choice;
    return encoderView();
  }
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
    if (hasExportFlag('export-exists')) throw { code: 'export_exists' };
    if (hasExportFlag('export-glyph-missing') && !corrected?.(a.source_id ?? 1, 10)) {
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
    const output = typeof a.output === 'string' && a.output.trim() ? a.output.trim() : '/test/exports/corte.mp4';
    const item: Mock = {
      job,
      state: 'running',
      progress: 35,
      output,
      started: Date.now(),
      error: null,
      encoder: null,
      encoderFallback: null,
      timer: null,
    };
    jobs.set(job, item);
    const project = hooks.getProjectId?.() ?? null;
    hooks.emitProgress?.({
      job: String(job),
      project,
      stage: 'export',
      percentage: 35,
      message: 'Exportando Corte',
      error: null,
    });
    const finishDelay = hasExportFlag('source-test') ? 1500 : 35;
    item.timer = setTimeout(() => {
      item.timer = null;
      if (item.state === 'cancelled') return;
      const fallbackActive = isFallbackActive();
      item.state = 'completed';
      item.progress = 100;
      item.encoder = fallbackActive ? 'libx264' : 'h264_nvenc';
      item.encoderFallback = fallbackActive ? { from: 'h264_nvenc', reason: 'encoder_failed' } : null;
      hooks.emitProgress?.({
        job: String(job),
        project,
        stage: 'complete',
        percentage: 100,
        message: 'Corte exportado.',
        error: null,
      });
    }, finishDelay);
    return { job, state: 'queued' };
  }
  if (name === 'export.status') {
    const item = jobs.get(a.job ?? a.id ?? -1);
    if (!item) throw { code: 'invalid_job', message: 'Tarefa inválida.' };
    return formatExportStatus(item);
  }
  const item = jobs.get(a.job ?? a.id ?? -1);
  if (!item) throw { code: 'invalid_job', message: 'Tarefa inválida.' };
  if (name === 'jobs.cancel') {
    if (item.timer) {
      clearTimeout(item.timer);
      item.timer = null;
    }
    item.state = 'cancelled';
    item.progress = 0;
    hooks.emitProgress?.({
      job: String(item.job),
      project: hooks.getProjectId?.() ?? null,
      stage: 'failed',
      percentage: 0,
      message: 'Exportação cancelada.',
      error: { code: 'cancelled', message: 'Exportação cancelada.' },
    });
  }
  return formatExportStatus(item);
}
