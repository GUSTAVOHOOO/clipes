import {
  Abas,
  BannerErroCore,
  Botao,
  Campo,
  Checkbox,
  ConfirmDialog,
  Dica,
  Entrada,
  Esqueleto,
  EstadoTela,
  Progresso,
  ResumoCustoPrivacidade,
  SeloTipoVideo,
  Select,
  Status,
  duracao,
  tcLongo,
  usd,
  type OpcaoSelect,
  type TomStatus,
} from '@ds'
import { useEffect, useMemo, useState } from 'react'
import { DialogoResolverIncerteza } from '~/componentes/DialogoResolverIncerteza'
import { SeletorPerfilRedo } from '~/componentes/SeletorPerfilRedo'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila, type Fila, type Job } from '~/core/progresso'
import {
  resolverDestinoSelecao,
  type DetalheExecucaoSelecao,
  type JanelaSelecao,
  type PerfilProvedorLista,
  type RespostaTarefasAssistente,
  type ResumoRunSelecao,
} from '~/stores/selecaoProjeto'

type RunComMeta = ResumoRunSelecao & {
  profile?: string
  createdAt?: string
  summary?: {
    energy?: { measured?: boolean; high?: number; peak?: number }
    chat?: { available?: boolean; peaks?: number; marked?: number }
  }
}

type BudgetRow = {
  scope: 'task' | 'batch'
  key: string
  maxCalls: number | null
  maxCostMicroUsd: number | null
  paused: string | null
  usage: {
    calls: number
    inputTokens: number
    outputTokens: number
    microUsd: number
  }
}

type RespostaEstimativaResume = {
  paid: boolean
  videoKind?: string
  estimate:
    | { kind: 'zero' }
    | { kind: 'plan_quota' }
    | { kind: 'unknown' }
    | { kind: 'usd'; minMicroUsd: number; maxMicroUsd: number; inputTokens?: number; windows?: number }
}

export type AcompanhamentoSelecaoProps = {
  projetoId: string
  fonteId: number
  runs: ResumoRunSelecao[]
  runSelecionadoId: number | null
  revSelecionada?: number
  execucao: DetalheExecucaoSelecao | null
  carregandoRuns: boolean
  carregandoExecucao: boolean
  erroRuns: ErroCore | null
  erroExecucao: ErroCore | null
  fila?: Fila
  aoSelecionarRun: (runId: number) => void
  aoMudarRevisao: (revision: number) => void
  aoFocarDisparar: () => void
  aoRecarregar: () => Promise<void> | void
}

function formatarDataCurta(iso?: string): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function formatarHorarioReset(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms))
  } catch {
    return null
  }
}

function statusRunVisual(state: ResumoRunSelecao['state']): { tom: TomStatus; rotulo: string } {
  switch (state) {
    case 'running':
      return { tom: 'rodando', rotulo: 'Em andamento' }
    case 'partial':
      return { tom: 'aviso', rotulo: 'Parcial' }
    default:
      return { tom: 'sucesso', rotulo: 'Concluída' }
  }
}

function statusJanelaVisual(state: string): { tom: TomStatus; rotulo: string } {
  switch (state) {
    case 'completed':
      return { tom: 'sucesso', rotulo: 'Concluída' }
    case 'running':
      return { tom: 'rodando', rotulo: 'Executando' }
    case 'queued':
      return { tom: 'pendente', rotulo: 'Na fila' }
    case 'failed':
      return { tom: 'perigo', rotulo: 'Falhou' }
    case 'cancelled':
      return { tom: 'neutro', rotulo: 'Cancelada' }
    case 'uncertain':
      return { tom: 'aviso', rotulo: 'Incerta' }
    default:
      return { tom: 'neutro', rotulo: state }
  }
}

function traduzirSubestagio(etapa?: string): string | null {
  if (!etapa) return null
  if (etapa.endsWith(':prepare')) return 'Preparando…'
  if (etapa.endsWith(':call')) return 'Enviando ao Provedor…'
  if (etapa.endsWith(':verify')) return 'Validando resposta…'
  if (etapa.endsWith(':paused')) return 'Pausada'
  return null
}

