import { invoke, isTauri } from '@tauri-apps/api/core';
import { cancelReframeJobMock, configureEditorMockHooks, editorEditsMock, getMockClipInfo, resetEditorMockState } from './editorEditsMock';
import { captionsMock, getDefaultCaptionStyleMock, resetCaptionsMockState, setDefaultCaptionStyleMock } from './captionsMock';
import { version } from '../../package.json';
import { configureExportMockHooks, exportMock, resetExportMockState } from '@/features/export/mock';

/** Contrato do Corte para export, compartilhado pela revisão e pelo editor (#61).
 * `export.start` recebe estes campos mais `output` (caminho MP4 escolhido no diálogo).
 */
export type ExportRequest = { source_id: number; start_id: number; end_id: number; candidate_id?: number; clip_id?: number };
import { batchMockDispatch } from './batchMock';
import {
  cancelPackagingMockJob,
  packagingMockDispatch,
  resetPackagingMockState,
  seedPackagingMockCandidate,
  setPackagingMockPermission,
} from './packagingMock';
import {
  cancelThumbnailMockJob,
  resetThumbnailMockState,
  seedThumbnailMockCandidate,
  thumbnailMockDispatch,
} from './thumbnailMock';
import {
  cancelScriptMockJob,
  peekScriptMock,
  resetScriptMockState,
  scriptMockDispatch,
  seedScriptMockCandidate,
} from './scriptMock';
import {
  configureTranslationMockHooks,
  resetTranslationMockState,
  translationMockDispatch,
  setTranslationMockPermission,
} from './translationMock';

export type EventoProgressoMock = {
  job: string;
  project?: string | null;
  stage: string;
  percentage: number;
  message: string;
  error: { code: string; message: string } | null;
};

const progressSubscribers = new Set<(evento: EventoProgressoMock) => void>();
const activeMockJobs = new Map<string, Set<string>>();

export function assinarProgressoMock(ouvinte: (evento: EventoProgressoMock) => void): () => void {
  progressSubscribers.add(ouvinte);
  return () => {
    progressSubscribers.delete(ouvinte);
  };
}

export function emitirProgressoMock(evento: EventoProgressoMock): void {
  if (evento.project && evento.job && evento.job !== '0') {
    let jobs = activeMockJobs.get(evento.project);
    const terminal =
      Boolean(evento.error) ||
      evento.percentage >= 100 ||
      evento.stage === 'complete' ||
      evento.stage === 'failed' ||
      evento.stage.endsWith(':done') ||
      evento.stage.endsWith(':paused');
    if (terminal) {
      jobs?.delete(evento.job);
    } else {
      if (!jobs) {
        jobs = new Set();
        activeMockJobs.set(evento.project, jobs);
      }
      jobs.add(evento.job);
    }
  }
  for (const ouvinte of progressSubscribers) {
    ouvinte(evento);
  }
}

/** Gera um WAV PCM 24 kHz mono 16-bit válido para previews de Narração no mock. */
export function gerarWavPcmMock(duracaoSegundos = 0.25, frequenciaHz = 440): Uint8Array {
  const sampleRate = 24000;
  const numSamples = Math.max(1, Math.round(sampleRate * duracaoSegundos));
  const dataSize = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (off: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(off + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < numSamples; i += 1) {
    const sample = Math.sin((2 * Math.PI * frequenciaHz * i) / sampleRate) * 0.25;
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }
  return new Uint8Array(buf);
}

/** Resolve recursos `narration-original/<id>` e `narration-clean/<id>` para WAV PCM válido no mock. */
export function obterWavNarrationMock(recurso: string): Uint8Array | null {
  const limpo = recurso.replace(/^\/+/, '');
  if (/^narration-original\/\d+$/i.test(limpo)) {
    return gerarWavPcmMock(0.25, 330);
  }
  if (/^narration-clean\/\d+$/i.test(limpo)) {
    return gerarWavPcmMock(0.25, 440);
  }
  return null;
}

type ProjectMock = { id: string; name: string; path: string; warning?: string | null };
type RecentProjectMock = { available: boolean; name: string; path: string };

const DEFAULT_RECENT_PROJECTS: RecentProjectMock[] = [
  { available: true, name: 'Meu Canal de Cortes', path: '/projetos/MeuCanal.clipes' },
  { available: true, name: 'Canal Dark História', path: '/projetos/Historia.clipes' },
  { available: true, name: 'Demo', path: '/projetos/Demo.clipes' },
  { available: false, name: 'Live Antiga', path: '/backup/Antiga.clipes' },
];

let recentProjectsMock: RecentProjectMock[] = DEFAULT_RECENT_PROJECTS.map((p) => ({ ...p }));
let currentProjectMock: ProjectMock | null = null;
let currentProjectTouched = false;

function hasSearchFlag(flag: string): boolean {
  if (typeof location === 'undefined') return false;
  if (new URLSearchParams(location.search).has(flag)) return true;
  const hash = location.hash ?? '';
  const qIdx = hash.indexOf('?');
  return qIdx >= 0 && new URLSearchParams(hash.slice(qIdx + 1)).has(flag);
}

function readEstadoParam(): string | null {
  if (typeof location === 'undefined') return null;
  const hash = location.hash ?? '';
  const qIdx = hash.indexOf('?');
  if (qIdx >= 0) {
    const v = new URLSearchParams(hash.slice(qIdx + 1)).get('estado');
    if (v) return v;
  }
  return new URLSearchParams(location.search).get('estado');
}

function getActiveProjectMock(): ProjectMock | null {
  if (currentProjectTouched) return currentProjectMock;
  return hasSearchFlag('source-test')
    ? { id: 'test-project', name: 'Teste', path: '/test/Teste.clipes', warning: null }
    : null;
}

function slugifyProjectId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'projeto';
}

const groqRetryTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('groq-retry-test');
const denoMock = { installed: false };
const pocketTtsMock = { installed: false };
const uvMock = { installed: false };
const activeComponentJobs = new Map<string, { cancel: () => void }>();
const activeSourceJobs = new Map<string, { cancel: () => void }>();
const activeUrlJobs = new Map<string, { cancel: () => void }>();

function runCancellableSteps(
  jobId: string,
  steps: Array<{ stage: string; percentage: number; message: string; delayMs?: number }>,
  onComplete: () => void,
  registry: Map<string, { cancel: () => void }> = activeComponentJobs,
  projectId: string | null = null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      registry.delete(jobId);
      emitirProgressoMock({
        job: jobId,
        project: projectId,
        stage: 'failed',
        percentage: 0,
        message: 'Operação cancelada.',
        error: { code: 'cancelled', message: 'Operação cancelada.' },
      });
      reject({ code: 'cancelled', message: 'Operação cancelada.' });
    };
    registry.set(jobId, { cancel });

    const runStep = (idx: number) => {
      if (cancelled) return;
      if (idx >= steps.length) {
        registry.delete(jobId);
        onComplete();
        resolve();
        return;
      }
      const step = steps[idx];
      emitirProgressoMock({
        job: jobId,
        project: projectId,
        stage: step.stage,
        percentage: step.percentage,
        message: step.message,
        error: null,
      });
      const wait = step.delayMs ?? 15;
      timer = setTimeout(() => runStep(idx + 1), wait);
    };

    runStep(0);
  });
}
const ttsActiveModels: Record<string, string> = { pt: 'portuguese_24l', en: 'english' };
const ttsInstalledModels = new Set<string>();
const ttsInstalledRevs = new Map<string, string>();
const catalogScenario = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('catalog-test') : null;
const catalogMock = {
  version: 1,
  embeddedVersion: 1,
  source: 'embedded' as 'embedded' | 'remote',
  warning: catalogScenario === 'tampered-cache' ? 'Assinatura do catálogo em cache inválida; usando o catálogo embutido.' : null as string | null,
  warningCode: catalogScenario === 'tampered-cache' ? 'catalog_signature_invalid' : null as string | null,
};
const MODEL_REV_V1 = {
  'whisper-turbo': '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf',
  'whisper-small': '536b0662742c02347bc0e980a01041f333bce120',
  yunet: '48b10fa505aeb51fbd127fc60a5c660040e823b7',
};
const MODEL_REV_V2 = {
  'whisper-turbo': '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf',
  'whisper-small': '2222222222222222222222222222222222222222',
  yunet: '48b10fa505aeb51fbd127fc60a5c660040e823b7',
};
const TTS_REV_V1 = 'a7056f505a4a8ca72d8b5fb1440071d6f1a35739';
const TTS_REV_V2 = '3333333333333333333333333333333333333333';
const modelInstalledRevs = new Map<string, string>(
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('components-missing')
    ? []
    : [['whisper-small', MODEL_REV_V1['whisper-small']]],
);
type MockBlockAlignment = {
  status: 'pending' | 'aligned' | 'needs_review' | 'approved' | 'failed';
  choice: 'script' | 'spoken' | null;
  activeTrack: 'script' | 'spoken' | null;
  substitutions: number;
  insertions: number;
  deletions: number;
  maxConsecutiveInsertions: number;
  errorCode: string | null;
  modelId: string;
  spokenText: string | null;
  wordCount: number;
};
type MockCleanupInfo = {
  applicable: boolean;
  enabled: boolean;
  ready: boolean;
  noiseFloorDb: number | null;
  noiseFloorSource: 'pending' | 'vad' | 'default';
  warningCode: string | null;
  warning: string | null;
};
const narrationGenerated = new Map<number, { blockId: number; voiceId: string; modelId: string; engineId: string; trimmed?: boolean; cleanupEnabled?: boolean; cleanupReady?: boolean; improviso?: boolean; durationUs: number; alignment: MockBlockAlignment }[]>();
const hasSourceTest = () => hasSearchFlag('source-test');
const sourceTest = hasSourceTest();
const componentsMissing = typeof location !== 'undefined' && new URLSearchParams(location.search).has('components-missing');
const assistantTestInit = hasSearchFlag('assistant-test');
const ffmpegMock = { installed: !componentsMissing && !assistantTestInit, incomplete: false, path: null as string | null };
const componentSettingsMock = { data_dir: '/test/data', cache_dir: '/test/cache', cache_limit_bytes: 10_000_000_000 };
const isAbsolutePathMock = (value: unknown): value is string =>
  typeof value === 'string' && /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(value.trim());
const ytdlpMock = { installed: !componentsMissing, version: '2026.11.01' };
let workerInstalledMock = !componentsMissing;
uvMock.installed = !componentsMissing;
const budgetTest = () => hasSearchFlag('budget-test');
const isTranscriptTest = () => hasSearchFlag('transcript-test');
const isHardwareCpuMode = () => hasSearchFlag('hardware-cpu');
const isHardwareProbeFallbackMode = () => hasSearchFlag('hardware-probe-fallback');
const hardwareCpuMode = isHardwareCpuMode();
const hardwareProbeFallbackMode = isHardwareProbeFallbackMode();
// Transcrição simulada: a Frase n tem as palavras n*10 (“Frase”) e n*10+1 (“n”); correções, desfazer e refazer valem por Fonte e posição.
let mockProxyPolls = 0;
type ProxyMockEntry = {
  key: string;
  state: 'running' | 'ready' | 'failed';
  job: number;
  progress: number;
  windowStartUs: number;
  windowEndUs: number;
  error: { code: string; message: string } | null;
  timer: ReturnType<typeof setTimeout> | null;
};
const proxyJobsMock = new Map<string, ProxyMockEntry>();
function resetProxyMockState() {
  mockProxyPolls = 0;
  for (const entry of proxyJobsMock.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  proxyJobsMock.clear();
}
const mockCorrected = new Map<string, string>();
let mockDone: {source:number; position:number; before:string|null; after:string|null}[] = [];
let mockUndone: typeof mockDone = [];
const mockOriginal = (position: number) => position % 10 === 0 ? 'Frase' : String(Math.floor(position / 10));
const mockFold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function mockWords(source: number, id: number) { return [0, 1].map(k => { const position = id * 10 + k; const value = mockCorrected.get(source + ':' + position); return { position, text: value ?? mockOriginal(position), corrected: value !== undefined, start_us: id * 1_000_000 + k * 500_000 }; }); }
function mockApply(source: number, position: number, value: string | null) { if (value === null) mockCorrected.delete(source + ':' + position); else mockCorrected.set(source + ':' + position, value); }
function mockStep(source: number, position: number, changed: boolean) { const value = mockCorrected.get(source + ':' + position); return { changed, source_id: source, transcript_id: 1, position, sentence_id: Math.floor(position / 10), text: ' ' + (value ?? mockOriginal(position)), corrected: value !== undefined, can_undo: mockDone.length > 0, can_redo: mockUndone.length > 0 }; }
const makeSourceMetadata = (duration = '3600.0') => ({
  format: { duration },
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '60/1' },
    { index: 1, codec_type: 'audio', codec_name: 'aac', tags: { title: 'Mic OBS', language: 'por' } },
    { index: 2, codec_type: 'audio', codec_name: 'aac', tags: { title: 'Jogo', language: 'por' } },
  ],
});
type SourceMockItem = {
  id: number;
  path: string;
  status: 'available' | 'offline' | 'changed';
  available: boolean;
  verified: boolean;
  audio_track: number;
  origin_url: string | null;
  language: string;
  permission: { status: 'none' } | { status: 'granted'; who: string; where: string; scope: string };
  metadata: ReturnType<typeof makeSourceMetadata>;
};
let sourceItems: SourceMockItem[] = [
  { id: 1, path: '/test/changed.mp4', status: 'changed', available: false, verified: false, audio_track: 1, origin_url: null, language: 'pt', permission: { status: 'none' }, metadata: makeSourceMetadata('3600.0') },
  { id: 2, path: '/test/offline.mp4', status: 'offline', available: false, verified: false, audio_track: 1, origin_url: null, language: 'pt', permission: { status: 'none' }, metadata: makeSourceMetadata('6600.0') },
  { id: 3, path: '/test/mismatch.mp4', status: 'changed', available: false, verified: true, audio_track: 1, origin_url: null, language: 'pt', permission: { status: 'none' }, metadata: makeSourceMetadata('1800.0') },
];
let urlSettingsMock = {terms_accepted:false, download_dir:'/test/downloads'};
type JobCostSummaryMock = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  microUsd: number;
  audioMicroUsd: number;
  unknownCostCalls: number;
  planQuotaCalls: number;
  durationMs: number;
  costLabel: string | null;
};

type JobItemMock = {
  id: number;
  kind: string;
  safety: 'local' | 'paid';
  state: 'queued' | 'running' | 'uncertain' | 'completed' | 'cancelled' | 'failed';
  attempts: number;
  checkpoint: string | null;
  progress: number;
  project: string;
  outcome: string | null;
  cost: string | null;
  batch: string | null;
  profile: string | null;
  budgetPause: string | null;
  taskCost: JobCostSummaryMock | null;
  profileCost: JobCostSummaryMock | null;
  batchCost: JobCostSummaryMock | null;
};

function createInitialJobItems(): JobItemMock[] {
  const selectionCost: JobCostSummaryMock = {
    calls: 8,
    inputTokens: 32_000,
    outputTokens: 10_100,
    microUsd: 420_000,
    audioMicroUsd: 0,
    unknownCostCalls: 0,
    planQuotaCalls: 0,
    durationMs: 12_000,
    costLabel: null,
  };
  const unknownBatchCost: JobCostSummaryMock = {
    calls: 4,
    inputTokens: 18_000,
    outputTokens: 2_400,
    microUsd: 0,
    audioMicroUsd: 0,
    unknownCostCalls: 1,
    planQuotaCalls: 0,
    durationMs: 8_000,
    costLabel: 'custo desconhecido',
  };
  const scriptCost: JobCostSummaryMock = {
    calls: 1,
    inputTokens: 0,
    outputTokens: 0,
    microUsd: 0,
    audioMicroUsd: 0,
    unknownCostCalls: 0,
    planQuotaCalls: 1,
    durationMs: 4_800,
    costLabel: 'consome a cota do plano',
  };
  const packagingCost: JobCostSummaryMock = {
    calls: 2,
    inputTokens: 6_400,
    outputTokens: 920,
    microUsd: 40_000,
    audioMicroUsd: 0,
    unknownCostCalls: 0,
    planQuotaCalls: 0,
    durationMs: 3_100,
    costLabel: null,
  };

  const isCleanSourceTest = hasSearchFlag('source-test');

  return [
    {
      id: 1,
      kind: 'preview',
      safety: 'local',
      state: isCleanSourceTest ? 'completed' : 'running',
      attempts: 1,
      checkpoint: null,
      progress: isCleanSourceTest ? 100 : 42,
      project: 'demo',
      outcome: isCleanSourceTest ? 'ok' : null,
      cost: null,
      batch: null,
      profile: null,
      budgetPause: null,
      taskCost: null,
      profileCost: null,
      batchCost: null,
    },
    {
      id: 2,
      kind: 'ai:selection',
      safety: 'paid',
      state: 'uncertain',
      attempts: 1,
      checkpoint: null,
      progress: 0,
      project: 'demo',
      outcome: 'uncertain',
      cost: 'unknown',
      batch: null,
      profile: 'legacy',
      budgetPause: null,
      taskCost: selectionCost,
      profileCost: selectionCost,
      batchCost: null,
    },
    {
      id: 3,
      kind: 'ai:selection',
      safety: 'paid',
      state: 'queued',
      attempts: 1,
      checkpoint: null,
      progress: 0,
      project: 'demo',
      outcome: null,
      cost: null,
      batch: 'sources-3',
      profile: 'legacy',
      budgetPause: 'cost_unknown',
      taskCost: unknownBatchCost,
      profileCost: null,
      batchCost: unknownBatchCost,
    },
    {
      id: 4,
      kind: 'ai:script',
      safety: 'paid',
      state: 'completed',
      attempts: 1,
      checkpoint: null,
      progress: 100,
      project: 'demo',
      outcome: 'ok',
      cost: 'consome a cota do plano',
      batch: null,
      profile: 'codex',
      budgetPause: null,
      taskCost: scriptCost,
      profileCost: scriptCost,
      batchCost: null,
    },
    {
      id: 5,
      kind: 'ai:packaging',
      safety: 'paid',
      state: 'failed',
      attempts: 2,
      checkpoint: null,
      progress: 0,
      project: 'demo',
      outcome: 'invalid_json',
      cost: '0.0400',
      batch: null,
      profile: 'legacy',
      budgetPause: null,
      taskCost: packagingCost,
      profileCost: packagingCost,
      batchCost: null,
    },
    {
      id: 6,
      kind: 'transcription',
      safety: 'local',
      state: 'completed',
      attempts: 1,
      checkpoint: null,
      progress: 100,
      project: 'demo',
      outcome: 'ok',
      cost: null,
      batch: null,
      profile: null,
      budgetPause: null,
      taskCost: null,
      profileCost: null,
      batchCost: null,
    },
    ...(budgetTest()
      ? [
          {
            id: 7,
            kind: 'ai:selection',
            safety: 'paid' as const,
            state: 'queued' as const,
            attempts: 1,
            checkpoint: null,
            progress: 0,
            project: 'demo',
            outcome: null,
            cost: null,
            batch: null,
            profile: 'legacy',
            budgetPause: 'budget_cost',
            taskCost: selectionCost,
            profileCost: null,
            batchCost: null,
          },
        ]
      : []),
  ];
}

let jobItems: JobItemMock[] = createInitialJobItems();
let nextJobIdMock = 100;

function resetJobsMockState(): void {
  jobItems = createInitialJobItems();
  nextJobIdMock = 100;
}
type TranscriptStateMock = {
  transcript: { id: number; engine: string; model: string; state: string; resume_us: number; duration_us: number; words: number } | null;
  job: { id: number; state: string; progress: number; code?: string | null } | null;
};
const transcriptsBySource = new Map<number, TranscriptStateMock>([
  [2, { transcript: { id: 2, engine: 'local', model: 'whisper-turbo', state: 'complete', resume_us: 6_600_000_000, duration_us: 6_600_000_000, words: 30000 }, job: null }],
]);
const energyMeasuredSources = new Set<number>();
if (groqRetryTest || componentsMissing || hardwareCpuMode || hardwareProbeFallbackMode) {
  sourceItems.push({ id: 4, path: '/test/downloaded.mp4', status: 'available', available: true, verified: true, audio_track: 1, origin_url: 'https://www.youtube.com/watch?v=downloaded', language: 'pt', permission: { status: 'none' }, metadata: makeSourceMetadata('3600.0') });
  if (groqRetryTest) {
    transcriptsBySource.set(4, { transcript: { id: 1, engine: 'groq', model: 'whisper-large-v3-turbo', state: 'running', resume_us: 4e6, duration_us: 10e6, words: 1 }, job: { id: 99, state: 'cancelled', progress: 40, code: null } });
  }
} else {
  sourceItems.push({ id: 4, path: '/test/Live_12_11_final.mp4', status: 'available', available: true, verified: true, audio_track: 1, origin_url: 'https://www.youtube.com/watch?v=live1211', language: 'pt', permission: { status: 'granted', who: 'Criador Exemplo', where: 'Discord', scope: 'cortes e tradução' }, metadata: makeSourceMetadata('3600.0') });
  transcriptsBySource.set(4, { transcript: { id: 4, engine: 'local', model: 'whisper-turbo', state: 'complete', resume_us: 3_600_000_000, duration_us: 3_600_000_000, words: 30000 }, job: null });
}
function requireProjectMock(args: object): ProjectMock {
  const active = getActiveProjectMock();
  if (!active) {
    throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto no momento.' };
  }
  const project = (args as { project?: unknown }).project;
  if (typeof project !== 'string' || !project.trim() || project !== active.path) {
    throw { code: 'invalid_project', message: 'O Projeto informado não corresponde ao Projeto aberto.' };
  }
  return active;
}
let providerMock = hasSearchFlag('assistant-test')
  ? {
      kind: 'openai',
      endpoint: '',
      model: '',
      nativeSchema: false,
      context: null as number | null,
      keyLastFour: null as string | null,
      remote: false,
      confirmed: false,
      confirmedEndpoints: [] as string[],
    }
  : {
      kind: 'openai',
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      nativeSchema: false,
      context: 128000 as number | null,
      keyLastFour: '9a4f' as string | null,
      remote: true,
      confirmed: true,
      confirmedEndpoints: ['https://api.openai.com/v1'] as string[],
    };
type ProfileMock = { id: string; label: string; kind: string; endpoint: string; model: string; nativeSchema: boolean; ownKey: boolean; context: number | null; maxOutput?: number | null; timeoutSecs?: number | null; tokensPerRequest?: number | null; tokensPerMinute?: number | null; tokensPerDay?: number | null; keyLastFour: string | null };
let profileMocks: ProfileMock[] = [];
const isLocalHost = (endpoint: string) => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname);
  } catch {
    return false;
  }
};
let priceOverrides: { provider: string; model: string; inputPerMillion: number; outputPerMillion: number }[] = [];
let assistantTouched = false;
let assistantMock = { completed: !assistantTestInit, skipped: false, needsSetup: assistantTestInit, default: '', tasks: { selection: '', packaging: '', script: '', translation: '' } as Record<string, string>, localOnly: { selection: false, packaging: false, script: false, translation: false } as Record<string, boolean> };
let projectVetoMock = false;
type BackupMockItem = { id: string; created_at: number; before_restore: boolean };
let backupSeqMock = 1;
const backupSettingsMock = {
  interval_seconds: 1800,
  copies: 10,
  default_interval_seconds: 1800,
  default_copies: 10,
};
let backupsMock: BackupMockItem[] = [
  { id: 'backup-20261117-193000.sqlite', created_at: 1794943800, before_restore: false },
  { id: 'before-restore-20261117-184500.sqlite', created_at: 1794941100, before_restore: true },
];
let channelProfileMock = {
  videoKind: 'direct',
  language: 'pt',
  minUs: 20_000_000,
  maxUs: 60_000_000,
  allowedSources: [] as { label: string; url?: string | null; note?: string | null }[],
  narrationVoice: null as string | null,
  directMonetizationAck: false,
};
const channelProfileView = () => ({
  ...channelProfileMock,
  captionStyle: getDefaultCaptionStyleMock(),
  limits: { defaultMinUs: 20_000_000, defaultMaxUs: 60_000_000, maxUs: 180_000_000, technicalMaxUs: 300_000_000 },
});
const knownProfile = (id: string) => (id === 'legacy' ? !!providerMock.endpoint : profileMocks.some(p => p.id === id));
const staleProfile = (choice: string) => choice.startsWith('profile:') && !knownProfile(choice.slice(8));
const assistantView = () => {
  const missing: Record<string, string> = {};
  const shown = (key: string, choice: string) => { if (staleProfile(choice)) { missing[key] = choice.slice(8); return ''; } return choice; };
  const tasks = Object.fromEntries(Object.entries(assistantMock.tasks).map(([task, choice]) => [task, shown(task, choice)]));
  const def = shown('default', assistantMock.default);
  const dynamicTest = !assistantTouched && hasSearchFlag('assistant-test');
  const completed = dynamicTest ? false : assistantMock.completed;
  const skipped = dynamicTest ? false : assistantMock.skipped;
  if (dynamicTest && !assistantTouched) {
    ffmpegMock.installed = false;
  }
  return { ...assistantMock, completed, skipped, default: def, needsSetup: !completed && !skipped, tasks, localOnly: { ...assistantMock.localOnly }, missing };
};
const taskTarget = (choice: string) => {
  const profileRow = (id: string, label: string, kind: string, model: string, endpoint: string) => { const local = isLocalHost(endpoint); return { id, label, kind, model, local, cli: false, cost: local ? { kind: 'zero' } : { kind: 'unknown' } }; };
  if (choice === 'codex' || choice === 'claude') return { id: choice, label: choice === 'codex' ? 'Codex CLI' : 'Claude Code CLI', kind: choice, model: null, local: false, cli: true, cost: { kind: 'plan_quota' } };
  if (choice === 'opencode') return { id:choice, label:'OpenCode CLI', kind:choice, model:providerCliMock.opencodeModel, local:false, cli:true, cost:{kind:providerCliMock.opencodeModel === 'opencode/big-pickle' ? 'zero' : 'unknown'} };
  const id = choice === 'endpoint' ? 'legacy' : choice.startsWith('profile:') ? choice.slice(8) : '';
  if (id === 'legacy' && providerMock.endpoint) return profileRow('legacy', 'Principal', providerMock.kind, providerMock.model, providerMock.endpoint);
  const found = profileMocks.find(p => p.id === id);
  return found ? profileRow(found.id, found.label, found.kind, found.model, found.endpoint) : null;
};
const assistantTasks = () => {
  const vetoAtivo = Boolean(getActiveProjectMock()) && projectVetoMock;
  return { projectLocalOnly: vetoAtivo, tasks: Object.keys(assistantMock.tasks).map(task => {
  const own = assistantMock.tasks[task];
  const choice = own || assistantMock.default;
  const profile = taskTarget(choice);
  const missing = !profile && staleProfile(choice) ? choice.slice(8) : null;
  const localOnly = assistantMock.localOnly[task] ?? false;
  const firstLocal = profileMocks.find(p => isLocalHost(p.endpoint));
  return { task, choice: missing ? '' : own, source: missing ? 'none' : own ? 'task' : assistantMock.default ? 'default' : 'none', profile, localOnly, blocked: (localOnly || vetoAtivo) && !!profile && !profile.local, missing,
    suggestion: !profile && firstLocal ? { choice: `profile:${firstLocal.id}`, label: firstLocal.label, measured: false } : null };
}) };
};
let groqKeyConfigured = groqRetryTest;
let groqConsent = groqRetryTest;
let groqUncertain = groqRetryTest;
let providerCliMock = { selected: '', codexConfirmed: false, claudeConfirmed: false, opencodeConfirmed: false, opencodeModel: '', timeoutSeconds: 300 };
// Mock do hardware da Transcrição (#50): GPU NVIDIA por padrão, CPU com `?hardware-cpu=1`.
const GIB = 1024 ** 3;
const hardwareMock = { manual: null as { model: string; device: string; compute_type: string } | null, probed: false, groupingChoice: null as boolean | null };
function hardwareMockDispatch(name: string, args: object): unknown {
  const cpuFlag = isHardwareCpuMode();
  const fallbackCpu = isHardwareProbeFallbackMode() && !hardwareMock.manual;
  const auto = cpuFlag || fallbackCpu ? { model: 'whisper-small', device: 'cpu', compute_type: 'int8' } : { model: 'whisper-turbo', device: 'cuda', compute_type: 'int8_float16' };
  const effective = hardwareMock.manual ?? auto;
  const cpu = effective.device === 'cpu';
  if (name === 'transcription.hardware.choose') {
    const a = args as { reset?: boolean; model?: string; device?: string; compute_type?: string };
    if (a.reset) hardwareMock.manual = null;
    else hardwareMock.manual = { model: a.model ?? '', device: a.device ?? '', compute_type: a.compute_type ?? '' };
    return hardwareMockDispatch('transcription.hardware.status', {});
  }
  if (name === 'transcription.hardware.probe') {
    return runCancellableSteps(
      'hardware-probe',
      [
        { stage: 'probe', percentage: 0, message: 'Sondando hardware de transcrição' },
        { stage: 'probe', percentage: 100, message: 'Sonda concluída', delayMs: 5 },
      ],
      () => {
        hardwareMock.probed = true;
      },
    ).then(() => ({ chosen: auto, verified: true, measured_at: 1790000000, attempts: [] }));
  }
  if (name === 'transcription.grouping') {
    const a = args as { enabled?: unknown; auto?: unknown };
    const hasEnabled = a.enabled !== undefined, hasAuto = a.auto !== undefined;
    if (hasEnabled || hasAuto) {
      if (hasEnabled && hasAuto) throw { code: 'invalid_grouping', message: 'Opção de agrupamento inválida.' };
      if (hasEnabled) {
        if (typeof a.enabled !== 'boolean') throw { code: 'invalid_grouping', message: 'Opção de agrupamento inválida.' };
        hardwareMock.groupingChoice = a.enabled;
      } else {
        if (a.auto !== true) throw { code: 'invalid_grouping', message: 'Opção de agrupamento inválida.' };
        hardwareMock.groupingChoice = null;
      }
    }
    // Automático (#279): ligado na CPU, desligado na GPU; a escolha manual vence.
    const enabled = hardwareMock.groupingChoice ?? cpu;
    const measured_size = cpu ? null : hardwareMock.probed ? 8 : null;
    const size = enabled ? (cpu ? 8 : (measured_size ?? 1)) : 1;
    return { enabled, mode: hardwareMock.groupingChoice === null ? 'auto' : 'manual', size, measured_size };
  }
  if (name === 'transcription.estimate') {
    requireProjectMock(args);
    const sid = (args as { source_id?: number }).source_id;
    if (typeof sid !== 'number' || !sourceItems.some((s) => s.id === sid)) {
      throw { code: 'source_missing', message: 'Fonte não encontrada.' };
    }
    const rate = cpu ? (effective.model === 'whisper-turbo' ? 4.1 : 2.57) : 0.386;
    const seconds = 5 + rate * 36000;
    return runCancellableSteps(
      'transcription-estimate',
      [
        { stage: 'estimate', percentage: 0, message: 'Extraindo amostra de 30 s' },
        { stage: 'estimate', percentage: 50, message: 'Medindo velocidade da transcrição' },
        { stage: 'estimate', percentage: 100, message: 'Estimativa concluída', delayMs: 5 },
      ],
      () => {},
    ).then(() => ({ ...effective, load_s: 5, rate, estimate_s: seconds, low_s: seconds * 0.7, high_s: seconds * 1.5, sample_start_us: 9e9, sample_us: 30e6, cached: false, measured_at: 1790000000, cpu, warnings: effective.model === 'whisper-turbo' && cpu ? ['low_ram'] : [] }));
  }
  if (name === 'transcription.hardware.diagnostic') {
    if (readEstadoParam() === 'vazio') return null;
    return {
      key: {
        gpu: cpuFlag ? null : 'NVIDIA GeForce RTX 3050 Laptop GPU',
        driver: cpuFlag ? null : '616.92',
        ct2_version: '4.5.0',
        model: effective.model,
        app_version: version,
      },
      chosen: effective,
      verified: true,
      attempts: cpuFlag
        ? [{ device: 'cpu', compute_type: 'int8', batch_size: 1, ok: true }]
        : [
            { device: 'cuda', compute_type: 'int8_float16', batch_size: 1, ok: true },
            { device: 'cuda', compute_type: 'int8_float16', batch_size: 8, ok: true },
          ],
      batch: cpuFlag
        ? null
        : {
            compute_type: 'int8_float16',
            tested: [
              [4, true],
              [8, true],
            ],
            max_safe: 8,
            origin: 'probe',
            measured_at: 1790000000,
          },
      vram_free_mib: cpuFlag ? null : 3962,
      measured_at: 1790000000,
      fallback_reason: fallbackCpu ? 'gpu_probe_failed' : null,
    };
  }
  const options = [['whisper-turbo', 'cuda', 'int8_float16'], ['whisper-turbo', 'cuda', 'float16'], ['whisper-turbo', 'cuda', 'int8'], ['whisper-turbo', 'cpu', 'int8'], ['whisper-small', 'cpu', 'int8']].map(([model, device, compute_type]) => ({ model, device, compute_type, installed: !componentsMissing && (model === 'whisper-small' ? modelInstalledRevs.has('whisper-small') : modelInstalledRevs.has('whisper-turbo')), enabled: !(cpuFlag && device === 'cuda'), reason: cpuFlag && device === 'cuda' ? 'no_cuda' : null }));
        return {
          gpu: cpuFlag ? null : { name: 'NVIDIA GeForce RTX 3050 Laptop GPU', driver: '616.92', total_mib: 4096, free_mib: 3962 },
          ram: { total: 16 * GIB, available: 9 * GIB }, cuda: !cpuFlag, no_compatible_gpu: cpu, effective, manual: hardwareMock.manual !== null,
          fallback_reason: fallbackCpu ? 'gpu_probe_failed' : null,
          probe: hardwareMock.probed ? { measured_at: 1790000000, verified: true, chosen: auto } : null, options, worker_installed: workerInstalledMock,
        };
}

