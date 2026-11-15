import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { clock, fill } from './selectionFormat';

type Weight = { key: string; weight: number };
type Axis = { score: number; why: string };
export type ReviewCandidate = { id: number; rank: number; startUs: number; endUs: number; axes: Record<string, Axis>; total: number; title: string; windows: number[]; adjusted: boolean; adjust: { extendedBefore?: number; extendedAfter?: number; trimmedEnd?: number } | null };
type Status = 'pending' | 'approved' | 'rejected';
type Moves = { startEarlier: boolean; startLater: boolean; endEarlier: boolean; endLater: boolean };
type Review = { candidate: number; status: Status; adjusted?: boolean; startUs?: number; endUs?: number; startText?: string; endText?: string; moves?: Moves };
type Answer = { item: Review | null; canUndo: boolean };

const texts = {
  'pt-BR': {
    candidates: 'Candidatos a Corte', review: 'Revisão dos candidatos', detail: 'Detalhe do candidato',
    total: 'Nota total', weight: 'peso {value}%', origin: 'Janelas de origem', untitled: 'Sem título',
    adjusted: 'Bordas ajustadas', extendedBefore: 'começo estendido', extendedAfter: 'fim estendido', trimmedEnd: 'fim encurtado', byYou: 'ajustado por você',
    status: { pending: 'Pendente', approved: 'Aprovado', rejected: 'Rejeitado' },
    counts: '{approved} aprovados · {rejected} rejeitados · {pending} pendentes',
    approve: 'Aprovar', reject: 'Rejeitar', undo: 'Desfazer decisão', preview: 'Abrir preview', previewWait: 'O preview do Corte chega com o ticket #58.',
    borders: 'Bordas do Corte', duration: 'Duração {value}', startEarlier: 'Começo antes', startLater: 'Começo depois', endEarlier: 'Fim antes', endLater: 'Fim depois', start: 'Começo', end: 'Fim',
    shortcuts: 'Atalhos', hint: 'Atalhos (com a revisão em foco)', nav: 'navega', keyApprove: 'aprova', keyReject: 'rejeita', keyStart: 'começo antes/depois', keyEnd: 'fim antes/depois', keyUndo: 'desfaz a última decisão',
    note: 'As bordas movem por Frase inteira, dentro da faixa de duração. As decisões ficam só neste Projeto.',
    errors: { adjust_out_of_transcript: 'A borda não pode sair da Transcrição.', adjust_empty: 'O Corte precisa manter ao menos uma Frase.', adjust_too_short: 'O Corte ficaria abaixo da duração mínima.', adjust_too_long: 'O Corte ficaria acima da duração máxima.', nothing_to_undo: 'Não há decisão para desfazer.', default: 'Não foi possível atualizar a revisão.' } as Record<string, string>,
    axis: { hook: 'Gancho', selfContained: 'Autossuficiência', energy: 'Emoção/energia', value: 'Valor', closing: 'Fechamento' } as Record<string, string>,
  },
  en: {
    candidates: 'Clip candidates', review: 'Candidate review', detail: 'Candidate detail',
    total: 'Total score', weight: 'weight {value}%', origin: 'Source windows', untitled: 'Untitled',
    adjusted: 'Borders adjusted', extendedBefore: 'start extended', extendedAfter: 'end extended', trimmedEnd: 'end shortened', byYou: 'adjusted by you',
    status: { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' },
    counts: '{approved} approved · {rejected} rejected · {pending} pending',
    approve: 'Approve', reject: 'Reject', undo: 'Undo decision', preview: 'Open preview', previewWait: 'The Clip preview arrives with ticket #58.',
    borders: 'Clip borders', duration: 'Duration {value}', startEarlier: 'Start earlier', startLater: 'Start later', endEarlier: 'End earlier', endLater: 'End later', start: 'Start', end: 'End',
    shortcuts: 'Shortcuts', hint: 'Shortcuts (with the review focused)', nav: 'navigate', keyApprove: 'approve', keyReject: 'reject', keyStart: 'start earlier/later', keyEnd: 'end earlier/later', keyUndo: 'undo the last decision',
    note: 'Borders move by whole Sentences, inside the duration range. Decisions stay in this Project only.',
    errors: { adjust_out_of_transcript: 'The border cannot leave the Transcript.', adjust_empty: 'The Clip must keep at least one Sentence.', adjust_too_short: 'The Clip would fall below the minimum duration.', adjust_too_long: 'The Clip would exceed the maximum duration.', nothing_to_undo: 'There is no decision to undo.', default: 'Could not update the review.' } as Record<string, string>,
    axis: { hook: 'Hook', selfContained: 'Self-contained', energy: 'Emotion/energy', value: 'Value', closing: 'Closing' } as Record<string, string>,
  },
};

const emptyMoves: Moves = { startEarlier: false, startLater: false, endEarlier: false, endLater: false };

/** Tela de revisão dos candidatos (#55): lista pela Nota, detalhe, aprovar, rejeitar e ajustar as bordas. */
export function CandidateReview({ run, candidates, weights, onOpenPreview }: { run: number; candidates: ReviewCandidate[]; weights: Weight[]; onOpenPreview?: (candidate: number) => void }) {
  const t = useText(texts);
  const [items, setItems] = useState<Record<number, Review>>({});
  const [canUndo, setCanUndo] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const signature = candidates.map(c => c.id).join(',');

  const load = useCallback(async () => {
    const answer = await coreDispatch<{ items: Review[]; canUndo: boolean }>('selection.review', { run });
    setItems(Object.fromEntries(answer.items.map(i => [i.candidate, i])));
    setCanUndo(answer.canUndo);
  }, [run]);
  useEffect(() => { let active = true; load().catch(() => { if (active) setError(t.errors.default); }); return () => { active = false; }; }, [load, signature, t.errors.default]);
  useEffect(() => { if (selected === null || !candidates.some(c => c.id === selected)) setSelected(candidates[0]?.id ?? null); }, [candidates, selected]);

  const current = candidates.find(c => c.id === selected) ?? null;
  const review = current ? items[current.id] : undefined;
  const moves = review?.moves ?? emptyMoves;
  const all = Object.values(items);
  const counts = { approved: all.filter(i => i.status === 'approved').length, rejected: all.filter(i => i.status === 'rejected').length, pending: all.filter(i => i.status === 'pending').length };

  async function act(command: string, args: object) {
    setError('');
    try {
      const answer = await coreDispatch<Answer>(command, args);
      if (answer.item) { const item = answer.item; setItems(prev => ({ ...prev, [item.candidate]: item })); if (command === 'selection.undo') setSelected(item.candidate); }
      setCanUndo(answer.canUndo);
    } catch (e) {
      const code = typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '';
      setError(t.errors[code] ?? t.errors.default);
      if (code === 'nothing_to_undo') setCanUndo(false);
    }
  }
  const decide = (decision: 'approved' | 'rejected') => { if (current) void act('selection.decide', { candidate: current.id, decision }); };
  const adjust = (edge: 'start' | 'end', delta: number) => { if (current) void act('selection.adjust', { candidate: current.id, edge, delta }); };
  const undo = () => { if (canUndo) void act('selection.undo', { run }); };
  function step(by: number) {
    const at = candidates.findIndex(c => c.id === selected);
    const next = candidates[Math.min(candidates.length - 1, Math.max(0, at + by))];
    if (next) { setSelected(next.id); root.current?.querySelector<HTMLElement>(`[data-pick="${next.id}"]`)?.scrollIntoView?.({ block: 'nearest' }); }
  }
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const target = e.target as HTMLElement;
    if (target.closest('input, select, textarea, [contenteditable="true"]')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    const handled = (run: () => void) => { e.preventDefault(); e.stopPropagation(); run(); };
    if (ctrl && !e.altKey && !e.shiftKey && key.toLowerCase() === 'z') return handled(undo);
    if (ctrl || e.altKey) return;
    // `[` e `]` também são atalhos globais das gavetas: dentro da revisão eles movem o começo.
    if (key === 'ArrowDown') handled(() => step(1));
    else if (key === 'ArrowUp') handled(() => step(-1));
    else if (key === 'a' || key === 'A') handled(() => decide('approved'));
    else if (key === 'r' || key === 'R') handled(() => decide('rejected'));
    else if (key === '[') handled(() => adjust('start', -1));
    else if (key === ']') handled(() => adjust('start', 1));
    else if (key === '{') handled(() => adjust('end', -1));
    else if (key === '}') handled(() => adjust('end', 1));
  }
  const startUs = review?.startUs ?? current?.startUs ?? 0;
  const endUs = review?.endUs ?? current?.endUs ?? 0;
  const adjustNote = (c: ReviewCandidate) => [c.adjust?.extendedBefore ? t.extendedBefore : '', c.adjust?.extendedAfter ? t.extendedAfter : '', c.adjust?.trimmedEnd ? t.trimmedEnd : ''].filter(Boolean).join(', ');

  return <div ref={root} role="group" aria-label={t.review} tabIndex={0} onKeyDown={onKeyDown} className="foco flex flex-col gap-2 rounded-md">
    <div className="flex flex-wrap items-center gap-3">
      <span aria-live="polite" data-review-counts>{fill(t.counts, counts)}</span>
      <Button tamanho="sm" disabled={!canUndo} onClick={undo} atalho="Ctrl+Z">{t.undo}</Button>
      <Button tamanho="sm" disabled title={t.previewWait} onClick={() => current && onOpenPreview?.(current.id)} data-preview-slot>{t.preview}</Button>
    </div>
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-2" aria-label={t.shortcuts}>
      <span>{t.hint}:</span>
      <span className="inline-flex items-center gap-1"><Kbd teclas={['↑', '↓']} /> {t.nav}</span>
      <span className="inline-flex items-center gap-1"><Kbd teclas={['A']} /> {t.keyApprove}</span>
      <span className="inline-flex items-center gap-1"><Kbd teclas={['R']} /> {t.keyReject}</span>
      <span className="inline-flex items-center gap-1"><Kbd teclas={['[', ']']} /> {t.keyStart}</span>
      <span className="inline-flex items-center gap-1"><Kbd teclas={['{', '}']} /> {t.keyEnd}</span>
      <span className="inline-flex items-center gap-1"><Kbd teclas={['Ctrl', 'Z']} /> {t.keyUndo}</span>
    </p>
    <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <ol aria-label={t.candidates} className="flex flex-col gap-1">
        {candidates.map(c => {
          const r = items[c.id];
          const status = r?.status ?? 'pending';
          return <li key={c.id} data-candidate={c.id} data-status={status}>
            <button type="button" data-pick={c.id} aria-current={c.id === selected ? 'true' : undefined} tabIndex={-1} onClick={() => setSelected(c.id)}
              className={`foco flex w-full flex-col gap-0.5 rounded-md border p-2 text-left ${c.id === selected ? 'border-accent-line bg-selected' : 'border-line hover:bg-hover'} ${status === 'rejected' ? 'opacity-60' : ''}`}>
              <span className="flex flex-wrap items-baseline gap-x-3"><strong>{t.total}: {c.total.toFixed(2)}</strong><span>{clock(r?.startUs ?? c.startUs)}–{clock(r?.endUs ?? c.endUs)}</span></span>
              <span className="text-fg-2">{c.title || t.untitled}</span>
              <span className={`w-fit rounded-sm px-1.5 text-xs ${status === 'approved' ? 'bg-success-subtle text-success' : status === 'rejected' ? 'bg-danger-subtle text-danger' : 'bg-field text-fg-2'}`}>{t.status[status]}{r?.adjusted ? ` · ${t.byYou}` : ''}</span>
            </button>
          </li>;
        })}
      </ol>
      {current && <section aria-label={t.detail} data-detail={current.id} className="flex flex-col gap-3 rounded-md border border-line p-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <strong>{t.total}: {current.total.toFixed(2)}</strong>
          <span>{clock(startUs)}–{clock(endUs)}</span>
          <span className="text-fg-2">{fill(t.duration, { value: clock(endUs - startUs) })}</span>
          {current.title && <span className="text-fg-2">{current.title}</span>}
        </div>
        {current.adjusted && <p className="text-fg-2">{t.adjusted}: {adjustNote(current)}</p>}
        <p className="text-fg-2">{t.origin}: {current.windows.map(n => n + 1).join(', ')}</p>
        <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_max-content_1fr]">
          {weights.map(w => <div key={w.key} className="contents">
            <dt className="font-medium">{t.axis[w.key] ?? w.key}</dt>
            <dd>{current.axes[w.key]?.score} <span className="text-fg-2">({fill(t.weight, { value: Math.round(w.weight * 100) })})</span></dd>
            <dd className="text-fg-2">{current.axes[w.key]?.why}</dd>
          </div>)}
        </dl>
        <div role="group" aria-label={t.borders} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{t.start}</span>
            <Button tamanho="sm" disabled={!moves.startEarlier} onClick={() => adjust('start', -1)}>{t.startEarlier}</Button>
            <Button tamanho="sm" disabled={!moves.startLater} onClick={() => adjust('start', 1)}>{t.startLater}</Button>
            {review?.startText && <q className="text-fg-2" data-border-text="start">{review.startText}</q>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{t.end}</span>
            <Button tamanho="sm" disabled={!moves.endEarlier} onClick={() => adjust('end', -1)}>{t.endEarlier}</Button>
            <Button tamanho="sm" disabled={!moves.endLater} onClick={() => adjust('end', 1)}>{t.endLater}</Button>
            {review?.endText && <q className="text-fg-2" data-border-text="end">{review.endText}</q>}
          </div>
          <p className="text-xs text-fg-2">{t.note}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variante="primario" aria-pressed={review?.status === 'approved'} onClick={() => decide('approved')} atalho="A">{t.approve}</Button>
          <Button aria-pressed={review?.status === 'rejected'} onClick={() => decide('rejected')} atalho="R">{t.reject}</Button>
        </div>
      </section>}
    </div>
    {error && <p role="alert" className="text-danger">{error}</p>}
  </div>;
}
