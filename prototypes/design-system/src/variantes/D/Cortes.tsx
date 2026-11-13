// Variante D · "Comando": lista de Cortes no estilo de paleta, com painel de detalhe e linha de status.
import { useRef, useState, type KeyboardEvent as KE } from 'react'
import { Check, Circle, Search, X } from 'lucide-react'
import { cortes, duracao, fonte, img, tc, type Corte } from '../../dados'
import type { PropsVariante } from '../../App'
import { Barra, Kbd, Paleta, Primario, foco, memo, num, useD, useTeclas, type Cmd } from './comum'

const CUSTO_POR_CORTE = 0.02
const plural = (n: number, p: string) => `${n} ${p}${n === 1 ? '' : 's'}`

function trecho(c: Corte, q: string) {
  if (!q) return null
  const f = c.frases.find(f => f.texto.toLowerCase().includes(q))
  if (!f) return null
  const i = f.texto.toLowerCase().indexOf(q)
  const a = Math.max(0, i - 18)
  return { pre: (a > 0 ? '…' : '') + f.texto.slice(a, i), hit: f.texto.slice(i, i + q.length), pos: f.texto.slice(i + q.length, i + q.length + 28) }
}

export default function Cortes({ irPara }: PropsVariante) {
  const { avisar } = useD()
  const [status, setStatus] = useState({ ...memo.status })
  const [q, setQ] = useState('')
  const [selId, setSelId] = useState(cortes[memo.corte].id)
  const busca = useRef<HTMLInputElement>(null)

  const ql = q.trim().toLowerCase()
  const lista = cortes.filter(c => !ql || c.titulo.toLowerCase().includes(ql) || c.frases.some(f => f.texto.toLowerCase().includes(ql)))
  const sel = lista.find(c => c.id === selId) ?? lista[0]
  const aprovados = cortes.filter(c => status[c.id] === 'aprovado')
  const rejeitados = cortes.filter(c => status[c.id] === 'rejeitado')

  const marcar = (c: Corte | undefined, v: 'aprovado' | 'rejeitado') => {
    if (!c) return
    const novo = status[c.id] === v ? undefined : v
    const s = { ...status, [c.id]: novo }
    setStatus(s); memo.status = s
    avisar(novo ? `“${c.titulo}” ${novo}` : `“${c.titulo}” voltou para pendente`)
  }
  const abrir = (c: Corte | undefined) => { if (!c) return; memo.corte = cortes.indexOf(c); irPara('editor') }
  const mover = (d: number) => {
    if (!lista.length) return
    const i = Math.max(0, lista.findIndex(c => c.id === sel?.id))
    setSelId(lista[(i + d + lista.length) % lista.length].id)
  }
  const custo = aprovados.length * CUSTO_POR_CORTE
  const exportarLote = () => aprovados.length
    ? avisar(`Exportando ${aprovados.length} Cortes aprovados (US$ ${num(custo, 2)})`)
    : avisar('Aprove ao menos um Corte para exportar o lote')

  useTeclas(e => {
    const k = e.key, ctrl = e.ctrlKey || e.metaKey
    if (ctrl && k.toLowerCase() === 'e') { e.preventDefault(); return exportarLote() }
    if (ctrl) return
    if (k === '/') { e.preventDefault(); return busca.current?.focus() }
    if (k === 'ArrowDown' || k.toLowerCase() === 'j') { e.preventDefault(); return mover(1) }
    if (k === 'ArrowUp' || k.toLowerCase() === 'k') { e.preventDefault(); return mover(-1) }
    if (k.toLowerCase() === 'a') return marcar(sel, 'aprovado')
    if (k.toLowerCase() === 'r') return marcar(sel, 'rejeitado')
    if (k === 'Enter' && !(e.target as HTMLElement).closest('button')) return abrir(sel)
  })
  const teclasBusca = (e: KE<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); mover(1) }
    if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1) }
    if (e.key === 'Enter') { e.preventDefault(); abrir(sel) }
    if (e.key === 'Escape') { e.preventDefault(); q ? setQ('') : busca.current?.blur() }
  }

  const comandos: Cmd[] = [
    { id: 'apr', grupo: 'Corte selecionado', rotulo: 'Aprovar Corte', tecla: ['A'], acao: () => marcar(sel, 'aprovado') },
    { id: 'rej', grupo: 'Corte selecionado', rotulo: 'Rejeitar Corte', tecla: ['R'], acao: () => marcar(sel, 'rejeitado') },
    { id: 'abr', grupo: 'Corte selecionado', rotulo: 'Abrir no editor', tecla: ['Enter'], acao: () => abrir(sel) },
    { id: 'lote', grupo: 'Lote', rotulo: `Exportar aprovados (${aprovados.length})`, tecla: ['Ctrl', 'E'], acao: exportarLote },
    { id: 'apr-todos', grupo: 'Lote', rotulo: 'Aprovar todos com Nota 7 ou mais', palavras: ['lote'], acao: () => {
      const s = { ...status }; cortes.forEach(c => { if (c.nota.total >= 7 && s[c.id] !== 'rejeitado') s[c.id] = 'aprovado' })
      setStatus(s); memo.status = s; avisar('Cortes com Nota 7 ou mais aprovados')
    } },
    { id: 'filtrar', grupo: 'Lote', rotulo: 'Filtrar pela Transcrição', tecla: ['/'], acao: () => setTimeout(() => busca.current?.focus()) },
  ]

  return (
    <>
      <Barra migalhas={[{ rotulo: 'Canal dark · Ficção', ir: () => irPara('importar') }, { rotulo: fonte.nome }]}
        direita={<span className="text-[12px] text-neutral-500">Sugeridos pelo Provedor</span>} />

      <main className="flex-1 min-h-0 grid grid-cols-[minmax(400px,540px)_1fr]">
        {/* Lista */}
        <section className="min-h-0 flex flex-col border-r border-neutral-200" aria-label="Cortes">
          <label className="h-12 shrink-0 flex items-center gap-2.5 px-4 border-b border-neutral-200">
            <Search size={15} strokeWidth={1.75} className="text-neutral-500" />
            <input ref={busca} value={q} onChange={e => setQ(e.target.value)} onKeyDown={teclasBusca}
              aria-label="Filtrar Cortes pela Transcrição" placeholder="Filtrar pela Transcrição"
              className="flex-1 h-full bg-transparent outline-none text-[14px] placeholder:text-neutral-500" />
            {q ? <button onClick={() => setQ('')} className={`text-[12px] text-neutral-500 hover:text-neutral-950 rounded-[3px] ${foco}`}>limpar</button> : <Kbd k={['/']} />}
          </label>
          <div className="h-8 shrink-0 flex items-center gap-3 px-4 text-[11.5px] text-neutral-500">
            <span className="flex-1 flex gap-3 min-w-0 truncate">
              <span>{ql ? `${lista.length} de ${cortes.length} Cortes` : `${cortes.length} Cortes`}</span>
              <span className="text-neutral-400" aria-hidden>/</span>
              <span>{plural(aprovados.length, 'aprovado')}</span>
              <span>{plural(rejeitados.length, 'rejeitado')}</span>
            </span>
            <span className="w-14 text-right">duração</span>
            <span className="w-10 text-right">Nota</span>
          </div>
          <ul role="listbox" aria-label="Cortes sugeridos" className="flex-1 min-h-0 overflow-y-auto px-2">
            {lista.map(c => {
              const ativo = c.id === sel?.id
              const st = status[c.id]
              const tr = trecho(c, ql)
              return (
                <li key={c.id} role="option" aria-selected={ativo}
                  onClick={() => setSelId(c.id)} onDoubleClick={() => abrir(c)}
                  className={`group h-10 flex items-center gap-3 px-2.5 rounded-[6px] cursor-default ${ativo ? 'bg-neutral-950 text-white' : 'hover:bg-neutral-50'}`}>
                  <span className={`w-4 grid place-items-center ${ativo ? 'text-white' : st ? 'text-neutral-950' : 'text-neutral-300'}`} aria-label={st ?? 'pendente'}>
                    {st === 'aprovado' ? <Check size={14} strokeWidth={2.25} /> : st === 'rejeitado' ? <X size={14} strokeWidth={2.25} /> : <Circle size={9} strokeWidth={2} />}
                  </span>
                  <span className="flex-1 min-w-0 flex items-baseline gap-2.5">
                    <span className={`truncate text-[13.5px] ${st === 'rejeitado' ? `line-through ${ativo ? 'text-white/70' : 'text-neutral-500'}` : ''}`}>{c.titulo}</span>
                    {tr && (
                      <span className={`truncate font-mono text-[11px] ${ativo ? 'text-white/65' : 'text-neutral-500'}`}>
                        {tr.pre}<mark className={`bg-transparent underline underline-offset-2 ${ativo ? 'text-white' : 'text-neutral-950'}`}>{tr.hit}</mark>{tr.pos}
                      </span>
                    )}
                  </span>
                  <span className={`w-14 text-right font-mono text-[12px] tabular-nums ${ativo ? 'text-white/75' : 'text-neutral-600'}`}>{tc(duracao(c), true)}</span>
                  <span className="w-10 text-right font-mono text-[12px] tabular-nums font-medium">{num(c.nota.total)}</span>
                </li>
              )
            })}
            {!lista.length && (
              <li className="px-3 py-10 text-center text-neutral-500 leading-relaxed">
                Nenhum Corte fala “{q}” na Transcrição.<br />
                <span className="inline-flex items-center gap-1.5 mt-1"><Kbd k={['Esc']} /> limpa a busca</span>
              </li>
            )}
          </ul>
          <div className="shrink-0 flex items-center gap-4 px-4 h-9 border-t border-neutral-200 text-[11.5px] text-neutral-500">
            <span className="flex items-center gap-1.5"><Kbd k={['↑', '↓']} /> mover</span>
            <span className="flex items-center gap-1.5"><Kbd k={['A']} /> aprovar</span>
            <span className="flex items-center gap-1.5"><Kbd k={['R']} /> rejeitar</span>
            <span className="flex items-center gap-1.5"><Kbd k={['Enter']} /> abrir</span>
          </div>
        </section>

        {/* Detalhe */}
        <section className="min-h-0 overflow-y-auto" aria-label="Detalhe do Corte">
          {sel ? <Detalhe c={sel} st={status[sel.id]} marcar={v => marcar(sel, v)} abrir={() => abrir(sel)} /> : (
            <div className="h-full grid place-items-center text-neutral-500">Selecione um Corte na lista.</div>
          )}
        </section>
      </main>

      {/* Linha de status: lote à esquerda, custo à direita, centro livre */}
      <footer className="h-11 shrink-0 flex items-center gap-4 px-4 border-t border-neutral-200 text-[12px]">
        <Primario tecla={['Ctrl', 'E']} onClick={exportarLote} disabled={!aprovados.length}>Exportar aprovados ({aprovados.length})</Primario>
                <span className="flex-1" />
        <span className="text-neutral-500">Custo do Provedor no lote</span>
        <span className="font-mono tabular-nums font-medium">US$ {num(custo, 2)}</span>
      </footer>

      <Paleta comandos={comandos} tela="cortes" irPara={irPara} irCorte={i => abrir(cortes[i])} />
    </>
  )
}

