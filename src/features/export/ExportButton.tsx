import { useEffect, useRef, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Button } from '@/components/ui/Button';
import { coreDispatch, type ExportRequest } from '@/lib/core';
import { useText } from '@/lib/i18n';

type Status = { job: number; state: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'; progress: number; error?: { code: string } | null; encoder_fallback?: { from: string; reason: string } | null };
const texts = {
  'pt-BR': {
    export: 'Exportar', save: 'Salvar Corte', pending: 'Aprove este candidato para exportar.', queued: 'Export na fila.', running: 'Exportando Corte', cancel: 'Cancelar export', completed: 'Corte exportado.', cancelled: 'Export cancelado.', fallback: 'O encoder de hardware falhou; este Corte foi exportado com x264, mais lento. Veja Preferências.',
    errors: { export_exists: 'Já existe um arquivo no destino. Escolha outro nome.', export_destination: 'Escolha uma pasta existente e um nome MP4 válido.', export_candidate: 'Aprove o candidato e use as bordas atuais da revisão.', export_bounds: 'As bordas do Corte devem coincidir com Frases da Transcrição completa.', source_changed: 'A Fonte está indisponível ou foi alterada.', component_missing: 'Instale o Componente FFmpeg em Componentes.', export_ass_missing: 'O FFmpeg instalado não tem suporte a legendas. Escolha uma versão com libass em Componentes.', export_font_missing: 'A fonte da legenda não foi carregada. Verifique o Componente FFmpeg.', default: 'Não foi possível exportar o Corte.' } as Record<string, string>,
  },
  en: {
    export: 'Export', save: 'Save Clip', pending: 'Approve this candidate to export.', queued: 'Export queued.', running: 'Exporting Clip', cancel: 'Cancel export', completed: 'Clip exported.', cancelled: 'Export cancelled.', fallback: 'The hardware encoder failed; this Clip was exported with x264, which is slower. See Preferences.',
    errors: { export_exists: 'A file already exists at this destination. Choose another name.', export_destination: 'Choose an existing folder and a valid MP4 name.', export_candidate: 'Approve the candidate and use its current review borders.', export_bounds: 'Clip borders must match Sentences in the complete Transcript.', source_changed: 'The Source is unavailable or has changed.', component_missing: 'Install the FFmpeg Component in Components.', export_ass_missing: 'The installed FFmpeg does not support subtitles. Choose a build with libass in Components.', export_font_missing: 'The subtitle font could not be loaded. Check the FFmpeg Component.', default: 'Could not export the Clip.' } as Record<string, string>,
  },
};

export function exportFilename(title: string, id: number): string {
  let name = title.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\.mp4$/i, '').trim().replace(/[. ]+$/g, '').slice(0, 100).replace(/[. ]+$/g, '');
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `corte-${id}`;
  return `${name}.mp4`;
}

export function ExportButton({ sourceId, candidateId, clipId, title, startId, endId, approved }: { sourceId: number; candidateId: number; clipId?: number; title: string; startId?: number; endId?: number; approved: boolean }) {
  const t = useText(texts);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const active = status?.state === 'queued' || status?.state === 'running';
  useEffect(() => {
    if (!status || !active) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;
    const sync = () => coreDispatch<Status>('export.status', { job: status.job }).then(next => { if (mounted) setStatus(next); }).catch(() => { if (mounted) setError(t.errors.default); });
    void sync();
    listen<{ job: string }>('core-progress', event => { if (event.payload.job === String(status.job)) void sync(); }).then(fn => { if (mounted) unlisten = fn; else fn(); }).catch(() => {});
    const timer = window.setInterval(() => void sync(), 500);
    return () => { mounted = false; unlisten?.(); window.clearInterval(timer); };
  }, [status?.job, active, t.errors.default]);

  async function start() {
    if (!approved || !startId || !endId) return;
    setBusy(true); setError('');
    try {
      const settings = await coreDispatch<{ last_directory: string | null }>('export.settings', {});
      const filename = exportFilename(title, candidateId);
      const defaultPath = settings.last_directory ? `${settings.last_directory.replace(/[\\/]+$/, '')}/${filename}` : filename;
      const mock = import.meta.env.VITE_CORE_MOCK === '1' && !isTauri();
      const chosen = mock ? `/test/exports/${filename}` : await save({ title: t.save, defaultPath, filters: [{ name: 'MP4', extensions: ['mp4'] }] });
      if (!chosen || !alive.current) return;
      const output = /\.mp4$/i.test(chosen) ? chosen : `${chosen}.mp4`;
      setStatus(null);
      const request: ExportRequest = { source_id: sourceId, candidate_id: candidateId, start_id: startId, end_id: endId, clip_id: clipId };
      const answer = await coreDispatch<{ job: number }>('export.start', { ...request, output });
      if (alive.current) setStatus({ job: answer.job, state: 'queued', progress: 0 });
    } catch (e) {
      const code = typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '';
      if (alive.current) setError(t.errors[code] ?? t.errors.default);
    } finally { if (alive.current) setBusy(false); }
  }
  async function cancel() {
    if (!status) return;
    setBusy(true); setError('');
    try {
      await coreDispatch('jobs.cancel', { id: status.job });
      const next = await coreDispatch<Status>('export.status', { job: status.job });
      if (alive.current) setStatus(next);
    } catch { if (alive.current) setError(t.errors.default); }
    finally { if (alive.current) setBusy(false); }
  }
  const failed = status?.state === 'failed' ? t.errors[status.error?.code ?? 'default'] ?? t.errors.default : '';
  return <div className="flex flex-wrap items-center gap-2" data-export>
    <Button tamanho="sm" disabled={!approved || !startId || !endId || active} carregando={busy} title={approved ? undefined : t.pending} onClick={() => void start()}>{t.export}</Button>
    {active && <Button tamanho="sm" disabled={busy} onClick={() => void cancel()}>{t.cancel}</Button>}
    {status && <span role="status" className="text-sm text-fg-2">{status.state === 'running' ? `${t.running} · ${status.progress}%` : status.state === 'failed' ? '' : t[status.state]}</span>}
    {active && <progress value={status?.progress ?? 0} max={100} aria-label={t.running} className="w-28 max-w-full" />}
    {status?.state === 'completed' && status.encoder_fallback && <p role="status" className="text-sm text-fg-2" data-export-fallback>{t.fallback}</p>}
    {(error || failed) && <p role="alert" className="text-sm text-danger">{error || failed}</p>}
  </div>;
}
