import type { ReactNode } from 'react'
import { CircleAlert, Inbox } from 'lucide-react'
import { cn } from '@/lib/cn'

export function Estado({
  titulo,
  descricao,
  acao,
  tipo = 'vazio',
  className,
}: {
  titulo: string
  descricao: string
  acao?: ReactNode
  tipo?: 'vazio' | 'erro'
  className?: string
}) {
  const Icone = tipo === 'erro' ? CircleAlert : Inbox
  return (
    <div
      role={tipo === 'erro' ? 'alert' : 'status'}
      className={cn('flex min-h-56 flex-col items-center justify-center gap-3 px-6 py-10 text-center', className)}
    >
      <Icone size={24} strokeWidth={1.5} className={tipo === 'erro' ? 'text-danger' : 'text-fg-3'} />
      <div>
        <h2 className="text-md font-medium">{titulo}</h2>
        <p className="mt-1 max-w-[48ch] text-sm text-fg-3">{descricao}</p>
      </div>
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  )
}

export function Esqueleto({ linhas = 5, rotulo = 'Carregando' }: { linhas?: number; rotulo?: string }) {
  return (
    <div role="status" aria-label={rotulo} aria-busy="true" className="divide-y divide-line">
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} aria-hidden className="flex h-16 items-center gap-4">
          <div className="h-10 w-16 rounded-sm bg-field" />
          <div className="flex-1 space-y-2">
            <div className="h-2 w-2/5 rounded-sm bg-selected" />
            <div className="h-2 w-1/4 rounded-sm bg-field" />
          </div>
        </div>
      ))}
    </div>
  )
}
