// Botões. O primário é o texto invertido (claro no escuro, escuro no claro); o âmbar não entra em botão.
// Uma tela tem no máximo um primário. Ícones Lucide a 14–16 px, traço 1,75.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Kbd } from './Kbd'
import { Spinner } from './Spinner'

export type Variante = 'primario' | 'secundario' | 'fantasma' | 'perigo'
export type Tamanho = 'sm' | 'md' | 'lg'

const VARIANTE: Record<Variante, string> = {
  primario: 'bg-primary text-primary-fg font-medium hover:bg-primary-hover active:bg-primary-hover',
  secundario: 'bg-field text-fg border border-line-strong hover:bg-hover active:bg-selected',
  fantasma: 'text-fg-2 hover:text-fg hover:bg-hover active:bg-selected',
  perigo: 'bg-danger-subtle text-danger border border-danger/40 hover:bg-danger/20 font-medium',
}
const TAMANHO: Record<Tamanho, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-8 px-3 text-sm gap-2',
  lg: 'h-9 px-3.5 text-sm gap-2',
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: Variante
  tamanho?: Tamanho
  /** ícone à esquerda */
  icone?: ReactNode
  /** atalho mostrado à direita em <Kbd> (só exibe; o atalho é registrado em useComandos) */
  atalho?: string
  carregando?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variante = 'secundario', tamanho = 'md', icone, atalho, carregando, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      className={cn(
        'foco inline-flex shrink-0 items-center justify-center rounded-md whitespace-nowrap select-none',
        'transition-[background-color,color,border-color,box-shadow] duration-(--dur-fast) ease-out',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTE[variante],
        TAMANHO[tamanho],
        atalho && 'pr-1.5',
        className,
      )}
      {...rest}
    >
      {carregando ? <Spinner /> : icone}
      {children}
      {atalho && <Kbd atalho={atalho} tom={variante === 'primario' ? 'sobre-primario' : 'padrao'} className="ml-0.5" />}
    </button>
  )
})

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** nome acessível obrigatório: vira aria-label e a dica */
  rotulo: string
  tamanho?: Tamanho
  variante?: 'fantasma' | 'secundario'
  ativo?: boolean
}

/** Botão só com ícone. Sempre com rótulo; para mostrar a tecla, envolva em <Tip atalho>. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { rotulo, tamanho = 'md', variante = 'fantasma', ativo, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={rotulo}
      className={cn(
        'foco inline-grid shrink-0 place-items-center rounded-md transition-colors duration-(--dur-fast)',
        'disabled:pointer-events-none disabled:opacity-45',
        { sm: 'size-7', md: 'size-8', lg: 'size-9' }[tamanho],
        variante === 'secundario' ? 'border border-line-strong bg-field' : '',
        ativo ? 'bg-selected text-fg' : 'text-fg-3 hover:bg-hover hover:text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})
