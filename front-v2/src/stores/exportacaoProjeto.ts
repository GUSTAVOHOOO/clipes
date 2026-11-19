import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { useFila, type Fila, type Job } from '~/core/progresso'
import type { LoteExportacao } from '~/stores/filaGlobal'
import type { FonteProjeto } from '~/stores/fontesProjeto'

export const TAMANHO_PAGINA = 12

export type ConfiguracoesExportacao = {
  last_directory: string | null
}

export type StatusEncoderExportacao = {
  ffmpeg: boolean
  detected: boolean
  stale: boolean
  passed: string[]
  selected: string
  manual: string | null
  effective: string
  gpu: string
  detected_at: number | null
}

export type RespostaGuardrails = {
  scope: 'single' | 'source' | 'project' | string
  directMonetizationAck?: boolean
  needsDirectNotice?: boolean
  videoKind?: 'direct' | 'transformed' | 'mixed' | string
  hasDirect?: boolean
  hasTransformed?: boolean
  totalCuts?: number
  durationUs?: number
  over60s?: boolean
  over60sCount?: number
  shortClaimLimitUs?: number
  permission?: {
    status: 'none' | 'granted' | string
    grantedCount: number
    missingCount: number
    totalCount: number
    who?: string | null
    where?: string | null
    scope?: string | null
  }
  script?: {
    applicable: boolean
    exists?: boolean
    approved?: boolean
    pendingBlocks?: number
    totalBlocks?: number
    busy?: boolean
    transformedCount?: number
    approvedCount?: number
    unapprovedCount?: number
  }
  narration?: {
    applicable: boolean
    hasTts?: boolean
    generatedBlocks?: number
    readyBlocks?: number
    ready?: boolean
    totalBlocks?: number
    ttsCutCount?: number
    transformedCount?: number
    voices?: string[]
    freezeTailUs?: number
    longFreezeTail?: boolean
    freezeTailCount?: number
    longFreezeTailCount?: number
    maxFreezeTailUs?: number
    busy?: boolean
  }
  audio?: {
    hasAudio: boolean
    assetCount?: number
    cutsWithAudio?: number
    cutsWithUnverifiedAudio?: number
    unverifiedCount: number
  }
}

export type ResumoEmpacotamentoCorte = {
  ready?: boolean
  current: {
    generation?: number
    language?: string
    edited?: boolean
    title?: string
    description?: string
    fullDescription?: string
    tags?: string[]
    hashtags?: string[]
  } | null
  credit?: {
    text: string | null
    warning: string | null
  }
  chapters?: {
    applicable?: boolean
    status?: string
    canGenerate?: boolean
  }
  job?: { id: number; state: string | null } | null
}

export type ResumoCapaCorte = {
  ready?: boolean
  current: {
    id: number
    instantUs: number
    origin: 'provider' | 'user' | string
    suggestionId?: number | null
    why?: string | null
  } | null
  job?: { id: number; state: string | null } | null
}

export type FonteResumoProntidao = {
  id: number
  name: string
  path: string
  status: FonteProjeto['status']
  available: boolean
  online: boolean
  permission: FonteProjeto['permission']
}

export type ResumoRoteiroProntidao = {
  applicable: boolean
  exists?: boolean
  approved?: boolean
  pendingBlocks?: number
  totalBlocks?: number
  busy?: boolean
}

export type ResumoNarracaoProntidao = {
  applicable: boolean
  hasTts?: boolean
  generatedBlocks?: number
  readyBlocks?: number
  ready?: boolean
  totalBlocks?: number
  voices?: string[]
  freezeTailUs?: number
  longFreezeTail?: boolean
  busy?: boolean
}

export type CorteAprovadoProntidao = {
  candidateId: number
  runId: number
  sourceId: number
  clipId?: number | null
  videoKind: 'direct' | 'transformed'
  candidateTitle: string
  scoreTotal: number
  adjusted: boolean
  startId: number
  endId: number
  startUs: number
  endUs: number
  durationUs: number
  source: FonteResumoProntidao
  packaging: ResumoEmpacotamentoCorte
  thumbnail: ResumoCapaCorte
  script: ResumoRoteiroProntidao
  narration: ResumoNarracaoProntidao
  guardrails: RespostaGuardrails
}

