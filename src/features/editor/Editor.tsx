import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { PanelLeft, PanelRight, X } from 'lucide-react';
import { coreDispatch, type ExportRequest } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { CabecalhoGaveta, GavetaBorda, Puxador, ZonaBorda, useGaveta } from '@/components/shell/Gaveta';
import { CutPreview, previewSeekEvent, type PreviewSeekEvent } from '@/features/projects/CutPreview';
import { clock, fill } from '@/features/projects/selectionFormat';
import { PX_PER_SEC, neighborStart, nextRate, pxToUs, sentenceAt, usToPx, visiblePx, visibleSentences, visibleThumbs, type TimelineSentence } from './timelineMath';

export const editorOpenEvent = 'clipes-editor-open';
/** Abre o editor num Corte: candidato aprovado ou par de Frases da Fonte. O núcleo valida as bordas. */
export function openEditor(request: ExportRequest) { window.dispatchEvent(new CustomEvent<ExportRequest>(editorOpenEvent, { detail: request })); }

type Opened = { request: ExportRequest; startUs: number; endUs: number; windowStartUs: number; windowEndUs: number; fps: number };
type Thumbs = { id: string; count: number; intervalUs: number; width: number; height: number; columns: number };
type Timeline = { state: 'queued' | 'running' | 'ready' | 'failed' | 'cancelled' | 'missing'; key: string; job: number | null; progress: number; error: string | null; thumbs: Thumbs | null };

const texts = {
  'pt-BR': {
    title: 'Editor do Corte', close: 'Fechar editor', timeline: 'Timeline do Corte', transcript: 'Transcrição do editor', borders: 'Bordas do Corte',
    markIn: 'Marcar entrada', markOut: 'Marcar saída', back: 'Voltar', pause: 'Pausar', forward: 'Avançar', rate: 'Velocidade', export: 'Exportar', exportSoon: 'A exportação chega com o ticket #59.',
    shortcuts: 'Atalhos', hintPlay: 'voltar · pausar · avançar', hintMark: 'entrada · saída (Frase inteira)', hintFrame: 'quadro', hintSentence: 'Frase anterior/próxima', hintDrawers: 'gavetas',
    duration: 'Duração {value}', start: 'Entrada', end: 'Saída', startEarlier: 'Entrada antes', startLater: 'Entrada depois', endEarlier: 'Saída antes', endLater: 'Saída depois',
    loading: 'Abrindo o editor…', timelinePreparing: 'Preparando miniaturas e onda…', timelineFailed: 'Não foi possível gerar as miniaturas e a onda.', cancel: 'Cancelar', retry: 'Gerar de novo',
    note: 'As bordas movem por Frase inteira, dentro da faixa de duração. O ajuste fino com Alt vem em outro ticket.',
    errors: { adjust_empty: 'O Corte precisa manter ao menos uma Frase.', adjust_too_short: 'O Corte ficaria abaixo da duração mínima.', adjust_too_long: 'O Corte ficaria acima da duração máxima.', unknown_sentence_id: 'Frase desconhecida.', invalid_range: 'Intervalo do Corte inválido.', candidate_not_found: 'Candidato não encontrado.', transcript_missing: 'Transcrição não encontrada.', source_not_found: 'Fonte não encontrada.', default: 'Não foi possível abrir o editor.' } as Record<string, string>,
  },
  en: {
    title: 'Clip editor', close: 'Close editor', timeline: 'Clip timeline', transcript: 'Editor Transcript', borders: 'Clip borders',
    markIn: 'Mark in', markOut: 'Mark out', back: 'Reverse', pause: 'Pause', forward: 'Forward', rate: 'Speed', export: 'Export', exportSoon: 'Export arrives with ticket #59.',
    shortcuts: 'Shortcuts', hintPlay: 'reverse · pause · forward', hintMark: 'in · out (whole Sentence)', hintFrame: 'frame', hintSentence: 'previous/next Sentence', hintDrawers: 'drawers',
    duration: 'Duration {value}', start: 'In', end: 'Out', startEarlier: 'In earlier', startLater: 'In later', endEarlier: 'Out earlier', endLater: 'Out later',
    loading: 'Opening the editor…', timelinePreparing: 'Preparing thumbnails and waveform…', timelineFailed: 'Could not generate thumbnails and waveform.', cancel: 'Cancel', retry: 'Generate again',
    note: 'Borders move by whole Sentences, inside the duration range. Fine adjustment with Alt comes in a later ticket.',
    errors: { adjust_empty: 'The Clip must keep at least one Sentence.', adjust_too_short: 'The Clip would fall below the minimum duration.', adjust_too_long: 'The Clip would exceed the maximum duration.', unknown_sentence_id: 'Unknown Sentence.', invalid_range: 'Invalid Clip range.', candidate_not_found: 'Candidate not found.', transcript_missing: 'Transcript not found.', source_not_found: 'Source not found.', default: 'Could not open the editor.' } as Record<string, string>,
  },
};

