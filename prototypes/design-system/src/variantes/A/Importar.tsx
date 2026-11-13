// Importar Fonte, Variante A ("Estúdio"): área de soltar no centro, formulário compacto ao lado, fila embaixo.
import { useEffect, useRef, useState } from 'react'
import { FileVideo, Link2, Info, Check } from 'lucide-react'
import { toast } from 'sonner'
import { fila as filaInicial, img, tc } from '../../dados'
import type { Tela } from '../../App'
import { Botao, Topo, foco } from './ui'

type Escolha = { tipo: 'arquivo' | 'url'; nome: string } | null
type Permissao = 'propria' | 'autorizada' | 'sem'
const PERFIS: Record<string, { perfil: string; detalhe: string }> = {
  'Canal dark · Ficção': { perfil: 'Ficção sombria', detalhe: '9:16, legenda Impacto, Narração em PT-BR' },
  'Canal de cortes': { perfil: 'Cortes de live', detalhe: '9:16, legenda Clássico, sem Narração' },
}
const campo = `h-8 w-full rounded-md bg-[var(--a-s2)] border border-[var(--a-ln2)] px-2.5 text-[13px] text-[var(--a-tx)] placeholder:text-[var(--a-tx3)] hover:border-[var(--a-tx3)] ${foco}`

