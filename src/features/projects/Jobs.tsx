import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

type Job = { id: number; kind: string; state: 'queued'|'running'|'uncertain'|'completed'|'cancelled'|'failed'; progress: number; project: string };
const texts = {
  'pt-BR': {title:'Tarefas', empty:'Nenhuma tarefa neste Projeto.', preview:'Onda e miniaturas', provider:'Provedor', queued:'Na fila', running:'Em andamento', uncertain:'Resultado incerto', completed:'Concluída', cancelled:'Cancelada', failed:'Falhou', cancel:'Cancelar tarefa', repeat:'Repetir', discard:'Descartar', retryTitle:'Repetir tarefa?', retryDescription:'O resultado da chamada é incerto. Repetir pode gerar uma nova cobrança.', cancelDialog:'Cancelar', failedAction:'Não foi possível atualizar a tarefa.'},
  en: {title:'Tasks', empty:'No tasks in this Project.', preview:'Waveform and thumbnails', provider:'Provider', queued:'Queued', running:'In progress', uncertain:'Uncertain result', completed:'Completed', cancelled:'Cancelled', failed:'Failed', cancel:'Cancel task', repeat:'Retry', discard:'Discard', retryTitle:'Retry task?', retryDescription:'The result of the request is uncertain. Retrying may incur another charge.', cancelDialog:'Cancel', failedAction:'Could not update the task.'},
};
export function Jobs({projectId}: {projectId:string}) {
  const t = useText(texts);
  const [items, setItems] = useState<Job[]>([]);
  const [pending, setPending] = useState<number|null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const retryFocus = useRef<HTMLButtonElement>(null);
  async function refresh() { setItems(await coreDispatch<Job[]>('jobs.list', {})); }
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const sync = () => { if (active) void refresh().catch(() => { if (active) setError(t.failedAction); }); };
    sync();
    listen<{project?:string}>('core-progress', event => { if (event.payload.project === projectId) sync(); }).then(fn => { if (active) unlisten = fn; else fn(); }).catch(() => {});
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    const timer = window.setInterval(sync, 5000);
    return () => { active = false; unlisten?.(); window.clearInterval(timer); window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', sync); };
  }, [projectId, t.failedAction]);
  async function action(name: string, id: number, confirmed = false) {
    setError(''); setBusy(true);
    try { await coreDispatch(name, {id, confirmed}); await refresh(); }
    catch { setError(t.failedAction); }
    finally { setBusy(false); }
  }
  return <section className="mt-8 border-t border-line pt-6" aria-labelledby="jobs-title">
    <h2 id="jobs-title" className="text-base font-semibold">{t.title}</h2>
    {error && <p role="alert" className="mt-3 text-danger">{error}</p>}
    {items.length === 0 ? <p className="mt-3 text-sm text-fg-2">{t.empty}</p> : <ul className="mt-3 divide-y divide-line border-y border-line">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div><p>{item.kind === 'preview' ? t.preview : t.provider}</p><p className="text-sm text-fg-2">{t[item.state]}{item.state === 'running' && ` · ${item.progress}%`}</p>{item.state === 'running' && <progress className="mt-1 w-48 max-w-full" value={item.progress} max={100} aria-label={t.running} />}</div>
      <div className="flex gap-2">{(item.state === 'queued' || item.state === 'running') && <Button disabled={busy} onClick={() => void action('jobs.cancel', item.id)}>{t.cancel}</Button>}{item.state === 'uncertain' && <><Button ref={retryFocus} disabled={busy} onClick={() => setPending(item.id)}>{t.repeat}</Button><Button disabled={busy} onClick={() => void action('jobs.discard', item.id)}>{t.discard}</Button></>}</div>
    </li>)}</ul>}
    <ConfirmDialog open={pending !== null} onOpenChange={open => { if (!open) setPending(null); }} title={t.retryTitle} description={t.retryDescription} cancelLabel={t.cancelDialog} confirmLabel={t.repeat} finalFocus={retryFocus} onConfirm={() => { const id = pending; setPending(null); if (id !== null) void action('jobs.retry', id, true); }}/>
  </section>;
}
