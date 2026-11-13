// Estado em texto + ícone, nunca só cor. Discreto: sem pílula colorida cheia.
import { Check, CircleAlert, CircleDashed, CircleDot, Clock, Info, TriangleAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './Spinner'

export type TomStatus = 'neutro' | 'andamento' | 'sucesso' | 'atencao' | 'perigo' | 'info' | 'espera' | 'rejeitado' | 'rascunho'

const ICONE: Record<TomStatus, ReactNode> = {
  neutro: <CircleDot size={13} />,
  andamento: <Spinner tamanho={13} />,
  sucesso: <Check size={13} strokeWidth={2.25} />,
  atencao: <TriangleAlert size={13} />,
  perigo: <CircleAlert size={13} />,
  info: <Info size={13} />,
  espera: <Clock size={13} />,
  rejeitado: <X size={13} />,
  rascunho: <CircleDashed size={13} />,
}
const COR: Record<TomStatus, string> = {
  neutro: 'text-fg-2',
  andamento: 'text-fg-2',
  sucesso: 'text-success',
  atencao: 'text-warning',
  perigo: 'text-danger',
  info: 'text-info',
  espera: 'text-fg-3',
  rejeitado: 'text-fg-3',
  rascunho: 'text-fg-3',
}

export function Status({ tom, children, className, semIcone }: { tom: TomStatus; children: ReactNode; className?: string; semIcone?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs whitespace-nowrap tabular-nums', COR[tom], className)}>
      {!semIcone && <span className="grid size-[13px] place-items-center">{ICONE[tom]}</span>}
      <span>{children}</span>
    </span>
  )
}
