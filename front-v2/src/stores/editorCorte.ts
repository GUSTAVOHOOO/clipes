import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { chamar, ErroCore } from '~/core/cliente'
import {
  useFila,
  useSalvamentoEditor,
  type EstadoSalvamentoEditor,
  type EventoProgresso,
  type Fila,
  type Job,
} from '~/core/progresso'
import type { CaptionData, CaptionStyle, CaptionTrack, WordOverride } from '../../../src/features/captions/types'
import type { ClipCrop, CropKeyframe, CropLayout, SuggestedCrop } from '../../../src/features/editor/cropMath'
import type {
  AudioAsset,
  AudioKind,
  AudioMixState,
  LicenseKind,
  MontageState,
  SfxAnchor,
  SilencesState,
  TimelineSentence,
} from '../../../src/features/editor/timelineMath'

export {
  clampCropRect,
  defaultCropRect,
  defaultPanelRect,
  effectiveSplitRatio,
  interpolateCrop,
  panelHeights,
  resolveCrop,
  resolveCropPlan,
  splitBounds,
  type ClipCrop,
  type CropKeyframe,
  type CropLayout,
  type CropRect,
  type CropSegment,
  type DualCropPanels,
  type PanelPlan,
  type ResolvedCropPlan,
  type SuggestedCrop,
} from '../../../src/features/editor/cropMath'
export {
  BUFFER_PX,
  PX_PER_SEC,
  neighborStart,
  nextRate,
  pxToUs,
  sentenceAt,
  splicedToSourceUs,
  sourceToSplicedUs,
  usToPx,
  visiblePx,
  visibleSentences,
  visibleThumbs,
  type AudioAsset,
  type AudioKind,
  type AudioMixState,
  type KeptSegment,
  type LicenseKind,
  type MontageBlock,
  type MontageState,
  type MontageWarning,
  type ResolvedSfx,
  type ResolvedSoundtrack,
  type SfxAnchor,
  type SilenceInterval,
  type SilencesState,
  type SpeechInterval,
  type TimelineSentence,
} from '../../../src/features/editor/timelineMath'
export {
  DUCKING_GAIN,
  activeNarrationAt,
  activeSpeechAt,
  computeSoundtrackGain,
  fadeEnvelope,
  soundtrackPlaybackSec,
  stepDuckGain,
  targetDuckGain,
  type PreviewNarrationSegment,
} from '../../../src/features/editor/duckingMath'
export type {
  CaptionCue,
  CaptionData,
  CaptionStyle,
  CaptionTrack,
  CaptionWord,
  EditableWord,
  MissingGlyph,
  NarrationSummary,
  WordOverride,
} from '../../../src/features/captions/types'

export type CorteIdentidade =
  | { kind: 'candidate'; candidateId: number }
  | { kind: 'avulso'; sourceId: number; startId: number; endId: number }

const RE_CANDIDATO = /^([1-9]\d*)$/
const RE_AVULSO = /^avulso-([1-9]\d*)-([1-9]\d*)-([1-9]\d*)$/

/** Interpreta `:corteId` da rota (`candidateId` numérico ou `avulso-<sourceId>-<startId>-<endId>`). */
export function parsearCorteId(corteId: string): CorteIdentidade | null {
  const limpo = corteId.trim()
  const matchCand = RE_CANDIDATO.exec(limpo)
  if (matchCand) {
    const candidateId = Number(matchCand[1])
    return Number.isSafeInteger(candidateId) && candidateId > 0
      ? { kind: 'candidate', candidateId }
      : null
  }
  const matchAvulso = RE_AVULSO.exec(limpo)
  if (matchAvulso) {
    const sourceId = Number(matchAvulso[1])
    const startId = Number(matchAvulso[2])
    const endId = Number(matchAvulso[3])
    if (
      Number.isSafeInteger(sourceId) &&
      Number.isSafeInteger(startId) &&
      Number.isSafeInteger(endId) &&
      endId >= startId
    ) {
      return { kind: 'avulso', sourceId, startId, endId }
    }
  }
  return null
}

export type EditorRequest = {
  source_id: number
  start_id: number
  end_id: number
  candidate_id?: number
}

export type EditorDocumento = {
  clipId: number
  schemaVersion: number
  request: EditorRequest
  startUs: number
  endUs: number
  windowStartUs?: number
  windowEndUs?: number
  fps?: number
  sourceAspect?: number
  revision: number
  undoCount: number
  redoCount: number
  silences: SilencesState
  crop: ClipCrop
  montage: MontageState | null
  audioMix: AudioMixState
}

type RespostaCropPlana = ClipCrop & {
  clipId: number
  schemaVersion: number
  revision: number
  undoCount: number
  redoCount: number
}

export type ProxyEstado = {
  state: 'idle' | 'queued' | 'running' | 'ready' | 'failed' | 'offline'
  key: string | null
  job: number | null
  progress: number
  error: { code: string; message: string } | null
}

export type TimelineEstado = {
  state: 'missing' | 'queued' | 'running' | 'ready' | 'failed' | 'cancelled'
  key: string | null
  job: number | null
  progress: number
  error: string | null
  thumbs: {
    id: string
    count: number
    intervalUs: number
    width: number
    height: number
    columns: number
  } | null
  waveValues: number[]
  waveBlockUs: number
}

export type ReframeJobEstado = {
  id: number
  job: number
  source: number
  startUs: number
  endUs: number
  layout: 'face' | 'gameplay_webcam' | 'two_people'
  splitRatio: number | null
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  timeline: SuggestedCrop | null
  secondaryTimeline: SuggestedCrop | null
  error: { code: string; message: string } | null
}

export type TraducaoDocumento = {
  schemaVersion?: number
  clipId: number
  sourceId: number
  transcriptId?: number
  permitted: boolean
  permissionError: { code: string; message: string } | null
  detectedLanguage?: string | null
  languageRequired?: boolean
  defaultTargetLanguage?: string | null
  activeTrack: 'original' | 'translated'
  targetLanguage?: 'pt-BR' | 'en' | null
  hasTranslation: boolean
  missingSentenceIds?: number[]
  sentences: Array<{
    id: number
    startUs: number
    endUs: number
    originalText: string
    translatedText: string | null
    edited: boolean
  }>
  run?: {
    id: number
    state: string
    sourceLanguage: string
    targetLanguage: string
    batchesTotal: number
    batchesCompleted: number
    batchesFailed: number
    jobs?: Array<{ id: number; batchIndex: number; state: string; code: string | null; violations: unknown[] }>
  } | null
}