// Seleção de Cortes simulada (#53): quatro Janelas; suporta execuções múltiplas, revisões múltiplas, eventos core-progress e estados ?estado=.
const chatMock = { fetched: false };
const chatFetchedSources = new Set<number>();
const selectionFlag = (name: string) => hasSearchFlag(name);
const selectionWeightsDirect = [{key:'hook',weight:0.3},{key:'selfContained',weight:0.2},{key:'energy',weight:0.2},{key:'value',weight:0.15},{key:'closing',weight:0.15}];
// Vídeo transformado (#67): 6º eixo `commentary` e os pesos da decisão de 15/11/2026.
const selectionWeightsTransformed = [{key:'commentary',weight:0.3},{key:'hook',weight:0.2},{key:'energy',weight:0.15},{key:'value',weight:0.15},{key:'selfContained',weight:0.1},{key:'closing',weight:0.1}];
const weightsOf = (kind: string) => kind === 'transformed' ? selectionWeightsTransformed : selectionWeightsDirect;
function selectionAxes(scores: number[], kind: string) { return Object.fromEntries(weightsOf(kind).map((w, i) => [w.key, { score: scores[i % scores.length], why: `Motivo do eixo ${w.key}.` }])); }

type MockWindowState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain' | 'unscheduled';
type MockSelectionWindow = {
  index: number;
  firstId: number;
  lastId: number;
  startUs: number;
  endUs: number;
  jobId: number | null;
  state: MockWindowState;
  code: string | null;
  resetAtMs: number | null;
  profile: string;
  redoFailed: string | null;
};
type MockCandidate = {
  id: number;
  rank: number;
  startId: number;
  endId: number;
  startUs: number;
  endUs: number;
  axes: Record<string, { score: number; why: string }>;
  total: number;
  totalCenti: number;
  title: string;
  windows: number[];
  adjusted: boolean;
  adjust: { extendedBefore?: number; extendedAfter?: number; trimmedEnd?: number } | null;
  chat: { ratio: number; reaction: string | null; atUs: number }[];
  profile: string;
  revision: number;
  videoKind?: 'direct' | 'transformed';
};
type MockDecisionEntry = {
  candStart: number;
  candEnd: number;
  kind: 'approved' | 'rejected' | 'adjusted';
  beforeStart: number;
  beforeEnd: number;
  afterStart: number;
  afterEnd: number;
};
type MockSelectionRun = {
  id: number;
  sourceId: number;
  transcriptId: number;
  state: 'running' | 'completed' | 'partial';
  videoKind: 'direct' | 'transformed';
  minUs: number;
  maxUs: number;
  planState: 'full' | 'reduced' | 'blocked';
  profile: string;
  revision: number;
  revisions: number[];
  activeRevision: number;
  budgetPause: string | null;
  createdAt: string;
  ticks: number;
  cancelled: boolean;
  redone: boolean;
  redoProfile?: string;
  energyMeasured: boolean;
  chatAvailable: boolean;
  parcialResolved: boolean;
  windows: MockSelectionWindow[];
  candidatesByRevision: Map<number, MockCandidate[]>;
  decisions: MockDecisionEntry[];
  timers: ReturnType<typeof setTimeout>[];
};

let nextRunIdMock = 4;
let nextCandidateIdMock = 400;
let nextWindowJobIdMock = 200;
const selectionRuns = new Map<number, MockSelectionRun>();
const selectionMock = { run: null as null | { id: number; ticks: number; state: string; cancelled: boolean; redone: boolean; videoKind: string; revision?: number; redoProfile?: string } };

configureEditorMockHooks({
  emitProgress: emitirProgressoMock,
  getProjectId: () => getActiveProjectMock()?.id ?? null,
  isTransformedCandidate: (candidateId) => {
    if (typeof candidateId !== 'number') return false;
    const hit = findRunAndCandidateById(candidateId);
    return hit?.run.videoKind === 'transformed';
  },
  hasNarrationAudio: (candidateId) => {
    if (typeof candidateId !== 'number') return false;
    return (narrationGenerated.get(candidateId)?.length ?? 0) > 0;
  },
  getTranscriptIdForSource: (sourceId) => transcriptsBySource.get(sourceId)?.transcript?.id ?? sourceId,
});

configureTranslationMockHooks({
  emitProgress: emitirProgressoMock,
  getProjectId: () => getActiveProjectMock()?.id ?? null,
  getClipSource: (clipId) => {
    const info = getMockClipInfo(clipId);
    return info ? { sourceId: info.sourceId, transcriptId: info.transcriptId } : null;
  },
  getSourcePermission: (sourceId) => sourceItems.find((s) => s.id === sourceId)?.permission ?? null,
});

configureExportMockHooks({
  emitProgress: emitirProgressoMock,
  getProjectId: () => getActiveProjectMock()?.id ?? null,
});

function buildCandidatesForRevision(
  revision: number,
  videoKind: 'direct' | 'transformed',
  profile: string,
  withChat: boolean,
  idBase: number,
): MockCandidate[] {
  const boost = revision > 1 ? 0.45 : 0;
  const p0 = revision > 1 ? profile : 'legacy';
  const c1Total = Math.min(10, Number((8.35 + boost).toFixed(2)));
  const c2Total = Math.min(10, Number((7.1 + (revision > 1 ? 0.4 : 0)).toFixed(2)));
  return [
    {
      id: idBase + 1,
      rank: 0,
      startId: 10,
      endId: 14,
      startUs: 90_000_000,
      endUs: 140_000_000,
      axes: selectionAxes([9, 8, 7, 9, 8, 9], videoKind),
      total: c1Total,
      totalCenti: Math.round(c1Total * 100),
      title: 'A virada do jogo',
      windows: [0, 1],
      adjusted: false,
      adjust: null,
      chat: withChat ? [{ ratio: 3.1, reaction: 'laugh', atUs: 95_000_000 }] : [],
      profile: p0,
      revision,
      videoKind,
    },
    {
      id: idBase + 2,
      rank: 1,
      startId: 40,
      endId: 41,
      startUs: 390_000_000,
      endUs: 410_000_000,
      axes: selectionAxes([8, 6, 7, 9, 5, 7], videoKind),
      total: c2Total,
      totalCenti: Math.round(c2Total * 100),
      title: '',
      windows: [0],
      adjusted: true,
      adjust: { extendedAfter: 1 },
      chat: withChat ? [{ ratio: 2.4, reaction: null, atUs: 395_000_000 }] : [],
      profile: p0,
      revision,
      videoKind,
    },
    {
      id: idBase + 3,
      rank: 2,
      startId: 200,
      endId: 203,
      startUs: 1_990_000_000,
      endUs: 2_030_000_000,
      axes: selectionAxes([4, 4, 4, 4, 4, 4], videoKind),
      total: 4,
      totalCenti: 400,
      title: 'Piada longa',
      windows: [2],
      adjusted: true,
      adjust: { trimmedEnd: 3 },
      chat: [],
      profile: 'legacy',
      revision,
      videoKind,
    },
  ];
}

function createInitialDemoRun(): MockSelectionRun {
  const kind: 'direct' | 'transformed' = selectionFlag('cenario-transformed') ? 'transformed' : 'direct';
  const windows: MockSelectionWindow[] = [0, 1, 2, 3].map((index) => ({
    index,
    firstId: index * 90 + 1,
    lastId: index * 90 + 90,
    startUs: index * 720_000_000,
    endUs: index * 720_000_000 + 900_000_000,
    jobId: index === 2 ? 2 : 10 + index,
    state: 'completed',
    code: null,
    resetAtMs: null,
    profile: index === 0 ? 'forte' : 'legacy',
    redoFailed: null,
  }));
  const candidatesByRevision = new Map<number, MockCandidate[]>([
    [1, buildCandidatesForRevision(1, kind, 'legacy', true, 0)],
    [2, buildCandidatesForRevision(2, kind, 'forte', true, 100)],
  ]);
  return {
    id: 1,
    sourceId: 4,
    transcriptId: 4,
    state: 'completed',
    videoKind: kind,
    minUs: 20_000_000,
    maxUs: 60_000_000,
    planState: 'full',
    profile: 'legacy',
    revision: 2,
    revisions: [1, 2],
    activeRevision: 2,
    budgetPause: null,
    createdAt: '2026-11-15T12:00:00Z',
    ticks: 2,
    cancelled: false,
    redone: true,
    energyMeasured: true,
    chatAvailable: true,
    parcialResolved: false,
    windows,
    candidatesByRevision,
    decisions: [
      {
        candStart: 40,
        candEnd: 41,
        kind: 'approved',
        beforeStart: 40,
        beforeEnd: 41,
        afterStart: 40,
        afterEnd: 41,
      },
    ],
    timers: [],
  };
}

function createDemoTransformedRun(): MockSelectionRun {
  const windows: MockSelectionWindow[] = [0, 1].map((index) => ({
    index,
    firstId: index * 90 + 1,
    lastId: index * 90 + 90,
    startUs: index * 720_000_000,
    endUs: index * 720_000_000 + 900_000_000,
    jobId: 20 + index,
    state: 'completed',
    code: null,
    resetAtMs: null,
    profile: 'forte',
    redoFailed: null,
  }));
  const candidates: MockCandidate[] = [
    {
      id: 201,
      rank: 0,
      startId: 10,
      endId: 14,
      startUs: 90_000_000,
      endUs: 140_000_000,
      axes: selectionAxes([9, 9, 8, 8, 8, 9], 'transformed'),
      total: 8.75,
      totalCenti: 875,
      title: 'A virada do jogo (transformado)',
      windows: [0],
      adjusted: false,
      adjust: null,
      chat: [],
      profile: 'forte',
      revision: 1,
      videoKind: 'transformed',
    },
    {
      id: 202,
      rank: 1,
      startId: 40,
      endId: 41,
      startUs: 390_000_000,
      endUs: 410_000_000,
      axes: selectionAxes([8, 8, 8, 8, 7, 8], 'transformed'),
      total: 8.1,
      totalCenti: 810,
      title: 'Análise completa da jogada (V1)',
      windows: [0],
      adjusted: false,
      adjust: null,
      chat: [],
      profile: 'forte',
      revision: 1,
      videoKind: 'transformed',
    },
    {
      id: 203,
      rank: 2,
      startId: 200,
      endId: 203,
      startUs: 1_990_000_000,
      endUs: 2_030_000_000,
      axes: selectionAxes([7, 7, 7, 7, 7, 7], 'transformed'),
      total: 7.0,
      totalCenti: 700,
      title: 'Outro trecho transformado',
      windows: [1],
      adjusted: false,
      adjust: null,
      chat: [],
      profile: 'forte',
      revision: 1,
      videoKind: 'transformed',
    },
  ];
  return {
    id: 2,
    sourceId: 4,
    transcriptId: 4,
    state: 'completed',
    videoKind: 'transformed',
    minUs: 20_000_000,
    maxUs: 60_000_000,
    planState: 'full',
    profile: 'forte',
    revision: 1,
    revisions: [1],
    activeRevision: 1,
    budgetPause: null,
    createdAt: '2026-11-14T12:00:00Z',
    ticks: 2,
    cancelled: false,
    redone: false,
    energyMeasured: true,
    chatAvailable: true,
    parcialResolved: false,
    windows,
    candidatesByRevision: new Map([[1, candidates]]),
    decisions: [
      { candStart: 10, candEnd: 14, kind: 'approved', beforeStart: 10, beforeEnd: 14, afterStart: 10, afterEnd: 14 },
      { candStart: 40, candEnd: 41, kind: 'approved', beforeStart: 40, beforeEnd: 41, afterStart: 40, afterEnd: 41 },
    ],
    timers: [],
  };
}

function createDemoV1OfflineRun(): MockSelectionRun {
  const candidates: MockCandidate[] = [
    {
      id: 301,
      rank: 0,
      startId: 10,
      endId: 14,
      startUs: 90_000_000,
      endUs: 140_000_000,
      axes: selectionAxes([8, 8, 7, 8, 7, 8], 'transformed'),
      total: 7.8,
      totalCenti: 780,
      title: 'Corte legado V1 offline',
      windows: [0],
      adjusted: false,
      adjust: null,
      chat: [],
      profile: 'legacy',
      revision: 1,
      videoKind: 'transformed',
    },
  ];
  return {
    id: 3,
    sourceId: 2,
    transcriptId: 2,
    state: 'completed',
    videoKind: 'transformed',
    minUs: 20_000_000,
    maxUs: 60_000_000,
    planState: 'full',
    profile: 'legacy',
    revision: 1,
    revisions: [1],
    activeRevision: 1,
    budgetPause: null,
    createdAt: '2026-11-13T12:00:00Z',
    ticks: 2,
    cancelled: false,
    redone: false,
    energyMeasured: false,
    chatAvailable: false,
    parcialResolved: false,
    windows: [
      {
        index: 0,
        firstId: 1,
        lastId: 90,
        startUs: 0,
        endUs: 900_000_000,
        jobId: 30,
        state: 'completed',
        code: null,
        resetAtMs: null,
        profile: 'legacy',
        redoFailed: null,
      },
    ],
    candidatesByRevision: new Map([[1, candidates]]),
    decisions: [
      { candStart: 10, candEnd: 14, kind: 'approved', beforeStart: 10, beforeEnd: 14, afterStart: 10, afterEnd: 14 },
    ],
    timers: [],
  };
}

function seedDemoTransformarEmpacotarState() {
  resetScriptMockState();
  resetThumbnailMockState();
  resetPackagingMockState();
  narrationGenerated.clear();
  if (hasSearchFlag('source-test')) return;
  pocketTtsMock.installed = false;
  ttsInstalledModels.clear();
  ttsInstalledRevs.clear();

  seedScriptMockCandidate(202, {
    angle: {
      name: 'Por que a jogada virou o jogo',
      promise: 'Mostra o detalhe de decisão que mudou o placar.',
      audience: 'Jogadores competitivos',
      sentence_ids: [40, 41],
    },
    blocks: [
      { id: 2021, position: 1, title: 'Abertura', refs: [40], narration: 'Olha o momento exato em que o jogo virou.', approved: true },
      { id: 2022, position: 2, title: 'Virada', refs: [41, 42], narration: 'Ele segurou o recurso em vez de gastar cedo.', approved: true },
      { id: 2023, position: 3, title: 'Fechamento', refs: [43, 44], narration: 'Essa leitura garantiu a vitória no final.', approved: true },
    ],
  });
  narrationGenerated.set(202, [
    {
      blockId: 2021,
      voiceId: 'recorded',
      modelId: 'silero-vad',
      engineId: 'recorded',
      trimmed: true,
      cleanupEnabled: true,
      cleanupReady: false,
      durationUs: 12_000_000,
      alignment: { status: 'aligned', choice: null, activeTrack: 'script', substitutions: 0, insertions: 0, deletions: 0, maxConsecutiveInsertions: 0, errorCode: null, modelId: 'whisper-turbo', spokenText: null, wordCount: 9 },
    },
    {
      blockId: 2022,
      voiceId: '13063',
      modelId: 'portuguese_24l',
      engineId: 'pocket-tts',
      trimmed: true,
      durationUs: 12_000_000,
      alignment: { status: 'aligned', choice: null, activeTrack: 'script', substitutions: 0, insertions: 0, deletions: 0, maxConsecutiveInsertions: 0, errorCode: null, modelId: 'whisper-turbo', spokenText: null, wordCount: 9 },
    },
    {
      blockId: 2023,
      voiceId: 'imported',
      modelId: 'external',
      engineId: 'imported',
      trimmed: true,
      cleanupEnabled: true,
      cleanupReady: true,
      durationUs: 12_000_000,
      alignment: { status: 'aligned', choice: null, activeTrack: 'script', substitutions: 0, insertions: 0, deletions: 0, maxConsecutiveInsertions: 0, errorCode: null, modelId: 'whisper-turbo', spokenText: null, wordCount: 8 },
    },
  ]);
  seedThumbnailMockCandidate(202, { instantUs: 395_000_000, origin: 'provider', why: 'Momento da reação principal.' });
  seedPackagingMockCandidate(202, {
    language: 'pt-BR',
    generated: {
      title: 'A virada que mudou toda a partida',
      description: 'Resumo do corte V1.\n\n--- Capítulos ---\n00:00 Abertura\n00:12 Virada\n00:24 Fechamento\n--- Fim dos capítulos ---',
      tags: ['clipes', 'jogada'],
      hashtags: ['#cortes', '#analise'],
    },
  });

  seedScriptMockCandidate(301, {
    angle: {
      name: 'Contexto da live antiga V1',
      promise: 'Comentário preservado em Projeto V1 mesmo com Fonte offline.',
      sentence_ids: [10, 11],
    },
    blocks: [
      { id: 3011, position: 1, title: 'Introdução V1', refs: [10], narration: 'Trecho salvo na V1.', approved: true },
      { id: 3012, position: 2, title: 'Comentário V1', refs: [11, 12], narration: 'Análise salva no SQLite.', approved: true },
      { id: 3013, position: 3, title: 'Conclusão V1', refs: [13, 14], narration: 'Fechamento do corte.', approved: true },
    ],
  });
  narrationGenerated.set(301, [
    {
      blockId: 3011,
      voiceId: 'recorded',
      modelId: 'silero-vad',
      engineId: 'recorded',
      trimmed: true,
      cleanupEnabled: true,
      cleanupReady: false,
      durationUs: 12_000_000,
      alignment: { status: 'aligned', choice: null, activeTrack: 'script', substitutions: 0, insertions: 0, deletions: 0, maxConsecutiveInsertions: 0, errorCode: null, modelId: 'whisper-turbo', spokenText: null, wordCount: 4 },
    },
    {
      blockId: 3012,
      voiceId: '13063',
      modelId: 'portuguese_24l',
      engineId: 'pocket-tts',
      trimmed: true,
      durationUs: 12_000_000,
      alignment: { status: 'aligned', choice: null, activeTrack: 'script', substitutions: 0, insertions: 0, deletions: 0, maxConsecutiveInsertions: 0, errorCode: null, modelId: 'whisper-turbo', spokenText: null, wordCount: 4 },
    },
    {
      blockId: 3013,
      voiceId: '13063',
      modelId: 'portuguese_24l',
      engineId: 'pocket-tts',
      trimmed: true,
      durationUs: 12_000_000,
      alignment: { status: 'aligned', choice: null, activeTrack: 'script', substitutions: 0, insertions: 0, deletions: 0, maxConsecutiveInsertions: 0, errorCode: null, modelId: 'whisper-turbo', spokenText: null, wordCount: 3 },
    },
  ]);
  seedThumbnailMockCandidate(301, { instantUs: 95_000_000, origin: 'user' });
  seedPackagingMockCandidate(301, {
    language: 'pt-BR',
    generated: {
      title: 'Corte legado da live antiga',
      description: 'Descrição editável mesmo com Fonte offline.',
      tags: ['legado'],
      hashtags: ['#live'],
    },
  });
}

function clearSelectionTimers() {
  for (const r of selectionRuns.values()) {
    for (const t of r.timers) clearTimeout(t);
    r.timers = [];
  }
}

function resetSelectionMockState() {
  clearSelectionTimers();
  selectionRuns.clear();
  nextRunIdMock = 4;
  nextCandidateIdMock = 400;
  nextWindowJobIdMock = 200;
  if (!hasSearchFlag('source-test')) {
    selectionRuns.set(1, createInitialDemoRun());
    selectionRuns.set(2, createDemoTransformedRun());
    selectionRuns.set(3, createDemoV1OfflineRun());
  }
  resetEditorMockState();
  resetCaptionsMockState();
  resetTranslationMockState();
  seedDemoTransformarEmpacotarState();
  resetExportMockState();
}

function ensureSelectionDemoInitialized() {
  if (!hasSearchFlag('source-test') && selectionRuns.size === 0) {
    nextRunIdMock = 4;
    nextCandidateIdMock = 400;
    selectionRuns.set(1, createInitialDemoRun());
    selectionRuns.set(2, createDemoTransformedRun());
    selectionRuns.set(3, createDemoV1OfflineRun());
    resetEditorMockState();
    seedDemoTransformarEmpacotarState();
  }
}

// Revisão simulada (#55): Frases de 10 s (a Frase k vai de 10(k-1) s a 10k s), faixa de [minUs, maxUs] e pilha de decisões.
type MockReview = { status: 'pending' | 'approved' | 'rejected'; start: number; end: number; origin: [number, number]; videoKindOverride?: 'transformed' };
const reviewMock = { items: new Map<number, MockReview>([[1, { status: 'pending', start: 10, end: 14, origin: [10, 14] }], [2, { status: 'pending', start: 40, end: 41, origin: [40, 41] }], [3, { status: 'pending', start: 200, end: 203, origin: [200, 203] }]]), history: [] as { id: number; before: MockReview }[] };
function effectiveCandidateKind(id: number): 'direct' | 'transformed' {
  const r = reviewMock.items.get(id);
  if (r?.videoKindOverride === 'transformed') return 'transformed';
  return selectionMock.run?.videoKind === 'transformed' ? 'transformed' : 'direct';
}
function mockMovesForRange(start: number, end: number, minUs: number, maxUs: number) {
  const ok = (s: number, e: number) => {
    const dur = (e - s + 1) * 10_000_000;
    return s >= 1 && e <= 240 && s <= e && dur >= minUs && dur <= maxUs;
  };
  return { startEarlier: ok(start - 1, end), startLater: ok(start + 1, end), endEarlier: ok(start, end - 1), endLater: ok(start, end + 1) };
}
function mockMoves(r: MockReview) {
  return mockMovesForRange(r.start, r.end, 20_000_000, 180_000_000);
}
function mockItem(id: number) {
  const r = reviewMock.items.get(id)!;
  return { candidate: id, status: r.status, adjusted: r.start !== r.origin[0] || r.end !== r.origin[1], videoKind: effectiveCandidateKind(id), startId: r.start, endId: r.end, startUs: (r.start - 1) * 10_000_000, endUs: r.end * 10_000_000, startText: `Primeira frase ${r.start} do Corte.`, endText: `Última frase ${r.end} do Corte.`, moves: mockMoves(r) };
}
function candidateStateInRun(c: MockCandidate, decisions: MockDecisionEntry[]) {
  let status: 'pending' | 'approved' | 'rejected' = 'pending';
  let startId = c.startId;
  let endId = c.endId;
  let adjusted = false;
  for (const d of decisions) {
    if (d.candStart === c.startId && d.candEnd === c.endId) {
      startId = d.afterStart;
      endId = d.afterEnd;
      adjusted = startId !== c.startId || endId !== c.endId;
      if (d.kind === 'approved' || d.kind === 'rejected') {
        status = d.kind;
      }
    }
  }
  return { status, startId, endId, adjusted };
}
function buildReviewItemForRun(c: MockCandidate, run: MockSelectionRun) {
  const st = candidateStateInRun(c, run.decisions);
  return {
    candidate: c.id,
    status: st.status,
    adjusted: st.adjusted,
    videoKind: c.videoKind ?? run.videoKind,
    startId: st.startId,
    endId: st.endId,
    startUs: (st.startId - 1) * 10_000_000,
    endUs: st.endId * 10_000_000,
    startText: `Primeira frase ${st.startId} do Corte.`,
    endText: `Última frase ${st.endId} do Corte.`,
    moves: mockMovesForRange(st.startId, st.endId, run.minUs, run.maxUs),
  };
}

function findRunAndCandidateById(candidateId: number): { run: MockSelectionRun; candidate: MockCandidate; revision: number } | null {
  for (const r of selectionRuns.values()) {
    const activeList = r.candidatesByRevision.get(r.activeRevision) ?? [];
    const hitActive = activeList.find((c) => c.id === candidateId);
    if (hitActive) return { run: r, candidate: hitActive, revision: r.activeRevision };
    for (const [rev, list] of r.candidatesByRevision.entries()) {
      const hit = list.find((c) => c.id === candidateId);
      if (hit) return { run: r, candidate: hit, revision: rev };
    }
  }
  return null;
}

