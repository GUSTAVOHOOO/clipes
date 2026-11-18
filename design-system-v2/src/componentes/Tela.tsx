// <Tela>: a moldura da janela. Barra superior (marca/SeletorProjeto, 3 etapas, Fila, Paleta),
// conteúdo que não rola por fora e BarraStatus fina. Sem caixas: só a linha de 1 px sob o topo.
import { Check, ChevronDown, FolderOpen, Layers, LogOut, Scissors, Search, Settings, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Kbd } from '@/primitivas/Botao'
import { Menu, MenuItem, MenuSeparador } from '@/primitivas/Flutuantes'
import { Status } from '@/primitivas/Indicadores'

export type Etapa = 'fontes' | 'cortes' | 'exportacao'

const rotulosEtapa: Record<Etapa, string> = { fontes: 'Fontes', cortes: 'Cortes', exportacao: 'Exportação' }

export interface TelaProps {
  titulo: string
  /** slot do sub-cabeçalho, ex.: <ContextoCorte> */
  meio?: ReactNode
  /** extras à direita do topo, antes da Fila */
  direita?: ReactNode
  /** false sem Projeto aberto */
  mostrarEtapas?: boolean
  /** true no assistente: só a marca */
  modoMinimo?: boolean
  projeto?: { nome: string; outros?: string[] } | null
  etapa?: Etapa
  /** contadores discretos por etapa (Fontes transcritas, Cortes aprovados) */
  contadores?: Partial<Record<Etapa, string>>
  aoIrEtapa?: (e: Etapa) => void
  fila?: { ativos: number; resumo?: string } | null
  aoAbrirFila?: () => void
  aoAbrirPaleta?: () => void
  somenteLocal?: boolean
  /** barra de status: esquerda e direita */
  status?: { esquerda?: ReactNode; direita?: ReactNode }
  children: ReactNode
  className?: string
}

export function Tela({ titulo, meio, direita, mostrarEtapas = true, modoMinimo, projeto, etapa, contadores, aoIrEtapa, fila, aoAbrirFila, aoAbrirPaleta, somenteLocal, status, children, className }: TelaProps) {
  return (
    <div className={cn('flex h-full w-full min-w-0 flex-col overflow-hidden bg-chao', className)} aria-label={titulo}>
      <BarraSuperior>
        <Marca compacta={!!projeto && !modoMinimo} />
        {!modoMinimo && projeto && <SeletorProjeto nome={projeto.nome} outros={projeto.outros} />}
        {!modoMinimo && mostrarEtapas && projeto && <Etapas atual={etapa} contadores={contadores} aoIr={aoIrEtapa} />}
        {!modoMinimo && (
          <div className="ml-auto flex items-center gap-3">
            {somenteLocal && (
              <Status icone={<ShieldCheck className="size-[13px] stroke-[1.75]" aria-hidden />}>Somente local</Status>
            )}
            {direita}
            {fila !== undefined && <GatilhoFila fila={fila} aoAbrir={aoAbrirFila} />}
            <GatilhoPaleta aoAbrir={aoAbrirPaleta} />
          </div>
        )}
      </BarraSuperior>
      {meio}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {status && <BarraStatus esquerda={status.esquerda} direita={status.direita} />}
    </div>
  )
}

export function BarraSuperior({ children }: { children: ReactNode }) {
  return (
    <header className="flex h-(--altura-topo) shrink-0 items-center gap-5 border-b border-linha px-4">
      {children}
    </header>
  )
}

function Marca({ compacta }: { compacta?: boolean }) {
  return (
    <span className="flex items-center gap-2 font-forte text-t1">
      <Scissors className="size-4 stroke-[1.75] text-sinal" aria-hidden />
      <span className={cn(compacta && 'max-[1300px]:sr-only')}>Clipes</span>
    </span>
  )
}