export type RespostaReadinessExportacao = {
  total: number
  offset: number
  limit: number | null
  hasMore: boolean
  items: CorteAprovadoProntidao[]
}

export type EstadoExportacaoProjeto = {
  projetoPath: string | null
  carregando: boolean
  carregandoMais: boolean
  atualizandoProntidao: boolean
  erro: ErroCore | null
  erroProntidao: ErroCore | null
  fontes: FonteProjeto[]
  aprovados: CorteAprovadoProntidao[]
  totalAprovados: number
  totalProjeto: number
  filtroFonteId: number | null
  temMais: boolean
  guardrailsProjeto: RespostaGuardrails | null
  guardrailsPorFonte: Record<number, RespostaGuardrails>
  settings: ConfiguracoesExportacao | null
  encoder: StatusEncoderExportacao | null
  lotes: LoteExportacao[]
}

export type StoreExportacaoProjeto = {
  estado: () => EstadoExportacaoProjeto
  assinar: (fn: () => void) => () => void
  definirProjeto: (projetoPath: string | null) => Promise<void>
  recarregar: () => Promise<void>
  recarregarLotes: () => Promise<LoteExportacao[]>
  carregarMais: () => Promise<void>
  filtrarPorFonte: (sourceId: number | null) => Promise<void>
  atualizarProntidao: () => Promise<void>
  tentarNovamenteProntidao: () => Promise<void>
  carregarGuardrailsEscopo: (sourceId?: number | null) => Promise<RespostaGuardrails | null>
  sincronizarJobs: (jobs: readonly Job[]) => void
}

function estadoInicial(projetoPath: string | null): EstadoExportacaoProjeto {
  return {
    projetoPath,
    carregando: Boolean(projetoPath),
    carregandoMais: false,
    atualizandoProntidao: false,
    erro: null,
    erroProntidao: null,
    fontes: [],
    aprovados: [],
    totalAprovados: 0,
    totalProjeto: 0,
    filtroFonteId: null,
    temMais: false,
    guardrailsProjeto: null,
    guardrailsPorFonte: {},
    settings: null,
    encoder: null,
    lotes: [],
  }
}

function mesclarSemDuplicar(
  atuais: readonly CorteAprovadoProntidao[],
  novos: readonly CorteAprovadoProntidao[],
): CorteAprovadoProntidao[] {
  const vistos = new Set(atuais.map((c) => c.candidateId))
  const resultado = [...atuais]
  for (const item of novos) {
    if (!vistos.has(item.candidateId)) {
      vistos.add(item.candidateId)
      resultado.push(item)
    }
  }
  return resultado
}

/**
 * Store paginado via `export.readiness` para a Mesa de Prontidão e Histórico de Lotes,
 * reagindo a `useFila()` e zerado integralmente ao fechar ou trocar o Projeto.
 */
