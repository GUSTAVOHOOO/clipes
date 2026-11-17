import { useContext, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { coreDispatch } from '@/lib/core';
import { LanguageContext, useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CHANNEL_PROFILE_UPDATED_EVENT, type ChannelProfileData } from './ChannelProfile';
import { VideoKindBadge, VideoKindPicker, kindOf, type VideoKind } from './videoKind';

type SourceRow = { id: number; path: string; status: string };
type Item = { position: number; sourceId: number; name: string | null; state: 'pending' | 'transcribing' | 'selecting' | 'completed' | 'paused' | 'cancelled'; error: string | null; resetAtMs?: number | null; progress: number | null };
type Budget = { maxCostMicroUsd: number | null; usage: { microUsd: number; audioMicroUsd?: number; costLabel: string | null } } | null;
type Batch = { id: number; key: string; videoKind?: VideoKind; status: 'running' | 'paused' | 'budget_paused' | 'attention' | 'completed' | 'cancelled'; pause: string | null; budget: Budget; counts: { total: number; completed: number; paused: number; active: number; pending: number; cancelled: number }; items: Item[] };
type Pending =
  | { kind: 'create'; usage: { selectionPaid?: boolean; transcriptionPaid?: boolean; audioEstimateMicroUsd?: number | null; maxCostMicroUsd?: number | null; sources?: number } }
  | { kind: 'item'; batch: number; source: number; estimate: string }
  | { kind: 'unknown'; batch: number; key: string };

const texts = {
  'pt-BR': {
    title: 'Lote de Fontes', intro: 'Escolha várias Fontes: o app transcreve e seleciona os Cortes de uma depois da outra.',
    pick: 'Fontes do lote', none: 'Nenhuma Fonte disponível.', engine: 'Motor de transcrição', local: 'Local', groq: 'Groq (pago)',
    cap: 'Teto de custo do lote (US$, opcional)', create: 'Criar lote', created: 'Lotes',
    status: { running: 'Em andamento', paused: 'Pausado', budget_paused: 'Pausado pelo teto', attention: 'Precisa de atenção', completed: 'Concluído', cancelled: 'Cancelado' },
    state: { pending: 'Na espera', transcribing: 'Transcrevendo', selecting: 'Selecionando', completed: 'Concluída', paused: 'Pausada', cancelled: 'Cancelada' },
    summary: '{done} de {total} Fontes concluídas', pause: 'Pausar lote', resume: 'Retomar lote', cancel: 'Cancelar lote',
    itemResume: 'Retomar Fonte', spent: 'Gasto: US$ {spent}', capNow: 'Teto: US$ {cap}', noCap: 'Sem teto', unknownCost: 'Custo desconhecido', quota: 'Consome a cota do plano',
    setCap: 'Definir teto', newCap: 'Novo teto (US$)', continueCap: 'Continuar com este teto', budgetPaused: 'O teto de custo foi atingido: o lote parou. Aumente o teto e continue.',
    unknownPaused: 'O custo deste Provedor é desconhecido: o teto não vale para ele. Confirme para continuar o lote.', continueUnknown: 'Confirmar e continuar',
    unknownTitle: 'Continuar com custo desconhecido?', unknownBody: 'O Provedor não tem preço conhecido. O lote não tem como respeitar um teto de custo nele. Você confirma continuar?',
    confirmTitle: 'Usar um serviço pago no lote?', confirmBody: 'O lote envia as Transcrições a um Provedor pago.', confirmAudio: 'O áudio vai ao Groq, com custo pelo tempo de áudio.', audioEstimate: 'Estimativa do áudio: US$ {cost}, a partir da duração das Fontes.', audioUnknown: 'Estimativa do áudio indisponível.',
    confirmSelection: 'O custo da seleção só pode ser estimado por Fonte depois da Transcrição.', confirmCap: 'Teto do lote: US$ {cap}.', confirmNoCap: 'Sem teto de custo: considere definir um.',
    confirmConsent: 'Esta confirmação não substitui o consentimento do texto ao Provedor nem do áudio ao Groq.', confirmAction: 'Confirmar e criar lote', cancelDialog: 'Cancelar',
    itemTitle: 'Repetir esta Fonte?', itemBody: 'Repetir envia de novo só o que não foi concluído e pode gerar nova cobrança. Custo estimado: {cost}.', itemAction: 'Confirmar e repetir',
    costUsd: 'até US$ {max}', costZero: 'zero (modelo local)', costQuota: 'consome a cota do plano', costUnknownEstimate: 'desconhecido',
    uncertainHint: 'Resultado incerto: confira e repita na lista de Tarefas, com o custo.',
    error: 'Não foi possível atualizar o lote.', code: 'erro', resetAt: ' · reinicia às {time}',
    codes: { provider_http: 'o Provedor recusou a chamada', rate_limit: 'limite de taxa do Provedor', provider_daily_limit: 'limite diário do Provedor atingido', request_too_large: 'a janela passou do limite de tamanho do Provedor', network: 'falha de rede', timeout_uncertain: 'resultado incerto', interrupted: 'resultado incerto (app fechado)', cancelled: 'cancelada', verification_failed: 'a resposta não passou na verificação', output_invalid: 'a resposta fugiu do formato', invalid_json: 'a resposta não era JSON válido', context_truncated: 'a Transcrição foi cortada pelo Provedor', groq_key_missing: 'falta a chave do Groq', confirmation_required: 'falta consentimento', local_only_violation: 'bloqueado por "somente local"', source_changed: 'a Fonte está indisponível ou mudou', component_missing: 'falta um Componente', transcription_failed: 'a Transcrição falhou', transcription_incomplete: 'a Transcrição não terminou', transcription_retry_confirmation: 'repetir pede confirmação', context_too_small: 'contexto do modelo pequeno demais' } as Record<string, string>,
  },
  en: {
    title: 'Source batch', intro: 'Pick several Sources: the app transcribes and selects Clips for one after the other.',
    pick: 'Batch Sources', none: 'No Source available.', engine: 'Transcription engine', local: 'Local', groq: 'Groq (paid)',
    cap: 'Batch cost cap (US$, optional)', create: 'Create batch', created: 'Batches',
    status: { running: 'Running', paused: 'Paused', budget_paused: 'Paused by the cap', attention: 'Needs attention', completed: 'Completed', cancelled: 'Cancelled' },
    state: { pending: 'Waiting', transcribing: 'Transcribing', selecting: 'Selecting', completed: 'Completed', paused: 'Paused', cancelled: 'Cancelled' },
    summary: '{done} of {total} Sources completed', pause: 'Pause batch', resume: 'Resume batch', cancel: 'Cancel batch',
    itemResume: 'Resume Source', spent: 'Spent: US$ {spent}', capNow: 'Cap: US$ {cap}', noCap: 'No cap', unknownCost: 'Unknown cost', quota: 'Uses your plan quota',
    setCap: 'Set cap', newCap: 'New cap (US$)', continueCap: 'Continue with this cap', budgetPaused: 'The cost cap was reached: the batch stopped. Raise the cap and continue.',
    unknownPaused: 'This Provider has no known price: the cap cannot apply to it. Confirm to continue the batch.', continueUnknown: 'Confirm and continue',
    unknownTitle: 'Continue with unknown cost?', unknownBody: 'The Provider has no known price, so the batch cannot enforce a cost cap on it. Do you confirm continuing?',
    confirmTitle: 'Use a paid service in the batch?', confirmBody: 'The batch sends Transcripts to a paid Provider.', confirmAudio: 'Audio goes to Groq, billed by audio time.', audioEstimate: 'Estimated audio cost: US$ {cost}, based on Source duration.', audioUnknown: 'Audio cost estimate unavailable.',
    confirmSelection: 'The selection cost can only be estimated per Source after transcription.', confirmCap: 'Batch cap: US$ {cap}.', confirmNoCap: 'No cost cap: consider setting one.',
    confirmConsent: 'This confirmation does not replace the consent to send text to the Provider or audio to Groq.', confirmAction: 'Confirm and create batch', cancelDialog: 'Cancel',
    itemTitle: 'Retry this Source?', itemBody: 'Retrying sends again only what did not finish and may incur a new charge. Estimated cost: {cost}.', itemAction: 'Confirm and retry',
    costUsd: 'up to US$ {max}', costZero: 'zero (local model)', costQuota: 'uses your plan quota', costUnknownEstimate: 'unknown',
    uncertainHint: 'Uncertain result: check and retry in the Tasks list, with the cost.',
    error: 'Could not update the batch.', code: 'error', resetAt: ' · resets at {time}',
    codes: { provider_http: 'the Provider refused the call', rate_limit: 'Provider rate limit', provider_daily_limit: 'Provider daily limit reached', request_too_large: 'the window exceeded the Provider size limit', network: 'network failure', timeout_uncertain: 'uncertain result', interrupted: 'uncertain result (app closed)', cancelled: 'cancelled', verification_failed: 'the answer failed verification', output_invalid: 'the answer did not match the format', invalid_json: 'the answer was not valid JSON', context_truncated: 'the Provider cut the Transcript', groq_key_missing: 'Groq key missing', confirmation_required: 'consent missing', local_only_violation: 'blocked by "local only"', source_changed: 'the Source is unavailable or changed', component_missing: 'a Component is missing', transcription_failed: 'Transcription failed', transcription_incomplete: 'Transcription did not finish', transcription_retry_confirmation: 'retrying needs confirmation', context_too_small: 'model context too small' } as Record<string, string>,
  },
};
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
const usd = (micro: number) => (micro / 1_000_000).toFixed(4);
const toMicro = (text: string) => { const n = Number(text.replace(',', '.')); return text.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000) : null; };
type Fail = { code?: string; message?: string; usage?: { estimate?: { kind: string; maxMicroUsd?: number | null } } };

