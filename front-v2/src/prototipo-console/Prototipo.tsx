// PROTOTYPE — console ao vivo. Três variações estruturalmente diferentes, trocadas por ?variant=A|B|C.
// A: dock recolhível acima da barra de status. B: painel lateral de atividade (tarefas primeiro, log depois).
// C: terminal fixo com abas por origem. Tudo simulado; não toca no núcleo. Descartar depois da avaliação.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { abrir, cancelar, hhmmss, iniciar, limpar, ROTULO, useConsole, type Linha, type Origem, type Tarefa } from './motor'

const VARIANTES = [
  { k: 'A', nome: 'Dock recolhível' },
  { k: 'B', nome: 'Painel de atividade' },
  { k: 'C', nome: 'Terminal com abas' },
] as const
type K = (typeof VARIANTES)[number]['k']

function lerVariante(): K {
  const v = new URLSearchParams(window.location.search).get('variant')?.toUpperCase()
  return v === 'B' || v === 'C' ? v : 'A'
}
const ouvVar = new Set<() => void>()
function usarVariante(): K {
  return useSyncExternalStore(
    (f) => {
      ouvVar.add(f)
      return () => ouvVar.delete(f)
    },
    lerVariante,
  )
}
function trocar(k: K) {
  const u = new URL(window.location.href)
  u.searchParams.set('variant', k)
  window.history.replaceState(null, '', u)
  ouvVar.forEach((f) => f())
}

const btn =
  'foco cursor-pointer rounded-controle border border-linha bg-transparent px-2 min-h-6 text-pequeno text-t2 hover:bg-area hover:text-t1'
const cor = (n: Linha['nivel']) => (n === 'erro' ? 'var(--erro)' : undefined)

// ---------- pedaços compartilhados (só as linhas e os controles; o layout é de cada variante) ----------
function useControles() {
  const [modo, setModo] = useState<'simples' | 'tecnico'>('simples')
  const [origem, setOrigem] = useState<Origem | 'todas'>('todas')
  const [auto, setAuto] = useState(true)
  const [aviso, setAviso] = useState('')
  const { linhas } = useConsole()
  const vis = useMemo(() => linhas.filter((l) => origem === 'todas' || l.origem === origem), [linhas, origem])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (auto && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [vis, auto])
  const onScroll = () => {
    const e = ref.current
    if (!e) return
    const fim = e.scrollTop + e.clientHeight >= e.scrollHeight - 16
    if (!fim && auto) setAuto(false)
    if (fim && !auto) setAuto(true)
  }
  const copiar = async () => {
    const txt = vis.map((l) => `${hhmmss(l.t)} ${modo === 'simples' ? l.simples : `[${l.origem}] ${l.tecnico}`}`).join('\n')
    try {
      await navigator.clipboard.writeText(txt)
      setAviso('Console copiado.')
    } catch {
      setAviso('Não foi possível copiar.')
    }
    setTimeout(() => setAviso(''), 1800)
  }
  return { modo, setModo, origem, setOrigem, auto, setAuto, aviso, vis, ref, onScroll, copiar }
}
type C = ReturnType<typeof useControles>

function Linhas({ c, className = '' }: { c: C; className?: string }) {
  return (
    <div
      ref={c.ref}
      onScroll={c.onScroll}
      role="log"
      aria-label="Registro de atividade ao vivo"
      aria-live="off"
      className={`min-h-0 flex-1 overflow-auto px-3 py-1.5 ${c.modo === 'tecnico' ? 'font-mono' : ''} text-pequeno ${className}`}
    >
      {c.vis.length === 0 && <p className="m-0 py-3 text-t3">Nada rodando agora. Quando algo começar, você acompanha por aqui.</p>}
      {c.vis.map((l) => (
        <div key={l.seq} className="flex gap-2 py-px leading-5" style={{ color: cor(l.nivel) }}>
          <span className="num shrink-0 text-t3">{hhmmss(l.t)}</span>
          {c.modo === 'tecnico' && <span className="w-20 shrink-0 text-t3">{ROTULO[l.origem]}</span>}
          <span className={l.nivel === 'aviso' ? 'text-t1' : 'text-t2'}>
            {l.nivel === 'aviso' && '⚠ '}
            {c.modo === 'simples' ? l.simples : l.tecnico}
          </span>
        </div>
      ))}
    </div>
  )
}

function Barra({ c, mostrarFiltro = true }: { c: C; mostrarFiltro?: boolean }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-1">
      <div role="group" aria-label="Nível de detalhe" className="flex">
        {(['simples', 'tecnico'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={c.modo === m} onClick={() => c.setModo(m)} className={`${btn} ${c.modo === m ? '!bg-area !text-t1' : ''}`}>
            {m === 'simples' ? 'Simples' : 'Técnico'}
          </button>
        ))}
      </div>
      {mostrarFiltro && (
        <select aria-label="Filtrar por origem" value={c.origem} onChange={(e) => c.setOrigem(e.target.value as Origem | 'todas')} className={btn}>
          <option value="todas">Todas as atividades</option>
          {(Object.keys(ROTULO) as Origem[]).map((o) => (
            <option key={o} value={o}>
              {ROTULO[o]}
            </option>
          ))}
        </select>
      )}
      <span className="ml-auto flex items-center gap-2">
        {c.aviso && <span className="text-pequeno text-t2">{c.aviso}</span>}
        {!c.auto && (
          <button type="button" className={btn} onClick={() => c.setAuto(true)}>
            Retomar rolagem
          </button>
        )}
        <button type="button" className={btn} onClick={c.copiar}>
          Copiar
        </button>
        <button type="button" className={btn} onClick={limpar}>
          Limpar
        </button>
      </span>
    </div>
  )
}

