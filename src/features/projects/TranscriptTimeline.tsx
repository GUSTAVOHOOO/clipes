import { useEffect, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';

type Item = { type: 'sentence' | 'silence'; id?: number; start_us: number; end_us: number; language?: string | null; text?: string };
type Page = { total: number; items: Item[] };
const texts = {
  'pt-BR': { title: 'Transcrição', silence: 'Silêncio', loading: 'Carregando transcrição…', error: 'Não foi possível carregar a transcrição.', unknown: 'Idioma desconhecido' },
  en: { title: 'Transcript', silence: 'Silence', loading: 'Loading transcript…', error: 'Could not load the transcript.', unknown: 'Unknown language' },
};
const height = 120;
const pageSize = 100;
function time(us: number) { const s = Math.floor(us / 1_000_000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

export function TranscriptTimeline({ sourceId }: { sourceId: number }) {
  const t = useText(texts);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState<Record<number, Item[]>>({});
  const [scroll, setScroll] = useState(0);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    setReady(false); setPages({}); setScroll(0); setError('');
    coreDispatch('transcription.segment', { source_id: sourceId }).then(() => { if (active) setReady(true); }).catch(() => { if (active) setError(t.error); });
    return () => { active = false; };
  }, [sourceId, t.error]);
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
  const rows = [];
  for (let i = first; i < last; i++) {
    const item = pages[Math.floor(i / pageSize)]?.[i % pageSize];
    if (!item) continue;
    rows.push(<div key={i} data-timeline-row className="absolute inset-x-0 overflow-auto border-b border-line px-3 py-2" style={{ top: i * height, height }}>
      <p className="font-mono text-xs text-fg-2">{time(item.start_us)} – {time(item.end_us)} · {item.type === 'silence' ? t.silence : item.language || t.unknown}</p>
      {item.type === 'sentence' && <p className="mt-1 whitespace-pre-wrap">{item.text}</p>}
    </div>);
  }
  return <section aria-label={t.title} tabIndex={0} className="foco mt-3 h-96 w-full overflow-y-auto rounded-md border border-line bg-surface text-sm" onScroll={e => setScroll(e.currentTarget.scrollTop)}>
    {error ? <p role="alert" className="p-3 text-danger">{error}</p> : !ready || (!total && !pages[0]) ? <p className="p-3">{t.loading}</p> : <div className="relative" style={{ height: total * height }}>{rows}</div>}
  </section>;
}
