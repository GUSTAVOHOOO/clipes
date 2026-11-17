import { Mic, Pause, Play, RotateCcw, Square, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { fill } from './selectionFormat';

export type TeleprompterBlock = {
  blockId: number;
  position: number;
  title: string;
  narrationText: string | null;
};

type MicDevice = {
  deviceId: string;
  label: string;
};

type RecordResponse = {
  candidate: number;
  blockId: number;
  trimmed: boolean;
  warningCode?: string | null;
  warning?: string | null;
};

const texts = {
  'pt-BR': {
    heading: 'Gravação com teleprompter',
    close: 'Fechar teleprompter',
    blockLabel: 'Bloco no teleprompter',
    blockOption: 'Bloco {n} · {title}',
    prevBlock: 'Bloco anterior',
    nextBlock: 'Próximo bloco',
    micLabel: 'Microfone',
    defaultMic: 'Microfone padrão do sistema',
    micUnnamed: 'Microfone {n}',
    allowMic: 'Permitir microfone',
    requestingMic: 'Aguardando permissão…',
    permissionGranted: 'Permissão concedida',
    teleprompter: 'Teleprompter',
    emptyText: 'Este bloco não possui texto para leitura.',
    scrollSpeed: 'Velocidade da rolagem (px/s)',
    resetScroll: 'Voltar ao início',
    startRecording: 'Iniciar gravação',
    stopAndSave: 'Parar e salvar',
    pause: 'Pausar',
    resume: 'Continuar',
    cancelRecording: 'Cancelar gravação',
    saving: 'Processando e aparando silêncios…',
    draftLabel: 'Rascunho sem fala detectada (áudio anterior do bloco preservado):',
    discardDraft: 'Descartar rascunho',
    errors: {
      unsupported: 'Gravação de microfone indisponível neste ambiente.',
      not_allowed: 'Permissão do microfone negada. Libere o acesso para gravar.',
      not_found: 'Microfone selecionado não encontrado. Verifique a conexão e tente novamente.',
      capture_failed: 'Não foi possível iniciar a gravação no microfone.',
      empty_capture: 'Nenhum áudio foi capturado na gravação.',
      no_speech_detected: 'Nenhuma fala detectada na gravação. O áudio anterior do bloco foi mantido; descarte o rascunho ou grave novamente.',
      component_missing: 'Instale o Componente FFmpeg para converter o áudio gravado.',
      script_not_approved: 'Aprove todos os blocos do Roteiro antes de gravar.',
      generation_in_progress: 'Aguarde a operação de Narração em andamento terminar.',
      default: 'Não foi possível salvar a gravação.',
    } as Record<string, string>,
  },
  en: {
    heading: 'Teleprompter recording',
    close: 'Close teleprompter',
    blockLabel: 'Teleprompter block',
    blockOption: 'Block {n} · {title}',
    prevBlock: 'Previous block',
    nextBlock: 'Next block',
    micLabel: 'Microphone',
    defaultMic: 'System default microphone',
    micUnnamed: 'Microphone {n}',
    allowMic: 'Allow microphone',
    requestingMic: 'Waiting for permission…',
    permissionGranted: 'Permission granted',
    teleprompter: 'Teleprompter',
    emptyText: 'This block has no text to read.',
    scrollSpeed: 'Scroll speed (px/s)',
    resetScroll: 'Reset scroll',
    startRecording: 'Start recording',
    stopAndSave: 'Stop and save',
    pause: 'Pause',
    resume: 'Resume',
    cancelRecording: 'Cancel recording',
    saving: 'Processing and trimming silences…',
    draftLabel: 'Draft with no speech detected (previous block audio kept):',
    discardDraft: 'Discard draft',
    errors: {
      unsupported: 'Microphone recording is unavailable in this environment.',
      not_allowed: 'Microphone permission denied. Allow access to record.',
      not_found: 'Selected microphone was not found. Check the connection and try again.',
      capture_failed: 'Could not start microphone recording.',
      empty_capture: 'No audio was captured in this recording.',
      no_speech_detected: 'No speech detected in the recording. The previous block audio was kept; discard the draft or record again.',
      component_missing: 'Install the FFmpeg Component to convert the recorded audio.',
      script_not_approved: 'Approve all Script blocks before recording.',
      generation_in_progress: 'Wait for the current Narration operation to finish.',
      default: 'Could not save the recording.',
    } as Record<string, string>,
  },
} as const;

const codeOf = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '');

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function encodePcm16MonoWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const writeStr = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buf);
}