function Trilho({ t }: { t: Tarefa }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-linha" role="progressbar" aria-valuenow={t.pct} aria-valuemin={0} aria-valuemax={100} aria-label={t.nome}>
      <div className="h-full bg-t2 transition-[width] duration-300" style={{ width: `${t.pct}%` }} />
    </div>
  )
}
const estadoTxt = (t: Tarefa) => (t.estado === 'ok' ? 'Concluído' : t.estado === 'cancelada' ? 'Cancelado' : t.estado === 'erro' ? 'Falhou' : `${Math.round(t.pct)}%`)

// ---------- Variante A: dock recolhível (recomendada no plano) ----------
function DockA() {
  const { aberto, tarefas, linhas } = useConsole()
  const c = useControles()
  const ativa = tarefas.find((t) => t.estado === 'rodando')
  const ultima = linhas[linhas.length - 1]
  return (
    <section aria-label="Console" data-proto="A" className="shrink-0 border-t border-linha bg-area">
      <div className="flex min-h-8 items-center gap-2 px-3">
        <button type="button" aria-expanded={aberto} onClick={() => abrir(!aberto)} className={`${btn} flex items-center gap-1.5`}>
          <span aria-hidden>{aberto ? '▾' : '▸'}</span>
          Console
          {ativa && <span aria-hidden className="inline-block size-1.5 animate-pulse rounded-full bg-t1" />}
        </button>
        {!aberto && (
          <span className="min-w-0 flex-1 truncate text-pequeno text-t2">
            {ativa ? `${ativa.nome} · ${Math.round(ativa.pct)}% — ${ativa.etapa}` : ultima ? ultima.simples : 'Nada rodando agora.'}
          </span>
        )}
      </div>
      {aberto && (
        <div className="flex h-56 flex-col border-t border-linha bg-chao">
          <Barra c={c} />
          <Linhas c={c} />
        </div>
      )}
    </section>
  )
}

