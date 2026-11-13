// Núcleo comum (F, G, H): casca da variante (tokens, avisos) e paleta de comandos Ctrl+K com cmdk.
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { Toaster } from 'sonner'
import { CornerDownLeft } from 'lucide-react'
import { cortes } from '../../dados'
import type { Tela } from '../../App'
import { Kbd, foco } from './base'

export type Cmd = {
  id: string; grupo: string; rotulo: string; tecla?: string[]; dica?: string
  palavras?: string[]; acao?: () => void; filhos?: Cmd[]
}

type Ctx = { paleta: boolean; abrirPaleta: (v: boolean) => void; aberta: { current: boolean } }
const CtxCasca = createContext<Ctx>(null as unknown as Ctx)
export const useCasca = () => useContext(CtxCasca)

/** Raiz da variante: aplica o tema por CSS variables (sem vazar estilo global) e hospeda avisos e paleta. */
export function Casca({ estilo, className = '', children, fonte = 'sans' }: { estilo: CSSProperties; className?: string; children: ReactNode; fonte?: 'sans' | 'geist' }) {
  const [paleta, setPaleta] = useState(() => new URLSearchParams(location.search).has('paleta')) // ?paleta abre já aberta (para screenshots)
  const aberta = useRef(paleta)
  const abrirPaleta = (v: boolean) => { aberta.current = v; setPaleta(v) }
  const familia = fonte === 'geist' ? '"Geist Variable", system-ui, sans-serif' : '"Inter Variable", system-ui, sans-serif'
  return (
    <CtxCasca.Provider value={{ paleta, abrirPaleta, aberta }}>
      <div style={{ ...estilo, fontFamily: familia }}
        className={`h-full overflow-hidden bg-[var(--bg)] text-[var(--tx)] text-[13px] antialiased selection:bg-[var(--acc-bg)] ${className}`}>
        {children}
        <Toaster position="bottom-right" offset={20} toastOptions={{
          style: { background: 'var(--s2)', border: '1px solid var(--ln2)', color: 'var(--tx)', fontFamily: familia, fontSize: 13, boxShadow: '0 12px 32px -12px rgba(0,0,0,.45)' },
        }} />
        <style>{`
          .nu-pal{animation:nu-pal .16s cubic-bezier(.22,1,.36,1)}
          .nu-scrim{animation:nu-fade .16s ease-out}
          @keyframes nu-pal{from{opacity:0;transform:translateY(-6px) scale(.985)}to{opacity:1;transform:none}}
          @keyframes nu-fade{from{opacity:0}to{opacity:1}}
          @media (prefers-reduced-motion: reduce){.nu-pal,.nu-scrim{animation:nu-fade .01s linear}}
          .nu-sem-barra{scrollbar-width:none}.nu-sem-barra::-webkit-scrollbar{display:none}
          .nu-rolagem{scrollbar-width:thin;scrollbar-color:var(--ln2) transparent}
        `}</style>
      </div>
    </CtxCasca.Provider>
  )
}

/** Atalhos de tela: ignorados com a paleta aberta, com Alt (troca de variante do protótipo) ou com foco num campo. */
export function useAtalhos(h: (e: KeyboardEvent) => void) {
  const { aberta } = useCasca()
  const ref = useRef(h); ref.current = h
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (aberta.current) return
      const el = e.target as HTMLElement
      if (e.altKey && !el.closest?.('[data-alca]')) return
      if (el.closest?.('input,textarea,select,[contenteditable="true"]')) return
      ref.current(e)
    }
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }, [aberta])
}

/** Botão que abre a paleta, para a barra superior. */
export function GatilhoPaleta({ largo = false, rotulo = 'Comandos' }: { largo?: boolean; rotulo?: string }) {
  const { abrirPaleta } = useCasca()
  return (
    <button onClick={() => abrirPaleta(true)}
      className={`h-7 flex items-center gap-2 px-2.5 rounded-[6px] border border-[var(--ln)] bg-[var(--bg)] text-[var(--tx3)] hover:text-[var(--tx2)] hover:border-[var(--ln2)] transition-colors duration-150 ${largo ? 'w-full' : ''} ${foco}`}>
      <span className={`text-[12.5px] ${largo ? 'flex-1 text-left' : ''}`}>{rotulo}</span>
      <Kbd k={['Ctrl', 'K']} />
    </button>
  )
}

