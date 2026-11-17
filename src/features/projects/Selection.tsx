import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { openCutPreview } from './CutPreview';
import { openEditor } from '@/features/editor/Editor';
import { CandidateReview } from './CandidateReview';
import { BatchExport } from '@/features/export/BatchExport';
import { clock, fill, message } from './selectionFormat';
import { CHANNEL_PROFILE_UPDATED_EVENT, type ChannelProfileData } from './ChannelProfile';
import { VideoKindBadge, VideoKindPicker, WeightsLine, kindOf, type VideoKind } from './videoKind';

type Estimate = { kind: string; windows: number; inputTokens: number; minMicroUsd: number | null; maxMicroUsd: number | null };
type Weight = { key: string; weight: number };
type Preview = { paid: boolean; videoKind?: VideoKind; profile?: string; plan?: { state: 'full' | 'reduced'; windows: unknown[] }; weights?: Weight[]; estimate: Estimate };
type Axis = { score: number; why: string };
type Candidate = { id: number; rank: number; startId: number; endId: number; startUs: number; endUs: number; axes: Record<string, Axis>; total: number; title: string; windows: number[]; adjusted: boolean; adjust: { extendedBefore?: number; extendedAfter?: number; trimmedEnd?: number } | null; profile?: string; revision?: number };
type Win = { index: number; startUs: number; endUs: number; state: string; code: string | null };
type ChatStatus = { state: 'none' | 'available' | 'absent'; canFetch: boolean; peaks: number; job: { state: string } | null };
type Run = { videoKind?: VideoKind; summary?: { energy?: { measured: boolean; high?: number; peak?: number }; chat?: { available: boolean; peaks?: number } } | null; id: number; state: 'running' | 'completed' | 'partial'; weights: Weight[]; budgetPause: string | null; counts: { windows: number; completed: number; failed: number; kept: number; discarded: number; merged: number }; createdAt: string };
type Detail = { run: Run; windows: Win[]; candidates: Candidate[] };
type Pending = { kind: 'start' } | { kind: 'redo'; windows?: number[] };

