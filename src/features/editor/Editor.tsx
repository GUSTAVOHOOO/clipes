import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Captions, Crop, Languages, PanelLeft, PanelRight, Scissors, X } from 'lucide-react';
import { coreDispatch, type ExportRequest } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { useComandos } from '@/lib/comandos';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { ExportButton } from '@/features/export/ExportButton';
import { GuardrailsChecklist } from '@/features/guardrails/GuardrailsPanel';
import { CabecalhoGaveta, GavetaBorda, Puxador, ZonaBorda, useGaveta } from '@/components/shell/Gaveta';
import { CutPreview, previewSeekEvent, type PreviewProxyInfo, type PreviewSeekEvent } from '@/features/projects/CutPreview';
import { clock, fill } from '@/features/projects/selectionFormat';
import { PX_PER_SEC, neighborStart, nextRate, pxToUs, sentenceAt, usToPx, visiblePx, visibleSentences, visibleThumbs, type MontageState, type SilencesState, type TimelineSentence } from './timelineMath';
import { CaptionPanel } from '@/features/captions/CaptionPanel';
import { useCaptions } from '@/features/captions/useCaptions';
import { BorderHandles, type Adjustment, type Edge } from './BorderHandles';
import { NarrationTrack } from './NarrationTrack';
import { SilencesPanel } from './SilencesPanel';
import { CropPanel, type CropAnswer, type CropPanelSlot } from './CropPanel';
import { TranslationPanel } from '@/features/translation/TranslationPanel';
import { resolveCrop, resolveCropPlan, type ClipCrop, type CropKeyframe, type CropLayout } from './cropMath';

export const editorOpenEvent = 'clipes-editor-open';
/** Abre o editor num Corte: candidato aprovado ou par de Frases da Fonte. O núcleo valida as bordas. */
export function openEditor(request: ExportRequest) { window.dispatchEvent(new CustomEvent<ExportRequest>(editorOpenEvent, { detail: request })); }

type Edited = { clipId: number; request: ExportRequest; startUs: number; endUs: number; undoCount: number; redoCount: number; revision: number; silences?: SilencesState; crop?: ClipCrop; montage?: MontageState | null };
type Opened = Edited & { windowStartUs: number; windowEndUs: number; fps: number; sourceAspect?: number };
type Thumbs = { id: string; count: number; intervalUs: number; width: number; height: number; columns: number };
type Timeline = { state: 'queued' | 'running' | 'ready' | 'failed' | 'cancelled' | 'missing'; key: string; job: number | null; progress: number; error: string | null; thumbs: Thumbs | null };

const texts = {
  'pt-BR': {
    title: 'Editor do Corte', close: 'Fechar editor', timeline: 'Timeline do Corte', transcript: 'Transcrição do editor', borders: 'Bordas do Corte', captions: 'Legenda', silences: 'Silêncios', crop: 'Enquadrar', translation: 'Tradução',
    markIn: 'Marcar entrada', markOut: 'Marcar saída', back: 'Voltar', play: 'Reproduzir', pause: 'Pausar', forward: 'Avançar', spaceHint: 'Espaço / K', rate: 'Velocidade', export: 'Exportar', exportNeedsCandidate: 'Abra um candidato aprovado para exportar.',
    shortcuts: 'Atalhos', hintPlay: 'voltar · pausar · avançar', hintMark: 'entrada · saída (Frase inteira)', hintFrame: 'quadro', hintSentence: 'Frase anterior/próxima', hintDrawers: 'gavetas',
    duration: 'Duração {value}', start: 'Entrada', end: 'Saída', startEarlier: 'Estender início', startLater: 'Encurtar início', endEarlier: 'Encurtar fim', endLater: 'Estender fim',
    loading: 'Abrindo o editor…', timelinePreparing: 'Preparando miniaturas e onda…', timelineFailed: 'Não foi possível gerar as miniaturas e a onda.', cancel: 'Cancelar', retry: 'Gerar de novo',
    undo: 'Desfazer', redo: 'Refazer', sentence: '1 Frase', saveFailed: 'Não foi possível salvar o Corte. Tente fechar o editor de novo.',
    note: 'Arraste as alças para encaixar em Frase. Segure Alt para ajustar por quadro. As edições são salvas automaticamente.',
    silenceActive: 'Silêncio removido ({ms} ms) — clique para reverter', silenceReverted: 'Silêncio revertido ({ms} ms) — clique para reaplicar',
    cropKeyframe: 'Keyframe de enquadramento em {time}',
    montageFreezeTail: 'Último quadro congelado por {sec} s no fim (sobra da Narração).',
    montageLongFreezeTail: 'Aviso: a Narração ultrapassa o fim do Corte em {sec} s (> 5 s) e congelará o último quadro.',
    montageEstimated: 'Duração da Narração estimada por caracteres.',
    errors: { adjust_empty: 'O Corte precisa manter ao menos uma Frase.', adjust_too_short: 'O Corte ficaria abaixo da duração mínima.', adjust_too_long: 'O Corte ficaria acima da duração máxima.', unknown_sentence_id: 'Frase desconhecida.', invalid_range: 'Intervalo do Corte inválido.', invalid_silence_threshold: 'O limite de silêncio deve ficar entre 300 ms e 2000 ms.', invalid_silence_interval: 'Trecho de silêncio inválido.', invalid_crop: 'Enquadramento inválido.', invalid_montage: 'Montagem inválida.', block_not_found: 'Bloco não encontrado.', candidate_not_found: 'Candidato não encontrado.', transcript_missing: 'Transcrição não encontrada.', source_not_found: 'Fonte não encontrada.', default: 'Não foi possível abrir o editor.' } as Record<string, string>,
  },
  en: {
    title: 'Clip editor', close: 'Close editor', timeline: 'Clip timeline', transcript: 'Editor Transcript', borders: 'Clip borders', captions: 'Captions', silences: 'Silences', crop: 'Framing', translation: 'Translation',
    markIn: 'Mark in', markOut: 'Mark out', back: 'Reverse', play: 'Play', pause: 'Pause', forward: 'Forward', spaceHint: 'Space / K', rate: 'Speed', export: 'Export', exportNeedsCandidate: 'Open an approved candidate to export.',
    shortcuts: 'Shortcuts', hintPlay: 'reverse · pause · forward', hintMark: 'in · out (whole Sentence)', hintFrame: 'frame', hintSentence: 'previous/next Sentence', hintDrawers: 'drawers',
    duration: 'Duration {value}', start: 'In', end: 'Out', startEarlier: 'Extend start', startLater: 'Shorten start', endEarlier: 'Shorten end', endLater: 'Extend end',
    loading: 'Opening the editor…', timelinePreparing: 'Preparing thumbnails and waveform…', timelineFailed: 'Could not generate thumbnails and waveform.', cancel: 'Cancel', retry: 'Generate again',
    undo: 'Undo', redo: 'Redo', sentence: '1 Sentence', saveFailed: 'Could not save the Clip. Try closing the editor again.',
    note: 'Drag handles to snap to Sentences. Hold Alt to adjust by frame. Edits are saved automatically.',
    silenceActive: 'Removed silence ({ms} ms) — click to revert', silenceReverted: 'Reverted silence ({ms} ms) — click to reapply',
    cropKeyframe: 'Framing keyframe at {time}',
    montageFreezeTail: 'Last frame freezes for {sec} s at the end (Narration overflow).',
    montageLongFreezeTail: 'Warning: Narration exceeds the Clip end by {sec} s (> 5 s) and will freeze the last frame.',
    montageEstimated: 'Narration durations estimated from character count.',
    errors: { adjust_empty: 'The Clip must keep at least one Sentence.', adjust_too_short: 'The Clip would fall below the minimum duration.', adjust_too_long: 'The Clip would exceed the maximum duration.', unknown_sentence_id: 'Unknown Sentence.', invalid_range: 'Invalid Clip range.', invalid_silence_threshold: 'Silence threshold must be between 300 ms and 2000 ms.', invalid_silence_interval: 'Invalid silence interval.', invalid_crop: 'Invalid crop.', invalid_montage: 'Invalid montage.', block_not_found: 'Block not found.', candidate_not_found: 'Candidate not found.', transcript_missing: 'Transcript not found.', source_not_found: 'Source not found.', default: 'Could not open the editor.' } as Record<string, string>,
  },
};

