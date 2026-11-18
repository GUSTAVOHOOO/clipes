import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { chamar, paraErroCore, type ErroCore } from '~/core/cliente'
import { useFila, type Fila, type Job } from '~/core/progresso'
import {
  resolverDestinoSelecao,
  type DestinoSelecao,
  type PerfilProvedorLista,
  type RespostaTarefasAssistente,
} from '~/stores/selecaoProjeto'

export interface AnguloItem {
  name: string
  promise: string
  audience?: string
  sentence_ids?: number[]
}

export interface AngulosDoc {
  schemaVersion: number
  revision: number
  detectedLanguage: string | null
  languageRequired: boolean
  selected: AnguloItem | null
  angles: AnguloItem[]
  generations: unknown[]
  job: { id: number; state: string; code: string | null } | null
}

export interface BlocoRoteiro {
  id: number
  position: number
  title: string
  intent: string
  refs: number[]
  narration: string | null
  status: 'aprovado' | 'pendente'
  stale: boolean
  version: number
  edited: boolean
  profile?: string | null
  job: unknown
}

export interface RoteiroDoc {
  schemaVersion: number
  revision: number
  detectedLanguage: string | null
  languageRequired: boolean
  angle: AnguloItem | null
  current: {
    generation: number
    language: string
    blocks: BlocoRoteiro[]
    totalChars: number
    pending: number
    approved: number
    complete: boolean
  } | null
  narrationAllowed: boolean
  busy: boolean
  job: { id: number; state: string; code: string | null; violations?: unknown[] } | null
  generations: unknown[]
  limits: {
    titleChars: number
    narrationChars: number
    scriptChars: number
    refs: number
  }
}

export interface LimpezaAudioInfo {
  applicable: boolean
  enabled: boolean
  ready: boolean
  noiseFloorDb: number | null
  noiseFloorSource: 'pending' | 'vad' | 'default'
  warningCode: string | null
  warning: string | null
}

export interface AlinhamentoBloco {
  status: 'pending' | 'aligned' | 'needs_review' | 'approved' | 'failed'
  choice: 'script' | 'spoken' | null
  activeTrack: 'script' | 'spoken' | null
  substitutions: number
  insertions: number
  deletions: number
  maxConsecutiveInsertions: number
  errorCode: string | null
  modelId: string
  spokenText: string | null
  wordCount: number
}

export interface BlocoNarracao {
  blockId: number
  position: number
  title: string
  versionId: number
  narrationText: string | null
  audio: {
    id: number
    versionId: number
    voiceId: string
    modelId: string
    engineId: string
    relPath: string
    durationUs: number
    sampleRate: number
    channels: number
    bytes: number
    stale: boolean
    trimmed: boolean
    cleanup: LimpezaAudioInfo | null
  } | null
  alignment: AlinhamentoBloco | null
}

export interface NarracaoDoc {
  candidate: number
  narrationAllowed: boolean
  gateReason: 'generating' | 'no_script' | 'pending_blocks' | null
  language: string
  defaultVoiceId: string
  activeModelId: string
  busy: boolean
  job: unknown
  importBusy: boolean
  importJob: unknown
  alignBusy: boolean
  alignJob: unknown
  alignPrerequisitesReady: boolean
  vadReady: boolean
  blocks: BlocoNarracao[]
  totalDurationUs: number
}

export interface CatalogoTtsDoc {
  componentInstalled: boolean
  activeModels: Record<string, string>
  engines: Array<{
    id: string
    label: string
    componentId: string
    codeLicense: string
    sourceUrl: string
    prohibitedUse: { textEn: string; summaryPt: string; version: string }
  }>
  models: Array<{
    id: string
    engineId: string
    language: string
    label: string
    description: string
    defaultForLanguage: boolean
    lightweight: boolean
    active: boolean
    installed: boolean
    updateAvailable: boolean
    termsAccepted: boolean
    license: string
    size: number
  }>
  voices: Array<{
    id: string
    engineId: string
    language: string
    gender: string
    label: string
    defaultForLanguage: boolean
    license: string
    attribution: string
    sourceUrl: string
    models: string[]
  }>
}

