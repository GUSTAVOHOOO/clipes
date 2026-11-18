import { Botao, Dica, cn, tcLongo } from '@ds'
import { AlertTriangle, Film, Pause, Play, Wrench } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { mediaUrl } from '../../../src/lib/media'

export type PlayerReferenciaFonteProps = {
  fonteId: number
  disponivel: boolean
  seekUs?: number | null
  duracaoUs?: number
  aoMudarTempoUs?: (tempoUs: number) => void
  aoPedirRelocalizacao?: () => void
  className?: string
}

/** Player de referência leve para Fontes inteiras via `mediaUrl("source/" + fonteId)` (HTTP 206 Range). */
export function PlayerReferenciaFonte({
  fonteId,
  disponivel,
  seekUs,
  duracaoUs = 0,
  aoMudarTempoUs,
  aoPedirRelocalizacao,
  className,
}: PlayerReferenciaFonteProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [erroVideo, setErroVideo] = useState(false)
  const [erroAudio, setErroAudio] = useState(false)
  const [reproduzindo, setReproduzindo] = useState(false)
  const [tempoLocalUs, setTempoLocalUs] = useState(0)

  const src = mediaUrl(`source/${fonteId}`)

  useEffect(() => {
    setErroVideo(false)
    setErroAudio(false)
    setReproduzindo(false)
    setTempoLocalUs(0)
  }, [fonteId, disponivel])

  useEffect(() => {
    if (!disponivel || seekUs == null || !Number.isFinite(seekUs)) return
    const alvoSeg = Math.max(0, seekUs / 1_000_000)
    const alvoEl = erroVideo ? audioRef.current : videoRef.current
    if (alvoEl) {
      try {
        alvoEl.currentTime = alvoSeg
      } catch {
        // jsdom/WebView pode ignorar antes de metadata
      }
    }
    setTempoLocalUs(seekUs)
  }, [disponivel, erroVideo, seekUs])

  const alternarReproducao = useCallback(() => {
    const el = erroVideo ? audioRef.current : videoRef.current
    if (!el) return
    if (el.paused) {
      void el.play?.().catch(() => {})
    } else {
      el.pause?.()
    }
  }, [erroVideo])

  if (!disponivel) {
    return (
      <section
        aria-label="Player de referência indisponível"
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-area bg-area px-3 py-2.5',
          className,
        )}
      >
        <div className="flex min-w-0 flex-1 items-start gap-2 text-pequeno text-t2">
          <AlertTriangle className="mt-0.5 size-[15px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
          <span>
            <strong className="font-medio text-t1">Vídeo indisponível no disco</strong> — você ainda
            pode ler, buscar e corrigir toda a Transcrição. Relocalize a Fonte para reproduzir o
            trecho.
          </span>
        </div>
        {aoPedirRelocalizacao && (
          <Botao
            variante="secundario"
            tamanho="p"
            icone={<Wrench />}
            onClick={aoPedirRelocalizacao}
          >
            Relocalizar / Verificar
          </Botao>
        )}
      </section>
    )
  }

  return (
    <section
      aria-label="Player de referência"
      className={cn('flex flex-wrap items-center gap-3 rounded-area bg-area p-2.5', className)}
    >
      {!erroVideo ? (
        <div className="w-44 shrink-0 overflow-hidden rounded-controle bg-preto">
          <video
            ref={videoRef}
            src={src}
            controls
            preload="metadata"
            playsInline
            aria-label="Player de referência da Fonte"
            className="aspect-video block w-full object-contain"
            onPlay={() => setReproduzindo(true)}
            onPause={() => setReproduzindo(false)}
            onError={() => {
              setReproduzindo(false)
              setErroVideo(true)
            }}
            onTimeUpdate={(e) => {
              const us = Math.round(e.currentTarget.currentTime * 1_000_000)
              setTempoLocalUs(us)
              aoMudarTempoUs?.(us)
            }}
          />
        </div>
      ) : (
        <div className="flex min-w-52 flex-1 flex-col gap-1.5 rounded-controle bg-chao p-2">
          {!erroAudio ? (
            <>
              <p className="text-pequeno text-t2">
                Não foi possível reproduzir o vídeo neste formato na WebView; reproduzindo apenas o
                áudio.
              </p>
              <audio
                ref={audioRef}
                src={src}
                controls
                preload="metadata"
                aria-label="Reprodução de áudio de referência"
                className="h-8 w-full"
                onPlay={() => setReproduzindo(true)}
                onPause={() => setReproduzindo(false)}
                onError={() => setErroAudio(true)}
                onTimeUpdate={(e) => {
                  const us = Math.round(e.currentTarget.currentTime * 1_000_000)
                  setTempoLocalUs(us)
                  aoMudarTempoUs?.(us)
                }}
              />
            </>
          ) : (
            <p className="text-pequeno text-t2">
              Prévia de mídia indisponível para reprodução direta na WebView; leitura, busca e
              correção da Transcrição seguem ativas.
            </p>
          )}
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {!erroAudio && (
            <Botao
              variante="secundario"
              tamanho="p"
              icone={reproduzindo ? <Pause /> : <Play />}
              onClick={alternarReproducao}
            >
              {reproduzindo ? 'Pausar' : 'Reproduzir'}
            </Botao>
          )}
          <span className="num text-pequeno text-t1">
            {tcLongo(tempoLocalUs)}
            {duracaoUs > 0 ? <span className="text-t3"> / {tcLongo(duracaoUs)}</span> : null}
          </span>

          <Dica texto="Tira de miniaturas ainda indisponível para esta Fonte.">
            <span tabIndex={0} className="ml-auto inline-flex">
              <Botao variante="fantasma" tamanho="p" icone={<Film />} disabled>
                Tira de miniaturas
              </Botao>
            </span>
          </Dica>
        </div>

        <p className="text-pequeno text-t3">
          Clique na palavra = ir ao vídeo · <kbd className="font-mono">F2</kbd> ou{' '}
          <kbd className="font-mono">Enter</kbd> = corrigir grafia ·{' '}
          <kbd className="font-mono">←</kbd>/<kbd className="font-mono">→</kbd> = navegar
        </p>
      </div>
    </section>
  )
}
