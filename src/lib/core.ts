import { invoke, isTauri } from '@tauri-apps/api/core';
import { version } from '../../package.json';

const groqRetryTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('groq-retry-test');
const sourceTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('source-test');
const budgetTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('budget-test');
const transcriptTest = sourceTest && typeof location !== 'undefined' && new URLSearchParams(location.search).has('transcript-test');
// Transcrição simulada: a Frase n tem as palavras n*10 (“Frase”) e n*10+1 (“n”); correções, desfazer e refazer valem por Fonte e posição.
const mockCorrected = new Map<string, string>();
let mockDone: {source:number; position:number; before:string|null; after:string|null}[] = [];
let mockUndone: typeof mockDone = [];
const mockOriginal = (position: number) => position % 10 === 0 ? 'Frase' : String(Math.floor(position / 10));
const mockFold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function mockWords(source: number, id: number) { return [0, 1].map(k => { const position = id * 10 + k; const value = mockCorrected.get(source + ':' + position); return { position, text: value ?? mockOriginal(position), corrected: value !== undefined }; }); }
function mockApply(source: number, position: number, value: string | null) { if (value === null) mockCorrected.delete(source + ':' + position); else mockCorrected.set(source + ':' + position, value); }
function mockStep(source: number, position: number, changed: boolean) { const value = mockCorrected.get(source + ':' + position); return { changed, source_id: source, transcript_id: 1, position, sentence_id: Math.floor(position / 10), text: ' ' + (value ?? mockOriginal(position)), corrected: value !== undefined, can_undo: mockDone.length > 0, can_redo: mockUndone.length > 0 }; }
let sourceItems = [
  { id: 1, path: '/test/changed.mp4', status: 'changed', available: false, verified: false, permission: {status:'none'} },
  { id: 2, path: '/test/offline.mp4', status: 'offline', available: false, verified: false, permission: {status:'none'} },
  { id: 3, path: '/test/mismatch.mp4', status: 'changed', available: false, verified: true, permission: {status:'none'} },
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
if (groqRetryTest || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('hardware-cpu'))) sourceItems.push({id:4,path:'/test/downloaded.mp4',status:'available',available:true,verified:true,permission:{status:'none'}});
let providerMock = { kind: 'openai', endpoint: '', model: '', nativeSchema: false, context: null as number | null, keyLastFour: null as string | null, remote: false, confirmed: false, confirmedEndpoints: [] as string[] };
type ProfileMock = { id: string; label: string; kind: string; endpoint: string; model: string; nativeSchema: boolean; ownKey: boolean; context: number | null; maxOutput?: number | null; timeoutSecs?: number | null; keyLastFour: string | null };
let profileMocks: ProfileMock[] = [];
const isLocalHost = (endpoint: string) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname);
let priceOverrides: { provider: string; model: string; inputPerMillion: number; outputPerMillion: number }[] = [];
const assistantTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('assistant-test');
let assistantMock = { completed: !assistantTest, skipped: false, needsSetup: assistantTest, default: '', tasks: { selection: '', packaging: '', script: '', translation: '' } as Record<string, string>, localOnly: { selection: false, packaging: false, script: false, translation: false } as Record<string, boolean> };
let projectVetoMock = false;
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

