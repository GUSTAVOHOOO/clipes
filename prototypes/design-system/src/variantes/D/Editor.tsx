// Variante D · "Comando": Editor do Corte. Preview sozinho no canvas, toolbar contextual, fita de palavras e timeline de hairlines.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeftToLine, ArrowRightToLine, AudioWaveform, Check, Crop, Focus, Pause, Play, Type } from 'lucide-react'
import { cortes, fonte, img, presets, tc, type Corte } from '../../dados'
import type { PropsVariante } from '../../App'
import { Barra, Kbd, Paleta, Primario, foco, memo, num, useD, useTeclas, type Cmd } from './comum'

type Ed = { ini: number; fim: number; cx: number; sil: boolean; preset: string }
/** Fração da largura do quadro 16:9 que o recorte 9:16 ocupa. */
const W = (9 / 16) / (16 / 9)
const FRASE_FORA = 2.8 // duração aproximada de uma Frase fora do Corte (não temos a Transcrição fora dele no protótipo)
const reduz = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const padrao = (c: Corte): Ed => ({ ini: c.inicio, fim: c.fim, cx: c.cx, sil: false, preset: 'classico' })
const uniq = (xs: number[]) => [...new Set(xs.map(x => Math.round(x * 1000) / 1000))].sort((a, b) => a - b)
const limitesIni = (c: Corte) => uniq([c.inicio - 3 * FRASE_FORA, c.inicio - 2 * FRASE_FORA, c.inicio - FRASE_FORA, c.inicio, ...c.frases.map(f => f.s)])
const limitesFim = (c: Corte) => uniq([...c.frases.map(f => f.e), c.fim, c.fim + FRASE_FORA, c.fim + 2 * FRASE_FORA, c.fim + 3 * FRASE_FORA])

/** Silêncios: intervalos entre Frases com mais de 0,3 s. */
function silencios(c: Corte, ed: Ed) {
  const out: { s: number; e: number }[] = []
  for (let i = 0; i < c.frases.length - 1; i++) {
    const s = c.frases[i].e + 0.08, e = c.frases[i + 1].s - 0.08
    if (e - s > 0.3 && s >= ed.ini && e <= ed.fim) out.push({ s, e })
  }
  return out
}