function selectionReviewMock(name: string, args: object): unknown {
  if (hasSearchFlag('source-test')) {
    const a = args as { candidate?: number; decision?: 'approved' | 'rejected'; edge?: 'start' | 'end'; delta?: number; videoKind?: unknown };
    const answer = (id: number | null) => ({ run: 1, item: id === null ? null : mockItem(id), canUndo: reviewMock.history.length > 0 });
    if (name === 'selection.review') return { run: 1, items: [...reviewMock.items.keys()].map(mockItem), canUndo: reviewMock.history.length > 0 };
    if (name === 'selection.undo') {
      const last = reviewMock.history.pop();
      if (!last) throw { code: 'nothing_to_undo', message: 'Não há decisão para desfazer.' };
      reviewMock.items.set(last.id, last.before);
      return answer(last.id);
    }
    if (name === 'selection.candidate.set_kind') {
      if (typeof a.candidate !== 'number' || !Number.isInteger(a.candidate)) {
        throw { code: 'candidate_not_found', message: 'Candidato não encontrado.' };
      }
      if (a.videoKind !== 'transformed') {
        throw { code: 'invalid_video_kind', message: 'Tipo de vídeo inválido: só é permitido converter para transformed (Vídeo transformado).' };
      }
      const target = reviewMock.items.get(a.candidate);
      if (!target) throw { code: 'candidate_not_found', message: 'Candidato não encontrado.' };
      target.videoKindOverride = 'transformed';
      const item = mockItem(a.candidate);
      return { ...answer(a.candidate), candidate: a.candidate, videoKind: item.videoKind };
    }
    const r = reviewMock.items.get(a.candidate ?? -1);
    if (!r) throw { code: 'candidate_not_found', message: 'Candidato não encontrado.' };
    const before = { ...r };
    if (name === 'selection.decide') {
      if (r.status !== a.decision) { r.status = a.decision!; reviewMock.history.push({ id: a.candidate!, before }); }
      return answer(a.candidate!);
    }
    const start = a.edge === 'start' ? r.start + a.delta! : r.start;
    const end = a.edge === 'end' ? r.end + a.delta! : r.end;
    const length = (end - start + 1) * 10;
    if (start < 1 || end > 240) throw { code: 'adjust_out_of_transcript', message: 'A borda não pode sair da Transcrição.' };
    if (start > end) throw { code: 'adjust_empty', message: 'O Corte precisa manter ao menos uma Frase.' };
    if (length < 20) throw { code: 'adjust_too_short', message: 'O Corte ficaria abaixo da duração mínima.' };
    if (length > 180) throw { code: 'adjust_too_long', message: 'O Corte ficaria acima da duração máxima.' };
    r.start = start; r.end = end; reviewMock.history.push({ id: a.candidate!, before });
    return answer(a.candidate!);
  }

  ensureSelectionDemoInitialized();
  const a = args as { run?: number; revision?: number; candidate?: number; decision?: 'approved' | 'rejected'; edge?: 'start' | 'end'; delta?: number; videoKind?: unknown };
  if (name === 'selection.review') {
    const r = typeof a.run === 'number' ? selectionRuns.get(a.run) : undefined;
    if (!r) throw { code: 'run_not_found', message: 'Execução de seleção não encontrada.' };
    const rev = typeof a.revision === 'number' && r.candidatesByRevision.has(a.revision) ? a.revision : r.activeRevision;
    const cands = r.candidatesByRevision.get(rev) ?? [];
    return {
      run: r.id,
      items: cands.map((c) => buildReviewItemForRun(c, r)),
      canUndo: r.decisions.length > 0,
    };
  }
  if (name === 'selection.undo') {
    const r = typeof a.run === 'number' ? selectionRuns.get(a.run) : undefined;
    if (!r) throw { code: 'run_not_found', message: 'Execução de seleção não encontrada.' };
    const last = r.decisions.pop();
    if (!last) throw { code: 'nothing_to_undo', message: 'Não há decisão para desfazer.' };
    const cands = r.candidatesByRevision.get(r.activeRevision) ?? [];
    const cand = cands.find((c) => c.startId === last.candStart && c.endId === last.candEnd) ?? null;
    return {
      run: r.id,
      item: cand ? buildReviewItemForRun(cand, r) : null,
      canUndo: r.decisions.length > 0,
    };
  }
  if (name === 'selection.candidate.set_kind') {
    if (typeof a.candidate !== 'number' || !Number.isInteger(a.candidate)) {
      throw { code: 'candidate_not_found', message: 'Candidato não encontrado.' };
    }
    if (a.videoKind !== 'transformed') {
      throw { code: 'invalid_video_kind', message: 'Tipo de vídeo inválido: só é permitido converter para transformed (Vídeo transformado).' };
    }
    const foundKind = findRunAndCandidateById(a.candidate);
    if (!foundKind) throw { code: 'candidate_not_found', message: 'Candidato não encontrado.' };
    foundKind.candidate.videoKind = 'transformed';
    const item = buildReviewItemForRun(foundKind.candidate, foundKind.run);
    return {
      run: foundKind.run.id,
      candidate: foundKind.candidate.id,
      videoKind: item.videoKind,
      item,
      canUndo: foundKind.run.decisions.length > 0,
    };
  }

  const found = typeof a.candidate === 'number' ? findRunAndCandidateById(a.candidate) : null;
  if (!found) throw { code: 'candidate_not_found', message: 'Candidato não encontrado.' };
  const { run: r, candidate: c } = found;
  const st = candidateStateInRun(c, r.decisions);

  if (name === 'selection.decide') {
    if (a.decision !== 'approved' && a.decision !== 'rejected') {
      throw { code: 'invalid_decision', message: 'Decisão inválida.' };
    }
    if (st.status !== a.decision) {
      r.decisions.push({
        candStart: c.startId,
        candEnd: c.endId,
        kind: a.decision,
        beforeStart: st.startId,
        beforeEnd: st.endId,
        afterStart: st.startId,
        afterEnd: st.endId,
      });
    }
    return {
      run: r.id,
      item: buildReviewItemForRun(c, r),
      canUndo: r.decisions.length > 0,
    };
  }

  if (a.edge !== 'start' && a.edge !== 'end') {
    throw { code: 'invalid_edge', message: 'Borda inválida.' };
  }
  if (typeof a.delta !== 'number' || !Number.isInteger(a.delta) || a.delta === 0) {
    throw { code: 'invalid_delta', message: 'Deslocamento inválido.' };
  }
  const start = a.edge === 'start' ? st.startId + a.delta : st.startId;
  const end = a.edge === 'end' ? st.endId + a.delta : st.endId;
  if (start < 1 || end > 240) throw { code: 'adjust_out_of_transcript', message: 'A borda não pode sair da Transcrição.' };
  if (start > end) throw { code: 'adjust_empty', message: 'O Corte precisa manter ao menos uma Frase.' };
  const lengthUs = (end - start + 1) * 10_000_000;
  if (lengthUs < r.minUs) throw { code: 'adjust_too_short', message: 'O Corte ficaria abaixo da duração mínima.' };
  if (lengthUs > r.maxUs) throw { code: 'adjust_too_long', message: 'O Corte ficaria acima da duração máxima.' };
  r.decisions.push({
    candStart: c.startId,
    candEnd: c.endId,
    kind: 'adjusted',
    beforeStart: st.startId,
    beforeEnd: st.endId,
    afterStart: start,
    afterEnd: end,
  });
  return {
    run: r.id,
    item: buildReviewItemForRun(c, r),
    canUndo: r.decisions.length > 0,
  };
}

function resolveSelectionRouteMock(profileId?: string) {
  const id = profileId ?? (() => {
    const rota = assistantMock.tasks.selection || assistantMock.default;
    if (!rota) return 'legacy';
    if (['codex', 'claude', 'opencode'].includes(rota)) return rota;
    if (rota === 'endpoint') return 'legacy';
    return rota.startsWith('profile:') ? rota.slice(8) : rota;
  })();

  if (id === 'forte') {
    return {
      profile: { id: 'forte', label: 'Forte remoto', kind: 'openai', model: 'forte-1' },
      local: false,
      cli: false,
      paid: true,
    };
  }
  if (id === 'leve') {
    return {
      profile: { id: 'leve', label: 'Leve local', kind: 'openai', model: 'leve-1' },
      local: true,
      cli: false,
      paid: false,
    };
  }
  if (['codex', 'claude', 'opencode'].includes(id)) {
    const label = id === 'codex' ? 'Codex CLI' : id === 'claude' ? 'Claude Code CLI' : 'OpenCode CLI';
    const model = id === 'opencode' ? (providerCliMock.opencodeModel || null) : null;
    const free = id === 'opencode' && model === 'opencode/big-pickle';
    return {
      profile: { id, label, kind: id, model },
      local: false,
      cli: true,
      paid: !free,
    };
  }
  if (id === 'legacy') {
    if (!providerMock.endpoint) throw { code: 'profile_unavailable', message: 'Perfil indisponível.' };
    const local = isLocalHost(providerMock.endpoint);
    return {
      profile: { id: 'legacy', label: 'Principal', kind: providerMock.kind, model: providerMock.model || null },
      local,
      cli: false,
      paid: !local,
    };
  }
  const found = profileMocks.find((p) => p.id === id);
  if (!found) throw { code: 'invalid_profile', message: 'Escolha um Perfil de Provedor.' };
  const local = isLocalHost(found.endpoint);
  return {
    profile: { id: found.id, label: found.label, kind: found.kind, model: found.model || null },
    local,
    cli: false,
    paid: !local,
  };
}

function estimateForRoute(route: ReturnType<typeof resolveSelectionRouteMock>, windowsCount: number) {
  if (selectionFlag('selection-paid')) {
    return { kind: 'usd', units: windowsCount, windows: windowsCount, inputTokens: windowsCount * 10000, minMicroUsd: windowsCount * 300, maxMicroUsd: windowsCount * 1350 };
  }
  if (route.local) {
    return { kind: 'zero', units: windowsCount, windows: windowsCount, inputTokens: windowsCount * 9000, minMicroUsd: 0, maxMicroUsd: 0 };
  }
  if (route.cli) {
    return { kind: route.paid ? 'plan_quota' : 'zero', units: windowsCount, windows: windowsCount, inputTokens: windowsCount * 9000, minMicroUsd: route.paid ? null : 0, maxMicroUsd: route.paid ? null : 0 };
  }
  return { kind: 'usd', units: windowsCount, windows: windowsCount, inputTokens: windowsCount * 9000, minMicroUsd: windowsCount * 600, maxMicroUsd: windowsCount * 2400 };
}

function applyParcialOverlay(run: MockSelectionRun): MockSelectionRun {
  if (run.id !== 1 || readEstadoParam() !== 'parcial' || run.parcialResolved) return run;
  const windows = run.windows.map((w) =>
    w.index === 2
      ? { ...w, state: 'uncertain' as MockWindowState, jobId: w.jobId ?? 2, code: 'timeout_uncertain' }
      : w,
  );
  return {
    ...run,
    state: 'partial',
    budgetPause: selectionFlag('cenario-budget') ? 'budget_cost' : run.budgetPause,
    windows,
  };
}

function formatRunHead(raw: MockSelectionRun) {
  const run = applyParcialOverlay(raw);
  const cands = run.candidatesByRevision.get(run.activeRevision) ?? [];
  const completed = run.windows.filter((w) => w.state === 'completed').length;
  const failed = run.windows.filter((w) => w.state === 'failed' || w.state === 'cancelled' || w.state === 'uncertain').length;
  return {
    id: run.id,
    transcriptId: run.transcriptId,
    taskVersion: run.videoKind === 'transformed' ? 2 : 3,
    promptSha256: 'e00332d06248cff669ccb8922aae9d50190a7e30715630e566c4943941469b8a',
    profile: run.profile,
    state: run.state,
    minUs: run.minUs,
    maxUs: run.maxUs,
    weights: weightsOf(run.videoKind),
    planState: run.planState,
    counts: {
      windows: run.windows.length,
      completed,
      failed,
      kept: cands.length,
      discarded: 0,
      merged: 1,
    },
    summary: {
      videoKind: run.videoKind,
      energy: run.energyMeasured || selectionFlag('selection-energy') ? { measured: true, high: 4, peak: 2 } : { measured: false },
      chat: run.chatAvailable || selectionFlag('selection-chat') ? { available: true, peaks: 3, marked: 2 } : { available: false },
      revision: run.revision,
      redoFailed: [],
      windows: {
        total: run.windows.length,
        completed,
        failed: run.windows.filter((w) => w.code).map((w) => ({ window: w.index, code: w.code })),
      },
      candidates: {
        proposed: cands.length + 1,
        kept: cands.length,
        merged: 1,
        adjusted: cands.filter((c) => c.adjusted).length,
        discarded: { tooShort: 0, tooLong: 0, unknownId: 0 },
      },
    },
    createdAt: run.createdAt,
    videoKind: run.videoKind,
    revision: run.revision,
    revisions: [...run.revisions],
    budgetPause: run.budgetPause,
  };
}

function selectionMockDispatch(name: string, args: object): unknown {
  const paid = selectionFlag('selection-paid');
  const asked = args as { source_id?: number; run?: number; revision?: number; profileId?: string; windows?: number[]; confirmed?: boolean; minUs?: number; maxUs?: number; videoKind?: string };

  if (name === 'energy.status') {
    if (selectionFlag('selection-energy-queued')) return { measured: false, marks: { high: 0, peak: 0 }, job: { id: 1, state: 'queued', progress: 0 } };
    if (selectionFlag('selection-energy-running')) return { measured: false, marks: { high: 0, peak: 0 }, job: { id: 1, state: 'running', progress: 45 } };
    const sid = asked.source_id;
    if (selectionFlag('selection-energy') || (typeof sid === 'number' && energyMeasuredSources.has(sid))) {
      return { measured: true, marks: { high: 4, peak: 2 }, job: { id: 1, state: 'completed', progress: 100 } };
    }
    return { measured: false, marks: { high: 0, peak: 0 }, job: null };
  }
  if (name === 'energy.start') {
    const active = getActiveProjectMock();
    if (!active) throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto.' };
    const sid = asked.source_id;
    if (typeof sid !== 'number' || !sourceItems.some((s) => s.id === sid)) {
      throw { code: 'source_missing', message: 'Fonte não encontrada.' };
    }
    const st = transcriptsBySource.get(sid);
    const complete = isTranscriptTest() || st?.transcript?.state === 'complete';
    if (!st?.transcript && !complete) throw { code: 'transcript_missing', message: 'Transcrição não encontrada.' };
    if (!complete) throw { code: 'transcript_incomplete', message: 'A Transcrição ainda não foi concluída.' };
    if (selectionFlag('selection-energy') || energyMeasuredSources.has(sid)) {
      return { state: 'measured', job: null };
    }
    const jobId = 101;
    emitirProgressoMock({ job: String(jobId), project: active.id, stage: 'energy', percentage: 0, message: 'Medindo energia do áudio', error: null });
    emitirProgressoMock({ job: String(jobId), project: active.id, stage: 'energy', percentage: 60, message: 'Medindo energia do áudio', error: null });
    energyMeasuredSources.add(sid);
    emitirProgressoMock({ job: String(jobId), project: active.id, stage: 'complete', percentage: 100, message: 'Energia medida', error: null });
    return { state: 'queued', job: jobId };
  }
  if (name === 'chat.status') {
    const sid = asked.source_id;
    const src = typeof sid === 'number' ? sourceItems.find((s) => s.id === sid) : undefined;
    const canFetch = !selectionFlag('chat-local') && (src ? Boolean(src.origin_url) || selectionFlag('selection-chat') : true);
    const fetched = chatMock.fetched || (typeof sid === 'number' && chatFetchedSources.has(sid));
    const state = selectionFlag('chat-absent') ? 'absent' : fetched ? 'available' : 'none';
    return {
      state,
      canFetch,
      intervals: fetched ? 42 : 0,
      messages: fetched ? 1280 : 0,
      peaks: fetched ? 3 : 0,
      job: null,
    };
  }
  if (name === 'chat.fetch') {
    const active = getActiveProjectMock();
    const sid = asked.source_id;
    const src = typeof sid === 'number' ? sourceItems.find((s) => s.id === sid) : undefined;
    if (src && !src.origin_url && !selectionFlag('selection-chat')) {
      throw { code: 'chat_needs_url', message: 'O chat só está disponível para Fontes importadas por URL.' };
    }
    chatMock.fetched = true;
    if (typeof sid === 'number') chatFetchedSources.add(sid);
    const jobId = 102;
    emitirProgressoMock({ job: String(jobId), project: active?.id ?? null, stage: 'chat', percentage: 0, message: 'Buscando o chat da live', error: null });
    emitirProgressoMock({ job: String(jobId), project: active?.id ?? null, stage: 'chat', percentage: 50, message: 'Agregando o chat da live', error: null });
    emitirProgressoMock({ job: String(jobId), project: active?.id ?? null, stage: 'complete', percentage: 100, message: 'Chat da live pronto', error: null });
    return { state: 'queued', job: jobId };
  }

  // Modo legado v1 (?source-test=1) para preservar 100% os testes de UI da v1 (`scripts/ui.mjs`)
  if (hasSearchFlag('source-test')) {
    if (name === 'selection.estimate' && asked.run && asked.profileId) {
      if (selectionFlag('selection-localonly') && asked.profileId === 'forte') throw { code: 'local_only_violation', message: 'local only' };
      const remote = asked.profileId === 'forte';
      return {
        profile: { id: asked.profileId, label: remote ? 'Forte remoto' : 'Leve local', model: remote ? 'forte-1' : 'leve-1' },
        paid: remote,
        leavesMachine: remote,
        windows: asked.windows ?? [],
        estimate: remote
          ? { kind: 'usd', units: 1, windows: 1, inputTokens: 9000, minMicroUsd: 2400, maxMicroUsd: 9800 }
          : { kind: 'zero', units: 1, windows: 1, inputTokens: 9000, minMicroUsd: 0, maxMicroUsd: 0 },
      };
    }
    if (name === 'selection.estimate') {
      if (selectionFlag('selection-blocked')) throw { code: 'context_too_small', message: 'O contexto efetivo de 4096 tokens (definido por você no perfil) não comporta a janela mínima. Aumente o contexto no Perfil de Provedor ou escolha outro perfil.' };
      const kind = asked.videoKind ?? 'direct';
      return {
        paid,
        profile: 'legacy',
        videoKind: kind,
        plan: { state: 'full', windows: [{}, {}, {}, {}], contextTokens: 32768 },
        weights: weightsOf(kind),
        estimate: { kind: paid ? 'usd' : 'zero', windows: 4, inputTokens: 40000, minMicroUsd: paid ? 1200 : 0, maxMicroUsd: paid ? 5400 : 0 },
      };
    }
    if (name === 'selection.redo' && asked.profileId) {
      if (selectionFlag('selection-uncertain')) throw { code: 'window_uncertain', message: 'incerta' };
      if (asked.profileId === 'forte' && !asked.confirmed) throw { code: 'confirmation_required', message: 'confirmação obrigatória' };
      const current = selectionMock.run;
      if (current) { current.redoProfile = asked.profileId; current.revision = 2; }
      return { run: 1, windows: asked.windows ?? [], profile: { id: asked.profileId } };
    }
    const run = selectionMock.run;
    if (name === 'selection.list') return run ? [{ id: run.id, state: run.state, createdAt: '2026-11-15T12:00:00Z', videoKind: run.videoKind, weights: weightsOf(run.videoKind), budgetPause: null, counts: { windows: 4, completed: 0, failed: 0, kept: 0, discarded: 0, merged: 0 } }] : [];
    if (name === 'selection.start') {
      if (paid && !asked.confirmed) throw { code: 'confirmation_required', message: 'confirmação obrigatória' };
      const kind = asked.videoKind ?? 'direct';
      selectionMock.run = { id: 1, ticks: 0, state: 'running', cancelled: false, redone: false, videoKind: kind };
      return { run: 1, videoKind: kind, windows: 4, planState: 'full', weights: weightsOf(kind) };
    }
    if (name === 'selection.cancel') { if (run) { run.cancelled = true; run.state = 'partial'; } return null; }
    if (name === 'selection.redo' || name === 'selection.resume') {
      if (paid && !asked.confirmed) throw { code: 'confirmation_required', message: 'confirmação obrigatória' };
      if (run) { run.redone = true; run.state = 'completed'; run.cancelled = false; }
      return { run: 1, windows: [2] };
    }
    if (name === 'selection.review' || name === 'selection.decide' || name === 'selection.adjust' || name === 'selection.undo' || name === 'selection.candidate.set_kind') return selectionReviewMock(name, args);
    if (name === 'selection.get' && run) {
      run.ticks += 1;
      const failing = !run.redone && !run.cancelled && run.ticks > 1;
      if (run.ticks > 1 && !run.cancelled && run.state === 'running') run.state = failing ? 'partial' : 'completed';
      const states = run.cancelled ? ['completed', 'cancelled', 'cancelled', 'cancelled'] : run.ticks === 1 ? ['completed', 'running', 'queued', 'queued'] : ['completed', 'completed', failing ? 'failed' : 'completed', 'completed'];
      if (selectionFlag('selection-uncertain') && run.ticks > 1) states[0] = 'uncertain';
      const made = (w: number[]) => (run.redoProfile && w.includes(0) ? run.redoProfile : 'legacy');
      const windows = states.map((state, index) => ({ index, firstId: index * 90 + 1, lastId: index * 90 + 90, startUs: index * 720_000_000, endUs: index * 720_000_000 + 900_000_000, jobId: index + 1, state, code: state === 'cancelled' ? 'cancelled' : state === 'failed' ? 'verification_failed' : null }));
      const done = states.filter(s => s === 'completed').length;
      const withChat = selectionFlag('selection-chat');
      const candidates = run.ticks === 1 && !run.cancelled ? [] : [
        { id: 1, rank: 0, startId: 10, endId: 14, startUs: 90_000_000, endUs: 140_000_000, axes: selectionAxes([9, 8, 7, 9, 8], run.videoKind), total: 8.35, title: 'A virada do jogo', windows: [0, 1], adjusted: false, adjust: null, chat: withChat ? [{ ratio: 3.1, reaction: 'laugh', atUs: 95_000_000 }] : [], profile: made([0, 1]), revision: run.revision ?? 1, videoKind: effectiveCandidateKind(1) },
        { id: 2, rank: 1, startId: 40, endId: 41, startUs: 390_000_000, endUs: 410_000_000, axes: selectionAxes([8, 6, 7, 9, 5], run.videoKind), total: 7.1, title: '', windows: [0], adjusted: true, adjust: { extendedAfter: 1 }, chat: withChat ? [{ ratio: 2.4, reaction: null, atUs: 395_000_000 }] : [], profile: made([0]), revision: run.revision ?? 1, videoKind: effectiveCandidateKind(2) },
        { id: 3, rank: 2, startId: 200, endId: 203, startUs: 1_990_000_000, endUs: 2_030_000_000, axes: selectionAxes([4, 4, 4, 4, 4], run.videoKind), total: 4, title: 'Piada longa', windows: [2], adjusted: true, adjust: { trimmedEnd: 3 }, chat: [], profile: made([2]), revision: run.revision ?? 1, videoKind: effectiveCandidateKind(3) },
      ];
      return { run: { id: 1, state: run.state, videoKind: run.videoKind, summary: { energy: selectionFlag('selection-energy') ? { measured: true, high: 4, peak: 2 } : { measured: false }, chat: selectionFlag('selection-chat') ? { available: true, peaks: 3 } : { available: false } }, weights: weightsOf(run.videoKind), budgetPause: null, createdAt: '2026-11-15T12:00:00Z', counts: { windows: 4, completed: done, failed: states.filter(s => s === 'failed' || s === 'cancelled').length, kept: candidates.length, discarded: 0, merged: 1 } }, windows, candidates };
    }
    throw { code: 'run_not_found', message: 'Execução de seleção não encontrada.' };
  }

  // Modo 3 (refazer com outro Perfil): selection.estimate { run, windows, profileId }
  if (name === 'selection.estimate' && asked.run && asked.profileId) {
    ensureSelectionDemoInitialized();
    const runObj = selectionRuns.get(asked.run);
    if (!runObj) throw { code: 'run_not_found', message: 'Execução de seleção não encontrada.' };
    const efetivo = applyParcialOverlay(runObj);
    const wanted = Array.isArray(asked.windows) ? asked.windows : [];
    if (wanted.length === 0) throw { code: 'windows_required', message: 'Escolha a(s) Janela(s) da seleção a refazer.' };
    for (const idx of wanted) {
      const w = efetivo.windows.find((win) => win.index === idx);
      if (!w) throw { code: 'window_not_found', message: 'Janela da seleção não encontrada.' };
      if (w.state === 'uncertain') throw { code: 'window_uncertain', message: 'A chamada desta Janela tem resultado incerto: resolva a incerteza antes de refazer com outro perfil.' };
      if (w.state === 'queued' || w.state === 'running') throw { code: 'window_not_redoable', message: 'Só uma Janela concluída, que falhou ou foi cancelada pode ser refeita.' };
    }
    const route = resolveSelectionRouteMock(asked.profileId);
    const veto = selectionFlag('selection-localonly') || (Boolean(getActiveProjectMock()) && projectVetoMock) || Boolean(assistantMock.localOnly.selection);
    if (veto && !route.local) {
      throw { code: 'local_only_violation', message: 'Bloqueado pelo modo Somente local.' };
    }
    const windows = asked.windows ?? [];
    return {
      profile: route.profile,
      paid: !route.local,
      leavesMachine: !route.local,
      windows,
      estimate: estimateForRoute(route, Math.max(1, windows.length)),
    };
  }

  // Modo 2 (retomar janelas pendentes): selection.estimate { run }
  if (name === 'selection.estimate' && asked.run && !asked.profileId) {
    ensureSelectionDemoInitialized();
    const runObj = selectionRuns.get(asked.run);
    if (runObj) {
      const efetivo = applyParcialOverlay(runObj);
      if (efetivo.windows.some((w) => w.state === 'uncertain')) {
        throw { code: 'window_uncertain', message: 'Esta execução tem Janela com chamada incerta: resolva a incerteza antes de retomar.' };
      }
    }
    const route = resolveSelectionRouteMock();
    return {
      paid: paid || !route.local,
      videoKind: runObj?.videoKind ?? 'direct',
      estimate: estimateForRoute(route, Math.max(1, asked.windows?.length ?? 1)),
    };
  }

  // Modo 1: selection.estimate { source_id, minUs?, maxUs?, videoKind? }
  if (name === 'selection.estimate') {
    if (selectionFlag('selection-blocked')) throw { code: 'context_too_small', message: 'O contexto efetivo de 4096 tokens (definido por você no perfil) não comporta a janela mínima. Aumente o contexto no Perfil de Provedor ou escolha outro perfil.' };
    const sid = asked.source_id ?? 4;
    if (!isTranscriptTest()) {
      const st = transcriptsBySource.get(sid);
      if (!st?.transcript) throw { code: 'transcript_missing', message: 'Transcrição não encontrada.' };
      if (st.transcript.state !== 'complete') throw { code: 'transcript_incomplete', message: 'A Transcrição ainda não foi concluída.' };
    }
    const minUs = asked.minUs ?? channelProfileMock.minUs;
    const maxUs = asked.maxUs ?? channelProfileMock.maxUs;
    if (minUs <= 0 || minUs >= maxUs) {
      throw { code: 'invalid_cut_range', message: 'A faixa de duração dos Cortes é inválida.' };
    }
    const kind = (asked.videoKind ?? channelProfileMock.videoKind) as 'direct' | 'transformed';
    if (kind !== 'direct' && kind !== 'transformed') {
      throw { code: 'invalid_video_kind', message: 'Tipo de vídeo inválido.' };
    }
    const route = resolveSelectionRouteMock();
    const veto = selectionFlag('selection-localonly') || (Boolean(getActiveProjectMock()) && projectVetoMock) || Boolean(assistantMock.localOnly.selection);
    if (veto && !route.local) {
      throw { code: 'local_only_violation', message: 'Bloqueado pelo modo Somente local.' };
    }
    const energyOn = selectionFlag('selection-energy') || energyMeasuredSources.has(sid);
    const chatOn = selectionFlag('selection-chat') || chatFetchedSources.has(sid) || chatMock.fetched;
    return {
      paid: paid || !route.local,
      profile: route.profile.id,
      minUs,
      maxUs,
      videoKind: kind,
      plan: {
        state: 'full',
        windows: [0, 1, 2, 3].map((index) => ({
          index,
          firstId: index * 90 + 1,
          lastId: index * 90 + 90,
          startUs: index * 720_000_000,
          endUs: index * 720_000_000 + 900_000_000,
        })),
        contextTokens: 32768,
      },
      weights: weightsOf(kind),
      energy: energyOn ? { measured: true, high: 4, peak: 2 } : { measured: false },
      chat: chatOn ? { available: true, peaks: 3, marked: 2 } : { available: false },
      estimate: estimateForRoute(route, 4),
    };
  }

  ensureSelectionDemoInitialized();
  if (name === 'selection.review' || name === 'selection.decide' || name === 'selection.adjust' || name === 'selection.undo' || name === 'selection.candidate.set_kind') {
    return selectionReviewMock(name, args);
  }

  if (name === 'selection.list') {
    const active = getActiveProjectMock();
    if (!active) throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto.' };
    if (readEstadoParam() === 'vazio') return [];
    const sid = asked.source_id;
    if (typeof sid !== 'number') throw { code: 'source_missing', message: 'Fonte não encontrada.' };
    const st = transcriptsBySource.get(sid);
    if (!st?.transcript && !isTranscriptTest()) {
      throw { code: 'transcript_missing', message: 'Transcrição não encontrada.' };
    }
    const ordemDemo = (r: MockSelectionRun) => (r.id >= 3 ? 1000 + r.id : r.id === 1 ? 2 : 1);
    return [...selectionRuns.values()]
      .filter((r) => r.sourceId === sid)
      .sort((a, b) => ordemDemo(b) - ordemDemo(a))
      .map(formatRunHead);
  }

  if (name === 'selection.start') {
    const active = getActiveProjectMock();
    if (!active) throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto.' };
    const sid = asked.source_id ?? 4;
    if (!sourceItems.some((s) => s.id === sid)) throw { code: 'source_missing', message: 'Fonte não encontrada.' };
    const st = transcriptsBySource.get(sid);
    if (!st?.transcript && !isTranscriptTest()) throw { code: 'transcript_missing', message: 'Transcrição não encontrada.' };
    if (st?.transcript && st.transcript.state !== 'complete' && !isTranscriptTest()) {
      throw { code: 'transcript_incomplete', message: 'A Transcrição ainda não foi concluída.' };
    }
    const minUs = asked.minUs ?? channelProfileMock.minUs;
    const maxUs = asked.maxUs ?? channelProfileMock.maxUs;
    if (minUs <= 0 || minUs >= maxUs) throw { code: 'invalid_cut_range', message: 'Faixa de duração inválida.' };
    const kind = (asked.videoKind ?? channelProfileMock.videoKind) as 'direct' | 'transformed';
    if (kind !== 'direct' && kind !== 'transformed') throw { code: 'invalid_video_kind', message: 'Tipo de vídeo inválido.' };
    const route = resolveSelectionRouteMock();
    const veto = selectionFlag('selection-localonly') || projectVetoMock || Boolean(assistantMock.localOnly.selection);
    if (veto && !route.local) throw { code: 'local_only_violation', message: 'Bloqueado pelo modo Somente local.' };
    if ((paid || !route.local) && !asked.confirmed) {
      throw { code: 'confirmation_required', message: 'Confirmação obrigatória.' };
    }

    const id = nextRunIdMock++;
    const jobBase = nextWindowJobIdMock;
    nextWindowJobIdMock += 4;
    const windows: MockSelectionWindow[] = [0, 1, 2, 3].map((index) => ({
      index,
      firstId: index * 90 + 1,
      lastId: index * 90 + 90,
      startUs: index * 720_000_000,
      endUs: index * 720_000_000 + 900_000_000,
      jobId: jobBase + index,
      state: index === 0 ? 'running' : 'queued',
      code: null,
      resetAtMs: null,
      profile: route.profile.id,
      redoFailed: null,
    }));
    const runObj: MockSelectionRun = {
      id,
      sourceId: sid,
      transcriptId: st?.transcript?.id ?? sid,
      state: 'running',
      videoKind: kind,
      minUs,
      maxUs,
      planState: 'full',
      profile: route.profile.id,
      revision: 1,
      revisions: [1],
      activeRevision: 1,
      budgetPause: null,
      createdAt: new Date().toISOString(),
      ticks: 1,
      cancelled: false,
      redone: false,
      energyMeasured: energyMeasuredSources.has(sid),
      chatAvailable: chatFetchedSources.has(sid) || chatMock.fetched,
      parcialResolved: false,
      windows,
      candidatesByRevision: new Map(),
      decisions: [],
      timers: [],
    };
    selectionRuns.set(id, runObj);

    const prefix = kind === 'transformed' ? 'ai:selection_transformed' : 'ai:selection';
    emitirProgressoMock({ job: String(windows[0].jobId), project: active.id, stage: `${prefix}:prepare`, percentage: 0, message: 'Preparando Janela 1', error: null });
    emitirProgressoMock({ job: String(windows[0].jobId), project: active.id, stage: `${prefix}:call`, percentage: 10, message: 'Consultando Provedor', error: null });

    const t1 = setTimeout(() => {
      if (runObj.cancelled) return;
      windows[0].state = 'completed';
      windows[1].state = 'completed';
      emitirProgressoMock({ job: String(windows[0].jobId), project: active.id, stage: `${prefix}:verify`, percentage: 80, message: 'Validando resposta', error: null });
      emitirProgressoMock({ job: String(windows[0].jobId), project: active.id, stage: `${prefix}:done`, percentage: 100, message: 'Janela 1 concluída', error: null });
      emitirProgressoMock({ job: `selection-${runObj.id}`, project: active.id, stage: 'selection:window', percentage: 50, message: 'Janela da seleção resolvida', error: null });
    }, 15);
    const t2 = setTimeout(() => {
      if (runObj.cancelled) return;
      for (const w of windows) {
        w.state = 'completed';
      }
      const candBase = nextCandidateIdMock;
      nextCandidateIdMock += 10;
      runObj.candidatesByRevision.set(1, buildCandidatesForRevision(1, kind, route.profile.id, runObj.chatAvailable, candBase));
      runObj.state = 'completed';
      emitirProgressoMock({ job: String(windows[3].jobId), project: active.id, stage: `${prefix}:done`, percentage: 100, message: 'Janela 4 concluída', error: null });
      emitirProgressoMock({ job: `selection-${runObj.id}`, project: active.id, stage: 'selection:done', percentage: 100, message: 'Seleção de Cortes concluída', error: null });
    }, 35);
    runObj.timers.push(t1, t2);

    return {
      run: id,
      batch: `selection-${id}`,
      videoKind: kind,
      minUs,
      maxUs,
      windows: 4,
      planState: 'full',
      weights: weightsOf(kind),
    };
  }

  if (name === 'selection.cancel') {
    const runObj = typeof asked.run === 'number' ? selectionRuns.get(asked.run) : undefined;
    if (!runObj) throw { code: 'run_not_found', message: 'Execução de seleção não encontrada.' };
    for (const t of runObj.timers) clearTimeout(t);
    runObj.timers = [];
    runObj.cancelled = true;
    runObj.state = 'partial';
    for (const w of runObj.windows) {
      if (w.state === 'queued' || w.state === 'running') {
        w.state = 'cancelled';
        w.code = 'cancelled';
      }
    }
    const active = getActiveProjectMock();
    emitirProgressoMock({ job: `selection-${runObj.id}`, project: active?.id ?? null, stage: 'selection:done', percentage: 100, message: 'Seleção cancelada', error: null });
    return null;
  }
  if (name === 'selection.resume') {
    const runObj = typeof asked.run === 'number' ? selectionRuns.get(asked.run) : undefined;
    if (!runObj) throw { code: 'run_not_found', message: 'Execução de seleção não encontrada.' };
    const efetivo = applyParcialOverlay(runObj);
    if (efetivo.windows.some((w) => w.state === 'uncertain')) {
      throw { code: 'window_uncertain', message: 'Esta execução tem Janela com chamada incerta: resolva a incerteza antes de retomar.' };
    }
    const route = resolveSelectionRouteMock();
    if ((paid || !route.local) && !asked.confirmed) {
      throw { code: 'confirmation_required', message: 'Confirmação obrigatória.' };
    }
    const retomar = runObj.windows.filter((w) => w.state === 'failed' || w.state === 'cancelled').map((w) => w.index);
    runObj.state = 'completed';
    for (const w of runObj.windows) {
      if (w.state === 'failed' || w.state === 'cancelled') {
        w.state = 'completed';
        w.code = null;
      }
    }
    return { run: runObj.id, windows: retomar };
  }

  if (name === 'selection.redo') {
    const runObj = typeof asked.run === 'number' ? selectionRuns.get(asked.run) : undefined;
    if (!runObj) throw { code: 'run_not_found', message: 'Execução de seleção não encontrada.' };
    const efetivo = applyParcialOverlay(runObj);
    const wanted = Array.isArray(asked.windows) ? asked.windows : [];

    if (asked.profileId) {
      if (wanted.length === 0) throw { code: 'windows_required', message: 'Escolha a(s) Janela(s) da seleção a refazer.' };
      for (const idx of wanted) {
        const w = efetivo.windows.find((win) => win.index === idx);
        if (!w) throw { code: 'window_not_found', message: 'Janela da seleção não encontrada.' };
        if (w.state === 'uncertain') throw { code: 'window_uncertain', message: 'A chamada desta Janela tem resultado incerto: resolva a incerteza antes de refazer com outro perfil.' };
        if (w.state === 'queued' || w.state === 'running') throw { code: 'window_not_redoable', message: 'Só uma Janela concluída, que falhou ou foi cancelada pode ser refeita.' };
      }
      const route = resolveSelectionRouteMock(asked.profileId);
      const veto = selectionFlag('selection-localonly') || (Boolean(getActiveProjectMock()) && projectVetoMock) || Boolean(assistantMock.localOnly.selection);
      if (veto && !route.local) throw { code: 'local_only_violation', message: 'Bloqueado pelo modo Somente local.' };
      if (!route.local && !asked.confirmed) throw { code: 'confirmation_required', message: 'Confirmação obrigatória.' };

      const active = getActiveProjectMock();
      const nextRev = runObj.revision + 1;
      const prefix = runObj.videoKind === 'transformed' ? 'ai:selection_transformed' : 'ai:selection';
      runObj.state = 'running';
      for (const idx of wanted) {
        const w = runObj.windows.find((win) => win.index === idx);
        if (w) {
          w.state = 'running';
          w.profile = route.profile.id;
          w.code = null;
        }
      }
      const firstWin = runObj.windows.find((w) => wanted.includes(w.index));
      if (firstWin?.jobId) {
        emitirProgressoMock({ job: String(firstWin.jobId), project: active?.id ?? null, stage: `${prefix}:call`, percentage: 10, message: 'Refazendo janela com novo Perfil', error: null });
      }
      const tRedo = setTimeout(() => {
        for (const idx of wanted) {
          const w = runObj.windows.find((win) => win.index === idx);
          if (w) w.state = 'completed';
        }
        const candBase = nextCandidateIdMock;
        nextCandidateIdMock += 10;
        runObj.revision = nextRev;
        if (!runObj.revisions.includes(nextRev)) runObj.revisions.push(nextRev);
        runObj.activeRevision = nextRev;
        runObj.candidatesByRevision.set(nextRev, buildCandidatesForRevision(nextRev, runObj.videoKind, route.profile.id, runObj.chatAvailable, candBase));
        runObj.state = 'completed';
        if (firstWin?.jobId) {
          emitirProgressoMock({ job: String(firstWin.jobId), project: active?.id ?? null, stage: `${prefix}:done`, percentage: 100, message: 'Janela refeita', error: null });
        }
        emitirProgressoMock({ job: `selection-${runObj.id}`, project: active?.id ?? null, stage: 'selection:done', percentage: 100, message: 'Nova revisão disponível', error: null });
      }, 20);
      runObj.timers.push(tRedo);
      return { run: runObj.id, windows: wanted, profile: route.profile };
    }

    if (efetivo.windows.some((w) => w.state === 'uncertain')) {
      throw { code: 'window_uncertain', message: 'Esta execução tem Janela com chamada incerta.' };
    }
    return { run: runObj.id, windows: wanted };
  }

  if (name === 'selection.get') {
    const runObj = typeof asked.run === 'number' ? selectionRuns.get(asked.run) : undefined;
    if (!runObj) throw { code: 'run_not_found', message: 'Execução de seleção não encontrada.' };
    if (typeof asked.revision === 'number') {
      if (runObj.candidatesByRevision.has(asked.revision)) {
        runObj.activeRevision = asked.revision;
      }
    }
    const efetivo = applyParcialOverlay(runObj);
    const head = formatRunHead(runObj);
    const rev = typeof asked.revision === 'number' && runObj.candidatesByRevision.has(asked.revision)
      ? asked.revision
      : runObj.activeRevision;
    const candidates = (runObj.candidatesByRevision.get(rev) ?? []).map((c) => ({ ...c }));
    return {
      run: head,
      windows: efetivo.windows.map((w) => ({ ...w })),
      candidates,
    };
  }

  throw { code: 'run_not_found', message: 'Execução de seleção não encontrada.' };
}

