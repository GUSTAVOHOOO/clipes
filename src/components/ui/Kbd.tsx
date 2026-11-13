// Tecla visível. Aceita um atalho ('Ctrl+Shift+ArrowLeft') ou rótulos prontos (['[', ']']).
import { teclasDe } from '@/lib/comandos'
import { cn } from '@/lib/cn'

type Props = {
  /** atalho no formato do registro de comandos */
  atalho?: string
  /** ou rótulos soltos, cada um vira uma tecla */
  teclas?: string[]
  /** 'sobre-primario' quando a tecla fica dentro do botão primário (cor invertida) */
  tom?: 'padrao' | 'sobre-primario'
  className?: string
}

export function Kbd({ atalho, teclas, tom = 'padrao', className }: Props) {
  const ks = teclas ?? (atalho ? teclasDe(atalho) : [])
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-[3px]', className)} aria-hidden>
      {ks.map((k, i) => (
        <kbd
          key={i}
          className={cn(
            'inline-grid h-[18px] min-w-[18px] place-items-center rounded-sm border px-[4px] font-mono text-[10.5px] leading-none font-medium tabular-nums',
            tom === 'padrao' ? 'border-line-strong bg-field text-fg-2' : 'border-current/30 bg-transparent text-current opacity-75',
          )}
        >
          {k}
        </kbd>
      ))}
    </span>
  )
}
