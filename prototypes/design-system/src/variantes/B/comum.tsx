// Variante B, "Documento": tokens, memória compartilhada entre telas e helpers.
import type { CSSProperties, ReactNode } from 'react'
import { Toaster } from 'sonner'
import type { Corte } from '../../dados'

/** Tokens do tema: papel neutro quente, tinta quase preta, marcador amarelo suave. */
export const tokens = {
  '--paper': '#FAFAF9',
  '--panel': '#F3F2F0',
  '--sheet': '#FFFFFF',
  '--ink': '#1C1917',
  '--ink-2': '#44403C',
  '--mute': '#625C57',
  '--faint': '#78716C',
  '--rule': '#E7E5E4',
  '--rule-2': '#D6D3D1',
  '--marker': '#FCEBA4',
  '--marker-soft': '#FDF6D6',
} as CSSProperties

/** Raiz da variante: o tema não vaza para fora desta div. */
export function Raiz({ children }: { children: ReactNode }) {
  return (
    <div style={tokens} className="vb h-full w-full overflow-hidden bg-[var(--paper)] text-[var(--ink)] font-geist antialiased selection:bg-[var(--marker)]">
      <style>{`
        .vb :focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; border-radius: 4px; }
        .vb .num { font-variant-numeric: tabular-nums; }
        .vb .tc { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
        @media (prefers-reduced-motion: reduce) { .vb * { transition: none !important; animation: none !important; } }
      `}</style>
      {children}
      <Toaster position="top-center" toastOptions={{ style: { fontFamily: 'var(--font-geist)', background: 'var(--ink)', color: '#FAFAF9', border: 'none', borderRadius: 10 } }} />
    </div>
  )
}

/** Estado que precisa sobreviver à troca de tela (o App remonta a variante). */
export const memoria = {
  corteId: 'c1',
  decisoes: { c1: 'aprovado', c2: 'aprovado' } as Record<string, 'aprovado' | 'rejeitado' | undefined>,
}

export const num = (n: number, casas = 1) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
export const segundos = (s: number) => `${num(s)} s`

/** Resumo da Nota em uma linha, como o Provedor escreveria. */
const RESUMOS: Record<string, string> = {
  c1: 'Gancho forte, fecha bem',
  c2: 'Muita energia, pouco Valor',
  c3: 'Emoção alta e gancho claro',
  c4: 'Fecha muito bem, abre devagar',
}
export const resumoNota = (c: Corte) => c.nota.resumo ?? RESUMOS[c.id] ?? ''

/** Frases vizinhas fora do Corte, para mostrar o contexto esmaecido no editor. */
export const CONTEXTO: Record<string, { antes: string; depois: string }> = {
  c1: { antes: 'Thom, wait. Hear me out.', depois: 'Celia! Celia, come back.' },
  c2: { antes: 'Okay, everybody in position.', depois: 'Here they come!' },
  c3: { antes: "Celia, it's me. It's Thom.", depois: "Alright, let's go again." },
  c4: { antes: 'Hold on to something!', depois: 'Roll the credits.' },
}

/** Custo do Provedor por Corte no Empacotamento (título, descrição e Narração). */
export const CUSTO_POR_CORTE = 0.02
export const dolar = (v: number) => `US$ ${num(v, 2)}`
