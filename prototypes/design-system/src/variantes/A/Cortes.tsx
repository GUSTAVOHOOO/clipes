// Cortes, Variante A ("Estúdio"): tabela densa + painel lateral com as justificativas da Nota.
import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, Check, X, SquarePen, Package } from 'lucide-react'
import { toast } from 'sonner'
import { cortes, fonte, img, tc, duracao, type Corte } from '../../dados'
import type { Tela } from '../../App'
import { BarraNota, Botao, Segmentado, Topo, dur, foco, num } from './ui'

type Estado = 'sugerido' | 'aprovado' | 'rejeitado'
type Filtro = 'todos' | Estado
const CUSTO = 0.01 // Empacotamento (título, descrição, hashtags) pelo Provedor, por Corte
const usd = (v: number) => `US$ ${num(v, 2)}`

function EstadoPill({ e }: { e: Estado }) {
  const m = {
    sugerido: { nome: 'Sugerido', cls: 'text-[var(--a-tx2)] border-[var(--a-ln2)]', icone: <span className="w-1.5 h-1.5 rounded-full border border-[var(--a-tx3)]" /> },
    aprovado: { nome: 'Aprovado', cls: 'text-[var(--a-tx)] border-[var(--a-tx3)] bg-[var(--a-s3)]', icone: <Check size={12} strokeWidth={2.5} /> },
    rejeitado: { nome: 'Rejeitado', cls: 'text-[var(--a-tx3)] border-[var(--a-ln)]', icone: <X size={12} /> },
  }[e]
  return <span className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-full border text-[12px] ${m.cls}`}>{m.icone}{m.nome}</span>
}

function MiniEixos({ c }: { c: Corte }) {
  return (
    <span className="flex items-end gap-[3px] h-[18px]" aria-label={c.nota.eixos.map(x => `${x.nome} ${x.valor}`).join(', ')}>
      {c.nota.eixos.map(x => (
        <span key={x.nome} title={`${x.nome}: ${x.valor}`} className="relative w-[5px] h-full rounded-[1.5px] bg-[var(--a-s3)] overflow-hidden">
          <span className="absolute inset-x-0 bottom-0 bg-[var(--a-tx2)]" style={{ height: `${x.valor * 10}%` }} />
        </span>
      ))}
    </span>
  )
}

export default function Cortes({ tela, irPara }: { tela: Tela; irPara: (t: Tela) => void }) {
  const [estados, setEstados] = useState<Record<string, Estado>>({ c1: 'aprovado' })
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [aberto, setAberto] = useState<string>('c1')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [ordem, setOrdem] = useState<'nota' | 'fonte'>('nota')

  const est = (c: Corte) => estados[c.id] ?? 'sugerido'
  const conta = (f: Filtro) => (f === 'todos' ? cortes.length : cortes.filter(c => est(c) === f).length)
  const linhas = useMemo(() => {
    const l = cortes.filter(c => filtro === 'todos' || (estados[c.id] ?? 'sugerido') === filtro)
    return [...l].sort((a, b) => (ordem === 'nota' ? b.nota.total - a.nota.total : a.inicio - b.inicio))
  }, [filtro, ordem, estados])

  const definir = (ids: string[], e: Estado) => setEstados(m => ({ ...m, ...Object.fromEntries(ids.map(id => [id, e])) }))
  const alternarMarca = (id: string) => setMarcados(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const todosMarcados = linhas.length > 0 && linhas.every(c => marcados.has(c.id))

  const aprovados = cortes.filter(c => est(c) === 'aprovado')
  const lote = marcados.size ? cortes.filter(c => marcados.has(c.id)) : aprovados
  const atual = cortes.find(c => c.id === aberto)

  const exportar = () => toast(`Exportando ${lote.length} ${lote.length === 1 ? 'Corte' : 'Cortes'}`, { description: `Empacotamento pelo Provedor: ${usd(lote.length * CUSTO)}` })
  const col = 'grid grid-cols-[40px_76px_minmax(0,1fr)_76px_128px_64px_116px_100px] items-center'

  return (
    <div className="h-full flex flex-col">
      <Topo tela={tela} irPara={irPara} />
      <div className="flex-1 min-h-0 flex">
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-end justify-between gap-6 px-6 pt-6 pb-4">
            <div className="min-w-0">
              <h1 className="text-[20px] font-semibold tracking-[-0.015em]">Cortes sugeridos</h1>
              <p className="mt-1 text-[13px] text-[var(--a-tx3)] truncate">{cortes.length} Cortes de {fonte.nome}, com Nota do Provedor</p>
            </div>
            <Segmentado<Filtro> rotulo="Filtrar por estado" valor={filtro} onChange={setFiltro} opcoes={(['todos', 'sugerido', 'aprovado', 'rejeitado'] as Filtro[]).map(f => ({
              v: f, nome: <>{{ todos: 'Todos', sugerido: 'Sugeridos', aprovado: 'Aprovados', rejeitado: 'Rejeitados' }[f]} <span className="text-[var(--a-tx3)] ml-0.5">{conta(f)}</span></>,
            }))} />
          </div>

          {/* ações em lote */}
          <div className="h-12 shrink-0 flex items-center gap-2 px-6 border-y border-[var(--a-ln)] bg-[var(--a-s1)]">
            <span className="text-[13px] text-[var(--a-tx2)] mr-2 tabular">
              {marcados.size ? `${marcados.size} ${marcados.size === 1 ? 'selecionado' : 'selecionados'}` : 'Marque Cortes para agir em lote'}
            </span>
            <Botao disabled={!marcados.size} onClick={() => { definir([...marcados], 'aprovado'); setMarcados(new Set()) }}><Check size={14} /> Aprovar</Botao>
            <Botao disabled={!marcados.size} onClick={() => { definir([...marcados], 'rejeitado'); setMarcados(new Set()) }}><X size={14} /> Rejeitar</Botao>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-[12px] text-[var(--a-tx3)] tabular inline-flex items-center gap-1.5">
                <Package size={13} /> Empacotamento pelo Provedor <span className="font-mono text-[var(--a-tx)]">{usd(lote.length * CUSTO)}</span>
              </span>
              <Botao tipo="primario" disabled={!lote.length} onClick={exportar}>
                {marcados.size ? `Exportar ${lote.length} ${lote.length === 1 ? 'Corte' : 'Cortes'}` : `Exportar aprovados (${lote.length})`}
              </Botao>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto px-6 pb-16" role="table" aria-label="Cortes">
            <div role="row" className={`${col} h-9 text-[12px] text-[var(--a-tx3)] border-b border-[var(--a-ln)]`}>
              <span role="columnheader" className="pl-1">
                <input type="checkbox" aria-label="Marcar todos" checked={todosMarcados}
                  onChange={() => setMarcados(todosMarcados ? new Set() : new Set(linhas.map(c => c.id)))}
                  className={`w-3.5 h-3.5 accent-[var(--a-tx)] ${foco}`} />
              </span>
              <span role="columnheader" className="col-span-2">
                <button onClick={() => setOrdem('fonte')} className={`inline-flex items-center gap-1 hover:text-[var(--a-tx2)] ${foco} ${ordem === 'fonte' ? 'text-[var(--a-tx2)]' : ''}`}>
                  Corte {ordem === 'fonte' && <ArrowDown size={12} />}
                </button>
              </span>
              <span role="columnheader">Duração</span>
              <span role="columnheader">
                <button onClick={() => setOrdem('nota')} className={`inline-flex items-center gap-1 hover:text-[var(--a-tx2)] ${foco} ${ordem === 'nota' ? 'text-[var(--a-tx2)]' : ''}`}>
                  Nota {ordem === 'nota' && <ArrowDown size={12} />}
                </button>
              </span>
              <span role="columnheader" title="Gancho, Autossuficiência, Emoção/energia, Valor, Fechamento">Eixos</span>
              <span role="columnheader">Estado</span>
              <span role="columnheader" className="sr-only">Ações</span>
            </div>

            {linhas.length === 0 && (
              <p className="py-10 text-center text-[13px] text-[var(--a-tx3)]">
                Nenhum Corte {({ sugerido: 'sugerido', aprovado: 'aprovado', rejeitado: 'rejeitado' } as Record<string, string>)[filtro]} ainda.{' '}
                <button className={`underline underline-offset-2 hover:text-[var(--a-tx2)] ${foco}`} onClick={() => setFiltro('todos')}>Ver todos</button>
              </p>
            )}

            {linhas.map(c => {
              const e = est(c)
              const on = c.id === aberto
              return (
                <div key={c.id} role="row" aria-selected={on} onClick={() => setAberto(c.id)}
                  className={`group relative ${col} h-[52px] border-b border-[var(--a-ln)] cursor-default ${on ? 'bg-[var(--a-s2)]' : 'hover:bg-[var(--a-s1)]'} ${e === 'rejeitado' ? 'text-[var(--a-tx3)]' : ''}`}>
                  {on && <span className="absolute -left-6 top-0 bottom-0 w-[2px] bg-[var(--a-acc)]" />}
                  <span role="cell" className="pl-1" onClick={ev => ev.stopPropagation()}>
                    <input type="checkbox" aria-label={`Marcar ${c.titulo}`} checked={marcados.has(c.id)} onChange={() => alternarMarca(c.id)}
                      className={`w-3.5 h-3.5 accent-[var(--a-tx)] ${foco}`} />
                  </span>
                  <span role="cell">
                    <img src={img(c.thumbs[3])} alt="" className={`w-16 h-9 rounded-[3px] object-cover bg-[var(--a-s3)] ${e === 'rejeitado' ? 'opacity-45 grayscale' : ''}`} />
                  </span>
                  <span role="cell" className="min-w-0 pr-4">
                    <button onClick={() => setAberto(c.id)} className={`block max-w-full text-left text-[13px] font-medium truncate ${foco} ${e === 'rejeitado' ? 'text-[var(--a-tx3)]' : 'text-[var(--a-tx)]'}`}>{c.titulo}</button>
                    <span className="block text-[11.5px] text-[var(--a-tx3)] font-mono tabular truncate">{tc(c.inicio)} a {tc(c.fim)} na Fonte</span>
                  </span>
                  <span role="cell" className="font-mono tabular text-[12.5px] text-[var(--a-tx2)]">{tc(duracao(c))}</span>
                  <span role="cell" className="flex items-center gap-2.5">
                    <span className="w-7 text-[13px] font-medium tabular text-[var(--a-tx)]">{num(c.nota.total)}</span>
                    <BarraNota valor={c.nota.total} largura={52} />
                  </span>
                  <span role="cell"><MiniEixos c={c} /></span>
                  <span role="cell"><EstadoPill e={e} /></span>
                  <span role="cell" className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 focus-within:opacity-100" onClick={ev => ev.stopPropagation()}>
                    <IconeAcao rotulo="Aprovar" onClick={() => definir([c.id], 'aprovado')} ativo={e === 'aprovado'}><Check size={15} /></IconeAcao>
                    <IconeAcao rotulo="Rejeitar" onClick={() => definir([c.id], 'rejeitado')} ativo={e === 'rejeitado'}><X size={15} /></IconeAcao>
                    <IconeAcao rotulo="Abrir no editor" onClick={() => irPara('editor')}><SquarePen size={14} /></IconeAcao>
                  </span>
                </div>
              )
            })}
          </div>
        </main>

        {atual && <PainelNota c={atual} e={est(atual)} onEstado={x => definir([atual.id], x)} onAbrir={() => irPara('editor')} onFechar={() => setAberto('')} />}
      </div>
    </div>
  )
}

function IconeAcao({ children, rotulo, onClick, ativo }: { children: ReactNode; rotulo: string; onClick: () => void; ativo?: boolean }) {
  return (
    <button aria-label={rotulo} title={rotulo} onClick={onClick} aria-pressed={ativo}
      className={`w-7 h-7 grid place-items-center rounded-[5px] ${foco} ${ativo ? 'text-[var(--a-tx)] bg-[var(--a-s3)]' : 'text-[var(--a-tx2)] hover:text-[var(--a-tx)] hover:bg-[var(--a-s3)]'}`}>
      {children}
    </button>
  )
}

function PainelNota({ c, e, onEstado, onAbrir, onFechar }: { c: Corte; e: Estado; onEstado: (e: Estado) => void; onAbrir: () => void; onFechar: () => void }) {
  const ord = [...c.nota.eixos].sort((a, b) => b.valor - a.valor)
  const fortes = ord.filter(x => x.valor === ord[0].valor).map(x => x.nome)
  const fraco = ord[ord.length - 1]
  return (
    <aside className="w-[380px] shrink-0 border-l border-[var(--a-ln)] bg-[var(--a-s1)] flex flex-col" aria-label={`Nota de ${c.titulo}`}>
      <div className="h-11 shrink-0 flex items-center justify-between pl-5 pr-2 border-b border-[var(--a-ln)]">
        <span className="text-[13px] font-medium">Por que esta Nota</span>
        <button onClick={onFechar} aria-label="Fechar painel" className={`w-7 h-7 grid place-items-center rounded-[5px] text-[var(--a-tx3)] hover:text-[var(--a-tx)] hover:bg-[var(--a-s2)] ${foco}`}><X size={15} /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="p-5 pb-4">
          <img src={img(c.wide)} alt={`Quadro de ${c.titulo}`} className="w-full aspect-video object-cover rounded-[4px] bg-black" />
          <h2 className="mt-4 text-[15px] font-medium leading-[1.35]">{c.titulo}</h2>
          <p className="mt-1 text-[12px] text-[var(--a-tx3)] tabular">{dur(duracao(c))}, de <span className="font-mono">{tc(c.inicio)}</span> a <span className="font-mono">{tc(c.fim)}</span> na Fonte</p>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-[30px] leading-none font-semibold tracking-[-0.02em] tabular">{num(c.nota.total)}</span>
            <span className="text-[13px] text-[var(--a-tx3)]">de 10</span>
          </div>
          <p className="mt-2 text-[12.5px] text-[var(--a-tx2)] leading-[1.5]">
            {c.nota.resumo ?? `Mais forte em ${fortes.join(' e ')}. O ponto fraco é ${fraco.nome} (${fraco.valor}).`}
          </p>
        </div>
        <ul className="px-5 pb-5 flex flex-col gap-4">
          {c.nota.eixos.map(x => (
            <li key={x.nome}>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-[var(--a-tx)]">{x.nome}</span>
                <span className="font-medium tabular">{x.valor}</span>
              </div>
              <div className="mt-1.5"><BarraNota valor={x.valor} largura={340} /></div>
              <p className="mt-1.5 text-[12.5px] leading-[1.5] text-[var(--a-tx2)]">{x.justificativa}</p>
            </li>
          ))}
        </ul>
      </div>
      <div className="shrink-0 flex items-center gap-2 p-4 border-t border-[var(--a-ln)]">
        <Botao aria-pressed={e === 'rejeitado'} onClick={() => onEstado('rejeitado')}><X size={14} /> Rejeitar</Botao>
        <Botao aria-pressed={e === 'aprovado'} onClick={() => onEstado('aprovado')}><Check size={14} /> {e === 'aprovado' ? 'Aprovado' : 'Aprovar'}</Botao>
        <Botao tipo="primario" className="ml-auto" onClick={onAbrir}><SquarePen size={14} /> Abrir no editor</Botao>
      </div>
    </aside>
  )
}
