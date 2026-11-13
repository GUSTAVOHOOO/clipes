// Editor do Corte, Variante E ("Estúdio + Comando"): a estrutura da A, enxuta.
// Trilho de Cortes recolhível ([), preview 9:16 com ar, inspector de ícones recolhível (I), timeline de hairlines.
// O que é raro (±1 Frase, presets, centralizar, trocar de Corte) mora na paleta, nos atalhos e no hover.
import { useEffect, useMemo, useRef, useState, type PointerEvent as PE, type KeyboardEvent as KE, type ReactNode } from 'react'
import { AudioWaveform, Captions, ChevronLeft, ChevronRight, Crop, Keyboard, PanelLeftClose, PanelLeftOpen, Pause, Play, ScrollText } from 'lucide-react'
import { cortes, presets, img, tc, type Corte } from '../../dados'
import { LinhaLegenda, grupoAtual, type Preset } from './Legenda'
import { LARG_CROP, acoes, clamp, destinos, edicaoDe, loja, mudarEdicao, num, presetAtual, silenciosDe, todasFrases, useLoja, type Aba, type Edicao, type Escala, type FraseT } from './estado'
import { Principal, Topo, useComandosTela, useE, useMigalhas, useTeclas } from './Shell'
import { Botao, Dica, Interruptor, Kbd, Segmentado, foco } from './ui'

const ABAS: { id: Aba; nome: string; tecla: string; icone: ReactNode }[] = [
  { id: 'transcricao', nome: 'Transcrição', tecla: 'T', icone: <ScrollText size={16} strokeWidth={1.6} /> },
  { id: 'legenda', nome: 'Legenda', tecla: 'L', icone: <Captions size={16} strokeWidth={1.6} /> },
  { id: 'enquadramento', nome: 'Enquadramento', tecla: 'E', icone: <Crop size={16} strokeWidth={1.6} /> },
  { id: 'audio', nome: 'Áudio', tecla: 'A', icone: <AudioWaveform size={16} strokeWidth={1.6} /> },
]
const abrirAba = (aba: Aba) => loja.set(s => ({ aba, inspector: s.aba === aba ? !s.inspector : true }))

