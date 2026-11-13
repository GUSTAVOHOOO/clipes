// Importar Fonte, como um formulário de uma pergunta por vez.
import { useState, type ReactNode } from 'react'
import { FileVideo, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { fila as filaInicial, img, tc } from '../../dados'
import type { Tela } from '../../App'

type Origem = { tipo: 'arquivo' | 'url'; valor: string; dur?: number }
type Permissao = 'autorizado' | 'criador' | 'sem'
type ItemFila = (typeof filaInicial)[number]

const PROJETOS = [
  { id: 'cortes', nome: 'Canal de cortes', perfil: 'Reação e bate-papo, 30 a 60 s, legenda Clássico' },
  { id: 'dark', nome: 'Canal dark · Ficção', perfil: 'Ficção narrada, 45 a 90 s, Narração grave' },
]

const PERMISSOES: { id: Permissao; titulo: string; detalhe: string }[] = [
  { id: 'autorizado', titulo: 'Sim, tenho permissão do criador', detalhe: 'Fica registrada no Projeto, junto com a Fonte.' },
  { id: 'criador', titulo: 'Eu sou o criador', detalhe: 'O conteúdo é seu. Nada mais a registrar.' },
  { id: 'sem', titulo: 'Não tenho permissão', detalhe: 'Dá para seguir, mas fica marcado.' },
]

export default function Importar({ irPara }: { irPara: (t: Tela) => void }) {
  const [passo, setPasso] = useState(0)
  const [origem, setOrigem] = useState<Origem | null>(null)
  const [url, setUrl] = useState('')
  const [permissao, setPermissao] = useState<Permissao | null>(null)
  const [registro, setRegistro] = useState('')
  const [projeto, setProjeto] = useState('cortes')
  const [novoProjeto, setNovoProjeto] = useState('')
  const [fila, setFila] = useState<ItemFila[]>(filaInicial)

  const escolherArquivo = () => {
    setOrigem({ tipo: 'arquivo', valor: 'live-213-bate-papo.mp4', dur: 2 * 3600 + 41 * 60 + 10 })
    setUrl('')
  }
  const urlValida = /^https?:\/\/\S+\.\S+/.test(url.trim())
  const confirmarOrigem = () => {
    if (urlValida && origem?.tipo !== 'arquivo') setOrigem({ tipo: 'url', valor: url.trim() })
    setPasso(1)
  }
  const nomeProjeto = projeto === 'novo' ? novoProjeto.trim() || 'Novo Projeto' : PROJETOS.find(p => p.id === projeto)!.nome

  const adicionar = () => {
    if (!origem) return
    const nome = origem.tipo === 'arquivo' ? origem.valor.replace(/\.\w+$/, '') : origem.valor.replace(/^https?:\/\/(www\.)?/, '')
    setFila(f => [{ nome, projeto: nomeProjeto, dur: origem.dur ?? 3600 + 18 * 60, estado: 'Na fila', progresso: 0, img: 'img/fonte-4.jpg' }, ...f])
    toast(`Fonte adicionada à fila de ${nomeProjeto}`)
    setPasso(0); setOrigem(null); setUrl(''); setPermissao(null); setRegistro('')
  }

  const podeSeguir0 = origem?.tipo === 'arquivo' || urlValida

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[620px] px-6 pt-12 pb-28">
        <header className="mb-12">
          <p className="text-[14px] text-[var(--mute)]">Nova Fonte</p>
          <h1 className="mt-1 text-[32px] leading-[1.15] font-semibold tracking-[-0.02em]">Três perguntas e a Fonte entra na fila.</h1>
        </header>

        <ol className="space-y-2">
          <Pergunta n={1} titulo="De onde vem a Fonte?" ativa={passo === 0} feita={passo > 0}
            resumo={origem && (origem.tipo === 'arquivo' ? origem.valor : origem.valor)} onAlterar={() => setPasso(0)}>
            <div className="space-y-3">
              <button type="button" onClick={escolherArquivo}
                className={`w-full flex items-center gap-4 rounded-xl border px-5 py-4 text-left transition-colors ${origem?.tipo === 'arquivo' ? 'border-[var(--ink)] bg-[var(--sheet)]' : 'border-[var(--rule-2)] hover:border-[var(--faint)] bg-[var(--sheet)]'}`}>
                <FileVideo size={20} strokeWidth={1.6} className="text-[var(--ink-2)] shrink-0" />
                <span className="flex-1">
                  <span className="block text-[16px] font-medium">{origem?.tipo === 'arquivo' ? origem.valor : 'Escolher um arquivo no computador'}</span>
                  <span className="block text-[14px] text-[var(--mute)]">{origem?.tipo === 'arquivo' ? `${tc(origem.dur!)} de duração` : 'MP4, MKV, MOV ou WEBM. A transcrição roda nesta máquina.'}</span>
                </span>
              </button>
              <div className="flex items-center gap-3 text-[13px] text-[var(--mute)]"><span className="h-px flex-1 bg-[var(--rule)]" />ou<span className="h-px flex-1 bg-[var(--rule)]" /></div>
              <label className={`flex items-center gap-4 rounded-xl border bg-[var(--sheet)] px-5 py-3 focus-within:border-[var(--ink)] ${urlValida ? 'border-[var(--ink)]' : 'border-[var(--rule-2)]'}`}>
                <Link2 size={20} strokeWidth={1.6} className="text-[var(--ink-2)] shrink-0" />
                <span className="sr-only">Link da Fonte</span>
                <input value={url} onChange={e => { setUrl(e.target.value); if (origem?.tipo === 'arquivo') setOrigem(null) }}
                  onKeyDown={e => e.key === 'Enter' && podeSeguir0 && confirmarOrigem()}
                  placeholder="Cole o link da live ou do vídeo"
                  className="flex-1 bg-transparent py-1 text-[16px] outline-none placeholder:text-[var(--faint)] focus-visible:!outline-none" />
              </label>
              <p className="text-[13px] text-[var(--mute)] pl-1">Links do YouTube, Twitch e afins são baixados com yt-dlp.</p>
            </div>
            <Seguir disabled={!podeSeguir0} onClick={confirmarOrigem} />
          </Pergunta>

          <Pergunta n={2} titulo="O criador autorizou?" ativa={passo === 1} feita={passo > 1}
            resumo={permissao && PERMISSOES.find(p => p.id === permissao)!.titulo} onAlterar={() => setPasso(1)}>
            <div role="radiogroup" aria-label="Permissão do criador" className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
              {PERMISSOES.map(p => (
                <Opcao key={p.id} marcada={permissao === p.id} onClick={() => setPermissao(p.id)} titulo={p.titulo} detalhe={p.detalhe} />
              ))}
            </div>
            {permissao === 'autorizado' && (
              <label className="mt-5 block">
                <span className="text-[14px] text-[var(--ink-2)]">Onde está a autorização? <span className="text-[var(--mute)]">(opcional)</span></span>
                <input value={registro} onChange={e => setRegistro(e.target.value)} placeholder="Ex.: e-mail de 12/11, contrato no Drive"
                  className="mt-2 w-full rounded-lg border border-[var(--rule-2)] bg-[var(--sheet)] px-4 py-2.5 text-[15px] outline-none focus:border-[var(--ink)] placeholder:text-[var(--faint)]" />
              </label>
            )}
            {permissao === 'sem' && (
              <p className="mt-5 border-l-2 border-[var(--rule-2)] pl-4 text-[14px] leading-relaxed text-[var(--ink-2)]">
                Publicar Cortes de conteúdo de terceiros sem autorização pode violar os Termos do YouTube e render avisos de direitos autorais no canal. A Fonte fica marcada como “sem permissão” no Projeto.
              </p>
            )}
            <Seguir disabled={!permissao} onClick={() => setPasso(2)} />
          </Pergunta>

          <Pergunta n={3} titulo="Em qual Projeto?" ativa={passo === 2} feita={false} onAlterar={() => setPasso(2)}>
            <p className="-mt-2 mb-4 text-[14px] text-[var(--mute)]">Cada Projeto é um canal. O Perfil de canal define duração, legenda e Narração dos Cortes.</p>
            <div role="radiogroup" aria-label="Projeto" className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
              {PROJETOS.map(p => (
                <Opcao key={p.id} marcada={projeto === p.id} onClick={() => setProjeto(p.id)} titulo={p.nome}
                  detalhe={`Perfil de canal: ${p.perfil}`} extra={p.id === 'cortes' ? 'Último usado' : undefined} />
              ))}
              <Opcao marcada={projeto === 'novo'} onClick={() => setProjeto('novo')} titulo="Novo Projeto" detalhe="Cria um Projeto e um Perfil de canal vazio." />
            </div>
            {projeto === 'novo' && (
              <input autoFocus value={novoProjeto} onChange={e => setNovoProjeto(e.target.value)} placeholder="Nome do canal"
                aria-label="Nome do novo Projeto"
                className="mt-5 w-full rounded-lg border border-[var(--rule-2)] bg-[var(--sheet)] px-4 py-2.5 text-[15px] outline-none focus:border-[var(--ink)] placeholder:text-[var(--faint)]" />
            )}
            <div className="mt-8 flex items-center gap-5">
              <button type="button" onClick={adicionar}
                className="rounded-lg bg-[var(--ink)] px-5 py-2.5 text-[15px] font-medium text-[var(--paper)] hover:bg-[var(--ink-2)]">
                Adicionar à fila
              </button>
              <span className="text-[14px] text-[var(--mute)]">Transcrição local, depois o Provedor escolhe os Cortes.</span>
            </div>
          </Pergunta>
        </ol>

        <section className="mt-20" aria-labelledby="vb-fila">
          <h2 id="vb-fila" className="text-[15px] font-semibold">Fila de Fontes</h2>
          <ul className="mt-4 border-t border-[var(--rule)]">
            {fila.map((f, i) => {
              const pronta = f.progresso >= 1
              return (
                <li key={f.nome + i} className="border-b border-[var(--rule)] py-4">
                  <div className="flex items-center gap-4">
                    <img src={img(f.img)} alt="" className="h-[36px] w-[64px] rounded-[4px] object-cover bg-[var(--rule)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">{f.nome}</p>
                      <p className="text-[13px] text-[var(--mute)]">{f.projeto}, <span className="num">{tc(f.dur)}</span></p>
                    </div>
                    <div className="text-right">
                      {pronta ? (
                        <button type="button" onClick={() => irPara('cortes')} className="text-[14px] font-medium underline decoration-[var(--rule-2)] underline-offset-4 hover:decoration-[var(--ink)]">
                          {f.estado.replace('Pronta · ', 'Ver ')}
                        </button>
                      ) : (
                        <p className="text-[14px] text-[var(--ink-2)]">{f.estado}{f.progresso > 0 && <span className="num text-[var(--mute)]"> {Math.round(f.progresso * 100)}%</span>}</p>
                      )}
                    </div>
                  </div>
                  {!pronta && (
                    <div className="mt-3 ml-[80px] h-[2px] rounded-full bg-[var(--rule)]" role="progressbar" aria-valuenow={Math.round(f.progresso * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Progresso de ${f.nome}`}>
                      <div className="h-full rounded-full bg-[var(--ink)]" style={{ width: `${f.progresso * 100}%` }} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </div>
  )
}

function Pergunta({ n, titulo, ativa, feita, resumo, onAlterar, children }: {
  n: number; titulo: string; ativa: boolean; feita: boolean; resumo?: ReactNode; onAlterar: () => void; children: ReactNode
}) {
  if (ativa) return (
    <li className="pt-4 pb-10">
      <p className="num text-[13px] text-[var(--mute)]">{n} de 3</p>
      <h2 className="mt-1 mb-6 text-[24px] leading-tight font-semibold tracking-[-0.015em]">{titulo}</h2>
      {children}
    </li>
  )
  return (
    <li className="flex items-baseline gap-4 border-b border-[var(--rule)] py-3">
      <span className={`text-[16px] ${feita ? 'text-[var(--ink-2)]' : 'text-[var(--faint)]'}`}>{titulo}</span>
      {feita && <span className="min-w-0 flex-1 truncate text-[16px] font-medium">{resumo}</span>}
      {feita && <button type="button" onClick={onAlterar} className="text-[14px] text-[var(--mute)] underline underline-offset-4 decoration-[var(--rule-2)] hover:text-[var(--ink)]">Alterar</button>}
    </li>
  )
}

function Opcao({ marcada, onClick, titulo, detalhe, extra }: { marcada: boolean; onClick: () => void; titulo: string; detalhe: string; extra?: string }) {
  return (
    <button type="button" role="radio" aria-checked={marcada} onClick={onClick} className="group flex w-full items-start gap-4 py-4 text-left">
      <span className={`mt-[5px] grid h-[16px] w-[16px] shrink-0 place-items-center rounded-full border ${marcada ? 'border-[var(--ink)]' : 'border-[var(--rule-2)] group-hover:border-[var(--faint)]'}`}>
        {marcada && <span className="h-[8px] w-[8px] rounded-full bg-[var(--ink)]" />}
      </span>
      <span className="flex-1">
        <span className="block text-[16px] font-medium">{titulo}{extra && <span className="ml-2 text-[13px] font-normal text-[var(--mute)]">{extra}</span>}</span>
        <span className="block text-[14px] text-[var(--mute)]">{detalhe}</span>
      </span>
    </button>
  )
}

function Seguir({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className="mt-8 rounded-lg bg-[var(--ink)] px-5 py-2.5 text-[15px] font-medium text-[var(--paper)] hover:bg-[var(--ink-2)] disabled:cursor-not-allowed disabled:bg-[var(--rule-2)] disabled:text-[var(--mute)]">
      Continuar
    </button>
  )
}
