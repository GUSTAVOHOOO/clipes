import { useEffect, useId, useRef, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { useComandosCtx } from '@/lib/comandos';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { Transcript } from './Transcription';

type Engine = 'local' | 'groq';
type Info = { endpoint: string; configured: boolean; confirmed: boolean; local_only: boolean };
type Estimate = { kind: string; usd?: number; hourly_usd?: number; checked?: string; source?: string };
type Loss = { blocks: number; paid_audio_us: number; paid_usd: number };
type Pending = { kind: 'replace'; loss: Loss } | { kind: 'remote'; replace: boolean };
const texts = {
  'pt-BR': { engine: 'Motor de transcrição', local: 'Local · nesta máquina', remote: 'Groq · envia áudio', start: 'Transcrever', resume: 'Retomar', change: 'Trocar e transcrever', configure: 'Configurar chave', unknown: 'Custo estimado: desconhecido.', cost: 'Custo estimado: US$ {value}.', rate: 'US$ {value}/hora · fonte oficial consultada em {date}. Mínimo de 10 s por chamada; a cobrança pode variar nas fronteiras dos blocos.', privacyTitle: 'Enviar áudio ao Groq?', privacy: 'O áudio da faixa escolhida da Fonte sai desta máquina e é enviado para {endpoint}. A chave fica no cofre do sistema. O consentimento vale para este endpoint.', replaceTitle: 'Apagar Transcrição parcial?', replace: 'A troca apaga {blocks} blocos concluídos. Áudio Groq já enviado e possivelmente cobrado: {seconds} s (estimativa US$ {cost}); esse valor não é reembolsado. A nova Transcrição começa do zero e usa só o Motor escolhido.', cancel: 'Cancelar', confirm: 'Confirmar e transcrever', failed: 'Não foi possível iniciar a Transcrição.', localOnly: 'Este Projeto permite somente processamento local.' },
  en: { engine: 'Transcription engine', local: 'Local · on this machine', remote: 'Groq · sends audio', start: 'Transcribe', resume: 'Resume', change: 'Switch and transcribe', configure: 'Configure key', unknown: 'Estimated cost: unknown.', cost: 'Estimated cost: US$ {value}.', rate: 'US$ {value}/hour · official source checked on {date}. Minimum 10 s per call; billing may vary at block boundaries.', privacyTitle: 'Send audio to Groq?', privacy: 'Audio from the selected Source track leaves this machine and is sent to {endpoint}. The key stays in the system vault. Consent applies to this endpoint.', replaceTitle: 'Delete partial Transcript?', replace: 'Switching deletes {blocks} completed blocks. Groq audio already sent and possibly charged: {seconds} s (estimated US$ {cost}); this amount is not refunded. The new Transcript starts over and uses only the chosen engine.', cancel: 'Cancel', confirm: 'Confirm and transcribe', failed: 'Could not start the Transcript.', localOnly: 'This Project only allows local processing.' },
};

export function EngineChoice({ project, sourceId, transcript, available, onStarted }: { project: string; sourceId: number; transcript: Transcript | null; available: boolean; onStarted: () => Promise<void> }) {
  const t = useText(texts);
  const id = useId();
  const commands = useComandosCtx();
  const focus = useRef<HTMLButtonElement>(null);
  const [engine, setEngine] = useState<Engine>(transcript?.engine ?? 'local');
  const [info, setInfo] = useState<Info | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setEngine(transcript?.engine ?? 'local'); }, [transcript?.id, transcript?.engine]);
  useEffect(() => {
    let active = true;
    if (engine === 'groq') {
      setInfo(null); setEstimate(null);
      Promise.all([coreDispatch<Info>('transcription.groq.info', {}), coreDispatch<Estimate>('transcription.groq.estimate', { source_id: sourceId })]).then(([i, e]) => { if (active) { setInfo(i); setEstimate(e); } }).catch(() => { if (active) setError(t.failed); });
    }
    return () => { active = false; };
  }, [engine, sourceId, transcript?.resume_us, t.failed]);
  const cost = estimate?.kind === 'usd' && typeof estimate.usd === 'number' ? t.cost.replace('{value}', estimate.usd.toFixed(5)) : t.unknown;

  async function start(replace = false, consent = false) {
    setBusy(true); setError('');
    try {
      if (consent && info) await coreDispatch('transcription.groq.confirm', { endpoint: info.endpoint, confirmed: true });
      await coreDispatch('transcription.start', { project, source_id: sourceId, engine, replace_confirmed: replace });
      await onStarted();
    } catch (e) {
      const failure = e as { code?: string; message?: string; usage?: Loss };
      if (failure.code === 'engine_change_confirmation' && failure.usage) setPending({ kind: 'replace', loss: failure.usage });
      else if (failure.code === 'confirmation_required' && engine === 'groq') setPending({ kind: 'remote', replace });
      else setError(failure.message ?? t.failed);
    } finally { setBusy(false); }
  }
  const description = pending?.kind === 'replace'
    ? t.replace.replace('{blocks}', String(pending.loss.blocks)).replace('{seconds}', (pending.loss.paid_audio_us / 1e6).toFixed(1)).replace('{cost}', pending.loss.paid_usd.toFixed(5))
    : `${t.privacy.replace('{endpoint}', info?.endpoint ?? 'https://api.groq.com/openai/v1/audio/transcriptions')} ${cost}`;
  return <div className="flex w-full flex-wrap items-center gap-3">
    <label htmlFor={id} className="text-fg-2">{t.engine}</label>
    <select id={id} className="foco min-h-8 max-w-full rounded-md border border-line-strong bg-field px-2 text-fg" value={engine} disabled={busy || pending !== null} onChange={e => { setEngine(e.target.value as Engine); setError(''); }}>
      <option value="local">{t.local}</option><option value="groq">{t.remote}</option>
    </select>
    {engine === 'groq' && info && !info.configured && <Button variante="fantasma" className="underline" onClick={() => commands.lista().find(c => c.id === 'preferences')?.executar?.()}>{t.configure}</Button>}
    <Button ref={focus} disabled={busy || !available || (engine === 'groq' && (!info?.configured || info.local_only || !estimate))} onClick={() => void start()}>{transcript && transcript.engine !== engine ? t.change : transcript ? t.resume : t.start}</Button>
    {engine === 'groq' && <div className="w-full text-fg-2"><p>{cost}</p>{estimate?.hourly_usd !== undefined && <p className="mt-1 max-w-prose text-xs">{t.rate.replace('{value}', String(estimate.hourly_usd)).replace('{date}', estimate.checked ?? '')} <a className="foco underline" href={estimate.source} target="_blank" rel="noreferrer">Groq</a></p>}{info?.local_only && <p role="alert" className="text-danger">{t.localOnly}</p>}</div>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    <ConfirmDialog open={pending !== null} onOpenChange={open => { if (!open) setPending(null); }} title={pending?.kind === 'replace' ? t.replaceTitle : t.privacyTitle} description={description} cancelLabel={t.cancel} confirmLabel={t.confirm} finalFocus={focus} onConfirm={() => { const next = pending; setPending(null); if (next) void start(next.kind === 'replace' || next.replace, next.kind === 'remote'); }} />
  </div>;
}
