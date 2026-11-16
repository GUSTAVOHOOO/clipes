import { useCallback, useContext, useEffect, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { LanguageContext, useText, type Language } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { fill } from './selectionFormat';
import { Angles, type Angle } from './Angles';

type Job = { id: number; state: string | null; code: string | null; violations: string[] };
type Block = { id: number; position: number; title: string; narration: string | null; status: 'pendente' | 'aprovado'; stale: boolean; edited: boolean; job: Job | null };
type Doc = {
  angle: Angle | null;
  languageRequired: boolean; busy: boolean; narrationAllowed: boolean; job: Job | null;
  current: { generation: number; blocks: Block[]; totalChars: number; pending: number; approved: number; complete: boolean } | null;
  limits: { narrationChars: number; scriptChars: number };
  generations: unknown[];
};
type Estimate = { paid: boolean; estimate: { kind: string; minMicroUsd: number | null; maxMicroUsd: number | null } };
type Ask = { block: number | null; estimate: Estimate['estimate'] };

const texts = {
  'pt-BR': {
    title: 'Roteiro da Narração', generate: 'Sugerir Roteiro', regenerateAll: 'Sugerir de novo', generating: 'Gerando…',
    language: 'Idioma do Roteiro', languageHint: 'O idioma deste Corte não é claro. Escolha PT-BR ou EN.',
    remaining: 'Faltam {n} de {total} blocos para aprovar.', allApproved: 'Todos os blocos aprovados: a Narração está liberada.', locked: 'A Narração só é liberada com todos os blocos aprovados.',
    block: 'Bloco {n}', pending: 'Pendente', approved: 'Aprovado', stale: 'desatualizado (ângulo mudou)', edit: 'Salvar edição', approve: 'Aprovar bloco', regenerate: 'Gerar bloco de novo', text: 'Texto do bloco {n}',
    counter: '{used}/{max} caracteres', total: 'Total do Roteiro: {used}/{max} caracteres', edited: 'com sua edição', saved: 'Edição salva.', noText: 'Este bloco ainda não tem texto.',
    free: 'sem custo (modelo local)', unknown: 'custo desconhecido', quota: 'consome a cota do plano', range: 'entre US$ {min} e US$ {max}',
    confirmTitle: 'Usar o Provedor pago?', confirmBody: 'O texto do Corte vai ao Provedor escolhido. Custo estimado: {cost}.', cancel: 'Cancelar', confirm: 'Confirmar e gerar',
    failed: 'Não foi possível gerar: {reason}',
    reasons: { verification_failed: 'o texto passou de um limite ou tinha formato inválido.', cancelled: 'a geração foi cancelada.', timeout_uncertain: 'o resultado ficou incerto.', default: 'o Provedor não devolveu um texto válido.' } as Record<string, string>,
    errors: { not_approved: 'Aprove o candidato antes de gerar.', language_required: 'Escolha o idioma: PT-BR ou EN.', generation_in_progress: 'Já há uma geração em andamento.', local_only_violation: 'O modo "somente local" impede este Provedor.', edit_invalid: 'A edição passa de um limite do Roteiro ou tem formato inválido.', script_requires_transformed: 'O Roteiro só existe no Vídeo transformado.', default: 'Não foi possível concluir a operação.' } as Record<string, string>,
  },
  en: {
    title: 'Narration script', generate: 'Suggest script', regenerateAll: 'Suggest again', generating: 'Generating…',
    language: 'Script language', languageHint: 'This Clip’s language is unclear. Pick PT-BR or EN.',
    remaining: '{n} of {total} blocks left to approve.', allApproved: 'All blocks approved: the Narration is unlocked.', locked: 'The Narration unlocks only when every block is approved.',
    block: 'Block {n}', pending: 'Pending', approved: 'Approved', stale: 'outdated (angle changed)', edit: 'Save edit', approve: 'Approve block', regenerate: 'Regenerate block', text: 'Text of block {n}',
    counter: '{used}/{max} characters', total: 'Script total: {used}/{max} characters', edited: 'with your edit', saved: 'Edit saved.', noText: 'This block has no text yet.',
    free: 'free (local model)', unknown: 'unknown cost', quota: 'uses the plan quota', range: 'between US$ {min} and US$ {max}',
    confirmTitle: 'Use the paid Provider?', confirmBody: 'The Clip text is sent to the chosen Provider. Estimated cost: {cost}.', cancel: 'Cancel', confirm: 'Confirm and generate',
    failed: 'Could not generate: {reason}',
    reasons: { verification_failed: 'the text went over a limit or had an invalid format.', cancelled: 'generation was cancelled.', timeout_uncertain: 'the result is uncertain.', default: 'the Provider did not return valid text.' } as Record<string, string>,
    errors: { not_approved: 'Approve the candidate before generating.', language_required: 'Pick the language: PT-BR or EN.', generation_in_progress: 'A generation is already running.', local_only_violation: '“Local only” blocks this Provider.', edit_invalid: 'The edit goes over a script limit or has an invalid format.', script_requires_transformed: 'The script exists only for Transformed Videos.', default: 'Could not complete the operation.' } as Record<string, string>,
  },
};

const usd = (micro: number) => (micro / 1_000_000).toFixed(4);
const codeOf = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '');

