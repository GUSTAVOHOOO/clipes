// Só o harness de navegador usa este módulo; o desktop sempre chama o núcleo.
type ProgressEmitter = (evento: {
  job: string;
  project?: string | null;
  stage: string;
  percentage: number;
  message: string;
  error: { code: string; message: string } | null;
}) => void;

type ExportMockContext = {
  project?: { id: string; path: string } | null;
  emitProgress?: ProgressEmitter;
};

type Mock = {
  job: number;
  state: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  progress: number;
  started: number;
  output: string;
  error: { code: string; message?: string } | null;
  encoder: string | null;
  encoderFallback: { from: string; reason: string } | null;
  timer?: ReturnType<typeof setTimeout> | null;
};
type BatchItemMock = {
  position: number;
  sourceId: number;
  runId: number;
  candidateId: number;
  clipId: number | null;
  jobId: number | null;
  title: string;
  filename: string;
  output: string;
  durationUs: number;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  error: { code: string; message?: string } | null;
  encoder: string | null;
  encoderFallback: { from: string; reason: string } | null;
};

type BatchMock = {
  id: number;
  scope: 'source' | 'project';
  sourceId: number | null;
  outputDir: string;
  state: 'running' | 'completed' | 'cancelled';
  started: number;
  items: BatchItemMock[];
  timers: ReturnType<typeof setTimeout>[];
};

type ExportMockHooks = {
  emitProgress?: ProgressEmitter;
  getProjectId?: () => string | null;
};

let hooks: ExportMockHooks = {};

export function configureExportMockHooks(next: ExportMockHooks): void {
  hooks = { ...hooks, ...next };
}
let serial = 5900;
let batchSerial = 6400;
let v1Seeded = false;
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

function clearBatchTimers(b: BatchMock) {
  for (const t of b.timers) clearTimeout(t);
  b.timers = [];
}

export function resetExportMockState(): void {
  for (const j of jobs.values()) {
    if (j.timer) clearTimeout(j.timer);
  }
  jobs.clear();
  for (const b of batches.values()) {
    clearBatchTimers(b);
  }
  batches.clear();
  v1Seeded = false;
}

