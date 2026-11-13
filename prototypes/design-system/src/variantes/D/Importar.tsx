// Variante D · "Comando": Importar Fonte. Um campo só, opções em linhas de comando e a fila monoespaçada.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Check, Info } from 'lucide-react'
import { fila, tc } from '../../dados'
import type { PropsVariante } from '../../App'
import { Barra, Kbd, Paleta, Primario, foco, useD, useTeclas, type Cmd } from './comum'

const PERMISSOES = [
  { id: 'criador', rotulo: 'Sou o criador do vídeo' },
  { id: 'autorizada', rotulo: 'Autorizada pelo criador' },
  { id: 'sem', rotulo: 'Sem permissão' },
] as const
const PROJETOS = [
  { nome: 'Canal dark · Ficção', perfil: 'Perfil de canal: Canal dark' },
  { nome: 'Canal de cortes', perfil: 'Perfil de canal: Cortes do Léo' },
]
type Item = { nome: string; projeto: string; dur: number; estado: string; progresso: number }

export default function Importar({ irPara }: PropsVariante) {
  const { avisar } = useD()
  const [valor, setValor] = useState('')
  const [arquivo, setArquivo] = useState(false)
  const [sobre, setSobre] = useState(false)
  const [perm, setPerm] = useState(1)
  const [proj, setProj] = useState(0)
  const [abrirProj, setAbrirProj] = useState(false)
  const [itens, setItens] = useState<Item[]>(() => fila.map(f => ({ ...f })))
  const campo = useRef<HTMLInputElement>(null)
  const seletor = useRef<HTMLInputElement>(null)

  // progresso de mentira para a fila parecer viva
  useEffect(() => {
    const id = setInterval(() => setItens(xs => xs.map(x => {
      if (x.progresso <= 0 || x.progresso >= 1) return x
      const p = Math.min(1, x.progresso + 0.006)
      return { ...x, progresso: p, estado: p >= 1 ? 'Pronta · Cortes a revisar' : x.estado }
    })), 600)
    return () => clearInterval(id)
  }, [])

  const url = /^https?:\/\//i.test(valor.trim())
  const tipo = !valor.trim() ? null : arquivo ? 'Arquivo local' : url ? 'URL via yt-dlp' : 'URL inválida'
  const pode = !!valor.trim() && tipo !== 'URL inválida'

  const importar = () => {
    if (!pode) { campo.current?.focus(); return avisar(valor.trim() ? 'Essa URL não começa com http(s)://' : 'Cole uma URL ou solte um arquivo primeiro') }
    const nome = arquivo ? valor : valor.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)
    setItens(xs => [{ nome, projeto: PROJETOS[proj].nome, dur: 0, estado: arquivo ? 'Lendo arquivo' : 'Baixando', progresso: 0.02 }, ...xs])
    setValor(''); setArquivo(false)
    avisar('Fonte adicionada à fila')
  }
  const proximaPerm = () => setPerm(p => (p + 1) % PERMISSOES.length)
  const colar = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) { setValor(t.trim()); setArquivo(false) } } catch { /* sem permissão de leitura */ }
    campo.current?.focus()
  }

  useTeclas(e => {
    const k = e.key, ctrl = e.ctrlKey || e.metaKey
    if (ctrl && k.toLowerCase() === 'o') { e.preventDefault(); return seletor.current?.click() }
    if (ctrl && k.toLowerCase() === 'v') { e.preventDefault(); return colar() }
    if (ctrl) return
    if (k.toLowerCase() === 'p') return proximaPerm()
    if (k.toLowerCase() === 'j') return setAbrirProj(v => !v)
    if (k === 'Escape') return setAbrirProj(false)
    if (abrirProj && ['1', '2'].includes(k)) { setProj(+k - 1); return setAbrirProj(false) }
    if (k === 'Enter' && !(e.target as HTMLElement).closest('button')) return importar()
  })

  const comandos: Cmd[] = [
    { id: 'colar', grupo: 'Importar', rotulo: 'Colar URL', tecla: ['Ctrl', 'V'], palavras: ['youtube', 'yt-dlp', 'link'], acao: colar },
    { id: 'arq', grupo: 'Importar', rotulo: 'Escolher arquivo de vídeo', tecla: ['Ctrl', 'O'], palavras: ['mp4', 'local'], acao: () => seletor.current?.click() },
    { id: 'imp', grupo: 'Importar', rotulo: 'Importar Fonte', tecla: ['Enter'], acao: importar },
    ...PERMISSOES.map((p, i) => ({ id: 'perm-' + p.id, grupo: 'Permissão', rotulo: `Permissão: ${p.rotulo}`, palavras: ['termos', 'youtube'], acao: () => setPerm(i) })),
    ...PROJETOS.map((p, i) => ({ id: 'proj-' + i, grupo: 'Projeto', rotulo: `Projeto: ${p.nome}`, palavras: ['canal', 'perfil'], acao: () => setProj(i) })),
  ]

  return (
    <>
      <Barra migalhas={[{ rotulo: PROJETOS[proj].nome }, { rotulo: 'Importar Fonte' }]} />
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-[600px] max-w-[calc(100%-32px)] pt-[9vh] pb-24">
          {/* Campo único */}
          <div
            onDragOver={e => { e.preventDefault(); setSobre(true) }}
            onDragLeave={() => setSobre(false)}
            onDrop={e => {
              e.preventDefault(); setSobre(false)
              const f = e.dataTransfer.files[0]
              if (f) { setValor(f.name); setArquivo(true) }
              else { const t = e.dataTransfer.getData('text'); if (t) { setValor(t); setArquivo(false) } }
            }}
            className={`rounded-[10px] border transition-colors ${sobre ? 'border-neutral-950 bg-neutral-950 text-white' : 'border-neutral-200 bg-white focus-within:border-neutral-950'}`}>
            <div className="flex items-center gap-3 px-5 h-[68px]">
              <input ref={campo} value={valor}
                onChange={e => { setValor(e.target.value); setArquivo(false) }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); importar() } if (e.key === 'Escape') campo.current?.blur() }}
                aria-label="URL ou arquivo da Fonte"
                placeholder={sobre ? 'Solte para usar este arquivo' : 'Cole uma URL ou solte um arquivo'}
                className={`flex-1 min-w-0 bg-transparent outline-none text-[19px] tracking-[-0.01em] ${sobre ? 'placeholder:text-white' : 'placeholder:text-neutral-500'}`} />
              {tipo && <span className={`shrink-0 font-mono text-[11px] ${tipo === 'URL inválida' ? 'text-neutral-950 underline decoration-dotted' : 'text-neutral-500'}`}>{tipo}</span>}
            </div>
            <div className={`flex items-center gap-4 px-5 h-10 border-t text-[12px] ${sobre ? 'border-white/20 text-white/70' : 'border-neutral-200 text-neutral-500'}`}>
              <span className="flex items-center gap-1.5"><Kbd k={['Ctrl', 'V']} inv={sobre} /> colar URL</span>
              <button onClick={() => seletor.current?.click()} className={`flex items-center gap-1.5 hover:text-neutral-950 rounded-[3px] ${foco}`}><Kbd k={['Ctrl', 'O']} inv={sobre} /> escolher arquivo</button>
              <span className="flex-1" />
              <span className="font-mono text-[11px]">YouTube, Twitch, mp4, mkv, mov</span>
            </div>
            <input ref={seletor} type="file" accept="video/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) { setValor(f.name); setArquivo(true) } }} />
          </div>

          {/* Opções em linhas de comando */}
          <div className="mt-5 rounded-[8px] border border-neutral-200 divide-y divide-neutral-200">
            <Linha rotulo="Permissão" tecla="P" onClick={proximaPerm} valor={PERMISSOES[perm].rotulo} />
            <div>
              <Linha rotulo="Projeto" tecla="J" onClick={() => setAbrirProj(v => !v)} aberto={abrirProj}
                valor={<>{PROJETOS[proj].nome}<span className="ml-2 text-neutral-500">{PROJETOS[proj].perfil}</span></>} />
              {abrirProj && (
                <div role="listbox" aria-label="Projeto" className="p-1 border-t border-neutral-200 bg-neutral-50">
                  {PROJETOS.map((p, i) => (
                    <button key={p.nome} role="option" aria-selected={i === proj} onClick={() => { setProj(i); setAbrirProj(false) }}
                      className={`w-full h-9 flex items-center gap-3 px-3 rounded-[6px] text-left ${i === proj ? 'bg-neutral-950 text-white' : 'hover:bg-white'} ${foco}`}>
                      <span className="w-4">{i === proj && <Check size={13} />}</span>
                      <span className="flex-1">{p.nome}</span>
                      <span className={`text-[12px] ${i === proj ? 'text-white/65' : 'text-neutral-500'}`}>{p.perfil}</span>
                      <Kbd k={[String(i + 1)]} inv={i === proj} />
                    </button>
                  ))}
                  <p className="px-3 py-2 text-[12px] text-neutral-500">Um Projeto por canal. O Perfil de canal define voz, Narração e Empacotamento dos Cortes.</p>
                </div>
              )}
            </div>
          </div>
          {PERMISSOES[perm].id === 'sem' && (
            <p className="mt-2.5 flex gap-2 px-1 text-[12px] leading-[1.5] text-neutral-600">
              <Info size={13} className="mt-[2px] shrink-0" />
              Sem permissão do criador, publicar Cortes deste vídeo pode violar os Termos do YouTube. A escolha fica registrada no Projeto.
            </p>
          )}

          <div className="mt-5 flex items-center justify-end gap-3">
            <span className="text-[12px] text-neutral-500">A Transcrição roda neste computador</span>
            <Primario tecla={['Enter']} onClick={importar} disabled={!pode}>Importar Fonte</Primario>
          </div>

          {/* Fila */}
          <section className="mt-12" aria-label="Fila de Fontes">
            <div className="flex items-baseline justify-between mb-1.5 px-1">
              <h2 className="text-[12px] text-neutral-500">Fila de Fontes</h2>
              <span className="font-mono text-[11px] tabular-nums text-neutral-500">{itens.filter(i => i.progresso < 1).length} em andamento</span>
            </div>
            <ul className="border-t border-neutral-200 font-mono text-[12px] tabular-nums">
              {itens.map((f, i) => {
                const pronta = f.progresso >= 1
                const Tag = pronta ? 'button' : 'div'
                return (
                  <li key={f.nome + i} className="relative border-b border-neutral-200">
                    <Tag {...(pronta ? { onClick: () => irPara('cortes') } : {})}
                      className={`group w-full h-11 grid grid-cols-[minmax(0,1fr)_64px_minmax(0,170px)_40px] items-center gap-4 px-1 text-left ${pronta ? `hover:bg-neutral-50 cursor-pointer ${foco}` : ''}`}>
                      <span className="min-w-0">
                        <span className="block truncate text-neutral-950">{f.nome}</span>
                        <span className="block truncate text-[11px] text-neutral-500">{f.projeto}</span>
                      </span>
                      <span className="text-right text-neutral-600">{f.dur ? tc(f.dur) : '–'}</span>
                      <span className={`truncate ${pronta ? 'text-neutral-950' : 'text-neutral-600'}`}>{f.estado}</span>
                      <span className="text-right text-neutral-600">{pronta ? <span className="group-hover:hidden">100%</span> : `${Math.round(f.progresso * 100)}%`}{pronta && <span className="hidden group-hover:inline text-neutral-950">abrir</span>}</span>
                    </Tag>
                    <span className="absolute left-0 -bottom-px h-px bg-neutral-950" style={{ width: `${f.progresso * 100}%` }} aria-hidden />
                  </li>
                )
              })}
            </ul>
          </section>
        </div>
      </main>
      <Paleta comandos={comandos} tela="importar" irPara={irPara} irCorte={() => irPara('editor')} />
    </>
  )
}

function Linha({ rotulo, valor, tecla, onClick, aberto }: { rotulo: string; valor: ReactNode; tecla: string; onClick: () => void; aberto?: boolean }) {
  return (
    <button onClick={onClick} aria-expanded={aberto}
      className={`w-full h-10 flex items-center gap-4 px-4 text-left hover:bg-neutral-50 first:rounded-t-[8px] ${foco}`}>
      <span className="w-20 text-neutral-500">{rotulo}</span>
      <span className="flex-1 min-w-0 truncate">{valor}</span>
      {aberto != null && <ChevronDown size={14} className={`text-neutral-500 transition-transform ${aberto ? 'rotate-180' : ''}`} />}
      <Kbd k={[tecla]} />
    </button>
  )
}