export type EditorSnapshotItem = {
  snapshot_id: number
  schemaVersion: number
  revision: number
  range: { startId: number; endId: number; startUs: number; endUs: number }
  silences: { thresholdUs: number; intervals: unknown[] } | null
  crop: { layout: CropLayout | null; splitRatio?: number | null }
}

export type AbrirCorteArgs = {
  corteId: string
  sourceId: number
  startId: number
  endId: number
  candidateId?: number | null
  fonteDisponivel: boolean
}

export type ResultadoFlush = { ok: true } | { ok: false; erro: ErroCore }

export interface EstadoEditorCorte {
  projetoPath: string | null
  corteId: string | null
  carregando: boolean
  erro: ErroCore | null
  erroAcao: ErroCore | null
  oficial: EditorDocumento | null
  previaLocal: EditorDocumento | null
  frases: TimelineSentence[]
  janelaFrases: { startUs: number; endUs: number } | null
  legendas: CaptionData | null
  remapDescartados: number
  traducao: TraducaoDocumento | null
  bibliotecaAudio: AudioAsset[]
  snapshots: EditorSnapshotItem[]
  proxy: ProxyEstado
  timeline: TimelineEstado
  reframe: ReframeJobEstado | null
  dirty: boolean
  salvando: boolean
  erroSalvamento: ErroCore | null
  modoSomenteLeituraMidia: boolean
  translationJobToClip: Record<number, number>
}

export interface StoreEditorCorte {
  assinar: (listener: () => void) => () => void
  obterSnapshot: () => EstadoEditorCorte
  definirProjeto: (projetoPath: string | null) => void
  definirCorte: (corteId: string | null) => void
  definirFonteDisponivel: (disponivel: boolean) => void
  limpar: () => void
  abrir: (args: AbrirCorteArgs) => Promise<EditorDocumento | null>
  ajustarBorda: (args: {
    edge: 'start' | 'end'
    timeUs?: number
    sentenceDelta?: -1 | 1
    sentenceId?: number
    free?: boolean
    preview: boolean
  }) => Promise<EditorDocumento | null>
  detectarSilencios: (thresholdUs: number, preview: boolean) => Promise<EditorDocumento | null>
  alternarSilencio: (id: number, status?: 'active' | 'reverted') => Promise<EditorDocumento | null>
  aplicarTodosSilencios: () => Promise<EditorDocumento | null>
  reverterTodosSilencios: () => Promise<EditorDocumento | null>
  definirLayoutCrop: (layout: CropLayout, splitRatio: number | null | undefined, preview: boolean) => Promise<EditorDocumento | null>
  aplicarSugestaoCrop: (reframeId: number) => Promise<EditorDocumento | null>
  definirEditsCrop: (
    panel: 'primary' | 'top' | 'bottom',
    edits: CropKeyframe[],
    preview: boolean,
    layout?: CropLayout,
  ) => Promise<EditorDocumento | null>
  iniciarReframe: (layout: 'face' | 'gameplay_webcam' | 'two_people', splitRatio?: number | null, force?: boolean) => Promise<ReframeJobEstado | null>
  consultarReframe: (reframeId: number) => Promise<ReframeJobEstado | null>
  definirInicioNarracao: (blockId: number, timeUs: number | null, free: boolean, preview: boolean) => Promise<EditorDocumento | null>
  definirTrilhaSonora: (args: {
    asset_id?: number | null
    start_us?: number
    volume?: number
    fade_in_us?: number
    fade_out_us?: number
    loop_to_fit?: boolean
    preview?: boolean
  }) => Promise<EditorDocumento | null>
  limparTrilhaSonora: (preview?: boolean) => Promise<EditorDocumento | null>
  adicionarSfx: (args: { asset_id: number; anchor: SfxAnchor; volume?: number; preview?: boolean }) => Promise<EditorDocumento | null>
  atualizarSfx: (args: {
    id: number
    time_us?: number
    anchor?: SfxAnchor
    volume?: number
    fade_in_us?: number
    fade_out_us?: number
    free?: boolean
    preview?: boolean
  }) => Promise<EditorDocumento | null>
  removerSfx: (id: number, preview?: boolean) => Promise<EditorDocumento | null>
  importarAudio: (args: {
    kind: AudioKind
    path: string
    name?: string
    license_kind: LicenseKind
    license_attribution?: string
  }) => Promise<AudioAsset>
  definirLicencaAudio: (id: number, licenseKind: LicenseKind, attribution?: string) => Promise<AudioAsset>
  excluirAudio: (id: number) => Promise<void>
  recarregarBibliotecaAudio: () => Promise<AudioAsset[]>
  definirFaixaLegenda: (track: CaptionTrack) => Promise<void>
  aplicarPresetLegenda: (preset: 'vertical' | 'cinema' | 'simple') => Promise<void>
  definirEstiloLegenda: (style: CaptionStyle) => Promise<void>
  definirEstiloPadraoLegenda: () => Promise<void>
  sobrescreverPalavraLegenda: (position: number, overrides: WordOverride) => Promise<void>
  recarregarLegendas: () => Promise<CaptionData | null>
  iniciarTraducao: (args: { target_language?: 'pt-BR' | 'en'; source_language?: string; confirmed?: boolean }) => Promise<{
    run: number
    jobs: number[]
    batches: number
    sourceLanguage: string
    targetLanguage: string
  } | null>
  definirFaixaTraducao: (track: 'original' | 'translated') => Promise<TraducaoDocumento | null>
  editarTraducao: (sentenceId: number, text: string) => Promise<TraducaoDocumento | null>
  recarregarTraducao: () => Promise<TraducaoDocumento | null>
  corrigirPalavraTranscricao: (sourceId: number, position: number, text: string) => Promise<void>
  desfazerEditor: () => Promise<EditorDocumento | null>
  refazerEditor: () => Promise<EditorDocumento | null>
  carregarSnapshots: () => Promise<EditorSnapshotItem[]>
  salvarAgora: () => Promise<ResultadoFlush>
  garantirSalvoParaSaida: () => Promise<ResultadoFlush>
  solicitarTimeline: () => Promise<void>
  carregarWave: (key: string) => Promise<void>
  sincronizarSalvamento: (salvamento: EstadoSalvamentoEditor) => void
  sincronizarJobs: (jobs: readonly Job[]) => Promise<void>
  registrarEventoProgresso: (evento: EventoProgresso) => void
}

function normalizarErro(err: unknown): ErroCore {
  if (err instanceof ErroCore) return err
  if (err && typeof err === 'object' && 'code' in err) {
    const rec = err as { code?: unknown; message?: unknown; usage?: unknown }
    return new ErroCore(
      typeof rec.code === 'string' && rec.code ? rec.code : 'desconhecido',
      typeof rec.message === 'string' ? rec.message : '',
      rec.usage,
    )
  }
  return new ErroCore('desconhecido', err instanceof Error ? err.message : String(err ?? ''))
}

