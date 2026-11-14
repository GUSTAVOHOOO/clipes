import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { texts } from './texts';

type Component = { id: string; version: string; size: number; license: string; source_url: string; build_source_url?: string | null };
type Settings = { data_dir: string; cache_dir: string; cache_limit_bytes: number; ffmpeg_path: string | null };
type Progress = { job: string; stage: string; percentage: number };
function message(error: unknown) { return typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error); }
export function Components() {
  const t = useText(texts);
  const [items, setItems] = useState<Component[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [path, setPath] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [incomplete, setIncomplete] = useState(false);
  async function refreshFfmpegStatus() { const result = await coreDispatch<{incomplete:boolean}>('components.ffmpeg.status', {}); setIncomplete(result.incomplete); }
  useEffect(() => {
    coreDispatch<Component[]>('components.manifest', {}).then(setItems).catch(e => setStatus(message(e)));
    refreshFfmpegStatus().catch(e => setStatus(message(e)));
    coreDispatch<Settings>('components.settings.get', {}).then(s => { setSettings(s); setPath(s.ffmpeg_path ?? ''); }).catch(e => setStatus(message(e)));
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    listen<Progress>('core-progress', e => { if (e.payload.stage === 'download') setProgress(e.payload.percentage); }).then(fn => { unlisten = fn; });
    return () => unlisten?.();
  }, []);
  async function download(id: string) { if (!window.confirm(t.confirm)) return; setBusy(id); setProgress(0); setStatus(''); try { const result = await coreDispatch<{path:string}>('components.download', { id, confirmed: true }); if (id === 'ffmpeg') setSettings(previous => previous && { ...previous, ffmpeg_path: result.path }); await refreshFfmpegStatus(); setStatus(t.installed); } catch (e) { setStatus(message(e)); } finally { setBusy(null); } }
  async function save() { if (!settings) return; try { const updated = await coreDispatch<Settings>('components.settings.set', settings); setSettings(updated); await refreshFfmpegStatus(); setStatus(t.saved); } catch (e) { setStatus(message(e)); } }
  async function useSystem() { try { const result = await coreDispatch<{version:string}>('components.ffmpeg.system', { path: path || 'ffmpeg' }); setStatus(result.version); setSettings(await coreDispatch<Settings>('components.settings.get', {})); await refreshFfmpegStatus(); } catch (e) { setStatus(message(e)); } }
  const input = 'foco mt-2 block w-full rounded-md border border-line-strong bg-field p-2 text-fg';
  return <section className="mx-auto max-w-4xl px-8 py-10"><h1 className="text-xl font-semibold">{t.title}</h1><p className="mt-2 text-fg-2">{t.intro}</p>
    {status && <p className="mt-4" role="status">{status}</p>}
    <div className="mt-6 space-y-4">{items.map(item => <article key={item.id} className="rounded-md border border-line p-4"><h2 className="font-semibold">{item.id} <span className="font-normal text-fg-2">{item.version}</span></h2>{item.id === 'ffmpeg' && incomplete && <p role="alert" className="mt-2 text-danger">{t.incomplete}</p>}<p className="mt-2">{(item.size / 1_000_000).toFixed(1)} MB · {item.license} · <a className="underline" href={item.source_url} target="_blank" rel="noreferrer">{t.source}</a>{item.build_source_url && <> · <a className="underline" href={item.build_source_url} target="_blank" rel="noreferrer">{t.buildSource}</a></>}</p><div className="mt-3 flex items-center gap-3"><Button disabled={!!busy} onClick={() => download(item.id)}>{item.id === 'ffmpeg' && incomplete ? t.reinstall : t.download}</Button>{busy === item.id && <><progress max={100} value={progress} aria-label={t.progress} /><Button onClick={() => { void coreDispatch('components.cancel', { id:item.id }); }}>{t.cancel}</Button></>}</div></article>)}</div>
    <div className="mt-8"><h2 className="font-semibold">{t.system}</h2><label className="mt-2 block">{t.ffmpegPath}<input className={input} value={path} onChange={e => setPath(e.target.value)} placeholder="ffmpeg" /></label><Button onClick={useSystem}>{t.validate}</Button></div>
    {settings && <div className="mt-8 space-y-4"><h2 className="font-semibold">{t.storage}</h2><p className="text-fg-2">{t.future}</p><label className="block">{t.data}<input className={input} value={settings.data_dir} onChange={e => setSettings({...settings,data_dir:e.target.value})} /></label><label className="block">{t.cache}<input className={input} value={settings.cache_dir} onChange={e => setSettings({...settings,cache_dir:e.target.value})} /></label><label className="block">{t.limit}<input className={input} type="number" min="0.1" step="0.1" value={settings.cache_limit_bytes / 1_000_000_000} onChange={e => setSettings({...settings,cache_limit_bytes:Math.round(Number(e.target.value)*1_000_000_000)})} /></label><Button onClick={save}>{t.save}</Button></div>}
  </section>;
}
