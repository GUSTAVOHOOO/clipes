import {
  BadgeNota,
  BannerErroCore,
  Botao,
  ChecklistGuardaCorpos,
  ConfirmDialog,
  EixosNota,
  EstadoTela,
  Kbd,
  PlayerProxy,
  Progresso,
  SeloTipoVideo,
  Status,
  Transporte,
  cn,
  duracao,
  tcLongo,
  useToast,
  type EixoNota,
  type ItemGuarda,
  type TomStatus,
} from '@ds'
import { AlertTriangle, Check, FileQuestion, MessageSquare, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { formatarTecla, resolverTeclaExibida } from '~/comandos/atalhos'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila } from '~/core/progresso'
import { usePreferencias } from '~/preferencias/preferencias'
import type { FonteProjeto } from '~/stores/fontesProjeto'
import type {
  ItemRevisaoSelecao,
  PerfilProvedorLista,
  ResumoRunSelecao,
} from '~/stores/selecaoProjeto'
import type { CandidatoLista, ChatPicoCandidato } from '~/telas/cortes/ListaCandidatos'
import { mediaUrl } from '../../../../src/lib/media'

export interface EixoDetalheCandidato {
  score: number
  why: string
}

export interface CandidatoDetalhe extends CandidatoLista {
  startId: number
  endId: number
  videoKind?: 'direct' | 'transformed'
  axes?: Record<string, EixoDetalheCandidato>
  weights?: Array<{ key: string; weight: number }>
  reasons?: string[]
  scores?: Record<string, number>
}

export interface RespostaSetKindCandidato {
  run: number
  candidate: number
  videoKind: 'direct' | 'transformed'
  item?: ItemRevisaoSelecao | null
  canUndo?: boolean
}

export interface DetalheCandidatoProps {
  projetoId: string
  run: ResumoRunSelecao
  fonte: FonteProjeto | null
  candidato: CandidatoDetalhe | null
  erroAjuste?: ErroCore | null
  ocupadoAjuste?: boolean
  tempoAtualUs?: number
  aoMudarTempoUs?: (us: number) => void
  reproduzindo?: boolean
  aoMudarReproduzindo?: (tocando: boolean) => void
  desabilitarAtalhosLocais?: boolean
  aoDecidir: (candidatoId: number, decisao: 'approved' | 'rejected') => Promise<void> | void
  aoAjustar: (candidatoId: number, borda: 'start' | 'end', delta: -1 | 1) => Promise<void> | void
  aoAbrirEditor: (candidatoId: number) => void
  aoConverterParaTransformado?: (candidatoId: number, resposta: RespostaSetKindCandidato) => void
  aoRelocalizarFonte?: (fonteId: number) => void
  className?: string
}

interface ProxyResposta {
  state: 'queued' | 'running' | 'ready' | 'failed'
  key: string
  job: number | null
  progress: number
  error: string | null
  windowStartUs?: number
  windowEndUs?: number
}

interface GuardrailsSingleResposta {
  scope: string
  directMonetizationAck: boolean
  needsDirectNotice: boolean
  over60s: boolean
  permission: {
    status: 'granted' | 'partial' | 'none'
    who?: string | null
    where?: string | null
    scope?: string | null
  }
}

interface AnglesGetResposta {
  selected: { name: string; promise?: string } | null
  generation: number | null
  busy: boolean
}

type EstadoProxyLocal = {
  status: 'idle' | 'queued' | 'running' | 'ready' | 'cancelled' | 'error'
  key: string | null
  jobId: number | null
  progress: number
  windowStartUs: number | null
  windowEndUs: number | null
  erro: ErroCore | null
}

const ESTADO_PROXY_INICIAL: EstadoProxyLocal = {
  status: 'idle',
  key: null,
  jobId: null,
  progress: 0,
  windowStartUs: null,
  windowEndUs: null,
  erro: null,
}

const PESOS_PADRAO_DIRETO: Array<{ key: string; weight: number }> = [
  { key: 'hook', weight: 0.3 },
  { key: 'selfContained', weight: 0.2 },
  { key: 'energy', weight: 0.2 },
  { key: 'value', weight: 0.15 },
  { key: 'closing', weight: 0.15 },
]

const PESOS_PADRAO_TRANSFORMADO: Array<{ key: string; weight: number }> = [
  { key: 'commentary', weight: 0.3 },
  { key: 'hook', weight: 0.2 },
  { key: 'energy', weight: 0.15 },
  { key: 'value', weight: 0.15 },
  { key: 'selfContained', weight: 0.1 },
  { key: 'closing', weight: 0.1 },
]

const ROTULOS_EIXOS: Record<string, string> = {
  commentary: 'Espaço para comentário',
  hook: 'Gancho',
  selfContained: 'Autossuficiência',
  energy: 'Energia',
  value: 'Valor',
  closing: 'Fechamento',
}

const REACOES_CHAT: Record<string, string> = {
  laugh: 'risadas',
  surprise: 'surpresa',
  clip: 'pedido de clip',
}

const STATUS_DECISAO: Record<CandidatoDetalhe['status'], { tom: TomStatus; rotulo: string }> = {
  pending: { tom: 'pendente', rotulo: 'Pendente' },
  approved: { tom: 'sucesso', rotulo: 'Aprovado' },
  rejected: { tom: 'perigo', rotulo: 'Rejeitado' },
}

