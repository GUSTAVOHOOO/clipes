// Etapa 3: editar um Corte. Preview enorme no centro, um painel por vez, timeline numa faixa só.
import { useEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent as PE } from 'react'
import { AudioWaveform, ChevronLeft, ChevronRight, Crop, FileText, Pause, Play, Type, X } from 'lucide-react'
import { cortes, img, presets, tc, type Corte } from '../../dados'
import type { Tela } from '../../App'
import { Botao, Interruptor, Legenda, Preview, Topo, atalhoLivre, foco, memoria, usePlayhead, virgula, type Preset } from './comum'
import { Exportar } from './Exportar'

type Painel = 'transcricao' | 'legenda' | 'enquadramento' | 'silencios'
const RAIL: { id: Painel; nome: string; Icone: ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { id: 'transcricao', nome: 'Transcrição', Icone: FileText },
  { id: 'legenda', nome: 'Legenda', Icone: Type },
  { id: 'enquadramento', nome: 'Enquadramento', Icone: Crop },
  { id: 'silencios', nome: 'Silêncios', Icone: AudioWaveform },
]
const LARGURA_CROP = (1080 * 9 / 16) / 1920 // fração da largura do quadro 16:9
const limitarCx = (x: number) => Math.min(1 - LARGURA_CROP / 2, Math.max(LARGURA_CROP / 2, x))

type Sel = { a: number; b: number }

