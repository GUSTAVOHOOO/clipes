// Variante G, "Seleção": não há abas. A timeline (e o preview) são o lugar de selecionar; o painel da direita mostra
// só as propriedades do que está selecionado: uma palavra, uma Frase, uma borda, o enquadramento ou, sem nada, o Corte.
import { useRef, useState, type ReactNode } from 'react'
import { Check, Download, Pause, Play, Plus, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { cortes, img, presets, tc } from '../../dados'
import type { PropsVariante } from '../../App'
import { Botao, Interruptor, Kbd, LAYOUTS, LinhaLegenda, Segmentado, clamp, foco, num } from '../nucleo/base'
import { LARG_CROP, useEditor, type EstadoEditor } from '../nucleo/editor'
import { Paleta, useAtalhos, type Cmd } from '../nucleo/Paleta'
import { Preview, QuadroFonte } from '../nucleo/Preview'
import { Timeline, type Sel } from '../nucleo/Timeline'
import { Inspector, Prop, Secao, TopoG, memoG } from './comum'

function selInicial(ed: EstadoEditor): Sel {
  const q = new URLSearchParams(location.search).get('sel')
  const w = ed.c.palavras[2], f = ed.c.frases[1]
  if (q === 'palavra') return { tipo: 'palavra', id: w.id }
  if (q === 'frase') return { tipo: 'frase', id: f.id }
  if (q === 'borda') return { tipo: 'borda', lado: 'out' }
  if (q === 'recorte') return { tipo: 'recorte' }
  return { tipo: 'corte' }
}

export default function EditorG({ tela, irPara }: PropsVariante) {
  const ed = useEditor(memoG)
  const { c, e, mudar, t, tocando, alternar, preset, estender, trocar, ir } = ed
  const [sel, setSel] = useState<Sel>(() => selInicial(ed))
  const campo = useRef<HTMLInputElement>(null)

  const avisar = (m: string | null, falha?: string) => toast(m ?? falha ?? '', { duration: 1800 })
  const exportar = () => toast(`Exportando “${c.titulo}”`, { description: `1080×1920 · ${num(ed.duracaoFinal)} s · legenda ${preset.nome}` })
  const alternarSil = () => { mudar({ sil: !e.sil }); toast(!e.sil ? `Silêncios removidos: −${num(ed.economia)} s` : 'Silêncios restaurados', { duration: 1600 }) }
  const aplicarPreset = (i: number) => { const p = presets[i]; mudar({ preset: p.id, pos: p.pos, porVez: p.palavras }) }
  const trocarCorte = (i: number) => { trocar(i); setSel({ tipo: 'corte' }) }
  const focarAlca = (lado: 'in' | 'out') => { setSel({ tipo: 'borda', lado }); requestAnimationFrame(() => (document.querySelector(`[data-alca="${lado}"]`) as HTMLElement | null)?.focus()) }
  const subir = () => {
    if (sel.tipo === 'palavra') { const w = c.palavras.find(p => p.id === sel.id); return setSel(w ? { tipo: 'frase', id: w.f } : { tipo: 'corte' }) }
    setSel({ tipo: 'corte' })
  }
  const selPalavra = (d: number) => {
    const base = sel.tipo === 'palavra' ? sel.id : ed.ativa?.id
    const k = Math.max(0, c.palavras.findIndex(p => p.id === base))
    const w = c.palavras[clamp(k + d, 0, c.palavras.length - 1)]
    ir(w.s + 0.001); setSel({ tipo: 'palavra', id: w.id })
  }
  const selFrase = (d: number) => {
    const base = sel.tipo === 'frase' ? sel.id : ed.frase?.id
    const k = Math.max(0, c.frases.findIndex(f => f.id === base))
    const f = c.frases[clamp(k + d, 0, c.frases.length - 1)]
    ir(f.s + 0.001); setSel({ tipo: 'frase', id: f.id })
  }
  const addKeyframe = () => { mudar({ keyframes: [...e.keyframes, { t, cx: e.cx }].sort((a, b) => a.t - b.t) }); toast(`Keyframe em ${tc(t - e.inn, true)}`, { duration: 1400 }) }

  useAtalhos(ev => {
    const k = ev.key, l = k.toLowerCase(), ctrl = ev.ctrlKey || ev.metaKey
    if ((ev.target as HTMLElement).closest?.('[data-alca]') && (k === 'ArrowLeft' || k === 'ArrowRight')) return
    if (ctrl && l === 'e') { ev.preventDefault(); return exportar() }
    if (ctrl && ev.shiftKey && k === 'ArrowRight') { ev.preventDefault(); return avisar(estender('in', -1), 'Não há outra Frase para tirar do início') }
    if (ctrl && ev.shiftKey && k === 'ArrowLeft') { ev.preventDefault(); return avisar(estender('out', -1), 'Não há outra Frase para tirar do fim') }
    if (ctrl || ev.altKey) return
    if (k === 'Escape') return subir()
    if (k === ' ') { ev.preventDefault(); return alternar() }
    if (ev.shiftKey && k === 'ArrowLeft') { ev.preventDefault(); return avisar(estender('in', 1), 'O início já está no limite') }
    if (ev.shiftKey && k === 'ArrowRight') { ev.preventDefault(); return avisar(estender('out', 1), 'O fim já está no limite') }
    if (k === 'ArrowLeft' || k === 'ArrowRight') { ev.preventDefault(); return selPalavra(k === 'ArrowLeft' ? -1 : 1) }
    if (k === 'ArrowUp' || k === 'ArrowDown') { ev.preventDefault(); return selFrase(k === 'ArrowUp' ? -1 : 1) }
    if (k === 'Enter' && sel.tipo === 'palavra') { ev.preventDefault(); return campo.current?.focus() }
    if (k === '[') return trocarCorte(ed.ci - 1)
    if (k === ']') return trocarCorte(ed.ci + 1)
    if (l === 'i') return focarAlca('in')
    if (l === 'o') return focarAlca('out')
    if (l === 'f') return setSel({ tipo: 'recorte' })
    if (l === 'w') return selPalavra(0)
    if (l === 'e') return selFrase(0)
    if (l === 'k' && sel.tipo === 'recorte') return addKeyframe()
    if (l === 's') return alternarSil()
    if (['1', '2', '3', '4'].includes(k)) return aplicarPreset(+k - 1)
  })

  const comandos: Cmd[] = [
    { id: 'tocar', grupo: 'Corte', rotulo: tocando ? 'Pausar' : 'Reproduzir', tecla: ['Espaço'], acao: alternar },
    { id: 's-in', grupo: 'Selecionar', rotulo: 'Selecionar a entrada', tecla: ['I'], palavras: ['borda', 'início'], acao: () => focarAlca('in') },
    { id: 's-out', grupo: 'Selecionar', rotulo: 'Selecionar a saída', tecla: ['O'], palavras: ['borda', 'fim'], acao: () => focarAlca('out') },
    { id: 's-w', grupo: 'Selecionar', rotulo: 'Selecionar a palavra no playhead', tecla: ['W'], acao: () => selPalavra(0) },
    { id: 's-f', grupo: 'Selecionar', rotulo: 'Selecionar a Frase no playhead', tecla: ['E'], acao: () => selFrase(0) },
    { id: 's-r', grupo: 'Selecionar', rotulo: 'Selecionar o enquadramento', tecla: ['F'], palavras: ['crop', 'recorte', 'layout', 'keyframe'], acao: () => setSel({ tipo: 'recorte' }) },
    { id: 's-c', grupo: 'Selecionar', rotulo: 'Selecionar o Corte (estilo e export)', tecla: ['Esc'], acao: () => setSel({ tipo: 'corte' }) },
    { id: 'ext-ini', grupo: 'Corte', rotulo: 'Estender início em 1 Frase', tecla: ['Shift', '←'], acao: () => avisar(estender('in', 1), 'O início já está no limite') },
    { id: 'ext-fim', grupo: 'Corte', rotulo: 'Estender fim em 1 Frase', tecla: ['Shift', '→'], acao: () => avisar(estender('out', 1), 'O fim já está no limite') },
    { id: 'sil', grupo: 'Corte', rotulo: e.sil ? 'Restaurar silêncios' : 'Remover silêncios', tecla: ['S'], acao: alternarSil },
    { id: 'exp', grupo: 'Corte', rotulo: 'Exportar Corte', tecla: ['Ctrl', 'E'], acao: exportar },
    ...presets.map((p, i) => ({ id: 'pre-' + p.id, grupo: 'Legenda', rotulo: `Legenda ${p.nome}`, tecla: [String(i + 1)], palavras: ['estilo', 'preset'], acao: () => aplicarPreset(i) })),
    { id: 'prox', grupo: 'Navegar', rotulo: 'Próximo Corte', tecla: [']'], acao: () => trocarCorte(ed.ci + 1) },
    { id: 'ant', grupo: 'Navegar', rotulo: 'Corte anterior', tecla: ['['], acao: () => trocarCorte(ed.ci - 1) },
  ]

  // conteúdo do inspector, conforme a seleção
  const nFrase = (id: string) => c.frases.findIndex(f => f.id === id) + 1
  let caminho: { rotulo: string; ir?: () => void }[] = [{ rotulo: 'Corte', ir: () => setSel({ tipo: 'corte' }) }]
  let corpo: ReactNode, dica: ReactNode, chave = sel.tipo
  if (sel.tipo === 'palavra') {
    const w = c.palavras.find(p => p.id === sel.id)!
    caminho = [...caminho, { rotulo: `Frase ${nFrase(w.f)}`, ir: () => setSel({ tipo: 'frase', id: w.f }) }, { rotulo: `“${e.textos[w.id] ?? w.t}”` }]
    chave += w.id
    dica = 'Corrija o texto aqui: a legenda muda junto, o áudio não.'
    corpo = <PropsPalavra ed={ed} id={w.id} campo={campo} onSair={() => setSel({ tipo: 'frase', id: w.f })} onSel={id => setSel({ tipo: 'palavra', id })} />
  } else if (sel.tipo === 'frase') {
    caminho = [...caminho, { rotulo: `Frase ${nFrase(sel.id)}` }]
    chave += sel.id
    corpo = <PropsFrase ed={ed} id={sel.id} onPalavra={id => setSel({ tipo: 'palavra', id })} avisar={avisar} />
  } else if (sel.tipo === 'borda') {
    caminho = [...caminho, { rotulo: sel.lado === 'in' ? 'Entrada' : 'Saída' }]
    chave += sel.lado
    dica = <>Com a alça em foco, <Kbd k={['←', '→']} className="align-middle" /> andam 1 Frase e <Kbd k={['Alt', '←', '→']} className="align-middle" /> andam 0,1 s.</>
    corpo = <PropsBorda ed={ed} lado={sel.lado} avisar={avisar} />
  } else if (sel.tipo === 'recorte') {
    caminho = [...caminho, { rotulo: 'Enquadramento' }]
    corpo = <PropsRecorte ed={ed} onKeyframe={addKeyframe} />
  } else {
    caminho = [{ rotulo: c.titulo }]
    dica = 'Clique numa palavra, numa Frase, numa alça ou no preview para ver só o que importa.'
    corpo = <PropsCorte ed={ed} onPreset={aplicarPreset} onSil={alternarSil} onExportar={exportar} />
  }

  return (
    <div className="h-full flex flex-col">
      <TopoG tela={tela} irPara={irPara}
        direita={<Botao tipo="primario" tamanho="p" tecla={['Ctrl', 'E']} onClick={exportar}><Download size={14} /> Exportar</Botao>} />
      <div className="flex-1 min-h-0 flex">
        <Trilho ci={ed.ci} onTrocar={trocarCorte} />
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 flex flex-col">
            <Preview className="flex-1 pt-5 px-6" c={c} cx={e.cx} layout={e.layout} grupo={ed.grupo} ativa={ed.ativa?.id}
              preset={preset} pos={e.pos} escala={e.escala} onClick={() => setSel({ tipo: 'recorte' })} rotulo="Preview 9:16. Clique para selecionar o enquadramento (F)"
              moldura={`transition-shadow duration-150 ${sel.tipo === 'recorte' ? 'ring-2 ring-[var(--acc)]' : 'ring-1 ring-[var(--ln)] hover:ring-[var(--ln2)] cursor-pointer'}`}>
              {sel.tipo === 'recorte' && <span className="absolute left-2 top-2 h-5 px-1.5 grid place-items-center rounded-[4px] bg-[var(--acc)] text-[var(--acc-tx)] text-[11px] font-medium">Enquadramento</span>}
            </Preview>
            <div className="h-14 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-5">
              <span className="justify-self-start flex items-center gap-2 text-[12px] text-[var(--tx3)]"><Kbd k={['I']} /> entrada <Kbd k={['O']} /> saída <Kbd k={['F']} /> enquadrar</span>
              <div className="flex items-center gap-3">
                <button onClick={alternar} aria-label={tocando ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'}
                  className={`w-9 h-9 rounded-full grid place-items-center bg-[var(--tx)] text-[var(--bg)] hover:opacity-90 ${foco}`}>
                  {tocando ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
                </button>
                <span className="font-mono tabular-nums text-[13px] whitespace-nowrap">{tc(ed.tRel, true)}<span className="text-[var(--tx3)]"> / {tc(ed.duracaoFinal, true)}</span></span>
              </div>
              <span className="justify-self-end flex items-center gap-2 text-[12px] text-[var(--tx3)]"><Kbd k={['W']} /> palavra <Kbd k={['E']} /> Frase</span>
            </div>
          </div>
          <section className="h-[214px] shrink-0 flex flex-col border-t border-[var(--ln)] bg-[var(--s1)]" aria-label="Timeline">
            <Timeline ed={ed} className="flex-1 pt-2 pr-4" rotuloTrilhas trilhas={{ miniaturas: 42, onda: 32, frases: 28, palavras: 0 }}
              sel={sel} onSel={setSel} onEditarPalavra={id => { setSel({ tipo: 'palavra', id }); requestAnimationFrame(() => campo.current?.focus()) }}
              onAviso={m => toast(m, { duration: 1800 })} />
            <div className="h-10 shrink-0 flex items-center justify-between px-4 text-[12px] text-[var(--tx3)]">
              <span className="tabular-nums">Duração <span className="font-mono text-[var(--tx)]">{num(ed.duracaoFinal)} s</span></span>

            </div>
          </section>
        </div>
        <Inspector caminho={caminho} chave={chave} dica={dica}>{corpo}</Inspector>
      </div>
      <Paleta comandos={comandos} tela={tela} irPara={irPara} irCorte={trocarCorte} />
    </div>
  )
}

/* ---------------------------------------------------------------- trilho de Cortes, só miniaturas */

function Trilho({ ci, onTrocar }: { ci: number; onTrocar: (i: number) => void }) {
  return (
    <nav className="w-[76px] shrink-0 flex flex-col items-center border-r border-[var(--ln)] bg-[var(--s1)]" aria-label="Cortes">
      <ul className="flex-1 flex flex-col items-center gap-3 pt-4">
        {cortes.map((k, i) => {
          const on = i === ci
          return (
            <li key={k.id}>
              <button onClick={() => onTrocar(i)} aria-current={on} title={`${k.titulo} · Nota ${num(k.nota.total)}`} aria-label={`${k.titulo}, Nota ${num(k.nota.total)}`}
                className={`group flex flex-col items-center gap-1.5 rounded-[6px] p-1 ${foco}`}>
                <span className={`relative block w-[40px] h-[71px] rounded-[5px] overflow-hidden transition-shadow duration-150 ${on ? 'ring-2 ring-[var(--tx)] ring-offset-2 ring-offset-[var(--s1)]' : 'ring-1 ring-[var(--ln2)] opacity-70 group-hover:opacity-100'}`}>
                  <img src={img(k.vert)} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  {memoG.status[k.id] === 'aprovado' && <span className="absolute right-0.5 bottom-0.5 w-3.5 h-3.5 grid place-items-center rounded-full bg-[var(--tx)] text-[var(--bg)]"><Check size={9} strokeWidth={3} /></span>}
                </span>
                <span className={`font-mono tabular-nums text-[11px] ${on ? 'text-[var(--tx)]' : 'text-[var(--tx3)]'}`}>{num(k.nota.total)}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <span className="pb-4"><Kbd k={['[', ']']} /></span>
    </nav>
  )
}

/* ---------------------------------------------------------------- propriedades por seleção */

function PropsCorte({ ed, onPreset, onSil, onExportar }: { ed: EstadoEditor; onPreset: (i: number) => void; onSil: () => void; onExportar: () => void }) {
  const { c, e, mudar, silencios, economia } = ed
  const amostra = c.palavras.slice(0, 2).map(w => ({ id: w.id, t: w.t }))
  return (
    <>
      <Secao titulo="Legenda">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Estilo da legenda">
          {presets.map((p, i) => {
            const on = p.id === e.preset
            return (
              <button key={p.id} role="radio" aria-checked={on} onClick={() => onPreset(i)} className={`text-left rounded-[6px] ${foco}`}>
                <span className={`relative block h-[52px] rounded-[6px] overflow-hidden ring-1 transition-shadow duration-150 ${on ? 'ring-2 ring-[var(--acc)]' : 'ring-[var(--ln2)] hover:ring-[var(--tx3)]'}`}>
                  <img src={img(c.wide)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />
                  <span className="absolute inset-0 grid place-items-center"><LinhaLegenda palavras={amostra} ativa={amostra[1]?.id} preset={p} tamanho={14} /></span>
                </span>
                <span className="mt-1 flex items-center justify-between text-[12px]">
                  <span className={on ? 'text-[var(--tx)]' : 'text-[var(--tx3)]'}>{p.nome}</span><Kbd k={[String(i + 1)]} />
                </span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-col gap-1">
          <Prop rotulo="Tamanho"><Segmentado rotulo="Tamanho" valor={e.escala} onChange={v => mudar({ escala: v })} opcoes={[{ v: 'P', nome: 'P' }, { v: 'M', nome: 'M' }, { v: 'G', nome: 'G' }]} /></Prop>
          <Prop rotulo="Palavras por vez"><Segmentado rotulo="Palavras por vez" valor={e.porVez} onChange={v => mudar({ porVez: v })} opcoes={[2, 3, 4, 5].map(v => ({ v, nome: v }))} /></Prop>
        </div>
      </Secao>
      <Secao titulo="Silêncios" extra={<span className="flex items-center gap-2"><Kbd k={['S']} /><Interruptor rotulo="Remover silêncios" ligado={e.sil} onChange={onSil} /></span>}>
        <p className="text-[12.5px] text-[var(--tx2)] tabular-nums">
          {silencios.length === 0 ? 'Nenhum silêncio neste Corte.' : e.sil ? `${silencios.length} trechos removidos, −${num(economia)} s` : `${silencios.length} trechos detectados, ${num(economia)} s`}
        </p>
        <div className="mt-2"><Prop rotulo="Duração mínima"><Segmentado rotulo="Duração mínima do silêncio" valor={e.minimo} onChange={v => mudar({ minimo: v })} opcoes={[{ v: 0.3, nome: '0,3 s' }, { v: 0.5, nome: '0,5 s' }, { v: 1, nome: '1 s' }]} /></Prop></div>
      </Secao>
      <Secao titulo="Saída">
        <Prop rotulo="Duração"><span className="font-mono tabular-nums">{num(ed.duracaoFinal)} s</span></Prop>
        <Prop rotulo="Formato"><span className="tabular-nums">1080×1920, 30 fps</span></Prop>
        <Prop rotulo="Enquadramento">{LAYOUTS.find(l => l.id === e.layout)!.nome}</Prop>
        <Botao className="w-full mt-3" tecla={['Ctrl', 'E']} onClick={onExportar}><Download size={14} /> Exportar este Corte</Botao>
      </Secao>
    </>
  )
}

function PropsPalavra({ ed, id, campo, onSair, onSel }: { ed: EstadoEditor; id: string; campo: React.RefObject<HTMLInputElement | null>; onSair: () => void; onSel: (id: string) => void }) {
  const { c, e, mudar } = ed
  const w = c.palavras.find(p => p.id === id)!
  const texto = e.textos[id] ?? w.t
  const daFrase = c.palavras.filter(p => p.f === w.f)
  const setTexto = (v: string) => { const n = { ...e.textos }; if (v === w.t) delete n[id]; else n[id] = v; mudar({ textos: n }) }
  return (
    <>
      <Secao titulo="Texto" extra={<Kbd k={['Enter']} />}>
        <input ref={campo} value={texto} onChange={ev => setTexto(ev.target.value)} aria-label="Texto da palavra"
          onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); (ev.target as HTMLInputElement).blur(); if (ev.key === 'Escape') onSair() } }}
          className={`w-full h-10 px-3 rounded-[6px] bg-[var(--bg)] border border-[var(--ln2)] text-[15px] focus:border-[var(--acc)] ${foco}`} />
        {e.textos[id] && (
          <button onClick={() => setTexto(w.t)} className={`mt-2 inline-flex items-center gap-1.5 text-[12px] text-[var(--tx2)] hover:text-[var(--tx)] rounded-[4px] ${foco}`}>
            <RotateCcw size={12} /> Voltar para “{w.t}” da Transcrição
          </button>
        )}
      </Secao>
      <Secao titulo="Tempo">
        <Prop rotulo="Começa"><span className="font-mono tabular-nums">{tc(w.s - e.inn, true)}</span></Prop>
        <Prop rotulo="Termina"><span className="font-mono tabular-nums">{tc(w.e - e.inn, true)}</span></Prop>
        <Prop rotulo="Duração"><span className="font-mono tabular-nums">{num(w.e - w.s, 2)} s</span></Prop>
      </Secao>
      <Secao titulo="Na Frase" extra={<Kbd k={['←', '→']} />}>
        <p className="text-[13.5px] leading-[1.7] text-[var(--tx2)]">
          {daFrase.map((p, i) => (
            <span key={p.id}>{i > 0 && ' '}
              <button onClick={() => { ed.ir(p.s + 0.001); onSel(p.id) }}
                className={`rounded-[3px] px-[2px] -mx-[2px] ${foco} ${p.id === id ? 'bg-[var(--acc-bg)] text-[var(--acc)]' : 'hover:bg-[var(--s3)] hover:text-[var(--tx)]'}`}>{e.textos[p.id] ?? p.t}</button>
            </span>
          ))}
        </p>
      </Secao>
    </>
  )
}

function PropsFrase({ ed, id, onPalavra, avisar }: { ed: EstadoEditor; id: string; onPalavra: (id: string) => void; avisar: (m: string | null, f?: string) => void }) {
  const { c, e, mudar } = ed
  const f = c.frases.find(x => x.id === id)!
  const i = c.frases.indexOf(f)
  const primeira = Math.abs(f.s - e.inn) < 0.05, ultima = Math.abs(f.e - e.out) < 0.05
  return (
    <>
      <Secao titulo="Transcrição" extra={<Kbd k={['↑', '↓']} />}>
        <p className="text-[15px] leading-[1.6] text-[var(--tx)]">
          {c.palavras.filter(w => w.f === id).map((w, k) => (
            <span key={w.id}>{k > 0 && ' '}
              <button onClick={() => { ed.ir(w.s + 0.001); onPalavra(w.id) }} className={`rounded-[3px] px-[2px] -mx-[2px] hover:bg-[var(--s3)] ${foco}`}>{e.textos[w.id] ?? w.t}</button>
            </span>
          ))}
        </p>
        <p className="mt-2 text-[12px] text-[var(--tx3)]">Frase {i + 1} de {c.frases.length}. Clique numa palavra para corrigir.</p>
      </Secao>
      <Secao titulo="Tempo">
        <Prop rotulo="De"><span className="font-mono tabular-nums">{tc(f.s - e.inn, true)} a {tc(f.e - e.inn, true)}</span></Prop>
        <Prop rotulo="Duração"><span className="font-mono tabular-nums">{num(f.e - f.s)} s</span></Prop>
      </Secao>
      <Secao titulo="Bordas do Corte">
        <div className="flex flex-col gap-2">
          <Botao tamanho="p" className="justify-between" disabled={primeira} onClick={() => { mudar({ inn: f.s }); avisar(`O Corte agora começa na Frase ${i + 1}`) }}>Começar o Corte aqui</Botao>
          <Botao tamanho="p" className="justify-between" disabled={ultima} onClick={() => { mudar({ out: f.e }); avisar(`O Corte agora termina na Frase ${i + 1}`) }}>Terminar o Corte aqui</Botao>
          {primeira && <Botao tamanho="p" tipo="fantasma" tecla={['Shift', '←']} className="justify-between" onClick={() => avisar(ed.estender('in', 1), 'O início já está no limite')}>Estender 1 Frase antes</Botao>}
          {ultima && <Botao tamanho="p" tipo="fantasma" tecla={['Shift', '→']} className="justify-between" onClick={() => avisar(ed.estender('out', 1), 'O fim já está no limite')}>Estender 1 Frase depois</Botao>}
        </div>
      </Secao>
    </>
  )
}

function PropsBorda({ ed, lado, avisar }: { ed: EstadoEditor; lado: 'in' | 'out'; avisar: (m: string | null, f?: string) => void }) {
  const { e, todas, mudar } = ed
  const v = lado === 'in' ? e.inn : e.out
  const f = todas.find(x => Math.abs((lado === 'in' ? x.s : x.e) - v) < 0.05)
  const ajustar = (d: number) => lado === 'in' ? mudar({ inn: clamp(e.inn + d, 0, e.out - 1) }) : mudar({ out: clamp(e.out + d, e.inn + 1, 1e9) })
  return (
    <>
      <Secao>
        <div className="font-mono tabular-nums text-[22px] tracking-[-0.01em]">{tc(v, true)}</div>
        <p className="mt-1 text-[12.5px] text-[var(--tx2)]">{f ? <>Encaixada {lado === 'in' ? 'no começo' : 'no fim'} de “<span className="text-[var(--tx)]">{f.texto.length > 42 ? f.texto.slice(0, 42) + '…' : f.texto}</span>”</> : 'Solta, fora do encaixe de Frase'}</p>
      </Secao>
      <Secao titulo="Por Frase">
        <div className="grid grid-cols-2 gap-2">
          <Botao tamanho="p" tecla={lado === 'in' ? ['Shift', '←'] : ['Ctrl', '⇧', '←']} onClick={() => avisar(lado === 'in' ? ed.estender('in', 1) : ed.estender('out', -1), 'Sem Frase para esse lado')}>−1 Frase</Botao>
          <Botao tamanho="p" tecla={lado === 'in' ? ['Ctrl', '⇧', '→'] : ['Shift', '→']} onClick={() => avisar(lado === 'in' ? ed.estender('in', -1) : ed.estender('out', 1), 'Sem Frase para esse lado')}>+1 Frase</Botao>
        </div>
        <p className="mt-2 text-[12px] text-[var(--tx3)]">{lado === 'in' ? '−1 começa uma Frase antes; +1, uma depois.' : '−1 termina uma Frase antes; +1, uma depois.'}</p>
      </Secao>
      <Secao titulo="Ajuste fino, sem encaixe">
        <div className="grid grid-cols-2 gap-2">
          <Botao tamanho="p" tipo="fantasma" onClick={() => ajustar(-0.1)}>−0,1 s</Botao>
          <Botao tamanho="p" tipo="fantasma" onClick={() => ajustar(0.1)}>+0,1 s</Botao>
        </div>
        <p className="mt-2 text-[12px] text-[var(--tx3)] flex items-center gap-1.5">Ao arrastar a alça, segure <Kbd k={['Alt']} /> para soltar o encaixe.</p>
      </Secao>
    </>
  )
}

function PropsRecorte({ ed, onKeyframe }: { ed: EstadoEditor; onKeyframe: () => void }) {
  const { c, e, mudar, ir } = ed
  return (
    <>
      <Secao titulo="Quadro da Fonte" extra={<span className="font-mono tabular-nums text-[12px] text-[var(--tx3)]">centro {Math.round(e.cx * 100)}%</span>}>
        <QuadroFonte c={c} cx={e.cx} onCx={cx => mudar({ cx: clamp(cx, LARG_CROP / 2, 1 - LARG_CROP / 2) })} keyframes={e.keyframes} />
        <div className="mt-3 flex gap-2">
          <Botao tamanho="p" onClick={() => mudar({ cx: 0.5 })}>Centralizar</Botao>
          <Botao tamanho="p" tipo="fantasma" disabled={Math.abs(e.cx - c.cx) < 0.001} onClick={() => mudar({ cx: c.cx })}>Sugerido</Botao>
        </div>
      </Secao>
      <Secao titulo="Layout">
        <div role="radiogroup" aria-label="Layout do enquadramento" className="flex flex-wrap gap-1.5">
          {LAYOUTS.map(l => (
            <button key={l.id} role="radio" aria-checked={e.layout === l.id} onClick={() => mudar({ layout: l.id })}
              className={`h-7 px-2.5 rounded-[6px] text-[12px] border transition-colors duration-150 ${foco} ${e.layout === l.id ? 'border-[var(--acc)] bg-[var(--acc-bg)] text-[var(--tx)]' : 'border-[var(--ln2)] text-[var(--tx2)] hover:text-[var(--tx)]'}`}>{l.nome}</button>
          ))}
        </div>
      </Secao>
      <Secao titulo="Keyframes" extra={<Botao tamanho="p" tipo="fantasma" tecla={['K']} onClick={onKeyframe}><Plus size={13} /> No playhead</Botao>}>
        <ul className="flex flex-col gap-1">
          {e.keyframes.map((k, i) => (
            <li key={i}>
              <button onClick={() => { ir(k.t); mudar({ cx: k.cx }) }} className={`w-full h-8 px-2.5 flex items-center justify-between rounded-[6px] bg-[var(--s2)] hover:bg-[var(--s3)] text-[12px] ${foco}`}>
                <span className="font-mono tabular-nums text-[var(--tx2)]">{tc(k.t - e.inn, true)}</span>
                <span className="tabular-nums text-[var(--tx3)]">centro {Math.round(k.cx * 100)}%</span>
              </button>
            </li>
          ))}
        </ul>
      </Secao>
    </>
  )
}
