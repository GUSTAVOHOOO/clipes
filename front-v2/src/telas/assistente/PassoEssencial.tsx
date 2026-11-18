import {
  BannerErroCore,
  Botao,
  ConfirmDialog,
  Dica,
  Esqueleto,
  Progresso,
  Status,
  tamanho,
} from '@ds'
import { ArrowRight, Cpu, Download, FolderCog } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SeletorCaminho } from '~/componentes/SeletorCaminho'
import { chamar, ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila } from '~/core/progresso'
import { useEstadoForcado } from '~/shell/EstadoForcado'

type ManifestoItem = {
  id: string
  version: string
  size: number
  license: string
  source_url: string
}

type StatusFfmpeg = {
  installed: boolean
  incomplete: boolean
}

type StatusWorker = {
  installed: boolean
  outdated?: boolean
  cuda?: boolean
  gpu?: boolean
  uv?: string | null
  handshake?: {
    protocol: number
    worker: string
    python: string
    libs: Record<string, string | null>
  }
}

type ModeloItem = {
  id: string
  label: string
  license: string
  source_url: string
  size: number
  installed: boolean
  worker_installed: boolean
  recommended?: boolean
}

type StatusHardware = {
  gpu: { name: string; driver: string; total_mib: number; free_mib: number } | null
  ram: { total: number; available: number } | null
  cuda: boolean
  no_compatible_gpu: boolean
  effective: { model: string; device: string; compute_type: string }
  manual: boolean
  fallback_reason: string | null
  worker_installed: boolean
}

type StatusAgrupamento = {
  enabled: boolean
  mode: 'auto' | 'manual'
  size: number
  measured_size: number | null
}

type ConfigComponentes = {
  data_dir: string
  cache_dir: string
  cache_limit_bytes: number
}

type PassoEssencialProps = {
  aoAvancar: () => void
  aoPular: () => Promise<void>
  pulando: boolean
}

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

function traduzirErroPasso1(erro: ErroCore): { titulo: string; explicacao?: string } {
  switch (erro.code) {
    case 'unknown_component':
      return {
        titulo:
          'A instalação automática do motor ainda não está disponível neste sistema operacional (#301).',
      }
    case 'download':
    case 'hash_mismatch':
      return {
        titulo:
          'Falha ao baixar ou verificar a integridade do arquivo. O download pode ser retomado.',
      }
    case 'invalid_ffmpeg':
    case 'ffprobe_missing':
      return {
        titulo: 'Não encontramos o FFmpeg e o FFprobe válidos nesse caminho.',
      }
    case 'cancelled':
      return { titulo: 'Operação cancelada.' }
    default:
      return mensagemDeErro(erro)
  }
}

function etapaAmigavelWorker(percentual: number, mensagem: string): string {
  if (percentual >= 95) return 'Verificando funcionamento'
  if (percentual >= 45) {
    return mensagem.toLowerCase().includes('cpu')
      ? 'Instalando dependências'
      : 'Instalando aceleração'
  }
  if (percentual >= 25) return 'Instalando ambiente isolado'
  return mensagem || 'Preparando ambiente isolado'
}

