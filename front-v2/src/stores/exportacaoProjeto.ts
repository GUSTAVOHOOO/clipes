import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { useFila, type Fila, type Job } from '~/core/progresso'
import type { LoteExportacao } from '~/stores/filaGlobal'
import type { FonteProjeto } from '~/stores/fontesProjeto'
import type {
  DetalheExecucaoSelecao,
  ResumoRunSelecao,
  RevisaoExecucaoSelecao,
} from '~/stores/selecaoProjeto'

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
    transformedCount?: number
    approvedCount?: number
    unapprovedCount?: number
  }
  narration?: {
    applicable: boolean
    hasTts?: boolean
    generatedBlocks?: number
    totalBlocks?: number
    ttsCutCount?: number
    transformedCount?: number
    voices?: string[]
    freezeTailUs?: number
    longFreezeTail?: boolean
    freezeTailCount?: number
    longFreezeTailCount?: number
    maxFreezeTailUs?: number
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
  current: {
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
  }
}

export type ResumoCapaCorte = {
  current: {
    id: number
    instantUs: number
    origin: 'provider' | 'user' | string
    why?: string | null
  } | null
}

export type DetalhesCorteProntidao = {
  candidateId: number
  packaging: ResumoEmpacotamentoCorte | null
  thumbnail: ResumoCapaCorte | null
  guardrails: RespostaGuardrails | null
}

export type CorteAprovadoProntidao = {
  candidateId: number
  runId: number
  sourceId: number
  sourceName: string
  sourceStatus: FonteProjeto['status']
  permission: FonteProjeto['permission']
  videoKind: 'direct' | 'transformed'
  startId: number
  endId: number
  startUs: number
  endUs: number
  durationUs: number
  adjusted: boolean
  scoreTotal: number
  candidateTitle: string
}

export type EstadoExportacaoProjeto = {
  projetoPath: string | null
  carregando: boolean
  carregandoMais: boolean
  erro: ErroCore | null
  fontes: FonteProjeto[]
  aprovados: CorteAprovadoProntidao[]
  paginaAtual: number
  temMais: boolean
  detalhesPorCandidato: Record<number, DetalhesCorteProntidao>
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
  garantirDetalhesParaIds: (ids: readonly number[]) => Promise<void>
  carregarGuardrailsEscopo: (sourceId?: number | null) => Promise<RespostaGuardrails | null>
  sincronizarJobs: (jobs: readonly Job[]) => void
}

function estadoInicial(projetoPath: string | null): EstadoExportacaoProjeto {
  return {
    projetoPath,
    carregando: Boolean(projetoPath),
    carregandoMais: false,
    erro: null,
    fontes: [],
    aprovados: [],
    paginaAtual: 1,
    temMais: false,
    detalhesPorCandidato: {},
    guardrailsProjeto: null,
    guardrailsPorFonte: {},
    settings: null,
    encoder: null,
    lotes: [],
  }
}

