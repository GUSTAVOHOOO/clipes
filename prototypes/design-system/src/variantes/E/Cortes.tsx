// Cortes, Variante E ("Estúdio + Comando"): a tabela da A, mais limpa, guiada pelo teclado (/ ↑ ↓ A R Enter),
// com o painel "Por que esta Nota" arejado e o lote numa linha de status discreta.
import { useRef, useState, type KeyboardEvent as KE } from 'react'
import { Search } from 'lucide-react'
import { cortes, fonte, img, tc, duracao, type Corte } from '../../dados'
import { CUSTO, acoes, dur, loja, num, useLoja, usd, type Situacao } from './estado'
import { Principal, Topo, useComandosTela, useE, useMigalhas, useTeclas } from './Shell'
import { BarraNota, Kbd, foco } from './ui'

function trecho(c: Corte, q: string) {
  if (!q) return null
  const f = c.frases.find(f => f.texto.toLowerCase().includes(q))
  if (!f) return null
  const i = f.texto.toLowerCase().indexOf(q)
  const a = Math.max(0, i - 22)
  return { pre: (a > 0 ? '…' : '') + f.texto.slice(a, i), hit: f.texto.slice(i, i + q.length), pos: f.texto.slice(i + q.length, i + q.length + 40) }
}

function Estado({ s }: { s?: Situacao }) {
  const m = s === 'aprovado' ? { nome: 'Aprovado', ponto: 'bg-[var(--e-tx)]', tx: 'text-[var(--e-tx)]' }
    : s === 'rejeitado' ? { nome: 'Rejeitado', ponto: 'bg-transparent border border-[var(--e-tx3)]', tx: 'text-[var(--e-tx3)]' }
      : { nome: 'Sugerido', ponto: 'bg-[var(--e-tx3)]/60', tx: 'text-[var(--e-tx2)]' }
  return <span className={`inline-flex items-center gap-2 text-[12.5px] ${m.tx}`}><span className={`w-[7px] h-[7px] rounded-full ${m.ponto}`} />{m.nome}</span>
}