function estadoInicial(
  projetoPath: string | null = null,
  corteId: string | null = null,
): EstadoEditorCorte {
  return {
    projetoPath,
    corteId,
    carregando: false,
    erro: null,
    erroAcao: null,
    oficial: null,
    previaLocal: null,
    frases: [],
    janelaFrases: null,
    legendas: null,
    remapDescartados: 0,
    traducao: null,
    bibliotecaAudio: [],
    snapshots: [],
    proxy: { state: 'idle', key: null, job: null, progress: 0, error: null },
    timeline: {
      state: 'missing',
      key: null,
      job: null,
      progress: 0,
      error: null,
      thumbs: null,
      waveValues: [],
      waveBlockUs: 100_000,
    },
    reframe: null,
    dirty: false,
    salvando: false,
    erroSalvamento: null,
    modoSomenteLeituraMidia: false,
    translationJobToClip: {},
  }
}

function mesclarDocEditor(base: EditorDocumento | null, proximo: EditorDocumento): EditorDocumento {
  if (!base) return proximo
  return {
    ...proximo,
    windowStartUs: proximo.windowStartUs ?? base.windowStartUs,
    windowEndUs: proximo.windowEndUs ?? base.windowEndUs,
    fps: proximo.fps ?? base.fps,
    sourceAspect: proximo.sourceAspect ?? base.sourceAspect,
  }
}

function mesclarCropNoDocumento(base: EditorDocumento, resp: RespostaCropPlana): EditorDocumento {
  return {
    ...base,
    revision: resp.revision,
    undoCount: resp.undoCount,
    redoCount: resp.redoCount,
    crop: {
      layout: resp.layout,
      explicitLayout: resp.explicitLayout,
      splitRatio: resp.splitRatio,
      suggested: resp.suggested,
      edits: resp.edits,
      gameplayWebcam: resp.gameplayWebcam,
      twoPeople: resp.twoPeople,
      resolved: resp.resolved,
      hasCrop: resp.hasCrop,
      plan: resp.plan,
    },
  }
}

function mesclarFrases(existentes: TimelineSentence[], novas: TimelineSentence[]): TimelineSentence[] {
  if (novas.length === 0) return existentes
  const mapa = new Map<number, TimelineSentence>()
  for (const f of existentes) mapa.set(f.id, f)
  for (const f of novas) mapa.set(f.id, f)
  return Array.from(mapa.values()).sort((a, b) => a.id - b.id)
}

/**
 * Store da sessão do Corte aberto no Editor: gerencia `editor.open`, prévias contínuas (`preview`),
 * atualizações otimistas reversíveis, `editor.flush`, mapa `jobId → clipId` (#297),
 * recarga automática de `editor.sentences` e invalidação de `export.captions`.
 */
