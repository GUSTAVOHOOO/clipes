// Etapa 2: revisar um Corte por vez. Aprovar ou rejeitar avança para o próximo.
import { useEffect, useState } from 'react'
import { Check, ChevronLeft, Download, ChevronRight, Pencil, Undo2, X } from 'lucide-react'
import { cortes, duracao, img, presets, tc } from '../../dados'
import type { Tela } from '../../App'
import { Botao, CUSTO_CORTE, Kbd, Preview, Topo, atalhoLivre, dinheiro, foco, memoria, usePlayhead, virgula, type Estado } from './comum'
import { Exportar } from './Exportar'

const ROTULO: Record<Estado, string> = { pendente: 'A revisar', aprovado: 'Aprovado', rejeitado: 'Rejeitado' }

export function Revisar({ irPara }: { irPara: (t: Tela) => void }) {
  const [estados, setEstados] = useState(memoria.estados)
  const [atual, setAtual] = useState(() => Math.max(0, cortes.findIndex(c => memoria.estados[c.id] === 'pendente')))
  const [exportando, setExportando] = useState(false)
  const corte = cortes[atual]
  const ph = usePlayhead(corte)
  const aprovados = cortes.filter(c => estados[c.id] === 'aprovado')
  const pendentes = cortes.filter(c => estados[c.id] === 'pendente').length
  const estado = estados[corte.id]

  useEffect(() => { memoria.estados = estados }, [estados])

  const decidir = (e: Estado) => {
    const novo = { ...estados, [corte.id]: e }
    setEstados(novo)
    if (e === 'pendente') return
    // Próximo pendente depois do atual, dando a volta.
    for (let k = 1; k < cortes.length; k++) {
      const j = (atual + k) % cortes.length
      if (novo[cortes[j].id] === 'pendente') return setAtual(j)
    }
  }
  const editar = () => { memoria.corte = atual; irPara('editor') }
  const mover = (d: number) => setAtual((atual + d + cortes.length) % cortes.length)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!atalhoLivre(e)) return
      const k = e.key.toLowerCase()
      if (k === 'a') decidir('aprovado')
      else if (k === 'r') decidir('rejeitado')
      else if (k === 'e') editar()
      else if (e.key === 'ArrowRight') mover(1)
      else if (e.key === 'ArrowLeft') mover(-1)
      else if (e.key === ' ') { e.preventDefault(); ph.setTocando(!ph.tocando) }
      else return
    }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  })

  const nota = corte.nota
  return (
    <>
      <Topo etapa={exportando ? 3 : 1} irPara={irPara} aoExportar={() => aprovados.length && setExportando(true)} />

      <main className="flex-1 min-h-0 flex flex-col px-10 pb-[68px]">
        <div className="flex-1 min-h-0 flex justify-center gap-14 pt-2">
          {/* 9:16 grande */}
          <div className="relative h-full flex items-center">
            <Preview key={corte.id} corte={corte} ativa={ph.i} preset={presets[0]} tocando={ph.tocando}
              aoTocar={() => ph.setTocando(!ph.tocando)} className="h-full max-h-[720px]" />
          </div>

          {/* Nota e decisão */}
          <section className="w-[400px] shrink-0 flex flex-col min-h-0 py-1" aria-label="Corte em revisão">
            <div className="flex items-center justify-between gap-3 text-[13px] text-[var(--tx-3)]">
              <span className="tabular truncate">
                Corte {atual + 1} de {cortes.length}, <span className="font-mono text-[var(--tx-2)]">{tc(corte.inicio)}</span> a <span className="font-mono text-[var(--tx-2)]">{tc(corte.fim)}</span> na Fonte, {virgula(duracao(corte), 0)} s
              </span>
              <div className="flex shrink-0">
                <button onClick={() => mover(-1)} aria-label="Corte anterior" className={`grid place-items-center size-7 rounded-md hover:bg-[var(--hover)] hover:text-[var(--tx)] ${foco}`}><ChevronLeft size={16} /></button>
                <button onClick={() => mover(1)} aria-label="Próximo Corte" className={`grid place-items-center size-7 rounded-md hover:bg-[var(--hover)] hover:text-[var(--tx)] ${foco}`}><ChevronRight size={16} /></button>
              </div>
            </div>
            <div className="mt-2 flex items-start gap-6">
              <h1 className="flex-1 font-geist text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] text-balance">{corte.titulo}</h1>
              <p className="shrink-0 text-right -mt-1">
                <span className="block font-geist text-[44px] leading-none font-light tracking-[-0.03em] tabular">{virgula(nota.total)}</span>
                <span className="block mt-1 text-[12px] text-[var(--tx-3)]">Nota de 10</span>
              </p>
            </div>

            <ul className="mt-6 flex flex-col gap-3 overflow-y-auto min-h-0 pr-1 -mr-1">
              {nota.eixos.map(e => (
                <li key={e.nome}>
                  <div className="flex items-baseline justify-between text-[13px]">
                    <span className="text-[var(--tx)]">{e.nome}</span>
                    <span className="tabular text-[var(--tx-2)]">{e.valor}</span>
                  </div>
                  <div className="mt-1.5 h-[3px] rounded-full bg-[var(--line)]">
                    <div className="h-full rounded-full bg-[var(--tx-2)]" style={{ width: `${e.valor * 10}%` }} />
                  </div>
                  <p className="mt-1.5 text-[13px] leading-[1.45] text-[var(--tx-3)]">{e.justificativa}</p>
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-5">
              {estado !== 'pendente' && (
                <p className="mb-3 flex items-center gap-2 text-[13px] text-[var(--tx-2)]">
                  {estado === 'aprovado' ? <Check size={14} /> : <X size={14} />} {ROTULO[estado]}
                  <button onClick={() => decidir('pendente')} className={`ml-1 inline-flex items-center gap-1 rounded px-1 text-[var(--tx-3)] hover:text-[var(--tx)] ${foco}`}>
                    <Undo2 size={13} /> Desfazer
                  </button>
                </p>
              )}
              <div className="grid grid-cols-[1fr_1.3fr_1fr] gap-2">
                <Botao tamanho="lg" onClick={() => decidir('rejeitado')}>Rejeitar <Kbd>R</Kbd></Botao>
                <Botao tamanho="lg" tipo="primario" onClick={() => decidir('aprovado')}>Aprovar <Kbd escuro>A</Kbd></Botao>
                <Botao tamanho="lg" onClick={editar}><Pencil size={15} /> Editar <Kbd>E</Kbd></Botao>
              </div>
            </div>
          </section>
        </div>

        {/* Fila de miniaturas */}
        <div className="mt-5 shrink-0 grid grid-cols-[1fr_auto_1fr] items-end gap-6">
        <span />
        <ol className="flex gap-3" aria-label="Cortes">
          {cortes.map((c, i) => {
            const st = estados[c.id], on = i === atual
            return (
              <li key={c.id}>
                <button onClick={() => setAtual(i)} aria-current={on ? 'true' : undefined} aria-label={`${c.titulo}, ${ROTULO[st]}`}
                  className={`group flex flex-col gap-1.5 w-[116px] text-left rounded-[10px] ${foco}`}>
                  <span className={`relative block aspect-video rounded-[8px] overflow-hidden ring-offset-2 ring-offset-[var(--bg)] transition
                    ${on ? 'ring-2 ring-[var(--tx)]' : 'ring-1 ring-[var(--line)] group-hover:ring-[var(--line-2)]'}`}>
                    <img src={img(c.thumbs[3])} alt="" className={`w-full h-full object-cover ${st === 'rejeitado' ? 'opacity-35 grayscale' : ''}`} />
                    {st !== 'pendente' && (
                      <span className={`absolute right-1.5 top-1.5 grid place-items-center size-5 rounded-full
                        ${st === 'aprovado' ? 'bg-[var(--tx)] text-[var(--bg)]' : 'bg-black/70 text-[var(--tx-2)]'}`}>
                        {st === 'aprovado' ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center justify-between text-[12px] tabular">
                    <span className={on ? 'text-[var(--tx)]' : 'text-[var(--tx-3)]'}>{ROTULO[st]}</span>
                    <span className="text-[var(--tx-3)]">{virgula(c.nota.total)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
        <div className="justify-self-end pb-5 flex items-center gap-4">
          <div className="text-right text-[13px] leading-[1.35] tabular whitespace-nowrap">
            <p className="text-[var(--tx-2)]"><span className="text-[var(--tx)]">{aprovados.length} de {cortes.length}</span> aprovados</p>
            <p className="text-[var(--tx-3)]" title="Custo do Provedor para o Empacotamento dos aprovados">Provedor {dinheiro(aprovados.length * CUSTO_CORTE)}</p>
          </div>
          <Botao tipo={pendentes === 0 && aprovados.length ? "primario" : "contorno"} disabled={!aprovados.length} onClick={() => setExportando(true)}>
            <Download size={15} /> Exportar {aprovados.length} aprovado{aprovados.length === 1 ? "" : "s"}
          </Botao>
        </div>
        </div>
      </main>

      {exportando && (
        <Exportar itens={aprovados.map(c => ({ corte: c, dur: duracao(c) }))} aoFechar={() => setExportando(false)} />
      )}
    </>
  )
}
