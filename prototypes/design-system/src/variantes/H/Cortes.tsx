// Variante H, "Linha": os Cortes aparecem onde estão na Fonte. Um mapa da Fonte inteira em cima (cada Corte
// é uma haste na sua posição, com a altura da Nota); embaixo, a lista na ordem do tempo e a Nota explicada.
import { useState } from 'react'
import { Check, Download, X } from 'lucide-react'
import { toast } from 'sonner'
import { cortes, fonte, img, tc } from '../../dados'
import type { PropsVariante } from '../../App'
import { BarraNota, Botao, Kbd, clamp, foco, num } from '../nucleo/base'
import { GatilhoPaleta, Paleta, useAtalhos, type Cmd } from '../nucleo/Paleta'
import { TopoH, memoH } from './comum'

const noTempo = [...cortes].sort((a, b) => a.inicio - b.inicio)

export default function CortesH({ tela, irPara }: PropsVariante) {
  const [foc, setFoc] = useState(() => Math.max(0, noTempo.findIndex(c => c.id === cortes[memoH.corte].id)))
  const [status, setStatus] = useState(memoH.status)
  const c = noTempo[foc]
  const marcar = (id: string, v: 'aprovado' | 'rejeitado') => { const n = { ...status, [id]: status[id] === v ? undefined : v }; memoH.status = n; setStatus(n) }
  const aprovados = noTempo.filter(k => status[k.id] === 'aprovado')
  const abrir = () => { memoH.corte = cortes.findIndex(k => k.id === c.id); irPara('editor') }
  const exportar = () => aprovados.length
    ? toast(`Exportando ${aprovados.length} ${aprovados.length === 1 ? 'Corte' : 'Cortes'}`, { description: 'Com Empacotamento sugerido: título, descrição com crédito e tags' })
    : toast('Aprove pelo menos um Corte para exportar', { duration: 1800 })

  useAtalhos(ev => {
    const k = ev.key, l = k.toLowerCase(), ctrl = ev.ctrlKey || ev.metaKey
    if (ctrl && l === 'e') { ev.preventDefault(); return exportar() }
    if (ctrl) return
    if (k === 'ArrowRight' || k === 'ArrowDown') { ev.preventDefault(); return setFoc(i => clamp(i + 1, 0, noTempo.length - 1)) }
    if (k === 'ArrowLeft' || k === 'ArrowUp') { ev.preventDefault(); return setFoc(i => clamp(i - 1, 0, noTempo.length - 1)) }
    if (l === 'a') return marcar(c.id, 'aprovado')
    if (l === 'r') return marcar(c.id, 'rejeitado')
    if (k === 'Enter') return abrir()
  })
  const comandos: Cmd[] = [
    { id: 'apr', grupo: 'Corte em foco', rotulo: 'Aprovar', tecla: ['A'], acao: () => marcar(c.id, 'aprovado') },
    { id: 'rej', grupo: 'Corte em foco', rotulo: 'Rejeitar', tecla: ['R'], acao: () => marcar(c.id, 'rejeitado') },
    { id: 'abr', grupo: 'Corte em foco', rotulo: 'Abrir no editor', tecla: ['Enter'], acao: abrir },
    { id: 'exp', grupo: 'Lote', rotulo: `Exportar aprovados (${aprovados.length})`, tecla: ['Ctrl', 'E'], acao: exportar },
  ]
  const marcas = [0, 0.5, 1, 1.5, 2].map(h => h * 3600).filter(s => s <= fonte.duracao)

  return (
    <div className="h-full flex flex-col">
      <TopoH tela={tela} irPara={irPara} direita={<GatilhoPaleta />} />

      {/* mapa da Fonte */}
      <section className="shrink-0 px-8 pt-6 pb-5 border-b border-[var(--ln)] bg-[var(--s1)]" aria-label="Mapa da Fonte">
        <div className="flex items-baseline justify-between">
          <h1 className="text-[15px] font-medium">{fonte.nome} <span className="font-mono tabular-nums text-[12px] text-[var(--tx3)]">· {tc(fonte.duracao)}</span></h1>
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--tx3)]"><Kbd k={['←', '→']} /> Corte anterior / próximo</span>
        </div>
        <div className="relative mt-4 h-[124px]">
          {noTempo.map((k, i) => {
            const on = i === foc, x = (k.inicio / fonte.duracao) * 100, h = k.nota.total * 9
            const direita = x > 70
            return (
              <button key={k.id} onClick={() => setFoc(i)} aria-label={`${k.titulo}, Nota ${num(k.nota.total)}, em ${tc(k.inicio)}`}
                className={`group absolute bottom-[22px] ${foco} rounded-[4px]`} style={{ left: `${x}%`, height: h + 30 }}>
                <span className={`absolute bottom-0 left-0 w-[3px] rounded-t-full transition-colors duration-150 ${on ? 'bg-[var(--acc)]' : 'bg-[var(--tx3)] group-hover:bg-[var(--tx2)]'}`} style={{ height: h }} />
                <span className={`absolute top-0 whitespace-nowrap text-[12px] leading-tight ${direita ? 'right-[-3px] text-right' : 'left-0'} ${on ? 'text-[var(--tx)]' : 'text-[var(--tx3)] group-hover:text-[var(--tx2)]'}`}>
                  {k.titulo} <span className="tabular-nums font-medium">{num(k.nota.total)}</span>
                  {status[k.id] === 'aprovado' && <Check size={12} className="inline ml-1 -mt-0.5" />}
                </span>
              </button>
            )
          })}
          <div className="absolute inset-x-0 bottom-[22px] h-px bg-[var(--ln2)]" />
          {marcas.map(s => (
            <span key={s} className="absolute bottom-0 font-mono tabular-nums text-[10.5px] text-[var(--tx3)]" style={{ left: `${(s / fonte.duracao) * 100}%` }}>
              <span className="absolute -top-[5px] left-0 w-px h-[5px] bg-[var(--ln2)]" />{tc(s)}
            </span>
          ))}
        </div>
      </section>

      <div className="flex-1 min-h-0 flex">
        <ol className="flex-1 min-w-0 overflow-auto nu-rolagem px-5 py-3">
          {noTempo.map((k, i) => {
            const on = i === foc, st = status[k.id]
            return (
              <li key={k.id}>
                <button onClick={() => setFoc(i)} onDoubleClick={abrir} aria-current={on}
                  className={`w-full grid grid-cols-[72px_88px_1fr_56px_104px_92px] items-center gap-4 px-3 py-2.5 rounded-[8px] text-left transition-colors duration-150 ${foco} ${on ? 'bg-[var(--s2)]' : 'hover:bg-[var(--s1)]'}`}>
                  <span className={`font-mono tabular-nums text-[12px] ${on ? 'text-[var(--acc)]' : 'text-[var(--tx3)]'}`}>{tc(k.inicio)}</span>
                  <img src={img(k.thumbs[3])} alt="" className={`w-[88px] h-[50px] rounded-[4px] object-cover ${st === 'rejeitado' ? 'opacity-40' : ''}`} />
                  <span className={`text-[14px] truncate ${st === 'rejeitado' ? 'text-[var(--tx3)]' : ''}`}>{k.titulo}</span>
                  <span className="font-mono tabular-nums text-[12.5px] text-[var(--tx2)] text-right">{tc(k.fim - k.inicio)}</span>
                  <span className="flex items-center justify-end gap-2"><span className="tabular-nums text-[14px] font-medium">{num(k.nota.total)}</span><BarraNota valor={k.nota.total} largura={44} /></span>
                  <span className="text-right text-[12px]">{st === 'aprovado' ? <span className="inline-flex items-center gap-1"><Check size={13} /> Aprovado</span> : st === 'rejeitado' ? <span className="inline-flex items-center gap-1 text-[var(--tx3)]"><X size={13} /> Rejeitado</span> : <span className="text-[var(--tx3)]">Sugerido</span>}</span>
                </button>
              </li>
            )
          })}
        </ol>
        <aside key={c.id} className="h-nota w-[380px] shrink-0 border-l border-[var(--ln)] overflow-auto nu-rolagem px-6 py-5" aria-label="Nota explicada">
          <div className="flex items-baseline gap-2">
            <span className="text-[28px] font-semibold tabular-nums tracking-[-0.02em] leading-none">{num(c.nota.total)}</span>
            <span className="text-[12.5px] text-[var(--tx3)]">de 10 · {tc(c.inicio)} a {tc(c.fim)}</span>
          </div>
          <dl className="mt-5 flex flex-col gap-3.5">
            {c.nota.eixos.map(x => (
              <div key={x.nome} className="grid grid-cols-[1fr_auto] gap-x-3">
                <dt className="text-[12.5px]">{x.nome}</dt>
                <dd className="font-mono tabular-nums text-[12.5px] text-[var(--tx2)]">{x.valor}</dd>
                <dd className="col-span-2 mt-1.5"><BarraNota valor={x.valor} largura="100%" /></dd>
                <dd className="col-span-2 mt-1.5 text-[12px] leading-[1.5] text-[var(--tx2)]">{x.justificativa}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 flex flex-wrap gap-2">
            <Botao tamanho="p" tecla={['A']} onClick={() => marcar(c.id, 'aprovado')} aria-pressed={status[c.id] === 'aprovado'}><Check size={13} /> {status[c.id] === 'aprovado' ? 'Aprovado' : 'Aprovar'}</Botao>
            <Botao tamanho="p" tipo="fantasma" tecla={['R']} onClick={() => marcar(c.id, 'rejeitado')}>Rejeitar</Botao>
            <Botao tamanho="p" tipo="fantasma" tecla={['Enter']} onClick={abrir}>Editar</Botao>
          </div>
        </aside>
      </div>
      <footer className="h-12 shrink-0 flex items-center justify-between px-5 border-t border-[var(--ln)] bg-[var(--s1)] text-[12.5px]">
        <span className="text-[var(--tx2)] tabular-nums">{aprovados.length} de {noTempo.length} aprovados · custo do Provedor no lote <span className="text-[var(--tx)]">US$ 0,04</span></span>
        <Botao tipo="primario" tecla={['Ctrl', 'E']} onClick={exportar} disabled={!aprovados.length}><Download size={14} /> Exportar aprovados</Botao>
      </footer>
      <Paleta comandos={comandos} tela={tela} irPara={irPara} irCorte={i => { memoH.corte = i; irPara('editor') }} />
      <style>{`
        .h-nota{animation:h-nota .18s ease-out}
        @keyframes h-nota{from{opacity:0}to{opacity:1}}
        @media (prefers-reduced-motion: reduce){.h-nota{animation:none}}
      `}</style>
    </div>
  )
}
