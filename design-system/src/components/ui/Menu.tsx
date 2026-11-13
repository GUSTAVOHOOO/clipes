// Menu suspenso. Cada item pode mostrar a tecla do mesmo comando registrado em useComandos.
import { Menu as M } from '@base-ui/react/menu'
import { Check, ChevronRight } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { itemBase, popupBase, zDropdown } from './camada'
import { Kbd } from './Kbd'

type MenuProps = {
  gatilho: ReactElement
  children: ReactNode
  lado?: 'top' | 'bottom' | 'left' | 'right'
  alinhar?: 'start' | 'center' | 'end'
  className?: string
}

export function Menu({ gatilho, children, lado = 'bottom', alinhar = 'start', className }: MenuProps) {
  return (
    <M.Root>
      <M.Trigger render={gatilho} />
      <M.Portal>
        <M.Positioner side={lado} align={alinhar} sideOffset={6} style={zDropdown}>
          <M.Popup className={cn(popupBase, 'min-w-52 p-1', className)}>{children}</M.Popup>
        </M.Positioner>
      </M.Portal>
    </M.Root>
  )
}

type ItemProps = {
  children: ReactNode
  icone?: ReactNode
  atalho?: string
  onSelect?: () => void
  desabilitado?: boolean
  perigo?: boolean
}

export function MenuItem({ children, icone, atalho, onSelect, desabilitado, perigo }: ItemProps) {
  return (
    <M.Item
      onClick={onSelect}
      disabled={desabilitado}
      className={cn(itemBase, perigo && 'text-danger data-highlighted:bg-danger-subtle data-highlighted:text-danger')}
    >
      {icone && <span className="grid w-4 place-items-center text-fg-3 [[data-highlighted]_&]:text-current">{icone}</span>}
      <span className="flex-1 truncate">{children}</span>
      {atalho && <Kbd atalho={atalho} />}
    </M.Item>
  )
}

export function MenuCheck({ children, marcado, onChange }: { children: ReactNode; marcado: boolean; onChange: (v: boolean) => void }) {
  return (
    <M.CheckboxItem checked={marcado} onCheckedChange={onChange} closeOnClick={false} className={itemBase}>
      <span className="grid w-4 place-items-center">
        <M.CheckboxItemIndicator>
          <Check size={14} />
        </M.CheckboxItemIndicator>
      </span>
      <span className="flex-1 truncate">{children}</span>
    </M.CheckboxItem>
  )
}

export const MenuSeparador = () => <M.Separator className="mx-1 my-1 h-px bg-line" />

export function MenuGrupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <M.Group>
      <M.GroupLabel className="px-2 pt-2 pb-1 text-2xs text-fg-3">{titulo}</M.GroupLabel>
      {children}
    </M.Group>
  )
}

/** Submenu (ex.: "Mover para o Projeto ›"). */
export function Submenu({ titulo, icone, children }: { titulo: ReactNode; icone?: ReactNode; children: ReactNode }) {
  return (
    <M.SubmenuRoot>
      <M.SubmenuTrigger className={cn(itemBase, 'data-popup-open:bg-selected data-popup-open:text-fg')}>
        {icone && <span className="grid w-4 place-items-center text-fg-3">{icone}</span>}
        <span className="flex-1 truncate">{titulo}</span>
        <ChevronRight size={14} className="text-fg-3" />
      </M.SubmenuTrigger>
      <M.Portal>
        <M.Positioner sideOffset={4} alignOffset={-4} style={zDropdown}>
          <M.Popup className={cn(popupBase, 'min-w-48 p-1')}>{children}</M.Popup>
        </M.Positioner>
      </M.Portal>
    </M.SubmenuRoot>
  )
}
