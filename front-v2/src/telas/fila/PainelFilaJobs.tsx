import {
  Abas,
  AreaRolagem,
  BannerErroCore,
  Botao,
  BotaoIcone,
  ConfirmDialog,
  Dica,
  Esqueleto,
  EstadoTela,
  Kbd,
  Progresso,
  ResumoCustoPrivacidade,
  Status,
  cn,
  usd,
  type Aba,
  type TomStatus,
} from '@ds'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Info,
  Pause,
  Play,
  RefreshCw,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { formatarTecla } from '~/comandos/atalhos'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { abrirNoSistema } from '~/core/desktop'
import { mensagemDeErro } from '~/core/erros'
import { useFila, type Fila, type Job } from '~/core/progresso'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import {
  useFilaGlobal,
  type JobPersistido,
  type LoteExportacao,
  type OperacaoGlobal,
  type OrcamentoItem,
  type ResultadoUseFilaGlobal,
  type StoreFilaGlobal,
} from '~/stores/filaGlobal'
import type { LoteFontes, LoteItem } from '~/stores/fontesProjeto'
import {
  DialogoDescartarJob,
  DialogoOrcamento,
  DialogoRefazerJob,
  DialogoResultadoJob,
  DialogoTentarDeNovo,
  nomeHumanoKind,
  rotuloEscopoOrcamento,
  traduzirMotivoPausa,
} from '~/telas/fila/DialogosFila'

export type FiltroFila = 'todos' | 'ativos' | 'atencao' | 'concluidos'

export type PainelFilaJobsProps = {
  aberto: boolean
  aoFechar: () => void
  projetoAberto: { id?: string | null; name: string; path?: string } | null
  refRetornoFoco?: RefObject<HTMLElement | null>
  estadoFila?: ResultadoUseFilaGlobal
  store?: StoreFilaGlobal
  fila?: Fila
  aoNavegar?: (hash: string) => void
}

function traduzirEstagioAoVivo(etapa: string): string {
  if (etapa.endsWith(':prepare')) return 'Preparando'
  if (etapa.endsWith(':call')) return 'Consultando Provedor'
  if (etapa.endsWith(':verify')) return 'Verificando saída'
  if (etapa === 'probe') return 'Verificando hardware'
  if (etapa === 'gpu_probe_fallback') return 'Fallback para CPU'
  if (etapa === 'transcribing') return 'Transcrevendo'
  if (etapa === 'export' || etapa === 'export_batch') return 'Exportando'
  if (etapa === 'waveform' || etapa === 'thumbnails' || etapa === 'preview') return 'Gerando prévia'
  if (etapa === 'download') return 'Baixando'
  const humano = nomeHumanoKind(etapa)
  return humano !== etapa ? humano : 'Em andamento'
}

function formatarEtaMs(etaMs: number): string {
  const seg = Math.max(1, Math.round(etaMs / 1000))
  if (seg < 60) return `~${seg} s restantes`
  const min = Math.max(1, Math.ceil(seg / 60))
  return `~${min} min restantes`
}

function formatarCustoJob(job: JobPersistido): string | null {
  if (job.taskCost?.costLabel) return job.taskCost.costLabel
  if (typeof job.taskCost?.microUsd === 'number' && job.taskCost.microUsd > 0) {
    return usd(job.taskCost.microUsd)
  }
  if (job.cost === 'unknown') return 'Custo desconhecido'
  if (job.cost === 'consome a cota do plano') return 'Consome a cota do plano'
  if (job.cost) return job.cost.startsWith('US$') ? job.cost : `US$ ${job.cost}`
  if (job.safety === 'local') return 'US$ 0,00'
  return null
}

function statusJobPersistido(job: JobPersistido): { tom: TomStatus; texto: string } {
  switch (job.state) {
    case 'queued':
      if (job.budgetPause === 'cost_unknown') {
        return { tom: 'pausado', texto: 'Aguardando confirmação de custo' }
      }
      if (job.budgetPause) {
        return { tom: 'pausado', texto: 'Pausado por orçamento' }
      }
      return { tom: 'pendente', texto: 'Na fila' }
    case 'running':
      return { tom: 'rodando', texto: 'Em execução' }
    case 'uncertain':
      return { tom: 'aviso', texto: 'Resultado incerto' }
    case 'completed':
      return { tom: 'sucesso', texto: 'Concluído' }
    case 'failed':
      return { tom: 'perigo', texto: 'Falhou' }
    case 'cancelled':
      return { tom: 'neutro', texto: 'Cancelado' }
  }
}

function statusLoteFontes(lote: LoteFontes): { tom: TomStatus; texto: string } {
  switch (lote.status) {
    case 'running':
      return { tom: 'rodando', texto: 'Em execução' }
    case 'paused':
      return { tom: 'pausado', texto: 'Pausado' }
    case 'budget_paused':
      return { tom: 'pausado', texto: 'Pausado por orçamento' }
    case 'attention':
      return { tom: 'aviso', texto: `Atenção (${lote.counts.paused})` }
    case 'completed':
      return { tom: 'sucesso', texto: 'Concluído' }
    case 'cancelled':
      return { tom: 'neutro', texto: 'Cancelado' }
  }
}

function statusItemLote(item: LoteItem): { tom: TomStatus; texto: string } {
  switch (item.state) {
    case 'pending':
      return { tom: 'pendente', texto: 'Na fila' }
    case 'transcribing':
      return { tom: 'rodando', texto: 'Transcrevendo' }
    case 'selecting':
      return { tom: 'rodando', texto: 'Selecionando' }
    case 'completed':
      return { tom: 'sucesso', texto: 'Concluído' }
    case 'paused':
      return { tom: 'aviso', texto: 'Pausado' }
    case 'cancelled':
      return { tom: 'neutro', texto: 'Cancelado' }
  }
}

