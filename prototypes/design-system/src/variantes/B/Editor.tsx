// Editor do Corte: a Transcrição é o documento. Preview 9:16 e timeline mínima à direita.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Crop, Pause, Play, Type } from 'lucide-react'
import { toast } from 'sonner'
import { cortes, img, presets, tc, type Corte, type Palavra } from '../../dados'
import type { Tela } from '../../App'
import { CONTEXTO, memoria, num, resumoNota, segundos } from './comum'

type Preset = (typeof presets)[number]
type FraseX = { id: string; s: number; e: number; texto: string; palavras: Palavra[]; ctx?: boolean }
type Silencio = { i: number; dur: number }

/** Largura do quadro 9:16 dentro de um quadro 16:9, como fração da largura. */
const LARG_CROP = (9 / 16) / (16 / 9)

function montar(c: Corte): FraseX[] {
  const porFrase = new Map<string, Palavra[]>()
  for (const p of c.palavras) {
    if (!porFrase.has(p.f)) porFrase.set(p.f, [])
    porFrase.get(p.f)!.push(p)
  }
  const sintetica = (id: string, texto: string, s: number, e: number): FraseX => {
    const ws = texto.split(' '), d = (e - s) / ws.length
    return { id, s, e, texto, ctx: true, palavras: ws.map((t, i) => ({ id: `${id}-${i}`, t, s: s + i * d, e: s + (i + 1) * d, f: id })) }
  }
  const ctx = CONTEXTO[c.id] ?? { antes: '…', depois: '…' }
  return [
    sintetica(`${c.id}-antes`, ctx.antes, c.inicio - 3.1, c.inicio - 0.7),
    ...c.frases.map(f => ({ ...f, palavras: porFrase.get(f.id) ?? [] })),
    sintetica(`${c.id}-depois`, ctx.depois, c.fim + 0.7, c.fim + 3.1),
  ]
}

export default function Editor({ irPara }: { irPara: (t: Tela) => void }) {
  const [idx, setIdx] = useState(() => Math.max(0, cortes.findIndex(c => c.id === memoria.corteId)))
  const [preset, setPreset] = useState<Preset>(presets[0])
  const trocar = (d: number) => {
    const n = (idx + d + cortes.length) % cortes.length
    memoria.corteId = cortes[n].id
    setIdx(n)
  }
  const c = cortes[idx]
  return <EditorCorte key={c.id} c={c} n={idx} trocar={trocar} preset={preset} setPreset={setPreset} irPara={irPara} />
}

