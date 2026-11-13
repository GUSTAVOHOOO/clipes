// Layout de toda tela do app: barra superior quieta + conteúdo. Sem scroll de página no editor;
// telas de lista rolam só a coluna de conteúdo.
//
//   <Tela titulo="Cortes" meio={…} direita={<Button variante="primario">…</Button>}>…</Tela>
//
// A barra: marca + Projeto à esquerda, as etapas do Projeto como texto, o contexto da tela no meio,
// paleta e a ação principal da tela à direita. Uma ação primária por tela, no máximo.
import { Check, ChevronDown, FolderOpen, Plus, Settings } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { projetos } from '@/data/dados'
import { useApp } from '@/lib/app'
import { cn } from '@/lib/cn'
import { useRota, ir } from '@/lib/rota'
import { IconButton } from '@/components/ui/Button'
import { Menu, MenuItem, MenuSeparador, MenuGrupo } from '@/components/ui/Menu'
import { Tip } from '@/components/ui/Tooltip'
import { GatilhoPaleta } from './Paleta'

export const ETAPAS = [
  { caminho: '/fontes', nome: 'Fontes' },
  { caminho: '/cortes', nome: 'Cortes' },
  { caminho: '/exportar', nome: 'Exportar' },
] as const

type Props = {
  /** título do documento (aba do navegador / janela) */
  titulo: string
  meio?: ReactNode
  direita?: ReactNode
  children: ReactNode
  className?: string
}

export function Tela({ titulo, meio, direita, children, className }: Props) {
  useEffect(() => {
    document.title = `${titulo} · Clipes`
  }, [titulo])
  return (
    <div className="flex h-full flex-col bg-canvas text-fg">
      <BarraSuperior meio={meio} direita={direita} />
      <main className={cn('relative min-h-0 flex-1', className)}>{children}</main>
    </div>
  )
}

function BarraSuperior({ meio, direita }: { meio?: ReactNode; direita?: ReactNode }) {
  const { caminho } = useRota()
  const ativo = (c: string) => caminho === c || (c === '/cortes' && caminho.startsWith('/corte/'))
  return (
    <header className="flex h-(--topbar-h) shrink-0 items-center gap-3 border-b border-line bg-canvas px-3">
      <SeletorProjeto />
      <nav aria-label="Etapas" className="flex h-full items-center gap-0.5">
        {ETAPAS.map(e => (
          <a
            key={e.caminho}
            href={'#' + e.caminho}
            aria-current={ativo(e.caminho) ? 'page' : undefined}
            className={cn(
              'foco flex h-7 items-center rounded-md px-2 text-sm transition-colors duration-(--dur-fast)',
              ativo(e.caminho) ? 'bg-field text-fg' : 'text-fg-3 hover:text-fg-2',
            )}
          >
            {e.nome}
          </a>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 items-center pl-2">{meio}</div>
      <div className="flex shrink-0 items-center gap-2">
        <GatilhoPaleta />
        <Tip rotulo="Configurações" atalho="Ctrl+,">
          <IconButton rotulo="Configurações" tamanho="sm" onClick={() => ir('/config/provedor')} ativo={caminho.startsWith('/config')}>
            <Settings size={15} strokeWidth={1.75} />
          </IconButton>
        </Tip>
        {direita}
      </div>
    </header>
  )
}

function SeletorProjeto() {
  const { projeto, setProjeto } = useApp()
  return (
    <Menu
      gatilho={
        <button
          type="button"
          className="foco -ml-1 flex h-7 max-w-[220px] items-center gap-2 rounded-md px-1.5 text-sm hover:bg-hover"
          aria-label={`Projeto: ${projeto.nome}. Trocar de Projeto`}
        >
          <span className="font-semibold tracking-[-0.01em]">Clipes</span>
          <span className="text-fg-3" aria-hidden>
            /
          </span>
          <span className="truncate text-fg-2">{projeto.nome}</span>
          <ChevronDown size={13} className="shrink-0 text-fg-3" />
        </button>
      }
    >
      <MenuGrupo titulo="Projetos">
        {projetos.map(p => (
          <MenuItem key={p.id} onSelect={() => setProjeto(p.id)} icone={p.id === projeto.id ? <Check size={14} /> : undefined}>
            {p.nome}
          </MenuItem>
        ))}
      </MenuGrupo>
      <MenuSeparador />
      <MenuItem icone={<Plus size={14} />}>Novo Projeto…</MenuItem>
      <MenuItem icone={<FolderOpen size={14} />}>Abrir pasta de Projeto…</MenuItem>
    </Menu>
  )
}

/** Cabeçalho de página para telas de lista e configuração (não para o editor). */
export function CabecalhoPagina({ titulo, descricao, acoes }: { titulo: ReactNode; descricao?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-6">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-[-0.015em]">{titulo}</h1>
        {descricao && <p className="mt-1 max-w-[68ch] text-sm text-fg-2">{descricao}</p>}
      </div>
      {acoes && <div className="flex shrink-0 items-center gap-3">{acoes}</div>}
    </div>
  )
}
