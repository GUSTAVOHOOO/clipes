import { useCallback, useEffect, useState } from 'react';
import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import type { TtsCatalog } from '@/features/components/TtsCatalogCard';
import { fill } from './selectionFormat';

type AudioInfo = {
  id: number;
  versionId: number;
  voiceId: string;
  modelId: string;
  relPath: string;
  durationUs: number;
  sampleRate: number;
  channels: number;
  bytes: number;
  stale: boolean;
};

type BlockAlignment = {
  status: 'pending' | 'aligned' | 'needs_review' | 'approved' | 'failed';
  choice: 'script' | 'spoken' | null;
  activeTrack: 'script' | 'spoken' | null;
  substitutions: number;
  insertions: number;
  deletions: number;
  maxConsecutiveInsertions: number;
  errorCode: string | null;
  modelId: string;
  spokenText: string | null;
  wordCount: number;
};

type NarrationBlock = {
  blockId: number;
  position: number;
  title: string;
  versionId: number | null;
  narrationText: string | null;
  audio: AudioInfo | null;
  alignment?: BlockAlignment | null;
};

type NarrationJob = {
  id: number;
  state: string;
  progress: number;
  code: string | null;
  blockId: number | null;
  voiceId: string;
  modelId: string;
};

type AlignJob = {
  id: number;
  state: string;
  progress: number;
  code: string | null;
  blockId: number | null;
};

type NarrationDoc = {
  candidate: number;
  narrationAllowed: boolean;
  gateReason: string | null;
  language: string;
  defaultVoiceId: string;
  activeModelId: string;
  busy: boolean;
  job: NarrationJob | null;
  alignBusy?: boolean;
  alignJob?: AlignJob | null;
  alignPrerequisitesReady?: boolean;
  blocks: NarrationBlock[];
  totalDurationUs: number;
};