function EditorCorte({ c, n, trocar, preset, setPreset, irPara }: {
  c: Corte; n: number; trocar: (d: number) => void; preset: Preset; setPreset: (p: Preset) => void; irPara: (t: Tela) => void
}) {
  const todas = useMemo(() => montar(c), [c])
  const silencios = useMemo<Silencio[]>(() => {
    const r: Silencio[] = []
    for (let i = 0; i < todas.length - 1; i++) {
      const dur = todas[i + 1].s - todas[i].e
      if (dur >= 0.3) r.push({ i, dur })
    }
    return r
  }, [todas])

  const [titulo, setTitulo] = useState(c.titulo)
  const [a, setA] = useState(1)
  const [b, setB] = useState(todas.length - 2)
  const [removidos, setRemovidos] = useState<Set<number>>(() => new Set(silencios.map(s => s.i)))
  const [t, setTState] = useState(todas[1].s)
  const tRef = useRef(t)
  const setT = (v: number) => { tRef.current = v; setTState(v) }
  const [tocando, setTocando] = useState(false)
  const [cx, setCx] = useState(c.cx)
  const [painel, setPainel] = useState<null | 'legenda' | 'enquadramento'>(null)

  const ini = todas[a].s, fim = todas[b].e
  const noCorte = (s: Silencio) => s.i >= a && s.i + 1 <= b
  const removido = (s: Silencio) => noCorte(s) && removidos.has(s.i)
  const silenciosCorte = silencios.filter(noCorte)
  const cortados = useMemo(() => silencios.filter(s => s.i >= a && s.i + 1 <= b && removidos.has(s.i)), [silencios, removidos, a, b])
  const economia = cortados.reduce((x, s) => x + s.dur, 0)
  const dur = fim - ini - economia
  const saida = (tt: number) => tt - ini - cortados.filter(s => todas[s.i + 1].s <= tt).reduce((x, s) => x + s.dur, 0)

  // Palavra ativa: a que contém o playhead, ou a última já falada.
  const palavrasCorte = useMemo(() => todas.slice(a, b + 1).flatMap(f => f.palavras), [todas, a, b])
  const ativa = useMemo(() => {
    let ult: Palavra | undefined
    for (const p of palavrasCorte) { if (p.s <= t + 1e-6) ult = p; else break }
    return ult ?? palavrasCorte[0]
  }, [palavrasCorte, t])
  const fraseAtiva = todas.find(f => f.id === ativa?.f)

  // Playhead fake: avança no tempo e pula os silêncios removidos.
  useEffect(() => {
    if (!tocando) return
    let raf = 0, last = performance.now()
    const tick = (now: number) => {
      let nt = tRef.current + (now - last) / 1000
      last = now
      for (const s of cortados) if (nt > todas[s.i].e && nt < todas[s.i + 1].s) nt = todas[s.i + 1].s
      if (nt >= fim) { setT(ini); setTocando(false); return }
      setT(nt)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [tocando, ini, fim, cortados, todas])

  // Mantém o playhead dentro do trecho do Corte.
  useEffect(() => { if (tRef.current < ini || tRef.current > fim) setT(ini) }, [ini, fim])

  // Durante a reprodução, a Frase ativa fica visível no documento.
  const refs = useRef(new Map<string, HTMLElement>())
  useEffect(() => {
    if (tocando && fraseAtiva) refs.current.get(fraseAtiva.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [tocando, fraseAtiva])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPainel(null)
      const el = e.target as HTMLElement
      if (e.key === ' ' && !el.closest('input,textarea,button,[role="switch"],[role="slider"]')) { e.preventDefault(); setTocando(v => !v) }
    }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  }, [])

  const seek = (tt: number) => setT(Math.min(fim - 0.01, Math.max(ini, tt)))
  const alternarSilencio = (i: number) => setRemovidos(r => { const x = new Set(r); x.has(i) ? x.delete(i) : x.add(i); return x })
  const todosRemovidos = silenciosCorte.length > 0 && silenciosCorte.every(s => removidos.has(s.i))
  const alternarTodos = () => setRemovidos(todosRemovidos ? new Set() : new Set(silencios.map(s => s.i)))

  const exportar = () => toast(`Exportando “${titulo}”`, { description: `${segundos(dur)}, 1080×1920, legenda ${preset.nome}` })

  return (
    <div className="flex h-full flex-col">
      {/* Barra superior */}
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--rule)] px-4">
        <button type="button" onClick={() => irPara('cortes')} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[14px] text-[var(--ink-2)] hover:bg-[var(--panel)]">
          <ArrowLeft size={16} strokeWidth={1.8} /> Cortes
        </button>
        <span className="mx-2 h-4 w-px bg-[var(--rule)]" />
        <button type="button" onClick={() => trocar(-1)} aria-label="Corte anterior" className="rounded-md p-1.5 text-[var(--ink-2)] hover:bg-[var(--panel)]"><ChevronLeft size={16} /></button>
        <span className="text-[14px] text-[var(--mute)]">Corte <span className="tc text-[var(--ink)]">{n + 1}</span> de <span className="tc">{cortes.length}</span></span>
        <button type="button" onClick={() => trocar(1)} aria-label="Próximo Corte" className="rounded-md p-1.5 text-[var(--ink-2)] hover:bg-[var(--panel)]"><ChevronRight size={16} /></button>
        <span className="flex-1" />
        <span className="mr-3 text-[13px] text-[var(--mute)]">Salvo no Projeto</span>
        <button type="button" onClick={exportar} className="rounded-lg bg-[var(--ink)] px-4 py-2 text-[14px] font-medium text-[var(--paper)] hover:bg-[var(--ink-2)]">
          Exportar Corte
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* O documento */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[720px] px-10 pt-12 pb-28">
            <label className="sr-only" htmlFor="vb-titulo">Título do Corte</label>
            <input id="vb-titulo" value={titulo} onChange={e => setTitulo(e.target.value)}
              className="w-full bg-transparent text-[30px] leading-[1.2] font-semibold tracking-[-0.02em] outline-none focus-visible:!outline-none border-b border-transparent focus:border-[var(--rule-2)] pl-[72px]" />
            <p className="mt-2 pl-[72px] text-[15px] text-[var(--mute)]">
              <span className="num font-medium text-[var(--ink)]">{segundos(dur)}</span>
              {economia > 0 && <> sem <span className="num">{segundos(economia)}</span> de silêncio</>}
              <span className="mx-2 text-[var(--rule-2)]">/</span>
              Nota <span className="num font-medium text-[var(--ink)]">{num(c.nota.total)}</span>, {resumoNota(c).toLowerCase()}
            </p>

            <div className="mt-7 ml-[72px] flex items-center gap-4 border-y border-[var(--rule)] py-2.5 text-[14px]">
              <button type="button" role="switch" aria-checked={todosRemovidos} onClick={alternarTodos} className="flex items-center gap-2.5 text-[var(--ink-2)]">
                <span className={`relative h-[18px] w-[30px] rounded-full transition-colors ${todosRemovidos ? 'bg-[var(--ink)]' : 'bg-[var(--rule-2)]'}`}>
                  <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-[left] ${todosRemovidos ? 'left-[14px]' : 'left-[2px]'}`} />
                </span>
                Remover silêncios
              </button>
              <span className="text-[var(--mute)]">
                {silenciosCorte.length === 0 ? 'nenhum no trecho' : <>{cortados.length} de {silenciosCorte.length} removidos</>}
              </span>
              <span className="flex-1" />
              <span className="text-[13px] text-[var(--mute)]">Clique numa palavra para ir até ela</span>
            </div>

            <article className="mt-6" aria-label="Transcrição do Corte">
              {todas.map((f, i) => {
                const dentro = i >= a && i <= b
                const sil = silencios.find(s => s.i === i)
                const ehAtiva = dentro && fraseAtiva?.id === f.id
                return (
                  <div key={f.id}>
                    {i === a && <Fronteira lado="inicio" podeEstender={a > 0} podeRecolher={a < b}
                      estender={() => setA(a - 1)} recolher={() => setA(a + 1)} />}
                    <div className="grid grid-cols-[72px_1fr]" ref={el => { if (el) refs.current.set(f.id, el); else refs.current.delete(f.id) }}>
                      <div className={`tc pr-5 pt-[13px] text-right text-[12px] ${dentro ? (ehAtiva ? 'text-[var(--ink)]' : 'text-[var(--mute)]') : 'text-[var(--faint)] opacity-70'}`}
                        title={`${tc(f.s, true)} na Fonte`}>
                        {dentro ? tc(saida(f.s), true) : tc(f.s)}
                      </div>
                      <p tabIndex={dentro ? 0 : -1}
                        onKeyDown={e => { if (dentro && e.key === 'Enter') seek(f.s) }}
                        aria-label={dentro ? undefined : `Fora do Corte: ${f.texto}`}
                        className={`border-l-2 py-[6px] pl-6 text-[18px] leading-[1.7] ${dentro ? 'border-[var(--ink)] text-[var(--ink)]' : 'border-transparent text-[var(--faint)]'}`}>
                        {f.palavras.map((p, k) => {
                          const on = dentro && ativa?.id === p.id
                          return (
                            <span key={p.id}>
                              {k > 0 && ' '}
                              <span onClick={dentro ? () => seek(p.s) : undefined}
                                className={`rounded-[3px] [box-decoration-break:clone] ${dentro ? 'cursor-pointer hover:bg-[var(--marker-soft)]' : ''} ${on ? '!bg-[var(--marker)] shadow-[0_0_0_2px_var(--marker)]' : ''}`}>
                                {p.t}
                              </span>
                            </span>
                          )
                        })}
                        {sil && dentro && i + 1 <= b && (
                          <>
                            {' '}
                            <button type="button" onClick={() => alternarSilencio(i)}
                              title={removidos.has(i) ? 'Silêncio removido. Clique para manter.' : 'Silêncio mantido. Clique para remover.'}
                              className={`tc whitespace-nowrap rounded px-1 align-[1px] text-[12px] hover:bg-[var(--panel)] ${removidos.has(i) ? 'text-[var(--faint)] line-through decoration-[var(--faint)]' : 'text-[var(--ink-2)]'}`}>
                              · {num(sil.dur)} s ·
                            </button>
                          </>
                        )}
                      </p>
                    </div>
                    {i === b && <Fronteira lado="fim" podeEstender={b < todas.length - 1} podeRecolher={a < b}
                      estender={() => setB(b + 1)} recolher={() => setB(b - 1)} />}
                  </div>
                )
              })}
            </article>
          </div>
        </main>

        {/* Preview e timeline */}
        <aside className="relative flex w-[392px] shrink-0 flex-col gap-3 border-l border-[var(--rule)] bg-[var(--panel)] px-5 pt-3 pb-5">
          <div className="flex items-center justify-center gap-1">
            <BotaoPainel ativo={painel === 'legenda'} onClick={() => setPainel(p => p === 'legenda' ? null : 'legenda')} icone={<Type size={15} strokeWidth={1.8} />}>
              Legenda: {preset.nome}
            </BotaoPainel>
            <BotaoPainel ativo={painel === 'enquadramento'} onClick={() => setPainel(p => p === 'enquadramento' ? null : 'enquadramento')} icone={<Crop size={15} strokeWidth={1.8} />}>
              Enquadramento
            </BotaoPainel>
          </div>

          {painel && (
            <Popover fechar={() => setPainel(null)}>
              {painel === 'legenda'
                ? <PainelLegenda atual={preset} escolher={setPreset} fundo={img(c.wide)} />
                : <PainelEnquadramento c={c} cx={cx} setCx={setCx} />}
            </Popover>
          )}

          <div className="flex min-h-0 flex-1 justify-center">
            <Telefone src={img(c.wide)} cx={cx} preset={preset} frase={fraseAtiva} ativa={ativa} />
          </div>

          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setTocando(v => !v)} aria-label={tocando ? 'Pausar' : 'Reproduzir'}
              className="grid h-8 w-8 place-items-center rounded-full bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--ink-2)]">
              {tocando ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-[2px]" />}
            </button>
            <span className="tc text-[13px]"><span className="text-[var(--ink)]">{tc(Math.max(0, saida(t)), true)}</span><span className="text-[var(--mute)]"> / {tc(dur, true)}</span></span>
            <span className="flex-1" />
            <span className="text-[12px] text-[var(--mute)]">Espaço reproduz</span>
          </div>

          <Timeline c={c} todas={todas} a={a} b={b} t={t} silencios={silencios} removido={removido}
            fraseAtiva={fraseAtiva?.id} seek={seek} setA={setA} setB={setB} />
        </aside>
      </div>
    </div>
  )
}

function Fronteira({ lado, podeEstender, podeRecolher, estender, recolher }: {
  lado: 'inicio' | 'fim'; podeEstender: boolean; podeRecolher: boolean; estender: () => void; recolher: () => void
}) {
  const rot = lado === 'inicio' ? 'início' : 'fim'
  return (
    <div className="grid grid-cols-[72px_1fr]">
      <div />
      <div className={`flex items-center gap-4 pl-6 text-[13px] ${lado === 'inicio' ? 'pt-3 pb-2' : 'pt-2 pb-3'}`}>
        {podeEstender
          ? <button type="button" onClick={estender} className="rounded px-1 -mx-1 font-medium text-[var(--ink-2)] hover:bg-[var(--marker-soft)] hover:text-[var(--ink)]">＋ Estender uma Frase</button>
          : <span className="text-[var(--faint)]">Sem mais Frases no {rot}</span>}
        {podeRecolher && <button type="button" onClick={recolher} className="text-[var(--mute)] hover:text-[var(--ink)]">Recolher uma</button>}
        <span className="h-px flex-1 bg-[var(--rule)]" />
        <span className="text-[var(--mute)]">{lado === 'inicio' ? 'Início do Corte' : 'Fim do Corte'}</span>
      </div>
    </div>
  )
}

function BotaoPainel({ ativo, onClick, icone, children }: { ativo: boolean; onClick: () => void; icone: ReactNode; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={ativo}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] ${ativo ? 'bg-[var(--sheet)] text-[var(--ink)] shadow-[0_0_0_1px_var(--rule-2)]' : 'text-[var(--ink-2)] hover:bg-[var(--sheet)]'}`}>
      {icone}{children}
    </button>
  )
}

