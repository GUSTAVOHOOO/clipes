// Linhas de domínio reaproveitadas pelas telas: Frase da Transcrição, linha de silêncio,
// item da lista de Cortes (Bancada) e ajuste de borda por Frase.
import { AudioLines, Check, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { duracao, nota as fmtNota, tc, tcLongo } from '@/lib/formato'
import { Botao } from '@/primitivas/Botao'

type LinhaFraseProps = {
  inicioUs: number
  /** palavras; `falada` destaca a palavra sob a agulha com a cor do sinal */
  palavras: string[]
  falada?: number
  ativa?: boolean
  /** fora do Corte (antes da Entrada ou depois da Saída) */
  fora?: boolean
  aoClicar?: () => void
}

export function LinhaFrase({ inicioUs, palavras, falada, ativa, fora, aoClicar }: LinhaFraseProps) {
  return (
    <div role="button" tabIndex={0} onClick={aoClicar} onKeyDown={(e) => e.key === 'Enter' && aoClicar?.()} aria-current={ativa || undefined}
      className={cn('foco-interno grid cursor-pointer grid-cols-[52px_1fr] items-baseline gap-2.5 rounded-controle px-2.5 py-2 transition-colors duration-(--dur-rapida) ease-saida hover:bg-elevado',
        ativa && 'marcado bg-elevado', fora && 'opacity-45')}
    >
      <span className="num text-t3">{tc(inicioUs)}</span>
      <p className={cn('leading-[1.55]', ativa ? 'text-t1' : 'text-t2')}>
        {palavras.map((p, i) => (
          <span key={i}>
            <span className={cn('-mx-0.5 rounded-mini px-0.5', i === falada && 'font-forte text-sinal-texto')}>{p}</span>{' '}
          </span>
        ))}
      </p>
    </div>
  )
}

export function LinhaSilencio({ duracaoUs, removido, aoAlternar }: { duracaoUs: number; removido: boolean; aoAlternar?: () => void }) {
  return (
    <button type="button" onClick={aoAlternar} aria-pressed={removido}
      className="foco-interno my-0.5 flex w-full cursor-pointer items-center gap-2 rounded-controle border-0 bg-transparent py-1.5 pr-2.5 pl-[72px] text-left text-pequeno text-t3 hover:bg-elevado hover:text-t2"
    >
      <AudioLines className="size-[13px] stroke-[1.75]" aria-hidden />
      <span className={cn('num', removido && 'line-through')}>silêncio {(duracaoUs / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s</span>
      <span className="ml-auto text-micro">{removido ? 'removido · manter' : 'manter · remover'}</span>
    </button>
  )
}

export type DecisaoCorte = 'pendente' | 'aprovado' | 'rejeitado'

type ItemCorteProps = {
  titulo: string
  inicioUs: number
  duracaoUs: number
  nota: number
  decisao: DecisaoCorte
  selecionado?: boolean
}

/** Linha enxuta da Bancada: título, início, duração, Nota e ícone da decisão. Decidido fica em t2. */
export function ItemCorte({ titulo, inicioUs, duracaoUs, nota, decisao, selecionado }: ItemCorteProps) {
  return (
    <div className={cn('grid cursor-pointer grid-cols-[1fr_auto_16px] items-center gap-3 rounded-controle px-4 py-2 transition-colors duration-(--dur-rapida) ease-saida hover:bg-elevado', selecionado && 'marcado bg-elevado')}>
      <div className="min-w-0">
        <p className={cn('truncate', selecionado || decisao === 'pendente' ? 'text-t1' : 'text-t2')}>{titulo}</p>
        <p className="num mt-0.5 text-pequeno text-t3">
          {tcLongo(inicioUs)}
          <span className="ml-2.5">{duracao(duracaoUs)}</span>
        </p>
      </div>
      <span className="num font-forte text-t1">{fmtNota(nota)}</span>
      <span className="text-t3">
        {decisao === 'aprovado' && <Check className="size-[14px] stroke-[1.75]" aria-label="Aprovado" />}
        {decisao === 'rejeitado' && <X className="size-[14px] stroke-[1.75]" aria-label="Rejeitado" />}
      </span>
    </div>
  )
}

/** "Início 00:12:31 [−1 Frase] [+1 Frase] “Em março de 2019…”" */
export function AjusteBorda({ rotulo, posicaoUs, previa, aoRecuar, aoAvancar, atalho }: { rotulo: string; posicaoUs: number; previa: ReactNode; aoRecuar?: () => void; aoAvancar?: () => void; atalho?: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[46px_70px_auto_1fr] items-center gap-2">
      <span className="text-pequeno text-t3">{rotulo}</span>
      <span className="num text-pequeno text-t2">{tcLongo(posicaoUs)}</span>
      <span className="inline-flex gap-0.5" title={atalho}>
        <Botao tamanho="p" variante="suave" onClick={aoRecuar}>
          −1 Frase
        </Botao>
        <Botao tamanho="p" variante="suave" onClick={aoAvancar}>
          +1 Frase
        </Botao>
      </span>
      <span className="min-w-0 truncate text-pequeno text-t3">{previa}</span>
    </div>
  )
}
