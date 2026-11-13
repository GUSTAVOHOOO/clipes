// Variante G, "Seleção": a mesma gramática do editor. À esquerda, a lista (Nova Fonte + fila);
// à direita, só as propriedades do item selecionado: o formulário da Nova Fonte ou o andamento de uma Fonte na fila.
import { useState } from 'react'
import { Check, Plus, TriangleAlert, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { fila, img, tc } from '../../dados'
import type { PropsVariante } from '../../App'
import { Botao, Kbd, clamp, foco } from '../nucleo/base'
import { Paleta, useAtalhos, type Cmd } from '../nucleo/Paleta'
import { Inspector, Prop, Secao, TopoG } from './comum'

const PROJETOS = [
  { id: 'ficcao', nome: 'Canal dark · Ficção', perfil: 'Ficção sombria · legenda Impacto · Narração PT-BR' },
  { id: 'cortes', nome: 'Canal de cortes', perfil: 'Reações e podcast · legenda Clássico' },
]
const PERMS = [
  { id: 'meu', nome: 'O vídeo é meu' },
  { id: 'autorizado', nome: 'Tenho permissão do criador' },
  { id: 'sem', nome: 'Sem permissão' },
]
const ETAPAS = ['Baixar', 'Transcrever', 'Selecionar Cortes', 'Pronta']
const etapaDe = (estado: string) => estado.startsWith('Pronta') ? 4 : estado === 'Selecionando Cortes' ? 2 : estado === 'Transcrevendo' ? 1 : 0

export default function ImportarG({ tela, irPara }: PropsVariante) {
  const [sel, setSel] = useState(-1) // -1 = Nova Fonte
  const [url, setUrl] = useState('')
  const [projeto, setProjeto] = useState(PROJETOS[0].id)
  const [perm, setPerm] = useState('autorizado')
  const [nota, setNota] = useState('')
  const adicionar = () => {
    if (!url.trim()) return toast('Escolha um arquivo ou cole uma URL.', { duration: 1800 })
    toast('Fonte adicionada à fila', { description: 'A Transcrição começa quando a atual terminar.' }); setUrl('')
  }

  useAtalhos(ev => {
    const k = ev.key, l = k.toLowerCase()
    if ((ev.ctrlKey || ev.metaKey) && l === 'o') { ev.preventDefault(); setSel(-1); return setUrl('live-213-reagindo-a-trailers.mp4') }
    if (ev.ctrlKey || ev.metaKey) return
    if (k === 'ArrowDown') { ev.preventDefault(); return setSel(i => clamp(i + 1, -1, fila.length - 1)) }
    if (k === 'ArrowUp') { ev.preventDefault(); return setSel(i => clamp(i - 1, -1, fila.length - 1)) }
    if (l === 'n' || k === 'Escape') return setSel(-1)
    if (k === 'Enter' && sel === -1) return adicionar()
    if (k === 'Enter' && sel >= 0 && fila[sel].progresso >= 1) return irPara('cortes')
  })

  const comandos: Cmd[] = [
    { id: 'nova', grupo: 'Importar', rotulo: 'Nova Fonte', tecla: ['N'], acao: () => setSel(-1) },
    { id: 'arq', grupo: 'Importar', rotulo: 'Escolher arquivo de vídeo', tecla: ['Ctrl', 'O'], acao: () => { setSel(-1); setUrl('live-213-reagindo-a-trailers.mp4') } },
    ...fila.map((f, i) => ({ id: 'f' + i, grupo: 'Fila', rotulo: f.nome, dica: f.estado, acao: () => setSel(i) })),
  ]

  const f = sel >= 0 ? fila[sel] : null
  return (
    <div className="h-full flex flex-col">
      <TopoG tela={tela} irPara={irPara} />
      <div className="flex-1 min-h-0 flex">
        <main className="flex-1 min-w-0 overflow-auto nu-rolagem">
          <div className="max-w-[860px] px-8 pt-8 pb-20">
            <div className="flex items-baseline justify-between">
              <h1 className="text-[18px] font-semibold tracking-[-0.01em]">Fontes</h1>
              <span className="flex items-center gap-3 text-[12px] text-[var(--tx3)]"><span className="flex items-center gap-1.5"><Kbd k={['↑', '↓']} /> selecionar</span><span className="flex items-center gap-1.5"><Kbd k={['N']} /> nova</span></span>
            </div>
            <ul className="mt-5 flex flex-col gap-1" role="listbox" aria-label="Fontes">
              <li role="option" aria-selected={sel === -1}>
                <button onClick={() => setSel(-1)} className={`w-full h-14 flex items-center gap-3.5 px-3 rounded-[8px] border border-dashed text-left transition-colors duration-150 ${foco} ${sel === -1 ? 'border-[var(--acc)] bg-[var(--acc-bg)]' : 'border-[var(--ln2)] hover:bg-[var(--s1)]'}`}>
                  <span className="w-[64px] h-[36px] rounded-[4px] grid place-items-center bg-[var(--s2)] text-[var(--tx2)]"><Plus size={16} /></span>
                  <span className="flex-1 text-[13.5px]">Nova Fonte <span className="text-[var(--tx3)]">· arquivo deste computador ou URL de uma live</span></span>
                </button>
              </li>
              {fila.map((x, i) => {
                const on = sel === i, pronta = x.progresso >= 1
                return (
                  <li key={x.nome} role="option" aria-selected={on}>
                    <button onClick={() => setSel(i)} className={`w-full flex items-center gap-3.5 px-3 py-2.5 rounded-[8px] text-left transition-colors duration-150 ${foco} ${on ? 'bg-[var(--acc-bg)] ring-1 ring-[var(--acc)]' : 'hover:bg-[var(--s1)]'}`}>
                      <img src={img(x.img)} alt="" className="w-[64px] h-[36px] rounded-[4px] object-cover shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] truncate">{x.nome}</span>
                        <span className="block mt-0.5 text-[12px] text-[var(--tx3)]">{x.projeto} · <span className="font-mono tabular-nums">{tc(x.dur)}</span></span>
                      </span>
                      <span className="w-[180px] shrink-0">
                        <span className={`flex justify-between text-[12px] tabular-nums ${pronta ? 'text-[var(--tx)]' : 'text-[var(--tx2)]'}`}>
                          <span>{x.estado}</span>{x.progresso > 0 && !pronta && <span>{Math.round(x.progresso * 100)}%</span>}
                        </span>
                        <span className="mt-1.5 block h-[2px] rounded-full bg-[var(--s3)] overflow-hidden"><span className="block h-full bg-[var(--tx2)]" style={{ width: `${x.progresso * 100}%` }} /></span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </main>

        {f
          ? <Inspector largura={340} caminho={[{ rotulo: 'Fila', ir: () => setSel(-1) }, { rotulo: f.nome }]} chave={'f' + sel}>
            <Secao>
              <img src={img(f.img)} alt="" className="w-full aspect-video rounded-[6px] object-cover" />
              <div className="mt-3 flex flex-col">
                <Prop rotulo="Projeto">{f.projeto}</Prop>
                <Prop rotulo="Duração"><span className="font-mono tabular-nums">{tc(f.dur)}</span></Prop>
                <Prop rotulo="Permissão">Tenho permissão do criador</Prop>
              </div>
            </Secao>
            <Secao titulo="Andamento">
              <ol className="flex flex-col gap-2.5">
                {ETAPAS.map((n, i) => {
                  const atual = etapaDe(f.estado)
                  const feita = i < atual || (i === 3 && atual === 4), agora = i === atual && atual < 4
                  return (
                    <li key={n} className="flex items-center gap-2.5 text-[12.5px]">
                      <span className={`w-4 h-4 rounded-full grid place-items-center shrink-0 ${feita ? 'bg-[var(--tx)] text-[var(--bg)]' : agora ? 'border-2 border-[var(--acc)]' : 'border border-[var(--ln2)]'}`}>{feita && <Check size={10} strokeWidth={3} />}</span>
                      <span className={feita ? 'text-[var(--tx2)]' : agora ? 'text-[var(--tx)]' : 'text-[var(--tx3)]'}>{n}</span>
                      {agora && f.progresso > 0 && <span className="ml-auto tabular-nums text-[var(--tx2)]">{Math.round(f.progresso * 100)}%</span>}
                    </li>
                  )
                })}
              </ol>
            </Secao>
            <Secao titulo="Custo do Provedor">
              <Prop rotulo="Estimado"><span className="tabular-nums">US$ {(f.dur / 3600 * 0.02).toFixed(2).replace('.', ',')}</span></Prop>
              <Prop rotulo="Real até agora"><span className="tabular-nums">{f.progresso >= 0.8 ? 'US$ 0,04' : 'US$ 0,00'}</span></Prop>
              <Prop rotulo="Teto do Projeto"><span className="tabular-nums">US$ 1,00</span></Prop>
            </Secao>
            <Secao>
              {f.progresso >= 1
                ? <Botao tipo="primario" className="w-full" tecla={['Enter']} onClick={() => irPara('cortes')}>Ver {f.estado.split('· ')[1]}</Botao>
                : <Botao className="w-full" onClick={() => toast(`“${f.nome}” saiu da fila`)}>Cancelar</Botao>}
            </Secao>
          </Inspector>
          : <Inspector largura={340} caminho={[{ rotulo: 'Nova Fonte' }]} chave="nova">
            <Secao titulo="Fonte">
              <button onClick={() => setUrl('live-213-reagindo-a-trailers.mp4')}
                className={`w-full h-[92px] flex flex-col items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-[var(--ln2)] hover:border-[var(--tx3)] hover:bg-[var(--s2)] transition-colors duration-150 ${foco}`}>
                <Upload size={16} className="text-[var(--tx2)]" />
                <span className="text-[13px]">Solte um vídeo ou escolha</span>
                <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--tx3)]">MP4, MKV, MOV, WEBM <Kbd k={['Ctrl', 'O']} /></span>
              </button>
              <input value={url} onChange={ev => setUrl(ev.target.value)} placeholder="ou cole a URL de uma live" aria-label="URL da Fonte"
                onKeyDown={ev => { if (ev.key === 'Enter') adicionar() }}
                className={`mt-2 w-full h-8 px-3 rounded-[6px] bg-[var(--bg)] border border-[var(--ln2)] text-[13px] placeholder:text-[var(--tx3)] ${foco}`} />
            </Secao>
            <Secao titulo="Projeto">
              <select value={projeto} onChange={ev => setProjeto(ev.target.value)} aria-label="Projeto"
                className={`w-full h-8 px-2 rounded-[6px] bg-[var(--bg)] border border-[var(--ln2)] text-[13px] ${foco}`}>
                {PROJETOS.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
              <p className="mt-2 text-[12px] text-[var(--tx3)] leading-[1.5]">Perfil de canal: {PROJETOS.find(p => p.id === projeto)!.perfil}</p>
            </Secao>
            <Secao titulo="Permissão do criador">
              <div role="radiogroup" aria-label="Permissão do criador" className="flex flex-col gap-0.5">
                {PERMS.map(p => (
                  <button key={p.id} role="radio" aria-checked={perm === p.id} onClick={() => setPerm(p.id)}
                    className={`h-8 px-2 flex items-center gap-2.5 rounded-[6px] text-[13px] text-left ${foco} ${perm === p.id ? 'text-[var(--tx)]' : 'text-[var(--tx2)] hover:bg-[var(--s2)]'}`}>
                    <span className={`w-3.5 h-3.5 rounded-full grid place-items-center ${perm === p.id ? 'border-[4px] border-[var(--acc)]' : 'border border-[var(--tx3)]'}`} />{p.nome}
                  </button>
                ))}
              </div>
              {perm === 'autorizado' && <input value={nota} onChange={ev => setNota(ev.target.value)} placeholder="Link ou nota da autorização" aria-label="Link ou nota da autorização"
                className={`mt-2 w-full h-8 px-3 rounded-[6px] bg-[var(--bg)] border border-[var(--ln2)] text-[13px] placeholder:text-[var(--tx3)] ${foco}`} />}
              {perm === 'sem' && <p className="mt-2 flex gap-2 text-[12px] leading-[1.5] text-[var(--tx2)]"><TriangleAlert size={14} className="shrink-0 mt-[2px]" />Publicar sem permissão pode violar os Termos do YouTube. A escolha fica registrada no Projeto.</p>}
            </Secao>
            <Secao>
              <Prop rotulo="Custo estimado"><span className="tabular-nums">≈ US$ 0,02 por hora</span></Prop>
              <Prop rotulo="Teto do Projeto"><span className="tabular-nums">US$ 1,00</span></Prop>
              <Botao tipo="primario" className="w-full mt-3" tecla={['Enter']} disabled={!url} onClick={adicionar}>Adicionar à fila</Botao>
            </Secao>
          </Inspector>}
      </div>
      <Paleta comandos={comandos} tela={tela} irPara={irPara} />
    </div>
  )
}
