import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { workerTexts } from './workerTexts';

type Handshake = { protocol: number; worker: string; python: string; libs: Record<string, string | null> };
type Status = { installed: boolean; outdated?: boolean; cuda?: boolean; handshake?: Handshake; error?: { code: string } };
type Progress = { job: string; stage: string; percentage: number };
function message(error: unknown) { return typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error); }

export function WorkerCard() {
  const t = useText(workerTexts);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const installFocus = useRef<HTMLButtonElement>(null);
  async function refresh() { setStatus(await coreDispatch<Status>('components.worker.status', {})); }
  useEffect(() => {
    refresh().catch(e => setNote(message(e)));
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    listen<Progress>('core-progress', e => { if (e.payload.job === 'worker' && (e.payload.stage === 'download' || e.payload.stage === 'worker')) setProgress(e.payload.percentage); }).then(fn => { unlisten = fn; });
    return () => unlisten?.();
  }, []);
  async function install() {
    setConfirming(false); setBusy(true); setProgress(0); setNote('');
    try { await coreDispatch('components.worker.install', { confirmed: true }); setNote(t.done); }
    catch (e) { setNote(message(e)); }
    finally { setBusy(false); try { await refresh(); } catch (e) { setNote(message(e)); } }
  }
  const h = status?.handshake;
  return <article className="mt-4 rounded-md border border-line p-4" aria-labelledby="worker-title">
    <h2 id="worker-title" className="font-semibold">{t.title} <span className="font-normal text-fg-2">{status ? (status.installed ? t.installed : t.missing) : ''}</span></h2>
    <p className="mt-2 text-fg-2">{t.intro}</p>
    {status?.outdated && <p className="mt-2">{t.outdated}</p>}
    {status?.installed && status.error && <p role="alert" className="mt-2 text-danger">{t.broken}</p>}
    {h && <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm" aria-label={t.versions}>
      <dt className="text-fg-2">{t.worker}</dt><dd>{h.worker}</dd>
      <dt className="text-fg-2">{t.protocol}</dt><dd>{h.protocol}</dd>
      <dt className="text-fg-2">{t.python}</dt><dd>{h.python}</dd>
      <dt className="text-fg-2">{t.variant}</dt><dd>{status?.cuda ? t.cuda : t.cpu}</dd>
      {Object.entries(h.libs).map(([name, version]) => [<dt key={`${name}-n`} className="text-fg-2">{name}</dt>, <dd key={`${name}-v`}>{version ?? t.notInstalledLib}</dd>])}
    </dl>}
    {note && <p className="mt-3" role="status">{note}</p>}
    <div className="mt-3 flex items-center gap-3">
      <Button ref={installFocus} disabled={busy} onClick={() => setConfirming(true)}>{status?.installed ? t.reinstall : t.install}</Button>
      {busy && <><progress max={100} value={progress} aria-label={t.progress} /><Button onClick={() => { void coreDispatch('components.cancel', { id: 'worker' }); }}>{t.cancel}</Button></>}
    </div>
    <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={t.confirmTitle} description={t.confirmDescription} cancelLabel={t.cancelDialog} confirmLabel={t.confirm} finalFocus={installFocus} onConfirm={() => void install()} />
  </article>;
}