function montarEixos(candidato: CandidatoDetalhe, run: ResumoRunSelecao): EixoNota[] {
  const basePesos =
    candidato.weights && candidato.weights.length > 0
      ? candidato.weights
      : run.weights && run.weights.length > 0
        ? run.weights
        : run.videoKind === 'transformed'
          ? PESOS_PADRAO_TRANSFORMADO
          : PESOS_PADRAO_DIRETO

  const ordenados =
    run.videoKind === 'transformed'
      ? [
          ...basePesos.filter((w) => w.key === 'commentary'),
          ...basePesos.filter((w) => w.key !== 'commentary'),
        ]
      : [...basePesos]

  return ordenados.map((w) => {
    const eixo = candidato.axes?.[w.key]
    const pct = Math.round(w.weight * 100)
    const rotuloBase = ROTULOS_EIXOS[w.key] ?? w.key
    const nome = w.key === 'commentary' ? `${rotuloBase} (${pct}%)` : rotuloBase
    return {
      nome,
      peso: Number((w.weight * 10).toFixed(1)),
      valor: eixo?.score ?? candidato.scores?.[w.key] ?? candidato.total,
      porque: eixo?.why ?? '',
    }
  })
}

function escolherMotivoPrincipal(candidato: CandidatoDetalhe, eixos: EixoNota[]): string | undefined {
  if (candidato.reasons && candidato.reasons.length > 0) {
    return candidato.reasons[0]
  }
  const comPorque = eixos.filter((e) => e.porque.trim().length > 0)
  if (comPorque.length === 0) return undefined
  const melhor = comPorque.reduce((atual, cand) =>
    cand.valor * cand.peso > atual.valor * atual.peso ? cand : atual,
  )
  return melhor.porque
}

function formatarAjusteSelecao(adjust: CandidatoDetalhe['adjust']): string {
  if (!adjust) return 'Bordas ajustadas automaticamente na seleção'
  const partes: string[] = []
  if (adjust.extendedBefore) partes.push('começo estendido')
  if (adjust.extendedAfter) partes.push('fim estendido')
  if (adjust.trimmedEnd) partes.push('fim encurtado')
  return partes.length > 0
    ? `Bordas ajustadas na seleção: ${partes.join(' / ')}`
    : 'Bordas ajustadas automaticamente na seleção'
}

function formatarPicoChat(pico: ChatPicoCandidato): string {
  const razao = pico.ratio.toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  const reacao = pico.reaction ? (REACOES_CHAT[pico.reaction] ?? pico.reaction) : null
  return `chat ${razao}× acima do normal${reacao ? ` · ${reacao}` : ''} · ${tcLongo(pico.atUs)}`
}

const ROTULO_PERFIL_FALLBACK: Record<string, string> = {
  legacy: 'Perfil configurado',
  forte: 'Forte remoto',
  leve: 'Leve local',
}

function formatarPerfilCandidato(
  profile: string,
  perfis: readonly PerfilProvedorLista[],
): string {
  const limpo = profile.trim()
  if (!limpo) return 'Perfil configurado'
  const encontrado = perfis.find((p) => p.id === limpo || p.label === limpo)
  if (encontrado?.label) return encontrado.label
  const fallback = ROTULO_PERFIL_FALLBACK[limpo.toLowerCase()]
  if (fallback) return fallback
  return limpo
}