function ensureV1DemoBatchSeeded(): void {
  if (v1Seeded || hasExportFlag('source-test')) return;
  v1Seeded = true;
  const id = 6399;
  const v1Batch: BatchMock = {
    id,
    scope: 'project',
    sourceId: null,
    outputDir: '/test/exports',
    state: 'completed',
    started: Date.now() - 60_000,
    timers: [],
    items: [
      {
        position: 0,
        sourceId: 4,
        runId: 1,
        candidateId: 102,
        clipId: null,
        jobId: 5891,
        title: 'Segundo corte',
        filename: 'Live_12_11_final-01-06m30s.mp4',
        output: '/test/exports/Live_12_11_final-01-06m30s.mp4',
        durationUs: 20_000_000,
        state: 'completed',
        progress: 100,
        error: null,
        encoder: 'libx264',
        encoderFallback: { from: 'h264_nvenc', reason: 'encoder_failed' },
      },
      {
        position: 1,
        sourceId: 1,
        runId: 1,
        candidateId: 104,
        clipId: null,
        jobId: 5892,
        title: 'Resumo final do jogo',
        filename: 'changed-02-11m30s.mp4',
        output: '/test/exports/changed-02-11m30s.mp4',
        durationUs: 40_000_000,
        state: 'failed',
        progress: 0,
        error: { code: 'source_changed', message: 'O arquivo da Fonte foi alterado no disco.' },
        encoder: null,
        encoderFallback: null,
      },
      {
        position: 2,
        sourceId: 4,
        runId: 1,
        candidateId: 101,
        clipId: null,
        jobId: 5893,
        title: 'A virada do jogo',
        filename: 'Live_12_11_final-03-01m30s.mp4',
        output: '/test/exports/Live_12_11_final-03-01m30s.mp4',
        durationUs: 50_000_000,
        state: 'completed',
        progress: 100,
        error: null,
        encoder: 'h264_nvenc',
        encoderFallback: null,
      },
    ],
  };
  batches.set(id, v1Batch);
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

function computeWeightedProgress(items: BatchItemMock[]): number {
  const totalWeight = items.reduce((acc, i) => acc + Math.max(1, i.durationUs), 0) || 1;
  const doneWeight = items.reduce((acc, i) => {
    const pct = i.state === 'completed' || i.state === 'failed' ? 100 : i.state === 'running' ? i.progress : 0;
    return acc + Math.max(1, i.durationUs) * pct;
  }, 0);
  return Math.min(100, Math.floor(doneWeight / totalWeight));
}

function batchView(b: BatchMock) {
  const counts = {
    total: b.items.length,
    queued: b.items.filter((i) => i.state === 'queued').length,
    running: b.items.filter((i) => i.state === 'running').length,
    completed: b.items.filter((i) => i.state === 'completed').length,
    failed: b.items.filter((i) => i.state === 'failed').length,
    cancelled: b.items.filter((i) => i.state === 'cancelled').length,
  };
  const progress = computeWeightedProgress(b.items);
  const status =
    b.state === 'cancelled'
      ? 'cancelled'
      : counts.queued > 0 || counts.running > 0
        ? 'running'
        : counts.completed === counts.total
          ? 'completed'
          : counts.completed > 0
            ? 'partial'
            : 'failed';
  return {
    id: b.id,
    scope: b.scope,
    sourceId: b.sourceId,
    outputDir: b.outputDir,
    state: b.state,
    status,
    progress,
    counts,
    items: b.items.map((i) => ({ ...i })),
  };
}

export function exportMock(
  name: string,
  args: object,
  corrected?: (sourceId: number, position: number) => boolean,
  ctx?: ExportMockContext,
): unknown {
  const a = args as {
    job?: number;
    id?: number;
    project?: unknown;
    output?: string;
    start_id?: number;
    end_id?: number;
    source_id?: number;
    output_dir?: string;
    confirmed?: boolean;
  };
  const projectId = ctx?.project?.id ?? null;

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
    if (typeof a.project === 'string') {
      if (ctx && ctx.project === null) {
        throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto no momento.' };
      }
      if (ctx?.project && a.project !== ctx.project.path) {
        throw { code: 'invalid_project', message: 'O Projeto não está aberto.' };
      }
    }
    const estado = readExportEstado();
    if (estado === 'vazio' || hasExportFlag('export-batch-empty')) {
      throw { code: 'export_batch_empty', message: 'Nenhum Corte aprovado para exportar.' };
    }
    if (!encoderView().ffmpeg) {
      throw { code: 'component_missing', message: 'Instale o Componente FFmpeg.' };
    }
    const outputDir = typeof a.output_dir === 'string' && a.output_dir.trim() ? a.output_dir.trim() : '/test/exports';
    const temConflito = hasExportFlag('export-batch-conflict') || outputDir.toLowerCase().includes('conflit');
    if (temConflito && !a.confirmed) {
      throw {
        code: 'confirmation_required',
        message: 'Alguns arquivos já existem na pasta de saída.',
        usage: { conflicts: ['changed-01-01m30s.mp4', 'changed-02-06m30s.mp4'] },
      };
    }

    ensureV1DemoBatchSeeded();
    const id = ++batchSerial;
    const scope = typeof a.source_id === 'number' ? 'source' : 'project';
    const srcId = a.source_id ?? 4;
    const failSecond = hasExportFlag('export-batch-fail') || estado === 'parcial';
    const useFallback = estado === 'fallback' || hasExportFlag('export-fallback');

    const items: BatchItemMock[] = [
      {
        position: 0,
        sourceId: srcId,
        runId: 1,
        candidateId: 101,
        clipId: null,
        jobId: ++serial,
        title: 'A virada do jogo',
        filename: 'changed-01-01m30s.mp4',
        output: `${outputDir}/changed-01-01m30s.mp4`,
        durationUs: 2_000_000,
        state: 'running',
        progress: 40,
        error: null,
        encoder: null,
        encoderFallback: null,
      },
      {
        position: 1,
        sourceId: srcId,
        runId: 1,
        candidateId: 102,
        clipId: null,
        jobId: ++serial,
        title: 'Segundo corte',
        filename: 'changed-02-06m30s.mp4',
        output: `${outputDir}/changed-02-06m30s.mp4`,
        durationUs: 6_000_000,
        state: 'queued',
        progress: 0,
        error: null,
        encoder: null,
        encoderFallback: null,
      },
    ];

    const batch: BatchMock = {
      id,
      scope,
      sourceId: a.source_id ?? null,
      outputDir,
      state: 'running',
      started: Date.now(),
      items,
      timers: [],
    };
    batches.set(id, batch);

    const view0 = batchView(batch);
    ctx?.emitProgress?.({
      job: `export-batch-${id}`,
      project: projectId,
      stage: 'export_batch',
      percentage: view0.progress,
      message: 'Exportando lote de Cortes',
      error: null,
    });
    if (items[0].jobId !== null) {
      ctx?.emitProgress?.({
        job: String(items[0].jobId),
        project: projectId,
        stage: 'export',
        percentage: 40,
        message: 'Exportando Corte 1',
        error: null,
      });
    }

    const t1 = setTimeout(() => {
      if (batch.state !== 'running') return;
      batch.items[0].state = 'completed';
      batch.items[0].progress = 100;
      batch.items[0].encoder = useFallback ? 'libx264' : 'h264_nvenc';
      batch.items[0].encoderFallback = useFallback
        ? { from: 'h264_nvenc', reason: 'encoder_failed' }
        : null;

      if (batch.items[0].jobId !== null) {
        ctx?.emitProgress?.({
          job: String(batch.items[0].jobId),
          project: projectId,
          stage: 'complete',
          percentage: 100,
          message: 'Corte exportado',
          error: null,
        });
      }

      if (batch.items[1]) {
        if (failSecond) {
          batch.items[1].state = 'failed';
          batch.items[1].progress = 0;
          batch.items[1].error = { code: 'export_failed', message: 'Falha ao renderizar no FFmpeg.' };
          if (batch.items[1].jobId !== null) {
            ctx?.emitProgress?.({
              job: String(batch.items[1].jobId),
              project: projectId,
              stage: 'failed',
              percentage: 0,
              message: 'Falha na exportação do Corte',
              error: { code: 'export_failed', message: 'Falha ao renderizar no FFmpeg.' },
            });
          }
        } else {
          batch.items[1].state = 'running';
          batch.items[1].progress = 50;
          if (batch.items[1].jobId !== null) {
            ctx?.emitProgress?.({
              job: String(batch.items[1].jobId),
              project: projectId,
              stage: 'export',
              percentage: 50,
              message: 'Exportando Corte 2',
              error: null,
            });
          }
        }
      }

      const midView = batchView(batch);
      if (failSecond) {
        batch.state = 'completed';
        ctx?.emitProgress?.({
          job: `export-batch-${id}`,
          project: projectId,
          stage: 'export_batch_complete',
          percentage: 100,
          message: 'Lote de export concluído com falhas',
          error: null,
        });
      } else {
        ctx?.emitProgress?.({
          job: `export-batch-${id}`,
          project: projectId,
          stage: 'export_batch',
          percentage: midView.progress,
          message: 'Exportando lote de Cortes',
          error: null,
        });
      }
    }, 120);

    const t2 = setTimeout(() => {
      if (batch.state !== 'running') return;
      for (const item of batch.items) {
        if (item.state === 'queued' || item.state === 'running') {
          item.state = 'completed';
          item.progress = 100;
          item.encoder = useFallback ? 'libx264' : 'h264_nvenc';
          item.encoderFallback = useFallback
            ? { from: 'h264_nvenc', reason: 'encoder_failed' }
            : null;
          if (item.jobId !== null) {
            ctx?.emitProgress?.({
              job: String(item.jobId),
              project: projectId,
              stage: 'complete',
              percentage: 100,
              message: 'Corte exportado',
              error: null,
            });
          }
        }
      }
      batch.state = 'completed';
      ctx?.emitProgress?.({
        job: `export-batch-${id}`,
        project: projectId,
        stage: 'export_batch_complete',
        percentage: 100,
        message: 'Lote de export concluído',
        error: null,
      });
    }, 260);

    batch.timers.push(t1, t2);
    return view0;
  }

  if (name === 'export.batch.status') {
    ensureV1DemoBatchSeeded();
    const b = batches.get(a.id ?? -1);
    if (!b) throw { code: 'batch_not_found' };
    return batchView(b);
  }

  if (name === 'export.batch.list') {
    if (readExportEstado() === 'vazio') return [];
    ensureV1DemoBatchSeeded();
    const all = [...batches.values()].reverse();
    const filtered = typeof a.source_id === 'number' ? all.filter((b) => b.scope === 'source' && b.sourceId === a.source_id) : all;
    return filtered.map(batchView);
  }

  if (name === 'export.batch.cancel') {
    ensureV1DemoBatchSeeded();
    const b = batches.get(a.id ?? -1);
    if (!b) throw { code: 'batch_not_found' };
    clearBatchTimers(b);
    b.state = 'cancelled';
    for (const item of b.items) {
      if (item.state === 'queued' || item.state === 'running') {
        item.state = 'cancelled';
        item.progress = 0;
        if (item.jobId !== null) {
          ctx?.emitProgress?.({
            job: String(item.jobId),
            project: projectId,
            stage: 'failed',
            percentage: 0,
            message: 'Exportação cancelada',
            error: { code: 'cancelled', message: 'Exportação cancelada.' },
          });
        }
      }
    }
    const cancelledView = batchView(b);
    ctx?.emitProgress?.({
      job: `export-batch-${b.id}`,
      project: projectId,
      stage: 'export_batch_cancelled',
      percentage: cancelledView.progress,
      message: 'Lote de export cancelado',
      error: null,
    });
    return cancelledView;
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
    const emit = ctx?.emitProgress ?? hooks.emitProgress;
    const project = projectId ?? hooks.getProjectId?.() ?? null;
    emit?.({
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
      if (item.state !== 'running') return;
      const fallbackActive = isFallbackActive();
      item.state = 'completed';
      item.progress = 100;
      item.encoder = fallbackActive ? 'libx264' : 'h264_nvenc';
      item.encoderFallback = fallbackActive ? { from: 'h264_nvenc', reason: 'encoder_failed' } : null;
      emit?.({
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
    const emit = ctx?.emitProgress ?? hooks.emitProgress;
    emit?.({
      job: String(item.job),
      project: projectId ?? hooks.getProjectId?.() ?? null,
      stage: 'failed',
      percentage: 0,
      message: 'Exportação cancelada.',
      error: { code: 'cancelled', message: 'Exportação cancelada.' },
    });
  }
  return formatExportStatus(item);
}