export function criarStoreEditorCorte(): StoreEditorCorte {
  let estado = estadoInicial(null, null)
  const ouvintes = new Set<() => void>()
  let sessaoToken = 0
  const translationJobMap = new Map<number, number>()
  const jobsProcessados = new Set<string>()
  const assinaturaJobs = new Map<string, string>()

  const notificar = () => {
    for (const fn of ouvintes) fn()
  }

  const atualizarEstado = (parcial: Partial<EstadoEditorCorte>) => {
    estado = { ...estado, ...parcial }
    notificar()
  }

  const sincronizarMapaTraducao = (): Record<number, number> => {
    const obj: Record<number, number> = {}
    for (const [k, v] of translationJobMap.entries()) obj[k] = v
    return obj
  }

  const resetarSessao = (projetoPath: string | null, corteId: string | null) => {
    sessaoToken += 1
    translationJobMap.clear()
    jobsProcessados.clear()
    assinaturaJobs.clear()
    estado = estadoInicial(projetoPath, corteId)
    notificar()
  }

  const definirProjeto = (projetoPath: string | null) => {
    if (estado.projetoPath === projetoPath) return
    resetarSessao(projetoPath, null)
  }

  const definirCorte = (corteId: string | null) => {
    if (estado.corteId === corteId) return
    resetarSessao(estado.projetoPath, corteId)
  }

  const definirFonteDisponivel = (disponivel: boolean) => {
    const modoSomenteLeituraMidia = !disponivel
    if (estado.modoSomenteLeituraMidia === modoSomenteLeituraMidia) return
    atualizarEstado({ modoSomenteLeituraMidia })
  }

  const limpar = () => {
    resetarSessao(null, null)
  }

  const recarregarLegendas = async (docAlvo?: EditorDocumento | null): Promise<CaptionData | null> => {
    const doc = docAlvo ?? estado.oficial
    if (!doc) return null
    const token = sessaoToken
    try {
      const req = doc.request
      const data = await chamar<CaptionData>('export.captions', {
        source_id: req.source_id,
        start_id: req.start_id,
        end_id: req.end_id,
        ...(typeof req.candidate_id === 'number' ? { candidate_id: req.candidate_id } : {}),
        clip_id: doc.clipId,
        start_us: doc.startUs,
        end_us: doc.endUs,
      })
      if (token !== sessaoToken) return null
      atualizarEstado({ legendas: data })
      return data
    } catch {
      return null
    }
  }

  const recarregarTraducao = async (clipIdAlvo?: number): Promise<TraducaoDocumento | null> => {
    const clipId = clipIdAlvo ?? estado.oficial?.clipId
    if (!clipId) return null
    const token = sessaoToken
    try {
      const doc = await chamar<TraducaoDocumento>('translation.get', { clip_id: clipId })
      if (token !== sessaoToken) return null
      atualizarEstado({ traducao: doc })
      return doc
    } catch {
      return null
    }
  }

  const carregarFrasesRange = async (
    sourceId: number,
    startUs: number,
    endUs: number,
    token: number,
  ): Promise<TimelineSentence[]> => {
    const todas: TimelineSentence[] = []
    let afterId = 0
    for (let pagina = 0; pagina < 10; pagina += 1) {
      const lote = await chamar<TimelineSentence[]>('editor.sentences', {
        source_id: sourceId,
        start_us: startUs,
        end_us: endUs,
        after_id: afterId,
        limit: 500,
      })
      if (token !== sessaoToken) return []
      if (!Array.isArray(lote) || lote.length === 0) break
      todas.push(...lote)
      afterId = lote[lote.length - 1].id
      if (lote.length < 500) break
    }
    return todas
  }

  const garantirFrasesParaBordas = async (doc: EditorDocumento, token: number) => {
    const janela = estado.janelaFrases
    const alvoStart = doc.windowStartUs ?? Math.max(0, doc.startUs - 120_000_000)
    const alvoEnd = doc.windowEndUs ?? doc.endUs + 120_000_000
    if (!janela) {
      const carregadas = await carregarFrasesRange(doc.request.source_id, alvoStart, alvoEnd, token)
      if (token !== sessaoToken) return
      atualizarEstado({
        frases: mesclarFrases(estado.frases, carregadas),
        janelaFrases: { startUs: alvoStart, endUs: alvoEnd },
      })
      return
    }

    const faltouInicio = doc.startUs < janela.startUs
    const faltouFim = doc.endUs > janela.endUs
    if (!faltouInicio && !faltouFim) return

    const promessas: Promise<TimelineSentence[]>[] = []
    if (faltouInicio) {
      promessas.push(carregarFrasesRange(doc.request.source_id, alvoStart, janela.startUs, token))
    }
    if (faltouFim) {
      promessas.push(carregarFrasesRange(doc.request.source_id, janela.endUs, alvoEnd, token))
    }
    const lotes = await Promise.all(promessas)
    if (token !== sessaoToken) return
    let combinadas = estado.frases
    for (const lote of lotes) {
      combinadas = mesclarFrases(combinadas, lote)
    }
    atualizarEstado({
      frases: combinadas,
      janelaFrases: {
        startUs: Math.min(janela.startUs, alvoStart),
        endUs: Math.max(janela.endUs, alvoEnd),
      },
    })
  }

  const carregarWave = async (key: string): Promise<void> => {
    const token = sessaoToken
    try {
      const wave = await chamar<{ blockUs?: number; values?: number[] }>('editor.wave', { key })
      if (token !== sessaoToken) return
      atualizarEstado({
        timeline: {
          ...estado.timeline,
          waveValues: Array.isArray(wave?.values) ? wave.values : [],
          waveBlockUs: typeof wave?.blockUs === 'number' ? wave.blockUs : 100_000,
        },
      })
    } catch {
      // onda opcional se timeline falhou
    }
  }

  const solicitarTimeline = async (): Promise<void> => {
    const doc = estado.oficial
    if (!doc || estado.modoSomenteLeituraMidia) return
    const token = sessaoToken
    try {
      const res = await chamar<{
        state: TimelineEstado['state']
        key: string | null
        job: number | null
        progress: number
        error: string | null
        thumbs: TimelineEstado['thumbs']
      }>('editor.timeline', {
        source_id: doc.request.source_id,
        start_us: doc.startUs,
        end_us: doc.endUs,
      })
      if (token !== sessaoToken) return
      atualizarEstado({
        timeline: {
          ...estado.timeline,
          state: res.state,
          key: res.key ?? null,
          job: res.job ?? null,
          progress: res.progress ?? 0,
          error: res.error ?? null,
          thumbs: res.thumbs ?? null,
        },
      })
      if (res.state === 'ready' && res.key) {
        await carregarWave(res.key)
      }
    } catch (err) {
      if (token !== sessaoToken) return
      const erro = normalizarErro(err)
      if (erro.code !== 'proxy_not_ready') {
        atualizarEstado({
          timeline: { ...estado.timeline, state: 'failed', error: erro.code },
        })
      }
    }
  }

  const abrir = async (args: AbrirCorteArgs): Promise<EditorDocumento | null> => {
    resetarSessao(estado.projetoPath, args.corteId)
    const token = sessaoToken
    const modoSomenteLeituraMidia = !args.fonteDisponivel
    atualizarEstado({ carregando: true, erro: null, modoSomenteLeituraMidia })

    try {
      const openArgs: Record<string, unknown> = {
        source_id: args.sourceId,
        start_id: args.startId,
        end_id: args.endId,
      }
      if (typeof args.candidateId === 'number') {
        openArgs.candidate_id = args.candidateId
      }

      const doc = await chamar<EditorDocumento>('editor.open', openArgs)
      if (token !== sessaoToken) return null

      const winStart = doc.windowStartUs ?? Math.max(0, doc.startUs - 120_000_000)
      const winEnd = doc.windowEndUs ?? doc.endUs + 120_000_000

      atualizarEstado({
        carregando: false,
        oficial: doc,
        previaLocal: null,
        dirty: false,
        janelaFrases: { startUs: winStart, endUs: winEnd },
      })

      const pFrases = carregarFrasesRange(args.sourceId, winStart, winEnd, token)
      const pLegendas = chamar<CaptionData>('export.captions', {
        source_id: args.sourceId,
        start_id: doc.request.start_id,
        end_id: doc.request.end_id,
        ...(typeof args.candidateId === 'number' ? { candidate_id: args.candidateId } : {}),
        clip_id: doc.clipId,
        start_us: doc.startUs,
        end_us: doc.endUs,
      })
      const pAudio = chamar<AudioAsset[]>('audio.list', {})
      const pTraducao = chamar<TraducaoDocumento>('translation.get', { clip_id: doc.clipId })
      const pRemap = chamar<{ discarded?: number }>('captions.remap_status', { source_id: args.sourceId })
      const pProxy = args.fonteDisponivel
        ? chamar<{
            state: ProxyEstado['state']
            key: string | null
            job: number | null
            progress: number
            error: { code: string; message: string } | null
          }>('proxy.request', {
            source_id: args.sourceId,
            start_us: doc.startUs,
            end_us: doc.endUs,
          })
        : Promise.resolve(null)

      const [rFrases, rLegendas, rAudio, rTraducao, rRemap, rProxy] = await Promise.allSettled([
        pFrases,
        pLegendas,
        pAudio,
        pTraducao,
        pRemap,
        pProxy,
      ])
      if (token !== sessaoToken) return null

      const patch: Partial<EstadoEditorCorte> = {}
      if (rFrases.status === 'fulfilled') patch.frases = rFrases.value
      if (rLegendas.status === 'fulfilled') patch.legendas = rLegendas.value
      if (rAudio.status === 'fulfilled' && Array.isArray(rAudio.value)) patch.bibliotecaAudio = rAudio.value
      if (rTraducao.status === 'fulfilled') patch.traducao = rTraducao.value
      if (rRemap.status === 'fulfilled') patch.remapDescartados = rRemap.value?.discarded ?? 0

      if (!args.fonteDisponivel) {
        patch.proxy = { state: 'offline', key: null, job: null, progress: 0, error: null }
      } else if (rProxy.status === 'fulfilled' && rProxy.value) {
        patch.proxy = {
          state: rProxy.value.state,
          key: rProxy.value.key ?? null,
          job: rProxy.value.job ?? null,
          progress: rProxy.value.progress ?? 0,
          error: rProxy.value.error ?? null,
        }
      } else if (rProxy.status === 'rejected') {
        const erroProxy = normalizarErro(rProxy.reason)
        if (erroProxy.code === 'source_offline' || erroProxy.code === 'source_changed') {
          patch.modoSomenteLeituraMidia = true
          patch.proxy = { state: 'offline', key: null, job: null, progress: 0, error: null }
        } else {
          patch.proxy = {
            state: 'failed',
            key: null,
            job: null,
            progress: 0,
            error: { code: erroProxy.code, message: erroProxy.detalhe },
          }
        }
      }

      atualizarEstado(patch)

      if (patch.proxy?.state === 'ready') {
        void solicitarTimeline()
      }

      return doc
    } catch (err) {
      if (token !== sessaoToken) return null
      atualizarEstado({ carregando: false, erro: normalizarErro(err) })
      return null
    }
  }

  const executarMutacaoDocumento = async (
    comando: string,
    payload: Record<string, unknown>,
    preview: boolean,
    opcoes?: {
      otimista?: (doc: EditorDocumento) => EditorDocumento
      aoConfirmar?: (doc: EditorDocumento) => void
    },
  ): Promise<EditorDocumento | null> => {
    const base = estado.oficial
    if (!base) return null
    const token = sessaoToken

    if (preview) {
      const resp = await chamar<EditorDocumento>(comando, { ...payload, clip_id: base.clipId, preview: true })
      if (token !== sessaoToken) return null
      const previa = mesclarDocEditor(base, resp)
      atualizarEstado({ previaLocal: previa, erroAcao: null })
      return previa
    }

    const antes = base
    const dirtyAntes = estado.dirty
    if (opcoes?.otimista) {
      atualizarEstado({
        oficial: opcoes.otimista(base),
        previaLocal: null,
        dirty: true,
        erroAcao: null,
      })
    }

    try {
      const resp = await chamar<EditorDocumento>(comando, { ...payload, clip_id: base.clipId, preview: false })
      if (token !== sessaoToken) return null
      const atualizado = mesclarDocEditor(antes, resp)
      atualizarEstado({
        oficial: atualizado,
        previaLocal: null,
        dirty: true,
        erroAcao: null,
      })
      opcoes?.aoConfirmar?.(atualizado)
      return atualizado
    } catch (err) {
      if (token !== sessaoToken) throw err
      const erro = normalizarErro(err)
      atualizarEstado({
        oficial: antes,
        previaLocal: null,
        dirty: dirtyAntes,
        erroAcao: erro,
      })
      throw erro
    }
  }

  const ajustarBorda: StoreEditorCorte['ajustarBorda'] = async (args) => {
    const payload: Record<string, unknown> = { edge: args.edge }
    if (typeof args.timeUs === 'number') payload.time_us = args.timeUs
    if (typeof args.sentenceDelta === 'number') payload.sentence_delta = args.sentenceDelta
    if (typeof args.sentenceId === 'number') payload.sentence_id = args.sentenceId
    if (args.free !== undefined) payload.free = args.free

    const token = sessaoToken
    const doc = await executarMutacaoDocumento('editor.adjust', payload, args.preview, {
      otimista:
        typeof args.timeUs === 'number'
          ? (atual) => ({
              ...atual,
              startUs: args.edge === 'start' ? args.timeUs! : atual.startUs,
              endUs: args.edge === 'end' ? args.timeUs! : atual.endUs,
            })
          : undefined,
      aoConfirmar: (atualizado) => {
        void recarregarLegendas(atualizado)
      },
    })
    if (doc && token === sessaoToken) {
      await garantirFrasesParaBordas(doc, token)
    }
    return doc
  }

  const detectarSilencios: StoreEditorCorte['detectarSilencios'] = (thresholdUs, preview) =>
    executarMutacaoDocumento(
      'editor.silences.detect',
      { threshold_us: thresholdUs },
      preview,
      preview ? undefined : { aoConfirmar: (doc) => void recarregarLegendas(doc) },
    )

  const alternarSilencio: StoreEditorCorte['alternarSilencio'] = (id, status) =>
    executarMutacaoDocumento(
      'editor.silences.toggle',
      { id, ...(status ? { status } : {}) },
      false,
      {
        otimista: (atual) => ({
          ...atual,
          silences: {
            ...atual.silences,
            intervals: atual.silences.intervals.map((item) =>
              item.id === id
                ? { ...item, status: status ?? (item.status === 'active' ? 'reverted' : 'active') }
                : item,
            ),
          },
        }),
        aoConfirmar: (doc) => void recarregarLegendas(doc),
      },
    )

  const aplicarTodosSilencios: StoreEditorCorte['aplicarTodosSilencios'] = () =>
    executarMutacaoDocumento('editor.silences.apply_all', {}, false, {
      aoConfirmar: (doc) => void recarregarLegendas(doc),
    })

  const reverterTodosSilencios: StoreEditorCorte['reverterTodosSilencios'] = () =>
    executarMutacaoDocumento('editor.silences.revert_all', {}, false, {
      aoConfirmar: (doc) => void recarregarLegendas(doc),
    })

  const definirLayoutCrop: StoreEditorCorte['definirLayoutCrop'] = async (layout, splitRatio, preview) => {
    const base = estado.oficial
    if (!base) return null
    const token = sessaoToken
    const resp = await chamar<RespostaCropPlana>('editor.crop.set_layout', {
      clip_id: base.clipId,
      layout,
      ...(splitRatio !== undefined && splitRatio !== null ? { split_ratio: splitRatio } : {}),
      preview,
    })
    if (token !== sessaoToken) return null
    if (preview) {
      const previa = mesclarCropNoDocumento(base, resp)
      atualizarEstado({ previaLocal: previa, erroAcao: null })
      return previa
    }
    const atualizado = mesclarCropNoDocumento(base, resp)
    atualizarEstado({ oficial: atualizado, previaLocal: null, dirty: true, erroAcao: null })
    return atualizado
  }

  const aplicarSugestaoCrop: StoreEditorCorte['aplicarSugestaoCrop'] = async (reframeId) => {
    const base = estado.oficial
    if (!base) return null
    const token = sessaoToken
    const resp = await chamar<RespostaCropPlana>('editor.crop.set_suggested', {
      clip_id: base.clipId,
      reframe_id: reframeId,
    })
    if (token !== sessaoToken) return null
    const atualizado = mesclarCropNoDocumento(base, resp)
    atualizarEstado({ oficial: atualizado, previaLocal: null, dirty: true, erroAcao: null })
    return atualizado
  }

  const definirEditsCrop: StoreEditorCorte['definirEditsCrop'] = async (panel, edits, preview, layout) => {
    const base = estado.oficial
    if (!base) return null
    const token = sessaoToken
    const resp = await chamar<RespostaCropPlana>('editor.crop.set_edits', {
      clip_id: base.clipId,
      panel,
      edits,
      ...(layout ? { layout } : {}),
      preview,
    })
    if (token !== sessaoToken) return null
    if (preview) {
      const previa = mesclarCropNoDocumento(base, resp)
      atualizarEstado({ previaLocal: previa, erroAcao: null })
      return previa
    }
    const atualizado = mesclarCropNoDocumento(base, resp)
    atualizarEstado({ oficial: atualizado, previaLocal: null, dirty: true, erroAcao: null })
    return atualizado
  }

  const iniciarReframe: StoreEditorCorte['iniciarReframe'] = async (layout, splitRatio, force) => {
    const doc = estado.oficial
    if (!doc || estado.modoSomenteLeituraMidia) return null
    const token = sessaoToken
    const res = await chamar<ReframeJobEstado>('reframe.start', {
      source: doc.request.source_id,
      startUs: doc.startUs,
      endUs: doc.endUs,
      layout,
      ...(splitRatio !== undefined && splitRatio !== null ? { splitRatio } : {}),
      ...(force ? { force: true } : {}),
    })
    if (token !== sessaoToken) return null
    atualizarEstado({ reframe: res })
    return res
  }

  const consultarReframe: StoreEditorCorte['consultarReframe'] = async (reframeId) => {
    const token = sessaoToken
    const res = await chamar<ReframeJobEstado>('reframe.status', { id: reframeId })
    if (token !== sessaoToken) return null
    atualizarEstado({ reframe: res })
    return res
  }

  const definirInicioNarracao: StoreEditorCorte['definirInicioNarracao'] = (blockId, timeUs, free, preview) =>
    executarMutacaoDocumento('editor.montage.set_start', { block_id: blockId, time_us: timeUs, free }, preview)

  const definirTrilhaSonora: StoreEditorCorte['definirTrilhaSonora'] = (args) => {
    const { preview = false, ...rest } = args
    return executarMutacaoDocumento('editor.audio.soundtrack.set', rest, preview)
  }

  const limparTrilhaSonora: StoreEditorCorte['limparTrilhaSonora'] = (preview = false) =>
    executarMutacaoDocumento('editor.audio.soundtrack.clear', {}, preview)

  const adicionarSfx: StoreEditorCorte['adicionarSfx'] = (args) => {
    const { preview = false, ...rest } = args
    return executarMutacaoDocumento('editor.audio.sfx.add', rest, preview)
  }

  const atualizarSfx: StoreEditorCorte['atualizarSfx'] = (args) => {
    const { preview = false, ...rest } = args
    return executarMutacaoDocumento('editor.audio.sfx.update', rest, preview)
  }

  const removerSfx: StoreEditorCorte['removerSfx'] = (id, preview = false) =>
    executarMutacaoDocumento('editor.audio.sfx.remove', { id }, preview)

  const recarregarBibliotecaAudio = async (): Promise<AudioAsset[]> => {
    const token = sessaoToken
    const lista = await chamar<AudioAsset[]>('audio.list', {})
    if (token !== sessaoToken) return []
    atualizarEstado({ bibliotecaAudio: lista })
    return lista
  }

  const importarAudio: StoreEditorCorte['importarAudio'] = async (args) => {
    const criado = await chamar<AudioAsset>('audio.import', args)
    await recarregarBibliotecaAudio()
    return criado
  }

  const definirLicencaAudio: StoreEditorCorte['definirLicencaAudio'] = async (id, licenseKind, attribution) => {
    const atualizado = await chamar<AudioAsset>('audio.license.set', {
      id,
      license_kind: licenseKind,
      ...(attribution !== undefined ? { license_attribution: attribution } : {}),
    })
    await recarregarBibliotecaAudio()
    return atualizado
  }

  const excluirAudio: StoreEditorCorte['excluirAudio'] = async (id) => {
    await chamar('audio.delete', { id })
    await recarregarBibliotecaAudio()
  }

  const definirFaixaLegenda: StoreEditorCorte['definirFaixaLegenda'] = async (track) => {
    const doc = estado.oficial
    if (!doc) return
    await chamar('captions.track.set', {
      clip_id: doc.clipId,
      ...(typeof doc.request.candidate_id === 'number' ? { candidate_id: doc.request.candidate_id } : {}),
      track,
    })
    await recarregarLegendas(doc)
  }

  const aplicarPresetLegenda: StoreEditorCorte['aplicarPresetLegenda'] = async (preset) => {
    const doc = estado.oficial
    const revision = estado.legendas?.style.revision ?? 0
    if (!doc) return
    await chamar('captions.style.preset', { clip_id: doc.clipId, preset, revision })
    await recarregarLegendas(doc)
  }

  const definirEstiloLegenda: StoreEditorCorte['definirEstiloLegenda'] = async (style) => {
    const doc = estado.oficial
    if (!doc) return
    await chamar('captions.style.set', { clip_id: doc.clipId, style })
    await recarregarLegendas(doc)
  }

  const definirEstiloPadraoLegenda: StoreEditorCorte['definirEstiloPadraoLegenda'] = async () => {
    const doc = estado.oficial
    if (!doc) return
    await chamar('captions.style.default', { clip_id: doc.clipId })
  }

  const sobrescreverPalavraLegenda: StoreEditorCorte['sobrescreverPalavraLegenda'] = async (position, overrides) => {
    const doc = estado.oficial
    if (!doc) return
    const transcriptId = estado.legendas?.transcriptId ?? doc.request.source_id
    await chamar('captions.override', { transcript_id: transcriptId, position, overrides })
    await recarregarLegendas(doc)
  }

  const iniciarTraducao: StoreEditorCorte['iniciarTraducao'] = async (args) => {
    const doc = estado.oficial
    if (!doc) return null
    const res = await chamar<{
      run: number
      jobs: number[]
      batches: number
      sourceLanguage: string
      targetLanguage: string
    }>('translation.start', {
      clip_id: doc.clipId,
      ...args,
    })
    for (const jobId of res.jobs) {
      translationJobMap.set(jobId, doc.clipId)
    }
    atualizarEstado({ translationJobToClip: sincronizarMapaTraducao() })
    return res
  }

  const definirFaixaTraducao: StoreEditorCorte['definirFaixaTraducao'] = async (track) => {
    const doc = estado.oficial
    if (!doc) return null
    const token = sessaoToken
    const traducao = await chamar<TraducaoDocumento>('translation.track.set', {
      clip_id: doc.clipId,
      track,
    })
    if (token !== sessaoToken) return null
    atualizarEstado({ traducao })
    await recarregarLegendas(doc)
    return traducao
  }

  const editarTraducao: StoreEditorCorte['editarTraducao'] = async (sentenceId, text) => {
    const doc = estado.oficial
    if (!doc) return null
    const token = sessaoToken
    const traducao = await chamar<TraducaoDocumento>('translation.edit', {
      clip_id: doc.clipId,
      sentence_id: sentenceId,
      text,
    })
    if (token !== sessaoToken) return null
    atualizarEstado({ traducao })
    await recarregarLegendas(doc)
    return traducao
  }

  const corrigirPalavraTranscricao: StoreEditorCorte['corrigirPalavraTranscricao'] = async (
    sourceId,
    position,
    text,
  ) => {
    const doc = estado.oficial
    const token = sessaoToken
    const frasesAntes = estado.frases
    const sentenceId = Math.floor(position / 10)
    const otimistas = frasesAntes.map((f) =>
      f.id === sentenceId ? { ...f, text: f.text.replace(/\S+/, text) } : f,
    )
    atualizarEstado({ frases: otimistas })

    try {
      await chamar('transcription.correct', { source_id: sourceId, position, text })
      if (token !== sessaoToken) return
      if (doc) {
        const startUs = estado.janelaFrases?.startUs ?? doc.windowStartUs ?? Math.max(0, doc.startUs - 120_000_000)
        const endUs = estado.janelaFrases?.endUs ?? doc.windowEndUs ?? doc.endUs + 120_000_000
        const [novasFrases] = await Promise.all([
          carregarFrasesRange(sourceId, startUs, endUs, token),
          recarregarLegendas(doc),
        ])
        if (token === sessaoToken && novasFrases.length > 0) {
          atualizarEstado({ frases: novasFrases })
        }
      }
    } catch (err) {
      if (token === sessaoToken) {
        atualizarEstado({ frases: frasesAntes, erroAcao: normalizarErro(err) })
      }
      throw err
    }
  }

  const desfazerEditor: StoreEditorCorte['desfazerEditor'] = () =>
    executarMutacaoDocumento('editor.undo', {}, false, {
      aoConfirmar: (doc) => void recarregarLegendas(doc),
    })

  const refazerEditor: StoreEditorCorte['refazerEditor'] = () =>
    executarMutacaoDocumento('editor.redo', {}, false, {
      aoConfirmar: (doc) => void recarregarLegendas(doc),
    })

  const carregarSnapshots: StoreEditorCorte['carregarSnapshots'] = async () => {
    const doc = estado.oficial
    if (!doc) return []
    const token = sessaoToken
    const lista = await chamar<EditorSnapshotItem[]>('editor.snapshots', { clip_id: doc.clipId })
    if (token !== sessaoToken) return []
    atualizarEstado({ snapshots: Array.isArray(lista) ? lista : [] })
    return lista
  }

  const executarFlush = async (): Promise<ResultadoFlush> => {
    const token = sessaoToken
    atualizarEstado({ salvando: true, erroSalvamento: null })
    try {
      await chamar('editor.flush', {})
      if (token !== sessaoToken) return { ok: true }
      atualizarEstado({ dirty: false, salvando: false, erroSalvamento: null })
      return { ok: true }
    } catch (err) {
      const erro = normalizarErro(err)
      if (token === sessaoToken) {
        atualizarEstado({ salvando: false, erroSalvamento: erro })
      }
      return { ok: false, erro }
    }
  }

  const salvarAgora = () => executarFlush()
  const garantirSalvoParaSaida = () => executarFlush()

  const sincronizarSalvamento = (salvamento: EstadoSalvamentoEditor) => {
    const clipAtivo = estado.oficial?.clipId
    if (salvamento.estado === 'salvo') {
      if (salvamento.clipId !== undefined && clipAtivo !== undefined && salvamento.clipId !== clipAtivo) {
        return
      }
      if (estado.dirty || estado.salvando || estado.erroSalvamento) {
        atualizarEstado({ dirty: false, salvando: false, erroSalvamento: null })
      }
    } else if (salvamento.estado === 'erro') {
      const proxErro = salvamento.erro ?? new ErroCore('project_write', '')
      if (estado.salvando || estado.erroSalvamento?.code !== proxErro.code) {
        atualizarEstado({ salvando: false, erroSalvamento: proxErro })
      }
    }
  }

  const processarConclusaoTraducao = async (jobNum: number) => {
    const clipId = translationJobMap.get(jobNum)
    const doc = estado.oficial
    if (!clipId || !doc || clipId !== doc.clipId) return
    const traducao = await recarregarTraducao(clipId)
    const faixaTraduzida =
      traducao?.activeTrack === 'translated' ||
      estado.traducao?.activeTrack === 'translated' ||
      estado.legendas?.track === 'translated'
    if (faixaTraduzida) {
      await recarregarLegendas(doc)
    }
  }

  const registrarEventoProgresso = (evento: EventoProgresso) => {
    const jobNum = Number(evento.job)
    const doc = estado.oficial
    if (!doc) return

    if (
      evento.stage === 'ai:translation:done' ||
      evento.stage === 'ai:translation:paused'
    ) {
      if (Number.isInteger(jobNum) && !jobsProcessados.has(`tr:${evento.job}:${evento.stage}`)) {
        jobsProcessados.add(`tr:${evento.job}:${evento.stage}`)
        void processarConclusaoTraducao(jobNum)
      }
      return
    }

    if (estado.proxy.job !== null && String(estado.proxy.job) === evento.job) {
      if (evento.stage === 'complete') {
        atualizarEstado({ proxy: { ...estado.proxy, state: 'ready', progress: 100, error: null } })
        void solicitarTimeline()
      } else if (evento.stage === 'failed') {
        atualizarEstado({
          proxy: { ...estado.proxy, state: 'failed', progress: 0, error: evento.error ?? null },
        })
      } else if (evento.stage === 'proxy') {
        atualizarEstado({
          proxy: { ...estado.proxy, state: 'running', progress: evento.percentage },
        })
      }
      return
    }

    if (estado.timeline.job !== null && String(estado.timeline.job) === evento.job) {
      if (evento.stage === 'complete' && estado.timeline.key) {
        void chamar<TimelineEstado>('editor.timeline_status', {
          key: estado.timeline.key,
          window_us: (doc.windowEndUs ?? doc.endUs) - (doc.windowStartUs ?? doc.startUs),
        }).then((st) => {
          atualizarEstado({ timeline: { ...estado.timeline, ...st, state: 'ready' } })
          if (estado.timeline.key) void carregarWave(estado.timeline.key)
        })
      } else if (evento.stage === 'failed') {
        atualizarEstado({
          timeline: { ...estado.timeline, state: 'failed', error: evento.error?.code ?? 'failed' },
        })
      } else if (evento.stage === 'timeline') {
        atualizarEstado({
          timeline: { ...estado.timeline, state: 'running', progress: evento.percentage },
        })
      }
      return
    }

    if (estado.reframe && String(estado.reframe.job) === evento.job) {
      if (evento.stage === 'complete') {
        void consultarReframe(estado.reframe.id)
      } else if (evento.stage === 'failed') {
        atualizarEstado({
          reframe: { ...estado.reframe, state: 'failed', error: evento.error ?? null },
        })
      } else if (evento.stage.startsWith('reframe_')) {
        atualizarEstado({
          reframe: { ...estado.reframe, state: 'running', progress: evento.percentage },
        })
      }
    }
  }

  const sincronizarJobs = async (jobs: readonly Job[]): Promise<void> => {
    for (const job of jobs) {
      const assinatura = `${job.estado}:${job.etapa}:${Math.round(job.percentual)}`
      if (assinaturaJobs.get(job.id) === assinatura) continue
      assinaturaJobs.set(job.id, assinatura)

      const jobNum = Number(job.id)
      if (
        Number.isInteger(jobNum) &&
        translationJobMap.has(jobNum) &&
        (job.estado === 'concluido' || job.estado === 'pausado' || job.estado === 'falhou')
      ) {
        await processarConclusaoTraducao(jobNum)
      }

      if (estado.proxy.job !== null && String(estado.proxy.job) === job.id) {
        if (job.estado === 'concluido' && estado.proxy.state !== 'ready') {
          atualizarEstado({ proxy: { ...estado.proxy, state: 'ready', progress: 100, error: null } })
          void solicitarTimeline()
        } else if (job.estado === 'falhou' && estado.proxy.state !== 'failed') {
          atualizarEstado({
            proxy: { ...estado.proxy, state: 'failed', progress: 0, error: job.erro ?? null },
          })
        } else if (job.estado === 'rodando') {
          atualizarEstado({
            proxy: { ...estado.proxy, state: 'running', progress: job.percentual },
          })
        }
      }

      if (estado.reframe && String(estado.reframe.job) === job.id) {
        if (job.estado === 'concluido' && estado.reframe.state !== 'completed') {
          await consultarReframe(estado.reframe.id)
        } else if (job.estado === 'falhou' && estado.reframe.state !== 'failed') {
          atualizarEstado({
            reframe: { ...estado.reframe, state: 'failed', error: job.erro ?? null },
          })
        } else if (job.estado === 'rodando') {
          atualizarEstado({
            reframe: { ...estado.reframe, state: 'running', progress: job.percentual },
          })
        }
      }
    }
  }

  return {
    assinar: (listener) => {
      ouvintes.add(listener)
      return () => ouvintes.delete(listener)
    },
    obterSnapshot: () => estado,
    definirProjeto,
    definirCorte,
    definirFonteDisponivel,
    limpar,
    abrir,
    ajustarBorda,
    detectarSilencios,
    alternarSilencio,
    aplicarTodosSilencios,
    reverterTodosSilencios,
    definirLayoutCrop,
    aplicarSugestaoCrop,
    definirEditsCrop,
    iniciarReframe,
    consultarReframe,
    definirInicioNarracao,
    definirTrilhaSonora,
    limparTrilhaSonora,
    adicionarSfx,
    atualizarSfx,
    removerSfx,
    importarAudio,
    definirLicencaAudio,
    excluirAudio,
    recarregarBibliotecaAudio,
    definirFaixaLegenda,
    aplicarPresetLegenda,
    definirEstiloLegenda,
    definirEstiloPadraoLegenda,
    sobrescreverPalavraLegenda,
    recarregarLegendas,
    iniciarTraducao,
    definirFaixaTraducao,
    editarTraducao,
    recarregarTraducao,
    corrigirPalavraTranscricao,
    desfazerEditor,
    refazerEditor,
    carregarSnapshots,
    salvarAgora,
    garantirSalvoParaSaida,
    solicitarTimeline,
    carregarWave,
    sincronizarSalvamento,
    sincronizarJobs,
    registrarEventoProgresso,
  }
}