const errorCode = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '');
const mediaUrl = (id: string) => (isTauri() ? convertFileSrc(id, 'clipes-media') : `/__clipes-media__/${id}`);
const borderClock = (us: number) => `${clock(us)}.${String(Math.floor((us % 1_000_000) / 1000)).padStart(3, '0')}`;
const ROW = { thumbs: 54, wave: 40, sentences: 56, narration: 44 } as const;

/** Escuta o pedido de abertura e monta o editor em sobreposição. Um por aplicativo. */
export function EditorHost() {
  const [request, setRequest] = useState<ExportRequest | null>(null);
  useEffect(() => {
    const onOpen = (event: Event) => setRequest((event as CustomEvent<ExportRequest>).detail);
    window.addEventListener(editorOpenEvent, onOpen);
    return () => window.removeEventListener(editorOpenEvent, onOpen);
  }, []);
  return request ? <Editor key={`${request.source_id}:${request.start_id}:${request.end_id}`} request={request} onClose={() => setRequest(null)} /> : null;
}

/** Editor Foco do Corte (#61): só preview e timeline; a Transcrição e as bordas ficam em gavetas. */
export function Editor({ request, onClose }: { request: ExportRequest; onClose: () => void }) {
  const t = useText(texts);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [windowRevision, setWindowRevision] = useState(0);
  const [startId, setStartId] = useState(request.start_id);
  const [endId, setEndId] = useState(request.end_id);
  const [range, setRange] = useState<{ startUs: number; endUs: number } | null>(null);
  const [cropState, setCropState] = useState<ClipCrop | null>(null);
  const [draftCropLayout, setDraftCropLayout] = useState<{ layout: CropLayout; splitRatio: number } | null>(null);
  const [draftCropEdits, setDraftCropEdits] = useState<{ panel: CropPanelSlot; layout: CropLayout; edits: CropKeyframe[] } | null>(null);
  const [proxyInfo, setProxyInfo] = useState<PreviewProxyInfo | null>(null);
  const [sentences, setSentences] = useState<TimelineSentence[]>([]);
  const [error, setError] = useState('');
  const [sourceUs, setSourceUs] = useState(0);
  const [rate, setRate] = useState(0);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [wave, setWave] = useState<number[] | null>(null);
  const [scroll, setScroll] = useState({ left: 0, width: 1200 });
  const [history, setHistory] = useState({ undoCount: 0, redoCount: 0 });
  const [silences, setSilences] = useState<SilencesState | null>(null);
  const [montage, setMontage] = useState<MontageState | null>(null);
  const [captionRevision, setCaptionRevision] = useState(0);
  const [closing, setClosing] = useState(false);
  const committed = useRef<Edited | null>(null);
  const sequence = useRef(0);
  const operations = useRef<Promise<void>>(Promise.resolve());
  const left = useGaveta();
  const right = useGaveta();
  const [view, setView] = useState<'borders' | 'captions' | 'silences' | 'crop' | 'translation'>('borders');
  const openRight = useCallback((next: 'borders' | 'captions' | 'silences' | 'crop' | 'translation') => { if (right.aberta && view !== next) setView(next); else { setView(next); right.alternar(); } }, [right, view]);
  const captionRequest = useMemo(() => opened && range ? { source_id: request.source_id, start_id: startId, end_id: endId, candidate_id: request.candidate_id, clip_id: opened.clipId, start_us: range.startUs, end_us: range.endUs } : null, [opened, range, request.source_id, request.candidate_id, startId, endId]);
  const captions = useCaptions(captionRequest, captionRevision);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const state = useRef({ sourceUs: 0, rate: 0, startId, endId, sentences, opened, fps: 30 });
  state.current = { sourceUs, rate, startId, endId, sentences, opened, fps: opened?.fps ?? 30 };
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    void listen<{ stage: string }>('core-progress', event => {
      if (event.payload.stage === 'editor_save_failed') setError('save_failed');
    }).then(fn => { if (alive) unlisten = fn; else fn(); });
    return () => { alive = false; unlisten?.(); };
  }, []);

  // Abre: o núcleo valida o par de Frases e devolve a janela do proxy (Corte ±2 min).
  useEffect(() => {
    let alive = true;
    coreDispatch<Opened>('editor.open', request).then(async info => {
      const all: TimelineSentence[] = [];
      for (;;) {
        const page = await coreDispatch<TimelineSentence[]>('editor.sentences', { source_id: request.source_id, start_us: info.windowStartUs, end_us: info.windowEndUs, after_id: all.at(-1)?.id ?? 0, limit: 200 });
        all.push(...page);
        if (page.length < 200) break;
      }
      if (!alive) return;
      if (committed.current?.clipId === info.clipId && committed.current.revision > info.revision) {
        setWindowRevision(n => n + 1); return;
      }
      committed.current = info; setHistory(info); setSilences(info.silences ?? null); setMontage(info.montage ?? null);
      setStartId(info.request.start_id); setEndId(info.request.end_id);
      setOpened(info); setSentences(all); setRange({ startUs: info.startUs, endUs: info.endUs }); setCropState(info.crop ?? null); setDraftCropLayout(null); setDraftCropEdits(null); setSourceUs(info.startUs);
      requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollLeft = Math.max(0, usToPx(info.startUs, info.windowStartUs) - 80); });
    }).catch(e => { if (alive) setError(errorCode(e)); });
    return () => { alive = false; };
  }, [request, windowRevision]);

  // Miniaturas e onda: nascem do proxy pronto. Espera o proxy e acompanha a tarefa local.
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    let timer = 0;
    const args = { source_id: request.source_id, start_us: opened.startUs, end_us: opened.endUs };
    const finish = async (next: Timeline) => {
      setTimeline(next);
      if (next.state === 'ready') {
        const data = await coreDispatch<{ values: number[] }>('editor.wave', { key: next.key });
        if (alive) setWave(data.values);
      }
    };
    const poll = async () => {
      try {
        const next = await coreDispatch<Timeline>('editor.timeline', args);
        if (!alive) return;
        await finish(next);
        if (next.state === 'queued' || next.state === 'running') timer = window.setTimeout(() => void status(next.key), 700);
      } catch (e) {
        if (alive && errorCode(e) === 'proxy_not_ready') timer = window.setTimeout(() => void poll(), 1000);
        else if (alive) setTimeline(current => current ?? { state: 'failed', key: '', job: null, progress: 0, error: errorCode(e), thumbs: null });
      }
    };
    const status = async (key: string) => {
      try {
        const next = await coreDispatch<Timeline>('editor.timeline_status', { key, window_us: opened.windowEndUs - opened.windowStartUs });
        if (!alive) return;
        if (next.state === 'missing') return void poll();
        await finish(next);
        if (next.state === 'queued' || next.state === 'running') timer = window.setTimeout(() => void status(key), 700);
      } catch { if (alive) setTimeline(current => current && { ...current, state: 'failed' }); }
    };
    void poll();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [opened, request.source_id]);

  const windowStartUs = opened?.windowStartUs ?? 0;
  const timelineEndUs = opened ? Math.max(opened.windowEndUs, range && montage && montage.freezeTailUs > 0 ? range.endUs + montage.freezeTailUs + 2_000_000 : 0) : 0;
  const totalPx = opened ? usToPx(timelineEndUs, windowStartUs) : 0;

  /** Move o cabeçote (do editor) e pede ao preview que vá ao mesmo tempo da Fonte. */
  const seek = useCallback((us: number) => {
    const info = state.current.opened;
    if (!info) return;
    const next = Math.round(Math.min(info.windowEndUs, Math.max(info.windowStartUs, us)));
    setSourceUs(next);
    window.dispatchEvent(new CustomEvent<PreviewSeekEvent>(previewSeekEvent, { detail: { source_id: request.source_id, us: next } }));
  }, [request.source_id]);

  const display = useCallback((answer: Edited) => {
    setStartId(answer.request.start_id); setEndId(answer.request.end_id);
    setRange({ startUs: answer.startUs, endUs: answer.endUs }); setHistory(answer);
    setSilences(answer.silences ?? null);
    if (answer.montage !== undefined) setMontage(answer.montage);
    if (answer.crop) setCropState(answer.crop);
  }, []);
  const applyCropAnswer = useCallback((ans: CropAnswer) => {
    if (!committed.current) return;
    const nextCrop: ClipCrop = {
      layout: ans.layout,
      explicitLayout: ans.explicitLayout,
      splitRatio: ans.splitRatio,
      suggested: ans.suggested,
      edits: ans.edits,
      gameplayWebcam: ans.gameplayWebcam,
      twoPeople: ans.twoPeople,
      resolved: ans.resolved,
      hasCrop: ans.hasCrop,
      plan: ans.plan,
    };
    const next: Edited = {
      ...committed.current,
      revision: ans.revision,
      undoCount: ans.undoCount,
      redoCount: ans.redoCount,
      crop: nextCrop,
    };
    committed.current = next;
    display(next);
    setError('');
  }, [display]);
  const commitCropLayout = useCallback((layout: CropLayout, splitRatio?: number) => {
    const seq = ++sequence.current;
    operations.current = operations.current.then(async () => {
      if (!committed.current) return;
      const ans = await coreDispatch<CropAnswer>('editor.crop.set_layout', {
        clip_id: committed.current.clipId,
        layout,
        ...(splitRatio !== undefined ? { split_ratio: splitRatio } : {}),
      });
      if (seq === sequence.current) applyCropAnswer(ans);
      else if (committed.current) {
        committed.current = {
          ...committed.current,
          revision: ans.revision,
          undoCount: ans.undoCount,
          redoCount: ans.redoCount,
          crop: {
            layout: ans.layout,
            explicitLayout: ans.explicitLayout,
            splitRatio: ans.splitRatio,
            suggested: ans.suggested,
            edits: ans.edits,
            gameplayWebcam: ans.gameplayWebcam,
            twoPeople: ans.twoPeople,
            resolved: ans.resolved,
            hasCrop: ans.hasCrop,
            plan: ans.plan,
          },
        };
      }
    }).catch(err => {
      if (seq === sequence.current) {
        if (committed.current) display(committed.current);
        setError(errorCode(err) || 'default');
      }
    });
  }, [applyCropAnswer, display]);
  const commitCropEdits = useCallback((edits: CropKeyframe[], panel: CropPanelSlot = 'primary', layout?: CropLayout) => {
    const seq = ++sequence.current;
    operations.current = operations.current.then(async () => {
      if (!committed.current) return;
      const ans = await coreDispatch<CropAnswer>('editor.crop.set_edits', {
        clip_id: committed.current.clipId,
        edits,
        panel,
        ...(layout ? { layout } : {}),
      });
      if (seq === sequence.current) applyCropAnswer(ans);
      else if (committed.current) {
        committed.current = {
          ...committed.current,
          revision: ans.revision,
          undoCount: ans.undoCount,
          redoCount: ans.redoCount,
          crop: {
            layout: ans.layout,
            explicitLayout: ans.explicitLayout,
            splitRatio: ans.splitRatio,
            suggested: ans.suggested,
            edits: ans.edits,
            gameplayWebcam: ans.gameplayWebcam,
            twoPeople: ans.twoPeople,
            resolved: ans.resolved,
            hasCrop: ans.hasCrop,
            plan: ans.plan,
          },
        };
      }
    }).catch(err => {
      if (seq === sequence.current) {
        if (committed.current) display(committed.current);
        setError(errorCode(err) || 'default');
      }
    });
  }, [applyCropAnswer, display]);
  // Serializa as mutações e descarta respostas de prévias ultrapassadas pelo mouseup.
  const edit = useCallback((name: string, args: Record<string, unknown>, preview = false, edge?: Edge) => {
    const seq = ++sequence.current;
    operations.current = operations.current.then(async () => {
      if (!committed.current || (preview && seq !== sequence.current)) return;
      const answer = await coreDispatch<Edited>(name, { clip_id: committed.current.clipId, ...args, preview });
      if (!preview) {
        committed.current = answer;
        setCaptionRevision(r => r + 1);
        const info = state.current.opened;
        if (info && (answer.startUs < info.windowStartUs || answer.endUs > info.windowEndUs)) setWindowRevision(n => n + 1);
      }
      if (seq === sequence.current) {
        display(answer); setError('');
        if (edge) seek(edge === 'start' ? answer.startUs : answer.endUs);
      }
    }).catch(err => {
      if (seq === sequence.current) {
        if (committed.current) display(committed.current);
        setError(errorCode(err) || 'default');
      }
    });
  }, [display, seek]);
  const adjust = useCallback((edge: Edge, args: Adjustment, preview = false) => edit('editor.adjust', { edge, ...args }, preview, edge), [edit]);
  const cancelPreview = useCallback((edge?: Edge) => {
    ++sequence.current;
    setDraftCropLayout(null);
    setDraftCropEdits(null);
    if (committed.current) { display(committed.current); if (edge) seek(edge === 'start' ? committed.current.startUs : committed.current.endUs); }
  }, [display, seek]);
  const close = useCallback(() => {
    if (closing) return;
    cancelPreview(); setClosing(true);
    void operations.current.then(() => coreDispatch('editor.flush', {})).then(onClose).catch(() => { setError('save_failed'); setClosing(false); });
  }, [cancelPreview, closing, onClose]);
  const mark = useCallback((edge: Edge, id: number) => adjust(edge, { sentence_id: id }), [adjust]);
  const markAtPlayhead = useCallback((edge: 'start' | 'end') => {
    const found = sentenceAt(state.current.sentences, state.current.sourceUs);
    if (found) void mark(edge, found.id);
  }, [mark]);
  const moveEdge = useCallback((edge: Edge, delta: number) => adjust(edge, { sentence_delta: delta }), [adjust]);
  useComandos([
    { id: 'editor-transcript', titulo: t.transcript, grupo: t.title, dica: '[', executar: () => { right.fechar(); left.alternar(); } },
    { id: 'editor-borders', titulo: t.borders, grupo: t.title, dica: ']', executar: () => { left.fechar(); openRight('borders'); } },
    { id: 'editor-captions', titulo: t.captions, grupo: t.title, dica: 'C', executar: () => { left.fechar(); openRight('captions'); } },
    { id: 'editor-silences', titulo: t.silences, grupo: t.title, dica: 'S', executar: () => { left.fechar(); openRight('silences'); } },
    { id: 'editor-crop', titulo: t.crop, grupo: t.title, dica: 'F', executar: () => { left.fechar(); openRight('crop'); } },
    { id: 'editor-translation', titulo: t.translation, grupo: t.title, dica: 'T', executar: () => { left.fechar(); openRight('translation'); } },
    { id: 'editor-play-pause', titulo: rate === 0 ? t.play : t.pause, grupo: t.title, dica: t.spaceHint, executar: () => setRate(rate === 0 ? 1 : 0), desabilitado: !opened },
    { id: 'editor-back', titulo: t.back, grupo: t.title, dica: 'J', executar: () => setRate(nextRate(rate, 'j')), desabilitado: !opened },
    { id: 'editor-forward', titulo: t.forward, grupo: t.title, dica: 'L', executar: () => setRate(nextRate(rate, 'l')), desabilitado: !opened },
    { id: 'editor-mark-in', titulo: t.markIn, grupo: t.title, dica: 'I', executar: () => markAtPlayhead('start'), desabilitado: !opened || closing },
    { id: 'editor-mark-out', titulo: t.markOut, grupo: t.title, dica: 'O', executar: () => markAtPlayhead('end'), desabilitado: !opened || closing },
    { id: 'editor-undo', titulo: t.undo, grupo: t.title, dica: 'Ctrl+Z', executar: () => edit('editor.undo', {}), desabilitado: !history.undoCount || closing },
    { id: 'editor-redo', titulo: t.redo, grupo: t.title, dica: 'Ctrl+Shift+Z / Ctrl+Y', executar: () => edit('editor.redo', {}), desabilitado: !history.redoCount || closing },
    { id: 'editor-extend-start', titulo: `${t.startEarlier} · ${t.sentence}`, grupo: t.title, dica: 'Ctrl+Shift+←', executar: () => moveEdge('start', -1), desabilitado: !opened || closing },
    { id: 'editor-shorten-start', titulo: `${t.startLater} · ${t.sentence}`, grupo: t.title, dica: 'Ctrl+Shift+→', executar: () => moveEdge('start', 1), desabilitado: !opened || closing },
    { id: 'editor-shorten-end', titulo: `${t.endEarlier} · ${t.sentence}`, grupo: t.title, dica: 'Ctrl+Shift+↑', executar: () => moveEdge('end', -1), desabilitado: !opened || closing },
    { id: 'editor-extend-end', titulo: `${t.endLater} · ${t.sentence}`, grupo: t.title, dica: 'Ctrl+Shift+↓', executar: () => moveEdge('end', 1), desabilitado: !opened || closing },
    { id: 'editor-export', titulo: t.export, grupo: t.title, executar: () => headerRef.current?.querySelector<HTMLButtonElement>('[data-export-trigger]')?.click(), desabilitado: request.candidate_id === undefined || !opened || closing },
    { id: 'editor-close', titulo: t.close, grupo: t.title, dica: 'Esc', executar: close, desabilitado: closing },
  ]);

  // Atalhos do editor não capturam campos de texto nem camadas abertas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const target = e.target as Element | null;
      const key = e.key;
      const inField = target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]');
      if (inField) return;
      const inLayer = target?.closest('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]');
      const inEditorLayer = !inLayer || inLayer.matches('aside[data-lado]');
      const take = () => { e.preventDefault(); e.stopPropagation(); };
      if (inEditorLayer && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
        take(); moveEdge(key === 'ArrowLeft' || key === 'ArrowRight' ? 'start' : 'end', key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (inEditorLayer && (e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' || (key === 'y' && !e.shiftKey)) { take(); edit(e.shiftKey || key === 'y' ? 'editor.redo' : 'editor.undo', {}); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (target?.closest('[data-edge],[data-narration-block]') && key.startsWith('Arrow')) return;
      if (key === '[' && !inLayer?.closest('aside[data-lado="dir"]')) { take(); right.fechar(); left.alternar(); return; }
      if (key === ']' && !inLayer?.closest('aside[data-lado="esq"]')) { take(); left.fechar(); openRight('borders'); return; }
      if ((key === 'c' || key === 'C') && !inLayer) { take(); left.fechar(); openRight('captions'); return; }
      if ((key === 's' || key === 'S') && !inLayer) { take(); left.fechar(); openRight('silences'); return; }
      if ((key === 't' || key === 'T') && !inLayer) { take(); left.fechar(); openRight('translation'); return; }
      if ((key === 'f' || key === 'F') && (!inLayer || inLayer.matches('aside[data-lado="dir"]'))) { take(); left.fechar(); openRight('crop'); return; }
      if (key === 'Escape') {
        if (left.aberta || right.aberta) { take(); left.fechar(); right.fechar(); } else if (!inLayer) { take(); close(); }
        return;
      }
      if (inLayer) return;
      const s = state.current;
      const lower = key.length === 1 ? key.toLowerCase() : key;
      if (lower === 'j' || lower === 'l') { take(); setRate(nextRate(s.rate, lower)); }
      else if (lower === 'k') { take(); setRate(0); }
      else if (key === ' ' && !target?.closest('button,a[href],summary')) { take(); setRate(s.rate === 0 ? 1 : 0); }
      else if (lower === 'i') { take(); markAtPlayhead('start'); }
      else if (lower === 'o') { take(); markAtPlayhead('end'); }
      else if (key === 'ArrowRight' || key === 'ArrowLeft') { take(); setRate(0); seek(s.sourceUs + (key === 'ArrowRight' ? 1 : -1) * (1_000_000 / s.fps)); }
      else if (key === 'ArrowDown' || key === 'ArrowUp') {
        take(); setRate(0);
        const to = neighborStart(s.sentences, s.sourceUs, key === 'ArrowDown' ? 1 : -1);
        if (to !== null) seek(to);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [left, right, openRight, close, seek, markAtPlayhead, edit, moveEdge]);

  // Tamanho da área rolável e rolagem; só o que cabe nela (mais uma folga) é montado.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setScroll({ left: el.scrollLeft, width: el.clientWidth || 1200 });
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => { el.removeEventListener('scroll', measure); observer?.disconnect(); };
  }, [opened]);

  // Acompanha o cabeçote durante a reprodução.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !opened) return;
    const x = usToPx(sourceUs, windowStartUs);
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - el.clientWidth / 3);
  }, [sourceUs, opened, windowStartUs]);

  const visible = useMemo(() => visiblePx(scroll.left, scroll.width, totalPx), [scroll, totalPx]);
  const shown = useMemo(() => visibleSentences(sentences, windowStartUs, visible), [sentences, windowStartUs, visible]);
  const thumbs = timeline?.state === 'ready' ? timeline.thumbs : null;
  const current = sentenceAt(sentences, sourceUs);

  // Onda: um único canvas do tamanho da área visível, desenhado a partir da série medida no proxy.
  useEffect(() => {
    const el = canvas.current;
    if (!el || !wave) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const [from, to] = visible;
    el.width = Math.max(1, Math.round(to - from));
    el.height = ROW.wave;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--fg-3').trim() || '#888';
    const blockPx = (100_000 / 1_000_000) * PX_PER_SEC;
    const first = Math.max(0, Math.floor(from / blockPx));
    const last = Math.min(wave.length - 1, Math.ceil(to / blockPx));
    for (let i = first; i <= last; i++) {
      const h = Math.max(1, Math.round((wave[i] / 255) * (ROW.wave - 4)));
      ctx.fillRect(Math.round(i * blockPx - from), Math.round((ROW.wave - h) / 2), Math.max(1, Math.floor(blockPx) - 1), h);
    }
  }, [wave, visible]);

  const inClip = (s: TimelineSentence) => s.id >= startId && s.id <= endId;
  const startSentence = sentences.find(s => s.id === startId);
  const endSentence = sentences.find(s => s.id === endId);
  const failedText = error === 'save_failed' ? t.saveFailed : error ? (t.errors[error] ?? t.errors.default) : '';

  const dispatchTimeline = async (id: number | null) => { if (id !== null) { try { await coreDispatch('jobs.cancel', { id }); } catch { /* a tarefa já terminou */ } } };

  const activeSilences = useMemo(() => (silences?.intervals ?? []).filter(i => i.status === 'active'), [silences]);
  const silencesView = useMemo<SilencesState>(() => silences ?? {
    enabled: false,
    thresholdUs: 600_000,
    intervals: [],
    segments: [],
    removedUs: 0,
    effectiveDurationUs: range ? range.endUs - range.startUs : 0,
  }, [silences, range]);
  const visibleSilences = useMemo(() => (silences?.intervals ?? []).filter(i => usToPx(i.endUs, windowStartUs) >= visible[0] && usToPx(i.startUs, windowStartUs) <= visible[1]), [silences, windowStartUs, visible]);
  const effectiveCrop = useMemo<ClipCrop>(() => {
    const base: ClipCrop = cropState ?? { suggested: null, edits: [], resolved: [], hasCrop: false };
    const startUs = range?.startUs ?? 0;
    const endUs = range?.endUs ?? 1;
    const aspect = opened?.sourceAspect ?? 16 / 9;
    if (!draftCropLayout && !draftCropEdits) {
      if (base.plan) return base;
      const plan = resolveCropPlan(base, aspect, startUs, endUs);
      return { ...base, plan };
    }
    const next: ClipCrop = {
      ...base,
      ...(draftCropLayout ? { layout: draftCropLayout.layout, explicitLayout: draftCropLayout.layout, splitRatio: draftCropLayout.splitRatio } : {}),
    };
    if (draftCropEdits) {
      if (draftCropEdits.panel === 'primary') {
        next.edits = draftCropEdits.edits;
      } else if (draftCropEdits.layout === 'gameplay_webcam') {
        const cur = next.gameplayWebcam ?? { top: { suggested: null, edits: [] }, bottom: { suggested: null, edits: [] } };
        next.gameplayWebcam = {
          top: draftCropEdits.panel === 'top' ? { ...cur.top, edits: draftCropEdits.edits } : cur.top,
          bottom: draftCropEdits.panel === 'bottom' ? { ...cur.bottom, edits: draftCropEdits.edits } : cur.bottom,
        };
      } else if (draftCropEdits.layout === 'two_people') {
        const cur = next.twoPeople ?? { top: { suggested: null, edits: [] }, bottom: { suggested: null, edits: [] } };
        next.twoPeople = {
          top: draftCropEdits.panel === 'top' ? { ...cur.top, edits: draftCropEdits.edits } : cur.top,
          bottom: draftCropEdits.panel === 'bottom' ? { ...cur.bottom, edits: draftCropEdits.edits } : cur.bottom,
        };
      }
    }
    const plan = resolveCropPlan(next, aspect, startUs, endUs);
    const resolved = resolveCrop(next.suggested, next.edits);
    return { ...next, layout: plan.layout, splitRatio: plan.splitRatio, resolved, hasCrop: true, plan };
  }, [cropState, draftCropLayout, draftCropEdits, opened?.sourceAspect, range?.startUs, range?.endUs]);
  const crop = useMemo(() => (effectiveCrop.resolved.length ? effectiveCrop.resolved : null), [effectiveCrop.resolved]);
  const cropPlan = useMemo(() => (effectiveCrop.hasCrop ? (effectiveCrop.plan ?? null) : null), [effectiveCrop.hasCrop, effectiveCrop.plan]);
  const activeTimelineKeyframes = useMemo(() => {
    const layout = effectiveCrop.explicitLayout ?? effectiveCrop.layout;
    if (layout === 'gameplay_webcam') {
      return [...(effectiveCrop.gameplayWebcam?.top.edits ?? []), ...(effectiveCrop.gameplayWebcam?.bottom.edits ?? [])];
    }
    if (layout === 'two_people') {
      return [...(effectiveCrop.twoPeople?.top.edits ?? []), ...(effectiveCrop.twoPeople?.bottom.edits ?? [])];
    }
    return effectiveCrop.edits;
  }, [effectiveCrop]);
  const visibleCropKeyframes = useMemo(() => activeTimelineKeyframes.filter(k => { const px = usToPx(k.timeUs, windowStartUs); return px >= visible[0] && px <= visible[1]; }), [activeTimelineKeyframes, windowStartUs, visible]);

  const hasNarrationTrack = !!(montage && montage.blocks.length > 0);
  const narrationWarning = montage?.warnings.find(w => w.code === 'long_freeze_tail' || w.code === 'freeze_tail');

  return <section role="region" aria-label={t.title} data-start-id={startId} data-end-id={endId} data-start-us={range?.startUs} data-end-us={range?.endUs} data-window-start-us={opened?.windowStartUs} data-undo-count={history.undoCount} data-source-us={Math.round(sourceUs)} data-rate={rate} data-silences-removed-us={silencesView.removedUs} data-montage-freeze-tail-us={montage?.freezeTailUs ?? 0} data-montage-total-duration-us={montage?.totalDurationUs ?? 0}
    className="fixed inset-0 flex flex-col overflow-hidden bg-canvas text-fg" style={{ zIndex: 'var(--z-scrim)' }}>
    <header ref={headerRef} className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
      <h2 className="text-base font-semibold">{t.title}</h2>
      {range && <span className="font-mono text-xs text-fg-2">{borderClock(range.startUs)} – {borderClock(range.endUs)} · {fill(t.duration, { value: clock(silencesView.removedUs > 0 ? silencesView.effectiveDurationUs : range.endUs - range.startUs) })}{silencesView.removedUs > 0 ? ` (-${Math.round(silencesView.removedUs / 1000)} ms)` : ''}</span>}
      <div className="flex-1" />
      <Button tamanho="sm" disabled={!history.undoCount || closing} onClick={() => edit('editor.undo', {})} atalho="Ctrl+Z">{t.undo}</Button>
      <Button tamanho="sm" disabled={!history.redoCount || closing} onClick={() => edit('editor.redo', {})} atalho="Ctrl+Shift+Z">{t.redo}</Button>
      {request.candidate_id !== undefined ? <ExportButton sourceId={request.source_id} candidateId={request.candidate_id} clipId={opened?.clipId} title={`Corte ${request.candidate_id}`} startId={startId} endId={endId} approved /> : <Button tamanho="sm" disabled title={t.exportNeedsCandidate}>{t.export}</Button>}
      <Button tamanho="sm" variante="fantasma" icone={<X size={14} />} onClick={close} disabled={closing} aria-label={t.close} atalho="Escape" />
    </header>
    {error && <p role="alert" className="border-b border-line bg-warning-subtle px-4 py-2 text-sm text-fg">{failedText}</p>}
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ZonaBorda lado="esq" g={left} /><ZonaBorda lado="dir" g={right} />
      <Puxador lado="esq" g={left} itens={[{ id: 'transcript', rotulo: t.transcript, atalho: '[', icone: <PanelLeft size={16} />, onClick: () => { right.fechar(); left.alternar(); } }]} />
      <Puxador lado="dir" g={right} itens={[{ id: 'borders', rotulo: t.borders, atalho: ']', icone: <PanelRight size={16} />, onClick: () => { left.fechar(); openRight('borders'); } }, { id: 'captions', rotulo: t.captions, atalho: 'C', icone: <Captions size={16} />, onClick: () => { left.fechar(); openRight('captions'); } }, { id: 'silences', rotulo: t.silences, atalho: 'S', icone: <Scissors size={16} />, onClick: () => { left.fechar(); openRight('silences'); } }, { id: 'crop', rotulo: t.crop, atalho: 'F', icone: <Crop size={16} />, onClick: () => { left.fechar(); openRight('crop'); } }, { id: 'translation', rotulo: t.translation, atalho: 'T', icone: <Languages size={16} />, onClick: () => { left.fechar(); openRight('translation'); } }]} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4"><div className="m-auto flex flex-col items-center gap-3">
        {!opened && !error && <p aria-live="polite" className="text-fg-2">{t.loading}</p>}
        {opened && range && <div style={{ width: 'min(18rem, 22vh)' }}><CutPreview sourceId={request.source_id} startUs={range.startUs} endUs={range.endUs} rate={rate} onSourceTime={us => setSourceUs(us)} onProxyChange={setProxyInfo} captions={captions.data} skipIntervals={activeSilences} crop={crop} cropPlan={cropPlan} montage={montage} keptSegments={silencesView.segments} clipStartUs={range.startUs} clipEndUs={range.endUs} /></div>}
        {opened && <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label={t.shortcuts}>
          <Button tamanho="sm" onClick={() => setRate(nextRate(rate, 'j'))} atalho="J">{t.back.replace(/ \(.\)$/, '')}</Button>
          <Button tamanho="sm" onClick={() => setRate(0)} atalho="K">{t.pause.replace(/ \(.\)$/, '')}</Button>
          <Button tamanho="sm" onClick={() => setRate(nextRate(rate, 'l'))} atalho="L">{t.forward.replace(/ \(.\)$/, '')}</Button>
          <span className="font-mono text-xs text-fg-2" aria-label={t.rate}>{rate}×</span>
          <Button tamanho="sm" onClick={() => markAtPlayhead('start')} atalho="I">{t.markIn}</Button>
          <Button tamanho="sm" onClick={() => markAtPlayhead('end')} atalho="O">{t.markOut}</Button>
        </div>}
        {opened && <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-fg-2" aria-label={t.shortcuts}>
          <li className="flex items-center gap-1.5"><Kbd teclas={['J', 'K', 'L']} /> {t.hintPlay}</li>
          <li className="flex items-center gap-1.5"><Kbd teclas={['I', 'O']} /> {t.hintMark}</li>
          <li className="flex items-center gap-1.5"><Kbd teclas={['←', '→']} /> {t.hintFrame}</li>
          <li className="flex items-center gap-1.5"><Kbd teclas={['↑', '↓']} /> {t.hintSentence}</li>
          <li className="flex items-center gap-1.5"><Kbd teclas={['[', ']']} /> {t.hintDrawers}</li>
        </ul>}
        {opened && (
          <GuardrailsChecklist
            scope="single"
            sourceId={request.source_id}
            candidateId={request.candidate_id}
            clipId={opened.clipId}
            startId={startId}
            endId={endId}
            refreshKey={`${startId}-${endId}-${silencesView.removedUs}-${montage?.freezeTailUs ?? 0}-${captionRevision}`}
          />
        )}
      </div>
      </div>

      <div role="region" aria-label={t.timeline} className="shrink-0 border-t border-line bg-surface">
        {timeline && timeline.state !== 'ready' && <p className="px-3 py-1 text-xs text-fg-2" role={timeline.state === 'failed' ? 'alert' : 'status'}>
          {timeline.state === 'failed' ? t.timelineFailed : `${t.timelinePreparing} ${timeline.progress}%`}
          {(timeline.state === 'queued' || timeline.state === 'running') && <> <Button tamanho="sm" variante="fantasma" onClick={() => void dispatchTimeline(timeline.job)}>{t.cancel}</Button></>}
        </p>}
        {hasNarrationTrack && montage && (narrationWarning || montage.usesEstimatedDurations) && (
          <div className="flex flex-wrap items-center gap-3 border-b border-line/60 px-3 py-1 text-xs">
            {narrationWarning && (
              <span
                role="status"
                data-montage-warning={narrationWarning.code}
                className={narrationWarning.code === 'long_freeze_tail' ? 'text-danger font-medium' : 'text-fg-2'}
              >
                {fill(narrationWarning.code === 'long_freeze_tail' ? t.montageLongFreezeTail : t.montageFreezeTail, { sec: (montage.freezeTailUs / 1_000_000).toFixed(1) })}
              </span>
            )}
            {montage.usesEstimatedDurations && (
              <span className="text-fg-3">{t.montageEstimated}</span>
            )}
          </div>
        )}
        <div ref={scroller} className="relative overflow-x-auto overflow-y-hidden" style={{ height: ROW.thumbs + ROW.wave + ROW.sentences + (hasNarrationTrack ? ROW.narration + 4 : 0) + 14 }}
          onClick={e => {
            if ((e.target as Element).closest('[data-editor-sentence],[data-silence-cut],[data-timeline-crop-kf],[data-narration-block],[data-narration-reset]') || !scroller.current) return;
            const rect = scroller.current.getBoundingClientRect();
            seek(pxToUs(e.clientX - rect.left + scroller.current.scrollLeft, windowStartUs));
          }}>
          <div className="relative" style={{ width: totalPx, height: '100%' }}>
            <div className="absolute inset-x-0 top-0 bg-field" style={{ height: ROW.thumbs }} data-row="thumbs">
              {thumbs && visibleThumbs(thumbs.count, thumbs.intervalUs, visible).map(i => (
                <div key={i} data-thumb={i} className="absolute top-0" style={{ left: i * thumbs.width, width: thumbs.width, height: thumbs.height, backgroundImage: `url(${mediaUrl(thumbs.id)})`, backgroundSize: `${thumbs.columns * thumbs.width}px auto`, backgroundPosition: `-${(i % thumbs.columns) * thumbs.width}px -${Math.floor(i / thumbs.columns) * thumbs.height}px` }} />
              ))}
            </div>
            <div className="absolute inset-x-0" style={{ top: ROW.thumbs, height: ROW.wave }} data-row="wave">
              {wave && <canvas ref={canvas} data-wave aria-hidden className="absolute top-0" style={{ left: visible[0], height: ROW.wave }} />}
              {visibleSilences.map(item => {
                const leftPx = usToPx(item.startUs, windowStartUs);
                const widthPx = Math.max(4, usToPx(item.endUs, windowStartUs) - leftPx);
                const active = item.status === 'active';
                const ms = Math.round((item.endUs - item.startUs) / 1000);
                const label = fill(active ? t.silenceActive : t.silenceReverted, { ms });
                return <button key={item.id} type="button" data-silence-cut={item.id} data-silence-status={item.status} title={label} aria-label={label}
                  onClick={e => { e.stopPropagation(); edit('editor.silences.toggle', { id: item.id }); }}
                  className={`foco absolute top-0 h-full ${active ? 'border-x border-danger bg-warning-subtle/75' : 'border-x border-dashed border-line-strong bg-transparent opacity-60'}`}
                  style={{ left: leftPx, width: widthPx }} />;
              })}
            </div>
            <div className="absolute inset-x-0" style={{ top: ROW.thumbs + ROW.wave + 4, height: ROW.sentences }} data-row="sentences">
              {shown.map(s => <button key={s.id} type="button" data-editor-sentence={s.id} data-in-clip={inClip(s)} aria-current={current?.id === s.id ? 'true' : undefined}
                onClick={() => { setRate(0); seek(s.startUs); }} title={s.text}
                className={`foco absolute top-0 overflow-hidden rounded-md border px-1.5 py-1 text-left text-xs leading-tight ${inClip(s) ? 'border-accent-line bg-accent-subtle text-fg' : 'border-line bg-field text-fg-3'} ${current?.id === s.id ? 'ring-1 ring-accent' : ''}`}
                style={{ left: usToPx(s.startUs, windowStartUs) + 1, width: Math.max(8, usToPx(s.endUs, windowStartUs) - usToPx(s.startUs, windowStartUs) - 2), height: ROW.sentences }}>
                <span className="mr-1 font-mono text-[10px] text-fg-3">{s.id}</span>{s.text}
              </button>)}
            </div>
            {hasNarrationTrack && montage && range && opened && (
              <NarrationTrack
                montage={montage}
                range={range}
                segments={silencesView.segments}
                sentences={sentences}
                windowStartUs={windowStartUs}
                fps={opened.fps}
                top={ROW.thumbs + ROW.wave + ROW.sentences + 8}
                height={ROW.narration}
                onSetStart={(blockId, timeUs, free, preview) => edit('editor.montage.set_start', { block_id: blockId, time_us: timeUs, free }, preview)}
                onCancel={() => cancelPreview()}
                onSeek={us => { setRate(0); seek(us); }}
                onPause={() => setRate(0)}
              />
            )}
            {range && opened && <BorderHandles startUs={range.startUs} endUs={range.endUs} windowStartUs={windowStartUs} fps={opened.fps} labels={{ start: t.start, end: t.end }} adjust={adjust} cancel={cancelPreview} pause={() => setRate(0)} />}
            {visibleCropKeyframes.map(k => {
              const label = fill(t.cropKeyframe, { time: borderClock(k.timeUs) });
              return <button key={k.timeUs} type="button" data-timeline-crop-kf={k.timeUs} aria-label={label} title={label}
                onClick={e => { e.stopPropagation(); setRate(0); seek(k.timeUs); }}
                className="foco absolute top-1 z-10 size-3 -translate-x-1/2 rotate-45 rounded-[2px] border border-line-strong bg-accent hover:scale-110"
                style={{ left: usToPx(k.timeUs, windowStartUs) }} />;
            })}
            <div aria-hidden data-playhead className="pointer-events-none absolute inset-y-0 w-0.5 bg-fg" style={{ left: usToPx(sourceUs, windowStartUs) }} />
          </div>
        </div>
      </div>

      <GavetaBorda lado="esq" g={left} rotulo={t.transcript}>
        <CabecalhoGaveta acoes={<Button tamanho="sm" onClick={left.fechar}>{t.close.replace(/ .*/, '')}</Button>}><h3 className="font-semibold">{t.transcript}</h3></CabecalhoGaveta>
        <ol className="flex flex-col gap-1 overflow-y-auto p-3 text-sm">
          {sentences.map(s => <li key={s.id}><button type="button" data-foco-inicial={s.id === (current?.id ?? startId) ? true : undefined} onClick={() => { setRate(0); seek(s.startUs); }}
            className={`foco w-full rounded-md px-2 py-1 text-left ${inClip(s) ? 'bg-accent-subtle' : ''} ${current?.id === s.id ? 'ring-1 ring-accent' : ''}`}>
            <span className="mr-2 font-mono text-xs text-fg-3">{clock(s.startUs)}</span>{s.text}</button></li>)}
        </ol>
      </GavetaBorda>
      <GavetaBorda lado="dir" g={right} rotulo={view === 'captions' ? t.captions : view === 'silences' ? t.silences : view === 'crop' ? t.crop : view === 'translation' ? t.translation : t.borders}>
        {view === 'captions' ? <><CabecalhoGaveta acoes={<Button tamanho="sm" onClick={right.fechar}>{t.close.replace(/ .*/, '')}</Button>}><h3 className="font-semibold">{t.captions}</h3></CabecalhoGaveta>
          {opened && <CaptionPanel data={captions.data} clipId={opened.clipId} sourceId={request.source_id} refresh={captions.refresh} loadError={captions.error} />}</> : view === 'silences' ? <>
          <CabecalhoGaveta acoes={<Button tamanho="sm" onClick={right.fechar}>{t.close.replace(/ .*/, '')}</Button>}><h3 className="font-semibold">{t.silences}</h3></CabecalhoGaveta>
          <SilencesPanel
            silences={silencesView}
            busy={closing}
            onDetect={(thresholdUs, preview) => edit('editor.silences.detect', { threshold_us: thresholdUs }, preview)}
            onToggle={id => edit('editor.silences.toggle', { id })}
            onRevertAll={() => edit('editor.silences.revert_all', {})}
            onApplyAll={() => edit('editor.silences.apply_all', {})}
            onSeek={us => { setRate(0); seek(us); }}
          /></> : view === 'crop' ? <>
          <CabecalhoGaveta acoes={<Button tamanho="sm" onClick={right.fechar}>{t.close.replace(/ .*/, '')}</Button>}><h3 className="font-semibold">{t.crop}</h3></CabecalhoGaveta>
          {opened && range && (
            <CropPanel
              clipId={opened.clipId}
              sourceId={request.source_id}
              range={range}
              sourceUs={sourceUs}
              fps={opened.fps}
              rate={rate}
              sourceAspect={opened.sourceAspect}
              proxy={proxyInfo}
              crop={effectiveCrop}
              busy={closing}
              onPreviewLayout={setDraftCropLayout}
              onCommitLayout={commitCropLayout}
              onPreviewEdits={setDraftCropEdits}
              onCommitEdits={commitCropEdits}
              onSuggestionApplied={applyCropAnswer}
              onSeek={seek}
              onPause={() => setRate(0)}
            />
          )}</> : view === 'translation' ? <>
          <CabecalhoGaveta acoes={<Button tamanho="sm" onClick={right.fechar}>{t.close.replace(/ .*/, '')}</Button>}><h3 className="font-semibold">{t.translation}</h3></CabecalhoGaveta>
          {opened && <TranslationPanel clipId={opened.clipId} clipRevision={opened.revision} onChanged={() => setCaptionRevision(r => r + 1)} onSeek={us => { setRate(0); seek(us); }} />}</> : <>
        <CabecalhoGaveta acoes={<Button tamanho="sm" onClick={right.fechar}>{t.close.replace(/ .*/, '')}</Button>}><h3 className="font-semibold">{t.borders}</h3></CabecalhoGaveta>
        <div className="flex flex-col gap-3 overflow-y-auto p-3 text-sm">
          <section aria-label={t.start}><h4 className="text-xs text-fg-2">{t.start} · #{startId}</h4><p>{startSentence?.text}</p>
            <div className="mt-1 flex flex-wrap gap-2"><Button tamanho="sm" data-foco-inicial onClick={() => moveEdge('start', -1)} atalho="Ctrl+Shift+ArrowLeft">{t.startEarlier}</Button><Button tamanho="sm" onClick={() => moveEdge('start', 1)} atalho="Ctrl+Shift+ArrowRight">{t.startLater}</Button></div></section>
          <section aria-label={t.end}><h4 className="text-xs text-fg-2">{t.end} · #{endId}</h4><p>{endSentence?.text}</p>
            <div className="mt-1 flex flex-wrap gap-2"><Button tamanho="sm" onClick={() => moveEdge('end', -1)} atalho="Ctrl+Shift+ArrowUp">{t.endEarlier}</Button><Button tamanho="sm" onClick={() => moveEdge('end', 1)} atalho="Ctrl+Shift+ArrowDown">{t.endLater}</Button></div></section>
          {range && <p className="font-mono text-xs text-fg-2">{fill(t.duration, { value: clock(range.endUs - range.startUs) })}</p>}
          <p className="text-fg-2">{t.note}</p>
        </div></>}
      </GavetaBorda>
    </div>
  </section>;
}
