import { useEffect, useId, useRef, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { useComandosCtx } from '@/lib/comandos';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LocalEstimate, RamWarnings } from './LocalEstimate';
import { SourceLanguageSelect } from './SourceLanguage';
import type { Transcript } from './Transcription';

type Engine = 'local' | 'groq';
type Info = { endpoint: string; configured: boolean; confirmed: boolean; local_only: boolean };
type Estimate = { kind: string; usd?: number; hourly_usd?: number; checked?: string; source?: string };
type Loss = { blocks: number | null; paid_audio_us: number; paid_usd: number };
type Pending = { kind: 'replace'; loss: Loss } | { kind: 'remote'; replace: boolean } | { kind: 'retry'; estimate: Estimate };
type Grouping = { enabled: boolean; mode: 'auto' | 'manual'; size: number; measured_size: number | null };
const texts = {
  'pt-BR': { engine: 'Motor de transcrição', language: 'Idioma da Fonte', local: 'Local · nesta máquina', remote: 'Groq · envia áudio', start: 'Transcrever', resume: 'Retomar', change: 'Trocar e transcrever', configure: 'Configurar chave', openComponents: 'Abrir Componentes', missingBoth: 'FFmpeg e o Motor de transcrição local não estão instalados. Instale-os em Componentes.', missingFfmpeg: 'O Componente FFmpeg não está instalado (ou está incompleto). Instale-o em Componentes.', missingEngine: 'O Motor de transcrição local (worker ou modelo) não está instalado. Instale-o em Componentes.', groupingOffAuto: 'Agrupamento por VAD: desligado, automático (na GPU usa mais VRAM sem ganho medido; ajuste em Componentes).', groupingOnAuto: 'Agrupamento por VAD: ligado, automático, lote {size} (na CPU acelera; ajuste em Componentes).', groupingOffManual: 'Agrupamento por VAD: desligado por escolha sua (ajuste em Componentes).', groupingOnManual: 'Agrupamento por VAD: ligado por escolha sua, lote {size} (ajuste em Componentes).', unknown: 'Custo estimado: desconhecido.', cost: 'Custo estimado: US$ {value}.', rate: 'US$ {value}/hora · fonte oficial consultada em {date}. Mínimo de 10 s por chamada; a cobrança pode variar nas fronteiras dos blocos.', retryTitle: 'Repetir chamada incerta?', retry: 'O resultado da chamada anterior é incerto. Repetir pode gerar nova cobrança.', privacyTitle: 'Enviar áudio ao Groq?', privacy: 'O áudio da faixa escolhida da Fonte sai desta máquina e é enviado para {endpoint}. A chave fica no cofre do sistema. O consentimento vale para este endpoint.', unknownBlocks: 'quantidade indisponível (Transcrição de versão anterior)', replaceTitle: 'Apagar Transcrição parcial?', replace: 'Blocos concluídos que serão apagados: {blocks}. Áudio Groq já enviado e possivelmente cobrado: {seconds} s (estimativa US$ {cost}); esse valor não é reembolsado. A nova Transcrição começa do zero e usa só o Motor escolhido.', cancel: 'Cancelar', confirm: 'Confirmar e transcrever', failed: 'Não foi possível iniciar a Transcrição.', localOnly: 'Este Projeto permite somente processamento local.' },
  en: { engine: 'Transcription engine', language: 'Source language', local: 'Local · on this machine', remote: 'Groq · sends audio', start: 'Transcribe', resume: 'Resume', change: 'Switch and transcribe', configure: 'Configure key', openComponents: 'Open Components', missingBoth: 'FFmpeg and the local Transcription engine are not installed. Install them in Components.', missingFfmpeg: 'The FFmpeg Component is not installed (or is incomplete). Install it in Components.', missingEngine: 'The local Transcription engine (worker or model) is not installed. Install it in Components.', groupingOffAuto: 'VAD grouping: off, automatic (on the GPU it uses more VRAM with no measured gain; adjust in Components).', groupingOnAuto: 'VAD grouping: on, automatic, batch {size} (on the CPU it speeds things up; adjust in Components).', groupingOffManual: 'VAD grouping: off by your choice (adjust in Components).', groupingOnManual: 'VAD grouping: on by your choice, batch {size} (adjust in Components).', unknown: 'Estimated cost: unknown.', cost: 'Estimated cost: US$ {value}.', rate: 'US$ {value}/hour · official source checked on {date}. Minimum 10 s per call; billing may vary at block boundaries.', retryTitle: 'Repeat uncertain call?', retry: 'The previous call has an uncertain result. Repeating it may incur another charge.', privacyTitle: 'Send audio to Groq?', privacy: 'Audio from the selected Source track leaves this machine and is sent to {endpoint}. The key stays in the system vault. Consent applies to this endpoint.', unknownBlocks: 'count unavailable (Transcript from an earlier version)', replaceTitle: 'Delete partial Transcript?', replace: 'Completed blocks that will be deleted: {blocks}. Groq audio already sent and possibly charged: {seconds} s (estimated US$ {cost}); this amount is not refunded. The new Transcript starts over and uses only the chosen engine.', cancel: 'Cancel', confirm: 'Confirm and transcribe', failed: 'Could not start the Transcript.', localOnly: 'This Project only allows local processing.' },
};