export function PassoEssencial({ aoAvancar, aoPular, pulando }: PassoEssencialProps) {
  const forcado = useEstadoForcado()
  const jobs = useFila()

  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<ErroCore | null>(null)
  const [ffmpegStatus, setFfmpegStatus] = useState<StatusFfmpeg>({
    installed: false,
    incomplete: false,
  })
  const [manifesto, setManifesto] = useState<ManifestoItem[]>([])
  const [config, setConfig] = useState<ConfigComponentes | null>(null)
  const [workerStatus, setWorkerStatus] = useState<StatusWorker>({ installed: false })
  const [modelos, setModelos] = useState<ModeloItem[]>([])
  const [hardware, setHardware] = useState<StatusHardware | null>(null)
  const [agrupamento, setAgrupamento] = useState<StatusAgrupamento | null>(null)

  const [caminhoSistema, setCaminhoSistema] = useState('')
  const [validandoSistema, setValidandoSistema] = useState(false)
  const [confirmarFfmpeg, setConfirmarFfmpeg] = useState(false)
  const [confirmarMotor, setConfirmarMotor] = useState(false)
  const [jobAtivoId, setJobAtivoId] = useState<string | null>(null)
  const [sondando, setSondando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const [resFfmpeg, resManifesto, resConfig, resWorker, resModelos, resHw, resGrp] =
        await Promise.all([
          chamar<StatusFfmpeg>('components.ffmpeg.status', {}),
          chamar<ManifestoItem[]>('components.manifest', {}),
          chamar<ConfigComponentes>('components.settings.get', {}),
          chamar<StatusWorker>('components.worker.status', {}),
          chamar<ModeloItem[]>('components.models.manifest', {}),
          chamar<StatusHardware>('transcription.hardware.status', {}),
          chamar<StatusAgrupamento>('transcription.grouping', {}),
        ])
      setFfmpegStatus(resFfmpeg ?? { installed: false, incomplete: false })
      setManifesto(resManifesto ?? [])
      setConfig(resConfig)
      setWorkerStatus(resWorker ?? { installed: false })
      setModelos(resModelos ?? [])
      setHardware(resHw)
      setAgrupamento(resGrp)
    } catch (e) {
      setErro(normalizarErro(e))
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const manifestoPorId = useMemo(
    () => new Map(manifesto.map((item) => [item.id, item])),
    [manifesto],
  )
  const itemFfmpeg = manifestoPorId.get('ffmpeg')
  const itemUv = manifestoPorId.get('uv')

  const modeloRecomendado = useMemo(() => {
    const modeloHw = hardware?.effective?.model
    return (
      modelos.find((m) => m.id === modeloHw) ??
      modelos.find((m) => m.recommended) ??
      modelos[0]
    )
  }, [hardware, modelos])

  const jobFilaAtual = useMemo(
    () => (jobAtivoId ? jobs.find((j) => j.id === jobAtivoId) : undefined),
    [jobAtivoId, jobs],
  )

  const ffmpegPronto = ffmpegStatus.installed && !ffmpegStatus.incomplete
  const motorPronto = Boolean(workerStatus.installed && modeloRecomendado?.installed)

  async function baixarFfmpeg() {
    setConfirmarFfmpeg(false)
    setErro(null)
    setJobAtivoId('ffmpeg')
    try {
      await chamar('components.download', { id: 'ffmpeg', confirmed: true })
      await carregar()
    } catch (e) {
      setErro(normalizarErro(e))
    } finally {
      setJobAtivoId(null)
    }
  }

  async function validarFfmpegSistema() {
    setValidandoSistema(true)
    setErro(null)
    try {
      await chamar(
        'components.ffmpeg.system',
        caminhoSistema.trim() ? { path: caminhoSistema.trim() } : {},
      )
      await carregar()
    } catch (e) {
      setErro(normalizarErro(e))
    } finally {
      setValidandoSistema(false)
    }
  }

  async function instalarMotor() {
    if (!modeloRecomendado) return
    setConfirmarMotor(false)
    setErro(null)
    try {
      if (!workerStatus.installed) {
        setJobAtivoId('worker')
        await chamar('components.worker.install', { confirmed: true })
      }
      if (!modeloRecomendado.installed) {
        setJobAtivoId(modeloRecomendado.id)
        await chamar('components.models.download', {
          id: modeloRecomendado.id,
          confirmed: true,
        })
      }
      await carregar()
    } catch (e) {
      setErro(normalizarErro(e))
    } finally {
      setJobAtivoId(null)
    }
  }

  async function testarHardware() {
    setSondando(true)
    setErro(null)
    setJobAtivoId('hardware-probe')
    try {
      await chamar('transcription.hardware.probe', {})
      await carregar()
    } catch (e) {
      setErro(normalizarErro(e))
    } finally {
      setJobAtivoId(null)
      setSondando(false)
    }
  }

  async function cancelarJobAtivo() {
    if (!jobAtivoId) return
    const alvo = jobAtivoId
    try {
      await chamar('components.cancel', { id: alvo })
    } finally {
      setJobAtivoId(null)
    }
  }

  if (forcado === 'carregando' || carregando) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-area bg-area p-4">
          <Esqueleto
            variante="painel"
            rotuloAcessivel="Verificando componentes essenciais"
          />
        </div>
      </div>
    )
  }

  const erroExibido =
    erro ??
    (forcado === 'erro'
      ? new ErroCore('download', 'Simulação de erro via ?estado=erro.')
      : null)

  const descricaoHardware = (() => {
    if (!hardware) return 'Analisando hardware do computador…'
    if (hardware.gpu && !hardware.no_compatible_gpu) {
      const vramGb = Math.max(1, Math.round(hardware.gpu.total_mib / 1024))
      return `Placa NVIDIA detectada (${hardware.gpu.name}, ${vramGb} GB). A transcrição usará aceleração por placa de vídeo.`
    }
    return 'Sem placa NVIDIA compatível. A transcrição rodará no processador (CPU) com modelo mais leve.'
  })()

  const ramGb = hardware?.ram ? Math.round(hardware.ram.total / 1024 ** 3) : null

  const botaoBaixarFfmpeg = (
    <Botao
      variante="secundario"
      icone={<Download />}
      disabled={Boolean(jobAtivoId) || !itemFfmpeg}
      onClick={() => setConfirmarFfmpeg(true)}
    >
      Baixar FFmpeg
    </Botao>
  )

  const botaoInstalarMotor = (
    <Botao
      variante="secundario"
      icone={<Download />}
      disabled={Boolean(jobAtivoId) || (!workerStatus.installed && !itemUv) || !modeloRecomendado}
      onClick={() => setConfirmarMotor(true)}
    >
      Instalar motor e modelo recomendados
    </Botao>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-area bg-area p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-titulo font-forte text-t1">
            Passo 1: Essencial para transcrever e cortar
          </h2>
          {ffmpegPronto && !motorPronto && (
            <Status tom="aviso">Parcial · FFmpeg pronto</Status>
          )}
        </div>

        {erroExibido && (
          <BannerErroCore
            erro={{
              code: erroExibido.code,
              message: erroExibido.detalhe || erroExibido.message,
            }}
            traduzir={() => traduzirErroPasso1(erroExibido)}
            acaoRecuperacao={
              erroExibido.code === 'download' || erroExibido.code === 'hash_mismatch'
                ? { rotulo: 'Tentar novamente', aoAcionar: () => void carregar() }
                : undefined
            }
            permitirRelato
            aoDispensar={erro ? () => setErro(null) : undefined}
          />
        )}

        {/* Bloco 1: FFmpeg */}
        <section
          aria-label="FFmpeg e FFprobe"
          className="flex flex-col gap-2 rounded-controle bg-elevado p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <strong className="text-base font-medio text-t1">1. FFmpeg e FFprobe</strong>
            {ffmpegPronto ? (
              <Status tom="sucesso">Pronto</Status>
            ) : ffmpegStatus.incomplete ? (
              <Status tom="aviso">Incompleto no disco</Status>
            ) : (
              <Status tom="pendente">Pendente</Status>
            )}
          </div>

          <p className="text-pequeno text-t2">
            Usado para ler vídeos, gerar prévias e exportar.{' '}
            {itemFfmpeg ? (
              <span className="num text-t3">
                ~{tamanho(itemFfmpeg.size)} · {itemFfmpeg.license}
              </span>
            ) : (
              <span className="text-t3">Use um FFmpeg instalado no sistema (#301).</span>
            )}
          </p>

          {ffmpegStatus.incomplete && (
            <p role="alert" className="text-pequeno text-erro">
              FFmpeg incompleto no disco. Reinstale ou aponte o FFmpeg do sistema.
            </p>
          )}

          {jobAtivoId === 'ffmpeg' && (
            <div className="flex items-center gap-3 rounded-controle bg-chao px-3 py-2">
              <Progresso
                valor={jobFilaAtual?.percentual ?? 0}
                rotulo={jobFilaAtual?.mensagem || 'Baixando FFmpeg…'}
                className="flex-1"
              />
              <Botao tamanho="p" onClick={() => void cancelarJobAtivo()}>
                Cancelar
              </Botao>
            </div>
          )}

          {!ffmpegPronto && (
            <div className="flex flex-wrap items-center gap-2">
              {itemFfmpeg ? (
                botaoBaixarFfmpeg
              ) : (
                <Dica texto="Download automático indisponível nesta plataforma; aguarda manifesto macOS (#301).">
                  <span tabIndex={0} className="inline-flex">
                    {botaoBaixarFfmpeg}
                  </span>
                </Dica>
              )}
            </div>
          )}

          <details className="text-pequeno text-t3">
            <summary className="foco w-fit cursor-pointer rounded-controle hover:text-t2">
              Já tenho FFmpeg instalado no computador
            </summary>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="min-w-64 flex-1">
                <SeletorCaminho
                  rotulo="Caminho do FFmpeg"
                  modo="arquivo"
                  valor={caminhoSistema}
                  aoMudar={setCaminhoSistema}
                  placeholder="ffmpeg ou C:\ffmpeg\bin\ffmpeg.exe"
                  desabilitado={validandoSistema}
                />
              </div>
              <Botao
                variante="suave"
                carregando={validandoSistema}
                onClick={() => void validarFfmpegSistema()}
              >
                Validar caminho
              </Botao>
            </div>
          </details>
        </section>

        {/* Bloco 2: Motor de transcrição local */}
        <section
          aria-label="Motor de transcrição local"
          className="flex flex-col gap-2 rounded-controle bg-elevado p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <strong className="text-base font-medio text-t1">
              2. Motor de transcrição local
            </strong>
            {motorPronto ? (
              <Status tom="sucesso">Pronto</Status>
            ) : (
              <Status tom="pendente">Opcional agora</Status>
            )}
          </div>

          <p className="text-pequeno text-t1">
            {descricaoHardware}
            {ramGb !== null && <span className="num text-t3"> · {ramGb} GB RAM</span>}
          </p>

          {modeloRecomendado && (
            <p className="text-pequeno text-t2">
              Recomendado: <strong className="font-medio text-t1">{modeloRecomendado.label}</strong>{' '}
              <span className="num text-t3">({tamanho(modeloRecomendado.size)})</span> ·{' '}
              <span className="text-t3">Tamanho variável conforme ambiente CUDA/CPU (#307)</span>
            </p>
          )}

          {config?.data_dir && (
            <div className="flex flex-wrap items-center gap-2 text-pequeno text-t3">
              <span className="truncate font-mono">Pasta: {config.data_dir}</span>
              <button
                type="button"
                onClick={() => {
                  window.location.hash = '#/config/componentes'
                }}
                className="foco cursor-pointer rounded-controle border-0 bg-transparent px-1 text-pequeno text-t2 underline hover:text-t1"
              >
                Mudar pasta de instalação
              </button>
            </div>
          )}

          {jobAtivoId && jobAtivoId !== 'ffmpeg' && (
            <div className="flex items-center gap-3 rounded-controle bg-chao px-3 py-2">
              <Progresso
                valor={jobFilaAtual?.percentual ?? 0}
                rotulo={
                  jobAtivoId === 'worker'
                    ? etapaAmigavelWorker(
                        jobFilaAtual?.percentual ?? 0,
                        jobFilaAtual?.mensagem ?? '',
                      )
                    : jobFilaAtual?.mensagem || 'Preparando componente…'
                }
                className="flex-1"
              />
              <Botao tamanho="p" onClick={() => void cancelarJobAtivo()}>
                Cancelar
              </Botao>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {!motorPronto &&
              (!workerStatus.installed && !itemUv ? (
                <Dica texto="Download automático indisponível nesta plataforma; aguarda manifesto macOS (#301).">
                  <span tabIndex={0} className="inline-flex">
                    {botaoInstalarMotor}
                  </span>
                </Dica>
              ) : (
                botaoInstalarMotor
              ))}
            <Botao
              variante="suave"
              icone={<Cpu />}
              carregando={sondando}
              disabled={Boolean(jobAtivoId)}
              onClick={() => void testarHardware()}
            >
              Testar meu hardware
            </Botao>
            <details className="ml-auto text-pequeno text-t3">
              <summary className="foco w-fit cursor-pointer rounded-controle hover:text-t2">
                Detalhes técnicos
              </summary>
              <div className="mt-2 flex flex-col gap-1 rounded-controle bg-chao p-2 font-mono text-micro text-t2">
                {hardware && (
                  <span>
                    effective: {hardware.effective.model} · {hardware.effective.device} ·{' '}
                    {hardware.effective.compute_type} (CUDA: {hardware.cuda ? 'sim' : 'não'})
                  </span>
                )}
                <span>
                  handshake:{' '}
                  {workerStatus.handshake
                    ? `v${workerStatus.handshake.protocol} · worker ${workerStatus.handshake.worker} · Python ${workerStatus.handshake.python}`
                    : 'não instalado'}
                </span>
                {agrupamento && (
                  <span>
                    agrupamento VAD: {agrupamento.mode} (size {agrupamento.size})
                  </span>
                )}
              </div>
            </details>
          </div>
        </section>

        <p className="flex items-center gap-1.5 text-pequeno text-t3">
          <FolderCog className="size-[13px] shrink-0 stroke-[1.75]" aria-hidden />
          <span>
            Ferramentas para baixar links do YouTube (yt-dlp/deno), reenquadramento automático de
            rosto (YuNet) e voz por TTS (pocket-tts) serão oferecidas só quando você usar esses
            recursos.
          </span>
        </p>
      </div>

      <footer className="flex items-center justify-between gap-2 pt-1">
        <Botao variante="fantasma" disabled={pulando || Boolean(jobAtivoId)} onClick={() => void aoPular()}>
          Pular por enquanto
        </Botao>
        <Botao
          variante="primario"
          icone={<ArrowRight />}
          disabled={Boolean(jobAtivoId)}
          onClick={aoAvancar}
        >
          Próximo: Provedor de IA
        </Botao>
      </footer>

      <ConfirmDialog
        aberto={confirmarFfmpeg}
        aoMudarAberto={setConfirmarFfmpeg}
        titulo="Baixar FFmpeg e FFprobe?"
        descricao={
          itemFfmpeg
            ? `Tamanho aproximado: ${tamanho(itemFfmpeg.size)} · Licença: ${itemFfmpeg.license} · Origem: ${itemFfmpeg.source_url}`
            : 'Baixar executáveis separados do FFmpeg e FFprobe.'
        }
        rotuloConfirmar="Confirmar download"
        focoInicial="confirmar"
        aoConfirmar={baixarFfmpeg}
      />

      <ConfirmDialog
        aberto={confirmarMotor}
        aoMudarAberto={setConfirmarMotor}
        titulo="Instalar motor e modelo recomendados?"
        descricao={
          modeloRecomendado
            ? `Modelo: ${modeloRecomendado.label} (${tamanho(modeloRecomendado.size)} · ${modeloRecomendado.license}). Tamanho variável conforme ambiente CUDA/CPU (#307).`
            : 'Instala ambiente Python isolado e modelo recomendado.'
        }
        rotuloConfirmar="Confirmar instalação"
        focoInicial="confirmar"
        aoConfirmar={instalarMotor}
      />
    </div>
  )
}