const texts = {
  'pt-BR': {
    title: 'Seleção de Cortes', start: 'Selecionar Cortes', cancel: 'Cancelar seleção', resume: 'Retomar janelas', redo: 'Refazer janela',
    estimating: 'Calculando janelas de seleção…', runningReason: 'Há uma seleção em andamento para esta Fonte.', busyReason: 'Aguarde a operação atual terminar.',
    estimate: 'Estimativa: {windows} janelas', free: 'sem custo (modelo local)', unknown: 'custo desconhecido', quota: 'consome a cota do plano', range: 'entre US$ {min} e US$ {max}', reduced: 'janelas reduzidas pelo contexto do modelo',
    confirmTitle: 'Usar o Provedor pago?', confirmBody: 'A seleção envia a Transcrição, em janelas, ao Provedor escolhido. Custo estimado: {cost}.', confirmRedo: 'Refazer envia de novo só as janelas escolhidas. Custo estimado: {cost}.', confirm: 'Confirmar e selecionar', confirmRedoLabel: 'Confirmar e refazer', dismiss: 'Cancelar',
    progress: 'Progresso da seleção', windowsDone: '{done} de {total} janelas', window: 'Janela {n}', paused: 'Pausada pelo orçamento do lote. Aumente o teto e continue na fila.',
    done: 'Seleção concluída', partial: 'Seleção com janelas pendentes', running: 'Selecionando',
    summary: '{kept} candidatos · {merged} juntados · {discarded} descartados',
    energyOn: 'Energia do áudio: {high} Frases com energia alta e {peak} com pico entraram na seleção.', energyOff: 'Energia do áudio não medida: a seleção rodou sem as marcas de energia.',
    chatOn: 'Chat da live: {peaks} picos entraram na seleção como indício, não como prova.', chatOff: 'Sem chat da live: a seleção rodou sem as marcas de chat.',
    chatFetch: 'Buscar o chat da live', chatFetching: 'Buscando o chat da live…', chatAvailable: 'Chat da live disponível ({peaks} picos).', chatAbsent: 'Esta Fonte não tem replay de chat.', chatFailed: 'Não foi possível buscar o chat da live.',
    minScore: 'Nota mínima', none: 'Nenhum candidato nesta seleção: o modelo não achou Cortes que valessem a pena.', noneFilter: 'Nenhum candidato com essa Nota.',
    run: 'Execução', error: 'Não foi possível atualizar a seleção.',
    state: { queued: 'na fila', running: 'em andamento', completed: 'concluída', failed: 'falhou', cancelled: 'cancelada', uncertain: 'incerta', unscheduled: 'não iniciada' },
    code: { verification_failed: 'a resposta não passou na verificação', output_invalid: 'a resposta fugiu do formato', invalid_json: 'a resposta não era JSON válido', context_truncated: 'a Transcrição foi cortada pelo Provedor; a resposta não foi aceita', cancelled: 'cancelada', timeout_uncertain: 'tempo esgotado, resultado incerto', not_started: 'não iniciada', output_truncated: 'a resposta foi cortada', refusal: 'o Provedor recusou', default: 'falhou' },
  },
  en: {
    title: 'Clip selection', start: 'Select Clips', cancel: 'Cancel selection', resume: 'Resume windows', redo: 'Redo window',
    estimating: 'Estimating selection windows…', runningReason: 'A selection is already running for this Source.', busyReason: 'Wait for the current action to finish.',
    estimate: 'Estimate: {windows} windows', free: 'free (local model)', unknown: 'cost unknown', quota: 'uses your plan quota', range: 'between US$ {min} and US$ {max}', reduced: 'windows shortened by the model context',
    confirmTitle: 'Use the paid Provider?', confirmBody: 'The selection sends the Transcript, in windows, to the chosen Provider. Estimated cost: {cost}.', confirmRedo: 'Redo sends only the chosen windows again. Estimated cost: {cost}.', confirm: 'Confirm and select', confirmRedoLabel: 'Confirm and redo', dismiss: 'Cancel',
    progress: 'Selection progress', windowsDone: '{done} of {total} windows', window: 'Window {n}', paused: 'Paused by the batch budget. Raise the cap and continue in the queue.',
    done: 'Selection finished', partial: 'Selection with pending windows', running: 'Selecting',
    summary: '{kept} candidates · {merged} merged · {discarded} discarded',
    energyOn: 'Audio energy: {high} high-energy and {peak} peak sentences were part of the selection.', energyOff: 'Audio energy not measured: the selection ran without energy marks.',
    chatOn: 'Live chat: {peaks} peaks were part of the selection as a hint, not as proof.', chatOff: 'No live chat: the selection ran without chat marks.',
    chatFetch: 'Fetch the live chat', chatFetching: 'Fetching the live chat…', chatAvailable: 'Live chat available ({peaks} peaks).', chatAbsent: 'This Source has no chat replay.', chatFailed: 'Could not fetch the live chat.',
    minScore: 'Minimum score', none: 'No candidates in this selection: the model found no Clips worth keeping.', noneFilter: 'No candidate with this score.',
    run: 'Run', error: 'Could not update the selection.',
    state: { queued: 'queued', running: 'running', completed: 'completed', failed: 'failed', cancelled: 'cancelled', uncertain: 'uncertain', unscheduled: 'not started' },
    code: { verification_failed: 'the answer failed verification', output_invalid: 'the answer did not match the format', invalid_json: 'the answer was not valid JSON', context_truncated: 'the Provider cut the Transcript; the answer was not accepted', cancelled: 'cancelled', timeout_uncertain: 'timed out, result uncertain', not_started: 'not started', output_truncated: 'the answer was cut off', refusal: 'the Provider refused', default: 'failed' },
  },
};
const usd = (micro: number) => (micro / 1_000_000).toFixed(4);

