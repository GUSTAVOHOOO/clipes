import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { chamar, ErroCore } from '~/core/cliente'
import { useFila, type EventoProgresso, type Fila, type Job } from '~/core/progresso'

export interface PerfilProvedorLista {
  id: string
  label: string
  kind: string
  endpoint: string | null
  model: string | null
  local: boolean
  cli?: boolean
  confirmed?: boolean
  active?: boolean
  experimental?: boolean
}

export interface TarefaAssistenteItem {
  task: string
  choice: string
  source: 'task' | 'default' | 'none'
  profile: {
    id: string
    label: string
    kind: string
    local: boolean
    model?: string | null
    cli?: boolean
  } | null
  localOnly: boolean
  blocked: boolean
  missing: string | null
}

export interface RespostaTarefasAssistente {
  projectLocalOnly: boolean
  tasks: TarefaAssistenteItem[]
}

export interface DestinoSelecao {
  perfil: {
    id: string
    label: string
    kind: 'local' | 'api' | 'cli' | 'groq'
    model: string | null
  }
  localidade: 'local' | 'remoto' | 'cli'
  saiDaMaquina: boolean
  host: string | null
  bloqueadoSomenteLocal: boolean
}

export interface ResumoRunSelecao {
  id: number
  state: 'running' | 'completed' | 'partial'
  minUs: number
  maxUs: number
  planState: string
  revision: number
  revisions: number[]
  videoKind: 'direct' | 'transformed'
  budgetPause?: string | null
  weights?: Array<{ key: string; weight: number }>
  counts?: {
    windows: number
    completed: number
    failed: number
    kept: number
    discarded: number
    merged: number
  }
}

export interface JanelaSelecao {
  index: number
  firstId: number
  lastId: number
  startUs: number
  endUs: number
  jobId: number | null
  state: string
  code: string | null
  resetAtMs: number | null
  profile: string
}

export interface CandidatoSelecao {
  id: number
  rank: number
  startId: number
  endId: number
  startUs: number
  endUs: number
  total: number
  title: string
  windows: number[]
  profile: string
  revision: number
  adjusted: boolean
  reasons?: string[]
  scores?: Record<string, number>
}

export interface DetalheExecucaoSelecao {
  run: ResumoRunSelecao
  windows: JanelaSelecao[]
  candidates: CandidatoSelecao[]
}

export interface ItemRevisaoSelecao {
  candidate: number
  status: 'pending' | 'approved' | 'rejected'
  adjusted: boolean
  startId: number
  endId: number
  startUs: number
  endUs: number
  startText: string
  endText: string
  moves?: {
    startEarlier: boolean
    startLater: boolean
    endEarlier: boolean
    endLater: boolean
  }
}

export interface RevisaoExecucaoSelecao {
  run: number
  items: ItemRevisaoSelecao[]
  canUndo: boolean
}

export interface EstadoSelecaoProjeto {
  projetoPath: string | null
  runsPorFonte: Record<number, ResumoRunSelecao[]>
  carregandoRunsPorFonte: Record<number, boolean>
  erroRunsPorFonte: Record<number, ErroCore | null>
  execucaoAtiva: DetalheExecucaoSelecao | null
  carregandoExecucao: boolean
  erroExecucao: ErroCore | null
  revisaoAtiva: RevisaoExecucaoSelecao | null
  carregandoRevisao: boolean
  erroRevisao: ErroCore | null
  versaoInvalidacaoSinais: number
}

const KINDS_CLI = new Set(['codex', 'claude', 'opencode'])
const HOSTS_LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function extrairHost(endpoint: string | null | undefined): { host: string | null; loopback: boolean } {
  if (!endpoint) return { host: null, loopback: false }
  try {
    const parsed = new URL(endpoint)
    const hostname = parsed.hostname.toLowerCase()
    return {
      host: parsed.host || hostname || null,
      loopback: HOSTS_LOOPBACK.has(hostname),
    }
  } catch {
    return { host: null, loopback: false }
  }
}

function normalizarErro(err: unknown): ErroCore {
  if (err instanceof ErroCore) return err
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    return new ErroCore(String((err as { code: unknown }).code), String((err as { message: unknown }).message))
  }
  return new ErroCore('desconhecido', err instanceof Error ? err.message : String(err))
}

/**
 * Cruza o nome/id de perfil retornado por `selection.estimate` com `provider.profiles.list` e
 * `assistant.tasks` para alimentar `<ResumoCustoPrivacidade>` (Questão #20 de `02-consolidacao.md`).
 */
