import { invoke, isTauri } from '@tauri-apps/api/core';
import { version } from '../../package.json';
export async function coreDispatch<T>(name: string, args: object): Promise<T> {
  if (import.meta.env.VITE_CORE_MOCK === '1' && !isTauri()) {
    if (name === 'app.version') return { version } as T;
    throw new Error(`Unknown core command: ${name}`);
  }
  return invoke<T>('core_dispatch', { name, arguments: args });
}
