// Variante H, "Linha": tema (escuro por padrão, claro com T) e barra superior comuns às três telas.
// Cena: a pessoa limpa bordas e palavras de 30 Cortes em sequência, olhando mais para a forma da fala do que para a imagem.
// À noite, escuro; na sessão da manhã, com a sala clara, ela aperta T. Neutro quase sem croma e um coral só no playhead.
import { createContext, useContext, type ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'
import type { Tela } from '../../App'
import { Kbd, criarMemo, foco, tema } from '../nucleo/base'

const H = 160
export const temaEscuro = tema({
  bg: `oklch(0.16 0.003 ${H})`,
  s1: `oklch(0.195 0.003 ${H})`,
  s2: `oklch(0.23 0.004 ${H})`,
  s3: `oklch(0.275 0.004 ${H})`,
  ln: `oklch(0.26 0.004 ${H})`,
  ln2: `oklch(0.34 0.005 ${H})`,
  tx: `oklch(0.94 0.003 ${H})`,
  tx2: `oklch(0.77 0.004 ${H})`,
  tx3: `oklch(0.65 0.004 ${H})`,
  acc: 'oklch(0.72 0.15 32)',
  accBg: 'oklch(0.72 0.15 32 / 0.16)',
  accTx: 'oklch(0.20 0.03 32)',
  ov: `oklch(0.10 0.003 ${H} / 0.55)`,
})
export const temaClaro = tema({
  bg: `oklch(0.95 0.003 ${H})`,
  s1: `oklch(0.99 0.002 ${H})`,
  s2: `oklch(0.965 0.003 ${H})`,
  s3: `oklch(0.925 0.004 ${H})`,
  ln: `oklch(0.905 0.004 ${H})`,
  ln2: `oklch(0.83 0.005 ${H})`,
  tx: `oklch(0.22 0.005 ${H})`,
  tx2: `oklch(0.40 0.006 ${H})`,
  tx3: `oklch(0.49 0.006 ${H})`,
  acc: 'oklch(0.58 0.17 32)',
  accBg: 'oklch(0.58 0.17 32 / 0.12)',
  accTx: 'oklch(0.99 0 0)',
  ov: `oklch(0.25 0.005 ${H} / 0.25)`,
})

export const memoH = { ...criarMemo(), claro: new URLSearchParams(location.search).get('tema') === 'claro' }

type CtxH = { claro: boolean; alternarTema: () => void }
export const CtxTema = createContext<CtxH>({ claro: false, alternarTema: () => {} })
export const useTema = () => useContext(CtxTema)

const TELAS: { id: Tela; nome: string }[] = [
  { id: 'importar', nome: 'Importar' },
  { id: 'cortes', nome: 'Cortes' },
  { id: 'editor', nome: 'Editor' },
]

export function TopoH({ tela, irPara, meio, direita }: { tela: Tela; irPara: (t: Tela) => void; meio?: ReactNode; direita?: ReactNode }) {
  const { claro, alternarTema } = useTema()
  return (
    <header className="h-11 shrink-0 flex items-center gap-5 px-4 border-b border-[var(--ln)] bg-[var(--s1)]">
      <span className="text-[13px] font-semibold tracking-[-0.01em]">Clipes</span>
      <nav className="flex items-center h-full" aria-label="Telas">
        {TELAS.map(t => (
          <button key={t.id} onClick={() => irPara(t.id)} aria-current={tela === t.id ? 'page' : undefined}
            className={`relative h-full px-2.5 text-[13px] ${foco} ${tela === t.id ? 'text-[var(--tx)]' : 'text-[var(--tx3)] hover:text-[var(--tx2)]'}`}>
            {t.nome}
            {tela === t.id && <span className="absolute left-2.5 right-2.5 -bottom-px h-[2px] bg-[var(--tx)]" />}
          </button>
        ))}
      </nav>
      <div className="flex-1 min-w-0 flex items-center">{meio}</div>
      <div className="flex items-center gap-2">
        <button onClick={alternarTema} aria-label={claro ? 'Tema escuro (T)' : 'Tema claro (T)'} title="Tema (T)"
          className={`h-7 flex items-center gap-1.5 px-2 rounded-[6px] text-[var(--tx3)] hover:text-[var(--tx)] hover:bg-[var(--s2)] ${foco}`}>
          {claro ? <Moon size={14} /> : <Sun size={14} />}<Kbd k={['T']} />
        </button>
        {direita}
      </div>
    </header>
  )
}