export interface StatusPocketTts {
  installed: boolean
  version: string | null
  pinned: string
  outdated: boolean
}

export interface OrcamentoJobs {
  limitMicroUsd?: number | null
  spentMicroUsd?: number
  remainingMicroUsd?: number | null
  callsRemaining?: number | null
  paused?: boolean
}

export interface EstadoTransformarCorte {
  candidateId: number | null
  carregando: boolean
  erro: ErroCore | null
  angulos: AngulosDoc | null
  roteiro: RoteiroDoc | null
  narracao: NarracaoDoc | null
  catalogoTts: CatalogoTtsDoc | null
  pocketTts: StatusPocketTts | null
  perfis: PerfilProvedorLista[]
  tarefas: RespostaTarefasAssistente | null
  orcamento: OrcamentoJobs | null
  somenteLocal: boolean
}

export interface StoreTransformarCorte {
  assinar: (listener: () => void) => () => void
  obterSnapshot: () => EstadoTransformarCorte
  definirCandidato: (candidateId: number | null) => void
  carregarTudo: (candidateId: number, opcoes?: { silencioso?: boolean }) => Promise<void>
  recarregarAngulos: (candidateId?: number) => Promise<void>
  recarregarRoteiro: (candidateId?: number) => Promise<void>
  recarregarNarracao: (candidateId?: number) => Promise<void>
  recarregarTts: () => Promise<void>
  sincronizarJobs: (jobs: readonly Job[]) => void
}

/**
 * Resolve o destino de rede, privacidade e bloqueio `Somente local` para a tarefa `script`
 * (ou um `profileId` específico escolhido em `Refazer com outro Perfil…`).
 */
export function resolverDestinoTransformar(
  profileIdOrName: string | null | undefined,
  perfis: readonly PerfilProvedorLista[],
  tarefas?: RespostaTarefasAssistente | null,
): DestinoSelecao {
  const tarefasAdaptadas = tarefas
    ? {
        ...tarefas,
        tasks: tarefas.tasks.map((t) => ({
          ...t,
          task: t.task === 'script' ? 'selection' : t.task === 'selection' ? '_selection' : t.task,
        })),
      }
    : tarefas
  return resolverDestinoSelecao(profileIdOrName, perfis, tarefasAdaptadas)
}

function estadoInicial(candidateId: number | null = null): EstadoTransformarCorte {
  return {
    candidateId,
    carregando: false,
    erro: null,
    angulos: null,
    roteiro: null,
    narracao: null,
    catalogoTts: null,
    pocketTts: null,
    perfis: [],
    tarefas: null,
    orcamento: null,
    somenteLocal: false,
  }
}