export function SeletorProjeto({ nome, outros = [] }: { nome: string; outros?: string[] }) {
  return (
    <Menu
      gatilho={
        <button type="button" className="-ml-2 flex h-7 cursor-pointer items-center gap-1 rounded-controle border-0 bg-transparent px-2 text-t2 transition-colors duration-(--dur-rapida) hover:bg-area hover:text-t1 data-popup-open:bg-area">
          <span className="max-w-48 truncate">{nome}</span>
          <ChevronDown className="size-[15px] stroke-[1.75] text-t3" aria-hidden />
        </button>
      }
    >
      <MenuItem icone={<Check />}>{nome}</MenuItem>
      {outros.map((o) => (
        <MenuItem key={o} icone={<span />}>
          {o}
        </MenuItem>
      ))}
      <MenuSeparador />
      <MenuItem icone={<FolderOpen />}>Trocar Projeto…</MenuItem>
      <MenuItem icone={<Settings />}>Configurações do Projeto</MenuItem>
      <MenuItem icone={<LogOut />}>Fechar Projeto</MenuItem>
    </Menu>
  )
}

export function Etapas({ atual, contadores, aoIr }: { atual?: Etapa; contadores?: Partial<Record<Etapa, string>>; aoIr?: (e: Etapa) => void }) {
  const etapas: Etapa[] = ['fontes', 'cortes', 'exportacao']
  return (
    <nav aria-label="Etapas do Projeto" className="flex items-center gap-1">
      {etapas.map((e, i) => (
        <span key={e} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden className="text-t3 select-none">·</span>}
          <a
            href={`#${e}`}
            aria-current={atual === e ? 'page' : undefined}
            onClick={(ev) => {
              if (aoIr) {
                ev.preventDefault()
                aoIr(e)
              }
            }}
            className="flex h-7 items-center gap-1.5 rounded-controle px-2.5 text-t3 no-underline transition-colors duration-(--dur-rapida) hover:bg-area hover:text-t2 aria-[current=page]:text-t1"
          >
            {rotulosEtapa[e]}
            {contadores?.[e] && <span className="num text-pequeno text-t3">{contadores[e]}</span>}
          </a>
        </span>
      ))}
    </nav>
  )
}

export function GatilhoFila({ fila, aoAbrir }: { fila: { ativos: number; resumo?: string } | null; aoAbrir?: () => void }) {
  const ativos = fila?.ativos ?? 0
  return (
    <button type="button" onClick={aoAbrir} aria-label={`Fila de jobs: ${ativos} ativos (Ctrl+J)`}
      className="flex h-7 cursor-pointer items-center gap-1.5 rounded-controle border-0 bg-transparent px-2 text-pequeno text-t3 transition-colors duration-(--dur-rapida) hover:bg-area hover:text-t2"
    >
      <Layers className="size-[14px] stroke-[1.75]" aria-hidden />
      Fila <span className="num">{ativos}</span>
    </button>
  )
}

export function GatilhoPaleta({ aoAbrir }: { aoAbrir?: () => void }) {
  return (
    <button type="button" onClick={aoAbrir} aria-label="Abrir comandos (Ctrl+K)"
      className="flex h-7 min-w-44 cursor-pointer items-center gap-2 rounded-controle border-0 bg-area pr-1.5 pl-2.5 text-left text-t3 transition-colors duration-(--dur-rapida) hover:bg-hover hover:text-t2"
    >
      <Search className="size-[14px] stroke-[1.75]" aria-hidden />
      <span className="flex-1">Comandos</span>
      <Kbd>Ctrl K</Kbd>
    </button>
  )
}

/** Rodapé fino: salvamento e job à esquerda; dicas de atalho à direita. Anuncia mudanças com polidez. */
export function BarraStatus({ esquerda, direita }: { esquerda?: ReactNode; direita?: ReactNode }) {
  return (
    <footer className="flex h-(--altura-rodape) shrink-0 items-center justify-between gap-4 px-4 text-pequeno text-t3">
      <div role="status" aria-live="polite" className="flex min-w-0 items-center gap-4">
        {esquerda}
      </div>
      <div className="flex items-center gap-4">{direita}</div>
    </footer>
  )
}

/** Dica de atalho para a barra de status: "Ctrl [ transcrição". */
export function DicaAtalho({ tecla, children }: { tecla: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <Kbd>{tecla}</Kbd>
      {children}
    </span>
  )
}
