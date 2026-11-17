import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';

type Status = { ffmpeg: boolean; detected: boolean; stale?: boolean; passed: string[]; selected?: string; manual?: string | null; effective: string };
const texts = {
  'pt-BR': { title: 'Encoder de vídeo do export', help: 'O Clipes testa cada encoder com um export curto e usa o mais rápido que funciona. O x264 é sempre o plano B.', label: 'Encoder', auto: 'Automático', detect: 'Detectar de novo', detecting: 'Testando encoders…', noFfmpeg: 'Instale o Componente FFmpeg para detectar o encoder.', notDetected: 'Ainda não detectado: o primeiro export testa os encoders.', stale: 'O FFmpeg ou o driver mudou; a próxima detecção refaz o teste.', using: 'Em uso:', done: 'Detecção concluída.', failed: 'Não foi possível concluir a operação.', names: { libx264: 'x264 (processador)', h264_nvenc: 'NVENC (NVIDIA)', h264_qsv: 'Quick Sync (Intel)', h264_amf: 'AMF (AMD)', h264_videotoolbox: 'VideoToolbox (Apple)' } as Record<string, string> },
  en: { title: 'Export video encoder', help: 'Clipes tests each encoder with a short export and uses the fastest one that works. x264 is always the fallback.', label: 'Encoder', auto: 'Automatic', detect: 'Detect again', detecting: 'Testing encoders…', noFfmpeg: 'Install the FFmpeg Component to detect the encoder.', notDetected: 'Not detected yet: the first export tests the encoders.', stale: 'FFmpeg or the driver changed; the next detection repeats the test.', using: 'In use:', done: 'Detection finished.', failed: 'Could not complete the operation.', names: { libx264: 'x264 (CPU)', h264_nvenc: 'NVENC (NVIDIA)', h264_qsv: 'Quick Sync (Intel)', h264_amf: 'AMF (AMD)', h264_videotoolbox: 'VideoToolbox (Apple)' } as Record<string, string> },
};
export function EncoderSettings() {
  const t = useText(texts);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { void coreDispatch<Status>('export.encoder.status', {}).then(setStatus).catch(() => setMessage(t.failed)); }, [t.failed]);
  async function run(command: string, args: object, success: string) {
    setBusy(true); setMessage('');
    try { setStatus(await coreDispatch<Status>(command, args)); setMessage(success); }
    catch { setMessage(t.failed); }
    finally { setBusy(false); }
  }
  const name = (id: string) => t.names[id] ?? id;
  return <section id="encoder-settings" className="mt-10 max-w-xl border-t border-line pt-8" aria-labelledby="encoder-settings-title">
    <h2 id="encoder-settings-title" className="text-lg font-semibold">{t.title}</h2>
    <p className="mt-2 text-sm text-fg-2">{t.help}</p>
    {status && !status.ffmpeg && <p className="mt-3 text-sm">{t.noFfmpeg}</p>}
    {status?.ffmpeg && <div className="mt-3 flex flex-col gap-3">
      <label>{t.label}<select className="foco mt-2 block h-9 w-72 rounded-md border border-line-strong bg-field px-3 text-fg" disabled={busy || !status.detected} value={status.manual ?? ''} onChange={event => void run('export.encoder.set', { encoder: event.target.value || null }, '')}>
        <option value="">{t.auto}</option>
        {status.passed.map(id => <option key={id} value={id}>{name(id)}</option>)}
      </select></label>
      <p className="text-sm">{status.detected ? `${t.using} ${name(status.effective)}` : status.stale ? t.stale : t.notDetected}</p>
      <div><Button type="button" disabled={busy} carregando={busy} onClick={() => void run('export.encoder.detect', {}, t.done)}>{busy ? t.detecting : t.detect}</Button></div>
    </div>}
    {message && <p className="mt-4 text-sm" role="status">{message}</p>}
  </section>;
}
