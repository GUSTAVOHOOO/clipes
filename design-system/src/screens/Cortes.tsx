import { useRef, useState } from 'react'
import { ArrowDownToLine, ArrowRight, Check, CheckCheck, Search, SlidersHorizontal, X } from 'lucide-react'
import { cortes, fonte, img } from '@/data/dados'
import { useApp, type StatusCorte } from '@/lib/app'
import { cn } from '@/lib/cn'
import { useComandos } from '@/lib/comandos'
import { dur, tc, usd } from '@/lib/formato'
import { ir, useRota } from '@/lib/rota'
import { Tela, CabecalhoPagina } from '@/components/shell/Tela'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Kbd } from '@/components/ui/Kbd'
import { Segmented } from '@/components/ui/Segmented'
import { Select } from '@/components/ui/Select'
import { Status, type TomStatus } from '@/components/ui/Status'
import { avisar } from '@/components/ui/Toast'
import { EstadoLista } from '@/components/domain/EstadoLista'
import { Nota } from '@/components/domain/Nota'

const ESTADOS: Record<StatusCorte, { texto: string; tom: TomStatus }> = {
  sugerido: { texto: 'A revisar', tom: 'rascunho' },
  aprovado: { texto: 'Aprovado', tom: 'sucesso' },
  rejeitado: { texto: 'Rejeitado', tom: 'rejeitado' },
  exportado: { texto: 'Exportado', tom: 'sucesso' },
}
type Filtro = 'todos' | 'sugerido' | 'aprovado' | 'rejeitado'

