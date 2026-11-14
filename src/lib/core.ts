import { invoke, isTauri } from '@tauri-apps/api/core';
import { version } from '../../package.json';

const sourceTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('source-test');
let sourceItems = [
  { id: 1, path: '/test/changed.mp4', status: 'changed', available: false, verified: false, permission: {status:'none'} },
  { id: 2, path: '/test/offline.mp4', status: 'offline', available: false, verified: false, permission: {status:'none'} },
  { id: 3, path: '/test/mismatch.mp4', status: 'changed', available: false, verified: true, permission: {status:'none'} },
];
let urlSettingsMock = {terms_accepted:false, download_dir:'/test/downloads'};
let jobItems = [
  { id: 1, kind: 'preview', state: 'running', progress: 42, project: 'test-project' },
  { id: 2, kind: 'ai:example', safety: 'paid', state: 'uncertain', progress: 0, project: 'test-project' },
];
let providerMock = { kind: 'openai', endpoint: '', model: '', nativeSchema: false, keyLastFour: null as string | null, remote: false, confirmed: false, confirmedEndpoints: [] as string[] };
type ProfileMock = { id: string; label: string; kind: string; endpoint: string; model: string; nativeSchema: boolean; ownKey: boolean; keyLastFour: string | null };
let profileMocks: ProfileMock[] = [];
const isLocalHost = (endpoint: string) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname);
let priceOverrides: { provider: string; model: string; inputPerMillion: number; outputPerMillion: number }[] = [];
const assistantTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('assistant-test');
let assistantMock = { completed: !assistantTest, skipped: false, needsSetup: assistantTest, default: '', tasks: { selection: '', packaging: '', script: '', translation: '' } as Record<string, string>, localOnly: { selection: false, packaging: false, script: false, translation: false } as Record<string, boolean> };
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
  const id = choice === 'endpoint' ? 'legacy' : choice.startsWith('profile:') ? choice.slice(8) : '';
  if (id === 'legacy' && providerMock.endpoint) return profileRow('legacy', 'Principal', providerMock.kind, providerMock.model, providerMock.endpoint);
  const found = profileMocks.find(p => p.id === id);
  return found ? profileRow(found.id, found.label, found.kind, found.model, found.endpoint) : null;
};
const assistantTasks = () => ({ tasks: Object.keys(assistantMock.tasks).map(task => {
  const own = assistantMock.tasks[task];
  const choice = own || assistantMock.default;
  const profile = taskTarget(choice);
  const missing = !profile && staleProfile(choice) ? choice.slice(8) : null;
  const localOnly = assistantMock.localOnly[task] ?? false;
  const firstLocal = profileMocks.find(p => isLocalHost(p.endpoint));
  return { task, choice: missing ? '' : own, source: missing ? 'none' : own ? 'task' : assistantMock.default ? 'default' : 'none', profile, localOnly, blocked: localOnly && !!profile && !profile.local, missing,
    suggestion: !profile && firstLocal ? { choice: `profile:${firstLocal.id}`, label: firstLocal.label, measured: false } : null };
}) });
let providerCliMock = { selected: '', codexConfirmed: false, claudeConfirmed: false };
export async function coreDispatch<T>(name: string, args: object): Promise<T> {
  if (import.meta.env.VITE_CORE_MOCK === '1' && !isTauri()) {
    if (name === 'diagnostic.get') return { text: "Clipes: 0.1.0\nSistema operacional: indisponível" } as T;
    if (name === 'projects.recent') return [] as T;
    if (name === 'projects.current') return (sourceTest ? { name:'Teste', path:'/test/Teste.clipes', id:'test-project' } : null) as T;
    if (name === 'jobs.list') return (sourceTest ? jobItems : []) as T;
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
    if (name === 'assistant.detect') return { ollama: { found: true, endpoint: 'http://127.0.0.1:11434/v1', models: ['llama3:8b', 'qwen3'] }, lmStudio: { found: false, endpoint: null, models: [] }, llamaCpp: { found: false, endpoint: null, models: [] }, codex: { found: true }, claude: { found: false } } as T;
    if (name === 'assistant.default.set' || name === 'assistant.task.set') {
      const { choice, task } = args as { choice: string; task?: string };
      if ((choice === 'codex' && !providerCliMock.codexConfirmed) || (choice === 'claude' && !providerCliMock.claudeConfirmed)) throw { code: 'confirmation_required', message: 'confirmation required' };
      if (choice.startsWith('profile:') && (!knownProfile(choice.slice(8)) || ['codex', 'claude'].includes(choice.slice(8)))) throw { code: 'invalid_settings', message: 'Profile not found' };
      if (name === 'assistant.task.set') assistantMock.tasks[task!] = choice; else assistantMock.default = choice;
      return assistantView() as T;
    }
    if (name === 'assistant.complete') { const skipped = !!(args as { skipped?: boolean }).skipped; assistantMock = { ...assistantMock, completed: !skipped, skipped }; return assistantView() as T; }
    if (name === 'provider.profiles.list') {
      const view = (p: ProfileMock) => ({ ...p, keyLastFour: p.ownKey || p.endpoint !== providerMock.endpoint ? p.keyLastFour : providerMock.keyLastFour, local: isLocalHost(p.endpoint), confirmed: providerMock.confirmedEndpoints.includes(p.endpoint), price: null, cli: false });
      const main = providerMock.endpoint ? [view({ id: 'legacy', label: 'Principal', kind: providerMock.kind, endpoint: providerMock.endpoint, model: providerMock.model, nativeSchema: providerMock.nativeSchema, ownKey: false, keyLastFour: providerMock.keyLastFour })] : [];
      const cli = (kind: string, label: string, confirmed: boolean) => ({ id: kind, label, kind, endpoint: null, model: null, nativeSchema: false, ownKey: false, keyLastFour: null, local: false, confirmed, active: providerCliMock.selected === kind, price: null, cli: true, experimental: true });
      return { profiles: [...main, ...profileMocks.map(view), cli('codex', 'Codex CLI', providerCliMock.codexConfirmed), cli('claude', 'Claude Code CLI', providerCliMock.claudeConfirmed)] } as T;
    }
    if (name === 'provider.profiles.remove') { profileMocks = profileMocks.filter(p => p.id !== (args as { profileId: string }).profileId); return {} as T; }
    if (name === 'provider.status') return { ...providerMock } as T;
    if (name === 'provider.cli.status') return { ...providerCliMock } as T;
    if (name === 'provider.cli.configure') { providerCliMock.selected = (args as { kind: string }).kind; return {} as T; }
    if (name === 'provider.cli.confirm') { if (providerCliMock.selected === 'codex') providerCliMock.codexConfirmed = true; else providerCliMock.claudeConfirmed = true; return {} as T; }
    if (name === 'provider.configure' && (args as { profileId?: string }).profileId) {
      const a = args as { profileId: string; label: string; kind: string; endpoint: string; model: string; nativeSchema: boolean; ownKey?: boolean };
      const old = profileMocks.find(p => p.id === a.profileId);
      const next = { id: a.profileId, label: a.label, kind: a.kind, endpoint: a.endpoint, model: a.model, nativeSchema: a.nativeSchema, ownKey: a.ownKey ?? old?.ownKey ?? false, keyLastFour: old?.keyLastFour ?? null };
      profileMocks = old ? profileMocks.map(p => p.id === a.profileId ? next : p) : [...profileMocks, next];
      return { profileId: a.profileId } as T;
    }
    if (name === 'provider.configure') {
      providerCliMock.selected = '';
      const { kind, endpoint, model, nativeSchema } = args as { kind: string; endpoint: string; model: string; nativeSchema: boolean };
      const same = endpoint === providerMock.endpoint;
      providerMock = { kind, endpoint, model, nativeSchema, keyLastFour: same ? providerMock.keyLastFour : null, confirmed: same && providerMock.confirmed, confirmedEndpoints: providerMock.confirmedEndpoints, remote: !['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname) };
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
      return { kind: 'usd', inputTokens, maxOutputTokens: maxOutputTokens ?? null, minMicroUsd: Math.round(inputTokens * 1.25), maxMicroUsd: maxOutputTokens ? Math.round(inputTokens * 1.25 + maxOutputTokens * 10) : null } as T;
    }
    if (name === 'provider.cost.list') return (sourceTest ? [{ id: 1, task: 'score', batch: null, provider: 'openai', model: 'gpt-5', costKind: 'usd', microUsd: 2500 }, { id: 2, task: 'script', batch: null, provider: 'cli:codex', model: '', costKind: 'plan_quota', microUsd: null }] : []) as T;
    if (name === 'provider.test') return { schemaVersion: 1 } as T;
    if (name === 'components.manifest') return [
      { id: 'ffmpeg', version: 'test', size: 2000000, license: 'GPL-3.0-or-later', source_url: 'https://github.com/FFmpeg/FFmpeg' },
      { id: 'yt-dlp', version: 'test', size: 1000000, license: 'Unlicense', source_url: 'https://github.com/yt-dlp/yt-dlp' },
      { id: 'uv', version: '0.13.8', size: 15000000, license: 'Apache-2.0', source_url: 'https://github.com/astral-sh/uv' },
    ] as T;
    if (name === 'components.settings.get') return { data_dir: '/test/data', cache_dir: '/test/cache', cache_limit_bytes: 10000000000, ffmpeg_path: null } as T;
    throw new Error(`Unknown core command: ${name}`);
  }
  return invoke<T>('core_dispatch', { name, arguments: args });
}
