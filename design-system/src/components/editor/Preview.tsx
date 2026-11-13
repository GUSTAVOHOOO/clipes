import { useRef, type CSSProperties, type PointerEvent } from 'react'
import { img, presets, type Corte, type Layout, type Palavra, type PresetLegenda } from '@/data/dados'
import { clamp } from '@/lib/formato'
import { cn } from '@/lib/cn'
import { LARGURA_CROP } from './estado'

export type PreviewCorteProps = {
  corte: Corte
  t?: number
  cx?: number
  layout?: Layout
  grupo?: Pick<Palavra, 'id' | 't'>[]
  ativa?: string
  preset?: PresetLegenda
  pos?: number
  escala?: 'P' | 'M' | 'G'
  className?: string
}

function quadroNoTempo(corte: Corte, t?: number) {
  if (t === undefined || !corte.thumbs.length) return corte.wide
  const indice = clamp(
    Math.floor(((t - corte.inicio) / (corte.fim - corte.inicio)) * corte.thumbs.length),
    0,
    corte.thumbs.length - 1,
  )
  return corte.thumbs[indice]
}

/** Prévia a partir dos quadros locais de demonstração; não simula uma decodificação de vídeo. */
export function PreviewCorte({
  corte,
  t,
  cx = corte.cx,
  layout = 'rosto',
  grupo = corte.palavras.slice(0, 3),
  ativa,
  preset = presets[0],
  pos = preset.pos,
  escala = 'M',
  className,
}: PreviewCorteProps) {
  const quadro = quadroNoTempo(corte, t)
  const centro = layout === 'cheia' ? 0.5 : cx
  const posicao = clamp((centro - LARGURA_CROP / 2) / (1 - LARGURA_CROP), 0, 1) * 100
  return (
    <div
      className={cn(
        'relative aspect-9/16 shrink-0 overflow-hidden bg-letterbox ring-1 ring-line [container-type:inline-size]',
        className,
      )}
      aria-label="Prévia do Corte em 9:16"
    >
      {layout === 'duas' ? (
        <div className="flex h-full flex-col">
          {[25, 75].map((x) => (
            <img
              key={x}
              src={img(quadro)}
              alt=""
              className="h-1/2 w-full object-cover"
              style={{ objectPosition: `${x}% center` }}
            />
          ))}
        </div>
      ) : layout === 'jogo' ? (
        <div className="flex h-full flex-col">
          <img src={img(quadro)} alt="" className="h-2/3 w-full object-contain" />
          <img
            src={img(quadro)}
            alt=""
            className="h-1/3 w-full object-cover"
            style={{ objectPosition: `${posicao}% center` }}
          />
        </div>
      ) : (
        <img
          src={img(quadro)}
          alt="Quadro da Fonte Tears of Steel"
          draggable={false}
          className={cn('h-full w-full', layout === 'fit' ? 'object-contain' : 'object-cover')}
          style={{ objectPosition: `${posicao}% center` }}
        />
      )}
      {grupo.length > 0 && (
        <div className="absolute inset-x-[7%] -translate-y-1/2 text-center" style={{ top: `${pos * 100}%` }}>
          <LinhaLegenda palavras={grupo} ativa={ativa ?? grupo[0]?.id} preset={preset} escala={escala} responsiva />
        </div>
      )}
      <span className="absolute top-2 left-2 rounded-sm bg-letterbox/80 px-1.5 py-0.5 text-2xs text-white">9:16</span>
    </div>
  )
}

export function LinhaLegenda({
  palavras,
  ativa,
  preset,
  escala = 'M',
  responsiva,
}: {
  palavras: Pick<Palavra, 'id' | 't'>[]
  ativa?: string
  preset: PresetLegenda
  escala?: 'P' | 'M' | 'G'
  responsiva?: boolean
}) {
  const estilo: CSSProperties = {
    color: preset.cor,
    fontFamily: preset.fonte === 'Geist' ? 'var(--font-mono)' : 'var(--font-sans)',
    fontSize: responsiva ? { P: '7cqw', M: '8.8cqw', G: '10.6cqw' }[escala] : { P: 17, M: 22, G: 28 }[escala],
    lineHeight: 1.25,
    fontWeight: 700,
    WebkitTextStroke: `${preset.contorno / 4}px var(--media-letterbox)`,
    paintOrder: 'stroke fill',
    ...(preset.id === 'caixa' ? { background: presets[0].cor, padding: '4px 8px', boxDecorationBreak: 'clone' } : {}),
  }
  return (
    <span style={estilo}>
      {palavras.map((w, i) => (
        <span key={w.id}>
          {i > 0 && ' '}
          <span style={{ color: w.id === ativa ? preset.destaque : preset.cor }}>{w.t}</span>
        </span>
      ))}
    </span>
  )
}

export function QuadroFonte({
  corte,
  t,
  cx,
  onCx,
}: {
  corte: Corte
  t?: number
  cx: number
  onCx: (v: number) => void
}) {
  const quadro = quadroNoTempo(corte, t)
  const deslocamento = useRef(0)
  const mover = (e: PointerEvent<HTMLDivElement>) => {
    const caixa = e.currentTarget.getBoundingClientRect()
    onCx((e.clientX - caixa.left) / caixa.width - deslocamento.current)
  }
  return (
    <div
      className="relative aspect-video touch-none overflow-hidden rounded-md bg-letterbox select-none"
      onPointerDown={(e) => {
        const caixa = e.currentTarget.getBoundingClientRect()
        deslocamento.current = (e.target as HTMLElement).closest('[role="slider"]')
          ? (e.clientX - caixa.left) / caixa.width - cx
          : 0
        e.currentTarget.setPointerCapture(e.pointerId)
        mover(e)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) mover(e)
      }}
    >
      <img
        src={img(quadro)}
        alt="Fonte em 16:9 com área do recorte"
        draggable={false}
        className="h-full w-full object-cover"
      />
      <div
        tabIndex={0}
        role="slider"
        aria-label="Centro do recorte horizontal"
        aria-valuenow={Math.round(cx * 100)}
        aria-valuemin={Math.ceil(LARGURA_CROP * 50)}
        aria-valuemax={Math.floor(100 - LARGURA_CROP * 50)}
        aria-valuetext={`${Math.round(cx * 100)} por cento`}
        className="foco absolute inset-y-0 cursor-ew-resize touch-none border-2 border-handle bg-accent-subtle"
        style={{ left: `${(cx - LARGURA_CROP / 2) * 100}%`, width: `${LARGURA_CROP * 100}%` }}
        onKeyDown={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            e.preventDefault()
            e.stopPropagation()
            onCx(
              e.key === 'Home'
                ? LARGURA_CROP / 2
                : e.key === 'End'
                  ? 1 - LARGURA_CROP / 2
                  : cx + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.05 : 0.01),
            )
          }
        }}
      >
        <span className="absolute top-1 left-1 rounded-xs bg-letterbox px-1 text-2xs text-white">9:16</span>
      </div>
    </div>
  )
}