export function resolverDestinoSelecao(
  profileIdOrName: string | null | undefined,
  perfis: readonly PerfilProvedorLista[],
  tarefas?: RespostaTarefasAssistente | null,
): DestinoSelecao {
  const consulta = (profileIdOrName ?? '').trim()
  const consultaLower = consulta.toLowerCase()
  const tarefaSelecao = tarefas?.tasks.find((t) => t.task === 'selection')

  let encontrado =
    perfis.find((p) => p.id === consulta || p.label === consulta) ??
    perfis.find((p) => p.id.toLowerCase() === consultaLower || p.label.toLowerCase() === consultaLower)

  if (!encontrado && tarefaSelecao?.profile) {
    const tProf = tarefaSelecao.profile
    if (!consulta || tProf.id === consulta || tProf.label === consulta) {
      encontrado = perfis.find((p) => p.id === tProf.id) ?? {
        id: tProf.id,
        label: tProf.label,
        kind: tProf.kind,
        endpoint: null,
        model: tProf.model ?? null,
        local: tProf.local,
        cli: tProf.cli ?? KINDS_CLI.has(tProf.kind.toLowerCase()),
      }
    }
  }

  const kindBruto = (encontrado?.kind ?? consulta).toLowerCase()
  const isCli = Boolean(encontrado?.cli) || KINDS_CLI.has(kindBruto) || KINDS_CLI.has(consultaLower)
  const { host, loopback } = extrairHost(encontrado?.endpoint)
  const ehLocal = !isCli && (Boolean(encontrado?.local) || loopback)

  const localidade: 'local' | 'remoto' | 'cli' = isCli ? 'cli' : ehLocal ? 'local' : 'remoto'
  const saiDaMaquina = localidade !== 'local'

  const perfilKind: 'local' | 'api' | 'cli' | 'groq' = isCli
    ? 'cli'
    : ehLocal
      ? 'local'
      : kindBruto === 'groq'
        ? 'groq'
        : 'api'

  const perfilId = encontrado?.id ?? (consulta || 'desconhecido')
  const perfilLabel = encontrado?.label ?? (consulta || 'Provedor selecionado')
  const perfilModel = encontrado?.model ?? null

  const restritoSelecao =
    Boolean(tarefas?.projectLocalOnly) || Boolean(tarefaSelecao?.localOnly) || Boolean(tarefaSelecao?.blocked)

  return {
    perfil: {
      id: perfilId,
      label: perfilLabel,
      kind: perfilKind,
      model: perfilModel,
    },
    localidade,
    saiDaMaquina,
    host: isCli ? null : host,
    bloqueadoSomenteLocal: saiDaMaquina && restritoSelecao,
  }
}

function etapaEhSelecao(etapa: string): boolean {
  return (
    etapa === 'selection:window' ||
    etapa === 'selection:done' ||
    (etapa.startsWith('ai:selection:') && (etapa.endsWith(':done') || etapa.endsWith(':paused')))
  )
}

function etapaEhSinal(etapa: string): boolean {
  return etapa === 'energy' || etapa === 'chat' || etapa === 'proxy'
}

export interface StoreSelecaoProjeto {
  assinar: (listener: () => void) => () => void
  obterSnapshot: () => EstadoSelecaoProjeto
  definirProjeto: (projetoPath: string | null) => void
  carregarRuns: (sourceId: number, opcoes?: { silencioso?: boolean }) => Promise<ResumoRunSelecao[]>
  carregarExecucao: (
    runId: number,
    revision?: number,
    opcoes?: { silencioso?: boolean },
  ) => Promise<DetalheExecucaoSelecao | null>
  carregarRevisao: (runId: number, opcoes?: { silencioso?: boolean }) => Promise<RevisaoExecucaoSelecao | null>
  sincronizarJobs: (jobs: readonly Job[]) => void
  registrarEventoProgresso: (evento: EventoProgresso) => void
}

function estadoInicial(projetoPath: string | null = null): EstadoSelecaoProjeto {
  return {
    projetoPath,
    runsPorFonte: {},
    carregandoRunsPorFonte: {},
    erroRunsPorFonte: {},
    execucaoAtiva: null,
    carregandoExecucao: false,
    erroExecucao: null,
    revisaoAtiva: null,
    carregandoRevisao: false,
    erroRevisao: null,
    versaoInvalidacaoSinais: 0,
  }
}

/**
 * Store reativo por Projeto para Seleção, Revisão, Sinais e Proxy, invalidado automaticamente por
 * `core-progress` e zerado integralmente ao trocar ou fechar o Projeto.
 */
