// Classes comuns das camadas flutuantes (menu, popover, select, dica). Entram e saem com escala + opacidade curtas.
export const popupBase =
  'origin-(--transform-origin) rounded-lg border border-line-strong bg-raised text-fg shadow-popover outline-none ' +
  'transition-[opacity,scale] duration-(--dur-fast) ease-out ' +
  'data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-ending-style:scale-[0.98] data-ending-style:opacity-0'

export const itemBase =
  'flex h-8 cursor-default items-center gap-2.5 rounded-md px-2 text-sm text-fg-2 outline-none select-none ' +
  'data-highlighted:bg-selected data-highlighted:text-fg data-disabled:pointer-events-none data-disabled:text-fg-disabled'

export const zDropdown = { zIndex: 'var(--z-dropdown)' } as const
