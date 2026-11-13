// Variante H, "Linha": a timeline é a protagonista. Ela ocupa a metade de baixo, com a Transcrição DENTRO dela
// como trilha de texto (palavra por palavra, no tempo), e rola com zoom. O preview fica menor e fixo em cima,
// ao lado de uma ficha curta com o que se ajusta no Corte inteiro.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Crop, Download, Minus, Pause, Play, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { cortes, presets, tc } from '../../dados'
import type { PropsVariante } from '../../App'
import { Botao, Interruptor, Kbd, LAYOUTS, Segmentado, clamp, foco, num } from '../nucleo/base'
import { useEditor, type EstadoEditor } from '../nucleo/editor'
import { GatilhoPaleta, Paleta, useAtalhos, type Cmd } from '../nucleo/Paleta'
import { Preview, QuadroFonte } from '../nucleo/Preview'
import { Timeline, type Sel } from '../nucleo/Timeline'
import { TopoH, memoH } from './comum'

const ZOOMS = [40, 70, 110, 160, 230, 320]

export default function EditorH({ tela, irPara }: PropsVariante) {
  const ed = useEditor(memoH)
  const { c, e, mudar, tocando, alternar, preset, estender, trocar } = ed
  const [zi, setZi] = useState(3)
  const [enquadrar, setEnquadrar] = useState(new URLSearchParams(location.search).get('painel') === 'enquadrar')
  const [sel, setSel] = useState<Sel>({ tipo: 'corte' })
  const [editando, setEditando] = useState<string | null>(null)

  const avisar = (m: string | null, falha?: string) => toast(m ?? falha ?? '', { duration: 1800 })
  const exportar = () => toast(`Exportando “${c.titulo}”`, { description: `1080×1920 · ${num(ed.duracaoFinal)} s · legenda ${preset.nome}` })
  const alternarSil = () => { mudar({ sil: !e.sil }); toast(!e.sil ? `Silêncios removidos: −${num(ed.economia)} s` : 'Silêncios restaurados', { duration: 1600 }) }
  const aplicarPreset = (i: number) => { const p = presets[i]; mudar({ preset: p.id, pos: p.pos, porVez: p.palavras }) }
  const trocarCorte = (i: number) => { trocar(i); setSel({ tipo: 'corte' }); setEditando(null) }
  const palavraAlvo = () => (sel.tipo === 'palavra' ? sel.id : ed.ativa?.id)

  useAtalhos(ev => {
    const k = ev.key, l = k.toLowerCase(), ctrl = ev.ctrlKey || ev.metaKey
    if ((ev.target as HTMLElement).closest?.('[data-alca]') && (k === 'ArrowLeft' || k === 'ArrowRight')) return
    if (ctrl && l === 'e') { ev.preventDefault(); return exportar() }
    if (ctrl && ev.shiftKey && k === 'ArrowRight') { ev.preventDefault(); return avisar(estender('in', -1), 'Não há outra Frase para tirar do início') }
    if (ctrl && ev.shiftKey && k === 'ArrowLeft') { ev.preventDefault(); return avisar(estender('out', -1), 'Não há outra Frase para tirar do fim') }
    if (ctrl || ev.altKey) return
    if (k === 'Escape') { setEnquadrar(false); return setSel({ tipo: 'corte' }) }
    if (k === ' ') { ev.preventDefault(); return alternar() }
    if (ev.shiftKey && k === 'ArrowLeft') { ev.preventDefault(); return avisar(estender('in', 1), 'O início já está no limite') }
    if (ev.shiftKey && k === 'ArrowRight') { ev.preventDefault(); return avisar(estender('out', 1), 'O fim já está no limite') }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      ev.preventDefault()
      const base = palavraAlvo()
      const i = clamp(c.palavras.findIndex(p => p.id === base) + (k === 'ArrowLeft' ? -1 : 1), 0, c.palavras.length - 1)
      ed.ir(c.palavras[i].s + 0.001); return setSel({ tipo: 'palavra', id: c.palavras[i].id })
    }
    if (k === 'Enter') { ev.preventDefault(); const id = palavraAlvo(); if (id) { setSel({ tipo: 'palavra', id }); setEditando(id) } return }
    if (k === '-' || k === '_') return setZi(z => Math.max(0, z - 1))
    if (k === '=' || k === '+') return setZi(z => Math.min(ZOOMS.length - 1, z + 1))
    if (l === 'z') return setZi(1)
    if (k === '[') return trocarCorte(ed.ci - 1)
    if (k === ']') return trocarCorte(ed.ci + 1)
    if (l === 'f') return setEnquadrar(v => !v)
    if (l === 's') return alternarSil()
    if (['1', '2', '3', '4'].includes(k)) return aplicarPreset(+k - 1)
  })

  const comandos: Cmd[] = [
    { id: 'tocar', grupo: 'Corte', rotulo: tocando ? 'Pausar' : 'Reproduzir', tecla: ['Espaço'], acao: alternar },
    { id: 'edit', grupo: 'Transcrição', rotulo: 'Corrigir a palavra no playhead', tecla: ['Enter'], palavras: ['texto', 'legenda', 'erro'], acao: () => { const id = palavraAlvo(); if (id) setEditando(id) } },
    { id: 'ext-ini', grupo: 'Corte', rotulo: 'Estender início em 1 Frase', tecla: ['Shift', '←'], acao: () => avisar(estender('in', 1), 'O início já está no limite') },
    { id: 'ext-fim', grupo: 'Corte', rotulo: 'Estender fim em 1 Frase', tecla: ['Shift', '→'], acao: () => avisar(estender('out', 1), 'O fim já está no limite') },
    { id: 'enc-ini', grupo: 'Corte', rotulo: 'Encurtar início em 1 Frase', tecla: ['Ctrl', 'Shift', '→'], acao: () => avisar(estender('in', -1), 'Não há outra Frase para tirar') },
    { id: 'enc-fim', grupo: 'Corte', rotulo: 'Encurtar fim em 1 Frase', tecla: ['Ctrl', 'Shift', '←'], acao: () => avisar(estender('out', -1), 'Não há outra Frase para tirar') },
    { id: 'sil', grupo: 'Corte', rotulo: e.sil ? 'Restaurar silêncios' : 'Remover silêncios', tecla: ['S'], acao: alternarSil },
    { id: 'enq', grupo: 'Corte', rotulo: enquadrar ? 'Fechar enquadramento' : 'Ajustar enquadramento', tecla: ['F'], palavras: ['crop', 'recorte', 'layout'], acao: () => setEnquadrar(v => !v) },
    { id: 'exp', grupo: 'Corte', rotulo: 'Exportar Corte', tecla: ['Ctrl', 'E'], acao: exportar },
    { id: 'z+', grupo: 'Timeline', rotulo: 'Aproximar', tecla: ['='], acao: () => setZi(z => Math.min(ZOOMS.length - 1, z + 1)) },
    { id: 'z-', grupo: 'Timeline', rotulo: 'Afastar', tecla: ['−'], acao: () => setZi(z => Math.max(0, z - 1)) },
    { id: 'z0', grupo: 'Timeline', rotulo: 'Ver o Corte inteiro', tecla: ['Z'], acao: () => setZi(1) },
    ...presets.map((p, i) => ({ id: 'pre-' + p.id, grupo: 'Legenda', rotulo: `Legenda ${p.nome}`, tecla: [String(i + 1)], palavras: ['estilo', 'preset'], acao: () => aplicarPreset(i) })),
    { id: 'prox', grupo: 'Navegar', rotulo: 'Próximo Corte', tecla: [']'], acao: () => trocarCorte(ed.ci + 1) },
    { id: 'ant', grupo: 'Navegar', rotulo: 'Corte anterior', tecla: ['['], acao: () => trocarCorte(ed.ci - 1) },
  ]

  const mini = `h-7 px-2 rounded-[5px] text-[12px] text-[var(--tx2)] hover:text-[var(--tx)] hover:bg-[var(--s2)] tabular-nums ${foco}`
  return (
    <div className="h-full flex flex-col">
      <TopoH tela={tela} irPara={irPara}
        meio={<div className="flex items-center gap-1 min-w-0">
          <button onClick={() => trocarCorte(ed.ci - 1)} aria-label="Corte anterior ([)" className={`w-7 h-7 grid place-items-center rounded-[5px] text-[var(--tx3)] hover:text-[var(--tx)] hover:bg-[var(--s2)] ${foco}`}><ChevronLeft size={15} /></button>
          <span className="truncate text-[13px] px-1">{c.titulo}</span>
          <button onClick={() => trocarCorte(ed.ci + 1)} aria-label="Próximo Corte (])" className={`w-7 h-7 grid place-items-center rounded-[5px] text-[var(--tx3)] hover:text-[var(--tx)] hover:bg-[var(--s2)] ${foco}`}><ChevronRight size={15} /></button>
          <span className="font-mono tabular-nums text-[12px] text-[var(--tx3)] ml-1">{ed.ci + 1}/{cortes.length}</span>
        </div>}
        direita={<>
          <GatilhoPaleta />
          <Botao tipo="primario" tamanho="p" tecla={['Ctrl', 'E']} onClick={exportar}><Download size={14} /> Exportar</Botao>
        </>} />

      {/* em cima: preview fixo e pequeno + ficha do Corte */}
      <div className="h-[clamp(300px,48vh,460px)] shrink-0 flex justify-center gap-10 px-6 py-4">
        <div className="flex flex-col items-center gap-2.5">
          <Preview className="flex-1 w-[240px]" c={c} cx={e.cx} layout={e.layout} grupo={ed.grupo} ativa={ed.ativa?.id}
            preset={preset} pos={e.pos} escala={e.escala} moldura="ring-1 ring-[var(--ln)]" />
          <div className="flex items-center gap-3">
            <button onClick={alternar} aria-label={tocando ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'}
              className={`w-8 h-8 rounded-full grid place-items-center bg-[var(--tx)] text-[var(--bg)] hover:opacity-90 ${foco}`}>
              {tocando ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" className="ml-0.5" />}
            </button>
            <span className="font-mono tabular-nums text-[12.5px] whitespace-nowrap">{tc(ed.tRel, true)}<span className="text-[var(--tx3)]"> / {tc(ed.duracaoFinal, true)}</span></span>
          </div>
        </div>
        {enquadrar ? <FichaEnquadrar ed={ed} onFechar={() => setEnquadrar(false)} /> : <Ficha ed={ed} onPreset={aplicarPreset} onSil={alternarSil} onEnquadrar={() => setEnquadrar(true)} />}
      </div>

      {/* embaixo: a timeline, com a Transcrição como trilha */}
      <section className="flex-1 min-h-0 flex flex-col border-t border-[var(--ln)] bg-[var(--s1)]" aria-label="Timeline">
        <div className="h-11 shrink-0 flex items-center gap-5 px-4 border-b border-[var(--ln)] text-[12px] text-[var(--tx3)]">
          <span className="flex items-center gap-0.5" role="group" aria-label="Início do Corte">
            <span className="mr-1.5">Início <span className="font-mono tabular-nums text-[var(--tx2)]">{tc(e.inn, true)}</span></span>
            <button className={mini} title="Começar 1 Frase antes (Shift ←)" onClick={() => avisar(estender('in', 1), 'O início já está no limite')}>+1 Frase</button>
            <button className={mini} title="Começar 1 Frase depois (Ctrl Shift →)" onClick={() => avisar(estender('in', -1), 'Não há outra Frase para tirar')}>−1</button>
          </span>
          <span className="flex items-center gap-0.5" role="group" aria-label="Fim do Corte">
            <span className="mr-1.5">Fim <span className="font-mono tabular-nums text-[var(--tx2)]">{tc(e.out, true)}</span></span>
            <button className={mini} title="Terminar 1 Frase antes (Ctrl Shift ←)" onClick={() => avisar(estender('out', -1), 'Não há outra Frase para tirar')}>−1</button>
            <button className={mini} title="Terminar 1 Frase depois (Shift →)" onClick={() => avisar(estender('out', 1), 'O fim já está no limite')}>+1 Frase</button>
          </span>
          <span>Duração <span className="font-mono tabular-nums text-[var(--tx)]">{num(ed.duracaoFinal)} s</span></span>
          <span className="ml-auto flex items-center gap-1.5" role="group" aria-label="Zoom da timeline">
            <button className={`${mini} w-7 px-0 grid place-items-center`} aria-label="Afastar (−)" onClick={() => setZi(z => Math.max(0, z - 1))}><Minus size={13} /></button>
            <span className="flex items-end gap-[3px] h-4" aria-hidden>{ZOOMS.map((_, i) => <span key={i} className={`w-[3px] rounded-full ${i <= zi ? 'bg-[var(--tx2)]' : 'bg-[var(--ln2)]'}`} style={{ height: 5 + i * 2 }} />)}</span>
            <button className={`${mini} w-7 px-0 grid place-items-center`} aria-label="Aproximar (=)" onClick={() => setZi(z => Math.min(ZOOMS.length - 1, z + 1))}><Plus size={13} /></button>
            <Kbd k={['−', '=']} /><span className="ml-1.5 flex items-center gap-1.5"><Kbd k={['Z']} /> Corte inteiro</span>
          </span>
        </div>
        <Timeline ed={ed} className="flex-1 pt-2 pr-3" rotuloTrilhas pxPorSeg={ZOOMS[zi]} margem={6}
          ordem={['palavras', 'frases', 'onda', 'miniaturas']} linhas={1} trilhas={{ palavras: 48, frases: 28, onda: 80, miniaturas: 64 }}
          sel={sel} onSel={setSel} onEditarPalavra={id => { setSel({ tipo: 'palavra', id }); setEditando(id) }} onAviso={m => toast(m, { duration: 1800 })} />
        <div className="h-10 shrink-0 flex items-center justify-between px-4 text-[12px] text-[var(--tx3)]">
          <span className="flex items-center gap-2">Clique duplo ou <Kbd k={['Enter']} /> corrige a palavra · <Kbd k={['Alt']} /> solta o encaixe</span>
          <span className="flex items-center gap-2 tabular-nums">
            {ed.silencios.length === 0 ? 'Nenhum silêncio' : e.sil ? `${ed.silencios.length} silêncios removidos, −${num(ed.economia)} s` : `${ed.silencios.length} silêncios mantidos`}<Kbd k={['S']} />
          </span>
        </div>
      </section>

      {editando && <EditorPalavra ed={ed} id={editando} onFim={() => setEditando(null)} />}
      <Paleta comandos={comandos} tela={tela} irPara={irPara} irCorte={trocarCorte} />
    </div>
  )
}

/** Corrige uma palavra no próprio lugar dela na timeline. Enter salva, Esc desiste. */
function EditorPalavra({ ed, id, onFim }: { ed: EstadoEditor; id: string; onFim: () => void }) {
  const w = ed.c.palavras.find(p => p.id === id)!
  const [v, setV] = useState(ed.e.textos[id] ?? w.t)
  const [r, setR] = useState<DOMRect | null>(null)
  const campo = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    const el = document.querySelector(`[data-palavra="${id}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    setR(el?.getBoundingClientRect() ?? null)
  }, [id])
  useEffect(() => { campo.current?.select() }, [r])
  const salvar = () => {
    const n = { ...ed.e.textos }
    if (v.trim() === w.t || !v.trim()) delete n[id]; else n[id] = v.trim()
    ed.mudar({ textos: n }); onFim()
  }
  if (!r) return null
  return (
    <div className="fixed z-30" style={{ left: r.left - 6, top: r.top - 10 }}>
      <input ref={campo} value={v} onChange={ev => setV(ev.target.value)} onBlur={salvar} aria-label={`Corrigir “${w.t}”`}
        onKeyDown={ev => { ev.stopPropagation(); if (ev.key === 'Enter') salvar(); if (ev.key === 'Escape') onFim() }}
        className="h-9 px-2.5 min-w-[140px] rounded-[6px] bg-[var(--s1)] border-2 border-[var(--acc)] text-[14px] text-[var(--tx)] shadow-[0_12px_32px_-12px_rgba(0,0,0,.5)] outline-none"
        style={{ width: `${Math.max(140, v.length * 9 + 32)}px` }} />
      <span className="absolute left-0 top-full mt-1 whitespace-nowrap text-[11px] text-[var(--tx2)] bg-[var(--s1)] px-1.5 py-0.5 rounded-[4px] border border-[var(--ln)]">Enter salva · Esc desiste · a legenda muda junto</span>
    </div>
  )
}

/* ---------------------------------------------------------------- ficha do Corte */

function Linha({ rotulo, tecla, children }: { rotulo: string; tecla?: string[]; children: ReactNode }) {
  return (
    <div className="min-h-10 flex items-center gap-3 border-b border-[var(--ln)] last:border-b-0">
      <span className="w-[112px] shrink-0 flex items-center gap-1.5 text-[12.5px] text-[var(--tx3)]">{rotulo}</span>
      <span className="flex-1 min-w-0 flex items-center justify-end gap-2">{children}</span>
      {tecla && <Kbd k={tecla} className="w-[40px] justify-end" />}
    </div>
  )
}

function Ficha({ ed, onPreset, onSil, onEnquadrar }: { ed: EstadoEditor; onPreset: (i: number) => void; onSil: () => void; onEnquadrar: () => void }) {
  const { c, e, mudar } = ed
  return (
    <div className="w-[400px] min-w-0 flex flex-col">
      <h1 className="text-[17px] font-semibold tracking-[-0.01em] leading-tight">{c.titulo}</h1>
      <p className="mt-1 text-[12.5px] text-[var(--tx3)] tabular-nums">Nota {num(c.nota.total)} · {c.frases.length} Frases · {num(ed.duracaoFinal)} s</p>
      <div className="mt-3">
        <Linha rotulo="Legenda" tecla={['1–4']}>
          <Segmentado rotulo="Estilo da legenda" valor={e.preset} onChange={id => onPreset(presets.findIndex(p => p.id === id))} opcoes={presets.map(p => ({ v: p.id, nome: p.nome }))} />
        </Linha>
        <Linha rotulo="Palavras por vez">
          <Segmentado rotulo="Palavras por vez" valor={e.porVez} onChange={v => mudar({ porVez: v })} opcoes={[2, 3, 4, 5].map(v => ({ v, nome: v }))} />
        </Linha>
        <Linha rotulo="Silêncios" tecla={['S']}>
          <span className="text-[12px] text-[var(--tx2)] tabular-nums">{e.sil ? `−${num(ed.economia)} s` : 'mantidos'}</span>
          <Interruptor rotulo="Remover silêncios" ligado={e.sil} onChange={onSil} />
        </Linha>
        <Linha rotulo="Enquadramento" tecla={['F']}>
          <span className="text-[12.5px] text-[var(--tx)]">{LAYOUTS.find(l => l.id === e.layout)!.nome}</span>
          <Botao tamanho="p" tipo="fantasma" onClick={onEnquadrar}><Crop size={13} /> Ajustar</Botao>
        </Linha>
      </div>
    </div>
  )
}

function FichaEnquadrar({ ed, onFechar }: { ed: EstadoEditor; onFechar: () => void }) {
  const { c, e, mudar } = ed
  return (
    <div className="w-[460px] min-w-0 flex flex-col">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-medium">Enquadramento</h2>
        <Botao tamanho="p" tipo="fantasma" tecla={['Esc']} onClick={onFechar}>Concluir</Botao>
      </div>
      <QuadroFonte className="mt-3 max-h-[200px] w-auto" c={c} cx={e.cx} onCx={cx => mudar({ cx })} keyframes={e.keyframes} />
      <div role="radiogroup" aria-label="Layout" className="mt-3 flex flex-wrap gap-1.5">
        {LAYOUTS.map(l => (
          <button key={l.id} role="radio" aria-checked={e.layout === l.id} onClick={() => mudar({ layout: l.id })}
            className={`h-7 px-2.5 rounded-[6px] text-[12px] border ${foco} ${e.layout === l.id ? 'border-[var(--tx2)] bg-[var(--s3)] text-[var(--tx)]' : 'border-[var(--ln2)] text-[var(--tx2)] hover:text-[var(--tx)]'}`}>{l.nome}</button>
        ))}
      </div>
    </div>
  )
}
