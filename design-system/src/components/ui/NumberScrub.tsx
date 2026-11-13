// Campo numérico com scrub, para tempos, posição e volume.
//   - arrastar o rótulo (dentro da caixa) muda o valor; o cursor some e o valor corre, como num editor de vídeo;
//   - ↑ ↓ mudam um passo, Shift × 10, Alt × 0,1; PageUp/PageDown um passo grande; Home/End vão ao mínimo e ao máximo;
//   - digitar aceita vírgula (PT-BR) e confirma no Enter ou ao sair.
// Base UI NumberField: a mesma peça cuida do teclado, do arraste e do formato.
import { NumberField as NF } from '@base-ui/react/number-field'
import { ChevronsLeftRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { caixa } from './Field'
import { Spinner } from './Spinner'

const casasDe = (n: number) => {
  const s = String(n)
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

export type NumberScrubProps = {
  valor: number | null
  onChange: (v: number | null) => void
  /** chamado quando o valor assenta: soltar o arraste, Enter, sair do campo */
  onCommit?: (v: number | null) => void
  /** nome curto, mostrado dentro da caixa e arrastável ("Entrada", "X", "Volume") */
  rotulo: string
  /** esconde o rótulo de dentro (quando o <Campo> já mostra um); o nome acessível continua */
  semRotulo?: boolean
  /** ícone no lugar do rótulo visível (o rótulo vira só nome acessível) */
  icone?: ReactNode
  /** unidade depois do valor: s, %, px, dB… */
  unidade?: string
  min?: number
  max?: number
  /** passo das setas e do arraste (padrão 1) */
  passo?: number
  /** com Alt (padrão passo ÷ 10) */
  passoFino?: number
  /** com Shift e PageUp/PageDown (padrão passo × 10) */
  passoGrosso?: number
  /** casas decimais mínimas (padrão: as do passo) */
  casas?: number
  /** pixels de arraste por passo (padrão 3) */
  sensibilidade?: number
  tamanho?: 'sm' | 'md'
  desabilitado?: boolean
  somenteLeitura?: boolean
  /** marca a caixa como inválida (a mensagem vem do <Campo erro>) */
  invalido?: boolean
  carregando?: boolean
  id?: string
  name?: string
  className?: string
}

export function NumberScrub({
  valor,
  onChange,
  onCommit,
  rotulo,
  semRotulo,
  icone,
  unidade,
  min,
  max,
  passo = 1,
  passoFino,
  passoGrosso,
  casas,
  sensibilidade = 3,
  tamanho = 'md',
  desabilitado,
  somenteLeitura,
  invalido,
  carregando,
  id,
  name,
  className,
}: NumberScrubProps) {
  const fino = passoFino ?? passo / 10
  const grosso = passoGrosso ?? passo * 10
  const minimo = casas ?? casasDe(passo)
  const maximo = Math.max(minimo, casasDe(fino))
  const mostraRotulo = !semRotulo || icone

  return (
    <NF.Root
      id={id}
      name={name}
      value={valor}
      onValueChange={(v) => onChange(v)}
      onValueCommitted={(v) => onCommit?.(v)}
      min={min}
      max={max}
      step={passo}
      smallStep={fino}
      largeStep={grosso}
      locale="pt-BR"
      format={{ minimumFractionDigits: minimo, maximumFractionDigits: maximo, useGrouping: false }}
      disabled={desabilitado || carregando}
      readOnly={somenteLeitura}
      className={cn('min-w-0', className)}
    >
      <NF.Group
        className={cn(
          caixa,
          'group/scrub flex items-center overflow-hidden data-scrubbing:border-control-border',
          tamanho === 'sm' ? 'h-7' : 'h-8',
          invalido && 'border-danger hover:border-danger',
        )}
      >
        {mostraRotulo && (
          <NF.ScrubArea
            direction="horizontal"
            pixelSensitivity={sensibilidade}
            title={`Arraste para mudar ${rotulo.toLowerCase()}`}
            className={cn(
              'flex h-full shrink-0 cursor-ew-resize items-center self-stretch pl-2.5 pr-1.5 text-fg-3 select-none',
              'transition-colors duration-(--dur-fast) hover:text-fg-2 group-data-scrubbing/scrub:text-fg',
              tamanho === 'sm' ? 'text-2xs' : 'text-xs',
            )}
          >
            {icone ?? <span className="whitespace-nowrap">{rotulo}</span>}
            <NF.ScrubAreaCursor className="pointer-events-none drop-shadow-[0_1px_1px_var(--shadow-color)]">
              <ChevronsLeftRight size={16} strokeWidth={2} className="text-fg" />
            </NF.ScrubAreaCursor>
          </NF.ScrubArea>
        )}
        <NF.Input
          aria-label={unidade ? `${rotulo} (${unidade})` : rotulo}
          aria-invalid={invalido || undefined}
          className={cn(
            'timecode h-full min-w-0 flex-1 bg-transparent text-right text-fg outline-none',
            'selection:bg-accent-subtle data-disabled:text-fg-disabled',
            tamanho === 'sm' ? 'text-xs' : 'text-sm',
            mostraRotulo ? 'pl-1' : 'pl-2.5',
            unidade ? 'pr-1' : 'pr-2.5',
          )}
        />
        {unidade && !carregando && (
          <span aria-hidden className={cn('shrink-0 pr-2.5 text-fg-3', tamanho === 'sm' ? 'text-2xs' : 'text-xs')}>
            {unidade}
          </span>
        )}
        {carregando && <Spinner className="mr-2.5 text-fg-3" rotulo="Calculando" />}
      </NF.Group>
    </NF.Root>
  )
}