export default function Cortes() {
  const { status, setStatus } = useApp()
  const { query } = useRota()
  const estado = query.get('estado')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState<'fonte' | 'nota'>('fonte')
  const [atual, setAtual] = useState(cortes[0].id)
  const [selecionados, setSelecionados] = useState<string[]>([])
  const buscaRef = useRef<HTMLInputElement>(null)
  const lista = cortes
    .filter(
      c =>
        (filtro === 'todos' || status[c.id] === filtro) &&
        c.titulo.toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR')),
    )
    .sort((a, b) => (ordem === 'nota' ? b.nota.total - a.nota.total : a.inicio - b.inicio))
  const ativo = lista.find(c => c.id === atual) ?? lista[0]
  const aprovados = cortes.filter(c => status[c.id] === 'aprovado').length
  const marcar = (id: string) => setSelecionados(s => (s.includes(id) ? s.filter(v => v !== id) : [...s, id]))
  const revisar = (id: string, novo: StatusCorte) => {
    const anterior = status[id]
    setStatus(id, novo)
    avisar.desfazer(
      novo === 'aprovado' ? 'Corte aprovado' : novo === 'rejeitado' ? 'Corte rejeitado' : 'Corte voltou para revisão',
      () => setStatus(id, anterior),
    )
  }
  const lote = (novo: StatusCorte) => {
    const antes = selecionados.map(id => [id, status[id]] as const)
    for (const id of selecionados) setStatus(id, novo)
    avisar.desfazer(`${selecionados.length} Cortes ${novo === 'aprovado' ? 'aprovados' : 'rejeitados'}`, () =>
      antes.forEach(([id, s]) => setStatus(id, s)),
    )
    setSelecionados([])
  }
  const navegar = (passo: number) => {
    if (!lista.length) return
    const i = lista.findIndex(c => c.id === ativo?.id)
    const proximo = lista[Math.max(0, Math.min(lista.length - 1, i + passo))]
    setAtual(proximo.id)
    document.getElementById(`linha-${proximo.id}`)?.scrollIntoView({ block: 'nearest' })
  }
  const explicar = () => {
    const nota = document.querySelector<HTMLDetailsElement>(`#linha-${ativo?.id} details`)
    if (nota) nota.open = !nota.open
  }
  useComandos([
    { id: 'cortes-proximo', titulo: 'Próximo Corte', grupo: 'Revisar', atalho: 'J', executar: () => navegar(1) },
    { id: 'cortes-anterior', titulo: 'Corte anterior', grupo: 'Revisar', atalho: 'K', executar: () => navegar(-1) },
    {
      id: 'cortes-aprovar',
      titulo: 'Aprovar Corte atual',
      grupo: 'Revisar',
      atalho: 'A',
      desabilitado: !ativo,
      executar: () => ativo && revisar(ativo.id, 'aprovado'),
    },
    {
      id: 'cortes-rejeitar',
      titulo: 'Rejeitar Corte atual',
      grupo: 'Revisar',
      atalho: 'X',
      desabilitado: !ativo,
      executar: () => ativo && revisar(ativo.id, 'rejeitado'),
    },
    {
      id: 'cortes-marcar',
      titulo: 'Selecionar Corte atual para lote',
      grupo: 'Revisar',
      atalho: 'Space',
      desabilitado: !ativo,
      executar: () => ativo && marcar(ativo.id),
    },
    {
      id: 'cortes-editar',
      titulo: 'Editar Corte atual',
      grupo: 'Revisar',
      atalho: 'Enter',
      desabilitado: !ativo,
      executar: () => ativo && ir(`/corte/${ativo.id}/editar`),
    },
    {
      id: 'cortes-buscar',
      titulo: 'Buscar Corte',
      grupo: 'Cortes',
      atalho: 'F',
      executar: () => buscaRef.current?.focus(),
    },
    {
      id: 'cortes-nota',
      titulo: 'Mostrar ou recolher os 5 eixos da Nota',
      grupo: 'Revisar',
      atalho: 'I',
      executar: explicar,
      desabilitado: !ativo,
    },
    {
      id: 'cortes-todos',
      titulo: 'Selecionar todos os Cortes visíveis',
      grupo: 'Cortes',
      executar: () => setSelecionados(lista.map(c => c.id)),
      desabilitado: !lista.length,
    },
    {
      id: 'cortes-limpar',
      titulo: 'Limpar seleção de Cortes',
      grupo: 'Cortes',
      executar: () => setSelecionados([]),
      desabilitado: !selecionados.length,
    },
    {
      id: 'cortes-exportar',
      titulo: 'Exportar Cortes aprovados',
      grupo: 'Cortes',
      atalho: 'Ctrl+E',
      desabilitado: !aprovados,
      executar: () => ir('/exportar'),
    },
    {
      id: 'cortes-aprovar-lote',
      titulo: 'Aprovar selecionados',
      grupo: 'Cortes',
      atalho: 'Shift+A',
      desabilitado: !selecionados.length,
      executar: () => lote('aprovado'),
    },
    {
      id: 'cortes-rejeitar-lote',
      titulo: 'Rejeitar selecionados',
      grupo: 'Cortes',
      atalho: 'Shift+X',
      desabilitado: !selecionados.length,
      executar: () => lote('rejeitado'),
    },
  ])

  return (
    <Tela
      titulo="Cortes"
      direita={
        <Button
          variante="primario"
          icone={<ArrowDownToLine size={14} />}
          atalho="Ctrl+E"
          disabled={!aprovados}
          onClick={() => ir('/exportar')}
        >
          Exportar aprovados · {aprovados}
        </Button>
      }
      className="overflow-auto"
    >
      <div className="mx-auto max-w-[1200px] px-10 py-8">
        <CabecalhoPagina
          titulo="Cortes"
          descricao={fonte.nome}
          acoes={
            <span className="text-xs text-fg-3">
              {dur(fonte.duracao)} de Fonte · {cortes.length} sugestões
            </span>
          }
        />
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
          <Segmented
            valor={filtro}
            onChange={setFiltro}
            rotulo="Filtrar Cortes"
            opcoes={[
              { valor: 'todos', rotulo: 'Todos' },
              { valor: 'sugerido', rotulo: 'A revisar' },
              { valor: 'aprovado', rotulo: 'Aprovados' },
              { valor: 'rejeitado', rotulo: 'Rejeitados' },
            ]}
          />
          <div className="flex gap-2">
            <Input
              ref={buscaRef}
              aria-label="Buscar Cortes"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              prefixo={<Search size={14} />}
              sufixo={<Kbd atalho="F" />}
              placeholder="Buscar Corte"
              className="w-56"
            />
            <Select
              valor={ordem}
              onChange={setOrdem}
              rotulo="Ordenar Cortes"
              tamanho="md"
              opcoes={[
                { valor: 'fonte', rotulo: 'Ordem da Fonte', icone: <SlidersHorizontal size={13} /> },
                { valor: 'nota', rotulo: 'Maior Nota' },
              ]}
            />
          </div>
        </div>
        {selecionados.length > 0 && (
          <div
            role="region"
            aria-label="Ações em lote"
            className="mt-3 flex items-center gap-3 rounded-md bg-field px-3 py-2 text-xs"
          >
            <span className="mr-auto">{selecionados.length} selecionados</span>
            <Button tamanho="sm" icone={<CheckCheck size={14} />} atalho="Shift+A" onClick={() => lote('aprovado')}>
              Aprovar selecionados
            </Button>
            <Button tamanho="sm" variante="fantasma" atalho="Shift+X" onClick={() => lote('rejeitado')}>
              Rejeitar selecionados
            </Button>
            <Button tamanho="sm" variante="fantasma" onClick={() => setSelecionados([])}>
              Limpar seleção
            </Button>
          </div>
        )}
        {estado || !lista.length ? (
          <EstadoLista
            estado={estado}
            titulo={
              estado === 'erro'
                ? 'Não foi possível carregar os Cortes'
                : estado === 'vazio'
                  ? 'A Fonte ainda não tem Cortes'
                  : 'Nenhum Corte neste filtro'
            }
            descricao={
              estado === 'erro'
                ? 'A Transcrição pode estar indisponível. Tente novamente ou confira a fila de Fontes.'
                : estado === 'vazio'
                  ? 'Importe uma Fonte. Os Cortes sugeridos aparecem aqui depois da Transcrição e da seleção.'
                  : 'Troque o filtro ou busque por outro título.'
            }
            acao={
              estado === 'erro'
                ? 'Tentar de novo'
                : estado === 'vazio'
                  ? 'Ir para Fontes'
                  : estado !== 'carregando'
                    ? 'Limpar filtros'
                    : undefined
            }
            onAcao={() => {
              if (estado === 'vazio') ir('/fontes')
              else if (estado === 'erro') ir('/cortes')
              else {
                setBusca('')
                setFiltro('todos')
              }
            }}
          />
        ) : (
          <div className="divide-y divide-line">
            {lista.map(c => {
              const st = ESTADOS[status[c.id]]
              return (
                <article
                  id={`linha-${c.id}`}
                  key={c.id}
                  aria-label={c.titulo}
                  className={cn(
                    'relative -mx-3 flex gap-4 rounded-md px-3 py-5 transition-colors duration-(--dur-fast)',
                    ativo?.id === c.id && 'bg-surface',
                  )}
                  onFocus={() => setAtual(c.id)}
                  onMouseDown={() => setAtual(c.id)}
                >
                  <label className="flex h-20 w-6 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${c.titulo}`}
                      className="foco size-4 accent-(--primary)"
                      checked={selecionados.includes(c.id)}
                      onChange={() => marcar(c.id)}
                    />
                  </label>
                  <button
                    type="button"
                    className="foco relative h-20 w-36 shrink-0 overflow-hidden rounded-md"
                    aria-label={`Editar ${c.titulo}`}
                    onClick={() => ir(`/corte/${c.id}/editar`)}
                  >
                    <img src={img(c.wide)} alt="" className="h-full w-full object-cover" />
                    <span className="timecode absolute bottom-1 right-1 rounded-xs bg-letterbox px-1 py-0.5 text-2xs text-white">
                      {dur(c.fim - c.inicio)}
                    </span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-3">
                      <h2 className="text-md font-medium">{c.titulo}</h2>
                      <span className="timecode shrink-0 text-2xs text-fg-3">
                        {tc(c.inicio)} → {tc(c.fim)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-fg-3">{c.frases[0]?.texto}</p>
                    <Nota corte={c} />
                  </div>
                  <div className="flex w-44 shrink-0 flex-col items-end gap-3">
                    <Status tom={st.tom}>{st.texto}</Status>
                    <div className="flex items-center gap-1">
                      <Button
                        tamanho="sm"
                        variante="fantasma"
                        icone={<Check size={14} />}
                        aria-label={`Aprovar ${c.titulo}`}
                        disabled={status[c.id] === 'aprovado'}
                        onClick={() => revisar(c.id, 'aprovado')}
                      >
                        Aprovar
                      </Button>
                      <Button
                        tamanho="sm"
                        variante="fantasma"
                        icone={<X size={14} />}
                        aria-label={`Rejeitar ${c.titulo}`}
                        disabled={status[c.id] === 'rejeitado'}
                        onClick={() => revisar(c.id, 'rejeitado')}
                      >
                        Rejeitar
                      </Button>
                    </div>
                    <Button
                      tamanho="sm"
                      variante="fantasma"
                      icone={<ArrowRight size={13} />}
                      onClick={() => ir(`/corte/${c.id}/editar`)}
                    >
                      Editar
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
        <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-xs text-fg-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5">
              <Kbd atalho="J" />
              <Kbd atalho="K" /> Navegar
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd atalho="A" /> Aprovar
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd atalho="X" /> Rejeitar
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd atalho="Enter" /> Editar
            </span>
          </div>
          <span>Estimativa de seleção: {usd(0.04)} · demonstração</span>
        </footer>
      </div>
    </Tela>
  )
}
