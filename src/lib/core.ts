import { invoke, isTauri } from '@tauri-apps/api/core';
import { editorEditsMock } from './editorEditsMock';
import { captionsMock, getDefaultCaptionStyleMock, setDefaultCaptionStyleMock } from './captionsMock';
import { version } from '../../package.json';
import { exportMock } from '@/features/export/mock';

/** Contrato do Corte para export, compartilhado pela revisão e pelo editor (#61).
 * `export.start` recebe estes campos mais `output` (caminho MP4 escolhido no diálogo).
 */
export type ExportRequest = { source_id: number; start_id: number; end_id: number; candidate_id?: number; clip_id?: number };
import { batchMockDispatch } from './batchMock';
import { packagingMockDispatch } from './packagingMock';
import { thumbnailMockDispatch } from './thumbnailMock';
import { scriptMockDispatch } from './scriptMock';
import { translationMockDispatch } from './translationMock';

const groqRetryTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('groq-retry-test');
const denoMock = { installed: false };
const pocketTtsMock = { installed: false };
const ttsActiveModels: Record<string, string> = { pt: 'portuguese_24l', en: 'english' };
const ttsInstalledModels = new Set<string>();
const narrationGenerated = new Map<number, { blockId: number; voiceId: string; modelId: string; durationUs: number }[]>();
const sourceTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('source-test');
const budgetTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('budget-test');
const transcriptTest = sourceTest && typeof location !== 'undefined' && new URLSearchParams(location.search).has('transcript-test');
// Transcrição simulada: a Frase n tem as palavras n*10 (“Frase”) e n*10+1 (“n”); correções, desfazer e refazer valem por Fonte e posição.
let mockProxyPolls = 0;
const mockCorrected = new Map<string, string>();
let mockDone: {source:number; position:number; before:string|null; after:string|null}[] = [];
let mockUndone: typeof mockDone = [];
const mockOriginal = (position: number) => position % 10 === 0 ? 'Frase' : String(Math.floor(position / 10));
const mockFold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function mockWords(source: number, id: number) { return [0, 1].map(k => { const position = id * 10 + k; const value = mockCorrected.get(source + ':' + position); return { position, text: value ?? mockOriginal(position), corrected: value !== undefined, start_us: id * 1_000_000 + k * 500_000 }; }); }
function mockApply(source: number, position: number, value: string | null) { if (value === null) mockCorrected.delete(source + ':' + position); else mockCorrected.set(source + ':' + position, value); }
function mockStep(source: number, position: number, changed: boolean) { const value = mockCorrected.get(source + ':' + position); return { changed, source_id: source, transcript_id: 1, position, sentence_id: Math.floor(position / 10), text: ' ' + (value ?? mockOriginal(position)), corrected: value !== undefined, can_undo: mockDone.length > 0, can_redo: mockUndone.length > 0 }; }
let sourceItems = [
  { id: 1, path: '/test/changed.mp4', status: 'changed', available: false, verified: false, language: 'pt', permission: {status:'none'} },
  { id: 2, path: '/test/offline.mp4', status: 'offline', available: false, verified: false, language: 'pt', permission: {status:'none'} },
  { id: 3, path: '/test/mismatch.mp4', status: 'changed', available: false, verified: true, language: 'pt', permission: {status:'none'} },
];
let urlSettingsMock = {terms_accepted:false, download_dir:'/test/downloads'};
let jobItems = [
  { id: 1, kind: 'preview', state: 'running', progress: 42, project: 'test-project' },
  { id: 2, kind: 'ai:example', safety: 'paid', state: 'uncertain', progress: 0, project: 'test-project' },
  ...(budgetTest ? [
    { id: 3, kind: 'ai:selection', state: 'queued', progress: 0, project: 'test-project', budgetPause: 'budget_cost', taskCost: {costLabel: null} },
    { id: 4, kind: 'ai:selection', state: 'queued', progress: 0, project: 'test-project', budgetPause: 'cost_unknown', taskCost: {costLabel: 'custo desconhecido'} },
    { id: 5, kind: 'ai:script', state: 'completed', progress: 100, project: 'test-project', budgetPause: null, taskCost: {costLabel: 'consome a cota do plano'} },
  ] : []),
];
let transcribeMock: { transcript: object | null; job: object | null } = groqRetryTest ? {transcript:{id:1,engine:'groq',state:'running',resume_us:4e6,duration_us:10e6,words:1},job:{id:99,state:'cancelled',progress:40}} : { transcript: null, job: null };
if (groqRetryTest || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('hardware-cpu'))) sourceItems.push({id:4,path:'/test/downloaded.mp4',status:'available',available:true,verified:true,language:'pt',permission:{status:'none'}});
let providerMock = { kind: 'openai', endpoint: '', model: '', nativeSchema: false, context: null as number | null, keyLastFour: null as string | null, remote: false, confirmed: false, confirmedEndpoints: [] as string[] };
type ProfileMock = { id: string; label: string; kind: string; endpoint: string; model: string; nativeSchema: boolean; ownKey: boolean; context: number | null; maxOutput?: number | null; timeoutSecs?: number | null; keyLastFour: string | null };
let profileMocks: ProfileMock[] = [];
const isLocalHost = (endpoint: string) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname);
let priceOverrides: { provider: string; model: string; inputPerMillion: number; outputPerMillion: number }[] = [];
const assistantTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('assistant-test');
let assistantMock = { completed: !assistantTest, skipped: false, needsSetup: assistantTest, default: '', tasks: { selection: '', packaging: '', script: '', translation: '' } as Record<string, string>, localOnly: { selection: false, packaging: false, script: false, translation: false } as Record<string, boolean> };
let projectVetoMock = false;
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
  return { ...assistantMock, default: def, needsSetup: !assistantMock.completed && !assistantMock.skipped, tasks, localOnly: { ...assistantMock.localOnly }, missing };
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
const assistantTasks = () => ({ projectLocalOnly: sourceTest && projectVetoMock, tasks: Object.keys(assistantMock.tasks).map(task => {
  const own = assistantMock.tasks[task];
  const choice = own || assistantMock.default;
  const profile = taskTarget(choice);
  const missing = !profile && staleProfile(choice) ? choice.slice(8) : null;
  const localOnly = assistantMock.localOnly[task] ?? false;
  const firstLocal = profileMocks.find(p => isLocalHost(p.endpoint));
  return { task, choice: missing ? '' : own, source: missing ? 'none' : own ? 'task' : assistantMock.default ? 'default' : 'none', profile, localOnly, blocked: (localOnly || (sourceTest && projectVetoMock)) && !!profile && !profile.local, missing,
    suggestion: !profile && firstLocal ? { choice: `profile:${firstLocal.id}`, label: firstLocal.label, measured: false } : null };
}) });
let groqKeyConfigured = groqRetryTest;
let groqConsent = groqRetryTest;
let groqUncertain = groqRetryTest;
let providerCliMock = { selected: '', codexConfirmed: false, claudeConfirmed: false, opencodeConfirmed: false, opencodeModel: '' };
// Mock do hardware da Transcrição (#50): GPU NVIDIA por padrão, CPU com `?hardware-cpu=1`.
const hardwareCpuMode = typeof location !== 'undefined' && new URLSearchParams(location.search).has('hardware-cpu');
const GIB = 1024 ** 3;
const hardwareMock = { manual: null as { model: string; device: string; compute_type: string } | null, probed: false };
function hardwareMockDispatch(name: string, args: object): unknown {
  const auto = hardwareCpuMode ? { model: 'whisper-small', device: 'cpu', compute_type: 'int8' } : { model: 'whisper-turbo', device: 'cuda', compute_type: 'int8_float16' };
  const effective = hardwareMock.manual ?? auto;
  const cpu = effective.device === 'cpu';
  if (name === 'transcription.hardware.choose') {
    const a = args as { reset?: boolean; model?: string; device?: string; compute_type?: string };
    if (a.reset) hardwareMock.manual = null;
    else hardwareMock.manual = { model: a.model ?? '', device: a.device ?? '', compute_type: a.compute_type ?? '' };
    return hardwareMockDispatch('transcription.hardware.status', {});
  }
  if (name === 'transcription.hardware.probe') { hardwareMock.probed = true; return { chosen: auto, verified: true, measured_at: 1790000000, attempts: [] }; }
  if (name === 'transcription.estimate') {
    const rate = cpu ? (effective.model === 'whisper-turbo' ? 4.1 : 2.57) : 0.386;
    const seconds = 5 + rate * 36000;
    return { ...effective, load_s: 5, rate, estimate_s: seconds, low_s: seconds * 0.7, high_s: seconds * 1.5, sample_start_us: 9e9, sample_us: 30e6, cached: false, measured_at: 1790000000, cpu, warnings: effective.model === 'whisper-turbo' && cpu ? ['low_ram'] : [] };
  }
  const options = [['whisper-turbo', 'cuda', 'int8_float16'], ['whisper-turbo', 'cuda', 'float16'], ['whisper-turbo', 'cuda', 'int8'], ['whisper-turbo', 'cpu', 'int8'], ['whisper-small', 'cpu', 'int8']].map(([model, device, compute_type]) => ({ model, device, compute_type, installed: true, enabled: !(hardwareCpuMode && device === 'cuda'), reason: hardwareCpuMode && device === 'cuda' ? 'no_cuda' : null }));
  return {
    gpu: hardwareCpuMode ? null : { name: 'NVIDIA GeForce RTX 3050 Laptop GPU', driver: '616.92', total_mib: 4096, free_mib: 3962 },
    ram: { total: 16 * GIB, available: 9 * GIB }, cuda: !hardwareCpuMode, no_compatible_gpu: cpu, effective, manual: hardwareMock.manual !== null,
    probe: hardwareMock.probed ? { measured_at: 1790000000, verified: true, chosen: auto } : null, options, worker_installed: true,
  };
}

