import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';

type Estimate = { model: string; device: string; compute_type: string; estimate_s: number; low_s: number; high_s: number; sample_us: number; cached: boolean; measured_at: number; cpu: boolean; warnings: string[] };
type Hardware = { no_compatible_gpu: boolean };
type Progress = { job: string; percentage: number; message: string };
const texts = {
  'pt-BR': { noGpu: 'Sem GPU compatível, a Transcrição pode demorar.', measure: 'Estimar tempo', again: 'Medir de novo', cancel: 'Cancelar estimativa', progress: 'Progresso da estimativa', result: 'Estimativa: cerca de {value} (entre {low} e {high}).', basis: 'Medida num trecho de {seconds} s da Fonte, com {setup}. É uma estimativa, não uma garantia.', cached: 'Velocidade medida em {date} neste hardware e reutilizada; o tempo vale para esta Fonte.', remote: 'Se preferir, o Motor Groq (envia áudio) é uma alternativa.', useRemote: 'Usar o Motor Groq', big: 'O modelo maior na CPU é bem mais lento que o Whisper small.', failed: 'Não foi possível medir o tempo.', cancelled: 'Estimativa cancelada.', lowRam: 'Pouca RAM disponível agora. O modelo maior na CPU pode travar o computador; feche outros programas antes de começar.', ramUnknown: 'Não foi possível medir a RAM disponível. O modelo maior na CPU precisa de bastante memória.', setupGpu: 'GPU', setupCpu: 'CPU' },
  en: { noGpu: 'No compatible GPU: Transcription may take a long time.', measure: 'Estimate time', again: 'Measure again', cancel: 'Cancel estimate', progress: 'Estimate progress', result: 'Estimate: about {value} (between {low} and {high}).', basis: 'Measured on a {seconds} s sample of the Source, using the {setup}. This is an estimate, not a guarantee.', cached: 'Speed measured on {date} on this hardware and reused; the time applies to this Source.', remote: 'If you prefer, the Groq Engine (sends audio) is an alternative.', useRemote: 'Use the Groq Engine', big: 'The larger model on the CPU is much slower than Whisper small.', failed: 'Could not measure the time.', cancelled: 'Estimate cancelled.', lowRam: 'Little RAM available right now. The larger model on the CPU may freeze the computer; close other programs before starting.', ramUnknown: 'Could not measure the available RAM. The larger model on the CPU needs a lot of memory.', setupGpu: 'GPU', setupCpu: 'CPU' },
};
export const ramTexts = { 'pt-BR': { lowRam: texts['pt-BR'].lowRam, ramUnknown: texts['pt-BR'].ramUnknown }, en: { lowRam: texts.en.lowRam, ramUnknown: texts.en.ramUnknown } };

export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  if (total < 90) return `${total} s`;
  const minutes = Math.round(total / 60);
  if (minutes < 90) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}
function message(error: unknown) { return typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error); }

/** Avisos de RAM não bloqueantes do modelo maior em CPU. */
export function RamWarnings({ codes }: { codes: string[] }) {
  const t = useText(ramTexts);
  return <>{codes.map(code => code === 'low_ram' ? <p key={code} role="note" className="w-full rounded-md border border-line bg-warning-subtle p-3">{t.lowRam}</p> : code === 'ram_unknown' ? <p key={code} role="note" className="w-full rounded-md border border-line bg-warning-subtle p-3">{t.ramUnknown}</p> : null)}</>;
}

/** Estimativa de tempo da Transcrição local, medida num trecho da Fonte, e o aviso de falta de GPU. */
export function LocalEstimate({ project, sourceId, onUseRemote }: { project: string; sourceId: number; onUseRemote: () => void }) {
  const t = useText(texts);
  const [noGpu, setNoGpu] = useState(false);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => { setEstimate(null); setError(''); }, [sourceId]);
  useEffect(() => {
    let active = true;
    coreDispatch<Hardware>('transcription.hardware.status', {}).then(s => { if (active) setNoGpu(s.no_compatible_gpu); }).catch(() => {});
    if (!isTauri()) return () => { active = false; };
    let unlisten: (() => void) | undefined;
    listen<Progress>('core-progress', e => { if (e.payload.job === 'transcription-estimate') setProgress(e.payload.percentage); }).then(fn => { if (active) unlisten = fn; else fn(); });
    return () => { active = false; unlisten?.(); };
  }, []);
  async function measure(remeasure: boolean) {
    setBusy(true); setProgress(0); setError('');
    try { setEstimate(await coreDispatch<Estimate>('transcription.estimate', { project, source_id: sourceId, remeasure })); }
    catch (e) { setError((e as { code?: string }).code === 'cancelled' ? t.cancelled : message(e) || t.failed); }
    finally { setBusy(false); }
  }
  const cpu = estimate ? estimate.cpu : noGpu;
  const setup = estimate ? `${estimate.model === 'whisper-turbo' ? 'Whisper large-v3-turbo' : 'Whisper small'} · ${estimate.device === 'cuda' ? t.setupGpu : t.setupCpu} · ${estimate.compute_type}` : '';
  return <div className="flex w-full flex-col gap-2 text-fg-2" aria-live="polite">
    {cpu && <p role="note" className="rounded-md border border-line bg-warning-subtle p-3 text-fg">{t.noGpu}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={busy} onClick={() => void measure(estimate !== null)}>{estimate ? t.again : t.measure}</Button>
      {busy && <><progress className="w-40 max-w-full" max={100} value={progress} aria-label={t.progress} /><Button onClick={() => { void coreDispatch('components.cancel', { id: 'transcription-estimate' }); }}>{t.cancel}</Button></>}
    </div>
    {estimate && <>
      <p className="text-fg">{t.result.replace('{value}', formatDuration(estimate.estimate_s)).replace('{low}', formatDuration(estimate.low_s)).replace('{high}', formatDuration(estimate.high_s))}</p>
      <p className="max-w-prose text-xs">{t.basis.replace('{seconds}', String(Math.round(estimate.sample_us / 1e6))).replace('{setup}', setup)} {estimate.cached && t.cached.replace('{date}', new Date(estimate.measured_at * 1000).toLocaleDateString())}</p>
      {estimate.model === 'whisper-turbo' && estimate.cpu && <p role="note" className="rounded-md border border-line bg-warning-subtle p-3 text-fg">{t.big}</p>}
      <RamWarnings codes={estimate.warnings} />
    </>}
    {cpu && <p className="text-xs">{t.remote} <Button variante="fantasma" className="underline" onClick={onUseRemote}>{t.useRemote}</Button></p>}
    {error && <p role="alert" className="text-danger">{error}</p>}
  </div>;
}
