// Variante D · "Comando": peças comuns (teclas, barra superior, paleta de comandos, aviso).
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { CornerDownLeft, Search } from 'lucide-react'
import { cortes } from '../../dados'
import type { Tela } from '../../App'

/** Estado que sobrevive à troca de tela (o App remonta a variante a cada troca). */
export const memo = {
  corte: 0,
  status: { c1: 'aprovado', c3: 'aprovado' } as Record<string, 'aprovado' | 'rejeitado' | undefined>,
}

export const num = (n: number, casas = 1) => n.toFixed(casas).replace('.', ',')
export const foco = 'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950'

/* ---------- Teclas ---------- */
export function Kbd({ k, inv = false }: { k: string[]; inv?: boolean }) {
  return (
    <span className="inline-flex items-center gap-[3px] shrink-0" aria-hidden>
      {k.map((x, i) => (
        <kbd key={i}
          className={`inline-grid place-items-center h-[18px] min-w-[18px] px-[5px] rounded-[4px] font-mono text-[10.5px] leading-none tabular-nums border ${inv
            ? 'border-white/25 text-white/75 bg-white/5'
            : 'border-neutral-200 border-b-neutral-300 text-neutral-600 bg-white'}`}>{x}</kbd>
      ))}
    </span>
  )
}

/* ---------- Contexto da variante ---------- */
export type Cmd = {
  id: string; grupo: string; rotulo: string; tecla?: string[]; dica?: string
  palavras?: string[]; acao?: () => void; filhos?: Cmd[]
}
type Ctx = { avisar: (m: string) => void; paletaAberta: { current: boolean }; abrirPaleta: (v: boolean) => void; paleta: boolean }
export const CtxD = createContext<Ctx>(null as unknown as Ctx)
export const useD = () => useContext(CtxD)

/** Atalhos de tela: ignorados enquanto a paleta está aberta ou o foco está num campo de texto. */
export function useTeclas(h: (e: KeyboardEvent) => void) {
  const { paletaAberta } = useD()
  const ref = useRef(h); ref.current = h
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (paletaAberta.current || e.altKey) return
      const el = e.target as HTMLElement
      if (el.closest?.('input,textarea,select,[contenteditable="true"]')) return
      ref.current(e)
    }
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }, [paletaAberta])
}

export function Raiz({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ t: string; n: number } | null>(null)
  const [paleta, setPaleta] = useState(false)
  const paletaAberta = useRef(false)
  const abrirPaleta = (v: boolean) => { paletaAberta.current = v; setPaleta(v) }
  useEffect(() => {
    if (!msg) return
    const id = setTimeout(() => setMsg(null), 2400)
    return () => clearTimeout(id)
  }, [msg])
  return (
    <CtxD.Provider value={{ avisar: t => setMsg({ t, n: Date.now() }), paletaAberta, abrirPaleta, paleta }}>
      <div className="h-full flex flex-col bg-white text-neutral-950 font-geist text-[13px] antialiased overflow-hidden selection:bg-neutral-950 selection:text-white"
        style={{ fontFeatureSettings: '"ss01", "cv11"' }}>
        {children}
        <div aria-live="polite" className="pointer-events-none fixed top-[52px] left-1/2 -translate-x-1/2 z-50">
          {msg && (
            <div key={msg.n} className="d-aviso rounded-[6px] bg-neutral-950 text-white text-[12.5px] px-3 h-8 inline-flex items-center gap-2 shadow-[0_6px_24px_-8px_rgba(0,0,0,.35)]">
              {msg.t}
            </div>
          )}
        </div>
        <style>{`
          .d-aviso{animation:d-in .16s ease-out}
          @keyframes d-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
          @media (prefers-reduced-motion: reduce){.d-aviso{animation:none}}
          .d-sem-barra{scrollbar-width:none}.d-sem-barra::-webkit-scrollbar{display:none}
        `}</style>
      </div>
    </CtxD.Provider>
  )
}

/* ---------- Barra superior ---------- */
export type Migalha = { rotulo: string; ir?: () => void }