export default function Editor({ irPara }: PropsVariante) {
  const { avisar } = useD()
  const [idx, setIdx] = useState(memo.corte)
  const c = cortes[idx]
  const [edits, setEdits] = useState<Record<string, Ed>>({})
  const ed = edits[c.id] ?? padrao(c)
  const setEd = (p: Partial<Ed>) => setEdits(m => ({ ...m, [c.id]: { ...(m[c.id] ?? padrao(c)), ...p } }))
  const [t, setT] = useState(c.inicio + 0.01)
  const [tocando, setTocando] = useState(false)
  const [modo, setModo] = useState<'normal' | 'enquadrar'>('normal')
  const [popPreset, setPopPreset] = useState(false)

  const preset = presets.find(p => p.id === ed.preset)!
  const gaps = useMemo(() => silencios(c, ed), [c, ed.ini, ed.fim])
  const cortado = ed.sil ? gaps.reduce((a, g) => a + g.e - g.s, 0) : 0
  const dur = ed.fim - ed.ini - cortado
  const tRel = Math.max(0, t - ed.ini - (ed.sil ? gaps.filter(g => g.e <= t).reduce((a, g) => a + g.e - g.s, 0) : 0))

  // palavra ativa: a última que já começou
  const ativa = useMemo(() => {
    let a = c.palavras[0]
    for (const p of c.palavras) if (p.s <= t + 0.001) a = p
    return a
  }, [c, t])

  // playhead fake
  const vivo = useRef({ ed, gaps }); vivo.current = { ed, gaps }
  useEffect(() => {
    if (!tocando) return
    const id = setInterval(() => setT(prev => {
      const { ed, gaps } = vivo.current
      let n = prev + 0.05
      if (ed.sil) for (const g of gaps) if (n > g.s && n < g.e) n = g.e
      if (n >= ed.fim || n < ed.ini) n = ed.ini
      return n
    }), 50)
    return () => clearInterval(id)
  }, [tocando])

  const trocar = (i: number) => {
    const n = (i + cortes.length) % cortes.length
    memo.corte = n; setIdx(n); setT(cortes[n].inicio + 0.01); setTocando(false); setModo('normal'); setPopPreset(false)
  }
  const passoPalavra = (d: number) => {
    const k = c.palavras.findIndex(p => p.id === ativa.id)
    const p = c.palavras[Math.max(0, Math.min(c.palavras.length - 1, k + d))]
    setT(p.s + 0.001)
  }
  const mover = (lado: 'ini' | 'fim', d: 1 | -1) => {
    if (lado === 'ini') {
      const L = limitesIni(c)
      const alvo = d < 0 ? [...L].reverse().find(x => x < ed.ini - 0.01) : L.find(x => x > ed.ini + 0.01 && x < ed.fim - 1.5)
      if (alvo == null) return avisar(d < 0 ? 'O início já está no limite' : 'Não há outra Frase para tirar do início')
      setEd({ ini: alvo }); if (t < alvo) setT(alvo + 0.01)
      avisar(d < 0 ? 'Início estendido em 1 Frase' : 'Início encurtado em 1 Frase')
    } else {
      const L = limitesFim(c)
      const alvo = d > 0 ? L.find(x => x > ed.fim + 0.01) : [...L].reverse().find(x => x < ed.fim - 0.01 && x > ed.ini + 1.5)
      if (alvo == null) return avisar(d > 0 ? 'O fim já está no limite' : 'Não há outra Frase para tirar do fim')
      setEd({ fim: alvo }); if (t > alvo) setT(ed.ini + 0.01)
      avisar(d > 0 ? 'Fim estendido em 1 Frase' : 'Fim encurtado em 1 Frase')
    }
  }
  const aplicarPreset = (id: string) => { setEd({ preset: id }); setPopPreset(false); avisar(`Preset ${presets.find(p => p.id === id)!.nome} aplicado`) }
  const alternarSil = () => { const v = !ed.sil; setEd({ sil: v }); avisar(v ? `Silêncios removidos: −${num(gaps.reduce((a, g) => a + g.e - g.s, 0))} s` : 'Silêncios restaurados') }
  const exportar = () => avisar(`Exportando “${c.titulo}” em 1080×1920`)
  const enquadrar = () => { setPopPreset(false); setModo(m => (m === 'enquadrar' ? 'normal' : 'enquadrar')) }
  const moverCx = (d: number) => setEd({ cx: Math.min(1 - W / 2, Math.max(W / 2, ed.cx + d)) })

  useTeclas(e => {
    const k = e.key, ctrl = e.ctrlKey || e.metaKey
    if (ctrl && k.toLowerCase() === 'e') { e.preventDefault(); return exportar() }
    if (ctrl && e.shiftKey && k === 'ArrowRight') { e.preventDefault(); return mover('ini', 1) }
    if (ctrl && e.shiftKey && k === 'ArrowLeft') { e.preventDefault(); return mover('fim', -1) }
    if (ctrl) return
    if (k === 'Escape') { setPopPreset(false); setModo('normal'); return }
    if (k === ' ') { e.preventDefault(); return setTocando(v => !v) }
    if (modo === 'enquadrar') {
      if (k === 'ArrowLeft') { e.preventDefault(); return moverCx(e.shiftKey ? -0.05 : -0.01) }
      if (k === 'ArrowRight') { e.preventDefault(); return moverCx(e.shiftKey ? 0.05 : 0.01) }
      if (k.toLowerCase() === 'c') return setEd({ cx: 0.5 })
    } else {
      if (e.shiftKey && k === 'ArrowLeft') { e.preventDefault(); return mover('ini', -1) }
      if (e.shiftKey && k === 'ArrowRight') { e.preventDefault(); return mover('fim', 1) }
      if (k === 'ArrowLeft') { e.preventDefault(); return passoPalavra(-1) }
      if (k === 'ArrowRight') { e.preventDefault(); return passoPalavra(1) }
    }
    if (k === '[') return trocar(idx - 1)
    if (k === ']') return trocar(idx + 1)
    const l = k.toLowerCase()
    if (l === 'f') return enquadrar()
    if (l === 's') return alternarSil()
    if (l === 'p') { setModo('normal'); return setPopPreset(v => !v) }
    if (['1', '2', '3', '4'].includes(k)) return aplicarPreset(presets[+k - 1].id)
  })

  const comandos: Cmd[] = [
    { id: 'tocar', grupo: 'Corte', rotulo: tocando ? 'Pausar' : 'Reproduzir', tecla: ['Espaço'], acao: () => setTocando(v => !v) },
    { id: 'ext-ini', grupo: 'Corte', rotulo: 'Estender início em 1 Frase', tecla: ['Shift', '←'], palavras: ['frase', 'antes'], acao: () => mover('ini', -1) },
    { id: 'ext-fim', grupo: 'Corte', rotulo: 'Estender fim em 1 Frase', tecla: ['Shift', '→'], palavras: ['frase', 'depois'], acao: () => mover('fim', 1) },
    { id: 'enc-ini', grupo: 'Corte', rotulo: 'Encurtar início em 1 Frase', tecla: ['Ctrl', 'Shift', '→'], acao: () => mover('ini', 1) },
    { id: 'enc-fim', grupo: 'Corte', rotulo: 'Encurtar fim em 1 Frase', tecla: ['Ctrl', 'Shift', '←'], acao: () => mover('fim', -1) },
    { id: 'sil', grupo: 'Corte', rotulo: ed.sil ? 'Restaurar silêncios' : 'Remover silêncios', tecla: ['S'], palavras: ['pausa', 'cortar'], acao: alternarSil },
    { id: 'enq', grupo: 'Corte', rotulo: modo === 'enquadrar' ? 'Concluir enquadramento' : 'Enquadrar', tecla: ['F'], palavras: ['crop', 'recorte', '16:9'], acao: enquadrar },
    { id: 'exp', grupo: 'Corte', rotulo: 'Exportar Corte', tecla: ['Ctrl', 'E'], palavras: ['render', 'salvar'], acao: exportar },
    ...presets.map((p, i) => ({ id: 'pre-' + p.id, grupo: 'Legenda', rotulo: `Aplicar preset ${p.nome}`, tecla: [String(i + 1)], palavras: ['estilo', 'legenda'], acao: () => aplicarPreset(p.id) })),
    { id: 'prox', grupo: 'Navegar', rotulo: 'Próximo Corte', tecla: [']'], acao: () => trocar(idx + 1) },
    { id: 'ant', grupo: 'Navegar', rotulo: 'Corte anterior', tecla: ['['], acao: () => trocar(idx - 1) },
  ]

  return (
    <>
      <Barra
        migalhas={[{ rotulo: 'Canal dark · Ficção', ir: () => irPara('importar') }, { rotulo: fonte.nome, ir: () => irPara('cortes') }, { rotulo: c.titulo }]}
        direita={<>
          <div className="flex items-center gap-1 mr-1">
            <BotaoKbd rotulo="Corte anterior" onClick={() => trocar(idx - 1)}>[</BotaoKbd>
            <span className="font-mono text-[11.5px] tabular-nums text-neutral-600 w-7 text-center" aria-label={`Corte ${idx + 1} de ${cortes.length}`}>{idx + 1}/{cortes.length}</span>
            <BotaoKbd rotulo="Próximo Corte" onClick={() => trocar(idx + 1)}>]</BotaoKbd>
          </div>
          <Primario tecla={['Ctrl', 'E']} onClick={exportar}>Exportar</Primario>
        </>} />

      <main className="flex-1 min-h-0 flex flex-col px-6 pt-5 pb-[60px]">
        {/* Palco */}
        <div className="flex-1 min-h-0 relative flex items-center justify-center">
          {modo === 'normal'
            ? <Palco c={c} ed={ed} preset={preset} ativa={ativa}>
              <Toolbar>
                <Ferramenta rotulo="Preset de legenda" tecla={['P']} ativo={popPreset} onClick={() => setPopPreset(v => !v)}><Type size={15} strokeWidth={1.75} /></Ferramenta>
                <Ferramenta rotulo="Enquadrar" tecla={['F']} onClick={enquadrar}><Crop size={15} strokeWidth={1.75} /></Ferramenta>
                <Ferramenta rotulo={ed.sil ? `Silêncios removidos (−${num(cortado)} s)` : 'Remover silêncios'} tecla={['S']} ativo={ed.sil} onClick={alternarSil}><AudioWaveform size={15} strokeWidth={1.75} /></Ferramenta>
                <span className="h-px mx-1.5 bg-neutral-200" />
                <Ferramenta rotulo="Estender início em 1 Frase" tecla={['Shift', '←']} onClick={() => mover('ini', -1)}><ArrowLeftToLine size={15} strokeWidth={1.75} /></Ferramenta>
                <Ferramenta rotulo="Estender fim em 1 Frase" tecla={['Shift', '→']} onClick={() => mover('fim', 1)}><ArrowRightToLine size={15} strokeWidth={1.75} /></Ferramenta>
                {popPreset && <PopPreset atual={ed.preset} escolher={aplicarPreset} />}
              </Toolbar>
            </Palco>
            : <Enquadrar c={c} ed={ed} preset={preset} ativa={ativa} setCx={cx => setEd({ cx })} concluir={() => setModo('normal')} />}
        </div>

        {/* Transcrição em fita */}
        <Fita c={c} ed={ed} ativa={ativa.id} seek={s => setT(s + 0.001)} />

        {/* Linha de controle */}
        <div className="h-8 mt-1 flex items-center gap-3 text-[12px]">
          <button onClick={() => setTocando(v => !v)} aria-label={tocando ? 'Pausar' : 'Reproduzir'}
            className={`size-7 grid place-items-center rounded-[6px] hover:bg-neutral-100 ${foco}`}>
            {tocando ? <Pause size={14} fill="currentColor" strokeWidth={0} /> : <Play size={14} fill="currentColor" strokeWidth={0} />}
          </button>
          <span className="font-mono tabular-nums text-[12px]">
            {tc(Math.min(tRel, dur), true)}<span className="text-neutral-500"> / {tc(dur, true)}</span>
          </span>
          <Kbd k={['Espaço']} />
          <span className="flex-1" />
          {ed.sil && <span className="font-mono tabular-nums text-neutral-600">silêncios −{num(cortado)} s</span>}
          <span className="text-neutral-500">Legenda <span className="text-neutral-800">{preset.nome}</span></span>
          <span className="font-mono tabular-nums text-neutral-500">Fonte {tc(ed.ini)}–{tc(ed.fim)}</span>
        </div>

        {/* Timeline */}
        <Timeline c={c} ed={ed} t={t} gaps={ed.sil ? gaps : []}
          seek={s => setT(s)}
          setIni={v => setEd({ ini: v })} setFim={v => setEd({ fim: v })} />
      </main>

      <Paleta comandos={comandos} tela="editor" irPara={irPara} irCorte={trocar} />
    </>
  )
}

