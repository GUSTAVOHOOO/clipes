// Popover: conteúdo pequeno e interativo preso a um gatilho (escolher Projeto, detalhes da Permissão).
import { Popover as P } from '@base-ui/react/popover'
import type { ReactElement, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { popupBase, zDropdown } from './camada'

type Props = {
  gatilho: ReactElement
  children: ReactNode
  titulo?: string
  lado?: 'top' | 'bottom' | 'left' | 'right'
  alinhar?: 'start' | 'center' | 'end'
  aberto?: boolean
  onAbrir?: (v: boolean) => void
  className?: string
}

export function Popover({ gatilho, children, titulo, lado = 'bottom', alinhar = 'start', aberto, onAbrir, className }: Props) {
  return (
    <P.Root open={aberto} onOpenChange={v => onAbrir?.(v)}>
      <P.Trigger render={gatilho} />
      <P.Portal>
        <P.Positioner side={lado} align={alinhar} sideOffset={6} style={zDropdown}>
          <P.Popup className={cn(popupBase, 'w-80 p-4', className)}>
            {titulo && <P.Title className="mb-2 text-sm font-medium">{titulo}</P.Title>}
            {children}
          </P.Popup>
        </P.Positioner>
      </P.Portal>
    </P.Root>
  )
}