export default function Cortes() {
  const { irPara } = useE()
  const st = useLoja()
  const migalhas = useMigalhas()
  const [q, setQ] = useState('')
  const busca = useRef<HTMLInputElement>(null)

  const ql = q.trim().toLowerCase()
  const lista = [...cortes]
    .filter(c => !ql || c.titulo.toLowerCase().includes(ql) || c.frases.some(f => f.texto.toLowerCase().includes(ql)))
    .sort((a, b) => b.nota.total - a.nota.total)
  const sel = lista.find(c => c === cortes[st.corte]) ?? lista[0]
  const aprovados = cortes.filter(c => st.status[c.id] === 'aprovado')
  const rejeitados = cortes.filter(c => st.status[c.id] === 'rejeitado')

  const selecionar = (c: Corte) => loja.set({ corte: cortes.indexOf(c) })
  const abrir = (c?: Corte) => { if (!c) return; selecionar(c); irPara('editor') }
  const mover = (d: number) => {
    if (!lista.length) return
    const i = Math.max(0, lista.indexOf(sel))
    selecionar(lista[(i + d + lista.length) % lista.length])
  }

  useTeclas(e => {
    const k = e.key
    if (e.ctrlKey || e.metaKey) return
    if (k === '/') { e.preventDefault(); return busca.current?.focus() }
    if (k === 'ArrowDown') { e.preventDefault(); return mover(1) }
    if (k === 'ArrowUp') { e.preventDefault(); return mover(-1) }
    if (k.toLowerCase() === 'a' && sel) return acoes.marcar(sel, 'aprovado')
    if (k.toLowerCase() === 'r' && sel) return acoes.marcar(sel, 'rejeitado')
    if (k === 'Enter' && !(e.target as HTMLElement).closest('button')) return abrir(sel)
  })
  const teclasBusca = (e: KE<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); mover(1) }
    if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1) }
    if (e.key === 'Enter') { e.preventDefault(); abrir(sel) }
    if (e.key === 'Escape') { e.preventDefault(); q ? setQ('') : busca.current?.blur() }
  }

  useComandosTela(sel ? [
    { id: 'apr', grupo: 'Cortes', rotulo: st.status[sel.id] === 'aprovado' ? 'Voltar para sugerido' : 'Aprovar Corte', dica: sel.titulo, tecla: ['A'], acao: () => acoes.marcar(sel, 'aprovado') },
    { id: 'rej', grupo: 'Cortes', rotulo: st.status[sel.id] === 'rejeitado' ? 'Voltar para sugerido' : 'Rejeitar Corte', dica: sel.titulo, tecla: ['R'], acao: () => acoes.marcar(sel, 'rejeitado') },
    { id: 'abr', grupo: 'Cortes', rotulo: 'Abrir no editor', dica: sel.titulo, tecla: ['Enter'], acao: () => abrir(sel) },
    { id: 'filtrar', grupo: 'Cortes', rotulo: 'Filtrar pela Transcrição', tecla: ['/'], acao: () => setTimeout(() => busca.current?.focus()) },
    { id: 'apr7', grupo: 'Cortes', rotulo: 'Aprovar os sugeridos com Nota 7 ou mais', palavras: ['lote'], acao: acoes.aprovarNota7 },
  ] : [])

  const col = 'grid grid-cols-[68px_minmax(0,1fr)_72px_112px_108px] gap-x-4 items-center'

  return (
    <>
      <Topo migalhas={migalhas} direita={
        <Principal tecla={['Ctrl', 'Shift', 'E']} onClick={acoes.exportarAprovados} disabled={!aprovados.length}>Exportar aprovados</Principal>
      } />
      <div className="flex-1 min-h-0 flex">
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-end justify-between gap-6 px-8 pt-7 pb-5">
            <div className="min-w-0">
              <h1 className="text-[18px] font-semibold tracking-[-0.015em]">Cortes</h1>
              <p className="mt-1 text-[12.5px] text-[var(--e-tx3)] truncate">{cortes.length} sugeridos pelo Provedor em {fonte.nome}</p>
            </div>
            <label className={`w-[300px] h-8 shrink-0 flex items-center gap-2 pl-2.5 pr-1.5 rounded-[6px] bg-[var(--e-bg)] border border-[var(--e-ln)] focus-within:border-[var(--e-ln2)]`}>
              <Search size={13} strokeWidth={1.75} className="text-[var(--e-tx3)] shrink-0" />
              <input ref={busca} value={q} onChange={e => setQ(e.target.value)} onKeyDown={teclasBusca}
                aria-label="Filtrar Cortes pela Transcrição" placeholder="Filtrar pela Transcrição"
                className="flex-1 min-w-0 h-full bg-transparent outline-none text-[12.5px] placeholder:text-[var(--e-tx3)]" />
              {q ? <button onClick={() => setQ('')} className={`text-[11.5px] text-[var(--e-tx3)] hover:text-[var(--e-tx)] rounded-[3px] px-1 ${foco}`}>limpar</button> : <Kbd k={['/']} />}
            </label>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-6" role="table" aria-label="Cortes">
            <div role="row" className={`${col} h-8 text-[11.5px] text-[var(--e-tx3)] border-b border-[var(--e-ln)]`}>
              <span role="columnheader" className="col-span-2">Corte</span>
              <span role="columnheader">Duração</span>
              <span role="columnheader">Nota</span>
              <span role="columnheader">Estado</span>
            </div>
            {!lista.length && (
              <p className="py-12 text-center text-[13px] text-[var(--e-tx3)] leading-relaxed">
                Nenhum Corte fala “{q}” na Transcrição.<br />
                <span className="inline-flex items-center gap-1.5 mt-1"><Kbd k={['Esc']} /> limpa a busca</span>
              </p>
            )}
            {lista.map(c => {
              const s = st.status[c.id]
              const on = c === sel
              const tr = trecho(c, ql)
              return (
                <div key={c.id} role="row" aria-selected={on} onClick={() => selecionar(c)} onDoubleClick={() => abrir(c)}
                  className={`relative ${col} h-[60px] border-b border-[var(--e-ln)] cursor-default ${on ? 'bg-[var(--e-s1)]' : 'hover:bg-[var(--e-s1)]/60'}`}>
                  {on && <span className="absolute -left-8 top-0 bottom-0 w-[2px] bg-[var(--e-acc)]" />}
                  <span role="cell">
                    <img src={img(c.thumbs[3])} alt="" className={`w-[68px] h-[38px] rounded-[3px] object-cover bg-[var(--e-s3)] ${s === 'rejeitado' ? 'opacity-40 grayscale' : ''}`} />
                  </span>
                  <span role="cell" className="min-w-0">
                    <button onClick={() => abrir(c)} className={`block max-w-full text-left text-[13px] truncate rounded-[3px] ${foco} ${s === 'rejeitado' ? 'text-[var(--e-tx3)]' : 'text-[var(--e-tx)]'}`}>{c.titulo}</button>
                    {tr
                      ? <span className="block mt-0.5 text-[11.5px] text-[var(--e-tx3)] truncate">{tr.pre}<mark className="bg-transparent text-[var(--e-tx)] underline underline-offset-2 decoration-[var(--e-tx3)]">{tr.hit}</mark>{tr.pos}</span>
                      : <span className="block mt-0.5 text-[11.5px] text-[var(--e-tx3)] font-mono tabular truncate">{tc(c.inicio)} a {tc(c.fim)} na Fonte</span>}
                  </span>
                  <span role="cell" className="font-mono tabular text-[12px] text-[var(--e-tx2)]">{tc(duracao(c))}</span>
                  <span role="cell" className="flex items-center gap-2.5">
                    <span className="w-7 text-[13px] tabular text-[var(--e-tx)]">{num(c.nota.total)}</span>
                    <BarraNota valor={c.nota.total} largura={48} />
                  </span>
                  <span role="cell"><Estado s={s} /></span>
                </div>
              )
            })}
          </div>
        </main>

        {sel && <PainelNota c={sel} s={st.status[sel.id]} onAbrir={() => abrir(sel)} />}
      </div>

      {/* Linha de status: teclas à esquerda, lote e custo à direita; o centro fica livre. */}
      <footer className="h-10 shrink-0 flex items-center gap-4 px-4 border-t border-[var(--e-ln)] bg-[var(--e-s1)] text-[12px] text-[var(--e-tx3)]">
        <span className="flex items-center gap-1.5"><Kbd k={['↑', '↓']} /> mover</span>
        <span className="flex items-center gap-1.5"><Kbd k={['/']} /> filtrar</span>
        <span className="w-px h-3.5 bg-[var(--e-ln2)]" aria-hidden />
        <button onClick={acoes.aprovarNota7} className={`text-[var(--e-tx2)] hover:text-[var(--e-tx)] rounded-[3px] ${foco}`}>Aprovar Nota 7 ou mais</button>
        <span className="flex-1" />
        <span className="tabular" title={`${rejeitados.length} rejeitados`}>{aprovados.length} {aprovados.length === 1 ? 'aprovado' : 'aprovados'}</span>
        <span>Empacotamento pelo Provedor <span className="font-mono tabular text-[var(--e-tx)]">{usd(aprovados.length * CUSTO)}</span></span>
      </footer>
    </>
  )
}