/* ---------- Peças ---------- */

function BotaoKbd({ children, rotulo, onClick }: { children: ReactNode; rotulo: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={rotulo} title={rotulo}
      className={`h-[18px] min-w-[18px] px-[5px] rounded-[4px] border border-neutral-200 border-b-neutral-300 font-mono text-[10.5px] text-neutral-600 hover:bg-neutral-950 hover:text-white hover:border-neutral-950 ${foco}`}>
      {children}
    </button>
  )
}

type P = (typeof presets)[number]
type Pal = Corte['palavras'][number]

/** Imagem 9:16 do Corte com a legenda karaokê do preset. */
function Vertical({ c, ed, preset, ativa, className = '' }: { c: Corte; ed: Ed; preset: P; ativa: Pal; className?: string }) {
  const original = Math.abs(ed.cx - c.cx) < 0.001
  const pos = ((ed.cx - W / 2) / (1 - W)) * 100
  const frase = c.palavras.filter(p => p.f === ativa.f)
  const k = frase.findIndex(p => p.id === ativa.id)
  const ini = Math.floor(k / preset.palavras) * preset.palavras
  const trecho = frase.slice(ini, ini + preset.palavras)
  const mesmo = preset.destaque === preset.cor
  const caixa = preset.id === 'caixa'
  return (
    <div className={`relative aspect-[9/16] overflow-hidden rounded-[8px] bg-neutral-900 ${className}`} style={{ containerType: 'inline-size' }}>
      <img src={img(original ? c.vert : c.wide)} alt={`Quadro do Corte “${c.titulo}”`} draggable={false}
        className="absolute inset-0 size-full object-cover" style={original ? undefined : { objectPosition: `${pos}% 50%` }} />
      <div className="absolute inset-x-[7%] flex justify-center" style={{ top: `${preset.pos * 100}%`, transform: 'translateY(-50%)' }}>
        <p className={`text-center leading-[1.12] ${caixa ? 'bg-white px-[0.4em] py-[0.15em] rounded-[0.18em]' : ''}`}
          style={{
            fontFamily: preset.fonte === 'Geist' ? 'var(--font-geist)' : 'var(--font-sans)',
            fontSize: preset.id === 'impacto' ? '10.5cqw' : preset.id === 'limpo' ? '6.6cqw' : '8.2cqw',
            fontWeight: preset.id === 'limpo' ? 600 : 800,
            textTransform: preset.id === 'impacto' ? 'uppercase' : undefined,
            letterSpacing: preset.id === 'impacto' ? '-0.01em' : undefined,
            WebkitTextStroke: preset.contorno ? `${preset.contorno * 0.022}em #000` : undefined,
            paintOrder: 'stroke fill',
            textShadow: preset.id === 'limpo' ? '0 1px 10px rgba(0,0,0,.65)' : undefined,
          }}>
          {trecho.map((p, i) => (
            <span key={p.id} style={{ color: p.id === ativa.id ? preset.destaque : preset.cor, opacity: mesmo && p.id !== ativa.id ? 0.5 : 1 }}>
              {i > 0 && ' '}{p.t}
            </span>
          ))}
        </p>
      </div>
    </div>
  )
}

