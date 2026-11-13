// Variante E, "Estúdio + Comando": a moldura comum às três telas.
// Topo de 40 px (caminho, busca Ctrl K, ação principal), paleta de comandos (cmdk), folha de atalhos (?) e os atalhos globais.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { CornerDownLeft, Search } from 'lucide-react'
import { Toaster } from 'sonner'
import { cortes, fonte, img, presets } from '../../dados'
import type { Tela } from '../../App'
import { CUSTO, acoes, loja, num, useLoja, usd } from './estado'
import { Kbd, foco, tema } from './ui'

export type Cmd = {
  id: string; grupo: string; rotulo: string; tecla?: string[]; seq?: boolean; dica?: string
  palavras?: string[]; acao?: () => void; filhos?: Cmd[]; thumb?: string
  /** Comando de Corte: fora do editor, abre o editor antes de agir, para o resultado ficar à vista. */
  editor?: boolean
}

type Ctx = {
  tela: Tela; irPara: (t: Tela) => void
  abrirPaleta: (v: boolean, pagina?: string) => void
  abrirFolha: (v: boolean) => void
  /** true enquanto a paleta ou a folha de atalhos estão abertas: os atalhos de tela param. */
  ocupado: { current: boolean }
  comandosTela: { current: Cmd[] }
}
const CtxE = createContext<Ctx>(null as unknown as Ctx)
export const useE = () => useContext(CtxE)

/** Os parâmetros de captura valem só na primeira montagem, não a cada troca de tela. */
const q = new URLSearchParams(location.search)
let paletaInicial = q.get('paleta') === '1'
let folhaInicial = q.get('atalhos') === '1'

/** Atalhos de tela: param com a paleta ou a folha abertas, com Alt (barra do protótipo) e dentro de campos. */
export function useTeclas(h: (e: KeyboardEvent) => void) {
  const { ocupado } = useE()
  const ref = useRef(h); ref.current = h
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (ocupado.current || e.altKey) return
      const el = e.target as HTMLElement
      if (el.closest?.('input,textarea,select,[contenteditable="true"],[role="slider"]')) return
      ref.current(e)
    }
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }, [ocupado])
}
/** A tela declara os comandos dela; a paleta junta com os globais. */
export function useComandosTela(cmds: Cmd[]) { useE().comandosTela.current = cmds }

export function Raiz({ tela, irPara, children }: { tela: Tela; irPara: (t: Tela) => void; children: ReactNode }) {
  const [paleta, setPaleta] = useState<{ aberta: boolean; pagina: string | null }>(() => {
    const p = { aberta: paletaInicial, pagina: null }; paletaInicial = false; return p
  })
  const [folha, setFolha] = useState(() => { const f = folhaInicial; folhaInicial = false; return f })
  const ocupado = useRef(false); ocupado.current = paleta.aberta || folha
  const comandosTela = useRef<Cmd[]>([])
  const g = useRef(0)

  const abrirPaleta = (v: boolean, pagina?: string) => { setFolha(false); setPaleta({ aberta: v, pagina: pagina ?? null }) }
  const abrirFolha = (v: boolean) => { setPaleta({ aberta: false, pagina: null }); setFolha(v) }

  // Atalhos globais, na captura: chegam antes dos atalhos de tela e podem barrá-los.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase()
      const parar = () => { e.preventDefault(); e.stopPropagation() }
      if (ctrl && !e.shiftKey && k === 'k') { parar(); return paleta.aberta ? abrirPaleta(false) : abrirPaleta(true) }
      if (ctrl && !e.shiftKey && k === 'p') { parar(); return abrirPaleta(true, 'ir-corte') }
      if (paleta.aberta || e.altKey) return
      if (folha) { if (e.key === 'Escape' || e.key === '?') { parar(); setFolha(false) } return }
      if ((e.target as HTMLElement).closest?.('input,textarea,select,[contenteditable="true"]')) return
      if (ctrl && e.shiftKey && k === 'e') { parar(); return acoes.exportarAprovados() }
      if (ctrl && k === 'e') { parar(); return acoes.exportarCorte() }
      if (ctrl) return
      if (e.key === '?') { parar(); return setFolha(true) }
      if (g.current && performance.now() - g.current < 1200 && (k === 'i' || k === 'c')) {
        parar(); g.current = 0; return irPara(k === 'i' ? 'importar' : 'cortes')
      }
      g.current = k === 'g' && !e.shiftKey ? performance.now() : 0
    }
    addEventListener('keydown', h, true)
    return () => removeEventListener('keydown', h, true)
  })

  return (
    <CtxE.Provider value={{ tela, irPara, abrirPaleta, abrirFolha, ocupado, comandosTela }}>
      <div style={tema} className="h-full flex flex-col overflow-hidden bg-[var(--e-bg)] text-[var(--e-tx)] font-sans text-[13px] antialiased [color-scheme:dark] selection:bg-[var(--e-accbg)]">
        {children}
        {paleta.aberta && <Paleta pagina0={paleta.pagina} fechar={() => abrirPaleta(false)} />}
        {folha && <FolhaAtalhos fechar={() => setFolha(false)} />}
        <Toaster position="bottom-right" offset={{ bottom: 188, right: 60 }} toastOptions={{
          style: { background: '#232323', border: '1px solid #3b3b3b', color: '#ecebe7', fontFamily: '"Inter Variable", system-ui, sans-serif', fontSize: 13 },
        }} />
      </div>
    </CtxE.Provider>
  )
}

