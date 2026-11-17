import { useContext, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { coreDispatch } from '@/lib/core';
import { useComandosCtx } from '@/lib/comandos';
import { LanguageContext, useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { EngineChoice } from './EngineChoice';
import { languageLabel } from './SourceLanguage';
import { TranscriptTimeline } from './TranscriptTimeline';
import { Selection } from './Selection';
import { CutPreviewPanel } from './CutPreview';

type Job = { id: number; state: 'queued' | 'running' | 'uncertain' | 'completed' | 'cancelled' | 'failed'; progress: number; code?: string | null };
export type Transcript = { engine: 'local' | 'groq'; id: number; state: 'running' | 'complete'; resume_us: number; duration_us: number; words: number };
type Status = { language?: string | null; transcript: Transcript | null; job: Job | null };
type HardwareSummary = { fallback_reason?: string | null };
const texts = {
  'pt-BR': { start: 'Transcrever', resume: 'Retomar', cancel: 'Cancelar transcrição', working: 'Transcrevendo', queued: 'Transcrição na fila', done: 'Transcrição pronta', words: 'palavras', interrupted: 'Transcrição interrompida', failed: 'A transcrição falhou', progress: 'Progresso da transcrição', error: 'Não foi possível atualizar a transcrição.', cpuModelMissing: 'A GPU não pôde ser usada e o modelo de CPU (Whisper small) não está instalado. Baixe-o em Componentes.', openComponents: 'Abrir Componentes', fallbackTimeout: 'A verificação automática da GPU excedeu o tempo limite; a Transcrição local caiu para a CPU.', fallbackFailed: 'A verificação automática da GPU falhou; a Transcrição local caiu para a CPU.' },
  en: { start: 'Transcribe', resume: 'Resume', cancel: 'Cancel transcription', working: 'Transcribing', queued: 'Transcription queued', done: 'Transcript ready', words: 'words', interrupted: 'Transcription interrupted', failed: 'Transcription failed', progress: 'Transcription progress', error: 'Could not update the transcription.', cpuModelMissing: 'The GPU could not be used and the CPU model (Whisper small) is not installed. Download it in Components.', openComponents: 'Open Components', fallbackTimeout: 'Automatic GPU verification timed out; local Transcription fell back to CPU.', fallbackFailed: 'Automatic GPU verification failed; local Transcription fell back to CPU.' },
};
function message(error: unknown) { return typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error); }

/** Transcrição de uma Fonte: iniciar, ver o progresso, cancelar e retomar do último bloco. */
export function Transcription({ project, sourceId, available, sourceLanguage = 'pt', onLanguageChange }: { project: string; sourceId: number; available: boolean; sourceLanguage?: string; onLanguageChange?: () => Promise<void> }) {
  const t = useText(texts);
  const uiLang = useContext(LanguageContext);
  const commands = useComandosCtx();
  const [status, setStatus] = useState<Status>({ transcript: null, job: null });
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const [nextStatus, hw] = await Promise.all([
      coreDispatch<Status>('transcription.status', { source_id: sourceId }),
      coreDispatch<HardwareSummary>('transcription.hardware.status', {}).catch(() => ({ fallback_reason: null })),
    ]);
    setStatus(nextStatus);
    setFallbackReason(hw.fallback_reason ?? null);
  }
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const sync = () => { if (active) void refresh().catch(() => { if (active) setError(t.error); }); };
    sync();
    listen('core-progress', sync).then(fn => { if (active) unlisten = fn; else fn(); }).catch(() => {});
    const timer = window.setInterval(sync, 5000);
    return () => { active = false; unlisten?.(); window.clearInterval(timer); };
  }, [sourceId, t.error]);
  async function cancel(id: number) {
    setError(''); setBusy(true);
    try { await coreDispatch('jobs.cancel', { id }); await refresh(); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  const { transcript, job } = status;
  const language = status.language ?? sourceLanguage;
  const active = job?.state === 'queued' || job?.state === 'running';
  const percentage = transcript && transcript.duration_us > 0 ? Math.min(99, Math.floor((transcript.resume_us * 100) / transcript.duration_us)) : 0;
  const shown = job?.state === 'running' ? Math.max(job.progress, percentage) : percentage;
  const openComponents = () => { commands.lista().find(c => c.id === 'components')?.executar?.(); };
  const showFallback = fallbackReason && transcript?.engine !== 'groq';
  return <div className="mt-2 flex w-full flex-wrap items-center gap-3 text-sm" aria-live="polite">
    {transcript?.state === 'complete' && <span>{t.done} · {languageLabel(language, uiLang)} · {transcript.words} {t.words}</span>}
    {active && <><span>{job.state === 'queued' ? t.queued : `${t.working}: ${shown}%`} · {languageLabel(language, uiLang)}</span><progress className="w-40 max-w-full" max={100} value={shown} aria-label={t.progress} /><Button disabled={busy} onClick={() => void cancel(job.id)}>{t.cancel}</Button></>}
    {transcript?.state !== 'complete' && !active && <>
      {transcript && <span>{job?.state === 'failed' ? t.failed : t.interrupted} · {percentage}%</span>}
      {job?.state === 'failed' && job.code === 'model_missing' && <div role="alert" className="flex w-full flex-wrap items-center gap-3 text-danger"><span>{t.cpuModelMissing}</span><Button onClick={openComponents}>{t.openComponents}</Button></div>}
      <EngineChoice project={project} sourceId={sourceId} transcript={transcript} available={available} language={language} onStarted={refresh} onLanguageChange={async () => { await refresh(); await onLanguageChange?.(); }} />
    </>}
    {showFallback && <p role="note" className="w-full rounded-md border border-line bg-warning-subtle p-3 text-fg">{fallbackReason === 'probe_timeout' ? t.fallbackTimeout : t.fallbackFailed}</p>}
    {transcript?.state === 'complete' && <Selection sourceId={sourceId} />}
    {transcript?.state === 'complete' && <CutPreviewPanel sourceId={sourceId} />}
    {transcript?.state === 'complete' && <TranscriptTimeline sourceId={sourceId} />}
    {error && <span role="alert" className="text-danger">{error}</span>}
  </div>;
}

