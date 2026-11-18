import {
  BannerErroCore,
  Botao,
  Campo,
  ConfirmDialog,
  Entrada,
  Esqueleto,
  EstadoTela,
  Progresso,
  ResumoCustoPrivacidade,
  Status,
  cn,
} from '@ds'
import { AlertTriangle, Check, Clapperboard, Mic } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila, type Job } from '~/core/progresso'
import type { FonteProjeto } from '~/stores/fontesProjeto'
import {
  resolverDestinoSelecao,
  type PerfilProvedorLista,
  type RespostaTarefasAssistente,
} from '~/stores/selecaoProjeto'

export type TipoVideoSelecao = 'direct' | 'transformed'

type PesoNota = {
  key: string
  weight: number
}

type ChannelProfileResp = {
  videoKind: TipoVideoSelecao
  language: string
  minUs: number
  maxUs: number
  directMonetizationAck: boolean
  limits?: {
    defaultMinUs: number
    defaultMaxUs: number
    maxUs: number
    technicalMaxUs: number
  }
}

type GuardrailsSourceResp = {
  scope: string
  directMonetizationAck: boolean
  needsDirectNotice: boolean
}

type EnergyStatusResp = {
  measured: boolean
  marks: { high: number; peak: number }
  job: { id: number; state: string; progress: number } | null
}

type ChatStatusResp = {
  state: 'none' | 'available' | 'absent' | string
  canFetch: boolean
  intervals: number
  messages: number
  peaks: number
  job: { id: number; state: string; progress: number } | null
}

type ProviderSelectionStateResp = {
  applicable: boolean
  profileId?: string
  kind?: string
  model?: string | null
  contextTokens?: number
  origin?: string
  state?: 'full' | 'reduced' | 'blocked'
  reference?: {
    sourceMinutes?: number
    maxWindowMinutes?: number
    minWindowMinutes?: number
    firstWindowMinutes?: number | null
    windows?: number | null
  }
  guides?: string[]
}

type BudgetItemResp = {
  scope: 'task' | 'batch'
  key: string
  maxCalls: number | null
  maxCostMicroUsd: number | null
  usage: {
    calls: number
    microUsd: number
  }
  paused: string | null
}

type SelectionEstimateModo1Resp = {
  paid: boolean
  profile: string
  minUs: number
  maxUs: number
  videoKind: TipoVideoSelecao
  plan: {
    state: 'full' | 'reduced' | 'blocked' | string
    windows: unknown[]
    contextTokens?: number
  }
  weights: PesoNota[]
  estimate:
    | { kind: 'zero' }
    | { kind: 'plan_quota' }
    | { kind: 'unknown' }
    | {
        kind: 'usd'
        minMicroUsd: number
        maxMicroUsd: number
        inputTokens?: number
        windows?: number
      }
}

export type ResultadoIniciarSelecao = {
  run: number
  batch?: string
  videoKind?: TipoVideoSelecao
  minUs?: number
  maxUs?: number
  windows?: number
  planState?: string
}

export type ConfiguradorSelecaoProps = {
  projetoId?: string
  fonte: FonteProjeto
  execucaoEmAndamento: boolean
  refCampoMaxUs?: RefObject<HTMLInputElement | null>
  refBotaoDisparar?: RefObject<HTMLButtonElement | null>
  aoIniciarSelecao?: (resultado: ResultadoIniciarSelecao) => void
}

const PESOS_DIRETO_PADRAO: PesoNota[] = [
  { key: 'hook', weight: 0.3 },
  { key: 'selfContained', weight: 0.2 },
  { key: 'energy', weight: 0.2 },
  { key: 'value', weight: 0.15 },
  { key: 'closing', weight: 0.15 },
]

const PESOS_TRANSFORMADO_PADRAO: PesoNota[] = [
  { key: 'commentary', weight: 0.3 },
  { key: 'hook', weight: 0.2 },
  { key: 'energy', weight: 0.15 },
  { key: 'value', weight: 0.15 },
  { key: 'selfContained', weight: 0.1 },
  { key: 'closing', weight: 0.1 },
]

const ROTULO_EIXO: Record<string, string> = {
  commentary: 'Espaço para comentário',
  hook: 'Gancho',
  selfContained: 'Autossuficiência',
  energy: 'Energia',
  value: 'Valor',
  closing: 'Fechamento',
}

const TETO_TECNICO_PADRAO_S = 300
const LIMITE_MUSICA_SHORTS_S = 60

function ordenarPesos(pesos: PesoNota[], videoKind: TipoVideoSelecao): PesoNota[] {
  if (videoKind !== 'transformed') return pesos
  return [...pesos].sort((a, b) => {
    if (a.key === 'commentary') return -1
    if (b.key === 'commentary') return 1
    return 0
  })
}

function converterEstimativaParaDs(estimate: SelectionEstimateModo1Resp['estimate'], windowsCount: number) {
  if (estimate.kind === 'usd') {
    return {
      kind: 'usd' as const,
      minMicroUsd: estimate.minMicroUsd,
      maxMicroUsd: estimate.maxMicroUsd,
      inputTokens: estimate.inputTokens,
      janelas: estimate.windows ?? windowsCount,
    }
  }
  return estimate
}

