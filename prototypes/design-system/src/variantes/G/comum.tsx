// Variante G, "Seleção": tema, barra superior e o painel contextual (inspector) comuns às três telas.
// Cena: tarde, notebook ligado a um monitor de 24", a pessoa refina um Corte de cada vez clicando no que quer mudar,
// como num Figma. Grafite frio, Geist, e um azul de seleção que só aparece no que está selecionado.
import { Fragment, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Tela } from '../../App'
import { Kbd, criarMemo, foco, tema } from '../nucleo/base'
import { GatilhoPaleta } from '../nucleo/Paleta'

const H = 255
export const temaG = tema({
  bg: `oklch(0.165 0.008 ${H})`,
  s1: `oklch(0.20 0.009 ${H})`,
  s2: `oklch(0.235 0.010 ${H})`,
  s3: `oklch(0.28 0.011 ${H})`,
  ln: `oklch(0.265 0.010 ${H})`,
  ln2: `oklch(0.345 0.012 ${H})`,
  tx: `oklch(0.95 0.005 ${H})`,
  tx2: `oklch(0.78 0.010 ${H})`,
  tx3: `oklch(0.66 0.012 ${H})`,
  acc: `oklch(0.72 0.13 ${H})`,
  accBg: `oklch(0.72 0.13 ${H} / 0.16)`,
  accTx: `oklch(0.18 0.03 ${H})`,
  ov: `oklch(0.10 0.01 ${H} / 0.55)`,
})

export const memoG = criarMemo()

const TELAS: { id: Tela; nome: string }[] = [
  { id: 'importar', nome: 'Importar' },
  { id: 'cortes', nome: 'Cortes' },
  { id: 'editor', nome: 'Editor' },
]

export function TopoG({ tela, irPara, esquerda, direita }: { tela: Tela; irPara: (t: Tela) => void; esquerda?: ReactNode; direita?: ReactNode }) {
  return (
    <header className="h-11 shrink-0 grid grid-cols-[minmax(0,1fr)_minmax(240px,360px)_minmax(0,1fr)] items-center gap-4 px-3 border-b border-[var(--ln)] bg-[var(--s1)]">
      <div className="flex items-center gap-4 min-w-0">
        <span className="text-[13px] font-semibold tracking-[-0.01em] pl-1">Clipes</span>
        <nav className="flex items-center gap-0.5" aria-label="Telas">
          {TELAS.map(t => (
            <button key={t.id} onClick={() => irPara(t.id)} aria-current={tela === t.id ? 'page' : undefined}
              className={`h-7 px-2 rounded-[5px] text-[13px] transition-colors duration-150 ${foco} ${tela === t.id ? 'text-[var(--tx)] bg-[var(--s3)]' : 'text-[var(--tx3)] hover:text-[var(--tx2)]'}`}>{t.nome}</button>
          ))}
        </nav>
        {esquerda}
      </div>
      <GatilhoPaleta largo rotulo="Buscar ou executar…" />
      <div className="flex items-center justify-end gap-2 min-w-0">{direita}</div>
    </header>
  )
}

/** Painel contextual: o caminho da seleção no topo (clicável para subir), e só as propriedades do que está selecionado. */
export function Inspector({ caminho, chave, dica, children, largura = 320 }: {
  caminho: { rotulo: string; ir?: () => void }[]; chave: string; dica?: ReactNode; children: ReactNode; largura?: number
}) {
  return (
    <aside className="shrink-0 flex flex-col border-l border-[var(--ln)] bg-[var(--s1)] min-h-0" style={{ width: largura }} aria-label="Propriedades da seleção">
      <div className="h-11 shrink-0 flex items-center gap-1 px-3 border-b border-[var(--ln)] text-[12.5px] min-w-0">
        {caminho.map((p, i) => {
          const ultimo = i === caminho.length - 1
          return (
            <Fragment key={i}>
              {i > 0 && <ChevronRight size={13} className="text-[var(--tx3)] shrink-0" />}
              {p.ir && !ultimo
                ? <button onClick={p.ir} className={`h-6 px-1 rounded-[4px] text-[var(--tx3)] hover:text-[var(--tx)] hover:bg-[var(--s2)] truncate ${foco}`}>{p.rotulo}</button>
                : <span className={`px-1 truncate ${ultimo ? 'text-[var(--tx)] font-medium' : 'text-[var(--tx3)]'}`}>{p.rotulo}</span>}
            </Fragment>
          )
        })}
        {caminho.length > 1 && caminho[0].ir && <span className="ml-auto pl-2 shrink-0"><Kbd k={['Esc']} /></span>}
      </div>
      <div key={chave} className="g-insp flex-1 min-h-0 overflow-auto nu-rolagem">
        {dica && <p className="px-4 pt-3 text-[12px] leading-[1.5] text-[var(--tx3)]">{dica}</p>}
        {children}
      </div>
      <style>{`
        .g-insp{animation:g-insp .18s cubic-bezier(.22,1,.36,1)}
        @keyframes g-insp{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        @media (prefers-reduced-motion: reduce){.g-insp{animation:g-fade .12s linear}@keyframes g-fade{from{opacity:0}to{opacity:1}}}
      `}</style>
    </aside>
  )
}

export const Secao = ({ titulo, children, extra }: { titulo?: string; children: ReactNode; extra?: ReactNode }) => (
  <section className="px-4 py-4 border-b border-[var(--ln)] last:border-b-0">
    {titulo && (
      <div className="flex items-center justify-between mb-3 min-h-[20px]">
        <h3 className="text-[12px] font-medium text-[var(--tx2)]">{titulo}</h3>
        {extra}
      </div>
    )}
    {children}
  </section>
)

/** Linha rótulo/valor das propriedades. */
export const Prop = ({ rotulo, children }: { rotulo: string; children: ReactNode }) => (
  <div className="flex items-center justify-between gap-3 min-h-8 text-[12.5px]">
    <span className="text-[var(--tx3)]">{rotulo}</span>
    <span className="text-[var(--tx)] text-right min-w-0">{children}</span>
  </div>
)
