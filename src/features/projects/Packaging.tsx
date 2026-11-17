import { useCallback, useContext, useEffect, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { LanguageContext, useText, type Language } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AiDisclosureNote } from '@/features/guardrails/GuardrailsPanel';
import { fill } from './selectionFormat';

type Limits = { titleChars: number; descriptionBytes: number; tagsChars: number; tags: number; tagChars: number; hashtags: number };
type Current = { generation: number; language: string; edited: boolean; title: string; description: string; tags: string[]; hashtags: string[]; fullDescription: string };
type Job = { id: number; state: string | null; code: string | null; violations: string[] };
type Doc = {
  detectedLanguage: string | null; languageRequired: boolean; current: Current | null; job: Job | null; limits: Limits;
  credit: { text: string | null; warning: string | null };
  generations: { generation: number; taskVersion: number; promptSha256: string; profile: string; edits: unknown[] }[];
};
type Estimate = { paid: boolean; language: string; estimate: { kind: string; minMicroUsd: number | null; maxMicroUsd: number | null } };

const texts = {
  'pt-BR': {
    title: 'Empacotamento', generate: 'Gerar título, descrição e tags', regenerate: 'Gerar de novo', generating: 'Gerando…', save: 'Salvar edições',
    language: 'Idioma do empacotamento', languageHint: 'O idioma deste Corte não é claro. Escolha PT-BR ou EN.',
    fTitle: 'Título', fDescription: 'Descrição', fTags: 'Tags (separadas por vírgula)', fHashtags: 'Hashtags (separadas por espaço)',
    counter: '{used}/{max} {unit}', chars: 'caracteres', bytes: 'bytes', tags: 'tags',
    credit: 'Crédito da Fonte (montado pelo Clipes, não editável)', noPermission: 'Esta Fonte não tem Permissão registrada: não há crédito na descrição. Registre a Permissão na Fonte para incluir o crédito.',
    version: 'Versão {n} de {total} · Tarefa v{task} · perfil {profile}', edited: 'com suas edições', saved: 'Edições salvas.',
    free: 'sem custo (modelo local)', unknown: 'custo desconhecido', quota: 'consome a cota do plano', range: 'entre US$ {min} e US$ {max}',
    confirmTitle: 'Usar o Provedor pago?', confirmBody: 'O texto do Corte vai ao Provedor escolhido. Custo estimado: {cost}.', cancel: 'Cancelar', confirm: 'Confirmar e gerar',
    failed: 'Não foi possível gerar: {reason} Você pode gerar de novo ou escrever os campos à mão.',
    reasons: {
      language_mismatch: 'o texto não veio no idioma pedido.', verification_failed: 'o texto passou de um limite ou tinha formato inválido.', cancelled: 'a geração foi cancelada.', timeout_uncertain: 'o resultado ficou incerto.', default: 'o Provedor não devolveu um texto válido.',
    } as Record<string, string>,
    errors: { not_approved: 'Aprove o candidato antes de gerar.', language_required: 'Escolha o idioma: PT-BR ou EN.', generation_in_progress: 'Já há uma geração em andamento.', local_only_violation: 'O modo "somente local" impede este Provedor.', edit_invalid: 'A edição passa de um limite do YouTube ou tem formato inválido.', default: 'Não foi possível concluir a operação.' } as Record<string, string>,
  },
  en: {
    title: 'Packaging', generate: 'Generate title, description and tags', regenerate: 'Generate again', generating: 'Generating…', save: 'Save edits',
    language: 'Packaging language', languageHint: 'This Clip’s language is unclear. Pick PT-BR or EN.',
    fTitle: 'Title', fDescription: 'Description', fTags: 'Tags (comma separated)', fHashtags: 'Hashtags (space separated)',
    counter: '{used}/{max} {unit}', chars: 'characters', bytes: 'bytes', tags: 'tags',
    credit: 'Source credit (built by Clipes, not editable)', noPermission: 'This Source has no recorded Permission: there is no credit in the description. Record the Permission on the Source to include the credit.',
    version: 'Version {n} of {total} · Task v{task} · profile {profile}', edited: 'with your edits', saved: 'Edits saved.',
    free: 'free (local model)', unknown: 'unknown cost', quota: 'uses the plan quota', range: 'between US$ {min} and US$ {max}',
    confirmTitle: 'Use the paid Provider?', confirmBody: 'The Clip text is sent to the chosen Provider. Estimated cost: {cost}.', cancel: 'Cancel', confirm: 'Confirm and generate',
    failed: 'Could not generate: {reason} You can generate again or write the fields by hand.',
    reasons: {
      language_mismatch: 'the text was not in the requested language.', verification_failed: 'the text went over a limit or had an invalid format.', cancelled: 'generation was cancelled.', timeout_uncertain: 'the result is uncertain.', default: 'the Provider did not return valid text.',
    } as Record<string, string>,
    errors: { not_approved: 'Approve the candidate before generating.', language_required: 'Pick the language: PT-BR or EN.', generation_in_progress: 'A generation is already running.', local_only_violation: '“Local only” blocks this Provider.', edit_invalid: 'The edit goes over a YouTube limit or has an invalid format.', default: 'Could not complete the operation.' } as Record<string, string>,
  },
};