function isWavHeader(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 44 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  );
}

async function blobToUploadPayload(blob: Blob): Promise<{ audioBase64: string; mimeType: string }> {
  const rawBuf = await blob.arrayBuffer();
  const rawBytes = new Uint8Array(rawBuf);
  if (/^audio\/(x-)?wav/i.test(blob.type) || isWavHeader(rawBytes)) {
    return { audioBase64: bytesToBase64(rawBytes), mimeType: 'audio/wav' };
  }
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AudioCtx && typeof OfflineAudioContext !== 'undefined') {
    const ctx = new AudioCtx();
    try {
      const decoded = await ctx.decodeAudioData(rawBuf.slice(0));
      const targetRate = 24000;
      const length = Math.max(1, Math.ceil(decoded.duration * targetRate));
      const offline = new OfflineAudioContext(1, length, targetRate);
      const src = offline.createBufferSource();
      src.buffer = decoded;
      src.connect(offline.destination);
      src.start(0);
      const rendered = await offline.startRendering();
      const wavBytes = encodePcm16MonoWav(rendered.getChannelData(0), targetRate);
      return { audioBase64: bytesToBase64(wavBytes), mimeType: 'audio/wav' };
    } catch {
      // Fallback: o núcleo Rust decodifica via FFmpeg quando o contêiner não decodifica no WebView.
    } finally {
      void ctx.close().catch(() => {});
    }
  }
  return { audioBase64: bytesToBase64(rawBytes), mimeType: blob.type || 'audio/webm' };
}

