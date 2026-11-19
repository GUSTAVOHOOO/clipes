import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { notificarSistema } from '~/core/desktop'
import {
  filaPadraoExportada,
  useFila,
  type EstadoJob,
  type Fila,
  type Job,
  type JobExterno,
} from '~/core/progresso'
import type { LoteFontes } from '~/stores/fontesProjeto'

export type ResumoCustoJob = {
  calls: number
  inputTokens: number
  outputTokens: number
  microUsd: number
  audioMicroUsd?: number
  unknownCostCalls: number
  planQuotaCalls: number
  durationMs: number
  costLabel: string | null
}

export type JobPersistido = {
  id: number
  kind: string
  safety: 'local' | 'paid' | string
  state: 'queued' | 'running' | 'uncertain' | 'completed' | 'cancelled' | 'failed'
  attempts: number
  checkpoint: string | null
  progress: number
  project: string
  outcome: string | null
  cost: string | null
  batch: string | null
  profile: string | null
  budgetPause: string | null
  startedAtMs?: number | null
  targetLabel?: string | null
  taskCost?: ResumoCustoJob | null
  profileCost?: ResumoCustoJob | null
  batchCost?: ResumoCustoJob | null
}

export type OrcamentoItem = {
  scope: 'task' | 'batch' | string
  key: string
  maxCalls: number | null
  maxTokens: number | null
  maxWallMs: number | null
  maxCostMicroUsd: number | null
  unknownConfirmed: boolean
  since: number
  usage: ResumoCustoJob
  paused: string | null
}

export type ItemLoteExportacao = {
  position: number
  sourceId: number
  runId?: number
  candidateId: number
  clipId: number | null
  jobId: number | null
  title: string
  filename: string
  output?: string
  durationUs: number
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  error: { code: string; message?: string } | null
  encoder: string | null
  encoderFallback: { from: string; reason: string } | null
}

export type LoteExportacao = {
  id: number
  scope: 'source' | 'project'
  sourceId: number | null
  outputDir: string
  state: 'running' | 'completed' | 'cancelled'
  status: 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'
  progress: number
  counts: {
    total: number
    queued: number
    running: number
    completed: number
    failed: number
    cancelled: number
  }
  items: ItemLoteExportacao[]
}

export type PrefixoCancelamentoGlobal = 'components' | 'tts' | 'sources-url' | 'sources' | null

export type OperacaoGlobal = {
  id: string
  etapa: string
  percentual: number
  mensagem: string
  estado: EstadoJob
  erro?: { code: string; message: string }
  prefixoCancelamento: PrefixoCancelamentoGlobal
}

export type DominioInvalidacao = 'fontes' | 'selecao' | 'exportacao' | 'lotes'

export type NotificacaoFila = {
  tipo: 'concluido' | 'falha' | 'orcamento'
  titulo: string
  corpo: string
  jobId: string
  etapa: string
  rota?: string
}

export type EstadoFilaGlobal = {
  projetoPath: string | null
  carregando: boolean
  erro: ErroCore | null
  jobs: JobPersistido[]
  lotesFontes: LoteFontes[]
  lotesExportacao: LoteExportacao[]
  orcamentos: OrcamentoItem[]
  pausasOrcamento: OrcamentoItem[]
  operacoesGlobais: OperacaoGlobal[]
  contagemAtivos: number
  contagemIncertos: number
  ultimaAtualizacaoMs: number | null
}

export type StoreFilaGlobal = {
  estado: () => EstadoFilaGlobal
  assinar: (fn: () => void) => () => void
  definirProjeto: (projetoPath: string | null) => Promise<void>
  recarregar: () => Promise<void>
  sincronizarJobs: (jobs: readonly Job[]) => void
  registrarInvalidacao: (fn: (dominio: DominioInvalidacao) => void) => () => void
  registrarNotificacao: (fn: (n: NotificacaoFila) => void) => () => void
  descartar: () => void
}

const PREFIXOS_COMPONENTES = [
  'ffmpeg',
  'yt-dlp',
  'deno',
  'pocket-tts',
  'uv',
  'worker',
  'catalog',
  'whisper-',
  'yunet',
  'hardware-probe',
  'transcription-estimate',
]

function classificarPrefixoCancelamento(job: Job): PrefixoCancelamentoGlobal {
  if (job.id.startsWith('tts:') || job.etapa.startsWith('tts.models.')) return 'tts'
  if (job.id.startsWith('url-') || job.id.startsWith('sources.url.') || job.etapa.startsWith('sources.url.')) {
    return 'sources-url'
  }
  if (
    job.id.startsWith('source-hash') ||
    job.id.startsWith('source-relocate') ||
    job.id.startsWith('source-copy') ||
    job.etapa === 'hash'
  ) {
    return 'sources'
  }
  if (
    PREFIXOS_COMPONENTES.some((p) => job.id === p || job.id.startsWith(p)) ||
    job.etapa === 'download' ||
    job.etapa === 'probe' ||
    job.etapa === 'estimate' ||
    job.etapa === 'worker'
  ) {
    return 'components'
  }
  return null
}