const texts = {
  'pt-BR': {
    title: 'Narração por TTS (Pocket TTS)',
    locked: 'A Narração por TTS só é liberada quando todos os blocos do Roteiro estão aprovados.',
    voice: 'Voz da Narração',
    activeModel: 'Modelo ativo: {model}',
    generate: 'Gerar Narração',
    regenerateAll: 'Gerar tudo de novo',
    generating: 'Sintetizando…',
    cancel: 'Cancelar',
    block: 'Bloco {n}',
    regenerateBlock: 'Regenerar bloco',
    duration: 'Duração real: {sec} s',
    stale: 'desatualizada (Roteiro editado)',
    noAudio: 'Ainda sem áudio gerado.',
    totalDuration: 'Duração total da Narração: {sec} s',
    progress: 'Progresso da síntese',
    failed: 'Não foi possível sintetizar a Narração.',
    align: 'Alinhar Narração',
    realign: 'Realinhar Narração',
    aligning: 'Alinhando…',
    alignProgress: 'Progresso do alinhamento',
    alignBlock: 'Alinhar bloco',
    alignPendingPrereq: 'Alinhamento pendente: instale o Worker Python e um modelo Whisper local em Componentes para gerar legendas da Narração.',
    alignFailed: 'Não foi possível alinhar a Narração.',
    alignStatus: {
      pending: 'Alinhamento pendente',
      aligned: 'Alinhada ({words} palavras)',
      needs_review: 'Desvio do Roteiro — sem legenda até revisar',
      approved_script: 'Aprovada (texto do Roteiro)',
      approved_spoken: 'Aprovada (texto falado)',
      failed: 'Falha no alinhamento',
    },
    deviationSummary: 'O áudio diverge do Roteiro ({subs} substituições, {ins} inserções seguidas). Escolha qual texto vira legenda:',
    spokenPreview: 'Texto detectado na fala: “{text}”',
    useScriptText: 'Usar texto do Roteiro',
    useSpokenText: 'Usar texto falado',
    errors: {
      script_not_approved: 'Aprove todos os blocos do Roteiro antes de gerar a Narração.',
      component_missing: 'Instale o Componente Pocket TTS em Componentes.',
      tts_model_missing: 'Baixe o modelo TTS deste idioma em Componentes antes de gerar.',
      worker_missing: 'Instale o Worker Python em Componentes para alinhar a Narração.',
      model_missing: 'Baixe um modelo Whisper local em Componentes antes de alinhar.',
      narration_missing: 'Gere ou importe o áudio da Narração antes de alinhar.',
      narration_align_in_progress: 'Já há um alinhamento de Narração em andamento.',
      generation_in_progress: 'Já há uma síntese de Narração em andamento.',
      narration_failed: 'O motor Pocket TTS falhou ao sintetizar um bloco.',
      default: 'Não foi possível concluir a Narração.',
    } as Record<string, string>,
  },
  en: {
    title: 'Narration TTS (Pocket TTS)',
    locked: 'TTS Narration unlocks only after all Script blocks are approved.',
    voice: 'Narration voice',
    activeModel: 'Active model: {model}',
    generate: 'Generate Narration',
    regenerateAll: 'Regenerate all',
    generating: 'Synthesizing…',
    cancel: 'Cancel',
    block: 'Block {n}',
    regenerateBlock: 'Regenerate block',
    duration: 'Real duration: {sec} s',
    stale: 'outdated (Script edited)',
    noAudio: 'No audio generated yet.',
    totalDuration: 'Total Narration duration: {sec} s',
    progress: 'Synthesis progress',
    failed: 'Could not synthesize Narration.',
    align: 'Align Narration',
    realign: 'Realign Narration',
    aligning: 'Aligning…',
    alignProgress: 'Alignment progress',
    alignBlock: 'Align block',
    alignPendingPrereq: 'Alignment pending: install the Python Worker and a local Whisper model in Components to generate Narration captions.',
    alignFailed: 'Could not align Narration.',
    alignStatus: {
      pending: 'Alignment pending',
      aligned: 'Aligned ({words} words)',
      needs_review: 'Script deviation — captions paused until reviewed',
      approved_script: 'Approved (Script text)',
      approved_spoken: 'Approved (spoken text)',
      failed: 'Alignment failed',
    },
    deviationSummary: 'Spoken audio diverges from Script ({subs} substitutions, {ins} consecutive insertions). Choose which text to caption:',
    spokenPreview: 'Spoken words detected: “{text}”',
    useScriptText: 'Use Script text',
    useSpokenText: 'Use spoken text',
    errors: {
      script_not_approved: 'Approve all Script blocks before generating Narration.',
      component_missing: 'Install the Pocket TTS Component in Components.',
      tts_model_missing: 'Download this language’s TTS model in Components before generating.',
      worker_missing: 'Install the Python Worker in Components to align Narration.',
      model_missing: 'Download a local Whisper model in Components before aligning.',
      narration_missing: 'Generate or import Narration audio before aligning.',
      narration_align_in_progress: 'A Narration alignment is already running.',
      generation_in_progress: 'A Narration synthesis is already running.',
      narration_failed: 'Pocket TTS failed while synthesizing a block.',
      default: 'Could not complete Narration.',
    } as Record<string, string>,
  },
} as const;

const mediaUrl = (id: string) => (isTauri() ? convertFileSrc(id, 'clipes-media') : `/__clipes-media__/${id}`);
const codeOf = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '');
const fmtSeconds = (us: number) => (us / 1_000_000).toFixed(2);

