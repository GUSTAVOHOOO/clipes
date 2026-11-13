// Contexto de um Corte aberto, para o meio da barra superior das telas do Corte:
// título, posição na lista ([ ] trocam) e as três etapas do Corte (Editar, Transformar, Empacotar).
import { cortes } from '@/data/dados'
import { cn } from '@/lib/cn'
import { useComandos } from '@/lib/comandos'
import { ir, useRota } from '@/lib/rota'
import { Kbd } from '@/components/ui/Kbd'

export const ETAPAS_CORTE = [
  { id: 'editar', nome: 'Editar', atalho: 'Ctrl+1' },
  { id: 'transformar', nome: 'Transformar', atalho: 'Ctrl+2' },
  { id: 'empacotar', nome: 'Empacotar', atalho: 'Ctrl+3' },
] as const
export type EtapaCorte = (typeof ETAPAS_CORTE)[number]['id']

/** Corte da rota (#/corte/c2/editar); cai no primeiro se o id não existir. */
export function useCorteDaRota() {
  const { partes } = useRota()
  const i = Math.max(0, cortes.findIndex(c => c.id === partes[1]))
  const etapa = (partes[2] ?? 'editar') as EtapaCorte
  return { corte: cortes[i], indice: i, etapa }
}

export function irCorte(i: number, etapa: EtapaCorte = 'editar') {
  const n = (i + cortes.length) % cortes.length
  ir(`/corte/${cortes[n].id}/${etapa}`)
}

export function ContextoCorte() {
  const { corte, indice, etapa } = useCorteDaRota()

  useComandos([
    ...ETAPAS_CORTE.map(e => ({
      id: `etapa-${e.id}`,
      titulo: `${e.nome} este Corte`,
      grupo: 'Corte',
      atalho: e.atalho,
      desabilitado: e.id === etapa,
      executar: () => irCorte(indice, e.id),
    })),
    { id: 'corte-prox', titulo: 'Próximo Corte', grupo: 'Navegar', atalho: ']', executar: () => irCorte(indice + 1, etapa) },
    { id: 'corte-ant', titulo: 'Corte anterior', grupo: 'Navegar', atalho: '[', executar: () => irCorte(indice - 1, etapa) },
    {
      id: 'ir-corte',
      titulo: 'Ir para o Corte…',
      grupo: 'Navegar',
      atalho: 'G',
      palavras: ['abrir', 'trocar', 'buscar'],
      filhos: () =>
        cortes.map((c, i) => ({
          id: `ir-${c.id}`,
          titulo: c.titulo,
          grupo: 'Cortes',
          dica: `${i + 1}/${cortes.length}`,
          palavras: c.frases.map(f => f.texto),
          executar: () => irCorte(i, etapa),
        })),
    },
  ])

  return (
    <div className="flex min-w-0 items-center gap-4">
      <span className="flex min-w-0 items-center gap-2.5 text-sm">
        <span className="truncate text-fg">{corte.titulo}</span>
        <span className="timecode shrink-0 text-xs text-fg-3">
          {indice + 1}/{cortes.length}
        </span>
        <Kbd teclas={['[', ']']} />
      </span>
      <nav aria-label="Etapas do Corte" className="flex shrink-0 items-center rounded-md border border-line p-0.5">
        {ETAPAS_CORTE.map(e => (
          <a
            key={e.id}
            href={`#/corte/${corte.id}/${e.id}`}
            aria-current={e.id === etapa ? 'page' : undefined}
            title={`${e.nome} (${e.atalho.replace('+', ' ')})`}
            className={cn(
              'foco flex h-6 items-center rounded-[5px] px-2 text-xs transition-colors duration-(--dur-fast)',
              e.id === etapa ? 'bg-selected text-fg' : 'text-fg-3 hover:text-fg-2',
            )}
          >
            {e.nome}
          </a>
        ))}
      </nav>
    </div>
  )
}
