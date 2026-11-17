import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { coreDispatch } from '@/lib/core';
import { mediaUrl } from '@/lib/media';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { TtsCatalog } from '@/features/components/TtsCatalogCard';
import { fill } from './selectionFormat';
import { TeleprompterRecorder } from './TeleprompterRecorder';

type CleanupInfo = {
  applicable: boolean;
  enabled: boolean;
  ready: boolean;
  noiseFloorDb: number | null;
  noiseFloorSource: 'pending' | 'vad' | 'default';
  warningCode: string | null;
  warning: string | null;
};

type AudioInfo = {
  id: number;
  versionId: number;
  voiceId: string;
  modelId: string;
  engineId?: string;
  relPath: string;
  durationUs: number;
  sampleRate: number;
  channels: number;
  bytes: number;
  stale: boolean;
  trimmed?: boolean;
  cleanup?: CleanupInfo | null;
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

type ImportJob = {
  id: number;
  state: string;
  progress: number;
  code: string | null;
  blockId: number;
  warning: string | null;
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
  importBusy?: boolean;
  importJob?: ImportJob | null;
  alignBusy?: boolean;
  alignJob?: AlignJob | null;
  alignPrerequisitesReady?: boolean;
  vadReady?: boolean;
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
    recordBlock: 'Gravar bloco',
    recordedLabel: 'Gravada',
    untrimmedLabel: 'não aparada (aparo de silêncio indisponível: instale o worker)',
    trimNow: 'Aparar agora',
    trimSuccess: 'Silêncios da gravação aparados.',
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
    importAudio: 'Importar áudio',
    importing: 'Importando áudio…',
    importProgress: 'Progresso da importação',
    importFailed: 'Não foi possível importar o áudio.',
    importMultiStreamWarning: 'O arquivo tinha mais de uma faixa de áudio; apenas a primeira foi usada.',
    importedAudio: 'Áudio importado',
    recordedAudio: 'Áudio gravado',
    cleanupLabel: 'Limpeza de voz',
    previewBefore: 'Antes (original)',
    previewAfter: 'Depois (limpa)',
    preparingCleanup: 'Limpando…',
    noiseFloorMeasured: 'Piso medido: {db} dB',
    cleanupWarnings: {
      vad_unavailable: 'Piso de ruído padrão (-50 dB): instale o worker para medir o ruído da gravação.',
      insufficient_silence: 'Trecho sem fala insuficiente para medir o ruído; usando piso padrão (-50 dB).',
    } as Record<string, string>,
    audioFilter: 'Áudio',
    replaceTitle: 'Substituir áudio do bloco?',
    replaceDescription: 'Este bloco já tem {kind}. Importar um novo arquivo vai substituir o áudio atual e refazer o alinhamento.',
    replaceKinds: { tts: 'Narração por TTS', imported: 'um áudio importado', recorded: 'uma gravação de voz' },
    replaceCancel: 'Cancelar',
    replaceConfirm: 'Escolher arquivo',
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
      no_speech_detected: 'Nenhuma fala detectada na gravação.',
      invalid_audio_path: 'Selecione um arquivo de áudio válido.',
      import_file_missing: 'Arquivo de áudio não encontrado.',
      import_unsupported_format: 'Formato de áudio não suportado. Use WAV, MP3, M4A ou OGG.',
      import_empty_file: 'O arquivo de áudio está vazio.',
      import_file_too_large: 'O arquivo de áudio ultrapassa o limite de 200 MiB.',
      import_no_audio_stream: 'O arquivo não contém faixa de áudio.',
      import_unsupported_codec: 'Codec de áudio não suportado. Use WAV, MP3, M4A ou OGG.',
      import_invalid_audio: 'Não foi possível ler os metadados ou o áudio do arquivo.',
      import_duration_too_short: 'O áudio importado deve ter pelo menos 0,3 segundos.',
      import_duration_too_long: 'O áudio importado ultrapassa o limite de 10 minutos por bloco.',
      import_failed: 'Não foi possível converter o áudio importado para Narração.',
      import_in_progress: 'Já há uma importação de áudio em andamento.',
      ffprobe_missing: 'Instale o Componente FFmpeg (com ffprobe) em Componentes.',
      ffmpeg_missing: 'Instale o Componente FFmpeg em Componentes para aplicar a limpeza de voz.',
      cleanup_not_applicable: 'A limpeza de voz só se aplica a Narração gravada ou importada.',
      narration_cleanup_failed: 'Não foi possível aplicar a limpeza de voz neste bloco.',
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
    recordBlock: 'Record block',
    recordedLabel: 'Recorded',
    untrimmedLabel: 'untrimmed (silence trimming unavailable: install the worker)',
    trimNow: 'Trim now',
    trimSuccess: 'Recording silences trimmed.',
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
    importAudio: 'Import audio',
    importing: 'Importing audio…',
    importProgress: 'Import progress',
    importFailed: 'Could not import audio.',
    importMultiStreamWarning: 'The file had multiple audio streams; only the first one was used.',
    importedAudio: 'Imported audio',
    recordedAudio: 'Recorded audio',
    cleanupLabel: 'Voice cleanup',
    previewBefore: 'Before (original)',
    previewAfter: 'After (cleaned)',
    preparingCleanup: 'Cleaning…',
    noiseFloorMeasured: 'Measured floor: {db} dB',
    cleanupWarnings: {
      vad_unavailable: 'Default noise floor (-50 dB): install the worker to measure recording noise.',
      insufficient_silence: 'Not enough non-speech to measure noise; using default floor (-50 dB).',
    } as Record<string, string>,
    audioFilter: 'Audio',
    replaceTitle: 'Replace block audio?',
    replaceDescription: 'This block already has {kind}. Importing a new file will replace the current audio and redo alignment.',
    replaceKinds: { tts: 'TTS Narration', imported: 'imported audio', recorded: 'a voice recording' },
    replaceCancel: 'Cancel',
    replaceConfirm: 'Choose file',
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
      no_speech_detected: 'No speech detected in the recording.',
      invalid_audio_path: 'Choose a valid audio file.',
      import_file_missing: 'Audio file not found.',
      import_unsupported_format: 'Unsupported audio format. Use WAV, MP3, M4A, or OGG.',
      import_empty_file: 'The audio file is empty.',
      import_file_too_large: 'The audio file exceeds the 200 MiB limit.',
      import_no_audio_stream: 'The file does not contain an audio stream.',
      import_unsupported_codec: 'Unsupported audio codec. Use WAV, MP3, M4A, or OGG.',
      import_invalid_audio: 'Could not read audio metadata or stream from the file.',
      import_duration_too_short: 'Imported audio must be at least 0.3 seconds long.',
      import_duration_too_long: 'Imported audio exceeds the 10-minute limit per block.',
      import_failed: 'Could not convert the imported audio for Narration.',
      import_in_progress: 'An audio import is already running.',
      ffprobe_missing: 'Install the FFmpeg Component (with ffprobe) in Components.',
      ffmpeg_missing: 'Install the FFmpeg Component in Components to apply voice cleanup.',
      cleanup_not_applicable: 'Voice cleanup only applies to recorded or imported Narration.',
      narration_cleanup_failed: 'Could not apply voice cleanup to this block.',
      default: 'Could not complete Narration.',
    } as Record<string, string>,
  },
} as const;

