import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FileVideo, FolderOpen, Link, Plus, ShieldCheck, Upload } from 'lucide-react'
import { fila, perfis } from '@/data/dados'
import { useApp, useEdicao } from '@/lib/app'
import { useComandos } from '@/lib/comandos'
import { ir, useRota } from '@/lib/rota'
import { Tela, CabecalhoPagina } from '@/components/shell/Tela'
import { Button } from '@/components/ui/Button'
import { Campo, Input } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Select } from '@/components/ui/Select'
import { avisar } from '@/components/ui/Toast'
import { LinhaFila, type FonteFila } from '@/components/domain/LinhaFila'
import { EstadoLista } from '@/components/domain/EstadoLista'

type FilaFontes = { itens: FonteFila[] }

export default function Fontes() {
  const { projeto, projetos } = useApp()
  const { query } = useRota()
  const estado = query.get('estado')
  const [dados, setDados] = useEdicao<FilaFontes>('fontes', 'fila', () => ({ itens: fila }))
  const [modo, setModo] = useState<'url' | 'arquivo'>('url')
  const [url, setUrl] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [pid, setPid] = useState(projeto.id)
  useEffect(() => setPid(projeto.id), [projeto.id])
  const [origem, setOrigem] = useState('')
  const [escopo, setEscopo] = useState('Cortes e transformação')
  const [permitido, setPermitido] = useState(false)
  const [erro, setErro] = useState('')
  const urlRef = useRef<HTMLInputElement>(null)
  const arquivoRef = useRef<HTMLInputElement>(null)
  const focar = () => (modo === 'url' ? urlRef.current?.focus() : arquivoRef.current?.click())
  const valido = (modo === 'url' ? !!url.trim() : !!arquivo) && permitido && !!origem.trim()
  const perfil = perfis.find(p => p.id === projetos.find(p => p.id === pid)?.perfil)

  const importar = () => {
    if (!valido) return
    let nome = arquivo?.name ?? ''
    if (modo === 'url') {
      try {
        const link = new URL(url)
        if (!['https:', 'http:'].includes(link.protocol)) throw new Error()
        nome = decodeURIComponent(link.pathname.split('/').filter(Boolean).at(-1) ?? link.hostname)
      } catch {
        setErro('Cole uma URL válida que comece com https:// ou http://.')
        return
      }
    }
    const item: FonteFila = {
      id: `nova-${Date.now()}`,
      nome,
      projeto: projetos.find(p => p.id === pid)!.nome,
      dur: 0,
      estado: 'na-fila',
      progresso: 0,
      img: 'img/fonte-0.jpg',
      permissao: { origem: origem.trim(), escopo },
      localizacao: modo === 'url' ? url.trim() : arquivo!.name,
    }
    setDados(v => ({ itens: [item, ...v.itens] }))
    setUrl('')
    setArquivo(null)
    setPermitido(false)
    setOrigem('')
    setErro('')
    if (arquivoRef.current) arquivoRef.current.value = ''
    avisar.sucesso(
      'Fonte adicionada à fila de demonstração',
      'A Permissão foi registrada nesta sessão. Nenhum arquivo foi processado.',
    )
  }
  const remover = (id: string) => {
    const anterior = dados.itens
    setDados({ itens: dados.itens.filter(i => i.id !== id) })
    avisar.desfazer('Fonte removida da fila', () => setDados({ itens: anterior }))
  }
  const repetir = (id: string) => {
    setDados({
      itens: dados.itens.map(i => (i.id === id ? { ...i, estado: 'na-fila', progresso: 0, erro: undefined } : i)),
    })
    avisar('Nova tentativa adicionada à fila de demonstração')
  }
  useComandos([
    { id: 'fonte-importar', titulo: 'Importar Fonte', grupo: 'Fontes', atalho: 'N', executar: focar },
    {
      id: 'fonte-adicionar',
      titulo: 'Adicionar Fonte à fila',
      grupo: 'Fontes',
      atalho: 'Ctrl+Enter',
      executar: importar,
      desabilitado: !valido,
    },
    {
      id: 'fonte-arquivo',
      titulo: 'Escolher arquivo de Fonte',
      grupo: 'Fontes',
      executar: () => {
        setModo('arquivo')
        arquivoRef.current?.click()
      },
    },
    ...dados.itens
      .filter(i => i.estado !== 'pronta')
      .map(i => ({
        id: `fonte-remover-${i.id}`,
        titulo: `Remover da fila: ${i.nome}`,
        grupo: 'Fontes',
        executar: () => remover(i.id),
      })),
    ...dados.itens
      .filter(i => i.estado === 'erro' || i.estado === 'offline')
      .map(i => ({
        id: `fonte-repetir-${i.id}`,
        titulo: `Tentar novamente: ${i.nome}`,
        grupo: 'Fontes',
        executar: () => repetir(i.id),
      })),
  ])

  return (
    <Tela
      titulo="Fontes"
      direita={
        <Button icone={<Plus size={14} />} atalho="N" onClick={focar}>
          Importar Fonte
        </Button>
      }
      className="overflow-auto"
    >
      <div className="mx-auto max-w-[1200px] px-10 py-8">
        <CabecalhoPagina
          titulo="Fontes"
          descricao="De uma live longa ao próximo Corte. Importe uma gravação e acompanhe a fila."
        />
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            importar()
          }}
          className="mt-7 border-y border-line bg-surface px-5 py-5"
        >
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <Upload size={15} /> Importar Fonte
            </h2>
            <Segmented
              valor={modo}
              onChange={setModo}
              rotulo="Origem da Fonte"
              opcoes={[
                { valor: 'url', rotulo: 'URL' },
                { valor: 'arquivo', rotulo: 'Arquivo local' },
              ]}
            />
          </div>
          <div className="grid grid-cols-[minmax(240px,1fr)_260px] gap-4">
            {modo === 'url' ? (
              <Campo rotulo="URL da Fonte" erro={erro || undefined}>
                <Input
                  ref={urlRef}
                  value={url}
                  onChange={e => {
                    setUrl(e.target.value)
                    setErro('')
                  }}
                  placeholder="https://… · live já gravada"
                  prefixo={<Link size={14} />}
                />
              </Campo>
            ) : (
              <Campo rotulo="Arquivo da Fonte" descricao="Vídeo ou áudio local. A Fonte permanece na pasta de origem.">
                <div className="flex h-8 items-center gap-3">
                  <Button icone={<FolderOpen size={14} />} onClick={() => arquivoRef.current?.click()}>
                    Escolher arquivo
                  </Button>
                  <span className="truncate text-xs text-fg-2">{arquivo?.name ?? 'Nenhum arquivo escolhido'}</span>
                </div>
              </Campo>
            )}
            <Campo rotulo="Projeto" descricao={`${perfil?.tipo} · ${perfil?.idioma}`}>
              <Select
                valor={pid}
                onChange={setPid}
                rotulo="Projeto de destino"
                opcoes={projetos.map(p => ({ valor: p.id, rotulo: p.nome }))}
                className="w-full"
              />
            </Campo>
          </div>
          <input
            ref={arquivoRef}
            type="file"
            accept="video/*,audio/*,.mkv,.mov,.mp4,.webm"
            aria-label="Arquivo da Fonte"
            className="sr-only"
            tabIndex={-1}
            onChange={e => setArquivo(e.target.files?.[0] ?? null)}
          />
          <div className="mt-4 grid grid-cols-[minmax(240px,1fr)_190px_260px] items-end gap-4">
            <Campo
              rotulo={
                <span className="flex items-center gap-1.5">
                  <ShieldCheck size={13} /> Origem da Permissão
                </span>
              }
            >
              <Input
                value={origem}
                onChange={e => setOrigem(e.target.value)}
                placeholder="Ex.: autorização por escrito, programa de cortes ou licença"
              />
            </Campo>
            <Campo rotulo="Escopo autorizado">
              <Select
                valor={escopo}
                onChange={setEscopo}
                rotulo="Escopo autorizado"
                opcoes={['Cortes e transformação', 'Só Cortes diretos', 'Só Vídeos transformados'].map(s => ({
                  valor: s,
                  rotulo: s,
                }))}
                className="w-full min-w-0"
              />
            </Campo>
            <Button type="submit" variante="primario" disabled={!valido} atalho="Ctrl+Enter" icone={<Plus size={14} />}>
              Adicionar à fila
            </Button>
          </div>
          <label className="mt-3 flex min-h-6 w-fit items-center gap-2 text-xs text-fg-2">
            <input
              type="checkbox"
              checked={permitido}
              onChange={e => setPermitido(e.target.checked)}
              className="foco size-4 accent-(--primary)"
            />
            Tenho Permissão para usar esta Fonte no escopo informado.
          </label>
          <p className="mt-1 pl-6 text-2xs text-fg-3">
            A Permissão não garante monetização. A Transcrição é local; o Provedor recebe somente texto.
          </p>
        </form>
        <section className="mt-8" aria-labelledby="titulo-fila">
          <div className="flex items-center justify-between gap-4 border-b border-line pb-3">
            <h2 id="titulo-fila" className="text-sm font-medium">
              Fila de Fontes <span className="ml-2 font-normal text-fg-3">{dados.itens.length}</span>
            </h2>
            <span className="flex items-center gap-1.5 text-xs text-fg-3">
              <FileVideo size={13} />
              Demonstração · processamento não executado
            </span>
          </div>
          {estado || !dados.itens.length ? (
            <EstadoLista
              estado={estado}
              titulo={estado === 'erro' ? 'Não foi possível ler a fila' : 'Seu próximo Corte começa aqui'}
              descricao={
                estado === 'erro'
                  ? 'O Projeto não está acessível. Confira a pasta e tente novamente.'
                  : 'Cole a URL de uma gravação ou escolha um arquivo local para importar a primeira Fonte.'
              }
              acao={estado === 'erro' ? 'Tentar de novo' : estado !== 'carregando' ? 'Importar Fonte' : undefined}
              onAcao={estado === 'erro' ? () => ir('/fontes') : focar}
            />
          ) : (
            <ul className="divide-y divide-line">
              {dados.itens.map(item => (
                <LinhaFila
                  key={item.id}
                  item={item}
                  onRepetir={() => repetir(item.id)}
                  onRemover={() => remover(item.id)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Tela>
  )
}