function Detalhe({ c, st, marcar, abrir }: { c: Corte; st?: 'aprovado' | 'rejeitado'; marcar: (v: 'aprovado' | 'rejeitado') => void; abrir: () => void }) {
  return (
    <article className="max-w-[760px] px-8 py-7">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-7 items-start">
        <div className="relative aspect-video rounded-[6px] overflow-hidden bg-neutral-100 ring-1 ring-neutral-200">
          <img src={img(c.wide)} alt={`Quadro do Corte “${c.titulo}”`} className="absolute inset-0 size-full object-cover" />
          <span className="absolute left-2 bottom-2 h-5 px-1.5 rounded-[4px] bg-neutral-950 text-white font-mono text-[10.5px] tabular-nums inline-flex items-center">
            {tc(c.inicio)}–{tc(c.fim)}
          </span>
        </div>
        <div className="min-w-0 flex flex-col gap-4">
          <div>
            <h2 className="text-[19px] leading-[1.25] font-semibold tracking-[-0.01em] text-balance">{c.titulo}</h2>
            <p className="mt-1.5 flex gap-3 font-mono text-[12px] tabular-nums text-neutral-500"><span>{num(duracao(c))} s</span><span>{c.frases.length} Frases</span></p>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[34px] leading-none font-medium tabular-nums tracking-[-0.03em]">{num(c.nota.total)}</span>
            <span className="font-mono text-[13px] text-neutral-500">/10</span>
            <span className="ml-2 text-[12px] text-neutral-500">Nota do Provedor</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Acao ativo={st === 'aprovado'} tecla="A" onClick={() => marcar('aprovado')}>{st === 'aprovado' ? 'Aprovado' : 'Aprovar'}</Acao>
            <Acao ativo={st === 'rejeitado'} tecla="R" onClick={() => marcar('rejeitado')}>{st === 'rejeitado' ? 'Rejeitado' : 'Rejeitar'}</Acao>
            <Primario tecla={['Enter']} onClick={abrir}>Abrir no editor</Primario>
          </div>
        </div>
      </div>

      <h3 className="mt-8 mb-1 text-[12px] text-neutral-500">Eixos da Nota</h3>
      <dl className="divide-y divide-neutral-200 border-y border-neutral-200">
        {c.nota.eixos.map(e => (
          <div key={e.nome} className="py-3 grid grid-cols-[150px_minmax(0,1fr)] gap-x-6 gap-y-1">
            <dt className="text-[13px] flex items-baseline justify-between gap-2">
              {e.nome}<span className="font-mono text-[12px] tabular-nums">{e.valor}</span>
            </dt>
            <dd className="row-span-2 text-[12.5px] leading-[1.5] text-neutral-600 text-pretty">{e.justificativa}</dd>
            <span className="h-[2px] mt-1 bg-neutral-200 rounded-full overflow-hidden" aria-hidden>
              <span className="block h-full bg-neutral-950" style={{ width: `${e.valor * 10}%` }} />
            </span>
          </div>
        ))}
      </dl>
    </article>
  )
}

function Acao({ children, tecla, ativo, onClick }: { children: string; tecla: string; ativo?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={ativo}
      className={`h-7 inline-flex items-center gap-2 pl-3 pr-1.5 rounded-[6px] border text-[12.5px] ${ativo ? 'border-neutral-950 bg-neutral-100 font-medium' : 'border-neutral-200 hover:border-neutral-400'} ${foco}`}>
      {children}<Kbd k={[tecla]} />
    </button>
  )
}
