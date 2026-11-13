import { useEffect, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { texts } from './texts';

type Status = { endpoint: string; model: string; nativeSchema: boolean; keyLastFour: string | null; remote: boolean; confirmed: boolean };
const empty: Status = { endpoint: '', model: '', nativeSchema: false, keyLastFour: null, remote: false, confirmed: false };

export function ProviderSettings() {
  const t = useText(texts);
  const [status, setStatus] = useState<Status>(empty);
  const [saved, setSaved] = useState<Status>(empty);
  const [key, setKey] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const input = 'foco mt-2 block h-9 w-full max-w-lg rounded-md border border-line-strong bg-field px-3 text-fg';
  async function refresh() { const value = await coreDispatch<Status>('provider.status', {}); setSaved(value); setStatus(value); }
  const dirty = status.endpoint !== saved.endpoint || status.model !== saved.model || status.nativeSchema !== saved.nativeSchema;
  useEffect(() => { void refresh().catch(() => setMessage(t.failed)); }, []);
  async function run(action: () => Promise<void | boolean>, result: string) {
    setBusy(true); setMessage('');
    try { const completed = await action(); await refresh(); if (completed !== false) setMessage(result); } catch { setMessage(t.failed); } finally { setBusy(false); }
  }
  async function test() {
    const current = await coreDispatch<Status>('provider.status', {});
    if (current.remote && !current.confirmed) {
      if (!window.confirm(`${t.confirm}\n\n${current.endpoint}`)) return false;
      await coreDispatch('provider.confirm', { endpoint: current.endpoint });
    }
    await coreDispatch('provider.test', {});
  }
  return <section className="mt-10 max-w-xl border-t border-line pt-8" aria-labelledby="provider-title">
    <h2 id="provider-title" className="text-lg font-semibold">{t.title}</h2>
    <form className="mt-5 flex flex-col gap-4" onSubmit={e => { e.preventDefault(); void run(async () => { await coreDispatch('provider.configure', { endpoint: status.endpoint, model: status.model, nativeSchema: status.nativeSchema }); }, t.saved); }}>
      <label>{t.endpoint}<input className={input} type="url" required value={status.endpoint} onChange={e => setStatus({ ...status, endpoint: e.target.value })} /></label>
      <label>{t.model}<input className={input} required value={status.model} onChange={e => setStatus({ ...status, model: e.target.value })} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={status.nativeSchema} onChange={e => setStatus({ ...status, nativeSchema: e.target.checked })} />{t.schema}</label>
      <div><Button type="submit" disabled={busy}>{t.save}</Button></div>
    </form>
    <form className="mt-6 flex flex-col gap-3" onSubmit={e => { e.preventDefault(); const submitted = key; setKey(''); void run(async () => { await coreDispatch('provider.key.set', { key: submitted }); }, t.saved); }}>
      <label>{t.key}<input className={input} type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /></label>
      <p className="text-sm text-fg-2">{t.keyHelp}</p><p className="text-sm">{status.keyLastFour ? `${t.keySaved} ${status.keyLastFour}` : t.noKey}</p>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || dirty || !saved.endpoint || !key}>{t.setKey}</Button><Button type="button" disabled={busy || dirty || !status.keyLastFour} onClick={() => void run(async () => { await coreDispatch('provider.key.remove', {}); }, t.saved)}>{t.removeKey}</Button></div>
    </form>
    <div className="mt-6"><Button type="button" disabled={busy || dirty || !saved.endpoint || !saved.model} onClick={() => void run(test, t.success)}>{t.test}</Button></div>
    {message && <p className="mt-4 text-sm" role="status">{message}</p>}
  </section>;
}