function Palco({ c, ed, preset, ativa, children }: { c: Corte; ed: Ed; preset: P; ativa: Pal; children: ReactNode }) {
  return (
    <div className="relative h-full max-h-full aspect-[9/16]">
      <Vertical c={c} ed={ed} preset={preset} ativa={ativa} className="h-full ring-1 ring-neutral-200" />
      <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4">{children}</div>
    </div>
  )
}

function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div role="toolbar" aria-label="Ferramentas do Corte" aria-orientation="vertical"
      className="relative flex flex-col gap-0.5 p-1 rounded-[8px] bg-white border border-neutral-200 shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_-12px_rgba(0,0,0,.12)]">
      {children}
    </div>
  )
}

function Ferramenta({ rotulo, tecla, ativo, onClick, children }: { rotulo: string; tecla: string[]; ativo?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-label={rotulo} aria-pressed={ativo}
      className={`group relative size-8 grid place-items-center rounded-[6px] ${ativo ? 'bg-neutral-950 text-white' : 'text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950'} ${foco}`}>
      {children}
      <span role="tooltip" className="pointer-events-none absolute left-full ml-2.5 top-1/2 -translate-y-1/2 z-20 hidden group-hover:flex group-focus-visible:flex items-center gap-2 whitespace-nowrap h-7 pl-2.5 pr-1.5 rounded-[6px] bg-neutral-950 text-white text-[12px] font-normal">
        {rotulo}<Kbd k={tecla} inv />
      </span>
    </button>
  )
}

