// Importar Fonte, Variante E ("Estúdio + Comando"): o campo único da D, opções em linhas e a fila em linhas finas, no grafite da A.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Info } from 'lucide-react'
import { toast } from 'sonner'
import { fila, img, tc } from '../../dados'
import { Principal, Topo, useComandosTela, useE, useTeclas } from './Shell'
import { Kbd, foco } from './ui'

const PERMISSOES = [
  { id: 'propria', rotulo: 'O vídeo é meu' },
  { id: 'autorizada', rotulo: 'Tenho permissão do criador' },
  { id: 'sem', rotulo: 'Sem permissão' },
] as const
const PROJETOS = [
  { nome: 'Canal dark · Ficção', perfil: 'Ficção sombria', detalhe: 'legenda Impacto, Narração em PT-BR' },
  { nome: 'Canal de cortes', perfil: 'Cortes de live', detalhe: 'legenda Clássico, sem Narração' },
]
type Item = { nome: string; projeto: string; dur: number; estado: string; progresso: number; img: string }

export default function Importar() {
  const { irPara } = useE()
  const [valor, setValor] = useState('')
  const [arquivo, setArquivo] = useState(false)
  const [sobre, setSobre] = useState(false)
  const [perm, setPerm] = useState(1)
  const [proj, setProj] = useState(0)
  const [abrirProj, setAbrirProj] = useState(false)
  const [itens, setItens] = useState<Item[]>(() => fila.map(f => ({ ...f })))
  const campo = useRef<HTMLInputElement>(null)
  const seletor = useRef<HTMLInputElement>(null)

  // Progresso de mentira para a fila parecer viva.
  useEffect(() => {
    const id = setInterval(() => setItens(xs => xs.map(x => {
      if (x.progresso <= 0 || x.progresso >= 1) return x
      const p = Math.min(1, x.progresso + 0.004)
      return { ...x, progresso: p, estado: p >= 1 ? 'Pronta · Cortes a revisar' : x.estado }
    })), 600)
    return () => clearInterval(id)
  }, [])

  const url = /^https?:\/\/\S+\.\S+/i.test(valor.trim())
  const tipo = !valor.trim() ? null : arquivo ? 'Arquivo local' : url ? 'URL, baixa com yt-dlp' : 'URL incompleta'
  const pode = !!valor.trim() && tipo !== 'URL incompleta'

  const importar = () => {
    if (!pode) { campo.current?.focus(); return toast(valor.trim() ? 'Cole um endereço completo, começando com https://' : 'Cole uma URL ou solte um arquivo primeiro') }
    const nome = arquivo ? valor : valor.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)
    setItens(xs => [{ nome, projeto: PROJETOS[proj].nome, dur: 0, estado: arquivo ? 'Lendo arquivo' : 'Baixando', progresso: 0.02, img: 'img/fonte-4.jpg' }, ...xs])
    setValor(''); setArquivo(false)
    toast('Fonte adicionada à fila', { description: `${PROJETOS[proj].nome}${PERMISSOES[perm].id === 'sem' ? ', sem permissão registrada' : ''}` })
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

  useComandosTela([
    { id: 'colar', grupo: 'Importar', rotulo: 'Colar URL', tecla: ['Ctrl', 'V'], palavras: ['youtube', 'yt-dlp', 'link'], acao: colar },
    { id: 'arq', grupo: 'Importar', rotulo: 'Escolher arquivo de vídeo', tecla: ['Ctrl', 'O'], palavras: ['mp4', 'local'], acao: () => seletor.current?.click() },
    { id: 'imp', grupo: 'Importar', rotulo: 'Importar Fonte', tecla: ['Enter'], acao: importar },
    ...PERMISSOES.map((p, i) => ({ id: 'perm-' + p.id, grupo: 'Importar', rotulo: `Permissão: ${p.rotulo}`, palavras: ['termos', 'youtube'], acao: () => setPerm(i) })),
    ...PROJETOS.map((p, i) => ({ id: 'proj-' + i, grupo: 'Importar', rotulo: `Projeto: ${p.nome}`, dica: `Perfil de canal ${p.perfil}`, palavras: ['canal', 'perfil'], acao: () => setProj(i) })),
  ])

  const p = PROJETOS[proj]
  return (
    <>
      <Topo migalhas={[{ rotulo: p.nome }, { rotulo: 'Importar Fonte' }]} />
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-[640px] max-w-[calc(100%-32px)] pt-[8vh] pb-24">
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
            className={`rounded-[10px] border bg-[var(--e-s1)] transition-colors ${sobre ? 'border-[var(--e-tx2)] bg-[var(--e-s2)]' : 'border-[var(--e-ln2)] focus-within:border-[var(--e-tx3)]'}`}>
            <div className="flex items-center gap-3 px-5 h-[68px]">
              <input ref={campo} value={valor}
                onChange={e => { setValor(e.target.value); setArquivo(false) }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); importar() } if (e.key === 'Escape') campo.current?.blur() }}
                aria-label="URL ou arquivo da Fonte" aria-invalid={tipo === 'URL incompleta'}
                placeholder={sobre ? 'Solte para usar este arquivo' : 'Cole uma URL ou solte um arquivo'}
                className="flex-1 min-w-0 bg-transparent outline-none text-[19px] tracking-[-0.01em] text-[var(--e-tx)] placeholder:text-[var(--e-tx3)]" />
              {tipo && <span className={`shrink-0 text-[11.5px] ${tipo === 'URL incompleta' ? 'text-[var(--e-tx)] underline decoration-dotted underline-offset-2' : 'text-[var(--e-tx3)]'}`}>{tipo}</span>}
            </div>
            <div className="flex items-center gap-4 px-5 h-10 border-t border-[var(--e-ln)] text-[12px] text-[var(--e-tx3)]">
              <span className="flex items-center gap-1.5"><Kbd k={['Ctrl', 'V']} /> colar URL</span>
              <button onClick={() => seletor.current?.click()} className={`flex items-center gap-1.5 hover:text-[var(--e-tx)] rounded-[3px] ${foco}`}><Kbd k={['Ctrl', 'O']} /> escolher arquivo</button>
              <span className="flex-1" />
              <span>YouTube, Twitch, MP4, MKV, MOV</span>
            </div>
            <input ref={seletor} type="file" accept="video/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) { setValor(f.name); setArquivo(true) } }} />
          </div>

          {/* Opções em linhas */}
          <div className="mt-4 rounded-[8px] border border-[var(--e-ln)] divide-y divide-[var(--e-ln)]">
            <Opcao rotulo="Permissão" tecla="P" onClick={proximaPerm} valor={PERMISSOES[perm].rotulo} />
            <div>
              <Opcao rotulo="Projeto" tecla="J" onClick={() => setAbrirProj(v => !v)} aberto={abrirProj}
                valor={<>{p.nome}<span className="ml-2.5 text-[var(--e-tx3)]">Perfil de canal {p.perfil}</span></>} />
              {abrirProj && (
                <div role="listbox" aria-label="Projeto" className="p-1 border-t border-[var(--e-ln)] bg-[var(--e-bg)]">
                  {PROJETOS.map((x, i) => (
                    <button key={x.nome} role="option" aria-selected={i === proj} onClick={() => { setProj(i); setAbrirProj(false) }}
                      className={`w-full h-9 flex items-center gap-3 px-3 rounded-[6px] text-left ${i === proj ? 'bg-[var(--e-s3)]' : 'hover:bg-[var(--e-s2)]'} ${foco}`}>
                      <span className="w-4 text-[var(--e-tx)]">{i === proj && <Check size={13} />}</span>
                      <span className="flex-1">{x.nome}</span>
                      <span className="text-[12px] text-[var(--e-tx3)]">{x.detalhe}</span>
                      <Kbd k={[String(i + 1)]} />
                    </button>
                  ))}
                  <p className="px-3 py-2 text-[12px] text-[var(--e-tx3)]">Um Projeto por canal. O Perfil de canal define voz, Narração e Empacotamento dos Cortes.</p>
                </div>
              )}
            </div>
          </div>
          {PERMISSOES[perm].id === 'sem' && (
            <p className="mt-2.5 flex gap-2 px-1 text-[12px] leading-[1.5] text-[var(--e-tx3)]">
              <Info size={13} className="mt-[2px] shrink-0" />
              Sem permissão do criador, publicar Cortes deste vídeo pode violar os Termos do YouTube. A escolha fica registrada no Projeto.
            </p>
          )}

          <div className="mt-5 flex items-center justify-end gap-4">
            <span className="text-[12px] text-[var(--e-tx3)]">A Transcrição roda neste computador</span>
            <Principal tecla={['Enter']} onClick={importar} disabled={!pode}>Importar Fonte</Principal>
          </div>

          {/* Fila: linhas finas com progresso de 1 px */}
          <section className="mt-14" aria-label="Fila de Fontes">
            <div className="flex items-baseline justify-between mb-1 px-1">
              <h2 className="text-[12px] text-[var(--e-tx3)]">Fila de Fontes</h2>
              <span className="text-[11.5px] tabular text-[var(--e-tx3)]">{itens.filter(i => i.progresso < 1).length} em andamento</span>
            </div>
            <ul className="border-t border-[var(--e-ln)] text-[12.5px]">
              {itens.map((f, i) => {
                const pronta = f.progresso >= 1
                const Tag = pronta ? 'button' : 'div'
                return (
                  <li key={f.nome + i} className="relative border-b border-[var(--e-ln)]">
                    <Tag {...(pronta ? { onClick: () => irPara('cortes') } : {})}
                      className={`group w-full h-12 grid grid-cols-[40px_minmax(0,1fr)_64px_minmax(0,150px)_44px] items-center gap-4 px-1 text-left ${pronta ? `hover:bg-[var(--e-s1)] cursor-pointer ${foco}` : ''}`}>
                      <img src={img(f.img)} alt="" className={`w-10 h-[22px] rounded-[2px] object-cover bg-[var(--e-s3)] ${pronta ? '' : 'opacity-70'}`} />
                      <span className="min-w-0">
                        <span className="block truncate text-[var(--e-tx)]">{f.nome}</span>
                        <span className="block truncate text-[11.5px] text-[var(--e-tx3)]">{f.projeto}</span>
                      </span>
                      <span className="text-right font-mono tabular text-[11.5px] text-[var(--e-tx3)]">{f.dur ? tc(f.dur) : '–'}</span>
                      <span className={`truncate ${pronta ? 'text-[var(--e-tx)]' : 'text-[var(--e-tx2)]'}`}>{f.estado.replace(' · ', ', ')}</span>
                      <span className="text-right font-mono tabular text-[11.5px] text-[var(--e-tx3)]">
                        {pronta ? <><span className="group-hover:hidden">100%</span><span className="hidden group-hover:inline text-[var(--e-tx)]">abrir</span></> : `${Math.floor(f.progresso * 100)}%`}
                      </span>
                    </Tag>
                    <span className={`absolute left-0 -bottom-px h-px ${pronta ? 'bg-[var(--e-tx3)]' : 'bg-[var(--e-tx)]'}`} style={{ width: `${f.progresso * 100}%` }}
                      role="progressbar" aria-valuenow={Math.round(f.progresso * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Progresso de ${f.nome}`} />
                  </li>
                )
              })}
            </ul>
          </section>
        </div>
      </main>
    </>
  )
}

function Opcao({ rotulo, valor, tecla, onClick, aberto }: { rotulo: string; valor: ReactNode; tecla: string; onClick: () => void; aberto?: boolean }) {
  return (
    <button onClick={onClick} aria-expanded={aberto}
      className={`w-full h-10 flex items-center gap-4 px-4 text-left text-[var(--e-tx)] hover:bg-[var(--e-s1)] first:rounded-t-[8px] ${foco}`}>
      <span className="w-20 text-[var(--e-tx3)]">{rotulo}</span>
      <span className="flex-1 min-w-0 truncate">{valor}</span>
      {aberto != null && <ChevronDown size={14} className={`text-[var(--e-tx3)] transition-transform ${aberto ? 'rotate-180' : ''}`} />}
      <Kbd k={[tecla]} />
    </button>
  )
}
