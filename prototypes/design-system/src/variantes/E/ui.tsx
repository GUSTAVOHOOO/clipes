// Variante E, "Estúdio + Comando": tokens e peças pequenas. O grafite e o âmbar são os da A; as teclas vêm da D.
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/** Grafite neutro (o mesmo da A): cada superfície sobe um degrau. Âmbar só no playhead, na palavra ativa e na seleção. */
export const tema = {
  '--e-bg': '#131313', // palco do preview, o mais fundo
  '--e-s1': '#1a1a1a', // painéis
  '--e-s2': '#212121', // hover, campos
  '--e-s3': '#2a2a2a', // controle ativo, trilhos
  '--e-ln': '#272727', // hairlines
  '--e-ln2': '#3b3b3b',
  '--e-tx': '#ecebe7',
  '--e-tx2': '#a9a8a3',
  '--e-tx3': '#8c8b86',
  '--e-acc': '#e3b46a',
  '--e-accbg': 'rgba(227,180,106,0.13)',
} as CSSProperties

export const foco = 'outline-none focus-visible:ring-1 focus-visible:ring-[var(--e-acc)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--e-s1)]'

/** Tecla. `seq`: teclas em sequência (G, depois I), com mais respiro entre elas. */
export function Kbd({ k, inv = false, seq = false, className = '' }: { k: string[]; inv?: boolean; seq?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center shrink-0 ${seq ? 'gap-1' : 'gap-[3px]'} ${className}`} aria-hidden>
      {k.map((x, i) => (
        <kbd key={i}
          className={`inline-grid place-items-center h-[18px] min-w-[18px] px-[5px] rounded-[4px] font-mono text-[10.5px] leading-none tabular border ${inv
            ? 'border-black/15 text-[#161616]/70 bg-black/[0.06]'
            : 'border-[var(--e-ln2)] text-[var(--e-tx2)] bg-[var(--e-s2)]'}`}>{x}</kbd>
      ))}
    </span>
  )
}

/** Dica no hover e no foco do teclado, com o atalho. */
export function Dica({ texto, tecla, lado = 'baixo', children, className = '' }: { texto: string; tecla?: string[]; lado?: 'baixo' | 'cima' | 'esquerda' | 'direita'; children: ReactNode; className?: string }) {
  const pos = {
    baixo: 'top-full mt-1.5 left-1/2 -translate-x-1/2',
    cima: 'bottom-full mb-1.5 left-1/2 -translate-x-1/2',
    esquerda: 'right-full mr-2 top-1/2 -translate-y-1/2',
    direita: 'left-full ml-2 top-1/2 -translate-y-1/2',
  }[lado]
  return (
    <span className={`group/dica relative inline-flex ${className}`}>
      {children}
      <span role="tooltip" className={`pointer-events-none absolute z-40 ${pos} hidden group-hover/dica:flex group-has-[:focus-visible]/dica:flex items-center gap-2 whitespace-nowrap h-7 px-2.5 rounded-[6px] bg-[var(--e-s3)] border border-[var(--e-ln2)] text-[12px] text-[var(--e-tx)] shadow-[0_8px_24px_-8px_rgba(0,0,0,.6)]`}>
        {texto}{tecla && <Kbd k={tecla} />}
      </span>
    </span>
  )
}

type BotaoProps = { children: ReactNode; onClick?: () => void; tipo?: 'primario' | 'secundario' | 'fantasma'; disabled?: boolean; title?: string; className?: string; 'aria-label'?: string; 'aria-pressed'?: boolean; type?: 'button' | 'submit' }
export function Botao({ children, onClick, tipo = 'secundario', disabled, title, className = '', type = 'button', ...aria }: BotaoProps) {
  const t = {
    primario: 'bg-[var(--e-tx)] text-[#161616] hover:bg-white font-medium',
    secundario: 'bg-[var(--e-s2)] text-[var(--e-tx)] border border-[var(--e-ln2)] hover:bg-[var(--e-s3)]',
    fantasma: 'text-[var(--e-tx2)] hover:text-[var(--e-tx)] hover:bg-[var(--e-s2)]',
  }[tipo]
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} {...aria}
      className={`inline-flex items-center justify-center gap-2 h-7 px-2.5 rounded-[6px] text-[12.5px] whitespace-nowrap transition-colors disabled:opacity-40 disabled:pointer-events-none ${t} ${foco} ${className}`}>
      {children}
    </button>
  )
}

export function Segmentado<T extends string | number>({ valor, opcoes, onChange, rotulo }: { valor: T; opcoes: { v: T; nome: ReactNode; titulo?: string }[]; onChange: (v: T) => void; rotulo: string }) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="inline-flex p-0.5 rounded-[6px] bg-[var(--e-bg)] border border-[var(--e-ln)]">
      {opcoes.map(o => (
        <button key={String(o.v)} role="radio" aria-checked={valor === o.v} onClick={() => onChange(o.v)} title={o.titulo}
          className={`h-6 min-w-7 px-2 rounded-[4px] text-[12px] tabular ${foco} ${valor === o.v ? 'bg-[var(--e-s3)] text-[var(--e-tx)]' : 'text-[var(--e-tx3)] hover:text-[var(--e-tx2)]'}`}>
          {o.nome}
        </button>
      ))}
    </div>
  )
}

export function Interruptor({ ligado, onChange, rotulo }: { ligado: boolean; onChange: (v: boolean) => void; rotulo: string }) {
  return (
    <button role="switch" aria-checked={ligado} aria-label={rotulo} onClick={() => onChange(!ligado)}
      className={`relative w-8 h-[18px] rounded-full shrink-0 transition-colors ${foco} ${ligado ? 'bg-[var(--e-tx)]' : 'bg-[var(--e-s3)] border border-[var(--e-ln2)]'}`}>
      <span className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full transition-all ${ligado ? 'left-[16px] bg-[#161616]' : 'left-[2px] bg-[var(--e-tx3)]'}`} />
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

/** Barra de Nota fina, sem acento: o número diz tudo, a barra só dá forma. */
export function BarraNota({ valor, largura }: { valor: number; largura?: number }) {
  return (
    <span className="relative block shrink-0 h-[3px] rounded-full bg-[var(--e-s3)] overflow-hidden" style={{ width: largura ?? '100%' }}>
      <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--e-tx2)]" style={{ width: `${valor * 10}%` }} />
    </span>
  )
}