/** Painel de síntese da Narração por bloco do Roteiro aprovado (#79). */
export function Narration({ candidate, refreshKey = 0, onChanged }: { candidate: number; refreshKey?: number; onChanged?: () => void }) {
  const t = useText(texts);
  const [doc, setDoc] = useState<NarrationDoc | null>(null);
  const [catalog, setCatalog] = useState<TtsCatalog | null>(null);
  const [voiceId, setVoiceId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [nextDoc, nextCat] = await Promise.all([
      coreDispatch<NarrationDoc>('narration.get', { candidate }),
      coreDispatch<TtsCatalog>('tts.catalog', {}).catch(() => null),
    ]);
    setDoc(nextDoc);
    if (nextCat) setCatalog(nextCat);
    setVoiceId(cur => cur || nextDoc.defaultVoiceId);
  }, [candidate]);

  useEffect(() => {
    let active = true;
    load().catch(() => { if (active) setError(t.errors.default); });
    return () => { active = false; };
  }, [load, refreshKey, t.errors.default]);

  const busy = doc?.busy === true;
  const alignBusy = doc?.alignBusy === true;
  const anyBusy = busy || alignBusy;
  useEffect(() => {
    if (!anyBusy) return;
    const sync = () => {
      coreDispatch<NarrationDoc>('narration.get', { candidate }).then(next => {
        setDoc(next);
        if (!next.busy && !next.alignBusy) onChanged?.();
      }).catch(() => {});
    };
    const timer = window.setInterval(sync, 700);
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      listen('core-progress', sync).then(fn => { unlisten = fn; });
    }
    return () => {
      window.clearInterval(timer);
      unlisten?.();
    };
  }, [anyBusy, candidate, onChanged]);

  async function generateAll() {
    setError('');
    try {
      await coreDispatch('narration.generate', { candidate, ...(voiceId ? { voiceId } : {}) });
      setDoc(await coreDispatch<NarrationDoc>('narration.get', { candidate }));
      onChanged?.();
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    }
  }

  async function regenerateBlock(block: number) {
    setError('');
    try {
      await coreDispatch('narration.regenerate_block', { candidate, block, ...(voiceId ? { voiceId } : {}) });
      setDoc(await coreDispatch<NarrationDoc>('narration.get', { candidate }));
      onChanged?.();
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    }
  }

  async function cancelJob() {
    const id = doc?.busy ? doc.job?.id : doc?.alignJob?.id;
    if (!id) return;
    try {
      await coreDispatch('jobs.cancel', { id });
      setDoc(await coreDispatch<NarrationDoc>('narration.get', { candidate }));
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    }
  }

  async function alignAll() {
    setError('');
    try {
      await coreDispatch('narration.align', { candidate });
      setDoc(await coreDispatch<NarrationDoc>('narration.get', { candidate }));
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    }
  }

  async function alignBlock(block: number) {
    setError('');
    try {
      await coreDispatch('narration.align_block', { candidate, block });
      setDoc(await coreDispatch<NarrationDoc>('narration.get', { candidate }));
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    }
  }

  async function reviewBlock(block: number, choice: 'script' | 'spoken') {
    setError('');
    try {
      await coreDispatch('narration.review', { candidate, block, choice });
      setDoc(await coreDispatch<NarrationDoc>('narration.get', { candidate }));
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    }
  }

  if (!doc) return error ? <p role="alert" className="text-danger">{error}</p> : null;

  const voices = (catalog?.voices ?? []).filter(v => v.language === doc.language);
  const hasAnyAudio = doc.blocks.some(b => b.audio !== null && !b.audio.stale);
  const hasAlignedAudio = doc.blocks.some(b => b.audio && !b.audio.stale && b.alignment && b.alignment.status !== 'pending');
  const jobFailed = doc.job && (doc.job.state === 'failed' || doc.job.state === 'cancelled');
  const alignJobFailed = doc.alignJob && (doc.alignJob.state === 'failed' || doc.alignJob.state === 'cancelled');

  return (
    <section aria-label={t.title} data-narration className="flex flex-col gap-2 rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{t.title}</h3>
        <span className="text-xs text-fg-2">{fill(t.activeModel, { model: doc.activeModelId })}</span>
      </div>

      {!doc.narrationAllowed && <p className="text-xs text-fg-2" data-narration-locked>{t.locked}</p>}

      <div className="flex flex-wrap items-end gap-2">
        {voices.length > 0 && (
          <label className="flex flex-col gap-1 text-xs">
            {t.voice}
            <select
              className="foco h-8 rounded-md border border-line-strong bg-field px-2 text-sm text-fg"
              value={voiceId}
              disabled={busy}
              onChange={e => setVoiceId(e.target.value)}
            >
              {voices.map(v => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </label>
        )}
        <Button
          variante="primario"
          tamanho="sm"
          disabled={!doc.narrationAllowed || anyBusy}
          carregando={busy}
          onClick={() => void generateAll()}
        >
          {busy ? t.generating : hasAnyAudio ? t.regenerateAll : t.generate}
        </Button>
        {hasAnyAudio && (
          <Button
            tamanho="sm"
            disabled={anyBusy}
            carregando={alignBusy}
            onClick={() => void alignAll()}
          >
            {alignBusy ? t.aligning : hasAlignedAudio ? t.realign : t.align}
          </Button>
        )}
        {busy && doc.job && (
          <>
            <progress max={100} value={doc.job.progress} aria-label={t.progress} />
            <Button tamanho="sm" onClick={() => void cancelJob()}>{t.cancel}</Button>
          </>
        )}
        {alignBusy && doc.alignJob && (
          <>
            <progress max={100} value={doc.alignJob.progress} aria-label={t.alignProgress} />
            <Button tamanho="sm" onClick={() => void cancelJob()}>{t.cancel}</Button>
          </>
        )}
      </div>

      {hasAnyAudio && doc.alignPrerequisitesReady === false && (
        <p className="text-xs text-fg-2" data-narration-align-pending>{t.alignPendingPrereq}</p>
      )}
      {jobFailed && <p role="alert" className="text-xs text-danger">{t.errors[doc.job?.code ?? ''] ?? t.failed}</p>}
      {alignJobFailed && <p role="alert" className="text-xs text-danger">{t.errors[doc.alignJob?.code ?? ''] ?? t.alignFailed}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}

      {doc.blocks.length > 0 && (
        <ol className="flex flex-col gap-2">
          {doc.blocks.map(b => {
            const al = b.alignment;
            const alignLabel = !b.audio || b.audio.stale || !al
              ? null
              : al.status === 'aligned'
                ? fill(t.alignStatus.aligned, { words: al.wordCount })
                : al.status === 'approved'
                  ? (al.choice === 'spoken' ? t.alignStatus.approved_spoken : t.alignStatus.approved_script)
                  : al.status === 'needs_review'
                    ? t.alignStatus.needs_review
                    : al.status === 'failed'
                      ? t.alignStatus.failed
                      : t.alignStatus.pending;
            return (
              <li key={b.blockId} data-narration-block={b.blockId} className="flex flex-col gap-1 rounded-md border border-line p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{fill(t.block, { n: b.position })} · {b.title}</span>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-fg-2">
                    {b.audio ? (
                      <>
                        <span data-narration-duration={b.audio.durationUs}>{fill(t.duration, { sec: fmtSeconds(b.audio.durationUs) })}</span>
                        <span>{b.audio.voiceId} · {b.audio.modelId}</span>
                        {b.audio.stale && <span className="text-danger">{t.stale}</span>}
                        {alignLabel && (
                          <span data-narration-align-status={al?.status} className={al?.status === 'needs_review' || al?.status === 'failed' ? 'text-danger font-medium' : ''}>
                            {alignLabel}
                          </span>
                        )}
                      </>
                    ) : (
                      <span>{t.noAudio}</span>
                    )}
                    {b.audio && !b.audio.stale && (
                      <Button tamanho="sm" disabled={anyBusy} onClick={() => void alignBlock(b.blockId)}>
                        {t.alignBlock}
                      </Button>
                    )}
                    <Button
                      tamanho="sm"
                      disabled={!doc.narrationAllowed || anyBusy}
                      onClick={() => void regenerateBlock(b.blockId)}
                    >
                      {t.regenerateBlock}
                    </Button>
                  </div>
                </div>
                {b.audio && !b.audio.stale && (
                  <audio controls preload="none" className="mt-1 h-8 w-full" src={mediaUrl(`narration/${b.audio.id}`)} />
                )}
                {b.audio && !b.audio.stale && al && (al.status === 'needs_review' || al.status === 'approved') && al.spokenText && (
                  <div data-narration-review={b.blockId} className="mt-1 flex flex-col gap-1 rounded border border-line-strong bg-surface p-2 text-xs">
                    <p className={al.status === 'needs_review' ? 'font-medium text-danger' : 'text-fg-2'}>
                      {fill(t.deviationSummary, { subs: al.substitutions, ins: al.maxConsecutiveInsertions })}
                    </p>
                    <p className="text-fg-2">{fill(t.spokenPreview, { text: al.spokenText })}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        tamanho="sm"
                        variante={al.choice === 'script' ? 'primario' : 'secundario'}
                        disabled={anyBusy}
                        onClick={() => void reviewBlock(b.blockId, 'script')}
                      >
                        {t.useScriptText}
                      </Button>
                      <Button
                        tamanho="sm"
                        variante={al.choice === 'spoken' ? 'primario' : 'secundario'}
                        disabled={anyBusy}
                        onClick={() => void reviewBlock(b.blockId, 'spoken')}
                      >
                        {t.useSpokenText}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {doc.totalDurationUs > 0 && (
        <p className="text-xs text-fg-2" data-narration-total>{fill(t.totalDuration, { sec: fmtSeconds(doc.totalDurationUs) })}</p>
      )}
    </section>
  );
}