function ehOperacaoGlobal(job: Job): boolean {
  if (!job.id || job.id === '0' || job.id === 'app.version' || job.id === 'editor') return false
  if (/^\d+$/.test(job.id)) return false
  if (job.id.startsWith('batch-') || job.id.startsWith('export-batch-') || job.id.startsWith('selection-')) {
    return false
  }
  if (job.etapa === 'editor_saved' || job.etapa === 'editor_save_failed') return false
  return true
}

function paraJobExterno(job: JobPersistido): JobExterno {
  const etapa = job.kind.startsWith('ai:') && !job.kind.includes(':', 3) ? `${job.kind}:call` : job.kind
  return {
    id: String(job.id),
    etapa,
    percentual: job.progress,
    mensagem: job.kind,
    estado: 'rodando',
    startedAtMs: job.startedAtMs ?? null,
    alvo: job.targetLabel ?? null,
  }
}

function ehEventoRefresh(job: Job): boolean {
  const s = job.etapa
  return (
    s === 'complete' ||
    s === 'failed' ||
    s === 'selection:done' ||
    s === 'selection:window' ||
    (s.startsWith('ai:') && (s.endsWith(':done') || s.endsWith(':paused'))) ||
    s.startsWith('batch:') ||
    s === 'export_batch' ||
    s === 'export_batch_complete' ||
    s === 'export_batch_cancelled'
  )
}

function ehNotificacaoLonga(job: Job): boolean {
  const s = job.etapa
  if (s === 'export_batch_complete' || s === 'batch:completed' || s === 'batch:item-paused') {
    return true
  }
  if (s.startsWith('ai:') && s.endsWith(':paused')) return true
  if (job.estado === 'concluido' || job.estado === 'falhou') {
    if (job.id === 'app.version') return false
    return /^\d+$/.test(job.id) || job.id.startsWith('export-batch-') || job.id.startsWith('batch-')
  }
  return false
}

function janelaSemFoco(): boolean {
  if (typeof document === 'undefined') return false
  if (document.hidden) return true
  if (typeof document.hasFocus === 'function') return !document.hasFocus()
  return false
}

function calcularContagemAtivos(
  jobs: readonly JobPersistido[],
  operacoesGlobais: readonly OperacaoGlobal[],
  lotesExportacao: readonly LoteExportacao[],
): number {
  const jobsAtivos = jobs.filter(
    (j) => j.state === 'running' || (j.state === 'queued' && !j.budgetPause),
  ).length
  const globaisAtivas = operacoesGlobais.filter((o) => o.estado === 'rodando').length
  const temExportEmJobs = jobs.some(
    (j) => j.kind === 'export' && (j.state === 'running' || j.state === 'queued'),
  )
  const lotesExportAtivos = temExportEmJobs
    ? 0
    : lotesExportacao.filter((l) => l.state === 'running').length
  return jobsAtivos + globaisAtivas + lotesExportAtivos
}

function estadoInicial(
  projetoPath: string | null,
  operacoesGlobais: OperacaoGlobal[] = [],
): EstadoFilaGlobal {
  return {
    projetoPath,
    carregando: Boolean(projetoPath),
    erro: null,
    jobs: [],
    lotesFontes: [],
    lotesExportacao: [],
    orcamentos: [],
    pausasOrcamento: [],
    operacoesGlobais,
    contagemAtivos: calcularContagemAtivos([], operacoesGlobais, []),
    contagemIncertos: 0,
    ultimaAtualizacaoMs: null,
  }
}

export type OpcoesStoreFilaGlobal = {
  fila?: Fila
  debounceMs?: number
  aoInvalidar?: (dominio: DominioInvalidacao) => void
  aoNotificar?: (notificacao: NotificacaoFila) => void
}

/**
 * Store reativo central da Fila Unificada (`jobs.list`, `batches.list`, `export.batch.list`,
 * `jobs.budget.get` e operações globais de `useFila()`), reconciliado com `FechamentoJanela` (#291).
 */
