// Variante A, "Estúdio": tokens e peças pequenas compartilhadas pelas três telas.
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Tela } from '../../App'
import { fonte } from '../../dados'

/** Grafite neutro: cada superfície sobe um degrau de luminância. Âmbar só em seleção e playhead. */
export const tema = {
  '--a-bg': '#131313', // palco do preview, o mais fundo
  '--a-s1': '#1a1a1a', // painéis
  '--a-s2': '#212121', // hover, campos
  '--a-s3': '#2a2a2a', // controle ativo, trilhos
  '--a-ln': '#2a2a2a', // linhas de 1 px
  '--a-ln2': '#3b3b3b',
  '--a-tx': '#ecebe7', // branco quente
  '--a-tx2': '#a9a8a3',
  '--a-tx3': '#8c8b86',
  '--a-acc': '#e3b46a', // âmbar contido
  '--a-accbg': 'rgba(227,180,106,0.12)',
} as CSSProperties

export const foco = 'outline-none focus-visible:ring-1 focus-visible:ring-[var(--a-acc)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--a-s1)]'

/** 8,0 */
export const num = (v: number, d = 1) => v.toFixed(d).replace('.', ',')
/** 22 s, 1 min 14 s */
export const dur = (s: number) => {
  const r = Math.round(s)
  return r < 60 ? `${r} s` : `${Math.floor(r / 60)} min ${String(r % 60).padStart(2, '0')} s`
}

const TELAS: { id: Tela; nome: string }[] = [
  { id: 'importar', nome: 'Importar' },
  { id: 'cortes', nome: 'Cortes' },
  { id: 'editor', nome: 'Editor' },
]

export function Topo({ tela, irPara, direita }: { tela: Tela; irPara: (t: Tela) => void; direita?: ReactNode }) {
  return (
    <header className="h-11 shrink-0 flex items-center gap-6 px-4 border-b border-[var(--a-ln)] bg-[var(--a-s1)]">
      <nav className="flex items-center gap-1.5 text-[13px] min-w-0" aria-label="Local">
        <span className="font-semibold tracking-[-0.01em] text-[var(--a-tx)]">Clipes</span>
        <ChevronRight size={14} className="text-[var(--a-tx3)] shrink-0" />
        <span className="text-[var(--a-tx2)] truncate">Canal dark · Ficção</span>
        {tela !== 'importar' && <>
          <ChevronRight size={14} className="text-[var(--a-tx3)] shrink-0" />
          <span className="text-[var(--a-tx2)] truncate">{fonte.nome}</span>
        </>}
      </nav>
      <div className="flex items-center h-full" role="tablist" aria-label="Telas">
        {TELAS.map(t => (
          <button key={t.id} role="tab" aria-selected={tela === t.id} onClick={() => irPara(t.id)}
            className={`relative h-full px-3 text-[13px] ${foco} ${tela === t.id ? 'text-[var(--a-tx)]' : 'text-[var(--a-tx3)] hover:text-[var(--a-tx2)]'}`}>
            {t.nome}
            {tela === t.id && <span className="absolute left-3 right-3 -bottom-px h-px bg-[var(--a-tx)]" />}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">{direita}</div>
    </header>
  )
}

type BotaoProps = { children: ReactNode; onClick?: () => void; tipo?: 'primario' | 'secundario' | 'fantasma'; disabled?: boolean; title?: string; className?: string; 'aria-label'?: string; 'aria-pressed'?: boolean }
export function Botao({ children, onClick, tipo = 'secundario', disabled, title, className = '', ...aria }: BotaoProps) {
  const t = {
    primario: 'bg-[var(--a-tx)] text-[#161616] hover:bg-white font-medium',
    secundario: 'bg-[var(--a-s2)] text-[var(--a-tx)] border border-[var(--a-ln2)] hover:bg-[var(--a-s3)]',
    fantasma: 'text-[var(--a-tx2)] hover:text-[var(--a-tx)] hover:bg-[var(--a-s2)]',
  }[tipo]
  return (
    <button onClick={onClick} disabled={disabled} title={title} {...aria}
      className={`inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md text-[13px] whitespace-nowrap transition-colors disabled:opacity-40 disabled:pointer-events-none ${t} ${foco} ${className}`}>
      {children}
    </button>
  )
}

export function Segmentado<T extends string | number>({ valor, opcoes, onChange, rotulo }: { valor: T; opcoes: { v: T; nome: ReactNode }[]; onChange: (v: T) => void; rotulo: string }) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="inline-flex p-0.5 rounded-md bg-[var(--a-bg)] border border-[var(--a-ln)]">
      {opcoes.map(o => (
        <button key={String(o.v)} role="radio" aria-checked={valor === o.v} onClick={() => onChange(o.v)}
          className={`h-7 px-2.5 rounded-[5px] text-[12px] tabular ${foco} ${valor === o.v ? 'bg-[var(--a-s3)] text-[var(--a-tx)]' : 'text-[var(--a-tx3)] hover:text-[var(--a-tx2)]'}`}>
          {o.nome}
        </button>
      ))}
    </div>
  )
}

export function Interruptor({ ligado, onChange, rotulo }: { ligado: boolean; onChange: (v: boolean) => void; rotulo: string }) {
  return (
    <button role="switch" aria-checked={ligado} aria-label={rotulo} onClick={() => onChange(!ligado)}
      className={`relative w-8 h-[18px] rounded-full shrink-0 transition-colors ${foco} ${ligado ? 'bg-[var(--a-tx)]' : 'bg-[var(--a-s3)] border border-[var(--a-ln2)]'}`}>
      <span className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full transition-all ${ligado ? 'left-[16px] bg-[#161616]' : 'left-[2px] bg-[var(--a-tx3)]'}`} />
    </button>
  )
}

/** Tamanho de um elemento, para o preview 9:16 caber no palco sem distorcer. */
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

/** Barra de Nota fina, sem acento: o número já diz tudo, a barra só dá forma. */
export function BarraNota({ valor, largura = 56 }: { valor: number; largura?: number }) {
  return (
    <span className="relative block shrink-0 h-[3px] rounded-full bg-[var(--a-s3)] overflow-hidden" style={{ width: largura }}>
      <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--a-tx2)]" style={{ width: `${valor * 10}%` }} />
    </span>
  )
}
