// Núcleo comum (F, G, H): timeline configurável. Régua em tempo da Fonte, miniaturas, onda, Frases e, se pedido,
// uma trilha de palavras (a Transcrição dentro da timeline). Bordas encaixam em Frase; Alt solta o encaixe.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as KE, type PointerEvent as PE, type ReactNode } from 'react'
import { img, tc } from '../../dados'
import { clamp, foco } from './base'
import { encaixar, type EstadoEditor } from './editor'

export type Sel =
  | { tipo: 'corte' }
  | { tipo: 'palavra'; id: string }
  | { tipo: 'frase'; id: string }
  | { tipo: 'borda'; lado: 'in' | 'out' }
  | { tipo: 'recorte' }

export type Trilhas = { miniaturas: number; onda: number; frases: number; palavras: number }
type NomeTrilha = keyof Trilhas
const ORDEM: NomeTrilha[] = ['miniaturas', 'onda', 'frases', 'palavras']
const NOMES: Record<NomeTrilha, string> = { miniaturas: 'Vídeo', onda: 'Áudio', frases: 'Frases', palavras: 'Transcrição' }

/** Onda contínua (envelope espelhado), para quando o zoom deixa cada pico largo demais para barras. */
function envelope(peaks: number[]) {
  const cima = peaks.map((p, i) => `${i + 0.5},${(50 - Math.max(1, p * 46)).toFixed(1)}`)
  const baixo = peaks.map((p, i) => `${i + 0.5},${(50 + Math.max(1, p * 46)).toFixed(1)}`).reverse()
  return `M0,50 L${cima.join(' L')} L${peaks.length},50 L${baixo.join(' L')} Z`
}

