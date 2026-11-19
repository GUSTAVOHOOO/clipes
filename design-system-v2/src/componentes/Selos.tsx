// Selos e indicadores no visual minimalista: nada de pílula colorida.
// <SeloTipoVideo> e <BadgeNota> são texto (ícone + palavra, número + palavra); <EixosNota> revela os 5 eixos.
import { Clapperboard, Mic, ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '@/lib/cn'
import { nota as fmtNota } from '@/lib/formato'

export type TipoVideo = 'direct' | 'transformed'

export function SeloTipoVideo({ tipo, className }: { tipo: TipoVideo; className?: string }) {
  const Icone = tipo === 'direct' ? Clapperboard : Mic
  return (
    <span className={cn('inline-flex items-center gap-1 text-pequeno whitespace-nowrap text-t3', className)}>
      <Icone className="size-[13px] stroke-[1.75]" aria-hidden />
      {tipo === 'direct' ? 'Corte direto' : 'Vídeo transformado'}
    </span>
  )
}

type BadgeNotaProps = {
  nota: number
  /** uma linha de motivo, ao lado do número */
  motivo?: string
  /** 'lista' mostra só o número forte; 'detalhe' mostra "Nota 8,4" + motivo */
  modo?: 'lista' | 'detalhe'
  className?: string
}

/** A Nota é um número com a palavra "Nota"; o motivo explica em uma linha. */
export function BadgeNota({ nota, motivo, modo = 'detalhe', className }: BadgeNotaProps) {
  if (modo === 'lista')
    return (
      <span className={cn('num font-forte text-t1', className)} aria-label={`Nota ${fmtNota(nota)}`}>
        {fmtNota(nota)}
      </span>
    )
  return (
    <p className={cn('flex flex-wrap items-baseline gap-x-2.5 gap-y-1', className)}>
      <span className="num text-[15px] font-forte text-t1">Nota {fmtNota(nota)}</span>
      {motivo && <span className="text-t2">{motivo}</span>}
    </p>
  )
}

export type EixoNota = { nome: string; peso: number; valor: number; porque: string }

/** "Ver os 5 eixos": recolhido por padrão (revelação progressiva). */
export function EixosNota({ eixos, abertoPorPadrao = false }: { eixos: EixoNota[]; abertoPorPadrao?: boolean }) {
  const [aberto, setAberto] = useState(abertoPorPadrao)
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <button type="button" aria-expanded={aberto} aria-controls={id} onClick={() => setAberto((v) => !v)}
        className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-controle border-0 bg-transparent py-1 text-pequeno text-t2 hover:text-t1"
      >
        <ChevronRight className={cn('size-[14px] stroke-[1.75] transition-transform duration-(--dur-base) ease-saida', aberto && 'rotate-90')} aria-hidden />
        {aberto ? 'Ocultar eixos' : `Ver os ${eixos.length} eixos`}
      </button>
      {aberto && (
        <dl id={id} className="grid gap-1.5 rounded-area bg-area px-3 py-2.5 text-pequeno">
          {eixos.map((e) => (
            <div key={e.nome} className="grid grid-cols-[minmax(120px,148px)_34px_1fr] items-baseline gap-2.5">
              <dt className="flex justify-between gap-1.5 text-t2">
                {e.nome} <span className="num text-t3">×{e.peso.toLocaleString('pt-BR')}</span>
              </dt>
              <dd className="num m-0 text-right font-forte text-t1">{fmtNota(e.valor)}</dd>
              <dd className="m-0 text-t3">{e.porque}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