function PopPreset({ atual, escolher }: { atual: string; escolher: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus() }, [])
  return (
    <div ref={ref} role="radiogroup" aria-label="Preset de legenda"
      className="absolute left-full top-0 ml-2 w-[220px] p-1 rounded-[8px] bg-white border border-neutral-200 shadow-[0_12px_32px_-12px_rgba(0,0,0,.2)] z-30">
      <p className="px-2 pt-1.5 pb-1 text-[11.5px] text-neutral-500">Preset de legenda</p>
      {presets.map((p, i) => {
        const sel = p.id === atual
        return (
          <button key={p.id} role="radio" aria-checked={sel} onClick={() => escolher(p.id)}
            className={`w-full h-9 flex items-center gap-2.5 px-2 rounded-[6px] text-left ${sel ? 'bg-neutral-950 text-white' : 'hover:bg-neutral-100'} ${foco}`}>
            <span className="w-8 h-6 grid place-items-center whitespace-nowrap rounded-[4px] bg-neutral-800 text-[12px] font-extrabold"
              style={{ fontFamily: p.fonte === 'Geist' ? 'var(--font-geist)' : 'var(--font-sans)', color: p.cor, ...(p.id === 'caixa' ? { background: '#fff', boxShadow: 'inset 0 0 0 1px #e5e5e5' } : {}) }}>
              <span>A<span style={{ color: p.destaque }}>a</span></span>
            </span>
            <span className="flex-1 text-[13px]">{p.nome}</span>
            {sel && <Check size={13} />}
            <Kbd k={[String(i + 1)]} inv={sel} />
          </button>
        )
      })}
    </div>
  )
}

