import {
  BannerErroCore,
  Botao,
  Checkbox,
  ConfirmDialog,
  Dica,
  Progresso,
  ResumoCustoPrivacidade,
  Status,
  cn,
  duracao,
  tcLongo,
  usd,
  useToast,
} from '@ds'
import { Activity, MessageSquare, Pause, Play, RefreshCw, ShieldAlert } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { chamar, ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila } from '~/core/progresso'
import type { FonteProjeto, TranscriptStatusFonte } from '~/stores/fontesProjeto'

type MotorEscolha = 'local' | 'groq'

type HardwareStatus = {
  gpu: { name: string; driver: string; total_mib: number; free_mib: number } | null
  ram: { total: number; available: number } | null
  cuda: boolean
  no_compatible_gpu: boolean
  effective: { model: string; device: string; compute_type: string }
  manual: boolean
  fallback_reason: string | null
  worker_installed?: boolean
}

type GroupingStatus = {
  enabled: boolean
  mode: 'auto' | 'manual'
  size: number
  measured_size: number | null
}

type EstimateSample = {
  model: string
  device: string
  compute_type: string
  load_s: number
  rate: number
  estimate_s: number
  low_s: number
  high_s: number
  cached: boolean
  cpu: boolean
  warnings?: string[]
}

type GroqInfo = {
  endpoint: string
  model: string
  configured: boolean
  confirmed: boolean
  local_only: boolean
  prices?: {
    minimum_seconds?: number
    models?: Record<string, { hourly_usd?: number }>
  }
}

type GroqEstimate = {
  kind: 'usd' | string
  usd?: number
  minMicroUsd: number
  maxMicroUsd: number
  audio_us: number
  hourly_usd?: number
}

type BlocoTranscricao = {
  start_us: number
  end_us: number
  device: string | null
  compute_type: string | null
}

type EnergyStatus = {
  measured: boolean
  marks: { high: number; peak: number }
  job: { id: number; state: string; progress: number } | null
}

type ChatStatus = {
  state: 'none' | 'available' | 'absent' | string
  canFetch: boolean
  intervals: number
  messages: number
  peaks: number
  job: { id: number; state: string; progress: number } | null
}

type ConfirmacaoMotor =
  | {
      tipo: 'replace'
      engine: MotorEscolha
      blocks: number
      paidAudioUs: number
      paidUsd: number
    }
  | {
      tipo: 'retry'
      engine: MotorEscolha
      usdEstimado?: number
    }
  | {
      tipo: 'groq_consent'
      engine: 'groq'
    }

const BLOCO_PADRAO_US = 600_000_000

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

function duracaoFonteUs(fonte: FonteProjeto, transcriptStatus: TranscriptStatusFonte | null): number {
  const doTranscript = transcriptStatus?.transcript?.duration_us ?? 0
  if (doTranscript > 0) return doTranscript
  const seg = Number(fonte.metadata?.format?.duration ?? 0)
  return Number.isFinite(seg) && seg > 0 ? Math.round(seg * 1_000_000) : 0
}

function extrairUsoTroca(usage: unknown): { blocks: number; paidAudioUs: number; paidUsd: number } {
  if (!usage || typeof usage !== 'object') {
    return { blocks: 1, paidAudioUs: 0, paidUsd: 0 }
  }
  const u = usage as { blocks?: unknown; paid_audio_us?: unknown; paid_usd?: unknown }
  return {
    blocks: typeof u.blocks === 'number' && u.blocks >= 0 ? u.blocks : 1,
    paidAudioUs: typeof u.paid_audio_us === 'number' && u.paid_audio_us >= 0 ? u.paid_audio_us : 0,
    paidUsd: typeof u.paid_usd === 'number' && u.paid_usd >= 0 ? u.paid_usd : 0,
  }
}

function extrairUsoRetry(usage: unknown): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const u = usage as { estimate?: { usd?: unknown } }
  return typeof u.estimate?.usd === 'number' ? u.estimate.usd : undefined
}

function traduzirEstagio(etapa: string | undefined, blocoAtual: number, totalBlocos: number): string {
  if (etapa === 'probe') return 'Verificando placa de vídeo…'
  if (etapa === 'gpu_probe_fallback') return 'GPU indisponível — continuando na CPU'
  if (etapa === 'transcribing') {
    return `Transcrevendo bloco ${Math.min(blocoAtual, totalBlocos)} de ${totalBlocos}`
  }
  if (etapa === 'complete') return 'Transcrição concluída'
  if (etapa === 'failed') return 'Transcrição interrompida'
  return `Transcrevendo bloco ${Math.min(blocoAtual, totalBlocos)} de ${totalBlocos}`
}

export type PainelMotorSinaisProps = {
  projetoPath: string
  fonte: FonteProjeto
  transcriptStatus: TranscriptStatusFonte | null
  localOnly?: boolean
  aoAtualizarStatus: () => Promise<void>
  aoPedirRelocalizacao?: () => void
  aoFocarMotorRef?: RefObject<HTMLButtonElement | null>
}