function Popover({ fechar, children }: { fechar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (ref.current && !ref.current.contains(el) && !el.closest('[aria-expanded]')) fechar()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [fechar])
  return (
    <div ref={ref} role="dialog" className="absolute left-4 right-4 top-[48px] z-20 rounded-xl border border-[var(--rule)] bg-[var(--sheet)] p-4 shadow-[0_12px_32px_-12px_rgba(28,25,23,0.28)]">
      {children}
    </div>
  )
}

/** Estilo inline da legenda conforme o preset. `escala` em cqw do contêiner. */
function estiloLegenda(p: Preset): { caixa: CSSProperties; palavra: (on: boolean) => CSSProperties } {
  const grande = p.id === 'impacto'
  const tamanho = grande ? 10.5 : p.id === 'limpo' ? 7 : 8
  const caixa: CSSProperties = {
    fontFamily: p.fonte === 'Geist' ? 'var(--font-geist)' : 'var(--font-sans)',
    fontSize: `${tamanho}cqw`, fontWeight: p.id === 'limpo' ? 600 : 800, lineHeight: 1.18,
    textTransform: grande ? 'uppercase' : undefined, letterSpacing: grande ? '-0.01em' : undefined, color: p.cor,
  }
  const mesmoTom = p.destaque.toLowerCase() === p.cor.toLowerCase()
  return {
    caixa,
    palavra: on => ({
      color: on && !mesmoTom ? p.destaque : p.cor,
      opacity: mesmoTom && !on && p.id !== 'caixa' ? 0.55 : 1,
      WebkitTextStroke: p.contorno ? `${(p.contorno / 1080) * 200}cqw #000` : undefined,
      paintOrder: 'stroke fill',
      textShadow: p.id === 'limpo' ? '0 0.3cqw 1.2cqw rgba(0,0,0,0.65)' : undefined,
      background: p.id === 'caixa' ? (on ? '#FCEBA4' : '#FFFFFF') : undefined,
      padding: p.id === 'caixa' ? '0.4cqw 1.4cqw' : undefined,
      borderRadius: p.id === 'caixa' ? '1cqw' : undefined,
      boxDecorationBreak: 'clone',
    }),
  }
}

