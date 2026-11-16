import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';

/** Corte (ou candidato da seleção) a pré-visualizar: tempos em µs da Fonte. */
export type CutRange = { sourceId: number; startUs: number; endUs: number };
/** Pede ao preview aberto da Fonte que vá ao tempo `us` (µs da Fonte); a Transcrição usa ao clicar numa palavra. */
export type PreviewSeekEvent = { source_id: number; us: number };
export const previewSeekEvent = 'clipes-preview-seek';
export const previewOpenEvent = 'clipes-preview-open';
/** O preview aberto avisa o instante em que está (µs da Fonte); a capa (#74) usa para marcar o quadro. */
export type PreviewTimeEvent = { source_id: number; us: number };
export const previewTimeEvent = 'clipes-preview-time';
/** Abre o preview de um Corte ou candidato no painel da Fonte (#55 usa isto a partir da lista de candidatos). */
export function openCutPreview(cut: CutRange) { window.dispatchEvent(new CustomEvent<CutRange>(previewOpenEvent, { detail: cut })); }

type Proxy = { state: 'queued' | 'running' | 'ready' | 'failed' | 'cancelled' | 'missing'; key: string; job: number | null; progress: number; error: string | null; windowStartUs: number; windowEndUs: number };
type Status = Omit<Proxy, 'windowStartUs' | 'windowEndUs'>;

