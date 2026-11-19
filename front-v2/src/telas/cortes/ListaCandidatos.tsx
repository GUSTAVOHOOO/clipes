import {
  Botao,
  EstadoTela,
  ItemCorte,
  Kbd,
  ListaVirtual,
  Segmentado,
  Select,
  Slider,
  cn,
  nota,
  type DecisaoCorte,
  type OpcaoSelect,
} from '@ds'
import { CircleDashed } from 'lucide-react'
import { useMemo } from 'react'

export type FiltroEstadoCandidato = 'todos' | 'pending' | 'approved' | 'rejected'
export type OrdenacaoCandidatos = 'nota' | 'fonte'

export interface ChatPicoCandidato {
  ratio: number
  reaction: string | null
  atUs: number
}

export interface AjusteSelecaoCandidato {
  extendedBefore?: number
  extendedAfter?: number
  trimmedEnd?: number
}

export interface CandidatoLista {
  id: number
  rank: number
  title: string
  total: number
  chat?: ChatPicoCandidato[]
  windows: number[]
  profile: string
  revision: number
  adjusted: boolean
  adjust?: AjusteSelecaoCandidato | null
  status: 'pending' | 'approved' | 'rejected'
  startUs: number
  endUs: number
  startText: string
  endText: string
  moves?: {
    startEarlier: boolean
    startLater: boolean
    endEarlier: boolean
    endLater: boolean
  }
}

export interface ListaCandidatosProps {
  candidatos: CandidatoLista[]
  selecionadoId: number | null
  aoSelecionar: (candidato: CandidatoLista) => void
  filtroEstado: FiltroEstadoCandidato
  aoMudarFiltroEstado: (estado: FiltroEstadoCandidato) => void
  notaMinima: number
  aoMudarNotaMinima: (notaMinima: number) => void
  ordenacao: OrdenacaoCandidatos
  aoMudarOrdenacao: (ordenacao: OrdenacaoCandidatos) => void
  aoLimparFiltros: () => void
  className?: string
}

const DECISAO_MAPA: Record<CandidatoLista['status'], DecisaoCorte> = {
  pending: 'pendente',
  approved: 'aprovado',
  rejected: 'rejeitado',
}

const OPCOES_ORDENACAO: OpcaoSelect<OrdenacaoCandidatos>[] = [
  { valor: 'nota', rotulo: 'Maior Nota' },
  { valor: 'fonte', rotulo: 'Ordem na Fonte' },
]

/** Filtra candidatos por estado e Nota mínima e ordena por Maior Nota ou Ordem na Fonte. */
export function filtrarEOrdenarCandidatos<T extends CandidatoLista>(
  candidatos: readonly T[],
  {
    filtroEstado,
    notaMinima,
    ordenacao,
  }: {
    filtroEstado: FiltroEstadoCandidato
    notaMinima: number
    ordenacao: OrdenacaoCandidatos
  },
): T[] {
  const filtrados = candidatos.filter((c) => {
    if (filtroEstado !== 'todos' && c.status !== filtroEstado) return false
    if (c.total < notaMinima) return false
    return true
  })

  return filtrados.sort((a, b) => {
    if (ordenacao === 'fonte') {
      if (a.startUs !== b.startUs) return a.startUs - b.startUs
      if (a.endUs !== b.endUs) return a.endUs - b.endUs
      return a.id - b.id
    }
    if (b.total !== a.total) return b.total - a.total
    if (a.rank !== b.rank) return a.rank - b.rank
    return a.startUs - b.startUs
  })
}

