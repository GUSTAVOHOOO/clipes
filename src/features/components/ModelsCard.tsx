import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { modelTexts } from './modelTexts';

type Model = { id: string; label: string; repo: string; revision: string; license: string; source_url: string; size: number; installed: boolean; recommended: boolean };
type Progress = { job: string; stage: string; percentage: number };
function message(error: unknown) { return typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error); }
const gigabytes = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(0)} MB`;

/** Modelos de transcrição: tamanho, licença e fonte à vista, e download só depois do consentimento. */
export function ModelsCard() {
  const t = useText(modelTexts);
  const [models, setModels] = useState<Model[]>([]);
  const [workerInstalled, setWorkerInstalled] = useState(true);
  const [confirming, setConfirming] = useState<Model | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState('');
  const focus = useRef<HTMLButtonElement | null>(null);
  async function refresh() {
    setModels(await coreDispatch<Model[]>('components.models.manifest', {}));
    setWorkerInstalled((await coreDispatch<{ installed: boolean }>('components.worker.status', {})).installed);
  }
  useEffect(() => {
    refresh().catch(e => setNote(message(e)));
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    listen<Progress>('core-progress', e => { if (e.payload.stage === 'download') setProgress(e.payload.percentage); }).then(fn => { unlisten = fn; });
    return () => unlisten?.();
  }, []);
  async function download(model: Model) {
    setConfirming(null); setBusy(model.id); setProgress(0); setNote('');
    try { await coreDispatch('components.models.download', { id: model.id, confirmed: true }); setNote(t.done); }
    catch (e) { setNote(message(e)); }
    finally { setBusy(null); try { await refresh(); } catch (e) { setNote(message(e)); } }
  }
  return <section className="mt-4" aria-labelledby="models-title">
    <h2 id="models-title" className="font-semibold">{t.title}</h2>
    <p className="mt-2 text-fg-2">{t.intro}</p>
    {!workerInstalled && <p className="mt-2" role="note">{t.needWorker}</p>}
    {note && <p className="mt-2" role="status">{note}</p>}
    <div className="mt-3 space-y-4">{models.map(model => <article key={model.id} className="rounded-md border border-line p-4" aria-label={model.label}>
      <h3 className="font-semibold">{model.label} <span className="font-normal text-fg-2">{model.installed ? t.installed : t.missing}{model.recommended ? ` · ${t.recommended}` : ''}</span></h3>
      <p className="mt-2">{gigabytes(model.size)} · {model.license} · <a className="underline" href={model.source_url} target="_blank" rel="noreferrer">{t.source}</a></p>
      <div className="mt-3 flex items-center gap-3">
        <Button disabled={!!busy || !workerInstalled} onClick={e => { focus.current = e.currentTarget; setConfirming(model); }}>{model.installed ? t.reinstall : t.download}</Button>
        {busy === model.id && <><progress max={100} value={progress} aria-label={t.progress} /><Button onClick={() => { void coreDispatch('components.cancel', { id: model.id }); }}>{t.cancel}</Button></>}
      </div>
    </article>)}</div>
    <ConfirmDialog open={confirming !== null} onOpenChange={open => { if (!open) setConfirming(null); }} title={t.confirmTitle} description={confirming ? t.confirmDescription.replace('{size}', gigabytes(confirming.size)).replace('{label}', confirming.label) : ''} cancelLabel={t.cancelDialog} confirmLabel={t.confirm} finalFocus={focus} onConfirm={() => { if (confirming) void download(confirming); }}>
      {confirming && <div className="overflow-y-auto px-5 pb-3 text-sm">
        <p className="font-semibold">{t.details}</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-fg-2">
          <li>{t.license}: {confirming.license}</li>
          <li>{t.size}: {gigabytes(confirming.size)}</li>
          <li>{t.revision}: <code>{confirming.revision.slice(0, 12)}</code></li>
          <li>{t.integrity}</li>
          <li><a className="underline" href={confirming.source_url} target="_blank" rel="noreferrer">{t.source}</a></li>
        </ul>
      </div>}
    </ConfirmDialog>
  </section>;
}