const texts = {
  'pt-BR': {
    title: 'Preview do Corte', video: 'Vídeo do preview em 9:16 com barras', play: 'Reproduzir', pause: 'Pausar', seek: 'Posição no preview', cancel: 'Cancelar preview', retry: 'Gerar de novo', close: 'Fechar preview',
    preparing: 'Preparando o preview do Corte', queued: 'Preview na fila', running: 'Gerando o preview', failed: 'Não foi possível gerar o preview.', cancelled: 'Preview cancelado.', outside: 'Esse trecho fica fora do preview deste Corte (a janela vai até 2 min antes e depois).', playError: 'O vídeo do preview não pôde ser tocado.', error: 'Não foi possível preparar o preview.',
    code: { source_offline: 'A Fonte está offline: reconecte ou relocalize a Fonte para ver o preview.', source_changed: 'A Fonte foi alterada: verifique a identidade dela antes do preview.', component_missing: 'Instale o Componente FFmpeg para gerar o preview.', clip_too_long: 'O Corte é longo demais para o preview.', invalid_range: 'Intervalo do Corte inválido.' } as Record<string, string>,
  },
  en: {
    title: 'Clip preview', video: '9:16 preview video with bars', play: 'Play', pause: 'Pause', seek: 'Preview position', cancel: 'Cancel preview', retry: 'Generate again', close: 'Close preview',
    preparing: 'Preparing the Clip preview', queued: 'Preview queued', running: 'Generating the preview', failed: 'Could not generate the preview.', cancelled: 'Preview cancelled.', outside: 'That part is outside this Clip’s preview (the window spans 2 min before and after).', playError: 'The preview video could not be played.', error: 'Could not prepare the preview.',
    code: { source_offline: 'The Source is offline: reconnect or relocate the Source to see the preview.', source_changed: 'The Source was changed: verify its identity before the preview.', component_missing: 'Install the FFmpeg Component to generate the preview.', clip_too_long: 'The Clip is too long for the preview.', invalid_range: 'Invalid Clip range.' } as Record<string, string>,
  },
};
function clock(us: number) { const s = Math.max(0, Math.floor(us / 1_000_000)); const h = Math.floor(s / 3600); const m = String(Math.floor(s / 60) % 60).padStart(2, '0'); const ss = String(s % 60).padStart(2, '0'); return h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`; }
function code(error: unknown) { return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''; }
/** Tempo da Fonte (µs) para o do proxy (s); `null` fora da janela. Igual a `proxy::to_proxy_us` do núcleo. */
export function toProxySeconds(sourceUs: number, windowStartUs: number, windowEndUs: number): number | null {
  return sourceUs >= windowStartUs && sourceUs <= windowEndUs ? (sourceUs - windowStartUs) / 1_000_000 : null;
}
const mediaUrl = (key: string) => (isTauri() ? convertFileSrc(`proxy/${key}`, 'clipes-media') : `/__clipes-media__/proxy/${key}`);

/** Preview 9:16 em Fit (barras, sem corte) de um Corte, sobre o proxy de GOP curto gerado pelo núcleo. */
/** `rate` (editor, #61): 0 pausa, >0 toca nessa velocidade, <0 volta por passos. `onSourceTime` informa o tempo da Fonte a cada atualização. */
export function CutPreview({ sourceId, startUs, endUs, rate, onSourceTime }: { sourceId: number; startUs: number; endUs: number; rate?: number; onSourceTime?: (sourceUs: number) => void }) {
  const t = useText(texts);
  const video = useRef<HTMLVideoElement>(null);
  const pending = useRef<number | null>(null);
  const [proxy, setProxy] = useState<Proxy | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [lastSeekUs, setLastSeekUs] = useState<number | null>(null);

  const request = useCallback(async (active: () => boolean) => {
    setError(null); setNotice('');
    try {
      const next = await coreDispatch<Proxy>('proxy.request', { source_id: sourceId, start_us: startUs, end_us: endUs });
      if (active()) setProxy(next);
    } catch (e) {
      if (active()) { setProxy(null); setError({ code: code(e), message: typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : '' }); }
    }
  }, [sourceId, startUs, endUs]);
  useEffect(() => {
    let alive = true;
    setProxy(null); setPlaying(false); setTime(0); setLastSeekUs(null); pending.current = null;
    void request(() => alive);
    return () => { alive = false; };
  }, [request]);

  // Acompanha o job enquanto gera: evento do núcleo e uma checagem periódica de reserva.
  const working = proxy?.state === 'queued' || proxy?.state === 'running';
  useEffect(() => {
    if (!working || !proxy) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    const sync = () => {
      coreDispatch<Status>('proxy.status', { key: proxy.key }).then(next => {
        if (!alive) return;
        if (next.state === 'missing') void request(() => alive);
        else setProxy(current => (current && current.key === next.key ? { ...current, ...next } : current));
      }).catch(() => { if (alive) setError({ code: '', message: '' }); });
    };
    if (isTauri()) listen('core-progress', sync).then(fn => { if (alive) unlisten = fn; else fn(); }).catch(() => {});
    const timer = window.setInterval(sync, 700);
    return () => { alive = false; unlisten?.(); window.clearInterval(timer); };
  }, [working, proxy?.key, request]);

  // Velocidade pedida pelo editor. Para trás o `<video>` não toca: volta em passos de 100 ms.
  useEffect(() => {
    const el = video.current;
    if (rate === undefined || !el || proxy?.state !== 'ready') return;
    if (rate > 0) { el.playbackRate = rate; el.play().catch(() => {}); return; }
    el.pause();
    if (rate === 0) return;
    const timer = window.setInterval(() => { el.currentTime = Math.max(0, el.currentTime + rate * 0.1); if (el.currentTime <= 0) window.clearInterval(timer); }, 100);
    return () => window.clearInterval(timer);
  }, [rate, proxy?.state]);

  const windowSeconds = proxy ? (proxy.windowEndUs - proxy.windowStartUs) / 1_000_000 : 0;
  function seekProxy(seconds: number) {
    const el = video.current;
    if (!el || el.readyState < 1) { pending.current = seconds; return; }
    el.currentTime = seconds;
    setTime(seconds);
  }
  // Clique numa palavra da Transcrição: mapeia o tempo da Fonte para o do proxy.
  useEffect(() => {
    const onSeek = (event: Event) => {
      const e = (event as CustomEvent<PreviewSeekEvent>).detail;
      if (e.source_id !== sourceId || !proxy) return;
      const mapped = toProxySeconds(e.us, proxy.windowStartUs, proxy.windowEndUs);
      if (mapped === null) { setNotice(t.outside); return; }
      setNotice(''); setLastSeekUs(e.us);
      if (proxy.state === 'ready') seekProxy(mapped); else pending.current = mapped;
    };
    window.addEventListener(previewSeekEvent, onSeek);
    return () => window.removeEventListener(previewSeekEvent, onSeek);
  }, [sourceId, proxy, t.outside]);

  function onLoaded() {
    const el = video.current;
    if (!el || !proxy) return;
    const start = pending.current ?? toProxySeconds(startUs, proxy.windowStartUs, proxy.windowEndUs) ?? 0;
    pending.current = null;
    el.currentTime = start; setTime(start);
  }
  function toggle() {
    const el = video.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => { if (isTauri()) setNotice(t.playError); }); else el.pause();
  }
  async function cancel() { if (proxy?.job != null) { try { await coreDispatch('jobs.cancel', { id: proxy.job }); } catch { setError({ code: '', message: '' }); } } }

  const sourceUs = proxy ? proxy.windowStartUs + time * 1_000_000 : startUs;
  return <section aria-label={t.title} data-preview-state={proxy?.state ?? (error ? 'error' : 'loading')} data-seek-us={lastSeekUs ?? undefined} className="flex w-full max-w-[18rem] flex-col gap-2 text-sm">
    {!proxy && !error && <p aria-live="polite" className="text-fg-2">{t.preparing}</p>}
    {error && <p role="alert" className="rounded-md border border-line bg-warning-subtle p-3 text-fg">{t.code[error.code] ?? t.error}</p>}
    {working && proxy && <div className="flex flex-col gap-2" aria-live="polite">
      <span>{proxy.state === 'queued' ? t.queued : `${t.running}: ${proxy.progress}%`}</span>
      <progress className="w-full" max={100} value={proxy.progress} aria-label={t.running} />
      <div><Button tamanho="sm" onClick={() => void cancel()}>{t.cancel}</Button></div>
    </div>}
    {(proxy?.state === 'failed' || proxy?.state === 'cancelled') && <div className="flex flex-col gap-2">
      <p role={proxy.state === 'failed' ? 'alert' : undefined}>{proxy.state === 'failed' ? (proxy.error && t.code[proxy.error]) || t.failed : t.cancelled}</p>
      <div><Button tamanho="sm" onClick={() => void request(() => true)}>{t.retry}</Button></div>
    </div>}
    {proxy?.state === 'ready' && <>
      <div className="aspect-[9/16] w-full overflow-hidden rounded-md border border-line bg-black">
        <video ref={video} src={mediaUrl(proxy.key)} aria-label={t.video} className="h-full w-full object-contain" playsInline preload="auto"
          onLoadedMetadata={onLoaded} onTimeUpdate={e => { setTime(e.currentTarget.currentTime); if (proxy) onSourceTime?.(proxy.windowStartUs + e.currentTarget.currentTime * 1_000_000); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
          onError={() => { if (isTauri()) setNotice(t.playError); }} />
      </div>
      <div className="flex items-center gap-2">
        <Button tamanho="sm" onClick={toggle}>{playing ? t.pause : t.play}</Button>
        <span className="font-mono text-xs text-fg-2" data-preview-clock>{clock(sourceUs)}</span>
      </div>
      <input type="range" aria-label={t.seek} min={0} max={windowSeconds} step={0.01} value={Math.min(time, windowSeconds)} onChange={e => seekProxy(Number(e.target.value))} className="w-full" />
    </>}
    {notice && <p role="status" className="text-fg-2">{notice}</p>}
  </section>;
}

/** Painel da Fonte: abre o preview do Corte pedido por `openCutPreview` e o fecha. */
export function CutPreviewPanel({ sourceId }: { sourceId: number }) {
  const t = useText(texts);
  const [cut, setCut] = useState<CutRange | null>(null);
  useEffect(() => {
    const onOpen = (event: Event) => {
      const next = (event as CustomEvent<CutRange>).detail;
      if (next.sourceId === sourceId) setCut(next);
    };
    window.addEventListener(previewOpenEvent, onOpen);
    return () => window.removeEventListener(previewOpenEvent, onOpen);
  }, [sourceId]);
  if (!cut) return null;
  return <div className="mt-3 flex flex-col gap-2">
    <CutPreview sourceId={cut.sourceId} startUs={cut.startUs} endUs={cut.endUs} />
    <div><Button tamanho="sm" onClick={() => setCut(null)}>{t.close}</Button></div>
  </div>;
}