/** Coluna direita da Bancada de Revisão (C.2): PlayerProxy 9:16, Nota explicável, ±1 Frase e Guardrails. */
export function DetalheCandidato({
  projetoId,
  run,
  fonte,
  candidato,
  erroAjuste,
  ocupadoAjuste = false,
  tempoAtualUs: tempoAtualUsProp,
  aoMudarTempoUs,
  reproduzindo: reproduzindoProp,
  aoMudarReproduzindo,
  desabilitarAtalhosLocais = false,
  aoDecidir,
  aoAjustar,
  aoAbrirEditor,
  aoConverterParaTransformado,
  aoRelocalizarFonte,
  className,
}: DetalheCandidatoProps) {
  const jobsFila = useFila()
  const [preferencias] = usePreferencias()
  const idMotivoAbrir = useId()
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const btnAprovarRef = useRef<HTMLButtonElement>(null)

  const teclaExibida = useCallback(
    (idAtalho: string, padrao: string, teclaUnica = true) => {
      const base = Object.hasOwn(preferencias.atalhos, idAtalho)
        ? preferencias.atalhos[idAtalho]
        : padrao
      const efetiva = resolverTeclaExibida(base, preferencias.modoTeclasUnicas, teclaUnica)
      return efetiva ? formatarTecla(efetiva) : undefined
    },
    [preferencias.atalhos, preferencias.modoTeclasUnicas],
  )

  const [proxyState, setProxyState] = useState<EstadoProxyLocal>(ESTADO_PROXY_INICIAL)
  const [proxyTentativa, setProxyTentativa] = useState(0)
  const [tempoAtualUsInterno, setTempoAtualUsInterno] = useState(0)
  const [reproduzindoInterno, setReproduzindoInterno] = useState(false)
  const [mudo, setMudo] = useState(false)

  const tempoAtualUs = tempoAtualUsProp ?? tempoAtualUsInterno
  const reproduzindo = reproduzindoProp ?? reproduzindoInterno

  const setTempoAtualUs = useCallback(
    (prox: number | ((atual: number) => number)) => {
      const valor = typeof prox === 'function' ? prox(tempoAtualUs) : prox
      if (tempoAtualUsProp === undefined) setTempoAtualUsInterno(valor)
      aoMudarTempoUs?.(valor)
    },
    [aoMudarTempoUs, tempoAtualUs, tempoAtualUsProp],
  )

  const setReproduzindo = useCallback(
    (prox: boolean | ((atual: boolean) => boolean)) => {
      const valor = typeof prox === 'function' ? prox(reproduzindo) : prox
      if (reproduzindoProp === undefined) setReproduzindoInterno(valor)
      aoMudarReproduzindo?.(valor)
    },
    [aoMudarReproduzindo, reproduzindo, reproduzindoProp],
  )

  const [guardrails, setGuardrails] = useState<GuardrailsSingleResposta | null>(null)
  const [guardrailsPronto, setGuardrailsPronto] = useState(false)
  const [erroGuardrails, setErroGuardrails] = useState<ErroCore | null>(null)
  const [angulos, setAngulos] = useState<AnglesGetResposta | null>(null)
  const [angulosPronto, setAngulosPronto] = useState(false)
  const [erroAngulos, setErroAngulos] = useState<ErroCore | null>(null)
  const [guardrailsTentativa, setGuardrailsTentativa] = useState(0)
  const [ackEmCurso, setAckEmCurso] = useState(false)
  const [perfis, setPerfis] = useState<PerfilProvedorLista[]>([])
  const [convertidosLocalmente, setConvertidosLocalmente] = useState<Set<number>>(() => new Set())
  const [confirmarConversaoAberto, setConfirmarConversaoAberto] = useState(false)
  const [convertendo, setConvertendo] = useState(false)
  const [erroConversao, setErroConversao] = useState<ErroCore | null>(null)
  const [focarAposConversao, setFocarAposConversao] = useState(false)

  const candidatoIdAtualRef = useRef<number | null>(candidato?.id ?? null)
  candidatoIdAtualRef.current = candidato?.id ?? null

  useEffect(() => {
    setConvertidosLocalmente(new Set())
  }, [projetoId, run.id])

  useEffect(() => {
    setConfirmarConversaoAberto(false)
    setConvertendo(false)
    setErroConversao(null)
    setFocarAposConversao(false)
  }, [candidato?.id])

  const tipoVideo: 'direct' | 'transformed' =
    candidato && convertidosLocalmente.has(candidato.id)
      ? 'transformed'
      : (candidato?.videoKind ?? run.videoKind)

  const ultimoCandidatoSolicitadoRef = useRef<number | null>(null)
  const jobsFilaRef = useRef(jobsFila)
  jobsFilaRef.current = jobsFila
  const filaInicioProxyRef = useRef<typeof jobsFila | null>(null)
  const ultimaFilaStatusRef = useRef<typeof jobsFila | null>(null)

  const fonteDisponivel = Boolean(fonte && fonte.status === 'available')
  const duracaoCorteUs = candidato ? Math.max(0, candidato.endUs - candidato.startUs) : 0

  // Reinicia relógio do preview quando muda o candidato ativo
  useEffect(() => {
    if (tempoAtualUsProp === undefined) setTempoAtualUsInterno(0)
    if (reproduzindoProp === undefined) setReproduzindoInterno(false)
  }, [candidato?.id, tempoAtualUsProp, reproduzindoProp])

  // Solicita proxy 9:16 quando muda o candidato/fonte ou quando ±1 Frase sai da janela em cache
  useEffect(() => {
    if (!candidato) {
      setProxyState(ESTADO_PROXY_INICIAL)
      ultimoCandidatoSolicitadoRef.current = null
      return
    }

    if (!fonte || fonte.status !== 'available') {
      const codigo = fonte?.status === 'changed' ? 'source_changed' : 'source_offline'
      setProxyState({
        ...ESTADO_PROXY_INICIAL,
        status: 'error',
        erro: new ErroCore(codigo, 'Fonte indisponível no disco.'),
      })
      ultimoCandidatoSolicitadoRef.current = candidato.id
      return
    }

    const dentroJanelaEmCache =
      ultimoCandidatoSolicitadoRef.current === candidato.id &&
      proxyState.status === 'ready' &&
      proxyState.windowStartUs !== null &&
      proxyState.windowEndUs !== null &&
      candidato.startUs >= proxyState.windowStartUs &&
      candidato.endUs <= proxyState.windowEndUs

    if (dentroJanelaEmCache) {
      void chamar('proxy.map_time', {
        window_start_us: proxyState.windowStartUs,
        window_end_us: proxyState.windowEndUs,
        source_us: candidato.startUs,
      }).catch(() => undefined)
      return
    }

    let cancelado = false
    ultimoCandidatoSolicitadoRef.current = candidato.id
    filaInicioProxyRef.current = jobsFilaRef.current
    ultimaFilaStatusRef.current = null
    setProxyState({ ...ESTADO_PROXY_INICIAL, status: 'queued' })

    void chamar<ProxyResposta>('proxy.request', {
      source_id: fonte.id,
      start_us: candidato.startUs,
      end_us: candidato.endUs,
    })
      .then((res) => {
        if (cancelado) return
        if (res.state === 'ready') {
          setProxyState({
            status: 'ready',
            key: res.key,
            jobId: res.job,
            progress: 100,
            windowStartUs: res.windowStartUs ?? null,
            windowEndUs: res.windowEndUs ?? null,
            erro: null,
          })
          if (typeof res.windowStartUs === 'number' && typeof res.windowEndUs === 'number') {
            void chamar('proxy.map_time', {
              window_start_us: res.windowStartUs,
              window_end_us: res.windowEndUs,
              source_us: candidato.startUs,
            }).catch(() => undefined)
          }
          return
        }
        if (res.state === 'failed') {
          setProxyState({
            status: 'error',
            key: res.key,
            jobId: res.job,
            progress: res.progress ?? 0,
            windowStartUs: res.windowStartUs ?? null,
            windowEndUs: res.windowEndUs ?? null,
            erro: new ErroCore(res.error ?? 'desconhecido', res.error ?? 'Falha ao gerar preview.'),
          })
          return
        }
        filaInicioProxyRef.current = jobsFilaRef.current
        ultimaFilaStatusRef.current = null
        setProxyState({
          status: res.state === 'queued' ? 'queued' : 'running',
          key: res.key,
          jobId: res.job,
          progress: res.progress ?? 0,
          windowStartUs: res.windowStartUs ?? null,
          windowEndUs: res.windowEndUs ?? null,
          erro: null,
        })
      })
      .catch((err) => {
        if (cancelado) return
        setProxyState({
          ...ESTADO_PROXY_INICIAL,
          status: 'error',
          erro: paraErroCore(err),
        })
      })

    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidato?.id, candidato?.startUs, candidato?.endUs, fonte?.id, fonte?.status, proxyTentativa])

  useEffect(() => {
    let cancelado = false
    void chamar<{ profiles: PerfilProvedorLista[] }>('provider.profiles.list', {})
      .then((res) => {
        if (!cancelado) setPerfis(res?.profiles ?? [])
      })
      .catch(() => {
        if (!cancelado) setPerfis([])
      })
    return () => {
      cancelado = true
    }
  }, [projetoId])

  // Sincroniza progresso do proxy a partir do store global da Fila (core-progress)
  const jobProxyAtivo = useMemo(() => {
    if (proxyState.jobId == null) return undefined
    const alvo = String(proxyState.jobId)
    return jobsFila.find((j) => j.id === alvo)
  }, [jobsFila, proxyState.jobId])

  useEffect(() => {
    if (!jobProxyAtivo) return
    if (proxyState.status !== 'queued' && proxyState.status !== 'running') return
    if (jobsFila === filaInicioProxyRef.current) return

    if (jobProxyAtivo.estado === 'falhou') {
      setProxyState((prev) => ({
        ...prev,
        status: 'error',
        erro: new ErroCore(
          jobProxyAtivo.erro?.code ?? 'desconhecido',
          jobProxyAtivo.erro?.message ?? 'Não foi possível gerar o preview.',
        ),
      }))
      return
    }

    if (jobProxyAtivo.estado === 'concluido' && proxyState.key) {
      if (ultimaFilaStatusRef.current === jobsFila) return
      ultimaFilaStatusRef.current = jobsFila
      const chaveConsultada = proxyState.key
      void chamar<ProxyResposta>('proxy.status', { key: chaveConsultada })
        .then((res) => {
          setProxyState((prev) => {
            if (prev.key !== chaveConsultada) return prev
            if (prev.status !== 'queued' && prev.status !== 'running') return prev
            if (res.state === 'ready') {
              return {
                ...prev,
                status: 'ready',
                progress: 100,
                erro: null,
              }
            }
            if (res.state === 'failed') {
              return {
                ...prev,
                status: 'error',
                erro: new ErroCore(res.error ?? 'desconhecido', 'Falha ao concluir preview.'),
              }
            }
            return {
              ...prev,
              status: res.state === 'queued' ? 'queued' : 'running',
              progress: res.progress ?? prev.progress,
              erro: null,
            }
          })
        })
        .catch((err) => {
          setProxyState((prev) => {
            if (prev.key !== chaveConsultada) return prev
            if (prev.status !== 'queued' && prev.status !== 'running') return prev
            return {
              ...prev,
              status: 'error',
              erro: paraErroCore(err),
            }
          })
        })
    }
  }, [jobsFila, jobProxyAtivo, proxyState.key, proxyState.status])

  // Carrega guardrails (e angles.get se transformed) apenas quando aprovado
  useEffect(() => {
    if (!candidato || candidato.status !== 'approved') {
      setGuardrails(null)
      setGuardrailsPronto(false)
      setErroGuardrails(null)
      setAngulos(null)
      setAngulosPronto(false)
      setErroAngulos(null)
      return
    }

    let cancelado = false
    setGuardrailsPronto(false)
    setErroGuardrails(null)
    setAngulosPronto(tipoVideo !== 'transformed')
    setErroAngulos(null)

    void chamar<GuardrailsSingleResposta>('guardrails.check', {
      scope: 'single',
      source_id: fonte?.id,
      candidate_id: candidato.id,
    })
      .then((res) => {
        if (!cancelado) {
          setGuardrails(res)
          setErroGuardrails(null)
          setGuardrailsPronto(true)
        }
      })
      .catch((err) => {
        if (!cancelado) {
          setGuardrails(null)
          setErroGuardrails(paraErroCore(err))
          setGuardrailsPronto(true)
        }
      })

    if (tipoVideo === 'transformed') {
      void chamar<AnglesGetResposta>('angles.get', { candidate: candidato.id })
        .then((res) => {
          if (!cancelado) {
            setAngulos(res)
            setErroAngulos(null)
            setAngulosPronto(true)
          }
        })
        .catch((err) => {
          if (!cancelado) {
            setAngulos(null)
            setErroAngulos(paraErroCore(err))
            setAngulosPronto(true)
          }
        })
    } else {
      setAngulos(null)
    }

    return () => {
      cancelado = true
    }
  }, [
    candidato?.id,
    candidato?.status,
    candidato?.startUs,
    candidato?.endUs,
    fonte?.id,
    tipoVideo,
    guardrailsTentativa,
  ])

  const cancelarPreview = useCallback(async () => {
    if (proxyState.jobId == null) return
    try {
      await chamar('jobs.cancel', { id: proxyState.jobId })
    } finally {
      setProxyState((prev) => ({ ...prev, status: 'cancelled' }))
    }
  }, [proxyState.jobId])

  const tentarProxyNovamente = useCallback(() => {
    ultimoCandidatoSolicitadoRef.current = null
    setProxyTentativa((n) => n + 1)
  }, [])

  const irParaRelocalizar = useCallback(() => {
    if (!fonte) return
    if (aoRelocalizarFonte) {
      aoRelocalizarFonte(fonte.id)
      return
    }
    window.location.hash = `#/projeto/${encodeURIComponent(projetoId)}/fontes/${fonte.id}`
  }, [aoRelocalizarFonte, fonte, projetoId])

  const confirmarDireto = useCallback(async () => {
    if (ackEmCurso) return
    setAckEmCurso(true)
    try {
      await chamar('guardrails.ack_direct_notice', {})
      setGuardrails((prev) =>
        prev ? { ...prev, directMonetizationAck: true, needsDirectNotice: false } : prev,
      )
    } finally {
      setAckEmCurso(false)
    }
  }, [ackEmCurso])

  const confirmarConversao = useCallback(async () => {
    if (!candidato || convertendo) return
    const alvoId = candidato.id
    setErroConversao(null)
    setConvertendo(true)
    try {
      const res = await chamar<RespostaSetKindCandidato>('selection.candidate.set_kind', {
        candidate: alvoId,
        videoKind: 'transformed',
      })
      if (candidatoIdAtualRef.current !== alvoId) return
      setConvertidosLocalmente((prev) => {
        const next = new Set(prev)
        next.add(alvoId)
        return next
      })
      setFocarAposConversao(true)
      setConfirmarConversaoAberto(false)
      aoConverterParaTransformado?.(alvoId, res)
      toastRef.current.add({ title: 'Corte convertido em Vídeo transformado.' })
    } catch (err) {
      if (candidatoIdAtualRef.current !== alvoId) return
      setErroConversao(paraErroCore(err))
    } finally {
      setConvertendo(false)
    }
  }, [aoConverterParaTransformado, candidato, convertendo])

  const eixos = useMemo(
    () => (candidato ? montarEixos(candidato, run) : []),
    [candidato, run],
  )
  const motivoPrincipal = useMemo(
    () => (candidato ? escolherMotivoPrincipal(candidato, eixos) : undefined),
    [candidato, eixos],
  )

  const itensGuarda: ItemGuarda[] = useMemo(() => {
    if (!candidato || candidato.status !== 'approved') return []
    const itens: ItemGuarda[] = []

    if (guardrails) {
      if (guardrails.permission.status === 'granted') {
        const detalhe = [
          guardrails.permission.who,
          guardrails.permission.where,
          guardrails.permission.scope,
        ]
          .filter(Boolean)
          .join(' · ')
        itens.push({
          id: 'permissao',
          estado: 'ok',
          titulo: 'Permissão registrada',
          detalhe: detalhe || undefined,
        })
      } else {
        itens.push({
          id: 'permissao',
          estado: 'atencao',
          titulo: 'Esta Fonte ainda não tem Permissão registrada para crédito automático.',
          acao: fonte
            ? {
                rotulo: 'Registrar Permissão',
                aoAcionar: () => {
                  window.location.hash = `#/projeto/${encodeURIComponent(projetoId)}/fontes/${fonte.id}`
                },
              }
            : undefined,
        })
      }

      if (guardrails.over60s) {
        itens.push({
          id: 'duracao',
          estado: 'atencao',
          titulo: 'Corte acima de 60 s',
          detalhe: 'Músicas com reivindicação de direitos podem bloquear monetização em Shorts.',
        })
      } else {
        itens.push({
          id: 'duracao',
          estado: 'ok',
          titulo: 'Duração dentro de 60 s',
        })
      }
    }

    if (tipoVideo === 'transformed') {
      if (angulos?.selected?.name) {
        itens.push({
          id: 'angulo',
          estado: 'ok',
          titulo: `Ângulo escolhido: ${angulos.selected.name}`,
          detalhe: 'Continue no Editor (aba Transformar) para aprovar o Roteiro e gerar Narração.',
        })
      } else {
        itens.push({
          id: 'angulo',
          estado: 'pendente',
          titulo: 'Próximo passo no Editor: escolher Ângulo → aprovar Roteiro → gerar Narração na aba Transformar',
        })
      }
    }

    return itens
  }, [angulos, candidato, fonte, guardrails, projetoId, tipoVideo])

  if (!candidato) {
    return (
      <section aria-label="Detalhe do Corte" className={cn('flex min-h-0 flex-1', className)}>
        <EstadoTela
          tipo="vazio"
          titulo="Nenhum candidato selecionado"
          descricao="Escolha um candidato na lista ao lado ou limpe os filtros ativos para revisar."
        />
      </section>
    )
  }

  const aprovado = candidato.status === 'approved'
  const rejeitado = candidato.status === 'rejected'
  const statusMeta = STATUS_DECISAO[candidato.status]
  const moves = candidato.moves ?? {
    startEarlier: true,
    startLater: true,
    endEarlier: true,
    endLater: true,
  }
  const progressoProxy =
    jobProxyAtivo && jobProxyAtivo.estado === 'rodando'
      ? jobProxyAtivo.percentual
      : proxyState.progress
  const codigoErroProxy = proxyState.erro?.code ?? ''
  const erroOffline = codigoErroProxy === 'source_offline' || codigoErroProxy === 'source_changed'
  const erroComponente =
    codigoErroProxy === 'component_missing' || codigoErroProxy === 'ffprobe_missing'
  const erroFaixaGuardrails = erroGuardrails ?? erroAngulos

  const atalhoAprovar = teclaExibida('revisao.aprovar', 'A', true)
  const atalhoRejeitar = teclaExibida('revisao.rejeitar', 'R', true)
  const atalhoInicio = teclaExibida('revisao.bordaInicio', 'I', true)
  const atalhoInicioAvancar = teclaExibida('revisao.bordaInicioAvancar', 'Shift+I', true)
  const atalhoFim = teclaExibida('revisao.bordaFim', 'O', true)
  const atalhoFimAvancar = teclaExibida('revisao.bordaFimAvancar', 'Shift+O', true)
  const atalhoEspaco = teclaExibida('transporte.reproduzir', 'Espaço', true)
  const atalhoAbrirEditor = teclaExibida('revisao.abrirEditor', 'Enter', false)

  return (
    <section
      aria-label="Detalhe do Corte"
      className={cn('flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto pt-2 pr-1 pb-4', className)}
    >
      {/* Grade superior: Preview 9:16 + Transporte à esquerda | Metadados, Nota, Eixos e Chat à direita */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[clamp(228px,30vh,260px)_1fr]">
        <div
          className="flex w-[clamp(228px,30vh,260px)] shrink-0 flex-col gap-2"
          onKeyDown={(e) => {
            if (desabilitarAtalhosLocais) return
            if ((e.target as HTMLElement).closest('input, textarea, [role="dialog"]')) return
            if (e.ctrlKey || e.metaKey || e.altKey) return
            const tecla = e.key.toLowerCase()
            if (tecla === 'k') {
              e.preventDefault()
              setReproduzindo((v) => !v)
            } else if (tecla === 'j') {
              e.preventDefault()
              setTempoAtualUs((t) => Math.max(0, t - 5_000_000))
            } else if (tecla === 'l') {
              e.preventDefault()
              setTempoAtualUs((t) => Math.min(duracaoCorteUs, t + 5_000_000))
            }
          }}
        >
          {proxyState.status === 'ready' && proxyState.key && fonteDisponivel ? (
            <PlayerProxy
              sourceId={fonte!.id}
              fonteDisponivel
              startUs={candidato.startUs}
              endUs={candidato.endUs}
              poster={mediaUrl(`proxy/${proxyState.key}`)}
              modo="previa_9_16"
              tempoAtualUs={tempoAtualUs}
              reproduzindo={reproduzindo}
              aoMudarTempoUs={setTempoAtualUs}
              aoMudarReproduzindo={setReproduzindo}
              aoPedirRelocalizacao={irParaRelocalizar}
              className="w-full"
            />
          ) : (
            <div className="relative flex aspect-[9/16] w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-area bg-preto p-4 text-center shadow-[0_0_0_1px_var(--contorno-controle)]">
              {(proxyState.status === 'queued' || proxyState.status === 'running') && (
                <>
                  <Progresso
                    valor={progressoProxy}
                    rotulo="Gerando preview 9:16"
                    className="w-full"
                  />
                  {proxyState.jobId != null && (
                    <Botao
                      tamanho="p"
                      variante="secundario"
                      onClick={() => void cancelarPreview()}
                    >
                      Cancelar preview
                    </Botao>
                  )}
                </>
              )}

              {proxyState.status === 'cancelled' && (
                <>
                  <p className="text-pequeno text-t2">Preview 9:16 cancelado.</p>
                  <Botao tamanho="p" variante="secundario" onClick={tentarProxyNovamente}>
                    Gerar preview novamente
                  </Botao>
                </>
              )}

              {proxyState.status === 'error' && erroOffline && (
                <>
                  <FileQuestion className="size-5 stroke-[1.5] text-t3" aria-hidden />
                  <p className="text-pequeno text-t2">
                    O arquivo da Fonte foi movido ou alterado; não é possível exibir o preview.
                  </p>
                  <Botao tamanho="p" variante="secundario" onClick={irParaRelocalizar}>
                    Ir para Fontes e relocalizar
                  </Botao>
                </>
              )}

              {proxyState.status === 'error' && erroComponente && (
                <>
                  <AlertTriangle className="size-5 stroke-[1.5] text-t3" aria-hidden />
                  <p className="text-pequeno text-t2">
                    Falta o FFmpeg para gerar o preview 9:16.
                  </p>
                  <Botao
                    tamanho="p"
                    variante="secundario"
                    onClick={() => {
                      window.location.hash = '#/config/componentes'
                    }}
                  >
                    Instalar componente
                  </Botao>
                </>
              )}

              {proxyState.status === 'error' && !erroOffline && !erroComponente && (
                <>
                  <AlertTriangle className="size-5 stroke-[1.5] text-erro" aria-hidden />
                  <p className="text-pequeno text-t2">
                    {proxyState.erro
                      ? mensagemDeErro(proxyState.erro).titulo
                      : 'Não foi possível gerar o preview 9:16.'}
                  </p>
                  <Botao tamanho="p" variante="secundario" onClick={tentarProxyNovamente}>
                    Tentar novamente
                  </Botao>
                </>
              )}

              {proxyState.status === 'idle' && (
                <Progresso valor={null} rotulo="Preparando preview 9:16" className="w-full" />
              )}
            </div>
          )}

          <Transporte
            compacto
            desabilitado={!fonteDisponivel || proxyState.status !== 'ready'}
            tempoUs={tempoAtualUs}
            duracaoUs={duracaoCorteUs}
            reproduzindo={reproduzindo}
            mudo={mudo}
            atalhoReproduzir={atalhoEspaco ?? null}
            aoAlternar={() => setReproduzindo((v) => !v)}
            aoInicio={() => setTempoAtualUs(0)}
            aoFim={() => setTempoAtualUs(duracaoCorteUs)}
            aoAlternarMudo={() => setMudo((v) => !v)}
            className="w-full justify-between"
          />
        </div>

        <div className="flex max-w-[640px] min-w-0 flex-1 flex-col gap-3.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-pequeno text-t3">
            <Status tom={statusMeta.tom}>{statusMeta.rotulo}</Status>
            <span aria-hidden>·</span>
            <span className="num">{duracao(duracaoCorteUs)}</span>
            <span aria-hidden>·</span>
            <SeloTipoVideo tipo={tipoVideo} />
            <span aria-hidden>·</span>
            <span>
              Gerado por {formatarPerfilCandidato(candidato.profile, perfis)} · revisão {candidato.revision}
              {candidato.windows.length > 0 && (
                <> · Janelas {candidato.windows.map((w) => w + 1).join(', ')}</>
              )}
            </span>
            {tipoVideo === 'direct' && (
              <Botao
                tamanho="p"
                variante="fantasma"
                icone={<Sparkles />}
                carregando={convertendo}
                onClick={() => {
                  setErroConversao(null)
                  setFocarAposConversao(false)
                  setConfirmarConversaoAberto(true)
                }}
              >
                Converter em Vídeo transformado
              </Botao>
            )}
          </div>

          <h2 className="text-titulo font-forte tracking-[-0.01em] text-t1">
            {candidato.title.trim() || 'Sem título'}
          </h2>

          <div className="flex flex-col gap-2">
            <BadgeNota nota={candidato.total} motivo={motivoPrincipal} modo="detalhe" />
            <EixosNota key={candidato.id} eixos={eixos} />
          </div>

          {candidato.adjusted && (
            <p className="text-pequeno text-t3">{formatarAjusteSelecao(candidato.adjust)}</p>
          )}

          {candidato.chat && candidato.chat.length > 0 && (
            <ul aria-label="Picos de chat" className="m-0 flex list-none flex-wrap gap-2 p-0">
              {candidato.chat.map((pico, idx) => (
                <li
                  key={`${pico.atUs}-${idx}`}
                  className="inline-flex items-center gap-1.5 rounded-controle bg-area px-2.5 py-1 text-pequeno text-t2"
                >
                  <MessageSquare className="size-[13px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
                  <span className="num">{formatarPicoChat(pico)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Bloco médio: Ajuste de bordas por Frase (±1 Frase) */}
      <section aria-label="Ajuste de bordas por Frase" className="flex max-w-[760px] flex-col gap-2">
        <div
          role="group"
          aria-label="Borda inicial"
          className="grid min-w-0 grid-cols-[46px_70px_auto_1fr] items-center gap-2"
        >
          <span className="text-pequeno text-t3">Início</span>
          <span className="num text-pequeno text-t2">{tcLongo(candidato.startUs)}</span>
          <span className="inline-flex items-center gap-1">
            <Botao
              tamanho="p"
              variante="suave"
              aria-label={atalhoInicio ? `Recuar início 1 Frase (${atalhoInicio})` : 'Recuar início 1 Frase'}
              disabled={!moves.startEarlier || ocupadoAjuste}
              onClick={() => void aoAjustar(candidato.id, 'start', -1)}
            >
              −1 Frase
            </Botao>
            <Botao
              tamanho="p"
              variante="suave"
              aria-label={
                atalhoInicioAvancar
                  ? `Avançar início 1 Frase (${atalhoInicioAvancar})`
                  : 'Avançar início 1 Frase'
              }
              disabled={!moves.startLater || ocupadoAjuste}
              onClick={() => void aoAjustar(candidato.id, 'start', 1)}
            >
              +1 Frase
            </Botao>
            {atalhoInicio && <Kbd>{atalhoInicio}</Kbd>}
          </span>
          <span className="min-w-0 truncate text-pequeno text-t3" title={candidato.startText}>
            {candidato.startText}
          </span>
        </div>

        <div
          role="group"
          aria-label="Borda final"
          className="grid min-w-0 grid-cols-[46px_70px_auto_1fr] items-center gap-2"
        >
          <span className="text-pequeno text-t3">Fim</span>
          <span className="num text-pequeno text-t2">{tcLongo(candidato.endUs)}</span>
          <span className="inline-flex items-center gap-1">
            <Botao
              tamanho="p"
              variante="suave"
              aria-label={atalhoFim ? `Recuar fim 1 Frase (${atalhoFim})` : 'Recuar fim 1 Frase'}
              disabled={!moves.endEarlier || ocupadoAjuste}
              onClick={() => void aoAjustar(candidato.id, 'end', -1)}
            >
              −1 Frase
            </Botao>
            <Botao
              tamanho="p"
              variante="suave"
              aria-label={
                atalhoFimAvancar ? `Avançar fim 1 Frase (${atalhoFimAvancar})` : 'Avançar fim 1 Frase'
              }
              disabled={!moves.endLater || ocupadoAjuste}
              onClick={() => void aoAjustar(candidato.id, 'end', 1)}
            >
              +1 Frase
            </Botao>
            {atalhoFim && <Kbd>{atalhoFim}</Kbd>}
          </span>
          <span className="min-w-0 truncate text-pequeno text-t3" title={candidato.endText}>
            {candidato.endText}
          </span>
        </div>

        <p className="num text-pequeno text-t3">
          Duração atual: {duracao(duracaoCorteUs)} (limites desta execução: {duracao(run.minUs)} –{' '}
          {duracao(run.maxUs)}) · Bordas sempre em Frase inteira.
        </p>

        {erroAjuste && (
          <BannerErroCore
            erro={{ code: erroAjuste.code, message: erroAjuste.detalhe }}
            traduzir={(code) => mensagemDeErro(new ErroCore(code, erroAjuste.detalhe))}
          />
        )}
      </section>

      {/* Barra de decisão e passagem — Regra da Luz Única: sempre 1 botão primário */}
      <div className="flex flex-wrap items-center gap-2">
        <Botao
          ref={btnAprovarRef}
          variante={aprovado ? 'secundario' : 'primario'}
          icone={<Check />}
          atalho={atalhoAprovar}
          aria-pressed={aprovado}
          onClick={() => void aoDecidir(candidato.id, 'approved')}
        >
          {aprovado ? 'Aprovado' : 'Aprovar'}
        </Botao>
        <Botao
          variante="secundario"
          icone={<X />}
          atalho={atalhoRejeitar}
          aria-pressed={rejeitado}
          onClick={() => void aoDecidir(candidato.id, 'rejected')}
        >
          Rejeitar
        </Botao>
        <Botao
          variante={aprovado ? 'primario' : 'fantasma'}
          atalho={atalhoAbrirEditor}
          disabled={!aprovado}
          aria-describedby={!aprovado ? idMotivoAbrir : undefined}
          onClick={() => aoAbrirEditor(candidato.id)}
        >
          Abrir no editor
        </Botao>
        {!aprovado && (
          <span id={idMotivoAbrir} className="text-pequeno text-t3">
            Aprove este candidato para editar ou exportar
          </span>
        )}
      </div>

      {/* Faixa contextual de guarda-corpos (visível apenas quando aprovado) */}
      {aprovado && guardrailsPronto && angulosPronto && (
        <div className="max-w-[640px]">
          {erroFaixaGuardrails ? (
            <BannerErroCore
              erro={{
                code: erroFaixaGuardrails.code,
                message: erroFaixaGuardrails.detalhe,
              }}
              traduzir={(code) =>
                mensagemDeErro(new ErroCore(code, erroFaixaGuardrails.detalhe))
              }
              acaoRecuperacao={{
                rotulo: 'Tentar de novo',
                aoAcionar: () => setGuardrailsTentativa((n) => n + 1),
              }}
            />
          ) : (
            <ChecklistGuardaCorpos
              key={`guard-${candidato.id}-${tipoVideo}`}
              escopo="single"
              itens={itensGuarda}
              abertoPorPadrao={
                itensGuarda.some((i) => i.estado !== 'ok') ||
                (tipoVideo === 'direct' && Boolean(guardrails?.needsDirectNotice)) ||
                tipoVideo === 'transformed'
              }
              aoConfirmarDireto={
                tipoVideo === 'direct' && guardrails?.needsDirectNotice
                  ? confirmarDireto
                  : undefined
              }
              confirmado={Boolean(guardrails?.directMonetizationAck)}
            />
          )}
        </div>
      )}

      <ConfirmDialog
        aberto={confirmarConversaoAberto}
        aoMudarAberto={(proximo) => {
          if (convertendo) return
          setConfirmarConversaoAberto(proximo)
          if (!proximo) setErroConversao(null)
        }}
        titulo="Converter em Vídeo transformado?"
        descricao="Este Corte passará a ser um Vídeo transformado, liberando a aba Transformar no Editor para Ângulo, Roteiro e Narração. Essa conversão não pode ser desfeita."
        rotuloCancelar="Cancelar"
        rotuloConfirmar="Confirmar conversão"
        ocupado={convertendo}
        focoInicial="cancelar"
        focoFinal={focarAposConversao ? btnAprovarRef : undefined}
        aoConfirmar={confirmarConversao}
      >
        {erroConversao && (
          <BannerErroCore
            erro={{
              code: erroConversao.code,
              message: erroConversao.detalhe || erroConversao.message,
            }}
            traduzir={(code) => mensagemDeErro(new ErroCore(code, erroConversao.detalhe))}
            aoDispensar={() => setErroConversao(null)}
          />
        )}
      </ConfirmDialog>
    </section>
  )
}