// ---------- Variante B: painel lateral de atividade (tarefas = protagonistas; log fica dentro) ----------
function PainelB() {
  const { tarefas, linhas, aberto } = useConsole()
  const [aberta, setAberta] = useState<string | null>(null)
  const c = useControles()
  if (!aberto && tarefas.length === 0) {
    return (
      <aside data-proto="B" aria-label="Atividade" className="hidden w-10 shrink-0 border-l border-linha bg-area sm:block">
        <button type="button" className={`${btn} m-1`} title="Atividade" onClick={() => abrir(true)}>
          ≡
        </button>
      </aside>
    )
  }
  return (
    <aside data-proto="B" aria-label="Atividade" className="flex w-96 shrink-0 flex-col border-l border-linha bg-area">
      <div className="flex min-h-8 items-center gap-2 px-3">
        <h2 className="m-0 text-pequeno font-medium text-t1">Atividade</h2>
        <button type="button" className={`${btn} ml-auto`} onClick={() => abrir(!aberto)}>
          {aberto ? 'Recolher' : 'Abrir'}
        </button>
      </div>
      {aberto && (
        <>
          <ul className="m-0 min-h-0 list-none overflow-auto p-0">
            {tarefas.length === 0 && <li className="px-3 py-2 text-pequeno text-t3">Nada rodando agora.</li>}
            {tarefas.map((t) => {
              const minhas = linhas.filter((l) => l.tarefa === t.nome)
              const ab = aberta === t.id
              return (
                <li key={t.id} className="border-t border-linha px-3 py-2">
                  <div className="flex items-center gap-2 text-pequeno">
                    <span className="min-w-0 flex-1 truncate font-medium text-t1">{t.nome}</span>
                    <span className="num text-t2">{estadoTxt(t)}</span>
                  </div>
                  <div className="my-1.5">
                    <Trilho t={t} />
                  </div>
                  <p className="m-0 text-pequeno text-t2">{t.etapa}</p>
                  <div className="mt-1.5 flex gap-2">
                    <button type="button" className={btn} aria-expanded={ab} onClick={() => setAberta(ab ? null : t.id)}>
                      {ab ? 'Esconder detalhes' : 'Ver detalhes'}
                    </button>
                    {t.estado === 'rodando' && (
                      <button type="button" className={btn} onClick={() => cancelar(t.id)}>
                        Cancelar
                      </button>
                    )}
                  </div>
                  {ab && (
                    <ol className="m-0 mt-2 max-h-40 list-none overflow-auto rounded-controle bg-chao p-2 font-mono text-pequeno text-t2">
                      {minhas.map((l) => (
                        <li key={l.seq} className="py-px">
                          <span className="num text-t3">{hhmmss(l.t)}</span> {l.tecnico}
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="mt-auto flex shrink-0 gap-2 border-t border-linha px-3 py-1.5">
            <button type="button" className={btn} onClick={c.copiar}>
              Copiar tudo
            </button>
            <button type="button" className={btn} onClick={limpar}>
              Limpar
            </button>
            {c.aviso && <span className="self-center text-pequeno text-t2">{c.aviso}</span>}
          </div>
        </>
      )}
    </aside>
  )
}

// ---------- Variante C: terminal fixo, abas por origem, sempre visível ----------
function TerminalC() {
  const c = useControles()
  const { linhas } = useConsole()
  const [alt, setAlt] = useState(200)
  const contagem = (o: Origem) => linhas.filter((l) => l.origem === o).length
  const abas: (Origem | 'todas')[] = ['todas', 'componente', 'uv', 'ffmpeg', 'worker', 'ia']
  return (
    <section aria-label="Console" data-proto="C" className="flex shrink-0 flex-col border-t border-linha bg-chao" style={{ height: alt }}>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Redimensionar console"
        className="h-1 shrink-0 cursor-row-resize bg-linha hover:bg-t3"
        onPointerDown={(e) => {
          const y0 = e.clientY
          const h0 = alt
          const mv = (m: PointerEvent) => setAlt(Math.min(420, Math.max(96, h0 + (y0 - m.clientY))))
          const up = () => {
            window.removeEventListener('pointermove', mv)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', mv)
          window.addEventListener('pointerup', up)
        }}
      />
      <div role="tablist" aria-label="Origem" className="flex shrink-0 items-center gap-0.5 border-b border-linha bg-area px-2">
        {abas.map((o) => (
          <button
            key={o}
            role="tab"
            type="button"
            aria-selected={c.origem === o}
            onClick={() => c.setOrigem(o)}
            className={`foco cursor-pointer border-0 border-b-2 bg-transparent px-2 py-1 text-pequeno ${c.origem === o ? 'border-b-[var(--t1)] text-t1' : 'border-b-transparent text-t3 hover:text-t2'}`}
          >
            {o === 'todas' ? 'Tudo' : ROTULO[o]}
            {o !== 'todas' && contagem(o) > 0 && <span className="num ml-1 text-t3">{contagem(o)}</span>}
          </button>
        ))}
      </div>
      <Barra c={c} mostrarFiltro={false} />
      <Linhas c={c} />
    </section>
  )
}

// ---------- Troca de variante e simulação ----------
export function PrototipoSwitcher() {
  const v = usarVariante()
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const a = document.activeElement as HTMLElement | null
      if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return
      const i = VARIANTES.findIndex((x) => x.k === v)
      if (e.key === 'ArrowRight') trocar(VARIANTES[(i + 1) % 3].k)
      if (e.key === 'ArrowLeft') trocar(VARIANTES[(i + 2) % 3].k)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [v])
  const i = VARIANTES.findIndex((x) => x.k === v)
  const pill = 'cursor-pointer rounded-full border border-white/20 bg-transparent px-2.5 py-1 text-xs text-white hover:bg-white/15'
  return (
    <div
      data-proto-switcher
      className="fixed bottom-1 left-1/2 z-[9999] flex -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-full bg-neutral-900 px-3 py-1.5 text-white shadow-xl ring-1 ring-white/20"
    >
      <button type="button" className={pill} aria-label="Variante anterior" onClick={() => trocar(VARIANTES[(i + 2) % 3].k)}>
        ←
      </button>
      <span className="min-w-44 text-center text-xs font-semibold">
        {VARIANTES[i].k} ({VARIANTES[i].nome})
      </span>
      <button type="button" className={pill} aria-label="Próxima variante" onClick={() => trocar(VARIANTES[(i + 1) % 3].k)}>
        →
      </button>
      <span className="mx-1 h-4 w-px bg-white/25" aria-hidden />
      <span className="text-xs text-white/60">Simular:</span>
      <button type="button" className={pill} onClick={() => iniciar('ffmpeg')}>
        FFmpeg
      </button>
      <button type="button" className={pill} onClick={() => iniciar('worker')}>
        Worker
      </button>
      <button type="button" className={pill} onClick={() => iniciar('modelo')}>
        Modelo
      </button>
      <button type="button" className={pill} onClick={() => iniciar('ia')}>
        IA
      </button>
      <button type="button" className={pill} onClick={() => iniciar('export')}>
        Exportar
      </button>
    </div>
  )
}

// Encaixes no Shell: lateral (dentro da linha main + fila) e rodapé (acima da BarraStatus).
export function PrototipoLateral() {
  return usarVariante() === 'B' ? <PainelB /> : null
}
export function PrototipoRodape() {
  const v = usarVariante()
  return v === 'A' ? <DockA /> : v === 'C' ? <TerminalC /> : null
}
