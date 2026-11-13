// Etapa 1: importar uma Fonte. Um passo de cada vez: origem, depois Permissão e Projeto.
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, ListVideo, TriangleAlert, Upload } from 'lucide-react'
import { fila, fonte, img, tc } from '../../dados'
import type { Tela } from '../../App'
import { Botao, Topo, foco } from './comum'

type Origem = { tipo: 'arquivo' | 'url'; nome: string }
type Permissao = 'criador' | 'autorizado' | 'sem'
const PROJETOS = [
  { nome: 'Canal dark · Ficção', perfil: 'Ficção narrada', resumo: 'Cortes de 20 a 60 s, legenda Impacto, Narração desligada' },
  { nome: 'Canal de cortes', perfil: 'Reações e podcast', resumo: 'Cortes de 30 a 90 s, legenda Clássico, Narração desligada' },
]

export function Importar({ irPara }: { irPara: (t: Tela) => void }) {
  const [origem, setOrigem] = useState<Origem | null>(null)
  const [enviado, setEnviado] = useState(false)
  const [url, setUrl] = useState('')
  const [sobre, setSobre] = useState(false)
  const [perm, setPerm] = useState<Permissao>('criador')
  const [autor, setAutor] = useState('')
  const [projeto, setProjeto] = useState(0)
  const arquivo = useRef<HTMLInputElement>(null)
  const naFila = fila.filter(f => f.progresso < 1).length + (enviado ? 1 : 0)

  const escolher = (o: Origem) => { setOrigem(o); setEnviado(false); setPerm(o.tipo === 'arquivo' ? 'criador' : 'autorizado') }
  const reiniciar = () => { setOrigem(null); setEnviado(false); setUrl('') }

  return (
    <>
      <Topo etapa={0} irPara={irPara} direita={<Fila naFila={naFila} extra={enviado && origem ? origem.nome : null} irPara={irPara} />} />

      <main className="flex-1 min-h-0 overflow-y-auto px-6 pb-[72px]">
        <div className="min-h-full flex flex-col items-center justify-center py-8">
          <div className="w-full max-w-[600px]">
            {!origem && (
              <>
                <h1 className="font-geist text-[34px] leading-[1.1] font-semibold tracking-[-0.025em]">De onde vem a Fonte?</h1>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--tx-2)] max-w-[52ch]">Um vídeo longo, como uma live gravada. A Transcrição roda neste computador, e o Provedor só recebe o texto.</p>

                <button onClick={() => arquivo.current?.click()}
                  onDragOver={e => { e.preventDefault(); setSobre(true) }} onDragLeave={() => setSobre(false)}
                  onDrop={e => { e.preventDefault(); setSobre(false); const f = e.dataTransfer.files[0]; escolher({ tipo: 'arquivo', nome: f?.name ?? 'video.mp4' }) }}
                  className={`mt-9 w-full h-[248px] rounded-[20px] border border-dashed flex flex-col items-center justify-center gap-4 transition-colors ${foco}
                    ${sobre ? 'border-[var(--tx-2)] bg-[var(--surface)]' : 'border-[var(--line-2)] bg-[var(--raised)] hover:bg-[var(--surface)]'}`}>
                  <span className="grid place-items-center size-14 rounded-full bg-[var(--surface)] text-[var(--tx)]"><Upload size={22} strokeWidth={1.75} /></span>
                  <span className="text-center">
                    <span className="block font-geist text-[19px] font-medium tracking-[-0.01em]">Soltar arquivo de vídeo</span>
                    <span className="block mt-1 text-[13px] text-[var(--tx-3)]">ou clique para escolher. MP4, MKV, MOV ou WEBM.</span>
                  </span>
                </button>
                <input ref={arquivo} type="file" accept="video/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) escolher({ tipo: 'arquivo', nome: f.name }) }} />

                <form className="mt-4 flex gap-2" onSubmit={e => { e.preventDefault(); if (url.trim()) escolher({ tipo: 'url', nome: url.trim() }) }}>
                  <label htmlFor="c-url" className="sr-only">URL do vídeo</label>
                  <input id="c-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="Ou cole a URL de uma live ou vídeo"
                    className={`flex-1 min-w-0 h-12 rounded-[12px] bg-[var(--raised)] border border-[var(--line)] px-4 text-[14px] placeholder:text-[var(--tx-3)] focus:border-[var(--line-2)] ${foco}`} />
                  <Botao tipo="primario" tamanho="lg" type="submit" disabled={!url.trim()}>Continuar</Botao>
                </form>
                <button onClick={() => escolher({ tipo: 'arquivo', nome: 'tears-of-steel-x10.mp4' })}
                  className={`mt-5 text-[13px] text-[var(--tx-3)] underline underline-offset-4 decoration-[var(--line-2)] hover:text-[var(--tx-2)] rounded ${foco}`}>
                  Usar a Fonte de exemplo
                </button>
              </>
            )}

            {origem && !enviado && (
              <>
                <button onClick={reiniciar} className={`-ml-2 mb-6 inline-flex items-center gap-1.5 rounded-lg px-2 h-8 text-[13px] text-[var(--tx-3)] hover:text-[var(--tx)] hover:bg-[var(--hover)] ${foco}`}>
                  <ArrowLeft size={15} /> Outra Fonte
                </button>
                <h1 className="font-geist text-[30px] leading-[1.1] font-semibold tracking-[-0.025em]">Confirme antes de transcrever</h1>

                <div className="mt-7 rounded-[20px] bg-[var(--raised)] border border-[var(--line)]">
                  <div className="flex gap-4 p-5">
                    <img src={img('img/fonte-4.jpg')} alt="" className="w-[148px] aspect-video rounded-[10px] object-cover" />
                    <div className="min-w-0 pt-0.5">
                      <p className="text-[15px] text-[var(--tx)] truncate">{origem.tipo === 'url' ? fonte.nome : origem.nome}</p>
                      <p className="mt-1 text-[13px] text-[var(--tx-3)] tabular">
                        <span className="font-mono text-[var(--tx-2)]">{tc(fonte.duracao)}</span>, {fonte.largura}×{fonte.altura}, {fonte.fps} fps
                      </p>
                      <p className="mt-1 text-[13px] text-[var(--tx-3)] truncate">{origem.tipo === 'url' ? `Baixada de ${origem.nome}` : 'Arquivo local'}</p>
                    </div>
                  </div>

                  <fieldset className="border-t border-[var(--line)] px-5 pt-4 pb-5">
                    <legend className="sr-only">Permissão</legend>
                    <p className="text-[14px] text-[var(--tx)]">Permissão</p>
                    <div role="radiogroup" className="mt-3 grid grid-cols-3 gap-2">
                      {([['criador', 'Sou o criador'], ['autorizado', 'Tenho permissão'], ['sem', 'Sem permissão']] as const).map(([id, nome]) => (
                        <button key={id} role="radio" aria-checked={perm === id} onClick={() => setPerm(id)}
                          className={`h-10 rounded-[10px] text-[13px] border transition-colors ${foco}
                            ${perm === id ? 'border-[var(--tx-2)] bg-[var(--surface)] text-[var(--tx)]' : 'border-[var(--line)] text-[var(--tx-2)] hover:bg-[var(--hover)]'}`}>
                          {nome}
                        </button>
                      ))}
                    </div>
                    {perm === 'autorizado' && (
                      <input value={autor} onChange={e => setAutor(e.target.value)} aria-label="Quem autorizou" placeholder="Quem autorizou, por exemplo o nome do canal (opcional)"
                        className={`mt-3 w-full h-10 rounded-[10px] bg-[var(--bg)] border border-[var(--line)] px-3 text-[13px] placeholder:text-[var(--tx-3)] ${foco}`} />
                    )}
                    {perm === 'sem' && (
                      <p className="mt-3 flex gap-2 text-[13px] leading-snug text-[var(--tx-3)]">
                        <TriangleAlert size={14} className="shrink-0 mt-0.5" />
                        Publicar Cortes de vídeos de terceiros sem permissão pode violar os Termos do YouTube. A escolha fica registrada no Projeto.
                      </p>
                    )}
                  </fieldset>

                  <div className="border-t border-[var(--line)] px-5 pt-4 pb-5">
                    <label htmlFor="c-projeto" className="text-[14px] text-[var(--tx)]">Projeto</label>
                    <div className="relative mt-3">
                      <select id="c-projeto" value={projeto} onChange={e => setProjeto(+e.target.value)}
                        className={`appearance-none w-full h-10 rounded-[10px] bg-[var(--bg)] border border-[var(--line)] pl-3 pr-9 text-[14px] text-[var(--tx)] ${foco}`}>
                        {PROJETOS.map((p, i) => <option key={p.nome} value={i}>{p.nome}</option>)}
                      </select>
                      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--tx-3)]" />
                    </div>
                    <p className="mt-2.5 text-[13px] leading-snug text-[var(--tx-3)]">
                      Perfil de canal <span className="text-[var(--tx-2)]">{PROJETOS[projeto].perfil}</span>: {PROJETOS[projeto].resumo}.
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <Botao tipo="primario" tamanho="lg" onClick={() => setEnviado(true)}>Transcrever Fonte</Botao>
                </div>
              </>
            )}

            {origem && enviado && (
              <div className="text-center flex flex-col items-center">
                <span className="grid place-items-center size-12 rounded-full bg-[var(--surface)] text-[var(--tx)]"><Check size={20} /></span>
                <h1 className="mt-6 font-geist text-[30px] leading-[1.1] font-semibold tracking-[-0.025em]">Na fila para transcrever</h1>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--tx-2)] max-w-[46ch]">
                  A Fonte entrou em {PROJETOS[projeto].nome}. A Transcrição começa quando a Live #212 terminar, e os Cortes aparecem em Revisar.
                </p>
                <div className="mt-8 flex gap-2">
                  <Botao tamanho="lg" onClick={reiniciar}>Importar outra Fonte</Botao>
                  <Botao tipo="primario" tamanho="lg" onClick={() => irPara('cortes')}>Revisar Cortes prontos</Botao>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  )
}