/** Roteiro do Corte aprovado do Vídeo transformado (#73): editar, aprovar e regenerar bloco a bloco. */
export function Script({ candidate }: { candidate: number }) {
  const t = useText(texts);
  const uiLanguage: Language = useContext(LanguageContext);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [language, setLanguage] = useState<string>(uiLanguage);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [ask, setAsk] = useState<Ask | null>(null);

  useEffect(() => {
    let active = true;
    coreDispatch<Doc>('script.get', { candidate }).then(d => { if (active) setDoc(d); }).catch(() => { if (active) setError(t.errors.default); });
    return () => { active = false; };
  }, [candidate, t.errors.default]);
  const busy = doc?.busy === true;
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => { coreDispatch<Doc>('script.get', { candidate }).then(setDoc).catch(() => {}); }, 800);
    return () => window.clearInterval(timer);
  }, [busy, candidate]);

  const cost = (e: Estimate['estimate']) => e.kind === 'zero' ? t.free : e.kind === 'plan_quota' ? t.quota : e.kind === 'usd' && e.minMicroUsd !== null && e.maxMicroUsd !== null ? fill(t.range, { min: usd(e.minMicroUsd), max: usd(e.maxMicroUsd) }) : t.unknown;
  const fail = (e: unknown) => setError(t.errors[codeOf(e)] ?? t.errors.default);
  const base = useCallback(() => ({ candidate, ...(doc?.languageRequired ? { language } : {}) }), [candidate, doc?.languageRequired, language]);

  async function run(block: number | null, confirmed: boolean) {
    setError(''); setNote('');
    try {
      await coreDispatch(block === null ? 'script.generate' : 'script.regenerate', { ...base(), ...(block !== null ? { block } : {}), ...(confirmed ? { confirmed: true } : {}) });
      setDoc(await coreDispatch<Doc>('script.get', { candidate }));
    } catch (e) { fail(e); }
  }
  async function start(block: number | null) {
    setError(''); setNote('');
    try {
      const e = await coreDispatch<Estimate>('script.estimate', { ...base(), ...(block !== null ? { block } : {}) });
      if (e.paid) setAsk({ block, estimate: e.estimate }); else await run(block, false);
    } catch (e) { fail(e); }
  }
  async function act(name: 'script.edit' | 'script.approve', block: number, extra: object = {}) {
    setError(''); setNote('');
    try { setDoc(await coreDispatch<Doc>(name, { candidate, block, ...extra })); if (name === 'script.edit') setNote(t.saved); }
    catch (e) { fail(e); }
  }

  if (!doc) return error ? <p role="alert" className="text-danger">{error}</p> : null;
  const cur = doc.current;
  const job = doc.job;
  const failedJob = job && (job.state === 'failed' || job.state === 'uncertain' || job.state === 'cancelled');
  const reason = job ? t.reasons[job.code ?? ''] ?? t.reasons.default : '';

  return <section aria-label={t.title} data-script className="flex flex-col gap-2 rounded-md border border-line p-3">
    <h3 className="font-medium">{t.title}</h3>
    {doc.languageRequired && <label className="flex flex-col gap-1 text-sm">{t.language}
      <select className="foco h-8 w-40 rounded-md border border-line-strong bg-field px-2 text-fg" value={language} onChange={e => setLanguage(e.target.value)}>
        <option value="pt-BR">PT-BR</option><option value="en">EN</option>
      </select>
      <span className="text-xs text-fg-2">{t.languageHint}</span>
    </label>}
    <Angles key={candidate} candidate={candidate} language={language} selected={doc.angle} disabled={busy} onChanged={async () => { setDoc(await coreDispatch<Doc>('script.get', { candidate })); }} />
    <div className="flex flex-wrap items-center gap-2">
      <Button variante={cur ? 'secundario' : 'primario'} tamanho="sm" disabled={busy || !doc.angle} carregando={busy} onClick={() => void start(null)}>{busy ? t.generating : cur ? t.regenerateAll : t.generate}</Button>
      {cur && <span role="status" data-script-remaining data-pending={cur.pending} className="text-sm text-fg-2">{cur.pending === 0 ? t.allApproved : fill(t.remaining, { n: cur.pending, total: cur.blocks.length })}</span>}
    </div>
    {cur && cur.pending > 0 && <p className="text-xs text-fg-2">{t.locked}</p>}
    {failedJob && <p role="alert" data-script-failed className="text-danger">{fill(t.failed, { reason })}</p>}
    {cur && <ol className="flex flex-col gap-2">
      {cur.blocks.map(b => <BlockRow key={b.id} block={b} t={t} max={doc.limits.narrationChars} disabled={busy}
        onSave={text => void act('script.edit', b.id, { narration: text })} onApprove={() => void act('script.approve', b.id)} onRegenerate={() => void start(b.id)} />)}
    </ol>}
    {cur && <p className="text-xs text-fg-2">{fill(t.total, { used: cur.totalChars, max: doc.limits.scriptChars })}{note && <span role="status" className="ml-2">{note}</span>}</p>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    <ConfirmDialog open={ask !== null} onOpenChange={open => { if (!open) setAsk(null); }} title={t.confirmTitle}
      description={ask ? fill(t.confirmBody, { cost: cost(ask.estimate) }) : ''} cancelLabel={t.cancel} confirmLabel={t.confirm}
      onConfirm={() => { const block = ask?.block ?? null; setAsk(null); void run(block, true); }} />
  </section>;
}