export function criarStoreFilaGlobal(opcoes?: OpcoesStoreFilaGlobal): StoreFilaGlobal {
  const fila = opcoes?.fila
  const debounceMs = opcoes?.debounceMs ?? 80
  let atual = estadoInicial(null)
  let seqProjeto = 0
  let timerRefresh: ReturnType<typeof setTimeout> | null = null
  const ouvintes = new Set<() => void>()
  const ouvintesInvalidacao = new Set<(dominio: DominioInvalidacao) => void>()
  const ouvintesNotificacao = new Set<(n: NotificacaoFila) => void>()
  const assinaturasVistas = new Map<string, string>()

  if (opcoes?.aoInvalidar) ouvintesInvalidacao.add(opcoes.aoInvalidar)
  if (opcoes?.aoNotificar) ouvintesNotificacao.add(opcoes.aoNotificar)

  function publicar(proximo: EstadoFilaGlobal) {
    atual = proximo
    for (const fn of ouvintes) {
      fn()
    }
  }

  function atualizar(patch: Partial<EstadoFilaGlobal>) {
    const proximo: EstadoFilaGlobal = { ...atual, ...patch }
    proximo.contagemAtivos = calcularContagemAtivos(
      proximo.jobs,
      proximo.operacoesGlobais,
      proximo.lotesExportacao,
    )
    proximo.contagemIncertos = proximo.jobs.filter((j) => j.state === 'uncertain').length
    publicar(proximo)
  }

  function sincronizarExternosComFila(
    jobsLista: readonly JobPersistido[],
    lotesExport: readonly LoteExportacao[],
  ) {
    if (!fila?.sincronizarExterno) return
    const externos: JobExterno[] = []
    for (const j of jobsLista) {
      if (j.state === 'running') {
        externos.push(paraJobExterno(j))
      }
    }
    for (const lote of lotesExport) {
      if (lote.state === 'running') {
        externos.push({
          id: `export-batch-${lote.id}`,
          etapa: 'export_batch',
          percentual: lote.progress,
          mensagem: `Exportando lote #${lote.id}`,
          estado: 'rodando',
        })
      }
    }
    fila.sincronizarExterno(externos)
  }

  async function recarregar(): Promise<void> {
    const caminho = atual.projetoPath
    if (!caminho) return
    const seq = seqProjeto

    try {
      const [jobsRes, lotesFontesRes, lotesExportRes, budgetRes] = await Promise.all([
        chamar<JobPersistido[]>('jobs.list', {}),
        chamar<LoteFontes[]>('batches.list', {}),
        chamar<LoteExportacao[]>('export.batch.list', {}),
        chamar<{ budgets?: OrcamentoItem[] }>('jobs.budget.get', {}),
      ])
      if (seq !== seqProjeto || atual.projetoPath !== caminho) return

      const jobs = Array.isArray(jobsRes) ? jobsRes : []
      const lotesFontes = Array.isArray(lotesFontesRes) ? lotesFontesRes : []
      const lotesExportacao = Array.isArray(lotesExportRes) ? lotesExportRes : []
      const orcamentos = Array.isArray(budgetRes?.budgets) ? budgetRes.budgets : []
      const pausasOrcamento = orcamentos.filter((b) => b.paused !== null)

      sincronizarExternosComFila(jobs, lotesExportacao)

      atualizar({
        carregando: false,
        erro: null,
        jobs,
        lotesFontes,
        lotesExportacao,
        orcamentos,
        pausasOrcamento,
        ultimaAtualizacaoMs: Date.now(),
      })
    } catch (err) {
      if (seq !== seqProjeto || atual.projetoPath !== caminho) return
      atualizar({
        carregando: false,
        erro: paraErroCore(err),
      })
    }
  }

  async function definirProjeto(projetoPath: string | null): Promise<void> {
    if (projetoPath === atual.projetoPath) return
    seqProjeto += 1
    if (timerRefresh !== null) {
      clearTimeout(timerRefresh)
      timerRefresh = null
    }

    const globaisAtuais = atual.operacoesGlobais
    if (!projetoPath) {
      if (fila?.limparProjeto) {
        fila.limparProjeto()
      } else {
        fila?.sincronizarExterno?.([])
      }
      publicar(estadoInicial(null, globaisAtuais))
      return
    }

    publicar(estadoInicial(projetoPath, globaisAtuais))
    await recarregar()
  }

  function emitirInvalidacao(dominio: DominioInvalidacao) {
    for (const fn of ouvintesInvalidacao) fn(dominio)
  }

  function emitirNotificacao(job: Job) {
    const tipo: NotificacaoFila['tipo'] =
      job.estado === 'pausado'
        ? 'orcamento'
        : job.estado === 'falhou'
          ? 'falha'
          : 'concluido'
    const titulo =
      tipo === 'orcamento'
        ? 'Orçamento pausou a fila'
        : tipo === 'falha'
          ? 'Tarefa falhou'
          : job.id.startsWith('export-batch-') || job.etapa === 'export'
            ? 'Exportação concluída'
            : 'Tarefa concluída'
    const corpo = job.mensagem || job.etapa
    const n: NotificacaoFila = {
      tipo,
      titulo,
      corpo,
      jobId: job.id,
      etapa: job.etapa,
    }
    for (const fn of ouvintesNotificacao) fn(n)
    if (janelaSemFoco()) {
      void notificarSistema(titulo, corpo)
    }
  }

  function agendarRefresh() {
    if (!atual.projetoPath) return
    if (timerRefresh !== null) clearTimeout(timerRefresh)
    if (debounceMs <= 0) {
      timerRefresh = null
      void recarregar()
      return
    }
    timerRefresh = setTimeout(() => {
      timerRefresh = null
      void recarregar()
    }, debounceMs)
  }

  function sincronizarJobs(jobs: readonly Job[]) {
    const novasGlobais: OperacaoGlobal[] = []
    let precisaRefresh = false

    for (const j of jobs) {
      if (ehOperacaoGlobal(j)) {
        novasGlobais.push({
          id: j.id,
          etapa: j.etapa,
          percentual: j.percentual,
          mensagem: j.mensagem,
          estado: j.estado,
          erro: j.erro,
          prefixoCancelamento: classificarPrefixoCancelamento(j),
        })
      }

      const assinatura = `${j.estado}:${j.etapa}:${j.percentual}`
      const anterior = assinaturasVistas.get(j.id)
      if (anterior === assinatura) continue
      assinaturasVistas.set(j.id, assinatura)

      if (ehEventoRefresh(j)) {
        precisaRefresh = true
        if (j.id.startsWith('export-batch-') || j.etapa.startsWith('export_batch') || j.etapa === 'export') {
          emitirInvalidacao('exportacao')
        } else if (j.id.startsWith('batch-') || j.etapa.startsWith('batch:')) {
          emitirInvalidacao('lotes')
          emitirInvalidacao('fontes')
        } else if (j.id.startsWith('selection-') || j.etapa.startsWith('selection:') || j.etapa.startsWith('ai:selection')) {
          emitirInvalidacao('selecao')
        } else if (j.etapa === 'transcribing' || j.etapa === 'complete' || j.etapa === 'failed') {
          emitirInvalidacao('fontes')
        }
      }

      // Notifica somente quando um evento novo entra em estado terminal/pausa relevante
      if (ehNotificacaoLonga(j) && anterior !== undefined) {
        emitirNotificacao(j)
      } else if (ehNotificacaoLonga(j) && anterior === undefined && atual.ultimaAtualizacaoMs !== null) {
        emitirNotificacao(j)
      }
    }

    const globaisMudaram =
      novasGlobais.length !== atual.operacoesGlobais.length ||
      novasGlobais.some((g, idx) => {
        const ant = atual.operacoesGlobais[idx]
        return !ant || ant.id !== g.id || ant.estado !== g.estado || ant.percentual !== g.percentual || ant.etapa !== g.etapa
      })

    if (globaisMudaram) {
      atualizar({ operacoesGlobais: novasGlobais })
    }

    if (precisaRefresh && atual.projetoPath) {
      agendarRefresh()
    }
  }

  function descartar() {
    if (timerRefresh !== null) {
      clearTimeout(timerRefresh)
      timerRefresh = null
    }
  }

  return {
    estado: () => atual,
    assinar: (fn) => {
      ouvintes.add(fn)
      return () => {
        ouvintes.delete(fn)
      }
    },
    definirProjeto,
    recarregar,
    sincronizarJobs,
    registrarInvalidacao: (fn) => {
      ouvintesInvalidacao.add(fn)
      return () => ouvintesInvalidacao.delete(fn)
    },
    registrarNotificacao: (fn) => {
      ouvintesNotificacao.add(fn)
      return () => ouvintesNotificacao.delete(fn)
    },
    descartar,
  }
}

export const storeFilaGlobal = criarStoreFilaGlobal({ fila: filaPadraoExportada })

export type ResultadoUseFilaGlobal = EstadoFilaGlobal & {
  recarregar: () => Promise<void>
}

/** Hook reativo da Fila Unificada, sincronizado com `useFila()` e limpo ao fechar Projeto. */
export function useFilaGlobal(
  projetoPath: string | null,
  opcoes?: { store?: StoreFilaGlobal; fila?: Fila },
): ResultadoUseFilaGlobal {
  const store = opcoes?.store ?? storeFilaGlobal
  const estado = useSyncExternalStore(store.assinar, store.estado, store.estado)
  const jobsFila = useFila(opcoes?.fila)
  const projetoAnteriorRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (projetoAnteriorRef.current === projetoPath) return
    projetoAnteriorRef.current = projetoPath
    void store.definirProjeto(projetoPath)
  }, [projetoPath, store])

  useEffect(() => {
    store.sincronizarJobs(jobsFila)
  }, [jobsFila, store])

  return useMemo(
    () => ({
      ...estado,
      recarregar: store.recarregar,
    }),
    [estado, store],
  )
}
