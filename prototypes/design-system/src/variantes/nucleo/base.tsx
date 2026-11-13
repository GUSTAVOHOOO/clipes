// Núcleo comum às variantes F, G e H: tokens por CSS variables, teclas, botões, legenda karaokê.
// Cada variante define os valores de --bg, --s1… na sua div raiz; estas peças só leem as variáveis.
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { presets, type Palavra } from '../../dados'

export type Preset = (typeof presets)[number]
export type Layout = 'rosto' | 'fit' | 'jogo' | 'duas' | 'cheia'
export const LAYOUTS: { id: Layout; nome: string }[] = [
  { id: 'rosto', nome: 'Rosto' },
  { id: 'fit', nome: 'Fit' },
  { id: 'jogo', nome: 'Jogo + webcam' },
  { id: 'duas', nome: 'Duas pessoas' },
  { id: 'cheia', nome: 'Tela cheia' },
]

/** Tema: escala de neutros tingida em OKLCH + um acento. */
export function tema(t: {
  bg: string; s1: string; s2: string; s3: string; ln: string; ln2: string
  tx: string; tx2: string; tx3: string; acc: string; accBg: string; accTx: string; ov: string
}) {
  return {
    '--bg': t.bg, '--s1': t.s1, '--s2': t.s2, '--s3': t.s3, '--ln': t.ln, '--ln2': t.ln2,
    '--tx': t.tx, '--tx2': t.tx2, '--tx3': t.tx3, '--acc': t.acc, '--acc-bg': t.accBg, '--acc-tx': t.accTx, '--ov': t.ov,
  } as CSSProperties
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
/** 8,0 */
export const num = (v: number, d = 1) => v.toFixed(d).replace('.', ',')
/** 22 s, 1 min 14 s */
export const dur = (s: number) => {
  const r = Math.round(s)
  return r < 60 ? `${r} s` : `${Math.floor(r / 60)} min ${String(r % 60).padStart(2, '0')} s`
}
export const reduzMovimento = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export const foco = 'outline-none focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--s1)]'

/** Estado que sobrevive à troca de tela (o App remonta a variante a cada troca). */
export type Memo = {
  corte: number
  status: Record<string, 'aprovado' | 'rejeitado' | undefined>
  edicoes: Record<string, unknown>
}
export const criarMemo = (): Memo => ({ corte: 0, status: { c1: 'aprovado' }, edicoes: {} })

/* ---------------------------------------------------------------- teclas */

export function Kbd({ k, className = '' }: { k: string[]; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[3px] shrink-0 ${className}`} aria-hidden>
      {k.map((x, i) => (
        <kbd key={i} className="inline-grid place-items-center h-[18px] min-w-[18px] px-[5px] rounded-[4px] font-mono text-[10.5px] leading-none tabular-nums border border-[var(--ln2)] bg-[var(--s2)] text-[var(--tx2)]">{x}</kbd>
      ))}
    </span>
  )
}

/* ---------------------------------------------------------------- botões */

type BotaoProps = {
  children: ReactNode; onClick?: () => void; tipo?: 'primario' | 'secundario' | 'fantasma'; disabled?: boolean
  title?: string; className?: string; tecla?: string[]; 'aria-label'?: string; 'aria-pressed'?: boolean; tamanho?: 'p' | 'm'
}
export function Botao({ children, onClick, tipo = 'secundario', disabled, title, className = '', tecla, tamanho = 'm', ...aria }: BotaoProps) {
  const t = {
    primario: 'bg-[var(--tx)] text-[var(--bg)] hover:opacity-90 font-medium',
    secundario: 'bg-[var(--s2)] text-[var(--tx)] border border-[var(--ln2)] hover:bg-[var(--s3)]',
    fantasma: 'text-[var(--tx2)] hover:text-[var(--tx)] hover:bg-[var(--s2)]',
  }[tipo]
  const h = tamanho === 'p' ? 'h-7 text-[12px]' : 'h-8 text-[13px]'
  return (
    <button onClick={onClick} disabled={disabled} title={title} {...aria}
      className={`inline-flex items-center justify-center gap-2 ${h} ${tecla ? 'pl-3 pr-1.5' : 'px-3'} rounded-[6px] whitespace-nowrap transition-[background-color,opacity,color] duration-150 disabled:opacity-40 disabled:pointer-events-none ${t} ${foco} ${className}`}>
      {children}
      {tecla && <span className={`inline-flex gap-[3px] ${tipo === 'primario' ? '[&_kbd]:bg-transparent [&_kbd]:border-current/30 [&_kbd]:text-current [&_kbd]:opacity-70' : ''}`}><Kbd k={tecla} /></span>}
    </button>
  )
}

export function Segmentado<T extends string | number>({ valor, opcoes, onChange, rotulo, className = '' }: {
  valor: T; opcoes: { v: T; nome: ReactNode }[]; onChange: (v: T) => void; rotulo: string; className?: string
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className={`inline-flex p-0.5 rounded-[6px] bg-[var(--bg)] border border-[var(--ln)] ${className}`}>
      {opcoes.map(o => (
        <button key={String(o.v)} role="radio" aria-checked={valor === o.v} onClick={() => onChange(o.v)}
          className={`h-7 px-2.5 rounded-[5px] text-[12px] tabular-nums whitespace-nowrap ${foco} ${valor === o.v ? 'bg-[var(--s3)] text-[var(--tx)]' : 'text-[var(--tx3)] hover:text-[var(--tx2)]'}`}>
          {o.nome}
        </button>
      ))}
    </div>
  )
}

export function Interruptor({ ligado, onChange, rotulo }: { ligado: boolean; onChange: (v: boolean) => void; rotulo: string }) {
  return (
    <button role="switch" aria-checked={ligado} aria-label={rotulo} onClick={() => onChange(!ligado)}
      className={`relative w-8 h-[18px] rounded-full shrink-0 transition-colors duration-150 ${foco} ${ligado ? 'bg-[var(--tx)]' : 'bg-[var(--s3)] border border-[var(--ln2)]'}`}>
      <span className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full transition-[left] duration-150 ${ligado ? 'left-[16px] bg-[var(--bg)]' : 'left-[2px] bg-[var(--tx3)]'}`} />
    </button>
  )
}

