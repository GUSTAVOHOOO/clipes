import {
  BannerErroCore,
  Botao,
  Campo,
  Checkbox,
  ConfirmDialog,
  Dica,
  Dialogo,
  Entrada,
  Esqueleto,
  ResumoCustoPrivacidade,
  Select,
  Status,
  usd,
  type OpcaoSelect,
} from '@ds'
import { AlertTriangle, Info, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import type { JobPersistido, OrcamentoItem } from '~/stores/filaGlobal'
import {
  resolverDestinoSelecao,
  type PerfilProvedorLista,
  type RespostaTarefasAssistente,
} from '~/stores/selecaoProjeto'

const NOMES_KIND: Record<string, string> = {
  preview: 'Onda e miniaturas',
  proxy: 'Proxy de vídeo',
  transcription: 'Transcrição',
  energy: 'Energia do áudio',
  chat: 'Replay de chat',
  reframe: 'Reenquadramento 9:16',
  narration: 'Narração (TTS)',
  narration_align: 'Alinhamento da Narração',
  narration_import: 'Importação de Narração',
  export: 'Exportação de Corte',
  'ai:selection': 'Seleção de Cortes',
  'ai:selection_transformed': 'Seleção de Cortes',
  'ai:angles': 'Sugestão de ângulos',
  'ai:script': 'Roteiro',
  'ai:script_block': 'Roteiro',
  'ai:packaging': 'Empacotamento',
  'ai:thumbnail': 'Ideia de capa',
  'ai:translation': 'Tradução de legenda',
}

/** Converte `kind` técnico do núcleo para rótulo canônico em PT-BR. */
export function nomeHumanoKind(kind: string): string {
  return NOMES_KIND[kind] ?? kind
}

const MOTIVOS_PAUSA: Record<string, string> = {
  budget_cost: 'Teto de custo atingido',
  budget_calls: 'Teto de chamadas atingido',
  budget_tokens: 'Teto de tokens atingido',
  time_budget_exhausted: 'Tempo limite atingido',
  cost_unknown: 'Provedor sem preço conhecido — exige confirmação',
  user: 'Pausado manualmente',
}

/** Traduz código de pausa de orçamento para rótulo humano em PT-BR. */
export function traduzirMotivoPausa(paused: string | null | undefined): string {
  if (!paused) return 'Ativo'
  return MOTIVOS_PAUSA[paused] ?? paused
}

const NOMES_TAREFA_ORCAMENTO: Record<string, string> = {
  selection: 'Seleção de Cortes',
  angles: 'Sugestão de ângulos',
  script: 'Roteiro',
  packaging: 'Empacotamento',
  thumbnail: 'Ideia de capa',
  translation: 'Tradução de legenda',
}

/** Traduz chave de escopo de orçamento (`task:selection`, `batch:sources-3`). */
export function rotuloEscopoOrcamento(orc: Pick<OrcamentoItem, 'scope' | 'key'>): string {
  if (orc.scope === 'task') {
    return `Tarefa: ${NOMES_TAREFA_ORCAMENTO[orc.key] ?? orc.key}`
  }
  return `Lote: ${orc.key}`
}

function traduzirBannerErro(erro: ErroCore) {
  return (code: string) => {
    const trad = mensagemDeErro(new ErroCore(code, erro.detalhe))
    return {
      titulo: trad.titulo,
      explicacao: erro.detalhe && erro.detalhe !== trad.titulo ? erro.detalhe : undefined,
    }
  }
}

type EstimativaBruta =
  | { kind: 'zero' }
  | { kind: 'plan_quota' }
  | { kind: 'unknown' }
  | { kind: 'usd'; minMicroUsd: number; maxMicroUsd: number; inputTokens?: number; windows?: number }

function converterEstimativaParaDs(estimate: EstimativaBruta) {
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

function rotuloPerfilVisivel(label: string | null | undefined, id?: string | null): string {
  const texto = (label ?? '').trim()
  if (texto && texto.toLowerCase() !== 'legacy') return texto
  if (id && id.trim().toLowerCase() === 'legacy') return 'Perfil configurado'
  const idLimpo = (id ?? '').trim()
  return idLimpo && idLimpo.toLowerCase() !== 'legacy' ? idLimpo : 'Perfil configurado'
}

function taskKeyDeKind(kind: string): string {
  if (!kind.startsWith('ai:')) return ''
  return kind.slice(3).split('_')[0] ?? ''
}

/* ---------- 1. Tentar de novo (jobs.estimate -> jobs.retry) ---------- */

type RespostaEstimativaJob = {
  safety: 'local' | 'paid' | 'free' | string
  estimate: EstimativaBruta
}

export type DialogoTentarDeNovoProps = {
  aberto: boolean
  job: JobPersistido | null
  aoFechar: () => void
  aoConcluir?: () => Promise<void> | void
}

/** Diálogo para estimar e repetir um job `uncertain`, exigindo `confirmed: true` quando pago. */
export function DialogoTentarDeNovo({ aberto, job, aoFechar, aoConcluir }: DialogoTentarDeNovoProps) {
  const [estimativa, setEstimativa] = useState<RespostaEstimativaJob | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<ErroCore | null>(null)
  const houveErroRef = useRef(false)

  useEffect(() => {
    if (!aberto || !job) {
      houveErroRef.current = false
      return
    }
    let cancelado = false
    setErro(null)
    setEstimativa(null)
    setCarregando(true)

    void chamar<RespostaEstimativaJob>('jobs.estimate', { id: job.id })
      .then((res) => {
        if (cancelado) return
        setEstimativa(res)
        setCarregando(false)
      })
      .catch((err) => {
        if (cancelado) return
        setErro(paraErroCore(err))
        setCarregando(false)
      })

    return () => {
      cancelado = true
    }
  }, [aberto, job])

  if (!job) return null

  const ehPago = estimativa ? estimativa.safety === 'paid' : job.safety === 'paid'
  const ehCli = job.profile === 'codex' || job.profile === 'claude' || job.profile === 'opencode'

  const confirmar = async () => {
    if (enviando) return
    setErro(null)
    setEnviando(true)
    houveErroRef.current = false

    try {
      await chamar('jobs.retry', ehPago ? { id: job.id, confirmed: true } : { id: job.id })
      setEnviando(false)
      await aoConcluir?.()
      aoFechar()
    } catch (err) {
      houveErroRef.current = true
      setErro(paraErroCore(err))
      setEnviando(false)
    }
  }

  return (
    <ConfirmDialog
      aberto={aberto}
      aoMudarAberto={(proximo) => {
        if (proximo) return
        if (houveErroRef.current) {
          houveErroRef.current = false
          return
        }
        if (!enviando) aoFechar()
      }}
      titulo={`Repetir tarefa #${job.id} — ${nomeHumanoKind(job.kind)}`}
      descricao="A tentativa anterior foi interrompida antes da confirmação. Confira a estimativa antes de reenviar."
      rotuloCancelar="Cancelar"
      rotuloConfirmar="Repetir tentativa"
      confirmarDesabilitado={carregando || !estimativa || enviando}
      ocupado={enviando}
      focoInicial="cancelar"
      aoConfirmar={confirmar}
    >
      <div className="flex flex-col gap-3">
        {carregando && (
          <Esqueleto variante="linha" quantidade={2} rotuloAcessivel="Estimando custo da tentativa" />
        )}

        {erro && (
          <BannerErroCore
            erro={{ code: erro.code, message: erro.detalhe || erro.message }}
            traduzir={traduzirBannerErro(erro)}
          />
        )}

        {estimativa && !carregando && (
          <ResumoCustoPrivacidade
            tarefa={`Repetir ${nomeHumanoKind(job.kind)}`}
            perfil={{
              id: job.profile ?? (ehPago ? 'provedor' : 'local'),
              label: ehPago
                ? rotuloPerfilVisivel(job.profile, job.profile)
                : 'Processamento local',
              kind: !ehPago ? 'local' : ehCli ? 'cli' : 'api',
              model: null,
            }}
            localidade={!ehPago ? 'local' : ehCli ? 'cli' : 'remoto'}
            saiDaMaquina={ehPago}
            estimativa={converterEstimativaParaDs(estimativa.estimate)}
            compacto
          />
        )}

        {ehPago && !carregando && (
          <p className="text-pequeno text-t2">
            Repetir uma chamada paga incerta pode gerar nova cobrança se o pedido anterior já tiver sido processado pelo Provedor.
          </p>
        )}
      </div>
    </ConfirmDialog>
  )
}

/* ---------- 2. Descartar (jobs.discard) ---------- */

export type DialogoDescartarJobProps = {
  aberto: boolean
  job: JobPersistido | null
  aoFechar: () => void
  aoConcluir?: () => Promise<void> | void
}

/** Confirmação para descartar um job `uncertain` sem reenviar ao Provedor. */
export function DialogoDescartarJob({ aberto, job, aoFechar, aoConcluir }: DialogoDescartarJobProps) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<ErroCore | null>(null)
  const houveErroRef = useRef(false)

  useEffect(() => {
    if (!aberto) {
      setErro(null)
      houveErroRef.current = false
    }
  }, [aberto, job])

  if (!job) return null

  const confirmar = async () => {
    if (enviando) return
    setErro(null)
    setEnviando(true)
    houveErroRef.current = false
    try {
      await chamar('jobs.discard', { id: job.id })
      setEnviando(false)
      await aoConcluir?.()
      aoFechar()
    } catch (err) {
      houveErroRef.current = true
      setErro(paraErroCore(err))
      setEnviando(false)
    }
  }

  return (
    <ConfirmDialog
      aberto={aberto}
      aoMudarAberto={(proximo) => {
        if (proximo) return
        if (houveErroRef.current) {
          houveErroRef.current = false
          return
        }
        if (!enviando) aoFechar()
      }}
      titulo={`Descartar chamada incerta #${job.id}?`}
      descricao="O job será marcado como cancelado e não será reenviado ao Provedor."
      rotuloCancelar="Cancelar"
      rotuloConfirmar="Descartar"
      variante="perigo"
      ocupado={enviando}
      focoInicial="cancelar"
      aoConfirmar={confirmar}
    >
      {erro && (
        <BannerErroCore
          erro={{ code: erro.code, message: erro.detalhe || erro.message }}
          traduzir={traduzirBannerErro(erro)}
        />
      )}
    </ConfirmDialog>
  )
}

/* ---------- 3. Refazer com outro Perfil (jobs.redo.estimate -> jobs.redo) ---------- */

type RespostaEstimativaRedoJob = {
  profile: {
    id: string
    label: string
    kind: string
    model: string | null
  }
  paid: boolean
  leavesMachine: boolean
  estimate: EstimativaBruta
}

export type DialogoRefazerJobProps = {
  aberto: boolean
  job: JobPersistido | null
  aoFechar: () => void
  aoConcluir?: () => Promise<void> | void
}

/** Diálogo para refazer um job `ai:*` com outro Perfil de Provedor, respeitando `Somente local` e `#304`. */
export function DialogoRefazerJob({ aberto, job, aoFechar, aoConcluir }: DialogoRefazerJobProps) {
  const [perfis, setPerfis] = useState<PerfilProvedorLista[]>([])
  const [tarefas, setTarefas] = useState<RespostaTarefasAssistente | null>(null)
  const [vetoProjeto, setVetoProjeto] = useState(false)
  const [perfilSelecionado, setPerfilSelecionado] = useState<string | null>(null)
  const [estimativa, setEstimativa] = useState<RespostaEstimativaRedoJob | null>(null)
  const [carregandoPerfis, setCarregandoPerfis] = useState(false)
  const [carregandoEstimativa, setCarregandoEstimativa] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<ErroCore | null>(null)
  const houveErroRef = useRef(false)

  useEffect(() => {
    if (!aberto || !job) {
      houveErroRef.current = false
      return
    }
    let cancelado = false
    setErro(null)
    setEstimativa(null)
    setCarregandoPerfis(true)

    void Promise.all([
      chamar<{ profiles: PerfilProvedorLista[] }>('provider.profiles.list', {}),
      chamar<{ enabled?: boolean }>('projects.local_only.get', {}).catch(() => null),
      chamar<RespostaTarefasAssistente>('assistant.tasks', {}).catch(() => null),
    ])
      .then(([listaResp, localOnlyResp, tarefasResp]) => {
        if (cancelado) return
        const lista = listaResp?.profiles ?? []
        setPerfis(lista)
        setTarefas(tarefasResp ?? null)
        setVetoProjeto(Boolean(localOnlyResp?.enabled) || Boolean(tarefasResp?.projectLocalOnly))

        const diferente = lista.find((p) => p.id !== job.profile) ?? lista[0]
        setPerfilSelecionado(diferente?.id ?? null)
        setCarregandoPerfis(false)
      })
      .catch((err) => {
        if (cancelado) return
        setErro(paraErroCore(err))
        setCarregandoPerfis(false)
      })

    return () => {
      cancelado = true
    }
  }, [aberto, job])

  useEffect(() => {
    if (!aberto || !job || !perfilSelecionado) {
      setEstimativa(null)
      return
    }
    let cancelado = false
    setErro(null)
    setCarregandoEstimativa(true)

    void chamar<RespostaEstimativaRedoJob>('jobs.redo.estimate', {
      id: job.id,
      profileId: perfilSelecionado,
    })
      .then((res) => {
        if (cancelado) return
        setEstimativa(res)
        setCarregandoEstimativa(false)
      })
      .catch((err) => {
        if (cancelado) return
        setEstimativa(null)
        setErro(paraErroCore(err))
        setCarregandoEstimativa(false)
      })

    return () => {
      cancelado = true
    }
  }, [aberto, job, perfilSelecionado])

  const opcoesSelect = useMemo<OpcaoSelect<string>[]>(
    () =>
      perfis.map((p) => ({
        valor: p.id,
        rotulo: rotuloPerfilVisivel(p.label, p.id),
        descricao: p.model ? `${p.local ? 'Local' : p.cli ? 'CLI' : 'Remoto'} · ${p.model}` : undefined,
      })),
    [perfis],
  )

  const destino = useMemo(() => {
    if (!perfilSelecionado) return null
    return resolverDestinoSelecao(perfilSelecionado, perfis, tarefas)
  }, [perfilSelecionado, perfis, tarefas])

  if (!job) return null

  const taskKey = taskKeyDeKind(job.kind)
  const tarefaLocalOnly = Boolean(tarefas?.tasks.find((t) => t.task === taskKey)?.localOnly)
  const bloqueadoPorSomenteLocal =
    erro?.code === 'local_only_violation' ||
    Boolean((vetoProjeto || tarefaLocalOnly) && (estimativa?.leavesMachine || destino?.saiDaMaquina))

  const bloqueado = bloqueadoPorSomenteLocal || Boolean(erro)
  const ehSelecao = job.kind.startsWith('ai:selection')

  const confirmar = async () => {
    if (!perfilSelecionado || enviando || bloqueado) return
    setErro(null)
    setEnviando(true)
    houveErroRef.current = false
    try {
      await chamar('jobs.redo', {
        id: job.id,
        profileId: perfilSelecionado,
        confirmed: true,
      })
      setEnviando(false)
      await aoConcluir?.()
      aoFechar()
    } catch (err) {
      houveErroRef.current = true
      setErro(paraErroCore(err))
      setEnviando(false)
    }
  }

  return (
    <ConfirmDialog
      aberto={aberto}
      aoMudarAberto={(proximo) => {
        if (proximo) return
        if (houveErroRef.current) {
          houveErroRef.current = false
          return
        }
        if (!enviando) aoFechar()
      }}
      titulo={`Refazer job #${job.id} com outro Perfil`}
      descricao={`Cria um novo job para "${nomeHumanoKind(job.kind)}" mantendo o histórico do anterior.`}
      rotuloCancelar="Cancelar"
      rotuloConfirmar="Confirmar e enfileirar"
      confirmarDesabilitado={
        carregandoPerfis ||
        carregandoEstimativa ||
        !perfilSelecionado ||
        !estimativa ||
        bloqueado
      }
      ocupado={enviando}
      focoInicial="cancelar"
      aoConfirmar={confirmar}
    >
      <div className="flex flex-col gap-3">
        {carregandoPerfis ? (
          <Esqueleto variante="formulario" quantidade={2} rotuloAcessivel="Carregando Perfis de Provedor" />
        ) : perfis.length === 0 ? (
          <p className="text-pequeno text-t3">
            Nenhum Perfil de Provedor disponível. Configure um Perfil em Configurações → Provedores.
          </p>
        ) : (
          <Select
            rotulo="Escolha o Perfil de Provedor"
            valor={perfilSelecionado}
            aoMudar={(novoId) => setPerfilSelecionado(novoId)}
            opcoes={opcoesSelect}
            placeholder="Escolha um Perfil"
            desabilitado={enviando}
          />
        )}

        {carregandoEstimativa && (
          <Esqueleto variante="linha" quantidade={2} rotuloAcessivel="Estimando custo para refazer" />
        )}

        {bloqueadoPorSomenteLocal && (
          <div role="alert" className="flex items-start gap-2 rounded-area bg-area px-3 py-2.5 text-pequeno text-t1">
            <ShieldAlert className="mt-0.5 size-[15px] shrink-0 stroke-[1.75] text-erro" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medio text-t1">Bloqueado pelo modo Somente local</p>
              <p className="text-t2">
                Este Perfil envia texto para fora da máquina. Escolha um Perfil local (loopback) ou ajuste o veto em Configurações.
              </p>
            </div>
          </div>
        )}

        {erro && erro.code !== 'local_only_violation' && (
          <BannerErroCore
            erro={{ code: erro.code, message: erro.detalhe || erro.message }}
            traduzir={traduzirBannerErro(erro)}
          />
        )}

        {estimativa && destino && !carregandoEstimativa && (
          <ResumoCustoPrivacidade
            tarefa={`Refazer ${nomeHumanoKind(job.kind)}`}
            perfil={{
              ...destino.perfil,
              label: rotuloPerfilVisivel(estimativa.profile.label, estimativa.profile.id),
              model: estimativa.profile.model ?? destino.perfil.model,
            }}
            localidade={destino.localidade}
            saiDaMaquina={estimativa.leavesMachine}
            host={destino.host}
            estimativa={converterEstimativaParaDs(estimativa.estimate)}
            bloqueadoSomenteLocal={bloqueadoPorSomenteLocal}
          />
        )}

        {ehSelecao && (
          <div className="flex items-start gap-2 rounded-area bg-area px-3 py-2 text-pequeno text-t2">
            <Dica texto="Refazer pela Fila não cria nova Revisão na Bancada (#304); para nova Revisão, use Cortes → Revisão.">
              <button
                type="button"
                aria-label="Aviso sobre Revisão da execução (#304)"
                className="foco mt-0.5 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-controle border-0 bg-transparent text-t3 hover:text-t1"
              >
                <Info className="size-[14px] stroke-[1.75]" aria-hidden />
              </button>
            </Dica>
            <span>
              Refazer pela Fila não cria nova Revisão na Bancada (#304); para nova Revisão, use Cortes → Revisão.
            </span>
          </div>
        )}
      </div>
    </ConfirmDialog>
  )
}

/* ---------- 4. Resultado do job (jobs.result) ---------- */

type RespostaResultadoJob = {
  outcome: string
  code?: string | null
  cost?: string | null
  calls?: number
  usage?: {
    inputTokens?: number
    outputTokens?: number
    calls?: number
    costKind?: string
    microUsd?: number | null
    durationMs?: number
  } | null
  data?: unknown
  violations?: Array<{ code?: string; message?: string }>
}

export type DialogoResultadoJobProps = {
  aberto: boolean
  job: JobPersistido | null
  aoFechar: () => void
}

function formatarCustoResultado(res: RespostaResultadoJob): string {
  if (res.usage?.costKind === 'plan_quota' || res.cost === 'consome a cota do plano') {
    return 'Consome a cota do plano'
  }
  if (typeof res.usage?.microUsd === 'number') {
    return usd(res.usage.microUsd)
  }
  if (res.cost === 'unknown') return 'Custo desconhecido'
  if (res.cost) return res.cost.startsWith('US$') ? res.cost : `US$ ${res.cost}`
  return 'US$ 0,00'
}

/** Exibe desfecho, consumo, custo real e resumo de resultado (`jobs.result`) com JSON completo recolhido. */
export function DialogoResultadoJob({ aberto, job, aoFechar }: DialogoResultadoJobProps) {
  const [resultado, setResultado] = useState<RespostaResultadoJob | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<ErroCore | null>(null)

  useEffect(() => {
    if (!aberto || !job) return
    let cancelado = false
    setErro(null)
    setResultado(null)
    setCarregando(true)

    void chamar<RespostaResultadoJob | null>('jobs.result', { id: job.id })
      .then((res) => {
        if (cancelado) return
        setResultado(res ?? null)
        setCarregando(false)
      })
      .catch((err) => {
        if (cancelado) return
        setErro(paraErroCore(err))
        setCarregando(false)
      })

    return () => {
      cancelado = true
    }
  }, [aberto, job])

  if (!job) return null

  return (
    <Dialogo
      aberto={aberto}
      aoMudarAberto={(proximo) => {
        if (!proximo) aoFechar()
      }}
      titulo={`Resultado do job #${job.id} — ${nomeHumanoKind(job.kind)}`}
      largura={540}
      rodape={
        <Botao variante="primario" onClick={aoFechar}>
          Fechar
        </Botao>
      }
    >
      <div className="flex flex-col gap-3">
        {carregando && (
          <Esqueleto variante="formulario" quantidade={3} rotuloAcessivel="Carregando resultado do job" />
        )}

        {erro && (
          <BannerErroCore
            erro={{ code: erro.code, message: erro.detalhe || erro.message }}
            traduzir={traduzirBannerErro(erro)}
          />
        )}

        {!carregando && !erro && !resultado && (
          <p className="text-pequeno text-t3">Nenhum resultado estruturado salvo para este job.</p>
        )}

        {!carregando && resultado && (
          <>
            <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 rounded-area bg-area p-3 text-pequeno">
              <dt className="text-t3">Desfecho</dt>
              <dd className="m-0 font-medio text-t1">
                {resultado.outcome === 'ok'
                  ? 'Sucesso (ok)'
                  : `${resultado.outcome}${resultado.code && resultado.code !== resultado.outcome ? ` (${resultado.code})` : ''}`}
              </dd>

              {job.profile && (
                <>
                  <dt className="text-t3">Perfil</dt>
                  <dd className="m-0 text-t1">{rotuloPerfilVisivel(job.profile, job.profile)}</dd>
                </>
              )}

              {resultado.usage && (
                <>
                  <dt className="text-t3">Consumo</dt>
                  <dd className="num m-0 text-t1">
                    {(resultado.usage.inputTokens ?? 0).toLocaleString('pt-BR')} entrada +{' '}
                    {(resultado.usage.outputTokens ?? 0).toLocaleString('pt-BR')} saída (
                    {resultado.usage.calls ?? resultado.calls ?? 1}{' '}
                    {(resultado.usage.calls ?? resultado.calls ?? 1) === 1 ? 'chamada' : 'chamadas'})
                  </dd>
                </>
              )}

              <dt className="text-t3">Custo real</dt>
              <dd className="num m-0 font-medio text-t1">{formatarCustoResultado(resultado)}</dd>
            </dl>

            {resultado.violations && resultado.violations.length > 0 && (
              <div role="alert" className="flex flex-col gap-1 rounded-area bg-area p-3 text-pequeno">
                <span className="font-medio text-erro">Violações de validação</span>
                <ul className="m-0 list-disc pl-4 text-t2">
                  {resultado.violations.map((v, i) => (
                    <li key={i}>
                      {v.message || v.code || 'Resposta fora do formato esperado.'}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {resultado.data != null && (
              <div className="flex flex-col gap-1">
                <span className="text-pequeno text-t2">Resumo da saída</span>
                <p className="rounded-area bg-area p-2.5 text-pequeno text-t1">
                  {typeof resultado.data === 'object'
                    ? `Saída estruturada disponível (${Object.keys(resultado.data as Record<string, unknown>).join(', ') || 'objeto'}).`
                    : String(resultado.data)}
                </p>
              </div>
            )}

            <details className="text-pequeno text-t3">
              <summary className="inline-flex min-h-6 cursor-pointer items-center rounded-controle hover:text-t1">
                Expandir JSON completo
              </summary>
              <pre
                tabIndex={0}
                className="foco mt-2 max-h-48 overflow-auto rounded-area bg-chao p-2.5 font-mono text-micro text-t2"
              >
                {JSON.stringify(resultado, null, 2)}
              </pre>
            </details>
          </>
        )}
      </div>
    </Dialogo>
  )
}

/* ---------- 5. Ajustar orçamento e continuar (jobs.budget.set / continue) ---------- */

export type DialogoOrcamentoProps = {
  aberto: boolean
  orcamento: OrcamentoItem | null
  modoContinuar?: boolean
  aoFechar: () => void
  aoConcluir?: () => Promise<void> | void
}

function parseCampoInteiro(valor: string): { valido: boolean; numero: number | null } {
  const limpo = valor.trim()
  if (!limpo) return { valido: true, numero: null }
  const n = Number(limpo)
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    return { valido: false, numero: null }
  }
  return { valido: true, numero: n }
}

function parseCampoUsd(valor: string): { valido: boolean; microUsd: number | null } {
  const limpo = valor.trim().replace(',', '.')
  if (!limpo) return { valido: true, microUsd: null }
  const n = Number(limpo)
  if (!Number.isFinite(n) || n < 0) {
    return { valido: false, microUsd: null }
  }
  return { valido: true, microUsd: Math.round(n * 1_000_000) }
}

/** Diálogo para editar limites de orçamento e retomar fila pausada (`jobs.budget.continue` / `jobs.budget.set`). */
export function DialogoOrcamento({
  aberto,
  orcamento,
  modoContinuar = true,
  aoFechar,
  aoConcluir,
}: DialogoOrcamentoProps) {
  const [custoTexto, setCustoTexto] = useState('')
  const [chamadasTexto, setChamadasTexto] = useState('')
  const [tokensTexto, setTokensTexto] = useState('')
  const [resetUsage, setResetUsage] = useState(false)
  const [confirmadoDesconhecido, setConfirmadoDesconhecido] = useState(false)
  const [erroValidacao, setErroValidacao] = useState<string | null>(null)
  const [erroCore, setErroCore] = useState<ErroCore | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!aberto || !orcamento) return
    setCustoTexto(
      orcamento.maxCostMicroUsd != null ? (orcamento.maxCostMicroUsd / 1_000_000).toFixed(2) : '',
    )
    setChamadasTexto(orcamento.maxCalls != null ? String(orcamento.maxCalls) : '')
    setTokensTexto(orcamento.maxTokens != null ? String(orcamento.maxTokens) : '')
    setResetUsage(false)
    setConfirmadoDesconhecido(Boolean(orcamento.unknownConfirmed))
    setErroValidacao(null)
    setErroCore(null)
  }, [aberto, orcamento])

  if (!orcamento) return null

  const exigeCienciaDesconhecido = orcamento.paused === 'cost_unknown'
  const continuar = modoContinuar || orcamento.paused !== null
  const tokensUsados = orcamento.usage.inputTokens + orcamento.usage.outputTokens

  const salvar = async () => {
    setErroValidacao(null)
    setErroCore(null)

    const custo = parseCampoUsd(custoTexto)
    const chamadas = parseCampoInteiro(chamadasTexto)
    const tokens = parseCampoInteiro(tokensTexto)

    if (!custo.valido || !chamadas.valido || !tokens.valido) {
      setErroValidacao('Informe um limite numérico válido (maior ou igual a zero).')
      return
    }
    if (exigeCienciaDesconhecido && !confirmadoDesconhecido) {
      setErroValidacao('Confirme continuar mesmo sem preço conhecido antes de retomar.')
      return
    }

    setEnviando(true)
    try {
      const comando = continuar ? 'jobs.budget.continue' : 'jobs.budget.set'
      await chamar(comando, {
        scope: orcamento.scope,
        key: orcamento.key,
        maxCostMicroUsd: custo.microUsd,
        maxCalls: chamadas.numero,
        maxTokens: tokens.numero,
        resetUsage,
        ...(exigeCienciaDesconhecido || confirmadoDesconhecido ? { confirmed: true } : {}),
      })
      setEnviando(false)
      await aoConcluir?.()
      aoFechar()
    } catch (err) {
      setErroCore(paraErroCore(err))
      setEnviando(false)
    }
  }

  return (
    <Dialogo
      aberto={aberto}
      aoMudarAberto={(proximo) => {
        if (!proximo && !enviando) aoFechar()
      }}
      titulo={continuar ? 'Ajustar orçamento e continuar fila' : 'Ajustar orçamento'}
      largura={500}
      rodape={
        <>
          <Botao variante="fantasma" disabled={enviando} onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            variante="primario"
            carregando={enviando}
            disabled={enviando || (exigeCienciaDesconhecido && !confirmadoDesconhecido)}
            onClick={() => void salvar()}
          >
            {continuar ? 'Salvar orçamento e retomar fila' : 'Salvar orçamento'}
          </Botao>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 rounded-area bg-area p-3 text-pequeno">
          <div className="flex items-center justify-between gap-2">
            <strong className="text-t1">{rotuloEscopoOrcamento(orcamento)}</strong>
            <Status tom={orcamento.paused ? 'pausado' : 'neutro'}>
              {traduzirMotivoPausa(orcamento.paused)}
            </Status>
          </div>
          <p className="num text-t2">
            Consumo acumulado: {orcamento.usage.costLabel ?? usd(orcamento.usage.microUsd)} ·{' '}
            {orcamento.usage.calls} chamadas · {tokensUsados.toLocaleString('pt-BR')} tokens
          </p>
        </div>

        {erroCore && (
          <BannerErroCore
            erro={{ code: erroCore.code, message: erroCore.detalhe || erroCore.message }}
            traduzir={traduzirBannerErro(erroCore)}
          />
        )}

        {erroValidacao && (
          <div role="alert" className="flex items-center gap-2 text-pequeno text-erro">
            <AlertTriangle className="size-[14px] shrink-0 stroke-[1.75]" aria-hidden />
            <span>{erroValidacao}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Campo rotulo="Novo teto de custo (USD)" ajuda="Vazio = sem teto">
            {(props) => (
              <Entrada
                {...props}
                className="num"
                inputMode="decimal"
                value={custoTexto}
                onChange={(e) => setCustoTexto(e.target.value)}
                disabled={enviando}
              />
            )}
          </Campo>

          <Campo rotulo="Novo teto de chamadas" ajuda="Vazio = sem teto">
            {(props) => (
              <Entrada
                {...props}
                className="num"
                inputMode="numeric"
                value={chamadasTexto}
                onChange={(e) => setChamadasTexto(e.target.value)}
                disabled={enviando}
              />
            )}
          </Campo>

          <Campo rotulo="Novo teto de tokens" ajuda="Vazio = sem teto">
            {(props) => (
              <Entrada
                {...props}
                className="num"
                inputMode="numeric"
                value={tokensTexto}
                onChange={(e) => setTokensTexto(e.target.value)}
                disabled={enviando}
              />
            )}
          </Campo>
        </div>

        <Checkbox marcado={resetUsage} aoMudar={setResetUsage} desabilitado={enviando} className="text-pequeno">
          Zerar contador de consumo desta etapa (resetUsage)
        </Checkbox>

        {exigeCienciaDesconhecido && (
          <Checkbox
            marcado={confirmadoDesconhecido}
            aoMudar={setConfirmadoDesconhecido}
            desabilitado={enviando}
            className="text-pequeno"
          >
            Confirmo continuar mesmo sem preço conhecido para este Provedor (cost_unknown)
          </Checkbox>
        )}
      </div>
    </Dialogo>
  )
}