/* ---------------------------------------------------------------- topo */

export type Migalha = { rotulo: string; ir?: () => void }

export function Topo({ migalhas, direita }: { migalhas: Migalha[]; direita?: ReactNode }) {
  const { abrirPaleta } = useE()
  return (
    <header className="h-10 shrink-0 grid grid-cols-[minmax(0,1fr)_minmax(240px,300px)_minmax(0,1fr)] items-center gap-4 pl-4 pr-2 border-b border-[var(--e-ln)] bg-[var(--e-s1)]">
      <nav aria-label="Caminho" className="flex items-center min-w-0 text-[12.5px]">
        {migalhas.map((m, i) => {
          const ultima = i === migalhas.length - 1
          return (
            <span key={i} className={`flex items-center min-w-[40px] ${ultima ? 'shrink-0 max-w-[60%]' : 'shrink'}`}>
              {i > 0 && <span className="px-2 text-[var(--e-ln2)]" aria-hidden>/</span>}
              {m.ir && !ultima
                ? <button onClick={m.ir} className={`truncate text-[var(--e-tx3)] hover:text-[var(--e-tx)] rounded-[3px] ${foco}`}>{m.rotulo}</button>
                : <span className={`truncate ${ultima ? 'text-[var(--e-tx)]' : 'text-[var(--e-tx3)]'}`} aria-current={ultima ? 'page' : undefined}>{m.rotulo}</span>}
            </span>
          )
        })}
      </nav>
      <button onClick={() => abrirPaleta(true)}
        className={`h-7 w-full flex items-center gap-2 pl-2.5 pr-1.5 rounded-[6px] bg-[var(--e-bg)] border border-[var(--e-ln)] text-[var(--e-tx3)] hover:border-[var(--e-ln2)] hover:text-[var(--e-tx2)] transition-colors ${foco}`}>
        <Search size={13} strokeWidth={1.75} />
        <span className="flex-1 text-left text-[12.5px]">Buscar ou executar…</span>
        <Kbd k={['Ctrl', 'K']} />
      </button>
      <div className="flex items-center justify-end gap-2 min-w-0">{direita}</div>
    </header>
  )
}

/** Botão principal do topo, com o atalho dentro. */
export function Principal({ children, tecla, onClick, disabled }: { children: ReactNode; tecla: string[]; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`h-7 inline-flex items-center gap-2 whitespace-nowrap pl-3 pr-1.5 rounded-[6px] bg-[var(--e-tx)] text-[#161616] text-[12.5px] font-medium hover:bg-white disabled:opacity-40 disabled:pointer-events-none ${foco}`}>
      {children}<Kbd k={tecla} inv />
    </button>
  )
}

/* ---------------------------------------------------------------- paleta */

