import { Botao, BotaoIcone, ConfirmDialog, Dialogo, Segmentado, Slider, Status, cn, tc } from '@ds'
import { AlertCircle, ArrowDown, ArrowUp, Mic, Pause, Play, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'

export interface BlocoTeleprompter {
  id: number
  position: number
  title: string
  narration: string | null
}

export interface AudioGravadoTeleprompter {
  blockId: number
  audioBase64: string
  mimeType: 'audio/wav'
}

export interface GravadorTeleprompterProps {
  aberto: boolean
  bloco: BlocoTeleprompter | null
  totalBlocos: number
  aoSalvarAudio: (payload: AudioGravadoTeleprompter) => Promise<void>
  aoDescartarRascunho: (blockId: number) => Promise<void> | void
  aoAlternarParaImportar?: () => void
  aoAlternarParaTts?: () => void
  aoFechar: () => void
}

type ModoLeitura = 'rolagem' | 'passo'
type EstadoGravador = 'ocioso' | 'gravando' | 'enviando' | 'sem_fala' | 'permissao_negada' | 'erro'

const TAXA_SAIDA = 24000

/** Reamostra PCM mono para 24 kHz 16-bit e empacota cabeçalho RIFF/WAVE completo. */
export function codificarWavPcm24kMono(amostras: Float32Array, taxaOrigem: number): Uint8Array {
  const taxa = taxaOrigem > 0 ? taxaOrigem : TAXA_SAIDA
  const proporcao = taxa / TAXA_SAIDA
  const tamanhoSaida = Math.max(1, Math.round(amostras.length / proporcao))
  const dados = new Int16Array(tamanhoSaida)

  for (let i = 0; i < tamanhoSaida; i += 1) {
    const pos = i * proporcao
    const idx0 = Math.min(amostras.length - 1, Math.floor(pos))
    const idx1 = Math.min(amostras.length - 1, idx0 + 1)
    const frac = pos - idx0
    const amostra = amostras.length > 0 ? amostras[idx0] * (1 - frac) + amostras[idx1] * frac : 0
    const limitada = Math.max(-1, Math.min(1, amostra))
    dados[i] = limitada < 0 ? Math.round(limitada * 0x8000) : Math.round(limitada * 0x7fff)
  }

  const buffer = new ArrayBuffer(44 + dados.byteLength)
  const view = new DataView(buffer)
  const escreverAscii = (offset: number, texto: string) => {
    for (let i = 0; i < texto.length; i += 1) {
      view.setUint8(offset + i, texto.charCodeAt(i))
    }
  }

  escreverAscii(0, 'RIFF')
  view.setUint32(4, 36 + dados.byteLength, true)
  escreverAscii(8, 'WAVE')
  escreverAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, TAXA_SAIDA, true)
  view.setUint32(28, TAXA_SAIDA * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  escreverAscii(36, 'data')
  view.setUint32(40, dados.byteLength, true)

  new Uint8Array(buffer, 44).set(new Uint8Array(dados.buffer))
  return new Uint8Array(buffer)
}

function bytesParaBase64(bytes: Uint8Array): string {
  let binario = ''
  const bloco = 0x8000
  for (let i = 0; i < bytes.length; i += bloco) {
    const fatia = bytes.subarray(i, i + bloco)
    binario += String.fromCharCode(...fatia)
  }
  return btoa(binario)
}

function criarUrlPreviewWav(bytes: Uint8Array): { url: string; revogar: boolean } {
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const copia = new Uint8Array(bytes.byteLength)
    copia.set(bytes)
    return {
      url: URL.createObjectURL(new Blob([copia.buffer], { type: 'audio/wav' })),
      revogar: true,
    }
  }
  return {
    url: `data:audio/wav;base64,${bytesParaBase64(bytes)}`,
    revogar: false,
  }
}

function detectarReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Modal de gravação no microfone com teleprompter integrado (`Rolagem` e `Passo`),
 * captura Web Audio -> WAV 24 kHz mono PCM e tratamento de permissão negada / silêncio sem fala.
 */