function rotuloPerfilSelecao(
  profileId: string | null | undefined,
  perfis: readonly PerfilProvedorLista[],
): string | null {
  const limpo = profileId?.trim()
  if (!limpo) return null
  const encontrado = perfis.find((p) => p.id === limpo || p.label === limpo)
  if (encontrado?.label) return encontrado.label
  if (limpo.toLowerCase() === 'legacy') return 'Perfil configurado'
  return limpo
}

function converterEstimativaParaDs(estimate: RespostaEstimativaResume['estimate']) {
  if (estimate.kind === 'usd') {
    return {
      kind: 'usd' as const,
      minMicroUsd: estimate.minMicroUsd,
      maxMicroUsd: estimate.maxMicroUsd,
      inputTokens: estimate.inputTokens,
      janelas: estimate.windows,
    }
  }
  return estimate
}

/**
 * Coluna direita da Tela C.1 (`#/projeto/:id/cortes`): seletor de Execução e Revisão,
 * banners prioritários (incerteza `#290`, orçamento, parcial), resumo da execução,
 * progresso determinístico via `core-progress` e grade responsiva de Janelas de seleção.
 */
export function AcompanhamentoSelecao({
  projetoId,
  fonteId,
  runs,
  runSelecionadoId,
  revSelecionada,
  execucao,
  carregandoRuns,
  carregandoExecucao,
  erroRuns,
  erroExecucao,
  fila: filaProp,
  aoSelecionarRun,
  aoMudarRevisao,
  aoFocarDisparar,
  aoRecarregar,
}: AcompanhamentoSelecaoProps) {
  const jobs = useFila(filaProp)
  const encProjeto = encodeURIComponent(projetoId)

  const [perfis, setPerfis] = useState<PerfilProvedorLista[]>([])
  const [tarefas, setTarefas] = useState<RespostaTarefasAssistente | null>(null)
  const [erroAcao, setErroAcao] = useState<ErroCore | null>(null)
  const [ocupadoAcao, setOcupadoAcao] = useState(false)

  // Diálogos
  const [redoJanelas, setRedoJanelas] = useState<number[] | null>(null)
  const [redoPerfilAtual, setRedoPerfilAtual] = useState<string | null>(null)
  const [incertezaAlvo, setIncertezaAlvo] = useState<{ jobId: number; rotulo: string } | null>(null)
  const [confirmCancelAberta, setConfirmCancelAberta] = useState(false)

  const [resumeConfirm, setResumeConfirm] = useState<RespostaEstimativaResume | null>(null)
  const [budgetDialogAberto, setBudgetDialogAberto] = useState(false)
  const [budgetAtual, setBudgetAtual] = useState<BudgetRow | null>(null)
  const [budgetNovoTetoUsd, setBudgetNovoTetoUsd] = useState('2.00')
  const [budgetUnknownConfirmed, setBudgetUnknownConfirmed] = useState(false)
  const [budgetErro, setBudgetErro] = useState<ErroCore | null>(null)

  useEffect(() => {
    let cancelado = false
    void Promise.all([
      chamar<{ profiles: PerfilProvedorLista[] }>('provider.profiles.list', {}).catch(() => ({
        profiles: [],
      })),
      chamar<RespostaTarefasAssistente>('assistant.tasks', {}).catch(() => null),
    ]).then(([p, t]) => {
      if (cancelado) return
      setPerfis(p?.profiles ?? [])
      setTarefas(t)
    })
    return () => {
      cancelado = true
    }
  }, [projetoId])

  const runsOrdenados = useMemo(
    () => [...runs].sort((a, b) => b.id - a.id),
    [runs],
  )

  const opcoesExecucao = useMemo<OpcaoSelect<string>[]>(
    () =>
      runsOrdenados.map((r) => {
        const meta = r as RunComMeta
        const data = formatarDataCurta(meta.createdAt)
        const tipo = r.videoKind === 'transformed' ? 'Vídeo transformado' : 'Corte direto'
        const cand = r.counts?.kept ?? 0
        return {
          valor: String(r.id),
          rotulo: `#${r.id}${data ? ` · ${data}` : ''} · ${tipo} · ${cand} cand.`,
        }
      }),
    [runsOrdenados],
  )

  const runAtivo = (execucao?.run ?? null) as RunComMeta | null
  const janelas = execucao?.windows ?? []
  const candidatos = execucao?.candidates ?? []

  const jobAgregadorFila = useMemo<Job | undefined>(() => {
    if (!runAtivo) return undefined
    return jobs.find((j) => j.id === `selection-${runAtivo.id}`)
  }, [jobs, runAtivo])

  const janelaIncerta = useMemo(
    () => janelas.find((w) => w.state === 'uncertain' && w.jobId !== null) ?? null,
    [janelas],
  )
  const temIncerta = janelas.some((w) => w.state === 'uncertain')
  const janelasRetomaveis = useMemo(
    () => janelas.filter((w) => w.state === 'failed' || w.state === 'cancelled'),
    [janelas],
  )

  const destinoRun = useMemo(() => {
    const idPerfil = runAtivo?.profile ?? tarefas?.tasks.find((t) => t.task === 'selection')?.profile?.id
    if (!idPerfil) return null
    return resolverDestinoSelecao(idPerfil, perfis, tarefas)
  }, [runAtivo?.profile, perfis, tarefas])

  const renderErro = (erro: ErroCore) => {
    const trad = mensagemDeErro(erro)
    let acaoRecuperacao = trad.recuperacao
      ? {
          rotulo: trad.recuperacao.rotulo,
          aoAcionar: () => {
            if (trad.recuperacao?.rota) {
              window.location.hash = trad.recuperacao.rota
            } else {
              void aoRecarregar()
            }
          },
        }
      : { rotulo: 'Tentar novamente', aoAcionar: () => void aoRecarregar() }

    if (erro.code === 'transcript_incomplete' || erro.code === 'no_sentences') {
      acaoRecuperacao = {
        rotulo: 'Abrir Transcrição',
        aoAcionar: () => {
          window.location.hash = `#/projeto/${encProjeto}/fontes/${fonteId}`
        },
      }
    }

    return (
      <BannerErroCore
        erro={{ code: erro.code, message: erro.detalhe || erro.message }}
        traduzir={() => ({ titulo: trad.titulo })}
        acaoRecuperacao={acaoRecuperacao}
        permitirRelato
      />
    )
  }

  const aoCancelarSelecao = async (jaConfirmado = false) => {
    if (!runAtivo || ocupadoAcao) return
    const temJobPagoEmVoo = Boolean(destinoRun?.saiDaMaquina)
    if (temJobPagoEmVoo && !jaConfirmado) {
      setConfirmCancelAberta(true)
      return
    }
    setErroAcao(null)
    setOcupadoAcao(true)
    try {
      await chamar('selection.cancel', { run: runAtivo.id })
      setConfirmCancelAberta(false)
      await aoRecarregar()
    } catch (err) {
      setErroAcao(paraErroCore(err))
    } finally {
      setOcupadoAcao(false)
    }
  }

  const aoIniciarRetomada = async () => {
    if (!runAtivo || temIncerta || ocupadoAcao) return
    setErroAcao(null)
    setOcupadoAcao(true)
    try {
      const est = await chamar<RespostaEstimativaResume>('selection.estimate', {
        run: runAtivo.id,
      })
      if (est.paid || destinoRun?.localidade === 'cli') {
        setResumeConfirm(est)
        setOcupadoAcao(false)
        return
      }
      await chamar('selection.resume', { run: runAtivo.id, confirmed: false })
      await aoRecarregar()
    } catch (err) {
      setErroAcao(paraErroCore(err))
    } finally {
      setOcupadoAcao(false)
    }
  }

  const aoConfirmarRetomada = async () => {
    if (!runAtivo || ocupadoAcao) return
    setErroAcao(null)
    setOcupadoAcao(true)
    try {
      await chamar('selection.resume', { run: runAtivo.id, confirmed: true })
      setResumeConfirm(null)
      await aoRecarregar()
    } catch (err) {
      setResumeConfirm(null)
      setErroAcao(paraErroCore(err))
    } finally {
      setOcupadoAcao(false)
    }
  }

  const aoRefazerJanelaMesmoPerfil = async (w: JanelaSelecao) => {
    if (!runAtivo || ocupadoAcao) return
    setErroAcao(null)
    setOcupadoAcao(true)
    try {
      await chamar('selection.redo', {
        run: runAtivo.id,
        windows: [w.index],
        confirmed: true,
      })
      await aoRecarregar()
    } catch (err) {
      setErroAcao(paraErroCore(err))
    } finally {
      setOcupadoAcao(false)
    }
  }

  const aoAbrirAjusteOrcamento = async () => {
    setBudgetErro(null)
    setBudgetUnknownConfirmed(false)
    try {
      const resp = await chamar<{ budgets: BudgetRow[] }>('jobs.budget.get', {})
      const item =
        resp?.budgets?.find((b) => b.scope === 'task' && b.key === 'selection') ?? null
      setBudgetAtual(item)
      if (item?.maxCostMicroUsd != null) {
        setBudgetNovoTetoUsd((item.maxCostMicroUsd / 1_000_000).toFixed(2))
      } else {
        setBudgetNovoTetoUsd('2.00')
      }
      setBudgetDialogAberto(true)
    } catch (err) {
      setErroAcao(paraErroCore(err))
    }
  }

  const aoConfirmarOrcamento = async () => {
    if (ocupadoAcao) return
    setBudgetErro(null)
    const valorNum = Number(budgetNovoTetoUsd.replace(',', '.'))
    const maxCostMicroUsd =
      budgetNovoTetoUsd.trim() === ''
        ? undefined
        : Number.isFinite(valorNum) && valorNum >= 0
          ? Math.round(valorNum * 1_000_000)
          : null

    if (maxCostMicroUsd === null) {
      setBudgetErro(new ErroCore('invalid_budget', 'Informe um valor em USD maior ou igual a zero.'))
      return
    }

    setOcupadoAcao(true)
    try {
      await chamar('jobs.budget.continue', {
        scope: 'task',
        key: 'selection',
        ...(maxCostMicroUsd !== undefined ? { maxCostMicroUsd } : {}),
        confirmed: budgetUnknownConfirmed,
      })
      setBudgetDialogAberto(false)
      await aoRecarregar()
    } catch (err) {
      setBudgetErro(paraErroCore(err))
    } finally {
      setOcupadoAcao(false)
    }
  }

  if (carregandoRuns && runs.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <Esqueleto variante="painel" quantidade={1} rotuloAcessivel="Carregando execuções de seleção" />
        <Esqueleto variante="lista" quantidade={4} rotuloAcessivel="Carregando janelas" />
      </div>
    )
  }

  if (erroRuns) {
    return renderErro(erroRuns)
  }

  if (runsOrdenados.length === 0) {
    return (
      <div className="flex min-h-full items-center justify-center rounded-area bg-area p-4">
        <EstadoTela
          tipo="vazio"
          titulo="Nenhuma seleção executada nesta Fonte"
          descricao="Ajuste a duração desejada ao lado e clique em Selecionar Cortes para ver os candidatos e as Notas."
          acaoSecundaria={{
            rotulo: 'Ir para Selecionar Cortes',
            aoAcionar: aoFocarDisparar,
          }}
        />
      </div>
    )
  }

  if (erroExecucao && !runAtivo) {
    return renderErro(erroExecucao)
  }

  if (carregandoExecucao && !runAtivo) {
    return (
      <div className="flex flex-col gap-3">
        <Esqueleto variante="painel" quantidade={1} rotuloAcessivel="Carregando detalhes da execução" />
        <Esqueleto variante="lista" quantidade={4} rotuloAcessivel="Carregando janelas" />
      </div>
    )
  }

  if (!runAtivo) return null

  const revisoes = runAtivo.revisions?.length ? runAtivo.revisions : [runAtivo.revision ?? 1]
  const revisaoAtiva =
    revSelecionada !== undefined && revisoes.includes(revSelecionada)
      ? revSelecionada
      : (runAtivo.revision ?? revisoes[revisoes.length - 1])
  const statusVisual = statusRunVisual(runAtivo.state)

  const totalJanelas = runAtivo.counts?.windows ?? janelas.length
  const janelasConcluidas =
    runAtivo.counts?.completed ?? janelas.filter((w) => w.state === 'completed').length
  const percentualProgresso =
    jobAgregadorFila?.percentual ??
    (totalJanelas > 0 ? Math.round((janelasConcluidas / totalJanelas) * 100) : 0)

  const janelaAtivaFila = (() => {
    for (const w of janelas) {
      if (w.jobId == null) continue
      const j = jobs.find((item) => item.id === String(w.jobId) && item.estado === 'rodando')
      if (j) return { janela: w, job: j }
    }
    return null
  })()
  const estagioAtual =
    traduzirSubestagio(janelaAtivaFila?.job.etapa) ??
    (runAtivo.state === 'running' ? 'Processando Janelas…' : null)

  const energiaResumo = runAtivo.summary?.energy?.measured
    ? `Energia (${runAtivo.summary.energy.high ?? 0} altas, ${runAtivo.summary.energy.peak ?? 0} picos)`
    : null
  const chatResumo = runAtivo.summary?.chat?.available
    ? `Chat (${runAtivo.summary.chat.peaks ?? 0} picos)`
    : null
  const sinaisCongelados = [energiaResumo, chatResumo].filter(Boolean).join(' + ') || 'Apenas Transcrição'

  const precisaConfirmarOrcamentoDesconhecido =
    runAtivo.budgetPause === 'cost_unknown' || budgetAtual?.paused === 'cost_unknown'

  return (
    <div className="flex flex-col gap-3">
      {/* Seletor de Execução e Revisão */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-area bg-area px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-pequeno text-t3">Execução:</span>
          <Select
            rotulo="Execução"
            valor={String(runSelecionadoId ?? runAtivo.id)}
            aoMudar={(v) => aoSelecionarRun(Number(v))}
            opcoes={opcoesExecucao}
            className="min-w-60"
          />
        </div>

        {revisoes.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-pequeno text-t3">Revisão:</span>
            {revisoes.length <= 5 ? (
              <Abas
                rotulo="Revisão da execução"
                tamanho="p"
                valor={String(revisaoAtiva)}
                aoMudar={(v) => aoMudarRevisao(Number(v))}
                abas={revisoes.map((rev, i) => ({
                  valor: String(rev),
                  rotulo: i === revisoes.length - 1 ? `Rev. ${rev} (atual)` : `Rev. ${rev}`,
                }))}
              />
            ) : (
              <Select
                rotulo="Revisão da execução"
                valor={String(revisaoAtiva)}
                aoMudar={(v) => aoMudarRevisao(Number(v))}
                opcoes={revisoes.map((rev, i) => ({
                  valor: String(rev),
                  rotulo: i === revisoes.length - 1 ? `Revisão ${rev} (atual)` : `Revisão ${rev}`,
                }))}
                className="min-w-36"
              />
            )}
            <span role="status" aria-live="polite" className="num sr-only">
              Revisão {revisaoAtiva} de {revisoes.length}
            </span>
          </div>
        )}
      </div>

      {erroAcao && renderErro(erroAcao)}

      {/* Banners prioritários */}
      {temIncerta && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-area bg-area px-3 py-2.5"
        >
          <div className="min-w-0 flex-1">
            <p className="text-base font-forte text-t1">
              Chamada paga incerta — resolva antes de repetir
            </p>
            <p className="text-pequeno text-t2">
              Uma chamada ao Provedor foi interrompida antes da confirmação. Resolva na Fila antes de retomar ou refazer.
            </p>
          </div>
          {janelaIncerta?.jobId != null && (
            <Botao
              tamanho="p"
              variante="secundario"
              onClick={() =>
                setIncertezaAlvo({
                  jobId: janelaIncerta.jobId!,
                  rotulo: `Janela ${janelaIncerta.index + 1}`,
                })
              }
            >
              Resolver na Fila
            </Botao>
          )}
        </div>
      )}

      {runAtivo.budgetPause != null && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-area bg-area px-3 py-2.5"
        >
          <div className="min-w-0 flex-1">
            <p className="text-base font-medio text-t1">Seleção pausada pelo teto de orçamento</p>
            <p className="text-pequeno text-t2">
              {runAtivo.budgetPause === 'cost_unknown'
                ? 'O perfil usado tem custo desconhecido e exige confirmação para continuar.'
                : 'O teto configurado foi atingido durante a seleção.'}
            </p>
          </div>
          <Botao tamanho="p" variante="secundario" onClick={() => void aoAbrirAjusteOrcamento()}>
            Ajustar orçamento e continuar
          </Botao>
        </div>
      )}

      {runAtivo.state === 'partial' && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-area bg-area px-3 py-2"
        >
          <p className="num text-pequeno text-t1">
            Seleção parcial: {janelasConcluidas} de {totalJanelas} Janelas concluídas,{' '}
            {Math.max(0, totalJanelas - janelasConcluidas)} pendente(s).
          </p>
          {temIncerta ? (
            /* Bloqueado enquanto existir janela incerta sem resolução na Fila */
            <Dica texto="Há janela incerta nesta execução; resolva na Fila antes de retomar.">
              <Botao
                tamanho="p"
                variante="secundario"
                aria-disabled="true"
                onClick={(e) => e.preventDefault()}
                className="pointer-events-auto! cursor-not-allowed hover:bg-elevado"
              >
                Retomar janelas pendentes
              </Botao>
            </Dica>
          ) : (
            janelasRetomaveis.length > 0 && (
              <Botao
                tamanho="p"
                variante="secundario"
                carregando={ocupadoAcao}
                onClick={() => void aoIniciarRetomada()}
              >
                Retomar janelas pendentes
              </Botao>
            )
          )}
        </div>
      )}

      {/* Resumo da execução */}
      <section aria-label="Resumo da execução" className="flex flex-col gap-2.5 rounded-area bg-area p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="num text-base font-forte text-t1">Execução #{runAtivo.id}</h2>
            <Status tom={statusVisual.tom} forte>
              {statusVisual.rotulo}
            </Status>
            <SeloTipoVideo tipo={runAtivo.videoKind} />
          </div>
          <span className="num text-pequeno text-t3">
            Faixa: {duracao(runAtivo.minUs)} – {duracao(runAtivo.maxUs)}
            {(() => {
              const perfilBase = rotuloPerfilSelecao(runAtivo.profile, perfis)
              return perfilBase ? ` · Perfil base: ${perfilBase}` : ''
            })()}
          </span>
        </div>

        <p className="num text-pequeno text-t2">
          {candidatos.length} candidatos · {runAtivo.counts?.merged ?? 0} juntados ·{' '}
          {runAtivo.counts?.discarded ?? 0} descartados · Sinais congelados: {sinaisCongelados}
        </p>

        {runAtivo.state === 'running' && (
          <div className="flex flex-col gap-2 rounded-controle bg-elevado px-3 py-2">
            <Progresso
              valor={percentualProgresso}
              rotulo={
                estagioAtual
                  ? `${estagioAtual}${janelaAtivaFila ? ` (Janela ${janelaAtivaFila.janela.index + 1})` : ''}`
                  : 'Selecionando Cortes'
              }
              detalhe={`${janelasConcluidas} de ${totalJanelas} Janelas concluídas (${Math.round(percentualProgresso)}%)`}
            />
            <div className="flex justify-end">
              <Botao
                tamanho="p"
                variante="perigo"
                carregando={ocupadoAcao}
                onClick={() => void aoCancelarSelecao(false)}
              >
                Cancelar seleção
              </Botao>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Botao
            variante="secundario"
            disabled={candidatos.length === 0}
            onClick={() => {
              window.location.hash = `#/projeto/${encProjeto}/cortes/revisao/${runAtivo.id}?rev=${revisaoAtiva}`
            }}
          >
            Abrir bancada de revisão ({candidatos.length})
          </Botao>

          {janelas.length > 0 && runAtivo.state !== 'running' && !temIncerta && (
            <Botao
              variante="fantasma"
              tamanho="p"
              onClick={() => {
                setRedoPerfilAtual(runAtivo.profile ?? null)
                setRedoJanelas(janelas.map((w) => w.index))
              }}
            >
              Refazer com outro Perfil…
            </Botao>
          )}
        </div>
      </section>

      {runAtivo.state === 'completed' && candidatos.length === 0 && (
        <div className="rounded-area bg-area p-2">
          <EstadoTela
            tipo="vazio"
            titulo="Nenhum Corte encontrado nesta seleção"
            descricao="O Provedor não encontrou trechos dentro dos critérios e da faixa de duração. Tente ampliar a faixa ou refazer com outro Perfil."
            acaoSecundaria={{
              rotulo: 'Refazer com outro Perfil',
              aoAcionar: () => {
                setRedoPerfilAtual(runAtivo.profile ?? null)
                setRedoJanelas(janelas.map((w) => w.index))
              },
            }}
          />
        </div>
      )}

      {/* Grade de Janelas de seleção */}
      <section aria-label="Janelas de seleção" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="num text-pequeno font-medio text-t2">
            Janelas de seleção ({janelas.length})
          </h3>
          <span className="num text-pequeno text-t3">Sobreposição: 60 s</span>
        </div>

        <ul
          role="list"
          className="m-0 grid list-none grid-cols-1 gap-2 p-0 min-[1440px]:grid-cols-2"
        >
          {janelas.map((w) => {
            const visual = statusJanelaVisual(w.state)
            const jobJanela =
              w.jobId != null ? jobs.find((j) => j.id === String(w.jobId)) : undefined
            const subestagio =
              w.state === 'running' || jobJanela?.estado === 'rodando'
                ? traduzirSubestagio(jobJanela?.etapa)
                : null
            const erroJanela =
              w.code && (w.state === 'failed' || w.state === 'cancelled' || w.state === 'uncertain')
                ? mensagemDeErro(new ErroCore(w.code, ''))
                : null
            const horarioReset =
              w.code === 'provider_daily_limit' ? formatarHorarioReset(w.resetAtMs) : null
            const elegivelRedo =
              w.state !== 'queued' && w.state !== 'running' && w.state !== 'uncertain'

            return (
              <li
                key={w.index}
                aria-label={`Janela ${w.index + 1}, de ${tcLongo(w.startUs)} a ${tcLongo(w.endUs)}, ${visual.rotulo}`}
                className="flex flex-col gap-2 rounded-area bg-area p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="num text-pequeno font-forte text-t1">
                      Janela {w.index + 1}
                    </span>
                    <span className="num text-pequeno text-t3">
                      {tcLongo(w.startUs)} – {tcLongo(w.endUs)}
                    </span>
                  </div>
                  <Status tom={visual.tom}>
                    {visual.rotulo}
                    {subestagio ? ` · ${subestagio}` : ''}
                  </Status>
                </div>

                {erroJanela && (
                  <p className={w.state === 'cancelled' ? 'text-pequeno text-t3' : 'text-pequeno text-erro'}>
                    {erroJanela.titulo}
                    {horarioReset ? ` (retoma às ${horarioReset})` : ''}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 text-pequeno text-t3">
                  <span>Perfil: {rotuloPerfilSelecao(w.profile || runAtivo.profile, perfis) ?? '—'}</span>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {(w.state === 'failed' || w.state === 'cancelled') && (
                      <Botao
                        tamanho="p"
                        variante="secundario"
                        disabled={temIncerta || ocupadoAcao}
                        onClick={() => void aoRefazerJanelaMesmoPerfil(w)}
                      >
                        Refazer janela
                      </Botao>
                    )}

                    {elegivelRedo && (
                      <Botao
                        tamanho="p"
                        variante="fantasma"
                        disabled={temIncerta}
                        onClick={() => {
                          setRedoPerfilAtual(w.profile || runAtivo.profile || null)
                          setRedoJanelas([w.index])
                        }}
                      >
                        Refazer com outro Perfil
                      </Botao>
                    )}

                    {w.state === 'uncertain' && w.jobId != null && (
                      <Botao
                        tamanho="p"
                        variante="secundario"
                        onClick={() =>
                          setIncertezaAlvo({
                            jobId: w.jobId!,
                            rotulo: `Janela ${w.index + 1}`,
                          })
                        }
                      >
                        Resolver incerteza
                      </Botao>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      {/* Diálogo: Refazer com outro Perfil (#304) */}
      <SeletorPerfilRedo
        aberto={redoJanelas !== null}
        run={runAtivo.id}
        windows={redoJanelas ?? []}
        perfilAtual={redoPerfilAtual}
        aoFechar={() => setRedoJanelas(null)}
        aoConcluir={() => void aoRecarregar()}
      />

      {/* Diálogo: Resolver incerteza */}
      <DialogoResolverIncerteza
        aberto={incertezaAlvo !== null}
        jobId={incertezaAlvo?.jobId ?? 0}
        rotuloJanela={incertezaAlvo?.rotulo}
        aoFechar={() => setIncertezaAlvo(null)}
        aoResolver={() => void aoRecarregar()}
      />

      {/* Diálogo: Cancelar seleção paga em andamento */}
      <ConfirmDialog
        aberto={confirmCancelAberta}
        aoMudarAberto={(aberto) => {
          if (!ocupadoAcao) setConfirmCancelAberta(aberto)
        }}
        titulo="Cancelar seleção em andamento"
        descricao="Chamada já enviada ao Provedor pode ficar como incerta e exigir confirmação na Fila antes de repetir."
        rotuloCancelar="Voltar"
        rotuloConfirmar="Cancelar seleção"
        variante="perigo"
        focoInicial="cancelar"
        ocupado={ocupadoAcao}
        aoConfirmar={() => void aoCancelarSelecao(true)}
      />

      {/* Diálogo: Retomar janelas pendentes (Modo 2 pago/CLI) */}
      <ConfirmDialog
        aberto={resumeConfirm !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto && !ocupadoAcao) setResumeConfirm(null)
        }}
        titulo="Retomar janelas pendentes"
        descricao="Apenas as Janelas que falharam ou foram canceladas serão processadas novamente."
        rotuloCancelar="Cancelar"
        rotuloConfirmar="Retomar janelas"
        focoInicial="cancelar"
        ocupado={ocupadoAcao}
        aoConfirmar={() => void aoConfirmarRetomada()}
      >
        {resumeConfirm && destinoRun && (
          <ResumoCustoPrivacidade
            tarefa={`Retomar ${janelasRetomaveis.length} Janela(s)`}
            perfil={destinoRun.perfil}
            localidade={destinoRun.localidade}
            saiDaMaquina={destinoRun.saiDaMaquina}
            host={destinoRun.host}
            estimativa={converterEstimativaParaDs(resumeConfirm.estimate)}
            compacto
          />
        )}
      </ConfirmDialog>

      {/* Diálogo: Ajustar orçamento e continuar */}
      <ConfirmDialog
        aberto={budgetDialogAberto}
        aoMudarAberto={(aberto) => {
          if (!ocupadoAcao) setBudgetDialogAberto(aberto)
        }}
        titulo="Ajustar orçamento e continuar"
        descricao="Atualize o teto de gasto da tarefa de seleção para destravar as Janelas na fila."
        rotuloCancelar="Cancelar"
        rotuloConfirmar="Continuar execução"
        focoInicial="cancelar"
        ocupado={ocupadoAcao}
        confirmarDesabilitado={precisaConfirmarOrcamentoDesconhecido && !budgetUnknownConfirmed}
        aoConfirmar={() => void aoConfirmarOrcamento()}
      >
        <div className="flex flex-col gap-3">
          {budgetAtual && (
            <p className="num text-pequeno text-t2">
              Consumo atual: {usd(budgetAtual.usage.microUsd)} em {budgetAtual.usage.calls} chamada(s)
              {budgetAtual.maxCostMicroUsd != null
                ? ` · Teto atual: ${usd(budgetAtual.maxCostMicroUsd)}`
                : ''}
            </p>
          )}

          <Campo rotulo="Novo teto de custo (USD)">
            {(props) => (
              <Entrada
                {...props}
                type="number"
                step="0.10"
                min="0"
                value={budgetNovoTetoUsd}
                onChange={(e) => setBudgetNovoTetoUsd(e.target.value)}
                className="num"
              />
            )}
          </Campo>

          {precisaConfirmarOrcamentoDesconhecido && (
            <Checkbox
              marcado={budgetUnknownConfirmed}
              aoMudar={setBudgetUnknownConfirmed}
              className="text-pequeno"
            >
              Entendo que o custo deste perfil é desconhecido e desejo continuar mesmo assim
            </Checkbox>
          )}

          {budgetErro && (
            <BannerErroCore
              erro={{ code: budgetErro.code, message: budgetErro.detalhe || budgetErro.message }}
              traduzir={(code) => mensagemDeErro(new ErroCore(code, budgetErro.detalhe))}
            />
          )}
        </div>
      </ConfirmDialog>
    </div>
  )
}
