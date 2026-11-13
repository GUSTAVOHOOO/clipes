// Núcleo comum (F, G, H): preview 9:16 com legenda karaokê e quadro 16:9 da Fonte com o retângulo de recorte.
import { useRef, type PointerEvent as PE, type ReactNode } from 'react'
import { img, type Corte } from '../../dados'
import { LinhaLegenda, clamp, foco, type Layout, type Preset } from './base'
import { LARG_CROP } from './editor'

/** background-position-x de um recorte centrado em cx que ocupa `frac` da largura da imagem. */
const posX = (cx: number, frac: number) => `${(clamp(cx - frac / 2, 0, 1 - frac) / (1 - frac)) * 100}%`

function Quadro({ c, layout, cx, padraoCx }: { c: Corte; layout: Layout; cx: number; padraoCx: number }) {
  const wide = `url(${img(c.wide)})`
  const recorte = (frac: number, x: number) => ({ backgroundImage: wide, backgroundSize: 'auto 100%', backgroundPosition: `${posX(x, frac)} 50%` })
  if (layout === 'fit') return (
    <>
      <div className="absolute inset-0 scale-125 opacity-50 blur-[18px]" style={{ backgroundImage: wide, backgroundSize: 'cover', backgroundPosition: 'center' }} />
      <img src={img(c.wide)} alt="" className="absolute left-0 right-0 top-1/2 -translate-y-1/2 w-full aspect-video object-cover" />
    </>
  )
  if (layout === 'jogo') return (
    <>
      <div className="absolute inset-x-0 top-0 h-[58%] bg-cover bg-center" style={{ backgroundImage: wide }} />
      <div className="absolute inset-x-0 bottom-0 h-[42%] border-t border-black" style={recorte(0.753, cx)} />
    </>
  )
  if (layout === 'duas') return (
    <>
      <div className="absolute inset-x-0 top-0 h-1/2" style={recorte(0.633, clamp(cx - 0.2, 0.32, 0.68))} />
      <div className="absolute inset-x-0 bottom-0 h-1/2 border-t border-black" style={recorte(0.633, clamp(cx + 0.2, 0.32, 0.68))} />
    </>
  )
  const x = layout === 'cheia' ? 0.5 : cx
  if (layout === 'rosto' && Math.abs(cx - padraoCx) < 0.001)
    return <img src={img(c.vert)} alt="" className="absolute inset-0 w-full h-full object-cover" />
  return <div className="absolute inset-0" style={recorte(LARG_CROP, x)} />
}

/** Preview 9:16 que cabe no contêiner. A legenda é desenhada no estilo do preset. */
export function Preview({ c, cx, layout, grupo, ativa, preset, pos, escala, className = '', moldura = '', onClick, children, rotulo }: {
  c: Corte; cx: number; layout: Layout; grupo: { id: string; t: string }[]; ativa?: string; preset: Preset; pos: number; escala: 'P' | 'M' | 'G'
  className?: string; moldura?: string; onClick?: () => void; children?: ReactNode; rotulo?: string
}) {
  // Tamanho só com CSS (container queries): o quadro cabe no contêiner sem medir nada em JS.
  const tamanho = { P: 7, M: 8.8, G: 10.6 }[escala] // em cqw do próprio quadro
  return (
    <div className={`min-h-0 min-w-0 flex items-center justify-center [container-type:size] ${className}`}>
      <div role={onClick ? 'button' : 'img'} tabIndex={onClick ? 0 : undefined} onClick={onClick}
        onKeyDown={onClick ? ev => { if (ev.key === 'Enter') onClick() } : undefined}
        aria-label={rotulo ?? `Preview 9:16 de ${c.titulo}`}
        className={`relative shrink-0 overflow-hidden rounded-[6px] bg-black [container-type:inline-size] ${onClick ? foco : ''} ${moldura}`}
        style={{ height: 'min(100cqh, 100cqw * 16 / 9)', aspectRatio: '9 / 16' }}>
        <Quadro c={c} layout={layout} cx={cx} padraoCx={c.cx} />
        {grupo.length > 0 && (
          <div className="absolute inset-x-[7%] flex justify-center text-center -translate-y-1/2 pointer-events-none" style={{ top: `${pos * 100}%` }}>
            <LinhaLegenda palavras={grupo} ativa={ativa} preset={preset} tamanho={tamanho} unidade="cqw" />
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

/** Quadro 16:9 da Fonte com o retângulo 9:16 arrastável. Teclado: ← → movem 1%, Shift 5%. */
export function QuadroFonte({ c, cx, onCx, keyframes, className = '' }: {
  c: Corte; cx: number; onCx: (v: number) => void; keyframes?: { t: number; cx: number }[]; className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const pega = useRef<number | null>(null)
  const L = clamp(cx - LARG_CROP / 2, 0, 1 - LARG_CROP)
  const mover = (ev: PE<HTMLDivElement>) => {
    if (pega.current == null) return
    const r = box.current!.getBoundingClientRect()
    onCx(clamp((ev.clientX - r.left) / r.width - pega.current, LARG_CROP / 2, 1 - LARG_CROP / 2))
  }
  return (
    <div ref={box} className={`relative aspect-video rounded-[4px] overflow-hidden bg-black select-none touch-none ${className}`}
      onPointerMove={mover} onPointerUp={() => (pega.current = null)} onPointerCancel={() => (pega.current = null)}>
      <img src={img(c.wide)} alt={`Quadro 16:9 de ${c.titulo}`} draggable={false} className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: `${L * 100}%` }} />
      <div className="absolute inset-y-0 right-0 bg-black/60" style={{ left: `${(L + LARG_CROP) * 100}%` }} />
      {keyframes?.map((k, i) => (
        <span key={i} className="absolute bottom-1 w-1.5 h-1.5 rotate-45 bg-white/70 -translate-x-1/2" style={{ left: `${k.cx * 100}%` }} aria-hidden />
      ))}
      <div role="slider" tabIndex={0} aria-label="Posição do recorte 9:16" aria-valuenow={Math.round(cx * 100)} aria-valuemin={0} aria-valuemax={100}
        onKeyDown={ev => {
          const p = ev.shiftKey ? 0.05 : 0.01
          const d = ev.key === 'ArrowLeft' ? -p : ev.key === 'ArrowRight' ? p : 0
          if (d) { ev.preventDefault(); ev.stopPropagation(); onCx(clamp(cx + d, LARG_CROP / 2, 1 - LARG_CROP / 2)) }
        }}
        onPointerDown={ev => {
          const r = box.current!.getBoundingClientRect()
          pega.current = (ev.clientX - r.left) / r.width - cx
          box.current!.setPointerCapture(ev.pointerId)
        }}
        className={`absolute inset-y-0 border-2 border-[var(--acc)] cursor-grab active:cursor-grabbing ${foco}`}
        style={{ left: `${L * 100}%`, width: `${LARG_CROP * 100}%` }}>
        <span className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
        <span className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
      </div>
    </div>
  )
}