/** Painel de gravação por microfone com teleprompter rolável por bloco do Roteiro (#83). */
export function TeleprompterRecorder({
  candidate,
  blocks,
  selectedBlockId,
  onSelectBlock,
  disabled,
  onSaved,
  onClose,
}: {
  candidate: number;
  blocks: TeleprompterBlock[];
  selectedBlockId: number;
  onSelectBlock: (blockId: number) => void;
  disabled: boolean;
  onSaved: (warning?: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const t = useText(texts);
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [selectedMic, setSelectedMic] = useState('');
  const [permissionState, setPermissionState] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');
  const [stage, setStage] = useState<'idle' | 'recording' | 'paused' | 'saving'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [scrollSpeed, setScrollSpeed] = useState(28);
  const [error, setError] = useState('');
  const [draftUrl, setDraftUrl] = useState<string | null>(null);

  const teleprompterRef = useRef<HTMLDivElement>(null);
  const scrollAccumRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const draftUrlRef = useRef<string | null>(null);

  const currentIdx = Math.max(0, blocks.findIndex(b => b.blockId === selectedBlockId));
  const currentBlock = blocks[currentIdx] ?? null;

  const stopMedia = useCallback((cancelSave: boolean) => {
    cancelledRef.current = cancelSave;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch {}
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const list = await navigator.mediaDevices.enumerateDevices();
    const inputs = list
      .filter(d => d.kind === 'audioinput')
      .map((d, idx) => ({
        deviceId: d.deviceId,
        label: d.label || fill(t.micUnnamed, { n: idx + 1 }),
        hasLabel: Boolean(d.label),
      }));
    if (!mountedRef.current) return [];
    setDevices(inputs.map(({ deviceId, label }) => ({ deviceId, label })));
    if (inputs.some(d => d.hasLabel)) {
      setPermissionState('granted');
      setSelectedMic(cur => (cur && inputs.some(d => d.deviceId === cur) ? cur : (inputs[0]?.deviceId ?? '')));
    }
    return inputs;
  }, [t.micUnnamed]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshDevices().catch(() => {});
    return () => {
      mountedRef.current = false;
      stopMedia(true);
      if (draftUrlRef.current) {
        URL.revokeObjectURL(draftUrlRef.current);
        draftUrlRef.current = null;
      }
    };
  }, [refreshDevices, stopMedia]);

  useEffect(() => {
    if (stage !== 'recording') return;
    let lastTick = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dtSec = Math.max(0, (now - lastTick) / 1000);
      lastTick = now;
      setSeconds(prev => prev + dtSec);
      const el = teleprompterRef.current;
      if (el) {
        if (Math.abs(el.scrollTop - scrollAccumRef.current) > 2) {
          scrollAccumRef.current = el.scrollTop;
        }
        scrollAccumRef.current += scrollSpeed * dtSec;
        el.scrollTop = scrollAccumRef.current;
      }
    }, 50);
    return () => window.clearInterval(id);
  }, [stage, scrollSpeed]);

  function clearDraftLocal() {
    if (draftUrlRef.current) {
      URL.revokeObjectURL(draftUrlRef.current);
      draftUrlRef.current = null;
    }
    setDraftUrl(null);
  }

  async function requestMicPermission() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(t.errors.unsupported);
      return;
    }
    setError('');
    setPermissionState('requesting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(track => track.stop());
      if (!mountedRef.current) return;
      setPermissionState('granted');
      const inputs = await refreshDevices();
      if (inputs.length > 0 && !selectedMic) {
        setSelectedMic(inputs[0].deviceId);
      }
    } catch (e) {
      if (!mountedRef.current) return;
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setPermissionState('denied');
        setError(t.errors.not_allowed);
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setPermissionState('idle');
        setError(t.errors.not_found);
      } else {
        setPermissionState('idle');
        setError(t.errors.capture_failed);
      }
    }
  }

  async function startRecording() {
    if (!currentBlock || disabled || stage !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(t.errors.unsupported);
      return;
    }
    setError('');
    clearDraftLocal();
    cancelledRef.current = false;

    try {
      const audioConstraint: MediaTrackConstraints | boolean = selectedMic
        ? { deviceId: { exact: selectedMic } }
        : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      setPermissionState('granted');
      void refreshDevices().catch(() => {});

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      const targetBlockId = currentBlock.blockId;

      recorder.ondataavailable = ev => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };

      recorder.onerror = () => {
        stopMedia(true);
        if (mountedRef.current) {
          setStage('idle');
          setError(t.errors.capture_failed);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        if (cancelledRef.current || !mountedRef.current) {
          if (mountedRef.current) setStage('idle');
          return;
        }
        if (chunks.length === 0) {
          setStage('idle');
          setError(t.errors.empty_capture);
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/wav' });
        void (async () => {
          try {
            const payload = await blobToUploadPayload(blob);
            const res = await coreDispatch<RecordResponse>('narration.record_block', {
              candidate,
              block: targetBlockId,
              audioBase64: payload.audioBase64,
              mimeType: payload.mimeType,
            });
            if (!mountedRef.current) return;
            setStage('idle');
            await onSaved(res.warning ?? undefined);
          } catch (err) {
            if (!mountedRef.current) return;
            setStage('idle');
            const code = codeOf(err);
            if (code === 'no_speech_detected') {
              const url = URL.createObjectURL(blob);
              draftUrlRef.current = url;
              setDraftUrl(url);
            }
            setError(t.errors[code] ?? t.errors.default);
          }
        })();
      };

      setSeconds(0);
      scrollAccumRef.current = 0;
      if (teleprompterRef.current) teleprompterRef.current.scrollTop = 0;
      recorder.start(250);
      setStage('recording');
    } catch (e) {
      if (!mountedRef.current) return;
      setStage('idle');
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setPermissionState('denied');
        setError(t.errors.not_allowed);
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setError(t.errors.not_found);
      } else {
        setError(t.errors.capture_failed);
      }
    }
  }

  function stopAndSave() {
    if (stage !== 'recording' && stage !== 'paused') return;
    setStage('saving');
    stopMedia(false);
  }

  function cancelRecording() {
    stopMedia(true);
    setStage('idle');
  }

  function togglePause() {
    const rec = recorderRef.current;
    if (!rec) return;
    if (stage === 'recording' && rec.state === 'recording') {
      rec.pause();
      setStage('paused');
    } else if (stage === 'paused' && rec.state === 'paused') {
      rec.resume();
      setStage('recording');
    }
  }

  async function discardDraft() {
    clearDraftLocal();
    setError('');
    if (!currentBlock) return;
    try {
      await coreDispatch('narration.discard_draft', { candidate, block: currentBlock.blockId });
    } catch {
      // Ignora se já foi limpo.
    }
  }

  function resetScroll() {
    scrollAccumRef.current = 0;
    if (teleprompterRef.current) teleprompterRef.current.scrollTop = 0;
  }

  if (!currentBlock) return null;
  const activeRecording = stage === 'recording' || stage === 'paused';

  return (
    <section
      aria-label={t.heading}
      data-teleprompter-recorder
      className="mt-2 flex flex-col gap-3 rounded-md border border-accent-line bg-surface p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{t.heading}</h4>
        <Button tamanho="sm" variante="fantasma" icone={<X size={14} />} disabled={activeRecording || stage === 'saving'} onClick={onClose}>
          {t.close}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs">
          {t.blockLabel}
          <select
            className="foco h-8 rounded-md border border-line-strong bg-field px-2 text-sm text-fg"
            value={currentBlock.blockId}
            disabled={activeRecording || stage === 'saving'}
            onChange={e => onSelectBlock(Number(e.target.value))}
          >
            {blocks.map(b => (
              <option key={b.blockId} value={b.blockId}>
                {fill(t.blockOption, { n: b.position, title: b.title })}
              </option>
            ))}
          </select>
        </label>
        <Button
          tamanho="sm"
          disabled={activeRecording || stage === 'saving' || currentIdx <= 0}
          onClick={() => blocks[currentIdx - 1] && onSelectBlock(blocks[currentIdx - 1].blockId)}
        >
          {t.prevBlock}
        </Button>
        <Button
          tamanho="sm"
          disabled={activeRecording || stage === 'saving' || currentIdx >= blocks.length - 1}
          onClick={() => blocks[currentIdx + 1] && onSelectBlock(blocks[currentIdx + 1].blockId)}
        >
          {t.nextBlock}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-48 flex-col gap-1 text-xs">
          {t.micLabel}
          <select
            data-record-mic
            className="foco h-8 rounded-md border border-line-strong bg-field px-2 text-sm text-fg"
            value={selectedMic}
            disabled={activeRecording || stage === 'saving'}
            onChange={e => setSelectedMic(e.target.value)}
          >
            {devices.length === 0 ? (
              <option value="">{t.defaultMic}</option>
            ) : (
              devices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))
            )}
          </select>
        </label>
        <Button
          tamanho="sm"
          data-record-permission
          disabled={activeRecording || stage === 'saving' || permissionState === 'requesting'}
          onClick={() => void requestMicPermission()}
        >
          {permissionState === 'requesting'
            ? t.requestingMic
            : permissionState === 'granted'
              ? t.permissionGranted
              : t.allowMic}
        </Button>
      </div>

      <div
        ref={teleprompterRef}
        tabIndex={0}
        aria-label={t.teleprompter}
        data-teleprompter={currentBlock.blockId}
        className="foco h-40 overflow-auto rounded-md border border-line bg-field px-4 py-4 text-lg leading-[1.85] text-fg whitespace-pre-wrap"
      >
        {currentBlock.narrationText?.trim() || t.emptyText}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2">
          <span>{t.scrollSpeed}</span>
          <input
            type="range"
            min={5}
            max={120}
            step={1}
            value={scrollSpeed}
            aria-label={t.scrollSpeed}
            onChange={e => setScrollSpeed(Number(e.target.value))}
          />
          <span className="timecode w-14 text-fg-2" data-scroll-speed-value>{scrollSpeed} px/s</span>
        </label>
        <Button tamanho="sm" variante="fantasma" icone={<RotateCcw size={13} />} onClick={resetScroll}>
          {t.resetScroll}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {stage === 'idle' && (
          <Button
            variante="primario"
            tamanho="sm"
            icone={<Mic size={14} />}
            disabled={disabled || !currentBlock.narrationText?.trim()}
            data-record-start
            onClick={() => void startRecording()}
          >
            {t.startRecording}
          </Button>
        )}
        {activeRecording && (
          <>
            <Button
              variante="primario"
              tamanho="sm"
              icone={<Square size={13} />}
              data-record-stop
              onClick={stopAndSave}
            >
              {t.stopAndSave}
            </Button>
            <Button
              tamanho="sm"
              icone={stage === 'paused' ? <Play size={13} /> : <Pause size={13} />}
              onClick={togglePause}
            >
              {stage === 'paused' ? t.resume : t.pause}
            </Button>
            <Button tamanho="sm" variante="fantasma" onClick={cancelRecording}>
              {t.cancelRecording}
            </Button>
            <span className="timecode text-xs text-fg-2" role="timer" data-record-timer>
              {formatClock(seconds)}
            </span>
          </>
        )}
        {stage === 'saving' && (
          <span role="status" className="text-xs text-fg-2">{t.saving}</span>
        )}
      </div>

      {error && <p role="alert" className="text-xs text-danger" data-record-error>{error}</p>}

      {draftUrl && (
        <div className="flex flex-col gap-2 rounded border border-line bg-field p-2 text-xs" data-record-draft>
          <p className="text-fg-2">{t.draftLabel}</p>
          <audio controls preload="none" className="h-8 w-full" src={draftUrl} data-record-draft-audio />
          <div className="flex gap-2">
            <Button tamanho="sm" icone={<Trash2 size={13} />} onClick={() => void discardDraft()}>
              {t.discardDraft}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
