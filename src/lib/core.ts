import { invoke, isTauri } from '@tauri-apps/api/core';
import { version } from '../../package.json';

const sourceTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('source-test');
let sourceItems = [
  { id: 1, path: '/test/changed.mp4', status: 'changed', available: false, verified: false, permission: {status:'none'} },
  { id: 2, path: '/test/offline.mp4', status: 'offline', available: false, verified: false, permission: {status:'none'} },
  { id: 3, path: '/test/mismatch.mp4', status: 'changed', available: false, verified: true, permission: {status:'none'} },
];
let urlSettingsMock = {terms_accepted:false, download_dir:'/test/downloads'};
let providerMock = { endpoint: '', model: '', nativeSchema: false, keyLastFour: null as string | null, remote: false, confirmed: false };
export async function coreDispatch<T>(name: string, args: object): Promise<T> {
  if (import.meta.env.VITE_CORE_MOCK === '1' && !isTauri()) {
    if (name === 'projects.recent') return [] as T;
    if (name === 'projects.current') return (sourceTest ? { name:'Teste', path:'/test/Teste.clipes' } : null) as T;
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
    if (name === 'components.ffmpeg.status') return { incomplete: false } as T;
    if (name === 'provider.status') return { ...providerMock } as T;
    if (name === 'provider.configure') {
      const { endpoint, model, nativeSchema } = args as { endpoint: string; model: string; nativeSchema: boolean };
      const same = endpoint === providerMock.endpoint;
      providerMock = { endpoint, model, nativeSchema, keyLastFour: same ? providerMock.keyLastFour : null, confirmed: same && providerMock.confirmed, remote: !['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname) };
      return {} as T;
    }
    if (name === 'provider.key.set') { providerMock.keyLastFour = (args as { key: string }).key.slice(-4); return {} as T; }
    if (name === 'provider.key.remove') { providerMock.keyLastFour = null; return {} as T; }
    if (name === 'provider.confirm') { providerMock.confirmed = true; return {} as T; }
    if (name === 'provider.test') return { schemaVersion: 1 } as T;
    if (name === 'components.manifest') return [
      { id: 'ffmpeg', version: 'test', size: 2000000, license: 'GPL-3.0-or-later', source_url: 'https://github.com/FFmpeg/FFmpeg' },
      { id: 'yt-dlp', version: 'test', size: 1000000, license: 'Unlicense', source_url: 'https://github.com/yt-dlp/yt-dlp' },
    ] as T;
    if (name === 'components.settings.get') return { data_dir: '/test/data', cache_dir: '/test/cache', cache_limit_bytes: 10000000000, ffmpeg_path: null } as T;
    throw new Error(`Unknown core command: ${name}`);
  }
  return invoke<T>('core_dispatch', { name, arguments: args });
}