/** Modo Enquadrar (F): o quadro 16:9 da Fonte por cima do canvas, com o retângulo 9:16 arrastável. */
function Enquadrar({ c, ed, preset, ativa, setCx, concluir }: { c: Corte; ed: Ed; preset: P; ativa: Pal; setCx: (v: number) => void; concluir: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const arrastando = useRef(false)
  const aplicar = (x: number) => {
    const r = ref.current!.getBoundingClientRect()
    setCx(Math.min(1 - W / 2, Math.max(W / 2, (x - r.left) / r.width)))
  }
  const esq = (ed.cx - W / 2) * 100
  return (
    <div className="d-aviso absolute inset-0 z-10 bg-white flex items-center justify-center gap-6">
      <div className="flex flex-col gap-3 min-w-0" style={{ width: 'min(760px, calc(100% - 260px))' }}>
        <div ref={ref} className="relative aspect-video w-full overflow-hidden rounded-[6px] bg-neutral-900 cursor-ew-resize touch-none select-none"
          onPointerDown={e => { arrastando.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); aplicar(e.clientX) }}
          onPointerMove={e => arrastando.current && aplicar(e.clientX)}
          onPointerUp={() => (arrastando.current = false)}>
          <img src={img(c.wide)} alt="Quadro 16:9 da Fonte" draggable={false} className="absolute inset-0 size-full object-cover" />
          <div className="absolute inset-y-0 left-0 bg-neutral-950/60" style={{ width: `${esq}%` }} />
          <div className="absolute inset-y-0 right-0 bg-neutral-950/60" style={{ width: `${100 - esq - W * 100}%` }} />
          <div className="absolute inset-y-0 border-[1.5px] border-white" style={{ left: `${esq}%`, width: `${W * 100}%` }}>
            <span className="absolute inset-y-0 left-1/3 w-px bg-white/30" /><span className="absolute inset-y-0 left-2/3 w-px bg-white/30" />
            <span className="absolute inset-x-0 top-1/3 h-px bg-white/30" /><span className="absolute inset-x-0 top-2/3 h-px bg-white/30" />
          </div>
        </div>
        <div className="flex items-center gap-4 text-[12px] text-neutral-600">
          <span className="flex items-center gap-1.5"><Kbd k={['←', '→']} /> mover</span>
          <span className="flex items-center gap-1.5"><Kbd k={['Shift', '←', '→']} /> mover rápido</span>
          <span className="flex items-center gap-1.5"><Kbd k={['C']} /> centralizar</span>
          <span className="flex-1" />
          <span className="font-mono tabular-nums text-neutral-500">x {num(ed.cx * 100, 0)}%</span>
        </div>
      </div>
      <div className="relative h-[min(100%,440px)] aspect-[9/16] shrink-0">
        <Vertical c={c} ed={ed} preset={preset} ativa={ativa} className="h-full ring-1 ring-neutral-200" />
        <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4">
          <Toolbar>
            <Ferramenta rotulo="Centralizar" tecla={['C']} onClick={() => setCx(0.5)}><Focus size={15} strokeWidth={1.75} /></Ferramenta>
            <Ferramenta rotulo="Concluir enquadramento" tecla={['F']} ativo onClick={concluir}><Check size={15} strokeWidth={2} /></Ferramenta>
          </Toolbar>
        </div>
      </div>
    </div>
  )
}

