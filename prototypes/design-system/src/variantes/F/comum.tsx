// Variante F, "Foco": tema e barra superior comuns às três telas.
// Cena: fim de noite, quarto com a luz baixa, a pessoa já revisou 30 Cortes e só quer o vídeo e a linha do tempo na frente.
// Por isso: grafite levemente quente (menos azul à noite), um âmbar contido só no playhead, seleção e foco.
import type { ReactNode } from 'react'
import type { Tela } from '../../App'
import { foco, tema } from '../nucleo/base'
import { criarMemo } from '../nucleo/base'

const H = 70 // matiz dos neutros: grafite quente, croma quase zero
export const temaF = tema({
  bg: `oklch(0.155 0.004 ${H})`,
  s1: `oklch(0.19 0.005 ${H})`,
  s2: `oklch(0.225 0.006 ${H})`,
  s3: `oklch(0.27 0.007 ${H})`,
  ln: `oklch(0.255 0.006 ${H})`,
  ln2: `oklch(0.34 0.008 ${H})`,
  tx: `oklch(0.94 0.007 ${H + 10})`,
  tx2: `oklch(0.77 0.008 ${H})`,
  tx3: `oklch(0.65 0.008 ${H})`,
  acc: 'oklch(0.80 0.11 75)',
  accBg: 'oklch(0.80 0.11 75 / 0.14)',
  accTx: 'oklch(0.22 0.03 75)',
  ov: `oklch(0.10 0.004 ${H} / 0.55)`,
})

export const memoF = criarMemo()

const TELAS: { id: Tela; nome: string }[] = [
  { id: 'importar', nome: 'Importar' },
  { id: 'cortes', nome: 'Cortes' },
  { id: 'editor', nome: 'Editor' },
]

/** Barra superior quieta: o caminho à esquerda, as telas como texto, a ação da tela à direita. */
export function TopoF({ tela, irPara, meio, direita }: { tela: Tela; irPara: (t: Tela) => void; meio?: ReactNode; direita?: ReactNode }) {
  return (
    <header className="h-11 shrink-0 flex items-center gap-5 px-4 border-b border-[var(--ln)]">
      <span className="text-[13px] font-semibold tracking-[-0.01em]">Clipes</span>
      <nav className="flex items-center gap-1 h-full" aria-label="Telas">
        {TELAS.map(t => (
          <button key={t.id} onClick={() => irPara(t.id)} aria-current={tela === t.id ? 'page' : undefined}
            className={`h-7 px-2 rounded-[5px] text-[13px] transition-colors duration-150 ${foco} ${tela === t.id ? 'text-[var(--tx)] bg-[var(--s2)]' : 'text-[var(--tx3)] hover:text-[var(--tx2)]'}`}>
            {t.nome}
          </button>
        ))}
      </nav>
      <div className="flex-1 min-w-0 flex items-center">{meio}</div>
      <div className="flex items-center gap-2">{direita}</div>
    </header>
  )
}