function comandosGlobais(tela: Tela, irPara: (t: Tela) => void): Cmd[] {
  const st = loja.get()
  const c = cortes[st.corte]
  const aprovados = cortes.filter(k => st.status[k.id] === 'aprovado').length
  return [
    ...(tela !== 'importar' ? [{ id: 'ir-imp', grupo: 'Navegar', rotulo: 'Ir para Importar', tecla: ['G', 'I'], seq: true, palavras: ['fonte', 'url', 'arquivo', 'fila'], acao: () => irPara('importar') }] : []),
    ...(tela !== 'cortes' ? [{ id: 'ir-cor', grupo: 'Navegar', rotulo: 'Ir para Cortes', tecla: ['G', 'C'], seq: true, palavras: ['lista', 'aprovar', 'nota'], acao: () => irPara('cortes') }] : []),
    {
      id: 'ir-corte', grupo: 'Navegar', rotulo: 'Ir para o Corte…', tecla: ['Ctrl', 'P'], palavras: ['abrir', 'editor', 'trocar'],
      filhos: cortes.map((k, i) => ({
        id: 'corte-' + k.id, grupo: 'Cortes', rotulo: k.titulo, dica: `Nota ${num(k.nota.total)}`, thumb: k.thumbs[3],
        palavras: k.frases.map(f => f.texto), editor: true, acao: () => acoes.irCorte(i),
      })),
    },
    { id: 'ext-ini', grupo: 'Corte', rotulo: 'Estender início em 1 Frase', tecla: ['Shift', '←'], palavras: ['antes', 'frase'], editor: true, acao: () => acoes.estender('inicio', 1) },
    { id: 'enc-ini', grupo: 'Corte', rotulo: 'Encurtar início em 1 Frase', tecla: ['Ctrl', 'Shift', '→'], palavras: ['frase'], editor: true, acao: () => acoes.estender('inicio', -1) },
    { id: 'ext-fim', grupo: 'Corte', rotulo: 'Estender fim em 1 Frase', tecla: ['Shift', '→'], palavras: ['depois', 'frase'], editor: true, acao: () => acoes.estender('fim', 1) },
    { id: 'enc-fim', grupo: 'Corte', rotulo: 'Encurtar fim em 1 Frase', tecla: ['Ctrl', 'Shift', '←'], palavras: ['frase'], editor: true, acao: () => acoes.estender('fim', -1) },
    { id: 'sil', grupo: 'Corte', rotulo: st.semSilencio ? 'Restaurar silêncios' : 'Remover silêncios', tecla: ['S'], palavras: ['pausa', 'áudio', 'audio'], editor: true, acao: acoes.alternarSilencios },
    ...presets.map((p, i) => ({ id: 'pre-' + p.id, grupo: 'Corte', rotulo: `Aplicar legenda ${p.nome}`, tecla: [String(i + 1)], dica: p.id === st.preset ? 'em uso' : undefined, palavras: ['preset', 'estilo', 'legenda'], editor: true, acao: () => acoes.aplicarPreset(i) })),
    { id: 'enq', grupo: 'Corte', rotulo: 'Enquadrar', tecla: ['E'], palavras: ['crop', 'recorte', '16:9', 'enquadramento'], editor: true, acao: acoes.enquadrar },
    { id: 'cen', grupo: 'Corte', rotulo: 'Centralizar o recorte', tecla: ['C'], palavras: ['crop', 'centro', 'enquadramento'], editor: true, acao: acoes.centralizar },
    { id: 'exp', grupo: 'Exportar', rotulo: 'Exportar este Corte', dica: c.titulo, tecla: ['Ctrl', 'E'], palavras: ['render', 'salvar', 'mp4'], acao: acoes.exportarCorte },
    { id: 'exp-lote', grupo: 'Exportar', rotulo: `Exportar aprovados (${aprovados})`, dica: usd(aprovados * CUSTO), tecla: ['Ctrl', 'Shift', 'E'], palavras: ['lote', 'empacotamento', 'provedor'], acao: acoes.exportarAprovados },
  ]
}