/** A fila de Fontes, recolhida no canto. */
function Fila({ naFila, extra, irPara }: { naFila: number; extra: string | null; irPara: (t: Tela) => void }) {
  const [aberta, setAberta] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberta) return
    const fora = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberta(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberta(false) }
    addEventListener('mousedown', fora); addEventListener('keydown', esc)
    return () => { removeEventListener('mousedown', fora); removeEventListener('keydown', esc) }
  }, [aberta])
  const itens = [...fila, ...(extra ? [{ nome: 'Tears of Steel ×10', projeto: '', dur: fonte.duracao, estado: 'Na fila', progresso: 0, img: 'img/fonte-4.jpg' }] : [])]
  return (
    <div ref={raiz} className="relative">
      <button onClick={() => setAberta(!aberta)} aria-expanded={aberta}
        className={`inline-flex items-center gap-2 h-8 px-3 rounded-full text-[13px] tabular transition-colors ${foco}
          ${aberta ? 'bg-[var(--surface)] text-[var(--tx)]' : 'text-[var(--tx-2)] hover:text-[var(--tx)] hover:bg-[var(--raised)]'}`}>
        <ListVideo size={15} /> {naFila} na fila
        <ChevronDown size={14} className={`transition-transform ${aberta ? 'rotate-180' : ''}`} />
      </button>
      {aberta && (
        <div className="absolute right-0 top-10 z-30 w-[360px] rounded-[16px] bg-[var(--raised)] border border-[var(--line)] p-2 shadow-[0_16px_40px_rgba(0,0,0,.45)]">
          <ul>
            {itens.map(f => {
              const pronta = f.progresso >= 1
              return (
                <li key={f.nome} className="flex items-center gap-3 rounded-[10px] p-2">
                  <img src={img(f.img)} alt="" className="w-[64px] aspect-video rounded-[6px] object-cover" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-[var(--tx)] truncate">{f.nome}</p>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[12px] text-[var(--tx-3)] tabular">
                      <span className="truncate">{f.estado}</span>
                      <span className="font-mono shrink-0">{tc(f.dur)}</span>
                    </div>
                    {!pronta && (
                      <div className="mt-1.5 h-[3px] rounded-full bg-[var(--line)]">
                        <div className="h-full rounded-full bg-[var(--tx-2)]" style={{ width: `${f.progresso * 100}%` }} />
                      </div>
                    )}
                  </div>
                  {pronta && <Botao tipo="fantasma" className="h-8 px-2.5" onClick={() => irPara('cortes')}>Revisar</Botao>}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
