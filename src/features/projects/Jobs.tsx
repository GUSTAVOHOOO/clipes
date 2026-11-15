import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

type Estimate = { kind: 'zero'|'plan_quota'|'usd'|'unknown'; minMicroUsd?: number|null; maxMicroUsd?: number|null };
type Job = { id: number; kind: string; safety?: 'local'|'paid'; state: 'queued'|'running'|'uncertain'|'completed'|'cancelled'|'failed'; progress: number; project: string; budgetPause?: string|null; taskCost?: {costLabel?: string|null}|null; batchCost?: {costLabel?: string|null}|null };
const texts = {
  'pt-BR': {budgetPaused:'Pausada pelo orçamento', userPaused:'Pausada pelo lote', costConfirmation:'Aguardando confirmação do custo', costUnknown:'Custo desconhecido', costQuota:'Consome a cota do plano', title:'Tarefas', empty:'Nenhuma tarefa neste Projeto.', preview:'Onda e miniaturas', transcribe:'Transcrição', provider:'Provedor', ai:'Tarefa de IA', estimateZero:'Custo estimado da repetição: zero (modelo local).', estimateQuota:'Custo estimado da repetição: consome a cota do plano.', estimateUsd:'Custo estimado da repetição: até US$ {value}.', estimateUnknown:'Custo estimado da repetição: desconhecido.', queued:'Na fila', running:'Em andamento', uncertain:'Resultado incerto', completed:'Concluída', cancelled:'Cancelada', failed:'Falhou', cancel:'Cancelar tarefa', repeat:'Repetir', discard:'Descartar', retryTitle:'Repetir tarefa?', retryDescription:'O resultado da chamada é incerto. Repetir pode gerar uma nova cobrança.', cancelDialog:'Cancelar', failedAction:'Não foi possível atualizar a tarefa.'},
  en: {budgetPaused:'Paused by budget', userPaused:'Paused by the batch', costConfirmation:'Awaiting cost confirmation', costUnknown:'Unknown cost', costQuota:'Uses your plan quota', title:'Tasks', empty:'No tasks in this Project.', preview:'Waveform and thumbnails', transcribe:'Transcription', provider:'Provider', ai:'AI task', estimateZero:'Estimated cost of retrying: zero (local model).', estimateQuota:'Estimated cost of retrying: uses your plan quota.', estimateUsd:'Estimated cost of retrying: up to US$ {value}.', estimateUnknown:'Estimated cost of retrying: unknown.', queued:'Queued', running:'In progress', uncertain:'Uncertain result', completed:'Completed', cancelled:'Cancelled', failed:'Failed', cancel:'Cancel task', repeat:'Retry', discard:'Discard', retryTitle:'Retry task?', retryDescription:'The result of the request is uncertain. Retrying may incur another charge.', cancelDialog:'Cancel', failedAction:'Could not update the task.'},
};
export function Jobs({projectId}: {projectId:string}) {
  const t = useText(texts);
  const [items, setItems] = useState<Job[]>([]);
  const [pending, setPending] = useState<number|null>(null);
  const [estimate, setEstimate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const retryFocus = useRef<HTMLButtonElement>(null);
  function stateLabel(item: Job) {
    if (item.state === 'queued' && item.budgetPause === 'user') return t.userPaused;
    if (item.state === 'queued' && item.budgetPause) return item.budgetPause === 'cost_unknown' ? t.costConfirmation : t.budgetPaused;
    return t[item.state];
  }
  function costLabel(item: Job) {
    const label = item.batchCost?.costLabel ?? item.taskCost?.costLabel;
    if (item.budgetPause === 'cost_unknown' || label === 'custo desconhecido') return t.costUnknown;
    if (label === 'consome a cota do plano') return t.costQuota;
    return null;
  }
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
  async function askRetry(item: Job) {
    if (item.safety === 'local') { void action('jobs.retry', item.id); return; }
    setError(''); setBusy(true);
    try {
      const view = await coreDispatch<{estimate: Estimate}>('jobs.estimate', {id: item.id});
      const e = view.estimate;
      setEstimate(e.kind === 'zero' ? t.estimateZero : e.kind === 'plan_quota' ? t.estimateQuota : e.kind === 'usd' && typeof e.maxMicroUsd === 'number' ? t.estimateUsd.replace('{value}', (e.maxMicroUsd / 1e6).toFixed(4)) : t.estimateUnknown);
      setPending(item.id);
    } catch { setEstimate(t.estimateUnknown); setPending(item.id); }
    finally { setBusy(false); }
  }
  return <section className="mt-8 border-t border-line pt-6" aria-labelledby="jobs-title">
    <h2 id="jobs-title" className="text-base font-semibold">{t.title}</h2>
    {error && <p role="alert" className="mt-3 text-danger">{error}</p>}
    {items.length === 0 ? <p className="mt-3 text-sm text-fg-2">{t.empty}</p> : <ul className="mt-3 divide-y divide-line border-y border-line">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div><p>{item.kind === 'preview' ? t.preview : item.kind === 'transcription' ? t.transcribe : item.kind.startsWith('ai:') ? t.ai : t.provider}</p><p className="text-sm text-fg-2">{stateLabel(item)}{item.state === 'running' && ` · ${item.progress}%`}</p>{costLabel(item) && <p className="text-sm text-fg-2">{costLabel(item)}</p>}{item.state === 'running' && <progress className="mt-1 w-48 max-w-full" value={item.progress} max={100} aria-label={t.running} />}</div>
      <div className="flex gap-2">{(item.state === 'queued' || item.state === 'running') && <Button disabled={busy} onClick={() => void action('jobs.cancel', item.id)}>{t.cancel}</Button>}{item.state === 'uncertain' && <><Button ref={retryFocus} disabled={busy} onClick={() => void askRetry(item)}>{t.repeat}</Button><Button disabled={busy} onClick={() => void action('jobs.discard', item.id)}>{t.discard}</Button></>}</div>
    </li>)}</ul>}
    <ConfirmDialog open={pending !== null} onOpenChange={open => { if (!open) setPending(null); }} title={t.retryTitle} description={`${t.retryDescription} ${estimate}`} cancelLabel={t.cancelDialog} confirmLabel={t.repeat} finalFocus={retryFocus} onConfirm={() => { const id = pending; setPending(null); if (id !== null) void action('jobs.retry', id, true); }}/>
  </section>;
}