function Paleta({ pagina0, fechar }: { pagina0: string | null; fechar: () => void }) {
  const { tela, irPara, comandosTela, abrirFolha } = useE()
  const [busca, setBusca] = useState('')
  const [paginaId, setPaginaId] = useState<string | null>(pagina0)
  useLoja() // rótulos acompanham o estado (silêncios, aprovados)

  // Navegar sempre no topo; fora do editor, os comandos da tela vêm logo depois (aprovar, colar URL…).
  const globais = comandosGlobais(tela, irPara)
  const nav = globais.filter(c => c.grupo === 'Navegar'), resto = globais.filter(c => c.grupo !== 'Navegar')
  const todos: Cmd[] = [
    ...nav,
    ...(tela === 'editor' ? [...resto, ...comandosTela.current] : [...comandosTela.current, ...resto]),
    { id: 'atalhos', grupo: 'Ajuda', rotulo: 'Ver todos os atalhos', tecla: ['?'], palavras: ['teclado', 'ajuda'], acao: () => abrirFolha(true) },
  ]
  const pagina = paginaId ? todos.find(c => c.id === paginaId) ?? null : null
  const lista = pagina?.filhos ?? todos
  const grupos = [...new Set(lista.map(c => c.grupo))]

  const executar = (c: Cmd) => {
    if (c.filhos) { setPaginaId(c.id); setBusca(''); return }
    fechar()
    if (c.editor && tela !== 'editor') { irPara('editor'); setTimeout(() => c.acao?.(), 90) }
    else c.acao?.()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center pt-[11vh] bg-black/55" onMouseDown={fechar}>
      <Command label="Paleta de comandos" loop onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (pagina && pagina0 !== pagina.id) setPaginaId(null); else fechar() }
          if (e.key === 'Backspace' && !busca && pagina) { e.preventDefault(); setPaginaId(null) }
        }}
        className="w-[620px] max-w-[calc(100vw-32px)] h-fit max-h-[min(520px,74vh)] flex flex-col rounded-[10px] bg-[var(--e-s1)] border border-[var(--e-ln2)] shadow-[0_32px_80px_-16px_rgba(0,0,0,.85)] overflow-hidden">
        <div className="flex items-center gap-2.5 h-12 px-4 border-b border-[var(--e-ln)]">
          <Search size={15} strokeWidth={1.75} className="text-[var(--e-tx3)] shrink-0" />
          {pagina && (
            <button onClick={() => setPaginaId(null)} className={`shrink-0 h-6 px-2 rounded-[4px] bg-[var(--e-s3)] text-[12px] text-[var(--e-tx2)] ${foco}`}>{pagina.rotulo.replace('…', '')}</button>
          )}
          <Command.Input autoFocus value={busca} onValueChange={setBusca}
            placeholder={pagina ? 'Título ou trecho da Transcrição' : 'Digite um comando ou busque'}
            className="flex-1 h-full bg-transparent outline-none text-[14px] text-[var(--e-tx)] placeholder:text-[var(--e-tx3)]" />
          <Kbd k={['Esc']} />
        </div>
        <Command.List className="overflow-y-auto overscroll-contain p-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:text-[var(--e-tx3)]">
          <Command.Empty className="px-3 py-8 text-center text-[var(--e-tx3)]">Nenhum comando com “{busca}”.</Command.Empty>
          {grupos.map(gr => (
            <Command.Group key={gr} heading={gr}>
              {lista.filter(c => c.grupo === gr).map(c => (
                <Command.Item key={c.id} value={c.id + ' ' + c.rotulo} keywords={c.palavras} onSelect={() => executar(c)}
                  className="h-9 flex items-center gap-3 px-2.5 rounded-[6px] cursor-default text-[13px] text-[var(--e-tx2)] data-[selected=true]:bg-[var(--e-s3)] data-[selected=true]:text-[var(--e-tx)]">
                  {c.thumb && <img src={img(c.thumb)} alt="" className="w-8 h-[18px] rounded-[2px] object-cover shrink-0" />}
                  <span className="flex-1 truncate">{c.rotulo}</span>
                  {c.dica && <span className="max-w-[200px] truncate text-[11.5px] tabular text-[var(--e-tx3)]">{c.dica}</span>}
                  {c.tecla && <Kbd k={c.tecla} seq={c.seq} />}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
        <div className="h-9 shrink-0 flex items-center gap-4 px-4 border-t border-[var(--e-ln)] text-[11.5px] text-[var(--e-tx3)]">
          <span className="flex items-center gap-1.5"><Kbd k={['↑', '↓']} /> mover</span>
          <span className="flex items-center gap-1.5"><span className="inline-grid place-items-center h-[18px] min-w-[18px] rounded-[4px] border border-[var(--e-ln2)] bg-[var(--e-s2)] text-[var(--e-tx2)]"><CornerDownLeft size={10} /></span> executar</span>
          {pagina && <span className="flex items-center gap-1.5"><Kbd k={['⌫']} /> voltar</span>}
          <span className="flex-1" />
          <span className="truncate">Corte atual: {cortes[loja.get().corte].titulo}</span>
        </div>
      </Command>
    </div>
  )
}

/* ---------------------------------------------------------------- folha de atalhos */

type Linha = [string[], string, boolean?]
const FOLHA: { titulo: string; tela?: Tela; linhas: Linha[] }[] = [
  {
    titulo: 'Em qualquer tela', linhas: [
      [['Ctrl', 'K'], 'Buscar ou executar'], [['Ctrl', 'P'], 'Ir para o Corte…'],
      [['G', 'I'], 'Ir para Importar', true], [['G', 'C'], 'Ir para Cortes', true],
      [['Ctrl', 'E'], 'Exportar este Corte'], [['Ctrl', 'Shift', 'E'], 'Exportar aprovados'],
      [['?'], 'Esta folha'], [['Esc'], 'Fechar'],
    ],
  },
  {
    titulo: 'Editor', tela: 'editor', linhas: [
      [['Espaço'], 'Reproduzir ou pausar'], [['←', '→'], 'Palavra anterior ou próxima'], [['↑', '↓'], 'Corte anterior ou próximo'],
      [['Shift', '←'], 'Estender início em 1 Frase'], [['Shift', '→'], 'Estender fim em 1 Frase'],
      [['Ctrl', 'Shift', '→'], 'Encurtar início em 1 Frase'], [['Ctrl', 'Shift', '←'], 'Encurtar fim em 1 Frase'],
      [['S'], 'Remover ou restaurar silêncios'], [['1–4'], 'Legenda: Clássico a Caixa'], [['C'], 'Centralizar o recorte'],
      [['T'], 'Transcrição'], [['L'], 'Legenda'], [['E'], 'Enquadramento'], [['A'], 'Áudio'],
      [['I'], 'Recolher o inspector'], [['['], 'Recolher a lista de Cortes'],
    ],
  },
  {
    titulo: 'Cortes', tela: 'cortes', linhas: [
      [['/'], 'Filtrar pela Transcrição'], [['↑', '↓'], 'Mover'], [['A'], 'Aprovar'], [['R'], 'Rejeitar'], [['Enter'], 'Abrir no editor'],
    ],
  },
  {
    titulo: 'Importar', tela: 'importar', linhas: [
      [['Ctrl', 'V'], 'Colar URL'], [['Ctrl', 'O'], 'Escolher arquivo'], [['P'], 'Trocar a Permissão'], [['J'], 'Escolher o Projeto'], [['Enter'], 'Importar Fonte'],
    ],
  },
]

function FolhaAtalhos({ fechar }: { fechar: () => void }) {
  const { tela } = useE()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const atual = FOLHA.find(f => f.tela === tela)
  const outras = FOLHA.filter(f => f.tela && f.tela !== tela)
  const Bloco = ({ b }: { b: (typeof FOLHA)[number] }) => (
    <section>
      <h3 className="mb-2 text-[12px] text-[var(--e-tx3)]">{b.titulo}</h3>
      <dl className="flex flex-col">
        {b.linhas.map(([k, t, seq]) => (
          <div key={t} className="h-7 flex items-center justify-between gap-4">
            <dt className="text-[12.5px] text-[var(--e-tx2)] truncate">{t}</dt>
            <dd><Kbd k={k} seq={seq} /></dd>
          </div>
        ))}
      </dl>
    </section>
  )
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6" onMouseDown={fechar}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-label="Atalhos de teclado" onMouseDown={e => e.stopPropagation()}
        className="w-[820px] max-w-full max-h-[calc(100vh-120px)] overflow-y-auto rounded-[10px] bg-[var(--e-s1)] border border-[var(--e-ln2)] shadow-[0_32px_80px_-16px_rgba(0,0,0,.85)] outline-none">
        <div className="h-12 flex items-center justify-between px-5 border-b border-[var(--e-ln)]">
          <h2 className="text-[13.5px] font-medium">Atalhos de teclado</h2>
          <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--e-tx3)]"><Kbd k={['Esc']} /> fechar</span>
        </div>
        <div className="grid grid-cols-[1.15fr_1fr] gap-x-10 gap-y-6 px-5 py-5">
          {atual && <Bloco b={atual} />}
          <div className="flex flex-col gap-6">
            <Bloco b={FOLHA[0]} />
            {outras.map(b => <Bloco key={b.titulo} b={b} />)}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Migalhas padrão: Projeto / Fonte / Corte. */
export function useMigalhas(corte?: boolean): Migalha[] {
  const { irPara } = useE()
  const st = useLoja()
  return [
    { rotulo: 'Canal dark · Ficção', ir: () => irPara('importar') },
    { rotulo: fonte.nome, ir: () => irPara('cortes') },
    ...(corte ? [{ rotulo: cortes[st.corte].titulo }] : []),
  ]
}