function statusLoteExport(lote: LoteExportacao): { tom: TomStatus; texto: string } {
  switch (lote.status) {
    case 'running':
      return { tom: 'rodando', texto: 'Em andamento' }
    case 'completed':
      return { tom: 'sucesso', texto: 'Concluído' }
    case 'partial':
      return { tom: 'aviso', texto: 'Concluído com falhas' }
    case 'failed':
      return { tom: 'perigo', texto: 'Falhou' }
    case 'cancelled':
      return { tom: 'neutro', texto: 'Cancelado' }
  }
}

function jobCombinaFiltro(job: JobPersistido, filtro: FiltroFila): boolean {
  if (filtro === 'todos') return true
  if (filtro === 'ativos') return job.state === 'running' || (job.state === 'queued' && !job.budgetPause)
  if (filtro === 'atencao') {
    return job.state === 'uncertain' || job.state === 'failed' || Boolean(job.budgetPause)
  }
  return job.state === 'completed' || job.state === 'cancelled'
}

function loteFontesCombinaFiltro(lote: LoteFontes, filtro: FiltroFila): boolean {
  if (filtro === 'todos') return true
  if (filtro === 'ativos') return lote.state === 'running' && lote.status !== 'attention'
  if (filtro === 'atencao') {
    return (
      lote.status === 'attention' ||
      lote.status === 'paused' ||
      lote.status === 'budget_paused' ||
      lote.counts.paused > 0
    )
  }
  return lote.state === 'completed' || lote.state === 'cancelled'
}

function loteExportCombinaFiltro(lote: LoteExportacao, filtro: FiltroFila): boolean {
  if (filtro === 'todos') return true
  if (filtro === 'ativos') return lote.state === 'running'
  if (filtro === 'atencao') return lote.status === 'partial' || lote.status === 'failed'
  return lote.status === 'completed' || lote.status === 'cancelled'
}

function globalCombinaFiltro(op: OperacaoGlobal, filtro: FiltroFila): boolean {
  if (filtro === 'todos') return true
  if (filtro === 'ativos') return op.estado === 'rodando'
  if (filtro === 'atencao') return op.estado === 'falhou' || op.estado === 'pausado' || op.estado === 'incerto'
  return op.estado === 'concluido'
}

async function cancelarOperacaoGlobal(op: OperacaoGlobal): Promise<void> {
  if (op.prefixoCancelamento === 'tts' || op.id.startsWith('tts:')) {
    const idLimpo = op.id.replace(/^tts:/, '')
    await chamar('tts.models.cancel', { id: idLimpo })
    return
  }
  if (op.prefixoCancelamento === 'sources-url' || op.id.startsWith('url-') || op.id.startsWith('sources.url.')) {
    await chamar('sources.url.cancel', { job: op.id })
    return
  }
  if (
    op.prefixoCancelamento === 'sources' ||
    op.id.startsWith('source-hash') ||
    op.id.startsWith('source-relocate') ||
    op.id.startsWith('source-copy')
  ) {
    await chamar('sources.cancel', { job: op.id })
    return
  }
  await chamar('components.cancel', { id: op.id })
}

type ConfirmacaoRetomadaItem = {
  loteId: number
  item: LoteItem
  estimativa: { kind?: string; minMicroUsd?: number; maxMicroUsd?: number } | null
}

/**
 * Gaveta global acoplável da Fila de Jobs (`Ctrl/Cmd+J`), unificando jobs persistidos,
 * Lotes de Fontes, Lotes de exportação, pausas de orçamento e operações globais em memória.
 */
