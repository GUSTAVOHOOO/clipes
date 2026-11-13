import { CircleAlert, Inbox } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'

export function EstadoLista({
  estado,
  titulo,
  descricao,
  acao,
  onAcao,
}: {
  estado: string | null
  titulo: string
  descricao: ReactNode
  acao?: string
  onAcao?: () => void
}) {
  if (estado === 'carregando')
    return (
      <div aria-busy="true" aria-label="Carregando lista" className="space-y-0 divide-y divide-line">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex items-center gap-4 py-5">
            <div className="h-14 w-24 rounded-md bg-field" />
            <div className="flex-1 space-y-3">
              <div className="h-3 w-2/5 rounded-xs bg-field" />
              <div className="h-3 w-3/5 rounded-xs bg-field" />
            </div>
            <div className="h-7 w-24 rounded-md bg-field" />
          </div>
        ))}
      </div>
    )
  const erro = estado === 'erro'
  return (
    <div
      role={erro ? 'alert' : 'status'}
      className="flex min-h-56 flex-col items-center justify-center gap-3 py-12 text-center"
    >
      {erro ? (
        <CircleAlert size={24} strokeWidth={1.5} className="text-danger" />
      ) : (
        <Inbox size={24} strokeWidth={1.5} className="text-fg-3" />
      )}
      <div>
        <h2 className="text-md font-medium">{titulo}</h2>
        <p className="mx-auto mt-1 max-w-[55ch] text-sm text-fg-3">{descricao}</p>
      </div>
      {acao && <Button onClick={onAcao}>{acao}</Button>}
    </div>
  )
}