function nomeArquivoDaFonte(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/**
 * Store paginado com cache em memória (#298) para a Mesa de Prontidão e Histórico de Lotes,
 * reagindo a `useFila()` e zerado integralmente ao fechar ou trocar o Projeto.
 */
export function criarStoreExportacaoProjeto(opcoes?: {
  tamanhoPagina?: number
}): StoreExportacaoProjeto {
  const tamanhoPagina = opcoes?.tamanhoPagina ?? TAMANHO_PAGINA
  let atual = estadoInicial(null)
  let seqProjeto = 0
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

  async function carregarDetalhesFaltantes(
    candidatosAlvo: readonly CorteAprovadoProntidao[],
    seq: number,
    caminho: string,
  ): Promise<void> {
    const faltantes = candidatosAlvo.filter((c) => !(c.candidateId in atual.detalhesPorCandidato))
    if (faltantes.length === 0) return

    const entradas = await Promise.all(
      faltantes.map(async (c): Promise<[number, DetalhesCorteProntidao]> => {
        const [pkg, thumb, gr] = await Promise.all([
          chamar<ResumoEmpacotamentoCorte>('packaging.get', { candidate: c.candidateId }).catch(() => null),
          chamar<ResumoCapaCorte>('thumbnail.get', { candidate: c.candidateId }).catch(() => null),
          chamar<RespostaGuardrails>('guardrails.check', {
            scope: 'single',
            source_id: c.sourceId,
            candidate_id: c.candidateId,
            start_id: c.startId,
            end_id: c.endId,
          }).catch(() => null),
        ])
        return [
          c.candidateId,
          {
            candidateId: c.candidateId,
            packaging: pkg,
            thumbnail: thumb,
            guardrails: gr,
          },
        ]
      }),
    )

    if (seq !== seqProjeto || atual.projetoPath !== caminho) return
    const proximoMapa = { ...atual.detalhesPorCandidato }
    for (const [id, det] of entradas) {
      proximoMapa[id] = det
    }
    atualizar({ detalhesPorCandidato: proximoMapa })
  }

  async function descobrirAprovados(
    fontes: readonly FonteProjeto[],
  ): Promise<CorteAprovadoProntidao[]> {
    const aprovados: CorteAprovadoProntidao[] = []

    for (const fonte of fontes) {
      let runs: ResumoRunSelecao[] = []
      try {
        const res = await chamar<ResumoRunSelecao[]>('selection.list', { source_id: fonte.id })
        runs = Array.isArray(res) ? res : []
      } catch (err) {
        const coreErr = paraErroCore(err)
        if (coreErr.code === 'transcript_missing') continue
        throw coreErr
      }

      for (const run of runs) {
        const [detalhe, revisao] = await Promise.all([
          chamar<DetalheExecucaoSelecao>('selection.get', {
            run: run.id,
            revision: run.revision,
          }).catch(() => null),
          chamar<RevisaoExecucaoSelecao>('selection.review', { run: run.id }).catch(() => null),
        ])
        if (!revisao) continue

        const candPorId = new Map((detalhe?.candidates ?? []).map((c) => [c.id, c]))
        for (const item of revisao.items) {
          if (item.status !== 'approved') continue
          const cand = candPorId.get(item.candidate)
          const videoKind =
            detalhe?.run?.videoKind === 'transformed' || run.videoKind === 'transformed'
              ? 'transformed'
              : 'direct'
          aprovados.push({
            candidateId: item.candidate,
            runId: run.id,
            sourceId: fonte.id,
            sourceName: nomeArquivoDaFonte(fonte.path),
            sourceStatus: fonte.status,
            permission: fonte.permission,
            videoKind,
            startId: item.startId,
            endId: item.endId,
            startUs: item.startUs,
            endUs: item.endUs,
            durationUs: Math.max(1, item.endUs - item.startUs),
            adjusted: item.adjusted,
            scoreTotal: cand?.total ?? 0,
            candidateTitle: cand?.title ?? '',
          })
        }
      }
    }

    return aprovados
  }

  async function recarregar(): Promise<void> {
    const caminho = atual.projetoPath
    if (!caminho) return
    const seq = seqProjeto
    atualizar({ carregando: true, erro: null })

    try {
      const [fontesRes, settingsRes, encoderRes, lotesRes, guardrailsRes] = await Promise.all([
        chamar<FonteProjeto[]>('sources.list', { project: caminho }),
        chamar<ConfiguracoesExportacao>('export.settings', {}).catch(() => null),
        chamar<StatusEncoderExportacao>('export.encoder.status', {}).catch(() => null),
        chamar<LoteExportacao[]>('export.batch.list', {}).catch(() => []),
        chamar<RespostaGuardrails>('guardrails.check', { scope: 'project' }).catch(() => null),
      ])
      if (seq !== seqProjeto || atual.projetoPath !== caminho) return

      const fontes = Array.isArray(fontesRes) ? fontesRes : []
      const aprovados = await descobrirAprovados(fontes)
      if (seq !== seqProjeto || atual.projetoPath !== caminho) return

      const limite = atual.paginaAtual * tamanhoPagina
      const loteInicial = aprovados.slice(0, limite)

      atualizar({
        fontes,
        aprovados,
        temMais: aprovados.length > limite,
        settings: settingsRes,
        encoder: encoderRes,
        lotes: Array.isArray(lotesRes) ? lotesRes : [],
        guardrailsProjeto: guardrailsRes,
        detalhesPorCandidato: {},
      })

      await carregarDetalhesFaltantes(loteInicial, seq, caminho)
      if (seq !== seqProjeto || atual.projetoPath !== caminho) return
      atualizar({ carregando: false, erro: null })
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
    const proximaPagina = atual.paginaAtual + 1
    const limite = proximaPagina * tamanhoPagina
    const fatia = atual.aprovados.slice(0, limite)

    atualizar({
      carregandoMais: true,
      paginaAtual: proximaPagina,
      temMais: atual.aprovados.length > limite,
    })

    await carregarDetalhesFaltantes(fatia, seq, caminho)
    if (seq !== seqProjeto || atual.projetoPath !== caminho) return
    atualizar({ carregandoMais: false })
  }

  async function garantirDetalhesParaIds(ids: readonly number[]): Promise<void> {
    const caminho = atual.projetoPath
    if (!caminho || ids.length === 0) return
    const seq = seqProjeto
    const conjunto = new Set(ids)
    const alvos = atual.aprovados.filter((c) => conjunto.has(c.candidateId))
    await carregarDetalhesFaltantes(alvos, seq, caminho)
  }

  async function carregarGuardrailsEscopo(sourceId?: number | null): Promise<RespostaGuardrails | null> {
    const caminho = atual.projetoPath
    if (!caminho) return null
    const seq = seqProjeto
    const args =
      typeof sourceId === 'number'
        ? { scope: 'source', source_id: sourceId }
        : { scope: 'project' }
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
  }

  async function definirProjeto(projetoPath: string | null): Promise<void> {
    if (projetoPath === atual.projetoPath) return
    seqProjeto += 1
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
    garantirDetalhesParaIds,
    carregarGuardrailsEscopo,
    sincronizarJobs,
  }
}

export const storeExportacaoProjeto = criarStoreExportacaoProjeto()

export type ResultadoUseExportacaoProjeto = EstadoExportacaoProjeto & {
  recarregar: () => Promise<void>
  recarregarLotes: () => Promise<LoteExportacao[]>
  carregarMais: () => Promise<void>
  garantirDetalhesParaIds: (ids: readonly number[]) => Promise<void>
  carregarGuardrailsEscopo: (sourceId?: number | null) => Promise<RespostaGuardrails | null>
}

/** Hook reativo da Mesa de Prontidão e Lotes de Exportação com cache paginado (#298). */
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
      garantirDetalhesParaIds: store.garantirDetalhesParaIds,
      carregarGuardrailsEscopo: store.carregarGuardrailsEscopo,
    }),
    [estado, store],
  )
}
