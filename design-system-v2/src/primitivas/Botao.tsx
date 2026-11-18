// Botão e Kbd. Um único primário (sinal) por tela; o resto é secundário (degrau elevado) ou fantasma.
import { Loader2 } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Dica } from './Flutuantes'

export type VarianteBotao = 'primario' | 'secundario' | 'suave' | 'fantasma' | 'perigo'
export type TamanhoBotao = 'p' | 'm' | 'g'

const base =
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-controle border-0 whitespace-nowrap select-none ' +
  'transition-[background-color,color,filter,box-shadow] duration-(--dur-base) ease-saida ' +
  'disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40 ' +
  '[&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:stroke-[1.75]'

const variantes: Record<VarianteBotao, string> = {
  primario: 'bg-sinal font-forte text-no-sinal hover:brightness-108 active:brightness-95',
  secundario: 'bg-elevado text-t1 shadow-[inset_0_0_0_1px_var(--contorno-controle)] hover:bg-hover',
  fantasma: 'bg-transparent text-t2 hover:bg-hover hover:text-t1 aria-expanded:bg-hover aria-expanded:text-t1 aria-pressed:text-t1',
  perigo: 'bg-elevado text-erro shadow-[inset_0_0_0_1px_var(--contorno-controle)] hover:bg-hover',
  // suave: um degrau só (área), para ações repetidas em linhas e sobre o chão
  suave: 'bg-area text-t2 shadow-[inset_0_0_0_1px_var(--contorno-controle)] hover:bg-hover hover:text-t1',
}

const tamanhos: Record<TamanhoBotao, string> = {
  p: 'h-6 px-2 text-pequeno',
  m: 'h-7 px-2.5 text-base',
  g: 'h-9 px-3 text-base',
}

export type BotaoProps = ComponentProps<'button'> & {
  variante?: VarianteBotao
  tamanho?: TamanhoBotao
  /** mostra o giro e bloqueia o clique, mantendo a largura */
  carregando?: boolean
  icone?: ReactNode
  /** atalho exibido à direita do rótulo */
  atalho?: string
}

export function Botao({
  variante = 'fantasma',
  tamanho = 'm',
  carregando,
  icone,
  atalho,
  className,
  children,
  disabled,
  type = 'button',
  ...resto
}: BotaoProps) {
  return (
    <button
      type={type}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      className={cn(base, variantes[variante], tamanhos[tamanho], carregando && 'disabled:opacity-70', className)}
      {...resto}
    >
      {carregando ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : icone}
      {children}
      {atalho && (
        <Kbd tom={variante === 'primario' ? 'sinal' : variante === 'fantasma' || variante === 'suave' ? 'normal' : 'forte'}>{atalho}</Kbd>
      )}
    </button>
  )
}

export type BotaoIconeProps = Omit<BotaoProps, 'children' | 'icone' | 'atalho'> & {
  /** nome acessível e texto da dica */
  rotulo: string
  /** atalho mostrado na dica */
  atalho?: string
  children: ReactNode
  semDica?: boolean
}

/** Botão só de ícone: quadrado, alvo ≥ 24 px, com dica (nome + atalho). */
export function BotaoIcone({ rotulo, atalho, tamanho = 'm', className, children, semDica, ...resto }: BotaoIconeProps) {
  const botao = (
    <Botao
      aria-label={rotulo}
      tamanho={tamanho}
      className={cn('px-0', tamanho === 'p' ? 'w-6' : tamanho === 'g' ? 'w-9' : 'w-7', className)}
      {...resto}
    >
      {children}
    </Botao>
  )
  if (semDica) return botao
  return (
    <Dica texto={rotulo} atalho={atalho}>
      {botao}
    </Dica>
  )
}

/** Tecla ou combinação. `tom` acompanha o fundo: normal (sobre chão/área), forte (sobre elevado), sinal. */
export function Kbd({
  children,
  tom = 'normal',
  className,
}: {
  children: ReactNode
  tom?: 'normal' | 'forte' | 'sinal'
  className?: string
}) {
  return (
    <kbd
      className={cn(
        'num inline-flex h-[18px] items-center rounded-mini px-[5px] text-micro leading-none font-medio',
        tom === 'sinal' ? 'bg-preto/18 text-no-sinal' : tom === 'forte' ? 'bg-hover text-t3' : 'bg-elevado text-t3',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
