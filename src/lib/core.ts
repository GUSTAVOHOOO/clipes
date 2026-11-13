import { invoke, isTauri } from '@tauri-apps/api/core';
import { version } from '../../package.json';

let providerMock = { endpoint: '', model: '', nativeSchema: false, keyLastFour: null as string | null, remote: false, confirmed: false };
export async function coreDispatch<T>(name: string, args: object): Promise<T> {
  if (import.meta.env.VITE_CORE_MOCK === '1' && !isTauri()) {
    if (name === 'app.version') return { version } as T;
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
    throw new Error(`Unknown core command: ${name}`);
  }
  return invoke<T>('core_dispatch', { name, arguments: args });
}