/** Transcrição numa linha só, rolando na horizontal como uma fita. */
function Fita({ c, ed, ativa, seek }: { c: Corte; ed: Ed; ativa: string; seek: (s: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = ref.current, el = box?.querySelector<HTMLElement>(`[data-p="${ativa}"]`)
    if (!box || !el) return
    box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2, behavior: reduz() ? 'auto' : 'smooth' })
  }, [ativa, c.id])
  const antes = Math.round((c.inicio - ed.ini) / FRASE_FORA), depois = Math.round((ed.fim - c.fim) / FRASE_FORA)
  return (
    <div className="relative mt-4 border-y border-neutral-200">
      <div ref={ref} onWheel={e => { if (ref.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) ref.current.scrollLeft += e.deltaY }}
        role="list" aria-label="Transcrição do Corte"
        className="d-sem-barra relative h-11 overflow-x-auto overflow-y-hidden whitespace-nowrap flex items-center px-[45%] text-[14px]"
        style={{ maskImage: 'linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)' }}>
        {antes > 0 && <span className="mr-3 font-mono text-[11px] text-neutral-500">+{antes} Frase{antes > 1 ? 's' : ''} antes</span>}
        {c.frases.map((f, i) => (
          <span key={f.id} role="listitem" className="flex items-center">
            {i > 0 && <span className="mx-2.5 h-4 w-px bg-neutral-300" aria-hidden />}
            {c.palavras.filter(p => p.f === f.id).map(p => {
              const fora = p.s < ed.ini - 0.01 || p.e > ed.fim + 0.01
              const at = p.id === ativa
              return (
                <button key={p.id} data-p={p.id} onClick={() => seek(p.s)}
                  className={`px-[3px] py-[2px] rounded-[3px] ${at ? 'bg-neutral-950 text-white' : fora ? 'text-neutral-500 line-through decoration-neutral-400' : 'text-neutral-800 hover:bg-neutral-100'} ${foco}`}>
                  {p.t}
                </button>
              )
            })}
          </span>
        ))}
        {depois > 0 && <span className="ml-3 font-mono text-[11px] text-neutral-500">+{depois} Frase{depois > 1 ? 's' : ''} depois</span>}
      </div>
    </div>
  )
}

