// Barra de progresso fina (3 px). Determinada mostra o valor; sem valor, corre indeterminada.
// O número em texto sempre acompanha quando importa ("Transcrevendo · 42%"): a barra só dá forma.
import { Progress as P } from '@base-ui/react/progress'
import { cn } from '@/lib/cn'

type Tom = 'neutro' | 'acento' | 'perigo' | 'sucesso'
const COR: Record<Tom, string> = { neutro: 'bg-fg-2', acento: 'bg-accent', perigo: 'bg-danger', sucesso: 'bg-success' }

type Props = {
  /** 0 a 1; null = indeterminada */
  valor: number | null
  rotulo: string
  tom?: Tom
  className?: string
  espessura?: 2 | 3 | 4
}

export function Progresso({ valor, rotulo, tom = 'neutro', className, espessura = 3 }: Props) {
  return (
    <P.Root value={valor == null ? null : Math.round(valor * 100)} aria-label={rotulo} className={cn('w-full', className)}>
      <P.Track className="relative overflow-hidden rounded-full bg-selected" style={{ height: espessura }}>
        <P.Indicator
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-[width] duration-(--dur-slow) ease-out',
            COR[tom],
            valor == null && 'w-2/5! animate-[barra-indeterminada_1.4s_var(--ease-in-out)_infinite]',
          )}
        />
      </P.Track>
    </P.Root>
  )
}