const errorCode = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '');
const mediaUrl = (id: string) => (isTauri() ? convertFileSrc(id, 'clipes-media') : `/__clipes-media__/${id}`);
const ROW = { thumbs: 54, wave: 40, sentences: 56 } as const;

/** Escuta o pedido de abertura e monta o editor em sobreposição. Um por aplicativo. */
export function EditorHost() {
  const [request, setRequest] = useState<ExportRequest | null>(null);
  useEffect(() => {
    const onOpen = (event: Event) => setRequest((event as CustomEvent<ExportRequest>).detail);
    window.addEventListener(editorOpenEvent, onOpen);
    return () => window.removeEventListener(editorOpenEvent, onOpen);
  }, []);
  return request ? <Editor key={`${request.source_id}:${request.start_id}:${request.end_id}`} request={request} onClose={() => setRequest(null)} /> : null;
}

/** Editor Foco do Corte (#61): só preview e timeline; a Transcrição e as bordas ficam em gavetas. */
export function Editor({ request, onClose }: { request: ExportRequest; onClose: () => void }) {
  const t = useText(texts);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [startId, setStartId] = useState(request.start_id);
  const [endId, setEndId] = useState(request.end_id);
  const [range, setRange] = useState<{ startUs: number; endUs: number } | null>(null);
  const [sentences, setSentences] = useState<TimelineSentence[]>([]);
  const [error, setError] = useState('');
  const [sourceUs, setSourceUs] = useState(0);
  const [rate, setRate] = useState(0);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [wave, setWave] = useState<number[] | null>(null);
  const [scroll, setScroll] = useState({ left: 0, width: 1200 });
  const left = useGaveta();
  const right = useGaveta();
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ sourceUs: 0, rate: 0, startId, endId, sentences, opened, fps: 30 });
  state.current = { sourceUs, rate, startId, endId, sentences, opened, fps: opened?.fps ?? 30 };

  // Abre: o núcleo valida o par de Frases e devolve a janela do proxy (Corte ±2 min).
  useEffect(() => {
    let alive = true;
    coreDispatch<Opened>('editor.open', request).then(async info => {
      const all: TimelineSentence[] = [];
      for (;;) {
        const page = await coreDispatch<TimelineSentence[]>('editor.sentences', { source_id: request.source_id, start_us: info.windowStartUs, end_us: info.windowEndUs, after_id: all.at(-1)?.id ?? 0, limit: 200 });
        all.push(...page);
        if (page.length < 200) break;
      }
      if (!alive) return;
      setOpened(info); setSentences(all); setRange({ startUs: info.startUs, endUs: info.endUs }); setSourceUs(info.startUs);
      requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollLeft = Math.max(0, usToPx(info.startUs, info.windowStartUs) - 80); });
    }).catch(e => { if (alive) setError(errorCode(e)); });
    return () => { alive = false; };
  }, [request]);

  // Miniaturas e onda: nascem do proxy pronto. Espera o proxy e acompanha a tarefa local.
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    let timer = 0;
    const args = { source_id: request.source_id, start_us: opened.startUs, end_us: opened.endUs };
    const finish = async (next: Timeline) => {
      setTimeline(next);
      if (next.state === 'ready') {
        const data = await coreDispatch<{ values: number[] }>('editor.wave', { key: next.key });
        if (alive) setWave(data.values);
      }
    };
    const poll = async () => {
      try {
        const next = await coreDispatch<Timeline>('editor.timeline', args);
        if (!alive) return;
        await finish(next);
        if (next.state === 'queued' || next.state === 'running') timer = window.setTimeout(() => void status(next.key), 700);
      } catch (e) {
        if (alive && errorCode(e) === 'proxy_not_ready') timer = window.setTimeout(() => void poll(), 1000);
        else if (alive) setTimeline(current => current ?? { state: 'failed', key: '', job: null, progress: 0, error: errorCode(e), thumbs: null });
      }
    };
    const status = async (key: string) => {
      try {
        const next = await coreDispatch<Timeline>('editor.timeline_status', { key, window_us: opened.windowEndUs - opened.windowStartUs });
        if (!alive) return;
        if (next.state === 'missing') return void poll();
        await finish(next);
        if (next.state === 'queued' || next.state === 'running') timer = window.setTimeout(() => void status(key), 700);
      } catch { if (alive) setTimeline(current => current && { ...current, state: 'failed' }); }
    };
    void poll();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [opened, request.source_id]);

  const windowStartUs = opened?.windowStartUs ?? 0;
  const totalPx = opened ? usToPx(opened.windowEndUs, windowStartUs) : 0;

  /** Move o cabeçote (do editor) e pede ao preview que vá ao mesmo tempo da Fonte. */
  const seek = useCallback((us: number) => {
    const info = state.current.opened;
    if (!info) return;
    const next = Math.round(Math.min(info.windowEndUs, Math.max(info.windowStartUs, us)));
    setSourceUs(next);
    window.dispatchEvent(new CustomEvent<PreviewSeekEvent>(previewSeekEvent, { detail: { source_id: request.source_id, us: next } }));
  }, [request.source_id]);

  /** Troca uma borda por Frase inteira; o núcleo recusa o que sair da faixa e a UI mantém a borda anterior. */
  const mark = useCallback(async (edge: 'start' | 'end', id: number) => {
    const { startId: s, endId: e } = state.current;
    const next = edge === 'start' ? { start_id: id, end_id: e } : { start_id: s, end_id: id };
    try {
      const answer = await coreDispatch<{ startUs: number; endUs: number }>('editor.range', { ...request, ...next });
      setStartId(next.start_id); setEndId(next.end_id); setRange({ startUs: answer.startUs, endUs: answer.endUs }); setError('');
    } catch (err) { setError(errorCode(err) || 'default'); }
  }, [request]);
  const markAtPlayhead = useCallback((edge: 'start' | 'end') => {
    const found = sentenceAt(state.current.sentences, state.current.sourceUs);
    if (found) void mark(edge, found.id);
  }, [mark]);
  const moveEdge = (edge: 'start' | 'end', delta: number) => {
    const list = state.current.sentences;
    const index = list.findIndex(s => s.id === (edge === 'start' ? state.current.startId : state.current.endId));
    const target = list[index + delta];
    if (index < 0 || !target) { setError('unknown_sentence_id'); return; }
    void mark(edge, target.id);
  };

  // Atalhos do editor (J/K/L, I/O, setas, colchetes). Não pegam o que acontece em campos, nem com Ctrl/Alt:
  // o ajuste fino com Alt é de ticket futuro e Ctrl+Z/F2 são da Transcrição.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as Element | null;
      const key = e.key;
      const inField = target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]');
      if (inField) return;
      const inLayer = target?.closest('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]');
      const take = () => { e.preventDefault(); e.stopPropagation(); };
      if (key === '[' && !inLayer?.closest('aside[data-lado="dir"]')) { take(); right.fechar(); left.alternar(); return; }
      if (key === ']' && !inLayer?.closest('aside[data-lado="esq"]')) { take(); left.fechar(); right.alternar(); return; }
      if (key === 'Escape') {
        if (left.aberta || right.aberta) { take(); left.fechar(); right.fechar(); } else if (!inLayer) { take(); onClose(); }
        return;
      }
      if (inLayer) return;
      const s = state.current;
      const lower = key.length === 1 ? key.toLowerCase() : key;
      if (lower === 'j' || lower === 'l') { take(); setRate(nextRate(s.rate, lower)); }
      else if (lower === 'k') { take(); setRate(0); }
      else if (key === ' ' && !target?.closest('button,a[href],summary')) { take(); setRate(s.rate === 0 ? 1 : 0); }
      else if (lower === 'i') { take(); markAtPlayhead('start'); }
      else if (lower === 'o') { take(); markAtPlayhead('end'); }
      else if (key === 'ArrowRight' || key === 'ArrowLeft') { take(); setRate(0); seek(s.sourceUs + (key === 'ArrowRight' ? 1 : -1) * (1_000_000 / s.fps)); }
      else if (key === 'ArrowDown' || key === 'ArrowUp') {
        take(); setRate(0);
        const to = neighborStart(s.sentences, s.sourceUs, key === 'ArrowDown' ? 1 : -1);
        if (to !== null) seek(to);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [left, right, onClose, seek, markAtPlayhead]);

  // Tamanho da área rolável e rolagem; só o que cabe nela (mais uma folga) é montado.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setScroll({ left: el.scrollLeft, width: el.clientWidth || 1200 });
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => { el.removeEventListener('scroll', measure); observer?.disconnect(); };
  }, [opened]);

  // Acompanha o cabeçote durante a reprodução.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !opened) return;
    const x = usToPx(sourceUs, windowStartUs);
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - el.clientWidth / 3);
  }, [sourceUs, opened, windowStartUs]);

  const visible = useMemo(() => visiblePx(scroll.left, scroll.width, totalPx), [scroll, totalPx]);
  const shown = useMemo(() => visibleSentences(sentences, windowStartUs, visible), [sentences, windowStartUs, visible]);
  const thumbs = timeline?.state === 'ready' ? timeline.thumbs : null;
  const current = sentenceAt(sentences, sourceUs);

  // Onda: um único canvas do tamanho da área visível, desenhado a partir da série medida no proxy.
  useEffect(() => {
    const el = canvas.current;
    if (!el || !wave) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const [from, to] = visible;
    el.width = Math.max(1, Math.round(to - from));
    el.height = ROW.wave;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--fg-3').trim() || '#888';
    const blockPx = (100_000 / 1_000_000) * PX_PER_SEC;
    const first = Math.max(0, Math.floor(from / blockPx));
    const last = Math.min(wave.length - 1, Math.ceil(to / blockPx));
    for (let i = first; i <= last; i++) {
      const h = Math.max(1, Math.round((wave[i] / 255) * (ROW.wave - 4)));
      ctx.fillRect(Math.round(i * blockPx - from), Math.round((ROW.wave - h) / 2), Math.max(1, Math.floor(blockPx) - 1), h);
    }
  }, [wave, visible]);

  const inClip = (s: TimelineSentence) => s.id >= startId && s.id <= endId;
  const startSentence = sentences.find(s => s.id === startId);
  const endSentence = sentences.find(s => s.id === endId);
  const failedText = error ? (t.errors[error] ?? t.errors.default) : '';

  const dispatchTimeline = async (id: number | null) => { if (id !== null) { try { await coreDispatch('jobs.cancel', { id }); } catch { /* a tarefa já terminou */ } } };

  return <section role="region" aria-label={t.title} data-start-id={startId} data-end-id={endId} data-source-us={Math.round(sourceUs)} data-rate={rate}
    className="fixed inset-0 flex flex-col overflow-hidden bg-canvas text-fg" style={{ zIndex: 'var(--z-scrim)' }}>
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
      <h2 className="text-base font-semibold">{t.title}</h2>
      {range && <span className="font-mono text-xs text-fg-2">{clock(range.startUs)} – {clock(range.endUs)} · {fill(t.duration, { value: clock(range.endUs - range.startUs) })}</span>}
      <div className="flex-1" />
      <Button tamanho="sm" disabled title={t.exportSoon}>{t.export}</Button>
      <Button tamanho="sm" variante="fantasma" icone={<X size={14} />} onClick={onClose} aria-label={t.close} atalho="Escape" />
    </header>
    {error && <p role="alert" className="border-b border-line bg-warning-subtle px-4 py-2 text-sm text-fg">{failedText}</p>}
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ZonaBorda lado="esq" g={left} /><ZonaBorda lado="dir" g={right} />
      <Puxador lado="esq" g={left} itens={[{ id: 'transcript', rotulo: t.transcript, atalho: '[', icone: <PanelLeft size={16} />, onClick: () => { right.fechar(); left.alternar(); } }]} />
      <Puxador lado="dir" g={right} itens={[{ id: 'borders', rotulo: t.borders, atalho: ']', icone: <PanelRight size={16} />, onClick: () => { left.fechar(); right.alternar(); } }]} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4"><div className="m-auto flex flex-col items-center gap-3">
        {!opened && !error && <p aria-live="polite" className="text-fg-2">{t.loading}</p>}
        {opened && <div style={{ width: 'min(18rem, 22vh)' }}><CutPreview sourceId={request.source_id} startUs={opened.startUs} endUs={opened.endUs} rate={rate} onSourceTime={us => setSourceUs(us)} /></div>}
        {opened && <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label={t.shortcuts}>
          <Button tamanho="sm" onClick={() => setRate(nextRate(rate, 'j'))} atalho="J">{t.back.replace(/ \(.\)$/, '')}</Button>
          <Button tamanho="sm" onClick={() => setRate(0)} atalho="K">{t.pause.replace(/ \(.\)$/, '')}</Button>
          <Button tamanho="sm" onClick={() => setRate(nextRate(rate, 'l'))} atalho="L">{t.forward.replace(/ \(.\)$/, '')}</Button>
          <span className="font-mono text-xs text-fg-2" aria-label={t.rate}>{rate}×</span>
          <Button tamanho="sm" onClick={() => markAtPlayhead('start')} atalho="I">{t.markIn}</Button>
          <Button tamanho="sm" onClick={() => markAtPlayhead('end')} atalho="O">{t.markOut}</Button>
        </div>}
        {opened && <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-fg-2" aria-label={t.shortcuts}>
          <li className="flex items-center gap-1.5"><Kbd teclas={['J', 'K', 'L']} /> {t.hintPlay}</li>
          <li className="flex items-center gap-1.5"><Kbd teclas={['I', 'O']} /> {t.hintMark}</li>
          <li className="flex items-center gap-1.5"><Kbd teclas={['←', '→']} /> {t.hintFrame}</li>
          <li className="flex items-center gap-1.5"><Kbd teclas={['↑', '↓']} /> {t.hintSentence}</li>
          <li className="flex items-center gap-1.5"><Kbd teclas={['[', ']']} /> {t.hintDrawers}</li>
        </ul>}
      </div>
      </div>

      <div role="region" aria-label={t.timeline} className="shrink-0 border-t border-line bg-surface">
        {timeline && timeline.state !== 'ready' && <p className="px-3 py-1 text-xs text-fg-2" role={timeline.state === 'failed' ? 'alert' : 'status'}>
          {timeline.state === 'failed' ? t.timelineFailed : `${t.timelinePreparing} ${timeline.progress}%`}
          {(timeline.state === 'queued' || timeline.state === 'running') && <> <Button tamanho="sm" variante="fantasma" onClick={() => void dispatchTimeline(timeline.job)}>{t.cancel}</Button></>}
        </p>}
        <div ref={scroller} className="relative overflow-x-auto overflow-y-hidden" style={{ height: ROW.thumbs + ROW.wave + ROW.sentences + 14 }}
          onClick={e => {
            if ((e.target as Element).closest('[data-editor-sentence]') || !scroller.current) return;
            const rect = scroller.current.getBoundingClientRect();
            seek(pxToUs(e.clientX - rect.left + scroller.current.scrollLeft, windowStartUs));
          }}>
          <div className="relative" style={{ width: totalPx, height: '100%' }}>
            <div className="absolute inset-x-0 top-0 bg-field" style={{ height: ROW.thumbs }} data-row="thumbs">
              {thumbs && visibleThumbs(thumbs.count, thumbs.intervalUs, visible).map(i => (
                <div key={i} data-thumb={i} className="absolute top-0" style={{ left: i * thumbs.width, width: thumbs.width, height: thumbs.height, backgroundImage: `url(${mediaUrl(thumbs.id)})`, backgroundSize: `${thumbs.columns * thumbs.width}px auto`, backgroundPosition: `-${(i % thumbs.columns) * thumbs.width}px -${Math.floor(i / thumbs.columns) * thumbs.height}px` }} />
              ))}
            </div>
            <div className="absolute inset-x-0" style={{ top: ROW.thumbs, height: ROW.wave }} data-row="wave">
              {wave && <canvas ref={canvas} data-wave aria-hidden className="absolute top-0" style={{ left: visible[0], height: ROW.wave }} />}
            </div>
            <div className="absolute inset-x-0" style={{ top: ROW.thumbs + ROW.wave + 4, height: ROW.sentences }} data-row="sentences">
              {shown.map(s => <button key={s.id} type="button" data-editor-sentence={s.id} data-in-clip={inClip(s)} aria-current={current?.id === s.id ? 'true' : undefined}
                onClick={() => { setRate(0); seek(s.startUs); }} title={s.text}
                className={`foco absolute top-0 overflow-hidden rounded-md border px-1.5 py-1 text-left text-xs leading-tight ${inClip(s) ? 'border-accent-line bg-accent-subtle text-fg' : 'border-line bg-field text-fg-3'} ${current?.id === s.id ? 'ring-1 ring-accent' : ''}`}
                style={{ left: usToPx(s.startUs, windowStartUs) + 1, width: Math.max(8, usToPx(s.endUs, windowStartUs) - usToPx(s.startUs, windowStartUs) - 2), height: ROW.sentences }}>
                <span className="mr-1 font-mono text-[10px] text-fg-3">{s.id}</span>{s.text}
              </button>)}
            </div>
            {range && <>
              <div aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent" style={{ left: usToPx(range.startUs, windowStartUs) }} />
              <div aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent" style={{ left: usToPx(range.endUs, windowStartUs) }} />
            </>}
            <div aria-hidden data-playhead className="pointer-events-none absolute inset-y-0 w-0.5 bg-fg" style={{ left: usToPx(sourceUs, windowStartUs) }} />
          </div>
        </div>
      </div>

      <GavetaBorda lado="esq" g={left} rotulo={t.transcript}>
        <CabecalhoGaveta acoes={<Button tamanho="sm" onClick={left.fechar}>{t.close.replace(/ .*/, '')}</Button>}><h3 className="font-semibold">{t.transcript}</h3></CabecalhoGaveta>
        <ol className="flex flex-col gap-1 overflow-y-auto p-3 text-sm">
          {sentences.map(s => <li key={s.id}><button type="button" data-foco-inicial={s.id === (current?.id ?? startId) ? true : undefined} onClick={() => { setRate(0); seek(s.startUs); }}
            className={`foco w-full rounded-md px-2 py-1 text-left ${inClip(s) ? 'bg-accent-subtle' : ''} ${current?.id === s.id ? 'ring-1 ring-accent' : ''}`}>
            <span className="mr-2 font-mono text-xs text-fg-3">{clock(s.startUs)}</span>{s.text}</button></li>)}
        </ol>
      </GavetaBorda>
      <GavetaBorda lado="dir" g={right} rotulo={t.borders}>
        <CabecalhoGaveta acoes={<Button tamanho="sm" onClick={right.fechar}>{t.close.replace(/ .*/, '')}</Button>}><h3 className="font-semibold">{t.borders}</h3></CabecalhoGaveta>
        <div className="flex flex-col gap-3 overflow-y-auto p-3 text-sm">
          <section aria-label={t.start}><h4 className="text-xs text-fg-2">{t.start} · #{startId}</h4><p>{startSentence?.text}</p>
            <div className="mt-1 flex gap-2"><Button tamanho="sm" data-foco-inicial onClick={() => moveEdge('start', -1)}>{t.startEarlier}</Button><Button tamanho="sm" onClick={() => moveEdge('start', 1)}>{t.startLater}</Button></div></section>
          <section aria-label={t.end}><h4 className="text-xs text-fg-2">{t.end} · #{endId}</h4><p>{endSentence?.text}</p>
            <div className="mt-1 flex gap-2"><Button tamanho="sm" onClick={() => moveEdge('end', -1)}>{t.endEarlier}</Button><Button tamanho="sm" onClick={() => moveEdge('end', 1)}>{t.endLater}</Button></div></section>
          {range && <p className="font-mono text-xs text-fg-2">{fill(t.duration, { value: clock(range.endUs - range.startUs) })}</p>}
          <p className="text-fg-2">{t.note}</p>
        </div>
      </GavetaBorda>
    </div>
  </section>;
}