function moverFocoRadio(e: KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'))
  const idx = radios.indexOf(document.activeElement as HTMLElement)
  if (idx < 0 || radios.length === 0) return
  e.preventDefault()
  const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
  const prox = radios[(idx + dir + radios.length) % radios.length]
  prox.click()
  prox.focus()
}

function validarFaixaSegundos(
  minStr: string,
  maxStr: string,
  tetoTecnicoS: number,
): { erroMin?: string; erroMax?: string; minS: number | null; maxS: number | null } {
  const minNum = Number(minStr)
  const maxNum = Number(maxStr)

  let erroMin: string | undefined
  let erroMax: string | undefined

  const minValido = minStr.trim() !== '' && Number.isFinite(minNum) && minNum > 0
  const maxValido = maxStr.trim() !== '' && Number.isFinite(maxNum) && maxNum > 0

  if (!minValido) {
    erroMin = 'Informe uma duração mínima maior que 0 s.'
  } else if (minNum > tetoTecnicoS) {
    erroMin = `A duração mínima não pode passar de ${tetoTecnicoS} s.`
  }

  if (!maxValido) {
    erroMax = 'Informe uma duração máxima maior que 0 s.'
  } else if (maxNum > tetoTecnicoS) {
    erroMax = `A duração máxima não pode passar de ${tetoTecnicoS} s.`
  }

  if (minValido && maxValido && minNum >= maxNum) {
    erroMin = 'A duração mínima deve ser menor que a duração máxima.'
  }

  return {
    erroMin,
    erroMax,
    minS: !erroMin && minValido ? Math.round(minNum) : null,
    maxS: !erroMax && maxValido ? Math.round(maxNum) : null,
  }
}

function encontrarJobAtivoPorIdOuEtapa(
  fila: readonly Job[],
  jobId: number | null | undefined,
  etapaAlvo: 'energy' | 'chat',
): Job | undefined {
  if (jobId != null) {
    const porId = fila.find((j) => j.id === String(jobId) && j.estado === 'rodando')
    if (porId) return porId
  }
  return fila.find((j) => j.etapa === etapaAlvo && j.estado === 'rodando')
}

/**
 * Coluna esquerda da Tela C.1 (`#/projeto/:id/cortes`): Tipo de vídeo + pesos da Nota,
 * faixa de duração, sinais locais (energia/chat), compatibilidade de contexto, guarda
 * `<ResumoCustoPrivacidade>` e disparo de `selection.start`.
 */