/** Seleção de Cortes de uma Fonte transcrita: estimativa, execução por Janela e candidatos. */
export function Selection({ sourceId }: { sourceId: number }) {
  const t = useText(texts);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [blocked, setBlocked] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [videoKind, setVideoKind] = useState<VideoKind>('direct');
  const [profileVersion, setProfileVersion] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [redoPaid, setRedoPaid] = useState<Preview | null>(null);
  const focus = useRef<HTMLButtonElement>(null);
  const [chat, setChat] = useState<ChatStatus | null>(null);
  const loadChat = useCallback(async () => { setChat(await coreDispatch<ChatStatus>('chat.status', { source_id: sourceId })); }, [sourceId]);
  useEffect(() => { loadChat().catch(() => setChat(null)); }, [loadChat]);
  useEffect(() => {
    let active = true;
    coreDispatch<ChannelProfileData>('channel_profile.get', {})
      .then(p => { if (active) setVideoKind(kindOf(p.videoKind)); })
      .catch(() => {});
    const onUpdated = (e: Event) => {
      const next = (e as CustomEvent<ChannelProfileData>).detail;
      if (next?.videoKind) setVideoKind(kindOf(next.videoKind));
      setProfileVersion(v => v + 1);
    };
    window.addEventListener(CHANNEL_PROFILE_UPDATED_EVENT, onUpdated);
    return () => { active = false; window.removeEventListener(CHANNEL_PROFILE_UPDATED_EVENT, onUpdated); };
  }, [sourceId]);
  const fetching = chat?.job?.state === 'queued' || chat?.job?.state === 'running';
  useEffect(() => {
    if (!fetching) return;
    const timer = window.setInterval(() => { void loadChat().catch(() => {}); }, 2000);
    return () => window.clearInterval(timer);
  }, [fetching, loadChat]);
  async function fetchChat() { setError(''); try { await coreDispatch('chat.fetch', { source_id: sourceId }); await loadChat(); } catch (e) { setError(message(e)); } }

  const loadRuns = useCallback(async () => {
    const list = await coreDispatch<Run[]>('selection.list', { source_id: sourceId });
    setRuns(list);
    setCurrent(c => c ?? list[0]?.id ?? null);
  }, [sourceId]);
  const loadDetail = useCallback(async (id: number) => { setDetail(await coreDispatch<Detail>('selection.get', { run: id })); }, []);
  useEffect(() => {
    let active = true;
    setBlocked(''); setPreview(null);
    coreDispatch<Preview>('selection.estimate', { source_id: sourceId, videoKind }).then(p => { if (active) setPreview(p); }).catch(e => { if (active) setBlocked(message(e)); });
    return () => { active = false; };
  }, [sourceId, videoKind, profileVersion]);
  useEffect(() => {
    let active = true;
    loadRuns().catch(() => { if (active) setError(t.error); });
    return () => { active = false; };
  }, [loadRuns, t.error]);
  useEffect(() => {
    if (current === null) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    const sync = () => { if (active) void loadDetail(current).catch(() => { if (active) setError(t.error); }); };
    sync();
    if (isTauri()) listen('core-progress', sync).then(fn => { if (active) unlisten = fn; else fn(); }).catch(() => {});
    const timer = window.setInterval(sync, 3000);
    return () => { active = false; unlisten?.(); window.clearInterval(timer); };
  }, [current, loadDetail, t.error]);

  function costText(e: Estimate) {
    if (e.kind === 'zero') return t.free;
    if (e.kind === 'plan_quota') return t.quota;
    if (e.kind === 'usd' && e.minMicroUsd !== null && e.maxMicroUsd !== null) return fill(t.range, { min: usd(e.minMicroUsd), max: usd(e.maxMicroUsd) });
    return t.unknown;
  }
  async function run(action: () => Promise<unknown>) {
    setError(''); setBusy(true);
    try { await action(); await loadRuns(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function startNow(confirmed: boolean) {
    await run(async () => {
      const started = await coreDispatch<{ run: number }>('selection.start', { source_id: sourceId, videoKind, confirmed });
      setCurrent(started.run); await loadDetail(started.run);
    });
  }
  async function redoNow(windows: number[] | undefined, confirmed: boolean) {
    if (current === null) return;
    await run(async () => { await coreDispatch(windows ? 'selection.redo' : 'selection.resume', { run: current, ...(windows ? { windows } : {}), confirmed }); await loadDetail(current); });
  }
  function begin() { if (preview?.paid) setPending({ kind: 'start' }); else void startNow(false); }
  async function askRedo(windows?: number[]) {
    if (current === null) return;
    try {
      const p = await coreDispatch<Preview>('selection.estimate', { run: current, ...(windows ? { windows } : {}) });
      if (p.paid) { setRedoPaid(p); setPending({ kind: 'redo', windows }); } else await redoNow(windows, false);
    } catch (e) { setError(message(e)); }
  }
  async function cancel() { if (current !== null) await run(async () => { await coreDispatch('selection.cancel', { run: current }); await loadDetail(current); }); }

  const head = detail?.run;
  const running = head?.state === 'running';
  const startDisabled = busy || running || preview === null;
  const disabledReason = blocked
    ? blocked
    : busy
      ? t.busyReason
      : running
        ? t.runningReason
        : preview === null
          ? t.estimating
          : '';
  const reasonId = `selection-disabled-reason-${sourceId}`;
  const needsRedo = detail?.windows.some(w => w.code !== null) ?? false;
  const shown = (detail?.candidates ?? []).filter(c => c.total >= minScore);
  const dialogEstimate = pending?.kind === 'start' ? preview?.estimate : redoPaid?.estimate;
  const weights = head?.weights ?? preview?.weights ?? [];
  const runKind = kindOf(head?.videoKind);
  return <section aria-label={t.title} className="mt-3 flex w-full flex-col gap-3 text-sm">
    <VideoKindPicker value={videoKind} onChange={setVideoKind} disabled={busy || running} />
    {preview?.weights && <WeightsLine weights={preview.weights} />}
    <div className="flex flex-wrap items-center gap-3">
      <Button ref={focus} variante="primario" disabled={startDisabled} title={disabledReason || undefined} aria-describedby={disabledReason ? reasonId : undefined} onClick={begin}>{t.start}</Button>
      {preview && <span className="text-fg-2">{fill(t.estimate, { windows: preview.estimate.windows })} · {costText(preview.estimate)}{preview.plan?.state === 'reduced' ? ` · ${t.reduced}` : ''}</span>}
      {!blocked && disabledReason && <span id={reasonId} className="text-fg-2">{disabledReason}</span>}
      {running && <Button disabled={busy} onClick={() => void cancel()}>{t.cancel}</Button>}
      {chat?.canFetch && chat.state !== 'available' && <Button disabled={fetching} onClick={() => void fetchChat()}>{fetching ? t.chatFetching : t.chatFetch}</Button>}
      {chat?.state === 'available' && <span className="text-fg-2" data-chat="available">{fill(t.chatAvailable, { peaks: chat.peaks })}</span>}
      {chat?.state === 'absent' && <span className="text-fg-2" data-chat="absent">{t.chatAbsent}</span>}
      {chat?.job?.state === 'failed' && chat.state === 'none' && <span role="alert" className="text-danger">{t.chatFailed}</span>}
      {runs.length > 1 && <label className="flex items-center gap-2">{t.run}<select className="h-8 rounded-md border border-line-strong bg-field px-2" value={current ?? ''} onChange={e => { setDetail(null); setCurrent(Number(e.target.value)); }}>{runs.map(r => <option key={r.id} value={r.id}>#{r.id} · {r.createdAt.slice(0, 16).replace('T', ' ')}</option>)}</select></label>}
    </div>
    {blocked && <p id={reasonId} role="alert" className="rounded-md border border-line bg-warning-subtle p-3 text-fg">{blocked}</p>}
    {head && <div className="flex flex-col gap-2" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <VideoKindBadge kind={runKind} />
        <span>{running ? t.running : head.state === 'completed' ? t.done : t.partial} · {fill(t.windowsDone, { done: head.counts.completed, total: head.counts.windows })}</span>
        <progress className="w-40 max-w-full" max={head.counts.windows} value={head.counts.completed + head.counts.failed} aria-label={t.progress} />
        {!running && needsRedo && <Button disabled={busy} onClick={() => void askRedo()}>{t.resume}</Button>}
      </div>
      {head.budgetPause && <p role="note" className="rounded-md border border-line bg-warning-subtle p-3">{t.paused}</p>}
      <ul className="flex flex-col gap-1 text-fg-2">
        {detail.windows.map(w => <li key={w.index} className="flex flex-wrap items-center gap-2" data-window={w.index}>
          <span>{fill(t.window, { n: w.index + 1 })} ({clock(w.startUs)}–{clock(w.endUs)}): {t.state[w.state as keyof typeof t.state] ?? w.state}{w.code ? ` · ${t.code[w.code as keyof typeof t.code] ?? t.code.default}` : ''}</span>
          {w.code && w.code !== 'cancelled' || w.state === 'cancelled' || w.state === 'unscheduled' ? <Button tamanho="sm" disabled={busy || running} aria-label={`${t.redo} ${w.index + 1}`} onClick={() => void askRedo([w.index])}>{t.redo}</Button> : null}
        </li>)}
      </ul>
      {!running && <p className="text-fg-2">{fill(t.summary, { kept: head.counts.kept, merged: head.counts.merged, discarded: head.counts.discarded })}</p>}
      {!running && head.summary?.energy && <p className="text-fg-2" data-energy={head.summary.energy.measured ? 'measured' : 'missing'}>{head.summary.energy.measured ? fill(t.energyOn, { high: head.summary.energy.high ?? 0, peak: head.summary.energy.peak ?? 0 }) : t.energyOff}</p>}
      {!running && head.summary?.chat && <p className="text-fg-2" data-chat-summary={head.summary.chat.available ? 'on' : 'off'}>{head.summary.chat.available ? fill(t.chatOn, { peaks: head.summary.chat.peaks ?? 0 }) : t.chatOff}</p>}
      <label className="flex items-center gap-2">{t.minScore}<input type="number" min={0} max={10} step={0.5} value={minScore} onChange={e => setMinScore(Math.min(10, Math.max(0, Number(e.target.value) || 0)))} className="h-8 w-20 rounded-md border border-line-strong bg-field px-2" /></label>
      {!running && detail.candidates.length === 0 && head.state === 'completed' && <p>{t.none}</p>}
      {detail.candidates.length > 0 && shown.length === 0 && <p>{t.noneFilter}</p>}
      {current !== null && shown.length > 0 && <CandidateReview sourceId={sourceId} run={current} videoKind={runKind} candidates={shown} weights={weights} onOpenPreview={(_, startUs, endUs) => openCutPreview({ sourceId, startUs, endUs })} onOpenEditor={(candidate, startId, endId) => openEditor({ source_id: sourceId, start_id: startId, end_id: endId, candidate_id: candidate })}
        windowStates={Object.fromEntries(detail.windows.map(w => [w.index, w.state]))} onRedoStarted={() => void loadDetail(current).catch(() => setError(t.error))} />}
    </div>}
    {runs.length > 0 && <BatchExport scope="source" sourceId={sourceId} />}
    {error && <p role="alert" className="text-danger">{error}</p>}
    <ConfirmDialog open={pending !== null} onOpenChange={open => { if (!open) setPending(null); }} title={t.confirmTitle}
      description={dialogEstimate ? fill(pending?.kind === 'redo' ? t.confirmRedo : t.confirmBody, { cost: costText(dialogEstimate) }) : ''}
      cancelLabel={t.dismiss} confirmLabel={pending?.kind === 'redo' ? t.confirmRedoLabel : t.confirm} finalFocus={focus}
      onConfirm={() => { const next = pending; setPending(null); if (next?.kind === 'start') void startNow(true); else if (next) void redoNow(next.windows, true); }} />
  </section>;
}