export function PainelFilaJobs({
  aberto,
  aoFechar,
  projetoAberto,
  refRetornoFoco,
  estadoFila: estadoFilaProp,
  store,
  fila: filaProp,
  aoNavegar,
}: PainelFilaJobsProps) {
  const projetoPath = projetoAberto?.path ?? (projetoAberto ? projetoAberto.id ?? projetoAberto.name : null)
  const estadoHook = useFilaGlobal(estadoFilaProp ? null : projetoPath, { store, fila: filaProp })
  const estadoFila = estadoFilaProp ?? estadoHook
  const jobsAoVivo = useFila(filaProp)
  const forcado = useEstadoForcado()

  const asideRef = useRef<HTMLElement>(null)
  const refsIncertos = useRef<Record<number, HTMLDivElement | null>>({})

  const [filtro, setFiltro] = useState<FiltroFila>('todos')
  const [lotesExpandidos, setLotesExpandidos] = useState<Record<number, boolean>>({})
  const [ocupadoKey, setOcupadoKey] = useState<string | null>(null)
  const [erroAcao, setErroAcao] = useState<ErroCore | null>(null)

  const [jobRetry, setJobRetry] = useState<JobPersistido | null>(null)
  const [jobDiscard, setJobDiscard] = useState<JobPersistido | null>(null)
  const [jobRedo, setJobRedo] = useState<JobPersistido | null>(null)
  const [jobResultado, setJobResultado] = useState<JobPersistido | null>(null)
  const [orcamentoDialogo, setOrcamentoDialogo] = useState<{
    item: OrcamentoItem
    modoContinuar: boolean
  } | null>(null)
  const [jobCancelarPago, setJobCancelarPago] = useState<JobPersistido | null>(null)
  const [loteCancelarFontes, setLoteCancelarFontes] = useState<LoteFontes | null>(null)
  const [loteCancelarExport, setLoteCancelarExport] = useState<LoteExportacao | null>(null)
  const [confirmacaoItem, setConfirmacaoItem] = useState<ConfirmacaoRetomadaItem | null>(null)

  const navegar = useCallback(
    (hash: string) => {
      if (aoNavegar) {
        aoNavegar(hash)
      } else {
        window.location.hash = hash
      }
    },
    [aoNavegar],
  )

  const fecharDevolvendoFoco = useCallback(() => {
    aoFechar()
    const alvo = refRetornoFoco?.current
    if (alvo) {
      alvo.focus()
    }
  }, [aoFechar, refRetornoFoco])

  useEffect(() => {
    if (!aberto) return
    const el = asideRef.current
    if (el && !el.contains(document.activeElement)) {
      el.focus()
    }
  }, [aberto])

  const mapaAoVivo = useMemo(() => {
    const mapa = new Map<string, Job>()
    for (const j of jobsAoVivo) {
      mapa.set(j.id, j)
    }
    return mapa
  }, [jobsAoVivo])

  const jobs = estadoFila.jobs
  const lotesFontes = estadoFila.lotesFontes
  const lotesExportacao = estadoFila.lotesExportacao
  const pausasOrcamento = estadoFila.pausasOrcamento
  const operacoesGlobais = estadoFila.operacoesGlobais

  const jobsIncertos = useMemo(() => jobs.filter((j) => j.state === 'uncertain'), [jobs])

  const focarPrimeiroIncerto = useCallback(
    (jobIdPreferido?: number | null) => {
      setFiltro('todos')
      const alvoId =
        jobIdPreferido != null && refsIncertos.current[jobIdPreferido]
          ? jobIdPreferido
          : jobsIncertos[0]?.id
      if (alvoId == null) return
      requestAnimationFrame(() => {
        const el = refsIncertos.current[alvoId]
        if (el) {
          el.scrollIntoView?.({ block: 'nearest' })
          el.focus()
        }
      })
    },
    [jobsIncertos],
  )

  const aoTeclarNoPainel = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const temModal = Array.from(
        document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
      ).some((el) => !el.closest('[aria-label="Notifications"]'))
      if (temModal) return
      e.preventDefault()
      e.stopPropagation()
      fecharDevolvendoFoco()
    },
    [fecharDevolvendoFoco],
  )

  const cancelarJobPersistido = useCallback(
    async (job: JobPersistido) => {
      setOcupadoKey(`job:${job.id}`)
      setErroAcao(null)
      try {
        await chamar('jobs.cancel', { id: job.id })
        setJobCancelarPago(null)
        await estadoFila.recarregar()
      } catch (err) {
        setErroAcao(paraErroCore(err))
      } finally {
        setOcupadoKey(null)
      }
    },
    [estadoFila],
  )

  const acionarControleLoteFontes = useCallback(
    async (cmd: 'batches.pause' | 'batches.resume' | 'batches.cancel', lote: LoteFontes) => {
      setOcupadoKey(`batch:${lote.id}`)
      setErroAcao(null)
      try {
        await chamar(cmd, { id: lote.id })
        setLoteCancelarFontes(null)
        await estadoFila.recarregar()
      } catch (err) {
        setErroAcao(paraErroCore(err))
      } finally {
        setOcupadoKey(null)
      }
    },
    [estadoFila],
  )

  const retomarItemLote = useCallback(
    async (loteId: number, item: LoteItem, confirmado: boolean) => {
      setOcupadoKey(`batch-item:${loteId}:${item.sourceId}`)
      setErroAcao(null)
      try {
        await chamar('batches.item.resume', {
          id: loteId,
          sourceId: item.sourceId,
          ...(confirmado ? { confirmed: true } : {}),
        })
        setConfirmacaoItem(null)
        await estadoFila.recarregar()
      } catch (err) {
        const coreErr = paraErroCore(err)
        if (coreErr.code === 'uncertain_job') {
          setConfirmacaoItem(null)
          setErroAcao(coreErr)
          focarPrimeiroIncerto(item.transcriptionJob)
        } else if (coreErr.code === 'confirmation_required' && !confirmado) {
          const usage = coreErr.usage as
            | { estimate?: ConfirmacaoRetomadaItem['estimativa'] }
            | undefined
          setConfirmacaoItem({
            loteId,
            item,
            estimativa: usage?.estimate ?? null,
          })
        } else {
          setConfirmacaoItem(null)
          setErroAcao(coreErr)
        }
      } finally {
        setOcupadoKey(null)
      }
    },
    [estadoFila, focarPrimeiroIncerto],
  )

  const cancelarLoteExportacao = useCallback(
    async (lote: LoteExportacao) => {
      setOcupadoKey(`export-batch:${lote.id}`)
      setErroAcao(null)
      try {
        await chamar('export.batch.cancel', { id: lote.id })
        setLoteCancelarExport(null)
        await estadoFila.recarregar()
      } catch (err) {
        setErroAcao(paraErroCore(err))
      } finally {
        setOcupadoKey(null)
      }
    },
    [estadoFila],
  )

  const cancelarGlobal = useCallback(async (op: OperacaoGlobal) => {
    setOcupadoKey(`global:${op.id}`)
    setErroAcao(null)
    try {
      await cancelarOperacaoGlobal(op)
    } catch (err) {
      const coreErr = paraErroCore(err)
      if (coreErr.code !== 'cancelled') {
        setErroAcao(coreErr)
      }
    } finally {
      setOcupadoKey(null)
    }
  }, [])

  const abrirOrcamentoLote = useCallback(
    (lote: LoteFontes) => {
      const existente = estadoFila.orcamentos.find(
        (o) => o.scope === 'batch' && o.key === lote.key,
      )
      const alvo: OrcamentoItem = existente ?? {
        scope: 'batch',
        key: lote.key,
        maxCalls: null,
        maxTokens: null,
        maxWallMs: null,
        maxCostMicroUsd: lote.budget?.maxCostMicroUsd ?? null,
        unknownConfirmed: Boolean(lote.budget?.unknownConfirmed),
        since: Date.now() * 1000,
        usage: {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          microUsd: lote.budget?.usage?.microUsd ?? 0,
          audioMicroUsd: lote.budget?.usage?.audioMicroUsd ?? 0,
          unknownCostCalls: lote.budget?.usage?.unknownCostCalls ?? 0,
          planQuotaCalls: 0,
          durationMs: 0,
          costLabel: lote.budget?.usage?.costLabel ?? null,
        },
        paused: lote.budget?.paused ?? (lote.pause || null),
      }
      setOrcamentoDialogo({ item: alvo, modoContinuar: alvo.paused !== null })
    },
    [estadoFila.orcamentos],
  )

  const contagens = useMemo(() => {
    const contar = (f: FiltroFila) =>
      (projetoAberto
        ? jobs.filter((j) => jobCombinaFiltro(j, f)).length +
          lotesFontes.filter((l) => loteFontesCombinaFiltro(l, f)).length +
          lotesExportacao.filter((l) => loteExportCombinaFiltro(l, f)).length
        : 0) + operacoesGlobais.filter((g) => globalCombinaFiltro(g, f)).length
    return {
      todos: contar('todos'),
      ativos: contar('ativos'),
      atencao: contar('atencao'),
      concluidos: contar('concluidos'),
    }
  }, [jobs, lotesExportacao, lotesFontes, operacoesGlobais, projetoAberto])

  const abasFiltro: Aba<FiltroFila>[] = [
    { valor: 'todos', rotulo: `Todos (${contagens.todos})` },
    { valor: 'ativos', rotulo: `Ativos e na fila (${contagens.ativos})` },
    { valor: 'atencao', rotulo: `Atenção (${contagens.atencao})` },
    { valor: 'concluidos', rotulo: `Concluídos (${contagens.concluidos})` },
  ]

  const jobsFiltrados = useMemo(
    () => (projetoAberto ? jobs.filter((j) => jobCombinaFiltro(j, filtro)) : []),
    [filtro, jobs, projetoAberto],
  )
  const lotesFontesFiltrados = useMemo(
    () => (projetoAberto ? lotesFontes.filter((l) => loteFontesCombinaFiltro(l, filtro)) : []),
    [filtro, lotesFontes, projetoAberto],
  )
  const lotesExportFiltrados = useMemo(
    () => (projetoAberto ? lotesExportacao.filter((l) => loteExportCombinaFiltro(l, filtro)) : []),
    [filtro, lotesExportacao, projetoAberto],
  )
  const globaisFiltradas = useMemo(
    () => operacoesGlobais.filter((g) => globalCombinaFiltro(g, filtro)),
    [filtro, operacoesGlobais],
  )

  if (!aberto) return null

  const encProjeto = projetoAberto
    ? encodeURIComponent(projetoAberto.id ?? projetoAberto.name)
    : ''
  const atalhoFila = formatarTecla('Mod+J')

  const carregandoInicial =
    forcado === 'carregando' ||
    (Boolean(projetoAberto) &&
      estadoFila.carregando &&
      jobs.length === 0 &&
      lotesFontes.length === 0 &&
      lotesExportacao.length === 0)

  const erroPrincipal =
    forcado === 'erro'
      ? new ErroCore('project_busy', 'Falha simulada via ?estado=erro.')
      : estadoFila.erro

  const semNadaNoProjeto =
    Boolean(projetoAberto) &&
    !carregandoInicial &&
    !erroPrincipal &&
    contagens.todos === 0

  const semNadaSemProjeto =
    !projetoAberto &&
    forcado !== 'carregando' &&
    !erroPrincipal &&
    operacoesGlobais.length === 0

  const filtroSemItens =
    !carregandoInicial &&
    !erroPrincipal &&
    contagens.todos > 0 &&
    jobsFiltrados.length === 0 &&
    lotesFontesFiltrados.length === 0 &&
    lotesExportFiltrados.length === 0 &&
    globaisFiltradas.length === 0

  return (
    <>
      <aside
        ref={asideRef}
        role="complementary"
        aria-label="Fila de Jobs"
        data-regiao="fila"
        tabIndex={-1}
        onKeyDown={aoTeclarNoPainel}
        className="foco-interno flex h-full w-[470px] max-w-[calc(100vw-32px)] shrink-0 flex-col border-l border-linha bg-area min-[1440px]:w-[560px]"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-linha px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-base font-forte text-t1">Fila de Jobs</h2>
            <Kbd>{atalhoFila}</Kbd>
            <span className="truncate text-pequeno text-t3">
              {projetoAberto ? `Projeto: ${projetoAberto.name}` : 'Sem Projeto aberto'}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {projetoAberto && (
              <BotaoIcone
                rotulo="Atualizar fila"
                tamanho="p"
                onClick={() => void estadoFila.recarregar()}
              >
                <RefreshCw />
              </BotaoIcone>
            )}
            <BotaoIcone
              rotulo="Fechar Fila (Esc)"
              atalho="Esc"
              tamanho="p"
              onClick={fecharDevolvendoFoco}
            >
              <X />
            </BotaoIcone>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
          {/* Zona 1 — Alertas Prioritários */}
          {projetoAberto && jobsIncertos.length > 0 && (
            <div role="alert" className="flex flex-col gap-2 rounded-area bg-elevado p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-[15px] shrink-0 stroke-[1.75] text-erro" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-base font-medio text-t1">
                      {jobsIncertos.length === 1
                        ? '1 chamada paga com resultado incerto'
                        : `${jobsIncertos.length} chamadas pagas com resultado incerto`}
                    </p>
                    <p className="mt-0.5 text-pequeno text-t2">
                      Uma ou mais chamadas pagas foram interrompidas ou expiraram. O Clipes nunca as repete automaticamente para evitar cobrança dupla.
                    </p>
                  </div>
                </div>
                <Botao
                  tamanho="p"
                  variante="secundario"
                  onClick={() => focarPrimeiroIncerto(jobsIncertos[0]?.id)}
                >
                  Revisar abaixo
                </Botao>
              </div>
            </div>
          )}

          {projetoAberto &&
            pausasOrcamento.map((orc) => {
              const tokens = orc.usage.inputTokens + orc.usage.outputTokens
              return (
                <div
                  key={`${orc.scope}:${orc.key}`}
                  role="alert"
                  className="flex flex-col gap-2 rounded-area bg-elevado p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-base font-medio text-t1">
                      Orçamento pausou: {rotuloEscopoOrcamento(orc)}
                    </span>
                    <Status tom="pausado">{traduzirMotivoPausa(orc.paused)}</Status>
                  </div>
                  <p className="num text-pequeno text-t2">
                    Gasto: {orc.usage.costLabel ?? usd(orc.usage.microUsd)}
                    {orc.maxCostMicroUsd != null ? ` / ${usd(orc.maxCostMicroUsd)}` : ''} ·{' '}
                    {orc.usage.calls} chamadas · {tokens.toLocaleString('pt-BR')} tokens
                  </p>
                  <div className="flex justify-end">
                    <Botao
                      tamanho="p"
                      variante="secundario"
                      onClick={() => setOrcamentoDialogo({ item: orc, modoContinuar: true })}
                    >
                      Ajustar orçamento e continuar
                    </Botao>
                  </div>
                </div>
              )
            })}

          {erroAcao && (
            <BannerErroCore
              erro={{ code: erroAcao.code, message: erroAcao.detalhe || erroAcao.message }}
              traduzir={(code) => {
                const trad = mensagemDeErro(new ErroCore(code, erroAcao.detalhe))
                return {
                  titulo: trad.titulo,
                  explicacao: erroAcao.detalhe && erroAcao.detalhe !== trad.titulo ? erroAcao.detalhe : undefined,
                }
              }}
              acaoRecuperacao={(() => {
                const rec = mensagemDeErro(erroAcao).recuperacao
                if (!rec) return undefined
                return {
                  rotulo: rec.rotulo,
                  aoAcionar: () => {
                    if (rec.rota) navegar(rec.rota)
                    else if (rec.acao === 'recarregar') void estadoFila.recarregar()
                    else if (rec.acao === 'abrir-fila') focarPrimeiroIncerto()
                    else if (rec.acao === 'ajustar-orcamento' && pausasOrcamento[0]) {
                      setOrcamentoDialogo({ item: pausasOrcamento[0], modoContinuar: true })
                    }
                  },
                }
              })()}
              aoDispensar={() => setErroAcao(null)}
            />
          )}

          {/* Zona 2 — Filtros */}
          {!carregandoInicial && !erroPrincipal && contagens.todos > 0 && (
            <Abas
              valor={filtro}
              aoMudar={setFiltro}
              abas={abasFiltro}
              rotulo="Filtros da Fila de Jobs"
              tamanho="p"
            />
          )}

          {/* Zona 3 — Lista Unificada */}
          <AreaRolagem className="min-h-0 flex-1" rotulo="Lista de tarefas da Fila">
            <div className="flex flex-col gap-3 pr-1">
              {carregandoInicial && (
                <Esqueleto
                  variante="lista"
                  quantidade={4}
                  rotuloAcessivel="Carregando Fila de Jobs"
                />
              )}

              {erroPrincipal && !carregandoInicial && (
                <BannerErroCore
                  erro={{
                    code: erroPrincipal.code,
                    message: erroPrincipal.detalhe || erroPrincipal.message,
                  }}
                  traduzir={(code) => {
                    const trad = mensagemDeErro(new ErroCore(code, erroPrincipal.detalhe))
                    return {
                      titulo: trad.titulo,
                      explicacao:
                        erroPrincipal.detalhe && erroPrincipal.detalhe !== trad.titulo
                          ? erroPrincipal.detalhe
                          : undefined,
                    }
                  }}
                  acaoRecuperacao={(() => {
                    const rec = mensagemDeErro(erroPrincipal).recuperacao
                    if (rec?.rota) {
                      return { rotulo: rec.rotulo, aoAcionar: () => navegar(rec.rota!) }
                    }
                    return {
                      rotulo: 'Atualizar fila',
                      aoAcionar: () => void estadoFila.recarregar(),
                    }
                  })()}
                />
              )}

              {semNadaSemProjeto && (
                <EstadoTela
                  tipo="vazio"
                  titulo="Nenhum Projeto aberto"
                  descricao="Nenhuma tarefa global em andamento. Abra um Projeto para acompanhar transcrições, seleções e exportações."
                  acaoPrimaria={{
                    rotulo: 'Ir para Início',
                    aoAcionar: () => navegar('#/inicio'),
                  }}
                />
              )}

              {!projetoAberto && !carregandoInicial && !erroPrincipal && operacoesGlobais.length > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-area bg-elevado p-3 text-pequeno">
                  <span className="text-t2">
                    Nenhum Projeto aberto. Abra um Projeto para acompanhar transcrições, seleções e exportações.
                  </span>
                  <Botao tamanho="p" variante="secundario" onClick={() => navegar('#/inicio')}>
                    Ir para Início
                  </Botao>
                </div>
              )}

              {semNadaNoProjeto && (
                <EstadoTela
                  tipo="vazio"
                  titulo="Nenhuma tarefa registrada"
                  descricao="Nenhuma tarefa registrada neste Projeto ainda. Importe uma Fonte ou dispare uma seleção para acompanhar aqui."
                  acaoPrimaria={{
                    rotulo: 'Ir para Fontes',
                    aoAcionar: () => navegar(`#/projeto/${encProjeto}/fontes`),
                  }}
                />
              )}

              {filtroSemItens && (
                <EstadoTela
                  tipo="vazio"
                  compacto
                  titulo="Nenhum item neste filtro."
                  descricao="Altere o filtro para ver outras tarefas."
                  acaoPrimaria={{
                    rotulo: 'Mostrar todos',
                    aoAcionar: () => setFiltro('todos'),
                  }}
                />
              )}

              {/* Trilha 1: Jobs persistidos do Projeto */}
              {!carregandoInicial && !erroPrincipal && jobsFiltrados.length > 0 && (
                <section aria-label="Tarefas do Projeto" className="flex flex-col gap-2">
                  <h3 className="text-micro font-medio tracking-wide text-t3 uppercase">
                    Tarefas do Projeto
                  </h3>
                  {jobsFiltrados.map((job) => {
                    const live = mapaAoVivo.get(String(job.id))
                    const estadoEfetivo: JobPersistido['state'] =
                      job.state === 'queued' && live?.estado === 'rodando' ? 'running' : job.state
                    const jobEfetivo: JobPersistido =
                      estadoEfetivo === job.state ? job : { ...job, state: estadoEfetivo }
                    const pct =
                      estadoEfetivo === 'running'
                        ? Math.max(job.progress, live?.percentual ?? 0)
                        : job.progress
                    const statusInfo = statusJobPersistido(jobEfetivo)
                    const custoTxt = formatarCustoJob(job)
                    const ehAi = job.kind.startsWith('ai:')
                    const erroTrad =
                      estadoEfetivo === 'failed'
                        ? mensagemDeErro(new ErroCore(job.outcome || 'desconhecido', ''))
                        : null
                    const podeEta =
                      estadoEfetivo === 'running' && !ehAi && live?.etaMs != null
                    const estagioTxt = live?.etapa ? traduzirEstagioAoVivo(live.etapa) : null

                    return (
                      <div
                        key={job.id}
                        data-testid={`fila-job-${job.id}`}
                        ref={(el) => {
                          if (estadoEfetivo === 'uncertain') {
                            refsIncertos.current[job.id] = el
                          }
                        }}
                        tabIndex={estadoEfetivo === 'uncertain' ? -1 : undefined}
                        className={cn(
                          'foco-interno flex flex-col gap-2 rounded-area bg-elevado p-3',
                          estadoEfetivo === 'uncertain' && 'marcado',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <strong className="text-base font-medio text-t1">
                                {nomeHumanoKind(job.kind)}
                              </strong>
                              <span className="num text-pequeno text-t3">#{job.id}</span>
                              {job.profile && (
                                <span className="text-pequeno text-t3">· {job.profile}</span>
                              )}
                              {job.batch && (
                                <span className="text-pequeno text-t3">· {job.batch}</span>
                              )}
                              {job.attempts > 1 && (
                                <span className="num text-pequeno text-t3">
                                  · {job.attempts} tentativas
                                </span>
                              )}
                            </div>
                          </div>
                          <Status tom={statusInfo.tom}>{statusInfo.texto}</Status>
                        </div>

                        {estadoEfetivo === 'running' && (
                          <div className="flex flex-col gap-1">
                            <Progresso
                              valor={pct}
                              rotulo={estagioTxt ?? 'Processando'}
                              detalhe={
                                podeEta
                                  ? `${Math.round(pct)}% · ${formatarEtaMs(live!.etaMs!)}`
                                  : `${Math.round(pct)}%`
                              }
                            />
                            {!podeEta && (
                              <div className="flex items-center gap-1 text-micro text-t3">
                                <Dica texto="Tempo restante (ETA) indisponível após recarregar a janela ou em etapas de IA.">
                                  <span className="inline-flex items-center gap-1">
                                    <Info className="size-3 stroke-[1.75]" aria-hidden />
                                    <span>ETA indisponível</span>
                                  </span>
                                </Dica>
                              </div>
                            )}
                          </div>
                        )}

                        {job.state === 'uncertain' && (
                          <p className="text-pequeno text-t2">
                            Resposta do Provedor expirou ou foi interrompida; não repetimos automaticamente.
                          </p>
                        )}

                        {erroTrad && (
                          <p className="text-pequeno text-erro">{erroTrad.titulo}</p>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          {custoTxt && job.state === 'completed' ? (
                            <span className="num text-pequeno text-t3">{custoTxt}</span>
                          ) : (
                            <span />
                          )}

                          <div className="flex flex-wrap items-center gap-1.5">
                            {job.state === 'uncertain' && (
                              <>
                                <Botao
                                  tamanho="p"
                                  variante="secundario"
                                  onClick={() => setJobRetry(job)}
                                >
                                  Ver estimativa e repetir
                                </Botao>
                                <Botao
                                  tamanho="p"
                                  variante="perigo"
                                  onClick={() => setJobDiscard(job)}
                                >
                                  Descartar
                                </Botao>
                              </>
                            )}

                            {(job.state === 'queued' || job.state === 'running') && (
                              <Botao
                                tamanho="p"
                                variante="suave"
                                carregando={ocupadoKey === `job:${job.id}`}
                                onClick={() => {
                                  if (job.state === 'running' && job.safety === 'paid') {
                                    setJobCancelarPago(job)
                                  } else {
                                    void cancelarJobPersistido(job)
                                  }
                                }}
                              >
                                Cancelar
                              </Botao>
                            )}

                            {ehAi && (job.state === 'completed' || job.state === 'failed') && (
                              <Botao
                                tamanho="p"
                                variante="fantasma"
                                onClick={() => setJobResultado(job)}
                              >
                                Ver resultado
                              </Botao>
                            )}

                            {ehAi &&
                              (job.state === 'completed' ||
                                job.state === 'failed' ||
                                job.state === 'cancelled') && (
                                <Botao
                                  tamanho="p"
                                  variante="suave"
                                  onClick={() => setJobRedo(job)}
                                >
                                  Refazer com outro Perfil
                                </Botao>
                              )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </section>
              )}

              {/* Trilha 2: Lotes de Fontes */}
              {!carregandoInicial && !erroPrincipal && lotesFontesFiltrados.length > 0 && (
                <section aria-label="Lotes de Fontes" className="flex flex-col gap-2">
                  <h3 className="text-micro font-medio tracking-wide text-t3 uppercase">
                    Lotes de Fontes
                  </h3>
                  {lotesFontesFiltrados.map((lote) => {
                    const st = statusLoteFontes(lote)
                    const pct =
                      lote.counts.total > 0
                        ? Math.round((lote.counts.completed / lote.counts.total) * 100)
                        : 0
                    const expandido =
                      lotesExpandidos[lote.id] ??
                      (lote.status === 'attention' || lote.counts.paused > 0)

                    return (
                      <div key={lote.id} className="flex flex-col gap-2 rounded-area bg-elevado p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <strong className="text-base font-medio text-t1">
                              Lote de Fontes #{lote.id}
                            </strong>
                            <span className="text-pequeno text-t3">
                              {lote.engine === 'groq' ? 'Groq' : 'Local'} ·{' '}
                              {lote.videoKind === 'transformed'
                                ? 'Vídeo transformado'
                                : 'Corte direto'}
                            </span>
                          </div>
                          <Status tom={st.tom}>{st.texto}</Status>
                        </div>

                        <Progresso
                          valor={pct}
                          rotulo="Progresso do lote"
                          detalhe={`${lote.counts.completed}/${lote.counts.total}`}
                        />

                        {lote.items.length > 0 && (
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              aria-expanded={expandido}
                              onClick={() =>
                                setLotesExpandidos((prev) => ({
                                  ...prev,
                                  [lote.id]: !expandido,
                                }))
                              }
                              className="foco flex w-fit cursor-pointer items-center gap-1 rounded-controle border-0 bg-transparent px-1 py-0.5 text-pequeno text-t2 hover:text-t1"
                            >
                              {expandido ? (
                                <ChevronDown className="size-[14px]" aria-hidden />
                              ) : (
                                <ChevronRight className="size-[14px]" aria-hidden />
                              )}
                              <span>Itens do lote ({lote.items.length})</span>
                            </button>

                            {expandido && (
                              <ul className="m-0 flex list-none flex-col gap-1.5 rounded-area bg-area p-2">
                                {lote.items.map((item) => {
                                  const stItem = statusItemLote(item)
                                  const msgErroItem =
                                    item.state === 'paused' && item.error
                                      ? mensagemDeErro(new ErroCore(item.error, '')).titulo
                                      : null
                                  return (
                                    <li
                                      key={item.sourceId}
                                      className="flex flex-wrap items-center justify-between gap-2 text-pequeno"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <span className="truncate text-t1">{item.name}</span>
                                        {msgErroItem && (
                                          <p className="text-micro text-erro">{msgErroItem}</p>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <Status tom={stItem.tom}>{stItem.texto}</Status>
                                        {item.state === 'paused' && (
                                          <Botao
                                            tamanho="p"
                                            variante="secundario"
                                            carregando={
                                              ocupadoKey === `batch-item:${lote.id}:${item.sourceId}`
                                            }
                                            onClick={() =>
                                              void retomarItemLote(lote.id, item, false)
                                            }
                                          >
                                            Retomar Fonte
                                          </Botao>
                                        )}
                                      </div>
                                    </li>
                                  )
                                })}
                              </ul>
                            )}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {lote.state === 'running' && (
                            <Botao
                              tamanho="p"
                              variante="suave"
                              icone={<Pause />}
                              carregando={ocupadoKey === `batch:${lote.id}`}
                              onClick={() => void acionarControleLoteFontes('batches.pause', lote)}
                            >
                              Pausar
                            </Botao>
                          )}
                          {(lote.state === 'paused' || lote.status === 'budget_paused') && (
                            <Botao
                              tamanho="p"
                              variante="secundario"
                              icone={<Play />}
                              carregando={ocupadoKey === `batch:${lote.id}`}
                              onClick={() => void acionarControleLoteFontes('batches.resume', lote)}
                            >
                              Retomar
                            </Botao>
                          )}
                          <Botao
                            tamanho="p"
                            variante="suave"
                            onClick={() => abrirOrcamentoLote(lote)}
                          >
                            Orçamento
                          </Botao>
                          {lote.state !== 'completed' && lote.state !== 'cancelled' && (
                            <Botao
                              tamanho="p"
                              variante="perigo"
                              onClick={() => setLoteCancelarFontes(lote)}
                            >
                              Cancelar
                            </Botao>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </section>
              )}

              {/* Trilha 3: Lotes de Exportação */}
              {!carregandoInicial && !erroPrincipal && lotesExportFiltrados.length > 0 && (
                <section aria-label="Lotes de Exportação" className="flex flex-col gap-2">
                  <h3 className="text-micro font-medio tracking-wide text-t3 uppercase">
                    Lotes de exportação
                  </h3>
                  {lotesExportFiltrados.map((lote) => {
                    const st = statusLoteExport(lote)
                    return (
                      <div key={lote.id} className="flex flex-col gap-2 rounded-area bg-elevado p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <strong className="text-base font-medio text-t1">
                              Exportação em lote #{lote.id}
                            </strong>
                            <span className="ml-2 text-pequeno text-t3">
                              {lote.scope === 'project'
                                ? 'Todo o Projeto'
                                : `Fonte #${lote.sourceId ?? ''}`}
                            </span>
                          </div>
                          <Status tom={st.tom}>{st.texto}</Status>
                        </div>

                        <Progresso
                          valor={lote.progress}
                          rotulo="Progresso da exportação"
                          detalhe={`${lote.counts.completed}/${lote.counts.total} · ${Math.round(lote.progress)}%`}
                        />

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <Botao
                              tamanho="p"
                              variante="fantasma"
                              icone={<ExternalLink />}
                              onClick={() => navegar(`#/projeto/${encProjeto}/exportacao?sub=lotes`)}
                            >
                              Abrir em Exportação
                            </Botao>
                            {lote.outputDir && (
                              <Botao
                                tamanho="p"
                                variante="fantasma"
                                icone={<FolderOpen />}
                                onClick={() => void abrirNoSistema(lote.outputDir)}
                              >
                                Abrir pasta
                              </Botao>
                            )}
                          </div>
                          {lote.state === 'running' && (
                            <Botao
                              tamanho="p"
                              variante="perigo"
                              onClick={() => setLoteCancelarExport(lote)}
                            >
                              Cancelar lote
                            </Botao>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </section>
              )}

              {/* Trilha 4: Operações Globais em memória */}
              {!carregandoInicial && !erroPrincipal && globaisFiltradas.length > 0 && (
                <section aria-label="Operações globais" className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-micro font-medio tracking-wide text-t3 uppercase">
                      Operações globais
                    </h3>
                    <Dica texto="Operações globais ficam apenas na memória desta sessão e não são restauradas após recarregar a janela.">
                      <span className="inline-flex items-center gap-1 text-micro text-t3">
                        <Info className="size-3 stroke-[1.75]" aria-hidden />
                        <span>Em memória nesta sessão</span>
                      </span>
                    </Dica>
                  </div>
                  {globaisFiltradas.map((op) => (
                    <div
                      key={op.id}
                      data-testid={`fila-global-${op.id}`}
                      className="flex flex-col gap-2 rounded-area bg-elevado p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className="truncate text-base font-medio text-t1">
                          {op.mensagem || op.etapa}
                        </strong>
                        <Status
                          tom={
                            op.estado === 'rodando'
                              ? 'rodando'
                              : op.estado === 'concluido'
                                ? 'sucesso'
                                : op.estado === 'falhou'
                                  ? 'perigo'
                                  : 'neutro'
                          }
                        >
                          Global
                        </Status>
                      </div>

                      <Progresso valor={op.percentual} rotulo={op.etapa} />

                      {op.estado === 'rodando' && (
                        <div className="flex justify-end">
                          <Botao
                            tamanho="p"
                            variante="suave"
                            carregando={ocupadoKey === `global:${op.id}`}
                            onClick={() => void cancelarGlobal(op)}
                          >
                            Cancelar
                          </Botao>
                        </div>
                      )}
                    </div>
                  ))}
                </section>
              )}
            </div>
          </AreaRolagem>
        </div>
      </aside>

      {/* Diálogos da Fila */}
      <DialogoTentarDeNovo
        aberto={jobRetry !== null}
        job={jobRetry}
        aoFechar={() => setJobRetry(null)}
        aoConcluir={estadoFila.recarregar}
      />

      <DialogoDescartarJob
        aberto={jobDiscard !== null}
        job={jobDiscard}
        aoFechar={() => setJobDiscard(null)}
        aoConcluir={estadoFila.recarregar}
      />

      <DialogoRefazerJob
        aberto={jobRedo !== null}
        job={jobRedo}
        aoFechar={() => setJobRedo(null)}
        aoConcluir={estadoFila.recarregar}
      />

      <DialogoResultadoJob
        aberto={jobResultado !== null}
        job={jobResultado}
        aoFechar={() => setJobResultado(null)}
      />

      <DialogoOrcamento
        aberto={orcamentoDialogo !== null}
        orcamento={orcamentoDialogo?.item ?? null}
        modoContinuar={orcamentoDialogo?.modoContinuar ?? true}
        aoFechar={() => setOrcamentoDialogo(null)}
        aoConcluir={estadoFila.recarregar}
      />

      <ConfirmDialog
        aberto={jobCancelarPago !== null}
        aoMudarAberto={(prox) => {
          if (!prox && !ocupadoKey) setJobCancelarPago(null)
        }}
        titulo={`Cancelar tarefa #${jobCancelarPago?.id ?? ''}?`}
        descricao="Esta chamada paga já está em andamento. Se o pedido já tiver sido enviado ao Provedor, a tarefa ficará marcada como Resultado incerto para sua decisão."
        rotuloCancelar="Voltar"
        rotuloConfirmar="Cancelar tarefa"
        variante="perigo"
        focoInicial="cancelar"
        ocupado={jobCancelarPago ? ocupadoKey === `job:${jobCancelarPago.id}` : false}
        aoConfirmar={() => {
          if (jobCancelarPago) return cancelarJobPersistido(jobCancelarPago)
        }}
      />

      <ConfirmDialog
        aberto={loteCancelarFontes !== null}
        aoMudarAberto={(prox) => {
          if (!prox && !ocupadoKey) setLoteCancelarFontes(null)
        }}
        titulo={`Cancelar Lote de Fontes #${loteCancelarFontes?.id ?? ''}?`}
        descricao="Itens já concluídos serão preservados; itens pendentes serão cancelados."
        rotuloCancelar="Voltar"
        rotuloConfirmar="Cancelar lote"
        variante="perigo"
        focoInicial="cancelar"
        ocupado={loteCancelarFontes ? ocupadoKey === `batch:${loteCancelarFontes.id}` : false}
        aoConfirmar={() => {
          if (loteCancelarFontes) {
            return acionarControleLoteFontes('batches.cancel', loteCancelarFontes)
          }
        }}
      />

      <ConfirmDialog
        aberto={loteCancelarExport !== null}
        aoMudarAberto={(prox) => {
          if (!prox && !ocupadoKey) setLoteCancelarExport(null)
        }}
        titulo={`Cancelar exportação do lote #${loteCancelarExport?.id ?? ''}?`}
        descricao="Cortes já exportados neste lote serão mantidos na pasta de saída; os restantes serão cancelados."
        rotuloCancelar="Voltar"
        rotuloConfirmar="Cancelar lote"
        variante="perigo"
        focoInicial="cancelar"
        ocupado={loteCancelarExport ? ocupadoKey === `export-batch:${loteCancelarExport.id}` : false}
        aoConfirmar={() => {
          if (loteCancelarExport) {
            return cancelarLoteExportacao(loteCancelarExport)
          }
        }}
      />

      <ConfirmDialog
        aberto={confirmacaoItem !== null}
        aoMudarAberto={(prox) => {
          if (!prox && !ocupadoKey) setConfirmacaoItem(null)
        }}
        titulo={`Retomar ${confirmacaoItem?.item.name ?? 'Fonte'}?`}
        descricao="Retomar este item do Lote de Fontes envolve envio pago ao Provedor."
        rotuloCancelar="Cancelar"
        rotuloConfirmar="Confirmar e retomar"
        focoInicial="cancelar"
        ocupado={
          confirmacaoItem
            ? ocupadoKey === `batch-item:${confirmacaoItem.loteId}:${confirmacaoItem.item.sourceId}`
            : false
        }
        aoConfirmar={() => {
          if (confirmacaoItem) {
            return retomarItemLote(confirmacaoItem.loteId, confirmacaoItem.item, true)
          }
        }}
      >
        {confirmacaoItem && (
          <ResumoCustoPrivacidade
            tarefa={`Retomar ${confirmacaoItem.item.name}`}
            perfil={{
              id: 'provedor-lote',
              label: 'Provedor do lote',
              kind: 'api',
              model: null,
            }}
            localidade="remoto"
            saiDaMaquina
            estimativa={
              confirmacaoItem.estimativa?.kind === 'usd' &&
              typeof confirmacaoItem.estimativa.minMicroUsd === 'number' &&
              typeof confirmacaoItem.estimativa.maxMicroUsd === 'number'
                ? {
                    kind: 'usd',
                    minMicroUsd: confirmacaoItem.estimativa.minMicroUsd,
                    maxMicroUsd: confirmacaoItem.estimativa.maxMicroUsd,
                  }
                : { kind: 'unknown' }
            }
            compacto
          />
        )}
      </ConfirmDialog>
    </>
  )
}
