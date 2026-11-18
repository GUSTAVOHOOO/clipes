import {
  BannerErroCore,
  Botao,
  Esqueleto,
  Status,
  cn,
  useToast,
} from '@ds'
import { CircleDashed, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chamar, paraErroCore, type ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import { ConfiguracoesLayout } from '~/telas/config/ConfiguracoesLayout'

type EncoderStatus = {
  ffmpeg: boolean
  detected: boolean
  stale?: boolean
  passed: string[]
  selected?: string
  manual?: string | null
  effective: string
  gpu?: string
  detected_at?: number | null
}

const ROTULOS_ENCODER: Record<string, string> = {
  h264_nvenc: 'Placa NVIDIA (NVENC)',
  h264_qsv: 'Intel Quick Sync',
  h264_amf: 'AMD AMF',
  h264_videotoolbox: 'Apple VideoToolbox',
  libx264: 'Processador / CPU (x264)',
}

const ENCODERS_CONHECIDOS = [
  'h264_nvenc',
  'h264_qsv',
  'h264_amf',
  'h264_videotoolbox',
  'libx264',
]

function rotuloEncoder(id: string): string {
  return ROTULOS_ENCODER[id] ?? id
}

function traduzirErroEncoder(erro: ErroCore): { titulo: string; explicacao?: string } {
  switch (erro.code) {
    case 'component_missing':
    case 'ffprobe_missing':
      return {
        titulo: 'FFmpeg ou FFprobe ausente. Instale em Componentes para testar os encoders.',
      }
    case 'encoder_invalid':
      return {
        titulo: 'Este encoder não está disponível ou ainda não foi testado neste computador.',
      }
    case 'export_failed':
      return {
        titulo:
          'Não foi possível concluir o teste dos encoders (limite de tempo ou erro no FFmpeg).',
      }
    default:
      return mensagemDeErro(erro)
  }
}

function formatarDataHora(segundos?: number | null): string | null {
  if (!segundos) return null
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(segundos * 1000))
  } catch {
    return null
  }
}