export function GravadorTeleprompter({
  aberto,
  bloco,
  totalBlocos,
  aoSalvarAudio,
  aoDescartarRascunho,
  aoAlternarParaImportar,
  aoAlternarParaTts,
  aoFechar,
}: GravadorTeleprompterProps) {
  const [modo, setModo] = useState<ModoLeitura>(() => (detectarReducedMotion() ? 'passo' : 'rolagem'))
  const [tamanhoFontePx, setTamanhoFontePx] = useState(22)
  const [velocidadePxSeg, setVelocidadePxSeg] = useState(36)
  const [rolandoPausado, setRolandoPausado] = useState(false)
  const [passoAtual, setPassoAtual] = useState(0)
  const [estado, setEstado] = useState<EstadoGravador>('ocioso')
  const [cronometroUs, setCronometroUs] = useState(0)
  const [nivelVu, setNivelVu] = useState(0)
  const [erroMensagem, setErroMensagem] = useState<string | null>(null)
  const [rascunhoUrl, setRascunhoUrl] = useState<{ url: string; revogar: boolean } | null>(null)
  const [confirmarDescarteAberto, setConfirmarDescarteAberto] = useState(false)

  const areaTextoRef = useRef<HTMLDivElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const blocosPcmRef = useRef<Float32Array[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rafVuRef = useRef<number | null>(null)
  const rafRolagemRef = useRef<number | null>(null)

  const passos = useMemo(() => {
    const bruto = (bloco?.narration ?? '').trim()
    if (!bruto) return ['Sem texto de roteiro definido para este bloco.']
    const partes = bruto
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
    return partes.length > 0 ? partes : [bruto]
  }, [bloco?.narration])

  const limparUrlRascunho = useCallback(() => {
    setRascunhoUrl((prev) => {
      if (prev?.revogar && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(prev.url)
      }
      return null
    })
  }, [])

  const encerrarCaptura = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (rafVuRef.current !== null) {
      cancelAnimationFrame(rafVuRef.current)
      rafVuRef.current = null
    }
    try {
      processorRef.current?.disconnect()
    } catch {
      // ignora
    }
    processorRef.current = null
    analyserRef.current = null

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close()
      audioCtxRef.current = null
    }
    setNivelVu(0)
  }, [])

  useEffect(() => {
    if (!aberto) {
      encerrarCaptura()
      limparUrlRascunho()
      setConfirmarDescarteAberto(false)
      setEstado('ocioso')
      setErroMensagem(null)
      setCronometroUs(0)
      return
    }
    setModo(detectarReducedMotion() ? 'passo' : 'rolagem')
    setPassoAtual(0)
    setRolandoPausado(false)
    setEstado('ocioso')
    setErroMensagem(null)
    setCronometroUs(0)
  }, [aberto, bloco?.id, encerrarCaptura, limparUrlRascunho])

  useEffect(() => {
    return () => {
      encerrarCaptura()
      limparUrlRascunho()
    }
  }, [encerrarCaptura, limparUrlRascunho])

  useEffect(() => {
    if (!aberto || modo !== 'rolagem' || rolandoPausado || detectarReducedMotion()) {
      if (rafRolagemRef.current !== null) {
        cancelAnimationFrame(rafRolagemRef.current)
        rafRolagemRef.current = null
      }
      return
    }

    let ultimoTs = performance.now()
    const passoFrame = (agora: number) => {
      const dt = Math.max(0, (agora - ultimoTs) / 1000)
      ultimoTs = agora
      if (areaTextoRef.current) {
        areaTextoRef.current.scrollTop += velocidadePxSeg * dt
      }
      rafRolagemRef.current = requestAnimationFrame(passoFrame)
    }
    rafRolagemRef.current = requestAnimationFrame(passoFrame)

    return () => {
      if (rafRolagemRef.current !== null) {
        cancelAnimationFrame(rafRolagemRef.current)
        rafRolagemRef.current = null
      }
    }
  }, [aberto, modo, rolandoPausado, velocidadePxSeg])

  const solicitarFechamento = useCallback(() => {
    if (estado === 'gravando') {
      setConfirmarDescarteAberto(true)
      return
    }
    encerrarCaptura()
    limparUrlRascunho()
    aoFechar()
  }, [aoFechar, encerrarCaptura, estado, limparUrlRascunho])

  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (confirmarDescarteAberto) return

      const alvo = e.target instanceof Element ? e.target : null
      const emControleEdicao = Boolean(
        alvo?.closest('input, textarea, select, [role="slider"]'),
      )

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        solicitarFechamento()
        return
      }

      if (modo === 'passo' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        if (emControleEdicao) return
        e.preventDefault()
        setPassoAtual((atual) =>
          e.key === 'ArrowDown'
            ? Math.min(passos.length - 1, atual + 1)
            : Math.max(0, atual - 1),
        )
        return
      }

      if (e.key === ' ' && modo === 'rolagem' && !emControleEdicao) {
        e.preventDefault()
        setRolandoPausado((p) => !p)
      }
    }

    window.addEventListener('keydown', aoTeclar, { capture: true })
    return () => window.removeEventListener('keydown', aoTeclar, { capture: true })
  }, [aberto, confirmarDescarteAberto, modo, passos.length, solicitarFechamento])

  const iniciarGravacao = async () => {
    if (!bloco) return
    limparUrlRascunho()
    setErroMensagem(null)
    blocosPcmRef.current = []

    if (!navigator.mediaDevices?.getUserMedia) {
      setEstado('permissao_negada')
      setErroMensagem('Captura de microfone indisponível neste ambiente.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const CtxAudio = window.AudioContext
      const ctx = new CtxAudio()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyserRef.current = analyser

      const proc = ctx.createScriptProcessor(2048, 1, 1)
      processorRef.current = proc
      proc.onaudioprocess = (ev) => {
        const canal = ev.inputBuffer?.getChannelData(0)
        if (canal) {
          blocosPcmRef.current.push(new Float32Array(canal))
        }
      }

      source.connect(analyser)
      analyser.connect(proc)
      proc.connect(ctx.destination)

      setEstado('gravando')
      setCronometroUs(0)
      const inicioMs = Date.now()
      timerRef.current = setInterval(() => {
        setCronometroUs((Date.now() - inicioMs) * 1000)
      }, 100)

      const bufferVu = new Uint8Array(analyser.frequencyBinCount)
      const atualizarVu = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteTimeDomainData(bufferVu)
        let pico = 0
        for (let i = 0; i < bufferVu.length; i += 1) {
          const desvio = Math.abs(bufferVu[i] - 128) / 128
          if (desvio > pico) pico = desvio
        }
        setNivelVu(Math.min(100, Math.round(pico * 160)))
        rafVuRef.current = requestAnimationFrame(atualizarVu)
      }
      rafVuRef.current = requestAnimationFrame(atualizarVu)
    } catch (erro) {
      encerrarCaptura()
      const nomeErro = erro instanceof Error ? erro.name : ''
      if (nomeErro === 'NotAllowedError' || nomeErro === 'PermissionDeniedError') {
        setEstado('permissao_negada')
        setErroMensagem('Permissão de microfone negada. Use uma alternativa ou libere o microfone no sistema.')
        return
      }
      const erroCore = paraErroCore(erro)
      setEstado('erro')
      setErroMensagem(mensagemDeErro(erroCore).titulo)
    }
  }

  const pararESalvar = async () => {
    if (!bloco) return
    const taxaOrigem = audioCtxRef.current?.sampleRate ?? TAXA_SAIDA
    const totalAmostras = blocosPcmRef.current.reduce((acc, b) => acc + b.length, 0)
    const combinado = new Float32Array(Math.max(totalAmostras, Math.round(taxaOrigem * 0.2)))
    let pos = 0
    for (const parte of blocosPcmRef.current) {
      combinado.set(parte, pos)
      pos += parte.length
    }

    encerrarCaptura()
    const wavBytes = codificarWavPcm24kMono(combinado, taxaOrigem)
    const audioBase64 = bytesParaBase64(wavBytes)

    setEstado('enviando')
    setErroMensagem(null)
    try {
      await aoSalvarAudio({
        blockId: bloco.id,
        audioBase64,
        mimeType: 'audio/wav',
      })
      limparUrlRascunho()
      setEstado('ocioso')
      aoFechar()
    } catch (erro) {
      const erroCore = paraErroCore(erro)
      const msg = mensagemDeErro(erroCore).titulo
      setErroMensagem(msg)
      if (erroCore.code === 'no_speech_detected') {
        setRascunhoUrl(criarUrlPreviewWav(wavBytes))
        setEstado('sem_fala')
        return
      }
      setEstado('erro')
    }
  }

  const descartarRascunho = async () => {
    if (!bloco) return
    await aoDescartarRascunho(bloco.id)
    limparUrlRascunho()
    setErroMensagem(null)
    setEstado('ocioso')
  }

  const tituloDialogo = bloco
    ? `Gravar Narração · Bloco ${bloco.position} de ${totalBlocos}: ${bloco.title}`
    : 'Gravar Narração'

  return (
    <>
      <Dialogo
        aberto={aberto}
        aoMudarAberto={(prox) => {
          if (!prox) solicitarFechamento()
        }}
        titulo={tituloDialogo}
        largura={680}
        rodape={
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="num text-base font-medio text-t1">{tc(cronometroUs)}</span>
              <Status tom={estado === 'gravando' ? 'rodando' : estado === 'sem_fala' || estado === 'erro' ? 'aviso' : 'neutro'}>
                {estado === 'gravando'
                  ? 'Gravando'
                  : estado === 'enviando'
                    ? 'Processando…'
                    : estado === 'sem_fala'
                      ? 'Sem fala detectada'
                      : 'Pronto para gravar'}
              </Status>
            </div>

            <div className="flex items-center gap-2">
              <Botao variante="fantasma" onClick={solicitarFechamento}>
                Fechar
              </Botao>
              {estado === 'gravando' ? (
                <Botao variante="primario" icone={<Square />} onClick={() => void pararESalvar()}>
                  Parar e salvar
                </Botao>
              ) : (
                <Botao
                  variante="primario"
                  icone={<Mic />}
                  carregando={estado === 'enviando'}
                  disabled={!bloco || estado === 'enviando'}
                  onClick={() => void iniciarGravacao()}
                >
                  {estado === 'sem_fala' ? 'Gravar novamente' : 'Gravar'}
                </Botao>
              )}
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {/* Controles do teleprompter */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-area bg-area p-2.5">
            <Segmentado<ModoLeitura>
              rotulo="Modo do teleprompter"
              valor={modo}
              aoMudar={setModo}
              opcoes={[
                { valor: 'rolagem', rotulo: 'Rolagem' },
                { valor: 'passo', rotulo: 'Passo' },
              ]}
            />

            <div className="flex items-center gap-2">
              <BotaoIcone
                rotulo="Diminuir fonte"
                onClick={() => setTamanhoFontePx((v) => Math.max(16, v - 2))}
              >
                <span className="text-pequeno font-medio">A-</span>
              </BotaoIcone>
              <BotaoIcone
                rotulo="Aumentar fonte"
                onClick={() => setTamanhoFontePx((v) => Math.min(34, v + 2))}
              >
                <span className="text-pequeno font-medio">A+</span>
              </BotaoIcone>
            </div>

            {modo === 'rolagem' ? (
              <div className="flex min-w-[180px] flex-1 items-center gap-2">
                <BotaoIcone
                  rotulo={rolandoPausado ? 'Retomar rolagem' : 'Pausar rolagem'}
                  atalho="Espaço"
                  onClick={() => setRolandoPausado((p) => !p)}
                >
                  {rolandoPausado ? <Play /> : <Pause />}
                </BotaoIcone>
                <div className="min-w-[120px] flex-1">
                  <Slider
                    rotulo="Velocidade da rolagem"
                    valor={velocidadePxSeg}
                    aoMudar={setVelocidadePxSeg}
                    min={15}
                    max={90}
                    passo={3}
                    textoValor={(v) => `${v} px/s`}
                  />
                </div>
                <span className="num text-pequeno text-t3">{velocidadePxSeg} px/s</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="num text-pequeno text-t2">
                  Passo {passoAtual + 1} de {passos.length}
                </span>
                <BotaoIcone
                  rotulo="Passo anterior"
                  atalho="↑"
                  disabled={passoAtual === 0}
                  onClick={() => setPassoAtual((p) => Math.max(0, p - 1))}
                >
                  <ArrowUp />
                </BotaoIcone>
                <BotaoIcone
                  rotulo="Próximo passo"
                  atalho="↓"
                  disabled={passoAtual >= passos.length - 1}
                  onClick={() => setPassoAtual((p) => Math.min(passos.length - 1, p + 1))}
                >
                  <ArrowDown />
                </BotaoIcone>
              </div>
            )}
          </div>

          {/* Área de leitura do teleprompter (<= 68 ch) */}
          <div
            ref={areaTextoRef}
            className="max-h-[260px] min-h-[160px] overflow-y-auto rounded-area bg-chao p-4"
          >
            <div
              className="mx-auto max-w-[68ch] leading-relaxed text-t1"
              style={{ fontSize: `${tamanhoFontePx}px` }}
            >
              {modo === 'passo' ? (
                <p className="m-0 whitespace-pre-wrap">{passos[passoAtual]}</p>
              ) : (
                <p className="m-0 whitespace-pre-wrap">{(bloco?.narration ?? '').trim() || passos[0]}</p>
              )}
            </div>
          </div>

          {/* VU do microfone */}
          <div className="flex items-center gap-2.5">
            <span className="text-pequeno text-t3">Microfone</span>
            <div
              role="progressbar"
              aria-label="Nível do microfone"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={nivelVu}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-area"
            >
              <div
                className="h-full bg-t1 transition-[width] duration-75 ease-out"
                style={{ width: `${nivelVu}%` }}
              />
            </div>
          </div>

          {/* Alertas acionáveis: permissão negada ou sem fala detectada */}
          {erroMensagem && (
            <div role="alert" className="flex flex-col gap-2 text-pequeno text-erro">
              <p className="m-0 flex items-start gap-1.5">
                <AlertCircle className="mt-px size-[14px] shrink-0 stroke-[1.75]" aria-hidden />
                {erroMensagem}
              </p>

              {estado === 'permissao_negada' && (
                <div className="flex flex-wrap gap-2">
                  {aoAlternarParaImportar && (
                    <Botao
                      variante="secundario"
                      tamanho="p"
                      onClick={() => {
                        aoFechar()
                        aoAlternarParaImportar()
                      }}
                    >
                      Importar áudio
                    </Botao>
                  )}
                  {aoAlternarParaTts && (
                    <Botao
                      variante="secundario"
                      tamanho="p"
                      onClick={() => {
                        aoFechar()
                        aoAlternarParaTts()
                      }}
                    >
                      Usar TTS local
                    </Botao>
                  )}
                </div>
              )}

              {estado === 'sem_fala' && rascunhoUrl && (
                <div className="flex flex-wrap items-center gap-2 rounded-area bg-area p-2.5 text-t1">
                  <audio
                    controls
                    src={rascunhoUrl.url}
                    className="h-8 flex-1 [color-scheme:dark] [[data-tema='claro']_&]:[color-scheme:light]"
                  />
                  <Botao
                    variante="fantasma"
                    tamanho="p"
                    icone={<Trash2 />}
                    onClick={() => void descartarRascunho()}
                  >
                    Descartar rascunho
                  </Botao>
                </div>
              )}
            </div>
          )}
        </div>
      </Dialogo>

      <ConfirmDialog
        aberto={confirmarDescarteAberto}
        aoMudarAberto={setConfirmarDescarteAberto}
        titulo="Descartar gravação em andamento?"
        descricao="Se você fechar agora, o áudio gravado neste bloco será perdido."
        rotuloConfirmar="Descartar gravação"
        rotuloCancelar="Continuar gravando"
        variante="perigo"
        focoInicial="cancelar"
        aoConfirmar={() => {
          setConfirmarDescarteAberto(false)
          encerrarCaptura()
          limparUrlRascunho()
          aoFechar()
        }}
      />
    </>
  )
}
