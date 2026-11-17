import { useCallback, useEffect, useRef, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { isTauri } from '@tauri-apps/api/core';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { fill } from './selectionFormat';
import { openCutPreview, previewSeekEvent, previewTimeEvent, type PreviewTimeEvent } from './CutPreview';

type Choice = { id: number; instantUs: number; origin: 'provider' | 'user'; suggestionId: number | null; createdAt: string; why?: string | null };
type Suggestion = { id: number; sentenceId: number; instantUs: number; why: string; taskVersion: number; profile: string };
type Job = { id: number; state: string | null; code: string | null; violations: string[] };
type Doc = { source: number; cut: { startUs: number; endUs: number }; current: Choice | null; job: Job | null; suggestions: Suggestion[]; choices: Choice[] };
type Estimate = { paid: boolean; estimate: { kind: string; minMicroUsd: number | null; maxMicroUsd: number | null } };

const texts = {
  'pt-BR': {
    title: 'Capa (thumbnail)', suggest: 'Sugerir momento da capa', suggesting: 'Sugerindo…', again: 'Sugerir de novo',
    hint: 'O Provedor só recebe o texto do Corte e aponta um momento; o quadro é extraído no seu computador.',
    none: 'Nenhum momento escolhido ainda.', current: 'Momento da capa', byProvider: 'sugerido pelo Provedor', byYou: 'escolhido por você', why: 'Motivo',
    openPreview: 'Abrir preview do Corte', seekPreview: 'Ver este momento no preview', useCurrent: 'Usar o instante do preview como capa', useCurrentHint: 'Reproduza ou mova o preview até o quadro desejado.',
    export: 'Salvar capa (PNG)', exporting: 'Salvando…', exported: 'Capa salva.', saveTitle: 'Salvar capa',
    history: 'Histórico de sugestões', suggestionLine: 'Sugestão {n}: {time} · Tarefa v{task}', chosen: 'Escolha registrada.',
    free: 'sem custo (modelo local)', unknown: 'custo desconhecido', quota: 'consome a cota do plano', range: 'entre US$ {min} e US$ {max}',
    confirmTitle: 'Usar o Provedor pago?', confirmBody: 'O texto do Corte vai ao Provedor escolhido. Custo estimado: {cost}.', cancel: 'Cancelar', confirm: 'Confirmar e sugerir',
    failed: 'Não foi possível sugerir: {reason} Você pode tentar de novo ou escolher o quadro pelo preview.',
    reasons: { verification_failed: 'o Provedor apontou um momento fora do Corte ou sem motivo válido.', cancelled: 'a sugestão foi cancelada.', timeout_uncertain: 'o resultado ficou incerto.', default: 'o Provedor não devolveu uma resposta válida.' } as Record<string, string>,
    errors: { not_approved: 'Aprove o candidato antes.', suggestion_in_progress: 'Já há uma sugestão em andamento.', local_only_violation: 'O modo "somente local" impede este Provedor.', instant_out_of_cut: 'O instante precisa estar dentro do Corte.', source_offline: 'A Fonte está offline: reconecte ou relocalize a Fonte para exportar a capa.', source_changed: 'A Fonte foi alterada: verifique a identidade dela antes de exportar.', component_missing: 'Instale o Componente FFmpeg em Componentes.', thumbnail_exists: 'Já existe um arquivo no destino. Escolha outro nome.', thumbnail_destination: 'Escolha uma pasta existente e um nome PNG válido.', no_instant: 'Escolha um momento para a capa antes de exportar.', thumbnail_failed: 'Não foi possível extrair o quadro da capa.', default: 'Não foi possível concluir a operação.' } as Record<string, string>,
  },
  en: {
    title: 'Cover (thumbnail)', suggest: 'Suggest the cover moment', suggesting: 'Suggesting…', again: 'Suggest again',
    hint: 'The Provider only receives the Clip text and points at a moment; the frame is extracted on your computer.',
    none: 'No moment chosen yet.', current: 'Cover moment', byProvider: 'suggested by the Provider', byYou: 'chosen by you', why: 'Reason',
    openPreview: 'Open Clip preview', seekPreview: 'See this moment in the preview', useCurrent: 'Use the preview time as the cover', useCurrentHint: 'Play or move the preview to the frame you want.',
    export: 'Save cover (PNG)', exporting: 'Saving…', exported: 'Cover saved.', saveTitle: 'Save cover',
    history: 'Suggestion history', suggestionLine: 'Suggestion {n}: {time} · Task v{task}', chosen: 'Choice saved.',
    free: 'free (local model)', unknown: 'unknown cost', quota: 'uses the plan quota', range: 'between US$ {min} and US$ {max}',
    confirmTitle: 'Use the paid Provider?', confirmBody: 'The Clip text is sent to the chosen Provider. Estimated cost: {cost}.', cancel: 'Cancel', confirm: 'Confirm and suggest',
    failed: 'Could not suggest: {reason} You can try again or pick the frame in the preview.',
    reasons: { verification_failed: 'the Provider pointed outside the Clip or gave no valid reason.', cancelled: 'the suggestion was cancelled.', timeout_uncertain: 'the result is uncertain.', default: 'the Provider did not return a valid answer.' } as Record<string, string>,
    errors: { not_approved: 'Approve the candidate first.', suggestion_in_progress: 'A suggestion is already running.', local_only_violation: '“Local only” blocks this Provider.', instant_out_of_cut: 'The time must be inside the Clip.', source_offline: 'The Source is offline: reconnect or relocate the Source to export the cover.', source_changed: 'The Source was changed: verify its identity before exporting.', component_missing: 'Install the FFmpeg Component in Components.', thumbnail_exists: 'A file already exists at this destination. Choose another name.', thumbnail_destination: 'Choose an existing folder and a valid PNG name.', no_instant: 'Pick a cover moment before exporting.', thumbnail_failed: 'Could not extract the cover frame.', default: 'Could not complete the operation.' } as Record<string, string>,
  },
};

const usd = (micro: number) => (micro / 1_000_000).toFixed(4);
const codeOf = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '');
function clock(us: number) { const s = Math.max(0, Math.floor(us / 1_000_000)); const h = Math.floor(s / 3600); const m = String(Math.floor(s / 60) % 60).padStart(2, '0'); const ss = String(s % 60).padStart(2, '0'); return h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`; }

/** Capa do Corte aprovado (#74): sugestão do Provedor (só texto), escolha pelo preview e export do quadro em PNG. */
export function Thumbnail({ candidate }: { candidate: number }) {
  const t = useText(texts);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<Estimate | null>(null);
  const [exporting, setExporting] = useState(false);
  const [previewUs, setPreviewUs] = useState<number | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    let active = true;
    coreDispatch<Doc>('thumbnail.get', { candidate }).then(d => { if (active) setDoc(d); }).catch(() => { if (active) setError(t.errors.default); });
    return () => { active = false; };
  }, [candidate, t.errors.default]);
  const running = doc?.job?.state === 'queued' || doc?.job?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => { coreDispatch<Doc>('thumbnail.get', { candidate }).then(d => { if (alive.current) setDoc(d); }).catch(() => {}); }, 800);
    return () => window.clearInterval(timer);
  }, [running, candidate]);
  // O preview do Corte avisa o instante em que está (µs da Fonte).
  const sourceId = doc?.source;
  useEffect(() => {
    const onTime = (event: Event) => { const e = (event as CustomEvent<PreviewTimeEvent>).detail; if (e.source_id === sourceId) setPreviewUs(e.us); };
    window.addEventListener(previewTimeEvent, onTime);
    return () => window.removeEventListener(previewTimeEvent, onTime);
  }, [sourceId]);

  const fail = useCallback((e: unknown) => setError(t.errors[codeOf(e)] ?? t.errors.default), [t.errors]);
  const cost = (e: Estimate['estimate']) => e.kind === 'zero' ? t.free : e.kind === 'plan_quota' ? t.quota : e.kind === 'usd' && e.minMicroUsd !== null && e.maxMicroUsd !== null ? fill(t.range, { min: usd(e.minMicroUsd), max: usd(e.maxMicroUsd) }) : t.unknown;

  async function start(confirmed: boolean) {
    setError(''); setNote('');
    try { await coreDispatch('thumbnail.suggest', { candidate, ...(confirmed ? { confirmed: true } : {}) }); setDoc(await coreDispatch<Doc>('thumbnail.get', { candidate })); }
    catch (e) { fail(e); }
  }
  async function suggest() {
    setError(''); setNote('');
    try {
      const e = await coreDispatch<Estimate>('thumbnail.estimate', { candidate });
      if (e.paid) setPending(e); else await start(false);
    } catch (e) { fail(e); }
  }
  async function useCurrent() {
    if (previewUs === null) return;
    setError(''); setNote('');
    try { setDoc(await coreDispatch<Doc>('thumbnail.choose', { candidate, instant_us: previewUs })); setNote(t.chosen); }
    catch (e) { fail(e); }
  }
  async function exportCover() {
    if (!doc?.current) return;
    setExporting(true); setError(''); setNote('');
    try {
      const mock = import.meta.env.VITE_CORE_MOCK === '1' && !isTauri();
      const chosen = mock ? '/test/exports/capa.png' : await save({ title: t.saveTitle, defaultPath: `capa-${candidate}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] });
      if (!chosen || !alive.current) return;
      const output = /\.png$/i.test(chosen) ? chosen : `${chosen}.png`;
      await coreDispatch('thumbnail.export', { candidate, output });
      if (alive.current) setNote(t.exported);
    } catch (e) { if (alive.current) fail(e); }
    finally { if (alive.current) setExporting(false); }
  }

  if (!doc) return error ? <p role="alert" className="text-danger">{error}</p> : null;
  const job = doc.job;
  const failedJob = job && (job.state === 'failed' || job.state === 'uncertain' || job.state === 'cancelled');
  const reason = job ? t.reasons[job.code ?? ''] ?? t.reasons.default : '';
  const cur = doc.current;
  const curWhy = cur?.why ?? doc.suggestions.find(s => s.id === cur?.suggestionId)?.why;
  const canUse = previewUs !== null && previewUs >= doc.cut.startUs && previewUs <= doc.cut.endUs;

  return <section aria-label={t.title} data-thumbnail className="flex flex-col gap-2 rounded-md border border-line p-3">
    <h3 className="font-medium">{t.title}</h3>
    <p className="text-xs text-fg-2">{t.hint}</p>
    <div className="flex flex-wrap items-center gap-2">
      <Button variante={cur ? 'secundario' : 'primario'} tamanho="sm" disabled={running} carregando={running} onClick={() => void suggest()}>{running ? t.suggesting : cur ? t.again : t.suggest}</Button>
      <Button tamanho="sm" onClick={() => openCutPreview({ sourceId: doc.source, startUs: doc.cut.startUs, endUs: doc.cut.endUs })}>{t.openPreview}</Button>
    </div>
    {failedJob && <p role="alert" data-thumbnail-failed className="text-danger">{fill(t.failed, { reason })}</p>}
    {cur ? <div data-thumbnail-current={cur.instantUs} className="flex flex-col gap-1 text-sm">
      <span><strong>{t.current}:</strong> <span className="font-mono">{clock(cur.instantUs)}</span> · <span className="text-fg-2">{cur.origin === 'provider' ? t.byProvider : t.byYou}</span></span>
      {cur.origin === 'provider' && curWhy && <span className="text-fg-2">{t.why}: {curWhy}</span>}
      <div className="flex flex-wrap items-center gap-2">
        <Button tamanho="sm" onClick={() => window.dispatchEvent(new CustomEvent(previewSeekEvent, { detail: { source_id: doc.source, us: cur.instantUs } }))}>{t.seekPreview}</Button>
      </div>
    </div> : <p className="text-sm text-fg-2">{t.none}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button tamanho="sm" disabled={!canUse} onClick={() => void useCurrent()} title={canUse ? undefined : t.useCurrentHint}>{t.useCurrent}</Button>
      {previewUs !== null && <span className="font-mono text-xs text-fg-2" data-thumbnail-preview-time>{clock(previewUs)}</span>}
      <Button variante="primario" tamanho="sm" disabled={!cur} carregando={exporting} onClick={() => void exportCover()}>{exporting ? t.exporting : t.export}</Button>
      {note && <span role="status" className="text-xs text-fg-2">{note}</span>}
    </div>
    {doc.suggestions.length > 0 && <details className="text-sm"><summary className="cursor-pointer">{t.history}</summary>
      <ol className="mt-1 flex flex-col gap-1 text-fg-2">{doc.suggestions.map((s, i) => <li key={s.id}>{fill(t.suggestionLine, { n: i + 1, time: clock(s.instantUs), task: s.taskVersion })} · {s.why}</li>)}</ol>
    </details>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    <ConfirmDialog open={pending !== null} onOpenChange={open => { if (!open) setPending(null); }} title={t.confirmTitle}
      description={pending ? fill(t.confirmBody, { cost: cost(pending.estimate) }) : ''} cancelLabel={t.cancel} confirmLabel={t.confirm}
      onConfirm={() => { setPending(null); void start(true); }} />
  </section>;
}
