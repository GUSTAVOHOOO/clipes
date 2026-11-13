// Variante C "Etapas": tokens, stepper, preview 9:16 com legenda karaokê e utilidades comuns.
import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, Play, Pause } from 'lucide-react'
import { img, presets, type Corte } from '../../dados'
import type { Tela } from '../../App'

/** Tokens da variante. Ficam só na div raiz. */
export const tema = {
  '--bg': '#0c0a09',
  '--raised': '#151311',
  '--surface': '#1c1917',
  '--hover': '#24201d',
  '--line': '#2a2522',
  '--line-2': '#3d3733',
  '--tx': '#ece8e3',
  '--tx-2': '#b3aca5',
  '--tx-3': '#8f8780',
  '--ac': '#aeb27a',
  '--ac-hover': '#bdc18b',
  '--ac-tx': '#1b1c10',
  '--ok': '#aeb27a',
  '--focus': '#d6d3d1',
} as CSSProperties

/** Estado que sobrevive à troca de tela (o App remonta a variante a cada tela). */
export const memoria = {
  corte: 0,
  estados: { c1: 'aprovado', c2: 'pendente', c3: 'pendente', c4: 'pendente' } as Record<string, Estado>,
  abrirExportar: false,
}
export type Estado = 'pendente' | 'aprovado' | 'rejeitado'

export const virgula = (n: number, casas = 1) => n.toFixed(casas).replace('.', ',')
export const dinheiro = (n: number) => `US$ ${virgula(n, 2)}`
/** Custo do Provedor por Corte exportado (Empacotamento). */
export const CUSTO_CORTE = 0.02

/** Atalhos de uma letra só valem fora de campos, sem modificador e sem diálogo aberto. */
export function atalhoLivre(e: KeyboardEvent) {
  const el = e.target as HTMLElement
  if (e.altKey || e.ctrlKey || e.metaKey) return false
  if (el.closest('input,textarea,select,[contenteditable="true"]')) return false
  return !document.querySelector('[aria-modal="true"]')
}

export const foco ='outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]'

// ---------- Topo: stepper ----------
const ETAPAS: { nome: string; tela: Tela | 'exportar' }[] = [
  { nome: 'Importar', tela: 'importar' },
  { nome: 'Revisar', tela: 'cortes' },
  { nome: 'Editar', tela: 'editor' },
  { nome: 'Exportar', tela: 'exportar' },
]

export function Topo({ etapa, irPara, aoExportar, direita }: {
  etapa: number; irPara: (t: Tela) => void; aoExportar?: () => void; direita?: ReactNode
}) {
  const ir = (t: Tela | 'exportar') => {
    if (t !== 'exportar') return irPara(t)
    if (aoExportar) return aoExportar()
    memoria.abrirExportar = true
    irPara('editor')
  }
  return (
    <header className="h-14 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center px-6">
      <div className="font-geist text-[15px] font-semibold tracking-[-0.01em] text-[var(--tx)]">Clipes</div>
      <nav aria-label="Etapas" className="flex items-center">
        {ETAPAS.map((e, i) => {
          const atual = i === etapa, feita = i < etapa
          return (
            <div key={e.nome} className="flex items-center">
              {i > 0 && <span aria-hidden className={`w-8 h-px mx-2 ${i <= etapa ? 'bg-[var(--tx-3)]' : 'bg-[var(--line-2)]'}`} />}
              <button onClick={() => ir(e.tela)} aria-current={atual ? 'step' : undefined}
                className={`group flex items-center gap-2 h-8 pl-1 pr-2.5 rounded-full text-[13px] transition-colors ${foco}
                  ${atual ? 'text-[var(--tx)] bg-[var(--surface)]' : 'text-[var(--tx-3)] hover:text-[var(--tx-2)]'}`}>
                <span className={`grid place-items-center size-6 rounded-full text-[11px] font-medium tabular
                  ${atual ? 'bg-[var(--tx)] text-[var(--bg)]' : feita ? 'bg-[var(--line-2)] text-[var(--tx-2)]' : 'border border-[var(--line-2)]'}`}>
                  {feita ? <Check size={12} strokeWidth={2.5} /> : i + 1}
                </span>
                {e.nome}
              </button>
            </div>
          )
        })}
      </nav>
      <div className="flex items-center justify-end gap-4 min-w-0">{direita}</div>
    </header>
  )
}

// ---------- Botões ----------
export function Kbd({ children, escuro }: { children: ReactNode; escuro?: boolean }) {
  return (
    <kbd className={`font-mono text-[11px] leading-none px-1.5 py-1 rounded-[5px] border
      ${escuro ? 'border-black/15 bg-black/10 text-[var(--ac-tx)]' : 'border-[var(--line-2)] text-[var(--tx-3)]'}`}>{children}</kbd>
  )
}

type BotaoProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { tipo?: 'primario' | 'contorno' | 'fantasma'; tamanho?: 'md' | 'lg' }
export function Botao({ tipo = 'contorno', tamanho = 'md', className = '', ...p }: BotaoProps) {
  const base = `inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none ${foco}`
  const t = tamanho === 'lg' ? 'h-12 px-5 text-[15px]' : 'h-9 px-3.5 text-[13px]'
  const v = tipo === 'primario'
    ? 'bg-[var(--ac)] text-[var(--ac-tx)] hover:bg-[var(--ac-hover)]'
    : tipo === 'contorno'
      ? 'border border-[var(--line-2)] text-[var(--tx)] hover:bg-[var(--hover)]'
      : 'text-[var(--tx-2)] hover:text-[var(--tx)] hover:bg-[var(--hover)]'
  return <button {...p} className={`${base} ${t} ${v} ${className}`} />
}