function BlockRow({ block, t, max, disabled, onSave, onApprove, onRegenerate }: { block: Block; t: (typeof texts)['pt-BR']; max: number; disabled: boolean; onSave: (text: string) => void; onApprove: () => void; onRegenerate: () => void }) {
  const saved = block.narration ?? '';
  const [text, setText] = useState(saved);
  useEffect(() => { setText(saved); }, [saved]);
  const dirty = text.trim() !== saved;
  const busy = disabled || block.job?.state === 'queued' || block.job?.state === 'running';
  const used = [...text.trim()].length;
  const over = used > max;
  const approved = block.status === 'aprovado';
  return <li data-script-block={block.id} data-status={block.status} className="flex flex-col gap-1 rounded-md border border-line p-2">
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{fill(t.block, { n: block.position })} · {block.title}</span>
      <span data-script-status className={approved ? 'text-fg' : 'text-fg-2'}>{approved ? t.approved : t.pending}</span>
      {block.stale && <span className="text-xs text-fg-2">{t.stale}</span>}
      {block.edited && <span className="text-xs text-fg-2">{t.edited}</span>}
    </div>
    {block.narration === null ? <p className="text-sm text-fg-2">{t.noText}</p> : <div className="flex flex-col gap-1 text-sm">
      <textarea aria-label={fill(t.text, { n: block.position })} className="foco w-full rounded-md border border-line-strong bg-field px-3 py-1.5 text-fg" rows={3} value={text} onChange={e => setText(e.target.value)} />
      <span data-over={over} className={over ? 'text-xs text-danger' : 'text-xs text-fg-2'}>{fill(t.counter, { used, max })}</span>
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      <Button tamanho="sm" disabled={busy || !dirty || block.narration === null} onClick={() => onSave(text)}>{t.edit}</Button>
      <Button variante="primario" tamanho="sm" disabled={busy || approved || dirty || block.narration === null} onClick={onApprove}>{t.approve}</Button>
      <Button tamanho="sm" disabled={busy} onClick={onRegenerate}>{t.regenerate}</Button>
    </div>
  </li>;
}
