// Gavetas de borda do Foco. A tela abre só com o essencial; o resto chega pela borda:
//   - mouse perto da borda (faixa de 16 px ou o puxador) abre em modo "perto" e fecha sozinha ao sair;
//   - tecla ou clique no puxador abre em modo "fixa", leva o foco para dentro e fica até Esc, a mesma tecla
//     ou voltar a editar (clicar no palco ou na timeline).
// A gaveta flutua sobre o palco: não empurra o preview nem muda o layout.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Kbd } from '@/components/ui/Kbd'

export type EstadoGaveta = null | 'perto' | 'fixa'
export type Lado = 'esq' | 'dir'

/** Máquina de estados de uma gaveta. `alternar` é o que a tecla chama. */
export function useGaveta(inicial: EstadoGaveta = null) {
  const [estado, setEstado] = useState<EstadoGaveta>(inicial)
  const timer = useRef(0)
  const perto = useCallback(() => {
    clearTimeout(timer.current)
    setEstado(v => v ?? 'perto')
  }, [])
  const longe = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setEstado(v => (v === 'perto' ? null : v)), 280)
  }, [])
  const fixar = useCallback(() => {
    clearTimeout(timer.current)
    setEstado('fixa')
  }, [])
  const fechar = useCallback(() => {
    clearTimeout(timer.current)
    setEstado(null)
  }, [])
  const alternar = useCallback(() => {
    clearTimeout(timer.current)
    setEstado(v => (v === 'fixa' ? null : 'fixa'))
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return { estado, aberta: estado !== null, perto, longe, fixar, fechar, alternar }
}
export type Gaveta = ReturnType<typeof useGaveta>

type Props = {
  lado: Lado
  g: Gaveta
  /** nome acessível da região */
  rotulo: string
  largura?: number
  children: ReactNode
  className?: string
}

/** O painel flutuante. Fechado, fica `inert` (fora do Tab e do leitor de tela). */
export function GavetaBorda({ lado, g, rotulo, largura = lado === 'esq' ? 300 : 400, children, className }: Props) {
  const ref = useRef<HTMLElement>(null)
  const voltar = useRef<HTMLElement | null>(null)

  // Aberta por tecla: leva o foco para o primeiro controle marcado como data-foco-inicial (ou o primeiro focável).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (g.estado === 'fixa') {
      if (!el.contains(document.activeElement)) voltar.current = document.activeElement as HTMLElement | null
      const alvo =
        el.querySelector<HTMLElement>('[data-foco-inicial]') ??
        el.querySelector<HTMLElement>('button:not([disabled]),[href],input,[tabindex]:not([tabindex="-1"])')
      requestAnimationFrame(() => alvo?.focus({ preventScroll: true }))
    } else if (g.estado === null && el.contains(document.activeElement)) {
      const v = voltar.current
      if (v && document.contains(v)) v.focus({ preventScroll: true })
      else (document.activeElement as HTMLElement | null)?.blur()
    }
  }, [g.estado])

  return (
    <aside
      ref={ref}
      aria-label={rotulo}
      data-lado={lado}
      data-aberta={g.aberta}
      inert={!g.aberta}
      onMouseEnter={g.perto}
      onMouseLeave={g.longe}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          g.fechar()
        }
      }}
      style={{ width: largura, zIndex: 'var(--z-drawer)' }}
      className={cn(
        'absolute top-3 bottom-3 flex flex-col overflow-hidden rounded-xl border border-line-strong bg-surface shadow-overlay',
        'transition-[translate,opacity] duration-(--dur-slow) ease-out motion-reduce:transition-opacity',
        lado === 'esq' ? 'left-3' : 'right-3',
        !g.aberta && (lado === 'esq' ? '-translate-x-[calc(100%+16px)] opacity-0' : 'translate-x-[calc(100%+16px)] opacity-0'),
        !g.aberta && 'motion-reduce:translate-x-0',
        className,
      )}
    >
      {children}
    </aside>
  )
}

/** Faixa invisível de 16 px na borda: chegar com o mouse abre a gaveta em modo "perto". */
export function ZonaBorda({ lado, g }: { lado: Lado; g: Gaveta }) {
  return (
    <div
      aria-hidden
      onMouseEnter={g.perto}
      onMouseLeave={g.longe}
      className={cn('absolute inset-y-0 w-4', lado === 'esq' ? 'left-0' : 'right-0')}
      style={{ zIndex: 'var(--z-edge)' }}
    />
  )
}

export type ItemPuxador = { id: string; rotulo: string; icone: ReactNode; atalho: string; onClick: () => void }

/** Puxador na borda, no meio da altura: ícone + tecla de cada coisa que a gaveta guarda. Some com a gaveta aberta. */
export function Puxador({ lado, g, itens }: { lado: Lado; g: Gaveta; itens: ItemPuxador[] }) {
  return (
    <div
      onMouseEnter={g.perto}
      onMouseLeave={g.longe}
      data-oculto={g.aberta}
      className={cn(
        'absolute top-1/2 flex -translate-y-1/2 flex-col border border-line bg-surface py-1 transition-opacity duration-(--dur-base) ease-out',
        'data-[oculto=true]:pointer-events-none data-[oculto=true]:opacity-0',
        lado === 'esq' ? 'left-0 rounded-r-lg border-l-0' : 'right-0 rounded-l-lg border-r-0',
      )}
      style={{ zIndex: 'var(--z-edge)' }}
    >
      {itens.map(i => (
        <button
          key={i.id}
          type="button"
          onClick={i.onClick}
          aria-label={`${i.rotulo} (${i.atalho})`}
          title={`${i.rotulo} (${i.atalho})`}
          className="foco flex w-9 flex-col items-center gap-1.5 rounded-md py-1.5 text-fg-3 transition-colors duration-(--dur-fast) hover:text-fg"
        >
          {i.icone}
          <Kbd atalho={i.atalho} />
        </button>
      ))}
    </div>
  )
}

/** Cabeçalho padrão de gaveta: título, contagem, ações e fechar. */
export function CabecalhoGaveta({ children, acoes }: { children: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      {acoes}
    </div>
  )
}
