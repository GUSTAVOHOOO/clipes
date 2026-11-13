// Campos de texto. Rótulo sempre visível (placeholder não é rótulo). Erro em texto + ícone, abaixo do campo.
import { Field as F } from '@base-ui/react/field'
import { CircleAlert } from 'lucide-react'
import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/** Aparência da caixa, compartilhada por input, textarea, select e campo numérico. */
export const caixa =
  'rounded-md border border-line-strong bg-field text-fg placeholder:text-fg-3 ' +
  'transition-[border-color,box-shadow] duration-(--dur-fast) hover:border-control-border ' +
  'focus-within:border-focus focus-within:shadow-[0_0_0_1px_var(--focus-ring)] ' +
  'has-[[aria-invalid=true]]:border-danger has-[[data-invalid]]:border-danger ' +
  'has-disabled:pointer-events-none has-disabled:opacity-45'

type CampoProps = {
  rotulo?: ReactNode
  descricao?: ReactNode
  erro?: ReactNode
  children: ReactNode
  className?: string
  /** rótulo à esquerda, na mesma linha (formulários de configuração) */
  emLinha?: boolean
}

/** Envolve um controle com rótulo, descrição e erro, ligados por id (Base UI Field). */
export function Campo({ rotulo, descricao, erro, children, className, emLinha }: CampoProps) {
  return (
    <F.Root invalid={!!erro} className={cn(emLinha ? 'grid grid-cols-[minmax(140px,200px)_1fr] items-start gap-x-6 gap-y-1' : 'flex flex-col gap-1.5', className)}>
      {rotulo && <F.Label className={cn('text-xs font-medium text-fg-2', emLinha && 'pt-2')}>{rotulo}</F.Label>}
      <div className="flex min-w-0 flex-col gap-1.5">
        {children}
        {descricao && !erro && <F.Description className="text-xs text-fg-3">{descricao}</F.Description>}
        {erro && (
          <F.Error match className="flex items-start gap-1.5 text-xs text-danger">
            <CircleAlert size={13} className="mt-px shrink-0" />
            <span>{erro}</span>
          </F.Error>
        )}
      </div>
    </F.Root>
  )
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** ícone ou texto antes do valor */
  prefixo?: ReactNode
  /** botão, unidade ou <Kbd> depois do valor */
  sufixo?: ReactNode
  tamanho?: 'sm' | 'md' | 'lg'
  /** valor em fonte mono (timecode, chave, caminho) */
  mono?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { prefixo, sufixo, tamanho = 'md', mono, className, ...rest },
  ref,
) {
  return (
    <div className={cn(caixa, 'flex items-center gap-2 px-2.5', { sm: 'h-7', md: 'h-8', lg: 'h-10' }[tamanho], className)}>
      {prefixo && <span className="flex shrink-0 items-center text-fg-3">{prefixo}</span>}
      <F.Control
        ref={ref}
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-3',
          tamanho === 'lg' ? 'text-md' : 'text-sm',
          mono && 'timecode',
        )}
        {...rest}
      />
      {sufixo && <span className="flex shrink-0 items-center gap-1 text-fg-3">{sufixo}</span>}
    </div>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(caixa, 'min-h-20 w-full resize-y px-2.5 py-2 text-sm leading-[var(--leading-prose)] outline-none', className)}
      {...rest}
    />
  )
})
