import { Copy, ImagePlus, Lightbulb, Save, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ContextoCorte, useCorteDaRota } from '@/components/shell/ContextoCorte'
import { CabecalhoGaveta, GavetaBorda, Puxador, useGaveta, ZonaBorda } from '@/components/shell/Gaveta'
import { Tela } from '@/components/shell/Tela'
import { Button, IconButton } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Field'
import { Kbd } from '@/components/ui/Kbd'
import { Progresso } from '@/components/ui/Progress'
import { Status } from '@/components/ui/Status'
import { avisar } from '@/components/ui/Toast'
import { img } from '@/data/dados'
import { useEdicao } from '@/lib/app'
import { useComandos } from '@/lib/comandos'
import { cn } from '@/lib/cn'
import { tc } from '@/lib/formato'
import { ir, useRota } from '@/lib/rota'

type Empacotamento = {
  titulo: string
  descricao: string
  textoCapa: string
  quadro: number
  capaImportada: string | null
  revisado: boolean
  salvo: boolean
}

function baixar(url: string, nome: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
}

export default function Empacotar() {
  const { corte } = useCorteDaRota()
  return <EmpacotarCorte key={corte.id} />
}

function EmpacotarCorte() {
  const { corte } = useCorteDaRota()
  const { query } = useRota()
  const vazio = query.get('estado') === 'vazio'
  const [edicao, mudar] = useEdicao<Empacotamento>(corte.id, 'empacotamento', () => ({
    titulo: vazio ? '' : corte.titulo,
    descricao: vazio
      ? ''
      : 'Um olhar sobre as escolhas de narrativa em Tears of Steel.\n\nFonte: Tears of Steel — Blender Foundation, CC-BY 3.0.\n#Cinema #TearsOfSteel',
    textoCapa: vazio ? '' : 'O que fica por dizer',
    quadro: 2,
    capaImportada: null,
    revisado: false,
    salvo: false,
  }))
  const [estado, setEstado] = useState(query.get('estado'))
  const [erroCapa, setErroCapa] = useState('')
  const [exportando, setExportando] = useState(false)
  const sugestoes = useGaveta(query.get('painel') === 'sugestoes' ? 'fixa' : null)
  const estadoPedido = query.get('estado')
  const painelPedido = query.get('painel')
  useEffect(() => {
    setEstado(estadoPedido)
  }, [estadoPedido])
  useEffect(() => {
    if (painelPedido === 'sugestoes') sugestoes.fixar()
    else sugestoes.fechar()
  }, [painelPedido, sugestoes.fixar, sugestoes.fechar])
  const upload = useRef<HTMLInputElement>(null)
  const tituloRef = useRef<HTMLInputElement>(null)
  const capa = edicao.capaImportada ?? img(corte.thumbs[edicao.quadro])
  const valido =
    edicao.titulo.trim().length > 0 &&
    edicao.titulo.length <= 100 &&
    edicao.descricao.trim().length > 0 &&
    edicao.descricao.length <= 5000

  function editar(p: Partial<Empacotamento>) {
    mudar({ ...p, revisado: false, salvo: false })
  }
  function salvar() {
    if (!valido || !edicao.revisado) return
    mudar({ salvo: true })
    avisar.sucesso('Empacotamento salvo nesta sessão')
  }
  function quadro(delta: number) {
    if (edicao.capaImportada) URL.revokeObjectURL(edicao.capaImportada)
    editar({ quadro: (edicao.quadro + delta + corte.thumbs.length) % corte.thumbs.length, capaImportada: null })
  }
  async function copiar() {
    try {
      await navigator.clipboard.writeText(`${edicao.titulo}\n\n${edicao.descricao}`)
      avisar.sucesso('Título e descrição copiados')
    } catch {
      avisar.erro('Não foi possível copiar', 'Selecione o texto nos campos e use Ctrl+C.')
    }
  }
  async function importar(file?: File) {
    if (!file) return
    setErroCapa('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErroCapa('Escolha uma imagem JPEG, PNG ou WebP.')
      return
    }
    if (file.size > 15 * 1000 * 1000) {
      setErroCapa('A imagem deve ter até 15 MB.')
      return
    }
    const url = URL.createObjectURL(file)
    const imagem = new Image()
    imagem.src = url
    try {
      await imagem.decode()
      if (edicao.capaImportada) URL.revokeObjectURL(edicao.capaImportada)
      editar({ capaImportada: url })
    } catch {
      URL.revokeObjectURL(url)
      setErroCapa('Esta imagem não pôde ser aberta. Tente outro arquivo.')
    }
  }

  async function exportarCapa() {
    if (exportando) return
    setExportando(true)
    try {
      const imagem = new Image()
      imagem.src = capa
      await imagem.decode()
      const canvas = document.createElement('canvas')
      canvas.width = 1080
      canvas.height = 1920
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas')
      const escala = Math.max(canvas.width / imagem.width, canvas.height / imagem.height)
      const w = imagem.width * escala,
        h = imagem.height * escala
      ctx.drawImage(imagem, (1080 - w) / 2, (1920 - h) / 2, w, h)
      if (edicao.textoCapa.trim()) {
        ctx.fillStyle = '#FFFFFF'
        ctx.strokeStyle = '#000000'
        ctx.lineWidth = 10
        ctx.lineJoin = 'round'
        ctx.textAlign = 'center'
        ctx.font = '600 86px Inter Variable, sans-serif'
        const linhas: string[] = []
        for (const palavra of edicao.textoCapa.trim().split(/\s+/)) {
          const i = linhas.length - 1
          if (i < 0 || ctx.measureText(linhas[i] + ' ' + palavra).width > 940) linhas.push(palavra)
          else linhas[i] += ' ' + palavra
        }
        linhas.forEach((linha, i) => {
          ctx.strokeText(linha, 540, 1420 + i * 102)
          ctx.fillText(linha, 540, 1420 + i * 102)
        })
      }
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'),
      )
      const url = URL.createObjectURL(blob)
      baixar(url, `${corte.id}-capa.png`)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      avisar.sucesso('Capa PNG preparada para salvar')
    } catch {
      avisar.erro('Não foi possível exportar a capa', 'Tente selecionar outro quadro ou importar uma imagem.')
    } finally {
      setExportando(false)
    }
  }

  useComandos([
    {
      id: 'empacotar-salvar',
      titulo: 'Salvar Empacotamento',
      grupo: 'Empacotamento',
      atalho: 'Ctrl+S',
      desabilitado: !valido || !edicao.revisado,
      executar: salvar,
    },
    {
      id: 'empacotar-sugestoes',
      titulo: 'Mostrar sugestões de título',
      grupo: 'Mostrar',
      atalho: 'S',
      executar: sugestoes.alternar,
    },
    {
      id: 'empacotar-copiar',
      titulo: 'Copiar título e descrição',
      grupo: 'Empacotamento',
      executar: () => void copiar(),
    },
    {
      id: 'empacotar-capa',
      titulo: 'Exportar capa PNG',
      grupo: 'Empacotamento',
      desabilitado: exportando,
      executar: () => void exportarCapa(),
    },
    {
      id: 'empacotar-importar',
      titulo: 'Importar imagem de capa',
      grupo: 'Empacotamento',
      executar: () => upload.current?.click(),
    },
    {
      id: 'empacotar-quadro-prox',
      titulo: 'Próximo quadro de capa',
      grupo: 'Capa',
      atalho: 'ArrowRight',
      executar: () => quadro(1),
    },
    {
      id: 'empacotar-quadro-ant',
      titulo: 'Quadro anterior de capa',
      grupo: 'Capa',
      atalho: 'ArrowLeft',
      executar: () => quadro(-1),
    },
    {
      id: 'empacotar-titulo',
      titulo: 'Escrever título',
      grupo: 'Empacotamento',
      atalho: 'R',
      executar: () => tituloRef.current?.focus(),
    },
    { id: 'empacotar-exportar', titulo: 'Ir para exportação em lote', grupo: 'Corte', executar: () => ir('/exportar') },
  ])

  return (
    <Tela
      titulo="Empacotamento"
      meio={<ContextoCorte />}
      direita={
        <Button
          variante="primario"
          icone={<Save size={14} />}
          atalho="Ctrl+S"
          disabled={!valido || !edicao.revisado}
          aria-label="Salvar Empacotamento"
          onClick={salvar}
        >
          Salvar
        </Button>
      }
    >
      <div className="relative h-full overflow-hidden">
        <div
          className="h-full overflow-auto"
          onPointerDown={(e) => {
            if (!(e.target as HTMLElement).closest('button')) sugestoes.fechar()
          }}
        >
          <div className="mx-auto max-w-[1040px] px-16 pt-10 pb-10">
            {estado === 'carregando' ? (
              <div className="max-w-[620px] space-y-5 py-16" aria-busy="true">
                <p className="text-fg-2">Carregando Empacotamento…</p>
                <Progresso valor={null} rotulo="Carregando Empacotamento" />
              </div>
            ) : estado === 'erro' ? (
              <div className="py-16">
                <Status tom="perigo">O Empacotamento não pôde ser carregado.</Status>
                <p className="mt-3 text-sm text-fg-2">O Corte e suas edições continuam disponíveis.</p>
                <Button className="mt-5" onClick={() => setEstado(null)}>
                  Tentar novamente
                </Button>
              </div>
            ) : (
              <>
                <div className="mb-7 flex items-start justify-between gap-8">
                  <div>
                    <h1 className="text-xl font-semibold">Prepare a apresentação do Corte</h1>
                    <p className="mt-2 max-w-[65ch] text-sm text-fg-2">
                      Escolha o título, escreva o contexto e revise a capa antes de exportar.
                    </p>
                  </div>
                  <span role="status" aria-label="Estado do Empacotamento">
                    <Status tom={edicao.salvo ? 'sucesso' : 'rascunho'}>
                      {edicao.salvo ? 'Empacotamento salvo' : 'Revisão pendente'}
                    </Status>
                  </span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_228px] items-start gap-12">
                  <section className="min-w-0 space-y-5" aria-label="Informações de publicação">
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <label htmlFor="titulo-corte" className="text-xs font-medium text-fg-2">
                          Título
                        </label>
                        <Button
                          tamanho="sm"
                          variante="fantasma"
                          className="-my-1"
                          icone={<Lightbulb size={13} />}
                          atalho="S"
                          onClick={sugestoes.alternar}
                        >
                          Sugestões
                        </Button>
                      </div>
                      <Input
                        ref={tituloRef}
                        id="titulo-corte"
                        aria-label="Título"
                        value={edicao.titulo}
                        maxLength={100}
                        placeholder="Diga o que torna este Corte interessante"
                        onChange={(e) => editar({ titulo: e.target.value })}
                      />
                      <p className="mt-1.5 text-right text-xs text-fg-3">{edicao.titulo.length}/100</p>
                    </div>
                    <div>
                      <label htmlFor="descricao-corte" className="mb-2 block text-xs font-medium text-fg-2">
                        Descrição
                      </label>
                      <Textarea
                        id="descricao-corte"
                        aria-label="Descrição"
                        value={edicao.descricao}
                        maxLength={5000}
                        placeholder="Acrescente contexto e os créditos da Fonte…"
                        onChange={(e) => editar({ descricao: e.target.value })}
                        className="min-h-[170px] leading-relaxed"
                      />
                      <p className="mt-1.5 text-xs text-fg-3">
                        Inclua os créditos exigidos pela licença da Fonte. {edicao.descricao.length}/5000
                      </p>
                    </div>
                    <div>
                      <label htmlFor="texto-capa" className="mb-2 block text-xs font-medium text-fg-2">
                        Texto na capa
                      </label>
                      <Input
                        id="texto-capa"
                        aria-label="Texto na capa"
                        value={edicao.textoCapa}
                        maxLength={70}
                        placeholder="Uma ideia curta, em poucas palavras"
                        onChange={(e) => editar({ textoCapa: e.target.value })}
                      />
                      <p className="mt-1.5 text-xs text-fg-3">Opcional · até 70 caracteres.</p>
                    </div>
                    <label className="flex min-h-10 cursor-default items-start gap-2.5 border-t border-line pt-4 text-sm text-fg-2">
                      <input
                        type="checkbox"
                        checked={edicao.revisado}
                        disabled={!valido}
                        onChange={(e) => mudar({ revisado: e.target.checked, salvo: false })}
                        className="foco mt-0.5 size-4 accent-(--primary)"
                      />
                      Revisei o título, a descrição e a capa
                    </label>
                    <div className="flex items-center justify-between gap-3">
                      <Button
                        tamanho="sm"
                        variante="fantasma"
                        icone={<Copy size={13} />}
                        onClick={() => void copiar()}
                        disabled={!edicao.titulo.trim()}
                      >
                        Copiar texto
                      </Button>
                      <Button tamanho="sm" onClick={() => ir('/exportar')}>
                        Ir para exportação →
                      </Button>
                    </div>
                  </section>
                  <section aria-label="Capa do Corte">
                    <div className="mb-3 flex justify-between text-xs text-fg-3">
                      <span>Capa · 9:16</span>
                      <span className="timecode">1080 × 1920</span>
                    </div>
                    <div className="relative aspect-9/16 overflow-hidden rounded-md bg-letterbox">
                      <img
                        src={capa}
                        alt={`Capa do Corte: ${edicao.titulo || corte.titulo}`}
                        className="h-full w-full object-cover"
                      />
                      {edicao.textoCapa && (
                        <p
                          className="absolute right-[7%] bottom-[20%] left-[7%] text-center text-xl leading-tight font-semibold break-words text-white"
                          style={{ textShadow: '0 1px 3px #000, 0 0 5px #000' }}
                        >
                          {edicao.textoCapa}
                        </p>
                      )}
                    </div>
                    <div className="mt-3 flex gap-1 overflow-x-auto pb-1" aria-label="Quadros da Fonte">
                      {corte.thumbs.map((thumb, i) => (
                        <button
                          key={thumb}
                          type="button"
                          aria-label={`Usar quadro ${i + 1} como capa`}
                          aria-pressed={!edicao.capaImportada && edicao.quadro === i}
                          onClick={() => {
                            if (edicao.capaImportada) URL.revokeObjectURL(edicao.capaImportada)
                            editar({ quadro: i, capaImportada: null })
                          }}
                          className={cn(
                            'foco h-9 w-8 shrink-0 overflow-hidden rounded-xs border',
                            !edicao.capaImportada && edicao.quadro === i ? 'border-accent-line' : 'border-transparent',
                          )}
                        >
                          <img src={img(thumb)} alt="" className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-fg-3">
                      <span className="timecode">
                        {edicao.capaImportada
                          ? 'Imagem importada'
                          : tc(corte.inicio + ((corte.fim - corte.inicio) * edicao.quadro) / 9)}
                      </span>
                      <Kbd teclas={['←', '→']} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1">
                      <Button
                        tamanho="sm"
                        variante="fantasma"
                        icone={<ImagePlus size={13} />}
                        onClick={() => upload.current?.click()}
                      >
                        Importar…
                      </Button>
                      <Button tamanho="sm" carregando={exportando} onClick={() => void exportarCapa()}>
                        Salvar PNG
                      </Button>
                    </div>
                    <input
                      ref={upload}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      aria-label="Imagem de capa"
                      className="hidden"
                      onChange={(e) => {
                        void importar(e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                    {erroCapa && (
                      <p role="alert" className="mt-2 text-xs text-danger">
                        {erroCapa}
                      </p>
                    )}
                  </section>
                </div>
                <p className="mt-7 border-t border-line pt-4 text-xs text-fg-3">
                  O Empacotamento fica nesta sessão. O Clipes não publica automaticamente.
                </p>
              </>
            )}
          </div>
        </div>
        <ZonaBorda lado="esq" g={sugestoes} />
        <Puxador
          lado="esq"
          g={sugestoes}
          itens={[
            {
              id: 'sugestoes',
              rotulo: 'Sugestões de título',
              icone: <Lightbulb size={16} />,
              atalho: 'S',
              onClick: sugestoes.alternar,
            },
          ]}
        />
        <GavetaBorda lado="esq" g={sugestoes} rotulo="Sugestões de título" largura={350}>
          <CabecalhoGaveta
            acoes={
              <IconButton rotulo="Fechar sugestões" tamanho="sm" onClick={sugestoes.fechar}>
                <X size={15} />
              </IconButton>
            }
          >
            <Lightbulb size={15} />
            <h2 className="text-sm font-medium">Sugestões de título</h2>
            <Kbd atalho="S" />
          </CabecalhoGaveta>
          <div className="flex-1 overflow-auto px-4 py-4">
            <p className="mb-5 text-xs leading-relaxed text-fg-3">
              Exemplos para explorar o tom. Escolha, ajuste e revise antes de salvar.
            </p>
            {[
              corte.titulo,
              `O detalhe que muda a cena: ${corte.titulo.toLowerCase()}`,
              'O que esta cena diz sem palavras',
            ].map((titulo) => (
              <button
                key={titulo}
                type="button"
                onClick={() => {
                  editar({ titulo: titulo.slice(0, 100) })
                  sugestoes.fechar()
                  tituloRef.current?.focus()
                }}
                className="foco mb-1 block w-full rounded-md border-b border-line px-2 py-4 text-left text-sm text-fg-2 hover:bg-hover"
              >
                {titulo}
              </button>
            ))}
            <p className="mt-6 text-xs leading-relaxed text-fg-3">
              No app, as sugestões virão do Provedor escolhido. Nenhuma chamada é feita nesta demonstração.
            </p>
          </div>
        </GavetaBorda>
      </div>
    </Tela>
  )
}
