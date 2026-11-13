// PROTÓTIPO DESCARTÁVEL (#22): 4 direções de design do Clipes, trocadas por ?variant=A..D e ?tela=importar|cortes|editor.
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import * as A from './variantes/VarianteA'
import * as B from './variantes/VarianteB'
import * as C from './variantes/VarianteC'
import * as D from './variantes/VarianteD'

const VARIANTES = { A, B, C, D } as const
type K = keyof typeof VARIANTES
export type Tela = 'importar' | 'cortes' | 'editor'
export type PropsVariante = { tela: Tela; irPara: (t: Tela) => void }
const TELAS: { id: Tela; nome: string }[] = [
  { id: 'importar', nome: 'Importar Fonte' },
  { id: 'cortes', nome: 'Cortes' },
  { id: 'editor', nome: 'Editor' },
]

function lerParams(): { v: K; t: Tela } {
  const p = new URLSearchParams(location.search)
  const v = (p.get('variant') ?? 'A').toUpperCase() as K
  const t = (p.get('tela') ?? 'editor') as Tela
  return { v: v in VARIANTES ? v : 'A', t: TELAS.some(x => x.id === t) ? t : 'editor' }
}

export default function App() {
  const [{ v, t }, set] = useState(lerParams)
  const ir = (nv: K, nt: Tela) => {
    const p = new URLSearchParams(location.search)
    p.set('variant', nv); p.set('tela', nt)
    history.replaceState(null, '', `?${p}`)
    set({ v: nv, t: nt })
  }
  const ks = Object.keys(VARIANTES) as K[]
  const passo = (d: number) => ir(ks[(ks.indexOf(v) + d + ks.length) % ks.length], t)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input,textarea,select,[contenteditable="true"]')) return
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); passo(1) }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); passo(-1) }
      if (e.altKey && ['1', '2', '3'].includes(e.key)) ir(v, TELAS[+e.key - 1].id)
    }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  })

  const Var = VARIANTES[v]
  return (
    <>
      <Var.default key={v + t} tela={t} irPara={(nt: Tela) => ir(v, nt)} />
      {/* Barra do protótipo: NÃO faz parte do design avaliado. */}
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-1 rounded-full bg-fuchsia-600 text-white shadow-2xl shadow-black/40 px-1.5 py-1 text-[12px] font-medium select-none whitespace-nowrap" style={{ fontFamily: 'system-ui' }}>
        <button onClick={() => passo(-1)} className="p-1.5 rounded-full hover:bg-white/20" title="Variante anterior (Alt+←)"><ChevronLeft size={16} /></button>
        <span className="px-2 min-w-[170px] text-center">{v} · {Var.nome}</span>
        <button onClick={() => passo(1)} className="p-1.5 rounded-full hover:bg-white/20" title="Próxima variante (Alt+→)"><ChevronRight size={16} /></button>
        <span className="w-px h-5 bg-white/30 mx-1" />
        {TELAS.map((x, i) => (
          <button key={x.id} onClick={() => ir(v, x.id)} title={`Alt+${i + 1}`}
            className={`px-2.5 py-1 rounded-full ${t === x.id ? 'bg-white text-fuchsia-700' : 'hover:bg-white/20'}`}>{x.nome}</button>
        ))}
      </div>
    </>
  )
}
