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
  Select,
  Status,
  cn,
  tamanho,
  useToast,
  type Aba,
  type OpcaoSelect,
} from '@ds'
import { Download, FolderCog, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SeletorCaminho } from '~/componentes/SeletorCaminho'
import { chamar, ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila } from '~/core/progresso'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import { ConfiguracoesLayout } from '~/telas/config/ConfiguracoesLayout'

type AbaComponentes = 'hardware' | 'componentes' | 'tts' | 'armazenamento'

type ManifestoItem = {
  id: string
  version: string
  size: number
  license: string
  source_url: string
}

type OpcaoHardware = {
  model: string
  device: string
  compute_type: string
  installed: boolean
  enabled: boolean
  reason: string | null
}

type StatusHardware = {
  gpu: { name: string; driver: string; total_mib: number; free_mib: number } | null
  ram: { total: number; available: number } | null
  cuda: boolean
  no_compatible_gpu: boolean
  effective: { model: string; device: string; compute_type: string }
  manual: boolean
  fallback_reason: string | null
  probe: { measured_at: number; verified: boolean; chosen: { model: string; device: string; compute_type: string } } | null
  options: OpcaoHardware[]
  worker_installed: boolean
}

type StatusAgrupamento = {
  enabled: boolean
  mode: 'auto' | 'manual'
  size: number
  measured_size: number | null
}

type ConfigArmazenamento = {
  data_dir: string
  cache_dir: string
  cache_limit_bytes: number
  ffmpeg_path?: string | null
}

type StatusFfmpeg = {
  installed: boolean
  incomplete: boolean
}

type StatusSimples = {
  installed: boolean
  version?: string | null
  pinned?: string | null
  outdated?: boolean
}

type StatusWorker = {
  installed: boolean
  outdated?: boolean
  cuda?: boolean
  gpu?: boolean
  uv?: string | null
  error?: { code: string; message: string }
  handshake?: {
    protocol: number
    worker: string
    python: string
    libs: Record<string, string | null>
  }
}

type StatusCatalogo = {
  version: number
  embeddedVersion: number
  source: 'embedded' | 'remote'
  warning: string | null
  warningCode: string | null
}

type ModeloWorker = {
  id: string
  label: string
  repo?: string
  license: string
  source_url: string
  size: number
  installed: boolean
  update_available?: boolean
  worker_installed: boolean
  recommended?: boolean
}

type TtsMotor = {
  id: string
  label: string
  componentId: string
  codeLicense?: string
  sourceUrl?: string
  prohibitedUse?: {
    textEn?: string
    summaryPt?: string
    version?: string
  }
}

type TtsModelo = {
  id: string
  engineId: string
  language: string
  label: string
  description?: string
  defaultForLanguage?: boolean
  active?: boolean
  installed: boolean
  updateAvailable?: boolean
  termsAccepted?: boolean
  license?: string
  sourceUrl?: string
  size: number
}

type TtsVoz = {
  id: string
  engineId: string
  language: string
  gender?: string
  label: string
  license?: string
  attribution?: string
  sourceUrl?: string
  models?: string[]
}

type TtsCatalogo = {
  componentInstalled?: boolean
  activeModels?: Record<string, string>
  engines?: TtsMotor[]
  models?: TtsModelo[]
  voices?: TtsVoz[]
}

type ConfirmacaoDownload = {
  titulo: string
  descricao: string
  tamanhoBytes?: number
  notaTamanho?: string
  licenca?: string
  origem?: string
  destino?: string
  termoTts?: { summaryPt: string; textEn?: string }
  aoConfirmar: () => Promise<void>
}

const ABAS: Array<Aba<AbaComponentes> & { rotulo: string }> = [
  { valor: 'hardware', rotulo: 'Hardware de Transcrição' },
  { valor: 'componentes', rotulo: 'Componentes e Modelos' },
  { valor: 'tts', rotulo: 'Vozes TTS (Narração)' },
  { valor: 'armazenamento', rotulo: 'Pastas e Armazenamento' },
]

const DICA_301 =
  'Download automático indisponível nesta plataforma; aguarda manifesto macOS (#301).'

function normalizarErro(erro: unknown): ErroCore {
  if (erro instanceof ErroCore) return erro
  if (erro && typeof erro === 'object' && 'code' in erro) {
    const e = erro as { code?: unknown; message?: unknown }
    return new ErroCore(
      typeof e.code === 'string' ? e.code : 'desconhecido',
      typeof e.message === 'string' ? e.message : '',
    )
  }
  return new ErroCore('desconhecido', erro instanceof Error ? erro.message : String(erro ?? ''))
}

function traduzirErroComponentes(erro: ErroCore): { titulo: string; explicacao?: string } {
  switch (erro.code) {
    case 'worker_missing':
    case 'model_missing':
      return {
        titulo: 'Instale o ambiente Python e o modelo recomendado antes de testar o hardware.',
      }
    case 'ram_insufficient':
      return { titulo: 'Este modelo em CPU exige pelo menos 8 GB de RAM.' }
    case 'gpu_unavailable':
      return { titulo: 'Placa NVIDIA ou aceleração CUDA não disponível neste ambiente.' }
    case 'invalid_ffmpeg':
    case 'ffprobe_missing':
      return { titulo: 'FFmpeg ou FFprobe não encontrado no caminho informado.' }
    case 'catalog_signature_invalid':
    case 'catalog_rollback':
      return {
        titulo:
          'A assinatura do catálogo remoto não pôde ser verificada; mantendo catálogo seguro embutido.',
      }
    case 'invalid_settings':
      return {
        titulo:
          'Informe pastas com caminho completo (absoluto) e limite de cache maior que zero.',
      }
    case 'component_integrity':
      return {
        titulo:
          'O arquivo do yt-dlp não passou na verificação de integridade. Reinstale para continuar.',
      }
    case 'unknown_component':
      return { titulo: DICA_301 }
    case 'download':
    case 'hash_mismatch':
      return {
        titulo: 'Falha ao baixar ou verificar o arquivo. Você pode retomar de onde parou.',
      }
    case 'terms_acceptance_required':
      return {
        titulo: 'Marque a caixa confirmando os termos de uso antes de baixar o modelo de voz.',
      }
    case 'cancelled':
      return { titulo: 'Operação cancelada.' }
    default:
      return mensagemDeErro(erro)
  }
}

function rotuloModelo(model: string): string {
  if (model === 'whisper-turbo') return 'Modelo rápido de alta precisão'
  if (model === 'whisper-small') return 'Modelo leve'
  return model
}

function rotuloDispositivo(device: string): string {
  if (device === 'cuda') return 'Placa NVIDIA'
  if (device === 'cpu') return 'Processador (CPU)'
  return device
}

function rotuloPrecisao(computeType: string): string {
  if (computeType === 'int8_float16') return 'precisão equilibrada'
  if (computeType === 'float16') return 'precisão máxima'
  if (computeType === 'int8') return 'modo econômico'
  return computeType
}