export default function Editor() {
  const { abrirFolha } = useE()
  const st = useLoja()
  const c = cortes[st.corte]
  const e = edicaoDe(c, st)
  const preset = presetAtual(st)
  const migalhas = useMigalhas(true)

  const [t, setT] = useState(c.inicio)
  const [tocando, setTocando] = useState(false)
  const [corteVisto, setCorteVisto] = useState(c.id)
  if (corteVisto !== c.id) { setCorteVisto(c.id); setT(c.inicio); setTocando(false) }
  useEffect(() => { setT(v => clamp(v, e.inn, e.out)) }, [e.inn, e.out])

  const todas = todasFrases(c)
  const silencios = useMemo(() => silenciosDe(c, st.minimo, e), [c, st.minimo, e.inn, e.out]) // eslint-disable-line react-hooks/exhaustive-deps
  const economia = silencios.reduce((a, s) => a + s.e - s.s, 0)
  const final = e.out - e.inn - (st.semSilencio ? economia : 0)
  const tRel = clamp(t - e.inn - (st.semSilencio ? silencios.reduce((a, s) => a + clamp(t, s.s, s.e) - s.s, 0) : 0), 0, final)

  // Playhead falso: avança em tempo real e pula silêncios quando a remoção está ligada.
  const tRef = useRef(t); tRef.current = t
  useEffect(() => {
    if (!tocando) return
    let raf = 0, antes = performance.now()
    const passo = (agora: number) => {
      let n = tRef.current + (agora - antes) / 1000
      antes = agora
      if (st.semSilencio) { const s = silencios.find(x => n >= x.s && n < x.e); if (s) n = s.e }
      if (n >= e.out) { setT(e.out); setTocando(false); return }
      setT(n)
      raf = requestAnimationFrame(passo)
    }
    raf = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(raf)
  }, [tocando, st.semSilencio, silencios, e.out])
  const alternar = () => {
    if (!tocando && (t >= e.out - 0.05 || t < e.inn)) setT(e.inn)
    setTocando(v => !v)
  }
  const ir = (s: number) => { setT(s); setTocando(false) }

  // Frase e palavra ativas no tempo t.
  const frase = c.frases.find(f => t >= f.s && t < f.e) ?? [...c.frases].reverse().find(f => f.s <= t && t - f.e < 1.2)
  const daFrase = frase ? c.palavras.filter(w => w.f === frase.id) : []
  const ativa = daFrase.find(w => t >= w.s && t < w.e) ?? [...daFrase].reverse().find(w => w.s <= t)
  const grupo = grupoAtual(c.palavras, frase?.id, ativa?.id, st.porVez)

  const passoPalavra = (d: 1 | -1) => {
    const dentro = c.palavras.filter(w => w.s >= e.inn - 0.01 && w.s < e.out)
    if (!dentro.length) return
    const k = ativa ? dentro.findIndex(w => w.id === ativa.id) : -1
    const p = k >= 0 ? dentro[clamp(k + d, 0, dentro.length - 1)] : d > 0 ? dentro.find(w => w.s > t) ?? dentro[dentro.length - 1] : [...dentro].reverse().find(w => w.s < t) ?? dentro[0]
    ir(p.s + 0.001)
  }

  useTeclas(ev => {
    const k = ev.key, ctrl = ev.ctrlKey || ev.metaKey, l = k.toLowerCase()
    const pare = () => ev.preventDefault()
    if (ctrl && ev.shiftKey && k === 'ArrowRight') { pare(); return acoes.estender('inicio', -1) }
    if (ctrl && ev.shiftKey && k === 'ArrowLeft') { pare(); return acoes.estender('fim', -1) }
    if (ctrl) return
    if (ev.shiftKey && k === 'ArrowLeft') { pare(); return acoes.estender('inicio', 1) }
    if (ev.shiftKey && k === 'ArrowRight') { pare(); return acoes.estender('fim', 1) }
    if (k === ' ') { if ((ev.target as HTMLElement).closest('button')) return; pare(); return alternar() }
    if (k === 'ArrowLeft') { pare(); return passoPalavra(-1) }
    if (k === 'ArrowRight') { pare(); return passoPalavra(1) }
    if (k === 'ArrowUp') { pare(); return acoes.irCorte(st.corte - 1) }
    if (k === 'ArrowDown') { pare(); return acoes.irCorte(st.corte + 1) }
    if (k === '[') return loja.set(s => ({ trilho: !s.trilho }))
    if (l === 'i') return loja.set(s => ({ inspector: !s.inspector }))
    const aba = ABAS.find(a => a.tecla.toLowerCase() === l)
    if (aba) return loja.set({ aba: aba.id, inspector: true })
    if (l === 's') return acoes.alternarSilencios()
    if (l === 'c') return acoes.centralizar()
    if (['1', '2', '3', '4'].includes(k)) return acoes.aplicarPreset(+k - 1)
  })

  useComandosTela([
    { id: 'tocar', grupo: 'Editor', rotulo: tocando ? 'Pausar' : 'Reproduzir', tecla: ['Espaço'], acao: alternar },
    { id: 'ant', grupo: 'Editor', rotulo: 'Corte anterior', tecla: ['↑'], acao: () => acoes.irCorte(st.corte - 1) },
    { id: 'prox', grupo: 'Editor', rotulo: 'Próximo Corte', tecla: ['↓'], acao: () => acoes.irCorte(st.corte + 1) },
    ...ABAS.filter(a => a.id !== 'enquadramento').map(a => ({ id: 'aba-' + a.id, grupo: 'Editor', rotulo: `Mostrar ${a.nome}`, tecla: [a.tecla], acao: () => loja.set({ aba: a.id, inspector: true }) })),
    { id: 'insp', grupo: 'Editor', rotulo: st.inspector ? 'Recolher o inspector' : 'Mostrar o inspector', tecla: ['I'], acao: () => loja.set(s => ({ inspector: !s.inspector })) },
    { id: 'trilho', grupo: 'Editor', rotulo: st.trilho ? 'Recolher a lista de Cortes' : 'Mostrar a lista de Cortes', tecla: ['['], acao: () => loja.set(s => ({ trilho: !s.trilho })) },
  ])

  const aba = ABAS.find(a => a.id === st.aba)!
  return (
    <>
      <Topo migalhas={migalhas} direita={<Principal tecla={['Ctrl', 'E']} onClick={acoes.exportarCorte}>Exportar</Principal>} />
      <div className="flex-1 min-h-0 flex">
        <Trilho ci={st.corte} aberto={st.trilho} />
        <main className="flex-1 min-w-0 flex flex-col">
          <Palco c={c} e={e} grupo={grupo} ativa={ativa?.id} preset={preset} pos={st.pos} escala={st.escala} />
          <div className="h-14 shrink-0 flex items-center justify-center gap-3">
            <Dica texto={tocando ? 'Pausar' : 'Reproduzir'} tecla={['Espaço']} lado="cima">
              <button onClick={alternar} aria-label={tocando ? 'Pausar' : 'Reproduzir'}
                className={`w-8 h-8 rounded-full grid place-items-center bg-[var(--e-tx)] text-[#161616] hover:bg-white ${foco}`}>
                {tocando ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" className="ml-0.5" />}
              </button>
            </Dica>
            <span className="font-mono tabular text-[12.5px] text-[var(--e-tx)]">
              {tc(tRel, true)}<span className="text-[var(--e-tx3)]"> / {tc(final, true)}</span>
            </span>
          </div>
        </main>
        {st.inspector && (
          <aside className="w-[316px] shrink-0 flex flex-col bg-[var(--e-s1)] border-l border-[var(--e-ln)]" aria-label={aba.nome}>
            <div className="h-9 shrink-0 flex items-center px-4 text-[12px] text-[var(--e-tx3)]">{aba.nome}</div>
            <div role="tabpanel" className="flex-1 min-h-0 overflow-y-auto">
              {st.aba === 'transcricao' && <AbaTranscricao c={c} e={e} todas={todas} frase={frase?.id} ativa={ativa?.id} onPalavra={ir} />}
              {st.aba === 'legenda' && <AbaLegenda c={c} preset={preset} pos={st.pos} escala={st.escala} porVez={st.porVez} />}
              {st.aba === 'enquadramento' && <AbaEnquadramento c={c} cx={e.cx} />}
              {st.aba === 'audio' && <AbaAudio silencios={silencios} economia={economia} inn={e.inn} ligado={st.semSilencio} minimo={st.minimo} normalizar={st.normalizar} onIr={ir} />}
            </div>
          </aside>
        )}
        <nav role="tablist" aria-label="Inspector" aria-orientation="vertical"
          className="w-11 shrink-0 flex flex-col items-center gap-1 py-1.5 bg-[var(--e-s1)] border-l border-[var(--e-ln)]">
          {ABAS.map(a => {
            const on = st.inspector && st.aba === a.id
            return (
              <Dica key={a.id} texto={a.nome} tecla={[a.tecla]} lado="esquerda">
                <button role="tab" aria-selected={on} aria-label={a.nome} onClick={() => abrirAba(a.id)}
                  className={`w-8 h-8 grid place-items-center rounded-[6px] transition-colors ${foco} ${on ? 'bg-[var(--e-s3)] text-[var(--e-tx)]' : 'text-[var(--e-tx3)] hover:text-[var(--e-tx)] hover:bg-[var(--e-s2)]'}`}>
                  {a.icone}
                </button>
              </Dica>
            )
          })}
          <span className="flex-1" />
          <Dica texto="Atalhos" tecla={['?']} lado="esquerda">
            <button onClick={() => abrirFolha(true)} aria-label="Atalhos de teclado"
              className={`w-8 h-8 grid place-items-center rounded-[6px] text-[var(--e-tx3)] hover:text-[var(--e-tx)] hover:bg-[var(--e-s2)] ${foco}`}>
              <Keyboard size={16} strokeWidth={1.6} />
            </button>
          </Dica>
        </nav>
      </div>
      <Timeline c={c} e={e} t={t} todas={todas} frase={frase?.id} silencios={silencios} semSilencio={st.semSilencio} onT={ir} />
      <footer className="h-10 shrink-0 flex items-center gap-5 px-4 bg-[var(--e-s1)] text-[12px] text-[var(--e-tx3)]">
        <span className="tabular"><span className="font-mono text-[var(--e-tx2)]">{num(final)} s</span>
          {st.semSilencio && economia > 0 && <>, {silencios.length} silêncios removidos</>}</span>
        <span className="font-mono tabular">{tc(e.inn, true)} a {tc(e.out, true)} na Fonte</span>
      </footer>
    </>
  )
}

/* ---------------------------------------------------------------- trilho de Cortes */

function Trilho({ ci, aberto }: { ci: number; aberto: boolean }) {
  return (
    <aside aria-label="Cortes" className={`shrink-0 flex flex-col bg-[var(--e-s1)] border-r border-[var(--e-ln)] ${aberto ? 'w-[208px]' : 'w-[64px]'}`}>
      <div className={`h-9 shrink-0 flex items-center ${aberto ? 'justify-between pl-3 pr-1.5' : 'justify-center'}`}>
        {aberto && <span className="text-[12px] text-[var(--e-tx3)]">Cortes</span>}
        <Dica texto={aberto ? 'Recolher' : 'Mostrar títulos'} tecla={['[']} lado="direita">
          <button onClick={() => loja.set(s => ({ trilho: !s.trilho }))} aria-label={aberto ? 'Recolher a lista de Cortes' : 'Mostrar a lista de Cortes'} aria-expanded={aberto}
            className={`w-7 h-7 grid place-items-center rounded-[5px] text-[var(--e-tx3)] hover:text-[var(--e-tx)] hover:bg-[var(--e-s2)] ${foco}`}>
            {aberto ? <PanelLeftClose size={14} strokeWidth={1.6} /> : <PanelLeftOpen size={14} strokeWidth={1.6} />}
          </button>
        </Dica>
      </div>
      <ul className="flex-1 overflow-y-auto pb-2">
        {cortes.map((k, i) => {
          const on = i === ci
          return (
            <li key={k.id}>
              <button onClick={() => acoes.irCorte(i)} aria-current={on} title={aberto ? undefined : `${k.titulo}, Nota ${num(k.nota.total)}`}
                className={`relative w-full flex items-center gap-2.5 py-[7px] text-left ${aberto ? 'px-3' : 'justify-center'} ${foco} ${on ? 'bg-[var(--e-s2)]' : 'hover:bg-[var(--e-s2)]/60'}`}>
                {on && <span className="absolute left-0 top-[7px] bottom-[7px] w-[2px] rounded-full bg-[var(--e-acc)]" />}
                <img src={img(k.thumbs[3])} alt="" className={`w-12 h-[27px] rounded-[3px] object-cover shrink-0 bg-[var(--e-s3)] ${on ? '' : 'opacity-80'}`} />
                {aberto && (
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[12.5px] leading-[1.3] ${on ? 'text-[var(--e-tx)]' : 'text-[var(--e-tx2)]'}`}>{k.titulo}</span>
                    <span className="block mt-0.5 text-[11px] tabular text-[var(--e-tx3)]">Nota {num(k.nota.total)}</span>
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

/* ---------------------------------------------------------------- preview 9:16 */

function Palco({ c, e, grupo, ativa, preset, pos, escala }: { c: Corte; e: Edicao; grupo: { id: string; t: string }[]; ativa?: string; preset: Preset; pos: number; escala: Escala }) {
  const alterado = Math.abs(e.cx - c.cx) > 0.001
  const L = clamp(e.cx - LARG_CROP / 2, 0, 1 - LARG_CROP)
  // Só CSS: a altura vem do palco, a largura da proporção 9:16 e a legenda escala em cqw. Nada a medir em JS.
  return (
    <div className="relative flex-1 min-h-0 mx-10 mt-8">
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 h-full max-w-full aspect-[9/16] overflow-hidden rounded-[6px] bg-black ring-1 ring-[var(--e-ln)]" style={{ containerType: 'inline-size' }}>
        {alterado
          ? <div className="absolute inset-0" style={{ backgroundImage: `url(${img(c.wide)})`, backgroundSize: 'auto 100%', backgroundPosition: `${(L / (1 - LARG_CROP)) * 100}% 50%` }} />
          : <img src={img(c.vert)} alt={`Quadro do Corte ${c.titulo}`} className="absolute inset-0 w-full h-full object-cover" />}
        {grupo.length > 0 && (
          <div className="absolute inset-x-[7%] flex justify-center text-center -translate-y-1/2 pointer-events-none" style={{ top: `${pos * 100}%` }}>
            <LinhaLegenda palavras={grupo} ativa={ativa} preset={preset} tamanho={{ P: 7, M: 8.8, G: 10.6 }[escala]} unidade="cqw" />
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- timeline */

const RULER = 20, TH_Y = 22, TH_H = 40, WV_Y = 66, WV_H = 28, FR_Y = 98, FR_H = 12, FUNDO = FR_Y + FR_H

function Timeline({ c, e, t, todas, frase, silencios, semSilencio, onT }: {
  c: Corte; e: Edicao; t: number; todas: FraseT[]; frase?: string; silencios: { s: number; e: number }[]; semSilencio: boolean; onT: (t: number) => void
}) {
  const vs = Math.min(c.inicio - 6, e.inn - 1.5), ve = Math.max(c.fim + 6, e.out + 1.5), span = ve - vs
  const pc = (s: number) => ((s - vs) / span) * 100
  const x = (s: number) => `${pc(s)}%`
  const larg = (a: number, b: number) => `${((b - a) / span) * 100}%`
  const area = useRef<HTMLDivElement>(null)
  const arraste = useRef<'in' | 'out' | 'scrub' | null>(null)
  const ext = destinos(c, e)

  const tempoDe = (clientX: number) => { const r = area.current!.getBoundingClientRect(); return vs + clamp((clientX - r.left) / r.width, 0, 1) * span }
  const mover = (ev: PE<HTMLDivElement>) => {
    const m = arraste.current
    if (!m) return
    const s = tempoDe(ev.clientX)
    if (m === 'in') mudarEdicao(c, { inn: clamp(s, vs, e.out - 1) })
    else if (m === 'out') mudarEdicao(c, { out: clamp(s, e.inn + 1, ve) })
    else onT(clamp(s, e.inn, e.out))
  }
  const descer = (ev: PE<HTMLDivElement>) => {
    if ((ev.target as HTMLElement).closest('[data-controle]')) return
    const alvo = (ev.target as HTMLElement).closest('[data-alca]') as HTMLElement | null
    arraste.current = (alvo?.dataset.alca as 'in' | 'out') ?? 'scrub'
    ev.currentTarget.setPointerCapture(ev.pointerId)
    mover(ev)
  }
  const alcaTeclado = (qual: 'in' | 'out') => (ev: KE) => {
    const d = ev.key === 'ArrowLeft' ? -0.5 : ev.key === 'ArrowRight' ? 0.5 : 0
    if (!d) return
    ev.preventDefault(); ev.stopPropagation()
    if (qual === 'in') mudarEdicao(c, { inn: clamp(e.inn + d, vs, e.out - 1) })
    else mudarEdicao(c, { out: clamp(e.out + d, e.inn + 1, ve) })
  }

  // Miniaturas cobrindo a janela toda: fora do Corte original repete a borda (no app real seriam quadros da Fonte).
  const tw = (c.fim - c.inicio) / c.thumbs.length
  const tiles: { s: number; src: string }[] = []
  for (let k = Math.floor((vs - c.inicio) / tw); c.inicio + k * tw < ve; k++) tiles.push({ s: c.inicio + k * tw, src: c.thumbs[clamp(k, 0, c.thumbs.length - 1)] })

  // Onda na janela toda: dentro do Corte original, os picos reais; fora, uma onda plausível.
  const N = 220
  const barras = Array.from({ length: N }, (_, i) => {
    const s = vs + ((i + 0.5) / N) * span
    const v = s >= c.inicio && s < c.fim ? c.peaks[Math.floor(((s - c.inicio) / (c.fim - c.inicio)) * c.peaks.length)] : 0.18 + 0.4 * Math.abs(Math.sin(s * 3.1) * Math.cos(s * 1.7))
    return Math.max(0.05, Math.sqrt(v ?? 0.1))
  })

  const marcas: number[] = []
  for (let s = Math.ceil(vs); s <= ve; s++) marcas.push(s)

  return (
    <div className="h-[132px] shrink-0 px-4 pt-3 bg-[var(--e-s1)] border-t border-[var(--e-ln)] select-none">
      <div ref={area} className="relative h-[114px] mx-1.5 cursor-text touch-none" onPointerDown={descer} onPointerMove={mover}
        onPointerUp={() => (arraste.current = null)} onPointerCancel={() => (arraste.current = null)}>
        {/* régua discreta, em tempo da Fonte */}
        {marcas.map(s => (
          <span key={s} className={`absolute w-px ${s % 5 === 0 ? 'bg-[var(--e-ln2)]' : 'bg-[var(--e-ln)]'}`} style={{ left: x(s), top: s % 5 === 0 ? RULER - 6 : RULER - 3, height: s % 5 === 0 ? 6 : 3 }} />
        ))}
        {marcas.filter(s => s % 5 === 0).map(s => (
          <span key={'r' + s} className="absolute top-0 ml-1 font-mono tabular text-[10px] leading-none text-[var(--e-tx3)]" style={{ left: x(s) }}>{tc(s)}</span>
        ))}

        {/* miniaturas */}
        <div className="absolute inset-x-0 overflow-hidden rounded-[3px]" style={{ top: TH_Y, height: TH_H }}>
          {tiles.map(k => (
            <img key={k.s} src={img(k.src)} alt="" draggable={false} className="absolute top-0 h-full object-cover border-r border-black/50"
              style={{ left: x(k.s), width: larg(0, tw) }} />
          ))}
        </div>

        {/* onda */}
        <svg className="absolute inset-x-0 w-full" style={{ top: WV_Y, height: WV_H }} viewBox={`0 0 ${N} 100`} preserveAspectRatio="none" aria-hidden>
          {barras.map((v, i) => <rect key={i} x={i + 0.2} y={50 - v * 46} width={0.6} height={v * 92} style={{ fill: 'var(--e-tx3)' }} />)}
        </svg>
        {silencios.map((s, i) => (
          <div key={i} title={semSilencio ? 'Silêncio removido' : 'Silêncio detectado'} className="absolute"
            style={{
              top: WV_Y, height: WV_H, left: x(s.s), width: larg(s.s, s.e),
              background: semSilencio ? 'repeating-linear-gradient(135deg, rgba(26,26,26,.92) 0 3px, rgba(255,255,255,.06) 3px 4px)' : 'rgba(255,255,255,0.05)',
            }} />
        ))}

        {/* Frases: uma linha fina de segmentos, o texto só no hover */}
        {todas.map(f => {
          const dentro = f.s >= e.inn - 0.01 && f.e <= e.out + 0.01
          const on = f.id === frase
          const direita = pc(f.s) > 62
          return (
            <div key={f.id} className="group/f absolute" style={{ top: FR_Y, height: FR_H, left: `calc(${x(f.s)} + 1px)`, width: `calc(${larg(f.s, f.e)} - 2px)` }}>
              <span className={`absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full ${on ? 'h-[3px] bg-[var(--e-tx)]' : f.fantasma ? 'h-px bg-[var(--e-ln2)]' : dentro ? 'h-[2px] bg-[var(--e-tx3)] group-hover/f:bg-[var(--e-tx2)]' : 'h-[2px] bg-[var(--e-ln2)]'}`} />
              <span role="tooltip" className={`pointer-events-none absolute bottom-full mb-1.5 z-20 hidden group-hover/f:block w-max max-w-[340px] truncate px-2 py-1 rounded-[5px] bg-[var(--e-s3)] border border-[var(--e-ln2)] text-[11.5px] text-[var(--e-tx)] ${direita ? 'right-0' : 'left-0'}`}>
                {f.fantasma ? 'Frase da Fonte, fora do Corte' : f.texto}
              </span>
            </div>
          )
        })}

        {/* fora da seleção fica bem apagado */}
        <div className="absolute left-0 bg-[#1a1a1a]/[0.86] pointer-events-none" style={{ top: TH_Y, height: FUNDO - TH_Y, width: x(e.inn) }} />
        <div className="absolute right-0 bg-[#1a1a1a]/[0.86] pointer-events-none" style={{ top: TH_Y, height: FUNDO - TH_Y, left: x(e.out) }} />
        <div className="absolute border-y border-[var(--e-tx)]/60 pointer-events-none" style={{ top: TH_Y - 1, height: FUNDO - TH_Y + 2, left: x(e.inn), width: larg(e.inn, e.out) }} />

        {/* alças, com o ±1 Frase discreto no hover */}
        {(['in', 'out'] as const).map(q => {
          const ini = q === 'in'
          const mais = ini ? ext.inicioMais : ext.fimMais, menos = ini ? ext.inicioMenos : ext.fimMenos
          const esq = ini ? { rot: 'Estender início em 1 Frase', tecla: ['Shift', '←'], ok: !!mais, f: () => acoes.estender('inicio', 1) } : { rot: 'Encurtar fim em 1 Frase', tecla: ['Ctrl', 'Shift', '←'], ok: !!menos, f: () => acoes.estender('fim', -1) }
          const dir = ini ? { rot: 'Encurtar início em 1 Frase', tecla: ['Ctrl', 'Shift', '→'], ok: !!menos, f: () => acoes.estender('inicio', -1) } : { rot: 'Estender fim em 1 Frase', tecla: ['Shift', '→'], ok: !!mais, f: () => acoes.estender('fim', 1) }
          const mini = `w-5 h-5 grid place-items-center rounded-[4px] text-[var(--e-tx2)] hover:text-[var(--e-tx)] hover:bg-[var(--e-s3)] disabled:opacity-30 disabled:pointer-events-none ${foco}`
          return (
            <div key={q} className="group/alca absolute top-0 bottom-0 w-0" style={{ left: x(ini ? e.inn : e.out) }}>
              <div data-controle className={`absolute top-0 -translate-x-1/2 ${ini ? 'ml-[-5px]' : 'ml-[5px]'} z-30 hidden group-hover/alca:flex group-focus-within/alca:flex items-center h-5 px-0.5 rounded-[5px] bg-[var(--e-s2)] border border-[var(--e-ln2)] shadow-[0_6px_16px_-6px_rgba(0,0,0,.7)]`}>
                <button className={mini} disabled={!esq.ok} onClick={esq.f} aria-label={esq.rot} title={`${esq.rot} (${esq.tecla.join('+')})`}><ChevronLeft size={12} strokeWidth={2} /></button>
                <span className="px-1 text-[10.5px] text-[var(--e-tx3)] whitespace-nowrap">1 Frase</span>
                <button className={mini} disabled={!dir.ok} onClick={dir.f} aria-label={dir.rot} title={`${dir.rot} (${dir.tecla.join('+')})`}><ChevronRight size={12} strokeWidth={2} /></button>
              </div>
              <div data-alca={q} role="slider" tabIndex={0} onKeyDown={alcaTeclado(q)}
                aria-label={ini ? 'Início do Corte' : 'Fim do Corte'} aria-valuetext={tc(ini ? e.inn : e.out, true)}
                title={`Arraste para ajustar o ${ini ? 'início' : 'fim'}. ${ini ? 'Shift ←' : 'Shift →'} estende 1 Frase`}
                className={`absolute w-2.5 bg-[var(--e-tx)] hover:bg-white cursor-ew-resize grid place-items-center ${foco} ${ini ? '-translate-x-full rounded-l-[3px]' : 'rounded-r-[3px]'}`}
                style={{ top: TH_Y - 1, height: FUNDO - TH_Y + 2 }}>
                <span className="w-px h-4 bg-[#161616]/60 pointer-events-none" />
              </div>
            </div>
          )
        })}

        {/* playhead */}
        <div className="absolute top-0 w-px bg-[var(--e-acc)] pointer-events-none z-10" style={{ left: x(t), height: FUNDO + 2 }}>
          <span className="absolute -left-[4.5px] top-[6px] w-[10px] h-[12px] bg-[var(--e-acc)]" style={{ clipPath: 'polygon(0 0,100% 0,100% 60%,50% 100%,0 60%)' }} />
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- inspector */

const Linha = ({ rotulo, children, largo }: { rotulo: ReactNode; children: ReactNode; largo?: boolean }) => (
  <div className={`min-h-8 grid items-center gap-3 ${largo ? 'grid-cols-[1fr_auto]' : 'grid-cols-[72px_1fr]'}`}>
    <span className="text-[12.5px] text-[var(--e-tx2)]">{rotulo}</span>
    <div className="flex items-center justify-end gap-2 min-w-0">{children}</div>
  </div>
)

function AbaTranscricao({ c, e, todas, frase, ativa, onPalavra }: { c: Corte; e: Edicao; todas: FraseT[]; frase?: string; ativa?: string; onPalavra: (s: number) => void }) {
  const ativaRef = useRef<HTMLLIElement>(null)
  useEffect(() => { ativaRef.current?.scrollIntoView({ block: 'nearest' }) }, [frase])
  const visiveis = todas.filter(f => !f.fantasma || (f.s >= e.inn - 0.01 && f.e <= e.out + 0.01))
  return (
    <ol className="px-2 pb-6" title="Clique numa palavra para levar o playhead até ela">
      {visiveis.map(f => {
        const dentro = f.s >= e.inn - 0.01 && f.e <= e.out + 0.01
        const on = f.id === frase
        return (
          <li key={f.id} ref={on ? ativaRef : undefined} className={`grid grid-cols-[46px_1fr] gap-2 px-2 py-[6px] ${dentro ? '' : 'opacity-35'}`}>
            <span className={`font-mono tabular text-[11px] pt-[4px] ${on ? 'text-[var(--e-tx2)]' : 'text-[var(--e-tx3)]'}`}>{tc(Math.max(0, f.s - e.inn), true)}</span>
            {f.fantasma
              ? <span className="block h-px mt-[11px] bg-[var(--e-ln2)]" title="Frase da Fonte sem Transcrição neste protótipo" />
              : <p className={`text-[13px] leading-[1.6] ${on ? 'text-[var(--e-tx)]' : 'text-[var(--e-tx2)]'}`}>
                {c.palavras.filter(w => w.f === f.id).map(w => (
                  <button key={w.id} onClick={() => onPalavra(w.s + 0.001)}
                    className={`rounded-[3px] px-[2px] -mx-[1px] ${foco} ${w.id === ativa ? 'bg-[var(--e-accbg)] text-[var(--e-acc)]' : 'hover:bg-[var(--e-s3)] hover:text-[var(--e-tx)]'}`}>
                    {w.t}
                  </button>
                )).reduce<ReactNode[]>((a, b, i) => (i ? [...a, ' ', b] : [b]), [])}
              </p>}
          </li>
        )
      })}
    </ol>
  )
}

function AbaLegenda({ c, preset, pos, escala, porVez }: { c: Corte; preset: Preset; pos: number; escala: Escala; porVez: number }) {
  const amostra = c.palavras.slice(0, 2).map(w => ({ id: w.id, t: w.t }))
  return (
    <div className="px-4 pb-6 flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-x-2 gap-y-3" role="radiogroup" aria-label="Estilo da legenda">
        {presets.map((p, i) => {
          const on = p.id === preset.id
          return (
            <button key={p.id} role="radio" aria-checked={on} onClick={() => acoes.aplicarPreset(i)} title={`${p.nome} (${i + 1})`} className={`text-left rounded-[6px] ${foco}`}>
              <span className={`relative block h-[58px] rounded-[6px] overflow-hidden ring-1 ${on ? 'ring-[var(--e-acc)]' : 'ring-[var(--e-ln)] hover:ring-[var(--e-ln2)]'}`}>
                <img src={img(c.wide)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />
                <span className="absolute inset-0 grid place-items-center"><LinhaLegenda palavras={amostra} ativa={amostra[1]?.id} preset={p} tamanho={15} /></span>
              </span>
              <span className={`block mt-1.5 text-[12px] ${on ? 'text-[var(--e-tx)]' : 'text-[var(--e-tx3)]'}`}>{p.nome}</span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-col gap-2">
        <Linha rotulo="Posição">
          <input type="range" min={0.15} max={0.9} step={0.01} value={pos} onChange={ev => loja.set({ pos: +ev.target.value })}
            aria-label="Posição vertical da legenda" className={`flex-1 min-w-0 h-1 accent-[var(--e-tx)] ${foco}`} />
          <span className="w-8 text-right font-mono tabular text-[11.5px] text-[var(--e-tx3)]">{Math.round(pos * 100)}%</span>
        </Linha>
        <Linha rotulo="Tamanho">
          <Segmentado<Escala> rotulo="Tamanho" valor={escala} onChange={v => loja.set({ escala: v })}
            opcoes={[{ v: 'P', nome: 'P', titulo: 'Pequeno' }, { v: 'M', nome: 'M', titulo: 'Médio' }, { v: 'G', nome: 'G', titulo: 'Grande' }]} />
        </Linha>
        <Linha rotulo="Palavras">
          <Segmentado rotulo="Palavras por vez" valor={porVez} onChange={v => loja.set({ porVez: v })} opcoes={[2, 3, 4, 5].map(v => ({ v, nome: v, titulo: `${v} palavras por vez` }))} />
        </Linha>
      </div>
    </div>
  )
}

function AbaEnquadramento({ c, cx }: { c: Corte; cx: number }) {
  const box = useRef<HTMLDivElement>(null)
  const pega = useRef<number | null>(null)
  const L = clamp(cx - LARG_CROP / 2, 0, 1 - LARG_CROP)
  const setCx = (v: number) => mudarEdicao(c, { cx: clamp(v, LARG_CROP / 2, 1 - LARG_CROP / 2) })
  const mover = (ev: PE<HTMLDivElement>) => {
    if (pega.current == null) return
    const r = box.current!.getBoundingClientRect()
    setCx((ev.clientX - r.left) / r.width - pega.current)
  }
  return (
    <div className="px-4 pb-6 flex flex-col gap-3">
      <div ref={box} className="relative aspect-video rounded-[4px] overflow-hidden bg-black select-none touch-none"
        onPointerMove={mover} onPointerUp={() => (pega.current = null)} onPointerCancel={() => (pega.current = null)}>
        <img src={img(c.wide)} alt={`Quadro 16:9 de ${c.titulo}`} draggable={false} className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: `${L * 100}%` }} />
        <div className="absolute inset-y-0 right-0 bg-black/60" style={{ left: `${(L + LARG_CROP) * 100}%` }} />
        <div role="slider" tabIndex={0} aria-label="Posição do recorte 9:16" aria-valuenow={Math.round(cx * 100)} aria-valuemin={0} aria-valuemax={100}
          title="Arraste o recorte, ou use ← e →"
          onKeyDown={ev => { const d = ev.key === 'ArrowLeft' ? -0.01 : ev.key === 'ArrowRight' ? 0.01 : 0; if (d) { ev.preventDefault(); ev.stopPropagation(); setCx(cx + d * (ev.shiftKey ? 5 : 1)) } }}
          onPointerDown={ev => {
            const r = box.current!.getBoundingClientRect()
            pega.current = (ev.clientX - r.left) / r.width - cx
            box.current!.setPointerCapture(ev.pointerId)
          }}
          className={`absolute inset-y-0 border border-[var(--e-acc)] cursor-grab active:cursor-grabbing ${foco}`}
          style={{ left: `${L * 100}%`, width: `${LARG_CROP * 100}%` }}>
          <span className="absolute inset-y-0 left-1/3 w-px bg-white/20" />
          <span className="absolute inset-y-0 left-2/3 w-px bg-white/20" />
        </div>
      </div>
      <Linha rotulo="Centro">
        <span className="font-mono tabular text-[11.5px] text-[var(--e-tx3)] mr-auto">{Math.round(cx * 100)}%</span>
        <Botao tipo="fantasma" disabled={Math.abs(cx - c.cx) < 0.001} onClick={() => setCx(c.cx)}>Sugerido</Botao>
        <Botao onClick={acoes.centralizar} className="pr-1.5">Centralizar <Kbd k={['C']} /></Botao>
      </Linha>
    </div>
  )
}

function AbaAudio({ silencios, economia, inn, ligado, minimo, normalizar, onIr }: {
  silencios: { s: number; e: number }[]; economia: number; inn: number; ligado: boolean; minimo: number; normalizar: boolean; onIr: (s: number) => void
}) {
  return (
    <div className="px-4 pb-6 flex flex-col gap-2">
      <Linha largo rotulo={<span className="inline-flex items-center gap-2">Remover silêncios <Kbd k={['S']} /></span>}>
        <Interruptor rotulo="Remover silêncios" ligado={ligado} onChange={acoes.alternarSilencios} />
      </Linha>
      <Linha largo rotulo="Mais longos que">
        <Segmentado rotulo="Duração mínima do silêncio" valor={minimo} onChange={v => loja.set({ minimo: v })} opcoes={[{ v: 0.3, nome: '0,3 s' }, { v: 0.5, nome: '0,5 s' }, { v: 1, nome: '1 s' }]} />
      </Linha>
      {silencios.length === 0
        ? <p className="py-2 text-[12px] text-[var(--e-tx3)]">Nenhum silêncio com essa duração.</p>
        : <>
          <ul className="mt-1 -mx-2">
            {silencios.map((s, i) => (
              <li key={i}>
                <button onClick={() => onIr(s.s)} className={`w-full flex items-center justify-between h-7 px-2 rounded-[5px] text-[12px] hover:bg-[var(--e-s2)] ${foco}`}>
                  <span className="font-mono tabular text-[var(--e-tx2)]">{tc(s.s - inn, true)}</span>
                  <span className={`tabular ${ligado ? 'text-[var(--e-tx3)] line-through' : 'text-[var(--e-tx2)]'}`}>{num(s.e - s.s)} s</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-[var(--e-tx3)] tabular">{ligado ? `O Corte fica ${num(economia)} s mais curto.` : `Ligue para tirar ${num(economia)} s do Corte.`}</p>
        </>}
      <div className="my-3 h-px bg-[var(--e-ln)]" />
      <Linha largo rotulo={<span>Normalizar volume<span className="block text-[11.5px] text-[var(--e-tx3)]">−14 LUFS na exportação</span></span>}>
        <Interruptor rotulo="Normalizar volume" ligado={normalizar} onChange={v => loja.set({ normalizar: v })} />
      </Linha>
    </div>
  )
}
