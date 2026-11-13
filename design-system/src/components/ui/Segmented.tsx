// Segmentado: escolha única entre 2 a 5 opções curtas (P/M/G, 0,3 s/0,5 s/1 s). Setas trocam.
import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Props<V extends string | number> = {
  valor: V
  onChange: (v: V) => void
  opcoes: { valor: V; rotulo: ReactNode; titulo?: string }[]
  rotulo: string
  tamanho?: 'sm' | 'md'
  largo?: boolean
  className?: string
}

export function Segmented<V extends string | number>({ valor, onChange, opcoes, rotulo, tamanho = 'sm', largo, className }: Props<V>) {
  return (
    <ToggleGroup
      value={[String(valor)]}
      onValueChange={v => {
        // clicar no que já está marcado não desmarca: sempre há uma escolha
        const o = opcoes.find(o => String(o.valor) === v[0])
        if (o) onChange(o.valor)
      }}
      aria-label={rotulo}
      className={cn('inline-flex rounded-md border border-line bg-canvas p-0.5', largo && 'flex w-full', className)}
    >
      {opcoes.map(o => (
        <Toggle
          key={String(o.valor)}
          value={String(o.valor)}
          title={o.titulo}
          className={cn(
            'foco rounded-[5px] px-2.5 whitespace-nowrap tabular-nums text-fg-3 transition-colors duration-(--dur-fast) select-none',
            'hover:text-fg-2 data-pressed:bg-selected data-pressed:text-fg',
            tamanho === 'sm' ? 'h-6 text-xs' : 'h-7 text-sm',
            largo && 'flex-1',
          )}
        >
          {o.rotulo}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