function traduzirMotivoHardware(reason: string | null): string | null {
  if (!reason) return null
  if (reason === 'no_cuda') return 'Requer placa NVIDIA e ambiente CUDA'
  if (reason === 'ram_insufficient' || reason === 'low_ram') {
    return 'Exige 8 GB de RAM para este modelo na CPU'
  }
  return reason
}

function formatarBytes(bytes: number): string {
  if (bytes < 1_000_000) {
    return `${Math.max(1, Math.round(bytes / 1000))} KB`
  }
  return tamanho(bytes)
}

function dominioDe(url?: string): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function moverFocoRadio(e: React.KeyboardEvent<HTMLDivElement>) {
  if (
    e.key !== 'ArrowDown' &&
    e.key !== 'ArrowRight' &&
    e.key !== 'ArrowUp' &&
    e.key !== 'ArrowLeft'
  ) {
    return
  }
  const botoes = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'),
  )
  if (botoes.length === 0) return
  e.preventDefault()
  const idx = botoes.indexOf(document.activeElement as HTMLButtonElement)
  const passo = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
  const prox = botoes[((idx >= 0 ? idx : 0) + passo + botoes.length) % botoes.length]
  prox.focus()
  prox.click()
}

export function ConfigComponentes({ projetoAberto }: { projetoAberto: string | null }) {
  const forcado = useEstadoForcado()
  const toast = useToast()
  const jobs = useFila()

  const [aba, setAba] = useState<AbaComponentes>('hardware')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<ErroCore | null>(null)

  const [hardware, setHardware] = useState<StatusHardware | null>(null)
  const [agrupamento, setAgrupamento] = useState<StatusAgrupamento | null>(null)
  const [manifesto, setManifesto] = useState<ManifestoItem[]>([])
  const [config, setConfig] = useState<ConfigArmazenamento | null>(null)
  const [ffmpegStatus, setFfmpegStatus] = useState<StatusFfmpeg>({
    installed: false,
    incomplete: false,
  })
  const [ytdlpStatus, setYtdlpStatus] = useState<StatusSimples>({ installed: false })
  const [ytdlpErroIntegridade, setYtdlpErroIntegridade] = useState(false)
  const [denoStatus, setDenoStatus] = useState<StatusSimples>({ installed: false })
  const [pocketTtsStatus, setPocketTtsStatus] = useState<StatusSimples>({ installed: false })
  const [workerStatus, setWorkerStatus] = useState<StatusWorker>({ installed: false })
  const [catalogStatus, setCatalogStatus] = useState<StatusCatalogo | null>(null)
  const [modelos, setModelos] = useState<ModeloWorker[]>([])
  const [ttsCatalogo, setTtsCatalogo] = useState<TtsCatalogo | null>(null)

  const [caminhoFfmpegSistema, setCaminhoFfmpegSistema] = useState('')
  const [validandoFfmpeg, setValidandoFfmpeg] = useState(false)
  const [verificandoCatalogo, setVerificandoCatalogo] = useState(false)
  const [jobLocalAtivo, setJobLocalAtivo] = useState<string | null>(null)
  const [termoTtsAceito, setTermoTtsAceito] = useState(false)
  const [confirmacao, setConfirmacao] = useState<ConfirmacaoDownload | null>(null)

  const [dataDir, setDataDir] = useState('')
  const [cacheDir, setCacheDir] = useState('')
  const [limiteGb, setLimiteGb] = useState('10')
  const [salvandoPastas, setSalvandoPastas] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setYtdlpErroIntegridade(false)
    try {
      const [
        resHw,
        resGrp,
        resMan,
        resCfg,
        resFfmpeg,
        resYtdlp,
        resDeno,
        resPocket,
        resWorker,
        resCatalog,
        resModelos,
        resTts,
      ] = await Promise.all([
        chamar<StatusHardware>('transcription.hardware.status', {}),
        chamar<StatusAgrupamento>('transcription.grouping', {}),
        chamar<ManifestoItem[]>('components.manifest', {}),
        chamar<ConfigArmazenamento>('components.settings.get', {}),
        chamar<StatusFfmpeg>('components.ffmpeg.status', {}),
        chamar<StatusSimples>('components.ytdlp.status', {}).then(
          (v) => ({ ok: true as const, value: v }),
          (e) => ({ ok: false as const, reason: e }),
        ),
        chamar<StatusSimples>('components.deno.status', {}),
        chamar<StatusSimples>('components.pocket_tts.status', {}),
        chamar<StatusWorker>('components.worker.status', {}),
        chamar<StatusCatalogo>('components.catalog.status', {}),
        chamar<ModeloWorker[]>('components.models.manifest', {}),
        chamar<TtsCatalogo>('tts.catalog', {}),
      ])

      setHardware(resHw)
      setAgrupamento(resGrp)
      setManifesto(resMan ?? [])
      setConfig(resCfg)
      if (resCfg) {
        setDataDir(resCfg.data_dir)
        setCacheDir(resCfg.cache_dir)
        setLimiteGb(String(Math.max(0.1, Number((resCfg.cache_limit_bytes / 1_000_000_000).toFixed(2)))))
        setCaminhoFfmpegSistema(resCfg.ffmpeg_path ?? '')
      }
      setFfmpegStatus(resFfmpeg ?? { installed: false, incomplete: false })
      if (resYtdlp.ok) {
        setYtdlpStatus(resYtdlp.value ?? { installed: false })
      } else {
        const e = normalizarErro(resYtdlp.reason)
        if (e.code === 'component_integrity') {
          setYtdlpErroIntegridade(true)
          setYtdlpStatus({ installed: false })
          setErro(e)
        } else {
          throw e
        }
      }
      setDenoStatus(resDeno ?? { installed: false })
      setPocketTtsStatus(resPocket ?? { installed: false })
      setWorkerStatus(resWorker ?? { installed: false })
      setCatalogStatus(resCatalog)
      setModelos(resModelos ?? [])
      setTtsCatalogo(resTts)
    } catch (e) {
      setErro(normalizarErro(e))
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar, forcado])

  const manifestoPorId = useMemo(
    () => new Map(manifesto.map((item) => [item.id, item])),
    [manifesto],
  )

  const jobDe = useCallback(
    (jobId: string) => {
      const fila = jobs.find((j) => j.id === jobId && j.estado === 'rodando')
      if (fila) return fila
      if (jobLocalAtivo === jobId) {
        return {
          id: jobId,
          etapa: 'download',
          percentual: 0,
          mensagem: 'Iniciando…',
          estado: 'rodando' as const,
          inicioMs: 0,
        }
      }
      return undefined
    },
    [jobs, jobLocalAtivo],
  )

  async function executarJob(jobId: string, fn: () => Promise<void>) {
    setErro(null)
    setJobLocalAtivo(jobId)
    try {
      await fn()
      await carregar()
    } catch (e) {
      const err = normalizarErro(e)
      if (err.code !== 'cancelled') {
        setErro(err)
      }
    } finally {
      setJobLocalAtivo(null)
    }
  }

  async function cancelarComponente(id: string) {
    try {
      await chamar('components.cancel', { id })
    } finally {
      if (jobLocalAtivo === id) setJobLocalAtivo(null)
    }
  }

  async function cancelarTts(modelId: string) {
    try {
      await chamar('tts.models.cancel', { id: modelId })
    } finally {
      if (jobLocalAtivo === `tts:${modelId}`) setJobLocalAtivo(null)
    }
  }

  async function sondarHardware() {
    await executarJob('hardware-probe', async () => {
      await chamar('transcription.hardware.probe', {})
      toast.add({ title: 'Teste de hardware concluído.' })
    })
  }

  async function escolherHardware(op: { reset?: boolean; model?: string; device?: string; compute_type?: string }) {
    setErro(null)
    try {
      const prox = await chamar<StatusHardware>('transcription.hardware.choose', op)
      setHardware(prox)
      const grp = await chamar<StatusAgrupamento>('transcription.grouping', {})
      setAgrupamento(grp)
    } catch (e) {
      setErro(normalizarErro(e))
    }
  }

  async function alterarAgrupamento(args: { auto?: true; enabled?: boolean }) {
    setErro(null)
    try {
      const prox = await chamar<StatusAgrupamento>('transcription.grouping', args)
      setAgrupamento(prox)
    } catch (e) {
      setErro(normalizarErro(e))
    }
  }

  async function validarFfmpegSistema() {
    setValidandoFfmpeg(true)
    setErro(null)
    try {
      await chamar(
        'components.ffmpeg.system',
        caminhoFfmpegSistema.trim() ? { path: caminhoFfmpegSistema.trim() } : {},
      )
      await carregar()
      toast.add({ title: 'FFmpeg do sistema validado.' })
    } catch (e) {
      setErro(normalizarErro(e))
    } finally {
      setValidandoFfmpeg(false)
    }
  }

  async function verificarCatalogo() {
    setVerificandoCatalogo(true)
    setErro(null)
    try {
      const res = await chamar<StatusCatalogo & { updated?: boolean }>('components.catalog.check', {})
      setCatalogStatus(res)
      await carregar()
      toast.add({
        title: res?.updated
          ? `Catálogo atualizado para versão ${res.version}.`
          : 'Catálogo já está na versão mais recente.',
      })
    } catch (e) {
      setErro(normalizarErro(e))
    } finally {
      setVerificandoCatalogo(false)
    }
  }

  async function escolherModeloTts(language: string, modelId: string) {
    setErro(null)
    try {
      const atualizado = await chamar<TtsCatalogo>('tts.models.choose', { language, modelId })
      setTtsCatalogo(atualizado)
    } catch (e) {
      setErro(normalizarErro(e))
    }
  }

  async function salvarPastas(e: React.FormEvent) {
    e.preventDefault()
    setSalvandoPastas(true)
    setErro(null)
    const gb = Number(limiteGb.replace(',', '.'))
    const limiteBytes = Number.isFinite(gb) && gb > 0 ? Math.round(gb * 1_000_000_000) : 0
    try {
      const salvo = await chamar<ConfigArmazenamento>('components.settings.set', {
        data_dir: dataDir.trim(),
        cache_dir: cacheDir.trim(),
        cache_limit_bytes: limiteBytes,
        ffmpeg_path: config?.ffmpeg_path ?? null,
      })
      setConfig(salvo)
      await carregar()
      toast.add({ title: 'Pastas e limite de cache salvos.' })
    } catch (e2) {
      setErro(normalizarErro(e2))
    } finally {
      setSalvandoPastas(false)
    }
  }

  function renderBotaoDownloadManifesto(
    id: string,
    rotulo: string,
    aoAcionar: (item: ManifestoItem) => void,
    jaInstalado = false,
  ) {
    const item = manifestoPorId.get(id)
    if (!item && !jaInstalado) {
      return (
        <Dica texto={DICA_301}>
          <span tabIndex={0} className="inline-flex">
            <Botao variante="secundario" tamanho="p" icone={<Download />} disabled>
              {rotulo}
            </Botao>
          </span>
        </Dica>
      )
    }
    return (
      <Botao
        variante="secundario"
        tamanho="p"
        icone={<Download />}
        disabled={Boolean(jobLocalAtivo)}
        onClick={() => {
          if (item) aoAcionar(item)
        }}
      >
        {rotulo}
      </Botao>
    )
  }

  const erroExibido =
    erro ??
    (forcado === 'erro'
      ? new ErroCore('worker_missing', 'Simulação de erro via ?estado=erro.')
      : null)

  const engineTts = ttsCatalogo?.engines?.[0]
  const modelosTtsPt: OpcaoSelect<string>[] = (ttsCatalogo?.models ?? [])
    .filter((m) => m.language === 'pt')
    .map((m) => ({ valor: m.id, rotulo: m.label }))
  const modelosTtsEn: OpcaoSelect<string>[] = (ttsCatalogo?.models ?? [])
    .filter((m) => m.language === 'en')
    .map((m) => ({ valor: m.id, rotulo: m.label }))

  const ramGb = hardware?.ram ? Math.round(hardware.ram.total / 1024 ** 3) : null
  const jobProbe = jobDe('hardware-probe')
  const jobFfmpeg = jobDe('ffmpeg')
  const jobYtdlp = jobDe('yt-dlp')
  const jobDeno = jobDe('deno')
  const jobWorker = jobDe('worker')
  const jobPocket = jobDe('pocket-tts')

  return (
    <ConfiguracoesLayout
      secao="componentes"
      projetoAberto={projetoAberto}
      titulo="Componentes e Armazenamento"
      subtitulo="Gerencie o hardware de Transcrição, ferramentas externas, modelos locais, vozes TTS e pastas do aplicativo."
    >
      <Abas
        valor={aba}
        aoMudar={(v) => {
          setErro(null)
          setAba(v)
        }}
        abas={ABAS}
        rotulo="Seções de Componentes e Armazenamento"
      />

      {erroExibido && (
        <BannerErroCore
          erro={{
            code: erroExibido.code,
            message: erroExibido.detalhe || erroExibido.message,
          }}
          traduzir={() => traduzirErroComponentes(erroExibido)}
          acaoRecuperacao={
            erroExibido.code === 'worker_missing' || erroExibido.code === 'model_missing'
              ? {
                  rotulo: 'Ir para Componentes e Modelos',
                  aoAcionar: () => {
                    setErro(null)
                    setAba('componentes')
                  },
                }
              : undefined
          }
          permitirRelato
          aoDispensar={erro ? () => setErro(null) : undefined}
        />
      )}

      {forcado === 'carregando' || carregando ? (
        <div className="rounded-area bg-area p-4">
          <Esqueleto variante="painel" rotuloAcessivel="Carregando componentes e hardware" />
        </div>
      ) : (
        <div role="tabpanel" aria-label={ABAS.find((a) => a.valor === aba)?.rotulo} className="flex flex-col gap-3">
          {aba === 'hardware' && (
            <>
              <section
                aria-label="Diagnóstico de hardware"
                className="flex flex-col gap-3 rounded-area bg-area p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-base font-medio text-t1">Diagnóstico de hardware</strong>
                  {hardware?.gpu && !hardware.no_compatible_gpu ? (
                    <Status tom="sucesso">Aceleração NVIDIA ativa</Status>
                  ) : (
                    <Status tom="neutro">Modo processador (CPU)</Status>
                  )}
                </div>

                <p className="text-pequeno text-t1">
                  {hardware?.gpu && !hardware.no_compatible_gpu
                    ? `Placa detectada: ${hardware.gpu.name} (${Math.max(1, Math.round(hardware.gpu.total_mib / 1024))} GB VRAM)`
                    : 'Sem placa NVIDIA compatível detectada'}
                  {ramGb !== null && ` · ${ramGb} GB RAM`}
                </p>

                {hardware && (
                  <p className="text-pequeno text-t2">
                    Configuração ativa:{' '}
                    <strong className="font-medio text-t1">
                      {hardware.manual ? 'Manual' : 'Automática'} —{' '}
                      {rotuloModelo(hardware.effective.model)} ·{' '}
                      {rotuloDispositivo(hardware.effective.device)}
                    </strong>
                  </p>
                )}

                {hardware?.fallback_reason && (
                  <div role="status" className="rounded-controle bg-elevado px-3 py-2 text-pequeno text-t2">
                    <Status tom="aviso">
                      O teste na placa de vídeo falhou ou expirou; usando processador como alternativa segura.
                    </Status>
                  </div>
                )}

                {hardware && (
                  <details className="text-pequeno text-t3">
                    <summary className="foco w-fit cursor-pointer rounded-controle hover:text-t2">
                      Detalhes técnicos
                    </summary>
                    <p className="mt-1.5 font-mono text-micro text-t2">
                      model: {hardware.effective.model} · device: {hardware.effective.device} ·
                      compute_type: {hardware.effective.compute_type} · cuda:{' '}
                      {String(hardware.cuda)}
                      {hardware.gpu ? ` · driver: ${hardware.gpu.driver}` : ''}
                    </p>
                  </details>
                )}

                {jobProbe && (
                  <div className="flex items-center gap-3 rounded-controle bg-elevado px-3 py-2">
                    <Progresso
                      valor={jobProbe.percentual}
                      rotulo={jobProbe.mensagem || 'Sondando hardware de transcrição…'}
                      className="flex-1"
                    />
                    <Botao
                      tamanho="p"
                      aria-label="Cancelar teste de hardware"
                      onClick={() => void cancelarComponente('hardware-probe')}
                    >
                      Cancelar
                    </Botao>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Botao
                    variante="primario"
                    carregando={Boolean(jobProbe)}
                    disabled={Boolean(jobLocalAtivo)}
                    onClick={() => void sondarHardware()}
                  >
                    Testar hardware
                  </Botao>
                  <Botao
                    variante="secundario"
                    disabled={!hardware?.manual || Boolean(jobLocalAtivo)}
                    onClick={() => void escolherHardware({ reset: true })}
                  >
                    Restaurar automático
                  </Botao>
                </div>
              </section>

              <section
                aria-label="Agrupamento de falas por silêncio (VAD)"
                className="flex flex-col gap-2.5 rounded-area bg-area p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-base font-medio text-t1">
                    Agrupamento de falas por silêncio (VAD)
                  </strong>
                  <Status tom="info">Vale para o app inteiro</Status>
                </div>

                {agrupamento && (
                  <div
                    role="radiogroup"
                    aria-label="Modo de agrupamento VAD"
                    onKeyDown={moverFocoRadio}
                    className="flex flex-col gap-2"
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={agrupamento.mode === 'auto'}
                      tabIndex={agrupamento.mode === 'auto' ? 0 : -1}
                      onClick={() => void alterarAgrupamento({ auto: true })}
                      className={cn(
                        'foco flex cursor-pointer items-center justify-between rounded-controle border-0 px-3 py-2 text-left text-pequeno',
                        agrupamento.mode === 'auto'
                          ? 'marcado bg-elevado text-t1'
                          : 'bg-chao text-t2 hover:bg-hover hover:text-t1',
                      )}
                    >
                      <span>
                        <strong className="font-medio">Automático</strong> (ligado na CPU,
                        desligado na GPU · atual: {agrupamento.enabled ? 'ligado' : 'desligado'})
                      </span>
                      <span className="num text-t3">Lote efetivo: {agrupamento.size}</span>
                    </button>

                    <button
                      type="button"
                      role="radio"
                      aria-checked={agrupamento.mode === 'manual'}
                      tabIndex={agrupamento.mode === 'manual' ? 0 : -1}
                      onClick={() =>
                        void alterarAgrupamento({ enabled: agrupamento.enabled })
                      }
                      className={cn(
                        'foco flex cursor-pointer items-center justify-between rounded-controle border-0 px-3 py-2 text-left text-pequeno',
                        agrupamento.mode === 'manual'
                          ? 'marcado bg-elevado text-t1'
                          : 'bg-chao text-t2 hover:bg-hover hover:text-t1',
                      )}
                    >
                      <span>
                        <strong className="font-medio">Manual</strong>
                      </span>
                      <span className="num text-t3">
                        {agrupamento.enabled ? `Ativo (lote ${agrupamento.size})` : 'Desligado (lote 1)'}
                      </span>
                    </button>

                    <div className="pl-2">
                      <Checkbox
                        marcado={agrupamento.enabled}
                        aoMudar={(checked) => void alterarAgrupamento({ enabled: checked })}
                      >
                        Agrupar trechos consecutivos antes de transcrever
                      </Checkbox>
                    </div>
                  </div>
                )}

                <p className="rounded-controle bg-elevado px-3 py-2 text-pequeno text-t2">
                  No modo automático, fica ligado na CPU e desligado na GPU: na CPU acelera ~18%;
                  na GPU usa ~1 GB a mais de VRAM sem ganho medido.
                </p>
              </section>

              {hardware && hardware.options.length > 0 && (
                <section
                  aria-label="Escolha manual de modelo e dispositivo"
                  className="flex flex-col gap-2 rounded-area bg-area p-3"
                >
                  <strong className="text-base font-medio text-t1">
                    Escolha manual de modelo e dispositivo
                  </strong>
                  <div
                    role="radiogroup"
                    aria-label="Combinações de hardware"
                    onKeyDown={moverFocoRadio}
                    className="flex flex-col gap-1.5"
                  >
                    {hardware.options.map((opt) => {
                      const selecionada =
                        hardware.effective.model === opt.model &&
                        hardware.effective.device === opt.device &&
                        hardware.effective.compute_type === opt.compute_type
                      const motivo = traduzirMotivoHardware(opt.reason)
                      const rotulo = `${rotuloModelo(opt.model)} · ${rotuloDispositivo(opt.device)}`

                      return (
                        <button
                          key={`${opt.model}-${opt.device}-${opt.compute_type}`}
                          type="button"
                          role="radio"
                          aria-checked={selecionada}
                          tabIndex={selecionada ? 0 : -1}
                          disabled={!opt.enabled}
                          onClick={() =>
                            void escolherHardware({
                              model: opt.model,
                              device: opt.device,
                              compute_type: opt.compute_type,
                            })
                          }
                          className={cn(
                            'foco flex cursor-pointer items-center justify-between gap-3 rounded-controle border-0 px-3 py-2 text-left text-pequeno disabled:cursor-not-allowed disabled:opacity-45',
                            selecionada
                              ? 'marcado bg-elevado text-t1'
                              : 'bg-chao text-t2 hover:bg-hover hover:text-t1',
                          )}
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className="font-medio">
                              {rotulo} ({rotuloPrecisao(opt.compute_type)})
                            </span>
                            {motivo && <span className="text-t3">{motivo}</span>}
                          </span>
                          <Status tom={opt.enabled ? (selecionada ? 'sucesso' : 'neutro') : 'aviso'}>
                            {opt.enabled ? (selecionada ? 'Ativo' : 'Disponível') : 'Indisponível'}
                          </Status>
                        </button>
                      )
                    })}
                  </div>
                </section>
              )}
            </>
          )}

          {aba === 'componentes' && (
            <>
              {/* FFmpeg */}
              <section
                aria-label="FFmpeg e FFprobe"
                className="flex flex-col gap-2 rounded-area bg-area p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <strong className="text-base font-medio text-t1">FFmpeg e FFprobe</strong>
                    {ffmpegStatus.installed && !ffmpegStatus.incomplete ? (
                      <Status tom="sucesso">Pronto</Status>
                    ) : ffmpegStatus.incomplete ? (
                      <Status tom="aviso">Incompleto</Status>
                    ) : (
                      <Status tom="pendente">Não instalado</Status>
                    )}
                  </div>
                  {renderBotaoDownloadManifesto(
                    'ffmpeg',
                    ffmpegStatus.installed ? 'Reinstalar FFmpeg' : 'Baixar FFmpeg',
                    (item) =>
                      setConfirmacao({
                        titulo: 'Baixar FFmpeg e FFprobe?',
                        descricao: 'Usado para leitura de vídeo, prévias e exportação.',
                        tamanhoBytes: item.size,
                        licenca: item.license,
                        origem: dominioDe(item.source_url),
                        destino: config?.data_dir,
                        aoConfirmar: () =>
                          executarJob('ffmpeg', async () => {
                            await chamar('components.download', { id: 'ffmpeg', confirmed: true })
                          }),
                      }),
                    ffmpegStatus.installed && !ffmpegStatus.incomplete,
                  )}
                </div>

                {jobFfmpeg && (
                  <div className="flex items-center gap-3 rounded-controle bg-elevado px-3 py-2">
                    <Progresso
                      valor={jobFfmpeg.percentual}
                      rotulo={jobFfmpeg.mensagem || 'Baixando FFmpeg…'}
                      className="flex-1"
                    />
                    <Botao
                      tamanho="p"
                      aria-label="Cancelar download de FFmpeg"
                      onClick={() => void cancelarComponente('ffmpeg')}
                    >
                      Cancelar
                    </Botao>
                  </div>
                )}

                <details className="text-pequeno text-t3">
                  <summary className="foco w-fit cursor-pointer rounded-controle hover:text-t2">
                    Usar FFmpeg já instalado no sistema
                  </summary>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <div className="min-w-64 flex-1">
                      <SeletorCaminho
                        rotulo="Caminho do FFmpeg"
                        modo="arquivo"
                        valor={caminhoFfmpegSistema}
                        aoMudar={setCaminhoFfmpegSistema}
                        placeholder="ffmpeg ou C:\ffmpeg\bin\ffmpeg.exe"
                        desabilitado={validandoFfmpeg}
                      />
                    </div>
                    <Botao
                      variante="secundario"
                      carregando={validandoFfmpeg}
                      onClick={() => void validarFfmpegSistema()}
                    >
                      Validar caminho
                    </Botao>
                  </div>
                </details>
              </section>

              {/* yt-dlp e deno */}
              <div className="grid gap-3 md:grid-cols-2">
                <section
                  aria-label="yt-dlp"
                  className="flex flex-col gap-2 rounded-area bg-area p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-base font-medio text-t1">yt-dlp</strong>
                    {ytdlpErroIntegridade ? (
                      <Status tom="perigo">Integridade inválida</Status>
                    ) : ytdlpStatus.installed ? (
                      <Status tom="sucesso">
                        Instalado{ytdlpStatus.version ? ` (${ytdlpStatus.version})` : ''}
                      </Status>
                    ) : (
                      <Status tom="pendente">Não instalado</Status>
                    )}
                  </div>

                  {jobYtdlp && (
                    <div className="flex items-center gap-2 rounded-controle bg-elevado px-3 py-2">
                      <Progresso
                        valor={jobYtdlp.percentual}
                        rotulo={jobYtdlp.mensagem || 'Baixando yt-dlp…'}
                        className="flex-1"
                      />
                      <Botao
                        tamanho="p"
                        aria-label="Cancelar download de yt-dlp"
                        onClick={() => void cancelarComponente('yt-dlp')}
                      >
                        Cancelar
                      </Botao>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {ytdlpStatus.installed && !ytdlpErroIntegridade ? (
                      <Botao
                        variante="secundario"
                        tamanho="p"
                        icone={<RefreshCw />}
                        disabled={Boolean(jobLocalAtivo)}
                        onClick={() =>
                          setConfirmacao({
                            titulo: 'Atualizar yt-dlp?',
                            descricao: 'Baixa a build mais recente verificada com assinatura PGP.',
                            licenca: manifestoPorId.get('yt-dlp')?.license ?? 'Unlicense',
                            origem: 'github.com/yt-dlp',
                            destino: config?.data_dir,
                            aoConfirmar: () =>
                              executarJob('yt-dlp', async () => {
                                await chamar('components.ytdlp.update', { confirmed: true })
                              }),
                          })
                        }
                      >
                        Atualizar yt-dlp
                      </Botao>
                    ) : (
                      renderBotaoDownloadManifesto(
                        'yt-dlp',
                        ytdlpErroIntegridade ? 'Reinstalar yt-dlp' : 'Baixar yt-dlp',
                        (item) =>
                          setConfirmacao({
                            titulo: 'Baixar yt-dlp?',
                            descricao: 'Ferramenta para importar Fontes a partir de URLs.',
                            tamanhoBytes: item.size,
                            licenca: item.license,
                            origem: dominioDe(item.source_url),
                            destino: config?.data_dir,
                            aoConfirmar: () =>
                              executarJob('yt-dlp', async () => {
                                await chamar('components.download', {
                                  id: 'yt-dlp',
                                  confirmed: true,
                                })
                              }),
                          }),
                      )
                    )}
                  </div>
                </section>

                <section
                  aria-label="deno"
                  className="flex flex-col gap-2 rounded-area bg-area p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-base font-medio text-t1">deno</strong>
                    {denoStatus.installed ? (
                      <Status tom={denoStatus.outdated ? 'aviso' : 'sucesso'}>
                        {denoStatus.outdated
                          ? 'Atualização disponível'
                          : `Instalado${denoStatus.version ? ` (${denoStatus.version})` : ''}`}
                      </Status>
                    ) : (
                      <Status tom="pendente">Não instalado</Status>
                    )}
                  </div>

                  {jobDeno && (
                    <div className="flex items-center gap-2 rounded-controle bg-elevado px-3 py-2">
                      <Progresso
                        valor={jobDeno.percentual}
                        rotulo={jobDeno.mensagem || 'Baixando deno…'}
                        className="flex-1"
                      />
                      <Botao
                        tamanho="p"
                        aria-label="Cancelar download de deno"
                        onClick={() => void cancelarComponente('deno')}
                      >
                        Cancelar
                      </Botao>
                    </div>
                  )}

                  <div>
                    {renderBotaoDownloadManifesto(
                      'deno',
                      denoStatus.installed ? 'Reinstalar deno' : 'Baixar deno',
                      (item) =>
                        setConfirmacao({
                          titulo: 'Baixar deno?',
                          descricao: 'Runtime JavaScript auxiliar para extração de URLs.',
                          tamanhoBytes: item.size,
                          licenca: item.license,
                          origem: dominioDe(item.source_url),
                          destino: config?.data_dir,
                          aoConfirmar: () =>
                            executarJob('deno', async () => {
                              await chamar('components.download', { id: 'deno', confirmed: true })
                            }),
                        }),
                      denoStatus.installed,
                    )}
                  </div>
                </section>
              </div>

              {/* Worker Python e Catálogo */}
              <section
                aria-label="Worker Python e Catálogo"
                className="flex flex-col gap-2.5 rounded-area bg-area p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <strong className="text-base font-medio text-t1">
                      Ambiente Python isolado (Worker)
                    </strong>
                    {workerStatus.installed && !workerStatus.outdated && !workerStatus.error ? (
                      <Status tom="sucesso">Pronto</Status>
                    ) : workerStatus.outdated ? (
                      <Status tom="aviso">Atualização recomendada</Status>
                    ) : workerStatus.error ? (
                      <Status tom="perigo">Erro ao iniciar</Status>
                    ) : (
                      <Status tom="pendente">Não instalado</Status>
                    )}
                  </div>

                  {renderBotaoDownloadManifesto(
                    'uv',
                    workerStatus.installed ? 'Instalar / Reparar' : 'Instalar Worker',
                    (item) =>
                      setConfirmacao({
                        titulo: 'Instalar ambiente Python isolado (Worker)?',
                        descricao:
                          'Prepara o ambiente isolado de Transcrição local e detecção facial.',
                        notaTamanho: 'Tamanho variável conforme ambiente CUDA/CPU (#307)',
                        licenca: item.license,
                        origem: dominioDe(item.source_url),
                        destino: config?.data_dir,
                        aoConfirmar: () =>
                          executarJob('worker', async () => {
                            await chamar('components.worker.install', { confirmed: true })
                          }),
                      }),
                    workerStatus.installed,
                  )}
                </div>

                <p className="text-pequeno text-t3">
                  Tamanho variável conforme ambiente CUDA/CPU (#307).
                </p>

                {workerStatus.handshake && (
                  <details className="text-pequeno text-t3">
                    <summary className="foco w-fit cursor-pointer rounded-controle hover:text-t2">
                      Detalhes técnicos
                    </summary>
                    <p className="mt-1 font-mono text-micro text-t2">
                      handshake: protocol {workerStatus.handshake.protocol} · python{' '}
                      {workerStatus.handshake.python} · uv {workerStatus.uv ?? '—'}
                    </p>
                  </details>
                )}

                {jobWorker && (
                  <div className="flex items-center gap-3 rounded-controle bg-elevado px-3 py-2">
                    <Progresso
                      valor={jobWorker.percentual}
                      rotulo={jobWorker.mensagem || 'Instalando Worker…'}
                      className="flex-1"
                    />
                    <Botao
                      tamanho="p"
                      aria-label="Cancelar instalação do Worker"
                      onClick={() => void cancelarComponente('worker')}
                    >
                      Cancelar
                    </Botao>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-controle bg-elevado px-3 py-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-pequeno text-t1">
                      Catálogo de modelos: versão{' '}
                      <span className="num font-medio">{catalogStatus?.version ?? 1}</span> (
                      {catalogStatus?.source === 'remote' ? 'remoto verificado' : 'embutido'})
                    </span>
                    {catalogStatus?.warning && (
                      <span className="text-pequeno text-erro">{catalogStatus.warning}</span>
                    )}
                  </div>
                  <Botao
                    variante="secundario"
                    tamanho="p"
                    carregando={verificandoCatalogo}
                    onClick={() => void verificarCatalogo()}
                  >
                    Verificar catálogo de modelos
                  </Botao>
                </div>
              </section>

              {/* Modelos ML */}
              <section
                aria-label="Modelos de Transcrição e Enquadramento"
                className="flex flex-col gap-2 rounded-area bg-area p-3"
              >
                <strong className="text-base font-medio text-t1">
                  Modelos de Transcrição e Enquadramento
                </strong>

                {modelos.length === 0 ? (
                  <EstadoTela
                    tipo="vazio"
                    compacto
                    titulo="Nenhum modelo no catálogo"
                    descricao="Não há modelos listados no catálogo atual."
                    acaoPrimaria={{
                      rotulo: 'Verificar catálogo',
                      aoAcionar: () => void verificarCatalogo(),
                    }}
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    {modelos.map((m) => {
                      const jobModelo = jobDe(m.id)
                      return (
                        <section
                          key={m.id}
                          aria-label={m.label}
                          className="flex flex-col gap-2 rounded-controle bg-elevado p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <strong className="text-base font-medio text-t1">{m.label}</strong>
                                {m.installed ? (
                                  <Status tom={m.update_available ? 'aviso' : 'sucesso'}>
                                    {m.update_available ? 'Atualização disponível' : 'Instalado'}
                                  </Status>
                                ) : (
                                  <Status tom="pendente">Não instalado</Status>
                                )}
                              </div>
                              <p className="mt-0.5 text-pequeno text-t3">
                                <span className="num">{formatarBytes(m.size)}</span> · {m.license} ·{' '}
                                <a
                                  href={m.source_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline hover:text-t1"
                                >
                                  Código-fonte
                                </a>
                              </p>
                            </div>

                            {(!m.installed || m.update_available) && (
                              <Botao
                                variante="secundario"
                                tamanho="p"
                                icone={<Download />}
                                disabled={Boolean(jobLocalAtivo)}
                                onClick={() =>
                                  setConfirmacao({
                                    titulo: `${m.update_available ? 'Atualizar' : 'Baixar'} ${m.label}?`,
                                    descricao:
                                      'O modelo será verificado por integridade após o download.',
                                    tamanhoBytes: m.size,
                                    licenca: m.license,
                                    origem: dominioDe(m.source_url),
                                    destino: config?.data_dir,
                                    aoConfirmar: () =>
                                      executarJob(m.id, async () => {
                                        await chamar('components.models.download', {
                                          id: m.id,
                                          confirmed: true,
                                        })
                                      }),
                                  })
                                }
                              >
                                {m.update_available ? 'Atualizar' : 'Baixar'}
                              </Botao>
                            )}
                          </div>

                          {jobModelo && (
                            <div className="flex items-center gap-3 rounded-controle bg-chao px-3 py-2">
                              <Progresso
                                valor={jobModelo.percentual}
                                rotulo={jobModelo.mensagem || `Baixando ${m.label}…`}
                                className="flex-1"
                              />
                              <Botao
                                tamanho="p"
                                aria-label={`Cancelar download de ${m.label}`}
                                onClick={() => void cancelarComponente(m.id)}
                              >
                                Cancelar
                              </Botao>
                            </div>
                          )}
                        </section>
                      )
                    })}
                  </div>
                )}
              </section>
            </>
          )}

          {aba === 'tts' && (
            <>
              <section
                aria-label="pocket-tts"
                className="flex flex-col gap-2 rounded-area bg-area p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <strong className="text-base font-medio text-t1">
                      pocket-tts (motor local de voz)
                    </strong>
                    {pocketTtsStatus.installed ? (
                      <Status tom={pocketTtsStatus.outdated ? 'aviso' : 'sucesso'}>
                        {pocketTtsStatus.outdated
                          ? 'Atualização disponível'
                          : `Instalado${pocketTtsStatus.version ? ` (${pocketTtsStatus.version})` : ''}`}
                      </Status>
                    ) : (
                      <Status tom="pendente">Não instalado</Status>
                    )}
                  </div>
                  {renderBotaoDownloadManifesto(
                    'pocket-tts',
                    pocketTtsStatus.installed ? 'Reinstalar pocket-tts' : 'Baixar pocket-tts',
                    (item) =>
                      setConfirmacao({
                        titulo: 'Baixar pocket-tts?',
                        descricao: 'Motor local para gerar Narração por voz sintética.',
                        tamanhoBytes: item.size,
                        licenca: item.license,
                        origem: dominioDe(item.source_url),
                        destino: config?.data_dir,
                        aoConfirmar: () =>
                          executarJob('pocket-tts', async () => {
                            await chamar('components.download', {
                              id: 'pocket-tts',
                              confirmed: true,
                            })
                          }),
                      }),
                    pocketTtsStatus.installed,
                  )}
                </div>

                {jobPocket && (
                  <div className="flex items-center gap-3 rounded-controle bg-elevado px-3 py-2">
                    <Progresso
                      valor={jobPocket.percentual}
                      rotulo={jobPocket.mensagem || 'Baixando pocket-tts…'}
                      className="flex-1"
                    />
                    <Botao
                      tamanho="p"
                      aria-label="Cancelar download de pocket-tts"
                      onClick={() => void cancelarComponente('pocket-tts')}
                    >
                      Cancelar
                    </Botao>
                  </div>
                )}
              </section>

              {(ttsCatalogo?.models?.length ?? 0) === 0 ? (
                <EstadoTela
                  tipo="vazio"
                  compacto
                  titulo="Nenhuma voz TTS disponível"
                  descricao="Verifique o catálogo de modelos para carregar os modelos e vozes de Narração."
                  acaoPrimaria={{
                    rotulo: 'Verificar catálogo',
                    aoAcionar: () => void verificarCatalogo(),
                  }}
                />
              ) : (
                <>
                  <section
                    aria-label="Modelos ativos por idioma"
                    className="flex flex-col gap-3 rounded-area bg-area p-3"
                  >
                    <strong className="text-base font-medio text-t1">
                      Modelo padrão por idioma
                    </strong>
                    <div className="grid gap-3 md:grid-cols-2">
                      {modelosTtsPt.length > 0 && (
                        <Campo rotulo="Português (PT-BR)">
                          {(propsAria) => (
                            <Select
                              {...propsAria}
                              valor={ttsCatalogo?.activeModels?.pt ?? null}
                              aoMudar={(id) => void escolherModeloTts('pt', id)}
                              opcoes={modelosTtsPt}
                            />
                          )}
                        </Campo>
                      )}
                      {modelosTtsEn.length > 0 && (
                        <Campo rotulo="Inglês (EN)">
                          {(propsAria) => (
                            <Select
                              {...propsAria}
                              valor={ttsCatalogo?.activeModels?.en ?? null}
                              aoMudar={(id) => void escolherModeloTts('en', id)}
                              opcoes={modelosTtsEn}
                            />
                          )}
                        </Campo>
                      )}
                    </div>

                    {engineTts?.prohibitedUse?.summaryPt && (
                      <div className="flex flex-col gap-2 rounded-controle bg-elevado p-3">
                        <strong className="text-pequeno font-medio text-t1">
                          Termo de uso responsável (obrigatório para download)
                        </strong>
                        <p className="text-pequeno text-t2">{engineTts.prohibitedUse.summaryPt}</p>
                        {engineTts.prohibitedUse.textEn && (
                          <details className="text-pequeno text-t3">
                            <summary className="foco w-fit cursor-pointer rounded-controle hover:text-t2">
                              Texto original em inglês
                            </summary>
                            <p className="mt-1 text-micro text-t2">
                              {engineTts.prohibitedUse.textEn}
                            </p>
                          </details>
                        )}
                        <Checkbox marcado={termoTtsAceito} aoMudar={setTermoTtsAceito}>
                          Li e concordo com os termos de uso deste modelo de voz
                        </Checkbox>
                      </div>
                    )}
                  </section>

                  <section
                    aria-label="Modelos de voz TTS"
                    className="flex flex-col gap-2 rounded-area bg-area p-3"
                  >
                    <strong className="text-base font-medio text-t1">Modelos de voz</strong>
                    <div className="flex flex-col gap-2">
                      {(ttsCatalogo?.models ?? []).map((m) => {
                        const jobTts = jobDe(`tts:${m.id}`)
                        return (
                          <section
                            key={m.id}
                            aria-label={m.label}
                            className="flex flex-col gap-2 rounded-controle bg-elevado p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <strong className="text-base font-medio text-t1">
                                    {m.label}
                                  </strong>
                                  {m.installed ? (
                                    <Status tom={m.updateAvailable ? 'aviso' : 'sucesso'}>
                                      {m.updateAvailable ? 'Atualização disponível' : 'Instalado'}
                                    </Status>
                                  ) : (
                                    <Status tom="pendente">Não instalado</Status>
                                  )}
                                </div>
                                <p className="mt-0.5 text-pequeno text-t3">
                                  <span className="num">{formatarBytes(m.size)}</span>
                                  {m.license ? ` · ${m.license}` : ''}
                                  {m.description ? ` · ${m.description}` : ''}
                                </p>
                              </div>

                              {(!m.installed || m.updateAvailable) && (
                                <Botao
                                  variante="secundario"
                                  tamanho="p"
                                  icone={<Download />}
                                  disabled={Boolean(jobLocalAtivo)}
                                  onClick={() =>
                                    setConfirmacao({
                                      titulo: `${m.updateAvailable ? 'Atualizar' : 'Baixar'} ${m.label}?`,
                                      descricao: 'Modelo de voz para Narração local.',
                                      tamanhoBytes: m.size,
                                      licenca: m.license ?? 'CC-BY-4.0',
                                      origem: dominioDe(m.sourceUrl),
                                      destino: config?.data_dir,
                                      termoTts: engineTts?.prohibitedUse?.summaryPt
                                        ? {
                                            summaryPt: engineTts.prohibitedUse.summaryPt,
                                            textEn: engineTts.prohibitedUse.textEn,
                                          }
                                        : undefined,
                                      aoConfirmar: () =>
                                        executarJob(`tts:${m.id}`, async () => {
                                          await chamar('tts.models.download', {
                                            id: m.id,
                                            confirmed: true,
                                            termsAccepted: true,
                                          })
                                        }),
                                    })
                                  }
                                >
                                  {m.updateAvailable ? 'Atualizar' : 'Baixar'}
                                </Botao>
                              )}
                            </div>

                            {jobTts && (
                              <div className="flex items-center gap-3 rounded-controle bg-chao px-3 py-2">
                                <Progresso
                                  valor={jobTts.percentual}
                                  rotulo={jobTts.mensagem || `Baixando ${m.label}…`}
                                  className="flex-1"
                                />
                                <Botao
                                  tamanho="p"
                                  aria-label={`Cancelar download de ${m.label}`}
                                  onClick={() => void cancelarTts(m.id)}
                                >
                                  Cancelar
                                </Botao>
                              </div>
                            )}
                          </section>
                        )
                      })}
                    </div>
                  </section>

                  {(ttsCatalogo?.voices?.length ?? 0) > 0 && (
                    <section
                      aria-label="Vozes e atribuições"
                      className="flex flex-col gap-2 rounded-area bg-area p-3"
                    >
                      <strong className="text-base font-medio text-t1">
                        Vozes e atribuições
                      </strong>
                      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                        {(ttsCatalogo?.voices ?? []).map((v) => (
                          <li
                            key={v.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-controle bg-elevado px-3 py-2 text-pequeno"
                          >
                            <span className="font-medio text-t1">{v.label}</span>
                            <span className="text-t3">
                              {v.attribution}
                              {v.license ? ` · ${v.license}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              )}
            </>
          )}

          {aba === 'armazenamento' && (
            <form
              noValidate
              onSubmit={(e) => void salvarPastas(e)}
              className="flex flex-col gap-3 rounded-area bg-area p-3"
            >
              <div className="flex items-center gap-2">
                <FolderCog className="size-4 text-t3" aria-hidden />
                <strong className="text-base font-medio text-t1">
                  Pastas e limite de cache
                </strong>
              </div>

              <SeletorCaminho
                rotulo="Pasta de componentes e modelos (data_dir)"
                modo="pasta"
                valor={dataDir}
                aoMudar={setDataDir}
                desabilitado={salvandoPastas}
              />

              <p
                role="note"
                className="rounded-controle bg-elevado px-3 py-2 text-pequeno text-t2"
              >
                Alterar a pasta de componentes vale apenas para downloads futuros. Arquivos já
                baixados não são movidos automaticamente (e listas de Projetos, histórico de
                encoder e diagnóstico continuam na pasta padrão de dados do app).
              </p>

              <SeletorCaminho
                rotulo="Pasta de cache temporário (cache_dir)"
                ajuda="Guarda proxies de preview, ondas de áudio e miniaturas descartáveis."
                modo="pasta"
                valor={cacheDir}
                aoMudar={setCacheDir}
                desabilitado={salvandoPastas}
              />

              <Campo
                rotulo="Limite do cache (GB)"
                extra="padrão: 10 GB"
                ajuda="Limpeza automática dos itens mais antigos ao ultrapassar este limite."
              >
                {(propsAria) => (
                  <Entrada
                    {...propsAria}
                    type="number"
                    min="0.1"
                    step="any"
                    value={limiteGb}
                    onChange={(e) => setLimiteGb(e.target.value)}
                    disabled={salvandoPastas}
                    className="num max-w-40"
                  />
                )}
              </Campo>

              <div className="flex justify-end">
                <Botao
                  type="submit"
                  variante="primario"
                  carregando={salvandoPastas}
                >
                  Salvar pastas e limite
                </Botao>
              </div>
            </form>
          )}
        </div>
      )}

      <ConfirmDialog
        aberto={confirmacao !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setConfirmacao(null)
        }}
        titulo={confirmacao?.titulo ?? ''}
        descricao={confirmacao?.descricao ?? ''}
        rotuloConfirmar="Baixar agora"
        focoInicial="cancelar"
        confirmarDesabilitado={Boolean(confirmacao?.termoTts && !termoTtsAceito)}
        aoConfirmar={async () => {
          const acao = confirmacao?.aoConfirmar
          setConfirmacao(null)
          if (acao) await acao()
        }}
      >
        {confirmacao && (
          <div className="flex flex-col gap-3">
            <dl className="m-0 grid grid-cols-[72px_1fr] gap-x-3 gap-y-1 rounded-controle bg-area p-2.5 text-pequeno">
              <dt className="text-t3">Tamanho</dt>
              <dd className="num m-0 text-t1">
                {confirmacao.tamanhoBytes !== undefined
                  ? formatarBytes(confirmacao.tamanhoBytes)
                  : confirmacao.notaTamanho ?? '—'}
              </dd>
              {confirmacao.licenca && (
                <>
                  <dt className="text-t3">Licença</dt>
                  <dd className="m-0 text-t2">{confirmacao.licenca}</dd>
                </>
              )}
              {confirmacao.origem && (
                <>
                  <dt className="text-t3">Origem</dt>
                  <dd className="m-0 font-mono text-t2">{confirmacao.origem}</dd>
                </>
              )}
              {confirmacao.destino && (
                <>
                  <dt className="text-t3">Destino</dt>
                  <dd className="m-0 truncate font-mono text-t2">{confirmacao.destino}</dd>
                </>
              )}
            </dl>

            {confirmacao.termoTts && (
              <div className="flex flex-col gap-2 rounded-controle bg-area p-2.5 text-pequeno">
                <p className="text-t2">{confirmacao.termoTts.summaryPt}</p>
                <Checkbox marcado={termoTtsAceito} aoMudar={setTermoTtsAceito}>
                  Li e concordo com os termos de uso deste modelo de voz
                </Checkbox>
              </div>
            )}
          </div>
        )}
      </ConfirmDialog>
    </ConfiguracoesLayout>
  )
}
