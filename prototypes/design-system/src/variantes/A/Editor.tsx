// Editor do Corte, Variante A ("Estúdio"): NLE clássico enxuto.
// Esquerda: Cortes. Centro: preview 9:16 e transporte. Direita: inspector com uma aba por vez. Embaixo: timeline.
import { useEffect, useMemo, useRef, useState, type PointerEvent as PE, type KeyboardEvent as KE, type ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { Play, Pause, Download, Film, AudioWaveform, Captions } from 'lucide-react'
import { toast } from 'sonner'
import { cortes, presets, img, tc, type Corte, type Frase } from '../../dados'
import type { Tela } from '../../App'
import { Botao, Interruptor, Segmentado, Topo, foco, num, useTamanho } from './ui'
import { LinhaLegenda, grupoAtual, type Preset } from './Legenda'

type Edicao = { inn: number; out: number; cx: number }
type FraseT = Frase & { fantasma?: boolean }
type Aba = 'transcricao' | 'legenda' | 'enquadramento' | 'audio'
const ABAS: { id: Aba; nome: string }[] = [
  { id: 'transcricao', nome: 'Transcrição' },
  { id: 'legenda', nome: 'Legenda' },
  { id: 'enquadramento', nome: 'Enquadramento' },
  { id: 'audio', nome: 'Áudio' },
]

const MARGEM = 8 // segundos de Fonte visíveis antes e depois do Corte na timeline
const LIMIAR = 0.1 // ~ −40 dB nos picos normalizados
const LARG_CROP = (9 / 16) / (16 / 9) // largura do recorte 9:16 dentro do quadro 16:9
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** Frases vizinhas da Fonte, fora do Corte, para o "Estender ±1 Frase" ter para onde ir. */
function vizinhas(c: Corte): FraseT[] {
  const f = (id: string, s: number, e: number, texto: string): FraseT => ({ id: `${c.id}-${id}`, s, e, texto, fantasma: true })
  return [
    f('a2', c.inicio - 7.4, c.inicio - 4.1, 'Frase anterior na Fonte'),
    f('a1', c.inicio - 3.5, c.inicio - 0.4, 'Frase anterior na Fonte'),
    f('d1', c.fim + 0.5, c.fim + 3.6, 'Próxima Frase na Fonte'),
    f('d2', c.fim + 4.2, c.fim + 7.5, 'Próxima Frase na Fonte'),
  ]
}

/** Silêncios pela onda: picos abaixo do limiar por pelo menos `minimo` segundos. */
function detectarSilencios(c: Corte, minimo: number) {
  const dt = (c.fim - c.inicio) / c.peaks.length
  const r: { s: number; e: number }[] = []
  let st = -1
  const fecha = (i: number) => { if ((i - st) * dt >= minimo) r.push({ s: c.inicio + st * dt, e: c.inicio + i * dt }); st = -1 }
  c.peaks.forEach((v, i) => { if (v < LIMIAR) { if (st < 0) st = i } else if (st >= 0) fecha(i) })
  if (st >= 0) fecha(c.peaks.length)
  return r
}

export default function Editor({ tela, irPara }: { tela: Tela; irPara: (t: Tela) => void }) {
  const [ci, setCi] = useState(0)
  const c = cortes[ci]
  const [edicoes, setEdicoes] = useState<Record<string, Edicao>>({})
  const e = edicoes[c.id] ?? { inn: c.inicio, out: c.fim, cx: c.cx }
  const mudar = (p: Partial<Edicao>) => setEdicoes(m => ({ ...m, [c.id]: { ...(m[c.id] ?? { inn: c.inicio, out: c.fim, cx: c.cx }), ...p } }))

  const [t, setT] = useState(c.inicio)
  const [tocando, setTocando] = useState(false)
  const [aba, setAba] = useState<Aba>(() => (ABAS.find(a => a.id === new URLSearchParams(location.search).get('aba'))?.id ?? 'transcricao'))

  const [preset, setPreset] = useState<Preset>(presets[0])
  const [pos, setPos] = useState(presets[0].pos)
  const [escala, setEscala] = useState<'P' | 'M' | 'G'>('M')
  const [porVez, setPorVez] = useState(presets[0].palavras)

  const [semSilencio, setSemSilencio] = useState(true)
  const [minimo, setMinimo] = useState(0.5)
  const [normalizar, setNormalizar] = useState(true)

  const todas = useMemo(() => [...vizinhas(c), ...c.frases].sort((a, b) => a.s - b.s), [c])
  const silencios = useMemo(
    () => detectarSilencios(c, minimo).map(s => ({ s: Math.max(s.s, e.inn), e: Math.min(s.e, e.out) })).filter(s => s.e - s.s >= minimo * 0.6),
    [c, minimo, e.inn, e.out])
  const economia = silencios.reduce((a, s) => a + s.e - s.s, 0)
  const duracaoFinal = e.out - e.inn - (semSilencio ? economia : 0)

  const trocarCorte = (i: number) => { setCi(i); setT(cortes[i].inicio); setTocando(false) }

  // Playhead falso: avança em tempo real e pula silêncios quando a remoção está ligada.
  const tRef = useRef(t); tRef.current = t
  useEffect(() => {
    if (!tocando) return
    let raf = 0, antes = performance.now()
    const passo = (agora: number) => {
      let n = tRef.current + (agora - antes) / 1000
      antes = agora
      if (semSilencio) { const s = silencios.find(x => n >= x.s && n < x.e); if (s) n = s.e }
      if (n >= e.out) { setT(e.out); setTocando(false); return }
      setT(n)
      raf = requestAnimationFrame(passo)
    }
    raf = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(raf)
  }, [tocando, semSilencio, silencios, e.out])

  const alternar = () => {
    if (!tocando && (t >= e.out - 0.05 || t < e.inn)) setT(e.inn)
    setTocando(v => !v)
  }
  useEffect(() => {
    const h = (ev: KeyboardEvent) => {
      if (ev.key !== ' ' || (ev.target as HTMLElement).closest('button,input,select,textarea,[role="separator"]')) return
      ev.preventDefault(); alternar()
    }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  })

  // Frase e palavra ativas no tempo t.
  const frase = c.frases.find(f => t >= f.s && t < f.e) ?? [...c.frases].reverse().find(f => f.s <= t && t - f.e < 1.2)
  const daFrase = frase ? c.palavras.filter(w => w.f === frase.id) : []
  const ativa = daFrase.find(w => t >= w.s && t < w.e) ?? [...daFrase].reverse().find(w => w.s <= t)
  const grupo = grupoAtual(c.palavras, frase?.id, ativa?.id, porVez)

  // Estender ±1 Frase: as bordas andam de Frase em Frase.
  const ext = {
    inicioMais: [...todas].reverse().find(f => f.s < e.inn - 0.05),
    inicioMenos: todas.find(f => f.s > e.inn + 0.05 && f.s < e.out - 1),
    fimMais: todas.find(f => f.e > e.out + 0.05),
    fimMenos: [...todas].reverse().find(f => f.e < e.out - 0.05 && f.e > e.inn + 1),
  }
  const avisar = (txt: string) => toast(txt, { duration: 1800 })

  return (
    <div className="h-full flex flex-col">
      <Topo tela={tela} irPara={irPara} direita={
        <Botao tipo="primario" onClick={() => toast(`Exportando “${c.titulo}”`, { description: `1080×1920, ${num(duracaoFinal)} s, legenda ${preset.nome}` })}>
          <Download size={15} /> Exportar Corte
        </Botao>
      } />
      <Group orientation="vertical" className="flex-1 min-h-0">
        <Panel minSize={340}>
          <Group orientation="horizontal">
            <Panel defaultSize={236} minSize={196} maxSize={320} className="bg-[var(--a-s1)]">
              <ListaCortes ci={ci} onTrocar={trocarCorte} />
            </Panel>
            <Separator className="w-px bg-[var(--a-ln)] data-[separator=hover]:bg-[var(--a-ln2)] data-[separator=active]:bg-[var(--a-acc)] data-[separator=focus]:bg-[var(--a-acc)] outline-none" />
            <Panel minSize={320} className="bg-[var(--a-bg)] flex flex-col">
              <Palco c={c} e={e} grupo={grupo} ativa={ativa?.id} preset={preset} pos={pos} escala={escala} />
              <Transporte
                t={t} e={e} tocando={tocando} onAlternar={alternar}
                inicioMais={!!ext.inicioMais} inicioMenos={!!ext.inicioMenos} fimMais={!!ext.fimMais} fimMenos={!!ext.fimMenos}
                onInicio={d => {
                  const f = d > 0 ? ext.inicioMais : ext.inicioMenos
                  if (!f) return
                  mudar({ inn: f.s }); if (t < f.s) setT(f.s)
                  avisar(d > 0 ? `Início estendido em 1 Frase (${num(e.inn - f.s)} s)` : `1 Frase a menos no início (${num(f.s - e.inn)} s)`)
                }}
                onFim={d => {
                  const f = d > 0 ? ext.fimMais : ext.fimMenos
                  if (!f) return
                  mudar({ out: f.e }); if (t > f.e) setT(f.e)
                  avisar(d > 0 ? `Fim estendido em 1 Frase (${num(f.e - e.out)} s)` : `1 Frase a menos no fim (${num(e.out - f.e)} s)`)
                }}
              />
            </Panel>
            <Separator className="w-px bg-[var(--a-ln)] data-[separator=hover]:bg-[var(--a-ln2)] data-[separator=active]:bg-[var(--a-acc)] data-[separator=focus]:bg-[var(--a-acc)] outline-none" />
            <Panel defaultSize={344} minSize={324} maxSize={480} className="bg-[var(--a-s1)] flex flex-col">
              <div role="tablist" aria-label="Inspector" className="h-10 shrink-0 flex items-end px-1.5 border-b border-[var(--a-ln)]">
                {ABAS.map(a => (
                  <button key={a.id} role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)}
                    className={`relative h-full px-2 text-[13px] ${foco} ${aba === a.id ? 'text-[var(--a-tx)]' : 'text-[var(--a-tx3)] hover:text-[var(--a-tx2)]'}`}>
                    {a.nome}
                    {aba === a.id && <span className="absolute left-2 right-2 -bottom-px h-px bg-[var(--a-tx)]" />}
                  </button>
                ))}
              </div>
              <div role="tabpanel" className="flex-1 min-h-0 overflow-auto">
                {aba === 'transcricao' && <AbaTranscricao c={c} e={e} todas={todas} frase={frase?.id} ativa={ativa?.id} onPalavra={s => { setT(s); setTocando(false) }} />}
                {aba === 'legenda' && <AbaLegenda c={c} preset={preset} pos={pos} escala={escala} porVez={porVez}
                  onPreset={p => { setPreset(p); setPos(p.pos); setPorVez(p.palavras) }} onPos={setPos} onEscala={setEscala} onPorVez={setPorVez} />}
                {aba === 'enquadramento' && <AbaEnquadramento c={c} cx={e.cx} onCx={cx => mudar({ cx })} />}
                {aba === 'audio' && <AbaAudio silencios={silencios} economia={economia} inn={e.inn} ligado={semSilencio} onLigado={setSemSilencio}
                  minimo={minimo} onMinimo={setMinimo} normalizar={normalizar} onNormalizar={setNormalizar} onIr={s => { setT(s); setTocando(false) }} />}
              </div>
            </Panel>
          </Group>
        </Panel>
        <Separator className="h-px bg-[var(--a-ln)] data-[separator=hover]:bg-[var(--a-ln2)] data-[separator=active]:bg-[var(--a-acc)] data-[separator=focus]:bg-[var(--a-acc)] outline-none" />
        <Panel defaultSize={226} minSize={218} maxSize={420} className="bg-[var(--a-s1)]">
          <Timeline c={c} e={e} t={t} todas={todas} frase={frase?.id} silencios={silencios} semSilencio={semSilencio}
            duracaoFinal={duracaoFinal} economia={economia}
            onT={v => { setT(v); setTocando(false) }} onEdicao={mudar} />
        </Panel>
      </Group>
    </div>
  )
}

