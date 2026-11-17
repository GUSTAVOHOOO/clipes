import { useEffect, useRef, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ackDirectMonetizationNotice, checkGuardrails, DirectMonetizationDialog } from '@/features/guardrails/GuardrailsPanel';
import { correctionEvent, type CorrectionEvent } from '@/features/projects/TranscriptTimeline';
import type { MissingGlyph } from '@/features/captions/types';
import { coreDispatch, type ExportRequest } from '@/lib/core';
import { useText } from '@/lib/i18n';

type ExportError = { code: string; message?: string; usage?: { font?: string; missing_glyphs?: MissingGlyph[] } | null };
type Status = { job: number; state: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'; progress: number; error?: ExportError | null; encoder_fallback?: { from: string; reason: string } | null };
const texts = {
  'pt-BR': {
    export: 'Exportar', save: 'Salvar Corte', pending: 'Aprove este candidato para exportar.', queued: 'Export na fila.', running: 'Exportando Corte', cancel: 'Cancelar export', completed: 'Corte exportado.', cancelled: 'Export cancelado.', fallback: 'O encoder de hardware falhou; este Corte foi exportado com x264, mais lento. Veja Preferências.',
    fixWord: 'Corrigir palavra', fixTitle: 'Corrigir palavra na Transcrição', fixCancel: 'Cancelar', fixConfirm: 'Salvar correção', wordLabel: 'Texto da palavra', fixSaveError: 'Não foi possível salvar a correção.', glyphFixed: 'Palavra corrigida. Você já pode exportar.', sentenceLabel: 'Frase', glyphAlert: 'Sem glifo na fonte para “{word}” ({char} · {codepoint}{sentence} · {time}).',
    errors: { export_exists: 'Já existe um arquivo no destino. Escolha outro nome.', export_destination: 'Escolha uma pasta existente e um nome MP4 válido.', export_candidate: 'Aprove o candidato e use as bordas atuais da revisão.', export_bounds: 'As bordas do Corte devem coincidir com Frases da Transcrição completa.', source_changed: 'A Fonte está indisponível ou foi alterada.', component_missing: 'Instale o Componente FFmpeg em Componentes.', export_ass_missing: 'O FFmpeg instalado não tem suporte a legendas. Escolha uma versão com libass em Componentes.', export_font_missing: 'A fonte da legenda não foi carregada. Verifique o Componente FFmpeg.', export_glyph_missing: 'A fonte da legenda não tem glifo para um caractere da Transcrição. Corrija a palavra.', default: 'Não foi possível exportar o Corte.' } as Record<string, string>,
  },
  en: {
    export: 'Export', save: 'Save Clip', pending: 'Approve this candidate to export.', queued: 'Export queued.', running: 'Exporting Clip', cancel: 'Cancel export', completed: 'Clip exported.', cancelled: 'Export cancelled.', fallback: 'The hardware encoder failed; this Clip was exported with x264, which is slower. See Preferences.',
    fixWord: 'Correct word', fixTitle: 'Correct word in Transcript', fixCancel: 'Cancel', fixConfirm: 'Save correction', wordLabel: 'Word text', fixSaveError: 'Could not save the correction.', glyphFixed: 'Word corrected. You can export now.', sentenceLabel: 'Sentence', glyphAlert: 'No font glyph for “{word}” ({char} · {codepoint}{sentence} · {time}).',
    errors: { export_exists: 'A file already exists at this destination. Choose another name.', export_destination: 'Choose an existing folder and a valid MP4 name.', export_candidate: 'Approve the candidate and use its current review borders.', export_bounds: 'Clip borders must match Sentences in the complete Transcript.', source_changed: 'The Source is unavailable or has changed.', component_missing: 'Install the FFmpeg Component in Components.', export_ass_missing: 'The installed FFmpeg does not support subtitles. Choose a build with libass in Components.', export_font_missing: 'The subtitle font could not be loaded. Check the FFmpeg Component.', export_glyph_missing: 'The subtitle font is missing a glyph for a Transcript character. Correct the word.', default: 'Could not export the Clip.' } as Record<string, string>,
  },
};

function clock(us: number): string {
  const s = Math.max(0, Math.floor(us / 1_000_000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s / 60) % 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function exportFilename(title: string, id: number): string {
  let name = title.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\.mp4$/i, '').trim().replace(/[. ]+$/g, '').slice(0, 100).replace(/[. ]+$/g, '');
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `corte-${id}`;
  return `${name}.mp4`;
}

export function ExportButton({ sourceId, candidateId, clipId, title, startId, endId, approved }: { sourceId: number; candidateId: number; clipId?: number; title: string; startId?: number; endId?: number; approved: boolean }) {
  const t = useText(texts);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<ExportError | null>(null);
  const [fixedPositions, setFixedPositions] = useState<number[]>([]);
  const [fixedNotice, setFixedNotice] = useState(false);
  const [fixing, setFixing] = useState<MissingGlyph | null>(null);
  const [draftWord, setDraftWord] = useState('');
  const [fixBusy, setFixBusy] = useState(false);
  const [fixError, setFixError] = useState('');
  const [directNoticeOpen, setDirectNoticeOpen] = useState(false);
  const exportTrigger = useRef<HTMLButtonElement>(null);
  const fixTrigger = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const active = status?.state === 'queued' || status?.state === 'running';
  useEffect(() => {
    if (!status || !active) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;
    const sync = () => coreDispatch<Status>('export.status', { job: status.job }).then(next => { if (mounted) setStatus(next); }).catch(() => { if (mounted) setStartError({ code: 'default' }); });
    void sync();
    listen<{ job: string }>('core-progress', event => { if (event.payload.job === String(status.job)) void sync(); }).then(fn => { if (mounted) unlisten = fn; else fn(); }).catch(() => {});
    const timer = window.setInterval(() => void sync(), 500);
    return () => { mounted = false; unlisten?.(); window.clearInterval(timer); };
  }, [status?.job, active]);

  const rawError: ExportError | null = startError ?? (status?.state === 'failed' ? (status.error ?? { code: 'default' }) : null);
  const allMissing = rawError?.code === 'export_glyph_missing' ? (rawError.usage?.missing_glyphs ?? []) : [];
  const missingGlyphs = allMissing.filter(g => !fixedPositions.includes(g.position));

  useEffect(() => {
    const onCorrected = (event: Event) => {
      const detail = (event as CustomEvent<CorrectionEvent>).detail;
      if (detail.source_id !== sourceId) return;
      setFixedPositions(prev => prev.includes(detail.position) ? prev : [...prev, detail.position]);
    };
    window.addEventListener(correctionEvent, onCorrected);
    return () => window.removeEventListener(correctionEvent, onCorrected);
  }, [sourceId]);

  useEffect(() => {
    if (rawError?.code === 'export_glyph_missing' && allMissing.length > 0 && missingGlyphs.length === 0) {
      setStartError(null);
      setStatus(s => s?.state === 'failed' ? null : s);
      setFixedNotice(true);
    }
  }, [rawError?.code, allMissing.length, missingGlyphs.length]);

  async function proceedStart() {
    if (!approved || !startId || !endId) return;
    setBusy(true); setStartError(null); setFixedPositions([]); setFixedNotice(false);
    try {
      const settings = await coreDispatch<{ last_directory: string | null }>('export.settings', {});
      const filename = exportFilename(title, candidateId);
      const defaultPath = settings.last_directory ? `${settings.last_directory.replace(/[\\/]+$/, '')}/${filename}` : filename;
      const mock = import.meta.env.VITE_CORE_MOCK === '1' && !isTauri();
      const chosen = mock ? `/test/exports/${filename}` : await save({ title: t.save, defaultPath, filters: [{ name: 'MP4', extensions: ['mp4'] }] });
      if (!chosen || !alive.current) return;
      const output = /\.mp4$/i.test(chosen) ? chosen : `${chosen}.mp4`;
      setStatus(null);
      const request: ExportRequest = { source_id: sourceId, candidate_id: candidateId, start_id: startId, end_id: endId, clip_id: clipId };
      const answer = await coreDispatch<{ job: number }>('export.start', { ...request, output });
      if (alive.current) setStatus({ job: answer.job, state: 'queued', progress: 0 });
    } catch (e) {
      const errObj = typeof e === 'object' && e !== null ? e as Partial<ExportError> : {};
      if (alive.current) setStartError({ code: errObj.code ? String(errObj.code) : 'default', message: errObj.message, usage: errObj.usage });
    } finally { if (alive.current) setBusy(false); }
  }
  async function start() {
    if (!approved || !startId || !endId) return;
    const guardrails = await checkGuardrails({
      scope: 'single',
      source_id: sourceId,
      candidate_id: candidateId,
      ...(clipId !== undefined ? { clip_id: clipId } : {}),
      start_id: startId,
      end_id: endId,
    });
    if (!alive.current) return;
    if (guardrails?.needsDirectNotice) {
      setDirectNoticeOpen(true);
      return;
    }
    await proceedStart();
  }
  async function cancel() {
    if (!status) return;
    setBusy(true); setStartError(null);
    try {
      await coreDispatch('jobs.cancel', { id: status.job });
      const next = await coreDispatch<Status>('export.status', { job: status.job });
      if (alive.current) setStatus(next);
    } catch { if (alive.current) setStartError({ code: 'default' }); }
    finally { if (alive.current) setBusy(false); }
  }
  function formatGlyphMessage(item: MissingGlyph): string {
    const sentence = item.sentence_id ? ` · ${t.sentenceLabel} ${item.sentence_id}` : '';
    return t.glyphAlert
      .replace('{word}', item.word)
      .replace('{char}', item.char)
      .replace('{codepoint}', item.codepoint)
      .replace('{sentence}', sentence)
      .replace('{time}', clock(item.start_us));
  }
  function openFix(item: MissingGlyph) {
    setFixing(item);
    setDraftWord(item.word);
    setFixError('');
  }
  async function submitFix() {
    if (!fixing || fixBusy) return;
    setFixBusy(true); setFixError('');
    try {
      const changed = await coreDispatch<CorrectionEvent>('transcription.correct', { source_id: sourceId, position: fixing.position, text: draftWord });
      window.dispatchEvent(new CustomEvent(correctionEvent, { detail: changed }));
      if (!alive.current) return;
      const nextPositions = fixedPositions.includes(fixing.position) ? fixedPositions : [...fixedPositions, fixing.position];
      setFixedPositions(nextPositions);
      const nextMissing = allMissing.find(g => !nextPositions.includes(g.position));
      if (nextMissing) {
        setFixing(nextMissing);
        setDraftWord(nextMissing.word);
      } else {
        setFixing(null);
        setStartError(null);
        setStatus(s => s?.state === 'failed' ? null : s);
        setFixedNotice(true);
      }
    } catch {
      if (alive.current) setFixError(t.fixSaveError);
    } finally {
      if (alive.current) setFixBusy(false);
    }
  }
  const errorMessage = rawError
    ? (rawError.code === 'export_glyph_missing' && missingGlyphs.length > 0
      ? `${formatGlyphMessage(missingGlyphs[0])}${missingGlyphs.length > 1 ? ` (+${missingGlyphs.length - 1})` : ''}`
      : t.errors[rawError.code] ?? t.errors.default)
    : '';
  return <div className="flex flex-wrap items-center gap-2" data-export>
    <Button ref={exportTrigger} tamanho="sm" disabled={!approved || !startId || !endId || active} carregando={busy} title={approved ? undefined : t.pending} onClick={() => void start()}>{t.export}</Button>
    {active && <Button tamanho="sm" disabled={busy} onClick={() => void cancel()}>{t.cancel}</Button>}
    {status && <span role="status" className="text-sm text-fg-2">{status.state === 'running' ? `${t.running} · ${status.progress}%` : status.state === 'failed' ? '' : t[status.state]}</span>}
    {active && <progress value={status?.progress ?? 0} max={100} aria-label={t.running} className="w-28 max-w-full" />}
    {status?.state === 'completed' && status.encoder_fallback && <p role="status" className="text-sm text-fg-2" data-export-fallback>{t.fallback}</p>}
    {errorMessage && <p role="alert" className="text-sm text-danger">{errorMessage}</p>}
    {rawError?.code === 'export_glyph_missing' && missingGlyphs.length > 0 && (
      <Button ref={fixTrigger} tamanho="sm" onClick={() => openFix(missingGlyphs[0])} data-export-fix-glyph>{t.fixWord}</Button>
    )}
    {fixedNotice && !errorMessage && <p role="status" className="text-sm text-fg-2" data-export-glyph-fixed>{t.glyphFixed}</p>}
    <ConfirmDialog
      open={fixing !== null}
      onOpenChange={open => { if (!open && !fixBusy) setFixing(null); }}
      title={t.fixTitle}
      description={fixing ? formatGlyphMessage(fixing) : ''}
      cancelLabel={t.fixCancel}
      confirmLabel={t.fixConfirm}
      onConfirm={() => void submitFix()}
      finalFocus={fixTrigger}
    >
      <div className="flex flex-col gap-2 px-5 pb-4 text-sm">
        {missingGlyphs.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {missingGlyphs.map(g => (
              <button key={g.position} type="button" onClick={() => openFix(g)}
                className={`foco rounded-md border px-2 py-0.5 text-xs ${fixing?.position === g.position ? 'border-accent-line bg-accent-subtle' : 'border-line bg-field'}`}>
                {g.word} ({g.codepoint})
              </button>
            ))}
          </div>
        )}
        <label className="flex flex-col gap-1">
          {t.wordLabel}
          <input
            className="foco h-8 w-full rounded-md border border-line-strong bg-field px-2 text-fg"
            maxLength={200}
            value={draftWord}
            disabled={fixBusy}
            onChange={e => setDraftWord(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submitFix(); } }}
          />
        </label>
        {fixError && <p role="alert" className="text-sm text-danger">{fixError}</p>}
      </div>
    </ConfirmDialog>
    <DirectMonetizationDialog
      open={directNoticeOpen}
      onOpenChange={setDirectNoticeOpen}
      finalFocus={exportTrigger}
      onConfirm={() => {
        setDirectNoticeOpen(false);
        void ackDirectMonetizationNotice().then(() => {
          if (alive.current) void proceedStart();
        });
      }}
    />
  </div>;
}
