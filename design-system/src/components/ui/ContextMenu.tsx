import { ContextMenu as C } from '@base-ui/react/context-menu'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Kbd } from './Kbd'
import { itemBase, popupBase, zDropdown } from './camada'

export function MenuContexto({
  children,
  itens,
}: {
  children: ReactNode
  itens: {
    id: string
    rotulo: string
    atalho?: string
    executar: () => void
    perigo?: boolean
    desabilitado?: boolean
  }[]
}) {
  return (
    <C.Root>
      <C.Trigger
        tabIndex={0}
        role="group"
        aria-label="Opções do item"
        className="foco block rounded-md"
        onKeyDown={(e) => {
          if (e.key === 'F10' && e.shiftKey) {
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            e.currentTarget.dispatchEvent(
              new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 10, clientY: r.top + 10, button: 2 }),
            )
          }
        }}
      >
        {children}
      </C.Trigger>
      <C.Portal>
        <C.Positioner style={zDropdown}>
          <C.Popup className={cn(popupBase, 'min-w-52 p-1')}>
            {itens.map((i) => (
              <C.Item
                key={i.id}
                disabled={i.desabilitado}
                onClick={i.executar}
                className={cn(
                  itemBase,
                  i.perigo && 'text-danger data-highlighted:bg-danger-subtle data-highlighted:text-danger',
                )}
              >
                <span className="flex-1">{i.rotulo}</span>
                {i.atalho && <Kbd atalho={i.atalho} />}
              </C.Item>
            ))}
          </C.Popup>
        </C.Positioner>
      </C.Portal>
    </C.Root>
  )
}
