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

type NarrationBlock = {
  blockId: number;
  position: number;
  title: string;
  versionId: number | null;
  narrationText: string | null;
  audio: AudioInfo | null;
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

type NarrationDoc = {
  candidate: number;
  narrationAllowed: boolean;
  gateReason: string | null;
  language: string;
  defaultVoiceId: string;
  activeModelId: string;
  busy: boolean;
  job: NarrationJob | null;
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
    errors: {
      script_not_approved: 'Aprove todos os blocos do Roteiro antes de gerar a Narração.',
      component_missing: 'Instale o Componente Pocket TTS em Componentes.',
      tts_model_missing: 'Baixe o modelo TTS deste idioma em Componentes antes de gerar.',
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
    errors: {
      script_not_approved: 'Approve all Script blocks before generating Narration.',
      component_missing: 'Install the Pocket TTS Component in Components.',
      tts_model_missing: 'Download this language’s TTS model in Components before generating.',
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
  useEffect(() => {
    if (!busy) return;
    const sync = () => {
      coreDispatch<NarrationDoc>('narration.get', { candidate }).then(next => {
        setDoc(next);
        if (!next.busy) onChanged?.();
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
  }, [busy, candidate, onChanged]);

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
    if (!doc?.job) return;
    try {
      await coreDispatch('jobs.cancel', { id: doc.job.id });
      setDoc(await coreDispatch<NarrationDoc>('narration.get', { candidate }));
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    }
  }

  if (!doc) return error ? <p role="alert" className="text-danger">{error}</p> : null;

  const voices = (catalog?.voices ?? []).filter(v => v.language === doc.language);
  const hasAnyAudio = doc.blocks.some(b => b.audio !== null);
  const jobFailed = doc.job && (doc.job.state === 'failed' || doc.job.state === 'cancelled');

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
          disabled={!doc.narrationAllowed || busy}
          carregando={busy}
          onClick={() => void generateAll()}
        >
          {busy ? t.generating : hasAnyAudio ? t.regenerateAll : t.generate}
        </Button>
        {busy && doc.job && (
          <>
            <progress max={100} value={doc.job.progress} aria-label={t.progress} />
            <Button tamanho="sm" onClick={() => void cancelJob()}>{t.cancel}</Button>
          </>
        )}
      </div>

      {jobFailed && <p role="alert" className="text-xs text-danger">{t.errors[doc.job?.code ?? ''] ?? t.failed}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}

      {doc.blocks.length > 0 && (
        <ol className="flex flex-col gap-2">
          {doc.blocks.map(b => (
            <li key={b.blockId} data-narration-block={b.blockId} className="flex flex-col gap-1 rounded-md border border-line p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{fill(t.block, { n: b.position })} · {b.title}</span>
                <div className="flex flex-wrap items-center gap-2 text-xs text-fg-2">
                  {b.audio ? (
                    <>
                      <span data-narration-duration={b.audio.durationUs}>{fill(t.duration, { sec: fmtSeconds(b.audio.durationUs) })}</span>
                      <span>{b.audio.voiceId} · {b.audio.modelId}</span>
                      {b.audio.stale && <span className="text-danger">{t.stale}</span>}
                    </>
                  ) : (
                    <span>{t.noAudio}</span>
                  )}
                  <Button
                    tamanho="sm"
                    disabled={!doc.narrationAllowed || busy}
                    onClick={() => void regenerateBlock(b.blockId)}
                  >
                    {t.regenerateBlock}
                  </Button>
                </div>
              </div>
              {b.audio && !b.audio.stale && (
                <audio controls preload="none" className="mt-1 h-8 w-full" src={mediaUrl(`narration/${b.audio.id}`)} />
              )}
            </li>
          ))}
        </ol>
      )}

      {doc.totalDurationUs > 0 && (
        <p className="text-xs text-fg-2" data-narration-total>{fill(t.totalDuration, { sec: fmtSeconds(doc.totalDurationUs) })}</p>
      )}
    </section>
  );
}