/** Timeline de hairlines: régua, miniaturas em cinza, onda, Frases, alças pretas e playhead. */
function Timeline({ c, ed, t, gaps, seek, setIni, setFim }: {
  c: Corte; ed: Ed; t: number; gaps: { s: number; e: number }[]
  seek: (s: number) => void; setIni: (v: number) => void; setFim: (v: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const modo = useRef<'seek' | 'ini' | 'fim' | null>(null)
  const d0 = Math.min(c.inicio, ed.ini) - 1.2, d1 = Math.max(c.fim, ed.fim) + 1.2, span = d1 - d0
  const x = (s: number) => ((s - d0) / span) * 100
  const tDe = (cx: number) => { const r = ref.current!.getBoundingClientRect(); return d0 + Math.min(1, Math.max(0, (cx - r.left) / r.width)) * span }
  const aplicar = (cx: number) => {
    const v = tDe(cx)
    if (modo.current === 'ini') setIni(Math.min(ed.fim - 1, Math.max(d0, v)))
    else if (modo.current === 'fim') setFim(Math.max(ed.ini + 1, Math.min(d1, v)))
    else if (modo.current === 'seek') seek(Math.min(ed.fim - 0.01, Math.max(ed.ini, v)))
  }
  const N = 180
  const pico = Math.max(...c.peaks)
  const barras = Array.from({ length: N }, (_, i) => {
    const s = d0 + (i / N) * span
    const dentro = s >= c.inicio && s < c.fim
    const v = dentro ? c.peaks[Math.floor(((s - c.inicio) / (c.fim - c.inicio)) * c.peaks.length)] : c.peaks[Math.floor(Math.abs(s * 7)) % c.peaks.length] * 0.7
    return { s, v: Math.max(0.06, Math.sqrt(Math.min(1, (v ?? 0.1) / pico))) }
  })
  const marcas: number[] = []
  for (let s = Math.ceil(d0); s <= d1; s++) marcas.push(s)
  const fakes = [
    ...Array.from({ length: Math.round((c.inicio - ed.ini) / FRASE_FORA) }, (_, i) => ({ s: c.inicio - (i + 1) * FRASE_FORA + 0.15, e: c.inicio - i * FRASE_FORA - 0.15 })),
    ...Array.from({ length: Math.round((ed.fim - c.fim) / FRASE_FORA) }, (_, i) => ({ s: c.fim + i * FRASE_FORA + 0.15, e: c.fim + (i + 1) * FRASE_FORA - 0.15 })),
  ]
  const fraseAtiva = c.frases.find(f => t >= f.s && t <= f.e)?.id

  return (
    <div ref={ref} className="relative mt-2 select-none touch-none cursor-text"
      onPointerDown={e => {
        const alca = (e.target as HTMLElement).closest<HTMLElement>('[data-alca]')?.dataset.alca as 'ini' | 'fim' | undefined
        modo.current = alca ?? 'seek'
        ref.current!.setPointerCapture(e.pointerId)
        aplicar(e.clientX)
      }}
      onPointerMove={e => modo.current && aplicar(e.clientX)}
      onPointerUp={() => (modo.current = null)}>
      {/* régua */}
      <div className="relative h-4 font-mono text-[9.5px] tabular-nums text-neutral-500">
        {marcas.map(s => (
          <span key={s} className="absolute bottom-0 w-px bg-neutral-300" style={{ left: `${x(s)}%`, height: s % 5 === 0 ? 6 : 3 }}>
            {s % 5 === 0 && <span className="absolute bottom-[7px] left-1 whitespace-nowrap">{tc(s)}</span>}
          </span>
        ))}
      </div>
      <div className="relative border-y border-neutral-200">
        {/* miniaturas */}
        <div className="flex h-9 border-b border-neutral-200 overflow-hidden">
          {c.thumbs.map((th, i) => (
            <img key={i} src={img(th)} alt="" draggable={false}
              className="h-full flex-1 min-w-0 object-cover grayscale hover:grayscale-0 transition-[filter] duration-200 border-r border-white last:border-r-0" />
          ))}
        </div>
        {/* onda */}
        <svg viewBox={`0 0 ${N} 40`} preserveAspectRatio="none" className="block w-full h-9 border-b border-neutral-200" aria-hidden>
          {barras.map((b, i) => (
            <rect key={i} x={i + 0.2} width={0.55} y={20 - b.v * 17} height={b.v * 34}
              fill={b.s >= ed.ini && b.s < t ? '#404040' : '#a3a3a3'} />
          ))}
        </svg>
        {/* Frases */}
        <div className="relative h-3.5">
          {[...c.frases, ...fakes.map((f, i) => ({ ...f, id: 'x' + i }))].map(f => (
            <span key={f.id} className={`absolute top-[5px] h-[4px] rounded-[1px] ${f.id === fraseAtiva ? 'bg-neutral-950' : f.id.startsWith('x') ? 'bg-neutral-300' : 'bg-neutral-400'}`}
              style={{ left: `${x(f.s)}%`, width: `${Math.max(0.3, x(f.e) - x(f.s))}%` }} />
          ))}
        </div>
        {/* silêncios removidos */}
        {gaps.map((g, i) => (
          <span key={i} className="absolute top-9 h-9 bg-white/80 border-x border-neutral-300"
            style={{ left: `${x(g.s)}%`, width: `${x(g.e) - x(g.s)}%`, backgroundImage: 'repeating-linear-gradient(135deg, #d4d4d4 0 1px, transparent 1px 5px)' }} />
        ))}
        {/* fora do Corte */}
        <span className="absolute inset-y-0 left-0 bg-white/75 pointer-events-none" style={{ width: `${x(ed.ini)}%` }} />
        <span className="absolute inset-y-0 right-0 bg-white/75 pointer-events-none" style={{ width: `${100 - x(ed.fim)}%` }} />
        {/* alças */}
        {(['ini', 'fim'] as const).map(l => (
          <span key={l} data-alca={l} role="slider" tabIndex={0} aria-label={l === 'ini' ? 'Início do Corte' : 'Fim do Corte'}
            aria-valuetext={tc(l === 'ini' ? ed.ini : ed.fim, true)}
            onKeyDown={e => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
              e.preventDefault(); e.stopPropagation()
              const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1)
              l === 'ini' ? setIni(Math.min(ed.fim - 1, Math.max(d0, ed.ini + d))) : setFim(Math.max(ed.ini + 1, Math.min(d1, ed.fim + d)))
            }}
            className={`absolute -top-px -bottom-px w-[7px] bg-neutral-950 cursor-ew-resize ${l === 'ini' ? 'rounded-l-[3px] -translate-x-full' : 'rounded-r-[3px]'} ${foco}`}
            style={{ left: `${x(l === 'ini' ? ed.ini : ed.fim)}%` }}>
            <span className="absolute inset-y-[38%] left-1/2 w-px -translate-x-1/2 bg-white/60" />
          </span>
        ))}
        {/* playhead */}
        <span className="absolute -top-5 -bottom-px w-px bg-neutral-950 pointer-events-none" style={{ left: `${x(t)}%` }}>
          <span className="absolute -top-px -left-[4px] size-[9px] bg-neutral-950 rounded-[2px]" />
        </span>
      </div>
    </div>
  )
}