const codeOf = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '');
const fmtSeconds = (us: number) => (us / 1_000_000).toFixed(2);

/** Painel de síntese da Narração por bloco do Roteiro aprovado (#79). */
export function Narration({ candidate, refreshKey = 0, onChanged }: { candidate: number; refreshKey?: number; onChanged?: () => void }) {
  const t = useText(texts);
  const [doc, setDoc] = useState<NarrationDoc | null>(null);
  const [catalog, setCatalog] = useState<TtsCatalog | null>(null);
  const [voiceId, setVoiceId] = useState('');
  const [error, setError] = useState('');
  const [recordNotice, setRecordNotice] = useState('');
  const [recordingBlockId, setRecordingBlockId] = useState<number | null>(null);
  const [replacePending, setReplacePending] = useState<{ blockId: number; kind: 'tts' | 'imported' | 'recorded' } | null>(null);
  const [previewMode, setPreviewMode] = useState<Record<number, 'original' | 'clean'>>({});
  const [preparingCleanupBlock, setPreparingCleanupBlock] = useState<number | null>(null);
  const importFocusRef = useRef<HTMLButtonElement>(null);

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
  const importBusy = doc?.importBusy === true;
  const alignBusy = doc?.alignBusy === true;
  const anyBusy = busy || importBusy || alignBusy;
  useEffect(() => {
    if (!anyBusy) return;
    const sync = () => {
      coreDispatch<NarrationDoc>('narration.get', { candidate }).then(next => {
        setDoc(next);
        if (!next.busy && !next.importBusy && !next.alignBusy) onChanged?.();
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
    const id = doc?.busy ? doc.job?.id : doc?.importBusy ? doc.importJob?.id : doc?.alignJob?.id;
    if (!id) return;
    try {
      await coreDispatch('jobs.cancel', { id });
      setDoc(await coreDispatch<NarrationDoc>('narration.get', { candidate }));
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    }
  }

  async function importBlockAudio(blockId: number) {
    setError('');
    try {
      const mock = import.meta.env.VITE_CORE_MOCK === '1' && !isTauri();
      const chosen = mock
        ? `/test/narration/block-${blockId}.mp3`
        : await open({
            multiple: false,
            filters: [{ name: t.audioFilter, extensions: ['wav', 'mp3', 'm4a', 'ogg'] }],
          });
      if (!chosen || Array.isArray(chosen)) return;
      await coreDispatch('narration.import', { candidate, block: blockId, path: chosen });
      setDoc(await coreDispatch<NarrationDoc>('narration.get', { candidate }));
      onChanged?.();
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    }
  }

  function requestImportBlock(b: NarrationBlock, btn: HTMLButtonElement) {
    importFocusRef.current = btn;
    if (b.audio && !b.audio.stale) {
      const kind = b.audio.engineId === 'imported'
        ? 'imported'
        : b.audio.engineId === 'recorded'
          ? 'recorded'
          : 'tts';
      setReplacePending({ blockId: b.blockId, kind });
    } else {
      void importBlockAudio(b.blockId);
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

  async function trimBlock(block: number) {
    setError('');
    setRecordNotice('');
    try {
      await coreDispatch('narration.trim_block', { candidate, block });
      setDoc(await coreDispatch<NarrationDoc>('narration.get', { candidate }));
      setRecordNotice(t.trimSuccess);
      onChanged?.();
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    }
  }

  async function handleRecordedSaved(warning?: string) {
    setError('');
    setRecordNotice(warning ?? '');
    setDoc(await coreDispatch<NarrationDoc>('narration.get', { candidate }));
    onChanged?.();
  }

  async function toggleCleanup(block: number, enabled: boolean) {
    setError('');
    try {
      await coreDispatch('narration.cleanup.set', { candidate, block, enabled });
      setDoc(await coreDispatch<NarrationDoc>('narration.get', { candidate }));
      if (!enabled) {
        setPreviewMode(cur => ({ ...cur, [block]: 'original' }));
      }
      onChanged?.();
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    }
  }

  async function selectPreviewMode(b: NarrationBlock, mode: 'original' | 'clean') {
    setError('');
    if (mode === 'original') {
      setPreviewMode(cur => ({ ...cur, [b.blockId]: 'original' }));
      return;
    }
    if (b.audio?.cleanup?.ready) {
      setPreviewMode(cur => ({ ...cur, [b.blockId]: 'clean' }));
      return;
    }
    setPreparingCleanupBlock(b.blockId);
    try {
      await coreDispatch('narration.cleanup.prepare', { candidate, block: b.blockId });
      setDoc(await coreDispatch<NarrationDoc>('narration.get', { candidate }));
      setPreviewMode(cur => ({ ...cur, [b.blockId]: 'clean' }));
      onChanged?.();
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    } finally {
      setPreparingCleanupBlock(cur => (cur === b.blockId ? null : cur));
    }
  }

  if (!doc) return error ? <p role="alert" className="text-danger">{error}</p> : null;

  const voices = (catalog?.voices ?? []).filter(v => v.language === doc.language);
  const hasAnyAudio = doc.blocks.some(b => b.audio !== null && !b.audio.stale);
  const hasAlignedAudio = doc.blocks.some(b => b.audio && !b.audio.stale && b.alignment && b.alignment.status !== 'pending');
  const jobFailed = doc.job && (doc.job.state === 'failed' || doc.job.state === 'cancelled');
  const importJobFailed = doc.importJob && (doc.importJob.state === 'failed' || doc.importJob.state === 'cancelled');
  const importMultiStreamWarn = doc.importJob?.state === 'completed' && doc.importJob.warning === 'multiple_audio_streams';
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
        {importBusy && doc.importJob && (
          <>
            <span className="text-xs text-fg-2">{t.importing}</span>
            <progress max={100} value={doc.importJob.progress} aria-label={t.importProgress} />
            <Button tamanho="sm" onClick={() => void cancelJob()}>{t.cancel}</Button>
          </>
        )}
      </div>

      {hasAnyAudio && doc.alignPrerequisitesReady === false && (
        <p className="text-xs text-fg-2" data-narration-align-pending>{t.alignPendingPrereq}</p>
      )}
      {importMultiStreamWarn && (
        <p role="note" className="text-xs text-fg-2" data-narration-import-warning>{t.importMultiStreamWarning}</p>
      )}
      {jobFailed && <p role="alert" className="text-xs text-danger">{t.errors[doc.job?.code ?? ''] ?? t.failed}</p>}
      {importJobFailed && <p role="alert" className="text-xs text-danger">{t.errors[doc.importJob?.code ?? ''] ?? t.importFailed}</p>}
      {alignJobFailed && <p role="alert" className="text-xs text-danger">{t.errors[doc.alignJob?.code ?? ''] ?? t.alignFailed}</p>}
      {recordNotice && <p role="status" className="text-xs text-warning" data-narration-record-notice>{recordNotice}</p>}
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
                        <span data-narration-source={b.audio.engineId ?? 'pocket-tts'}>
                          {b.audio.engineId === 'imported'
                            ? t.importedAudio
                            : b.audio.engineId === 'recorded'
                              ? t.recordedAudio
                              : `${b.audio.voiceId} · ${b.audio.modelId}`}
                        </span>
                        {b.audio.engineId === 'recorded' && b.audio.trimmed === false && (
                          <span className="text-warning" data-narration-untrimmed>{t.untrimmedLabel}</span>
                        )}
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
                    {b.audio && !b.audio.stale && b.audio.engineId === 'recorded' && b.audio.trimmed === false && doc.vadReady !== false && (
                      <Button tamanho="sm" disabled={anyBusy} data-trim-block={b.blockId} onClick={() => void trimBlock(b.blockId)}>
                        {t.trimNow}
                      </Button>
                    )}
                    {b.audio && !b.audio.stale && (
                      <Button tamanho="sm" disabled={anyBusy} onClick={() => void alignBlock(b.blockId)}>
                        {t.alignBlock}
                      </Button>
                    )}
                    <Button
                      tamanho="sm"
                      disabled={!doc.narrationAllowed || anyBusy}
                      data-record-block={b.blockId}
                      onClick={() => setRecordingBlockId(cur => (cur === b.blockId ? null : b.blockId))}
                    >
                      {t.recordBlock}
                    </Button>
                    <Button
                      tamanho="sm"
                      disabled={!doc.narrationAllowed || anyBusy}
                      onClick={e => requestImportBlock(b, e.currentTarget)}
                    >
                      {t.importAudio}
                    </Button>
                    <Button
                      tamanho="sm"
                      disabled={!doc.narrationAllowed || anyBusy}
                      onClick={() => void regenerateBlock(b.blockId)}
                    >
                      {t.regenerateBlock}
                    </Button>
                  </div>
                </div>
                {b.audio && !b.audio.stale && b.audio.cleanup?.applicable ? (
                  (() => {
                    const cleanup = b.audio.cleanup;
                    const activeMode: 'original' | 'clean' =
                      previewMode[b.blockId] ?? (cleanup.enabled && cleanup.ready ? 'clean' : 'original');
                    const audioRes = activeMode === 'clean' && cleanup.ready
                      ? `narration-clean/${b.audio.id}`
                      : `narration-original/${b.audio.id}`;
                    const preparing = preparingCleanupBlock === b.blockId;
                    const warnText = cleanup.warningCode
                      ? (t.cleanupWarnings[cleanup.warningCode] ?? cleanup.warning ?? '')
                      : '';
                    return (
                      <div className="mt-1 flex flex-col gap-1" data-narration-cleanup={b.blockId}>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex flex-wrap items-center gap-3">
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                role="switch"
                                className="foco"
                                data-narration-cleanup-toggle={b.blockId}
                                checked={cleanup.enabled}
                                disabled={anyBusy || preparing}
                                onChange={e => void toggleCleanup(b.blockId, e.target.checked)}
                              />
                              <span>{t.cleanupLabel}</span>
                            </label>
                            {cleanup.noiseFloorSource === 'vad' && cleanup.noiseFloorDb !== null && (
                              <span className="text-fg-2" data-narration-noise-floor>
                                {fill(t.noiseFloorMeasured, { db: cleanup.noiseFloorDb.toFixed(0) })}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1" role="group" aria-label={t.cleanupLabel}>
                            <Button
                              tamanho="sm"
                              variante={activeMode === 'original' ? 'primario' : 'secundario'}
                              aria-pressed={activeMode === 'original'}
                              data-narration-preview-before={b.blockId}
                              disabled={anyBusy || preparing}
                              onClick={() => void selectPreviewMode(b, 'original')}
                            >
                              {t.previewBefore}
                            </Button>
                            <Button
                              tamanho="sm"
                              variante={activeMode === 'clean' ? 'primario' : 'secundario'}
                              aria-pressed={activeMode === 'clean'}
                              data-narration-preview-after={b.blockId}
                              disabled={anyBusy || preparing}
                              carregando={preparing}
                              onClick={() => void selectPreviewMode(b, 'clean')}
                            >
                              {preparing ? t.preparingCleanup : t.previewAfter}
                            </Button>
                          </div>
                        </div>
                        {warnText && (
                          <p role="note" className="text-xs text-warning" data-narration-cleanup-warning={cleanup.warningCode}>
                            {warnText}
                          </p>
                        )}
                        <audio
                          controls
                          preload="none"
                          data-narration-audio={activeMode}
                          className="h-8 w-full"
                          src={mediaUrl(audioRes)}
                        />
                      </div>
                    );
                  })()
                ) : (
                  b.audio && !b.audio.stale && (
                    <audio controls preload="none" className="mt-1 h-8 w-full" src={mediaUrl(`narration/${b.audio.id}`)} />
                  )
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
      {recordingBlockId !== null && doc.narrationAllowed && doc.blocks.length > 0 && (
        <TeleprompterRecorder
          candidate={candidate}
          blocks={doc.blocks}
          selectedBlockId={recordingBlockId}
          onSelectBlock={setRecordingBlockId}
          disabled={anyBusy}
          onSaved={handleRecordedSaved}
          onClose={() => setRecordingBlockId(null)}
        />
      )}
      <ConfirmDialog
        open={replacePending !== null}
        onOpenChange={openState => { if (!openState) setReplacePending(null); }}
        title={t.replaceTitle}
        description={replacePending ? fill(t.replaceDescription, { kind: t.replaceKinds[replacePending.kind] }) : ''}
        cancelLabel={t.replaceCancel}
        confirmLabel={t.replaceConfirm}
        finalFocus={importFocusRef}
        onConfirm={() => {
          const target = replacePending;
          setReplacePending(null);
          if (target) void importBlockAudio(target.blockId);
        }}
      />
    </section>
  );
}