export function Interruptor({ ligado, aoMudar, rotulo }: { ligado: boolean; aoMudar: (v: boolean) => void; rotulo: string }) {
  return (
    <button role="switch" aria-checked={ligado} aria-label={rotulo} onClick={() => aoMudar(!ligado)}
      className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${foco} ${ligado ? 'bg-[var(--tx)]' : 'bg-[var(--line-2)]'}`}>
      <span className={`absolute top-0.5 size-4 rounded-full transition-all ${ligado ? 'left-[18px] bg-[var(--bg)]' : 'left-0.5 bg-[var(--tx-3)]'}`} />
    </button>
  )
}

// ---------- Playhead fake ----------
/** Avança pelas palavras no tempo real delas. */
export function usePlayhead(corte: Corte, inicio = 0) {
  const [i, setI] = useState(inicio)
  const [tocando, setTocando] = useState(false)
  useEffect(() => { setI(inicio); setTocando(false) }, [corte.id])
  useEffect(() => {
    if (!tocando) return
    const p = corte.palavras[i], prox = corte.palavras[i + 1]
    if (!p || !prox) { setTocando(false); return }
    const h = setTimeout(() => setI(i + 1), Math.max(110, (prox.s - p.s) * 1000))
    return () => clearTimeout(h)
  }, [tocando, i, corte])
  return { i: Math.min(i, corte.palavras.length - 1), setI, tocando, setTocando }
}

// ---------- Preview 9:16 ----------
export type Preset = typeof presets[number]

export function Preview({ corte, ativa, preset, cx, tocando, aoTocar, className = '' }: {
  corte: Corte; ativa: number; preset: Preset; cx?: number; tocando?: boolean; aoTocar?: () => void; className?: string
}) {
  const x = cx ?? corte.cx
  // Largura do quadro 16:9 em relação ao 9:16 com a mesma altura: (16/9)/(9/16).
  const L = (16 / 9) / (9 / 16) * 100
  return (
    <div className={`relative aspect-[9/16] overflow-hidden rounded-[18px] bg-black [container-type:inline-size] ${className}`}>
      {Math.abs(x - corte.cx) < 0.001
        ? <img src={img(corte.vert)} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
        : <img src={img(corte.wide)} alt="" draggable={false} className="absolute top-0 h-full max-w-none"
            style={{ width: `${L}%`, left: `${-(x * L - 50)}%` }} />}
      <Legenda corte={corte} ativa={ativa} preset={preset} />
      {aoTocar && (
        <button onClick={aoTocar} aria-label={tocando ? 'Pausar' : 'Reproduzir'}
          className={`absolute left-3 top-3 grid place-items-center size-9 rounded-full bg-black/55 text-white hover:bg-black/75 ${foco}`}>
          {tocando ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
        </button>
      )}
    </div>
  )
}

const ESTILO: Record<string, { tam: number; peso: number; caixaAlta?: boolean }> = {
  classico: { tam: 7.2, peso: 800 },
  impacto: { tam: 9.5, peso: 850, caixaAlta: true },
  limpo: { tam: 5.6, peso: 600 },
  caixa: { tam: 6.4, peso: 700 },
}

/** As palavras da Frase atual, em grupos do tamanho do preset, com a palavra ativa em destaque. */
export function Legenda({ corte, ativa, preset }: { corte: Corte; ativa: number; preset: Preset }) {
  const p = corte.palavras[ativa]
  if (!p) return null
  const daFrase = corte.palavras.filter(w => w.f === p.f)
  const pos = daFrase.indexOf(p)
  const ini = Math.floor(pos / preset.palavras) * preset.palavras
  const grupo = daFrase.slice(ini, ini + preset.palavras)
  const e = ESTILO[preset.id] ?? ESTILO.classico
  const caixa = preset.id === 'caixa'
  const mesmaCor = preset.cor === preset.destaque
  return (
    <div className="absolute inset-x-0 px-[7%] -translate-y-1/2 flex justify-center pointer-events-none" style={{ top: `${preset.pos * 100}%` }}>
      <p className={`text-center leading-[1.15] ${caixa ? 'bg-[#F5F5F4] px-[3cqw] py-[1.5cqw] rounded-[1.5cqw]' : ''}`}
        style={{
          fontFamily: preset.fonte === 'Geist' ? 'var(--font-geist)' : 'var(--font-sans)',
          fontSize: `${e.tam}cqw`, fontWeight: e.peso, textTransform: e.caixaAlta ? 'uppercase' : undefined,
          letterSpacing: e.caixaAlta ? '-0.01em' : undefined,
          WebkitTextStroke: preset.contorno ? `${preset.contorno * 0.17}cqw #000` : undefined,
          paintOrder: 'stroke fill',
          textShadow: preset.contorno || caixa ? undefined : '0 0.4cqw 2cqw rgba(0,0,0,.65)',
        }}>
        {grupo.map(w => {
          const on = w.id === p.id
          return (
            <Fragment key={w.id}>
              <span className={caixa && on ? 'bg-[#0A0A0A] text-[#F5F5F4] rounded-[1cqw] px-[1cqw]' : ''}
                style={{ color: caixa && on ? undefined : on ? preset.destaque : preset.cor, opacity: mesmaCor && !caixa && !on ? 0.55 : 1 }}>
                {w.t}
              </span>{' '}
            </Fragment>
          )
        })}
      </p>
    </div>
  )
}