const storesPorInstancia = new WeakMap<object, StoreEditorCorte>()
const storePadrao = criarStoreEditorCorte()

function obterStore(fila?: Fila): StoreEditorCorte {
  if (!fila) return storePadrao
  let s = storesPorInstancia.get(fila)
  if (!s) {
    s = criarStoreEditorCorte()
    storesPorInstancia.set(fila, s)
  }
  return s
}

/** Hook React da sessão do Editor: limpa estado ao trocar Projeto/Corte e sincroniza `useFila` e `useSalvamentoEditor`. */
export function useEditorCorte(
  projetoPath: string | null,
  corteId: string | null,
  opcoes?: { fonteDisponivel?: boolean; fila?: Fila },
) {
  const fila = opcoes?.fila
  const store = obterStore(fila)
  const jobs = useFila(fila)
  const salvamento = useSalvamentoEditor(fila)

  useEffect(() => {
    store.definirProjeto(projetoPath)
  }, [store, projetoPath])

  useEffect(() => {
    store.definirCorte(corteId)
  }, [store, corteId])

  useEffect(() => {
    if (opcoes?.fonteDisponivel !== undefined) {
      store.definirFonteDisponivel(opcoes.fonteDisponivel)
    }
  }, [store, opcoes?.fonteDisponivel])

  useEffect(() => {
    if (projetoPath) {
      void store.sincronizarJobs(jobs)
    }
  }, [store, projetoPath, jobs])

  useEffect(() => {
    store.sincronizarSalvamento(salvamento)
  }, [store, salvamento])

  const estado = useSyncExternalStore(store.assinar, store.obterSnapshot, store.obterSnapshot)
  const documentoAtivo = estado.previaLocal ?? estado.oficial

  const abrir = useCallback((args: AbrirCorteArgs) => store.abrir(args), [store])
  const garantirSalvoParaSaida = useCallback(() => store.garantirSalvoParaSaida(), [store])
  const salvarAgora = useCallback(() => store.salvarAgora(), [store])

  return useMemo(
    () => ({
      ...estado,
      documentoAtivo,
      store,
      abrir,
      salvarAgora,
      garantirSalvoParaSaida,
    }),
    [estado, documentoAtivo, store, abrir, salvarAgora, garantirSalvoParaSaida],
  )
}