export function ConfigExportacao({ projetoAberto }: { projetoAberto: string | null }) {
  const forcado = useEstadoForcado()
  const toast = useToast()

  const [carregando, setCarregando] = useState(true)
  const [status, setStatus] = useState<EncoderStatus | null>(null)
  const [erro, setErro] = useState<ErroCore | null>(null)
  const [detectando, setDetectando] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const radiosRef = useRef<Map<string, HTMLButtonElement>>(new Map())

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const res = await chamar<EncoderStatus>('export.encoder.status', {})
      setStatus(res)
    } catch (e) {
      setErro(paraErroCore(e))
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar, forcado])

  const detectar = useCallback(async () => {
    setDetectando(true)
    setErro(null)
    try {
      const res = await chamar<EncoderStatus>('export.encoder.detect', {})
      setStatus(res)
      toast.add({ title: `Encoder ativo: ${rotuloEncoder(res.effective)}.` })
    } catch (e) {
      setErro(paraErroCore(e))
    } finally {
      setDetectando(false)
    }
  }, [toast])

  const selecionar = useCallback(async (encoder: string | null) => {
    if (salvando || detectando) return
    setSalvando(true)
    setErro(null)
    try {
      const res = await chamar<EncoderStatus>('export.encoder.set', { encoder })
      setStatus(res)
    } catch (e) {
      setErro(paraErroCore(e))
    } finally {
      setSalvando(false)
    }
  }, [detectando, salvando])

  const listaEncoders = useMemo(() => {
    const passed = status?.passed ?? []
    const extras = passed.filter((id) => !ENCODERS_CONHECIDOS.includes(id))
    return [...ENCODERS_CONHECIDOS, ...extras]
  }, [status?.passed])

  const opcoesHabilitadas = useMemo(() => {
    const passedSet = new Set(status?.passed ?? [])
    return [null as string | null, ...listaEncoders.filter((id) => passedSet.has(id))]
  }, [listaEncoders, status?.passed])

  const escolhaAtual = status?.manual ?? null
  const ultimaVerificacao = formatarDataHora(status?.detected_at)

  function onKeyDownGrupo(e: React.KeyboardEvent<HTMLDivElement>) {
    if (detectando || salvando) return
    if (
      e.key !== 'ArrowDown' &&
      e.key !== 'ArrowRight' &&
      e.key !== 'ArrowUp' &&
      e.key !== 'ArrowLeft'
    ) {
      return
    }
    e.preventDefault()
    if (opcoesHabilitadas.length === 0) return
    const idxAtual = opcoesHabilitadas.indexOf(escolhaAtual)
    const passo = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
    const proxIdx =
      ((idxAtual >= 0 ? idxAtual : 0) + passo + opcoesHabilitadas.length) %
      opcoesHabilitadas.length
    const proximo = opcoesHabilitadas[proxIdx]
    const chave = proximo ?? '__auto__'
    radiosRef.current.get(chave)?.focus()
    void selecionar(proximo)
  }

  return (
    <ConfiguracoesLayout
      secao="exportacao"
      projetoAberto={projetoAberto}
      titulo="Exportação e Encoder"
      subtitulo="Exporta vídeos em 1080×1920 (H.264) usando aceleração quando disponível, com fallback seguro para CPU (x264)."
    >
      {erro && (
        <BannerErroCore
          erro={{
            code: erro.code,
            message: erro.detalhe || erro.message,
          }}
          traduzir={() => traduzirErroEncoder(erro)}
          acaoRecuperacao={
            erro.code === 'component_missing' || erro.code === 'ffprobe_missing'
              ? {
                  rotulo: 'Ir para Componentes',
                  aoAcionar: () => {
                    window.location.hash = '#/config/componentes'
                  },
                }
              : erro.code === 'export_failed'
                ? {
                    rotulo: 'Tentar novamente',
                    aoAcionar: () => void detectar(),
                  }
                : undefined
          }
          permitirRelato
          aoDispensar={() => setErro(null)}
        />
      )}

      {forcado === 'carregando' || carregando ? (
        <div className="rounded-area bg-area p-4">
          <Esqueleto
            variante="formulario"
            quantidade={3}
            rotuloAcessivel="Carregando estado dos encoders"
          />
        </div>
      ) : status && status.ffmpeg === false ? (
        <BannerErroCore
          erro={{
            code: 'component_missing',
            message: 'FFmpeg não está instalado.',
          }}
          traduzir={() => ({
            titulo: 'FFmpeg não está instalado. Instale o FFmpeg para detectar encoders de vídeo.',
          })}
          acaoRecuperacao={{
            rotulo: 'Ir para Componentes',
            aoAcionar: () => {
              window.location.hash = '#/config/componentes'
            },
          }}
        />
      ) : status && !status.detected && !status.stale ? (
        <div className="flex flex-col items-start gap-3 rounded-area bg-area p-6">
          <CircleDashed className="size-5 stroke-[1.5] text-t3" aria-hidden />
          <h2 className="text-titulo font-forte tracking-[-0.01em] text-t1">
            Nenhum teste de encoder realizado ainda
          </h2>
          <p className="max-w-[54ch] text-pequeno text-t2">
            Ainda não testamos os encoders deste computador. Por padrão usaremos o processador
            (x264), que garante compatibilidade na exportação.
          </p>
          <Botao
            variante="primario"
            carregando={detectando}
            onClick={() => void detectar()}
          >
            {detectando
              ? 'Testando encoders (pode levar alguns segundos)…'
              : 'Detectar encoders agora'}
          </Botao>
        </div>
      ) : status ? (
        <div className="flex flex-col gap-3">
          {status.stale && (
            <div role="status" className="rounded-area bg-area px-3 py-2.5">
              <Status tom="aviso" forte>
                O FFmpeg ou o driver de vídeo mudou desde o último teste. Recomendamos testar
                novamente.
              </Status>
            </div>
          )}

          <section
            aria-label="Status atual do encoder"
            className="flex flex-col gap-2.5 rounded-area bg-area p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-medio text-t1">Status atual</h2>
              <Status tom={status.stale ? 'aviso' : 'sucesso'} forte>
                {rotuloEncoder(status.effective)} · {status.manual ? 'Manual' : 'Automático'}
              </Status>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-pequeno text-t3">
                {ultimaVerificacao ? (
                  <>
                    Última verificação:{' '}
                    <span className="num text-t2">{ultimaVerificacao}</span>
                  </>
                ) : (
                  'Teste local de 1 s valida os encoders disponíveis.'
                )}
              </span>

              <Botao
                variante="secundario"
                icone={<RefreshCw />}
                carregando={detectando}
                disabled={salvando}
                onClick={() => void detectar()}
              >
                {detectando
                  ? 'Testando encoders (pode levar alguns segundos)…'
                  : 'Detectar encoders novamente'}
              </Botao>
            </div>
          </section>

          <section
            aria-label="Escolha de encoder"
            className="flex flex-col gap-2 rounded-area bg-area p-3"
          >
            <h2 className="text-base font-medio text-t1">Escolha de encoder</h2>
            <div
              role="radiogroup"
              aria-label="Escolha de encoder H.264"
              onKeyDown={onKeyDownGrupo}
              className="flex flex-col gap-1.5"
            >
              <button
                ref={(el) => {
                  if (el) radiosRef.current.set('__auto__', el)
                  else radiosRef.current.delete('__auto__')
                }}
                type="button"
                role="radio"
                aria-checked={escolhaAtual === null}
                aria-disabled={salvando || undefined}
                tabIndex={escolhaAtual === null ? 0 : -1}
                disabled={detectando}
                onClick={() => void selecionar(null)}
                className={cn(
                  'foco flex cursor-pointer items-center justify-between gap-3 rounded-controle border-0 px-3 py-2 text-left text-pequeno disabled:cursor-not-allowed disabled:opacity-45',
                  escolhaAtual === null
                    ? 'marcado bg-elevado text-t1'
                    : 'bg-chao text-t2 hover:bg-hover hover:text-t1',
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <strong className="font-medio">Automático (recomendado)</strong>
                  <span className="text-t3">
                    Usa o encoder mais rápido aprovado neste computador.
                  </span>
                </span>
                <Status tom={escolhaAtual === null ? 'sucesso' : 'neutro'}>
                  {escolhaAtual === null ? 'Em uso' : 'Disponível'}
                </Status>
              </button>

              {listaEncoders.map((enc) => {
                const aprovado = status.passed.includes(enc)
                const selecionado = escolhaAtual === enc
                const desabilitado = !aprovado || detectando

                return (
                  <button
                    key={enc}
                    ref={(el) => {
                      if (el) radiosRef.current.set(enc, el)
                      else radiosRef.current.delete(enc)
                    }}
                    type="button"
                    role="radio"
                    aria-checked={selecionado}
                    aria-disabled={salvando || undefined}
                    tabIndex={selecionado ? 0 : -1}
                    disabled={desabilitado}
                    onClick={() => void selecionar(enc)}
                    className={cn(
                      'foco flex cursor-pointer items-center justify-between gap-3 rounded-controle border-0 px-3 py-2 text-left text-pequeno disabled:cursor-not-allowed disabled:opacity-45',
                      selecionado
                        ? 'marcado bg-elevado text-t1'
                        : 'bg-chao text-t2 hover:bg-hover hover:text-t1',
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <strong className="font-medio">{rotuloEncoder(enc)}</strong>
                      <span className="font-mono text-micro text-t3">{enc}</span>
                    </span>
                    <Status tom={aprovado ? 'sucesso' : 'perigo'}>
                      {aprovado
                        ? enc === 'libx264'
                          ? 'Aprovado (fallback)'
                          : 'Aprovado'
                        : 'Indisponível'}
                    </Status>
                  </button>
                )
              })}
            </div>
          </section>
        </div>
      ) : null}
    </ConfiguracoesLayout>
  )
}