/** Coluna esquerda da Bancada de Revisão (C.2): filtros segmentados, Nota mínima, ordenação e lista virtualizada. */
export function ListaCandidatos({
  candidatos,
  selecionadoId,
  aoSelecionar,
  filtroEstado,
  aoMudarFiltroEstado,
  notaMinima,
  aoMudarNotaMinima,
  ordenacao,
  aoMudarOrdenacao,
  aoLimparFiltros,
  className,
}: ListaCandidatosProps) {
  const contadores = useMemo(() => {
    let pending = 0
    let approved = 0
    let rejected = 0
    for (const c of candidatos) {
      if (c.status === 'approved') approved += 1
      else if (c.status === 'rejected') rejected += 1
      else pending += 1
    }
    return {
      todos: candidatos.length,
      pending,
      approved,
      rejected,
    }
  }, [candidatos])

  const candidatosFiltrados = useMemo(
    () => filtrarEOrdenarCandidatos(candidatos, { filtroEstado, notaMinima, ordenacao }),
    [candidatos, filtroEstado, notaMinima, ordenacao],
  )

  const opcoesEstado = useMemo(
    () => [
      { valor: 'todos' as const, rotulo: <span className="num">Todos ({contadores.todos})</span> },
      { valor: 'pending' as const, rotulo: <span className="num">Pend. ({contadores.pending})</span> },
      { valor: 'approved' as const, rotulo: <span className="num">Aprov. ({contadores.approved})</span> },
      { valor: 'rejected' as const, rotulo: <span className="num">Rej. ({contadores.rejected})</span> },
    ],
    [contadores],
  )

  const filtroZerou = candidatos.length > 0 && candidatosFiltrados.length === 0

  return (
    <section
      aria-label="Lista de candidatos"
      className={cn('flex min-h-0 flex-col rounded-area bg-area', className)}
    >
      <div className="flex shrink-0 flex-col gap-2.5 px-3 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2 text-pequeno text-t3">
          <span className="num">
            {candidatosFiltrados.length === candidatos.length
              ? `${candidatos.length} Cortes sugeridos`
              : `${candidatosFiltrados.length} de ${candidatos.length} Cortes`}
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span>navegar</span>
          </span>
        </div>

        <Segmentado
          rotulo="Filtrar por estado"
          valor={filtroEstado}
          aoMudar={aoMudarFiltroEstado}
          opcoes={opcoesEstado}
        />

        <div className="grid grid-cols-[minmax(0,1fr)_152px] items-end gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-2 text-pequeno">
              <span className="whitespace-nowrap text-t3">Nota mínima</span>
              <span className="num font-medio text-t2">{nota(notaMinima)}</span>
            </div>
            <Slider
              valor={notaMinima}
              aoMudar={aoMudarNotaMinima}
              min={0}
              max={10}
              passo={0.5}
              rotulo="Nota mínima"
              textoValor={(v) => `Nota mínima ${nota(v)} de 10`}
            />
          </div>

          <Select
            rotulo="Ordenar candidatos"
            valor={ordenacao}
            aoMudar={aoMudarOrdenacao}
            opcoes={OPCOES_ORDENACAO}
            className="min-w-0"
          />
        </div>
      </div>

      {filtroZerou ? (
        <div className="flex min-h-0 flex-1">
          {selecionadoId === null ? (
            <EstadoTela
              tipo="vazio"
              compacto={false}
              titulo="Nenhum candidato corresponde aos filtros atuais"
              descricao="Altere o estado selecionado ou reduza a Nota mínima para voltar a ver os candidatos."
              acaoPrimaria={{ rotulo: 'Limpar filtros', aoAcionar: aoLimparFiltros }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center p-8">
              <div className="flex max-w-[44ch] flex-col items-start gap-3">
                <CircleDashed className="size-5 stroke-[1.5] text-t3" aria-hidden />
                <h2 className="text-titulo font-forte tracking-[-0.01em] text-balance text-t1">
                  Nenhum candidato corresponde aos filtros atuais
                </h2>
                <p className="text-t2">
                  Altere o estado selecionado ou reduza a Nota mínima para voltar a ver os candidatos.
                </p>
                <div className="mt-2 flex gap-2">
                  <Botao variante="secundario" onClick={aoLimparFiltros}>
                    Limpar filtros
                  </Botao>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <ListaVirtual<CandidatoLista>
          papel="listbox"
          ariaLabel="Candidatos a Corte"
          itens={candidatosFiltrados}
          total={candidatosFiltrados.length}
          alturaItem={56}
          selecionadoId={selecionadoId}
          aoSelecionar={aoSelecionar}
          renderizarItem={(c, _indice, selecionado) => (
            <ItemCorte
              titulo={c.title.trim() || 'Sem título'}
              inicioUs={c.startUs}
              duracaoUs={Math.max(0, c.endUs - c.startUs)}
              nota={c.total}
              decisao={DECISAO_MAPA[c.status]}
              selecionado={selecionado}
            />
          )}
          className="flex-1 px-1.5 pb-1.5"
        />
      )}
    </section>
  )
}
