import { useEffect, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { correctionEvent, gotoEvent, type GotoEvent } from './TranscriptTimeline';

type Hit = { transcript_id: number; source_id: number; source: string; sentence_id: number; start_us: number; end_us: number; row: number; snippet: { text: string; match: boolean }[] };
const texts = {
  'pt-BR': { title: 'Buscar nas Transcrições', label: 'Buscar texto em todas as Transcrições do Projeto', hint: 'Acentos não importam: “acao” acha “ação”.', none: 'Nenhum resultado.', sentence: 'Frase', error: 'Não foi possível buscar.', open: 'Abrir no trecho', count: 'resultados' },
  en: { title: 'Search Transcripts', label: 'Search text across all Transcripts in the Project', hint: 'Accents do not matter: “acao” finds “ação”.', none: 'No results.', sentence: 'Sentence', error: 'Could not search.', open: 'Open at this passage', count: 'results' },
};
function time(us: number) { const s = Math.floor(us / 1_000_000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

/** Busca FTS5 no texto corrigido das Frases; clicar num resultado leva ao trecho da Transcrição. */
export function TranscriptSearch({ projectId }: { projectId: string }) {
  const t = useText(texts);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  // Uma correção (ou desfazer/refazer) muda o texto indexado: refaz a busca atual.
  useEffect(() => {
    const bump = () => setVersion(v => v + 1);
    window.addEventListener(correctionEvent, bump);
    return () => window.removeEventListener(correctionEvent, bump);
  }, []);
  useEffect(() => {
    if (!query.trim()) { setHits(null); setError(''); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      coreDispatch<Hit[]>('transcription.search', { query }).then(result => { if (active) { setHits(result); setError(''); } }).catch(() => { if (active) setError(t.error); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, version, projectId, t.error]);
  return <section aria-label={t.title} className="mt-8 border-t border-line pt-6">
    <h2 className="text-base font-semibold">{t.title}</h2>
    <label className="mt-3 flex max-w-xl flex-col gap-1 text-sm">{t.label}
      <input type="search" className="foco h-8 rounded-md border border-line-strong bg-field px-3 text-fg" value={query} onChange={e => setQuery(e.target.value)} />
    </label>
    <p className="mt-1 text-sm text-fg-2">{t.hint}</p>
    {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
    <div aria-live="polite">
      {hits && hits.length === 0 && <p className="mt-3 text-fg-2">{t.none}</p>}
      {hits && hits.length > 0 && <ul className="mt-3 divide-y divide-line border-y border-line">{hits.map(h => <li key={`${h.transcript_id}-${h.sentence_id}`}>
        <button type="button" className="foco block w-full px-2 py-2 text-left hover:bg-field" aria-label={`${t.open}: ${h.source}, ${t.sentence} ${h.sentence_id}`}
          onClick={() => window.dispatchEvent(new CustomEvent<GotoEvent>(gotoEvent, { detail: { source_id: h.source_id, row: h.row, sentence_id: h.sentence_id } }))}>
          <span className="block font-mono text-xs text-fg-2">{h.source} · {t.sentence} {h.sentence_id} · {time(h.start_us)}</span>
          <span className="block text-sm">{h.snippet.map((p, i) => p.match ? <mark key={i} className="rounded-sm bg-accent-subtle px-0.5 text-fg">{p.text}</mark> : <span key={i}>{p.text}</span>)}</span>
        </button>
      </li>)}</ul>}
    </div>
  </section>;
}