export function EngineChoice({ project, sourceId, transcript, available, language, onStarted, onLanguageChange }: { project: string; sourceId: number; transcript: Transcript | null; available: boolean; language: string; onStarted: () => Promise<void>; onLanguageChange: () => Promise<void> }) {
  const t = useText(texts);
  const id = useId();
  const langId = useId();
  const commands = useComandosCtx();
  const focus = useRef<HTMLButtonElement>(null);
  const [engine, setEngine] = useState<Engine>(transcript?.engine ?? 'local');
  const [info, setInfo] = useState<Info | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [missingSetup, setMissingSetup] = useState<{ ffmpeg: boolean; engine: boolean }>({ ffmpeg: false, engine: false });
  const [missingComponentError, setMissingComponentError] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [grouping, setGrouping] = useState<Grouping | null>(null);
  const openComponents = () => { commands.lista().find(c => c.id === 'components')?.executar?.(); };
  useEffect(() => { setEngine(transcript?.engine ?? 'local'); }, [transcript?.id, transcript?.engine]);
  useEffect(() => {
    let active = true;
    Promise.all([
      coreDispatch<{ incomplete: boolean; installed?: boolean }>('components.ffmpeg.status', {}),
      coreDispatch<{ worker_installed: boolean; effective: { model: string }; options: { model: string; installed: boolean }[] }>('transcription.hardware.status', {}),
      coreDispatch<Grouping>('transcription.grouping', {}).catch(() => null),
    ]).then(([ffmpeg, hw, grp]) => {
      if (!active) return;
      const ffmpegMissing = ffmpeg.incomplete || ffmpeg.installed === false;
      const modelInstalled = hw.options.some(o => o.model === hw.effective.model && o.installed);
      setMissingSetup({ ffmpeg: ffmpegMissing, engine: !hw.worker_installed || !modelInstalled });
      if (grp) setGrouping(grp);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    if (engine === 'groq') {
      setInfo(null); setEstimate(null);
      Promise.all([coreDispatch<Info>('transcription.groq.info', {}), coreDispatch<Estimate>('transcription.groq.estimate', { source_id: sourceId })]).then(([i, e]) => { if (active) { setInfo(i); setEstimate(e); } }).catch(() => { if (active) setError(t.failed); });
    }
    return () => { active = false; };
  }, [engine, sourceId, transcript?.resume_us, t.failed]);
  const cost = estimate?.kind === 'usd' && typeof estimate.usd === 'number' ? t.cost.replace('{value}', estimate.usd.toFixed(5)) : t.unknown;

  const canEditLanguage = !transcript || (transcript.state !== 'complete' && transcript.resume_us === 0);

  async function changeLanguage(next: string) {
    setBusy(true); setError('');
    try {
      await coreDispatch('sources.language.set', { project, id: sourceId, language: next });
      await onLanguageChange();
    } catch (e) {
      setError((e as { message?: string }).message ?? t.failed);
    } finally {
      setBusy(false);
    }
  }

  async function start(replace = false, consent = false, retry = false) {
    setBusy(true); setError(''); setMissingComponentError(false);
    try {
      if (consent && info) await coreDispatch('transcription.groq.confirm', { endpoint: info.endpoint, confirmed: true });
      const started = await coreDispatch<{ warnings?: string[] }>('transcription.start', { project, source_id: sourceId, engine, replace_confirmed: replace, retry_confirmed: retry });
      setWarnings(started.warnings ?? []);
      await onStarted();
    } catch (e) {
      const failure = e as { code?: string; message?: string; usage?: Loss & { estimate?: Estimate } };
      if (failure.code === 'engine_change_confirmation' && failure.usage) setPending({ kind: 'replace', loss: failure.usage });
      else if (failure.code === 'transcription_retry_confirmation' && failure.usage?.estimate) setPending({ kind: 'retry', estimate: failure.usage.estimate });
      else if (failure.code === 'confirmation_required' && engine === 'groq') setPending({ kind: 'remote', replace });
      else {
        if (failure.code === 'component_missing' || failure.code === 'worker_missing' || failure.code === 'model_missing') setMissingComponentError(true);
        setError(failure.message ?? t.failed);
      }
    } finally { setBusy(false); }
  }
  const description = pending?.kind === 'replace'
    ? t.replace.replace('{blocks}', pending.loss.blocks === null ? t.unknownBlocks : String(pending.loss.blocks)).replace('{seconds}', (pending.loss.paid_audio_us / 1e6).toFixed(1)).replace('{cost}', pending.loss.paid_usd.toFixed(5))
    : pending?.kind === 'retry' ? `${t.retry} ${pending.estimate.usd !== undefined ? t.cost.replace('{value}', pending.estimate.usd.toFixed(5)) : t.unknown}`
    : `${t.privacy.replace('{endpoint}', info?.endpoint ?? 'https://api.groq.com/openai/v1/audio/transcriptions')} ${cost}`;
  const showProactiveSetup = missingSetup.ffmpeg || (engine === 'local' && missingSetup.engine);
  return <div className="flex w-full flex-wrap items-center gap-3">
    <label htmlFor={langId} className="text-fg-2">{t.language}</label>
    <SourceLanguageSelect id={langId} className="foco min-h-8 max-w-full rounded-md border border-line-strong bg-field px-2 text-fg" value={language} disabled={busy || pending !== null || !canEditLanguage} onChange={v => void changeLanguage(v)} />
    <label htmlFor={id} className="text-fg-2">{t.engine}</label>
    <select id={id} className="foco min-h-8 max-w-full rounded-md border border-line-strong bg-field px-2 text-fg" value={engine} disabled={busy || pending !== null} onChange={e => { setEngine(e.target.value as Engine); setError(''); setMissingComponentError(false); }}>
      <option value="local">{t.local}</option><option value="groq">{t.remote}</option>
    </select>
    {engine === 'groq' && info && !info.configured && <Button variante="fantasma" className="underline" onClick={() => commands.lista().find(c => c.id === 'preferences')?.executar?.()}>{t.configure}</Button>}
    <Button ref={focus} disabled={busy || !available || (engine === 'groq' && (!info?.configured || info.local_only || !estimate))} onClick={() => void start()}>{transcript && transcript.engine !== engine ? t.change : transcript ? t.resume : t.start}</Button>
    {showProactiveSetup && <div role="note" className="flex w-full flex-wrap items-center gap-3 rounded-md border border-line bg-warning-subtle p-3 text-fg"><span>{missingSetup.ffmpeg && engine === 'local' && missingSetup.engine ? t.missingBoth : missingSetup.ffmpeg ? t.missingFfmpeg : t.missingEngine}</span><Button onClick={openComponents}>{t.openComponents}</Button></div>}
    {engine === 'groq' && <div className="w-full text-fg-2"><p>{cost}</p>{estimate?.hourly_usd !== undefined && <p className="mt-1 max-w-prose text-xs">{t.rate.replace('{value}', String(estimate.hourly_usd)).replace('{date}', estimate.checked ?? '')} <a className="foco underline" href={estimate.source} target="_blank" rel="noreferrer">Groq</a></p>}{info?.local_only && <p role="alert" className="text-danger">{t.localOnly}</p>}</div>}
    {engine === 'local' && available && <LocalEstimate project={project} sourceId={sourceId} onUseRemote={() => setEngine('groq')} />}
    {engine === 'local' && grouping && <p className="w-full text-xs text-fg-2">{t[`grouping${grouping.enabled ? 'On' : 'Off'}${grouping.mode === 'auto' ? 'Auto' : 'Manual'}` as 'groupingOnAuto'].replace('{size}', String(grouping.size))}</p>}
    <RamWarnings codes={warnings} />
    {error && <div className="flex w-full flex-wrap items-center gap-3"><p role="alert" className="text-danger">{error}</p>{missingComponentError && <Button onClick={openComponents}>{t.openComponents}</Button>}</div>}
    <ConfirmDialog open={pending !== null} onOpenChange={open => { if (!open) setPending(null); }} title={pending?.kind === 'replace' ? t.replaceTitle : pending?.kind === 'retry' ? t.retryTitle : t.privacyTitle} description={description} cancelLabel={t.cancel} confirmLabel={t.confirm} finalFocus={focus} onConfirm={() => { const next = pending; setPending(null); if (next) void start(next.kind === 'replace' || (next.kind === 'remote' && next.replace), next.kind === 'remote', next.kind === 'retry'); }} />
  </div>;
}
