// Campos de texto: Campo (rótulo + ajuda + erro), Entrada, Busca, AreaTexto e Select.
// Campo é um degrau (elevado) sem borda; erro aparece como contorno discreto + mensagem com ícone.
import { Select as S } from '@base-ui/react/select'
import { AlertCircle, Check, ChevronsUpDown, Search } from 'lucide-react'
import { useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Kbd } from './Botao'
import { camadaBase, itemBase } from './Flutuantes'

export const caixaCampo =
  'w-full rounded-controle border-0 bg-elevado text-t1 shadow-[inset_0_0_0_1px_var(--contorno-campo)] outline-none transition-[background-color,box-shadow] duration-(--dur-base) ease-saida ' +
  'in-[.bg-elevado]:bg-chao hover:bg-hover in-[.bg-elevado]:hover:bg-hover focus-visible:bg-elevado in-[.bg-elevado]:focus-visible:bg-chao focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-0 focus-visible:outline-foco ' +
  'disabled:pointer-events-none disabled:opacity-40 aria-invalid:shadow-[inset_0_0_0_1px_var(--erro)]'

type CampoProps = {
  rotulo: string
  /** ajuda curta sob o campo */
  ajuda?: ReactNode
  /** mensagem de erro acionável: diz o problema e como resolver */
  erro?: string
  /** rótulo à direita (contador, unidade) */
  extra?: ReactNode
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode
  className?: string
}

/** Rótulo, controle, ajuda e erro ligados por id. */
export function Campo({ rotulo, ajuda, erro, extra, children, className }: CampoProps) {
  const id = useId()
  const desc = erro ? `${id}-erro` : ajuda ? `${id}-ajuda` : undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-pequeno text-t2">
          {rotulo}
        </label>
        {extra && <span className="num text-pequeno text-t3">{extra}</span>}
      </div>
      {children({ id, 'aria-describedby': desc, 'aria-invalid': erro ? true : undefined })}
      {erro ? (
        <p id={desc} className="flex items-start gap-1.5 text-pequeno text-erro">
          <AlertCircle className="mt-px size-[13px] shrink-0 stroke-[1.75]" aria-hidden />
          {erro}
        </p>
      ) : (
        ajuda && (
          <p id={desc} className="text-pequeno text-t3">
            {ajuda}
          </p>
        )
      )}
    </div>
  )
}

export function Entrada({ className, tamanho = 'm', ...resto }: ComponentProps<'input'> & { tamanho?: 'p' | 'm' }) {
  return (
    <input
      className={cn(caixaCampo, tamanho === 'p' ? 'h-6 px-2 text-pequeno' : 'h-7 px-2.5 text-pequeno', className)}
      {...resto}
    />
  )
}

type BuscaProps = Omit<ComponentProps<'input'>, 'type'> & { atalho?: string; rotulo: string }

/** Busca com lupa e atalho. `rotulo` é o nome acessível. */
export function Busca({ atalho, rotulo, className, ...resto }: BuscaProps) {
  return (
    <div className={cn('relative flex items-center', className)}>
      <Search className="pointer-events-none absolute left-2.5 size-[14px] stroke-[1.75] text-t3" aria-hidden />
      <input type="search" aria-label={rotulo} className={cn(caixaCampo, 'h-7 pr-2 pl-8 text-pequeno [&::-webkit-search-cancel-button]:hidden')} {...resto} />
      {atalho && (
        <Kbd tom="forte" className="pointer-events-none absolute right-1.5">
          {atalho}
        </Kbd>
      )}
    </div>
  )
}

export function AreaTexto({ className, ...resto }: ComponentProps<'textarea'>) {
  return <textarea className={cn(caixaCampo, 'min-h-20 resize-y px-2.5 py-2 text-base leading-[1.55]', className)} {...resto} />
}

/* ---------- Select ---------- */

export type OpcaoSelect<V extends string> = { valor: V; rotulo: string; descricao?: string; desabilitada?: boolean }

type SelectProps<V extends string> = {
  valor: V | null
  aoMudar: (v: V) => void
  opcoes: OpcaoSelect<V>[]
  /** nome acessível quando não há <Campo> em volta */
  rotulo?: string
  placeholder?: string
  desabilitado?: boolean
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: true
  className?: string
}

/** Seleção única numa lista curta (até ~15 opções). Lista maior vai para a Paleta. */
export function Select<V extends string>({ valor, aoMudar, opcoes, rotulo, placeholder = 'Escolha', desabilitado, id, className, ...aria }: SelectProps<V>) {
  const atual = opcoes.find((o) => o.valor === valor)
  return (
    <S.Root value={valor} onValueChange={(v) => v != null && aoMudar(v as V)} items={opcoes.map((o) => ({ value: o.valor, label: o.rotulo }))} disabled={desabilitado} modal={false}>
      <S.Trigger id={id} aria-label={rotulo} {...aria} className={cn(caixaCampo, 'flex h-7 min-w-36 cursor-pointer items-center gap-2 pr-1.5 pl-2.5 text-left text-pequeno data-popup-open:bg-hover in-[.bg-elevado]:data-popup-open:bg-hover', className)}>
        <S.Value className={cn('flex-1 truncate', !atual && 'text-t3')}>{atual?.rotulo ?? placeholder}</S.Value>
        <S.Icon className="text-t3">
          <ChevronsUpDown className="size-[14px] stroke-[1.75]" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Positioner sideOffset={4} alignItemWithTrigger={false} style={{ zIndex: 'var(--z-popover)' }}>
          <S.Popup className={cn(camadaBase, 'max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto p-1')}>
            {opcoes.map((o) => (
              <S.Item key={o.valor} value={o.valor} disabled={o.desabilitada} className={cn(itemBase, 'h-auto min-h-8 py-1.5 data-selected:text-t1')}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <S.ItemText className="truncate">{o.rotulo}</S.ItemText>
                  {o.descricao && <span className="text-pequeno text-t3">{o.descricao}</span>}
                </span>
                <S.ItemIndicator className="text-t1">
                  <Check />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Popup>
        </S.Positioner>
      </S.Portal>
    </S.Root>
  )
}