export function Timeline({ ed, trilhas, ordem = ORDEM, sel, onSel, onEditarPalavra, onAviso, pxPorSeg, margem = 8, rotuloTrilhas = false, linhas = 2, className = '' }: {
  ed: EstadoEditor; trilhas: Trilhas; ordem?: NomeTrilha[]; sel?: Sel; onSel?: (s: Sel) => void; onEditarPalavra?: (id: string) => void
  onAviso?: (m: string) => void; pxPorSeg?: number; margem?: number; rotuloTrilhas?: boolean; linhas?: 1 | 2; className?: string
}) {
  const { c, e, t, todas, frase, ativa, silencios, mudar, ir, palavrasTexto } = ed
  const vs = Math.min(c.inicio - margem, e.inn - 1), ve = Math.max(c.fim + margem, e.out + 1)
  const span = ve - vs
  const x = (s: number) => `${((s - vs) / span) * 100}%`
  const larg = (a: number, b: number) => `${(Math.max(0, b - a) / span) * 100}%`
  const area = useRef<HTMLDivElement>(null)
  const rolo = useRef<HTMLDivElement>(null)
  const arraste = useRef<'in' | 'out' | 'scrub' | null>(null)
  const [dica, setDica] = useState<{ lado: 'in' | 'out'; solto: boolean } | null>(null)

  const tempoDe = (clientX: number) => {
    const r = area.current!.getBoundingClientRect()
    return vs + clamp((clientX - r.left) / r.width, 0, 1) * span
  }
  const mover = (ev: PE<HTMLDivElement>) => {
    const m = arraste.current
    if (!m) return
    const s = tempoDe(ev.clientX)
    if (m === 'in') { mudar({ inn: clamp(encaixar(s, 'in', todas, ev.altKey), vs, e.out - 1) }); setDica({ lado: 'in', solto: ev.altKey }) }
    else if (m === 'out') { mudar({ out: clamp(encaixar(s, 'out', todas, ev.altKey), e.inn + 1, ve) }); setDica({ lado: 'out', solto: ev.altKey }) }
    else ir(s)
  }
  const soltar = () => { arraste.current = null; setDica(null) }
  const descer = (ev: PE<HTMLDivElement>) => {
    const alvo = ev.target as HTMLElement
    const alca = alvo.closest('[data-alca]') as HTMLElement | null
    const pal = alvo.closest('[data-palavra]') as HTMLElement | null
    const fr = alvo.closest('[data-frase]') as HTMLElement | null
    if (alca) {
      const lado = alca.dataset.alca as 'in' | 'out'
      arraste.current = lado; onSel?.({ tipo: 'borda', lado })
    } else if (pal) {
      const w = c.palavras.find(p => p.id === pal.dataset.palavra)!
      ir(w.s + 0.001); onSel?.({ tipo: 'palavra', id: w.id })
      return
    } else if (fr) {
      const f = todas.find(p => p.id === fr.dataset.frase)!
      if (!f.fantasma) { ir(f.s + 0.001); onSel?.({ tipo: 'frase', id: f.id }) }
      else onAviso?.('Frase fora do Corte. Use Estender ±1 Frase para trazê-la.')
      return
    } else arraste.current = 'scrub'
    ev.currentTarget.setPointerCapture(ev.pointerId)
    mover(ev)
  }
  const alcaTeclado = (lado: 'in' | 'out') => (ev: KE) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return
    ev.preventDefault(); ev.stopPropagation()
    const dir = ev.key === 'ArrowLeft' ? -1 : 1
    if (ev.altKey) {
      if (lado === 'in') mudar({ inn: clamp(e.inn + dir * 0.1, vs, e.out - 1) })
      else mudar({ out: clamp(e.out + dir * 0.1, e.inn + 1, ve) })
      return
    }
    const m = lado === 'in' ? ed.estender('in', dir < 0 ? 1 : -1) : ed.estender('out', dir > 0 ? 1 : -1)
    if (m) onAviso?.(m)
  }

  // Com zoom (px por segundo), a timeline rola e segue o playhead.
  const largura = pxPorSeg ? span * pxPorSeg : undefined
  useEffect(() => {
    const r = rolo.current
    if (!r || !pxPorSeg) return
    const px = (t - vs) * pxPorSeg
    if (px < r.scrollLeft + 40 || px > r.scrollLeft + r.clientWidth - 80) r.scrollTo({ left: px - r.clientWidth * 0.3 })
  }, [t, pxPorSeg, vs])
  // Ao abrir um Corte ou trocar o zoom: a entrada (ou o playhead) perto da esquerda, sem a margem vazia na frente.
  useLayoutEffect(() => {
    const r = rolo.current
    if (!r || !pxPorSeg) return
    const ancora = t > e.inn + 0.2 ? t : e.inn
    r.scrollLeft = (ancora - vs) * pxPorSeg - (ancora === t ? r.clientWidth * 0.3 : 56)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, pxPorSeg])

  const passoRotulo = span / (largura ?? 1200) * 90 > 5 ? 10 : span / (largura ?? 1200) * 90 > 1 ? 5 : 1
  const marcas: number[] = []
  for (let s = Math.ceil(vs); s <= ve; s++) marcas.push(s)

  const RULER = 22
  const fundoFonte = { backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in oklch, var(--tx) 4%, transparent) 5px 6px)' }
  const dt = (c.fim - c.inicio) / c.thumbs.length
  const selFrase = sel?.tipo === 'frase' ? sel.id : undefined
  const selPal = sel?.tipo === 'palavra' ? sel.id : undefined
  const selBorda = sel?.tipo === 'borda' ? sel.lado : undefined

  // Palavras em duas linhas alternadas: o rótulo pode passar da duração da palavra até a próxima da mesma linha.
  const pals = palavrasTexto
  const duasLinhas = linhas === 2 && trilhas.palavras >= 34

  const nomes = ordem.filter(k => trilhas[k] > 0).map(k => ({ h: trilhas[k], n: NOMES[k] }))

  return (
    <div className={`flex min-h-0 select-none ${className}`}>
      {rotuloTrilhas && (
        <div className="w-[84px] shrink-0 flex flex-col gap-1.5 text-[11px] text-[var(--tx3)]" style={{ paddingTop: RULER + 6 }} aria-hidden>
          {nomes.map(n => <span key={n.n} className="flex items-center pl-3" style={{ height: n.h }}>{n.n}</span>)}
        </div>
      )}
      <div ref={rolo} className={`relative flex-1 min-w-0 ${pxPorSeg ? 'overflow-x-auto overflow-y-hidden nu-rolagem' : ''}`}>
        <div ref={area} className="relative h-full cursor-text touch-none" style={{ width: largura ?? '100%' }}
          onPointerDown={descer} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}
          onDoubleClick={ev => { const p = (ev.target as HTMLElement).closest('[data-palavra]') as HTMLElement | null; if (p) onEditarPalavra?.(p.dataset.palavra!) }}>
          {/* régua em tempo da Fonte */}
          <div className="absolute inset-x-0 top-0" style={{ height: RULER }}>
            {marcas.map(s => (
              <span key={s} className="absolute bottom-0 w-px bg-[var(--ln2)]" style={{ left: x(s), height: s % passoRotulo === 0 ? 8 : 4 }} />
            ))}
            {marcas.filter(s => s % passoRotulo === 0).map(s => (
              <span key={`r${s}`} className="absolute top-[3px] ml-1 font-mono tabular-nums text-[10px] text-[var(--tx3)]" style={{ left: x(s) }}>{tc(s)}</span>
            ))}
          </div>

          <div className="absolute inset-x-0 flex flex-col gap-1.5" style={{ top: RULER + 6 }}>
            {ordem.filter(k => trilhas[k] > 0).map(k => <div key={k}>{({
            miniaturas: () => (
              <div className="relative rounded-[3px] overflow-hidden bg-[var(--s2)]" style={{ ...fundoFonte, height: trilhas.miniaturas }}>
                {c.thumbs.map((th, i) => (
                  <div key={th} className="absolute inset-y-0 border-r border-black/40"
                    style={{ left: x(c.inicio + i * dt), width: larg(c.inicio + i * dt, c.inicio + (i + 1) * dt), backgroundImage: `url(${img(th)})`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }} />
                ))}
              </div>
            ),
            onda: () => (
              <div className="relative rounded-[3px] overflow-hidden bg-[var(--s2)]" style={{ ...fundoFonte, height: trilhas.onda }}>
                <svg className="absolute top-0 h-full" style={{ left: x(c.inicio), width: larg(c.inicio, c.fim) }} viewBox={`0 0 ${c.peaks.length} 100`} preserveAspectRatio="none" aria-hidden>
                  {pxPorSeg
                    ? <path d={envelope(c.peaks)} style={{ fill: 'var(--tx3)' }} />
                    : c.peaks.map((p, i) => {
                      const hh = Math.max(2, p * 92)
                      return <rect key={i} x={i + 0.15} y={50 - hh / 2} width={0.7} height={hh} style={{ fill: 'var(--tx3)' }} />
                    })}
                </svg>
                {silencios.map((s, i) => (
                  <div key={i} className="absolute inset-y-0 border-x border-[var(--ln2)]" title={e.sil ? 'Silêncio removido' : 'Silêncio detectado'}
                    style={{ left: x(s.s), width: larg(s.s, s.e), background: e.sil ? 'repeating-linear-gradient(135deg, color-mix(in oklch, var(--bg) 75%, transparent) 0 3px, color-mix(in oklch, var(--tx) 10%, transparent) 3px 4px)' : 'color-mix(in oklch, var(--tx) 5%, transparent)' }} />
                ))}
              </div>
            ),
            frases: () => (
              <div className="relative" style={{ height: trilhas.frases }}>
                {todas.map(f => {
                  const on = f.id === frase?.id, s = f.id === selFrase
                  return (
                    <div key={f.id} data-frase={f.id} title={f.texto}
                      className={`absolute inset-y-0 rounded-[3px] px-1.5 flex items-center text-[11px] border cursor-pointer transition-colors duration-150 ${
                        f.fantasma ? 'border-dashed border-[var(--ln2)] text-[var(--tx3)]'
                          : s ? 'bg-[var(--acc-bg)] border-[var(--acc)] text-[var(--tx)]'
                            : on ? 'bg-[var(--s3)] border-[var(--tx3)] text-[var(--tx)]'
                              : 'bg-[var(--s2)] border-[var(--ln2)] text-[var(--tx2)] hover:border-[var(--tx3)]'}`}
                      style={{ left: `calc(${x(f.s)} + 1px)`, width: `calc(${larg(f.s, f.e)} - 2px)` }}>
                      <span className="truncate">{f.texto}</span>
                    </div>
                  )
                })}
              </div>
            ),
            palavras: () => (
              <div className="relative" style={{ height: trilhas.palavras }} aria-label="Transcrição na timeline">
                {pals.map((w, i) => {
                  const linha = duasLinhas ? i % 2 : 0
                  const prox = pals[i + (duasLinhas ? 2 : 1)]
                  const fimRotulo = prox && prox.f === w.f ? prox.s : Math.max(w.e, (pals[i + 1]?.s ?? w.e))
                  const on = w.id === ativa?.id, s = w.id === selPal
                  const editada = !!e.textos[w.id]
                  const hLinha = duasLinhas ? trilhas.palavras / 2 : trilhas.palavras
                  return (
                    <div key={w.id} data-palavra={w.id} title={`${w.t} · ${tc(w.s, true)}`}
                      className="absolute cursor-pointer group" style={{ left: x(w.s), width: larg(w.s, Math.max(w.e, fimRotulo)), top: linha * hLinha, height: hLinha }}>
                      <span className={`absolute left-0 bottom-0 h-[3px] rounded-full transition-colors duration-150 ${s ? 'bg-[var(--acc)]' : on ? 'bg-[var(--tx)]' : 'bg-[var(--ln2)] group-hover:bg-[var(--tx3)]'}`}
                        style={{ width: `${(Math.max(0.05, w.e - w.s) / Math.max(0.05, Math.max(w.e, fimRotulo) - w.s)) * 100}%` }} />
                      <span className={`absolute left-0 right-1 truncate leading-none ${hLinha >= 40 ? 'text-[14px] bottom-[10px]' : hLinha >= 24 ? 'text-[13px] bottom-[5px]' : 'text-[11.5px] bottom-[5px]'} [text-overflow:clip] rounded-[3px] ${
                        s ? 'text-[var(--acc)] font-medium' : on ? 'text-[var(--tx)]' : editada ? 'text-[var(--tx)] underline decoration-dotted decoration-[var(--tx3)] underline-offset-2' : 'text-[var(--tx2)] group-hover:text-[var(--tx)]'}`}>{w.t}</span>
                    </div>
                  )
                })}
              </div>
            ),
            } as Record<NomeTrilha, () => ReactNode>)[k]()}</div>)}
          </div>

          {/* fora do Corte fica apagado */}
          <div className="absolute bottom-0 left-0 pointer-events-none" style={{ top: RULER, width: x(e.inn), background: 'color-mix(in oklch, var(--bg) 72%, transparent)' }} />
          <div className="absolute bottom-0 right-0 pointer-events-none" style={{ top: RULER, left: x(e.out), background: 'color-mix(in oklch, var(--bg) 72%, transparent)' }} />
          <div className="absolute border-y border-[var(--tx)]/60 pointer-events-none" style={{ top: RULER + 3, bottom: 0, left: x(e.inn), width: larg(e.inn, e.out) }} />

          {/* alças */}
          {(['in', 'out'] as const).map(q => {
            const s = selBorda === q
            return (
              <div key={q} data-alca={q} role="slider" tabIndex={0} onKeyDown={alcaTeclado(q)} onFocus={() => onSel?.({ tipo: 'borda', lado: q })}
                aria-label={q === 'in' ? 'Entrada do Corte. Setas movem 1 Frase; Alt + setas, 0,1 s' : 'Saída do Corte. Setas movem 1 Frase; Alt + setas, 0,1 s'}
                aria-valuetext={tc(q === 'in' ? e.inn : e.out, true)}
                className={`absolute w-2.5 cursor-ew-resize grid place-items-center ${foco} ${s ? 'bg-[var(--acc)]' : 'bg-[var(--tx)]'} ${q === 'in' ? '-translate-x-full rounded-l-[3px]' : 'rounded-r-[3px]'}`}
                style={{ top: RULER + 3, bottom: 0, left: x(q === 'in' ? e.inn : e.out) }}>
                <span className="w-px h-4 bg-[var(--bg)]/60 pointer-events-none" />
                {dica?.lado === q && (
                  <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[4px] bg-[var(--s3)] border border-[var(--ln2)] px-1.5 py-0.5 text-[11px] text-[var(--tx)] font-mono tabular-nums pointer-events-none">
                    {tc(q === 'in' ? e.inn : e.out, true)} · {dica.solto ? 'livre' : 'na Frase'}
                  </span>
                )}
              </div>
            )
          })}

          {/* playhead */}
          <div className="absolute top-0 bottom-0 w-px bg-[var(--acc)] pointer-events-none" style={{ left: x(t) }}>
            <span className="absolute -left-[4.5px] top-0 w-[10px] h-[12px] bg-[var(--acc)]" style={{ clipPath: 'polygon(0 0,100% 0,100% 60%,50% 100%,0 60%)' }} />
          </div>
        </div>
      </div>
    </div>
  )
}