/** Painel esquerdo do Detalhe da Fonte: Motor Local/Groq, amostra 30 s, VAD #279, blocos e sinais. */
export function PainelMotorSinais({
  projetoPath,
  fonte,
  transcriptStatus,
  localOnly = false,
  aoAtualizarStatus,
  aoPedirRelocalizacao,
  aoFocarMotorRef,
}: PainelMotorSinaisProps) {
  const toast = useToast()
  const jobsFila = useFila()

  const [motor, setMotor] = useState<MotorEscolha>(
    transcriptStatus?.transcript?.engine === 'groq' ? 'groq' : 'local',
  )
  const [hardware, setHardware] = useState<HardwareStatus | null>(null)
  const [agrupamento, setAgrupamento] = useState<GroupingStatus | null>(null)
  const [groqInfo, setGroqInfo] = useState<GroqInfo | null>(null)
  const [groqEst, setGroqEst] = useState<GroqEstimate | null>(null)
  const [blocos, setBlocos] = useState<BlocoTranscricao[]>([])
  const [energia, setEnergia] = useState<EnergyStatus | null>(null)
  const [chat, setChat] = useState<ChatStatus | null>(null)

  const [estimando, setEstimando] = useState(false)
  const [estimativa, setEstimativa] = useState<EstimateSample | null>(null)
  const [iniciando, setIniciando] = useState(false)
  const [cancelandoJob, setCancelandoJob] = useState(false)
  const [avisoGpuFallback, setAvisoGpuFallback] = useState(false)
  const [erroLocal, setErroLocal] = useState<ErroCore | null>(null)
  const [confirmacao, setConfirmacao] = useState<ConfirmacaoMotor | null>(null)
  const [confirmandoDialogo, setConfirmandoDialogo] = useState(false)

  const fallbackProcessadoRef = useRef<string | null>(null)
  const ultimoBlocoRecarregadoRef = useRef<number>(-1)

  const carregarHardware = useCallback(async () => {
    try {
      const hw = await chamar<HardwareStatus>('transcription.hardware.status', {})
      setHardware(hw)
      if (hw?.fallback_reason) {
        setAvisoGpuFallback(true)
      }
    } catch {
      // erro não fatal na leitura inicial de hardware
    }
  }, [])

  const carregarBlocosESinais = useCallback(async () => {
    const [resBlocos, resEnergia, resChat] = await Promise.allSettled([
      chamar<BlocoTranscricao[]>('transcription.blocks', { source_id: fonte.id }),
      chamar<EnergyStatus>('energy.status', { source_id: fonte.id }),
      chamar<ChatStatus>('chat.status', { source_id: fonte.id }),
    ])
    if (resBlocos.status === 'fulfilled' && Array.isArray(resBlocos.value)) {
      setBlocos(resBlocos.value)
    }
    if (resEnergia.status === 'fulfilled' && resEnergia.value) {
      setEnergia(resEnergia.value)
    }
    if (resChat.status === 'fulfilled' && resChat.value) {
      setChat(resChat.value)
    }
  }, [fonte.id])

  useEffect(() => {
    let cancelado = false
    Promise.allSettled([
      chamar<HardwareStatus>('transcription.hardware.status', {}),
      chamar<GroupingStatus>('transcription.grouping', {}),
      chamar<GroqInfo>('transcription.groq.info', {}),
      chamar<GroqEstimate>('transcription.groq.estimate', { source_id: fonte.id }),
    ]).then(([resHw, resGrp, resGroqInfo, resGroqEst]) => {
      if (cancelado) return
      if (resHw.status === 'fulfilled' && resHw.value) {
        setHardware(resHw.value)
        if (resHw.value.fallback_reason) setAvisoGpuFallback(true)
      }
      if (resGrp.status === 'fulfilled' && resGrp.value) {
        setAgrupamento(resGrp.value)
      }
      if (resGroqInfo.status === 'fulfilled' && resGroqInfo.value) {
        setGroqInfo(resGroqInfo.value)
      }
      if (resGroqEst.status === 'fulfilled' && resGroqEst.value) {
        setGroqEst(resGroqEst.value)
      }
    })
    void carregarBlocosESinais()
    return () => {
      cancelado = true
    }
  }, [carregarBlocosESinais, fonte.id])

  const transcript = transcriptStatus?.transcript ?? null
  const jobTranscricao = transcriptStatus?.job ?? null
  const transcricaoRodando =
    jobTranscricao?.state === 'queued' || jobTranscricao?.state === 'running'

  const jobFilaTranscricao = useMemo(() => {
    if (!jobTranscricao?.id) return undefined
    return jobsFila.find((j) => j.id === String(jobTranscricao.id))
  }, [jobTranscricao?.id, jobsFila])

  const jobFilaEstimativa = useMemo(
    () => jobsFila.find((j) => j.id === 'transcription-estimate' && j.estado === 'rodando'),
    [jobsFila],
  )

  const jobFilaEnergia = useMemo(() => {
    if (energia?.job?.id) {
      return jobsFila.find((j) => j.id === String(energia.job!.id))
    }
    return jobsFila.find((j) => j.etapa === 'energy' && j.estado === 'rodando')
  }, [energia?.job, jobsFila])

  const jobFilaChat = useMemo(() => {
    if (chat?.job?.id) {
      return jobsFila.find((j) => j.id === String(chat.job!.id))
    }
    return jobsFila.find((j) => j.etapa === 'chat' && j.estado === 'rodando')
  }, [chat?.job, jobsFila])

  // Reage a gpu_probe_fallback e recarrega blocos ao avançar
  useEffect(() => {
    if (!jobFilaTranscricao) return
    if (
      jobFilaTranscricao.etapa === 'gpu_probe_fallback' &&
      fallbackProcessadoRef.current !== jobFilaTranscricao.id
    ) {
      fallbackProcessadoRef.current = jobFilaTranscricao.id
      setAvisoGpuFallback(true)
      void carregarHardware()
    }
    const marco = Math.floor(jobFilaTranscricao.percentual / 10)
    if (marco > ultimoBlocoRecarregadoRef.current) {
      ultimoBlocoRecarregadoRef.current = marco
      void chamar<BlocoTranscricao[]>('transcription.blocks', { source_id: fonte.id })
        .then((b) => Array.isArray(b) && setBlocos(b))
        .catch(() => {})
    }
    if (jobFilaTranscricao.estado === 'concluido' || jobFilaTranscricao.estado === 'falhou') {
      void carregarBlocosESinais()
      void aoAtualizarStatus()
    }
  }, [aoAtualizarStatus, carregarBlocosESinais, carregarHardware, fonte.id, jobFilaTranscricao])

  // Atualiza cartões de energia/chat quando eventos terminam
  useEffect(() => {
    if (jobFilaEnergia && (jobFilaEnergia.estado === 'concluido' || jobFilaEnergia.estado === 'falhou')) {
      void chamar<EnergyStatus>('energy.status', { source_id: fonte.id })
        .then((e) => e && setEnergia(e))
        .catch(() => {})
    }
  }, [fonte.id, jobFilaEnergia])

  useEffect(() => {
    if (jobFilaChat && (jobFilaChat.estado === 'concluido' || jobFilaChat.estado === 'falhou')) {
      void chamar<ChatStatus>('chat.status', { source_id: fonte.id })
        .then((c) => c && setChat(c))
        .catch(() => {})
    }
  }, [fonte.id, jobFilaChat])

  const fonteDisponivel = fonte.status === 'available'
  const bloqueadoSomenteLocal = Boolean(localOnly || groqInfo?.local_only)
  const duracaoTotalUs = duracaoFonteUs(fonte, transcriptStatus)
  // Nota #307: total previsto de blocos calculado no cliente até #307 expor no núcleo
  const totalBlocos = Math.max(1, Math.ceil(duracaoTotalUs / BLOCO_PADRAO_US))

  const pctResume =
    duracaoTotalUs > 0 && transcript ? Math.min(100, (transcript.resume_us / duracaoTotalUs) * 100) : 0
  const pctJob = jobFilaTranscricao?.percentual ?? jobTranscricao?.progress ?? 0
  const progressoDeterministico =
    transcript?.state === 'complete'
      ? 100
      : transcricaoRodando
        ? Math.max(pctResume, pctJob)
        : pctResume

  const etaRestanteUs = useMemo(() => {
    if (!estimativa?.estimate_s || !transcricaoRodando) return null
    const restante = Math.max(0, 1 - progressoDeterministico / 100)
    return Math.round(estimativa.estimate_s * restante * 1_000_000)
  }, [estimativa?.estimate_s, progressoDeterministico, transcricaoRodando])

  const blocoAtual = Math.min(totalBlocos, Math.max(1, blocos.length + (transcricaoRodando ? 1 : 0)))

  const alterarAgrupamento = async (args: { auto: true } | { enabled: boolean }) => {
    setErroLocal(null)
    try {
      const prox = await chamar<GroupingStatus>('transcription.grouping', args)
      setAgrupamento(prox)
    } catch (err) {
      setErroLocal(normalizarErro(err))
    }
  }

  const medirAmostra = async () => {
    if (!fonteDisponivel || estimando) return
    setErroLocal(null)
    setEstimando(true)
    try {
      const res = await chamar<EstimateSample>('transcription.estimate', {
        project: projetoPath,
        source_id: fonte.id,
        remeasure: Boolean(estimativa),
      })
      setEstimativa(res)
    } catch (err) {
      const e = normalizarErro(err)
      if (e.code !== 'cancelled') {
        setErroLocal(e)
      }
    } finally {
      setEstimando(false)
    }
  }

  const cancelarAmostra = async () => {
    try {
      await chamar('components.cancel', { id: 'transcription-estimate' })
    } catch {
      // ignora se já finalizou
    }
  }

  const confirmarGroq = async (aceito: boolean) => {
    if (!aceito || !groqInfo) return
    setErroLocal(null)
    try {
      await chamar('transcription.groq.confirm', {
        endpoint: groqInfo.endpoint,
        confirmed: true,
      })
      setGroqInfo((prev) => (prev ? { ...prev, confirmed: true } : prev))
    } catch (err) {
      setErroLocal(normalizarErro(err))
    }
  }

  const iniciarTranscricao = async (opcoes?: {
    engine?: MotorEscolha
    replaceConfirmed?: boolean
    retryConfirmed?: boolean
  }) => {
    const engineAlvo = opcoes?.engine ?? motor
    if (!fonteDisponivel || iniciando) return
    if (engineAlvo === 'groq' && bloqueadoSomenteLocal) return

    setErroLocal(null)
    setIniciando(true)
    try {
      await chamar('transcription.start', {
        project: projetoPath,
        source_id: fonte.id,
        engine: engineAlvo,
        ...(opcoes?.replaceConfirmed ? { replace_confirmed: true } : {}),
        ...(opcoes?.retryConfirmed ? { retry_confirmed: true } : {}),
      })
      await Promise.all([aoAtualizarStatus(), carregarBlocosESinais()])
    } catch (err) {
      const e = normalizarErro(err)
      if (e.code === 'engine_change_confirmation') {
        const uso = extrairUsoTroca(e.usage)
        setConfirmacao({
          tipo: 'replace',
          engine: engineAlvo,
          blocks: uso.blocks,
          paidAudioUs: uso.paidAudioUs,
          paidUsd: uso.paidUsd,
        })
      } else if (e.code === 'transcription_retry_confirmation') {
        setConfirmacao({
          tipo: 'retry',
          engine: engineAlvo,
          usdEstimado: extrairUsoRetry(e.usage),
        })
      } else if (e.code === 'confirmation_required' && engineAlvo === 'groq') {
        setConfirmacao({ tipo: 'groq_consent', engine: 'groq' })
      } else {
        setErroLocal(e)
      }
    } finally {
      setIniciando(false)
    }
  }

  const confirmarDialogoMotor = async () => {
    if (!confirmacao) return
    setConfirmandoDialogo(true)
    try {
      if (confirmacao.tipo === 'replace') {
        const eng = confirmacao.engine
        setConfirmacao(null)
        await iniciarTranscricao({ engine: eng, replaceConfirmed: true })
      } else if (confirmacao.tipo === 'retry') {
        const eng = confirmacao.engine
        setConfirmacao(null)
        await iniciarTranscricao({ engine: eng, retryConfirmed: true })
      } else if (confirmacao.tipo === 'groq_consent') {
        if (groqInfo) {
          await chamar('transcription.groq.confirm', {
            endpoint: groqInfo.endpoint,
            confirmed: true,
          })
          setGroqInfo((prev) => (prev ? { ...prev, confirmed: true } : prev))
        }
        setConfirmacao(null)
        await iniciarTranscricao({ engine: 'groq' })
      }
    } finally {
      setConfirmandoDialogo(false)
    }
  }

  const cancelarJob = async (jobId: number) => {
    if (cancelandoJob) return
    setCancelandoJob(true)
    setErroLocal(null)
    try {
      await chamar('jobs.cancel', { id: jobId })
      await Promise.all([aoAtualizarStatus(), carregarBlocosESinais()])
    } catch (err) {
      setErroLocal(normalizarErro(err))
    } finally {
      setCancelandoJob(false)
    }
  }

  const iniciarEnergia = async () => {
    if (!fonteDisponivel) return
    setErroLocal(null)
    try {
      await chamar('energy.start', { source_id: fonte.id })
      toast.add({ title: 'Medição de energia do áudio iniciada.' })
      await carregarBlocosESinais()
    } catch (err) {
      setErroLocal(normalizarErro(err))
    }
  }

  const buscarChat = async () => {
    setErroLocal(null)
    try {
      await chamar('chat.fetch', { source_id: fonte.id })
      toast.add({ title: 'Busca do replay de chat iniciada.' })
      await carregarBlocosESinais()
    } catch (err) {
      setErroLocal(normalizarErro(err))
    }
  }

  const traducaoErro = erroLocal ? mensagemDeErro(erroLocal) : null
  const usandoGpu = hardware ? !hardware.no_compatible_gpu && hardware.cuda : false
  const transcricaoConcluida = transcript?.state === 'complete'
  const parcialPausada = Boolean(transcript && transcript.state === 'running' && transcript.resume_us > 0 && !transcricaoRodando)

  const rotuloAcaoPrincipal = transcricaoConcluida
    ? 'Refazer transcrição'
    : parcialPausada
      ? `Retomar de ${tcLongo(transcript!.resume_us)}`
      : 'Iniciar transcrição'

  const energiaRodando =
    energia?.job?.state === 'queued' ||
    energia?.job?.state === 'running' ||
    jobFilaEnergia?.estado === 'rodando'
  const chatRodando =
    chat?.job?.state === 'queued' ||
    chat?.job?.state === 'running' ||
    jobFilaChat?.estado === 'rodando'

  const vramTexto = hardware?.gpu
    ? `${(hardware.gpu.free_mib / 1024).toFixed(1)} GB livres de ${(hardware.gpu.total_mib / 1024).toFixed(1)} GB`
    : 'Sem GPU dedicada'

  return (
    <div className="flex flex-col gap-3">
      {erroLocal && traducaoErro && (
        <BannerErroCore
          erro={{
            code: erroLocal.code,
            message: erroLocal.detalhe || erroLocal.message,
            usage: erroLocal.usage,
          }}
          traduzir={() => ({ titulo: traducaoErro.titulo })}
          acaoRecuperacao={
            erroLocal.code === 'local_only_violation'
              ? {
                  rotulo: 'Usar Motor Local',
                  aoAcionar: () => {
                    setMotor('local')
                    setErroLocal(null)
                  },
                }
              : traducaoErro.recuperacao
                ? {
                    rotulo: traducaoErro.recuperacao.rotulo,
                    aoAcionar: () => {
                      if (traducaoErro.recuperacao?.acao === 'relocalizar-fonte') {
                        aoPedirRelocalizacao?.()
                      } else if (traducaoErro.recuperacao?.rota) {
                        window.location.hash = traducaoErro.recuperacao.rota
                      }
                    },
                  }
                : undefined
          }
          aoDispensar={() => setErroLocal(null)}
          permitirRelato
        />
      )}

      {!fonteDisponivel && (
        <div role="alert" className="flex flex-col gap-2 rounded-area bg-area p-3">
          <div className="flex items-center gap-2 text-base font-medio text-t1">
            <ShieldAlert className="size-[15px] shrink-0 stroke-[1.75] text-t2" aria-hidden />
            <span>O arquivo da Fonte não está disponível no disco</span>
          </div>
          <p className="text-pequeno text-t2">
            Iniciar nova transcrição, amostra de 30 s e medição de energia ficam bloqueados até você
            relocalizar ou verificar o arquivo. A Transcrição já salva continua legível e editável.
          </p>
          {aoPedirRelocalizacao && (
            <div>
              <Botao variante="secundario" tamanho="p" onClick={aoPedirRelocalizacao}>
                Relocalizar / Verificar Fonte
              </Botao>
            </div>
          )}
        </div>
      )}

      {avisoGpuFallback && (
        <div role="status" className="rounded-area bg-area px-3 py-2 text-pequeno text-t2">
          <Status tom="aviso" forte>
            A verificação da GPU falhou; continuando na CPU.
          </Status>
        </div>
      )}

      {/* Cartão 1: Motor de Transcrição */}
      <section aria-label="Motor de transcrição" className="flex flex-col gap-3 rounded-area bg-area p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-forte text-t1">Motor de transcrição</h2>
          {transcricaoConcluida ? (
            <Status tom="sucesso">Concluída</Status>
          ) : transcricaoRodando ? (
            <Status tom="rodando">Em andamento</Status>
          ) : parcialPausada ? (
            <Status tom="pausado">Parcial</Status>
          ) : (
            <Status tom="neutro">Não iniciada</Status>
          )}
        </div>

        <div
          role="radiogroup"
          aria-label="Escolha do Motor de transcrição"
          onKeyDown={moverFocoRadio}
          className="flex flex-col gap-2"
        >
          {/* Opção 1: Motor Local */}
          <div
            className={cn(
              'flex flex-col gap-2.5 rounded-controle bg-chao p-2.5',
              motor === 'local' && 'marcado',
            )}
          >
            <button
              ref={aoFocarMotorRef}
              type="button"
              role="radio"
              aria-checked={motor === 'local'}
              tabIndex={motor === 'local' ? 0 : -1}
              onClick={() => setMotor('local')}
              className="foco flex cursor-pointer items-center justify-between gap-2 rounded-mini border-0 bg-transparent p-0 text-left text-base font-medio text-t1"
            >
              <span>Local — US$ 0,00</span>
              <span className="text-pequeno font-normal text-t3">não sai da máquina</span>
            </button>

            <div className="flex flex-col gap-2 pl-1">
              <p className="text-pequeno text-t2">
                {hardware
                  ? usandoGpu
                    ? `Placa de vídeo NVIDIA detectada (${hardware.gpu?.name ?? 'GPU'}) — processamento acelerado.`
                    : `Rodando no processador (CPU).${hardware.fallback_reason ? ' Fallback da GPU aplicado.' : ''}`
                  : 'Verificando hardware local…'}
              </p>

              {/* Amostra de 30 s */}
              <div className="flex flex-wrap items-center gap-2">
                <Botao
                  variante="secundario"
                  tamanho="p"
                  disabled={!fonteDisponivel || estimando || transcricaoRodando}
                  onClick={() => void medirAmostra()}
                >
                  {estimativa ? 'Medir novamente (30 s)' : 'Medir amostra 30 s'}
                </Botao>
                {estimando && (
                  <Botao tamanho="p" variante="fantasma" onClick={() => void cancelarAmostra()}>
                    Cancelar amostra
                  </Botao>
                )}
                {estimativa && (
                  <span className="num text-pequeno text-t2">
                    ETA estimado: {duracao(estimativa.low_s * 1_000_000)} –{' '}
                    {duracao(estimativa.high_s * 1_000_000)}
                  </span>
                )}
              </div>

              {estimando && (
                <Progresso
                  valor={jobFilaEstimativa?.percentual ?? null}
                  rotulo={jobFilaEstimativa?.mensagem || 'Medindo amostra de 30 s…'}
                />
              )}

              {estimativa?.warnings?.includes('low_ram') && (
                <p role="status" className="text-pequeno text-t2">
                  Memória RAM baixa para este modelo; considere acompanhar outros apps abertos.
                </p>
              )}
              {estimativa?.warnings?.includes('ram_unknown') && (
                <p role="status" className="text-pequeno text-t2">
                  Não foi possível confirmar a memória RAM disponível; acompanhe outros apps abertos.
                </p>
              )}

              {/* Detalhes técnicos recolhidos por revelação progressiva */}
              <details className="text-pequeno text-t3">
                <summary className="foco cursor-pointer rounded-mini py-0.5 text-t2 hover:text-t1">
                  Detalhes técnicos
                </summary>
                <div className="mt-1.5 flex flex-col gap-1 rounded-controle bg-elevado p-2 font-mono text-pequeno text-t2">
                  {hardware && (
                    <>
                      <span>modelo: {hardware.effective.model}</span>
                      <span>
                        dispositivo: {hardware.effective.device} · compute:{' '}
                        {hardware.effective.compute_type}
                      </span>
                      <span>VRAM: {vramTexto}</span>
                    </>
                  )}
                  <a
                    href="#/config/componentes"
                    className="foco mt-1 font-sans text-pequeno text-t1 underline"
                  >
                    Configurar componentes e hardware
                  </a>
                </div>
              </details>

              {/* Agrupamento VAD #279 */}
              <div className="flex flex-col gap-2 rounded-controle bg-area p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-pequeno font-medio text-t1">
                    Agrupamento de trechos (VAD)
                  </strong>
                  <Status tom="info">Vale para o app inteiro</Status>
                </div>

                {agrupamento && (
                  <div
                    role="radiogroup"
                    aria-label="Modo de agrupamento VAD"
                    onKeyDown={moverFocoRadio}
                    className="flex flex-col gap-1.5"
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={agrupamento.mode === 'auto'}
                      tabIndex={agrupamento.mode === 'auto' ? 0 : -1}
                      onClick={() => void alterarAgrupamento({ auto: true })}
                      className={cn(
                        'foco flex min-h-6 cursor-pointer items-center justify-between rounded-controle border-0 px-2.5 py-1 text-left text-pequeno',
                        agrupamento.mode === 'auto'
                          ? 'bg-elevado font-medio text-t1'
                          : 'bg-chao text-t2 hover:bg-hover hover:text-t1',
                      )}
                    >
                      <span>Automático (recomendado)</span>
                      <span className="num text-t3">
                        {agrupamento.enabled ? `Ligado — até ${agrupamento.size} trechos` : 'Desligado'}
                      </span>
                    </button>

                    <button
                      type="button"
                      role="radio"
                      aria-checked={agrupamento.mode === 'manual'}
                      tabIndex={agrupamento.mode === 'manual' ? 0 : -1}
                      onClick={() => void alterarAgrupamento({ enabled: agrupamento.enabled })}
                      className={cn(
                        'foco flex min-h-6 cursor-pointer items-center justify-between rounded-controle border-0 px-2.5 py-1 text-left text-pequeno',
                        agrupamento.mode === 'manual'
                          ? 'bg-elevado font-medio text-t1'
                          : 'bg-chao text-t2 hover:bg-hover hover:text-t1',
                      )}
                    >
                      <span>Manual</span>
                      <span className="num text-t3">
                        {agrupamento.enabled ? `Ligado — até ${agrupamento.size} trechos` : 'Desligado'}
                      </span>
                    </button>

                    <Checkbox
                      marcado={agrupamento.enabled}
                      aoMudar={(checked) => void alterarAgrupamento({ enabled: checked })}
                      className="text-pequeno"
                    >
                      Agrupar trechos consecutivos antes de transcrever
                    </Checkbox>
                  </div>
                )}

                <p className="rounded-controle bg-elevado px-2.5 py-1.5 text-pequeno text-t2">
                  No modo automático, o agrupamento fica ligado na CPU (acelera em ~18%) e desligado
                  na GPU (evita gastar ~1 GB extra de VRAM sem ganho medido).
                </p>
              </div>
            </div>
          </div>

          {/* Opção 2: Groq remoto */}
          <div
            className={cn(
              'flex flex-col gap-2.5 rounded-controle bg-chao p-2.5',
              motor === 'groq' && 'marcado',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                role="radio"
                aria-checked={motor === 'groq'}
                tabIndex={motor === 'groq' ? 0 : -1}
                onClick={() => setMotor('groq')}
                className="foco flex cursor-pointer items-center gap-2 rounded-mini border-0 bg-transparent p-0 text-left text-base font-medio text-t1"
              >
                <span>Groq remoto</span>
                {groqEst && !bloqueadoSomenteLocal && (
                  <span className="num text-pequeno font-normal text-t3">
                    ~{usd(groqEst.minMicroUsd)} – {usd(groqEst.maxMicroUsd)}
                  </span>
                )}
              </button>

              {bloqueadoSomenteLocal && (
                <Status tom="aviso">Indisponível no modo Somente local</Status>
              )}
            </div>

            {motor === 'groq' && (
              <div className="flex flex-col gap-2.5">
                <ResumoCustoPrivacidade
                  tarefa="Transcrição Groq"
                  perfil={{
                    id: 'groq',
                    label: 'Groq',
                    kind: 'groq',
                    model: groqInfo?.model ?? 'whisper-large-v3-turbo',
                  }}
                  localidade="remoto"
                  saiDaMaquina
                  host="api.groq.com"
                  estimativa={
                    groqEst
                      ? {
                          kind: 'usd',
                          minMicroUsd: groqEst.minMicroUsd,
                          maxMicroUsd: groqEst.maxMicroUsd,
                          nota: `Envia apenas o áudio com fala (FLAC) para fora da máquina · mínimo ${groqInfo?.prices?.minimum_seconds ?? 10} s por chamada · ${duracao(groqEst.audio_us)} restantes`,
                        }
                      : { kind: 'unknown' }
                  }
                  bloqueadoSomenteLocal={bloqueadoSomenteLocal}
                  compacto
                />

                {!groqInfo?.configured && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-controle bg-elevado px-2.5 py-2 text-pequeno text-t2">
                    <span>Chave da API do Groq não configurada no cofre.</span>
                    <a href="#/config/provedores" className="foco text-t1 underline">
                      Configurar chave do Groq
                    </a>
                  </div>
                )}

                {!bloqueadoSomenteLocal && !groqInfo?.confirmed && (
                  <Checkbox
                    marcado={Boolean(groqInfo?.confirmed)}
                    aoMudar={(v) => void confirmarGroq(v)}
                    className="text-pequeno"
                  >
                    Autorizo enviar o áudio com fala (FLAC) desta Fonte para api.groq.com
                  </Checkbox>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Botão de ação do Motor */}
        {!transcricaoRodando && (
          <div className="flex items-center gap-2">
            <Botao
              variante={transcricaoConcluida ? 'secundario' : 'primario'}
              carregando={iniciando}
              disabled={
                !fonteDisponivel ||
                (motor === 'groq' && (bloqueadoSomenteLocal || groqInfo?.configured === false))
              }
              icone={transcricaoConcluida ? <RefreshCw /> : <Play />}
              onClick={() => void iniciarTranscricao()}
            >
              {rotuloAcaoPrincipal}
            </Botao>
          </div>
        )}
      </section>

      {/* Cartão 2: Progresso e Blocos de 10 min */}
      {(transcricaoRodando || blocos.length > 0 || parcialPausada || transcricaoConcluida) && (
        <section aria-label="Blocos de 10 min" className="flex flex-col gap-2.5 rounded-area bg-area p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-forte text-t1">Blocos de 10 min</h2>
            <span className="num text-pequeno text-t2">
              {blocos.length} / {totalBlocos} blocos salvos
            </span>
          </div>

          <Progresso
            valor={progressoDeterministico}
            rotulo={
              transcricaoRodando
                ? traduzirEstagio(jobFilaTranscricao?.etapa, blocoAtual, totalBlocos)
                : transcricaoConcluida
                  ? 'Transcrição concluída'
                  : `Progresso salvo até ${tcLongo(transcript?.resume_us ?? 0)}`
            }
            detalhe={
              etaRestanteUs != null
                ? `${Math.round(progressoDeterministico)}% · ETA ~${duracao(etaRestanteUs)}`
                : `${Math.round(progressoDeterministico)}%`
            }
          />

          {blocos.length > 0 && (
            <ul className="m-0 flex max-h-36 list-none flex-col gap-1 overflow-y-auto p-0">
              {blocos.map((b, idx) => {
                const dispositivo = b.device === 'cpu' ? 'CPU' : 'GPU'
                const faixa = `${tcLongo(b.start_us)}–${tcLongo(b.end_us)}`
                return (
                  <li
                    key={`${b.start_us}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-controle bg-chao px-2 py-1 text-pequeno"
                  >
                    <span className="num text-t1">{faixa}</span>
                    <Dica
                      texto={
                        b.compute_type
                          ? `${dispositivo} (${b.compute_type})`
                          : `Processado em ${dispositivo}`
                      }
                    >
                      <span className="rounded-mini bg-elevado px-1.5 py-0.5 text-micro text-t2">
                        {dispositivo}
                      </span>
                    </Dica>
                  </li>
                )
              })}
            </ul>
          )}

          {transcricaoRodando && jobTranscricao && (
            <div className="flex flex-col gap-1.5">
              {transcript?.engine === 'groq' && (
                <p className="text-pequeno text-t3">
                  Se houver chamada paga do Groq em voo ao cancelar, ela aparecerá como incerta na
                  Fila de Jobs para revisão.
                </p>
              )}
              <Botao
                variante="secundario"
                tamanho="p"
                icone={<Pause />}
                carregando={cancelandoJob}
                onClick={() => void cancelarJob(jobTranscricao.id)}
              >
                Pausar / Cancelar mantendo blocos salvos
              </Botao>
            </div>
          )}
        </section>
      )}

      {/* Cartão 3: Sinais para Seleção de Cortes */}
      <section aria-label="Sinais para Seleção de Cortes" className="flex flex-col gap-2.5 rounded-area bg-area p-3">
        <h2 className="text-base font-forte text-t1">Sinais para Seleção de Cortes</h2>

        {/* Energia do áudio */}
        <div className="flex flex-col gap-1.5 rounded-controle bg-chao p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-pequeno font-medio text-t1">
              <Activity className="size-[14px] stroke-[1.75] text-t3" aria-hidden />
              Energia do áudio
            </span>
            {energia?.measured ? (
              <Status tom="sucesso">Medida</Status>
            ) : energiaRodando ? (
              <Status tom="rodando">Medindo</Status>
            ) : (
              <Status tom="neutro">Pendente</Status>
            )}
          </div>

          {energia?.measured ? (
            <p className="num text-pequeno text-t2">
              Medida · {energia.marks.peak} picos e {energia.marks.high} trechos altos
            </p>
          ) : energiaRodando ? (
            <div className="flex items-center justify-between gap-2">
              <span className="num text-pequeno text-t2">
                Medindo energia do áudio (
                {Math.round(jobFilaEnergia?.percentual ?? energia?.job?.progress ?? 0)}%)…
              </span>
              {energia?.job?.id && (
                <Botao
                  tamanho="p"
                  variante="fantasma"
                  onClick={() => void cancelarJob(energia.job!.id)}
                >
                  Cancelar
                </Botao>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-pequeno text-t3">
                {transcricaoConcluida
                  ? fonteDisponivel
                    ? 'Ainda não medida'
                    : 'Indisponível enquanto a Fonte estiver offline/alterada'
                  : 'Disponível após concluir a Transcrição'}
              </span>
              {transcricaoConcluida && (
                <Botao
                  variante="secundario"
                  tamanho="p"
                  disabled={!fonteDisponivel}
                  onClick={() => void iniciarEnergia()}
                >
                  Medir energia agora
                </Botao>
              )}
            </div>
          )}
        </div>

        {/* Chat da live */}
        <div className="flex flex-col gap-1.5 rounded-controle bg-chao p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-pequeno font-medio text-t1">
              <MessageSquare className="size-[14px] stroke-[1.75] text-t3" aria-hidden />
              Chat da live
            </span>
            {chat?.state === 'available' ? (
              <Status tom="sucesso">Disponível</Status>
            ) : chatRodando ? (
              <Status tom="rodando">Buscando</Status>
            ) : (
              <Status tom="neutro">
                {chat?.state === 'absent' ? 'Sem replay' : 'Não buscado'}
              </Status>
            )}
          </div>

          {chat?.state === 'available' ? (
            <p className="num text-pequeno text-t2">
              Disponível · {chat.peaks} picos em {chat.intervals} intervalos (
              {chat.messages.toLocaleString('pt-BR')} mensagens)
            </p>
          ) : chat?.state === 'absent' ? (
            <p className="text-pequeno text-t3">Esta live não possui replay de chat no YouTube.</p>
          ) : chatRodando ? (
            <div className="flex items-center justify-between gap-2">
              <span className="num text-pequeno text-t2">
                Buscando replay de chat (
                {Math.round(jobFilaChat?.percentual ?? chat?.job?.progress ?? 0)}%)…
              </span>
              {chat?.job?.id && (
                <Botao tamanho="p" variante="fantasma" onClick={() => void cancelarJob(chat.job!.id)}>
                  Cancelar
                </Botao>
              )}
            </div>
          ) : chat?.canFetch ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-pequeno text-t3">Não buscado ainda</span>
              <Botao variante="secundario" tamanho="p" onClick={() => void buscarChat()}>
                Buscar chat da live
              </Botao>
            </div>
          ) : (
            <p className="text-pequeno text-t3">
              Disponível apenas para lives importadas por URL do YouTube.
            </p>
          )}
        </div>
      </section>

      {/* Diálogo de confirmação de troca de Motor / retry / consentimento Groq */}
      <ConfirmDialog
        aberto={Boolean(confirmacao)}
        aoMudarAberto={(v) => {
          if (!v && !confirmandoDialogo) setConfirmacao(null)
        }}
        titulo={
          confirmacao?.tipo === 'replace'
            ? 'Trocar Motor e descartar progresso parcial?'
            : confirmacao?.tipo === 'retry'
              ? 'Repetir chamada paga no Groq?'
              : 'Confirmar envio remoto para o Groq?'
        }
        descricao={
          confirmacao?.tipo === 'replace' ? (
            <div className="flex flex-col gap-2">
              <p>
                Já existem <strong className="num">{confirmacao.blocks} bloco(s)</strong> salvos
                para esta Fonte. Trocar o Motor descartará o progresso parcial atual e recomeçará do
                início.
              </p>
              {(confirmacao.paidAudioUs > 0 || confirmacao.paidUsd > 0) && (
                <p className="num text-pequeno text-t2">
                  Áudio já processado no Groq: {duracao(confirmacao.paidAudioUs)} (
                  {usd(Math.round(confirmacao.paidUsd * 1_000_000))}).
                </p>
              )}
            </div>
          ) : confirmacao?.tipo === 'retry' ? (
            <p>
              A tentativa anterior no Groq terminou com resultado incerto.
              {confirmacao.usdEstimado != null && (
                <span className="num">
                  {' '}
                  Estimativa para retomar: {usd(Math.round(confirmacao.usdEstimado * 1_000_000))}.
                </span>
              )}
            </p>
          ) : (
            <p>
              O áudio com fala (FLAC) será enviado para <span className="font-mono">api.groq.com</span>{' '}
              para produzir a Transcrição.
            </p>
          )
        }
        rotuloConfirmar={
          confirmacao?.tipo === 'replace'
            ? 'Trocar Motor e recomeçar'
            : confirmacao?.tipo === 'retry'
              ? 'Repetir chamada'
              : 'Confirmar envio'
        }
        rotuloCancelar="Cancelar"
        variante={confirmacao?.tipo === 'replace' ? 'perigo' : 'primario'}
        focoInicial="cancelar"
        ocupado={confirmandoDialogo}
        aoConfirmar={confirmarDialogoMotor}
      />
    </div>
  )
}