// Seleção de Cortes simulada (#53): quatro Janelas; a terceira falha até ser refeita. `selection-paid` simula Provedor pago e `selection-blocked` o contexto pequeno demais.
const chatMock = { fetched: false };
const selectionFlag = (name: string) => typeof location !== 'undefined' && new URLSearchParams(location.search).has(name);
const selectionWeightsDirect = [{key:'hook',weight:0.3},{key:'selfContained',weight:0.2},{key:'energy',weight:0.2},{key:'value',weight:0.15},{key:'closing',weight:0.15}];
// Vídeo transformado (#67): 6º eixo `commentary` e os pesos da decisão de 15/11/2026.
const selectionWeightsTransformed = [{key:'commentary',weight:0.3},{key:'hook',weight:0.2},{key:'energy',weight:0.15},{key:'value',weight:0.15},{key:'selfContained',weight:0.1},{key:'closing',weight:0.1}];
const selectionMock = { run: null as null | { id: number; ticks: number; state: string; cancelled: boolean; redone: boolean; videoKind: string; revision?: number; redoProfile?: string } };
const weightsOf = (kind: string) => kind === 'transformed' ? selectionWeightsTransformed : selectionWeightsDirect;
function selectionAxes(scores: number[], kind: string) { return Object.fromEntries(weightsOf(kind).map((w, i) => [w.key, { score: scores[i % scores.length], why: `Motivo do eixo ${w.key}.` }])); }
// Revisão simulada (#55): Frases de 10 s (a Frase k vai de 10(k-1) s a 10k s), faixa de 20 s a 3 min e pilha de decisões.
type MockReview = { status: 'pending' | 'approved' | 'rejected'; start: number; end: number; origin: [number, number] };
const reviewMock = { items: new Map<number, MockReview>([[1, { status: 'pending', start: 10, end: 14, origin: [10, 14] }], [2, { status: 'pending', start: 40, end: 41, origin: [40, 41] }], [3, { status: 'pending', start: 200, end: 203, origin: [200, 203] }]]), history: [] as { id: number; before: MockReview }[] };
function mockMoves(r: MockReview) {
  const ok = (start: number, end: number) => start >= 1 && end <= 240 && start <= end && (end - start + 1) * 10 >= 20 && (end - start + 1) * 10 <= 180;
  return { startEarlier: ok(r.start - 1, r.end), startLater: ok(r.start + 1, r.end), endEarlier: ok(r.start, r.end - 1), endLater: ok(r.start, r.end + 1) };
}
function mockItem(id: number) {
  const r = reviewMock.items.get(id)!;
  return { candidate: id, status: r.status, adjusted: r.start !== r.origin[0] || r.end !== r.origin[1], startId: r.start, endId: r.end, startUs: (r.start - 1) * 10_000_000, endUs: r.end * 10_000_000, startText: `Primeira frase ${r.start} do Corte.`, endText: `Última frase ${r.end} do Corte.`, moves: mockMoves(r) };
}
function selectionReviewMock(name: string, args: object): unknown {
  const a = args as { candidate?: number; decision?: 'approved' | 'rejected'; edge?: 'start' | 'end'; delta?: number };
  const answer = (id: number | null) => ({ run: 1, item: id === null ? null : mockItem(id), canUndo: reviewMock.history.length > 0 });
  if (name === 'selection.review') return { run: 1, items: [...reviewMock.items.keys()].map(mockItem), canUndo: reviewMock.history.length > 0 };
  if (name === 'selection.undo') {
    const last = reviewMock.history.pop();
    if (!last) throw { code: 'nothing_to_undo', message: 'Não há decisão para desfazer.' };
    reviewMock.items.set(last.id, last.before);
    return answer(last.id);
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
function selectionMockDispatch(name: string, args: object): unknown {
  const paid = selectionFlag('selection-paid');
  const asked = args as { run?: number; profileId?: string; windows?: number[]; confirmed?: boolean };
  // Refazer com outro perfil (#126): selection-redo traz um perfil remoto (forte) e um local (leve); selection-localonly veta o remoto; selection-uncertain deixa a Janela 1 incerta.
  if (name === 'selection.estimate' && asked.run && asked.profileId) {
    if (selectionFlag('selection-localonly') && asked.profileId === 'forte') throw { code: 'local_only_violation', message: 'local only' };
    const remote = asked.profileId === 'forte';
    return { profile: { id: asked.profileId, label: remote ? 'Forte remoto' : 'Leve local', model: remote ? 'forte-1' : 'leve-1' }, paid: remote, leavesMachine: remote, windows: asked.windows ?? [], estimate: remote ? { kind: 'usd', units: 1, windows: 1, inputTokens: 9000, minMicroUsd: 2400, maxMicroUsd: 9800 } : { kind: 'zero', units: 1, windows: 1, inputTokens: 9000, minMicroUsd: 0, maxMicroUsd: 0 } };
  }
  if (name === 'selection.redo' && asked.profileId) {
    if (selectionFlag('selection-uncertain')) throw { code: 'window_uncertain', message: 'incerta' };
    if (asked.profileId === 'forte' && !asked.confirmed) throw { code: 'confirmation_required', message: 'confirmação obrigatória' };
    const current = selectionMock.run;
    if (current) { current.redoProfile = asked.profileId; current.revision = 2; }
    return { run: 1, windows: asked.windows ?? [], profile: { id: asked.profileId } };
  }
  const estimate = { kind: paid ? 'usd' : 'zero', windows: 4, inputTokens: 40000, minMicroUsd: paid ? 1200 : 0, maxMicroUsd: paid ? 5400 : 0 };
  if (name === 'energy.status') {
    if (selectionFlag('selection-energy-queued')) return { measured: false, marks: { high: 0, peak: 0 }, job: { id: 1, state: 'queued', progress: 0 } };
    if (selectionFlag('selection-energy-running')) return { measured: false, marks: { high: 0, peak: 0 }, job: { id: 1, state: 'running', progress: 45 } };
    if (selectionFlag('selection-energy')) return { measured: true, marks: { high: 4, peak: 2 }, job: { id: 1, state: 'completed', progress: 100 } };
    return { measured: false, marks: { high: 0, peak: 0 }, job: null };
  }
  if (name === 'chat.status') return { state: chatMock.fetched ? 'available' : 'none', canFetch: !selectionFlag('chat-local'), peaks: chatMock.fetched ? 3 : 0, job: null };
  if (name === 'chat.fetch') { chatMock.fetched = true; return { state: 'queued', job: 1 }; }
  if (name === 'selection.estimate') {
    if (selectionFlag('selection-blocked')) throw { code: 'context_too_small', message: 'O contexto efetivo de 4096 tokens (definido por você no perfil) não comporta a janela mínima. Aumente o contexto no Perfil de Provedor ou escolha outro perfil.' };
    const kind = (args as { videoKind?: string }).videoKind ?? 'direct';
    return { paid, profile: 'legacy', videoKind: kind, plan: { state: 'full', windows: [{}, {}, {}, {}], contextTokens: 32768 }, weights: weightsOf(kind), estimate };
  }
  const run = selectionMock.run;
  if (name === 'selection.list') return run ? [{ id: run.id, state: run.state, createdAt: '2026-11-15T12:00:00Z', videoKind: run.videoKind, weights: weightsOf(run.videoKind), budgetPause: null, counts: { windows: 4, completed: 0, failed: 0, kept: 0, discarded: 0, merged: 0 } }] : [];
  if (name === 'selection.start') {
    if (paid && !(args as { confirmed?: boolean }).confirmed) throw { code: 'confirmation_required', message: 'confirmação obrigatória' };
    const kind = (args as { videoKind?: string }).videoKind ?? 'direct';
    selectionMock.run = { id: 1, ticks: 0, state: 'running', cancelled: false, redone: false, videoKind: kind };
    return { run: 1, videoKind: kind, windows: 4, planState: 'full', weights: weightsOf(kind) };
  }
  if (name === 'selection.cancel') { if (run) { run.cancelled = true; run.state = 'partial'; } return null; }
  if (name === 'selection.redo' || name === 'selection.resume') {
    if (paid && !(args as { confirmed?: boolean }).confirmed) throw { code: 'confirmation_required', message: 'confirmação obrigatória' };
    if (run) { run.redone = true; run.state = 'completed'; run.cancelled = false; }
    return { run: 1, windows: [2] };
  }
  if (name === 'selection.review' || name === 'selection.decide' || name === 'selection.adjust' || name === 'selection.undo') return selectionReviewMock(name, args);
  if (name === 'selection.get' && run) {
    run.ticks += 1;
    const failing = !run.redone && !run.cancelled && run.ticks > 1;
    if (run.ticks > 1 && !run.cancelled && run.state === 'running') run.state = failing ? 'partial' : 'completed';
    const states = run.cancelled ? ['completed', 'cancelled', 'cancelled', 'cancelled'] : run.ticks === 1 ? ['completed', 'running', 'queued', 'queued'] : ['completed', 'completed', failing ? 'failed' : 'completed', 'completed'];
    if (selectionFlag('selection-uncertain') && run.ticks > 1) states[0] = 'uncertain';
    const made = (w: number[]) => (run.redoProfile && w.includes(0) ? run.redoProfile : 'legacy');
    const windows = states.map((state, index) => ({ index, firstId: index * 90 + 1, lastId: index * 90 + 90, startUs: index * 720_000_000, endUs: index * 720_000_000 + 900_000_000, jobId: index + 1, state, code: state === 'cancelled' ? 'cancelled' : state === 'failed' ? 'verification_failed' : null }));
    const done = states.filter(s => s === 'completed').length;
    const candidates = run.ticks === 1 && !run.cancelled ? [] : [
      { id: 1, rank: 0, startId: 10, endId: 14, startUs: 90_000_000, endUs: 140_000_000, axes: selectionAxes([9, 8, 7, 9, 8], run.videoKind), total: 8.35, title: 'A virada do jogo', windows: [0, 1], adjusted: false, adjust: null, profile: made([0, 1]), revision: run.revision ?? 1 },
      { id: 2, rank: 1, startId: 40, endId: 41, startUs: 390_000_000, endUs: 410_000_000, axes: selectionAxes([8, 6, 7, 9, 5], run.videoKind), total: 7.1, title: '', windows: [0], adjusted: true, adjust: { extendedAfter: 1 }, profile: made([0]), revision: run.revision ?? 1 },
      { id: 3, rank: 2, startId: 200, endId: 203, startUs: 1_990_000_000, endUs: 2_030_000_000, axes: selectionAxes([4, 4, 4, 4, 4], run.videoKind), total: 4, title: 'Piada longa', windows: [2], adjusted: true, adjust: { trimmedEnd: 3 }, profile: made([2]), revision: run.revision ?? 1 },
    ];
    return { run: { id: 1, state: run.state, videoKind: run.videoKind, summary: { energy: selectionFlag('selection-energy') ? { measured: true, high: 4, peak: 2 } : { measured: false }, chat: selectionFlag('selection-chat') ? { available: true, peaks: 3 } : { available: false } }, weights: weightsOf(run.videoKind), budgetPause: null, createdAt: '2026-11-15T12:00:00Z', counts: { windows: 4, completed: done, failed: states.filter(s => s === 'failed' || s === 'cancelled').length, kept: candidates.length, discarded: 0, merged: 1 } }, windows, candidates };
  }
  throw { code: 'run_not_found', message: 'Execução de seleção não encontrada.' };
}

export async function coreDispatch<T>(name: string, args: object): Promise<T> {
  if (import.meta.env.VITE_CORE_MOCK === '1' && !isTauri()) {
    if ((name.startsWith('export.') && name !== 'export.captions') || (name === 'jobs.cancel' && (args as {id: number}).id >= 5900)) return exportMock(name, args, (source, pos) => mockCorrected.has(`${source}:${pos}`)) as T;
    if (name === 'transcription.groq.info') return {endpoint:'https://api.groq.com/openai/v1/audio/transcriptions',configured:groqKeyConfigured,confirmed:groqConsent,local_only:projectVetoMock} as T;
    if (name === 'transcription.groq.estimate') return {kind:'usd',usd:0.00012,hourly_usd:0.04,checked:'2026-11-15',source:'https://console.groq.com/docs/speech-to-text'} as T;
    if (name === 'transcription.groq.confirm') { groqConsent = true; return {confirmed:true} as T; }
    if (name === 'transcription.groq.key.status') return {configured:groqKeyConfigured} as T;
    if (name === 'transcription.groq.key.set') { groqKeyConfigured = true; return {configured:true} as T; }
    if (name === 'transcription.groq.key.remove') { groqKeyConfigured = false; return {configured:false} as T; }
    if (name === 'transcription.groq.key.test') return {ok:true} as T;
    if (name === 'diagnostic.get') return { text: "Clipes: 0.1.0\nSistema operacional: indisponível" } as T;
    if (name === 'projects.recent') return [] as T;
    if (name === 'projects.current') return (sourceTest ? { name:'Teste', path:'/test/Teste.clipes', id:'test-project' } : null) as T;
    if (name === 'projects.local_only.get') return { open: sourceTest, enabled: sourceTest && projectVetoMock } as T;
    if (name === 'projects.local_only.set') { projectVetoMock = (args as { enabled: boolean }).enabled; return { open: true, enabled: projectVetoMock } as T; }
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
      const videoKind = selectionMock.run?.videoKind ?? channelProfileMock.videoKind;
      const hasDirect = videoKind === 'direct';
      const hasTransformed = videoKind === 'transformed';
      if (scope === 'single') {
        const src = sourceItems.find(s => s.id === (a.source_id ?? 1)) ?? sourceItems[0];
        const granted = src?.permission?.status === 'granted';
        const permObj = src?.permission as { who?: string; where?: string; scope?: string } | undefined;
        let durationUs = 50_000_000;
        if (typeof a.start_id === 'number' && typeof a.end_id === 'number' && a.end_id >= a.start_id) {
          durationUs = (a.end_id - a.start_id + 1) * 10_000_000;
        } else if (typeof a.candidate_id === 'number') {
          const r = reviewMock.items.get(a.candidate_id);
          if (r) durationUs = (r.end - r.start + 1) * 10_000_000;
        }
        const over60s = durationUs > 60_000_000;
        const scriptView = hasTransformed ? (scriptMockDispatch('script.get', { candidate: a.candidate_id ?? 1 }) as { current?: { blocks?: unknown[]; pending?: number } | null; narrationAllowed?: boolean }) : null;
        return {
          scope: 'single',
          directMonetizationAck: ack,
          needsDirectNotice: !ack && hasDirect,
          videoKind,
          hasDirect,
          hasTransformed,
          totalCuts: 1,
          durationUs,
          over60s,
          over60sCount: over60s ? 1 : 0,
          shortClaimLimitUs: 60_000_000,
          permission: { status: granted ? 'granted' : 'none', grantedCount: granted ? 1 : 0, missingCount: granted ? 0 : 1, totalCount: 1, who: permObj?.who ?? null, where: permObj?.where ?? null, scope: permObj?.scope ?? null },
          script: hasTransformed ? { applicable: true, exists: !!scriptView?.current, approved: !!scriptView?.narrationAllowed, pendingBlocks: scriptView?.current?.pending ?? 0, totalBlocks: scriptView?.current?.blocks?.length ?? 0 } : { applicable: false },
          narration: hasTransformed ? (() => { const g = narrationGenerated.get(a.candidate_id ?? 1) ?? []; return { applicable: true, hasTts: g.length > 0, generatedBlocks: g.length, totalBlocks: scriptView?.current?.blocks?.length ?? 0, voices: [...new Set(g.map(x => x.voiceId))] }; })() : { applicable: false },
        } as T;
      }
      const totalCuts = selectionFlag('export-batch-empty') || (scope === 'source' && !selectionMock.run) ? 0 : 2;
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
        permission: { status: 'none', grantedCount: 0, missingCount: totalCuts, totalCount: totalCuts },
        script: hasTransformed && totalCuts > 0 ? { applicable: true, transformedCount: totalCuts, approvedCount: 0, unapprovedCount: totalCuts } : { applicable: false },
        narration: hasTransformed && totalCuts > 0 ? { applicable: true, hasTts: false, ttsCutCount: 0, transformedCount: totalCuts } : { applicable: false },
      } as T;
    }
    if (sourceTest && new URLSearchParams(location.search).has('batch-test')) { const handled = batchMockDispatch(name, args); if (handled !== undefined) return handled as T; }
    if (name.startsWith('thumbnail.')) { const handled = thumbnailMockDispatch(name, args); if (handled !== undefined) return handled as T; }
    if (name.startsWith('script.') || name.startsWith('angles.')) { const handled = scriptMockDispatch(name, args); if (handled !== undefined) return handled as T; }
    if (name.startsWith('packaging.')) {
      const candidate = (args as { candidate?: number }).candidate ?? 1;
      const scriptDoc = scriptMockDispatch('script.get', { candidate }) as { narrationAllowed: boolean; current: { blocks: { id: number; position: number; title: string }[] } | null };
      const generated = narrationGenerated.get(candidate) ?? [];
      const blocks = (scriptDoc.current?.blocks ?? []).map(b => ({
        id: b.id,
        position: b.position,
        title: b.title,
        durationUs: generated.find(g => g.blockId === b.id)?.durationUs ?? null,
      }));
      const kind = selectionMock.run?.videoKind ?? channelProfileMock.videoKind;
      const handled = packagingMockDispatch(name, args, {
        videoKind: kind === 'transformed' ? 'transformed' : 'direct',
        scriptAllowed: scriptDoc.narrationAllowed,
        blocks,
      });
      if (handled !== undefined) return handled as T;
    }
    if (name === 'jobs.list') return (sourceTest ? jobItems : []) as T;
    if (name === 'jobs.cancel' && (args as { id: number }).id === 99) { transcribeMock = { ...transcribeMock, job: { id: 99, state: 'cancelled', progress: 40 } }; return null as T; }
    if (sourceTest && name === 'jobs.estimate') return { safety: 'paid', estimate: { kind: 'unknown' } } as T;
    if (sourceTest && (name === 'jobs.retry' || name === 'jobs.discard' || name === 'jobs.cancel')) {
      const {id, confirmed} = args as {id:number; confirmed?:boolean};
      if (name === 'jobs.retry' && !confirmed) throw {code:'confirmation_required', message:'Confirmação obrigatória'};
      jobItems = jobItems.map(item => item.id === id ? {...item, state: name === 'jobs.retry' ? 'queued' : 'cancelled'} : item);
      return null as T;
    }
    if (sourceTest && name === 'backups.list') return [] as T;
    if (sourceTest && name === 'backups.settings.get') return { interval_seconds: 1800, copies: 10 } as T;
    if (name === 'sources.url.settings.get') return urlSettingsMock as T;
    if (name === 'sources.url.settings.set') { urlSettingsMock = {...urlSettingsMock, ...(args as typeof urlSettingsMock)}; return urlSettingsMock as T; }
    if (sourceTest && name === 'sources.list') return sourceItems as T;
    if (sourceTest && name === 'sources.url.download') { const url=(args as {url:string}).url; if(url.endsWith('/age-test')) throw {code:'age_restricted',message:'test'}; if(url.endsWith('/js-test') && !denoMock.installed) throw {code:'js_runtime_missing',message:'test'}; return {path:'/test/downloaded.mp4',url} as T; }
    if (sourceTest && name === 'sources.inspect') return {format:{duration:'12'},streams:[{index:0,codec_type:'audio',codec_name:'aac'}]} as T;
    if (sourceTest && name === 'sources.import') { const a=args as {path:string;permission:{status:string};origin_url?:string;language?:string}; const item={id:4,path:a.path,status:'available',available:true,verified:true,language:a.language??channelProfileMock.language,permission:a.permission}; sourceItems.push(item); return {...item,origin_url:a.origin_url} as T; }
    if (sourceTest && name === 'sources.language.set') { const { id, language } = args as { id: number; language: string }; sourceItems = sourceItems.map(item => item.id === id ? { ...item, language } : item); return sourceItems.find(item => item.id === id) as T; }

    if (sourceTest && (name === 'sources.hash' || name === 'sources.relocate')) {
      const { id, confirmed } = args as { id: number; confirmed?: boolean };
      if (!confirmed) throw { code:'confirmation_required', message:'confirmation required' };
      sourceItems = sourceItems.map(item => item.id === id ? { ...item, status:'available', available:true, verified:true } : item);
      return {} as T;
    }
    if (name === 'app.version') return { version } as T;
    if (name === 'components.deno.status') return { installed: denoMock.installed, version: denoMock.installed ? '2.9.8' : null, pinned: '2.9.8', outdated: false } as T;
    if (name === 'components.download' && (args as { id?: string }).id === 'deno') { denoMock.installed = true; return { path: '/test/components/deno' } as T; }
    if (name === 'components.pocket_tts.status') return { installed: pocketTtsMock.installed, version: pocketTtsMock.installed ? '3.3.0' : null, pinned: '3.3.0', outdated: false } as T;
    if (name === 'components.download' && (args as { id?: string }).id === 'pocket-tts') { pocketTtsMock.installed = true; return { path: '/test/components/pocket-tts' } as T; }
    if (name === 'tts.catalog' || name === 'tts.models.choose') {
      if (name === 'tts.models.choose') { const a = args as { language: string; modelId: string }; ttsActiveModels[a.language] = a.modelId; }
      return {
        componentInstalled: pocketTtsMock.installed,
        activeModels: { ...ttsActiveModels },
        engines: [{ id: 'pocket-tts', label: 'Pocket TTS (Kyutai)', componentId: 'pocket-tts', codeLicense: 'MIT', sourceUrl: 'https://github.com/kyutai-labs/pocket-tts/tree/v4.0.1', prohibitedUse: { textEn: 'Prohibited use: Use of our model must comply with all applicable laws and regulations and must not result in, involve, or facilitate any illegal, harmful, deceptive, fraudulent, or unauthorized activity.', summaryPt: 'Uso proibido pelo autor do modelo (Kyutai): sem imitação ou clonagem de voz sem consentimento explícito e legal.', version: 'mock' } }],
        models: [
          { id: 'portuguese_24l', engineId: 'pocket-tts', language: 'pt', label: 'Pocket TTS PT-BR (24 camadas · padrão)', description: 'Qualidade superior em PT-BR.', defaultForLanguage: true, lightweight: false, active: ttsActiveModels.pt === 'portuguese_24l', installed: ttsInstalledModels.has('portuguese_24l'), termsAccepted: ttsInstalledModels.has('portuguese_24l'), repo: 'kyutai/pocket-tts-without-voice-cloning', revision: 'a7056f505a4a8ca72d8b5fb1440071d6f1a35739', license: 'CC-BY-4.0', sourceUrl: 'https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/tree/a7056f505a4a8ca72d8b5fb1440071d6f1a35739', size: 701332218 },
          { id: 'portuguese', engineId: 'pocket-tts', language: 'pt', label: 'Pocket TTS PT-BR (6 camadas · leve)', description: 'Variante destilada mais rápida.', defaultForLanguage: false, lightweight: true, active: ttsActiveModels.pt === 'portuguese', installed: ttsInstalledModels.has('portuguese'), termsAccepted: ttsInstalledModels.has('portuguese'), repo: 'kyutai/pocket-tts-without-voice-cloning', revision: 'a7056f505a4a8ca72d8b5fb1440071d6f1a35739', license: 'CC-BY-4.0', sourceUrl: 'https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/tree/a7056f505a4a8ca72d8b5fb1440071d6f1a35739', size: 226502826 },
          { id: 'english', engineId: 'pocket-tts', language: 'en', label: 'Pocket TTS EN (6 camadas · padrão)', description: 'Modelo oficial em inglês.', defaultForLanguage: true, lightweight: true, active: ttsActiveModels.en === 'english', installed: ttsInstalledModels.has('english'), termsAccepted: ttsInstalledModels.has('english'), repo: 'kyutai/pocket-tts-without-voice-cloning', revision: 'a7056f505a4a8ca72d8b5fb1440071d6f1a35739', license: 'CC-BY-4.0', sourceUrl: 'https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/tree/a7056f505a4a8ca72d8b5fb1440071d6f1a35739', size: 231761368 },
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
      ttsInstalledModels.add(a.id);
      return { id: a.id } as T;
    }
    if (name === 'tts.models.cancel') return {} as T;
    if (name === 'narration.get' || name === 'narration.generate' || name === 'narration.regenerate_block') {
      const a = args as { candidate: number; block?: number; voiceId?: string };
      const s = scriptMockDispatch('script.get', { candidate: a.candidate }) as { narrationAllowed: boolean; current: { blocks: { id: number; position: number; title: string; narration: string | null }[] } | null };
      if (name !== 'narration.get') {
        if (!s.narrationAllowed) throw { code: 'script_not_approved', message: 'Aprove o Roteiro.' };
        const voiceId = a.voiceId ?? channelProfileMock.narrationVoice ?? '13063';
        const modelId = ttsActiveModels.pt;
        const blocks = s.current?.blocks ?? [];
        const existing = narrationGenerated.get(a.candidate) ?? [];
        const blockDurationUs = selectionFlag('packaging-chapters') ? 12_000_000 : 3_200_000;
        const next = blocks.map(b => (a.block === undefined || b.id === a.block)
          ? { blockId: b.id, voiceId, modelId, durationUs: blockDurationUs }
          : (existing.find(e => e.blockId === b.id) ?? { blockId: b.id, voiceId, modelId, durationUs: blockDurationUs }));
        narrationGenerated.set(a.candidate, next);
        return { job: 790, candidate: a.candidate } as T;
      }
      const list = narrationGenerated.get(a.candidate) ?? [];
      const blocks = (s.current?.blocks ?? []).map(b => {
        const hit = list.find(x => x.blockId === b.id);
        return {
          blockId: b.id, position: b.position, title: b.title, versionId: 1, narrationText: b.narration,
          audio: hit ? { id: b.id, versionId: 1, voiceId: hit.voiceId, modelId: hit.modelId, relPath: `narrations/c${a.candidate}/b${b.id}-v1.wav`, durationUs: hit.durationUs, sampleRate: 24000, channels: 1, bytes: 153644, stale: false } : null,
        };
      });
      return {
        candidate: a.candidate, narrationAllowed: s.narrationAllowed, gateReason: s.narrationAllowed ? null : 'pending_blocks',
        language: 'pt', defaultVoiceId: channelProfileMock.narrationVoice ?? '13063', activeModelId: ttsActiveModels.pt,
        busy: false, job: null, blocks, totalDurationUs: blocks.reduce((acc, b) => acc + (b.audio?.durationUs ?? 0), 0),
      } as T;
    }
    if (name === 'components.ytdlp.status') return {installed:true,version:'test'} as T;
    if (name === 'components.ytdlp.update') return {version:'test'} as T;
    if (name === 'components.worker.status') return { installed: true, outdated: false, cuda: false, gpu: true, uv: '0.13.8', handshake: { protocol: 1, worker: '0.1.0', python: '3.12.16', libs: { 'faster-whisper': '1.2.1', onnxruntime: '1.32.0', numpy: '2.4.6', 'opencv-python-headless': null } } } as T;
    if (name === 'components.worker.install') return { handshake: null } as T;
    if (name === 'components.ffmpeg.status') return { incomplete: false } as T;
    if (name === 'assistant.status') return assistantView() as T;
    if (name === 'assistant.tasks') return assistantTasks() as T;
    if (name === 'assistant.local_only.set') { const { task, enabled } = args as { task: string; enabled: boolean }; assistantMock.localOnly[task] = enabled; return assistantView() as T; }
    if (name === 'assistant.detect') return { ollama: { found: true, endpoint: 'http://127.0.0.1:11434/v1', models: ['llama3:8b', 'qwen3'] }, lmStudio: { found: false, endpoint: null, models: [] }, llamaCpp: { found: false, endpoint: null, models: [] }, codex: { found: true }, claude: { found: false }, opencode: { found: true } } as T;
    if (name === 'assistant.default.set' || name === 'assistant.task.set') {
      const { choice, task } = args as { choice: string; task?: string };
      if ((choice === 'codex' && !providerCliMock.codexConfirmed) || (choice === 'claude' && !providerCliMock.claudeConfirmed) || (choice === 'opencode' && !providerCliMock.opencodeConfirmed)) throw { code: 'confirmation_required', message: 'confirmation required' };
      if (choice.startsWith('profile:') && (!knownProfile(choice.slice(8)) || ['codex', 'claude', 'opencode'].includes(choice.slice(8)))) throw { code: 'invalid_settings', message: 'Profile not found' };
      if (name === 'assistant.task.set') assistantMock.tasks[task!] = choice; else assistantMock.default = choice;
      return assistantView() as T;
    }
    if (name === 'assistant.complete') { const skipped = !!(args as { skipped?: boolean }).skipped; assistantMock = { ...assistantMock, completed: !skipped, skipped }; return assistantView() as T; }
    if (name === 'provider.profiles.list') {
      if (selectionFlag('selection-redo') && !profileMocks.length) {
        providerMock = { ...providerMock, endpoint: 'http://127.0.0.1:11434/v1', model: 'llama3', kind: 'openai' };
        profileMocks = [{ id: 'forte', label: 'Forte remoto', kind: 'openai', endpoint: 'https://api.example.test/v1', model: 'forte-1', nativeSchema: false, ownKey: true, context: null, keyLastFour: '1234' }, { id: 'leve', label: 'Leve local', kind: 'openai', endpoint: 'http://127.0.0.1:11435/v1', model: 'leve-1', nativeSchema: false, ownKey: false, context: null, keyLastFour: null }];
      }
      const limits = (p: ProfileMock) => ({ maxOutput: { value: p.maxOutput ?? 4096, source: p.maxOutput ? 'profile' : 'fallback' }, timeout: { seconds: p.timeoutSecs ?? (isLocalHost(p.endpoint) ? 300 : 60), source: p.timeoutSecs ? 'profile' : 'default' }, timeoutMsPer1kInputTokens: 1000, minUsefulOutput: 512 });
      const view = (p: ProfileMock) => ({ ...p, maxOutput: p.maxOutput ?? null, timeoutSecs: p.timeoutSecs ?? null, limits: limits(p), keyLastFour: p.ownKey || p.endpoint !== providerMock.endpoint ? p.keyLastFour : providerMock.keyLastFour, local: isLocalHost(p.endpoint), confirmed: providerMock.confirmedEndpoints.includes(p.endpoint), price: null, cli: false });
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
      const id = (args as { profileId?: string }).profileId ?? 'legacy';
      if (['codex', 'claude', 'opencode'].includes(id)) return { applicable: false } as T;
      const p = id === 'legacy' ? { id, context: providerMock.context, kind: providerMock.kind, endpoint: providerMock.endpoint, model: providerMock.model } : profileMocks.find(x => x.id === id);
      if (!p) throw { code: 'invalid_settings', message: 'Profile not found' };
      // Limites só do simulador (o núcleo real usa o planejador): abaixo de 11 mil bloqueia, abaixo de 16 mil reduz.
      const tokens = p.context ?? (p.kind === 'ollama' ? 4096 : 8192);
      const state = tokens < 11000 ? 'blocked' : tokens < 16000 ? 'reduced' : 'full';
      const guides = p.kind === 'ollama' ? ['ollama_profile'] : p.kind === 'openai' && isLocalHost(p.endpoint) ? ['ollama_server', 'lmstudio', 'llamacpp'] : [];
      return { applicable: true, profileId: id, kind: p.kind, model: p.model, contextTokens: tokens, origin: p.context ? 'user' : 'fallback', state,
        reference: { sourceMinutes: 60, maxWindowMinutes: 15, minWindowMinutes: 9, firstWindowMinutes: state === 'blocked' ? null : state === 'reduced' ? 12 : 15, windows: state === 'blocked' ? null : 5 }, guides } as T;
    }
    if (name === 'provider.profiles.remove') { profileMocks = profileMocks.filter(p => p.id !== (args as { profileId: string }).profileId); return {} as T; }
    if (name === 'provider.status') return { ...providerMock } as T;
    if (name === 'provider.cli.status') return { ...providerCliMock } as T;
    if (name === 'provider.cli.configure') { providerCliMock.selected = (args as { kind: string }).kind; if ('model' in args) providerCliMock.opencodeModel = (args as {model:string}).model; return {} as T; }
    if (name === 'provider.cli.confirm') { if (providerCliMock.selected === 'codex') providerCliMock.codexConfirmed = true; else if (providerCliMock.selected === 'opencode') providerCliMock.opencodeConfirmed = true; else providerCliMock.claudeConfirmed = true; return {} as T; }
    if (name === 'provider.configure' && (args as { profileId?: string }).profileId) {
      const a = args as { profileId: string; label: string; kind: string; endpoint: string; model: string; nativeSchema: boolean; ownKey?: boolean; context?: number | null; maxOutput?: number | null; timeoutSecs?: number | null };
      const old = profileMocks.find(p => p.id === a.profileId);
      const next = { id: a.profileId, label: a.label, kind: a.kind, endpoint: a.endpoint, model: a.model, nativeSchema: a.nativeSchema, context: a.context ?? null, maxOutput: 'maxOutput' in a ? a.maxOutput : old?.maxOutput ?? null, timeoutSecs: 'timeoutSecs' in a ? a.timeoutSecs : old?.timeoutSecs ?? null, ownKey: a.ownKey ?? old?.ownKey ?? false, keyLastFour: old?.keyLastFour ?? null };
      profileMocks = old ? profileMocks.map(p => p.id === a.profileId ? next : p) : [...profileMocks, next];
      return { profileId: a.profileId } as T;
    }
    if (name === 'provider.configure') {
      providerCliMock.selected = '';
      const { kind, endpoint, model, nativeSchema, context } = args as { kind: string; endpoint: string; model: string; nativeSchema: boolean; context?: number | null };
      const same = endpoint === providerMock.endpoint;
      providerMock = { kind, endpoint, model, nativeSchema, context: context ?? null, keyLastFour: same ? providerMock.keyLastFour : null, confirmed: same && providerMock.confirmed, confirmedEndpoints: providerMock.confirmedEndpoints, remote: !['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname) };
      return {} as T;
    }
    if ((name === 'provider.key.set' || name === 'provider.key.remove') && (args as { profileId?: string }).profileId && (args as { profileId?: string }).profileId !== 'legacy') {
      const { profileId, key } = args as { profileId: string; key?: string };
      profileMocks = profileMocks.map(p => p.id === profileId ? { ...p, keyLastFour: name === 'provider.key.set' ? key!.slice(-4) : null } : p);
      return {} as T;
    }
    if (name === 'provider.key.set') { providerMock.keyLastFour = (args as { key: string }).key.slice(-4); return {} as T; }
    if (name === 'provider.key.remove') { providerMock.keyLastFour = null; return {} as T; }
    if (name === 'provider.confirm') { const endpoint = (args as { endpoint: string }).endpoint; if (endpoint === providerMock.endpoint) providerMock.confirmed = true; providerMock.confirmedEndpoints.push(endpoint); return {} as T; }
    if (name === 'provider.prices.get' || name === 'provider.prices.set' || name === 'provider.prices.clear') {
      const a = args as { provider: string; model: string; inputPerMillion?: number; outputPerMillion?: number };
      if (name === 'provider.prices.set') priceOverrides = [...priceOverrides.filter(p => !(p.provider === a.provider && p.model === a.model)), { provider: a.provider, model: a.model, inputPerMillion: a.inputPerMillion!, outputPerMillion: a.outputPerMillion! }];
      if (name === 'provider.prices.clear') priceOverrides = priceOverrides.filter(p => !(p.provider === a.provider && p.model === a.model));
      return { updatedAt: '2026-11-14', prices: [{ provider: 'openai', model: 'gpt-5', inputPerMillion: 1.25, outputPerMillion: 10 }], overrides: priceOverrides } as T;
    }
    if (name === 'provider.cost.estimate') {
      const { transcript, maxOutputTokens } = args as { transcript: string; maxOutputTokens?: number };
      const inputTokens = Math.ceil((transcript.length + 2) / 4);
      const high = Math.ceil(inputTokens * 5 / 3);
      const tier = high > 100000 ? { aboveInputTokens: 100000, upToInputTokens: null, crossesThreshold: inputTokens <= 100000 } : null;
      return { kind: 'usd', inputTokens, inputTokensRange: { min: inputTokens, max: high }, tier, maxOutputTokens: maxOutputTokens ?? null, minMicroUsd: Math.round(inputTokens * 1.25), maxMicroUsd: maxOutputTokens ? Math.round(high * 1.25 + maxOutputTokens * 10) : null } as T;
    }
    if (name === 'provider.cost.list') return (sourceTest ? [{ id: 1, task: 'score', batch: null, provider: 'openai', model: 'gpt-5', costKind: 'usd', microUsd: 2500 }, { id: 2, task: 'script', batch: null, provider: 'cli:codex', model: '', costKind: 'plan_quota', microUsd: null }] : []) as T;
    if (name === 'provider.test' && providerCliMock.selected === 'opencode' && new URLSearchParams(location.search).has('opencode-free-limit')) throw { code: 'cli_free_limit', message: 'OpenCode free quota exhausted; retry after 79181 seconds; no automatic retry' };
    if (name === 'provider.test' && (args as { probeContext?: boolean }).probeContext) return { truncated: true, measured: 2048 } as T;
    if (name === 'provider.test') return { schemaVersion: 1 } as T;
    if (name === 'components.manifest') return [
      { id: 'ffmpeg', version: 'test', size: 2000000, license: 'GPL-3.0-or-later', source_url: 'https://github.com/FFmpeg/FFmpeg' },
      { id: 'yt-dlp', version: 'test', size: 1000000, license: 'Unlicense', source_url: 'https://github.com/yt-dlp/yt-dlp' },
      { id: 'deno', version: '2.9.8', size: 42917472, license: 'MIT', source_url: 'https://github.com/denoland/deno/tree/v2.9.8' },
      { id: 'pocket-tts', version: '3.3.0', size: 7914990, license: 'MIT', source_url: 'https://github.com/kyutai-labs/pocket-tts/tree/v4.0.1' },
      { id: 'uv', version: '0.13.8', size: 15000000, license: 'Apache-2.0', source_url: 'https://github.com/astral-sh/uv' },
    ] as T;
    if (name === 'components.models.manifest') return [
      { worker_installed: true, id: 'whisper-turbo', label: 'Whisper large-v3-turbo (GPU NVIDIA)', repo: 'dropbox-dash/faster-whisper-large-v3-turbo', revision: '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf', license: 'MIT', source_url: 'https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo/tree/0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf', size: 1621666000, installed: false, recommended: true },
      { worker_installed: true, id: 'whisper-small', label: 'Whisper small (CPU)', repo: 'Systran/faster-whisper-small', revision: '536b0662742c02347bc0e980a01041f333bce120', license: 'MIT', source_url: 'https://huggingface.co/Systran/faster-whisper-small/tree/536b0662742c02347bc0e980a01041f333bce120', size: 486212372, installed: true, recommended: false },
      { worker_installed: true, id: 'yunet', label: 'YuNet (reenquadramento)', repo: 'opencv/opencv_zoo', revision: '48b10fa505aeb51fbd127fc60a5c660040e823b7', license: 'MIT', source_url: 'https://github.com/opencv/opencv_zoo/tree/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/face_detection_yunet', size: 232589, installed: false, recommended: false },
    ] as T;
    if (name.startsWith('transcription.hardware.') || name === 'transcription.estimate') return hardwareMockDispatch(name, args) as T;
    if (name === 'components.models.download') return { id: (args as { id: string }).id } as T;
    if (sourceTest && new URLSearchParams(location.search).has('transcript-test') && name === 'transcription.segment') return {} as T;
    // Preview do Corte simulado (#58): a Fonte 2 está offline; a primeira consulta de um Corte gera (40%), a seguinte já está pronta.
    if (editorTest && (name.startsWith('editor.') || name.startsWith('captions.') || name.startsWith('reframe.') || name === 'export.captions')) return editorMock(name, args as Record<string, number>) as T;
    const translated = translationMockDispatch(name, args);
    if (translated !== undefined) return translated as T;
    if (transcriptTest && name === 'proxy.request') { const a = args as {source_id:number; start_us:number; end_us:number}; if (a.source_id === 2) throw {code:'source_offline', message:'A Fonte está offline: reconecte ou relocalize a Fonte para ver o preview.'}; const key = 'ab'.repeat(32); mockProxyPolls = 0; return {state:'running', key, job:7, progress:40, error:null, windowStartUs:Math.max(0, a.start_us - 120_000_000), windowEndUs:a.end_us + 120_000_000} as T; }
    if (transcriptTest && name === 'proxy.status') { mockProxyPolls += 1; return {state:mockProxyPolls > 1 ? 'ready' : 'running', key:(args as {key:string}).key, job:7, progress:mockProxyPolls > 1 ? 100 : 60, error:null} as T; }
    if (transcriptTest && (name.startsWith('selection.') || name.startsWith('chat.') || name.startsWith('energy.'))) return selectionMockDispatch(name, args) as T;
    if (transcriptTest && name === 'transcription.timeline') { const {source_id, offset, limit} = args as {source_id:number; offset:number; limit:number}; const total=30001; return {total, items:Array.from({length:Math.min(limit,total-offset)}, (_, n) => { const i=offset+n; if (i===1) return {type:'silence',start_us:1000000,end_us:2000000}; const id=i===0?1:i; const words=mockWords(source_id,id); return {type:'sentence',id,start_us:i*1000000,end_us:(i+1)*1000000,language:'pt',text:words.map(w=>w.text).join(' '),first_position:id*10,last_position:id*10+1,words}; })} as T; }
    if (transcriptTest && name === 'transcription.correct') { const {source_id, position, text} = args as {source_id:number; position:number; text:string}; const value=text.normalize('NFC').trim(); if (!value) throw {code:'invalid_correction',message:'O texto da correção é inválido.'}; const key=source_id+':'+position; const before=mockCorrected.get(key) ?? null; const after=value===mockOriginal(position) ? null : value; if ((after ?? mockOriginal(position)) === (before ?? mockOriginal(position))) return mockStep(source_id, position, false) as T; mockUndone = []; mockDone.push({source:source_id, position, before, after}); mockApply(source_id, position, after); return mockStep(source_id, position, true) as T; }
    if (transcriptTest && (name === 'transcription.undo' || name === 'transcription.redo')) { const undo=name==='transcription.undo'; const entry=undo ? mockDone.pop() : mockUndone.pop(); if (!entry) throw {code:undo?'nothing_to_undo':'nothing_to_redo',message:'Nada a fazer.'}; (undo ? mockUndone : mockDone).push(entry); mockApply(entry.source, entry.position, undo ? entry.before : entry.after); return mockStep(entry.source, entry.position, true) as T; }
    if (transcriptTest && name === 'transcription.corrections') return {can_undo:mockDone.length>0, can_redo:mockUndone.length>0} as T;
    if (transcriptTest && name === 'transcription.search') { const q=mockFold(String((args as {query:string}).query)).trim(); const hits:object[]=[]; const row=(id:number)=>id<=1?0:id; for (const [key,value] of mockCorrected) { const [source,position]=key.split(':').map(Number); const id=Math.floor(position/10); const text=mockWords(source,id).map(w=>w.text).join(' '); if (q && mockFold(value).includes(q)) hits.push({transcript_id:1,source_id:source,source:'changed.mp4',sentence_id:id,start_us:id*1000000,end_us:(id+1)*1000000,row:row(id),snippet:text.split(value).flatMap((part,k,all)=>k<all.length-1?[{text:part,match:false},{text:value,match:true}]:[{text:part,match:false}]).filter(p=>p.text)}); } const m=/^frase\s*(\d+)$/.exec(q); if (m) { const id=Number(m[1]); hits.push({transcript_id:1,source_id:1,source:'changed.mp4',sentence_id:id,start_us:id*1000000,end_us:(id+1)*1000000,row:row(id),snippet:[{text:'Frase '+id,match:true}]}); } return hits as T; }
    if (sourceTest && new URLSearchParams(location.search).has('transcript-test') && name === 'transcription.status') return {language:'pt',transcript:{id:1,state:'complete',resume_us:36000000000,duration_us:36000000000,words:30000},job:null} as T;
    if (name === 'transcription.status') { const sid = (args as { source_id?: number }).source_id; const src = sourceItems.find(s => s.id === sid); return { language: src?.language ?? 'pt', transcript: transcribeMock.transcript, job: transcribeMock.job } as T; }
    if (name === 'transcription.start') {
      const {source_id, language, engine = 'local', replace_confirmed, retry_confirmed} = args as {source_id?:number;language?:string;engine?:string;replace_confirmed?:boolean;retry_confirmed?:boolean};
      if (language && source_id) sourceItems = sourceItems.map(item => item.id === source_id ? { ...item, language } : item);
      if (engine === 'groq' && groqUncertain && !retry_confirmed) throw {code:'transcription_retry_confirmation',usage:{estimate:{kind:'usd',usd:0.00012}}};
      groqUncertain = false;
      const previous = transcribeMock.transcript as {engine?:string;state?:string} | null;
      if (previous && previous.engine !== engine && !replace_confirmed) throw {code:'engine_change_confirmation',usage:{blocks:1,paid_audio_us:previous.engine==='groq'?4e6:0,paid_usd:previous.engine==='groq'?0.00012:0}};
      if (engine === 'groq' && !groqConsent) throw {code:'confirmation_required'};
      transcribeMock = { transcript: { id: 1, engine, state: 'running', resume_us: 4000000, duration_us: 10000000, words: 0 }, job: { id: 99, state: 'running', progress: 40 } }; return { transcript_id: 1, state: 'running', job_id: 99 } as T;
    }
    if (name === 'components.settings.get') return { data_dir: '/test/data', cache_dir: '/test/cache', cache_limit_bytes: 10000000000, ffmpeg_path: null } as T;
    throw new Error(`Unknown core command: ${name}`);
  }
  return invoke<T>('core_dispatch', { name, arguments: args });
}


// Editor simulado (#61): a Frase n ocupa [(n-1)*10 s, n*10 s]; o Corte vale de 20 a 180 s; a janela do proxy é o Corte ±2 min.
const editorTest = transcriptTest && typeof location !== 'undefined' && new URLSearchParams(location.search).has('editor-test');
const editorKey = 'ab'.repeat(32);
function editorMock(name: string, a: Record<string, number>) {
  const edited = editorEditsMock(name, a);
  if (edited !== undefined) return edited;
  const captioned = captionsMock(name, a as Record<string, any>, p => mockCorrected.get('1:' + p) ?? mockOriginal(p));
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
    const first = Math.max(a.after_id + 1, Math.ceil(a.start_us / 10_000_000) + 1), last = Math.min(Math.floor(a.end_us / 10_000_000), 720);
    return Array.from({ length: Math.max(0, Math.min(a.limit, last - first + 1)) }, (_, n) => { const id = first + n; return { id, startUs: (id - 1) * 10_000_000, endUs: id * 10_000_000, text: `Frase ${id}` }; });
  }
  if (name === 'editor.timeline' || name === 'editor.timeline_status') return { state: 'ready', key: editorKey, job: null, progress: 100, error: null, thumbs: { id: `thumbs/${editorKey}`, count: 150, intervalUs: 2_000_000, width: 96, height: 54, columns: 20 } };
  if (name === 'editor.wave') return { blockUs: 100_000, values: Array.from({ length: 3000 }, (_, i) => 40 + Math.round(120 * Math.abs(Math.sin(i / 7)))) };
  throw new Error(`Unknown core command: ${name}`);
}
