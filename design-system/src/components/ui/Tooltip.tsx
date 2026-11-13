// Dica: nome da ação e a tecla. Aparece no hover e no foco do teclado, nunca carrega informação única.
import { Tooltip as T } from '@base-ui/react/tooltip'
import type { ReactElement, ReactNode } from 'react'
import { Kbd } from './Kbd'

export const TipProvider = ({ children }: { children: ReactNode }) => (
  <T.Provider delay={450} closeDelay={0}>
    {children}
  </T.Provider>
)

type Props = {
  rotulo: ReactNode
  atalho?: string
  /** o gatilho: um único elemento focável (Button, IconButton…) */
  children: ReactElement
  lado?: 'top' | 'bottom' | 'left' | 'right'
}

export function Tip({ rotulo, atalho, children, lado = 'top' }: Props) {
  return (
    <T.Root>
      <T.Trigger render={children} />
      <T.Portal>
        <T.Positioner side={lado} sideOffset={6} style={{ zIndex: 'var(--z-tooltip)' }}>
          <T.Popup
            className="flex origin-(--transform-origin) items-center gap-2 rounded-md border border-line-strong bg-raised px-2 py-1 text-xs text-fg shadow-popover transition-[opacity,scale] duration-(--dur-fast) ease-out data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0 data-instant:transition-none"
          >
            {rotulo}
            {atalho && <Kbd atalho={atalho} />}
          </T.Popup>
        </T.Positioner>
      </T.Portal>
    </T.Root>
  )
}