export function criarStoreExportacaoProjeto(opcoes?: {
  tamanhoPagina?: number
}): StoreExportacaoProjeto {
  const tamanhoPagina = opcoes?.tamanhoPagina ?? TAMANHO_PAGINA
  let atual = estadoInicial(null)
  let seqProjeto = 0
  let seqReadiness = 0
  let ultimaFalhaProntidao: 'atualizar' | 'mais' | 'guardrails' | null = null
  let ultimaFonteGuardrailsFalhou: number | null = null
  const ouvintes = new Set<() => void>()
  const assinaturasVistas = new Map<string, string>()

  function publicar(proximo: EstadoExportacaoProjeto) {
    atual = proximo
    for (const fn of ouvintes) {
      fn()
    }
  }

  function atualizar(patch: Partial<EstadoExportacaoProjeto>) {
    publicar({ ...atual, ...patch })
  }

  async function buscarReadiness(params: {
    sourceId: number | null
    offset: number
    limit: number
  }): Promise<RespostaReadinessExportacao> {
    const args: Record<string, unknown> = {
      offset: params.offset,
      limit: params.limit,
    }
    if (params.sourceId !== null) {
      args.source_id = params.sourceId
    }
    const res = await chamar<RespostaReadinessExportacao>('export.readiness', args)
    return {
      total: typeof res?.total === 'number' ? res.total : 0,
      offset: typeof res?.offset === 'number' ? res.offset : params.offset,
      limit: typeof res?.limit === 'number' ? res.limit : params.limit,
      hasMore: Boolean(res?.hasMore),
      items: Array.isArray(res?.items) ? res.items : [],
    }
  }

  async function recarregar(): Promise<void> {
    const caminho = atual.projetoPath
    if (!caminho) return
    const seq = seqProjeto
    seqReadiness += 1
    const rSeq = seqReadiness
    const fonteFiltro = atual.filtroFonteId
    ultimaFalhaProntidao = null
    ultimaFonteGuardrailsFalhou = null
    atualizar({ carregando: true, erro: null, erroProntidao: null })

    try {
      const [fontesRes, readinessRes, settingsRes, encoderRes, lotesRes, guardrailsRes] =
        await Promise.all([
          chamar<FonteProjeto[]>('sources.list', { project: caminho }),
          buscarReadiness({
            sourceId: fonteFiltro,
            offset: 0,
            limit: tamanhoPagina,
          }),
          chamar<ConfiguracoesExportacao>('export.settings', {}).catch(() => null),
          chamar<StatusEncoderExportacao>('export.encoder.status', {}).catch(() => null),
          chamar<LoteExportacao[]>('export.batch.list', {}).catch(() => []),
          chamar<RespostaGuardrails>('guardrails.check', { scope: 'project' }).catch(() => null),
        ])
      if (seq !== seqProjeto || rSeq !== seqReadiness || atual.projetoPath !== caminho) return

      const fontes = Array.isArray(fontesRes) ? fontesRes : []
      const totalProjeto =
        fonteFiltro === null
          ? readinessRes.total
          : (guardrailsRes?.totalCuts ?? atual.totalProjeto)

      atualizar({
        carregando: false,
        erro: null,
        erroProntidao: null,
        fontes,
        aprovados: readinessRes.items,
        totalAprovados: readinessRes.total,
        totalProjeto,
        temMais: readinessRes.hasMore,
        settings: settingsRes,
        encoder: encoderRes,
        lotes: Array.isArray(lotesRes) ? lotesRes : [],
        guardrailsProjeto: guardrailsRes,
      })
    } catch (err) {
      if (seq !== seqProjeto || atual.projetoPath !== caminho) return
      atualizar({ carregando: false, erro: paraErroCore(err) })
    }
  }

  async function recarregarLotes(): Promise<LoteExportacao[]> {
    const caminho = atual.projetoPath
    if (!caminho) return []
    const seq = seqProjeto
    try {
      const res = await chamar<LoteExportacao[]>('export.batch.list', {})
      if (seq !== seqProjeto || atual.projetoPath !== caminho) return []
      const lotes = Array.isArray(res) ? res : []
      atualizar({ lotes })
      return lotes
    } catch {
      return atual.lotes
    }
  }

  async function carregarMais(): Promise<void> {
    const caminho = atual.projetoPath
    if (!caminho || atual.carregandoMais || !atual.temMais) return
    const seq = seqProjeto
    const rSeq = seqReadiness
    const fonteAlvo = atual.filtroFonteId
    const offset = atual.aprovados.length

    atualizar({ carregandoMais: true, erroProntidao: null })

    try {
      const res = await buscarReadiness({
        sourceId: fonteAlvo,
        offset,
        limit: tamanhoPagina,
      })
      if (seq !== seqProjeto || rSeq !== seqReadiness || atual.projetoPath !== caminho) return
      ultimaFalhaProntidao = null
      atualizar({
        carregandoMais: false,
        erroProntidao: null,
        aprovados: mesclarSemDuplicar(atual.aprovados, res.items),
        totalAprovados: res.total,
        totalProjeto: fonteAlvo === null ? res.total : atual.totalProjeto,
        temMais: res.hasMore,
      })
    } catch (err) {
      if (seq !== seqProjeto || rSeq !== seqReadiness || atual.projetoPath !== caminho) return
      ultimaFalhaProntidao = 'mais'
      atualizar({ carregandoMais: false, erroProntidao: paraErroCore(err) })
    }
  }

  async function executarReadinessInicial(params: {
    sourceId: number | null
    limit: number
  }): Promise<void> {
    const caminho = atual.projetoPath
    if (!caminho) return
    const seq = seqProjeto
    seqReadiness += 1
    const rSeq = seqReadiness

    atualizar({
      filtroFonteId: params.sourceId,
      atualizandoProntidao: true,
      carregandoMais: false,
      erroProntidao: null,
    })

    try {
      const res = await buscarReadiness({
        sourceId: params.sourceId,
        offset: 0,
        limit: params.limit,
      })
      if (seq !== seqProjeto || rSeq !== seqReadiness || atual.projetoPath !== caminho) return
      ultimaFalhaProntidao = null
      atualizar({
        atualizandoProntidao: false,
        erroProntidao: null,
        aprovados: res.items,
        totalAprovados: res.total,
        totalProjeto: params.sourceId === null ? res.total : atual.totalProjeto,
        temMais: res.hasMore,
      })
    } catch (err) {
      if (seq !== seqProjeto || rSeq !== seqReadiness || atual.projetoPath !== caminho) return
      ultimaFalhaProntidao = 'atualizar'
      atualizar({ atualizandoProntidao: false, erroProntidao: paraErroCore(err) })
    }
  }

  async function filtrarPorFonte(sourceId: number | null): Promise<void> {
    await executarReadinessInicial({ sourceId, limit: tamanhoPagina })
  }

  async function atualizarProntidao(): Promise<void> {
    const limit = Math.max(tamanhoPagina, atual.aprovados.length)
    await executarReadinessInicial({ sourceId: atual.filtroFonteId, limit })
  }

  async function carregarGuardrailsEscopo(
    sourceId?: number | null,
  ): Promise<RespostaGuardrails | null> {
    const caminho = atual.projetoPath
    if (!caminho) return null
    const seq = seqProjeto
    const args =
      typeof sourceId === 'number'
        ? { scope: 'source', source_id: sourceId }
        : { scope: 'project' }
    try {
      const res = await chamar<RespostaGuardrails>('guardrails.check', args)
      if (seq !== seqProjeto || atual.projetoPath !== caminho) return null
      if (typeof sourceId === 'number') {
        atualizar({
          guardrailsPorFonte: {
            ...atual.guardrailsPorFonte,
            [sourceId]: res,
          },
        })
      } else {
        atualizar({ guardrailsProjeto: res })
      }
      return res
    } catch (err) {
      if (seq !== seqProjeto || atual.projetoPath !== caminho) return null
      ultimaFalhaProntidao = 'guardrails'
      ultimaFonteGuardrailsFalhou = typeof sourceId === 'number' ? sourceId : null
      atualizar({ erroProntidao: paraErroCore(err) })
      return null
    }
  }

  async function tentarNovamenteProntidao(): Promise<void> {
    if (ultimaFalhaProntidao === 'mais') {
      await carregarMais()
      return
    }
    if (ultimaFalhaProntidao === 'guardrails') {
      atualizar({ erroProntidao: null })
      ultimaFalhaProntidao = null
      await carregarGuardrailsEscopo(ultimaFonteGuardrailsFalhou)
      return
    }
    await atualizarProntidao()
  }

  async function definirProjeto(projetoPath: string | null): Promise<void> {
    if (projetoPath === atual.projetoPath) return
    seqProjeto += 1
    seqReadiness += 1
    ultimaFalhaProntidao = null
    ultimaFonteGuardrailsFalhou = null
    assinaturasVistas.clear()
    publicar(estadoInicial(projetoPath))
    if (!projetoPath) return
    await recarregar()
  }

  function sincronizarJobs(jobs: readonly Job[]): void {
    if (!atual.projetoPath || jobs.length === 0) return

    let precisaRefreshLotes = false
    let lotesAtualizados = atual.lotes
    let mudouLoteEmMemoria = false

    for (const j of jobs) {
      const assinatura = `${j.estado}:${j.etapa}:${j.percentual}`
      const mudou = assinaturasVistas.get(j.id) !== assinatura
      assinaturasVistas.set(j.id, assinatura)
      if (!mudou) continue

      if (j.id.startsWith('export-batch-')) {
        const idNum = Number(j.id.slice('export-batch-'.length))
        if (Number.isFinite(idNum)) {
          lotesAtualizados = lotesAtualizados.map((lote) => {
            if (lote.id !== idNum) return lote
            mudouLoteEmMemoria = true
            const estadoLote =
              j.etapa === 'export_batch_cancelled'
                ? ('cancelled' as const)
                : j.etapa === 'export_batch_complete' || j.estado === 'concluido'
                  ? ('completed' as const)
                  : lote.state
            return {
              ...lote,
              progress: Math.max(lote.progress, Math.round(j.percentual)),
              state: estadoLote,
            }
          })
        }
        if (
          j.etapa === 'export_batch_complete' ||
          j.etapa === 'export_batch_cancelled' ||
          j.estado === 'concluido' ||
          j.estado === 'falhou'
        ) {
          precisaRefreshLotes = true
        }
      } else if (/^\d+$/.test(j.id)) {
        const jobNum = Number(j.id)
        lotesAtualizados = lotesAtualizados.map((lote) => {
          if (!lote.items.some((it) => it.jobId === jobNum)) return lote
          mudouLoteEmMemoria = true
          return {
            ...lote,
            items: lote.items.map((it) => {
              if (it.jobId !== jobNum) return it
              const novoEstado =
                j.estado === 'concluido'
                  ? ('completed' as const)
                  : j.estado === 'falhou'
                    ? (j.erro?.code === 'cancelled' ? ('cancelled' as const) : ('failed' as const))
                    : ('running' as const)
              return {
                ...it,
                state: novoEstado,
                progress: novoEstado === 'completed' ? 100 : Math.max(it.progress, Math.round(j.percentual)),
                error: j.erro ? { code: j.erro.code, message: j.erro.message } : it.error,
              }
            }),
          }
        })
      }
    }

    if (mudouLoteEmMemoria) {
      atualizar({ lotes: lotesAtualizados })
    }
    if (precisaRefreshLotes) {
      void recarregarLotes()
    }
  }

  return {
    estado: () => atual,
    assinar: (fn) => {
      ouvintes.add(fn)
      return () => ouvintes.delete(fn)
    },
    definirProjeto,
    recarregar,
    recarregarLotes,
    carregarMais,
    filtrarPorFonte,
    atualizarProntidao,
    tentarNovamenteProntidao,
    carregarGuardrailsEscopo,
    sincronizarJobs,
  }
}

