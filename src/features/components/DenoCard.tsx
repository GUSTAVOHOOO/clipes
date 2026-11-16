import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { denoTexts } from './denoTexts';

type Item = { id: string; version: string; size: number; license: string; source_url: string };
type Status = { installed: boolean; version: string | null; pinned: string | null; outdated: boolean };
type Progress = { job: string; stage: string; percentage: number };
function message(error: unknown) { return typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error); }

export function DenoCard({ item }: { item?: Item }) {
  const t = useText(denoTexts);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const focus = useRef<HTMLButtonElement>(null);
  async function refresh() { setStatus(await coreDispatch<Status>('components.deno.status', {})); }
  useEffect(() => {
    refresh().catch(e => setNote(message(e)));
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    listen<Progress>('core-progress', e => { if (e.payload.job === 'deno' && e.payload.stage === 'download') setProgress(e.payload.percentage); }).then(fn => { unlisten = fn; });
    return () => unlisten?.();
  }, []);
  async function install() {
    setConfirming(false); setBusy(true); setProgress(0); setNote('');
    try { await coreDispatch('components.download', { id: 'deno', confirmed: true }); setNote(t.done); }
    catch (e) { setNote(message(e)); }
    finally { setBusy(false); try { await refresh(); } catch (e) { setNote(message(e)); } }
  }
  if (!item) return null;
  const updating = !!status?.installed && status.outdated;
  return <article className="mt-4 rounded-md border border-line p-4" aria-labelledby="deno-title">
    <h2 id="deno-title" className="font-semibold">{t.title} <span className="font-normal text-fg-2">{status?.installed ? `${t.installed} ${status.version ?? ''}` : status ? t.missing : ''}</span></h2>
    <p className="mt-2 text-fg-2">{t.intro}</p>
    {updating && <p className="mt-2">{t.outdated}</p>}
    <p className="mt-2">{t.pinned} {item.version} · {(item.size / 1_000_000).toFixed(1)} MB · {item.license} · <a className="underline" href={item.source_url} target="_blank" rel="noreferrer">{t.source}</a></p>
    {note && <p className="mt-3" role="status">{note}</p>}
    <div className="mt-3 flex items-center gap-3">
      {(!status?.installed || updating) && <Button ref={focus} disabled={busy} onClick={() => setConfirming(true)}>{updating ? t.update : t.install}</Button>}
      {busy && <><progress max={100} value={progress} aria-label={t.progress} /><Button onClick={() => { void coreDispatch('components.cancel', { id: 'deno' }); }}>{t.cancel}</Button></>}
    </div>
    <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={updating ? t.confirmUpdateTitle : t.confirmInstallTitle} description={t.confirmDescription.replace('{version}', item.version).replace('{size}', (item.size / 1_000_000).toFixed(0)).replace('{license}', item.license)} cancelLabel={t.cancelDialog} confirmLabel={updating ? t.confirmUpdate : t.confirmInstall} finalFocus={focus} onConfirm={() => void install()} />
  </article>;
}