/* ---------------------------------------------------------------- trilho de Cortes */

function ListaCortes({ ci, onTrocar }: { ci: number; onTrocar: (i: number) => void }) {
  return (
    <div className="h-full flex flex-col">
      <div className="h-10 shrink-0 flex items-center justify-between px-3 border-b border-[var(--a-ln)]">
        <span className="text-[13px] font-medium">Cortes</span>
        <span className="text-[12px] text-[var(--a-tx3)] tabular">{cortes.length}</span>
      </div>
      <ul className="flex-1 overflow-auto py-1">
        {cortes.map((k, i) => {
          const on = i === ci
          return (
            <li key={k.id}>
              <button onClick={() => onTrocar(i)} aria-current={on}
                className={`relative w-full flex gap-2.5 px-3 py-2 text-left ${foco} ${on ? 'bg-[var(--a-s2)]' : 'hover:bg-[var(--a-s2)]/60'}`}>
                {on && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-[var(--a-acc)]" />}
                <img src={img(k.thumbs[3])} alt="" className="w-[60px] h-[34px] rounded-[3px] object-cover shrink-0 bg-[var(--a-s3)]" />
                <span className="min-w-0 flex-1">
                  <span className={`block text-[12.5px] leading-[1.3] line-clamp-2 ${on ? 'text-[var(--a-tx)]' : 'text-[var(--a-tx2)]'}`}>{k.titulo}</span>
                  <span className="mt-1 flex items-center justify-between text-[11px] text-[var(--a-tx3)]">
                    <span className="font-mono tabular">{tc(k.fim - k.inicio)}</span>
                    <span className="tabular">Nota <span className={on ? 'text-[var(--a-tx)]' : 'text-[var(--a-tx2)]'}>{num(k.nota.total)}</span></span>
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ---------------------------------------------------------------- preview 9:16 */

function Palco({ c, e, grupo, ativa, preset, pos, escala }: { c: Corte; e: Edicao; grupo: { id: string; t: string }[]; ativa?: string; preset: Preset; pos: number; escala: 'P' | 'M' | 'G' }) {
  const [ref, { w, h }] = useTamanho<HTMLDivElement>()
  const ph = Math.max(0, Math.min(h, (w * 16) / 9))
  const pw = (ph * 9) / 16
  const recorteAlterado = Math.abs(e.cx - c.cx) > 0.001
  const L = clamp(e.cx - LARG_CROP / 2, 0, 1 - LARG_CROP)
  const tamanho = pw * { P: 0.07, M: 0.088, G: 0.106 }[escala]
  return (
    <div ref={ref} className="flex-1 min-h-0 mx-6 mt-4 mb-0 flex items-center justify-center">
      {pw > 0 && (
        <div className="relative overflow-hidden rounded-[6px] bg-black ring-1 ring-[var(--a-ln)]" style={{ width: pw, height: ph }}>
          {recorteAlterado
            ? <div className="absolute inset-0" style={{ backgroundImage: `url(${img(c.wide)})`, backgroundSize: 'auto 100%', backgroundPosition: `${(L / (1 - LARG_CROP)) * 100}% 50%` }} />
            : <img src={img(c.vert)} alt={`Quadro do Corte ${c.titulo}`} className="absolute inset-0 w-full h-full object-cover" />}
          {grupo.length > 0 && (
            <div className="absolute inset-x-[7%] flex justify-center text-center -translate-y-1/2 pointer-events-none" style={{ top: `${pos * 100}%` }}>
              <LinhaLegenda palavras={grupo} ativa={ativa} preset={preset} tamanho={tamanho} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Transporte(p: {
  t: number; e: Edicao; tocando: boolean; onAlternar: () => void
  inicioMais: boolean; inicioMenos: boolean; fimMais: boolean; fimMenos: boolean
  onInicio: (d: 1 | -1) => void; onFim: (d: 1 | -1) => void
}) {
  const mini = `h-7 px-2 rounded-[5px] text-[12px] text-[var(--a-tx2)] hover:text-[var(--a-tx)] hover:bg-[var(--a-s2)] disabled:opacity-35 disabled:pointer-events-none tabular ${foco}`
  return (
    <div className="h-12 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4">
      <div className="flex items-center gap-0.5 justify-self-start" role="group" aria-label="Início do Corte">
        <span className="text-[12px] text-[var(--a-tx3)] mr-1.5">Início</span>
        <button className={mini} disabled={!p.inicioMais} onClick={() => p.onInicio(1)} title="Começar 1 Frase antes">+1 Frase</button>
        <button className={mini} disabled={!p.inicioMenos} onClick={() => p.onInicio(-1)} title="Começar 1 Frase depois">−1 Frase</button>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={p.onAlternar} aria-label={p.tocando ? 'Pausar' : 'Reproduzir'} title="Espaço"
          className={`w-9 h-9 rounded-full grid place-items-center bg-[var(--a-tx)] text-[#161616] hover:bg-white ${foco}`}>
          {p.tocando ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
        </button>
        <span className="font-mono tabular text-[13px] text-[var(--a-tx)] w-[118px]">
          {tc(clamp(p.t - p.e.inn, 0, 1e9), true)}<span className="text-[var(--a-tx3)]"> / {tc(p.e.out - p.e.inn, true)}</span>
        </span>
      </div>
      <div className="flex items-center gap-0.5 justify-self-end" role="group" aria-label="Fim do Corte">
        <button className={mini} disabled={!p.fimMenos} onClick={() => p.onFim(-1)} title="Terminar 1 Frase antes">−1 Frase</button>
        <button className={mini} disabled={!p.fimMais} onClick={() => p.onFim(1)} title="Terminar 1 Frase depois">+1 Frase</button>
        <span className="text-[12px] text-[var(--a-tx3)] ml-1.5">Fim</span>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- timeline */

function Timeline({ c, e, t, todas, frase, silencios, semSilencio, duracaoFinal, economia, onT, onEdicao }: {
  c: Corte; e: Edicao; t: number; todas: FraseT[]; frase?: string; silencios: { s: number; e: number }[]; semSilencio: boolean
  duracaoFinal: number; economia: number; onT: (t: number) => void; onEdicao: (p: Partial<Edicao>) => void
}) {
  const vs = Math.min(c.inicio - MARGEM, e.inn - 1), ve = Math.max(c.fim + MARGEM, e.out + 1)
  const x = (s: number) => `${((s - vs) / (ve - vs)) * 100}%`
  const larg = (a: number, b: number) => `${((b - a) / (ve - vs)) * 100}%`
  const area = useRef<HTMLDivElement>(null)
  const arraste = useRef<'in' | 'out' | 'scrub' | null>(null)

  const tempoDe = (clientX: number) => {
    const r = area.current!.getBoundingClientRect()
    return vs + clamp((clientX - r.left) / r.width, 0, 1) * (ve - vs)
  }
  const mover = (ev: PE<HTMLDivElement>) => {
    const m = arraste.current
    if (!m) return
    const s = tempoDe(ev.clientX)
    if (m === 'in') onEdicao({ inn: clamp(s, vs, e.out - 1) })
    else if (m === 'out') onEdicao({ out: clamp(s, e.inn + 1, ve) })
    else onT(s)
  }
  const descer = (ev: PE<HTMLDivElement>) => {
    const alvo = (ev.target as HTMLElement).closest('[data-alca]') as HTMLElement | null
    arraste.current = (alvo?.dataset.alca as 'in' | 'out') ?? 'scrub'
    ev.currentTarget.setPointerCapture(ev.pointerId)
    mover(ev)
  }
  const alcaTeclado = (qual: 'in' | 'out') => (ev: KE) => {
    const d = ev.key === 'ArrowLeft' ? -0.5 : ev.key === 'ArrowRight' ? 0.5 : 0
    if (!d) return
    ev.preventDefault()
    if (qual === 'in') onEdicao({ inn: clamp(e.inn + d, vs, e.out - 1) })
    else onEdicao({ out: clamp(e.out + d, e.inn + 1, ve) })
  }

  const span = ve - vs
  const passoRotulo = span > 70 ? 10 : 5
  const marcas: number[] = []
  for (let s = Math.ceil(vs); s <= ve; s++) marcas.push(s)

  const RULER = 22
  const trilho = 'relative rounded-[3px] overflow-hidden'
  const fundoFonte = { backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 5px, rgba(255,255,255,0.025) 5px 6px)' }

  return (
    <div className="h-full flex flex-col select-none">
      <div className="h-9 shrink-0 flex items-center gap-5 px-4 border-b border-[var(--a-ln)] text-[12px] text-[var(--a-tx3)]">
        <span>Entrada <span className="font-mono tabular text-[var(--a-tx2)]">{tc(e.inn, true)}</span></span>
        <span>Saída <span className="font-mono tabular text-[var(--a-tx2)]">{tc(e.out, true)}</span></span>
        <span>Duração <span className="font-mono tabular text-[var(--a-tx)]">{num(duracaoFinal)} s</span>
          {semSilencio && economia > 0 && <span className="tabular"> ({num(e.out - e.inn)} s com silêncios)</span>}</span>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="w-10 shrink-0 flex flex-col items-center gap-1.5 pt-[30px] text-[var(--a-tx3)]" aria-hidden>
          <span className="h-12 grid place-items-center"><Film size={14} /></span>
          <span className="h-10 grid place-items-center"><AudioWaveform size={14} /></span>
          <span className="h-7 grid place-items-center"><Captions size={14} /></span>
        </div>

        <div className="relative flex-1 min-w-0 pr-5 pl-2">
          <div ref={area} className="absolute inset-y-0 left-2 right-5 cursor-text touch-none" onPointerDown={descer} onPointerMove={mover}
            onPointerUp={() => (arraste.current = null)} onPointerCancel={() => (arraste.current = null)}>
            {/* régua em tempo da Fonte */}
            <div className="absolute inset-x-0 top-0" style={{ height: RULER }}>
              {marcas.map(s => (
                <span key={s} className="absolute bottom-0 w-px bg-[var(--a-ln2)]" style={{ left: x(s), height: s % passoRotulo === 0 ? 8 : 4 }} />
              ))}
              {marcas.filter(s => s % passoRotulo === 0).map(s => (
                <span key={`r${s}`} className="absolute top-[3px] ml-1 font-mono tabular text-[10px] text-[var(--a-tx3)]" style={{ left: x(s) }}>{tc(s)}</span>
              ))}
            </div>

            <div className="absolute inset-x-0 flex flex-col gap-1.5" style={{ top: RULER + 6 }}>
              {/* vídeo */}
              <div className={`${trilho} h-12 bg-[var(--a-s2)]`} style={fundoFonte}>
                <div className="absolute inset-y-0 flex" style={{ left: x(c.inicio), width: larg(c.inicio, c.fim) }}>
                  {c.thumbs.map(th => <img key={th} src={img(th)} alt="" draggable={false} className="h-full flex-1 min-w-0 object-cover border-r border-black/40 last:border-r-0" />)}
                </div>
              </div>
              {/* onda */}
              <div className={`${trilho} h-10 bg-[var(--a-s2)]`} style={fundoFonte}>
                <svg className="absolute top-0 h-full" style={{ left: x(c.inicio), width: larg(c.inicio, c.fim) }} viewBox={`0 0 ${c.peaks.length} 100`} preserveAspectRatio="none" aria-hidden>
                  {c.peaks.map((p, i) => {
                    const hh = Math.max(2, p * 92)
                    return <rect key={i} x={i + 0.15} y={50 - hh / 2} width={0.7} height={hh} style={{ fill: "var(--a-tx3)" }} />
                  })}
                </svg>
                {silencios.map((s, i) => (
                  <div key={i} className="absolute inset-y-0 border-x border-[var(--a-ln2)]"
                    title={semSilencio ? 'Silêncio removido' : 'Silêncio detectado'}
                    style={{
                      left: x(s.s), width: larg(s.s, s.e),
                      background: semSilencio ? 'repeating-linear-gradient(135deg, rgba(0,0,0,.55) 0 3px, rgba(255,255,255,.07) 3px 4px)' : 'rgba(255,255,255,0.04)',
                    }} />
                ))}
              </div>
              {/* Frases */}
              <div className="relative h-7">
                {todas.map(f => {
                  const on = f.id === frase
                  return (
                    <div key={f.id} title={f.texto}
                      className={`absolute inset-y-0 rounded-[3px] px-1.5 flex items-center text-[11px] truncate border ${
                        f.fantasma ? 'border-dashed border-[var(--a-ln2)] text-[var(--a-tx3)]'
                          : on ? 'bg-[var(--a-accbg)] border-[var(--a-acc)]/50 text-[var(--a-tx)]'
                            : 'bg-[var(--a-s3)] border-[var(--a-ln2)] text-[var(--a-tx2)]'}`}
                      style={{ left: `calc(${x(f.s)} + 1px)`, width: `calc(${larg(f.s, f.e)} - 2px)` }}>
                      <span className="truncate">{f.texto}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* fora do Corte fica apagado */}
            <div className="absolute bottom-0 left-0 bg-[#0d0d0d]/70 pointer-events-none" style={{ top: RULER, width: x(e.inn) }} />
            <div className="absolute bottom-0 right-0 bg-[#0d0d0d]/70 pointer-events-none" style={{ top: RULER, left: x(e.out) }} />
            <div className="absolute border-y border-[var(--a-tx)]/70 pointer-events-none" style={{ top: RULER + 4, bottom: 0, left: x(e.inn), width: larg(e.inn, e.out) }} />

            {/* alças */}
            {(['in', 'out'] as const).map(q => (
              <div key={q} data-alca={q} role="slider" tabIndex={0} onKeyDown={alcaTeclado(q)}
                aria-label={q === 'in' ? 'Entrada do Corte' : 'Saída do Corte'} aria-valuetext={tc(q === 'in' ? e.inn : e.out, true)}
                className={`absolute w-2.5 bg-[var(--a-tx)] cursor-ew-resize grid place-items-center ${foco} ${q === 'in' ? '-translate-x-full rounded-l-[3px]' : 'rounded-r-[3px]'}`}
                style={{ top: RULER + 4, bottom: 0, left: x(q === 'in' ? e.inn : e.out) }}>
                <span className="w-px h-4 bg-[#161616]/60 pointer-events-none" />
              </div>
            ))}

            {/* playhead */}
            <div className="absolute top-0 bottom-0 w-px bg-[var(--a-acc)] pointer-events-none" style={{ left: x(t) }}>
              <span className="absolute -left-[4.5px] top-0 w-[10px] h-[12px] bg-[var(--a-acc)]" style={{ clipPath: 'polygon(0 0,100% 0,100% 60%,50% 100%,0 60%)' }} />
            </div>
          </div>
        </div>
      </div>

      <div className="h-11 shrink-0 flex items-center justify-between px-4 text-[12px] text-[var(--a-tx3)]">
        <span>Arraste as alças para ajustar o Corte</span>
        <span className="tabular">{silencios.length === 0 ? 'Nenhum silêncio detectado'
          : semSilencio ? `${silencios.length} silêncios removidos, −${num(economia)} s` : `${silencios.length} silêncios detectados`}</span>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- abas do inspector */

const Secao = ({ titulo, children, extra }: { titulo: string; children: ReactNode; extra?: ReactNode }) => (
  <section className="px-4 py-4 border-b border-[var(--a-ln)] last:border-b-0">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-[12px] font-medium text-[var(--a-tx2)]">{titulo}</h3>
      {extra}
    </div>
    {children}
  </section>
)

function AbaTranscricao({ c, e, todas, frase, ativa, onPalavra }: { c: Corte; e: Edicao; todas: FraseT[]; frase?: string; ativa?: string; onPalavra: (s: number) => void }) {
  const ativaRef = useRef<HTMLDivElement>(null)
  useEffect(() => { ativaRef.current?.scrollIntoView({ block: 'nearest' }) }, [frase])
  const visiveis = todas.filter(f => !f.fantasma || (f.s >= e.inn - 0.01 && f.e <= e.out + 0.01))
  return (
    <div className="py-2">
      <p className="px-4 pt-2 pb-3 text-[12px] text-[var(--a-tx3)]">Clique numa palavra para levar o playhead até ela.</p>
      <ol>
        {visiveis.map(f => {
          const dentro = f.s >= e.inn - 0.01 && f.e <= e.out + 0.01
          const on = f.id === frase
          return (
            <li key={f.id}>
              <div ref={on ? ativaRef : undefined}
                className={`relative grid grid-cols-[52px_1fr] gap-2 px-4 py-2 ${dentro ? '' : 'opacity-40'}`}>
                {on && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-[var(--a-acc)]" />}
                <span className={`font-mono tabular text-[11px] pt-[3px] ${on ? 'text-[var(--a-tx)]' : 'text-[var(--a-tx3)]'}`}>{tc(Math.max(0, f.s - e.inn), true)}</span>
                {f.fantasma
                  ? <span className="text-[13px] leading-[1.6] text-[var(--a-tx3)]">{f.texto}, sem Transcrição carregada no protótipo</span>
                  : <p className="text-[13.5px] leading-[1.6] text-[var(--a-tx2)]">
                    {c.palavras.filter(w => w.f === f.id).map(w => (
                      <button key={w.id} onClick={() => onPalavra(w.s)}
                        className={`rounded-[3px] px-[2px] -mx-[1px] ${foco} ${w.id === ativa ? 'bg-[var(--a-accbg)] text-[var(--a-acc)]' : on ? 'text-[var(--a-tx)] hover:bg-[var(--a-s3)]' : 'hover:bg-[var(--a-s3)] hover:text-[var(--a-tx)]'}`}>
                        {w.t}
                      </button>
                    )).reduce<ReactNode[]>((a, b, i) => (i ? [...a, ' ', b] : [b]), [])}
                    {!dentro && <span className="ml-2 text-[11px] text-[var(--a-tx3)]">fora do Corte</span>}
                  </p>}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function AbaLegenda({ c, preset, pos, escala, porVez, onPreset, onPos, onEscala, onPorVez }: {
  c: Corte; preset: Preset; pos: number; escala: 'P' | 'M' | 'G'; porVez: number
  onPreset: (p: Preset) => void; onPos: (v: number) => void; onEscala: (v: 'P' | 'M' | 'G') => void; onPorVez: (v: number) => void
}) {
  const amostra = c.palavras.slice(0, 2).map(w => ({ id: w.id, t: w.t }))
  return (
    <>
      <Secao titulo="Estilo">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Estilo da legenda">
          {presets.map(p => {
            const on = p.id === preset.id
            return (
              <button key={p.id} role="radio" aria-checked={on} onClick={() => onPreset(p)} className={`text-left ${foco} rounded-[6px]`}>
                <span className={`relative block h-[68px] rounded-[6px] overflow-hidden ring-1 ${on ? 'ring-[var(--a-acc)]' : 'ring-[var(--a-ln2)] hover:ring-[var(--a-tx3)]'}`}>
                  <img src={img(c.wide)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-45" />
                  <span className="absolute inset-0 grid place-items-center">
                    <LinhaLegenda palavras={amostra} ativa={amostra[1]?.id} preset={p} tamanho={17} />
                  </span>
                </span>
                <span className={`block mt-1.5 text-[12px] ${on ? 'text-[var(--a-tx)]' : 'text-[var(--a-tx3)]'}`}>{p.nome}</span>
              </button>
            )
          })}
        </div>
      </Secao>
      <Secao titulo="Posição vertical" extra={<span className="font-mono tabular text-[12px] text-[var(--a-tx3)]">{Math.round(pos * 100)}%</span>}>
        <input type="range" min={0.15} max={0.9} step={0.01} value={pos} onChange={ev => onPos(+ev.target.value)}
          aria-label="Posição vertical da legenda" className={`w-full accent-[var(--a-tx)] ${foco}`} />
      </Secao>
      <Secao titulo="Tamanho e ritmo">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[var(--a-tx3)]">Tamanho</span>
            <Segmentado rotulo="Tamanho" valor={escala} onChange={onEscala} opcoes={[{ v: 'P', nome: 'Pequeno' }, { v: 'M', nome: 'Médio' }, { v: 'G', nome: 'Grande' }]} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[var(--a-tx3)]">Palavras por vez</span>
            <Segmentado rotulo="Palavras por vez" valor={porVez} onChange={onPorVez} opcoes={[2, 3, 4, 5].map(v => ({ v, nome: v }))} />
          </div>
        </div>
      </Secao>
    </>
  )
}

function AbaEnquadramento({ c, cx, onCx }: { c: Corte; cx: number; onCx: (v: number) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const pega = useRef<number | null>(null)
  const L = clamp(cx - LARG_CROP / 2, 0, 1 - LARG_CROP)
  const mover = (ev: PE<HTMLDivElement>) => {
    if (pega.current == null) return
    const r = box.current!.getBoundingClientRect()
    onCx(clamp((ev.clientX - r.left) / r.width - pega.current, LARG_CROP / 2, 1 - LARG_CROP / 2))
  }
  return (
    <>
      <Secao titulo="Quadro da Fonte">
        <div ref={box} className="relative aspect-video rounded-[4px] overflow-hidden bg-black select-none touch-none"
          onPointerMove={mover} onPointerUp={() => (pega.current = null)} onPointerCancel={() => (pega.current = null)}>
          <img src={img(c.wide)} alt={`Quadro 16:9 de ${c.titulo}`} draggable={false} className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: `${L * 100}%` }} />
          <div className="absolute inset-y-0 right-0 bg-black/60" style={{ left: `${(L + LARG_CROP) * 100}%` }} />
          <div role="slider" tabIndex={0} aria-label="Posição do recorte 9:16" aria-valuenow={Math.round(cx * 100)} aria-valuemin={0} aria-valuemax={100}
            onKeyDown={ev => { const d = ev.key === 'ArrowLeft' ? -0.01 : ev.key === 'ArrowRight' ? 0.01 : 0; if (d) { ev.preventDefault(); onCx(clamp(cx + d, LARG_CROP / 2, 1 - LARG_CROP / 2)) } }}
            onPointerDown={ev => {
              const r = box.current!.getBoundingClientRect()
              pega.current = (ev.clientX - r.left) / r.width - cx
              box.current!.setPointerCapture(ev.pointerId)
            }}
            className={`absolute inset-y-0 border border-[var(--a-acc)] cursor-grab active:cursor-grabbing ${foco}`}
            style={{ left: `${L * 100}%`, width: `${LARG_CROP * 100}%` }}>
            <span className="absolute inset-y-0 left-1/3 w-px bg-white/20" />
            <span className="absolute inset-y-0 left-2/3 w-px bg-white/20" />
          </div>
        </div>
        <p className="mt-2.5 text-[12px] text-[var(--a-tx3)] leading-[1.5]">Arraste o retângulo. O preview 9:16 usa este recorte.</p>
      </Secao>
      <Secao titulo="Centro horizontal" extra={<span className="font-mono tabular text-[12px] text-[var(--a-tx3)]">{Math.round(cx * 100)}%</span>}>
        <input type="range" min={LARG_CROP / 2} max={1 - LARG_CROP / 2} step={0.005} value={cx} onChange={ev => onCx(+ev.target.value)}
          aria-label="Centro horizontal do recorte" className={`w-full accent-[var(--a-tx)] ${foco}`} />
        <div className="mt-3 flex gap-2">
          <Botao onClick={() => onCx(0.5)}>Centralizar</Botao>
          <Botao tipo="fantasma" disabled={Math.abs(cx - c.cx) < 0.001} onClick={() => onCx(c.cx)}>Voltar ao sugerido ({Math.round(c.cx * 100)}%)</Botao>
        </div>
      </Secao>
    </>
  )
}

function AbaAudio({ silencios, economia, inn, ligado, onLigado, minimo, onMinimo, normalizar, onNormalizar, onIr }: {
  silencios: { s: number; e: number }[]; economia: number; inn: number; ligado: boolean; onLigado: (v: boolean) => void
  minimo: number; onMinimo: (v: number) => void; normalizar: boolean; onNormalizar: (v: boolean) => void; onIr: (s: number) => void
}) {
  return (
    <>
      <Secao titulo="Remover silêncios" extra={<Interruptor rotulo="Remover silêncios" ligado={ligado} onChange={onLigado} />}>
        <p className="text-[12px] text-[var(--a-tx3)] leading-[1.5] mb-3">Corta os trechos abaixo de −40 dB. A Transcrição e a legenda acompanham.</p>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px] text-[var(--a-tx3)]">Duração mínima</span>
          <Segmentado rotulo="Duração mínima do silêncio" valor={minimo} onChange={onMinimo} opcoes={[{ v: 0.3, nome: '0,3 s' }, { v: 0.5, nome: '0,5 s' }, { v: 1, nome: '1 s' }]} />
        </div>
        {silencios.length === 0
          ? <p className="text-[12px] text-[var(--a-tx3)]">Nenhum silêncio com essa duração neste Corte.</p>
          : <>
            <ul className="rounded-[6px] border border-[var(--a-ln)] divide-y divide-[var(--a-ln)]">
              {silencios.map((s, i) => (
                <li key={i}>
                  <button onClick={() => onIr(s.s)} className={`w-full flex items-center justify-between h-8 px-3 text-[12px] hover:bg-[var(--a-s2)] ${foco}`}>
                    <span className="font-mono tabular text-[var(--a-tx2)]">{tc(s.s - inn, true)}</span>
                    <span className={`tabular ${ligado ? 'text-[var(--a-tx3)] line-through' : 'text-[var(--a-tx2)]'}`}>{num(s.e - s.s)} s</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-[12px] text-[var(--a-tx2)] tabular">{ligado ? `O Corte fica ${num(economia)} s mais curto.` : `Ligue para tirar ${num(economia)} s do Corte.`}</p>
          </>}
      </Secao>
      <Secao titulo="Volume" extra={<Interruptor rotulo="Normalizar volume" ligado={normalizar} onChange={onNormalizar} />}>
        <p className="text-[12px] text-[var(--a-tx3)] leading-[1.5]">Normaliza para −14 LUFS na exportação.</p>
      </Secao>
    </>
  )
}
