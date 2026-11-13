// Variante F, "Foco": o editor abre só com o preview e a timeline.
// Os Cortes (borda esquerda) e as ferramentas (borda direita) chegam por proximidade do mouse ou por tecla,
// flutuam sobre o palco sem empurrar o preview, e somem quando você volta a mexer no vídeo ou na timeline.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AudioWaveform, Captions, Check, Crop, Download, Pause, Play, Rows3, ScrollText, X } from 'lucide-react'
import { toast } from 'sonner'
import { cortes, img, presets, tc } from '../../dados'
import type { PropsVariante } from '../../App'
import { Botao, Interruptor, Kbd, LAYOUTS, LinhaLegenda, Segmentado, foco, num, rolarAte } from '../nucleo/base'
import { useEditor, type EstadoEditor } from '../nucleo/editor'
import { GatilhoPaleta, Paleta, useAtalhos, type Cmd } from '../nucleo/Paleta'
import { Preview, QuadroFonte } from '../nucleo/Preview'
import { Timeline } from '../nucleo/Timeline'
import { TopoF, memoF } from './comum'

type Ferramenta = 'transcricao' | 'legenda' | 'enquadrar' | 'audio'
type Estado = null | 'perto' | 'fixa' // 'perto' = aberta pelo mouse na borda; 'fixa' = aberta por tecla
const FERR: { id: Ferramenta; nome: string; tecla: string; icone: ReactNode }[] = [
  { id: 'transcricao', nome: 'Transcrição', tecla: 'T', icone: <ScrollText size={15} strokeWidth={1.75} /> },
  { id: 'legenda', nome: 'Legenda', tecla: 'L', icone: <Captions size={15} strokeWidth={1.75} /> },
  { id: 'enquadrar', nome: 'Enquadrar', tecla: 'F', icone: <Crop size={15} strokeWidth={1.75} /> },
  { id: 'audio', nome: 'Áudio', tecla: 'A', icone: <AudioWaveform size={15} strokeWidth={1.75} /> },
]

