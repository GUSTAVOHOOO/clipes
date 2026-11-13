// Seleção única numa lista curta (até ~15 opções): fonte da legenda, idioma, Perfil de canal.
// Lista maior ou com busca vai para a paleta ou para um Combobox. A lista abre abaixo do gatilho,
// sem cobrir o valor atual; ↑ ↓ e letras movem, Enter escolhe, Esc fecha e devolve o foco.
import { Select as S } from '@base-ui/react/select'
import { Check, ChevronsUpDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { popupBase, zDropdown } from './camada'
import { caixa } from './Field'

export type OpcaoSelect<V extends string> = {
  valor: V
  rotulo: string
  /** linha de apoio, abaixo do rótulo (só dentro da lista) */
  descricao?: ReactNode
  icone?: ReactNode
  desabilitada?: boolean
}

export type GrupoSelect<V extends string> = { titulo: string; opcoes: OpcaoSelect<V>[] }

type Props<V extends string> = {
  valor: V | null
  onChange: (v: V) => void
  /** opções soltas ou em grupos */
  opcoes: OpcaoSelect<V>[] | GrupoSelect<V>[]
  /** nome acessível do gatilho, quando não há <Campo rotulo> em volta */
  rotulo?: string
  placeholder?: string
  tamanho?: 'sm' | 'md'
  desabilitado?: boolean
  invalido?: boolean
  id?: string
  name?: string
  className?: string
}

const ehGrupo = <V extends string>(o: OpcaoSelect<V> | GrupoSelect<V>): o is GrupoSelect<V> => 'opcoes' in o

export function Select<V extends string>({
  valor,
  onChange,
  opcoes,
  rotulo,
  placeholder = 'Escolha',
  tamanho = 'md',
  desabilitado,
  invalido,
  id,
  name,
  className,
}: Props<V>) {
  const grupos: GrupoSelect<V>[] =
    opcoes.length && ehGrupo(opcoes[0])
      ? (opcoes as GrupoSelect<V>[])
      : [{ titulo: '', opcoes: opcoes as OpcaoSelect<V>[] }]
  const todas = grupos.flatMap((g) => g.opcoes)
  const atual = todas.find((o) => o.valor === valor)

  return (
    <S.Root
      id={id}
      name={name}
      value={valor}
      onValueChange={(v) => v != null && onChange(v as V)}
      items={todas.map((o) => ({ value: o.valor, label: o.rotulo }))}
      disabled={desabilitado}
      modal={false}
    >
      <S.Trigger
        aria-label={rotulo}
        aria-invalid={invalido || undefined}
        className={cn(
          caixa,
          'foco group/sel flex min-w-40 items-center gap-2 pr-1.5 pl-2.5 text-left select-none',
          'data-popup-open:border-control-border data-disabled:pointer-events-none data-disabled:opacity-45',
          tamanho === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm',
          invalido && 'border-danger hover:border-danger',
          className,
        )}
      >
        {atual?.icone && <span className="flex shrink-0 text-fg-3">{atual.icone}</span>}
        <S.Value placeholder={placeholder} className="min-w-0 flex-1 truncate data-placeholder:text-fg-3" />
        <S.Icon className="flex shrink-0 text-fg-3 transition-colors group-hover/sel:text-fg-2">
          <ChevronsUpDown size={14} strokeWidth={1.75} />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Positioner alignItemWithTrigger={false} side="bottom" align="start" sideOffset={4} style={zDropdown}>
          <S.Popup className={cn(popupBase, 'min-w-(--anchor-width) p-1')}>
            <S.List className="max-h-[min(var(--available-height),320px)] scroll-py-1 overflow-y-auto overscroll-contain">
              {grupos.map((g, gi) => {
                const itens = g.opcoes.map((o) => (
                  <S.Item
                    key={o.valor}
                    value={o.valor}
                    disabled={o.desabilitada}
                    className={cn(
                      'flex min-h-8 cursor-default items-center gap-2.5 rounded-md py-1.5 pr-2 pl-2 text-sm text-fg-2 outline-none select-none',
                      'data-highlighted:bg-selected data-highlighted:text-fg data-selected:text-fg',
                      'data-disabled:pointer-events-none data-disabled:text-fg-disabled',
                    )}
                  >
                    {o.icone && <span className="grid w-4 shrink-0 place-items-center text-fg-3">{o.icone}</span>}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <S.ItemText className="truncate">{o.rotulo}</S.ItemText>
                      {o.descricao && <span className="text-xs text-fg-3">{o.descricao}</span>}
                    </span>
                    <S.ItemIndicator className="flex shrink-0 text-fg">
                      <Check size={14} strokeWidth={2} />
                    </S.ItemIndicator>
                  </S.Item>
                ))
                if (!g.titulo) return itens
                return (
                  <S.Group key={g.titulo}>
                    {gi > 0 && <S.Separator className="mx-1 my-1 h-px bg-line" />}
                    <S.GroupLabel className="px-2 pt-2 pb-1 text-2xs text-fg-3">{g.titulo}</S.GroupLabel>
                    {itens}
                  </S.Group>
                )
              })}
            </S.List>
          </S.Popup>
        </S.Positioner>
      </S.Portal>
    </S.Root>
  )
}