export function Editor({ irPara }: { irPara: (t: Tela) => void }) {
  const [ci, setCi] = useState(memoria.corte)
  const corte = cortes[ci]
  const [painel, setPainel] = useState<Painel | null>('transcricao')
  const [presetId, setPresetId] = useState('classico')
  const [cxs, setCxs] = useState<Record<string, number>>({})
  const [sels, setSels] = useState<Record<string, Sel>>({})
  const [silencios, setSilencios] = useState(false)
  const [limiar, setLimiar] = useState(0.4)
  const [exportando, setExportando] = useState(() => { const v = memoria.abrirExportar; memoria.abrirExportar = false; return v })
  const ph = usePlayhead(corte)

  const preset = presets.find(p => p.id === presetId) ?? presets[0]
  const cx = cxs[corte.id] ?? corte.cx
  const sel = sels[corte.id] ?? { a: 0, b: corte.frases.length - 1 }
  const ini = corte.frases[sel.a].s, fim = corte.frases[sel.b].e
  const pausas = useMemo(() => achar(corte, limiar, ini, fim), [corte, limiar, ini, fim])
  const cortado = silencios ? pausas.reduce((s, p) => s + p.e - p.s, 0) : 0
  const dur = fim - ini - cortado

  const setSel = (s: Sel) => setSels(v => ({ ...v, [corte.id]: s }))
  const trocar = (d: number) => { const n = (ci + d + cortes.length) % cortes.length; setCi(n); memoria.corte = n }
  const ir = (i: number) => { ph.setTocando(false); ph.setI(Math.max(0, Math.min(corte.palavras.length - 1, i))) }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!atalhoLivre(e)) return
      if ((e.target as HTMLElement).closest('[role="slider"],[role="radio"]')) return
      if (e.key === ' ') { e.preventDefault(); ph.setTocando(!ph.tocando) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); ir(ph.i + 1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); ir(ph.i - 1) }
    }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  })

  return (
    <>
      <Topo etapa={exportando ? 3 : 2} irPara={irPara} aoExportar={() => setExportando(true)}
        direita={<Botao tipo="primario" onClick={() => setExportando(true)}>Exportar</Botao>} />

      <div className="flex-1 min-h-0 flex">
        {/* Rail */}
        <nav aria-label="Ferramentas" className="w-16 shrink-0 flex flex-col items-center gap-1.5 pt-10">
          {RAIL.map(({ id, nome, Icone }) => {
            const on = painel === id
            return (
              <button key={id} onClick={() => setPainel(on ? null : id)} aria-pressed={on} aria-label={nome}
                className={`group relative grid place-items-center size-11 rounded-[12px] transition-colors ${foco}
                  ${on ? 'bg-[var(--surface)] text-[var(--tx)]' : 'text-[var(--tx-3)] hover:text-[var(--tx)] hover:bg-[var(--raised)]'}`}>
                <Icone size={19} strokeWidth={1.75} />
                <span className="pointer-events-none absolute left-full ml-2 z-30 whitespace-nowrap rounded-md bg-[var(--surface)] border border-[var(--line)] px-2 py-1 text-[12px] text-[var(--tx)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">{nome}</span>
              </button>
            )
          })}
        </nav>

        {/* Painel único, desliza ao lado do preview */}
        <div className="shrink-0 overflow-hidden transition-[width] duration-200 ease-out" style={{ width: painel ? 372 : 0 }}>
          <aside className="w-[372px] h-full pl-2 pr-6 pt-8 pb-4 flex flex-col min-h-0" aria-label={RAIL.find(r => r.id === painel)?.nome}>
            {painel && (
              <div className="flex-1 min-h-0 flex flex-col rounded-[16px] bg-[var(--raised)] border border-[var(--line)]">
                <div className="flex items-center justify-between pl-5 pr-2 pt-3.5 pb-1">
                  <h2 className="font-geist text-[15px] font-semibold tracking-[-0.01em]">{RAIL.find(r => r.id === painel)!.nome}</h2>
                  <button onClick={() => setPainel(null)} aria-label="Fechar painel" className={`grid place-items-center size-8 rounded-lg text-[var(--tx-3)] hover:text-[var(--tx)] hover:bg-[var(--hover)] ${foco}`}><X size={15} /></button>
                </div>
                {painel === 'transcricao' && <PainelTranscricao corte={corte} ativa={ph.i} sel={sel} aoIr={ir} pausas={silencios ? pausas : []} />}
                {painel === 'legenda' && <PainelLegenda corte={corte} ativa={ph.i} preset={preset} aoEscolher={setPresetId} />}
                {painel === 'enquadramento' && <PainelEnquadramento corte={corte} cx={cx} aoMudar={x => setCxs({ ...cxs, [corte.id]: x })} />}
                {painel === 'silencios' && <PainelSilencios ligado={silencios} aoLigar={setSilencios} limiar={limiar} aoLimiar={setLimiar}
                  pausas={pausas} total={fim - ini} corte={corte} aoIr={t => ir(corte.palavras.findIndex(w => w.s >= t))} />}
              </div>
            )}
          </aside>
        </div>

        {/* Preview */}
        <main className="flex-1 min-w-0 flex flex-col items-center pt-3 pb-5 px-8">
          <div className="flex items-center gap-1 text-[13px] text-[var(--tx-2)] h-8 max-w-full">
            <button onClick={() => trocar(-1)} aria-label="Corte anterior" className={`grid place-items-center size-7 rounded-md text-[var(--tx-3)] hover:text-[var(--tx)] hover:bg-[var(--hover)] ${foco}`}><ChevronLeft size={16} /></button>
            <span className="truncate px-1 text-[var(--tx)]">{corte.titulo}</span>
            <span className="text-[var(--tx-3)] tabular whitespace-nowrap">{ci + 1} de {cortes.length}</span>
            <button onClick={() => trocar(1)} aria-label="Próximo Corte" className={`grid place-items-center size-7 rounded-md text-[var(--tx-3)] hover:text-[var(--tx)] hover:bg-[var(--hover)] ${foco}`}><ChevronRight size={16} /></button>
          </div>
          <div className="flex-1 min-h-0 w-full flex justify-center pt-3">
            <Preview corte={corte} ativa={ph.i} preset={preset} cx={cx} className="h-full max-w-full" />
          </div>
        </main>
      </div>

      <Timeline corte={corte} ativa={ph.i} tocando={ph.tocando} aoTocar={() => ph.setTocando(!ph.tocando)} aoIr={ir}
        sel={sel} aoSel={setSel} pausas={silencios ? pausas : []} dur={dur} cortado={cortado} />

      {exportando && <Exportar itens={[{ corte, dur }]} aoFechar={() => setExportando(false)} />}
    </>
  )
}

/** Pausas entre palavras seguidas, dentro do trecho selecionado. */
function achar(corte: Corte, limiar: number, ini: number, fim: number) {
  const r: { s: number; e: number }[] = []
  const w = corte.palavras
  for (let k = 1; k < w.length; k++) {
    const s = w[k - 1].e, e = w[k].s
    if (e - s >= limiar && s >= ini && e <= fim) r.push({ s, e })
  }
  return r
}