export function criarStoreSelecaoProjeto(): StoreSelecaoProjeto {
  let estado = estadoInicial(null)
  const ouvintes = new Set<() => void>()
  const assinaturaJobs = new Map<string, string>()
  const ultimaEtapaPorJob = new Map<string, string>()
  let execucaoSolicitada: { runId: number; revision?: number } | null = null
  let revisaoSolicitada: number | null = null

  const notificar = () => {
    for (const listener of ouvintes) listener()
  }

  const definirProjeto = (projetoPath: string | null) => {
    if (estado.projetoPath === projetoPath) return
    assinaturaJobs.clear()
    ultimaEtapaPorJob.clear()
    execucaoSolicitada = null
    revisaoSolicitada = null
    estado = estadoInicial(projetoPath)
    notificar()
  }

  const carregarRuns = async (sourceId: number, opcoes?: { silencioso?: boolean }): Promise<ResumoRunSelecao[]> => {
    const caminhoAlvo = estado.projetoPath
    if (!opcoes?.silencioso) {
      estado = {
        ...estado,
        carregandoRunsPorFonte: { ...estado.carregandoRunsPorFonte, [sourceId]: true },
        erroRunsPorFonte: { ...estado.erroRunsPorFonte, [sourceId]: null },
      }
      notificar()
    }

    try {
      const lista = await chamar<ResumoRunSelecao[]>('selection.list', { source_id: sourceId })
      if (estado.projetoPath !== caminhoAlvo) return []
      estado = {
        ...estado,
        runsPorFonte: { ...estado.runsPorFonte, [sourceId]: lista ?? [] },
        carregandoRunsPorFonte: { ...estado.carregandoRunsPorFonte, [sourceId]: false },
        erroRunsPorFonte: { ...estado.erroRunsPorFonte, [sourceId]: null },
      }
      notificar()
      return estado.runsPorFonte[sourceId]
    } catch (err) {
      if (estado.projetoPath !== caminhoAlvo) return []
      estado = {
        ...estado,
        carregandoRunsPorFonte: { ...estado.carregandoRunsPorFonte, [sourceId]: false },
        erroRunsPorFonte: { ...estado.erroRunsPorFonte, [sourceId]: normalizarErro(err) },
      }
      notificar()
      return []
    }
  }

  const carregarExecucao = async (
    runId: number,
    revision?: number,
    opcoes?: { silencioso?: boolean },
  ): Promise<DetalheExecucaoSelecao | null> => {
    const caminhoAlvo = estado.projetoPath
    execucaoSolicitada = { runId, revision }
    if (!opcoes?.silencioso) {
      estado = {
        ...estado,
        carregandoExecucao: true,
        erroExecucao: null,
      }
      notificar()
    }

    try {
      const detalhe = await chamar<DetalheExecucaoSelecao>(
        'selection.get',
        revision !== undefined ? { run: runId, revision } : { run: runId },
      )
      if (estado.projetoPath !== caminhoAlvo) return null
      estado = {
        ...estado,
        execucaoAtiva: detalhe,
        carregandoExecucao: false,
        erroExecucao: null,
      }
      notificar()
      return detalhe
    } catch (err) {
      if (estado.projetoPath !== caminhoAlvo) return null
      estado = {
        ...estado,
        carregandoExecucao: false,
        erroExecucao: normalizarErro(err),
      }
      notificar()
      return null
    }
  }

  const carregarRevisao = async (
    runId: number,
    opcoes?: { silencioso?: boolean },
  ): Promise<RevisaoExecucaoSelecao | null> => {
    const caminhoAlvo = estado.projetoPath
    revisaoSolicitada = runId
    if (!opcoes?.silencioso) {
      estado = {
        ...estado,
        carregandoRevisao: true,
        erroRevisao: null,
      }
      notificar()
    }

    try {
      const revisao = await chamar<RevisaoExecucaoSelecao>('selection.review', { run: runId })
      if (estado.projetoPath !== caminhoAlvo) return null
      estado = {
        ...estado,
        revisaoAtiva: revisao,
        carregandoRevisao: false,
        erroRevisao: null,
      }
      notificar()
      return revisao
    } catch (err) {
      if (estado.projetoPath !== caminhoAlvo) return null
      estado = {
        ...estado,
        carregandoRevisao: false,
        erroRevisao: normalizarErro(err),
      }
      notificar()
      return null
    }
  }

  const dispararInvalidacao = (alvo: 'selecao' | 'sinais' | 'ambos') => {
    if (alvo === 'sinais' || alvo === 'ambos') {
      estado = { ...estado, versaoInvalidacaoSinais: estado.versaoInvalidacaoSinais + 1 }
      notificar()
    }

    if (alvo === 'selecao' || alvo === 'ambos') {
      const fontesRastreadas = Object.keys(estado.runsPorFonte).map((k) => Number(k))
      for (const sid of fontesRastreadas) {
        if (!Number.isNaN(sid)) void carregarRuns(sid, { silencioso: true })
      }
      if (execucaoSolicitada) {
        void carregarExecucao(execucaoSolicitada.runId, execucaoSolicitada.revision, { silencioso: true })
      }
      if (revisaoSolicitada !== null) {
        void carregarRevisao(revisaoSolicitada, { silencioso: true })
      }
    }
  }

  const sincronizarJobs = (jobs: readonly Job[]) => {
    let invalidarSelecao = false
    let invalidarSinais = false

    for (const job of jobs) {
      const assinatura = `${job.estado}:${job.etapa}:${job.percentual}`
      const mudou = assinaturaJobs.get(job.id) !== assinatura
      const etapaAnterior = ultimaEtapaPorJob.get(job.id) ?? ''

      assinaturaJobs.set(job.id, assinatura)
      if (job.etapa && job.etapa !== 'complete' && job.etapa !== 'failed') {
        ultimaEtapaPorJob.set(job.id, job.etapa)
      }

      if (!mudou) continue

      if (etapaEhSelecao(job.etapa)) {
        invalidarSelecao = true
      }

      const origemSinal = etapaEhSinal(job.etapa) ? job.etapa : etapaEhSinal(etapaAnterior) ? etapaAnterior : ''
      if (origemSinal === 'energy' || origemSinal === 'chat') {
        if (job.estado === 'concluido') invalidarSinais = true
      } else if (origemSinal === 'proxy') {
        if (job.estado === 'concluido' || job.estado === 'falhou') invalidarSinais = true
      }
    }

    if (invalidarSelecao && invalidarSinais) {
      dispararInvalidacao('ambos')
    } else if (invalidarSelecao) {
      dispararInvalidacao('selecao')
    } else if (invalidarSinais) {
      dispararInvalidacao('sinais')
    }
  }

  const registrarEventoProgresso = (evento: EventoProgresso) => {
    const etapaAnterior = ultimaEtapaPorJob.get(evento.job) ?? ''
    if (evento.stage && evento.stage !== 'complete' && evento.stage !== 'failed') {
      ultimaEtapaPorJob.set(evento.job, evento.stage)
    }

    if (etapaEhSelecao(evento.stage)) {
      dispararInvalidacao('selecao')
      return
    }

    const origemSinal = etapaEhSinal(evento.stage) ? evento.stage : etapaEhSinal(etapaAnterior) ? etapaAnterior : ''
    if (
      (origemSinal === 'energy' || origemSinal === 'chat') &&
      (evento.stage === 'complete' || (etapaEhSinal(evento.stage) && evento.percentage >= 100))
    ) {
      dispararInvalidacao('sinais')
    } else if (
      origemSinal === 'proxy' &&
      (evento.stage === 'complete' || evento.stage === 'failed')
    ) {
      dispararInvalidacao('sinais')
    }
  }

  return {
    assinar: (listener) => {
      ouvintes.add(listener)
      return () => ouvintes.delete(listener)
    },
    obterSnapshot: () => estado,
    definirProjeto,
    carregarRuns,
    carregarExecucao,
    carregarRevisao,
    sincronizarJobs,
    registrarEventoProgresso,
  }
}

