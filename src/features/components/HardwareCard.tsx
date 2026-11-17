import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { hardwareTexts } from './hardwareTexts';

type Config = { model: string; device: string; compute_type: string };
type Option = Config & { enabled: boolean; reason: string | null; installed: boolean };
type Gpu = { name: string; driver: string; total_mib: number; free_mib: number };
type Ram = { total: number; available: number };
type Probe = { measured_at: number; verified: boolean; chosen: Config };
type Grouping = { enabled: boolean; size: number; measured_size: number | null };
export type HardwareStatus = { gpu: Gpu | null; ram: Ram | null; cuda: boolean; no_compatible_gpu: boolean; effective: Config; manual: boolean; fallback_reason?: string | null; probe: Probe | null; options: Option[]; worker_installed: boolean };
type Progress = { job: string; percentage: number; message: string };
function message(error: unknown) { return typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error); }
const key = (c: Config) => `${c.model}|${c.device}|${c.compute_type}`;
const gigabytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** Hardware da Transcrição local: o que foi detectado, a escolha em uso e a troca manual. */
export function HardwareCard() {
  const t = useText(hardwareTexts);
  const [status, setStatus] = useState<HardwareStatus | null>(null);
  const [grouping, setGrouping] = useState<Grouping | null>(null);
  const [probing, setProbing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState('');
  const [note, setNote] = useState('');
  async function refresh() {
    const [nextStatus, nextGrouping] = await Promise.all([
      coreDispatch<HardwareStatus>('transcription.hardware.status', {}),
      coreDispatch<Grouping>('transcription.grouping', {}),
    ]);
    setStatus(nextStatus);
    setGrouping(nextGrouping);
  }
  useEffect(() => {
    refresh().catch(e => setNote(message(e)));
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    listen<Progress>('core-progress', e => { if (e.payload.job === 'hardware-probe') { setProgress(e.payload.percentage); setStep(e.payload.message); } }).then(fn => { unlisten = fn; });
    return () => unlisten?.();
  }, []);
  async function probe() {
    setProbing(true); setProgress(0); setStep(''); setNote('');
    try { await coreDispatch('transcription.hardware.probe', {}); setNote(t.probed); }
    catch (e) { setNote((e as { code?: string }).code === 'cancelled' ? t.cancelled : message(e)); }
    finally { setProbing(false); try { await refresh(); } catch (e) { setNote(message(e)); } }
  }
  async function choose(value: string) {
    setNote('');
    try {
      if (value === 'auto') setStatus(await coreDispatch<HardwareStatus>('transcription.hardware.choose', { reset: true }));
      else { const [model, device, compute_type] = value.split('|'); setStatus(await coreDispatch<HardwareStatus>('transcription.hardware.choose', { model, device, compute_type })); }
      setGrouping(await coreDispatch<Grouping>('transcription.grouping', {}));
    } catch (e) { setNote(message(e)); }
  }
  async function toggleGrouping(enabled: boolean) {
    setNote('');
    try { setGrouping(await coreDispatch<Grouping>('transcription.grouping', { enabled })); }
    catch (e) { setNote(message(e)); }
  }
  const label = (c: Config) => `${c.model === 'whisper-turbo' ? t.turbo : t.small} · ${c.device === 'cuda' ? t.gpu : t.cpu} · ${c.compute_type}`;
  const reason = (r: string | null) => r === 'ram_insufficient' ? t.ramInsufficient : r === 'no_cuda' ? t.noCuda : '';
  const selected = status ? (status.manual ? key(status.effective) : 'auto') : 'auto';
  const turboOnCpu = status?.effective.model === 'whisper-turbo' && status.effective.device === 'cpu';
  const groupingTargetSize = status?.effective.device === 'cpu' ? 8 : (grouping?.measured_size ?? 1);
  return <section className="mt-4" aria-labelledby="hardware-title">
    <h2 id="hardware-title" className="font-semibold">{t.title}</h2>
    <p className="mt-2 text-fg-2">{t.intro}</p>
    {status && <>
      <ul className="mt-3 space-y-1">
        <li>{status.gpu ? t.gpuLine.replace('{name}', status.gpu.name).replace('{driver}', status.gpu.driver).replace('{free}', String(status.gpu.free_mib)).replace('{total}', String(status.gpu.total_mib)) : t.noNvidia}</li>
        <li>{status.ram ? t.ramLine.replace('{total}', gigabytes(status.ram.total)).replace('{available}', gigabytes(status.ram.available)) : t.ramUnknown}</li>
        <li>{t.inUse}: <strong>{label(status.effective)}</strong> ({status.manual ? t.manual : t.automatic})</li>
        <li>{status.probe ? t.lastProbe.replace('{date}', new Date(status.probe.measured_at * 1000).toLocaleDateString()).replace('{verified}', status.probe.verified ? t.verified : t.notVerified) : t.neverProbed}</li>
        {(status.cuda || grouping?.measured_size != null) && <li>{grouping?.measured_size != null ? t.safeBatchMeasured.replace('{size}', String(grouping.measured_size)) : t.safeBatchUnmeasured}</li>}
      </ul>
      {status.fallback_reason && <p className="mt-3 rounded-md border border-line bg-warning-subtle p-3" role="note">{status.fallback_reason === 'probe_timeout' ? t.fallbackTimeout : t.fallbackFailed}</p>}
      {status.no_compatible_gpu && <p className="mt-3 rounded-md border border-line bg-warning-subtle p-3" role="note">{t.noGpu} {t.amdIntel}</p>}
      {turboOnCpu && <p className="mt-3 rounded-md border border-line bg-warning-subtle p-3" role="note">{t.turboCpu}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">{t.choice}
          <select className="foco min-h-8 rounded-md border border-line-strong bg-field px-2 text-fg" value={selected} disabled={probing} onChange={e => void choose(e.target.value)}>
            <option value="auto">{t.automatic}</option>
            {status.options.map(o => <option key={key(o)} value={key(o)} disabled={!o.enabled}>{label(o)}{o.enabled ? '' : ` — ${reason(o.reason)}`}</option>)}
          </select>
        </label>
        {status.manual && <Button disabled={probing} onClick={() => void choose('auto')}>{t.reset}</Button>}
      </div>
      {grouping && <label className="mt-3 flex items-start gap-3 text-sm">
        <input type="checkbox" role="switch" className="foco mt-1" checked={grouping.enabled} disabled={probing} onChange={e => void toggleGrouping(e.target.checked)} />
        <span><strong>{t.groupingLabel}</strong><span className="mt-1 block text-fg-2">{t.groupingHelp.replace('{size}', String(groupingTargetSize))}</span></span>
      </label>}
    </>}
    {note && <p className="mt-2" role="status">{note}</p>}
    <div className="mt-3 flex items-center gap-3">
      <Button disabled={probing || !status?.worker_installed} onClick={() => void probe()}>{t.probe}</Button>
      {probing && <><progress max={100} value={progress} aria-label={t.progress} /><span className="text-fg-2">{step}</span><Button onClick={() => { void coreDispatch('components.cancel', { id: 'hardware-probe' }); }}>{t.cancel}</Button></>}
    </div>
    {status && !status.worker_installed && <p className="mt-2 text-fg-2">{t.needWorker}</p>}
  </section>;
}