const objPos = (cx: number) => `${Math.min(100, Math.max(0, ((cx - LARG_CROP / 2) / (1 - LARG_CROP)) * 100))}% 50%`

function Telefone({ src, cx, preset, frase, ativa }: { src: string; cx: number; preset: Preset; frase?: FraseX; ativa?: Palavra }) {
  const ws = frase?.palavras ?? []
  const k = Math.max(0, ws.findIndex(w => w.id === ativa?.id))
  const ini = Math.floor(k / preset.palavras) * preset.palavras
  const trecho = ws.slice(ini, ini + preset.palavras)
  const st = estiloLegenda(preset)
  return (
    <div className="h-full max-h-[640px] max-w-full aspect-[9/16] rounded-[30px] bg-[var(--ink)] p-[7px] shadow-[0_18px_40px_-24px_rgba(28,25,23,0.6)]">
      <div className="relative h-full w-full overflow-hidden rounded-[24px] bg-black" style={{ containerType: 'inline-size' }}>
        <img src={src} alt="Preview 9:16 do Corte" className="h-full w-full object-cover" style={{ objectPosition: objPos(cx) }} />
        <div className="absolute inset-x-0 -translate-y-1/2 px-[8%] text-center" style={{ top: `${preset.pos * 100}%`, ...st.caixa }} aria-live="off">
          {trecho.map((w, i) => (
            <span key={w.id}>{i > 0 && ' '}<span style={st.palavra(w.id === ativa?.id)}>{w.t}</span></span>
          ))}
        </div>
      </div>
    </div>
  )
}

