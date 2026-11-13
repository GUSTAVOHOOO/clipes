import { invoke, isTauri } from '@tauri-apps/api/core';
import { version } from '../../package.json';
export async function coreDispatch<T>(name: string, args: object): Promise<T> {
  if (import.meta.env.VITE_CORE_MOCK === '1' && !isTauri()) {
    if (name === 'projects.recent') return [] as T;
    if (name === 'app.version') return { version } as T;
    if (name === 'components.manifest') return [
      { id: 'ffmpeg', version: 'test', size: 2000000, license: 'GPL-3.0-or-later', source_url: 'https://github.com/FFmpeg/FFmpeg' },
      { id: 'yt-dlp', version: 'test', size: 1000000, license: 'Unlicense', source_url: 'https://github.com/yt-dlp/yt-dlp' },
    ] as T;
    if (name === 'components.settings.get') return { data_dir: '/test/data', cache_dir: '/test/cache', cache_limit_bytes: 10000000000, ffmpeg_path: null } as T;
    throw new Error(`Unknown core command: ${name}`);
  }
  return invoke<T>('core_dispatch', { name, arguments: args });
}