export const storeExportacaoProjeto = criarStoreExportacaoProjeto()

export type ResultadoUseExportacaoProjeto = EstadoExportacaoProjeto & {
  recarregar: () => Promise<void>
  recarregarLotes: () => Promise<LoteExportacao[]>
  carregarMais: () => Promise<void>
  filtrarPorFonte: (sourceId: number | null) => Promise<void>
  atualizarProntidao: () => Promise<void>
  tentarNovamenteProntidao: () => Promise<void>
  carregarGuardrailsEscopo: (sourceId?: number | null) => Promise<RespostaGuardrails | null>
}

/** Hook reativo da Mesa de Prontidão e Lotes de Exportação via `export.readiness`. */
export function useExportacaoProjeto(
  projetoPath: string | null,
  opcoes?: { store?: StoreExportacaoProjeto; fila?: Fila },
): ResultadoUseExportacaoProjeto {
  const store = opcoes?.store ?? storeExportacaoProjeto
  const estado = useSyncExternalStore(store.assinar, store.estado, store.estado)
  const jobs = useFila(opcoes?.fila)
  const projetoAnteriorRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (projetoAnteriorRef.current === projetoPath) return
    projetoAnteriorRef.current = projetoPath
    void store.definirProjeto(projetoPath)
  }, [projetoPath, store])

  useEffect(() => {
    if (!projetoPath || jobs.length === 0) return
    store.sincronizarJobs(jobs)
  }, [jobs, projetoPath, store])

  return useMemo(
    () => ({
      ...estado,
      recarregar: store.recarregar,
      recarregarLotes: store.recarregarLotes,
      carregarMais: store.carregarMais,
      filtrarPorFonte: store.filtrarPorFonte,
      atualizarProntidao: store.atualizarProntidao,
      tentarNovamenteProntidao: store.tentarNovamenteProntidao,
      carregarGuardrailsEscopo: store.carregarGuardrailsEscopo,
    }),
    [estado, store],
  )
}