function PainelLegenda({ atual, escolher, fundo }: { atual: Preset; escolher: (p: Preset) => void; fundo: string }) {
  return (
    <div>
      <p className="mb-3 text-[14px] font-semibold">Estilo da legenda</p>
      <ul className="space-y-1" role="radiogroup" aria-label="Estilo da legenda">
        {presets.map(p => {
          const st = estiloLegenda(p), on = p.id === atual.id
          return (
            <li key={p.id}>
              <button type="button" role="radio" aria-checked={on} onClick={() => escolher(p)}
                className={`flex w-full items-center gap-3 rounded-lg p-1.5 text-left ${on ? 'bg-[var(--panel)]' : 'hover:bg-[var(--paper)]'}`}>
                <span className="relative h-[44px] w-[78px] shrink-0 overflow-hidden rounded-md bg-black" style={{ containerType: 'inline-size' }}>
                  <img src={fundo} alt="" className="h-full w-full object-cover opacity-70" />
                  <span className="absolute inset-0 grid place-items-center" style={{ ...st.caixa, fontSize: '17cqw' }}>
                    <span><span style={st.palavra(false)}>Fine</span> <span style={st.palavra(true)}>Thom</span></span>
                  </span>
                </span>
                <span className="flex-1">
                  <span className="block text-[14px] font-medium">{p.nome}</span>
                  <span className="block text-[12px] text-[var(--mute)]">{p.palavras} palavras por vez, {p.fonte}</span>
                </span>
                {on && <Check size={16} className="mr-1 text-[var(--ink)]" />}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-[12px] text-[var(--mute)]">O estilo vale para todos os Cortes deste Projeto até você trocar.</p>
    </div>
  )
}

function PainelEnquadramento({ c, cx, setCx }: { c: Corte; cx: number; setCx: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const limite = (v: number) => Math.min(1 - LARG_CROP / 2, Math.max(LARG_CROP / 2, v))
  const arrastar = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const mover = (x: number) => setCx(limite((x - r.left) / r.width))
    mover(e.clientX)
    const mm = (ev: PointerEvent) => mover(ev.clientX)
    const up = () => { removeEventListener('pointermove', mm); removeEventListener('pointerup', up) }
    addEventListener('pointermove', mm); addEventListener('pointerup', up)
  }
  return (
    <div>
      <p className="mb-1 text-[14px] font-semibold">Enquadramento</p>
      <p className="mb-3 text-[12px] text-[var(--mute)]">Arraste o retângulo sobre o quadro da Fonte. As setas também movem.</p>
      <div ref={ref} onPointerDown={arrastar} className="relative cursor-ew-resize touch-none select-none overflow-hidden rounded-md bg-black">
        <img src={img(c.wide)} alt="Quadro 16:9 da Fonte" draggable={false} className="block aspect-video w-full object-cover" />
        <div role="slider" tabIndex={0} aria-label="Posição horizontal do enquadramento" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round(cx * 100)}
          onKeyDown={e => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); setCx(limite(cx - 0.02)) }
            if (e.key === 'ArrowRight') { e.preventDefault(); setCx(limite(cx + 0.02)) }
          }}
          className="absolute inset-y-0 border-2 border-white shadow-[0_0_0_9999px_rgba(250,250,249,0.62)]"
          style={{ left: `${(cx - LARG_CROP / 2) * 100}%`, width: `${LARG_CROP * 100}%` }} />
      </div>
      <div className="mt-3 flex items-center gap-4 text-[13px]">
        <button type="button" onClick={() => setCx(0.5)} className="text-[var(--ink-2)] underline underline-offset-4 decoration-[var(--rule-2)] hover:text-[var(--ink)]">Centralizar</button>
        <button type="button" onClick={() => setCx(c.cx)} disabled={cx === c.cx} className="text-[var(--ink-2)] underline underline-offset-4 decoration-[var(--rule-2)] hover:text-[var(--ink)] disabled:text-[var(--faint)] disabled:no-underline">Voltar ao sugerido</button>
        <span className="flex-1" />
        <span className="tc text-[var(--mute)]">{Math.round(cx * 100)}%</span>
      </div>
    </div>
  )
}