/** Cria uma instância isolada da store reativa de `Transformar`. */
export function criarStoreTransformarCorte(): StoreTransformarCorte {
  let estado = estadoInicial(null)
  const ouvintes = new Set<() => void>()
  const assinaturaJobs = new Map<string, string>()
  let versao = 0

  const notificar = () => {
    for (const listener of ouvintes) listener()
  }

  const definirCandidato = (candidateId: number | null) => {
    if (estado.candidateId === candidateId) return
    versao += 1
    assinaturaJobs.clear()
    estado = estadoInicial(candidateId)
    notificar()
  }

  const carregarTudo = async (candidateId: number, opcoes?: { silencioso?: boolean }) => {
    const reqVersao = ++versao
    if (!opcoes?.silencioso) {
      estado = { ...estado, candidateId, carregando: true, erro: null }
      notificar()
    }
    try {
      const [angulos, roteiro, narracao, catalogoTts, pocketTts, perfisResp, tarefas, orcamento, localOnly] =
        await Promise.all([
          chamar<AngulosDoc>('angles.get', { candidate: candidateId }),
          chamar<RoteiroDoc>('script.get', { candidate: candidateId }),
          chamar<NarracaoDoc>('narration.get', { candidate: candidateId }),
          chamar<CatalogoTtsDoc>('tts.catalog', {}),
          chamar<StatusPocketTts>('components.pocket_tts.status', {}),
          chamar<{ profiles: PerfilProvedorLista[] }>('provider.profiles.list', {}),
          chamar<RespostaTarefasAssistente>('assistant.tasks', {}),
          chamar<OrcamentoJobs>('jobs.budget.get', {}),
          chamar<{ enabled: boolean }>('projects.local_only.get', {}),
        ])
      if (reqVersao !== versao || estado.candidateId !== candidateId) return
      estado = {
        candidateId,
        carregando: false,
        erro: null,
        angulos,
        roteiro,
        narracao,
        catalogoTts,
        pocketTts,
        perfis: perfisResp.profiles ?? [],
        tarefas,
        orcamento,
        somenteLocal: Boolean(localOnly?.enabled),
      }
      notificar()
    } catch (e) {
      if (reqVersao !== versao || estado.candidateId !== candidateId) return
      estado = { ...estado, carregando: false, erro: paraErroCore(e) }
      notificar()
    }
  }

  const recarregarAngulos = async (candidateId = estado.candidateId ?? undefined) => {
    if (candidateId == null || candidateId !== estado.candidateId) return
    const reqVersao = versao
    try {
      const angulos = await chamar<AngulosDoc>('angles.get', { candidate: candidateId })
      if (reqVersao !== versao || estado.candidateId !== candidateId) return
      estado = { ...estado, angulos }
      notificar()
    } catch (e) {
      if (reqVersao !== versao) return
      estado = { ...estado, erro: paraErroCore(e) }
      notificar()
    }
  }

  const recarregarRoteiro = async (candidateId = estado.candidateId ?? undefined) => {
    if (candidateId == null || candidateId !== estado.candidateId) return
    const reqVersao = versao
    try {
      const [roteiro, narracao] = await Promise.all([
        chamar<RoteiroDoc>('script.get', { candidate: candidateId }),
        chamar<NarracaoDoc>('narration.get', { candidate: candidateId }),
      ])
      if (reqVersao !== versao || estado.candidateId !== candidateId) return
      estado = { ...estado, roteiro, narracao }
      notificar()
    } catch (e) {
      if (reqVersao !== versao) return
      estado = { ...estado, erro: paraErroCore(e) }
      notificar()
    }
  }

  const recarregarNarracao = async (candidateId = estado.candidateId ?? undefined) => {
    if (candidateId == null || candidateId !== estado.candidateId) return
    const reqVersao = versao
    try {
      const narracao = await chamar<NarracaoDoc>('narration.get', { candidate: candidateId })
      if (reqVersao !== versao || estado.candidateId !== candidateId) return
      estado = { ...estado, narracao }
      notificar()
    } catch (e) {
      if (reqVersao !== versao) return
      estado = { ...estado, erro: paraErroCore(e) }
      notificar()
    }
  }

  const recarregarTts = async () => {
    const candidateId = estado.candidateId
    const reqVersao = versao
    try {
      const [catalogoTts, pocketTts] = await Promise.all([
        chamar<CatalogoTtsDoc>('tts.catalog', {}),
        chamar<StatusPocketTts>('components.pocket_tts.status', {}),
      ])
      if (reqVersao !== versao || estado.candidateId !== candidateId) return
      estado = { ...estado, catalogoTts, pocketTts }
      notificar()
      if (candidateId != null) {
        await recarregarNarracao(candidateId)
      }
    } catch (e) {
      if (reqVersao !== versao) return
      estado = { ...estado, erro: paraErroCore(e) }
      notificar()
    }
  }

  const sincronizarJobs = (jobs: readonly Job[]) => {
    if (estado.candidateId == null) return
    let recAngles = false
    let recScript = false
    let recNarration = false
    let recTts = false

    for (const job of jobs) {
      // Filtro defensivo para evento residual job === "0" na gravação (#293)
      if (job.id === '0') continue

      const assinatura = `${job.etapa}:${job.estado}:${job.percentual}`
      const anterior = assinaturaJobs.get(job.id)
      if (anterior === assinatura) continue
      assinaturaJobs.set(job.id, assinatura)

      const concluiuOuFalhou =
        job.estado === 'concluido' ||
        job.estado === 'falhou' ||
        job.etapa.endsWith(':done') ||
        job.etapa === 'complete'

      if (!concluiuOuFalhou) continue

      if (job.etapa.startsWith('ai:angles:')) {
        recAngles = true
      } else if (job.etapa.startsWith('ai:script:') || job.etapa.startsWith('ai:script_block:')) {
        recScript = true
      } else if (
        job.etapa === 'narration' ||
        job.etapa === 'narration_import' ||
        job.etapa === 'aligning' ||
        job.etapa === 'narration_record' ||
        job.id === 'narration_record'
      ) {
        recNarration = true
      } else if (job.etapa === 'pocket-tts' || job.etapa.startsWith('tts:')) {
        recTts = true
      }
    }

    if (recAngles) void recarregarAngulos(estado.candidateId)
    if (recScript) void recarregarRoteiro(estado.candidateId)
    if (recNarration && !recScript) void recarregarNarracao(estado.candidateId)
    if (recTts) void recarregarTts()
  }

  return {
    assinar: (listener) => {
      ouvintes.add(listener)
      return () => ouvintes.delete(listener)
    },
    obterSnapshot: () => estado,
    definirCandidato,
    carregarTudo,
    recarregarAngulos,
    recarregarRoteiro,
    recarregarNarracao,
    recarregarTts,
    sincronizarJobs,
  }
}