/** Lote de Fontes (#56): montar, acompanhar por Fonte, pausar, retomar, teto e confirmações. */
export function SourceBatches({ project, projectId }: { project: string; projectId: string }) {
  const t = useText(texts);
  const language = useContext(LanguageContext);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [chosen, setChosen] = useState<number[]>([]);
  const [engine, setEngine] = useState<'local' | 'groq'>('local');
  const [cap, setCap] = useState('');
  const [videoKind, setVideoKind] = useState<VideoKind>('direct');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [capEdit, setCapEdit] = useState<Record<number, string>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const focus = useRef<HTMLButtonElement>(null);

  async function refresh() { setBatches(await coreDispatch<Batch[]>('batches.list', {})); }
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const sync = () => { if (active) void refresh().catch(() => { if (active) setError(t.error); }); };
    coreDispatch<SourceRow[]>('sources.list', { project }).then(rows => { if (active) setSources(rows); }).catch(() => {});
    coreDispatch<ChannelProfileData>('channel_profile.get', {}).then(p => { if (active) setVideoKind(kindOf(p.videoKind)); }).catch(() => {});
    const onUpdated = (e: Event) => {
      const next = (e as CustomEvent<ChannelProfileData>).detail;
      if (next?.videoKind) setVideoKind(kindOf(next.videoKind));
    };
    window.addEventListener(CHANNEL_PROFILE_UPDATED_EVENT, onUpdated);
    sync();
    listen<{ project?: string }>('core-progress', event => { if (event.payload.project === projectId) sync(); }).then(fn => { if (active) unlisten = fn; else fn(); }).catch(() => {});
    const timer = window.setInterval(sync, 3000);
    return () => { active = false; window.removeEventListener(CHANNEL_PROFILE_UPDATED_EVENT, onUpdated); unlisten?.(); window.clearInterval(timer); };
  }, [project, projectId, t.error]);

  const name = (path: string) => path.split(/[\\/]/).pop() ?? path;
  async function run(action: () => Promise<unknown>, onError?: (e: Fail) => boolean) {
    setError(''); setBusy(true);
    try { await action(); await refresh(); }
    catch (e) { const f = e as Fail; if (!onError?.(f)) setError(f.code ? `${t.error} (${t.code}: ${t.codes[f.code] ?? f.code})` : t.error); }
    finally { setBusy(false); }
  }
  const capMicro = toMicro(cap);
  async function create(confirmed: boolean) {
    await run(
      () => coreDispatch('batches.create', { sourceIds: chosen, engine, videoKind, ...(capMicro !== null ? { maxCostMicroUsd: capMicro } : {}), ...(confirmed ? { confirmed: true } : {}) }).then(() => { setChosen([]); setCap(''); }),
      f => { if (f.code === 'confirmation_required') { setPending({ kind: 'create', usage: (f as { usage?: Extract<Pending, { kind: 'create' }>['usage'] }).usage ?? {} }); return true; } return false; },
    );
  }
  async function resumeItem(batch: number, source: number, confirmed = false) {
    await run(
      () => coreDispatch('batches.item.resume', { id: batch, sourceId: source, ...(confirmed ? { confirmed: true } : {}) }),
      f => {
        if (f.code === 'confirmation_required' || f.code === 'transcription_retry_confirmation') {
          const e = f.usage?.estimate;
          const estimate = !e ? t.costUnknownEstimate : e.kind === 'zero' ? t.costZero : e.kind === 'plan_quota' ? t.costQuota : e.kind === 'usd' && typeof e.maxMicroUsd === 'number' ? fill(t.costUsd, { max: usd(e.maxMicroUsd) }) : t.costUnknownEstimate;
          setPending({ kind: 'item', batch, source, estimate });
          return true;
        }
        if (f.code === 'uncertain_job') { setError(t.uncertainHint); return true; }
        return false;
      },
    );
  }
  async function continueBudget(b: Batch, confirmed: boolean) {
    const text = capEdit[b.id] ?? '';
    const micro = toMicro(text);
    await run(
      () => coreDispatch('jobs.budget.continue', { scope: 'batch', key: b.key, ...(micro !== null ? { maxCostMicroUsd: micro } : {}), ...(confirmed ? { confirmed: true } : {}) }),
      f => { if (f.code === 'confirmation_required') { setPending({ kind: 'unknown', batch: b.id, key: b.key }); return true; } return false; },
    );
  }
  const toggle = (id: number) => setChosen(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const costLine = (b: Batch) => {
    const u = b.budget?.usage; if (!u) return null;
    const parts = [fill(t.spent, { spent: usd(u.microUsd) }), b.budget?.maxCostMicroUsd != null ? fill(t.capNow, { cap: usd(b.budget.maxCostMicroUsd) }) : t.noCap];
    if (u.costLabel === 'custo desconhecido') parts.push(t.unknownCost); else if (u.costLabel === 'consome a cota do plano') parts.push(t.quota);
    return parts.join(' · ');
  };
  const pendingCreate = pending?.kind === 'create' ? pending.usage : null;
  return <section className="mt-8 border-t border-line pt-6" aria-labelledby="batches-title">
    <h2 id="batches-title" className="text-base font-semibold">{t.title}</h2>
    <p className="mt-1 text-sm text-fg-2">{t.intro}</p>
    <fieldset className="mt-3"><legend className="text-sm">{t.pick}</legend>
      {sources.length === 0 ? <p className="text-sm text-fg-2">{t.none}</p> : <ul className="mt-1 flex flex-col gap-1">{sources.map(s => <li key={s.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={chosen.includes(s.id)} onChange={() => toggle(s.id)} />{name(s.path)}</label></li>)}</ul>}
    </fieldset>
    <div className="mt-3 text-sm"><VideoKindPicker value={videoKind} onChange={setVideoKind} disabled={busy} /></div>
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">{t.engine}<select className="foco h-8 rounded-md border border-line-strong bg-field px-3 text-fg" value={engine} onChange={e => setEngine(e.target.value as 'local' | 'groq')}><option value="local">{t.local}</option><option value="groq">{t.groq}</option></select></label>
      <label className="flex flex-col gap-1 text-sm">{t.cap}<input inputMode="decimal" className="foco h-8 w-40 rounded-md border border-line-strong bg-field px-3 text-fg" value={cap} onChange={e => setCap(e.target.value)} /></label>
      <Button ref={focus} variante="primario" disabled={busy || chosen.length === 0 || (cap.trim() !== '' && capMicro === null)} onClick={() => void create(false)}>{t.create}</Button>
    </div>
    {error && <p role="alert" className="mt-3 text-danger">{error}</p>}
    {batches.length > 0 && <h3 className="mt-5 text-sm font-semibold">{t.created}</h3>}
    <ul className="mt-2 flex flex-col gap-4">{batches.map(b => <li key={b.id} className="rounded-md border border-line p-3" aria-label={`${t.title} ${b.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="flex flex-wrap items-center gap-2 font-medium">{t.title} {b.id} · {t.status[b.status]} <VideoKindBadge kind={kindOf(b.videoKind)} /></p><p className="text-sm text-fg-2">{fill(t.summary, { done: b.counts.completed, total: b.counts.total })}</p>{costLine(b) && <p className="text-sm text-fg-2">{costLine(b)}</p>}</div>
        <div className="flex gap-2">
          {(b.status === 'running' || b.status === 'attention' || b.status === 'budget_paused') && <Button disabled={busy} onClick={() => void run(() => coreDispatch('batches.pause', { id: b.id }))}>{t.pause}</Button>}
          {b.status === 'paused' && <Button disabled={busy} onClick={() => void run(() => coreDispatch('batches.resume', { id: b.id }))}>{t.resume}</Button>}
          {b.status !== 'completed' && b.status !== 'cancelled' && <Button disabled={busy} onClick={() => void run(() => coreDispatch('batches.cancel', { id: b.id }))}>{t.cancel}</Button>}
        </div>
      </div>
      {b.status !== 'completed' && b.status !== 'cancelled' && <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">{b.status === 'budget_paused' || b.pause === 'cost_unknown' ? t.newCap : t.setCap}<input aria-label={`${t.newCap} ${b.id}`} inputMode="decimal" className="foco h-8 w-32 rounded-md border border-line-strong bg-field px-3 text-fg" value={capEdit[b.id] ?? ''} onChange={e => setCapEdit(m => ({ ...m, [b.id]: e.target.value }))} /></label>
        <Button disabled={busy || toMicro(capEdit[b.id] ?? '') === null} onClick={() => void run(() => coreDispatch('jobs.budget.set', { scope: 'batch', key: b.key, maxCostMicroUsd: toMicro(capEdit[b.id] ?? '') }))}>{t.setCap} {b.id}</Button>
        {b.pause !== null && b.pause !== 'user' && b.pause !== 'cost_unknown' && <Button variante="primario" disabled={busy} onClick={() => void continueBudget(b, false)}>{t.continueCap}</Button>}
        {b.pause === 'cost_unknown' && <Button variante="primario" disabled={busy} onClick={() => void continueBudget(b, false)}>{t.continueUnknown}</Button>}
      </div>}
      {b.pause === 'cost_unknown' && <p className="mt-2 text-sm text-fg-2">{t.unknownPaused}</p>}
      {b.pause !== null && b.pause !== 'user' && b.pause !== 'cost_unknown' && <p className="mt-2 text-sm text-fg-2">{t.budgetPaused}</p>}
      <ul className="mt-3 divide-y divide-line border-y border-line">{b.items.map(i => {
        const reset = i.state === 'paused' && i.error === 'provider_daily_limit' && typeof i.resetAtMs === 'number'
          ? fill(t.resetAt, { time: new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(new Date(i.resetAtMs)) })
          : '';
        return <li key={i.position} className="flex flex-wrap items-center justify-between gap-3 py-2">
          <div><p className="text-sm">{i.name ?? `#${i.sourceId}`}</p><p className="text-sm text-fg-2">{t.state[i.state]}{(i.state === 'transcribing' || i.state === 'selecting') && i.progress !== null && ` · ${i.progress}%`}{i.state === 'paused' && i.error && ` · ${t.code}: ${t.codes[i.error] ?? i.error}${reset}`}</p>
            {(i.state === 'transcribing' || i.state === 'selecting') && i.progress !== null && <progress className="mt-1 w-40 max-w-full" value={i.progress} max={100} aria-label={`${t.state[i.state]} ${i.name ?? i.sourceId}`} />}</div>
          {i.state === 'paused' && <Button disabled={busy} onClick={() => void resumeItem(b.id, i.sourceId)}>{t.itemResume} {i.name ?? i.sourceId}</Button>}
        </li>;
      })}</ul>
    </li>)}</ul>
    <ConfirmDialog open={pending?.kind === 'create'} onOpenChange={open => { if (!open) setPending(null); }} title={t.confirmTitle}
      description={[pendingCreate?.selectionPaid ? t.confirmBody : '', pendingCreate?.transcriptionPaid ? t.confirmAudio : '', pendingCreate?.transcriptionPaid ? (typeof pendingCreate.audioEstimateMicroUsd === 'number' ? fill(t.audioEstimate, { cost: usd(pendingCreate.audioEstimateMicroUsd) }) : t.audioUnknown) : '', t.confirmSelection, pendingCreate?.maxCostMicroUsd != null ? fill(t.confirmCap, { cap: usd(pendingCreate.maxCostMicroUsd) }) : t.confirmNoCap, t.confirmConsent].filter(Boolean).join(' ')}
      cancelLabel={t.cancelDialog} confirmLabel={t.confirmAction} finalFocus={focus} onConfirm={() => { setPending(null); void create(true); }} />
    <ConfirmDialog open={pending?.kind === 'item'} onOpenChange={open => { if (!open) setPending(null); }} title={t.itemTitle}
      description={pending?.kind === 'item' ? fill(t.itemBody, { cost: pending.estimate }) : ''} cancelLabel={t.cancelDialog} confirmLabel={t.itemAction} finalFocus={focus}
      onConfirm={() => { const p = pending; setPending(null); if (p?.kind === 'item') void resumeItem(p.batch, p.source, true); }} />
    <ConfirmDialog open={pending?.kind === 'unknown'} onOpenChange={open => { if (!open) setPending(null); }} title={t.unknownTitle} description={t.unknownBody}
      cancelLabel={t.cancelDialog} confirmLabel={t.continueUnknown} finalFocus={focus}
      onConfirm={() => { const p = pending; setPending(null); if (p?.kind === 'unknown') { const b = batches.find(x => x.id === p.batch); if (b) void continueBudget(b, true); } }} />
  </section>;
}
