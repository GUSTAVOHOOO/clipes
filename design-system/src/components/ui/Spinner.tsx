import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Só dentro de controles (botão salvando, linha processando). Conteúdo carregando usa Skeleton. */
export function Spinner({ tamanho = 14, className, rotulo }: { tamanho?: number; className?: string; rotulo?: string }) {
  return (
    <LoaderCircle
      size={tamanho}
      strokeWidth={2}
      className={cn('shrink-0 animate-spin motion-reduce:animate-none', className)}
      role={rotulo ? 'status' : undefined}
      aria-label={rotulo}
      aria-hidden={rotulo ? undefined : true}
    />
  )
}