const storesPorFila = new WeakMap<object, StoreTransformarCorte>()
const storePadrao = criarStoreTransformarCorte()

function obterStore(fila?: Fila): StoreTransformarCorte {
  if (!fila) return storePadrao
  let store = storesPorFila.get(fila)
  if (!store) {
    store = criarStoreTransformarCorte()
    storesPorFila.set(fila, store)
  }
  return store
}

/**
 * Hook React vinculado ao `candidateId` em `Transformar`: carrega os 9 domínios em paralelo,
 * reage aos eventos `core-progress` via `useFila()` e limpa cache ao trocar de Corte.
 */
export function useTransformarCorte(candidateId: number | null, fila?: Fila) {
  const store = obterStore(fila)
  const jobs = useFila(fila)

  useEffect(() => {
    store.definirCandidato(candidateId)
    if (candidateId != null) {
      void store.carregarTudo(candidateId)
    }
  }, [store, candidateId])

  useEffect(() => {
    if (candidateId != null) {
      store.sincronizarJobs(jobs)
    }
  }, [store, candidateId, jobs])

  const estado = useSyncExternalStore(store.assinar, store.obterSnapshot, store.obterSnapshot)

  const recarregar = useCallback(
    (opcoes?: { silencioso?: boolean }) =>
      candidateId != null ? store.carregarTudo(candidateId, opcoes) : Promise.resolve(),
    [store, candidateId],
  )
  const recarregarAngulos = useCallback(() => store.recarregarAngulos(), [store])
  const recarregarRoteiro = useCallback(() => store.recarregarRoteiro(), [store])
  const recarregarNarracao = useCallback(() => store.recarregarNarracao(), [store])
  const recarregarTts = useCallback(() => store.recarregarTts(), [store])
  const resolverDestino = useCallback(
    (profileIdOrName?: string | null) =>
      resolverDestinoTransformar(profileIdOrName, estado.perfis, estado.tarefas),
    [estado.perfis, estado.tarefas],
  )

  return useMemo(
    () => ({
      ...estado,
      recarregar,
      recarregarAngulos,
      recarregarRoteiro,
      recarregarNarracao,
      recarregarTts,
      resolverDestino,
    }),
    [
      estado,
      recarregar,
      recarregarAngulos,
      recarregarRoteiro,
      recarregarNarracao,
      recarregarTts,
      resolverDestino,
    ],
  )
}