export default function EditorF({ tela, irPara }: PropsVariante) {
  const ed = useEditor(memoF)
  const { c, e, mudar, t, tocando, alternar, preset, estender, trocar } = ed
  const q = new URLSearchParams(location.search).get('painel')
  const [esq, setEsq] = useState<Estado>(q === 'cortes' ? 'fixa' : null)
  const [dir, setDir] = useState<Estado>(q && q !== 'cortes' ? 'fixa' : null)
  const [ferr, setFerr] = useState<Ferramenta>((FERR.find(f => f.id === q)?.id) ?? 'transcricao')
  const fechaTimer = useRef(0)

  const avisar = (m: string | null, falha?: string) => { if (m) toast(m, { duration: 1800 }); else if (falha) toast(falha, { duration: 1800 }) }
  const exportar = () => toast(`Exportando “${c.titulo}”`, { description: `1080×1920 · ${num(ed.duracaoFinal)} s · legenda ${preset.nome}` })
  const abrirFerr = (f: Ferramenta) => { if (dir === 'fixa' && ferr === f) setDir(null); else { setFerr(f); setDir('fixa') } }
  const alternarSil = () => { mudar({ sil: !e.sil }); toast(!e.sil ? `Silêncios removidos: −${num(ed.economia)} s` : 'Silêncios restaurados', { duration: 1600 }) }
  const aplicarPreset = (i: number) => { const p = presets[i]; mudar({ preset: p.id, pos: p.pos, porVez: p.palavras }); toast(`Legenda ${p.nome}`, { duration: 1400 }) }
  /** Voltar a editar recolhe o que estava aberto. */
  const voltarAEditar = () => { setEsq(null); setDir(null) }

  useAtalhos(ev => {
    const k = ev.key, l = k.toLowerCase(), ctrl = ev.ctrlKey || ev.metaKey
    if (ctrl && l === 'e') { ev.preventDefault(); return exportar() }
    if (ctrl && ev.shiftKey && k === 'ArrowRight') { ev.preventDefault(); return avisar(estender('in', -1), 'Não há outra Frase para tirar do início') }
    if (ctrl && ev.shiftKey && k === 'ArrowLeft') { ev.preventDefault(); return avisar(estender('out', -1), 'Não há outra Frase para tirar do fim') }
    if (ctrl) return
    if (k === 'Escape') return voltarAEditar()
    if (k === ' ') { ev.preventDefault(); return alternar() }
    if (ev.shiftKey && k === 'ArrowLeft') { ev.preventDefault(); return avisar(estender('in', 1), 'O início já está no limite') }
    if (ev.shiftKey && k === 'ArrowRight') { ev.preventDefault(); return avisar(estender('out', 1), 'O fim já está no limite') }
    if (k === 'ArrowLeft') { ev.preventDefault(); return ed.passoPalavra(-1) }
    if (k === 'ArrowRight') { ev.preventDefault(); return ed.passoPalavra(1) }
    if (k === '[') return trocar(ed.ci - 1)
    if (k === ']') return trocar(ed.ci + 1)
    if (l === 'c') return setEsq(v => (v === 'fixa' ? null : 'fixa'))
    const f = FERR.find(x => x.tecla.toLowerCase() === l)
    if (f) return abrirFerr(f.id)
    if (l === 's') return alternarSil()
    if (['1', '2', '3', '4'].includes(k)) return aplicarPreset(+k - 1)
  })

  const comandos: Cmd[] = [
    { id: 'tocar', grupo: 'Corte', rotulo: tocando ? 'Pausar' : 'Reproduzir', tecla: ['Espaço'], acao: alternar },
    { id: 'ext-ini', grupo: 'Corte', rotulo: 'Estender início em 1 Frase', tecla: ['Shift', '←'], palavras: ['frase', 'antes'], acao: () => avisar(estender('in', 1), 'O início já está no limite') },
    { id: 'ext-fim', grupo: 'Corte', rotulo: 'Estender fim em 1 Frase', tecla: ['Shift', '→'], palavras: ['frase', 'depois'], acao: () => avisar(estender('out', 1), 'O fim já está no limite') },
    { id: 'enc-ini', grupo: 'Corte', rotulo: 'Encurtar início em 1 Frase', tecla: ['Ctrl', 'Shift', '→'], acao: () => avisar(estender('in', -1), 'Não há outra Frase para tirar do início') },
    { id: 'enc-fim', grupo: 'Corte', rotulo: 'Encurtar fim em 1 Frase', tecla: ['Ctrl', 'Shift', '←'], acao: () => avisar(estender('out', -1), 'Não há outra Frase para tirar do fim') },
    { id: 'sil', grupo: 'Corte', rotulo: e.sil ? 'Restaurar silêncios' : 'Remover silêncios', tecla: ['S'], palavras: ['pausa'], acao: alternarSil },
    { id: 'exp', grupo: 'Corte', rotulo: 'Exportar Corte', tecla: ['Ctrl', 'E'], palavras: ['render', 'salvar'], acao: exportar },
    { id: 'p-cortes', grupo: 'Mostrar', rotulo: 'Mostrar Cortes', tecla: ['C'], acao: () => setEsq('fixa') },
    ...FERR.map(f => ({ id: 'p-' + f.id, grupo: 'Mostrar', rotulo: `Mostrar ${f.nome}`, tecla: [f.tecla], palavras: f.id === 'enquadrar' ? ['crop', 'recorte', 'layout'] : undefined, acao: () => { setFerr(f.id); setDir('fixa') } })),
    { id: 'p-foco', grupo: 'Mostrar', rotulo: 'Só preview e timeline', tecla: ['Esc'], acao: voltarAEditar },
    ...presets.map((p, i) => ({ id: 'pre-' + p.id, grupo: 'Legenda', rotulo: `Legenda ${p.nome}`, tecla: [String(i + 1)], palavras: ['estilo', 'preset'], acao: () => aplicarPreset(i) })),
    { id: 'prox', grupo: 'Navegar', rotulo: 'Próximo Corte', tecla: [']'], acao: () => trocar(ed.ci + 1) },
    { id: 'ant', grupo: 'Navegar', rotulo: 'Corte anterior', tecla: ['['], acao: () => trocar(ed.ci - 1) },
  ]

  const perto = (lado: 'esq' | 'dir') => {
    clearTimeout(fechaTimer.current)
    if (lado === 'esq' && !esq) setEsq('perto')
    if (lado === 'dir' && !dir) setDir('perto')
  }
  const longe = (lado: 'esq' | 'dir') => {
    clearTimeout(fechaTimer.current)
    fechaTimer.current = window.setTimeout(() => {
      if (lado === 'esq') setEsq(v => (v === 'perto' ? null : v))
      else setDir(v => (v === 'perto' ? null : v))
    }, 260)
  }
  useEffect(() => () => clearTimeout(fechaTimer.current), [])

  return (
    <div className="h-full flex flex-col">
      <TopoF tela={tela} irPara={irPara}
        meio={<span className="flex items-center gap-2.5 min-w-0 text-[13px]">
          <span className="truncate text-[var(--tx)]">{c.titulo}</span>
          <span className="font-mono tabular-nums text-[12px] text-[var(--tx3)]">{ed.ci + 1}/{cortes.length}</span>
          <Kbd k={['[', ']']} />
        </span>}
        direita={<>
          <GatilhoPaleta />
          <Botao tipo="primario" tecla={['Ctrl', 'E']} onClick={exportar}><Download size={14} /> Exportar</Botao>
        </>} />

      {/* palco: só o preview e o transporte. As gavetas flutuam por cima, sem empurrar nada. */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 flex flex-col" onPointerDown={voltarAEditar}>
          <Preview className="flex-1 pt-5 px-6" c={c} cx={e.cx} layout={e.layout} grupo={ed.grupo} ativa={ed.ativa?.id}
            preset={preset} pos={e.pos} escala={e.escala} moldura="ring-1 ring-[var(--ln)]" />
          <Transporte ed={ed} avisar={avisar} />
        </div>

        {/* bordas vivas: chegar perto ou apertar a tecla */}
        <div className="absolute left-0 inset-y-0 w-4 z-10" onMouseEnter={() => perto('esq')} onMouseLeave={() => longe('esq')} aria-hidden />
        <div className="absolute right-0 inset-y-0 w-4 z-10" onMouseEnter={() => perto('dir')} onMouseLeave={() => longe('dir')} aria-hidden />
        <button onClick={() => setEsq('fixa')} onMouseEnter={() => perto('esq')} onMouseLeave={() => longe('esq')}
          className={`f-puxador absolute left-0 top-1/2 -translate-y-1/2 z-10 w-9 py-2.5 flex flex-col items-center gap-2 rounded-r-[8px] border border-l-0 border-[var(--ln)] bg-[var(--s1)] text-[var(--tx3)] hover:text-[var(--tx)] ${foco}`}
          data-oculto={!!esq} aria-label="Mostrar Cortes (C)" title="Cortes (C)">
          <Rows3 size={15} strokeWidth={1.75} />
          <kbd className="font-mono text-[10px] leading-none px-[4px] py-[3px] rounded-[3px] border border-[var(--ln2)] bg-[var(--s2)] text-[var(--tx2)]">C</kbd>
        </button>
        <div className="f-puxador absolute right-0 top-1/2 -translate-y-1/2 z-10 flex flex-col rounded-l-[8px] border border-r-0 border-[var(--ln)] bg-[var(--s1)] py-1"
          data-oculto={!!dir} onMouseEnter={() => perto('dir')} onMouseLeave={() => longe('dir')}>
          {FERR.map(f => (
            <button key={f.id} onClick={() => abrirFerr(f.id)} aria-label={`${f.nome} (${f.tecla})`} title={`${f.nome} (${f.tecla})`}
              className={`w-9 py-1.5 flex flex-col items-center gap-1.5 text-[var(--tx3)] hover:text-[var(--tx)] ${foco}`}>
              {f.icone}
              <kbd className="font-mono text-[10px] leading-none px-[4px] py-[3px] rounded-[3px] border border-[var(--ln2)] bg-[var(--s2)] text-[var(--tx2)]">{f.tecla}</kbd>
            </button>
          ))}
        </div>

        <Gaveta lado="esq" aberta={!!esq} onEnter={() => perto('esq')} onLeave={() => longe('esq')}>
          <GavetaCortes ci={ed.ci} onTrocar={i => { trocar(i); setEsq(null) }} onFechar={() => setEsq(null)} />
        </Gaveta>
        <Gaveta lado="dir" aberta={!!dir} onEnter={() => perto('dir')} onLeave={() => longe('dir')}>
          <div className="h-12 shrink-0 flex items-center gap-0.5 px-1.5 border-b border-[var(--ln)]" role="tablist" aria-label="Ferramentas">
            {FERR.map(f => (
              <button key={f.id} role="tab" aria-selected={ferr === f.id} onClick={() => setFerr(f.id)}
                className={`h-8 px-1.5 flex items-center gap-1.5 rounded-[6px] text-[12.5px] whitespace-nowrap transition-colors duration-150 ${foco} ${ferr === f.id ? 'bg-[var(--s3)] text-[var(--tx)]' : 'text-[var(--tx3)] hover:text-[var(--tx2)]'}`}>
                {f.nome}<Kbd k={[f.tecla]} />
              </button>
            ))}
            <button onClick={() => setDir(null)} aria-label="Fechar (Esc)" className={`ml-auto w-7 h-7 grid place-items-center rounded-[5px] text-[var(--tx3)] hover:text-[var(--tx)] hover:bg-[var(--s2)] ${foco}`}><X size={14} /></button>
          </div>
          <div key={ferr} className="f-troca flex-1 min-h-0 overflow-auto nu-rolagem">
            {ferr === 'transcricao' && <FerrTranscricao ed={ed} />}
            {ferr === 'legenda' && <FerrLegenda ed={ed} onPreset={aplicarPreset} />}
            {ferr === 'enquadrar' && <FerrEnquadrar ed={ed} />}
            {ferr === 'audio' && <FerrAudio ed={ed} onSil={alternarSil} />}
          </div>
        </Gaveta>
      </div>

      {/* timeline: sempre visível, é onde se edita */}
      <section className="h-[244px] shrink-0 flex flex-col border-t border-[var(--ln)] bg-[var(--s1)]" onPointerDown={voltarAEditar} aria-label="Timeline">
        <div className="h-9 shrink-0 flex items-center gap-5 px-4 text-[12px] text-[var(--tx3)]">
          <span>Entrada <span className="font-mono tabular-nums text-[var(--tx2)]">{tc(e.inn, true)}</span></span>
          <span>Saída <span className="font-mono tabular-nums text-[var(--tx2)]">{tc(e.out, true)}</span></span>
          <span>Duração <span className="font-mono tabular-nums text-[var(--tx)]">{num(ed.duracaoFinal)} s</span></span>
          <span className="ml-auto flex items-center gap-2 tabular-nums">
            {ed.silencios.length === 0 ? 'Nenhum silêncio' : e.sil ? `${ed.silencios.length} silêncios removidos, −${num(ed.economia)} s` : `${ed.silencios.length} silêncios mantidos`}
            <Kbd k={['S']} />
          </span>
        </div>
        <Timeline ed={ed} className="flex-1 px-4" trilhas={{ miniaturas: 46, onda: 36, frases: 24, palavras: 0 }} onAviso={m => toast(m, { duration: 1800 })} />
        <div className="h-10 shrink-0 flex items-center justify-between px-4 text-[12px] text-[var(--tx3)]">
          <span className="flex items-center gap-2">Alças encaixam na Frase; <Kbd k={['Alt']} /> solta</span>
          <span className="flex items-center gap-2"><Kbd k={['←', '→']} /> palavra <span className="w-2" /><Kbd k={['Shift', '←', '→']} /> ±1 Frase</span>
        </div>
      </section>

      <Paleta comandos={comandos} tela={tela} irPara={irPara} irCorte={trocar} />
      <style>{`
        .f-gaveta{transition:transform .22s cubic-bezier(.22,1,.36,1),opacity .18s ease-out}
        .f-gaveta[data-lado=esq][data-aberta=false]{transform:translateX(calc(-100% - 16px));opacity:0}
        .f-gaveta[data-lado=dir][data-aberta=false]{transform:translateX(calc(100% + 16px));opacity:0}
        .f-puxador{transition:opacity .16s ease-out}
        .f-puxador[data-oculto=true]{opacity:0;pointer-events:none}
        .f-troca{animation:f-troca .16s ease-out}
        @keyframes f-troca{from{opacity:0}to{opacity:1}}
        @media (prefers-reduced-motion: reduce){
          .f-gaveta{transition:opacity .12s linear}
          .f-gaveta[data-aberta=false]{transform:none !important}
          .f-troca{animation:none}
        }
      `}</style>
    </div>
  )
}

function Gaveta({ lado, aberta, children, onEnter, onLeave }: { lado: 'esq' | 'dir'; aberta: boolean; children: ReactNode; onEnter: () => void; onLeave: () => void }) {
  return (
    <aside data-lado={lado} data-aberta={aberta} inert={!aberta} onMouseEnter={onEnter} onMouseLeave={onLeave}
      className={`f-gaveta absolute top-3 bottom-3 z-20 flex flex-col rounded-[10px] bg-[var(--s1)] border border-[var(--ln2)] shadow-[0_24px_48px_-20px_rgba(0,0,0,.7)] overflow-hidden ${lado === 'esq' ? 'left-3 w-[296px]' : 'right-3 w-[396px]'}`}>
      {children}
    </aside>
  )
}

/* ---------------------------------------------------------------- transporte */

function Transporte({ ed, avisar }: { ed: EstadoEditor; avisar: (m: string | null, falha?: string) => void }) {
  const { tocando, alternar, estender } = ed
  const mini = `h-7 px-2 rounded-[5px] text-[12px] text-[var(--tx2)] hover:text-[var(--tx)] hover:bg-[var(--s2)] tabular-nums ${foco}`
  return (
    <div className="h-14 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-6" onPointerDown={ev => ev.stopPropagation()}>
      <div className="justify-self-end flex items-center gap-0.5" role="group" aria-label="Início do Corte">
        <span className="text-[12px] text-[var(--tx3)] mr-1">Início</span>
        <button className={mini} title="Começar 1 Frase antes (Shift ←)" onClick={() => avisar(estender('in', 1), 'O início já está no limite')}>+1 Frase</button>
        <button className={mini} title="Começar 1 Frase depois (Ctrl Shift →)" onClick={() => avisar(estender('in', -1), 'Não há outra Frase para tirar')}>−1</button>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={alternar} aria-label={tocando ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'} title="Espaço"
          className={`w-9 h-9 rounded-full grid place-items-center bg-[var(--tx)] text-[var(--bg)] hover:opacity-90 ${foco}`}>
          {tocando ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
        </button>
        <span className="font-mono tabular-nums text-[13px] whitespace-nowrap min-w-[124px]">
          {tc(ed.tRel, true)}<span className="text-[var(--tx3)]"> / {tc(ed.duracaoFinal, true)}</span>
        </span>
      </div>
      <div className="justify-self-start flex items-center gap-0.5" role="group" aria-label="Fim do Corte">
        <button className={mini} title="Terminar 1 Frase antes (Ctrl Shift ←)" onClick={() => avisar(estender('out', -1), 'Não há outra Frase para tirar')}>−1</button>
        <button className={mini} title="Terminar 1 Frase depois (Shift →)" onClick={() => avisar(estender('out', 1), 'O fim já está no limite')}>+1 Frase</button>
        <span className="text-[12px] text-[var(--tx3)] ml-1">Fim</span>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- gaveta de Cortes */

function GavetaCortes({ ci, onTrocar, onFechar }: { ci: number; onTrocar: (i: number) => void; onFechar: () => void }) {
  return (
    <>
      <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-[var(--ln)]">
        <span className="text-[13px] font-medium">Cortes</span>
        <span className="text-[12px] text-[var(--tx3)] tabular-nums">{cortes.length}</span>
        <button onClick={onFechar} aria-label="Fechar (C)" className={`ml-auto w-7 h-7 grid place-items-center rounded-[5px] text-[var(--tx3)] hover:text-[var(--tx)] hover:bg-[var(--s2)] ${foco}`}><X size={14} /></button>
      </div>
      <ul className="flex-1 overflow-auto nu-rolagem p-1.5">
        {cortes.map((k, i) => {
          const on = i === ci
          const st = memoF.status[k.id]
          return (
            <li key={k.id}>
              <button onClick={() => onTrocar(i)} aria-current={on}
                className={`w-full flex gap-3 p-2 rounded-[7px] text-left transition-colors duration-150 ${foco} ${on ? 'bg-[var(--s3)]' : 'hover:bg-[var(--s2)]'}`}>
                <img src={img(k.thumbs[3])} alt="" className="w-[72px] h-[40px] rounded-[4px] object-cover shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13px] leading-[1.3] truncate ${on ? 'text-[var(--tx)]' : 'text-[var(--tx2)]'}`}>{k.titulo}</span>
                  <span className="mt-1 flex items-center gap-2 text-[11.5px] text-[var(--tx3)] tabular-nums">
                    <span className="font-mono">{tc(k.fim - k.inicio)}</span>
                    <span>Nota {num(k.nota.total)}</span>
                    {st === 'aprovado' && <span className="ml-auto flex items-center gap-1 text-[var(--tx2)]"><Check size={12} /> aprovado</span>}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="h-10 shrink-0 flex items-center gap-4 px-4 border-t border-[var(--ln)] text-[11.5px] text-[var(--tx3)]">
        <span className="flex items-center gap-1.5"><Kbd k={['[', ']']} /> trocar</span>
        <span className="flex items-center gap-1.5"><Kbd k={['G']} /> buscar</span>
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- ferramentas */

const Secao = ({ titulo, children, extra }: { titulo: string; children: ReactNode; extra?: ReactNode }) => (
  <section className="px-4 py-4 border-b border-[var(--ln)] last:border-b-0">
    <div className="flex items-center justify-between mb-3 min-h-[20px]">
      <h3 className="text-[12px] font-medium text-[var(--tx2)]">{titulo}</h3>
      {extra}
    </div>
    {children}
  </section>
)

function FerrTranscricao({ ed }: { ed: EstadoEditor }) {
  const { c, e, frase, ativa, ir, palavrasTexto } = ed
  const ativaRef = useRef<HTMLLIElement>(null)
  useEffect(() => { rolarAte(ativaRef.current) }, [frase?.id])
  return (
    <ol className="py-2">
      {c.frases.map(f => {
        const dentro = f.s >= e.inn - 0.01 && f.e <= e.out + 0.01
        const on = f.id === frase?.id
        return (
          <li key={f.id} ref={on ? ativaRef : undefined} className={`grid grid-cols-[48px_1fr] gap-2 px-4 py-2 rounded-[6px] mx-1.5 ${on ? 'bg-[var(--s2)]' : ''} ${dentro ? '' : 'opacity-45'}`}>
            <span className={`font-mono tabular-nums text-[11px] pt-[3px] ${on ? 'text-[var(--tx)]' : 'text-[var(--tx3)]'}`}>{tc(Math.max(0, f.s - e.inn), true)}</span>
            <p className="text-[13.5px] leading-[1.6] text-[var(--tx2)]">
              {palavrasTexto.filter(w => w.f === f.id).map((w, i) => (
                <span key={w.id}>{i > 0 && ' '}
                  <button onClick={() => ir(w.s + 0.001)}
                    className={`rounded-[3px] px-[2px] -mx-[2px] ${foco} ${w.id === ativa?.id ? 'bg-[var(--acc-bg)] text-[var(--acc)]' : on ? 'text-[var(--tx)] hover:bg-[var(--s3)]' : 'hover:bg-[var(--s3)] hover:text-[var(--tx)]'}`}>{w.t}</button>
                </span>
              ))}
              {!dentro && <span className="ml-2 text-[11px] text-[var(--tx3)]">fora do Corte</span>}
            </p>
          </li>
        )
      })}
    </ol>
  )
}

function FerrLegenda({ ed, onPreset }: { ed: EstadoEditor; onPreset: (i: number) => void }) {
  const { c, e, mudar } = ed
  const amostra = c.palavras.slice(0, 2).map(w => ({ id: w.id, t: w.t }))
  return (
    <>
      <Secao titulo="Estilo">
        <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Estilo da legenda">
          {presets.map((p, i) => {
            const on = p.id === e.preset
            return (
              <button key={p.id} role="radio" aria-checked={on} onClick={() => onPreset(i)} className={`text-left rounded-[7px] ${foco}`}>
                <span className={`relative block h-[64px] rounded-[7px] overflow-hidden ring-1 transition-shadow duration-150 ${on ? 'ring-2 ring-[var(--acc)]' : 'ring-[var(--ln2)] hover:ring-[var(--tx3)]'}`}>
                  <img src={img(c.wide)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />
                  <span className="absolute inset-0 grid place-items-center"><LinhaLegenda palavras={amostra} ativa={amostra[1]?.id} preset={p} tamanho={16} /></span>
                </span>
                <span className="mt-1.5 flex items-center justify-between">
                  <span className={`text-[12px] ${on ? 'text-[var(--tx)]' : 'text-[var(--tx3)]'}`}>{p.nome}</span>
                  <Kbd k={[String(i + 1)]} />
                </span>
              </button>
            )
          })}
        </div>
      </Secao>
      <Secao titulo="Tamanho e ritmo">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-[var(--tx3)]">Tamanho</span>
            <Segmentado rotulo="Tamanho" valor={e.escala} onChange={v => mudar({ escala: v })} opcoes={[{ v: 'P', nome: 'P' }, { v: 'M', nome: 'M' }, { v: 'G', nome: 'G' }]} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-[var(--tx3)]">Palavras por vez</span>
            <Segmentado rotulo="Palavras por vez" valor={e.porVez} onChange={v => mudar({ porVez: v })} opcoes={[2, 3, 4, 5].map(v => ({ v, nome: v }))} />
          </div>
        </div>
      </Secao>
      <Secao titulo="Posição vertical" extra={<span className="font-mono tabular-nums text-[12px] text-[var(--tx3)]">{Math.round(e.pos * 100)}%</span>}>
        <input type="range" min={0.15} max={0.9} step={0.01} value={e.pos} onChange={ev => mudar({ pos: +ev.target.value })}
          aria-label="Posição vertical da legenda" className={`w-full accent-[var(--tx)] ${foco}`} />
      </Secao>
    </>
  )
}

function FerrEnquadrar({ ed }: { ed: EstadoEditor }) {
  const { c, e, mudar } = ed
  return (
    <>
      <Secao titulo="Quadro da Fonte" extra={<span className="font-mono tabular-nums text-[12px] text-[var(--tx3)]">{Math.round(e.cx * 100)}%</span>}>
        <QuadroFonte c={c} cx={e.cx} onCx={cx => mudar({ cx, layout: e.layout === 'cheia' ? 'rosto' : e.layout })} keyframes={e.keyframes} />
        <p className="mt-2.5 text-[12px] text-[var(--tx3)] leading-[1.5]">Arraste o retângulo ou use <Kbd k={['←', '→']} className="align-middle" /> com ele em foco.</p>
        <div className="mt-3 flex gap-2">
          <Botao tamanho="p" onClick={() => mudar({ cx: 0.5 })}>Centralizar</Botao>
          <Botao tamanho="p" tipo="fantasma" disabled={Math.abs(e.cx - c.cx) < 0.001} onClick={() => mudar({ cx: c.cx })}>Voltar ao sugerido</Botao>
        </div>
      </Secao>
      <Secao titulo="Layout">
        <ul role="radiogroup" aria-label="Layout do enquadramento" className="flex flex-col gap-0.5">
          {LAYOUTS.map(l => (
            <li key={l.id}>
              <button role="radio" aria-checked={e.layout === l.id} onClick={() => mudar({ layout: l.id })}
                className={`w-full h-8 px-2.5 flex items-center justify-between rounded-[6px] text-[13px] transition-colors duration-150 ${foco} ${e.layout === l.id ? 'bg-[var(--s3)] text-[var(--tx)]' : 'text-[var(--tx2)] hover:bg-[var(--s2)]'}`}>
                {l.nome}{e.layout === l.id && <Check size={14} />}
              </button>
            </li>
          ))}
        </ul>
      </Secao>
      <Secao titulo="Keyframes" extra={<span className="text-[12px] text-[var(--tx3)] tabular-nums">{e.keyframes.length}</span>}>
        <ul className="text-[12px] flex flex-col gap-1">
          {e.keyframes.map((k, i) => (
            <li key={i} className="flex items-center justify-between h-7 px-2 rounded-[5px] bg-[var(--s2)]">
              <span className="font-mono tabular-nums text-[var(--tx2)]">{tc(k.t - e.inn, true)}</span>
              <span className="tabular-nums text-[var(--tx3)]">centro {Math.round(k.cx * 100)}%</span>
            </li>
          ))}
        </ul>
      </Secao>
    </>
  )
}

function FerrAudio({ ed, onSil }: { ed: EstadoEditor; onSil: () => void }) {
  const { e, mudar, silencios, economia, ir } = ed
  return (
    <Secao titulo="Remover silêncios" extra={<span className="flex items-center gap-2"><Kbd k={['S']} /><Interruptor rotulo="Remover silêncios" ligado={e.sil} onChange={onSil} /></span>}>
      <p className="text-[12px] text-[var(--tx3)] leading-[1.5] mb-3">Corta os trechos abaixo de −40 dB. A legenda acompanha.</p>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] text-[var(--tx3)]">Duração mínima</span>
        <Segmentado rotulo="Duração mínima do silêncio" valor={e.minimo} onChange={v => mudar({ minimo: v })} opcoes={[{ v: 0.3, nome: '0,3 s' }, { v: 0.5, nome: '0,5 s' }, { v: 1, nome: '1 s' }]} />
      </div>
      {silencios.length === 0
        ? <p className="text-[12px] text-[var(--tx3)]">Nenhum silêncio com essa duração neste Corte.</p>
        : <>
          <ul className="rounded-[6px] border border-[var(--ln)] divide-y divide-[var(--ln)]">
            {silencios.map((s, i) => (
              <li key={i}>
                <button onClick={() => ir(s.s)} className={`w-full flex items-center justify-between h-8 px-3 text-[12px] hover:bg-[var(--s2)] ${foco}`}>
                  <span className="font-mono tabular-nums text-[var(--tx2)]">{tc(s.s - e.inn, true)}</span>
                  <span className={`tabular-nums ${e.sil ? 'text-[var(--tx3)] line-through' : 'text-[var(--tx2)]'}`}>{num(s.e - s.s)} s</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-[12px] text-[var(--tx2)] tabular-nums">{e.sil ? `O Corte fica ${num(economia)} s mais curto.` : `Ligue para tirar ${num(economia)} s.`}</p>
        </>}
    </Secao>
  )
}