export function ConfiguradorSelecao({
  projetoId = 'demo',
  fonte,
  execucaoEmAndamento,
  refCampoMaxUs,
  refBotaoDisparar,
  aoIniciarSelecao,
}: ConfiguradorSelecaoProps) {
  const fila = useFila()
  const tituloTipoId = useId()
  const maxInputInternoRef = useRef<HTMLInputElement | null>(null)
  const dispararInternoRef = useRef<HTMLButtonElement | null>(null)

  const [carregandoInicial, setCarregandoInicial] = useState(true)
  const [canalPerfil, setCanalPerfil] = useState<ChannelProfileResp | null>(null)
  const [videoKind, setVideoKind] = useState<TipoVideoSelecao>('direct')
  const [minStr, setMinStr] = useState('20')
  const [maxStr, setMaxStr] = useState('60')
  const [precisaAvisoDireto, setPrecisaAvisoDireto] = useState(false)
  const [confirmandoAvisoDireto, setConfirmandoAvisoDireto] = useState(false)

  const [energia, setEnergia] = useState<EnergyStatusResp | null>(null)
  const [chat, setChat] = useState<ChatStatusResp | null>(null)
  const [ocupadoEnergia, setOcupadoEnergia] = useState(false)
  const [ocupadoChat, setOcupadoChat] = useState(false)
  const [erroSinais, setErroSinais] = useState<ErroCore | null>(null)
  const [versaoSinais, setVersaoSinais] = useState(0)

  const [selectionState, setSelectionState] = useState<ProviderSelectionStateResp | null>(null)
  const [perfis, setPerfis] = useState<PerfilProvedorLista[]>([])
  const [tarefas, setTarefas] = useState<RespostaTarefasAssistente | null>(null)
  const [orcamentoSelecao, setOrcamentoSelecao] = useState<BudgetItemResp | null>(null)

  const [estimativa, setEstimativa] = useState<SelectionEstimateModo1Resp | null>(null)
  const [erroEstimativa, setErroEstimativa] = useState<ErroCore | null>(null)
  const [erroDisparo, setErroDisparo] = useState<ErroCore | null>(null)
  const [confirmacaoAberta, setConfirmacaoAberta] = useState(false)
  const [disparando, setDisparando] = useState(false)

  const encProjeto = encodeURIComponent(projetoId)
  const estimativaIniciadaFonteRef = useRef<number | null>(null)
  const assinaturasJobsRef = useRef(new Map<string, string>())

  const atribuirRefMax = useCallback(
    (el: HTMLInputElement | null) => {
      maxInputInternoRef.current = el
      if (refCampoMaxUs) refCampoMaxUs.current = el
    },
    [refCampoMaxUs],
  )

  const atribuirRefDisparar = useCallback(
    (el: HTMLButtonElement | null) => {
      dispararInternoRef.current = el
      if (refBotaoDisparar) refBotaoDisparar.current = el
    },
    [refBotaoDisparar],
  )

  const recarregarSinais = useCallback(async () => {
    try {
      const [en, ch] = await Promise.all([
        chamar<EnergyStatusResp>('energy.status', { source_id: fonte.id }).catch(() => null),
        chamar<ChatStatusResp>('chat.status', { source_id: fonte.id }).catch(() => null),
      ])
      if (en) setEnergia(en)
      if (ch) setChat(ch)
    } catch {
      // ignora erro transitório ao atualizar sinais
    }
  }, [fonte.id])

  useEffect(() => {
    let cancelado = false
    estimativaIniciadaFonteRef.current = null
    setCarregandoInicial(true)
    setErroEstimativa(null)
    setErroDisparo(null)
    setErroSinais(null)
    setEstimativa(null)

    void Promise.all([
      chamar<ChannelProfileResp>('channel_profile.get', {}),
      chamar<EnergyStatusResp>('energy.status', { source_id: fonte.id }).catch(() => null),
      chamar<ChatStatusResp>('chat.status', { source_id: fonte.id }).catch(() => null),
      chamar<ProviderSelectionStateResp>('provider.selection_state', { task: 'selection' }).catch(
        () => ({ applicable: false }),
      ),
      chamar<{ profiles: PerfilProvedorLista[] }>('provider.profiles.list', {}).catch(() => ({
        profiles: [],
      })),
      chamar<RespostaTarefasAssistente>('assistant.tasks', {}).catch(() => null),
      chamar<{ budgets: BudgetItemResp[] }>('jobs.budget.get', {}).catch(() => ({ budgets: [] })),
    ])
      .then(async ([perfilCanal, en, ch, selState, listaPerfis, respTarefas, respBudgets]) => {
        if (cancelado) return
        setCanalPerfil(perfilCanal)
        setVideoKind(perfilCanal.videoKind)
        setMinStr(String(Math.round(perfilCanal.minUs / 1_000_000)))
        setMaxStr(String(Math.round(perfilCanal.maxUs / 1_000_000)))
        setEnergia(en)
        setChat(ch)
        setSelectionState(selState)
        setPerfis(listaPerfis?.profiles ?? [])
        setTarefas(respTarefas)
        const budgetTask =
          respBudgets?.budgets?.find((b) => b.scope === 'task' && b.key === 'selection') ?? null
        setOrcamentoSelecao(budgetTask)

        if (perfilCanal.videoKind === 'direct' && !perfilCanal.directMonetizationAck) {
          try {
            const gr = await chamar<GuardrailsSourceResp>('guardrails.check', {
              scope: 'source',
              source_id: fonte.id,
            })
            if (!cancelado) setPrecisaAvisoDireto(Boolean(gr?.needsDirectNotice))
          } catch {
            if (!cancelado) setPrecisaAvisoDireto(false)
          }
        } else {
          setPrecisaAvisoDireto(false)
        }

        if (!cancelado) setCarregandoInicial(false)
      })
      .catch((err) => {
        if (cancelado) return
        setErroEstimativa(paraErroCore(err))
        setCarregandoInicial(false)
      })

    return () => {
      cancelado = true
    }
  }, [fonte.id])

  // Reage a eventos de `core-progress` (via useFila) para energia e chat
  useEffect(() => {
    let mudouSinal = false
    for (const j of fila) {
      const assinatura = `${j.estado}:${j.etapa}:${j.percentual}`
      const anterior = assinaturasJobsRef.current.get(j.id)
      if (anterior === assinatura) continue
      assinaturasJobsRef.current.set(j.id, assinatura)

      const ehEnergia =
        j.etapa === 'energy' || (energia?.job?.id != null && j.id === String(energia.job.id))
      const ehChat =
        j.etapa === 'chat' || (chat?.job?.id != null && j.id === String(chat.job.id))

      if ((ehEnergia || ehChat) && (j.estado === 'concluido' || j.estado === 'falhou')) {
        mudouSinal = true
      }
    }

    if (mudouSinal) {
      void recarregarSinais().then(() => setVersaoSinais((v) => v + 1))
    }
  }, [fila, energia?.job?.id, chat?.job?.id, recarregarSinais])

  // Atualiza aviso de Corte direto quando o usuário alterna entre Corte direto e Vídeo transformado
  useEffect(() => {
    if (!canalPerfil || carregandoInicial) return
    if (videoKind !== 'direct' || canalPerfil.directMonetizationAck) {
      setPrecisaAvisoDireto(false)
      return
    }
    let cancelado = false
    void chamar<GuardrailsSourceResp>('guardrails.check', {
      scope: 'source',
      source_id: fonte.id,
    })
      .then((gr) => {
        if (!cancelado) setPrecisaAvisoDireto(Boolean(gr?.needsDirectNotice))
      })
      .catch(() => {})
    return () => {
      cancelado = true
    }
  }, [canalPerfil, carregandoInicial, fonte.id, videoKind])

  const tetoTecnicoS = canalPerfil?.limits?.technicalMaxUs
    ? Math.round(canalPerfil.limits.technicalMaxUs / 1_000_000)
    : TETO_TECNICO_PADRAO_S

  const validacaoFaixa = useMemo(
    () => validarFaixaSegundos(minStr, maxStr, tetoTecnicoS),
    [minStr, maxStr, tetoTecnicoS],
  )

  const rangeValido = validacaoFaixa.minS !== null && validacaoFaixa.maxS !== null
  const minUs = validacaoFaixa.minS !== null ? validacaoFaixa.minS * 1_000_000 : null
  const maxUs = validacaoFaixa.maxS !== null ? validacaoFaixa.maxS * 1_000_000 : null

  // Estimativa Modo 1: imediata na abertura e debounced quando parâmetros mudam
  useEffect(() => {
    if (carregandoInicial || minUs === null || maxUs === null) return
    let cancelado = false
    const primeiraDaFonte = estimativaIniciadaFonteRef.current !== fonte.id

    const executar = () => {
      estimativaIniciadaFonteRef.current = fonte.id
      setErroEstimativa(null)
      void chamar<SelectionEstimateModo1Resp>('selection.estimate', {
        source_id: fonte.id,
        minUs,
        maxUs,
        videoKind,
      })
        .then((res) => {
          if (cancelado) return
          setEstimativa(res)
          setErroEstimativa(null)
        })
        .catch((err) => {
          if (cancelado) return
          setEstimativa(null)
          setErroEstimativa(paraErroCore(err))
        })
    }

    if (primeiraDaFonte) {
      executar()
      return () => {
        cancelado = true
      }
    }

    const timer = window.setTimeout(executar, 140)
    return () => {
      cancelado = true
      window.clearTimeout(timer)
    }
  }, [carregandoInicial, fonte.id, minUs, maxUs, videoKind, versaoSinais])

  const tarefaSelecao = useMemo(
    () => tarefas?.tasks.find((t) => t.task === 'selection') ?? null,
    [tarefas],
  )

  const destino = useMemo(() => {
    const idPerfil = estimativa?.profile ?? tarefaSelecao?.profile?.id ?? null
    if (!idPerfil) return null
    return resolverDestinoSelecao(idPerfil, perfis, tarefas)
  }, [estimativa?.profile, tarefaSelecao?.profile?.id, perfis, tarefas])

  const semPerfilConfigurado = useMemo(() => {
    if (
      erroEstimativa?.code === 'profile_unavailable' ||
      erroEstimativa?.code === 'invalid_settings' ||
      erroDisparo?.code === 'profile_unavailable' ||
      erroDisparo?.code === 'invalid_settings'
    ) {
      return true
    }
    if (tarefas && !tarefaSelecao?.profile && !estimativa) {
      return true
    }
    return false
  }, [erroEstimativa?.code, erroDisparo?.code, tarefas, tarefaSelecao?.profile, estimativa])

  const estadoContextoEfetivo = useMemo(() => {
    if (!selectionState) return null
    if (selectionState.applicable) return selectionState
    if (destino?.localidade === 'cli') return selectionState
    if (
      estimativa?.plan?.state === 'full' ||
      estimativa?.plan?.state === 'reduced' ||
      estimativa?.plan?.state === 'blocked'
    ) {
      return {
        applicable: true,
        state: estimativa.plan.state as 'full' | 'reduced' | 'blocked',
        reference: { firstWindowMinutes: estimativa.plan.state === 'reduced' ? 12 : 15 },
      }
    }
    return selectionState
  }, [selectionState, destino?.localidade, estimativa?.plan?.state])

  const canalMinS = canalPerfil ? Math.round(canalPerfil.minUs / 1_000_000) : 20
  const canalMaxS = canalPerfil ? Math.round(canalPerfil.maxUs / 1_000_000) : 60
  const diferenteDoCanal =
    canalPerfil !== null && (minStr !== String(canalMinS) || maxStr !== String(canalMaxS))
  const tipoSobrescrito = canalPerfil !== null && videoKind !== canalPerfil.videoKind

  const pesosExibidos = useMemo(
    () =>
      ordenarPesos(
        estimativa?.weights && estimativa.weights.length > 0
          ? estimativa.weights
          : videoKind === 'transformed'
            ? PESOS_TRANSFORMADO_PADRAO
            : PESOS_DIRETO_PADRAO,
        videoKind,
      ),
    [estimativa?.weights, videoKind],
  )

  const jobEnergiaFila = encontrarJobAtivoPorIdOuEtapa(fila, energia?.job?.id, 'energy')
  const energiaRodando =
    Boolean(jobEnergiaFila) ||
    energia?.job?.state === 'queued' ||
    energia?.job?.state === 'running'
  const energiaJobId = jobEnergiaFila ? Number(jobEnergiaFila.id) : energia?.job?.id ?? null
  const energiaProgresso = jobEnergiaFila?.percentual ?? energia?.job?.progress ?? 0

  const jobChatFila = encontrarJobAtivoPorIdOuEtapa(fila, chat?.job?.id, 'chat')
  const chatRodando =
    Boolean(jobChatFila) || chat?.job?.state === 'queued' || chat?.job?.state === 'running'
  const chatJobId = jobChatFila ? Number(jobChatFila.id) : chat?.job?.id ?? null
  const chatProgresso = jobChatFila?.percentual ?? chat?.job?.progress ?? 0

  const aoEntenderRiscoDireto = async () => {
    setConfirmandoAvisoDireto(true)
    try {
      await chamar('guardrails.ack_direct_notice', {})
      setPrecisaAvisoDireto(false)
      setCanalPerfil((prev) => (prev ? { ...prev, directMonetizationAck: true } : prev))
    } catch (err) {
      setErroDisparo(paraErroCore(err))
    } finally {
      setConfirmandoAvisoDireto(false)
    }
  }

  const aoMedirEnergia = async () => {
    setErroSinais(null)
    setOcupadoEnergia(true)
    try {
      await chamar('energy.start', { source_id: fonte.id })
      await recarregarSinais()
      setVersaoSinais((v) => v + 1)
    } catch (err) {
      setErroSinais(paraErroCore(err))
    } finally {
      setOcupadoEnergia(false)
    }
  }

  const aoBuscarChat = async () => {
    setErroSinais(null)
    setOcupadoChat(true)
    try {
      await chamar('chat.fetch', { source_id: fonte.id })
      await recarregarSinais()
      setVersaoSinais((v) => v + 1)
    } catch (err) {
      setErroSinais(paraErroCore(err))
    } finally {
      setOcupadoChat(false)
    }
  }

  const aoCancelarJobSinal = async (jobId: number | null) => {
    if (jobId == null || !Number.isFinite(jobId)) return
    setErroSinais(null)
    try {
      await chamar('jobs.cancel', { id: jobId })
      await recarregarSinais()
    } catch (err) {
      setErroSinais(paraErroCore(err))
    }
  }

  const executarDisparo = async (confirmed: boolean) => {
    if (minUs === null || maxUs === null || disparando) return
    setErroDisparo(null)
    setDisparando(true)
    try {
      const res = await chamar<ResultadoIniciarSelecao>('selection.start', {
        source_id: fonte.id,
        minUs,
        maxUs,
        videoKind,
        confirmed,
      })
      setConfirmacaoAberta(false)
      aoIniciarSelecao?.(res)
    } catch (err) {
      const e = paraErroCore(err)
      if (e.code === 'confirmation_required' && !confirmed) {
        setConfirmacaoAberta(true)
      } else {
        setConfirmacaoAberta(false)
        setErroDisparo(e)
      }
    } finally {
      setDisparando(false)
    }
  }

  const precisaConfirmarPagoOuCli =
    Boolean(estimativa?.paid) || destino?.localidade === 'cli' || Boolean(destino?.saiDaMaquina)

  const aoClicarSelecionarCortes = () => {
    if (!rangeValido || execucaoEmAndamento || semPerfilConfigurado) return
    if (precisaConfirmarPagoOuCli) {
      setConfirmacaoAberta(true)
      return
    }
    void executarDisparo(false)
  }

  const erroAtivo = erroDisparo ?? (semPerfilConfigurado ? null : erroEstimativa)
  const configuracaoBloqueada =
    execucaoEmAndamento ||
    !rangeValido ||
    semPerfilConfigurado ||
    selectionState?.state === 'blocked' ||
    estimativa?.plan?.state === 'blocked' ||
    Boolean(destino?.bloqueadoSomenteLocal) ||
    erroAtivo?.code === 'context_too_small' ||
    erroAtivo?.code === 'max_cut_too_long' ||
    erroAtivo?.code === 'local_only_violation'

  const renderBannerErro = (erro: ErroCore) => {
    const trad = mensagemDeErro(erro)
    let acaoRecuperacao = trad.recuperacao
      ? {
          rotulo: trad.recuperacao.rotulo,
          aoAcionar: () => {
            if (trad.recuperacao?.rota) {
              window.location.hash = trad.recuperacao.rota
            }
          },
        }
      : undefined
    let acaoSecundaria: { rotulo: string; aoAcionar: () => void } | undefined

    if (erro.code === 'context_too_small' || erro.code === 'max_cut_too_long') {
      acaoRecuperacao = {
        rotulo: 'Reduzir duração máxima',
        aoAcionar: () => maxInputInternoRef.current?.focus(),
      }
      acaoSecundaria = {
        rotulo: 'Trocar Perfil de Provedor',
        aoAcionar: () => {
          window.location.hash = '#/config/provedores'
        },
      }
    } else if (erro.code === 'local_only_violation') {
      acaoRecuperacao = {
        rotulo: 'Escolher Perfil local',
        aoAcionar: () => {
          window.location.hash = '#/config/provedores'
        },
      }
      acaoSecundaria = {
        rotulo: 'Ver veto do Projeto',
        aoAcionar: () => {
          window.location.hash = '#/config/projeto'
        },
      }
    } else if (erro.code === 'confirmation_required') {
      acaoRecuperacao = {
        rotulo: 'Confirmar e continuar',
        aoAcionar: () => setConfirmacaoAberta(true),
      }
    } else if (erro.code === 'vault' || erro.code === 'cli_auth_required') {
      acaoRecuperacao = {
        rotulo: 'Ir para Provedores',
        aoAcionar: () => {
          window.location.hash = '#/config/provedores'
        },
      }
    } else if (erro.code === 'transcript_incomplete' || erro.code === 'no_sentences') {
      acaoRecuperacao = {
        rotulo: 'Abrir Transcrição',
        aoAcionar: () => {
          window.location.hash = `#/projeto/${encProjeto}/fontes/${fonte.id}`
        },
      }
    }

    return (
      <BannerErroCore
        erro={{ code: erro.code, message: erro.detalhe || erro.message }}
        traduzir={() => ({ titulo: trad.titulo })}
        acaoRecuperacao={acaoRecuperacao}
        acaoSecundaria={acaoSecundaria}
        permitirRelato
      />
    )
  }

  if (carregandoInicial) {
    return (
      <div className="flex flex-col gap-3">
        <Esqueleto variante="formulario" quantidade={4} rotuloAcessivel="Carregando configurador de seleção" />
      </div>
    )
  }

  return (
    <div className="flex max-w-[68ch] flex-col gap-3">
      {execucaoEmAndamento && (
        <div role="status" className="flex items-center justify-between gap-2 rounded-area bg-area px-3 py-2">
          <Status tom="rodando" forte>
            Seleção em andamento para esta Fonte
          </Status>
          <span className="text-pequeno text-t3">Aguarde concluir ou cancele ao lado.</span>
        </div>
      )}

      {/* 1. Tipo de vídeo desta seleção */}
      <section aria-labelledby={tituloTipoId} className="flex flex-col gap-2.5 rounded-area bg-area p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={tituloTipoId} className="text-base font-forte text-t1">
            1. Tipo de vídeo desta seleção
          </h2>
          <span className="text-pequeno text-t3">
            {tipoSobrescrito ? 'Sobrescrito só para esta execução' : 'Herdado do Perfil de canal'}
          </span>
        </div>

        <div
          role="radiogroup"
          aria-labelledby={tituloTipoId}
          onKeyDown={moverFocoRadio}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          <button
            type="button"
            role="radio"
            aria-checked={videoKind === 'direct'}
            tabIndex={videoKind === 'direct' ? 0 : -1}
            onClick={() => setVideoKind('direct')}
            className={cn(
              'foco flex min-h-9 cursor-pointer items-center gap-2 rounded-controle border-0 px-3 py-2 text-left text-pequeno transition-colors duration-(--dur-rapida) ease-saida',
              videoKind === 'direct'
                ? 'marcado bg-elevado font-medio text-t1'
                : 'bg-chao text-t2 hover:bg-hover hover:text-t1',
            )}
          >
            <Clapperboard className="size-3.5 shrink-0 stroke-[1.75]" aria-hidden />
            <span className="flex flex-col">
              <span>Corte direto</span>
              <span className="text-micro text-t3">Canal de cortes</span>
            </span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={videoKind === 'transformed'}
            tabIndex={videoKind === 'transformed' ? 0 : -1}
            onClick={() => setVideoKind('transformed')}
            className={cn(
              'foco flex min-h-9 cursor-pointer items-center gap-2 rounded-controle border-0 px-3 py-2 text-left text-pequeno transition-colors duration-(--dur-rapida) ease-saida',
              videoKind === 'transformed'
                ? 'marcado bg-elevado font-medio text-t1'
                : 'bg-chao text-t2 hover:bg-hover hover:text-t1',
            )}
          >
            <Mic className="size-3.5 shrink-0 stroke-[1.75]" aria-hidden />
            <span className="flex flex-col">
              <span>Vídeo transformado</span>
              <span className="text-micro text-t3">Canal dark</span>
            </span>
          </button>
        </div>

        <p className="text-pequeno text-t2">
          {videoKind === 'transformed'
            ? 'Vídeo transformado exige Ângulo → Roteiro aprovado → Narração antes de exportar.'
            : 'Corte direto vai direto ao Editor e Empacotamento, sem Roteiro nem Narração.'}
        </p>

        <p className="num text-pequeno text-t3">
          Pesos da Nota:{' '}
          {pesosExibidos.map((p, idx) => {
            const pct = Math.round(p.weight * 100)
            const destaque = videoKind === 'transformed' && p.key === 'commentary'
            const nome = ROTULO_EIXO[p.key] ?? p.key
            return (
              <span key={p.key} className={destaque ? 'font-forte text-t1' : undefined}>
                {idx > 0 ? ' · ' : ''}
                {nome} ({pct}%)
              </span>
            )
          })}
        </p>

        {videoKind === 'direct' && precisaAvisoDireto && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-controle bg-elevado px-2.5 py-2 text-pequeno">
            <span className="flex min-w-0 flex-1 items-start gap-1.5 text-t2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 stroke-[1.75] text-t3" aria-hidden />
              <span>
                Corte direto publica sem Transformação e pode ter monetização recusada por conteúdo reutilizado.
              </span>
            </span>
            <Botao
              tamanho="p"
              variante="secundario"
              carregando={confirmandoAvisoDireto}
              onClick={() => void aoEntenderRiscoDireto()}
            >
              Entendi o risco
            </Botao>
          </div>
        )}
      </section>

      {/* 2. Faixa de duração do Corte */}
      <section aria-label="2. Faixa de duração do Corte" className="flex flex-col gap-2.5 rounded-area bg-area p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-forte text-t1">2. Faixa de duração do Corte</h2>
          <Botao
            tamanho="p"
            variante="fantasma"
            disabled={!diferenteDoCanal}
            onClick={() => {
              setMinStr(String(canalMinS))
              setMaxStr(String(canalMaxS))
            }}
          >
            Restaurar padrão do canal ({canalMinS}–{canalMaxS} s)
          </Botao>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo rotulo="Duração mínima (s)" erro={validacaoFaixa.erroMin}>
            {(props) => (
              <Entrada
                {...props}
                type="number"
                min={1}
                max={tetoTecnicoS}
                step={1}
                value={minStr}
                onChange={(e) => setMinStr(e.target.value)}
                className="num"
              />
            )}
          </Campo>

          <Campo
            rotulo="Duração máxima (s)"
            extra={`Teto: ${tetoTecnicoS} s`}
            erro={validacaoFaixa.erroMax}
          >
            {(props) => (
              <Entrada
                {...props}
                ref={atribuirRefMax}
                type="number"
                min={1}
                max={tetoTecnicoS}
                step={1}
                value={maxStr}
                onChange={(e) => setMaxStr(e.target.value)}
                className="num"
              />
            )}
          </Campo>
        </div>

        {rangeValido && validacaoFaixa.maxS !== null && validacaoFaixa.maxS > LIMITE_MUSICA_SHORTS_S && (
          <p className="flex items-start gap-1.5 text-pequeno text-t2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 stroke-[1.75] text-t3" aria-hidden />
            <span>
              Aviso: acima de 60 s, músicas reivindicadas podem bloquear a monetização em vídeos curtos.
            </span>
          </p>
        )}
      </section>

      {/* 3. Sinais locais da Fonte */}
      <section aria-label="3. Sinais locais da Fonte" className="flex flex-col gap-2.5 rounded-area bg-area p-3">
        <h2 className="text-base font-forte text-t1">3. Sinais locais da Fonte</h2>

        {erroSinais && (
          <BannerErroCore
            erro={{ code: erroSinais.code, message: erroSinais.detalhe || erroSinais.message }}
            traduzir={(code) => mensagemDeErro(new ErroCore(code, erroSinais.detalhe))}
            aoDispensar={() => setErroSinais(null)}
          />
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col justify-between gap-2 rounded-controle bg-elevado px-2.5 py-2">
            <span className="text-pequeno text-t3">Energia do áudio</span>
            {energia?.measured ? (
              <p className="num flex items-center gap-1.5 text-pequeno text-t1">
                <Check className="size-3.5 shrink-0 stroke-[1.75] text-t3" aria-hidden />
                <span>
                  {energia.marks.high} altas · {energia.marks.peak} picos
                </span>
              </p>
            ) : energiaRodando ? (
              <div className="flex flex-col gap-2">
                <Progresso valor={energiaProgresso} rotulo="Medindo energia do áudio" />
                <Botao
                  tamanho="p"
                  variante="suave"
                  aria-label="Cancelar medição de energia"
                  onClick={() => void aoCancelarJobSinal(energiaJobId)}
                >
                  Cancelar
                </Botao>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-1.5">
                <span className="text-pequeno text-t2">Ainda não medida</span>
                <Botao
                  tamanho="p"
                  variante="secundario"
                  carregando={ocupadoEnergia}
                  onClick={() => void aoMedirEnergia()}
                >
                  Medir energia do áudio
                </Botao>
              </div>
            )}
          </div>

          <div className="flex flex-col justify-between gap-2 rounded-controle bg-elevado px-2.5 py-2">
            <span className="text-pequeno text-t3">Chat da live</span>
            {chat?.state === 'available' ? (
              <p className="num flex items-center gap-1.5 text-pequeno text-t1">
                <Check className="size-3.5 shrink-0 stroke-[1.75] text-t3" aria-hidden />
                <span>
                  Disponível: {chat.peaks} picos · {chat.messages.toLocaleString('pt-BR')} msgs
                </span>
              </p>
            ) : chatRodando ? (
              <div className="flex flex-col gap-2">
                <Progresso valor={chatProgresso} rotulo="Buscando chat da live" />
                <Botao
                  tamanho="p"
                  variante="suave"
                  aria-label="Cancelar busca do chat"
                  onClick={() => void aoCancelarJobSinal(chatJobId)}
                >
                  Cancelar
                </Botao>
              </div>
            ) : chat?.state === 'absent' ? (
              <span className="text-pequeno text-t2">Sem replay de chat</span>
            ) : chat?.canFetch ? (
              <div className="flex flex-col items-start gap-1.5">
                <span className="text-pequeno text-t2">Replay disponível para busca</span>
                <Botao
                  tamanho="p"
                  variante="secundario"
                  carregando={ocupadoChat}
                  onClick={() => void aoBuscarChat()}
                >
                  Buscar chat da live
                </Botao>
              </div>
            ) : (
              <span className="text-pequeno text-t2">Sem replay de chat (arquivo local)</span>
            )}
          </div>
        </div>
      </section>

      {/* 4. Contexto, Custo e Disparo */}
      <section aria-label="4. Contexto, Custo e Disparo" className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-forte text-t1">4. Contexto, Custo e Disparo</h2>
          {!semPerfilConfigurado && estadoContextoEfetivo && (
            estadoContextoEfetivo.applicable === false ? (
              <Status tom="info">Contexto gerenciado pelo CLI</Status>
            ) : estadoContextoEfetivo.state === 'full' ? (
              <Status tom="sucesso">Janela de contexto: Completa (15 min)</Status>
            ) : estadoContextoEfetivo.state === 'reduced' ? (
              <Status tom="aviso">
                Janela de contexto: Reduzida ({estadoContextoEfetivo.reference?.firstWindowMinutes ?? 12} min)
              </Status>
            ) : (
              <div className="flex items-center gap-2">
                <Status tom="perigo">Janela de contexto: Bloqueada</Status>
                <Botao
                  tamanho="p"
                  variante="secundario"
                  onClick={() => {
                    window.location.hash = '#/config/provedores'
                  }}
                >
                  Configurar Provedores
                </Botao>
              </div>
            )
          )}
        </div>

        {semPerfilConfigurado ? (
          <EstadoTela
            tipo="sem_permissao"
            compacto
            titulo="Configure um Perfil de Provedor para selecionar Cortes"
            descricao="Defina um Perfil para a tarefa de seleção antes de iniciar."
            acaoPrimaria={{
              rotulo: 'Configurar Provedores',
              aoAcionar: () => {
                window.location.hash = '#/config/provedores'
              },
            }}
          />
        ) : (
          <>
            {erroAtivo && renderBannerErro(erroAtivo)}

            {estimativa && destino && (
              <ResumoCustoPrivacidade
                tarefa="Seleção de Cortes"
                perfil={destino.perfil}
                localidade={destino.localidade}
                saiDaMaquina={destino.saiDaMaquina}
                host={destino.host}
                estimativa={converterEstimativaParaDs(
                  estimativa.estimate,
                  estimativa.plan?.windows?.length ?? 0,
                )}
                orcamento={
                  orcamentoSelecao
                    ? {
                        restanteMicroUsd:
                          orcamentoSelecao.maxCostMicroUsd != null
                            ? Math.max(
                                0,
                                orcamentoSelecao.maxCostMicroUsd - orcamentoSelecao.usage.microUsd,
                              )
                            : null,
                        callsRestantes:
                          orcamentoSelecao.maxCalls != null
                            ? Math.max(0, orcamentoSelecao.maxCalls - orcamentoSelecao.usage.calls)
                            : null,
                        pausado: Boolean(orcamentoSelecao.paused),
                      }
                    : null
                }
                bloqueadoSomenteLocal={destino.bloqueadoSomenteLocal}
              />
            )}
          </>
        )}

        <Botao
          ref={atribuirRefDisparar}
          variante="primario"
          tamanho="g"
          disabled={configuracaoBloqueada}
          carregando={disparando}
          onClick={aoClicarSelecionarCortes}
          className="w-full justify-center"
        >
          {execucaoEmAndamento ? 'Seleção em andamento…' : 'Selecionar Cortes'}
        </Botao>
      </section>

      <ConfirmDialog
        aberto={confirmacaoAberta}
        aoMudarAberto={(proximo) => {
          if (!disparando) setConfirmacaoAberta(proximo)
        }}
        titulo="Confirmar seleção de Cortes"
        descricao="Esta ação envia trechos da Transcrição para o Provedor configurado. Confira os custos e a privacidade antes de continuar."
        rotuloCancelar="Cancelar"
        rotuloConfirmar="Confirmar e selecionar Cortes"
        focoInicial="cancelar"
        ocupado={disparando}
        aoConfirmar={() => void executarDisparo(true)}
      >
        {estimativa && destino && (
          <ResumoCustoPrivacidade
            tarefa={`Seleção de Cortes (${videoKind === 'transformed' ? 'Vídeo transformado' : 'Corte direto'})`}
            perfil={destino.perfil}
            localidade={destino.localidade}
            saiDaMaquina={destino.saiDaMaquina}
            host={destino.host}
            estimativa={converterEstimativaParaDs(
              estimativa.estimate,
              estimativa.plan?.windows?.length ?? 0,
            )}
            orcamento={
              orcamentoSelecao
                ? {
                    restanteMicroUsd:
                      orcamentoSelecao.maxCostMicroUsd != null
                        ? Math.max(
                            0,
                            orcamentoSelecao.maxCostMicroUsd - orcamentoSelecao.usage.microUsd,
                          )
                        : null,
                    callsRestantes:
                      orcamentoSelecao.maxCalls != null
                        ? Math.max(0, orcamentoSelecao.maxCalls - orcamentoSelecao.usage.calls)
                        : null,
                    pausado: Boolean(orcamentoSelecao.paused),
                  }
                : null
            }
            bloqueadoSomenteLocal={destino.bloqueadoSomenteLocal}
          />
        )}
      </ConfirmDialog>
    </div>
  )
}