export function Barra({ migalhas, direita }: { migalhas: Migalha[]; direita?: ReactNode }) {
  const { abrirPaleta } = useD()
  return (
    <header className="h-10 shrink-0 grid grid-cols-[minmax(0,1fr)_minmax(260px,340px)_minmax(0,1fr)] items-center gap-4 px-3 border-b border-neutral-200">
      <nav aria-label="Caminho" className="flex items-center min-w-0 text-[12.5px]">
        <span className="size-[9px] bg-neutral-950 rounded-[2px] mr-3 shrink-0" aria-hidden />
        {migalhas.map((m, i) => {
          const ultima = i === migalhas.length - 1
          return (
            <span key={i} className={`flex items-center min-w-[48px] ${ultima ? 'shrink-0 max-w-[55%]' : 'shrink'}`}>
              {i > 0 && <span className="px-2 text-neutral-300" aria-hidden>/</span>}
              {m.ir && !ultima
                ? <button onClick={m.ir} className={`truncate text-neutral-500 hover:text-neutral-950 rounded-[3px] ${foco}`}>{m.rotulo}</button>
                : <span className={`truncate ${ultima ? 'text-neutral-950 font-medium' : 'text-neutral-500'}`} aria-current={ultima ? 'page' : undefined}>{m.rotulo}</span>}
            </span>
          )
        })}
      </nav>
      <button onClick={() => abrirPaleta(true)}
        className={`h-7 w-full flex items-center gap-2 px-2.5 rounded-[6px] bg-neutral-50 border border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-700 ${foco}`}>
        <Search size={13} strokeWidth={1.75} />
        <span className="flex-1 text-left text-[12.5px]">Buscar ou executar…</span>
        <Kbd k={['Ctrl', 'K']} />
      </button>
      <div className="flex items-center justify-end gap-2 min-w-0">{direita}</div>
    </header>
  )
}

