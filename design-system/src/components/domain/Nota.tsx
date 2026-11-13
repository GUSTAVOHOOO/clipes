import { ChevronDown } from 'lucide-react'
import { PESOS, type Corte } from '@/data/dados'
import { num } from '@/lib/formato'

/** A Nota explica a seleção em cinco eixos; nunca promete audiência. */
export function Nota({ corte }: { corte: Corte }) {
  return (
    <details className="group/nota mt-2">
      <summary className="foco inline-flex min-h-7 cursor-default list-none items-center gap-2 rounded-md pr-2 text-xs text-fg-2 hover:text-fg">
        <span className="timecode font-medium text-fg">
          Nota {num(corte.nota.total)}
          <span className="text-fg-3"> / 10</span>
        </span>
        <span>Ver 5 eixos</span>
        <ChevronDown size={13} className="transition-transform duration-(--dur-fast) group-open/nota:rotate-180" />
      </summary>
      <div className="mt-2 max-w-[720px] space-y-3 border-t border-line pt-3 pb-1">
        {corte.nota.eixos.map(e => (
          <div key={e.nome} className="grid grid-cols-[160px_44px_1fr] items-start gap-3 text-xs">
            <div>
              <span className="text-fg-2">{e.nome}</span>
              <span className="ml-1 text-fg-3">{Math.round((PESOS[e.nome] ?? 0) * 100)}%</span>
              <div className="mt-1.5 h-0.5 bg-selected">
                <div className="h-full bg-fg-3" style={{ width: `${e.valor * 10}%` }} />
              </div>
            </div>
            <span className="timecode text-fg-2">{num(e.valor)}</span>
            <p className="leading-relaxed text-fg-3">{e.justificativa}</p>
          </div>
        ))}
        <p className="text-2xs text-fg-3">A Nota orienta a revisão. Não prevê visualizações.</p>
      </div>
    </details>
  )
}
