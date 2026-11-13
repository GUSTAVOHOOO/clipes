// Variante F, "Foco": os Cortes são uma lista curta, por Nota. Só o Corte em foco se abre e mostra a Nota explicada;
// os outros ficam numa linha. Revisar é descer com ↓ e decidir com A ou R.
import { useState } from 'react'
import { Check, Download, X } from 'lucide-react'
import { toast } from 'sonner'
import { cortes, fonte, img, tc } from '../../dados'
import type { PropsVariante } from '../../App'
import { BarraNota, Botao, Kbd, foco, num } from '../nucleo/base'
import { GatilhoPaleta, Paleta, useAtalhos, type Cmd } from '../nucleo/Paleta'
import { TopoF, memoF } from './comum'

const ordem = [...cortes].sort((a, b) => b.nota.total - a.nota.total)

export default function CortesF({ tela, irPara }: PropsVariante) {
  const [foc, setFoc] = useState(() => Math.max(0, ordem.findIndex(c => c.id === cortes[memoF.corte].id)))
  const [status, setStatus] = useState(memoF.status)
  const marcar = (id: string, v: 'aprovado' | 'rejeitado') => {
    const n = { ...status, [id]: status[id] === v ? undefined : v }
    memoF.status = n; setStatus(n)
  }
  const aprovados = ordem.filter(c => status[c.id] === 'aprovado')
  const c = ordem[foc]
  const abrir = (i = foc) => { memoF.corte = cortes.findIndex(k => k.id === ordem[i].id); irPara('editor') }
  const exportar = () => aprovados.length
    ? toast(`Exportando ${aprovados.length} ${aprovados.length === 1 ? 'Corte' : 'Cortes'}`, { description: 'Com Empacotamento sugerido: título, descrição com crédito e tags' })
    : toast('Aprove pelo menos um Corte para exportar', { duration: 1800 })

  useAtalhos(ev => {
    const k = ev.key, l = k.toLowerCase(), ctrl = ev.ctrlKey || ev.metaKey
    if (ctrl && l === 'e') { ev.preventDefault(); return exportar() }
    if (ctrl) return
    if (k === 'ArrowDown' || l === 'j') { ev.preventDefault(); return setFoc(i => Math.min(ordem.length - 1, i + 1)) }
    if (k === 'ArrowUp' || l === 'k') { ev.preventDefault(); return setFoc(i => Math.max(0, i - 1)) }
    if (l === 'a') { marcar(c.id, 'aprovado'); return setFoc(i => Math.min(ordem.length - 1, i + 1)) }
    if (l === 'r') { marcar(c.id, 'rejeitado'); return setFoc(i => Math.min(ordem.length - 1, i + 1)) }
    if (k === 'Enter') return abrir()
  })

  const comandos: Cmd[] = [
    { id: 'apr', grupo: 'Corte em foco', rotulo: 'Aprovar e ir ao próximo', tecla: ['A'], acao: () => marcar(c.id, 'aprovado') },
    { id: 'rej', grupo: 'Corte em foco', rotulo: 'Rejeitar e ir ao próximo', tecla: ['R'], acao: () => marcar(c.id, 'rejeitado') },
    { id: 'abr', grupo: 'Corte em foco', rotulo: 'Abrir no editor', tecla: ['Enter'], acao: () => abrir() },
    { id: 'exp', grupo: 'Lote', rotulo: `Exportar aprovados (${aprovados.length})`, tecla: ['Ctrl', 'E'], acao: exportar },
  ]

  return (
    <div className="h-full flex flex-col">
      <TopoF tela={tela} irPara={irPara} direita={<GatilhoPaleta />} />
      <main className="flex-1 min-h-0 overflow-auto nu-rolagem">
        <div className="max-w-[880px] mx-auto px-6 pt-10 pb-8">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Cortes sugeridos</h1>
              <p className="mt-1.5 text-[13px] text-[var(--tx2)]">{ordem.length} Cortes de {fonte.nome}, pela Nota do Provedor.</p>
            </div>
            <p className="flex items-center gap-3 text-[12px] text-[var(--tx3)]">
              <span className="flex items-center gap-1.5"><Kbd k={['↑', '↓']} /> mover</span>
              <span className="flex items-center gap-1.5"><Kbd k={['A']} /> aprovar</span>
              <span className="flex items-center gap-1.5"><Kbd k={['R']} /> rejeitar</span>
              <span className="flex items-center gap-1.5"><Kbd k={['Enter']} /> editar</span>
            </p>
          </div>

          <ol className="mt-7 border-t border-[var(--ln)]">
            {ordem.map((k, i) => {
              const on = i === foc
              const st = status[k.id]
              return (
                <li key={k.id} className={`border-b border-[var(--ln)] transition-colors duration-200 ${on ? 'bg-[var(--s1)]' : ''}`}>
                  <button onClick={() => setFoc(i)} onDoubleClick={() => abrir(i)} aria-expanded={on}
                    className={`w-full flex items-center gap-4 px-3 py-3.5 text-left transition-colors duration-150 ${foco} ${on ? '' : 'hover:bg-[var(--s1)]'}`}>
                    <img src={img(k.thumbs[3])} alt="" className={`w-[88px] h-[50px] rounded-[4px] object-cover shrink-0 ${st === 'rejeitado' ? 'opacity-40 grayscale' : ''}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[14px] truncate ${st === 'rejeitado' ? 'text-[var(--tx3)] line-through decoration-[var(--tx3)]' : 'text-[var(--tx)]'}`}>{k.titulo}</span>
                      <span className="block mt-1 text-[12px] text-[var(--tx3)] font-mono tabular-nums">{tc(k.inicio)}–{tc(k.fim)} na Fonte</span>
                    </span>
                    <span className="w-[56px] text-right font-mono tabular-nums text-[13px] text-[var(--tx2)]">{tc(k.fim - k.inicio)}</span>
                    <span className="w-[108px] flex items-center justify-end gap-2.5">
                      <span className="text-[15px] font-medium tabular-nums">{num(k.nota.total)}</span>
                      <BarraNota valor={k.nota.total} largura={48} />
                    </span>
                    <span className="w-[96px] flex justify-end text-[12px]">
                      {st === 'aprovado' && <span className="flex items-center gap-1 text-[var(--tx)]"><Check size={13} /> Aprovado</span>}
                      {st === 'rejeitado' && <span className="flex items-center gap-1 text-[var(--tx3)]"><X size={13} /> Rejeitado</span>}
                      {!st && <span className="text-[var(--tx3)]">Sugerido</span>}
                    </span>
                  </button>
                  <div className="f-acordeao grid" data-aberta={on}>
                    <div className="overflow-hidden" inert={!on}>
                      <div className="pl-[119px] pr-3 pt-2 pb-6">
                        <dl className="grid grid-cols-2 gap-x-10 gap-y-4">
                          {k.nota.eixos.map(x => (
                            <div key={x.nome}>
                              <dt className="flex items-center justify-between text-[12.5px]">
                                <span className="text-[var(--tx)]">{x.nome}</span>
                                <span className="font-mono tabular-nums text-[var(--tx2)]">{x.valor}</span>
                              </dt>
                              <dd className="mt-1.5"><BarraNota valor={x.valor} largura="100%" /></dd>
                              <dd className="mt-1.5 text-[12.5px] leading-[1.5] text-[var(--tx2)] max-w-[52ch]">{x.justificativa}</dd>
                            </div>
                          ))}
                        </dl>
                        <div className="mt-5 flex gap-2">
                          <Botao tamanho="p" tecla={['A']} onClick={() => marcar(k.id, 'aprovado')} aria-pressed={st === 'aprovado'}><Check size={13} /> {st === 'aprovado' ? 'Aprovado' : 'Aprovar'}</Botao>
                          <Botao tamanho="p" tipo="fantasma" tecla={['R']} onClick={() => marcar(k.id, 'rejeitado')} aria-pressed={st === 'rejeitado'}><X size={13} /> Rejeitar</Botao>
                          <Botao tamanho="p" tipo="fantasma" tecla={['Enter']} onClick={() => abrir(i)}>Abrir no editor</Botao>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      </main>
      <footer className="h-12 shrink-0 flex items-center justify-between px-5 border-t border-[var(--ln)] bg-[var(--s1)] text-[12.5px]">
        <span className="text-[var(--tx2)] tabular-nums">{aprovados.length} de {ordem.length} aprovados · custo do Provedor no lote <span className="text-[var(--tx)]">US$ 0,04</span> de US$ 1,00</span>
        <Botao tipo="primario" tecla={['Ctrl', 'E']} onClick={exportar} disabled={!aprovados.length}><Download size={14} /> Exportar aprovados</Botao>
      </footer>
      <Paleta comandos={comandos} tela={tela} irPara={irPara} irCorte={i => { memoF.corte = i; irPara('editor') }} />
      <style>{`
        .f-acordeao{grid-template-rows:0fr;transition:grid-template-rows .24s cubic-bezier(.22,1,.36,1)}
        .f-acordeao[data-aberta=true]{grid-template-rows:1fr}
        @media (prefers-reduced-motion: reduce){.f-acordeao{transition:none}}
      `}</style>
    </div>
  )
}
