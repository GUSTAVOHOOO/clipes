import { useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/cn'

/** Lista longa de seleção única: uma parada Tab, setas/Home/End movem o foco virtual. */
export function ListaVirtual<T>({
  itens,
  chave,
  render,
  rotulo,
  altura = 280,
  alturaLinha = 44,
  onSelecionar,
}: {
  itens: T[]
  chave: (item: T) => string
  render: (item: T, ativo: boolean) => ReactNode
  rotulo: string
  altura?: number
  alturaLinha?: number
  onSelecionar?: (item: T) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [ativo, setAtivo] = useState(0)
  const v = useVirtualizer({
    count: itens.length,
    getScrollElement: () => ref.current,
    estimateSize: () => alturaLinha,
    overscan: 3,
  })
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={rotulo}
      tabIndex={0}
      aria-activedescendant={itens[ativo] ? `virtual-${chave(itens[ativo])}` : undefined}
      className="foco overflow-auto rounded-md border border-line bg-surface"
      style={{ height: altura }}
      onKeyDown={(e) => {
        let indice = ativo
        if (e.key === 'ArrowDown') indice++
        else if (e.key === 'ArrowUp') indice--
        else if (e.key === 'Home') indice = 0
        else if (e.key === 'End') indice = itens.length - 1
        else if (e.key === 'Enter' && itens[ativo]) {
          e.preventDefault()
          onSelecionar?.(itens[ativo])
          return
        } else return
        e.preventDefault()
        indice = Math.max(0, Math.min(itens.length - 1, indice))
        setAtivo(indice)
        v.scrollToIndex(indice)
      }}
    >
      <div className="relative w-full" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((row) => (
          <div
            key={row.key}
            id={`virtual-${chave(itens[row.index])}`}
            role="option"
            aria-selected={ativo === row.index}
            aria-posinset={row.index + 1}
            aria-setsize={itens.length}
            onClick={() => {
              setAtivo(row.index)
              ref.current?.focus()
              onSelecionar?.(itens[row.index])
            }}
            className={cn(
              'absolute top-0 left-0 flex w-full items-center border-b border-line px-3 text-sm',
              ativo === row.index && 'bg-selected',
            )}
            style={{ height: row.size, transform: `translateY(${row.start}px)` }}
          >
            {render(itens[row.index], ativo === row.index)}
          </div>
        ))}
      </div>
    </div>
  )
}
