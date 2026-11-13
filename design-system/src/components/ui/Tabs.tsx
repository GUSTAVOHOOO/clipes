// Abas: troca de vista dentro do mesmo contexto (ferramentas da gaveta, seções do Empacotamento).
// Setas movem entre as abas (roving focus do Base UI).
import { Tabs as T } from '@base-ui/react/tabs'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Kbd } from './Kbd'

export type Aba<V extends string> = { valor: V; rotulo: ReactNode; atalho?: string; icone?: ReactNode; desabilitada?: boolean }

type Props<V extends string> = {
  valor: V
  onChange: (v: V) => void
  abas: Aba<V>[]
  rotulo: string
  className?: string
  /** 'sublinhado' para seções de página; 'pilula' para barras compactas (gaveta) */
  estilo?: 'sublinhado' | 'pilula'
}

export function Abas<V extends string>({ valor, onChange, abas, rotulo, className, estilo = 'pilula' }: Props<V>) {
  return (
    <T.Root value={valor} onValueChange={v => onChange(v as V)}>
      <T.List
        aria-label={rotulo}
        className={cn('relative flex items-center', estilo === 'pilula' ? 'gap-0.5' : 'gap-5 border-b border-line', className)}
      >
        {abas.map(a => (
          <T.Tab
            key={a.valor}
            value={a.valor}
            disabled={a.desabilitada}
            className={cn(
              'foco relative z-1 flex items-center gap-1.5 text-sm whitespace-nowrap text-fg-3 transition-colors duration-(--dur-fast) select-none',
              'hover:text-fg-2 data-active:text-fg data-disabled:text-fg-disabled',
              estilo === 'pilula' ? 'h-8 rounded-md px-2' : 'h-9 px-0.5',
            )}
          >
            {a.icone}
            {a.rotulo}
            {a.atalho && <Kbd atalho={a.atalho} />}
          </T.Tab>
        ))}
        <T.Indicator
          className={cn(
            'absolute left-0 translate-x-(--active-tab-left) transition-[translate,width] duration-(--dur-base) ease-out',
            estilo === 'pilula'
              ? 'top-1/2 z-0 h-8 w-(--active-tab-width) -translate-y-1/2 rounded-md bg-selected'
              : '-bottom-px h-0.5 w-(--active-tab-width) bg-fg',
          )}
        />
      </T.List>
    </T.Root>
  )
}
