// Variante F, "Foco": importar é uma coluna só. Um campo para a Fonte; Projeto e Permissão aparecem como
// linhas resumidas com o valor atual e só se abrem quando você vai decidir. A fila fica embaixo, quieta.
import { useState, type ReactNode } from 'react'
import { ChevronDown, FileVideo, Link2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { fila, img, tc } from '../../dados'
import type { PropsVariante } from '../../App'
import { Botao, Kbd, foco } from '../nucleo/base'
import { GatilhoPaleta, Paleta, useAtalhos, type Cmd } from '../nucleo/Paleta'
import { TopoF } from './comum'

const PROJETOS = [
  { id: 'ficcao', nome: 'Canal dark · Ficção', perfil: 'Ficção sombria, legenda Impacto, Narração PT-BR' },
  { id: 'cortes', nome: 'Canal de cortes', perfil: 'Reações e podcast, legenda Clássico' },
]
const PERMISSOES = [
  { id: 'meu', nome: 'O vídeo é meu' },
  { id: 'autorizado', nome: 'Tenho permissão do criador' },
  { id: 'sem', nome: 'Sem permissão' },
] as const
type Perm = (typeof PERMISSOES)[number]['id'] | null

export default function ImportarF({ tela, irPara }: PropsVariante) {
  const [fonte, setFonte] = useState('')
  const [projeto, setProjeto] = useState(PROJETOS[0])
  const [perm, setPerm] = useState<Perm>(null)
  const [nota, setNota] = useState('')
  const [aberta, setAberta] = useState<'projeto' | 'perm' | null>(null)
  const pronto = fonte.trim().length > 0 && perm !== null

  const escolherArquivo = () => { setFonte('live-213-reagindo-a-trailers.mp4'); setAberta('perm') }
  const adicionar = () => {
    if (!pronto) return toast(fonte ? 'Registre a Permissão antes de adicionar.' : 'Escolha um arquivo ou cole uma URL.', { duration: 1800 })
    toast('Fonte adicionada à fila', { description: `${projeto.nome} · a Transcrição começa quando a atual terminar` })
    setFonte(''); setPerm(null); setNota('')
  }

  useAtalhos(ev => {
    const l = ev.key.toLowerCase()
    if ((ev.ctrlKey || ev.metaKey) && l === 'o') { ev.preventDefault(); return escolherArquivo() }
    if (ev.ctrlKey || ev.metaKey) return
    if (l === 'p') return setAberta(a => (a === 'projeto' ? null : 'projeto'))
    if (l === 'r') return setAberta(a => (a === 'perm' ? null : 'perm'))
    if (ev.key === 'Enter') return adicionar()
    if (ev.key === 'Escape') return setAberta(null)
  })

  const comandos: Cmd[] = [
    { id: 'arq', grupo: 'Importar', rotulo: 'Escolher arquivo de vídeo', tecla: ['Ctrl', 'O'], acao: escolherArquivo },
    { id: 'proj', grupo: 'Importar', rotulo: 'Trocar Projeto', tecla: ['P'], acao: () => setAberta('projeto') },
    { id: 'perm', grupo: 'Importar', rotulo: 'Registrar Permissão', tecla: ['R'], acao: () => setAberta('perm') },
    { id: 'add', grupo: 'Importar', rotulo: 'Adicionar à fila', tecla: ['Enter'], acao: adicionar },
  ]

  return (
    <div className="h-full flex flex-col">
      <TopoF tela={tela} irPara={irPara} direita={<GatilhoPaleta />} />
      <main className="flex-1 min-h-0 overflow-auto nu-rolagem">
        <div className="max-w-[620px] mx-auto px-6 pt-14 pb-24">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Nova Fonte</h1>
          <p className="mt-1.5 text-[13px] text-[var(--tx2)] [text-wrap:pretty]">Um vídeo deste computador ou a URL de uma live. A Transcrição roda aqui, sem enviar o áudio.</p>

          <div className="mt-7 flex items-center gap-2 h-12 pl-3.5 pr-1.5 rounded-[8px] border border-[var(--ln2)] bg-[var(--s1)] focus-within:border-[var(--tx3)] transition-colors duration-150">
            {fonte.endsWith('.mp4') ? <FileVideo size={16} className="text-[var(--tx3)] shrink-0" /> : <Link2 size={16} className="text-[var(--tx3)] shrink-0" />}
            <input value={fonte} onChange={ev => setFonte(ev.target.value)} onKeyDown={ev => { if (ev.key === 'Enter') adicionar() }}
              placeholder="Cole a URL de uma live ou solte um arquivo aqui" aria-label="URL ou arquivo da Fonte"
              className="flex-1 min-w-0 h-full bg-transparent outline-none text-[14px] placeholder:text-[var(--tx3)]" />
            <Botao tamanho="p" tecla={['Ctrl', 'O']} onClick={escolherArquivo}>Arquivo</Botao>
          </div>
          <p className="mt-2 text-[12px] text-[var(--tx3)]">MP4, MKV, MOV ou WEBM, de qualquer duração. URLs passam pelo yt-dlp.</p>

          <div className="mt-6 border-y border-[var(--ln)] divide-y divide-[var(--ln)]">
            <Linha rotulo="Projeto" tecla="P" aberta={aberta === 'projeto'} onAlternar={() => setAberta(a => (a === 'projeto' ? null : 'projeto'))}
              valor={<><span className="text-[var(--tx)]">{projeto.nome}</span><span className="text-[var(--tx3)] truncate"> · {projeto.perfil}</span></>}>
              <ul role="radiogroup" aria-label="Projeto" className="flex flex-col gap-0.5">
                {PROJETOS.map(p => (
                  <li key={p.id}>
                    <button role="radio" aria-checked={projeto.id === p.id} onClick={() => { setProjeto(p); setAberta(null) }}
                      className={`w-full text-left px-3 py-2 rounded-[6px] ${foco} ${projeto.id === p.id ? 'bg-[var(--s3)]' : 'hover:bg-[var(--s2)]'}`}>
                      <span className="block text-[13px]">{p.nome}</span>
                      <span className="block text-[12px] text-[var(--tx3)] mt-0.5">Perfil de canal: {p.perfil}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Linha>
            <Linha rotulo="Permissão" tecla="R" aberta={aberta === 'perm'} onAlternar={() => setAberta(a => (a === 'perm' ? null : 'perm'))}
              valor={perm ? <span className="text-[var(--tx)]">{PERMISSOES.find(p => p.id === perm)!.nome}</span> : <span className="text-[var(--tx2)]">Ainda não registrada</span>}>
              <div role="radiogroup" aria-label="Permissão do criador" className="flex gap-1.5">
                {PERMISSOES.map(p => (
                  <button key={p.id} role="radio" aria-checked={perm === p.id} onClick={() => setPerm(p.id)}
                    className={`h-8 px-3 rounded-[6px] text-[13px] border transition-colors duration-150 ${foco} ${perm === p.id ? 'border-[var(--tx2)] bg-[var(--s3)] text-[var(--tx)]' : 'border-[var(--ln2)] text-[var(--tx2)] hover:text-[var(--tx)]'}`}>{p.nome}</button>
                ))}
              </div>
              {perm === 'autorizado' && (
                <input value={nota} onChange={ev => setNota(ev.target.value)} placeholder="Link ou nota da autorização" aria-label="Link ou nota da autorização"
                  className={`mt-3 w-full h-8 px-3 rounded-[6px] bg-[var(--bg)] border border-[var(--ln2)] text-[13px] placeholder:text-[var(--tx3)] ${foco}`} />
              )}
              {perm === 'sem' && (
                <p className="mt-3 flex gap-2 text-[12px] leading-[1.5] text-[var(--tx2)]">
                  <TriangleAlert size={14} className="shrink-0 mt-[2px] text-[var(--acc)]" />
                  Sem permissão, publicar Cortes pode violar os Termos do YouTube e gerar reivindicação. O Clipes registra a escolha no Projeto.
                </p>
              )}
            </Linha>
          </div>

          <div className="mt-5 flex items-center justify-between gap-4">
            <p className="text-[12px] text-[var(--tx3)] tabular-nums">Provedor: ≈ US$ 0,02 por hora de Fonte · teto US$ 1,00</p>
            <Botao tipo="primario" tecla={['Enter']} onClick={adicionar} disabled={!fonte}>Adicionar à fila</Botao>
          </div>

          <section className="mt-14" aria-labelledby="f-fila">
            <div className="flex items-baseline justify-between mb-2">
              <h2 id="f-fila" className="text-[15px] font-medium">Fila</h2>
              <span className="text-[12px] text-[var(--tx3)] tabular-nums">{fila.length} Fontes, uma de cada vez</span>
            </div>
            <ul className="divide-y divide-[var(--ln)]">
              {fila.map(f => {
                const pronta = f.progresso >= 1
                return (
                  <li key={f.nome} className="flex items-center gap-3.5 py-3">
                    <img src={img(f.img)} alt="" className="w-[64px] h-[36px] rounded-[4px] object-cover shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[13px] truncate">{f.nome}</span>
                        <span className={`text-[12px] shrink-0 tabular-nums ${pronta ? 'text-[var(--tx)]' : 'text-[var(--tx2)]'}`}>
                          {f.estado}{f.progresso > 0 && !pronta && ` · ${Math.round(f.progresso * 100)}%`}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3">
                        <span className="text-[12px] text-[var(--tx3)] shrink-0">{f.projeto} · <span className="font-mono tabular-nums">{tc(f.dur)}</span></span>
                        <span className="flex-1 h-[2px] rounded-full bg-[var(--s3)] overflow-hidden">
                          <span className={`block h-full rounded-full ${pronta ? 'bg-[var(--tx2)]' : 'bg-[var(--acc)]'}`} style={{ width: `${f.progresso * 100}%` }} />
                        </span>
                      </div>
                    </div>
                    {pronta
                      ? <Botao tamanho="p" onClick={() => irPara('cortes')}>Ver Cortes</Botao>
                      : <Botao tamanho="p" tipo="fantasma" onClick={() => toast(`“${f.nome}” saiu da fila`)}>Cancelar</Botao>}
                  </li>
                )
              })}
            </ul>
          </section>
        </div>
      </main>
      <Paleta comandos={comandos} tela={tela} irPara={irPara} />
    </div>
  )
}

function Linha({ rotulo, tecla, valor, aberta, onAlternar, children }: { rotulo: string; tecla: string; valor: ReactNode; aberta: boolean; onAlternar: () => void; children: ReactNode }) {
  return (
    <div>
      <button onClick={onAlternar} aria-expanded={aberta} className={`w-full h-12 flex items-center gap-4 text-left text-[13px] ${foco}`}>
        <span className="w-[76px] shrink-0 text-[var(--tx3)]">{rotulo}</span>
        <span className="flex-1 min-w-0 truncate">{valor}</span>
        <Kbd k={[tecla]} />
        <ChevronDown size={14} className={`text-[var(--tx3)] transition-transform duration-200 ${aberta ? 'rotate-180' : ''}`} />
      </button>
      <div className="f-acordeao grid" data-aberta={aberta}>
        <div className="overflow-hidden" inert={!aberta}>
          <div className="pl-[92px] pb-4">{children}</div>
        </div>
      </div>
      <style>{`
        .f-acordeao{grid-template-rows:0fr;transition:grid-template-rows .22s cubic-bezier(.22,1,.36,1)}
        .f-acordeao[data-aberta=true]{grid-template-rows:1fr}
        @media (prefers-reduced-motion: reduce){.f-acordeao{transition:none}}
      `}</style>
    </div>
  )
}
