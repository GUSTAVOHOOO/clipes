// Interruptor: liga e desliga na hora, sem "Salvar". Sempre com rótulo visível ao lado ou aria-label.
import { Switch as S } from '@base-ui/react/switch'
import { cn } from '@/lib/cn'

type Props = {
  ligado: boolean
  onChange: (v: boolean) => void
  rotulo: string
  desabilitado?: boolean
  id?: string
  className?: string
}

export function Switch({ ligado, onChange, rotulo, desabilitado, id, className }: Props) {
  return (
    <S.Root
      id={id}
      checked={ligado}
      onCheckedChange={v => onChange(v)}
      disabled={desabilitado}
      aria-label={rotulo}
      className={cn(
        'foco relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border transition-colors duration-(--dur-fast)',
        'border-control-border bg-field data-checked:border-primary data-checked:bg-primary',
        'data-disabled:opacity-45',
        className,
      )}
    >
      <S.Thumb className="block size-3 translate-x-[2px] rounded-full bg-fg-3 transition-[translate,background-color] duration-(--dur-base) ease-out data-checked:translate-x-[16px] data-checked:bg-primary-fg" />
    </S.Root>
  )
}