// ---------- Painéis ----------
function PainelTranscricao({ corte, ativa, sel, aoIr, pausas }: {
  corte: Corte; ativa: number; sel: Sel; aoIr: (i: number) => void; pausas: { s: number; e: number }[]
}) {
  const caixa = useRef<HTMLDivElement>(null)
  const fraseAtiva = corte.palavras[ativa]?.f
  useEffect(() => {
    const c = caixa.current, el = c?.querySelector<HTMLElement>(`[data-frase="${fraseAtiva}"]`)
    if (!c || !el) return
    const top = el.offsetTop - c.offsetTop, bot = top + el.offsetHeight
    if (top < c.scrollTop + 8) c.scrollTop = top - 8
    else if (bot > c.scrollTop + c.clientHeight - 8) c.scrollTop = bot - c.clientHeight + 8
  }, [fraseAtiva])
  return (
    <>
      <p className="px-5 text-[13px] text-[var(--tx-3)]">{corte.frases.length} Frases. Clique numa palavra para ir até ela.</p>
      <div ref={caixa} className="relative flex-1 min-h-0 overflow-y-auto px-3 pt-3 pb-4 mt-1">
        {corte.frases.map((f, k) => {
          const dentro = k >= sel.a && k <= sel.b
          const on = f.id === fraseAtiva
          const pausa = pausas.find(p => p.s >= f.e - 0.01 && p.s < f.e + 0.01)
          return (
            <div key={f.id}>
              <div data-frase={f.id} className={`flex gap-3 rounded-[10px] px-2 py-2 ${on ? 'bg-[var(--surface)]' : ''} ${dentro ? '' : 'opacity-40'}`}>
                <span className="w-11 shrink-0 pt-[3px] font-mono tabular text-[11px] text-[var(--tx-3)]">{tc(f.s - corte.inicio, true)}</span>
                <p className="text-[14.5px] leading-[1.7]">
                  {corte.palavras.map((w, i) => w.f !== f.id ? null : (
                    <button key={w.id} onClick={() => aoIr(i)}
                      className={`rounded-[4px] px-[2px] mr-[2px] transition-colors ${foco}
                        ${i === ativa ? 'bg-[var(--tx)] text-[var(--bg)]' : on ? 'text-[var(--tx)] hover:bg-[var(--hover)]' : 'text-[var(--tx-2)] hover:text-[var(--tx)] hover:bg-[var(--hover)]'}`}>
                      {w.t}
                    </button>
                  ))}
                </p>
              </div>
              {!dentro && k === sel.a - 1 && <Divisa texto="Início do Corte" />}
              {pausa && dentro && k < sel.b && <Divisa texto={`Pausa de ${virgula(pausa.e - pausa.s)} s removida`} />}
              {k === sel.b && sel.b < corte.frases.length - 1 && <Divisa texto="Fim do Corte" />}
            </div>
          )
        })}
      </div>
    </>
  )
}
function Divisa({ texto }: { texto: string }) {
  return (
    <div className="flex items-center gap-2 pl-[60px] pr-2 my-1 text-[11px] text-[var(--tx-3)]">
      <span className="h-px flex-1 bg-[var(--line)]" /> {texto} <span className="h-px flex-1 bg-[var(--line)]" />
    </div>
  )
}

const DESCR: Record<string, string> = {
  classico: 'Branco com contorno, destaque amarelo, 3 palavras',
  impacto: 'Caixa alta grande, destaque ciano, 2 palavras',
  limpo: 'Sem contorno, frase mais longa, 5 palavras',
  caixa: 'Texto escuro sobre faixa clara, 4 palavras',
}
function PainelLegenda({ corte, ativa, preset, aoEscolher }: { corte: Corte; ativa: number; preset: Preset; aoEscolher: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Estilo da legenda" className="flex-1 min-h-0 overflow-y-auto px-3 pt-2 pb-3 flex flex-col gap-1">
      {presets.map(p => {
        const on = p.id === preset.id
        return (
          <button key={p.id} role="radio" aria-checked={on} onClick={() => aoEscolher(p.id)}
            className={`flex items-center gap-4 rounded-[12px] p-2 text-left transition-colors ${foco} ${on ? 'bg-[var(--surface)]' : 'hover:bg-[var(--hover)]'}`}>
            <span className={`relative shrink-0 w-[58px] aspect-[9/16] overflow-hidden rounded-[8px] bg-black [container-type:inline-size] ${on ? 'ring-2 ring-[var(--tx)]' : ''}`}>
              <img src={img(corte.vert)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80" />
              <Legenda corte={corte} ativa={ativa} preset={p} />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] text-[var(--tx)]">{p.nome}</span>
              <span className="block mt-0.5 text-[13px] leading-snug text-[var(--tx-3)]">{DESCR[p.id]}</span>
            </span>
          </button>
        )
      })}
      <p className="px-2 pt-3 text-[13px] leading-snug text-[var(--tx-3)]">A palavra falada fica em destaque. O estilo vale para este Corte e para o Perfil de canal, se você quiser fixá-lo depois.</p>
    </div>
  )
}

