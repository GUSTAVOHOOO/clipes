// Variante H, "Linha": importar numa linha só (Fonte, Projeto, Permissão, Adicionar) e a fila desenhada como
// linhas de tempo na mesma escala: o comprimento é a duração da Fonte, o preenchimento é o andamento.
import { useState } from 'react'
import { Link2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { cortes, fila, fonte, img, tc } from '../../dados'
import type { PropsVariante } from '../../App'
import { Botao, Kbd, foco } from '../nucleo/base'
import { GatilhoPaleta, Paleta, useAtalhos, type Cmd } from '../nucleo/Paleta'
import { TopoH } from './comum'

const PROJETOS = [
  { id: 'ficcao', nome: 'Canal dark · Ficção', perfil: 'Ficção sombria, legenda Impacto, Narração PT-BR' },
  { id: 'cortes', nome: 'Canal de cortes', perfil: 'Reações e podcast, legenda Clássico' },
]
const ESCALA = 6 * 3600 // eixo da fila: 0 a 6 h

export default function ImportarH({ tela, irPara }: PropsVariante) {
  const [url, setUrl] = useState('')
  const [projeto, setProjeto] = useState(PROJETOS[0].id)
  const [perm, setPerm] = useState('')
  const adicionar = () => {
    if (!url.trim()) return toast('Escolha um arquivo ou cole uma URL.', { duration: 1800 })
    if (!perm) return toast('Registre a Permissão antes de adicionar.', { duration: 1800 })
    toast('Fonte adicionada à fila', { description: 'A Transcrição começa quando a atual terminar.' }); setUrl('')
  }
  useAtalhos(ev => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'o') { ev.preventDefault(); setUrl('live-213-reagindo-a-trailers.mp4') }
  })
  const comandos: Cmd[] = [
    { id: 'arq', grupo: 'Importar', rotulo: 'Escolher arquivo de vídeo', tecla: ['Ctrl', 'O'], acao: () => setUrl('live-213-reagindo-a-trailers.mp4') },
    { id: 'add', grupo: 'Importar', rotulo: 'Adicionar à fila', tecla: ['Enter'], acao: adicionar },
  ]
  const campo = `h-9 rounded-[6px] bg-[var(--bg)] border border-[var(--ln2)] text-[13px] ${foco}`

  return (
    <div className="h-full flex flex-col">
      <TopoH tela={tela} irPara={irPara} direita={<GatilhoPaleta />} />
      <main className="flex-1 min-h-0 overflow-auto nu-rolagem">
        <div className="max-w-[1120px] mx-auto px-8 pt-9 pb-24">
          <h1 className="text-[18px] font-semibold tracking-[-0.01em]">Importar Fonte</h1>

          <div className="mt-5 flex items-center gap-2" onKeyDown={ev => { if (ev.key === 'Enter' && (ev.target as HTMLElement).tagName === 'INPUT') adicionar() }}>
            <label className={`flex-1 min-w-0 flex items-center gap-2 pl-3 pr-1 ${campo} focus-within:border-[var(--tx3)]`}>
              <Link2 size={15} className="text-[var(--tx3)] shrink-0" />
              <input value={url} onChange={ev => setUrl(ev.target.value)} placeholder="URL de uma live ou arquivo deste computador" aria-label="URL ou arquivo da Fonte"
                className="flex-1 min-w-0 h-full bg-transparent outline-none placeholder:text-[var(--tx3)]" />
              <button onClick={() => setUrl('live-213-reagindo-a-trailers.mp4')} className={`h-7 flex items-center gap-1.5 px-2 rounded-[5px] text-[12.5px] text-[var(--tx2)] hover:text-[var(--tx)] hover:bg-[var(--s2)] ${foco}`}>Arquivo <Kbd k={['Ctrl', 'O']} /></button>
            </label>
            <select value={projeto} onChange={ev => setProjeto(ev.target.value)} aria-label="Projeto" className={`${campo} w-[200px] px-2`}>
              {PROJETOS.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
            <select value={perm} onChange={ev => setPerm(ev.target.value)} aria-label="Permissão do criador" className={`${campo} w-[230px] px-2 ${perm ? '' : 'text-[var(--tx2)]'}`}>
              <option value="" disabled>Permissão do criador…</option>
              <option value="meu">O vídeo é meu</option>
              <option value="autorizado">Tenho permissão do criador</option>
              <option value="sem">Sem permissão</option>
            </select>
            <Botao tipo="primario" tecla={['Enter']} onClick={adicionar} className="h-9">Adicionar</Botao>
          </div>
          <div className="mt-2.5 flex items-start justify-between gap-6 text-[12px] text-[var(--tx3)]">
            <span>Perfil de canal: {PROJETOS.find(p => p.id === projeto)!.perfil}. A Transcrição roda aqui, sem enviar o áudio.</span>
            <span className="shrink-0 tabular-nums">Provedor ≈ US$ 0,02 por hora de Fonte · teto US$ 1,00</span>
          </div>
          {perm === 'sem' && (
            <p className="mt-2 flex items-center gap-2 text-[12px] text-[var(--tx2)]"><TriangleAlert size={14} className="shrink-0" />Publicar sem permissão pode violar os Termos do YouTube. A escolha fica registrada no Projeto.</p>
          )}

          <section className="mt-12" aria-labelledby="h-fila">
            <div className="grid grid-cols-[280px_1fr_112px] items-end gap-5 pb-2 border-b border-[var(--ln)]">
              <h2 id="h-fila" className="text-[15px] font-medium">Fila <span className="text-[12px] font-normal text-[var(--tx3)]">· uma Fonte de cada vez</span></h2>
              <div className="relative h-4" aria-hidden>
                {[0, 1, 2, 3, 4, 5, 6].map(h => (
                  <span key={h} className={`absolute bottom-0 whitespace-nowrap font-mono tabular-nums text-[10.5px] text-[var(--tx3)] ${h === 0 ? '' : h === 6 ? '-translate-x-full' : '-translate-x-1/2'}`} style={{ left: `${(h / 6) * 100}%` }}>{h} h</span>
                ))}
              </div>
              <span />
            </div>
            <ul>
              {fila.map(f => {
                const pronta = f.progresso >= 1
                const largura = (f.dur / ESCALA) * 100
                const ehTears = f.nome === fonte.nome
                return (
                  <li key={f.nome} className="grid grid-cols-[280px_1fr_112px] items-center gap-5 py-3.5 border-b border-[var(--ln)]">
                    <div className="flex items-center gap-3 min-w-0">
                      <img src={img(f.img)} alt="" className="w-[56px] h-[32px] rounded-[4px] object-cover shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-[13px] truncate">{f.nome}</span>
                        <span className="block text-[12px] text-[var(--tx3)] truncate">{f.projeto}</span>
                      </span>
                    </div>
                    <div className="relative h-10">
                      {[1, 2, 3, 4, 5].map(h => <span key={h} className="absolute bottom-0 h-[18px] w-px bg-[var(--ln)]" style={{ left: `${(h / 6) * 100}%` }} aria-hidden />)}
                      <span className="absolute left-0 top-0 text-[12px] whitespace-nowrap tabular-nums">
                        <span className={pronta ? 'text-[var(--tx)]' : 'text-[var(--tx2)]'}>{f.estado}{f.progresso > 0 && !pronta && ` · ${Math.round(f.progresso * 100)}%`}</span>
                        <span className="text-[var(--tx3)] font-mono"> · {tc(f.dur)}</span>
                      </span>
                      <div className="absolute left-0 bottom-1 h-2.5 rounded-[3px] bg-[var(--s3)] overflow-hidden" style={{ width: `${largura}%` }}
                        role="progressbar" aria-valuenow={Math.round(f.progresso * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${f.nome}: ${f.estado}`}>
                        <div className={`h-full ${pronta ? 'bg-[var(--tx3)]' : 'bg-[var(--tx2)]'}`} style={{ width: `${f.progresso * 100}%` }} />
                        {ehTears && cortes.map(k => <span key={k.id} className="absolute top-0 bottom-0 w-[3px] bg-[var(--tx)]" style={{ left: `${(k.inicio / f.dur) * 100}%` }} title={k.titulo} />)}
                      </div>
                      {!pronta && f.progresso > 0 && <span className="absolute bottom-0 w-[2px] h-[18px] bg-[var(--acc)]" style={{ left: `calc(${largura * f.progresso}% - 1px)` }} aria-hidden />}
                    </div>
                    <div className="flex justify-end">
                      {pronta ? <Botao tamanho="p" onClick={() => irPara('cortes')}>Ver Cortes</Botao>
                        : <Botao tamanho="p" tipo="fantasma" onClick={() => toast(`“${f.nome}” saiu da fila`)}>Cancelar</Botao>}
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="mt-3 text-[12px] text-[var(--tx3)]">Os traços claros na Fonte pronta são os Cortes que o Provedor sugeriu, no lugar onde estão.</p>
          </section>
        </div>
      </main>
      <Paleta comandos={comandos} tela={tela} irPara={irPara} />
    </div>
  )
}
