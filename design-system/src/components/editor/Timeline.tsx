import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { img } from '@/data/dados'
import { clamp, tc } from '@/lib/formato'
import { cn } from '@/lib/cn'
import type { EstadoEditor } from './estado'

export function Timeline({ ed, zoom = 1, onEditar }: { ed: EstadoEditor; zoom?: number; onEditar?: () => void }) {
  const area = useRef<HTMLDivElement>(null)
  const arraste = useRef<'in' | 'out' | 'tempo' | null>(null)
  const { c, e, t } = ed
  const vs = c.inicio - 2
  const ve = c.fim + 2
  const span = ve - vs
  const x = (s: number) => `${(100 * (s - vs)) / span}%`
  const largura = (s: number, fim: number) => `${(100 * (fim - s)) / span}%`
  const mover = (ev: PointerEvent<HTMLDivElement>) => {
    if (!arraste.current || !area.current) return
    const r = area.current.getBoundingClientRect()
    const tempo = vs + clamp((ev.clientX - r.left) / r.width, 0, 1) * span
    if (arraste.current === 'tempo') ed.ir(tempo)
    else ed.borda(arraste.current, tempo, ev.altKey)
  }
  const descer = (ev: PointerEvent<HTMLDivElement>) => {
    if ((ev.target as HTMLElement).closest('button')) return
    onEditar?.()
    const alca = (ev.target as HTMLElement).closest<HTMLElement>('[data-alca]')
    arraste.current = alca ? (alca.dataset.alca as 'in' | 'out') : 'tempo'
    ev.currentTarget.setPointerCapture(ev.pointerId)
    mover(ev)
  }
  const tecladoBorda = (lado: 'in' | 'out') => (ev: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return
    ev.preventDefault()
    ev.stopPropagation()
    if (ev.key === 'Home' || ev.key === 'End') ed.borda(lado, ev.key === 'Home' ? c.inicio : c.fim)
    else ed.passoBorda(lado, ev.key === 'ArrowLeft' ? -1 : 1, ev.altKey)
  }
  const passo = span > 55 ? 10 : 5
  const marcas: number[] = []
  for (let s = Math.ceil(vs / passo) * passo; s <= ve; s += passo) marcas.push(s)
  const dt = (c.fim - c.inicio) / c.thumbs.length
  return (
    <section aria-label="Timeline do Corte" className="shrink-0 border-t border-line bg-surface px-6 pt-2 pb-3">
      <div className="flex gap-3">
        <div className="flex w-12 shrink-0 flex-col gap-1.5 pt-7 text-2xs text-fg-3" aria-hidden>
          <span className="flex h-10 items-center">Vídeo</span>
          <span className="flex h-9 items-center">Áudio</span>
          <span className="flex h-7 items-center">Frases</span>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden pb-1">
          <div
            ref={area}
            className="relative h-[158px] touch-none select-none"
            style={{ width: `${zoom * 100}%` }}
            onPointerDown={descer}
            onPointerMove={mover}
            onPointerUp={() => {
              arraste.current = null
            }}
            onPointerCancel={() => {
              arraste.current = null
            }}
          >
            <div className="relative h-7" aria-hidden>
              {marcas.map((s) => (
                <span key={s} className="absolute bottom-0 h-2 border-l border-line-strong" style={{ left: x(s) }}>
                  <span className="timecode absolute bottom-2 left-1 whitespace-nowrap text-2xs text-fg-3">
                    {tc(s)}
                  </span>
                </span>
              ))}
            </div>
            <div className="relative mb-1.5 h-10 overflow-hidden rounded-xs bg-track hachura" aria-hidden>
              {c.thumbs.map((th, i) => (
                <div
                  key={th}
                  className="absolute inset-y-0 overflow-hidden border-r border-canvas/50"
                  style={{ left: x(c.inicio + i * dt), width: largura(0, dt) }}
                >
                  <img src={img(th)} alt="" draggable={false} className="h-full w-full object-cover" />
                </div>
              ))}
            </div>
            <div className="relative mb-1.5 h-9 overflow-hidden rounded-xs bg-track" aria-label="Onde há silêncios">
              <svg
                aria-hidden
                className="absolute inset-y-0 h-full fill-wave"
                viewBox={`0 0 ${c.peaks.length} 100`}
                preserveAspectRatio="none"
                style={{ left: x(c.inicio), width: largura(c.inicio, c.fim) }}
              >
                {c.peaks.map((p, i) => (
                  <rect key={i} x={i + 0.15} y={50 - p * 45} width={0.7} height={Math.max(2, p * 90)} />
                ))}
              </svg>
              {ed.silencios.map((s) => (
                <span
                  key={s.s}
                  className={cn('absolute inset-y-0 border-x border-line-strong hachura', e.sil && 'bg-canvas/75')}
                  title={`Silêncio ${e.sil ? 'removido' : 'detectado'}: ${tc(s.e - s.s, true)}`}
                  style={{ left: x(s.s), width: largura(s.s, s.e) }}
                />
              ))}
            </div>
            <div className="relative h-7" aria-label="Frases na timeline">
              {c.frases.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  title={`${tc(f.s, true)} · ${f.texto}`}
                  aria-label={`Ir à Frase: ${f.texto}`}
                  onClick={() => {
                    onEditar?.()
                    ed.ir(f.s + 0.001)
                  }}
                  className={cn(
                    'foco absolute inset-y-0 overflow-hidden rounded-xs border px-1.5 text-left text-2xs transition-colors duration-(--dur-fast)',
                    ed.frase?.id === f.id
                      ? 'border-accent-line bg-accent-subtle text-fg'
                      : 'border-line-strong bg-track text-fg-2 hover:bg-hover',
                  )}
                  style={{ left: `calc(${x(f.s)} + 1px)`, width: `calc(${largura(f.s, f.e)} - 2px)` }}
                >
                  <span className="block truncate">{f.texto}</span>
                </button>
              ))}
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute top-7 bottom-0 left-0"
              style={{ width: x(e.inn), background: 'var(--track-outside)' }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute top-7 right-0 bottom-0"
              style={{ width: `${100 - (100 * (e.out - vs)) / span}%`, background: 'var(--track-outside)' }}
            />
            {(['in', 'out'] as const).map((lado) => (
              <div
                key={lado}
                data-alca={lado}
                role="slider"
                tabIndex={0}
                aria-label={lado === 'in' ? 'Início do Corte' : 'Fim do Corte'}
                aria-valuemin={lado === 'in' ? c.inicio : e.inn + 0.1}
                aria-valuemax={lado === 'in' ? e.out - 0.1 : c.fim}
                aria-valuenow={lado === 'in' ? e.inn : e.out}
                aria-valuetext={`${tc(lado === 'in' ? e.inn : e.out, true)} da Fonte`}
                aria-describedby="ajuste-bordas"
                onKeyDown={tecladoBorda(lado)}
                className="foco absolute z-10 top-6 bottom-0 w-6 -translate-x-1/2 cursor-ew-resize rounded-sm"
                style={{ left: x(lado === 'in' ? e.inn : e.out) }}
              >
                <span className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 bg-handle" />
                <span className="pointer-events-none absolute top-0 left-1/2 flex h-7 w-2.5 -translate-x-1/2 items-center justify-center rounded-xs bg-handle text-canvas">
                  <span className="h-3 w-px bg-canvas" />
                </span>
              </div>
            ))}
            <div
              role="slider"
              tabIndex={0}
              aria-label="Posição de reprodução"
              aria-valuemin={c.inicio}
              aria-valuemax={c.fim}
              aria-valuenow={Math.round(t * 1000) / 1000}
              aria-valuetext={tc(t, true)}
              className="foco absolute top-0 bottom-0 w-6 -translate-x-1/2 rounded-xs"
              style={{ left: x(t) }}
              onKeyDown={(ev) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) {
                  ev.preventDefault()
                  ev.stopPropagation()
                  if (ev.key === 'Home' || ev.key === 'End') ed.ir(ev.key === 'Home' ? e.inn : e.out)
                  else ed.passoPalavra(ev.key === 'ArrowLeft' ? -1 : 1)
                }
              }}
            >
              <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-playhead" />
              <span className="pointer-events-none absolute top-0 left-1/2 size-2 -translate-x-1/2 rotate-45 rounded-xs bg-playhead" />
            </div>
          </div>
        </div>
      </div>
      <p id="ajuste-bordas" className="mt-1 flex justify-between text-2xs text-fg-3">
        <span>Alças: ← → por Frase · Alt para ajustar 0,1 s</span>
        <span className="timecode">
          Fonte {tc(e.inn, true)} — {tc(e.out, true)}
        </span>
      </p>
    </section>
  )
}