function PainelNota({ c, s, onAbrir }: { c: Corte; s?: Situacao; onAbrir: () => void }) {
  const ord = [...c.nota.eixos].sort((a, b) => b.valor - a.valor)
  const fortes = ord.filter(x => x.valor === ord[0].valor).map(x => x.nome)
  const fraco = ord[ord.length - 1]
  const Acao = ({ v, nome, tecla }: { v: Situacao; nome: string; tecla: string }) => (
    <button onClick={() => acoes.marcar(c, v)} aria-pressed={s === v}
      className={`h-7 inline-flex items-center gap-2 pl-2.5 pr-1.5 rounded-[6px] border text-[12.5px] ${foco} ${s === v ? 'border-[var(--e-tx3)] bg-[var(--e-s3)] text-[var(--e-tx)]' : 'border-[var(--e-ln2)] text-[var(--e-tx2)] hover:text-[var(--e-tx)] hover:bg-[var(--e-s2)]'}`}>
      {nome}<Kbd k={[tecla]} />
    </button>
  )
  return (
    <aside className="w-[400px] shrink-0 border-l border-[var(--e-ln)] bg-[var(--e-s1)] flex flex-col" aria-label={`Por que ${c.titulo} tem esta Nota`}>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-6 pb-6">
        <img src={img(c.wide)} alt={`Quadro de ${c.titulo}`} className="w-full aspect-video object-cover rounded-[4px] bg-black" />
        <h2 className="mt-5 text-[15px] font-medium leading-[1.35]">{c.titulo}</h2>
        <p className="mt-1 text-[12px] text-[var(--e-tx3)] tabular">{dur(duracao(c))}, de <span className="font-mono">{tc(c.inicio)}</span> a <span className="font-mono">{tc(c.fim)}</span> na Fonte</p>

        <h3 className="mt-7 text-[12px] text-[var(--e-tx3)]">Por que esta Nota</h3>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-[28px] leading-none font-semibold tracking-[-0.02em] tabular">{num(c.nota.total)}</span>
          <span className="text-[12.5px] text-[var(--e-tx3)]">de 10</span>
        </div>
        <p className="mt-2 text-[12.5px] text-[var(--e-tx2)] leading-[1.55]">
          {c.nota.resumo ?? `Mais forte em ${fortes.join(' e ')}. O ponto fraco é ${fraco.nome} (${fraco.valor}).`}
        </p>

        <ul className="mt-7 flex flex-col gap-5">
          {c.nota.eixos.map(x => (
            <li key={x.nome}>
              <div className="flex items-center gap-3 text-[13px]">
                <span className="flex-1 text-[var(--e-tx)]">{x.nome}</span>
                <BarraNota valor={x.valor} largura={72} />
                <span className="w-4 text-right tabular text-[var(--e-tx)]">{x.valor}</span>
              </div>
              <p className="mt-1.5 pr-6 text-[12.5px] leading-[1.55] text-[var(--e-tx3)]">{x.justificativa}</p>
            </li>
          ))}
        </ul>
      </div>
      <div className="shrink-0 flex items-center gap-2 px-5 h-14 border-t border-[var(--e-ln)]">
        <Acao v="rejeitado" nome={s === 'rejeitado' ? 'Rejeitado' : 'Rejeitar'} tecla="R" />
        <Acao v="aprovado" nome={s === 'aprovado' ? 'Aprovado' : 'Aprovar'} tecla="A" />
        <span className="flex-1" />
        <Principal tecla={['Enter']} onClick={onAbrir}>Abrir no editor</Principal>
      </div>
    </aside>
  )
}