export async function coreDispatch<T>(name: string, args: object): Promise<T> {
  if (import.meta.env.VITE_CORE_MOCK === '1' && !isTauri()) {
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
    if (sourceTest && name === 'sources.url.download') return {path:'/test/downloaded.mp4',url:(args as {url:string}).url} as T;
    if (sourceTest && name === 'sources.inspect') return {format:{duration:'12'},streams:[{index:0,codec_type:'audio',codec_name:'aac'}]} as T;
    if (sourceTest && name === 'sources.import') { const a=args as {path:string;permission:{status:string};origin_url?:string}; const item={id:4,path:a.path,status:'available',available:true,verified:true,permission:a.permission}; sourceItems.push(item); return {...item,origin_url:a.origin_url} as T; }

    if (sourceTest && (name === 'sources.hash' || name === 'sources.relocate')) {
      const { id, confirmed } = args as { id: number; confirmed?: boolean };
      if (!confirmed) throw { code:'confirmation_required', message:'confirmation required' };
      sourceItems = sourceItems.map(item => item.id === id ? { ...item, status:'available', available:true, verified:true } : item);
      return {} as T;
    }
    if (name === 'app.version') return { version } as T;
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
      { id: 'uv', version: '0.13.8', size: 15000000, license: 'Apache-2.0', source_url: 'https://github.com/astral-sh/uv' },
    ] as T;
    if (name === 'components.models.manifest') return [
      { worker_installed: true, id: 'whisper-turbo', label: 'Whisper large-v3-turbo (GPU NVIDIA)', repo: 'dropbox-dash/faster-whisper-large-v3-turbo', revision: '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf', license: 'MIT', source_url: 'https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo/tree/0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf', size: 1621666000, installed: false, recommended: true },
      { worker_installed: true, id: 'whisper-small', label: 'Whisper small (CPU)', repo: 'Systran/faster-whisper-small', revision: '536b0662742c02347bc0e980a01041f333bce120', license: 'MIT', source_url: 'https://huggingface.co/Systran/faster-whisper-small/tree/536b0662742c02347bc0e980a01041f333bce120', size: 486212372, installed: true, recommended: false },
    ] as T;
    if (name.startsWith('transcription.hardware.') || name === 'transcription.estimate') return hardwareMockDispatch(name, args) as T;
    if (name === 'components.models.download') return { id: (args as { id: string }).id } as T;
    if (sourceTest && new URLSearchParams(location.search).has('transcript-test') && name === 'transcription.segment') return {} as T;
    if (transcriptTest && name === 'transcription.timeline') { const {source_id, offset, limit} = args as {source_id:number; offset:number; limit:number}; const total=30001; return {total, items:Array.from({length:Math.min(limit,total-offset)}, (_, n) => { const i=offset+n; if (i===1) return {type:'silence',start_us:1000000,end_us:2000000}; const id=i===0?1:i; const words=mockWords(source_id,id); return {type:'sentence',id,start_us:i*1000000,end_us:(i+1)*1000000,language:'pt',text:words.map(w=>w.text).join(' '),first_position:id*10,last_position:id*10+1,words}; })} as T; }
    if (transcriptTest && name === 'transcription.correct') { const {source_id, position, text} = args as {source_id:number; position:number; text:string}; const value=text.normalize('NFC').trim(); if (!value) throw {code:'invalid_correction',message:'O texto da correção é inválido.'}; const key=source_id+':'+position; const before=mockCorrected.get(key) ?? null; const after=value===mockOriginal(position) ? null : value; if ((after ?? mockOriginal(position)) === (before ?? mockOriginal(position))) return mockStep(source_id, position, false) as T; mockUndone = []; mockDone.push({source:source_id, position, before, after}); mockApply(source_id, position, after); return mockStep(source_id, position, true) as T; }
    if (transcriptTest && (name === 'transcription.undo' || name === 'transcription.redo')) { const undo=name==='transcription.undo'; const entry=undo ? mockDone.pop() : mockUndone.pop(); if (!entry) throw {code:undo?'nothing_to_undo':'nothing_to_redo',message:'Nada a fazer.'}; (undo ? mockUndone : mockDone).push(entry); mockApply(entry.source, entry.position, undo ? entry.before : entry.after); return mockStep(entry.source, entry.position, true) as T; }
    if (transcriptTest && name === 'transcription.corrections') return {can_undo:mockDone.length>0, can_redo:mockUndone.length>0} as T;
    if (transcriptTest && name === 'transcription.search') { const q=mockFold(String((args as {query:string}).query)).trim(); const hits:object[]=[]; const row=(id:number)=>id<=1?0:id; for (const [key,value] of mockCorrected) { const [source,position]=key.split(':').map(Number); const id=Math.floor(position/10); const text=mockWords(source,id).map(w=>w.text).join(' '); if (q && mockFold(value).includes(q)) hits.push({transcript_id:1,source_id:source,source:'changed.mp4',sentence_id:id,start_us:id*1000000,end_us:(id+1)*1000000,row:row(id),snippet:text.split(value).flatMap((part,k,all)=>k<all.length-1?[{text:part,match:false},{text:value,match:true}]:[{text:part,match:false}]).filter(p=>p.text)}); } const m=/^frase\s*(\d+)$/.exec(q); if (m) { const id=Number(m[1]); hits.push({transcript_id:1,source_id:1,source:'changed.mp4',sentence_id:id,start_us:id*1000000,end_us:(id+1)*1000000,row:row(id),snippet:[{text:'Frase '+id,match:true}]}); } return hits as T; }
    if (sourceTest && new URLSearchParams(location.search).has('transcript-test') && name === 'transcription.status') return {transcript:{id:1,state:'complete',resume_us:36000000000,duration_us:36000000000,words:30000},job:null} as T;
    if (name === 'transcription.status') return { transcript: transcribeMock.transcript, job: transcribeMock.job } as T;
    if (name === 'transcription.start') {
      const {engine = 'local', replace_confirmed, retry_confirmed} = args as {engine?:string;replace_confirmed?:boolean;retry_confirmed?:boolean};
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