function PainelEnquadramento({ corte, cx, aoMudar }: { corte: Corte; cx: number; aoMudar: (x: number) => void }) {
  const quadro = useRef<HTMLDivElement>(null)
  const mover = (e: PE) => {
    const r = quadro.current!.getBoundingClientRect()
    aoMudar(limitarCx((e.clientX - r.left) / r.width))
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-4">
      <p className="text-[13px] leading-snug text-[var(--tx-3)]">Quadro da Fonte em 16:9. Arraste o retângulo para escolher o que entra no 9:16.</p>
      <div ref={quadro} className="relative mt-4 aspect-video rounded-[10px] overflow-hidden bg-black cursor-ew-resize touch-none select-none"
        onPointerDown={e => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); mover(e) }}
        onPointerMove={e => { if (e.buttons) mover(e) }}>
        <img src={img(corte.wide)} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
        <div role="slider" tabIndex={0} aria-label="Posição horizontal do enquadramento" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(cx * 100)}
          onKeyDown={e => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); aoMudar(limitarCx(cx + (e.key === 'ArrowRight' ? 0.02 : -0.02))) }
          }}
          className="absolute top-0 bottom-0 border-2 border-[var(--tx)] rounded-[3px] outline-none focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-white focus-visible:-outline-offset-[6px]"
          style={{ left: `${(cx - LARGURA_CROP / 2) * 100}%`, width: `${LARGURA_CROP * 100}%`, boxShadow: '0 0 0 999px rgba(12,10,9,.7)' }} />
      </div>
      <div className="mt-4 flex items-center justify-between text-[13px]">
        <span className="text-[var(--tx-2)]">Posição horizontal <span className="font-mono tabular text-[var(--tx)]">{Math.round(cx * 100)}%</span></span>
        <Botao tipo="fantasma" disabled={Math.abs(cx - corte.cx) < 0.001} onClick={() => aoMudar(corte.cx)}>Voltar ao automático</Botao>
      </div>
      <p className="mt-2 text-[13px] leading-snug text-[var(--tx-3)]">O automático segue o rosto de quem fala, quadro a quadro.</p>
    </div>
  )
}