function Timeline({ c, todas, a, b, t, silencios, removido, fraseAtiva, seek, setA, setB }: {
  c: Corte; todas: FraseX[]; a: number; b: number; t: number; silencios: Silencio[]; removido: (s: Silencio) => boolean
  fraseAtiva?: string; seek: (t: number) => void; setA: (n: number) => void; setB: (n: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const D0 = todas[0].s - 0.3, D1 = todas[todas.length - 1].e + 0.3
  const x = (tt: number) => ((tt - D0) / (D1 - D0)) * 100
  const tempoEm = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return D0 + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (D1 - D0)
  }
  const ini = todas[a].s, fim = todas[b].e

  const arrastar = (e: RPointerEvent, fn: (tt: number) => void) => {
    e.preventDefault(); e.stopPropagation()
    fn(tempoEm(e.clientX))
    const mm = (ev: PointerEvent) => fn(tempoEm(ev.clientX))
    const up = () => { removeEventListener('pointermove', mm); removeEventListener('pointerup', up) }
    addEventListener('pointermove', mm); addEventListener('pointerup', up)
  }
  const maisPerto = (tt: number, de: number, ate: number, campo: 's' | 'e') => {
    let melhor = de
    for (let k = de; k <= ate; k++) if (Math.abs(todas[k][campo] - tt) < Math.abs(todas[melhor][campo] - tt)) melhor = k
    return melhor
  }
  const moverInicio = (tt: number) => setA(maisPerto(tt, 0, b, 's'))
  const moverFim = (tt: number) => setB(maisPerto(tt, a, todas.length - 1, 'e'))

  // Onda: picos reais dentro dos dados do Corte, ruído baixo nas Frases de contexto.
  const barras = useMemo(() => {
    const r: { x: number; h: number; fora: boolean }[] = []
    c.peaks.forEach((p, i) => r.push({ x: x(c.inicio + (i / c.peaks.length) * (c.fim - c.inicio)), h: p, fora: false }))
    for (const f of [todas[0], todas[todas.length - 1]]) {
      const nb = 22
      for (let i = 0; i < nb; i++) r.push({ x: x(f.s + (i / nb) * (f.e - f.s)), h: 0.18 + 0.22 * Math.abs(Math.sin(i * 1.7 + f.s)), fora: true })
    }
    return r
  }, [c, todas])

  const alca = (lado: 'inicio' | 'fim') => {
    const pos = lado === 'inicio' ? x(ini) : x(fim)
    return (
      <div role="slider" tabIndex={0} aria-label={lado === 'inicio' ? 'Alça de início do Corte' : 'Alça de fim do Corte'}
        aria-valuetext={tc(lado === 'inicio' ? ini : fim, true)}
        onPointerDown={e => arrastar(e, lado === 'inicio' ? moverInicio : moverFim)}
        onKeyDown={e => {
          const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
          if (!d) return
          e.preventDefault()
          if (lado === 'inicio') setA(Math.min(b, Math.max(0, a + d)))
          else setB(Math.max(a, Math.min(todas.length - 1, b + d)))
        }}
        className="group absolute -top-[3px] -bottom-[3px] z-10 w-[14px] -translate-x-1/2 cursor-ew-resize touch-none"
        style={{ left: `${pos}%` }}>
        <span className={`absolute inset-y-0 w-[4px] rounded-full bg-[var(--ink)] left-[5px]`} />
        <span className="absolute top-1/2 left-[3px] h-[18px] w-[8px] -translate-y-1/2 rounded-[3px] bg-[var(--ink)] group-hover:h-[24px]" />
      </div>
    )
  }

  return (
    <div>
      <div ref={ref} className="relative h-[86px] cursor-pointer touch-none select-none" onPointerDown={e => arrastar(e, seek)} role="group" aria-label="Timeline do Corte">
        {/* Miniaturas */}
        <div className="absolute top-0 h-[30px] overflow-hidden rounded-[4px] bg-[var(--rule)]" style={{ left: '0%', width: '100%' }}>
          <div className="absolute inset-y-0 flex" style={{ left: `${x(c.inicio)}%`, width: `${x(c.fim) - x(c.inicio)}%` }}>
            {c.thumbs.map(s => <img key={s} src={img(s)} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />)}
          </div>
        </div>
        {/* Onda */}
        <svg className="absolute top-[36px] h-[36px] w-full" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden>
          {barras.map((r, i) => {
            const h = Math.max(1, r.h * 34)
            return <rect key={i} x={r.x} y={18 - h / 2} width={0.22} height={h} fill={r.fora ? 'var(--faint)' : 'var(--ink-2)'} opacity={r.fora ? 0.45 : 0.85} />
          })}
        </svg>
        {/* Silêncios removidos */}
        {silencios.filter(removido).map(s => (
          <div key={s.i} className="absolute top-[36px] h-[36px] border-x border-dashed border-[var(--rule-2)] bg-[var(--panel)]"
            style={{ left: `${x(todas[s.i].e)}%`, width: `${x(todas[s.i + 1].s) - x(todas[s.i].e)}%` }} title={`Silêncio removido, ${num(s.dur)} s`} />
        ))}
        {/* Frases */}
        <div className="absolute top-[78px] h-[5px] w-full">
          {todas.map((f, k) => (
            <span key={f.id} className={`absolute h-full rounded-full ${f.id === fraseAtiva ? 'bg-[var(--ink)]' : k >= a && k <= b ? 'bg-[var(--faint)]' : 'bg-[var(--rule-2)]'}`}
              style={{ left: `${x(f.s)}%`, width: `max(2px, ${x(f.e) - x(f.s)}%)` }} title={f.texto} />
          ))}
        </div>
        {/* Fora do trecho */}
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-[var(--panel)]/75" style={{ width: `${x(ini)}%` }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 bg-[var(--panel)]/75" style={{ width: `${100 - x(fim)}%` }} />
        {/* Playhead */}
        <div className="pointer-events-none absolute -top-[4px] -bottom-[2px] w-0" style={{ left: `${x(t)}%` }}>
          <span className="absolute inset-y-0 -left-[0.75px] w-[1.5px] bg-[var(--ink)]" />
          <span className="absolute -top-[2px] -left-[4px] h-[8px] w-[8px] rounded-full bg-[var(--ink)]" />
        </div>
        {alca('inicio')}
        {alca('fim')}
      </div>
      <div className="mt-2 flex items-center justify-between text-[12px] text-[var(--mute)]">
        <span className="tc">{tc(ini, true)}</span>
        <span>Alças ajustam por Frase</span>
        <span className="tc">{tc(fim, true)}</span>
      </div>
    </div>
  )
}