export async function coreDispatch<T>(name: string, args: object): Promise<T> {
  if (import.meta.env.VITE_CORE_MOCK === '1' && !isTauri()) {
    if (name === 'jobs.cancel' && cancelReframeJobMock((args as { id: number }).id)) return null as T;
    if (name === 'export.readiness') {
      const active = getActiveProjectMock();
      if (!active) throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto.' };
      const a = args as { source_id?: unknown; sourceId?: unknown; limit?: unknown; offset?: unknown };
      const parseOptionalId = (val: unknown, label: string): number | null => {
        if (val === undefined || val === null) return null;
        if (typeof val !== 'number' || !Number.isInteger(val) || val <= 0) {
          throw { code: 'invalid_input', message: `Parâmetro ${label} inválido.` };
        }
        return val;
      };
      const snakeSid = parseOptionalId(a.source_id, 'source_id');
      const camelSid = parseOptionalId(a.sourceId, 'sourceId');
      if (snakeSid !== null && camelSid !== null && snakeSid !== camelSid) {
        throw { code: 'invalid_input', message: 'source_id e sourceId informados com valores diferentes.' };
      }
      const scopeSource = snakeSid ?? camelSid;
      if (scopeSource !== null && !sourceItems.some((s) => s.id === scopeSource)) {
        throw { code: 'source_missing', message: 'Fonte não encontrada.' };
      }
      const parseNonNegInt = (val: unknown, label: string): number | null => {
        if (val === undefined || val === null) return null;
        if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
          throw { code: 'invalid_input', message: `Parâmetro ${label} inválido.` };
        }
        return val;
      };
      const offset = parseNonNegInt(a.offset, 'offset') ?? 0;
      const limit = parseNonNegInt(a.limit, 'limit');

      if (readEstadoParam() === 'vazio') {
        return { total: 0, offset, limit, hasMore: false, items: [] } as T;
      }

      ensureSelectionDemoInitialized();
      const offlineForcado = !hasSearchFlag('source-test') && readEstadoParam() === 'offline';
      const ack = channelProfileMock.directMonetizationAck;

      type PlannedMockCut = {
        candidateId: number;
        runId: number;
        sourceId: number;
        videoKind: 'direct' | 'transformed';
        candidateTitle: string;
        scoreTotal: number;
        adjusted: boolean;
        startId: number;
        endId: number;
        startUs: number;
        endUs: number;
        durationUs: number;
      };

      const planned: PlannedMockCut[] = [];
      if (hasSearchFlag('source-test')) {
        const src = sourceItems.find((s) => (scopeSource !== null ? s.id === scopeSource : s.id === 1)) ?? sourceItems[0];
        if (src && (scopeSource === null || src.id === scopeSource)) {
          for (const [id, r] of reviewMock.items.entries()) {
            if (r.status !== 'approved') continue;
            const kind = effectiveCandidateKind(id);
            const startUs = (r.start - 1) * 10_000_000;
            const endUs = r.end * 10_000_000;
            planned.push({
              candidateId: id,
              runId: 1,
              sourceId: src.id,
              videoKind: kind,
              candidateTitle: `Corte ${id}`,
              scoreTotal: 8.0,
              adjusted: r.start !== r.origin[0] || r.end !== r.origin[1],
              startId: r.start,
              endId: r.end,
              startUs,
              endUs,
              durationUs: Math.max(1, endUs - startUs),
            });
          }
        }
      } else {
        const orderedRuns = [...selectionRuns.values()].sort((x, y) => x.id - y.id);
        for (const run of orderedRuns) {
          if (scopeSource !== null && run.sourceId !== scopeSource) continue;
          const activeList = run.candidatesByRevision.get(run.activeRevision) ?? [];
          for (const cand of activeList) {
            const revItem = buildReviewItemForRun(cand, run);
            if (revItem.status !== 'approved') continue;
            const kind = (cand.videoKind ?? run.videoKind) === 'transformed' ? 'transformed' : 'direct';
            planned.push({
              candidateId: cand.id,
              runId: run.id,
              sourceId: run.sourceId,
              videoKind: kind,
              candidateTitle: cand.title,
              scoreTotal: cand.total,
              adjusted: revItem.adjusted,
              startId: revItem.startId,
              endId: revItem.endId,
              startUs: revItem.startUs,
              endUs: revItem.endUs,
              durationUs: Math.max(1, revItem.endUs - revItem.startUs),
            });
          }
        }
      }

      const total = planned.length;
      const slice = limit === null ? planned.slice(offset) : planned.slice(offset, offset + limit);
      const items = slice.map((cut) => {
        const src = sourceItems.find((s) => s.id === cut.sourceId) ?? sourceItems[0];
        const status = offlineForcado ? 'offline' : (src?.status ?? 'available');
        const available = status === 'available';
        const srcName = src?.path.split(/[\\/]/).pop() || src?.path || `fonte-${cut.sourceId}`;
        const permObj = (src?.permission ?? { status: 'none' }) as { status: string; who?: string; where?: string; scope?: string };
        const granted = permObj.status === 'granted';

        const isTransformed = cut.videoKind === 'transformed';
        const scriptDoc = isTransformed
          ? (peekScriptMock(cut.candidateId) as {
              current?: { blocks?: unknown[]; pending?: number } | null;
              narrationAllowed?: boolean;
              busy?: boolean;
            })
          : null;
        const totalBlocks = scriptDoc?.current?.blocks?.length ?? 0;
        const pendingBlocks = scriptDoc?.current?.pending ?? 0;
        const scriptJson = isTransformed
          ? {
              applicable: true,
              exists: Boolean(scriptDoc?.current),
              approved: Boolean(scriptDoc?.narrationAllowed),
              pendingBlocks,
              totalBlocks,
              busy: Boolean(scriptDoc?.busy),
            }
          : { applicable: false };

        const narrEntries = isTransformed ? (narrationGenerated.get(cut.candidateId) ?? []) : [];
        const ttsEntries = narrEntries.filter((x) => x.engineId !== 'imported' && x.engineId !== 'recorded');
        const readyBlocks = narrEntries.length;
        const narrationJson = isTransformed
          ? {
              applicable: true,
              hasTts: ttsEntries.length > 0,
              generatedBlocks: ttsEntries.length,
              readyBlocks,
              ready: totalBlocks > 0 && readyBlocks >= totalBlocks,
              totalBlocks,
              voices: [...new Set(ttsEntries.map((x) => x.voiceId))],
              freezeTailUs: 0,
              longFreezeTail: false,
              busy: false,
            }
          : { applicable: false };

        const pkgRaw = packagingMockDispatch('packaging.get', { candidate: cut.candidateId }, {
          videoKind: cut.videoKind,
          scriptAllowed: Boolean(scriptDoc?.narrationAllowed),
          blocks: [],
          source: cut.sourceId,
          permission: hasSearchFlag('source-test') ? undefined : permObj,
          originUrl: src?.origin_url ?? null,
          detectedLanguage: src?.language === 'en' ? 'en' : src?.language === 'und' ? null : 'pt-BR',
          languageRequired: src?.language === 'und',
        }) as { current?: unknown; credit?: unknown; chapters?: unknown; job?: unknown };

        const thumbRaw = thumbnailMockDispatch('thumbnail.get', { candidate: cut.candidateId }, {
          getCandidateInfo: () => ({
            source: cut.sourceId,
            cut: { startUs: cut.startUs, endUs: cut.endUs },
            sourceStatus: status,
          }),
          isFfmpegInstalled: () => ffmpegMock.installed,
          isSourceTest: () => hasSearchFlag('source-test'),
        }) as { current?: unknown; job?: unknown };

        const over60s = cut.durationUs > 60_000_000;
        const permGuardrail = {
          status: granted ? 'granted' : 'none',
          grantedCount: granted ? 1 : 0,
          missingCount: granted ? 0 : 1,
          totalCount: 1,
          who: granted ? (permObj.who ?? null) : null,
          where: granted ? (permObj.where ?? null) : null,
          scope: granted ? (permObj.scope ?? null) : null,
        };
        const guardrailsJson = {
          scope: 'single',
          directMonetizationAck: ack,
          needsDirectNotice: !ack && cut.videoKind === 'direct',
          videoKind: cut.videoKind,
          hasDirect: cut.videoKind === 'direct',
          hasTransformed: isTransformed,
          totalCuts: 1,
          durationUs: cut.durationUs,
          over60s,
          over60sCount: over60s ? 1 : 0,
          shortClaimLimitUs: 60_000_000,
          permission: permGuardrail,
          script: scriptJson,
          narration: narrationJson,
          audio: { hasAudio: false, assetCount: 0, unverifiedCount: 0 },
        };

        return {
          candidateId: cut.candidateId,
          runId: cut.runId,
          sourceId: cut.sourceId,
          clipId: null,
          videoKind: cut.videoKind,
          candidateTitle: cut.candidateTitle,
          scoreTotal: cut.scoreTotal,
          adjusted: cut.adjusted,
          startId: cut.startId,
          endId: cut.endId,
          startUs: cut.startUs,
          endUs: cut.endUs,
          durationUs: cut.durationUs,
          source: {
            id: cut.sourceId,
            name: srcName,
            path: src?.path ?? '',
            status,
            available,
            online: available,
            permission: permObj,
          },
          packaging: {
            ready: Boolean(pkgRaw?.current),
            current: pkgRaw?.current ?? null,
            credit: pkgRaw?.credit ?? { text: null, warning: granted ? null : 'no_permission' },
            chapters: pkgRaw?.chapters ?? { applicable: isTransformed, status: isTransformed ? 'script_not_approved' : 'not_transformed', canGenerate: false },
            job: pkgRaw?.job ?? null,
          },
          thumbnail: {
            ready: Boolean(thumbRaw?.current),
            current: thumbRaw?.current ?? null,
            job: thumbRaw?.job ?? null,
          },
          script: scriptJson,
          narration: narrationJson,
          guardrails: guardrailsJson,
        };
      });

      return {
        total,
        offset,
        limit,
        hasMore: offset + items.length < total,
        items,
      } as T;
    }
    if ((name.startsWith('export.') && name !== 'export.captions') || (name === 'jobs.cancel' && (args as {id: number}).id >= 5900)) return exportMock(name, args, (source, pos) => mockCorrected.has(`${source}:${pos}`), { project: getActiveProjectMock(), emitProgress: emitirProgressoMock }) as T;
    if (name === 'transcription.groq.info') {
      return {
        endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
        model: 'whisper-large-v3-turbo',
        configured: groqKeyConfigured,
        confirmed: groqConsent,
        local_only: projectVetoMock,
        prices: {
          source: 'https://console.groq.com/docs/speech-to-text',
          checked: '2026-11-15',
          currency: 'USD',
          minimum_seconds: 10,
          models: { 'whisper-large-v3-turbo': { hourly_usd: 0.04 } },
        },
      } as T;
    }
    if (name === 'transcription.groq.estimate') {
      const sid = (args as { source_id?: number }).source_id;
      const src = typeof sid === 'number' ? sourceItems.find((s) => s.id === sid) : undefined;
      if (typeof sid === 'number' && !src) {
        throw { code: 'source_missing', message: 'Fonte não encontrada.' };
      }
      return {
        kind: 'usd',
        usd: 0.00012,
        minMicroUsd: 120,
        maxMicroUsd: 240,
        audio_us: 10_000_000,
        hourly_usd: 0.04,
        checked: '2026-11-15',
        source: 'https://console.groq.com/docs/speech-to-text',
      } as T;
    }
    if (name === 'transcription.groq.confirm') { groqConsent = true; return {confirmed:true} as T; }
    if (name === 'transcription.groq.key.status') return {configured:groqKeyConfigured} as T;
    if (name === 'transcription.groq.key.set') { groqKeyConfigured = true; return {configured:true} as T; }
    if (name === 'transcription.groq.key.remove') { groqKeyConfigured = false; return {configured:false} as T; }
    if (name === 'transcription.groq.key.test') return {ok:true} as T;
    if (name === 'diagnostic.get') {
      const cpu = isHardwareCpuMode();
      const encoderInfo = exportMock('export.encoder.status', {}) as { effective?: string };
      const lines = [
        `Clipes: ${version}`,
        'Sistema operacional: windows',
        'Etapa da falha: componente',
        'Avisos e erros: [2026-11-18T17:00:00Z] encoder: fallback h264_nvenc -> libx264',
        `Componentes: ffmpeg=${ffmpegMock.installed ? 'ok' : 'ausente'}, yt-dlp=${ytdlpMock.installed ? 'ok' : 'ausente'}, deno=${denoMock.installed ? 'ok' : 'ausente'}`,
        `GPU / VRAM: ${cpu ? 'indisponível (CPU)' : 'NVIDIA GeForce RTX 3050 Laptop GPU (3962/4096 MiB)'}`,
        `Encoder: ${encoderInfo.effective ?? 'libx264'} (fallback: libx264)`,
        `Motor de transcrição: ${cpu ? 'local (whisper-small cpu int8)' : 'local (whisper-turbo cuda int8_float16)'}`,
        `Provedor: ${providerMock.kind} (${providerMock.model || 'não configurado'})`,
        'Calibração de tokens: fator=1.00',
        'Versão da tarefa: selection=3',
        'Hash do prompt: e00332d06248cff669ccb8922aae9d50190a7e30715630e566c4943941469b8a',
        `Contexto efetivo (tokens): ${providerMock.context ?? 8192}`,
        `Origem do contexto efetivo: ${providerMock.context ? 'user' : 'fallback'}`,
      ];
      return { text: lines.join('\n') } as T;
    }
    if (name === 'diagnostic.export') {
      const a = args as { path?: unknown; text?: unknown };
      const rawPath = typeof a.path === 'string' ? a.path.trim() : '';
      if (!rawPath || !isAbsolutePathMock(rawPath) || !rawPath.toLowerCase().endsWith('.txt')) {
        throw { code: 'invalid_path', message: 'Caminho inválido' };
      }
      if (typeof a.text !== 'string' || !a.text.trim()) {
        throw { code: 'invalid_text', message: 'Texto inválido' };
      }
      return {} as T;
    }
    if (name === 'projects.recent') {
      if (readEstadoParam() === 'vazio') return [] as T;
      return recentProjectsMock.map((p) => ({ ...p })) as T;
    }
    if (name === 'projects.current') {
      const active = getActiveProjectMock();
      return (active ? { ...active } : null) as T;
    }
    if (name === 'projects.create') {
      const a = args as { name?: unknown; parent?: unknown };
      const rawName = typeof a.name === 'string' ? a.name.trim() : '';
      if (!rawName || rawName === '.' || rawName === '..' || /[\\/:]/.test(rawName)) {
        throw { code: 'invalid_project', message: 'Nome de Projeto inválido.' };
      }
      const rawParent = typeof a.parent === 'string' ? a.parent.trim() : '';
      if (!rawParent) {
        throw { code: 'invalid_project', message: 'Pasta de destino obrigatória.' };
      }
      const sep = rawParent.includes('\\') && !rawParent.includes('/') ? '\\' : '/';
      const cleanParent = rawParent.replace(/[\\/]+$/, '') || sep;
      const fullPath = cleanParent === sep ? `${sep}${rawName}.clipes` : `${cleanParent}${sep}${rawName}.clipes`;
      const created: ProjectMock = { id: slugifyProjectId(rawName), name: rawName, path: fullPath, warning: null };
      currentProjectMock = created;
      currentProjectTouched = true;
      resetSelectionMockState();
      resetProxyMockState();
      resetExportMockState();
      resetJobsMockState();
      recentProjectsMock = [
        { available: true, name: created.name, path: created.path },
        ...recentProjectsMock.filter((p) => p.path !== created.path),
      ];
      return { id: created.id, name: created.name, path: created.path } as T;
    }
    if (name === 'projects.open') {
      const a = args as { path?: unknown };
      const rawPath = typeof a.path === 'string' ? a.path.trim() : '';
      const cleanPath = rawPath.replace(/[\\/]+$/, '');
      if (!cleanPath || !cleanPath.toLowerCase().endsWith('.clipes')) {
        throw { code: 'invalid_project', message: 'Escolha uma pasta .clipes válida.' };
      }
      if (cleanPath.toLowerCase().endsWith('futuro.clipes')) {
        throw { code: 'newer_project', message: 'Este Projeto foi criado por uma versão mais nova do Clipes.' };
      }
      if (cleanPath.toLowerCase().endsWith('ocupado.clipes') || hasSearchFlag('project-busy')) {
        throw { code: 'project_busy', message: 'Há uma tarefa ativa no Projeto atual impedindo a troca.' };
      }
      const base = cleanPath.split(/[\\/]/).pop() ?? cleanPath;
      const derivedName = base.replace(/\.clipes$/i, '') || 'Projeto';
      const existing = recentProjectsMock.find((p) => p.path === cleanPath);
      const projName = existing?.name ?? derivedName;
      const warning = cleanPath.toLowerCase().endsWith('aviso.clipes')
        ? 'Backup automático falhou na última execução.'
        : null;
      const opened: ProjectMock = {
        id: cleanPath === '/test/Teste.clipes' ? 'test-project' : slugifyProjectId(projName),
        name: projName,
        path: cleanPath,
        warning,
      };
      currentProjectMock = opened;
      currentProjectTouched = true;
      resetSelectionMockState();
      resetProxyMockState();
      resetExportMockState();
      resetJobsMockState();
      recentProjectsMock = [
        { available: true, name: opened.name, path: opened.path },
        ...recentProjectsMock.filter((p) => p.path !== opened.path),
      ];
      return { id: opened.id, name: opened.name, path: opened.path } as T;
    }
    if (name === 'projects.close') {
      const active = getActiveProjectMock();
      if (active && (hasSearchFlag('project-busy') || (activeMockJobs.get(active.id)?.size ?? 0) > 0)) {
        throw { code: 'project_busy', message: 'Há uma tarefa ativa bloqueando esta operação no Projeto.' };
      }
      currentProjectMock = null;
      currentProjectTouched = true;
      projectVetoMock = false;
      resetSelectionMockState();
      resetProxyMockState();
      resetExportMockState();
      resetJobsMockState();
      return null as T;
    }
    if (name === 'projects.local_only.get') {
      const active = getActiveProjectMock();
      return { open: Boolean(active), enabled: Boolean(active) && projectVetoMock } as T;
    }
    if (name === 'projects.local_only.set') {
      const active = getActiveProjectMock();
      projectVetoMock = (args as { enabled: boolean }).enabled;
      return { open: Boolean(active), enabled: Boolean(active) && projectVetoMock } as T;
    }
    if (name === 'channel_profile.languages') return [{ code: 'pt', name: 'portuguese' }, { code: 'en', name: 'english' }, { code: 'es', name: 'spanish' }] as T;
    if (name === 'channel_profile.get') return channelProfileView() as T;
    if (name === 'channel_profile.set') {
      const a = args as Partial<typeof channelProfileMock> & { captionStyle?: ReturnType<typeof getDefaultCaptionStyleMock> };
      const minUs = a.minUs ?? channelProfileMock.minUs;
      const maxUs = a.maxUs ?? channelProfileMock.maxUs;
      if (minUs <= 0 || minUs >= maxUs || maxUs > 180_000_000) throw { code: 'invalid_cut_range', message: 'A faixa de duração dos Cortes é inválida.' };
      if (a.narrationVoice && !['13063', 'alba', 'marius'].includes(a.narrationVoice)) throw { code: 'channel_profile_invalid', message: 'Voz inválida.' };
      channelProfileMock = {
        videoKind: a.videoKind ?? channelProfileMock.videoKind,
        language: a.language ?? channelProfileMock.language,
        minUs,
        maxUs,
        allowedSources: a.allowedSources ?? channelProfileMock.allowedSources,
        narrationVoice: a.narrationVoice === undefined ? channelProfileMock.narrationVoice : a.narrationVoice,
        directMonetizationAck: channelProfileMock.directMonetizationAck,
      };
      if (a.captionStyle) setDefaultCaptionStyleMock(a.captionStyle);
      return channelProfileView() as T;
    }
    if (name === 'guardrails.ack_direct_notice') {
      channelProfileMock = { ...channelProfileMock, directMonetizationAck: true };
      return { directMonetizationAck: true } as T;
    }
    if (name === 'guardrails.check') {
      const a = args as { scope?: string; source_id?: number; candidate_id?: number; start_id?: number; end_id?: number };
      const scope = a.scope ?? 'single';
      const ack = channelProfileMock.directMonetizationAck;
      const latestRun = !hasSearchFlag('source-test')
        ? ([...selectionRuns.values()].filter((r) => r.id >= 3).at(-1) ?? selectionRuns.get(1))
        : undefined;
      const candidateHit = typeof a.candidate_id === 'number' && !hasSearchFlag('source-test')
        ? findRunAndCandidateById(a.candidate_id)
        : null;
      const candOverride = typeof a.candidate_id === 'number' && hasSearchFlag('source-test')
        ? reviewMock.items.get(a.candidate_id)?.videoKindOverride
        : undefined;
      const videoKind =
        candOverride ??
        candidateHit?.candidate.videoKind ??
        candidateHit?.run.videoKind ??
        selectionMock.run?.videoKind ??
        latestRun?.videoKind ??
        channelProfileMock.videoKind;
      const hasDirect = videoKind === 'direct';
      const hasTransformed = videoKind === 'transformed';
      if (scope === 'single') {
        const src = sourceItems.find(s => s.id === (a.source_id ?? candidateHit?.run.sourceId ?? 1)) ?? sourceItems[0];
        const granted = src?.permission?.status === 'granted';
        const permObj = src?.permission as { who?: string; where?: string; scope?: string } | undefined;
        let durationUs = 50_000_000;
        if (typeof a.start_id === 'number' && typeof a.end_id === 'number' && a.end_id >= a.start_id) {
          durationUs = (a.end_id - a.start_id + 1) * 10_000_000;
        } else if (candidateHit) {
          const item = buildReviewItemForRun(candidateHit.candidate, candidateHit.run);
          durationUs = Math.max(10_000_000, item.endUs - item.startUs);
        } else if (typeof a.candidate_id === 'number') {
          const r = reviewMock.items.get(a.candidate_id);
          if (r) durationUs = (r.end - r.start + 1) * 10_000_000;
        }
        const over60s = durationUs > 60_000_000;
        const montageInfo = typeof (a as { clip_id?: number }).clip_id === 'number'
          ? (editorEditsMock('editor.montage.get', { clip_id: (a as { clip_id?: number }).clip_id }) as { montage?: { freezeTailUs?: number } | null } | undefined)
          : undefined;
        const freezeTailUs = montageInfo?.montage?.freezeTailUs ?? 0;
        const effectiveTransformed = hasTransformed || freezeTailUs > 0 || !!montageInfo?.montage;
        const effectiveKind = effectiveTransformed ? 'transformed' : videoKind;
        const scriptView = effectiveTransformed ? (scriptMockDispatch('script.get', { candidate: a.candidate_id ?? 1 }) as { current?: { blocks?: unknown[]; pending?: number } | null; narrationAllowed?: boolean }) : null;
        const audioInfo = typeof (a as { clip_id?: number }).clip_id === 'number'
          ? (editorEditsMock('editor.audio.get', { clip_id: (a as { clip_id?: number }).clip_id }) as { audioMix?: { soundtrack?: { assetId: number; licenseVerified: boolean } | null; sfx: { assetId: number; licenseVerified: boolean }[]; unverifiedCount: number } } | undefined)?.audioMix
          : undefined;
        const usedIds = new Set<number>();
        if (audioInfo?.soundtrack) usedIds.add(audioInfo.soundtrack.assetId);
        for (const item of audioInfo?.sfx ?? []) usedIds.add(item.assetId);
        return {
          scope: 'single',
          directMonetizationAck: ack,
          needsDirectNotice: !ack && effectiveKind === 'direct',
          videoKind: effectiveKind,
          hasDirect: effectiveKind === 'direct',
          hasTransformed: effectiveTransformed,
          totalCuts: 1,
          durationUs,
          over60s,
          over60sCount: over60s ? 1 : 0,
          shortClaimLimitUs: 60_000_000,
          permission: { status: granted ? 'granted' : 'none', grantedCount: granted ? 1 : 0, missingCount: granted ? 0 : 1, totalCount: 1, who: permObj?.who ?? null, where: permObj?.where ?? null, scope: permObj?.scope ?? null },
          script: effectiveTransformed ? { applicable: true, exists: !!scriptView?.current, approved: !!scriptView?.narrationAllowed, pendingBlocks: scriptView?.current?.pending ?? 0, totalBlocks: scriptView?.current?.blocks?.length ?? 0 } : { applicable: false },
          narration: effectiveTransformed ? (() => { const g = (narrationGenerated.get(a.candidate_id ?? 1) ?? []).filter(x => x.engineId !== 'imported' && x.engineId !== 'recorded'); return { applicable: true, hasTts: g.length > 0, generatedBlocks: g.length, totalBlocks: scriptView?.current?.blocks?.length ?? 0, voices: [...new Set(g.map(x => x.voiceId))], freezeTailUs, longFreezeTail: freezeTailUs > 5_000_000 }; })() : { applicable: false },
          audio: { hasAudio: usedIds.size > 0, assetCount: usedIds.size, unverifiedCount: audioInfo?.unverifiedCount ?? 0 },
        } as T;
      }
      const hasRunsForScope = Boolean(selectionMock.run) || (!hasSearchFlag('source-test') && (scope === 'project' ? selectionRuns.size > 0 : [...selectionRuns.values()].some((r) => r.sourceId === (a.source_id ?? 1))));
      const totalCuts = selectionFlag('export-batch-empty') || (scope === 'source' && !hasRunsForScope) ? 0 : 2;
      const batchSrc = sourceItems.find(s => s.id === (a.source_id ?? 1)) ?? sourceItems[0];
      const batchGranted = batchSrc?.permission?.status === 'granted';
      return {
        scope,
        directMonetizationAck: ack,
        needsDirectNotice: !ack && totalCuts > 0 && hasDirect,
        videoKind,
        hasDirect: totalCuts > 0 && hasDirect,
        hasTransformed: totalCuts > 0 && hasTransformed,
        totalCuts,
        durationUs: totalCuts > 0 ? 50_000_000 : 0,
        over60s: false,
        over60sCount: 0,
        shortClaimLimitUs: 60_000_000,
        permission: totalCuts === 0
          ? { status: 'none', grantedCount: 0, missingCount: 0, totalCount: 0 }
          : { status: batchGranted ? 'granted' : 'none', grantedCount: batchGranted ? totalCuts : 0, missingCount: batchGranted ? 0 : totalCuts, totalCount: totalCuts },
        script: hasTransformed && totalCuts > 0 ? { applicable: true, transformedCount: totalCuts, approvedCount: 0, unapprovedCount: totalCuts } : { applicable: false },
        narration: hasTransformed && totalCuts > 0
          ? { applicable: true, hasTts: false, ttsCutCount: 0, transformedCount: totalCuts, freezeTailCount: 0, longFreezeTailCount: 0, maxFreezeTailUs: 0 }
          : { applicable: false },
        audio: { hasAudio: false, cutsWithAudio: 0, cutsWithUnverifiedAudio: 0, unverifiedCount: 0 },
      } as T;
    }
    if (name === 'jobs.budget.get' || name === 'jobs.budget.set' || name === 'jobs.budget.continue') {
      const active = getActiveProjectMock();
      if (!active) throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto.' };
      const handled = batchMockDispatch(name, args, emitirProgressoMock, active.id);
      if (handled !== undefined) return handled as T;
    }
    if (name.startsWith('batches.')) {
      const active = getActiveProjectMock();
      if (!active) throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto.' };
      if (name === 'batches.create') {
        const eng = (args as { engine?: string }).engine;
        const selectionBlocked = assistantTasks().tasks.find((t) => t.task === 'selection')?.blocked;
        if ((eng === 'groq' && projectVetoMock) || selectionBlocked) {
          throw { code: 'local_only_violation', message: 'Bloqueado pelo modo Somente local.' };
        }
      }
      const sourceNames = Object.fromEntries(
        sourceItems.map((s) => [s.id, s.path.split(/[\\/]/).pop() || s.path]),
      );
      const handled = batchMockDispatch(name, args, emitirProgressoMock, active.id, sourceNames);
      if (handled !== undefined) return handled as T;
    }
    const getCandidateInfoForMock = (candidate: number) => {
      const candHit = !hasSearchFlag('source-test') ? findRunAndCandidateById(candidate) : null;
      const sourceId = candHit?.run.sourceId ?? (hasSearchFlag('source-test') ? 1 : 4);
      const src = sourceItems.find((s) => s.id === sourceId) ?? sourceItems[0];
      const offlineOverride = readEstadoParam() === 'offline';
      const sourceStatus: 'available' | 'offline' | 'changed' = offlineOverride
        ? 'offline'
        : (src?.status ?? 'available');
      const videoKind: 'direct' | 'transformed' =
        ((hasSearchFlag('source-test')
          ? reviewMock.items.get(candidate)?.videoKindOverride
          : candHit?.candidate.videoKind) ??
          candHit?.run.videoKind ??
          selectionMock.run?.videoKind ??
          channelProfileMock.videoKind) === 'transformed'
          ? 'transformed'
          : 'direct';
      const cut = candHit
        ? { startUs: candHit.candidate.startUs, endUs: candHit.candidate.endUs }
        : { startUs: 60_000_000, endUs: 120_000_000 };
      return {
        candHit,
        source: src?.id ?? sourceId,
        sourceStatus,
        permission: src?.permission ?? { status: 'none' },
        originUrl: src?.origin_url ?? null,
        detectedLanguage: src?.language === 'en' ? 'en' : src?.language === 'und' ? null : 'pt-BR',
        languageRequired: src?.language === 'und',
        videoKind,
        cut,
      };
    };

    const resolveAiTaskRoute = (task: 'script' | 'packaging', profileId?: string) => {
      const choice = profileId
        ? profileId === 'legacy'
          ? 'endpoint'
          : ['codex', 'claude', 'opencode'].includes(profileId)
            ? profileId
            : `profile:${profileId}`
        : assistantMock.tasks[task] || assistantMock.default || (providerMock.endpoint ? 'endpoint' : '');
      const target = choice ? taskTarget(choice) : null;
      if (!target) {
        return {
          profile: profileId ?? 'legacy',
          local: false,
          cli: false,
          paid: false,
          blockedLocalOnly: false,
          estimate: { kind: 'unknown', minMicroUsd: null, maxMicroUsd: null },
        };
      }
      const veto = Boolean(assistantMock.localOnly[task]) || (Boolean(getActiveProjectMock()) && projectVetoMock);
      const freeCli = target.cli && target.kind === 'opencode' && target.cost.kind === 'zero';
      const paid = !target.local && !freeCli;
      const estimate = target.local
        ? { kind: 'zero', minMicroUsd: 0, maxMicroUsd: 0 }
        : target.cli
          ? { kind: freeCli ? 'zero' : 'plan_quota', minMicroUsd: freeCli ? 0 : null, maxMicroUsd: freeCli ? 0 : null }
          : { kind: 'usd', minMicroUsd: 300, maxMicroUsd: 1200 };
      return {
        profile: target.id,
        local: target.local,
        cli: target.cli,
        paid,
        blockedLocalOnly: veto && !target.local,
        estimate,
      };
    };

    const checkCandidateTransformed = (candidate: number) => {
      if (hasSearchFlag('source-test')) {
        if (reviewMock.items.has(candidate) && effectiveCandidateKind(candidate) !== 'transformed') {
          throw { code: 'script_requires_transformed', message: 'O Roteiro só existe para Cortes do Vídeo transformado.' };
        }
        return;
      }
      const hit = findRunAndCandidateById(candidate);
      if (hit && hit.revision === hit.run.activeRevision) {
        const kind = hit.candidate.videoKind ?? hit.run.videoKind;
        if (kind !== 'transformed') {
          throw { code: 'script_requires_transformed', message: 'O Roteiro só existe para Cortes do Vídeo transformado.' };
        }
      }
    };

    if (name.startsWith('thumbnail.')) {
      ensureSelectionDemoInitialized();
      const handled = thumbnailMockDispatch(name, args, {
        getCandidateInfo: (cand) => {
          const info = getCandidateInfoForMock(cand);
          return { source: info.source, cut: info.cut, sourceStatus: info.sourceStatus };
        },
        isFfmpegInstalled: () => ffmpegMock.installed,
        isSourceTest: () => hasSearchFlag('source-test'),
        resolveRoute: hasSearchFlag('source-test') ? undefined : () => resolveAiTaskRoute('packaging'),
        emitProgress: emitirProgressoMock,
        projectId: () => getActiveProjectMock()?.id ?? null,
      });
      if (handled !== undefined) return handled as T;
    }

    if (name.startsWith('script.') || name.startsWith('angles.')) {
      ensureSelectionDemoInitialized();
      const handled = scriptMockDispatch(name, args, {
        checkTransformed: checkCandidateTransformed,
        resolveRoute: hasSearchFlag('source-test') ? undefined : (task, profileId) => resolveAiTaskRoute(task, profileId),
        emitProgress: emitirProgressoMock,
        projectId: () => getActiveProjectMock()?.id ?? null,
      });
      if (handled !== undefined) return handled as T;
    }

    if (name.startsWith('packaging.')) {
      ensureSelectionDemoInitialized();
      const candidate = (args as { candidate?: number }).candidate ?? 1;
      const info = getCandidateInfoForMock(candidate);
      let scriptAllowed = false;
      let blocks: { id: number; position: number; title: string; durationUs: number | null }[] = [];
      if (info.videoKind === 'transformed') {
        const scriptDoc = peekScriptMock(candidate);
        scriptAllowed = scriptDoc.narrationAllowed;
        const generated = narrationGenerated.get(candidate) ?? [];
        blocks = (scriptDoc.current?.blocks ?? []).map((b) => ({
          id: b.id,
          position: b.position,
          title: b.title,
          durationUs: generated.find((g) => g.blockId === b.id)?.durationUs ?? null,
        }));
      }
      const handled = packagingMockDispatch(name, args, {
        videoKind: info.videoKind,
        scriptAllowed,
        blocks,
        source: info.source,
        permission: hasSearchFlag('source-test') ? undefined : info.permission,
        originUrl: info.originUrl,
        detectedLanguage: info.detectedLanguage,
        languageRequired: info.languageRequired,
        resolveRoute: hasSearchFlag('source-test') ? undefined : () => resolveAiTaskRoute('packaging'),
        emitProgress: emitirProgressoMock,
        projectId: () => getActiveProjectMock()?.id ?? null,
      });
      if (handled !== undefined) return handled as T;
    }
    if (name === 'jobs.list') {
      const active = getActiveProjectMock();
      if (!active) throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto no momento.' };
      if (readEstadoParam() === 'vazio') return [] as T;
      return jobItems.map((item) => ({ ...item, project: active.id })) as T;
    }
    if (name === 'jobs.preview') {
      const active = getActiveProjectMock();
      if (!active) throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto.' };
      const raw = args as { sourceId?: unknown; source_id?: unknown };
      const parsePositiveId = (val: unknown, label: string): number | null => {
        if (val === undefined || val === null) return null;
        if (typeof val !== 'number' || !Number.isInteger(val) || val <= 0) {
          throw { code: 'invalid_input', message: `${label} inválido.` };
        }
        return val;
      };
      const camel = parsePositiveId(raw.sourceId, 'sourceId');
      const snake = parsePositiveId(raw.source_id, 'source_id');
      if (camel !== null && snake !== null && camel !== snake) {
        throw { code: 'invalid_input', message: 'sourceId e source_id informados com valores diferentes.' };
      }
      const sid = camel ?? snake;
      if (sid === null) {
        throw { code: 'invalid_input', message: 'Informe sourceId ou source_id.' };
      }
      const src = sourceItems.find((s) => s.id === sid);
      if (!src) throw { code: 'preview_failed', message: 'Fonte não encontrada.' };
      return {
        waveform: `/test/cache/preview/${sid}/waveform.bin`,
        thumbnails: [
          `/test/cache/preview/${sid}/thumb-001.jpg`,
          `/test/cache/preview/${sid}/thumb-002.jpg`,
        ],
        waveformKey: `preview-waveform/${sid}`,
        thumbnailKeys: [
          `preview-thumb/${sid}-0`,
          `preview-thumb/${sid}-1`,
        ],
      } as T;
    }
    if (name === 'jobs.cancel' && (args as { id: number }).id === 99) {
      for (const [sid, st] of transcriptsBySource.entries()) {
        if (st.job?.id === 99) {
          transcriptsBySource.set(sid, { ...st, job: { id: 99, state: 'cancelled', progress: st.job.progress, code: 'cancelled' } });
        }
      }
      const active = getActiveProjectMock();
      if (active) {
        emitirProgressoMock({
          job: '99',
          project: active.id,
          stage: 'failed',
          percentage: 0,
          message: 'Transcrição cancelada',
          error: { code: 'cancelled', message: 'Transcrição cancelada.' },
        });
      }
      return null as T;
    }
    if (name === 'jobs.estimate') {
      const id = (args as { id?: unknown }).id;
      if (typeof id !== 'number' || !Number.isInteger(id)) {
        throw { code: 'invalid_job', message: 'Tarefa inválida.' };
      }
      const proxyMatch = [...proxyJobsMock.values()].find((p) => p.job === id);
      if (proxyMatch) return { safety: 'free', estimate: { kind: 'zero' } } as T;
      const foundJob = jobItems.find((item) => item.id === id);
      if (foundJob) {
        if (foundJob.safety === 'local') {
          return { safety: 'local', estimate: { kind: 'zero' } } as T;
        }
        if (foundJob.profile === 'codex') {
          return { safety: 'paid', estimate: { kind: 'plan_quota' } } as T;
        }
        if (foundJob.cost === 'unknown') {
          return { safety: 'paid', estimate: { kind: 'unknown' } } as T;
        }
        return {
          safety: 'paid',
          estimate: { kind: 'usd', units: 1, windows: 1, inputTokens: 9000, minMicroUsd: 300, maxMicroUsd: 1350 },
        } as T;
      }
      return { safety: 'paid', estimate: { kind: 'unknown' } } as T;
    }
    if (name === 'jobs.redo.estimate' || name === 'jobs.redo') {
      const a = args as { id?: unknown; profileId?: unknown; confirmed?: unknown };
      const profileId = typeof a.profileId === 'string' ? a.profileId.trim() : '';
      if (!profileId || profileId.length > 64) {
        throw { code: 'invalid_profile', message: 'Escolha um Perfil de Provedor.' };
      }
      if (typeof a.id !== 'number' || !Number.isInteger(a.id)) {
        throw { code: 'invalid_job', message: 'Tarefa inválida.' };
      }
      const found = jobItems.find((item) => item.id === a.id);
      if (!found || !found.kind.startsWith('ai:')) {
        throw { code: 'invalid_job', message: 'Tarefa inválida.' };
      }
      if (found.state === 'uncertain') {
        throw {
          code: 'job_uncertain',
          message: 'Esta chamada tem resultado incerto: resolva a incerteza antes de refazer com outro perfil.',
        };
      }
      if (found.state !== 'completed' && found.state !== 'failed' && found.state !== 'cancelled') {
        throw {
          code: 'job_not_redoable',
          message: 'Só uma unidade concluída, que falhou ou foi cancelada pode ser refeita.',
        };
      }
      if (hasSearchFlag('task-version-changed')) {
        throw {
          code: 'task_version_changed',
          message: 'A Tarefa de IA foi atualizada desde este job; dispare uma nova execução na tela de origem.',
        };
      }
      const route = resolveSelectionRouteMock(profileId);
      const taskKey = found.kind.slice(3).split('_')[0];
      const active = getActiveProjectMock();
      const veto =
        (Boolean(active) && projectVetoMock) ||
        Boolean(assistantMock.localOnly[taskKey]);
      if (veto && !route.local) {
        throw { code: 'local_only_violation', message: 'Bloqueado pelo modo Somente local.' };
      }
      const estimate = estimateForRoute(route, 1);
      const leavesMachine = !route.local;
      if (name === 'jobs.redo.estimate') {
        return {
          profile: route.profile,
          paid: route.paid,
          leavesMachine,
          estimate,
        } as T;
      }
      if (route.paid && a.confirmed !== true) {
        throw {
          code: 'confirmation_required',
          message: 'Refazer com este perfil envia o texto a um Provedor pago: confirme o perfil e o custo estimado antes de começar.',
          usage: { estimate, profile: route.profile, leavesMachine },
        };
      }
      const newId = ++nextJobIdMock;
      const newJob: JobItemMock = {
        id: newId,
        kind: found.kind,
        safety: route.local ? 'local' : 'paid',
        state: 'queued',
        attempts: 1,
        checkpoint: null,
        progress: 0,
        project: active?.id ?? found.project,
        outcome: null,
        cost: null,
        batch: found.batch,
        profile: route.profile.id,
        budgetPause: null,
        taskCost: found.taskCost,
        profileCost: null,
        batchCost: found.batchCost,
      };
      jobItems = [...jobItems, newJob];
      if (active) {
        emitirProgressoMock({
          job: String(newId),
          project: active.id,
          stage: `${found.kind}:prepare`,
          percentage: 0,
          message: `Refazendo tarefa com ${route.profile.label}`,
          error: null,
        });
      }
      return { job: newId, profile: route.profile } as T;
    }
    if (name === 'jobs.result') {
      const id = (args as { id?: unknown }).id;
      if (typeof id !== 'number' || !Number.isInteger(id)) {
        throw { code: 'invalid_job', message: 'Tarefa inválida.' };
      }
      const found = jobItems.find((item) => item.id === id);
      if (!found) {
        throw { code: 'invalid_job', message: 'Tarefa inválida.' };
      }
      if (!found.kind.startsWith('ai:')) return null as T;
      if (found.state === 'uncertain') {
        return { outcome: 'uncertain', code: 'interrupted', cost: 'unknown' } as T;
      }
      if (found.state === 'failed') {
        return {
          outcome: 'invalid_json',
          code: 'invalid_json',
          cost: found.cost ?? '0.0400',
          calls: found.attempts,
          usage: {
            inputTokens: found.taskCost?.inputTokens ?? 6400,
            outputTokens: found.taskCost?.outputTokens ?? 920,
            calls: found.attempts,
            costKind: 'usd',
            microUsd: found.taskCost?.microUsd ?? 40_000,
            durationMs: found.taskCost?.durationMs ?? 3100,
          },
          data: null,
          violations: [{ code: 'invalid_json', message: 'Campo title ausente na resposta do modelo.' }],
        } as T;
      }
      if (found.state === 'completed') {
        return {
          outcome: 'ok',
          code: 'ok',
          cost: found.cost ?? 'US$ 0,00',
          calls: found.attempts,
          usage: {
            inputTokens: found.taskCost?.inputTokens || 4200,
            outputTokens: found.taskCost?.outputTokens || 1150,
            calls: found.attempts,
            costKind: found.profile === 'codex' ? 'plan_quota' : 'usd',
            microUsd: found.profile === 'codex' ? null : (found.taskCost?.microUsd ?? 0),
            durationMs: found.taskCost?.durationMs ?? 4800,
          },
          data: {
            blocks: [{ position: 1, title: 'Gancho inicial', narration: 'Texto sugerido do roteiro.' }],
          },
          violations: [],
        } as T;
      }
      return null as T;
    }
    if (name === 'jobs.retry' || name === 'jobs.discard' || name === 'jobs.cancel') {
      const { id, confirmed } = args as { id: number; confirmed?: boolean };
      const foundJob = jobItems.find((item) => item.id === id);
      if (name === 'jobs.retry') {
        const local = foundJob?.safety === 'local';
        if (!local && confirmed !== true) {
          throw { code: 'confirmation_required', message: 'Confirmação obrigatória' };
        }
      }
      const active = getActiveProjectMock();
      if (name === 'jobs.cancel') {
        const activeId = active?.id ?? null;
        cancelScriptMockJob(id, { emitProgress: emitirProgressoMock, projectId: () => activeId });
        cancelThumbnailMockJob(id, { emitProgress: emitirProgressoMock, projectId: () => activeId });
        cancelPackagingMockJob(id, { emitProgress: emitirProgressoMock, projectId: () => activeId });
        for (const p of proxyJobsMock.values()) {
          if (p.job === id) {
            if (p.timer) {
              clearTimeout(p.timer);
              p.timer = null;
            }
            p.state = 'failed';
            p.error = { code: 'cancelled', message: 'Preview cancelado.' };
            if (active) {
              emitirProgressoMock({
                job: String(id),
                project: active.id,
                stage: 'failed',
                percentage: 0,
                message: 'Preview cancelado',
                error: { code: 'cancelled', message: 'Preview cancelado.' },
              });
            }
          }
        }
      }
      if (!hasSearchFlag('source-test')) {
        for (const run of selectionRuns.values()) {
          const directIdx = run.windows.findIndex((w) => w.jobId === id);
          const parcialIdx = run.id === 1 && readEstadoParam() === 'parcial' && !run.parcialResolved && (directIdx >= 0 ? run.windows[directIdx].index === 2 : id === 2)
            ? run.windows.findIndex((w) => w.index === 2)
            : -1;
          const winIdx = parcialIdx >= 0 ? parcialIdx : directIdx;
          if (winIdx >= 0) {
            const win = run.windows[winIdx];
            if (run.id === 1 && readEstadoParam() === 'parcial') {
              run.parcialResolved = true;
            }
            if (name === 'jobs.discard' || name === 'jobs.cancel') {
              run.windows[winIdx] = { ...win, state: 'cancelled', code: 'cancelled' };
              const temAberta = run.windows.some((w) => w.state === 'failed' || w.state === 'cancelled' || w.state === 'uncertain');
              run.state = temAberta ? 'partial' : 'completed';
              if (active) {
                emitirProgressoMock({
                  job: String(id),
                  project: active.id,
                  stage: 'failed',
                  percentage: 0,
                  message: 'Janela descartada',
                  error: { code: 'cancelled', message: 'Janela descartada.' },
                });
              }
            } else if (name === 'jobs.retry') {
              run.windows[winIdx] = { ...win, state: 'queued', code: null };
              const nextRev = Math.max(...run.revisions, run.revision) + 1;
              setTimeout(() => {
                run.windows[winIdx] = { ...run.windows[winIdx], state: 'completed', code: null };
                if (!run.revisions.includes(nextRev)) run.revisions.push(nextRev);
                run.revision = nextRev;
                const temAberta = run.windows.some((w) => w.state === 'failed' || w.state === 'cancelled' || w.state === 'uncertain');
                run.state = temAberta ? 'partial' : 'completed';
                if (active) {
                  emitirProgressoMock({
                    job: String(id),
                    project: active.id,
                    stage: 'selection:window',
                    percentage: 100,
                    message: `Janela ${winIdx + 1} concluída`,
                    error: null,
                  });
                  emitirProgressoMock({
                    job: String(id),
                    project: active.id,
                    stage: 'selection:done',
                    percentage: 100,
                    message: 'Seleção concluída',
                    error: null,
                  });
                }
              }, 25);
            }
          }
        }
      }
      jobItems = jobItems.map(item => item.id === id ? { ...item, state: name === 'jobs.retry' ? 'queued' : 'cancelled' } : item);
      return null as T;
    }
    if (name === 'backups.list') {
      if (!getActiveProjectMock()) throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto.' };
      if (readEstadoParam() === 'vazio') return [] as T;
      return backupsMock.map((b) => ({ ...b })) as T;
    }
    if (name === 'backups.settings.get') {
      const active = getActiveProjectMock();
      if (!active) throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto.' };
      const warning = active.warning
        ? { code: 'backup_failed', message: active.warning }
        : hasSearchFlag('backup-warning') || readEstadoParam() === 'parcial'
          ? { code: 'backup_failed', message: 'O último backup automático falhou por espaço ou permissão.' }
          : null;
      return { ...backupSettingsMock, warning } as T;
    }
    if (name === 'backups.settings.set') {
      if (!getActiveProjectMock()) throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto.' };
      const a = args as { interval_seconds?: unknown; copies?: unknown };
      const interval = typeof a.interval_seconds === 'number' ? a.interval_seconds : NaN;
      const copies = typeof a.copies === 'number' ? a.copies : NaN;
      if (!Number.isInteger(interval) || interval <= 0 || !Number.isInteger(copies) || copies <= 0) {
        throw { code: 'backup_settings', message: 'Informe intervalo e número de cópias inteiros maiores que zero.' };
      }
      backupSettingsMock.interval_seconds = interval;
      backupSettingsMock.copies = copies;
      return null as T;
    }
    if (name === 'backups.create') {
      if (!getActiveProjectMock()) throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto.' };
      const now = Math.floor(Date.now() / 1000);
      const seq = String(backupSeqMock++).padStart(4, '0');
      const novo: BackupMockItem = {
        id: `backup-20261118-${now}-${seq}.sqlite`,
        created_at: now,
        before_restore: false,
      };
      backupsMock = [novo, ...backupsMock].slice(0, Math.max(1, backupSettingsMock.copies));
      return null as T;
    }
    if (name === 'backups.restore') {
      const active = getActiveProjectMock();
      if (!active) throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto.' };
      if (hasSearchFlag('project-busy') || (activeMockJobs.get(active.id)?.size ?? 0) > 0) {
        throw { code: 'project_busy', message: 'Há uma tarefa ativa bloqueando esta operação no Projeto.' };
      }
      const id = (args as { id?: unknown }).id;
      if (typeof id !== 'string' || !backupsMock.some((b) => b.id === id)) {
        throw { code: 'backup_invalid', message: 'Este arquivo de backup está corrompido ou é incompatível.' };
      }
      const now = Math.floor(Date.now() / 1000);
      const seq = String(backupSeqMock++).padStart(4, '0');
      backupsMock = [
        { id: `before-restore-20261118-${now}-${seq}.sqlite`, created_at: now, before_restore: true },
        ...backupsMock,
      ];
      return null as T;
    }
    if (name === 'sources.url.settings.get') return urlSettingsMock as T;
    if (name === 'sources.url.settings.set') { urlSettingsMock = {...urlSettingsMock, ...(args as typeof urlSettingsMock)}; return urlSettingsMock as T; }
    if (name === 'sources.cancel') {
      const job = (args as { job?: string }).job;
      if (job) activeSourceJobs.get(job)?.cancel();
      return {} as T;
    }
    if (name === 'sources.url.cancel') {
      const job = (args as { job?: string }).job;
      if (job) activeUrlJobs.get(job)?.cancel();
      return {} as T;
    }
    if (name === 'sources.list') {
      requireProjectMock(args);
      const offlineForcado = !hasSearchFlag('source-test') && readEstadoParam() === 'offline';
      return sourceItems.map((s) =>
        offlineForcado ? { ...s, status: 'offline' as const, available: false } : { ...s },
      ) as T;
    }
    if (name === 'sources.url.download') {
      requireProjectMock(args);
      const a = args as { url?: string; job?: string };
      const url = typeof a.url === 'string' ? a.url.trim() : '';
      if (!url || !/^https?:\/\//i.test(url)) {
        throw { code: 'invalid_url', message: 'Informe uma URL http:// ou https:// válida.' };
      }
      if (!urlSettingsMock.terms_accepted) {
        throw { code: 'terms_required', message: 'Aceite os Termos do YouTube antes de baixar.' };
      }
      if (!ytdlpMock.installed) {
        throw { code: 'component_missing', message: 'Instale o componente yt-dlp.' };
      }
      if (url.endsWith('/age-test')) throw { code: 'age_restricted', message: 'test' };
      if (url.endsWith('/login-test')) throw { code: 'login_required', message: 'test' };
      if (url.endsWith('/js-test') && !denoMock.installed) throw { code: 'js_runtime_missing', message: 'test' };
      const job = a.job?.trim() || `url-${Date.now()}`;
      await runCancellableSteps(
        job,
        [
          { stage: 'download', percentage: 0, message: 'Baixando Fonte' },
          { stage: 'download', percentage: 50, message: 'Baixando Fonte' },
          { stage: 'download', percentage: 100, message: 'Download concluído', delayMs: 5 },
        ],
        () => {},
        activeUrlJobs,
        null,
      );
      return { path: '/test/downloaded.mp4', url } as T;
    }
    if (name === 'sources.inspect') {
      const p = (args as { path?: string }).path;
      if (typeof p !== 'string' || !p.trim()) {
        throw { code: 'invalid_source', message: 'Caminho de arquivo inválido.' };
      }
      if (p.includes('indisponivel')) {
        throw { code: 'source_unavailable', message: 'Não foi possível ler o arquivo.' };
      }
      return makeSourceMetadata('3600.0') as T;
    }
    if (name === 'sources.import') {
      requireProjectMock(args);
      const a = args as {
        path: string;
        audio_track?: number;
        permission: { status: string; who?: string; where?: string; scope?: string };
        origin_url?: string | null;
        language?: string | null;
        copy?: boolean;
      };
      if (typeof a.path !== 'string' || !a.path.trim()) {
        throw { code: 'invalid_source', message: 'Caminho de arquivo inválido.' };
      }
      if (typeof a.audio_track !== 'number' || !Number.isInteger(a.audio_track) || a.audio_track < 0) {
        throw { code: 'invalid_track', message: 'Faixa de áudio inválida.' };
      }
      const perm = a.permission;
      if (perm?.status !== 'none' && !(perm?.status === 'granted' && perm.who?.trim() && perm.where?.trim() && perm.scope?.trim())) {
        throw { code: 'invalid_permission', message: 'Registre a Permissão ou informe que não há permissão.' };
      }
      if (a.copy && a.path.includes('copy-exists')) {
        throw { code: 'copy_exists', message: 'Já existe um arquivo com este nome dentro da pasta do Projeto.' };
      }
      if (a.copy) {
        await runCancellableSteps(
          'source-copy-original',
          [
            { stage: 'hash', percentage: 0, message: 'Verificando Fonte' },
            { stage: 'hash', percentage: 50, message: 'Verificando Fonte' },
            { stage: 'hash', percentage: 100, message: 'Verificando Fonte', delayMs: 5 },
          ],
          () => {},
          activeSourceJobs,
          null,
        );
        await runCancellableSteps(
          'source-copy-check',
          [
            { stage: 'hash', percentage: 0, message: 'Verificando Fonte' },
            { stage: 'hash', percentage: 100, message: 'Verificando Fonte', delayMs: 5 },
          ],
          () => {},
          activeSourceJobs,
          null,
        );
      }
      const nextId = sourceItems.reduce((max, s) => Math.max(max, s.id), 0) + 1;
      const normalizedPerm: SourceMockItem['permission'] =
        perm.status === 'none'
          ? { status: 'none' }
          : { status: 'granted', who: perm.who!.trim(), where: perm.where!.trim(), scope: perm.scope!.trim() };
      const item: SourceMockItem = {
        id: nextId,
        path: a.path,
        status: 'available',
        available: true,
        verified: true,
        audio_track: a.audio_track,
        origin_url: a.origin_url ?? null,
        language: a.language ?? channelProfileMock.language,
        permission: normalizedPerm,
        metadata: makeSourceMetadata('3600.0'),
      };
      sourceItems.push(item);
      return { ...item } as T;
    }
    if (name === 'sources.language.set') {
      requireProjectMock(args);
      const { id, language } = args as { id: number; language: string };
      const existing = sourceItems.find((item) => item.id === id);
      if (!existing) throw { code: 'source_missing', message: 'Fonte não encontrada.' };
      if (typeof language !== 'string' || !language.trim()) {
        throw { code: 'invalid_language', message: 'Idioma inválido.' };
      }
      const st = transcriptsBySource.get(id);
      if (st?.job && (st.job.state === 'queued' || st.job.state === 'running' || st.job.state === 'uncertain')) {
        throw { code: 'transcription_busy', message: 'A Transcrição está em andamento.' };
      }
      if (st?.transcript?.state === 'complete') {
        throw { code: 'transcript_complete', message: 'A Transcrição já foi concluída.' };
      }
      if (st?.transcript && st.transcript.resume_us > 0) {
        throw { code: 'transcript_partial', message: 'A Transcrição já foi iniciada.' };
      }
      sourceItems = sourceItems.map((item) => (item.id === id ? { ...item, language } : item));
      return sourceItems.find((item) => item.id === id) as T;
    }
    if (name === 'sources.permission.set') {
      requireProjectMock(args);
      const { id, permission } = args as { id: number; permission: { status: string; who?: string; where?: string; scope?: string } };
      if (permission?.status !== 'none' && !(permission?.status === 'granted' && permission.who?.trim() && permission.where?.trim() && permission.scope?.trim())) {
        throw { code: 'invalid_permission', message: 'Registre a Permissão ou informe que não há permissão' };
      }
      const normalized: SourceMockItem['permission'] = permission.status === 'none'
        ? { status: 'none' }
        : { status: 'granted', who: permission.who!.trim(), where: permission.where!.trim(), scope: permission.scope!.trim() };
      if (!sourceItems.some(item => item.id === id)) throw { code: 'source_missing', message: 'Fonte não encontrada' };
      sourceItems = sourceItems.map(item => item.id === id ? { ...item, permission: normalized } : item);
      setPackagingMockPermission(normalized);
      setTranslationMockPermission(id, normalized);
      return sourceItems.find(item => item.id === id) as T;
    }
    if (name === 'sources.delete') {
      const active = getActiveProjectMock();
      if (!active) {
        throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto no momento.' };
      }
      const requestedProject = (args as { project?: unknown }).project;
      if (requestedProject !== undefined && requestedProject !== null) {
        if (typeof requestedProject !== 'string' || !requestedProject.trim() || requestedProject !== active.path) {
          throw { code: 'invalid_project', message: 'O Projeto informado não corresponde ao Projeto aberto.' };
        }
      }
      const id = (args as { id?: unknown }).id;
      if (typeof id !== 'number' || !Number.isInteger(id)) {
        throw { code: 'source_missing', message: 'Fonte não encontrada.' };
      }
      const existing = sourceItems.find((item) => item.id === id);
      if (!existing) {
        throw { code: 'source_missing', message: 'Fonte não encontrada.' };
      }
      const st = transcriptsBySource.get(id);
      const jobAtivo =
        (st?.job && ['queued', 'running', 'uncertain'].includes(st.job.state)) ||
        activeSourceJobs.has(`source-hash-${id}`) ||
        activeSourceJobs.has(`source-relocate-${id}`);
      if (jobAtivo) {
        throw { code: 'source_busy', message: 'Há uma tarefa ativa ou incerta vinculada a esta Fonte.' };
      }
      sourceItems = sourceItems.filter((item) => item.id !== id);
      transcriptsBySource.delete(id);
      energyMeasuredSources.delete(id);
      return {
        deleted: true,
        id,
        transcripts: st?.transcript ? 1 : 0,
        cuts: 0,
        selection_runs: 0,
        clip_edits: 0,
        batch_items: 0,
        jobs: 0,
        jobs_kept_for_costs: st?.transcript?.engine === 'groq' ? 1 : 0,
      } as T;
    }

    if (name === 'sources.hash' || name === 'sources.relocate') {
      requireProjectMock(args);
      const { id, confirmed, path, job } = args as { id: number; confirmed?: boolean; path?: string; job?: string };
      const existing = sourceItems.find((item) => item.id === id);
      if (!existing) throw { code: 'source_missing', message: 'Fonte não encontrada.' };
      if (name === 'sources.relocate') {
        if (typeof path !== 'string' || !path.trim()) {
          throw { code: 'invalid_source', message: 'Caminho de arquivo inválido.' };
        }
        if (path.includes('mismatch')) {
          throw { code: 'source_mismatch', message: 'O arquivo escolhido não corresponde à Fonte original.' };
        }
      }
      if (!confirmed) throw { code: 'confirmation_required', message: 'confirmation required' };
      const jobId = job?.trim() || (name === 'sources.hash' ? 'source-hash' : 'source-relocate');
      await runCancellableSteps(
        jobId,
        [
          { stage: 'hash', percentage: 0, message: 'Verificando Fonte' },
          { stage: 'hash', percentage: 50, message: 'Verificando Fonte' },
          { stage: 'hash', percentage: 100, message: 'Verificando Fonte', delayMs: 5 },
        ],
        () => {
          const manterCaminhoV1 = name === 'sources.relocate' && hasSourceTest() && path === '/test/replacement.mp4';
          sourceItems = sourceItems.map((item) =>
            item.id === id
              ? { ...item, ...(!manterCaminhoV1 && name === 'sources.relocate' && path ? { path } : {}), status: 'available', available: true, verified: true }
              : item,
          );
        },
        activeSourceJobs,
        null,
      );
      if (name === 'sources.relocate') {
        return sourceItems.find((item) => item.id === id) as T;
      }
      return { verified: true } as T;
    }
    if (name === 'app.version') return { version } as T;
    if (name === 'components.cancel') {
      const id = (args as { id?: string }).id;
      if (id) activeComponentJobs.get(id)?.cancel();
      return {} as T;
    }
    if (name === 'components.deno.status') return { installed: denoMock.installed, version: denoMock.installed ? '2.9.8' : null, pinned: '2.9.8', outdated: false } as T;
    if (name === 'components.pocket_tts.status') return { installed: pocketTtsMock.installed, version: pocketTtsMock.installed ? '3.3.0' : null, pinned: '3.3.0', outdated: false } as T;
    if (name === 'components.download') {
      const a = args as { id?: string; confirmed?: boolean };
      if (!a.confirmed) throw { code: 'confirmation_required', message: 'Confirme o download antes de iniciar.' };
      const id = a.id ?? '';
      if (!['ffmpeg', 'yt-dlp', 'uv', 'deno', 'pocket-tts'].includes(id)) {
        throw { code: 'unknown_component', message: `Componente desconhecido: ${id}` };
      }
      await runCancellableSteps(
        id,
        [
          { stage: 'download', percentage: 0, message: `Baixando ${id}` },
          { stage: 'download', percentage: 50, message: `Baixando ${id}` },
          { stage: 'complete', percentage: 100, message: 'Componente instalado', delayMs: 5 },
        ],
        () => {
          if (id === 'deno') denoMock.installed = true;
          if (id === 'pocket-tts') pocketTtsMock.installed = true;
          if (id === 'yt-dlp') ytdlpMock.installed = true;
          if (id === 'uv') uvMock.installed = true;
          if (id === 'ffmpeg') {
            ffmpegMock.installed = true;
            ffmpegMock.incomplete = false;
            ffmpegMock.path = '/test/components/ffmpeg';
          }
        },
      );
      return { path: `/test/components/${id}` } as T;
    }
    if (name === 'tts.catalog' || name === 'tts.models.choose') {
      if (name === 'tts.models.choose') { const a = args as { language: string; modelId: string }; ttsActiveModels[a.language] = a.modelId; }
      const pt24Rev = catalogMock.version > 1 ? TTS_REV_V2 : TTS_REV_V1;
      const revFor = (id: string) => (id === 'portuguese_24l' ? pt24Rev : TTS_REV_V1);
      const installedRev = (id: string) => (ttsInstalledModels.has(id) ? (ttsInstalledRevs.get(id) ?? TTS_REV_V1) : null);
      return {
        catalogVersion: catalogMock.version,
        catalogSource: catalogMock.source,
        catalogWarning: catalogMock.warning,
        componentInstalled: pocketTtsMock.installed,
        activeModels: { ...ttsActiveModels },
        engines: [{ id: 'pocket-tts', label: 'Pocket TTS (Kyutai)', componentId: 'pocket-tts', codeLicense: 'MIT', sourceUrl: 'https://github.com/kyutai-labs/pocket-tts/tree/v4.0.1', prohibitedUse: { textEn: 'Prohibited use: Use of our model must comply with all applicable laws and regulations and must not result in, involve, or facilitate any illegal, harmful, deceptive, fraudulent, or unauthorized activity.', summaryPt: 'Uso proibido pelo autor do modelo (Kyutai): sem imitação ou clonagem de voz sem consentimento explícito e legal.', version: 'mock' } }],
        models: [
          { id: 'portuguese_24l', engineId: 'pocket-tts', language: 'pt', label: 'Pocket TTS PT-BR (24 camadas · padrão)', description: 'Qualidade superior em PT-BR.', defaultForLanguage: true, lightweight: false, active: ttsActiveModels.pt === 'portuguese_24l', installed: ttsInstalledModels.has('portuguese_24l'), installedRevision: installedRev('portuguese_24l'), updateAvailable: ttsInstalledModels.has('portuguese_24l') && installedRev('portuguese_24l') !== revFor('portuguese_24l'), termsAccepted: ttsInstalledModels.has('portuguese_24l'), repo: 'kyutai/pocket-tts-without-voice-cloning', revision: revFor('portuguese_24l'), license: 'CC-BY-4.0', sourceUrl: `https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/tree/${revFor('portuguese_24l')}`, size: 701332218 },
          { id: 'portuguese', engineId: 'pocket-tts', language: 'pt', label: 'Pocket TTS PT-BR (6 camadas · leve)', description: 'Variante destilada mais rápida.', defaultForLanguage: false, lightweight: true, active: ttsActiveModels.pt === 'portuguese', installed: ttsInstalledModels.has('portuguese'), installedRevision: installedRev('portuguese'), updateAvailable: false, termsAccepted: ttsInstalledModels.has('portuguese'), repo: 'kyutai/pocket-tts-without-voice-cloning', revision: TTS_REV_V1, license: 'CC-BY-4.0', sourceUrl: 'https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/tree/a7056f505a4a8ca72d8b5fb1440071d6f1a35739', size: 226502826 },
          { id: 'english', engineId: 'pocket-tts', language: 'en', label: 'Pocket TTS EN (6 camadas · padrão)', description: 'Modelo oficial em inglês.', defaultForLanguage: true, lightweight: true, active: ttsActiveModels.en === 'english', installed: ttsInstalledModels.has('english'), installedRevision: installedRev('english'), updateAvailable: false, termsAccepted: ttsInstalledModels.has('english'), repo: 'kyutai/pocket-tts-without-voice-cloning', revision: TTS_REV_V1, license: 'CC-BY-4.0', sourceUrl: 'https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/tree/a7056f505a4a8ca72d8b5fb1440071d6f1a35739', size: 231761368 },
        ],
        voices: [
          { id: '13063', engineId: 'pocket-tts', language: 'pt', gender: 'male', label: 'Narrador PT-BR 13063 (masculina)', defaultForLanguage: true, license: 'CC-BY-4.0', attribution: 'BRSpeech-TTS / CML-TTS (CC-BY 4.0)', sourceUrl: 'https://huggingface.co/datasets/freds0/BRSpeech-TTS', models: ['portuguese_24l', 'portuguese'], installedModels: [] },
          { id: 'alba', engineId: 'pocket-tts', language: 'en', gender: 'female', label: 'Alba (EN, feminina)', defaultForLanguage: true, license: 'CC-BY-4.0', attribution: 'Alba MacKenna (CC-BY 4.0)', sourceUrl: 'https://huggingface.co/kyutai/tts-voices/tree/323332d33f997de8394f24a193e1a76df720e01a/alba-mackenna', models: ['english'], installedModels: [] },
          { id: 'marius', engineId: 'pocket-tts', language: 'en', gender: 'male', label: 'Marius (EN, masculina)', defaultForLanguage: false, license: 'CC0-1.0', attribution: 'Unmute Voice Donation Project (CC0 1.0)', sourceUrl: 'https://huggingface.co/kyutai/tts-voices/tree/323332d33f997de8394f24a193e1a76df720e01a/voice-donations', models: ['english'], installedModels: [] },
        ],
      } as T;
    }
    if (name === 'tts.models.download') {
      const a = args as { id: string; confirmed?: boolean; termsAccepted?: boolean };
      if (!a.confirmed) throw { code: 'confirmation_required', message: 'Confirmação obrigatória.' };
      if (!a.termsAccepted) throw { code: 'terms_acceptance_required', message: 'Aceite o termo.' };
      await runCancellableSteps(
        `tts:${a.id}`,
        [
          { stage: 'download', percentage: 0, message: 'Baixando modelo TTS' },
          { stage: 'download', percentage: 60, message: 'Baixando voz TTS' },
          { stage: 'complete', percentage: 100, message: 'Modelo TTS instalado', delayMs: 5 },
        ],
        () => {
          ttsInstalledModels.add(a.id);
          ttsInstalledRevs.set(a.id, a.id === 'portuguese_24l' && catalogMock.version > 1 ? TTS_REV_V2 : TTS_REV_V1);
        },
      );
      return { id: a.id } as T;
    }
    if (name === 'tts.models.cancel') {
      const id = (args as { id?: string }).id;
      if (id) activeComponentJobs.get(`tts:${id}`)?.cancel();
      return {} as T;
    }
    if (name === 'narration.get' || name === 'narration.generate' || name === 'narration.regenerate_block' || name === 'narration.import' || name === 'narration.align' || name === 'narration.align_block' || name === 'narration.review' || name === 'narration.record_block' || name === 'narration.trim_block' || name === 'narration.discard_draft' || name === 'narration.cleanup.set' || name === 'narration.cleanup.prepare') {
      ensureSelectionDemoInitialized();
      const a = args as { candidate: number; block?: number; voiceId?: string; choice?: 'script' | 'spoken'; audioBase64?: string; enabled?: boolean; path?: string };
      const cand = a.candidate ?? 1;
      if (!hasSearchFlag('source-test')) checkCandidateTransformed(cand);
      const s = peekScriptMock(cand);
      const recordNoWorker = typeof location !== 'undefined' && new URLSearchParams(location.search).has('record-no-worker');
      const recordNoSpeech = typeof location !== 'undefined' && new URLSearchParams(location.search).has('record-no-speech');
      const vadReady = !componentsMissing && !recordNoWorker;
      const projectId = getActiveProjectMock()?.id ?? null;
      const lang = s.current?.language ?? s.detectedLanguage ?? 'pt';
      const defaultAlign = (text: string | null, idx: number, improviso?: boolean): MockBlockAlignment => {
        const deviationMode = typeof location !== 'undefined' && new URLSearchParams(location.search).has('narration-deviation');
        const wordCount = (text ?? '').trim().split(/\s+/).filter(Boolean).length || 4;
        if (improviso || (deviationMode && idx === 0)) {
          return { status: 'needs_review', choice: null, activeTrack: null, substitutions: 0, insertions: 2, deletions: 0, maxConsecutiveInsertions: 2, errorCode: null, modelId: 'whisper-turbo', spokenText: `${text ?? 'Bloco'} extra improviso`, wordCount: wordCount + 2 };
        }
        return { status: 'aligned', choice: null, activeTrack: 'script', substitutions: 0, insertions: 0, deletions: 0, maxConsecutiveInsertions: 0, errorCode: null, modelId: 'whisper-turbo', spokenText: null, wordCount };
      };
      if (name === 'narration.discard_draft') {
        return { candidate: cand, blockId: a.block ?? 0, discarded: true } as T;
      }
      if (name === 'narration.record_block') {
        if (!s.narrationAllowed) throw { code: 'script_not_approved', message: 'Aprove o Roteiro.' };
        if (!hasSearchFlag('source-test') && (!a.audioBase64 || typeof a.audioBase64 !== 'string' || !a.audioBase64.trim())) {
          throw { code: 'invalid_recording_audio', message: 'O áudio gravado está vazio ou em formato inválido.' };
        }
        if (recordNoSpeech || a.audioBase64 === 'SILENCE') {
          throw { code: 'no_speech_detected', message: 'Nenhuma fala detectada na gravação.', usage: { hasDraft: true, durationUs: 1_500_000 } };
        }
        const blocks = s.current?.blocks ?? [];
        const idx = blocks.findIndex(b => b.id === a.block);
        const target = blocks[idx];
        if (!target) throw { code: 'block_not_found', message: 'Bloco não encontrado.' };
        const existing = narrationGenerated.get(cand) ?? [];
        const trimmed = vadReady;
        const durationUs = trimmed ? 2_400_000 : 3_500_000;
        const entry = {
          blockId: target.id,
          voiceId: 'recorded',
          modelId: trimmed ? 'silero-vad' : 'untrimmed',
          engineId: 'recorded',
          trimmed,
          cleanupEnabled: true,
          cleanupReady: false,
          durationUs,
          alignment: vadReady ? defaultAlign(target.narration, idx) : { status: 'pending' as const, choice: null, activeTrack: null, substitutions: 0, insertions: 0, deletions: 0, maxConsecutiveInsertions: 0, errorCode: null, modelId: '', spokenText: null, wordCount: 0 },
        };
        const next = existing.some(e => e.blockId === target.id)
          ? existing.map(e => (e.blockId === target.id ? entry : e))
          : [...existing, entry];
        narrationGenerated.set(cand, next);
        emitirProgressoMock({ job: '0', project: projectId, stage: 'narration_record', percentage: 50, message: 'Processando gravação', error: null });
        emitirProgressoMock({ job: 'narration_record', project: projectId, stage: 'done', percentage: 100, message: 'Gravação concluída', error: null });
        return {
          candidate: cand,
          blockId: target.id,
          narrationId: target.id,
          versionId: 1,
          engineId: 'recorded',
          voiceId: 'recorded',
          modelId: entry.modelId,
          relPath: `narrations/c${cand}/b${target.id}-v1.wav`,
          durationUs,
          sampleRate: 24000,
          channels: 1,
          bytes: 115244,
          trimmed,
          warningCode: trimmed ? null : 'vad_unavailable',
          warning: trimmed ? null : 'Aparo de silêncio indisponível: instale o worker.',
        } as T;
      }
      if (name === 'narration.trim_block') {
        if (!vadReady) throw { code: 'worker_missing', message: 'Instale o worker.' };
        const blocks = s.current?.blocks ?? [];
        const idx = blocks.findIndex(b => b.id === a.block);
        const target = blocks[idx];
        const existing = narrationGenerated.get(cand) ?? [];
        const hit = existing.find(e => e.blockId === a.block);
        if (!hit || !target) throw { code: 'narration_missing', message: 'Gravação não encontrada.' };
        if (hit.engineId !== 'recorded') throw { code: 'narration_not_recorded', message: 'Apenas gravações podem ser aparadas com VAD.' };
        const updated = { ...hit, modelId: 'silero-vad', trimmed: true, durationUs: 2_400_000, alignment: defaultAlign(target.narration, idx, hit.improviso) };
        narrationGenerated.set(cand, existing.map(e => (e.blockId === a.block ? updated : e)));
        return { candidate: cand, blockId: target.id, trimmed: true, durationUs: 2_400_000 } as T;
      }
      if (name === 'narration.generate' || name === 'narration.regenerate_block') {
        if (!s.narrationAllowed) throw { code: 'script_not_approved', message: 'Aprove o Roteiro.' };
        const modelId = ttsActiveModels[lang] ?? ttsActiveModels.pt;
        if (!hasSearchFlag('source-test')) {
          if (!pocketTtsMock.installed) {
            throw { code: 'component_missing', message: 'Instale o Componente pocket-tts para gerar Narração por voz.' };
          }
          if (!ttsInstalledModels.has(modelId)) {
            throw { code: 'tts_model_missing', message: 'Falta baixar o modelo de voz TTS deste idioma.' };
          }
        }
        const voiceId = a.voiceId ?? channelProfileMock.narrationVoice ?? '13063';
        const blocks = s.current?.blocks ?? [];
        const existing = narrationGenerated.get(cand) ?? [];
        const blockDurationUs = selectionFlag('packaging-chapters') ? 12_000_000 : 3_200_000;
        const next = blocks.map((b, idx) => (a.block === undefined || b.id === a.block)
          ? { blockId: b.id, voiceId, modelId, engineId: 'pocket-tts', trimmed: true, durationUs: blockDurationUs, alignment: defaultAlign(b.narration, idx) }
          : (existing.find(e => e.blockId === b.id) ?? { blockId: b.id, voiceId, modelId, engineId: 'pocket-tts', trimmed: true, durationUs: blockDurationUs, alignment: defaultAlign(b.narration, idx) }));
        narrationGenerated.set(cand, next);
        emitirProgressoMock({ job: '790', project: projectId, stage: 'narration', percentage: 100, message: 'Narração gerada', error: null });
        return { job: 790, candidate: cand } as T;
      }
      if (name === 'narration.import') {
        if (!s.narrationAllowed) throw { code: 'script_not_approved', message: 'Aprove o Roteiro.' };
        const imp = args as { candidate: number; block: number; path: string };
        const caminho = imp.path ?? '';
        const lower = caminho.toLowerCase();
        if (lower.includes('missing')) throw { code: 'import_file_missing', message: 'O arquivo selecionado não foi encontrado no disco.' };
        if (lower.includes('too-large')) throw { code: 'import_file_too_large', message: 'Arquivo excede 200 MiB.' };
        if (!/\.(wav|mp3|m4a|ogg)$/i.test(caminho)) throw { code: 'import_unsupported_format', message: 'Formato inválido.' };
        if (lower.includes('empty')) throw { code: 'import_empty_file', message: 'Arquivo de áudio vazio.' };
        if (lower.includes('no-audio')) throw { code: 'import_no_audio_stream', message: 'Arquivo sem trilha de áudio.' };
        if (lower.includes('bad-codec')) throw { code: 'import_unsupported_codec', message: 'Codec não suportado.' };
        if (lower.includes('too-short')) throw { code: 'import_duration_too_short', message: 'Duração abaixo de 0,3 s.' };
        if (lower.includes('too-long')) throw { code: 'import_duration_too_long', message: 'Duração acima de 10 min.' };
        const blocks = s.current?.blocks ?? [];
        const idx = blocks.findIndex(b => b.id === imp.block);
        if (idx < 0) throw { code: 'block_not_found', message: 'Bloco não encontrado.' };
        const improviso = lower.includes('improviso');
        const existing = narrationGenerated.get(cand) ?? [];
        const entry = {
          blockId: imp.block,
          voiceId: 'imported',
          modelId: 'external',
          engineId: 'imported',
          cleanupEnabled: true,
          cleanupReady: false,
          improviso,
          durationUs: 2_800_000,
          alignment: defaultAlign(blocks[idx]?.narration ?? null, idx, improviso),
        };
        const next = existing.some(e => e.blockId === imp.block)
          ? existing.map(e => e.blockId === imp.block ? entry : e)
          : [...existing, entry];
        narrationGenerated.set(cand, next);
        emitirProgressoMock({ job: '792', project: projectId, stage: 'narration_import', percentage: 100, message: 'Áudio importado', error: null });
        return { job: 792, candidate: cand, blockId: imp.block } as T;
      }
      if (name === 'narration.align' || name === 'narration.align_block') {
        const blocks = s.current?.blocks ?? [];
        const existing = narrationGenerated.get(cand) ?? [];
        const next = existing.map((e, idx) => (a.block === undefined || e.blockId === a.block)
          ? { ...e, alignment: defaultAlign(blocks.find(b => b.id === e.blockId)?.narration ?? null, idx, e.improviso) }
          : e);
        narrationGenerated.set(cand, next);
        emitirProgressoMock({ job: '791', project: projectId, stage: 'aligning', percentage: 100, message: 'Alinhamento concluído', error: null });
        return { job: 791, candidate: cand, block: a.block ?? null } as T;
      }
      if (name === 'narration.review') {
        if (a.choice !== 'script' && a.choice !== 'spoken') throw { code: 'invalid_review_choice', message: 'Escolha inválida.' };
        const existing = narrationGenerated.get(cand) ?? [];
        const hit = existing.find(e => e.blockId === a.block);
        if (!hit) throw { code: 'alignment_missing', message: 'Bloco sem alinhamento para revisar.' };
        const next = existing.map(e => e.blockId === a.block
          ? { ...e, alignment: { ...e.alignment, status: 'approved' as const, choice: a.choice ?? 'script', activeTrack: a.choice ?? 'script' } }
          : e);
        narrationGenerated.set(cand, next);
        const updated = next.find(e => e.blockId === a.block);
        return { candidate: cand, block: a.block, alignment: updated?.alignment ?? null } as T;
      }
      const cleanupFor = (hit: { engineId: string; cleanupEnabled?: boolean; cleanupReady?: boolean }): MockCleanupInfo | null => {
        if (hit.engineId !== 'recorded' && hit.engineId !== 'imported') return null;
        return {
          applicable: true,
          enabled: hit.cleanupEnabled ?? true,
          ready: hit.cleanupReady ?? false,
          noiseFloorDb: vadReady ? -44 : -50,
          noiseFloorSource: vadReady ? 'vad' : 'default',
          warningCode: vadReady ? null : 'vad_unavailable',
          warning: vadReady ? null : 'Piso de ruído padrão usado: instale o worker para medir o ruído da gravação.',
        };
      };
      if (name === 'narration.cleanup.set') {
        const existing = narrationGenerated.get(cand) ?? [];
        const hit = existing.find(e => e.blockId === a.block);
        if (!hit) throw { code: 'narration_missing', message: 'Este bloco ainda não tem áudio.' };
        if (hit.engineId !== 'recorded' && hit.engineId !== 'imported') {
          throw { code: 'cleanup_not_applicable', message: 'A limpeza de voz só se aplica a Narração gravada ou importada.' };
        }
        const updated = { ...hit, cleanupEnabled: Boolean(a.enabled) };
        narrationGenerated.set(cand, existing.map(e => (e.blockId === a.block ? updated : e)));
        return { candidate: cand, blockId: a.block, narrationId: a.block, cleanup: cleanupFor(updated) } as T;
      }
      if (name === 'narration.cleanup.prepare') {
        if (componentsMissing || (!ffmpegMock.installed && !hasSearchFlag('source-test'))) {
          throw { code: 'ffmpeg_missing', message: 'Instale o Componente FFmpeg para limpar o áudio.' };
        }
        const existing = narrationGenerated.get(cand) ?? [];
        const hit = existing.find(e => e.blockId === a.block);
        if (!hit) throw { code: 'narration_missing', message: 'Este bloco ainda não tem áudio.' };
        if (hit.engineId !== 'recorded' && hit.engineId !== 'imported') {
          throw { code: 'cleanup_not_applicable', message: 'A limpeza de voz só se aplica a Narração gravada ou importada.' };
        }
        const updated = { ...hit, cleanupReady: true };
        narrationGenerated.set(cand, existing.map(e => (e.blockId === a.block ? updated : e)));
        const info = cleanupFor(updated)!;
        return {
          candidate: cand,
          blockId: a.block,
          narrationId: a.block,
          enabled: info.enabled,
          ready: true,
          cleanRelPath: `narrations/c${cand}/b${a.block}-v1.clean.wav`,
          durationUs: updated.durationUs,
          noiseFloorDb: info.noiseFloorDb,
          noiseFloorSource: info.noiseFloorSource,
          warningCode: info.warningCode,
          warning: info.warning,
        } as T;
      }
      const list = narrationGenerated.get(cand) ?? [];
      const blocks = (s.current?.blocks ?? []).map(b => {
        const hit = list.find(x => x.blockId === b.id);
        return {
          blockId: b.id, position: b.position, title: b.title, versionId: 1, narrationText: b.narration,
          audio: hit ? { id: b.id, versionId: 1, voiceId: hit.voiceId, modelId: hit.modelId, engineId: hit.engineId, relPath: `narrations/c${cand}/b${b.id}-v1.wav`, durationUs: hit.durationUs, sampleRate: 24000, channels: 1, bytes: 153644, stale: false, trimmed: hit.trimmed ?? true, cleanup: cleanupFor(hit) } : null,
          alignment: hit ? hit.alignment : null,
        };
      });
      const gateReason = s.narrationAllowed
        ? null
        : s.busy
          ? 'generating'
          : !s.current || s.current.blocks.length === 0
            ? 'no_script'
            : 'pending_blocks';
      return {
        candidate: cand, narrationAllowed: s.narrationAllowed, gateReason,
        language: lang, defaultVoiceId: channelProfileMock.narrationVoice ?? '13063', activeModelId: ttsActiveModels[lang] ?? ttsActiveModels.pt,
        busy: false, job: null, importBusy: false, importJob: null, alignBusy: false, alignJob: null,
        alignPrerequisitesReady: !componentsMissing && (hasSearchFlag('source-test') || workerInstalledMock),
        vadReady,
        blocks, totalDurationUs: blocks.reduce((acc, b) => acc + (b.audio?.durationUs ?? 0), 0),
      } as T;
    }
    if (name === 'components.ytdlp.status') return (ytdlpMock.installed ? { installed: true, version: ytdlpMock.version } : { installed: false }) as T;
    if (name === 'components.ytdlp.update') return {version:'test'} as T;
    if (name === 'components.worker.status') return (!workerInstalledMock ? { installed: false, gpu: true } : { installed: true, outdated: false, cuda: false, gpu: true, uv: '0.13.8', handshake: { protocol: 1, worker: '0.1.0', python: '3.12.16', libs: { 'faster-whisper': '1.2.1', onnxruntime: '1.32.0', numpy: '2.4.6', 'opencv-python-headless': null } } }) as T;
    if (name === 'components.worker.install') {
      const a = args as { confirmed?: boolean };
      if (!a.confirmed) throw { code: 'confirmation_required', message: 'Confirme a instalação antes de iniciar.' };
      const accel = hardwareCpuMode ? 'CPU' : 'CUDA';
      await runCancellableSteps(
        'worker',
        [
          { stage: 'worker', percentage: 25, message: 'Instalando o Python gerenciado' },
          { stage: 'worker', percentage: 45, message: `Instalando as dependências do worker (${accel})` },
          { stage: 'worker', percentage: 95, message: 'Verificando o worker' },
          { stage: 'complete', percentage: 100, message: 'Worker instalado', delayMs: 5 },
        ],
        () => {
          workerInstalledMock = true;
          uvMock.installed = true;
        },
      );
      return {
        handshake: {
          protocol: 1,
          worker: '0.1.0',
          python: '3.12.16',
          libs: { 'faster-whisper': '1.2.1', onnxruntime: '1.32.0', numpy: '2.4.6', 'opencv-python-headless': null },
        },
        cuda: !hardwareCpuMode,
      } as T;
    }
    if (name === 'components.ffmpeg.status') return { incomplete: ffmpegMock.incomplete, installed: ffmpegMock.installed } as T;
    if (name === 'components.ffmpeg.system') {
      const a = args as { path?: string };
      const caminho = (a.path ?? 'ffmpeg').trim() || 'ffmpeg';
      if (caminho.toLowerCase().includes('invalido')) {
        throw { code: 'invalid_ffmpeg', message: 'Não encontramos o FFmpeg válido nesse caminho.' };
      }
      if (caminho.toLowerCase().includes('sem-ffprobe')) {
        throw { code: 'ffprobe_missing', message: 'FFprobe não encontrado junto ao FFmpeg.' };
      }
      ffmpegMock.installed = true;
      ffmpegMock.incomplete = false;
      ffmpegMock.path = caminho;
      return { version: 'ffmpeg version 7.1-mock', path: caminho } as T;
    }
    if (name === 'assistant.status') return assistantView() as T;
    if (name === 'assistant.tasks') return assistantTasks() as T;
    if (name === 'assistant.local_only.set') { const { task, enabled } = args as { task: string; enabled: boolean }; assistantMock.localOnly[task] = enabled; return assistantView() as T; }
    if (name === 'assistant.detect') return { ollama: { found: true, endpoint: 'http://127.0.0.1:11434', models: ['llama3:8b', 'qwen3'] }, lmStudio: { found: false, endpoint: null, models: [] }, llamaCpp: { found: false, endpoint: null, models: [] }, codex: { found: true }, claude: { found: false }, opencode: { found: true } } as T;
    if (name === 'assistant.default.set' || name === 'assistant.task.set') {
      const { choice, task } = args as { choice: string; task?: string };
      if ((choice === 'codex' && !providerCliMock.codexConfirmed) || (choice === 'claude' && !providerCliMock.claudeConfirmed) || (choice === 'opencode' && !providerCliMock.opencodeConfirmed)) throw { code: 'confirmation_required', message: 'confirmation required' };
      if (choice.startsWith('profile:') && (!knownProfile(choice.slice(8)) || ['codex', 'claude', 'opencode'].includes(choice.slice(8)))) throw { code: 'invalid_settings', message: 'Profile not found' };
      assistantTouched = true;
      if (name === 'assistant.task.set') assistantMock.tasks[task!] = choice; else assistantMock.default = choice;
      return assistantView() as T;
    }
    if (name === 'assistant.complete') {
      const skipped = !!(args as { skipped?: boolean }).skipped;
      assistantTouched = true;
      assistantMock = { ...assistantMock, completed: !skipped, skipped };
      return assistantView() as T;
    }
    if (name === 'provider.profiles.list') {
      if (selectionFlag('selection-redo') && !profileMocks.length) {
        providerMock = { ...providerMock, endpoint: 'http://127.0.0.1:11434/v1', model: 'llama3', kind: 'openai' };
        profileMocks = [{ id: 'forte', label: 'Forte remoto', kind: 'openai', endpoint: 'https://api.example.test/v1', model: 'forte-1', nativeSchema: false, ownKey: true, context: null, keyLastFour: '1234' }, { id: 'leve', label: 'Leve local', kind: 'openai', endpoint: 'http://127.0.0.1:11435/v1', model: 'leve-1', nativeSchema: false, ownKey: false, context: null, keyLastFour: null }];
      }
      const limits = (p: ProfileMock) => ({
        maxOutput: { value: p.maxOutput ?? 4096, source: p.maxOutput ? 'profile' : 'fallback' },
        timeout: { seconds: p.timeoutSecs ?? (isLocalHost(p.endpoint) ? 300 : 60), source: p.timeoutSecs ? 'profile' : 'default' },
        timeoutMsPer1kInputTokens: 1000,
        minUsefulOutput: 512,
        tokensPerRequest: p.tokensPerRequest ? { value: p.tokensPerRequest, source: 'profile' } : null,
        tokensPerMinute: p.tokensPerMinute ? { value: p.tokensPerMinute, source: 'profile' } : null,
        tokensPerDay: p.tokensPerDay ? { value: p.tokensPerDay, source: 'profile' } : null,
      });
      const view = (p: ProfileMock) => ({ ...p, maxOutput: p.maxOutput ?? null, timeoutSecs: p.timeoutSecs ?? null, tokensPerRequest: p.tokensPerRequest ?? null, tokensPerMinute: p.tokensPerMinute ?? null, tokensPerDay: p.tokensPerDay ?? null, limits: limits(p), keyLastFour: p.ownKey || p.endpoint !== providerMock.endpoint ? p.keyLastFour : providerMock.keyLastFour, local: isLocalHost(p.endpoint), confirmed: providerMock.confirmedEndpoints.includes(p.endpoint), price: null, cli: false });
      const main = providerMock.endpoint ? [view({ id: 'legacy', label: 'Principal', kind: providerMock.kind, endpoint: providerMock.endpoint, model: providerMock.model, nativeSchema: providerMock.nativeSchema, context: providerMock.context, ownKey: false, keyLastFour: providerMock.keyLastFour })] : [];
      const cli = (kind: string, label: string, confirmed: boolean) => ({ id: kind, label, kind, endpoint: null, model: null, nativeSchema: false, ownKey: false, keyLastFour: null, local: false, confirmed, active: providerCliMock.selected === kind, price: null, cli: true, experimental: true });
      return { profiles: [...main, ...profileMocks.map(view), cli('codex', 'Codex CLI', providerCliMock.codexConfirmed), cli('claude', 'Claude Code CLI', providerCliMock.claudeConfirmed), {...cli('opencode', 'OpenCode CLI', providerCliMock.opencodeConfirmed), model:providerCliMock.opencodeModel, cost:{kind:providerCliMock.opencodeModel === 'opencode/big-pickle' ? 'zero' : 'unknown'}}] } as T;
    }
    if (name === 'provider.context.get') {
      const id = (args as { profileId?: string }).profileId ?? 'legacy';
      const p = id === 'legacy' ? { context: providerMock.context, kind: providerMock.kind } : profileMocks.find(x => x.id === id);
      if (!p) throw { code: 'invalid_settings', message: 'Profile not found' };
      const source = p.context ? 'user' : 'fallback';
      const why = { user: 'Value set by you for this profile.', fallback: 'Conservative default: no limit was discovered.' };
      return { profileId: id, kind: p.kind, value: p.context ?? (p.kind === 'ollama' ? 4096 : 8192), source, detail: null, explanation: why[source], capped: false, warning: null, measured: false, userContext: p.context, loaded: null, maxContext: null, maxOutput: null, refreshed: !!(args as { refresh?: boolean }).refresh } as T;
    }
    if (name === 'provider.selection_state') {
      const a = args as { profileId?: string; task?: string };
      let id = a.profileId;
      if (!id && a.task) {
        const rota = assistantMock.tasks[a.task] || assistantMock.default;
        if (!rota) return { applicable: false } as T;
        if (['codex', 'claude', 'opencode'].includes(rota)) return { applicable: false } as T;
        id = rota === 'endpoint' ? 'legacy' : rota.startsWith('profile:') ? rota.slice(8) : rota;
      }
      id = id ?? 'legacy';
      if (['codex', 'claude', 'opencode'].includes(id)) return { applicable: false } as T;
      if (id === 'legacy' && !providerMock.endpoint) return { applicable: false } as T;
      const p = id === 'legacy' ? { id, context: providerMock.context, kind: providerMock.kind, endpoint: providerMock.endpoint, model: providerMock.model } : profileMocks.find(x => x.id === id);
      if (!p) throw { code: 'invalid_settings', message: 'Profile not found' };
      // Limites só do simulador (o núcleo real usa o planejador): abaixo de 11 mil bloqueia, abaixo de 16 mil reduz.
      const tokens = p.context ?? (p.kind === 'ollama' ? 4096 : 8192);
      const state = tokens < 11000 ? 'blocked' : tokens < 16000 ? 'reduced' : 'full';
      const guides = p.kind === 'ollama' ? ['ollama_profile'] : p.kind === 'openai' && isLocalHost(p.endpoint) ? ['ollama_server', 'lmstudio', 'llamacpp'] : [];
      return { applicable: true, profileId: id, kind: p.kind, model: p.model, contextTokens: tokens, origin: p.context ? 'user' : 'fallback', state,
        reference: { sourceMinutes: 60, maxWindowMinutes: 15, minWindowMinutes: 9, firstWindowMinutes: state === 'blocked' ? null : state === 'reduced' ? 12 : 15, windows: state === 'blocked' ? null : 5 }, guides } as T;
    }
    if (name === 'provider.profiles.remove') {
      const id = (args as { profileId?: string }).profileId;
      if (!id || id === 'legacy' || !profileMocks.some(p => p.id === id)) {
        throw { code: 'invalid_settings', message: 'Não é possível remover este perfil.' };
      }
      profileMocks = profileMocks.filter(p => p.id !== id);
      return {} as T;
    }
    if (name === 'provider.status') return { ...providerMock, timeouts: { remote: 60, local: 300 } } as T;
    if (name === 'provider.cli.status') return { ...providerCliMock } as T;
    if (name === 'provider.cli.configure') {
      const a = args as { kind?: string; model?: string; timeoutSeconds?: number | null };
      const kind = a.kind ?? '';
      if (!['', 'codex', 'claude', 'opencode'].includes(kind)) {
        throw { code: 'invalid_settings', message: 'CLI inválido.' };
      }
      if (kind === 'opencode' && 'model' in a) {
        const m = String(a.model ?? '').trim();
        if (!m || m.length > 200 || !m.includes('/')) {
          throw { code: 'invalid_settings', message: 'Modelo OpenCode inválido (use provedor/modelo).' };
        }
        providerCliMock.opencodeModel = m;
      }
      if ('timeoutSeconds' in a) {
        if (a.timeoutSeconds === null) {
          providerCliMock.timeoutSeconds = 300;
        } else if (typeof a.timeoutSeconds === 'number' && Number.isInteger(a.timeoutSeconds) && a.timeoutSeconds >= 1 && a.timeoutSeconds <= 3600) {
          providerCliMock.timeoutSeconds = a.timeoutSeconds;
        } else {
          throw { code: 'invalid_settings', message: 'Timeout inválido (1..3600 s).' };
        }
      }
      providerCliMock.selected = kind;
      return {} as T;
    }
    if (name === 'provider.cli.confirm') {
      const k = (args as { kind?: string }).kind || providerCliMock.selected;
      if (k === 'codex') providerCliMock.codexConfirmed = true;
      else if (k === 'opencode') providerCliMock.opencodeConfirmed = true;
      else if (k === 'claude') providerCliMock.claudeConfirmed = true;
      return {} as T;
    }
    if (name === 'provider.configure' && (args as { profileId?: string }).profileId) {
      const a = args as { profileId: string; label: string; kind: string; endpoint: string; model: string; nativeSchema: boolean; ownKey?: boolean; context?: number | null; maxOutput?: number | null; timeoutSecs?: number | null; tokensPerRequest?: number | null; tokensPerMinute?: number | null; tokensPerDay?: number | null };
      if (a.profileId === 'legacy' && a.ownKey) throw { code: 'invalid_settings', message: 'O perfil legado não aceita chave própria.' };
      if (!a.model?.trim()) throw { code: 'invalid_settings', message: 'Informe o modelo.' };
      let parsedUrl: URL;
      try { parsedUrl = new URL(a.endpoint); } catch { throw { code: 'invalid_endpoint', message: 'Endereço do Provedor inválido.' }; }
      if (!parsedUrl.hostname || !['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
        throw { code: 'invalid_endpoint', message: 'Endereço do Provedor inválido.' };
      }
      if (a.timeoutSecs !== undefined && a.timeoutSecs !== null && (typeof a.timeoutSecs !== 'number' || a.timeoutSecs < 1 || a.timeoutSecs > 3600)) {
        throw { code: 'invalid_settings', message: 'Timeout inválido (1..3600 s).' };
      }
      if (a.profileId === 'legacy') {
        providerMock = { ...providerMock, kind: a.kind, endpoint: a.endpoint, model: a.model, nativeSchema: a.nativeSchema, context: a.context ?? null, remote: !isLocalHost(a.endpoint), confirmed: providerMock.confirmedEndpoints.includes(a.endpoint) };
        return { profileId: 'legacy' } as T;
      }
      const old = profileMocks.find(p => p.id === a.profileId);
      const next = { id: a.profileId, label: a.label, kind: a.kind, endpoint: a.endpoint, model: a.model, nativeSchema: a.nativeSchema, context: a.context ?? null, maxOutput: 'maxOutput' in a ? a.maxOutput : old?.maxOutput ?? null, timeoutSecs: 'timeoutSecs' in a ? a.timeoutSecs : old?.timeoutSecs ?? null, tokensPerRequest: 'tokensPerRequest' in a ? a.tokensPerRequest : old?.tokensPerRequest ?? null, tokensPerMinute: 'tokensPerMinute' in a ? a.tokensPerMinute : old?.tokensPerMinute ?? null, tokensPerDay: 'tokensPerDay' in a ? a.tokensPerDay : old?.tokensPerDay ?? null, ownKey: a.ownKey ?? old?.ownKey ?? false, keyLastFour: old?.keyLastFour ?? null };
      profileMocks = old ? profileMocks.map(p => p.id === a.profileId ? next : p) : [...profileMocks, next];
      return { profileId: a.profileId } as T;
    }
    if (name === 'provider.configure') {
      providerCliMock.selected = '';
      const { kind, endpoint, model, nativeSchema, context } = args as { kind: string; endpoint: string; model: string; nativeSchema: boolean; context?: number | null };
      let hostname: string;
      try {
        hostname = new URL(endpoint).hostname;
      } catch {
        throw { code: 'invalid_endpoint', message: 'Endereço do Provedor inválido.' };
      }
      const same = endpoint === providerMock.endpoint;
      providerMock = { kind, endpoint, model, nativeSchema, context: context ?? null, keyLastFour: same ? providerMock.keyLastFour : null, confirmed: same && providerMock.confirmed, confirmedEndpoints: providerMock.confirmedEndpoints, remote: !['localhost', '127.0.0.1', '[::1]'].includes(hostname) };
      return {} as T;
    }
    if ((name === 'provider.key.set' || name === 'provider.key.remove') && (args as { profileId?: string }).profileId && (args as { profileId?: string }).profileId !== 'legacy') {
      const { profileId, key } = args as { profileId: string; key?: string };
      const lastFour = name === 'provider.key.set' ? key!.slice(-4) : null;
      const alvo = profileMocks.find(p => p.id === profileId);
      profileMocks = profileMocks.map(p => p.id === profileId ? { ...p, keyLastFour: lastFour } : p);
      if (alvo && !alvo.ownKey && alvo.endpoint === providerMock.endpoint) {
        providerMock.keyLastFour = lastFour;
      }
      return {} as T;
    }
    if (name === 'provider.key.set') { providerMock.keyLastFour = (args as { key: string }).key.slice(-4); return {} as T; }
    if (name === 'provider.key.remove') { providerMock.keyLastFour = null; return {} as T; }
    if (name === 'provider.confirm') { const endpoint = (args as { endpoint: string }).endpoint; if (endpoint === providerMock.endpoint) providerMock.confirmed = true; providerMock.confirmedEndpoints.push(endpoint); return {} as T; }
    if (name === 'provider.prices.get' || name === 'provider.prices.set' || name === 'provider.prices.clear') {
      const a = args as { provider?: string; model?: string; inputPerMillion?: number; outputPerMillion?: number; tiers?: { aboveInputTokens: number; inputPerMillion: number; outputPerMillion: number }[] };
      if (name === 'provider.prices.set') {
        const prov = String(a.provider ?? '').trim();
        const mod = String(a.model ?? '').trim();
        if (!prov || !mod || typeof a.inputPerMillion !== 'number' || a.inputPerMillion < 0 || typeof a.outputPerMillion !== 'number' || a.outputPerMillion < 0) {
          throw { code: 'invalid_price', message: 'Preço inválido.' };
        }
        if (a.tiers && a.tiers.some((t, i) => t.aboveInputTokens <= 0 || t.inputPerMillion < 0 || t.outputPerMillion < 0 || (i > 0 && t.aboveInputTokens <= a.tiers![i - 1].aboveInputTokens))) {
          throw { code: 'invalid_price', message: 'Faixas de preço inválidas.' };
        }
        priceOverrides = [...priceOverrides.filter(p => !(p.provider === prov && p.model === mod)), { provider: prov, model: mod, inputPerMillion: a.inputPerMillion, outputPerMillion: a.outputPerMillion }];
      }
      if (name === 'provider.prices.clear') {
        if (!a.provider || !a.model) throw { code: 'invalid_price', message: 'Preço inválido.' };
        priceOverrides = priceOverrides.filter(p => !(p.provider === a.provider && p.model === a.model));
      }
      const prices = [
        { provider: 'openai', model: 'gpt-5', inputPerMillion: 1.25, outputPerMillion: 10 },
        { provider: 'openai', model: 'gpt-4o-mini', inputPerMillion: 0.15, outputPerMillion: 0.6 },
        { provider: 'anthropic', model: 'claude-sonnet-4-5', inputPerMillion: 3, outputPerMillion: 15 },
        { provider: 'gemini', model: 'gemini-2.5-flash-lite', inputPerMillion: 0.1, outputPerMillion: 0.4 },
        { provider: 'groq', model: 'openai/gpt-oss-120b', inputPerMillion: 0.15, outputPerMillion: 0.6 },
      ];
      return { updatedAt: '2026-11-14', prices, overrides: priceOverrides } as T;
    }
    if (name === 'provider.cost.estimate') {
      const a = args as { transcript?: string; maxOutputTokens?: number; profileId?: string; task?: string };
      const transcript = a.transcript ?? '';
      const maxOutputTokens = a.maxOutputTokens;
      const inputTokens = Math.ceil((transcript.length + 2) / 4);
      const high = Math.ceil(inputTokens * 5 / 3);
      const tier = high > 100000 ? { aboveInputTokens: 100000, upToInputTokens: null, crossesThreshold: inputTokens <= 100000 } : null;
      if (a.profileId || a.task) {
        let rota = a.profileId ?? '';
        if (!rota && a.task) rota = assistantMock.tasks[a.task] || assistantMock.default;
        const target = taskTarget(rota.startsWith('profile:') || ['codex', 'claude', 'opencode', 'endpoint'].includes(rota) ? rota : rota === 'legacy' ? 'endpoint' : `profile:${rota}`);
        if (target) {
          if ((a.task && assistantMock.localOnly[a.task]) || (getActiveProjectMock() && projectVetoMock)) {
            if (!target.local) throw { code: 'local_only_violation', message: 'Bloqueado pelo modo Somente local.' };
          }
          if (target.local) {
            return { kind: 'zero', callsOnly: false, inputTokens, inputTokensRange: { min: inputTokens, max: high }, tier: null, maxOutputTokens: maxOutputTokens ?? null, minMicroUsd: 0, maxMicroUsd: 0, priceSource: null, tableUpdatedAt: '2026-11-14', profileId: target.id } as T;
          }
          if (target.cli) {
            const free = target.kind === 'opencode' && target.cost.kind === 'zero';
            return { kind: free ? 'zero' : target.kind === 'opencode' ? 'unknown' : 'plan_quota', callsOnly: !free, inputTokens, inputTokensRange: { min: inputTokens, max: high }, tier: null, maxOutputTokens: maxOutputTokens ?? null, minMicroUsd: free ? 0 : null, maxMicroUsd: free ? 0 : null, priceSource: null, tableUpdatedAt: '2026-11-14', profileId: target.id } as T;
          }
          const builtIn = [
            { provider: 'openai', model: 'gpt-5', inputPerMillion: 1.25, outputPerMillion: 10 },
            { provider: 'openai', model: 'gpt-4o-mini', inputPerMillion: 0.15, outputPerMillion: 0.6 },
            { provider: 'anthropic', model: 'claude-sonnet-4-5', inputPerMillion: 3, outputPerMillion: 15 },
            { provider: 'gemini', model: 'gemini-2.5-flash-lite', inputPerMillion: 0.1, outputPerMillion: 0.4 },
            { provider: 'groq', model: 'openai/gpt-oss-120b', inputPerMillion: 0.15, outputPerMillion: 0.6 },
          ];
          const ov = priceOverrides.find(p => p.provider === target.kind && p.model === target.model);
          const tab = builtIn.find(p => p.provider === target.kind && p.model === target.model);
          const price = ov ?? tab;
          if (!price) {
            return { kind: 'unknown', callsOnly: false, inputTokens, inputTokensRange: { min: inputTokens, max: high }, tier: null, maxOutputTokens: maxOutputTokens ?? null, minMicroUsd: null, maxMicroUsd: null, priceSource: null, tableUpdatedAt: '2026-11-14', profileId: target.id } as T;
          }
          return { kind: 'usd', callsOnly: false, inputTokens, inputTokensRange: { min: inputTokens, max: high }, tier, maxOutputTokens: maxOutputTokens ?? null, minMicroUsd: Math.round(inputTokens * price.inputPerMillion), maxMicroUsd: maxOutputTokens ? Math.round(high * price.inputPerMillion + maxOutputTokens * price.outputPerMillion) : Math.round(high * price.inputPerMillion), priceSource: ov ? 'override' : 'table', tableUpdatedAt: '2026-11-14', profileId: target.id } as T;
        }
      }
      return { kind: 'usd', inputTokens, inputTokensRange: { min: inputTokens, max: high }, tier, maxOutputTokens: maxOutputTokens ?? null, minMicroUsd: Math.round(inputTokens * 1.25), maxMicroUsd: maxOutputTokens ? Math.round(high * 1.25 + maxOutputTokens * 10) : null, priceSource: 'table', tableUpdatedAt: '2026-11-14' } as T;
    }
    if (name === 'provider.cost.list') {
      if (!getActiveProjectMock()) throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto.' };
      return [
        { id: 1, jobId: 48, task: 'selection', taskVersion: 4, attempt: 1, outcome: 'ok', code: 'ok', batch: null, profile: 'legacy', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 14200, outputTokens: 1180, calls: 1, costKind: 'usd', microUsd: 30000, estimateMicroUsd: 30000, durationMs: 2400, priceSource: 'table', tableUpdatedAt: '2026-11-15', createdAt: 1794942840000000 },
        { id: 2, jobId: 47, task: 'packaging', taskVersion: 2, attempt: 1, outcome: 'invalid_json', code: 'invalid_json', batch: null, profile: 'legacy', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 6400, outputTokens: 920, calls: 1, costKind: 'usd', microUsd: 40000, estimateMicroUsd: 30000, durationMs: 3100, priceSource: 'table', tableUpdatedAt: '2026-11-15', createdAt: 1794942480000000 },
        { id: 3, jobId: 46, task: 'script', taskVersion: 1, attempt: 1, outcome: 'ok', code: 'ok', batch: null, profile: 'codex', provider: 'cli:codex', model: '', inputTokens: null, outputTokens: null, calls: 1, costKind: 'plan_quota', microUsd: null, estimateMicroUsd: null, durationMs: 4800, priceSource: null, tableUpdatedAt: '2026-11-15', createdAt: 1794941700000000 },
      ] as T;
    }
    if (name === 'provider.audit.list') {
      if (!getActiveProjectMock()) throw { code: 'project_not_open', message: 'Nenhum Projeto está aberto.' };
      const jobFilter = (args as { job?: number }).job;
      const rows = [
        { id: 1, providerKind: 'openai', host: 'api.openai.com', model: 'gpt-4o-mini', promptSha256: '4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a', inputSha256: '8f3a111122223333444455556666777788889999aaaabbbbccccddddeeee91c2', sentBytes: 54120, responseSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', task: 'selection', taskVersion: 4, outcome: 'ok', costId: 1, transcriptionCallId: null, job: 48 },
        { id: 2, providerKind: 'openai', host: 'api.openai.com', model: 'gpt-4o-mini', promptSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', inputSha256: '7a09111122223333444455556666777788889999aaaabbbbccccddddeeeee211', sentBytes: 19110, responseSha256: null, task: 'packaging', taskVersion: 2, outcome: 'invalid_json', costId: 2, transcriptionCallId: null, job: 47 },
        { id: 3, providerKind: 'ollama', host: '127.0.0.1:11434', model: 'qwen2.5:14b', promptSha256: '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae', inputSha256: '3c1d111122223333444455556666777788889999aaaabbbbccccddddeeee44b0', sentBytes: 18904, responseSha256: 'ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d', task: 'translation', taskVersion: 1, outcome: 'ok', costId: null, transcriptionCallId: null, job: 45 },
      ];
      return (typeof jobFilter === 'number' ? rows.filter(r => r.job === jobFilter) : rows) as T;
    }
    if (name === 'provider.test' && providerCliMock.selected === 'opencode' && new URLSearchParams(location.search).has('opencode-free-limit')) throw { code: 'cli_free_limit', message: 'OpenCode free quota exhausted; retry after 79181 seconds; no automatic retry' };
    if (name === 'provider.test' && (args as { probeContext?: boolean }).probeContext) return { truncated: true, measured: 2048 } as T;
    if (name === 'provider.test') {
      emitirProgressoMock({ job: 'provider.structured', project: null, stage: 'starting', percentage: 0, message: 'Testando conexão', error: null });
      emitirProgressoMock({ job: 'provider.structured', project: null, stage: 'complete', percentage: 100, message: 'Conexão verificada', error: null });
      return { schemaVersion: 1 } as T;
    }
    if (name === 'components.manifest') return [
      { id: 'ffmpeg', version: 'test', size: 2000000, license: 'GPL-3.0-or-later', source_url: 'https://github.com/FFmpeg/FFmpeg' },
      { id: 'yt-dlp', version: 'test', size: 1000000, license: 'Unlicense', source_url: 'https://github.com/yt-dlp/yt-dlp' },
      { id: 'deno', version: '2.9.8', size: 42917472, license: 'MIT', source_url: 'https://github.com/denoland/deno/tree/v2.9.8' },
      { id: 'pocket-tts', version: '3.3.0', size: 7914990, license: 'MIT', source_url: 'https://github.com/kyutai-labs/pocket-tts/tree/v4.0.1' },
      { id: 'uv', version: '0.13.8', size: 15000000, license: 'Apache-2.0', source_url: 'https://github.com/astral-sh/uv' },
    ] as T;
    if (name === 'components.catalog.status') return { ...catalogMock } as T;
    if (name === 'components.catalog.check') {
      if (catalogScenario === 'invalid-signature') {
        throw { code: 'catalog_signature_invalid', message: 'Assinatura do catálogo remoto inválida; usando o catálogo embutido.' };
      }
      if (catalogScenario === 'offline') {
        throw { code: 'catalog_network', message: 'Não foi possível consultar o catálogo remoto de modelos.' };
      }
      if (catalogScenario === 'update' && catalogMock.version === 1) {
        catalogMock.version = 2;
        catalogMock.source = 'remote';
        catalogMock.warning = null;
        catalogMock.warningCode = null;
        return { ...catalogMock, previousVersion: 1, updated: true, upToDate: false } as T;
      }
      return { ...catalogMock, previousVersion: catalogMock.version, updated: false, upToDate: true } as T;
    }
    if (name === 'components.models.manifest') {
      const revs = catalogMock.version > 1 ? MODEL_REV_V2 : MODEL_REV_V1;
      const smallInstalled = modelInstalledRevs.get('whisper-small') ?? null;
      const turboInstalled = modelInstalledRevs.get('whisper-turbo') ?? null;
      const yunetInstalled = modelInstalledRevs.get('yunet') ?? null;
      return [
        { worker_installed: workerInstalledMock, id: 'whisper-turbo', label: 'Whisper large-v3-turbo (GPU NVIDIA)', repo: 'dropbox-dash/faster-whisper-large-v3-turbo', revision: revs['whisper-turbo'], license: 'MIT', source_url: `https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo/tree/${revs['whisper-turbo']}`, size: 1621666000, installed: turboInstalled !== null, installed_revision: turboInstalled, update_available: turboInstalled !== null && turboInstalled !== revs['whisper-turbo'], recommended: true, catalog_version: catalogMock.version, catalog_source: catalogMock.source },
        { worker_installed: workerInstalledMock, id: 'whisper-small', label: 'Whisper small (CPU)', repo: 'Systran/faster-whisper-small', revision: revs['whisper-small'], license: 'MIT', source_url: `https://huggingface.co/Systran/faster-whisper-small/tree/${revs['whisper-small']}`, size: 486212372, installed: smallInstalled !== null, installed_revision: smallInstalled, update_available: smallInstalled !== null && smallInstalled !== revs['whisper-small'], recommended: false, catalog_version: catalogMock.version, catalog_source: catalogMock.source },
        { worker_installed: workerInstalledMock, id: 'yunet', label: 'YuNet (reenquadramento)', repo: 'opencv/opencv_zoo', revision: revs.yunet, license: 'MIT', source_url: `https://github.com/opencv/opencv_zoo/tree/${revs.yunet}/models/face_detection_yunet`, size: 232589, installed: yunetInstalled !== null, installed_revision: yunetInstalled, update_available: yunetInstalled !== null && yunetInstalled !== revs.yunet, recommended: false, catalog_version: catalogMock.version, catalog_source: catalogMock.source },
      ] as T;
    }
    if (name.startsWith('transcription.hardware.') || name === 'transcription.estimate' || name === 'transcription.grouping') return hardwareMockDispatch(name, args) as T;
    if (name === 'components.models.download') {
      const a = args as { id: string; confirmed?: boolean };
      if (!a.confirmed) throw { code: 'confirmation_required', message: 'Confirme o download antes de iniciar' };
      if (!workerInstalledMock) throw { code: 'worker_missing', message: 'Instale o worker Python antes de baixar o modelo.' };
      const revs = catalogMock.version > 1 ? MODEL_REV_V2 : MODEL_REV_V1;
      const rev = revs[a.id as keyof typeof revs] ?? MODEL_REV_V1['whisper-small'];
      await runCancellableSteps(
        a.id,
        [
          { stage: 'download', percentage: 0, message: 'Baixando modelo' },
          { stage: 'download', percentage: 55, message: 'Baixando modelo' },
          { stage: 'complete', percentage: 100, message: 'Modelo instalado', delayMs: 5 },
        ],
        () => {
          modelInstalledRevs.set(a.id, rev);
        },
      );
      return { id: a.id } as T;
    }
    if (name === 'transcription.segment') return { transcript_id: 1, sentences: 30000, changed: false } as T;
    // Editor, áudio, legendas e reenquadramento disponíveis sem portão ?editor-test.
    if (name.startsWith('editor.') || name.startsWith('audio.') || name.startsWith('captions.') || name.startsWith('reframe.') || name === 'export.captions') return editorMock(name, args as Record<string, number>) as T;
    const translated = translationMockDispatch(name, args);
    if (translated !== undefined) return translated as T;
    if (name === 'proxy.request') {
      const a = args as { source_id: number; start_us: number; end_us: number };
      const src = sourceItems.find((s) => s.id === a.source_id);
      const offlineForcado = !hasSearchFlag('source-test') && readEstadoParam() === 'offline';
      if (offlineForcado || a.source_id === 2 || src?.status === 'offline') {
        throw { code: 'source_offline', message: 'A Fonte está offline: reconecte ou relocalize a Fonte para ver o preview.' };
      }
      if (!src) throw { code: 'source_missing', message: 'Fonte não encontrada.' };
      const srcHex = a.source_id.toString(16).padStart(4, '0').slice(-4);
      const key = `${srcHex}${'ab'.repeat(30)}`;
      const windowStartUs = Math.max(0, a.start_us - 120_000_000);
      const windowEndUs = a.end_us + 120_000_000;
      const prev = proxyJobsMock.get(key);
      if (prev?.timer) clearTimeout(prev.timer);
      mockProxyPolls = 0;
      const entry: ProxyMockEntry = {
        key,
        state: 'running',
        job: 7,
        progress: 40,
        windowStartUs,
        windowEndUs,
        error: null,
        timer: null,
      };
      proxyJobsMock.set(key, entry);
      const active = getActiveProjectMock();
      if (active) {
        emitirProgressoMock({
          job: '7',
          project: active.id,
          stage: 'proxy',
          percentage: 40,
          message: 'Preparando preview do trecho.',
          error: null,
        });
      }
      const delayMs = hasSearchFlag('source-test') ? 1800 : 25;
      entry.timer = setTimeout(() => {
        entry.timer = null;
        if (entry.state === 'failed') return;
        entry.state = 'ready';
        entry.progress = 100;
        const proj = getActiveProjectMock();
        if (proj) {
          emitirProgressoMock({
            job: '7',
            project: proj.id,
            stage: 'proxy',
            percentage: 100,
            message: 'Preview pronto.',
            error: null,
          });
          emitirProgressoMock({
            job: '7',
            project: proj.id,
            stage: 'complete',
            percentage: 100,
            message: 'Preview concluído.',
            error: null,
          });
        }
      }, delayMs);
      return { state: 'running', key, job: 7, progress: 40, error: null, windowStartUs, windowEndUs } as T;
    }
    if (name === 'proxy.status') {
      const a = args as { key: string };
      mockProxyPolls += 1;
      const entry = proxyJobsMock.get(a.key);
      if (entry) {
        if (hasSearchFlag('source-test') && mockProxyPolls > 1 && entry.state === 'running') {
          entry.state = 'ready';
          entry.progress = 100;
        }
        return { state: entry.state, key: entry.key, job: entry.job, progress: entry.progress, error: entry.error } as T;
      }
      return { state: mockProxyPolls > 1 ? 'ready' : 'running', key: a.key, job: 7, progress: mockProxyPolls > 1 ? 100 : 60, error: null } as T;
    }
    if (name === 'proxy.map_time') {
      const a = args as { window_start_us: number; window_end_us: number; source_us?: number; proxy_us?: number };
      if (typeof a.source_us === 'number') {
        if (a.source_us < a.window_start_us || a.source_us > a.window_end_us) {
          return { proxyUs: null } as T;
        }
        return { proxyUs: a.source_us - a.window_start_us } as T;
      }
      if (typeof a.proxy_us === 'number') {
        if (a.proxy_us < 0) return { sourceUs: null } as T;
        const mapped = a.window_start_us + a.proxy_us;
        if (mapped < a.window_start_us || mapped > a.window_end_us) {
          return { sourceUs: null } as T;
        }
        return { sourceUs: mapped } as T;
      }
      return { proxyUs: null, sourceUs: null } as T;
    }
    if (name.startsWith('selection.') || name.startsWith('chat.') || name.startsWith('energy.')) return selectionMockDispatch(name, args) as T;
    if (name === 'transcription.blocks') {
      const sid = (args as { source_id?: number }).source_id;
      const src = typeof sid === 'number' ? sourceItems.find((s) => s.id === sid) : undefined;
      if (!src) throw { code: 'source_missing', message: 'Fonte não encontrada.' };
      const st = transcriptsBySource.get(sid!);
      if (!st?.transcript && !isTranscriptTest()) return [] as T;
      const resumeUs = isTranscriptTest() ? 3_600_000_000 : (st?.transcript?.resume_us ?? 0);
      const blockCount = Math.max(resumeUs > 0 ? 1 : 0, Math.floor(resumeUs / 600_000_000));
      const device = isHardwareCpuMode() ? 'cpu' : 'cuda';
      const compute_type = device === 'cpu' ? 'int8' : 'int8_float16';
      return Array.from({ length: blockCount }, (_, idx) => ({
        start_us: idx * 600_000_000,
        end_us: Math.min(resumeUs, (idx + 1) * 600_000_000),
        device,
        compute_type,
      })) as T;
    }
    if (name === 'transcription.sentences') {
      const { source_id, after_id = 0, limit = 1000 } = args as { source_id: number; after_id?: number; limit?: number };
      if (!sourceItems.some((s) => s.id === source_id)) throw { code: 'source_missing', message: 'Fonte não encontrada.' };
      const capped = Math.max(1, Math.min(10000, limit));
      const out = [];
      for (let id = Math.max(1, after_id + 1); id <= 30000 && out.length < capped; id++) {
        const words = mockWords(source_id, id);
        out.push({
          id,
          start_us: id * 1_000_000,
          end_us: (id + 1) * 1_000_000,
          language: 'pt',
          text: words.map((w) => w.text).join(' '),
          first_position: id * 10,
          last_position: id * 10 + 1,
        });
      }
      return out as T;
    }
    if (name === 'transcription.words') {
      const { source_id, from_us = 0, to_us = Number.MAX_SAFE_INTEGER, limit = 10000 } = args as { source_id: number; from_us?: number; to_us?: number; limit?: number };
      if (!sourceItems.some((s) => s.id === source_id)) throw { code: 'source_missing', message: 'Fonte não encontrada.' };
      const capped = Math.max(1, Math.min(100000, limit));
      const out = [];
      for (let id = 1; id <= 30000 && out.length < capped; id++) {
        if (id === 2 && 2_000_000 >= from_us && 1_000_000 <= to_us) {
          out.push({
            position: 15,
            kind: 'silence',
            text: '',
            start_us: 1_000_000,
            end_us: 2_000_000,
            language: null,
            speaker: null,
            original_text: '',
            corrected: false,
          });
        }
        const words = mockWords(source_id, id);
        for (const w of words) {
          if (out.length >= capped) break;
          const endUs = w.start_us + 500_000;
          if (endUs >= from_us && w.start_us <= to_us) {
            out.push({
              position: w.position,
              kind: 'word',
              text: w.text,
              start_us: w.start_us,
              end_us: endUs,
              language: 'pt',
              speaker: null,
              original_text: mockOriginal(w.position),
              corrected: w.corrected,
            });
          }
        }
      }
      return out as T;
    }
    if (name === 'transcription.timeline') { const {source_id, offset = 0, limit = 500} = args as {source_id:number; offset?:number; limit?:number}; const total=30001; return {total, offset, items:Array.from({length:Math.min(limit,total-offset)}, (_, n) => { const i=offset+n; if (i===1) return {type:'silence',start_us:1000000,end_us:2000000}; const id=i===0?1:i; const words=mockWords(source_id,id); return {type:'sentence',id,start_us:i*1000000,end_us:(i+1)*1000000,language:'pt',text:words.map(w=>w.text).join(' '),first_position:id*10,last_position:id*10+1,words}; })} as T; }
    if (name === 'transcription.correct') { const {source_id, position, text} = args as {source_id:number; position:number; text:string}; const value=text.normalize('NFC').trim(); if (!value || value.length > 200) throw {code:'invalid_correction',message:'O texto da correção é inválido.'}; const key=source_id+':'+position; const before=mockCorrected.get(key) ?? null; const after=value===mockOriginal(position) ? null : value; if ((after ?? mockOriginal(position)) === (before ?? mockOriginal(position))) return mockStep(source_id, position, false) as T; mockUndone = []; mockDone.push({source:source_id, position, before, after}); mockApply(source_id, position, after); return mockStep(source_id, position, true) as T; }
    if (name === 'transcription.undo' || name === 'transcription.redo') { const undo=name==='transcription.undo'; const entry=undo ? mockDone.pop() : mockUndone.pop(); if (!entry) throw {code:undo?'nothing_to_undo':'nothing_to_redo',message:'Nada a fazer.'}; (undo ? mockUndone : mockDone).push(entry); mockApply(entry.source, entry.position, undo ? entry.before : entry.after); return mockStep(entry.source, entry.position, true) as T; }
    if (name === 'transcription.corrections') return {can_undo:mockDone.length>0, can_redo:mockUndone.length>0} as T;
    if (name === 'transcription.search') { const q=mockFold(String((args as {query:string}).query)).trim(); const hits:object[]=[]; const row=(id:number)=>id<=1?0:id; const sourceName=(id:number)=>sourceItems.find(s=>s.id===id)?.path.split(/[\\/]/).pop() ?? 'changed.mp4'; for (const [key,value] of mockCorrected) { const [source,position]=key.split(':').map(Number); const id=Math.floor(position/10); const text=mockWords(source,id).map(w=>w.text).join(' '); if (q && mockFold(value).includes(q)) hits.push({transcript_id:1,source_id:source,source:sourceName(source),sentence_id:id,start_us:id*1000000,end_us:(id+1)*1000000,row:row(id),snippet:text.split(value).flatMap((part,k,all)=>k<all.length-1?[{text:part,match:false},{text:value,match:true}]:[{text:part,match:false}]).filter(p=>p.text)}); } const m=/^frase\s*(\d+)$/.exec(q); if (m) { const id=Number(m[1]); hits.push({transcript_id:1,source_id:1,source:'changed.mp4',sentence_id:id,start_us:id*1000000,end_us:(id+1)*1000000,row:row(id),snippet:[{text:'Frase '+id,match:true}]}); } return hits as T; }
    if (name === 'transcription.status') {
      const sid = (args as { source_id?: number }).source_id;
      const src = sourceItems.find((s) => s.id === sid);
      if (isTranscriptTest()) {
        return {
          language: src?.language ?? 'pt',
          transcript: { id: 1, state: 'complete', resume_us: 36000000000, duration_us: 36000000000, model: 'whisper-turbo', engine: 'local', words: 30000 },
          job: null,
        } as T;
      }
      const st = typeof sid === 'number' ? transcriptsBySource.get(sid) : undefined;
      return {
        language: src?.language ?? 'pt',
        transcript: st?.transcript ?? null,
        job: st?.job ?? null,
      } as T;
    }
    if (name === 'transcription.start') {
      const active = requireProjectMock(args);
      if (componentsMissing) throw { code: 'component_missing', message: 'Instale o Componente FFmpeg.' };
      const { source_id, language, engine = 'local', replace_confirmed, retry_confirmed } = args as { source_id?: number; language?: string; engine?: string; replace_confirmed?: boolean; retry_confirmed?: boolean };
      if (typeof source_id !== 'number' || !sourceItems.some((s) => s.id === source_id)) {
        throw { code: 'source_missing', message: 'Fonte não encontrada.' };
      }
      if (language) {
        const currentSt = transcriptsBySource.get(source_id);
        if (currentSt?.transcript && currentSt.transcript.resume_us === 0) {
          sourceItems = sourceItems.map((item) => (item.id === source_id ? { ...item, language } : item));
        } else if (!currentSt?.transcript) {
          sourceItems = sourceItems.map((item) => (item.id === source_id ? { ...item, language } : item));
        }
      }
      if (engine === 'groq' && projectVetoMock) {
        throw { code: 'local_only_violation', message: 'Bloqueado pelo modo Somente local.' };
      }
      if (engine === 'groq' && groqUncertain && !retry_confirmed) throw { code: 'transcription_retry_confirmation', usage: { estimate: { kind: 'usd', usd: 0.00012 } } };
      groqUncertain = false;
      const previous = transcriptsBySource.get(source_id)?.transcript ?? null;
      if (previous && previous.engine !== engine && !replace_confirmed) {
        throw { code: 'engine_change_confirmation', usage: { blocks: 1, paid_audio_us: previous.engine === 'groq' ? 4e6 : 0, paid_usd: previous.engine === 'groq' ? 0.00012 : 0 } };
      }
      if (engine === 'groq' && !groqConsent) throw { code: 'confirmation_required' };
      const model = engine === 'groq' ? 'whisper-large-v3-turbo' : (isHardwareCpuMode() ? 'whisper-small' : 'whisper-turbo');
      transcriptsBySource.set(source_id, {
        transcript: { id: source_id, engine, model, state: 'running', resume_us: 4000000, duration_us: 10000000, words: 0 },
        job: { id: 99, state: 'running', progress: 40, code: null },
      });
      if (engine === 'local') {
        emitirProgressoMock({
          job: '99',
          project: active.id,
          stage: isHardwareProbeFallbackMode() ? 'gpu_probe_fallback' : 'probe',
          percentage: 0,
          message: isHardwareProbeFallbackMode() ? 'A verificação da GPU falhou; continuando na CPU.' : 'Verificando placa de vídeo',
          error: null,
        });
      }
      emitirProgressoMock({
        job: '99',
        project: active.id,
        stage: 'transcribing',
        percentage: 40,
        message: 'Transcrevendo bloco 1',
        error: null,
      });
      return {
        transcript_id: source_id,
        state: 'running',
        job_id: 99,
        warnings: isHardwareCpuMode() ? ['low_ram'] : [],
      } as T;
    }
    if (name === 'components.settings.get') return { ...componentSettingsMock, ffmpeg_path: ffmpegMock.path } as T;
    if (name === 'components.settings.set') {
      const a = args as { data_dir?: unknown; cache_dir?: unknown; cache_limit_bytes?: unknown; ffmpeg_path?: unknown };
      if (
        !isAbsolutePathMock(a.data_dir) ||
        !isAbsolutePathMock(a.cache_dir) ||
        typeof a.cache_limit_bytes !== 'number' ||
        !Number.isFinite(a.cache_limit_bytes) ||
        a.cache_limit_bytes <= 0
      ) {
        throw { code: 'invalid_settings', message: 'Caminhos absolutos e limite positivo são obrigatórios.' };
      }
      componentSettingsMock.data_dir = a.data_dir.trim();
      componentSettingsMock.cache_dir = a.cache_dir.trim();
      componentSettingsMock.cache_limit_bytes = Math.trunc(a.cache_limit_bytes);
      if (a.ffmpeg_path === null || typeof a.ffmpeg_path === 'string') {
        ffmpegMock.path = a.ffmpeg_path;
      }
      return { ...componentSettingsMock, ffmpeg_path: ffmpegMock.path } as T;
    }
    throw new Error(`Unknown core command: ${name}`);
  }
  return invoke<T>('core_dispatch', { name, arguments: args });
}


// Editor simulado (#61): a Frase n ocupa [(n-1)*10 s, n*10 s]; o Corte vale de 20 a 180 s; a janela do proxy é o Corte ±2 min.
const editorKey = 'ab'.repeat(32);
function editorMock(name: string, a: Record<string, number>) {
  const edited = editorEditsMock(name, a);
  if (edited !== undefined) return edited;
  const captioned = captionsMock(
    name,
    a as Record<string, any>,
    (p, sourceId = 1) => mockCorrected.get(`${sourceId}:${p}`) ?? mockOriginal(p),
  );
  if (captioned !== undefined) return captioned;
  const fail = (code: string, message: string) => { throw { code, message }; };
  const range = () => {
    if (!(a.start_id >= 1 && a.start_id <= 720 && a.end_id >= 1 && a.end_id <= 720)) fail('unknown_sentence_id', 'Frase desconhecida.');
    if (a.end_id < a.start_id) fail('adjust_empty', 'O Corte precisa manter ao menos uma Frase.');
    const startUs = (a.start_id - 1) * 10_000_000, endUs = a.end_id * 10_000_000;
    if (endUs - startUs < 20_000_000) fail('adjust_too_short', 'O Corte ficaria abaixo da duração mínima.');
    if (endUs - startUs > 180_000_000) fail('adjust_too_long', 'O Corte ficaria acima da duração máxima.');
    return { startUs, endUs };
  };
  if (name === 'editor.range') return { request: a, ...range() };
  if (name === 'editor.sentences') {
    const sid = a.source_id ?? 1;
    const afterId = a.after_id ?? 0;
    const limit = a.limit ?? 500;
    const first = Math.max(afterId + 1, Math.ceil(a.start_us / 10_000_000) + 1), last = Math.min(Math.floor(a.end_us / 10_000_000), 720);
    return Array.from({ length: Math.max(0, Math.min(limit, last - first + 1)) }, (_, n) => {
      const id = first + n;
      const words = mockWords(sid, id);
      return { id, startUs: (id - 1) * 10_000_000, endUs: id * 10_000_000, text: words.map((w) => w.text).join(' ') };
    });
  }
  if (name === 'editor.timeline' || name === 'editor.timeline_status') {
    if (name === 'editor.timeline') {
      const proj = getActiveProjectMock()?.id ?? null;
      emitirProgressoMock({ job: '8', project: proj, stage: 'timeline', percentage: 40, message: 'Gerando miniaturas e onda', error: null });
      emitirProgressoMock({ job: '8', project: proj, stage: 'complete', percentage: 100, message: 'Timeline pronta', error: null });
    }
    return { state: 'ready', key: editorKey, job: null, progress: 100, error: null, thumbs: { id: `thumbs/${editorKey}`, count: 150, intervalUs: 2_000_000, width: 96, height: 54, columns: 20 } };
  }
  if (name === 'editor.wave') return { blockUs: 100_000, values: Array.from({ length: 3000 }, (_, i) => 40 + Math.round(120 * Math.abs(Math.sin(i / 7)))) };
  throw new Error(`Unknown core command: ${name}`);
}