export default function Importar({ tela, irPara }: { tela: Tela; irPara: (t: Tela) => void }) {
  const [escolha, setEscolha] = useState<Escolha>(null)
  const [arrastando, setArrastando] = useState(false)
  const [url, setUrl] = useState('')
  const [erroUrl, setErroUrl] = useState('')
  const [projeto, setProjeto] = useState('Canal dark · Ficção')
  const [novoProjeto, setNovoProjeto] = useState('')
  const [permissao, setPermissao] = useState<Permissao>('autorizada')
  const [nota, setNota] = useState('')
  const [fila, setFila] = useState(filaInicial)
  const arquivo = useRef<HTMLInputElement>(null)

  // Progresso de mentira para a fila parecer viva.
  useEffect(() => {
    const id = setInterval(() => setFila(f => f.map(x => (x.progresso > 0 && x.progresso < 1 ? { ...x, progresso: Math.min(0.99, x.progresso + 0.003) } : x))), 500)
    return () => clearInterval(id)
  }, [])

  const buscar = () => {
    if (!/^https?:\/\/\S+\.\S+/.test(url.trim())) { setErroUrl('Cole um endereço completo, começando com https://'); return }
    setErroUrl(''); setEscolha({ tipo: 'url', nome: url.trim() })
  }
  const nomeProjeto = projeto === '__novo' ? novoProjeto.trim() || 'Novo Projeto' : projeto
  const perfil = PERFIS[projeto]
  const adicionar = () => {
    if (!escolha) return
    setFila(f => [{ nome: escolha.nome.replace(/^https?:\/\//, ''), projeto: nomeProjeto, dur: 1 * 3600 + 47 * 60, estado: 'Na fila', progresso: 0, img: 'img/fonte-4.jpg' }, ...f])
    toast('Fonte adicionada à fila', { description: `${nomeProjeto}${permissao === 'sem' ? ', sem permissão registrada' : ''}` })
    setEscolha(null); setUrl('')
  }

  return (
    <div className="h-full flex flex-col">
      <Topo tela={tela} irPara={irPara} />
      <main className="flex-1 min-h-0 overflow-auto">
        <div className="max-w-[1120px] mx-auto px-8 pt-7 pb-20">
          <h1 className="text-[20px] font-semibold tracking-[-0.015em]">Importar Fonte</h1>
          <p className="mt-1 text-[13px] text-[var(--a-tx3)]">Um vídeo deste computador ou a URL de uma live. A Transcrição roda aqui, sem enviar o áudio.</p>

          <div className="mt-6 grid grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
            <div className="min-w-0">
              <div
                onDragOver={e => { e.preventDefault(); setArrastando(true) }}
                onDragLeave={() => setArrastando(false)}
                onDrop={e => { e.preventDefault(); setArrastando(false); const f = e.dataTransfer.files[0]; if (f) setEscolha({ tipo: 'arquivo', nome: f.name }) }}
                className={`h-[200px] rounded-lg border border-dashed flex flex-col items-center justify-center text-center px-6 transition-colors ${
                  arrastando ? 'border-[var(--a-acc)] bg-[var(--a-accbg)]' : 'border-[var(--a-ln2)] bg-[var(--a-s1)]'}`}>
                {escolha ? <>
                  <span className="w-10 h-10 rounded-full grid place-items-center bg-[var(--a-s3)] text-[var(--a-tx)]"><Check size={18} /></span>
                  <p className="mt-3 text-[14px] text-[var(--a-tx)] max-w-[440px] truncate">{escolha.nome}</p>
                  <p className="mt-1 text-[12px] text-[var(--a-tx3)]">{escolha.tipo === 'url' ? 'URL encontrada. Baixa com yt-dlp ao entrar na fila.' : 'Arquivo pronto para entrar na fila.'}</p>
                  <Botao tipo="fantasma" className="mt-3" onClick={() => setEscolha(null)}>Trocar</Botao>
                </> : <>
                  <FileVideo size={26} strokeWidth={1.5} className="text-[var(--a-tx3)]" />
                  <p className="mt-3 text-[15px] text-[var(--a-tx)]">Solte um vídeo aqui</p>
                  <p className="mt-1 text-[12px] text-[var(--a-tx3)]">MP4, MKV, MOV ou WEBM, de qualquer duração</p>
                  <Botao className="mt-4" onClick={() => arquivo.current?.click()}>Escolher arquivo</Botao>
                  <input ref={arquivo} type="file" accept="video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setEscolha({ tipo: 'arquivo', nome: f.name }) }} />
                </>}
              </div>

              <div className="mt-3 flex gap-2">
                <label className="relative flex-1">
                  <span className="sr-only">URL da live ou do vídeo</span>
                  <Link2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--a-tx3)] pointer-events-none" />
                  <input value={url} onChange={e => { setUrl(e.target.value); setErroUrl('') }} onKeyDown={e => e.key === 'Enter' && buscar()}
                    placeholder="Ou cole a URL de uma live ou vídeo" aria-invalid={!!erroUrl} className={`${campo} pl-8`} />
                </label>
                <Botao onClick={buscar} disabled={!url.trim()}>Buscar</Botao>
              </div>
              {erroUrl && <p className="mt-1.5 text-[12px] text-[var(--a-tx2)]">{erroUrl}</p>}
            <section className="mt-8" aria-label="Fila de Fontes">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-[15px] font-medium">Fila de Fontes</h2>
                <span className="text-[12px] text-[var(--a-tx3)] tabular">{fila.length} Fontes</span>
              </div>
              <ul className="rounded-lg border border-[var(--a-ln)] divide-y divide-[var(--a-ln)] bg-[var(--a-s1)]">
                {fila.map((f, i) => {
                  const pronta = f.progresso >= 1
                  return (
                    <li key={f.nome + i} className="grid grid-cols-[64px_minmax(0,1fr)_64px_minmax(120px,180px)_92px] items-center gap-3.5 h-[58px] px-3">
                      <img src={img(f.img)} alt="" className="w-16 h-9 rounded-[3px] object-cover bg-[var(--a-s3)]" />
                      <div className="min-w-0">
                        <p className="text-[13px] text-[var(--a-tx)] truncate">{f.nome}</p>
                        <p className="text-[12px] text-[var(--a-tx3)] truncate">{f.projeto}</p>
                      </div>
                      <span className="font-mono tabular text-[12px] text-[var(--a-tx2)]">{tc(f.dur)}</span>
                      <div>
                        <div className="flex items-center justify-between text-[12px]">
                          <span className={pronta ? 'text-[var(--a-tx)]' : 'text-[var(--a-tx2)]'}>{f.estado.replace(' · ', ', ')}</span>
                          {!pronta && f.progresso > 0 && <span className="font-mono tabular text-[var(--a-tx3)]">{Math.floor(f.progresso * 100)}%</span>}
                        </div>
                        <div className="mt-1.5 h-[2px] rounded-full bg-[var(--a-s3)] overflow-hidden"
                          role="progressbar" aria-valuenow={Math.round(f.progresso * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Progresso de ${f.nome}`}>
                          <div className={`h-full rounded-full ${pronta ? 'bg-[var(--a-tx2)]' : 'bg-[var(--a-tx)]'}`} style={{ width: `${f.progresso * 100}%` }} />
                        </div>
                      </div>
                      <div className="justify-self-end">
                        {pronta
                          ? <Botao onClick={() => irPara('cortes')}>Ver Cortes</Botao>
                          : <Botao tipo="fantasma" onClick={() => { setFila(x => x.filter((_, j) => j !== i)); toast(`${f.nome} saiu da fila`) }}>Cancelar</Botao>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
            </div>

            <form onSubmit={e => { e.preventDefault(); adicionar() }} className="sticky top-0 rounded-lg border border-[var(--a-ln)] bg-[var(--a-s1)]">
              <div className="p-4 flex flex-col gap-3 border-b border-[var(--a-ln)]">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] text-[var(--a-tx2)]">Projeto</span>
                  <select value={projeto} onChange={e => setProjeto(e.target.value)} className={campo}>
                    {Object.keys(PERFIS).map(p => <option key={p} value={p}>{p}</option>)}
                    <option value="__novo">Novo Projeto…</option>
                  </select>
                </label>
                {projeto === '__novo'
                  ? <input value={novoProjeto} onChange={e => setNovoProjeto(e.target.value)} placeholder="Nome do canal" aria-label="Nome do novo Projeto" className={campo} />
                  : <p className="text-[12px] leading-[1.5] text-[var(--a-tx3)]">
                    Perfil de canal <span className="text-[var(--a-tx2)]">{perfil.perfil}</span>: {perfil.detalhe}.
                  </p>}
              </div>

              <fieldset className="p-4 border-b border-[var(--a-ln)]">
                <legend className="text-[12px] text-[var(--a-tx2)] mb-2 float-left w-full">Permissão do criador</legend>
                <div className="clear-both flex flex-col" role="radiogroup">
                  {([['propria', 'O vídeo é meu'], ['autorizada', 'Tenho permissão do criador'], ['sem', 'Sem permissão']] as [Permissao, string][]).map(([v, n]) => (
                    <label key={v} className="flex items-center gap-2.5 h-8 cursor-pointer text-[13px] text-[var(--a-tx)]">
                      <input type="radio" name="permissao" value={v} checked={permissao === v} onChange={() => setPermissao(v)}
                        className={`w-3.5 h-3.5 accent-[var(--a-tx)] ${foco}`} />
                      {n}
                    </label>
                  ))}
                </div>
                {permissao === 'autorizada' && (
                  <input value={nota} onChange={e => setNota(e.target.value)} placeholder="Link ou nota da autorização" aria-label="Link ou nota da autorização" className={`${campo} mt-2`} />
                )}
                {permissao === 'sem' && (
                  <p className="mt-2 flex gap-2 text-[12px] leading-[1.5] text-[var(--a-tx3)]">
                    <Info size={13} className="shrink-0 mt-[2px]" />
                    Baixar vídeos de outros canais sem permissão pode violar os Termos do YouTube. A Fonte fica marcada assim no Projeto.
                  </p>
                )}
              </fieldset>

              <div className="p-4">
                <Botao tipo="primario" className="w-full" disabled={!escolha}>Adicionar à fila</Botao>
                {!escolha && <p className="mt-2 text-[12px] text-center text-[var(--a-tx3)]">Escolha um arquivo ou cole uma URL primeiro</p>}
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}
