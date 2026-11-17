import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { previewSeekEvent, type PreviewSeekEvent } from './CutPreview';

type Word = { position: number; text: string; corrected: boolean; start_us: number };
type Item = { type: 'sentence' | 'silence'; id?: number; start_us: number; end_us: number; language?: string | null; text?: string; words?: Word[] };
type Page = { total: number; items: Item[] };
/** Mudança de uma palavra, devolvida pelo núcleo e repassada a todas as telas abertas. */
export type CorrectionEvent = { source_id: number; position: number; text: string; corrected: boolean; sentence_id: number | null };
type Step = CorrectionEvent & { can_undo: boolean; can_redo: boolean };
export type GotoEvent = { source_id: number; row: number; sentence_id: number };
export const correctionEvent = 'clipes-transcript-corrected';
export const gotoEvent = 'clipes-transcript-goto';

const texts = {
  'pt-BR': { title: 'Transcrição', silence: 'Silêncio', loading: 'Carregando transcrição…', error: 'Não foi possível carregar a transcrição.', unknown: 'Idioma desconhecido', undo: 'Desfazer', redo: 'Refazer', edit: 'Corrigir palavra', saveError: 'Não foi possível salvar a correção.', hint: 'corrige a palavra focada', confirm: 'confirma', cancel: 'cancela', corrected: 'corrigida', arrows: 'Setas movem entre palavras', hintFull: 'F2 corrige a palavra focada, Enter confirma, Esc cancela, Ctrl+Z desfaz, Ctrl+Y refaz, setas movem entre palavras.' },
  en: { title: 'Transcript', silence: 'Silence', loading: 'Loading transcript…', error: 'Could not load the transcript.', unknown: 'Unknown language', undo: 'Undo', redo: 'Redo', edit: 'Correct word', saveError: 'Could not save the correction.', hint: 'corrects the focused word', confirm: 'confirms', cancel: 'cancels', corrected: 'corrected', arrows: 'Arrows move between words', hintFull: 'F2 corrects the focused word, Enter confirms, Esc cancels, Ctrl+Z undoes, Ctrl+Y redoes, arrows move between words.' },
};
const height = 120;
const pageSize = 100;
function time(us: number) { const s = Math.floor(us / 1_000_000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
const sentenceText = (words: Word[]) => words.map(w => w.text.trim()).filter(Boolean).join(' ');

export function TranscriptTimeline({ sourceId }: { sourceId: number }) {
  const t = useText(texts);
  const section = useRef<HTMLElement>(null);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState<Record<number, Item[]>>({});
  const [scroll, setScroll] = useState(0);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [focus, setFocus] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ position: number; value: string } | null>(null);
  const [stack, setStack] = useState({ can_undo: false, can_redo: false });
  // Palavra a focar depois do próximo render (depois de editar, de rolar ou de abrir um resultado da busca).
  const pending = useRef<{ position?: number; sentence?: number; edge?: 'first' | 'last' } | null>(null);
  useEffect(() => {
    let active = true;
    setReady(false); setPages({}); setScroll(0); setError('');
    coreDispatch('transcription.segment', { source_id: sourceId }).then(() => { if (active) setReady(true); }).catch(() => { if (active) setError(t.error); });
    coreDispatch<{ can_undo: boolean; can_redo: boolean }>('transcription.corrections', {}).then(s => { if (active) setStack(s); }).catch(() => {});
    return () => { active = false; };
  }, [sourceId, t.error]);
  // Correções (também as feitas por desfazer/refazer em outra tela) entram na lista já carregada,
  // sem recarregar: recarregar desmontaria a palavra focada.
  useEffect(() => {
    const onCorrected = (event: Event) => {
      const e = (event as CustomEvent<CorrectionEvent>).detail;
      coreDispatch<{ can_undo: boolean; can_redo: boolean }>('transcription.corrections', {}).then(setStack).catch(() => {});
      if (e.source_id !== sourceId) return;
      setPages(current => {
        const next: Record<number, Item[]> = {};
        for (const [page, items] of Object.entries(current)) {
          next[Number(page)] = items.map(item => {
            if (!item.words?.some(w => w.position === e.position)) return item;
            const words = item.words.map(w => w.position === e.position ? { ...w, text: e.text.trim(), corrected: e.corrected } : w);
            return { ...item, words, text: sentenceText(words) };
          });
        }
        return next;
      });
    };
    const onGoto = (event: Event) => {
      const e = (event as CustomEvent<GotoEvent>).detail;
      if (e.source_id !== sourceId) return;
      const el = section.current;
      if (!el) return;
      pending.current = { sentence: e.sentence_id };
      el.scrollIntoView({ block: 'nearest' });
      el.scrollTop = e.row * height;
      setScroll(e.row * height);
    };
    window.addEventListener(correctionEvent, onCorrected);
    window.addEventListener(gotoEvent, onGoto);
    return () => { window.removeEventListener(correctionEvent, onCorrected); window.removeEventListener(gotoEvent, onGoto); };
  }, [sourceId]);
  const first = Math.max(0, Math.floor(scroll / height) - 5);
  const last = Math.min(total || pageSize, first + 20);
  const startPage = Math.floor(first / pageSize);
  const endPage = Math.floor(Math.max(first, last - 1) / pageSize);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    for (let p = startPage; p <= endPage; p++) {
      if (pages[p]) continue;
      coreDispatch<Page>('transcription.timeline', { source_id: sourceId, offset: p * pageSize, limit: pageSize }).then(result => {
        if (active) { setTotal(result.total); setPages(current => ({ ...current, [p]: result.items })); }
      }).catch(() => { if (active) setError(t.error); });
    }
    return () => { active = false; };
  }, [sourceId, ready, startPage, endPage, pages, t.error]);
  // Foco pendente: roda a cada render, mas só age quando a palavra já está montada.
  useEffect(() => {
    const want = pending.current;
    const el = section.current;
    if (!want || !el) return;
    let target: HTMLElement | null = null;
    if (want.position !== undefined) target = el.querySelector(`[data-word="${want.position}"]`);
    else if (want.sentence !== undefined) target = el.querySelector(`[data-sentence="${want.sentence}"] [data-word]`);
    else if (want.edge) { const all = el.querySelectorAll<HTMLElement>('[data-word]'); target = all[want.edge === 'first' ? 0 : all.length - 1] ?? null; }
    if (target) { pending.current = null; target.focus(); }
  });

  async function apply(name: 'transcription.correct' | 'transcription.undo' | 'transcription.redo', args: object) {
    setError('');
    try {
      const r = await coreDispatch<Step>(name, args);
      setStack({ can_undo: r.can_undo, can_redo: r.can_redo });
      if (r.source_id !== undefined) window.dispatchEvent(new CustomEvent<CorrectionEvent>(correctionEvent, { detail: { source_id: r.source_id, position: r.position, text: r.text, corrected: r.corrected, sentence_id: r.sentence_id } }));
      return r;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'nothing_to_undo' && code !== 'nothing_to_redo') setError(t.saveError);
      return null;
    }
  }
  async function commit() {
    const current = editing;
    if (!current) return;
    setEditing(null);
    pending.current = { position: current.position };
    await apply('transcription.correct', { source_id: sourceId, position: current.position, text: current.value });
    // O render que fecha o campo já devolve o foco; este força um novo passe se nada mudou.
    setFocus(current.position);
  }
  function cancel() {
    if (editing) pending.current = { position: editing.position };
    setEditing(null);
  }
  async function step(direction: 'undo' | 'redo') {
    const r = await apply(direction === 'undo' ? 'transcription.undo' : 'transcription.redo', {});
    if (r && r.source_id === sourceId) pending.current = { position: r.position };
  }
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (editing) return;
    const key = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && key === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); void step('undo'); return; }
    if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); e.stopPropagation(); void step('redo'); return; }
    const el = section.current;
    const word = (e.target as HTMLElement).closest<HTMLElement>('[data-word]');
    if (!el) return;
    if (!word) {
      if (e.target === el && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) { e.preventDefault(); el.querySelector<HTMLElement>('[data-word]')?.focus(); }
      return;
    }
    const position = Number(word.dataset.word);
    if (e.key === 'F2') {
      e.preventDefault(); e.stopPropagation();
      setEditing({ position, value: word.textContent?.trim() ?? '' });
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation();
      const all = Array.from(el.querySelectorAll<HTMLElement>('[data-word]'));
      const next = all[all.indexOf(word) + (e.key === 'ArrowRight' ? 1 : -1)];
      if (next) next.focus();
      else {
        // Fim da área carregada: rola uma linha e foca a palavra que aparecer.
        pending.current = { edge: e.key === 'ArrowRight' ? 'first' : 'last' };
        const top = Math.max(0, el.scrollTop + (e.key === 'ArrowRight' ? height : -height));
        el.scrollTop = top; setScroll(top);
      }
    }
  }

  const rows = [];
  for (let i = first; i < last; i++) {
    const item = pages[Math.floor(i / pageSize)]?.[i % pageSize];
    if (!item) continue;
    rows.push(<div key={i} data-timeline-row data-sentence={item.id} className="absolute inset-x-0 overflow-auto border-b border-line px-3 py-2" style={{ top: i * height, height }}>
      <p className="font-mono text-xs text-fg-2">{time(item.start_us)} – {time(item.end_us)} · {item.type === 'silence' ? t.silence : item.language || t.unknown}</p>
      {item.type === 'sentence' && <p className="mt-1 whitespace-pre-wrap">{item.words?.length
        ? item.words.map(w => <span key={w.position}>{editing?.position === w.position
          ? <input autoFocus aria-label={t.edit} className="foco h-6 w-32 rounded-sm border border-line-strong bg-field px-1 text-fg" value={editing.value}
            onChange={ev => setEditing({ position: w.position, value: ev.target.value })}
            onBlur={cancel}
            onKeyDown={ev => {
              if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); void commit(); }
              else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancel(); }
              else if (ev.key !== 'Tab') ev.stopPropagation();
            }} />
          : <button type="button" data-word={w.position} tabIndex={(focus ?? item.words?.[0]?.position) === w.position ? 0 : -1} title={w.corrected ? t.corrected : undefined}
            onFocus={() => setFocus(w.position)}
            onClick={() => window.dispatchEvent(new CustomEvent<PreviewSeekEvent>(previewSeekEvent, { detail: { source_id: sourceId, us: w.start_us } }))}
            className={`foco rounded-sm px-0.5 ${w.corrected ? 'underline decoration-dotted underline-offset-4' : ''}`}>{w.text}</button>}{' '}</span>)
        : item.text}</p>}
    </div>);
  }
  return <div className="mt-3 w-full">
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Button disabled={!stack.can_undo} onClick={() => void step('undo')}>{t.undo}</Button>
      <Button disabled={!stack.can_redo} onClick={() => void step('redo')}>{t.redo}</Button>
      <span className="text-fg-2"><span className="sr-only">{t.hintFull}</span><span aria-hidden="true"><Kbd teclas={["F2"]} /> {t.hint} · <Kbd teclas={["Enter"]} /> {t.confirm} · <Kbd teclas={["Esc"]} /> {t.cancel} · <Kbd teclas={["Ctrl","Z"]} /> / <Kbd teclas={["Ctrl","Y"]} /> · {t.arrows}</span></span>
    </div>
    <section ref={section} aria-label={t.title} tabIndex={0} className="foco mt-2 h-96 w-full overflow-y-auto rounded-md border border-line bg-surface text-sm" onScroll={e => setScroll(e.currentTarget.scrollTop)} onKeyDown={onKeyDown}>
      {error ? <p role="alert" className="p-3 text-danger">{error}</p> : !ready || (!total && !pages[0]) ? <p className="p-3">{t.loading}</p> : <div className="relative" style={{ height: total * height }}>{rows}</div>}
    </section>
    {error && ready && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
  </div>;
}
