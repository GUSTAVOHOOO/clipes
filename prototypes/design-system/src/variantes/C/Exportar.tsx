// Etapa 4: exportar um Corte (do editor) ou os aprovados em lote (da revisão).
import { useEffect, useRef, useState } from 'react'
import { Check, FolderOpen, X } from 'lucide-react'
import { img, tc, type Corte } from '../../dados'
import { Botao, CUSTO_CORTE, Interruptor, dinheiro, foco, virgula } from './comum'

export function Exportar({ itens, aoFechar }: { itens: { corte: Corte; dur: number }[]; aoFechar: () => void }) {
  const [legenda, setLegenda] = useState(true)
  const [pacote, setPacote] = useState(true)
  const [prog, setProg] = useState<number | null>(null)
  const caixa = useRef<HTMLDivElement>(null)
  const custo = pacote ? itens.length * CUSTO_CORTE : 0
  const feito = prog !== null && prog >= 1

  const fechar = useRef(aoFechar)
  fechar.current = aoFechar
  useEffect(() => {
    caixa.current?.focus()
    // Os atalhos das telas de trás checam `atalhoLivre` e ficam mudos com o diálogo aberto.
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar.current() }
    addEventListener('keydown', h, true)
    return () => removeEventListener('keydown', h, true)
  }, [])

  useEffect(() => {
    if (prog === null || prog >= 1) return
    const h = setTimeout(() => setProg(Math.min(1, prog + 0.04)), 50)
    return () => clearTimeout(h)
  }, [prog])

  const plural = itens.length === 1 ? 'Corte' : 'Cortes'
  return (
    <div className="absolute inset-0 z-40 bg-black/60 grid place-items-center p-6" onMouseDown={e => { if (e.target === e.currentTarget) aoFechar() }}>
      <div ref={caixa} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="c-exp-titulo"
        className="w-full max-w-[480px] rounded-[18px] bg-[var(--raised)] border border-[var(--line)] p-7 outline-none">
        <div className="flex items-start justify-between gap-4">
          <h2 id="c-exp-titulo" className="font-geist text-[22px] font-semibold tracking-[-0.015em]">
            {feito ? `${itens.length} ${plural} exportado${itens.length === 1 ? '' : 's'}` : `Exportar ${itens.length} ${plural}`}
          </h2>
          <button onClick={aoFechar} aria-label="Fechar" className={`-mr-2 -mt-1 grid place-items-center size-8 rounded-lg text-[var(--tx-3)] hover:text-[var(--tx)] hover:bg-[var(--hover)] ${foco}`}><X size={16} /></button>
        </div>

        <ul className="mt-5 flex flex-col gap-2.5">
          {itens.map(({ corte, dur }) => (
            <li key={corte.id} className="flex items-center gap-3">
              <img src={img(corte.thumbs[2])} alt="" className="w-[60px] aspect-video rounded-md object-cover" />
              <span className="flex-1 min-w-0 truncate text-[14px]">{corte.titulo}</span>
              <span className="font-mono tabular text-[12px] text-[var(--tx-3)]">{tc(dur)}</span>
            </li>
          ))}
        </ul>

        {!feito && prog === null && (
          <div className="mt-6 flex flex-col divide-y divide-[var(--line)] border-y border-[var(--line)]">
            <label className="flex items-center justify-between gap-4 py-3.5 cursor-pointer">
              <span>
                <span className="block text-[14px]">Legenda gravada no vídeo</span>
                <span className="block text-[13px] text-[var(--tx-3)]">MP4 vertical, 1080×1920, 24 fps</span>
              </span>
              <Interruptor ligado={legenda} aoMudar={setLegenda} rotulo="Legenda gravada no vídeo" />
            </label>
            <label className="flex items-center justify-between gap-4 py-3.5 cursor-pointer">
              <span>
                <span className="block text-[14px]">Gerar Empacotamento</span>
                <span className="block text-[13px] text-[var(--tx-3)]">Título, descrição e hashtags pelo Provedor</span>
              </span>
              <Interruptor ligado={pacote} aoMudar={setPacote} rotulo="Gerar Empacotamento" />
            </label>
          </div>
        )}

        {prog !== null && (
          <div className="mt-6">
            <div className="h-1 rounded-full bg-[var(--line)] overflow-hidden">
              <div className="h-full bg-[var(--tx)] transition-[width] duration-75" style={{ width: `${prog * 100}%` }} />
            </div>
            <p className="mt-2.5 text-[13px] text-[var(--tx-3)] tabular">
              {feito ? 'Salvo em Clipes/Canal dark/exportados' : `Renderizando, ${Math.round(prog * 100)}%`}
            </p>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-[13px] text-[var(--tx-3)] tabular">
            Custo do Provedor <span className="text-[var(--tx)]">{dinheiro(custo)}</span>
          </p>
          {feito ? (
            <div className="flex gap-2">
              <Botao tipo="fantasma" onClick={aoFechar}>Fechar</Botao>
              <Botao><FolderOpen size={15} /> Abrir pasta</Botao>
            </div>
          ) : (
            <div className="flex gap-2">
              <Botao tipo="fantasma" onClick={aoFechar}>Cancelar</Botao>
              <Botao tipo="primario" disabled={prog !== null} onClick={() => setProg(0)}>
                {prog !== null ? 'Exportando' : <><Check size={15} /> Exportar</>}
              </Botao>
            </div>
          )}
        </div>
        {!feito && prog === null && pacote && (
          <p className="mt-3 text-[12px] text-[var(--tx-3)] tabular">{dinheiro(CUSTO_CORTE)} por Corte, {virgula(itens.reduce((s, x) => s + x.dur, 0), 0)} s no total</p>
        )}
      </div>
    </div>
  )
}