/* ---------- Paleta de comandos ---------- */
export function Paleta({ comandos, tela, irPara, irCorte }: {
  comandos: Cmd[]; tela: Tela; irPara: (t: Tela) => void; irCorte: (i: number) => void
}) {
  const { paleta, abrirPaleta } = useD()
  const [busca, setBusca] = useState('')
  const [paginaId, setPaginaId] = useState<string | null>(null)

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirPaleta(!paleta) }
      const el = e.target as HTMLElement
      if (!paleta && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'g' && !el.closest?.('input,textarea,select')) {
        e.preventDefault(); setPaginaId('ir-corte'); abrirPaleta(true)
      }
    }
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }, [paleta, abrirPaleta])
  useEffect(() => { if (!paleta) { setBusca(''); setPaginaId(null) } }, [paleta])

  const nav: Cmd[] = [
    {
      id: 'ir-corte', grupo: 'Navegar', rotulo: 'Ir para o Corte…', tecla: ['G'], palavras: ['abrir', 'trocar'],
      filhos: cortes.map((c, i) => ({ id: c.id, grupo: 'Cortes', rotulo: c.titulo, dica: `${i + 1}/${cortes.length}`, palavras: c.frases.map(f => f.texto), acao: () => irCorte(i) })),
    },
    ...(tela !== 'importar' ? [{ id: 'n-imp', grupo: 'Navegar', rotulo: 'Importar Fonte', palavras: ['url', 'arquivo', 'fila'], acao: () => irPara('importar') }] : []),
    ...(tela !== 'cortes' ? [{ id: 'n-cor', grupo: 'Navegar', rotulo: 'Ver Cortes sugeridos', palavras: ['lista', 'aprovar'], acao: () => irPara('cortes') }] : []),
    ...(tela !== 'editor' ? [{ id: 'n-ed', grupo: 'Navegar', rotulo: 'Abrir editor do Corte', palavras: ['editar'], acao: () => irPara('editor') }] : []),
  ]
  const pagina = paginaId ? [...comandos, ...nav].find(c => c.id === paginaId) ?? null : null
  const setPagina = (c: Cmd | null) => setPaginaId(c?.id ?? null)
  const lista = pagina ? pagina.filhos! : [...comandos, ...nav]
  const grupos = [...new Set(lista.map(c => c.grupo))]

  const executar = (c: Cmd) => {
    if (c.filhos) { setPagina(c); setBusca(''); return }
    abrirPaleta(false)
    c.acao?.()
  }

  if (!paleta) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-center pt-[12vh] bg-white/60" onMouseDown={() => abrirPaleta(false)}>
      <Command label="Paleta de comandos" loop onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); pagina ? setPagina(null) : abrirPaleta(false) }
          if (e.key === 'Backspace' && !busca && pagina) { e.preventDefault(); setPagina(null) }
        }}
        className="w-[600px] max-w-[calc(100vw-32px)] h-fit max-h-[min(460px,70vh)] flex flex-col rounded-[10px] bg-white border border-neutral-200 shadow-[0_24px_64px_-20px_rgba(0,0,0,.28),0_2px_6px_-2px_rgba(0,0,0,.06)] overflow-hidden">
        <div className="flex items-center gap-2 h-12 px-4 border-b border-neutral-200">
          {pagina && (
            <button onClick={() => setPagina(null)} className={`shrink-0 h-6 px-2 rounded-[4px] bg-neutral-100 text-[12px] text-neutral-700 ${foco}`}>{pagina.rotulo.replace('…', '')}</button>
          )}
          <Command.Input autoFocus value={busca} onValueChange={setBusca}
            placeholder={pagina ? 'Título ou trecho da Transcrição' : 'Digite um comando ou procure'}
            className="flex-1 h-full bg-transparent outline-none text-[14px] placeholder:text-neutral-500" />
          <Kbd k={['Esc']} />
        </div>
        <Command.List className="overflow-y-auto overscroll-contain p-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:text-neutral-500">
          <Command.Empty className="px-3 py-8 text-center text-neutral-500">Nenhum comando com “{busca}”.</Command.Empty>
          {grupos.map(g => (
            <Command.Group key={g} heading={g}>
              {lista.filter(c => c.grupo === g).map(c => (
                <Command.Item key={c.id} value={c.id + ' ' + c.rotulo} keywords={c.palavras} onSelect={() => executar(c)}
                  className="group h-9 flex items-center gap-3 px-2.5 rounded-[6px] cursor-default text-[13px] text-neutral-800 data-[selected=true]:bg-neutral-950 data-[selected=true]:text-white">
                  <span className="flex-1 truncate">{c.rotulo}</span>
                  {c.dica && <span className="font-mono text-[11px] tabular-nums text-neutral-500 group-data-[selected=true]:text-white/60">{c.dica}</span>}
                  {c.tecla && <span className="group-data-[selected=true]:hidden"><Kbd k={c.tecla} /></span>}
                  {c.tecla && <span className="hidden group-data-[selected=true]:inline-flex"><Kbd k={c.tecla} inv /></span>}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
        <div className="h-9 shrink-0 flex items-center gap-4 px-4 border-t border-neutral-200 text-[11.5px] text-neutral-500">
          <span className="flex items-center gap-1.5"><Kbd k={['↑', '↓']} /> mover</span>
          <span className="flex items-center gap-1.5"><span className="inline-grid place-items-center h-[18px] min-w-[18px] rounded-[4px] border border-neutral-200 text-neutral-600"><CornerDownLeft size={10} /></span> executar</span>
          {pagina && <span className="flex items-center gap-1.5"><Kbd k={['⌫']} /> voltar</span>}
        </div>
      </Command>
    </div>
  )
}

/** Botão primário preto (o preto é o acento desta direção). */
export function Primario({ children, tecla, onClick, disabled, className = '' }: {
  children: ReactNode; tecla?: string[]; onClick?: () => void; disabled?: boolean; className?: string
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`h-7 inline-flex items-center gap-2 pl-3 ${tecla ? 'pr-1.5' : 'pr-3'} rounded-[6px] bg-neutral-950 text-white text-[12.5px] font-medium hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500 ${foco} ${className}`}>
      {children}{tecla && <Kbd k={tecla} inv />}
    </button>
  )
}