export function Paleta({ comandos, tela, irPara, irCorte }: {
  comandos: Cmd[]; tela: Tela; irPara: (t: Tela) => void; irCorte?: (i: number) => void
}) {
  const { paleta, abrirPaleta } = useCasca()
  const [busca, setBusca] = useState('')
  const [paginaId, setPaginaId] = useState<string | null>(null)

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirPaleta(!paleta) }
      const el = e.target as HTMLElement
      if (irCorte && !paleta && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'g' && !el.closest?.('input,textarea,select')) {
        e.preventDefault(); setPaginaId('ir-corte'); abrirPaleta(true)
      }
    }
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }, [paleta, abrirPaleta, irCorte])
  useEffect(() => { if (!paleta) { setBusca(''); setPaginaId(null) } }, [paleta])

  const nav: Cmd[] = [
    ...(irCorte ? [{
      id: 'ir-corte', grupo: 'Navegar', rotulo: 'Ir para o Corte…', tecla: ['G'], palavras: ['abrir', 'trocar'],
      filhos: cortes.map((c, i) => ({ id: c.id, grupo: 'Cortes', rotulo: c.titulo, dica: `${i + 1}/${cortes.length}`, palavras: c.frases.map(f => f.texto), acao: () => irCorte(i) })),
    }] : []),
    ...(tela !== 'importar' ? [{ id: 'n-imp', grupo: 'Navegar', rotulo: 'Importar Fonte', palavras: ['url', 'arquivo', 'fila'], acao: () => irPara('importar') }] : []),
    ...(tela !== 'cortes' ? [{ id: 'n-cor', grupo: 'Navegar', rotulo: 'Ver Cortes sugeridos', palavras: ['lista', 'aprovar', 'nota'], acao: () => irPara('cortes') }] : []),
    ...(tela !== 'editor' ? [{ id: 'n-ed', grupo: 'Navegar', rotulo: 'Abrir editor do Corte', palavras: ['editar'], acao: () => irPara('editor') }] : []),
  ]
  const todos = [...comandos, ...nav]
  const pagina = paginaId ? todos.find(c => c.id === paginaId) ?? null : null
  const lista = pagina ? pagina.filhos! : todos
  const grupos = [...new Set(lista.map(c => c.grupo))]

  const executar = (c: Cmd) => {
    if (c.filhos) { setPaginaId(c.id); setBusca(''); return }
    abrirPaleta(false)
    c.acao?.()
  }

  if (!paleta) return null
  return (
    <div className="nu-scrim fixed inset-0 z-40 flex justify-center pt-[13vh] bg-[var(--ov)]" onMouseDown={() => abrirPaleta(false)}>
      <Command label="Paleta de comandos" loop onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); pagina ? setPaginaId(null) : abrirPaleta(false) }
          if (e.key === 'Backspace' && !busca && pagina) { e.preventDefault(); setPaginaId(null) }
        }}
        className="nu-pal w-[600px] max-w-[calc(100vw-32px)] h-fit max-h-[min(480px,70vh)] flex flex-col rounded-[10px] bg-[var(--s1)] border border-[var(--ln2)] shadow-[0_24px_64px_-16px_rgba(0,0,0,.6)] overflow-hidden">
        <div className="shrink-0 flex items-center gap-2 h-12 px-4 border-b border-[var(--ln)]">
          {pagina && <span className="shrink-0 h-6 px-2 grid place-items-center rounded-[4px] bg-[var(--s3)] text-[12px] text-[var(--tx2)]">{pagina.rotulo.replace('…', '')}</span>}
          <Command.Input autoFocus value={busca} onValueChange={setBusca}
            placeholder={pagina ? 'Título ou trecho da Transcrição' : 'Digite um comando ou procure'}
            className="flex-1 h-full bg-transparent outline-none text-[14px] text-[var(--tx)] placeholder:text-[var(--tx3)]" />
          <Kbd k={['Esc']} />
        </div>
        <Command.List className="nu-rolagem overflow-y-auto overscroll-contain p-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:text-[var(--tx3)]">
          <Command.Empty className="px-3 py-8 text-center text-[var(--tx3)]">Nenhum comando com “{busca}”.</Command.Empty>
          {grupos.map(g => (
            <Command.Group key={g} heading={g}>
              {lista.filter(c => c.grupo === g).map(c => (
                <Command.Item key={c.id} value={c.id + ' ' + c.rotulo} keywords={c.palavras} onSelect={() => executar(c)}
                  className="h-9 flex items-center gap-3 px-2.5 rounded-[6px] cursor-default text-[13px] text-[var(--tx2)] data-[selected=true]:bg-[var(--s3)] data-[selected=true]:text-[var(--tx)]">
                  <span className="flex-1 truncate">{c.rotulo}</span>
                  {c.dica && <span className="font-mono text-[11px] tabular-nums text-[var(--tx3)]">{c.dica}</span>}
                  {c.tecla && <Kbd k={c.tecla} />}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
        <div className="h-9 shrink-0 flex items-center gap-4 px-4 border-t border-[var(--ln)] text-[11.5px] text-[var(--tx3)]">
          <span className="flex items-center gap-1.5"><Kbd k={['↑', '↓']} /> mover</span>
          <span className="flex items-center gap-1.5"><span className="inline-grid place-items-center h-[18px] min-w-[18px] rounded-[4px] border border-[var(--ln2)] bg-[var(--s2)] text-[var(--tx2)]"><CornerDownLeft size={10} /></span> executar</span>
          {pagina && <span className="flex items-center gap-1.5"><Kbd k={['⌫']} /> voltar</span>}
        </div>
      </Command>
    </div>
  )
}