function PainelSilencios({ ligado, aoLigar, limiar, aoLimiar, pausas, total, corte, aoIr }: {
  ligado: boolean; aoLigar: (v: boolean) => void; limiar: number; aoLimiar: (v: number) => void
  pausas: { s: number; e: number }[]; total: number; corte: Corte; aoIr: (t: number) => void
}) {
  const soma = pausas.reduce((s, p) => s + p.e - p.s, 0)
  return (
    <div className="flex-1 min-h-0 flex flex-col px-5 pt-2 pb-4">
      <label className="flex items-center justify-between gap-4 cursor-pointer">
        <span className="text-[14px]">Remover silêncios</span>
        <Interruptor ligado={ligado} aoMudar={aoLigar} rotulo="Remover silêncios" />
      </label>
      <div className="mt-5">
        <div className="flex items-baseline justify-between text-[13px]">
          <label htmlFor="c-limiar" className="text-[var(--tx-2)]">Pausa mínima</label>
          <span className="font-mono tabular text-[var(--tx)]">{virgula(limiar)} s</span>
        </div>
        <input id="c-limiar" type="range" min={0.2} max={1} step={0.1} value={limiar} onChange={e => aoLimiar(+e.target.value)}
          className={`mt-2 w-full accent-[var(--tx)] ${foco}`} />
      </div>
      <p className="mt-4 text-[13px] leading-snug text-[var(--tx-2)] tabular">
        {pausas.length} pausas somam {virgula(soma)} s. {ligado ? `O Corte cai de ${virgula(total)} s para ${virgula(total - soma)} s.` : 'Ligue para tirar as pausas do Corte.'}
      </p>
      <ul className="mt-3 flex-1 min-h-0 overflow-y-auto -mx-2">
        {pausas.map(p => (
          <li key={p.s}>
            <button onClick={() => aoIr(p.e)} className={`w-full flex items-center justify-between rounded-[8px] px-2 py-1.5 text-[13px] hover:bg-[var(--hover)] ${foco}`}>
              <span className="font-mono tabular text-[var(--tx-2)]">{tc(p.s - corte.inicio, true)}</span>
              <span className={`font-mono tabular ${ligado ? 'text-[var(--tx-3)] line-through' : 'text-[var(--tx-2)]'}`}>{virgula(p.e - p.s)} s</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------- Timeline ----------
function Timeline({ corte, ativa, tocando, aoTocar, aoIr, sel, aoSel, pausas, dur, cortado }: {
  corte: Corte; ativa: number; tocando: boolean; aoTocar: () => void; aoIr: (i: number) => void
  sel: Sel; aoSel: (s: Sel) => void; pausas: { s: number; e: number }[]; dur: number; cortado: number
}) {
  const faixa = useRef<HTMLDivElement>(null)
  const W0 = corte.inicio, W1 = corte.fim
  const pct = (t: number) => ((t - W0) / (W1 - W0)) * 100
  const ini = corte.frases[sel.a].s, fim = corte.frases[sel.b].e
  const n = corte.frases.length
  const tempo = (x: number) => { const r = faixa.current!.getBoundingClientRect(); return W0 + Math.min(1, Math.max(0, (x - r.left) / r.width)) * (W1 - W0) }
  const p = corte.palavras[ativa]

  const buscar = (e: PE) => {
    const t = tempo(e.clientX)
    let k = corte.palavras.findIndex(w => w.e > t)
    if (k < 0) k = corte.palavras.length - 1
    aoIr(k)
  }
  const arrastar = (lado: 'a' | 'b') => (e: PE) => {
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const mov = (ev: PointerEvent) => {
      const t = tempo(ev.clientX)
      const cand = corte.frases.map((f, k) => ({ k, d: Math.abs((lado === 'a' ? f.s : f.e) - t) }))
        .filter(c => lado === 'a' ? c.k <= sel.b : c.k >= sel.a).sort((x, y) => x.d - y.d)[0]
      if (cand) aoSel(lado === 'a' ? { a: cand.k, b: sel.b } : { a: sel.a, b: cand.k })
    }
    const fim = () => { el.removeEventListener('pointermove', mov); el.removeEventListener('pointerup', fim) }
    el.addEventListener('pointermove', mov); el.addEventListener('pointerup', fim)
  }
  const teclaAlca = (lado: 'a' | 'b') => (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (!d) return
    e.preventDefault()
    if (lado === 'a') aoSel({ a: Math.max(0, Math.min(sel.b, sel.a + d)), b: sel.b })
    else aoSel({ a: sel.a, b: Math.min(n - 1, Math.max(sel.a, sel.b + d)) })
  }

  return (
    <footer className="shrink-0 px-6 pb-[64px] pt-1">
      <div className="flex items-center gap-4">
        <div className="w-[132px] shrink-0 flex items-center gap-3">
          <button onClick={aoTocar} aria-label={tocando ? 'Pausar' : 'Reproduzir'}
            className={`grid place-items-center size-10 rounded-full bg-[var(--surface)] text-[var(--tx)] hover:bg-[var(--hover)] ${foco}`}>
            {tocando ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
          </button>
          <span className="font-mono tabular text-[13px] text-[var(--tx)]">{p ? tc(p.s - corte.inicio, true) : '0:00.0'}</span>
        </div>

        <Estender rotulo="início" menos={() => aoSel({ a: Math.min(sel.b, sel.a + 1), b: sel.b })} mais={() => aoSel({ a: sel.a - 1, b: sel.b })}
          podeMenos={sel.a < sel.b} podeMais={sel.a > 0} />

        <div className="flex-1 min-w-0">
          <div ref={faixa} className="relative h-[60px] cursor-pointer select-none touch-none" onPointerDown={buscar}>
            <div className="absolute inset-0 rounded-[10px] overflow-hidden bg-[var(--surface)]">
              <div className="absolute inset-0 flex">
                {corte.thumbs.map(t => <img key={t} src={img(t)} alt="" draggable={false} className="flex-1 min-w-0 h-full object-cover opacity-45" />)}
              </div>
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 240 100" preserveAspectRatio="none" aria-hidden>
                {corte.peaks.map((v, i) => { const h = Math.max(2, v * 78); return <rect key={i} x={i + 0.15} width={0.7} y={50 - h / 2} height={h} fill="#ece8e3" opacity={0.75} /> })}
              </svg>
              {corte.frases.map(f => <span key={f.id} className="absolute top-0 h-2 w-px bg-white/60" style={{ left: `${pct(f.s)}%` }} />)}
              {pausas.map(q => (
                <span key={q.s} className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,rgba(12,10,9,.85)_0_3px,rgba(12,10,9,.35)_3px_6px)]"
                  style={{ left: `${pct(q.s)}%`, width: `${pct(q.e) - pct(q.s)}%` }} />
              ))}
              <span className="absolute inset-y-0 left-0 bg-[var(--bg)]/75" style={{ width: `${pct(ini)}%` }} />
              <span className="absolute inset-y-0 right-0 bg-[var(--bg)]/75" style={{ width: `${100 - pct(fim)}%` }} />
            </div>
            {/* Trecho selecionado e alças */}
            <span className="pointer-events-none absolute inset-y-0 border-y-2 border-[var(--tx)]" style={{ left: `${pct(ini)}%`, width: `${pct(fim) - pct(ini)}%` }} />
            {(['a', 'b'] as const).map(lado => (
              <span key={lado} role="slider" tabIndex={0} aria-label={lado === 'a' ? 'Início do Corte' : 'Fim do Corte'}
                aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={sel[lado]} aria-valuetext={tc(lado === 'a' ? ini : fim, true)}
                onPointerDown={arrastar(lado)} onKeyDown={teclaAlca(lado)}
                className={`absolute inset-y-0 w-3 bg-[var(--tx)] cursor-ew-resize grid place-items-center ${lado === 'a' ? 'rounded-l-[8px]' : 'rounded-r-[8px] -translate-x-full'} ${foco}`}
                style={{ left: `${pct(lado === 'a' ? ini : fim)}%` }}>
                <span className="w-px h-5 bg-[var(--bg)]/60" />
              </span>
            ))}
            {p && <span className="pointer-events-none absolute -top-1.5 -bottom-1.5 w-[2px] -ml-px rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,.5)]" style={{ left: `${pct(p.s)}%` }} />}
          </div>
          <div className="relative mt-2 h-4 text-[12px] leading-4 text-[var(--tx-3)] tabular">
            <span className="absolute font-mono" style={{ left: `${pct(ini)}%` }}>{tc(ini - W0, true)}</span>
            <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">
              <span className="text-[var(--tx)]">{virgula(dur)} s</span>, {sel.b - sel.a + 1} de {n} Frases{cortado > 0 && `, ${virgula(cortado)} s de silêncio removidos`}
            </span>
            <span className="absolute font-mono" style={{ right: `${100 - pct(fim)}%` }}>{tc(fim - W0, true)}</span>
          </div>
        </div>

        <Estender rotulo="fim" menos={() => aoSel({ a: sel.a, b: Math.max(sel.a, sel.b - 1) })} mais={() => aoSel({ a: sel.a, b: sel.b + 1 })}
          podeMenos={sel.b > sel.a} podeMais={sel.b < n - 1} />
      </div>
    </footer>
  )
}

function Estender({ rotulo, menos, mais, podeMenos, podeMais }: { rotulo: string; menos: () => void; mais: () => void; podeMenos: boolean; podeMais: boolean }) {
  const b = `h-8 px-2.5 text-[12px] font-medium text-[var(--tx-2)] hover:text-[var(--tx)] hover:bg-[var(--hover)] disabled:opacity-35 disabled:pointer-events-none tabular ${foco}`
  return (
    <div className="shrink-0 flex flex-col items-center gap-1 -mt-5">
      <span className="text-[11px] text-[var(--tx-3)]">Frase no {rotulo}</span>
      <div className="flex rounded-[9px] border border-[var(--line-2)] overflow-hidden divide-x divide-[var(--line-2)]">
        <button className={b} onClick={menos} disabled={!podeMenos} title={`Encurtar o ${rotulo} em 1 Frase`}>−1</button>
        <button className={b} onClick={mais} disabled={!podeMais} title={`Estender o ${rotulo} em 1 Frase`}>+1</button>
      </div>
    </div>
  )
}
