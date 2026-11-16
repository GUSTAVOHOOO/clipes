import { useEffect, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export type Angle = { name: string; promise: string; audience?: string; sentence_ids?: number[] };
type Doc = { angles: Angle[]; generation: number | null; busy: boolean; job: { state: string; code: string | null } | null };
type Estimate = { paid: boolean; estimate: { kind: string; minMicroUsd: number | null; maxMicroUsd: number | null } };
type Choice = { angle: Angle } | { generation: number; index: number };
type Ask = { kind: 'choose'; choice: Choice } | { kind: 'generate'; estimate: Estimate['estimate'] };

const texts = {
  'pt-BR': {
    title: 'Ângulo do vídeo', hint: 'Escolha a promessa que o Roteiro vai cumprir ou escreva a sua.',
    generate: 'Sugerir ângulos', regenerate: 'Sugerir novos ângulos', generating: 'Gerando ângulos…', selected: 'Ângulo escolhido', choose: 'Escolher',
    own: 'Seu próprio ângulo', name: 'Nome do ângulo', promise: 'Promessa em uma frase', audience: 'Para quem é (opcional)', refs: 'IDs de Frases (opcional)', refsHint: 'Separe os IDs por vírgulas; use somente Frases deste Corte.', use: 'Usar meu ângulo',
    change: 'Trocar o ângulo?', changeBody: 'Os textos do Roteiro serão preservados. Todos os blocos ficarão desatualizados até você revisar e aprovar, editar ou gerar de novo.', changeConfirm: 'Trocar ângulo',
    paid: 'Usar o Provedor pago?', paidBody: 'O texto do Corte vai ao Provedor escolhido. Custo estimado: ', confirm: 'Confirmar e gerar', cancel: 'Cancelar',
    zero: 'sem custo (modelo local)', quota: 'consome a cota do plano', unknown: 'custo desconhecido', between: 'entre US$ ', and: ' e US$ ',
    failed: 'O Provedor não devolveu ângulos válidos e diferentes. Você pode tentar de novo ou escrever o seu.',
    errors: { angle_invalid: 'Confira os limites dos campos e os IDs das Frases do Corte.', local_only_violation: 'O modo “somente local” impede este Provedor.', generation_in_progress: 'Aguarde a geração terminar antes de trocar o ângulo.', default: 'Não foi possível concluir a operação.' } as Record<string, string>,
  },
  en: {
    title: 'Video angle', hint: 'Choose the promise the script will deliver, or write your own.',
    generate: 'Suggest angles', regenerate: 'Suggest new angles', generating: 'Generating angles…', selected: 'Chosen angle', choose: 'Choose',
    own: 'Your own angle', name: 'Angle name', promise: 'Promise in one sentence', audience: 'Audience (optional)', refs: 'Sentence IDs (optional)', refsHint: 'Separate IDs with commas; use only Sentences from this Clip.', use: 'Use my angle',
    change: 'Change the angle?', changeBody: 'The script text will be preserved. Every block will be outdated until you review and approve, edit or regenerate it.', changeConfirm: 'Change angle',
    paid: 'Use the paid Provider?', paidBody: 'The Clip text is sent to the chosen Provider. Estimated cost: ', confirm: 'Confirm and generate', cancel: 'Cancel',
    zero: 'free (local model)', quota: 'uses the plan quota', unknown: 'unknown cost', between: 'between US$ ', and: ' and US$ ',
    failed: 'The Provider did not return valid, distinct angles. Try again or write your own.',
    errors: { angle_invalid: 'Check field limits and the Sentence IDs in this Clip.', local_only_violation: '“Local only” blocks this Provider.', generation_in_progress: 'Wait for generation to finish before changing the angle.', default: 'Could not complete the operation.' } as Record<string, string>,
  },
};
const code = (e: unknown) => typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '';

export function Angles({ candidate, language, selected, disabled, onChanged }: { candidate: number; language: string; selected: Angle | null; disabled: boolean; onChanged: () => Promise<void> }) {
  const t = useText(texts);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<Ask | null>(null);
  const [name, setName] = useState('');
  const [promise, setPromise] = useState('');
  const [audience, setAudience] = useState('');
  const [refs, setRefs] = useState('');
  const [sending, setSending] = useState(false);
  const busy = doc?.busy === true;
  const blocked = disabled || sending;
  useEffect(() => {
    let active = true;
    coreDispatch<Doc>('angles.get', { candidate }).then(d => { if (active) setDoc(d); }).catch(() => { if (active) setError(t.errors.default); });
    return () => { active = false; };
  }, [candidate, t.errors.default]);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => { coreDispatch<Doc>('angles.get', { candidate }).then(setDoc).catch(() => {}); }, 800);
    return () => window.clearInterval(timer);
  }, [busy, candidate]);

  const fail = (e: unknown) => setError(t.errors[code(e)] ?? t.errors.default);
  async function generate(confirmed = false) {
    setSending(true); setError('');
    try {
      await coreDispatch('angles.generate', { candidate, language, confirmed });
      setDoc(await coreDispatch<Doc>('angles.get', { candidate }));
    } catch (e) { fail(e); } finally { setSending(false); }
  }
  async function start() {
    setError(''); setSending(true);
    try {
      const estimate = await coreDispatch<Estimate>('angles.estimate', { candidate, language });
      if (estimate.paid) setAsk({ kind: 'generate', estimate: estimate.estimate }); else await generate();
    } catch (e) { fail(e); } finally { setSending(false); }
  }
  async function choose(choice: Choice, confirmed = false) {
    setError(''); setSending(true);
    try {
      await coreDispatch('angles.choose', { candidate, ...choice, confirmed });
      await onChanged();
    } catch (e) { if (code(e) === 'angle_change_confirmation') setAsk({ kind: 'choose', choice }); else fail(e); }
    finally { setSending(false); }
  }
  const cost = (e: Estimate['estimate']) => e.kind === 'zero' ? t.zero : e.kind === 'plan_quota' ? t.quota : e.kind === 'usd' && e.minMicroUsd !== null && e.maxMicroUsd !== null ? t.between + (e.minMicroUsd / 1e6).toFixed(4) + t.and + (e.maxMicroUsd / 1e6).toFixed(4) : t.unknown;
  const field = 'foco w-full rounded-md border border-line-strong bg-field px-3 py-1.5 text-fg';
  const failed = doc?.job && ['failed', 'uncertain', 'cancelled'].includes(doc.job.state);
  return <section data-angles aria-label={t.title} className="flex flex-col gap-2 border-b border-line pb-3">
    <h4 className="font-medium">{t.title}</h4>
    <p className="text-sm text-fg-2">{t.hint}</p>
    {selected && <div role="status" className="text-sm"><strong>{t.selected}: {selected.name}</strong><p>{selected.promise}</p>{selected.audience && <p className="text-fg-2">{selected.audience}</p>}</div>}
    <Button tamanho="sm" disabled={blocked || busy || !doc} carregando={busy} onClick={() => void start()}>{busy ? t.generating : doc?.angles.length ? t.regenerate : t.generate}</Button>
    {failed && <p role="alert" className="text-sm text-danger">{t.failed}</p>}
    {doc && doc.angles.length > 0 && <ul className="divide-y divide-line">
      {doc.angles.map((a, index) => <li key={index} className="flex flex-col items-start gap-1 py-2 text-sm">
        <strong>{a.name}</strong><p>{a.promise}</p><p className="text-fg-2">{a.audience}</p><p className="text-xs text-fg-2">{a.sentence_ids?.join(', ')}</p>
        <Button tamanho="sm" disabled={blocked} aria-label={`${t.choose} ${a.name}`} onClick={() => { if (doc.generation !== null) void choose({ generation: doc.generation, index }); }}>{t.choose}</Button>
      </li>)}
    </ul>}
    <details>
    <summary className="foco cursor-pointer rounded-sm text-sm font-medium">{t.own}</summary>
    <form className="mt-2" onSubmit={e => { e.preventDefault(); const angle: Angle = { name: name.trim(), promise: promise.trim() }; if (audience.trim()) angle.audience = audience.trim(); if (refs.trim()) { const parts = refs.split(',').map(s => s.trim()); if (parts.some(s => !/^\d+$/.test(s))) { setError(t.errors.angle_invalid); return; } angle.sentence_ids = parts.map(Number); } void choose({ angle }); }}>
      <fieldset disabled={blocked} className="flex flex-col gap-2 text-sm">
        <legend className="mb-2 font-medium">{t.own}</legend>
        <label className="flex flex-col gap-1">{t.name}<input className={field} value={name} required maxLength={60} onChange={e => setName(e.target.value)} /></label>
        <label className="flex flex-col gap-1">{t.promise}<textarea className={field} value={promise} required maxLength={200} rows={2} onChange={e => setPromise(e.target.value)} /></label>
        <label className="flex flex-col gap-1">{t.audience}<input className={field} value={audience} maxLength={120} onChange={e => setAudience(e.target.value)} /></label>
        <label className="flex flex-col gap-1">{t.refs}<input className={field} value={refs} onChange={e => setRefs(e.target.value)} /><span className="text-xs text-fg-2">{t.refsHint}</span></label>
        <Button type="submit" tamanho="sm" disabled={blocked || !name.trim() || !promise.trim()}>{t.use}</Button>
      </fieldset>
    </form>
    </details>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <ConfirmDialog open={ask !== null} onOpenChange={open => { if (!open) setAsk(null); }} title={ask?.kind === 'choose' ? t.change : t.paid}
      description={ask?.kind === 'choose' ? t.changeBody : ask ? t.paidBody + cost(ask.estimate) + '.' : ''} cancelLabel={t.cancel} confirmLabel={ask?.kind === 'choose' ? t.changeConfirm : t.confirm}
      onConfirm={() => { const current = ask; setAsk(null); if (current?.kind === 'choose') void choose(current.choice, true); else if (current) void generate(true); }} />
  </section>;
}
