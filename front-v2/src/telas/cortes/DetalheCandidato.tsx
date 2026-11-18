import {
  BadgeNota,
  BannerErroCore,
  Botao,
  ChecklistGuardaCorpos,
  Dica,
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
  type EixoNota,
  type ItemGuarda,
  type TomStatus,
} from '@ds'
import { AlertTriangle, Check, FileQuestion, MessageSquare, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { chamar, ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila } from '~/core/progresso'
import type { FonteProjeto } from '~/stores/fontesProjeto'
import type { ResumoRunSelecao } from '~/stores/selecaoProjeto'
import type { CandidatoLista, ChatPicoCandidato } from '~/telas/cortes/ListaCandidatos'
import { mediaUrl } from '../../../../src/lib/media'

export interface EixoDetalheCandidato {
  score: number
  why: string
}

export interface CandidatoDetalhe extends CandidatoLista {
  startId: number
  endId: number
  axes?: Record<string, EixoDetalheCandidato>
  weights?: Array<{ key: string; weight: number }>
  reasons?: string[]
  scores?: Record<string, number>
}

export interface DetalheCandidatoProps {
  projetoId: string
  run: ResumoRunSelecao
  fonte: FonteProjeto | null
  candidato: CandidatoDetalhe | null
  erroAjuste?: ErroCore | null
  ocupadoAjuste?: boolean
  aoDecidir: (candidatoId: number, decisao: 'approved' | 'rejected') => Promise<void> | void
  aoAjustar: (candidatoId: number, borda: 'start' | 'end', delta: -1 | 1) => Promise<void> | void
  aoAbrirEditor: (candidatoId: number) => void
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

function normalizarErro(err: unknown): ErroCore {
  if (err instanceof ErroCore) return err
  if (err && typeof err === 'object' && 'code' in err) {
    const e = err as { code?: unknown; message?: unknown }
    return new ErroCore(
      typeof e.code === 'string' && e.code ? e.code : 'desconhecido',
      typeof e.message === 'string' ? e.message : '',
    )
  }
  return new ErroCore('desconhecido', err instanceof Error ? err.message : String(err ?? ''))
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

/** Coluna direita da Bancada de Revisão (C.2): PlayerProxy 9:16, Nota explicável, ±1 Frase e Guardrails. */
export function DetalheCandidato({
  projetoId,
  run,
  fonte,
  candidato,
  erroAjuste,
  ocupadoAjuste = false,
  aoDecidir,
  aoAjustar,
  aoAbrirEditor,
  aoRelocalizarFonte,
  className,
}: DetalheCandidatoProps) {
  const jobsFila = useFila()
  const idMotivoAbrir = useId()
  const idDicaDireto = useId()

  const [proxyState, setProxyState] = useState<EstadoProxyLocal>(ESTADO_PROXY_INICIAL)
  const [proxyTentativa, setProxyTentativa] = useState(0)
  const [tempoAtualUs, setTempoAtualUs] = useState(0)
  const [reproduzindo, setReproduzindo] = useState(false)
  const [mudo, setMudo] = useState(false)

  const [guardrails, setGuardrails] = useState<GuardrailsSingleResposta | null>(null)
  const [guardrailsPronto, setGuardrailsPronto] = useState(false)
  const [angulos, setAngulos] = useState<AnglesGetResposta | null>(null)
  const [angulosPronto, setAngulosPronto] = useState(false)
  const [ackEmCurso, setAckEmCurso] = useState(false)

  const ultimoCandidatoSolicitadoRef = useRef<number | null>(null)
  const statusConsultadoParaKeyRef = useRef<string | null>(null)

  const fonteDisponivel = Boolean(fonte && fonte.status === 'available')
  const duracaoCorteUs = candidato ? Math.max(0, candidato.endUs - candidato.startUs) : 0

  // Reinicia relógio do preview quando muda o candidato ativo
  useEffect(() => {
    setTempoAtualUs(0)
    setReproduzindo(false)
  }, [candidato?.id])

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
    statusConsultadoParaKeyRef.current = null
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
          erro: normalizarErro(err),
        })
      })

    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidato?.id, candidato?.startUs, candidato?.endUs, fonte?.id, fonte?.status, proxyTentativa])

  // Sincroniza progresso do proxy a partir do store global da Fila (core-progress)
  const jobProxyAtivo = useMemo(() => {
    if (proxyState.jobId == null) return undefined
    const alvo = String(proxyState.jobId)
    return jobsFila.find((j) => j.id === alvo)
  }, [jobsFila, proxyState.jobId])

  useEffect(() => {
    if (!jobProxyAtivo) return
    if (proxyState.status !== 'queued' && proxyState.status !== 'running') return

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
      if (statusConsultadoParaKeyRef.current === proxyState.key) return
      statusConsultadoParaKeyRef.current = proxyState.key
      void chamar<ProxyResposta>('proxy.status', { key: proxyState.key })
        .then((res) => {
          setProxyState((prev) => ({
            ...prev,
            status: res.state === 'failed' ? 'error' : 'ready',
            progress: res.state === 'failed' ? prev.progress : 100,
            erro:
              res.state === 'failed'
                ? new ErroCore(res.error ?? 'desconhecido', 'Falha ao concluir preview.')
                : null,
          }))
        })
        .catch((err) => {
          setProxyState((prev) => ({
            ...prev,
            status: 'error',
            erro: normalizarErro(err),
          }))
        })
    }
  }, [jobProxyAtivo, proxyState.key, proxyState.status])

  // Carrega guardrails (e angles.get se transformed) apenas quando aprovado
  useEffect(() => {
    if (!candidato || candidato.status !== 'approved') {
      setGuardrails(null)
      setGuardrailsPronto(false)
      setAngulos(null)
      setAngulosPronto(false)
      return
    }

    let cancelado = false
    setGuardrailsPronto(false)
    setAngulosPronto(run.videoKind !== 'transformed')

    void chamar<GuardrailsSingleResposta>('guardrails.check', {
      scope: 'single',
      source_id: fonte?.id,
      candidate_id: candidato.id,
    })
      .then((res) => {
        if (!cancelado) {
          setGuardrails(res)
          setGuardrailsPronto(true)
        }
      })
      .catch(() => {
        if (!cancelado) {
          setGuardrails(null)
          setGuardrailsPronto(true)
        }
      })

    if (run.videoKind === 'transformed') {
      void chamar<AnglesGetResposta>('angles.get', { candidate: candidato.id })
        .then((res) => {
          if (!cancelado) {
            setAngulos(res)
            setAngulosPronto(true)
          }
        })
        .catch(() => {
          if (!cancelado) {
            setAngulos(null)
            setAngulosPronto(true)
          }
        })
    } else {
      setAngulos(null)
    }

    return () => {
      cancelado = true
    }
  }, [candidato?.id, candidato?.status, candidato?.startUs, candidato?.endUs, fonte?.id, run.videoKind])

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

    if (run.videoKind === 'transformed') {
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
  }, [angulos, candidato, fonte, guardrails, projetoId, run.videoKind])

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
  const progressoProxy = jobProxyAtivo ? jobProxyAtivo.percentual : proxyState.progress
  const codigoErroProxy = proxyState.erro?.code ?? ''
  const erroOffline = codigoErroProxy === 'source_offline' || codigoErroProxy === 'source_changed'
  const erroComponente =
    codigoErroProxy === 'component_missing' || codigoErroProxy === 'ffprobe_missing'

  return (
    <section
      aria-label="Detalhe do Corte"
      className={cn('flex min-h-0 min-w-0 flex-col gap-5 overflow-y-auto pt-2 pr-1 pb-4', className)}
    >
      {/* Grade superior: Preview 9:16 + Transporte à esquerda | Metadados, Nota, Eixos e Chat à direita */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[clamp(204px,28vh,250px)_1fr]">
        <div
          className="flex w-[clamp(204px,28vh,250px)] shrink-0 flex-col gap-2"
          onKeyDown={(e) => {
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
            <div className="relative flex aspect-[9/16] w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-area bg-preto p-4 text-center">
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
            tempoUs={tempoAtualUs}
            duracaoUs={duracaoCorteUs}
            reproduzindo={reproduzindo}
            mudo={mudo}
            aoAlternar={() => setReproduzindo((v) => !v)}
            aoInicio={() => setTempoAtualUs(0)}
            aoFim={() => setTempoAtualUs(duracaoCorteUs)}
            aoMarcarEntrada={() => void aoAjustar(candidato.id, 'start', -1)}
            aoMarcarSaida={() => void aoAjustar(candidato.id, 'end', -1)}
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
            <SeloTipoVideo tipo={run.videoKind} />
            <span aria-hidden>·</span>
            <span>
              Gerado por {candidato.profile} · revisão {candidato.revision}
              {candidato.windows.length > 0 && (
                <> · Janelas {candidato.windows.map((w) => w + 1).join(', ')}</>
              )}
            </span>
            {run.videoKind === 'direct' && (
              <Dica texto="Conversão individual para Vídeo transformado aguarda comando no núcleo (#292).">
                <span tabIndex={0} className="inline-flex" aria-describedby={idDicaDireto}>
                  <Botao
                    tamanho="p"
                    variante="fantasma"
                    icone={<Sparkles />}
                    disabled
                  >
                    Converter em Vídeo transformado
                  </Botao>
                </span>
              </Dica>
            )}
          </div>
          {run.videoKind === 'direct' && (
            <span id={idDicaDireto} className="sr-only">
              Conversão individual para Vídeo transformado aguarda comando no núcleo (#292).
            </span>
          )}

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
              aria-label="Recuar início 1 Frase (I)"
              disabled={!moves.startEarlier || ocupadoAjuste}
              onClick={() => void aoAjustar(candidato.id, 'start', -1)}
            >
              −1 Frase
            </Botao>
            <Botao
              tamanho="p"
              variante="suave"
              aria-label="Avançar início 1 Frase (Shift+I)"
              disabled={!moves.startLater || ocupadoAjuste}
              onClick={() => void aoAjustar(candidato.id, 'start', 1)}
            >
              +1 Frase
            </Botao>
            <Kbd>I</Kbd>
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
              aria-label="Recuar fim 1 Frase (O)"
              disabled={!moves.endEarlier || ocupadoAjuste}
              onClick={() => void aoAjustar(candidato.id, 'end', -1)}
            >
              −1 Frase
            </Botao>
            <Botao
              tamanho="p"
              variante="suave"
              aria-label="Avançar fim 1 Frase (Shift+O)"
              disabled={!moves.endLater || ocupadoAjuste}
              onClick={() => void aoAjustar(candidato.id, 'end', 1)}
            >
              +1 Frase
            </Botao>
            <Kbd>O</Kbd>
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
          variante={aprovado ? 'secundario' : 'primario'}
          icone={<Check />}
          atalho="A"
          aria-pressed={aprovado}
          onClick={() => void aoDecidir(candidato.id, 'approved')}
        >
          {aprovado ? 'Aprovado' : 'Aprovar'}
        </Botao>
        <Botao
          variante="secundario"
          icone={<X />}
          atalho="R"
          aria-pressed={rejeitado}
          onClick={() => void aoDecidir(candidato.id, 'rejected')}
        >
          Rejeitar
        </Botao>
        <Botao
          variante={aprovado ? 'primario' : 'fantasma'}
          atalho="Enter"
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
          <ChecklistGuardaCorpos
            key={`guard-${candidato.id}-${run.videoKind}`}
            escopo="single"
            itens={itensGuarda}
            abertoPorPadrao={
              itensGuarda.some((i) => i.estado !== 'ok') ||
              (run.videoKind === 'direct' && Boolean(guardrails?.needsDirectNotice)) ||
              run.videoKind === 'transformed'
            }
            aoConfirmarDireto={
              run.videoKind === 'direct' && guardrails?.needsDirectNotice
                ? confirmarDireto
                : undefined
            }
            confirmado={Boolean(guardrails?.directMonetizationAck)}
          />
        </div>
      )}
    </section>
  )
}