/** Barra fina de Nota: o número diz tudo, a barra só dá forma. */
export function BarraNota({ valor, largura = 56, cor = 'var(--tx2)' }: { valor: number; largura?: number | string; cor?: string }) {
  return (
    <span className="relative block shrink-0 h-[3px] rounded-full bg-[var(--s3)] overflow-hidden" style={{ width: largura }}>
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${valor * 10}%`, background: cor }} />
    </span>
  )
}

/** Tamanho de um elemento, para o preview 9:16 caber sem distorcer. */
export function useTamanho<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [t, setT] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setT({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, t] as const
}

/* ---------------------------------------------------------------- legenda karaokê */

const pesoDe = (p: Preset) => (p.id === 'limpo' ? 600 : p.id === 'caixa' ? 700 : 800)
const familia = (p: Preset) => (p.fonte === 'Geist' ? '"Geist Variable", system-ui, sans-serif' : '"Inter Variable", system-ui, sans-serif')

export function LinhaLegenda({ palavras, ativa, preset, tamanho, unidade = 'px' }: { palavras: { id: string; t: string }[]; ativa?: string; preset: Preset; tamanho: number; unidade?: 'px' | 'cqw' }) {
  const semDestaque = preset.destaque === preset.cor
  const caixa = preset.id === 'caixa'
  const contorno = preset.contorno ? (preset.contorno * tamanho) / 60 : 0
  const base: CSSProperties = {
    fontFamily: familia(preset), fontWeight: pesoDe(preset), fontSize: `${tamanho}${unidade}`, lineHeight: 1.15,
    letterSpacing: preset.id === 'impacto' ? '0.01em' : '-0.01em',
    textTransform: preset.id === 'impacto' ? 'uppercase' : undefined,
    WebkitTextStroke: contorno ? `${contorno}${unidade} #000` : undefined,
    paintOrder: 'stroke fill',
    textShadow: preset.id === 'limpo' ? '0 1px 8px rgba(0,0,0,.6)' : undefined,
  }
  return (
    <span className={`inline-flex flex-wrap justify-center gap-x-[0.28em] ${caixa ? 'bg-[#F5F5F4] rounded-[0.18em] px-[0.35em] py-[0.12em]' : ''}`} style={base}>
      {palavras.map(w => {
        const on = w.id === ativa
        return (
          <span key={w.id} style={{
            color: on ? preset.destaque : preset.cor, display: 'inline-block',
            opacity: semDestaque && ativa && !on ? 0.5 : 1,
            transform: on && !semDestaque ? 'scale(1.06)' : undefined,
          }}>{w.t}</span>
        )
      })}
    </span>
  )
}

/** Recorta a Frase atual em grupos de N palavras e devolve o grupo da palavra ativa. */
export function grupoAtual(palavras: Palavra[], fraseId: string | undefined, ativaId: string | undefined, porVez: number) {
  if (!fraseId) return []
  const da = palavras.filter(w => w.f === fraseId)
  const i = Math.max(0, da.findIndex(w => w.id === ativaId))
  const g = Math.floor(i / porVez)
  return da.slice(g * porVez, g * porVez + porVez)
}

/** Rola só o contêiner vertical mais próximo (scrollIntoView também rolaria pais com overflow escondido). */
export function rolarAte(el: HTMLElement | null) {
  if (!el) return
  let p = el.parentElement
  while (p && !(p.scrollHeight > p.clientHeight && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement
  if (!p) return
  const r = el.getBoundingClientRect(), q = p.getBoundingClientRect()
  if (r.top < q.top) p.scrollTop -= q.top - r.top + 8
  else if (r.bottom > q.bottom) p.scrollTop += r.bottom - q.bottom + 8
}
