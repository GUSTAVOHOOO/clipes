// Variante G, "Seleção": a tabela de Cortes é o lugar de selecionar; o painel mostra o que cabe à seleção.
// Um Corte em foco: a Nota explicada. Cortes marcados (X): as ações do lote e o custo do Provedor.
import { useState } from 'react'
import { Check, Download, X } from 'lucide-react'
import { toast } from 'sonner'
import { cortes, fonte, img, tc } from '../../dados'
import type { PropsVariante } from '../../App'
import { BarraNota, Botao, Interruptor, Kbd, clamp, dur, foco, num } from '../nucleo/base'
import { Paleta, useAtalhos, type Cmd } from '../nucleo/Paleta'
import { Inspector, Prop, Secao, TopoG, memoG } from './comum'

const ordem = [...cortes].sort((a, b) => b.nota.total - a.nota.total)
type C = (typeof cortes)[number]
function resumo(c: C) {
  const ord = [...c.nota.eixos].sort((a, b) => b.valor - a.valor)
  const fraco = ord[ord.length - 1]
  return `Mais forte em ${ord[0].nome} e ${ord[1].nome}. O ponto fraco é ${fraco.nome} (${fraco.valor}).`
}

export default function CortesG({ tela, irPara }: PropsVariante) {
  const [foc, setFoc] = useState(0)
  const [marcados, setMarcados] = useState<Set<string>>(() => new URLSearchParams(location.search).get('sel') === 'lote' ? new Set(['c1', 'c3', 'c4']) : new Set())
  const [status, setStatus] = useState(memoG.status)
  const [empacotar, setEmpacotar] = useState(true)
  const c = ordem[foc]
  const lote = ordem.filter(k => marcados.has(k.id))

  const definir = (ids: string[], v: 'aprovado' | 'rejeitado') => {
    const n = { ...status }
    ids.forEach(id => { n[id] = ids.length === 1 && n[id] === v ? undefined : v })
    memoG.status = n; setStatus(n)
  }
  const alvo = () => (lote.length ? lote.map(k => k.id) : [c.id])
  const marcar = (id: string) => setMarcados(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const abrir = (k = c) => { memoG.corte = cortes.findIndex(x => x.id === k.id); irPara('editor') }
  const exportar = () => {
    const ids = lote.length ? lote : ordem.filter(k => status[k.id] === 'aprovado')
    toast(`Exportando ${ids.length} ${ids.length === 1 ? 'Corte' : 'Cortes'}`, { description: empacotar ? 'Com Empacotamento sugerido: título, descrição com crédito e tags' : 'Sem Empacotamento' })
  }

  useAtalhos(ev => {
    const k = ev.key, l = k.toLowerCase(), ctrl = ev.ctrlKey || ev.metaKey
    if (ctrl && l === 'e') { ev.preventDefault(); return exportar() }
    if (ctrl && l === 'a') { ev.preventDefault(); return setMarcados(new Set(ordem.map(x => x.id))) }
    if (ctrl) return
    if (k === 'ArrowDown' || l === 'j') { ev.preventDefault(); return setFoc(i => clamp(i + 1, 0, ordem.length - 1)) }
    if (k === 'ArrowUp' || l === 'k') { ev.preventDefault(); return setFoc(i => clamp(i - 1, 0, ordem.length - 1)) }
    if (l === 'x') return marcar(c.id)
    if (k === 'Escape') return setMarcados(new Set())
    if (l === 'a') return definir(alvo(), 'aprovado')
    if (l === 'r') return definir(alvo(), 'rejeitado')
    if (k === 'Enter') return abrir()
  })

  const comandos: Cmd[] = [
    { id: 'm', grupo: 'Seleção', rotulo: 'Marcar ou desmarcar o Corte em foco', tecla: ['X'], acao: () => marcar(c.id) },
    { id: 'ma', grupo: 'Seleção', rotulo: 'Marcar todos', tecla: ['Ctrl', 'A'], acao: () => setMarcados(new Set(ordem.map(x => x.id))) },
    { id: 'apr', grupo: 'Revisar', rotulo: lote.length ? `Aprovar ${lote.length} marcados` : 'Aprovar', tecla: ['A'], acao: () => definir(alvo(), 'aprovado') },
    { id: 'rej', grupo: 'Revisar', rotulo: lote.length ? `Rejeitar ${lote.length} marcados` : 'Rejeitar', tecla: ['R'], acao: () => definir(alvo(), 'rejeitado') },
    { id: 'abr', grupo: 'Revisar', rotulo: 'Abrir no editor', tecla: ['Enter'], acao: () => abrir() },
    { id: 'exp', grupo: 'Lote', rotulo: 'Exportar', tecla: ['Ctrl', 'E'], acao: exportar },
  ]

  return (
    <div className="h-full flex flex-col">
      <TopoG tela={tela} irPara={irPara} />
      <div className="flex-1 min-h-0 flex">
        <main className="flex-1 min-w-0 overflow-auto nu-rolagem">
          <div className="px-8 pt-8 pb-20 max-w-[920px]">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <h1 className="text-[18px] font-semibold tracking-[-0.01em]">Cortes sugeridos</h1>
                <p className="mt-1 text-[12.5px] text-[var(--tx3)]">{fonte.nome} · {ordem.length} Cortes pela Nota do Provedor</p>
              </div>
              <span className="flex items-center gap-3 text-[12px] text-[var(--tx3)]">
                <span className="flex items-center gap-1.5"><Kbd k={['X']} /> marcar</span>
                <span className="flex items-center gap-1.5"><Kbd k={['A']} /> aprovar</span>
                <span className="flex items-center gap-1.5"><Kbd k={['R']} /> rejeitar</span>
              </span>
            </div>
            <div role="grid" aria-label="Cortes" className="mt-6">
              <div role="row" className="h-8 grid grid-cols-[28px_1fr_64px_120px_100px] items-center gap-3 px-3 text-[11.5px] text-[var(--tx3)] border-b border-[var(--ln)]">
                <button role="checkbox" aria-checked={marcados.size === ordem.length} aria-label="Marcar todos"
                  onClick={() => setMarcados(marcados.size === ordem.length ? new Set() : new Set(ordem.map(x => x.id)))}
                  className={`w-4 h-4 rounded-[4px] grid place-items-center ${foco} ${marcados.size === ordem.length ? 'bg-[var(--acc)] text-[var(--acc-tx)]' : 'border border-[var(--ln2)]'}`}>{marcados.size === ordem.length && <Check size={11} strokeWidth={3} />}</button>
                <span>Corte</span><span className="text-right">Duração</span><span className="text-right">Nota</span><span className="text-right">Estado</span>
              </div>
              {ordem.map((k, i) => {
                const on = i === foc, m = marcados.has(k.id), st = status[k.id]
                return (
                  <div key={k.id} role="row" aria-selected={on} onClick={() => setFoc(i)} onDoubleClick={() => abrir(k)}
                    className={`grid grid-cols-[28px_1fr_64px_120px_100px] items-center gap-3 px-3 py-2.5 mt-1 rounded-[8px] cursor-default transition-colors duration-150 ${on ? 'bg-[var(--acc-bg)] ring-1 ring-[var(--acc)]' : m ? 'bg-[var(--s2)]' : 'hover:bg-[var(--s1)]'}`}>
                    <button role="checkbox" aria-checked={m} aria-label={`Marcar ${k.titulo}`} onClick={ev => { ev.stopPropagation(); marcar(k.id) }}
                      className={`w-4 h-4 rounded-[4px] grid place-items-center ${foco} ${m ? 'bg-[var(--acc)] text-[var(--acc-tx)]' : 'border border-[var(--ln2)] hover:border-[var(--tx3)]'}`}>{m && <Check size={11} strokeWidth={3} />}</button>
                    <span className="flex items-center gap-3 min-w-0">
                      <img src={img(k.thumbs[3])} alt="" className={`w-[72px] h-[40px] rounded-[4px] object-cover shrink-0 ${st === 'rejeitado' ? 'opacity-40' : ''}`} />
                      <span className="min-w-0">
                        <span className={`block text-[13.5px] truncate ${st === 'rejeitado' ? 'text-[var(--tx3)]' : ''}`}>{k.titulo}</span>
                        <span className="block mt-0.5 font-mono tabular-nums text-[11.5px] text-[var(--tx3)]">{tc(k.inicio)}–{tc(k.fim)}</span>
                      </span>
                    </span>
                    <span className="text-right font-mono tabular-nums text-[12.5px] text-[var(--tx2)]">{tc(k.fim - k.inicio)}</span>
                    <span className="flex items-center justify-end gap-2.5"><span className="tabular-nums text-[14px] font-medium">{num(k.nota.total)}</span><BarraNota valor={k.nota.total} largura={44} /></span>
                    <span className="text-right text-[12px]">
                      {st === 'aprovado' ? <span className="inline-flex items-center gap-1"><Check size={13} /> Aprovado</span> : st === 'rejeitado' ? <span className="inline-flex items-center gap-1 text-[var(--tx3)]"><X size={13} /> Rejeitado</span> : <span className="text-[var(--tx3)]">Sugerido</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </main>

        {lote.length
          ? <Inspector largura={340} caminho={[{ rotulo: 'Cortes', ir: () => setMarcados(new Set()) }, { rotulo: `${lote.length} marcados` }]} chave="lote">
            <Secao>
              <div className="flex -space-x-3">{lote.map(k => <img key={k.id} src={img(k.vert)} alt="" className="w-[38px] h-[68px] rounded-[5px] object-cover ring-2 ring-[var(--s1)]" />)}</div>
              <div className="mt-3">
                <Prop rotulo="Duração somada"><span className="tabular-nums">{dur(lote.reduce((a, k) => a + k.fim - k.inicio, 0))}</span></Prop>
                <Prop rotulo="Nota média"><span className="tabular-nums">{num(lote.reduce((a, k) => a + k.nota.total, 0) / lote.length)}</span></Prop>
                <Prop rotulo="Custo do Provedor no lote"><span className="tabular-nums">US$ {(0.01 * lote.length).toFixed(2).replace('.', ',')}</span></Prop>
              </div>
            </Secao>
            <Secao titulo="Empacotamento" extra={<Interruptor rotulo="Gerar Empacotamento" ligado={empacotar} onChange={setEmpacotar} />}>
              <p className="text-[12.5px] leading-[1.5] text-[var(--tx2)]">Título, descrição com crédito à Fonte, tags e ideia de thumbnail, editáveis antes de publicar.</p>
            </Secao>
            <Secao>
              <div className="grid grid-cols-2 gap-2">
                <Botao tamanho="p" tecla={['A']} onClick={() => definir(lote.map(k => k.id), 'aprovado')}><Check size={13} /> Aprovar</Botao>
                <Botao tamanho="p" tipo="fantasma" tecla={['R']} onClick={() => definir(lote.map(k => k.id), 'rejeitado')}>Rejeitar</Botao>
              </div>
              <Botao tipo="primario" className="w-full mt-2" tecla={['Ctrl', 'E']} onClick={exportar}><Download size={14} /> Exportar {lote.length}</Botao>
            </Secao>
          </Inspector>
          : <Inspector largura={340} caminho={[{ rotulo: 'Cortes' }, { rotulo: c.titulo }]} chave={c.id}>
            <Secao>
              <img src={img(c.wide)} alt="" className="w-full aspect-video rounded-[6px] object-cover" />
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-[30px] font-semibold tabular-nums tracking-[-0.02em] leading-none">{num(c.nota.total)}</span>
                <span className="text-[12.5px] text-[var(--tx3)]">de 10, Nota do Provedor</span>
              </div>
              <p className="mt-2 text-[12.5px] leading-[1.5] text-[var(--tx2)]">{resumo(c)}</p>
            </Secao>
            <Secao titulo="Por que esta Nota">
              <dl className="flex flex-col gap-3.5">
                {c.nota.eixos.map(x => (
                  <div key={x.nome}>
                    <dt className="flex justify-between text-[12.5px]"><span>{x.nome}</span><span className="font-mono tabular-nums text-[var(--tx2)]">{x.valor}</span></dt>
                    <dd className="mt-1.5"><BarraNota valor={x.valor} largura="100%" /></dd>
                    <dd className="mt-1.5 text-[12px] leading-[1.5] text-[var(--tx2)]">{x.justificativa}</dd>
                  </div>
                ))}
              </dl>
            </Secao>
            <Secao>
              <div className="grid grid-cols-2 gap-2">
                <Botao tamanho="p" tecla={['A']} onClick={() => definir([c.id], 'aprovado')} aria-pressed={status[c.id] === 'aprovado'}><Check size={13} /> {status[c.id] === 'aprovado' ? 'Aprovado' : 'Aprovar'}</Botao>
                <Botao tamanho="p" tipo="fantasma" tecla={['R']} onClick={() => definir([c.id], 'rejeitado')}>Rejeitar</Botao>
              </div>
              <Botao tipo="primario" className="w-full mt-2" tecla={['Enter']} onClick={() => abrir()}>Abrir no editor</Botao>
            </Secao>
          </Inspector>}
      </div>
      <Paleta comandos={comandos} tela={tela} irPara={irPara} irCorte={i => { memoG.corte = i; irPara('editor') }} />
    </div>
  )
}