const storesPorInstancia = new WeakMap<object, StoreSelecaoProjeto>()
const storePadrao = criarStoreSelecaoProjeto()

function obterStore(fila?: Fila): StoreSelecaoProjeto {
  if (!fila) return storePadrao
  let s = storesPorInstancia.get(fila)
  if (!s) {
    s = criarStoreSelecaoProjeto()
    storesPorInstancia.set(fila, s)
  }
  return s
}

/**
 * Hook React vinculado ao `projetoPath` ativo: limpa cache ao trocar/fechar Projeto e reage
 * automaticamente a `core-progress` (via `useFila`).
 */
export function useSelecaoProjeto(projetoPath: string | null, fila?: Fila) {
  const store = obterStore(fila)
  const jobs = useFila(fila)

  useEffect(() => {
    store.definirProjeto(projetoPath)
  }, [store, projetoPath])

  useEffect(() => {
    if (projetoPath) {
      store.sincronizarJobs(jobs)
    }
  }, [store, projetoPath, jobs])

  const estado = useSyncExternalStore(store.assinar, store.obterSnapshot, store.obterSnapshot)

  const carregarRuns = useCallback(
    (sourceId: number, opcoes?: { silencioso?: boolean }) => store.carregarRuns(sourceId, opcoes),
    [store],
  )
  const carregarExecucao = useCallback(
    (runId: number, revision?: number, opcoes?: { silencioso?: boolean }) =>
      store.carregarExecucao(runId, revision, opcoes),
    [store],
  )
  const carregarRevisao = useCallback(
    (runId: number, opcoes?: { silencioso?: boolean }) => store.carregarRevisao(runId, opcoes),
    [store],
  )

  return useMemo(
    () => ({
      ...estado,
      carregarRuns,
      carregarExecucao,
      carregarRevisao,
    }),
    [estado, carregarRuns, carregarExecucao, carregarRevisao],
  )
}