const usd = (micro: number) => (micro / 1_000_000).toFixed(4);
const codeOf = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '');
const tagsChars = (tags: string[]) => tags.reduce((n, t) => n + [...t].length + (t.includes(' ') ? 2 : 0), 0) + Math.max(0, tags.length - 1);
const splitTags = (text: string) => text.split(',').map(t => t.trim()).filter(Boolean);
const splitHashtags = (text: string) => text.split(/\s+/).filter(Boolean);
const bytesOf = (text: string) => new TextEncoder().encode(text).length;

/** Empacotamento do Corte aprovado (#68): gerar, ver e editar título, descrição, tags e hashtags. */
export function Packaging({ candidate }: { candidate: number }) {
  const t = useText(texts);
  const uiLanguage: Language = useContext(LanguageContext);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [language, setLanguage] = useState<string>(uiLanguage);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<Estimate | null>(null);

  const apply = useCallback((d: Doc) => {
    setDoc(d);
    if (d.current) { setTitle(d.current.title); setDescription(d.current.description); setTags(d.current.tags.join(', ')); setHashtags(d.current.hashtags.join(' ')); }
  }, []);
  const generating = doc?.job?.state === 'queued' || doc?.job?.state === 'running';
  useEffect(() => {
    let active = true;
    coreDispatch<Doc>('packaging.get', { candidate }).then(d => { if (active) apply(d); }).catch(() => { if (active) setError(t.errors.default); });
    return () => { active = false; };
  }, [candidate, apply, t.errors.default]);
  useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(() => { coreDispatch<Doc>('packaging.get', { candidate }).then(apply).catch(() => {}); }, 800);
    return () => window.clearInterval(timer);
  }, [generating, candidate, apply]);

  const cost = (e: Estimate['estimate']) => e.kind === 'zero' ? t.free : e.kind === 'plan_quota' ? t.quota : e.kind === 'usd' && e.minMicroUsd !== null && e.maxMicroUsd !== null ? fill(t.range, { min: usd(e.minMicroUsd), max: usd(e.maxMicroUsd) }) : t.unknown;
  const args = (extra: object = {}) => ({ candidate, ...(doc?.languageRequired ? { language } : {}), ...extra });

  async function start(confirmed: boolean) {
    setError(''); setNote('');
    try { await coreDispatch('packaging.generate', args(confirmed ? { confirmed: true } : {})); apply(await coreDispatch<Doc>('packaging.get', { candidate })); }
    catch (e) { setError(t.errors[codeOf(e)] ?? t.errors.default); }
  }
  async function generate() {
    setError(''); setNote('');
    try {
      const e = await coreDispatch<Estimate>('packaging.estimate', args());
      if (e.paid) setPending(e); else await start(false);
    } catch (e) { setError(t.errors[codeOf(e)] ?? t.errors.default); }
  }
  async function save() {
    setError(''); setNote('');
    try { apply(await coreDispatch<Doc>('packaging.edit', { candidate, title, description, tags: splitTags(tags), hashtags: splitHashtags(hashtags) })); setNote(t.saved); }
    catch (e) { setError(t.errors[codeOf(e)] ?? t.errors.default); }
  }

  if (!doc) return error ? <p role="alert" className="text-danger">{error}</p> : null;
  const limits = doc.limits;
  const creditBytes = doc.credit.text ? bytesOf(doc.credit.text) + 2 : 0;
  const count = (used: number, max: number, unit: string) => {
    const over = used > max;
    return <span data-over={over} className={over ? 'text-danger' : 'text-fg-2'}>{fill(t.counter, { used, max, unit })}</span>;
  };
  const job = doc.job;
  const failedJob = job && (job.state === 'failed' || job.state === 'uncertain' || job.state === 'cancelled');
  const reason = job ? (job.violations.includes('language_mismatch') ? t.reasons.language_mismatch : t.reasons[job.code ?? ''] ?? t.reasons.default) : '';
  const field = 'foco w-full rounded-md border border-line-strong bg-field px-3 py-1.5 text-fg';

  return <section aria-label={t.title} data-packaging className="flex flex-col gap-2 rounded-md border border-line p-3">
    <h3 className="font-medium">{t.title}</h3>
    {doc.languageRequired && <label className="flex flex-col gap-1 text-sm">{t.language}
      <select className="foco h-8 w-40 rounded-md border border-line-strong bg-field px-2 text-fg" value={language} onChange={e => setLanguage(e.target.value)}>
        <option value="pt-BR">PT-BR</option><option value="en">EN</option>
      </select>
      <span className="text-xs text-fg-2">{t.languageHint}</span>
    </label>}
    <div className="flex flex-wrap items-center gap-2">
      <Button variante={doc.current ? 'secundario' : 'primario'} tamanho="sm" disabled={generating} carregando={generating} onClick={() => void generate()}>{generating ? t.generating : doc.current ? t.regenerate : t.generate}</Button>
      {doc.current && <span className="text-xs text-fg-2" data-packaging-version>{fill(t.version, { n: doc.current.generation, total: doc.generations.length, task: doc.generations[doc.current.generation - 1]?.taskVersion ?? '', profile: doc.generations[doc.current.generation - 1]?.profile || '—' })}{doc.current.edited ? ` · ${t.edited}` : ''}</span>}
    </div>
    {failedJob && <p role="alert" data-packaging-failed className="text-danger">{fill(t.failed, { reason })}</p>}
    {doc.current && <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm"><span className="flex justify-between"><span>{t.fTitle}</span>{count([...title.trim()].length, limits.titleChars, t.chars)}</span>
        <input className={field} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-sm"><span className="flex justify-between"><span>{t.fDescription}</span>{count(bytesOf(description) + creditBytes, limits.descriptionBytes, t.bytes)}</span>
        <textarea className={field} rows={5} value={description} onChange={e => setDescription(e.target.value)} /></label>
      {doc.credit.text && <div data-credit className="flex flex-col gap-1 text-sm"><span className="font-medium">{t.credit}</span><pre className="whitespace-pre-wrap rounded-md border border-line bg-field p-2 text-fg-2">{doc.credit.text}</pre></div>}
      {doc.credit.warning && <p data-credit-warning role="status" className="text-sm text-fg-2">{t.noPermission}</p>}
      <label className="flex flex-col gap-1 text-sm"><span className="flex justify-between"><span>{t.fTags}</span>{count(tagsChars(splitTags(tags)), limits.tagsChars, t.chars)}</span>
        <input className={field} value={tags} onChange={e => setTags(e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-sm"><span className="flex justify-between"><span>{t.fHashtags}</span>{count(splitHashtags(hashtags).length, limits.hashtags, '#')}</span>
        <input className={field} value={hashtags} onChange={e => setHashtags(e.target.value)} /></label>
      <div className="flex items-center gap-2"><Button variante="primario" tamanho="sm" onClick={() => void save()}>{t.save}</Button>{note && <span role="status" className="text-xs text-fg-2">{note}</span>}</div>
    </div>}
    <AiDisclosureNote />
    {error && <p role="alert" className="text-danger">{error}</p>}
    <ConfirmDialog open={pending !== null} onOpenChange={open => { if (!open) setPending(null); }} title={t.confirmTitle}
      description={pending ? fill(t.confirmBody, { cost: cost(pending.estimate) }) : ''} cancelLabel={t.cancel} confirmLabel={t.confirm}
      onConfirm={() => { setPending(null); void start(true); }} />
  </section>;
}
