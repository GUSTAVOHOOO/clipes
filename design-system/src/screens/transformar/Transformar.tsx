import { Check, FileText, Mic, Save, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ContextoCorte, useCorteDaRota } from '@/components/shell/ContextoCorte'
import { CabecalhoGaveta, GavetaBorda, Puxador, useGaveta, ZonaBorda } from '@/components/shell/Gaveta'
import { Tela } from '@/components/shell/Tela'
import { Button, IconButton } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Field'
import { Kbd } from '@/components/ui/Kbd'
import { Progresso } from '@/components/ui/Progress'
import { Status } from '@/components/ui/Status'
import { avisar } from '@/components/ui/Toast'
import { img } from '@/data/dados'
import { useEdicao } from '@/lib/app'
import { useComandos } from '@/lib/comandos'
import { dur, tc } from '@/lib/formato'
import { ir, useRota } from '@/lib/rota'
import { Narracao } from './Narracao'
import { transformacaoInicial } from './modelo'

export default function Transformar() {
  const { corte } = useCorteDaRota()
  return <TransformarCorte key={corte.id} />
}

function TransformarCorte() {
  const { corte } = useCorteDaRota()
  const { query } = useRota()
  const [edicao, mudar] = useEdicao(corte.id, 'transformacao', () => transformacaoInicial(corte.titulo))
  const [estado, setEstado] = useState(query.get('estado'))
  const fonte = useGaveta()
  const narracao = useGaveta(query.get('painel') === 'narracao' ? 'fixa' : null)
  const roteiroRef = useRef<HTMLTextAreaElement>(null)
  const palavras = (estado === 'vazio' ? '' : edicao.roteiro).trim().split(/\s+/).filter(Boolean).length
  const aprovado = estado !== 'vazio' && edicao.revisado && edicao.salvo
  const valido = palavras >= 10
  const estadoPedido = query.get('estado')
  const painelPedido = query.get('painel')
  useEffect(() => {
    setEstado(estadoPedido)
  }, [estadoPedido])
  useEffect(() => {
    if (painelPedido === 'narracao') narracao.fixar()
    else narracao.fechar()
  }, [painelPedido, narracao.fixar, narracao.fechar])

  function salvar() {
    if (!valido) {
      roteiroRef.current?.focus()
      return
    }
    mudar({ salvo: true })
    avisar.sucesso(edicao.revisado ? 'Roteiro aprovado nesta sessão' : 'Rascunho salvo nesta sessão')
  }
  function revisar(v: boolean) {
    mudar({ revisado: v, salvo: false, ttsDemonstrado: false })
  }

  useComandos([
    {
      id: 'transformar-salvar',
      titulo: 'Salvar Roteiro',
      grupo: 'Roteiro',
      atalho: 'Ctrl+S',
      desabilitado: !valido,
      executar: salvar,
    },
    {
      id: 'transformar-narracao',
      titulo: 'Mostrar Narração',
      grupo: 'Mostrar',
      atalho: 'N',
      executar: narracao.alternar,
    },
    {
      id: 'transformar-fonte',
      titulo: 'Mostrar Transcrição da Fonte',
      grupo: 'Mostrar',
      atalho: 'T',
      executar: fonte.alternar,
    },
    {
      id: 'transformar-revisar',
      titulo: edicao.revisado ? 'Retirar aprovação do Roteiro' : 'Aprovar versão do Roteiro',
      grupo: 'Roteiro',
      desabilitado: !valido,
      executar: () => revisar(!edicao.revisado),
    },
    {
      id: 'transformar-editar',
      titulo: 'Escrever no Roteiro',
      grupo: 'Roteiro',
      atalho: 'R',
      executar: () => roteiroRef.current?.focus(),
    },
    {
      id: 'transformar-proxima',
      titulo: 'Continuar para Empacotamento',
      grupo: 'Corte',
      executar: () => ir(`/corte/${corte.id}/empacotar`),
    },
    {
      id: 'transformar-fechar',
      titulo: 'Fechar ferramentas',
      grupo: 'Mostrar',
      atalho: 'Escape',
      oculto: true,
      executar: () => {
        fonte.fechar()
        narracao.fechar()
      },
    },
  ])

  return (
    <Tela
      titulo="Vídeo transformado"
      meio={<ContextoCorte />}
      direita={
        <Button
          variante="primario"
          icone={<Save size={14} />}
          atalho="Ctrl+S"
          disabled={!valido}
          onClick={salvar}
          aria-label="Salvar Roteiro"
        >
          Salvar Roteiro
        </Button>
      }
    >
      <div className="relative h-full overflow-hidden">
        <div
          className="h-full overflow-auto"
          onPointerDown={(e) => {
            if (!(e.target as HTMLElement).closest('button,input')) {
              fonte.fechar()
              narracao.fechar()
            }
          }}
        >
          <div className="mx-auto max-w-[1000px] px-16 pt-10 pb-8">
            {estado === 'carregando' ? (
              <div className="mx-auto max-w-[620px] space-y-5 py-16" aria-busy="true">
                <p className="text-fg-2">Carregando Roteiro…</p>
                <Progresso valor={null} rotulo="Carregando Roteiro" />
              </div>
            ) : estado === 'erro' ? (
              <div className="mx-auto max-w-[620px] py-16">
                <Status tom="perigo">O Roteiro não pôde ser carregado.</Status>
                <p className="mt-3 text-sm text-fg-2">As edições desta sessão continuam disponíveis.</p>
                <Button className="mt-5" onClick={() => setEstado(null)}>
                  Tentar novamente
                </Button>
              </div>
            ) : (
              <>
                <div className="mb-7 flex items-start justify-between gap-8">
                  <div>
                    <h1 className="text-xl font-semibold">Dê outro sentido à cena</h1>
                    <p className="mt-2 max-w-[64ch] text-sm text-fg-2">
                      Acrescente seu comentário ou análise. Revise o Roteiro antes de criar a Narração.
                    </p>
                  </div>
                  <Button
                    tamanho="sm"
                    variante="fantasma"
                    icone={<Mic size={14} />}
                    atalho="N"
                    onClick={narracao.alternar}
                  >
                    Narração
                  </Button>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_190px] items-start gap-10">
                  <section className="min-w-0" aria-label="Revisão do Roteiro">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <label htmlFor="roteiro" className="text-sm font-medium">
                        Roteiro
                      </label>
                      <span role="status" aria-label="Estado do Roteiro">
                        <Status tom={aprovado ? 'sucesso' : 'rascunho'}>
                          {aprovado ? 'Roteiro aprovado' : edicao.salvo ? 'Rascunho salvo' : 'Revisão pendente'}
                        </Status>
                      </span>
                    </div>
                    <Textarea
                      ref={roteiroRef}
                      id="roteiro"
                      aria-label="Roteiro"
                      placeholder="Comece pelo que você quer acrescentar à cena…"
                      value={estado === 'vazio' ? '' : edicao.roteiro}
                      onChange={(e) => {
                        setEstado(null)
                        mudar({ roteiro: e.target.value, revisado: false, salvo: false, ttsDemonstrado: false })
                      }}
                      className="min-h-[310px] resize-none px-4 py-4 text-md leading-[1.85]"
                    />
                    <div className="mt-2 flex justify-between gap-4 text-xs text-fg-3">
                      <span>
                        {estado === 'vazio' ? 0 : palavras} palavras · cerca de {dur(palavras / 2.5)} de fala
                      </span>
                      <span>
                        Escrever <Kbd atalho="R" />
                      </span>
                    </div>
                    {!valido && (
                      <p className="mt-2 text-xs text-warning">Escreva pelo menos 10 palavras para salvar e revisar.</p>
                    )}
                    <label className="mt-6 flex min-h-6 cursor-default items-start gap-2.5 text-sm text-fg-2">
                      <input
                        type="checkbox"
                        className="foco mt-0.5 size-4 accent-(--primary)"
                        checked={edicao.revisado}
                        disabled={!valido || estado === 'vazio'}
                        onChange={(e) => revisar(e.target.checked)}
                      />
                      Revisei o Roteiro e aprovo esta versão para Narração
                    </label>
                    <p className="mt-2 pl-[26px] text-xs text-fg-3">
                      Editar o texto retira a aprovação. Salve para confirmar a versão revisada.
                    </p>
                    <div className="mt-7 flex items-center justify-between border-t border-line pt-4 text-xs text-fg-3">
                      <span>
                        {edicao.audio
                          ? 'Narração disponível nesta sessão'
                          : 'A Narração começa com um Roteiro revisado'}
                      </span>
                      <Button tamanho="sm" variante="fantasma" onClick={() => ir(`/corte/${corte.id}/empacotar`)}>
                        Empacotar →
                      </Button>
                    </div>
                  </section>
                  <aside aria-label="Referência da Fonte" className="pt-0.5">
                    <p className="mb-3 text-xs text-fg-3">Cena de referência</p>
                    <img
                      src={img(corte.vert)}
                      alt={`Cena de ${corte.titulo}`}
                      className="aspect-9/16 w-full rounded-md object-cover"
                    />
                    <div className="mt-3 flex justify-between text-xs text-fg-3">
                      <span>Corte original</span>
                      <span className="timecode">{tc(corte.fim - corte.inicio)}</span>
                    </div>
                    <p className="mt-4 text-xs leading-relaxed text-fg-3">
                      Legenda e enquadramento acompanham o Corte. Sua contribuição vem do Roteiro e da Narração.
                    </p>
                  </aside>
                </div>
              </>
            )}
          </div>
        </div>
        <ZonaBorda lado="esq" g={fonte} />
        <ZonaBorda lado="dir" g={narracao} />
        <Puxador
          lado="esq"
          g={fonte}
          itens={[
            {
              id: 'fonte',
              rotulo: 'Transcrição da Fonte',
              icone: <FileText size={16} />,
              atalho: 'T',
              onClick: fonte.alternar,
            },
          ]}
        />
        <Puxador
          lado="dir"
          g={narracao}
          itens={[
            { id: 'narracao', rotulo: 'Narração', icone: <Mic size={16} />, atalho: 'N', onClick: narracao.alternar },
          ]}
        />
        <GavetaBorda lado="esq" g={fonte} rotulo="Transcrição da Fonte" largura={330}>
          <CabecalhoGaveta
            acoes={
              <IconButton rotulo="Fechar Transcrição" tamanho="sm" onClick={fonte.fechar}>
                <X size={15} />
              </IconButton>
            }
          >
            <FileText size={15} />
            <h2 className="text-sm font-medium">Transcrição da Fonte</h2>
            <Kbd atalho="T" />
          </CabecalhoGaveta>
          <div className="flex-1 overflow-auto px-4 py-4">
            <p className="mb-5 text-xs text-fg-3">Use a fala como referência para seu comentário.</p>
            {corte.frases.map((f) => (
              <div key={f.id} className="mb-4">
                <span className="timecode text-2xs text-fg-3">{tc(f.s)}</span>
                <p className="mt-1 text-sm leading-relaxed text-fg-2">{f.texto}</p>
              </div>
            ))}
          </div>
        </GavetaBorda>
        <GavetaBorda lado="dir" g={narracao} rotulo="Narração" largura={410}>
          <CabecalhoGaveta
            acoes={
              <IconButton rotulo="Fechar Narração" tamanho="sm" onClick={narracao.fechar}>
                <X size={15} />
              </IconButton>
            }
          >
            <Mic size={15} />
            <h2 className="text-sm font-medium">Narração</h2>
            <Kbd atalho="N" />
            {aprovado && <Check size={13} className="ml-auto text-success" />}
          </CabecalhoGaveta>
          <Narracao edicao={edicao} mudar={mudar} aprovado={aprovado} ativo={narracao.aberta} />
        </GavetaBorda>
      </div>
    </Tela>
  )
}
