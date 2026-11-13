import { useEffect } from 'react'
import { ArrowDownToLine, ArrowLeft, Check, FileVideo, Folder, Pause, Play, RotateCcw, X } from 'lucide-react'
import { cortes, img } from '@/data/dados'
import { useApp, useEdicao } from '@/lib/app'
import { useComandos } from '@/lib/comandos'
import { dur, num } from '@/lib/formato'
import { ir, useRota } from '@/lib/rota'
import { Tela, CabecalhoPagina } from '@/components/shell/Tela'
import { Button, IconButton } from '@/components/ui/Button'
import { Campo, Input } from '@/components/ui/Field'
import { Progresso } from '@/components/ui/Progress'
import { Select } from '@/components/ui/Select'
import { Status } from '@/components/ui/Status'
import { avisar } from '@/components/ui/Toast'
import { EstadoLista } from '@/components/domain/EstadoLista'

type Etapa = 'na-fila' | 'renderizando' | 'concluido' | 'cancelado' | 'erro'
type Trabalho = { id: string; etapa: Etapa; progresso: number; erro?: string }
type Lote = {
  trabalhos: Trabalho[]
  estado: 'pronto' | 'rodando' | 'pausado' | 'cancelado' | 'concluido'
  destino: string
  resolucao: '1080' | '720'
  formato: 'mp4' | 'mov'
}

export default function Exportar() {
  const { projeto, status, setStatus } = useApp()
  const { query } = useRota()
  const estadoRevisao = query.get('estado')
  const solicitado = cortes.find((c) => c.id === query.get('corte'))
  const [lote, mudar] = useEdicao<Lote>(projeto.id, `exportacao:${solicitado?.id ?? 'lote'}`, () => ({
    trabalhos: [],
    estado: 'pronto',
    destino: `${projeto.pasta}\\Exportados`,
    resolucao: '1080',
    formato: 'mp4',
  }))
  const candidatos = solicitado ? [solicitado] : cortes.filter((c) => status[c.id] === 'aprovado')
  const aprovados = candidatos.filter((c) => status[c.id] === 'aprovado' || status[c.id] === 'exportado')
  const erroDemonstrado = estadoRevisao === 'erro' && !lote.trabalhos.length
  const trabalhos: Trabalho[] = erroDemonstrado
    ? [
        {
          id: cortes[0].id,
          etapa: 'erro',
          progresso: 0.36,
          erro: 'Sem espaço no destino. Escolha outra pasta e tente novamente.',
        },
      ]
    : lote.trabalhos.length
      ? lote.trabalhos
      : candidatos.map((c) => ({ id: c.id, etapa: 'na-fila', progresso: 0 }))
  const ocupado = lote.estado === 'rodando' || lote.estado === 'pausado'
  const concluidos = trabalhos.filter((t) => t.etapa === 'concluido').length
  const progresso = trabalhos.length ? trabalhos.reduce((v, t) => v + t.progresso, 0) / trabalhos.length : 0
  const iniciar = () => {
    if (!aprovados.length || !lote.destino.trim()) return
    mudar({ trabalhos: aprovados.map((c) => ({ id: c.id, etapa: 'na-fila', progresso: 0 })), estado: 'rodando' })
  }
  const pausar = () => mudar({ estado: lote.estado === 'pausado' ? 'rodando' : 'pausado' })
  const cancelar = () =>
    mudar((v) => ({
      ...v,
      estado: 'cancelado',
      trabalhos: v.trabalhos.map((t) => (t.etapa === 'concluido' ? t : { ...t, etapa: 'cancelado' })),
    }))
  const repetir = (id: string) => {
    if (status[id] !== 'aprovado' && status[id] !== 'exportado') return
    mudar({
      trabalhos: trabalhos.map((t) => (t.id === id ? { ...t, etapa: 'na-fila', progresso: 0, erro: undefined } : t)),
      estado: 'rodando',
    })
    if (estadoRevisao) ir('/exportar')
  }

  // Novas aprovações substituem a prévia de um lote encerrado, preservando o lote ativo.
  const novosAprovados = aprovados.some((c) => !lote.trabalhos.some((t) => t.id === c.id))
  const trabalhosInvalidos = lote.trabalhos.some((t) => status[t.id] !== 'aprovado' && status[t.id] !== 'exportado')
  useEffect(() => {
    if (trabalhosInvalidos || (!ocupado && lote.trabalhos.length && novosAprovados))
      mudar({ trabalhos: [], estado: 'pronto' })
  }, [ocupado, lote.trabalhos.length, novosAprovados, trabalhosInvalidos, mudar])

  useEffect(() => {
    if (lote.estado !== 'rodando' || trabalhosInvalidos) return
    const ativo = lote.trabalhos.find((t) => t.etapa === 'renderizando' || t.etapa === 'na-fila')
    if (!ativo) {
      mudar({ estado: 'concluido' })
      return
    }
    const timer = window.setTimeout(() => {
      const novo = Math.min(1, ativo.progresso + 0.04)
      mudar((v) => ({
        ...v,
        trabalhos: v.trabalhos.map((t) =>
          t.id === ativo.id ? { ...t, progresso: novo, etapa: novo === 1 ? 'concluido' : 'renderizando' } : t,
        ),
      }))
      if (novo === 1) setStatus(ativo.id, 'exportado')
    }, 400)
    return () => clearTimeout(timer)
  }, [lote, mudar, setStatus, trabalhosInvalidos])

  useComandos([
    {
      id: 'lote-iniciar',
      titulo: 'Simular exportação dos aprovados',
      grupo: 'Exportar',
      atalho: 'Ctrl+Enter',
      executar: iniciar,
      desabilitado: ocupado || !aprovados.length || !lote.destino.trim(),
    },
    {
      id: 'lote-pausa',
      titulo: lote.estado === 'pausado' ? 'Retomar lote' : 'Pausar lote',
      grupo: 'Exportar',
      atalho: 'Space',
      executar: pausar,
      desabilitado: !ocupado,
    },
    {
      id: 'lote-cancelar',
      titulo: 'Cancelar lote',
      grupo: 'Exportar',
      atalho: 'Ctrl+Backspace',
      executar: cancelar,
      desabilitado: !ocupado,
    },
    { id: 'lote-voltar', titulo: 'Voltar à revisão dos Cortes', grupo: 'Exportar', executar: () => ir('/cortes') },
    {
      id: 'lote-aprovar',
      titulo: 'Aprovar Corte para exportar',
      grupo: 'Exportar',
      desabilitado: !solicitado || aprovados.length > 0,
      executar: () => solicitado && setStatus(solicitado.id, 'aprovado'),
    },
    ...trabalhos
      .filter((t) => t.etapa === 'erro' || t.etapa === 'cancelado')
      .map((t) => ({
        id: `lote-repetir-${t.id}`,
        titulo: `Tentar exportar novamente: ${cortes.find((c) => c.id === t.id)?.titulo}`,
        grupo: 'Exportar',
        desabilitado: status[t.id] !== 'aprovado' && status[t.id] !== 'exportado',
        executar: () => repetir(t.id),
      })),
  ])

  const tituloEstado =
    lote.estado === 'pausado'
      ? 'Lote pausado'
      : lote.estado === 'cancelado'
        ? 'Lote cancelado'
        : lote.estado === 'concluido'
          ? 'Simulação concluída'
          : lote.estado === 'rodando'
            ? `Simulando exportação · ${num(progresso * 100, 0)}%`
            : 'Pronto para exportar'
  return (
    <Tela
      titulo="Exportar em lote"
      direita={
        ocupado ? (
          <Button
            icone={lote.estado === 'pausado' ? <Play size={14} /> : <Pause size={14} />}
            atalho="Space"
            onClick={pausar}
          >
            {lote.estado === 'pausado' ? 'Retomar lote' : 'Pausar lote'}
          </Button>
        ) : (
          <Button
            variante="primario"
            icone={<ArrowDownToLine size={14} />}
            atalho="Ctrl+Enter"
            disabled={!aprovados.length || !lote.destino.trim()}
            onClick={iniciar}
          >
            Simular exportação
          </Button>
        )
      }
      className="overflow-auto"
    >
      <div className="mx-auto max-w-[1120px] px-10 py-8">
        <CabecalhoPagina
          titulo="Exportar em lote"
          descricao="Os Cortes aprovados, com suas edições, legenda e Empacotamento."
          acoes={
            <Button variante="fantasma" tamanho="sm" icone={<ArrowLeft size={13} />} onClick={() => ir('/cortes')}>
              Voltar à revisão
            </Button>
          }
        />
        {solicitado && (
          <div className="mt-5 flex items-center justify-between gap-4 border-y border-line py-3 text-sm">
            <p className="text-fg-2">
              Exportação individual · somente este Corte.
              {!aprovados.length && <span className="ml-2 text-warning">Revise e aprove antes de exportar.</span>}
            </p>
            {!aprovados.length && (
              <Button onClick={() => setStatus(solicitado.id, 'aprovado')}>Aprovar Corte para exportar</Button>
            )}
            <a
              className="foco inline-flex min-h-8 items-center text-xs text-fg-3 underline underline-offset-4"
              href="#/exportar"
            >
              Ver lote de aprovados
            </a>
          </div>
        )}
        <div className="mt-7 grid grid-cols-[minmax(300px,1fr)_170px_150px] items-start gap-4 border-y border-line bg-surface px-5 py-5">
          <Campo rotulo="Pasta de destino" descricao="Caminho de demonstração; nenhum arquivo é gravado.">
            <Input
              aria-label="Pasta de destino"
              prefixo={<Folder size={14} />}
              mono
              value={lote.destino}
              disabled={ocupado}
              onChange={(e) => mudar({ destino: e.target.value })}
            />
          </Campo>
          <Campo rotulo="Resolução">
            <Select
              valor={lote.resolucao}
              onChange={(resolucao) => mudar({ resolucao })}
              rotulo="Resolução"
              desabilitado={ocupado}
              opcoes={[
                { valor: '1080', rotulo: '1080 × 1920' },
                { valor: '720', rotulo: '720 × 1280' },
              ]}
              className="w-full min-w-0"
            />
          </Campo>
          <Campo rotulo="Formato">
            <Select
              valor={lote.formato}
              onChange={(formato) => mudar({ formato })}
              rotulo="Formato"
              desabilitado={ocupado}
              opcoes={[
                { valor: 'mp4', rotulo: 'MP4 · H.264' },
                { valor: 'mov', rotulo: 'MOV · ProRes' },
              ]}
              className="w-full min-w-0"
            />
          </Campo>
        </div>
        {estadoRevisao === 'carregando' || estadoRevisao === 'vazio' || !trabalhos.length ? (
          <EstadoLista
            estado={estadoRevisao}
            titulo="Escolha o que merece sair"
            descricao="Aprove pelo menos um Corte na revisão. Ele aparece aqui com a legenda e o enquadramento que você ajustou."
            acao={estadoRevisao !== 'carregando' ? 'Revisar Cortes' : undefined}
            onAcao={() => ir('/cortes')}
          />
        ) : (
          <section className="mt-8" aria-label="Fila de exportação">
            <div className="flex items-center justify-between gap-4 pb-4">
              <div className="flex items-center gap-2">
                <Status
                  tom={lote.estado === 'concluido' ? 'sucesso' : lote.estado === 'rodando' ? 'andamento' : 'neutro'}
                >
                  <span aria-live="polite">{tituloEstado}</span>
                </Status>
                <span className="text-xs text-fg-3">
                  · {concluidos} de {trabalhos.length} {trabalhos.length === 1 ? 'Corte' : 'Cortes'}
                </span>
              </div>
              {ocupado && (
                <Button tamanho="sm" variante="fantasma" icone={<X size={13} />} onClick={cancelar}>
                  Cancelar lote
                </Button>
              )}
            </div>
            {lote.trabalhos.length > 0 && (
              <Progresso className="mb-4" valor={progresso} rotulo={`Lote: ${num(progresso * 100, 0)}%`} />
            )}
            <ul className="divide-y divide-line border-y border-line">
              {trabalhos.map((t) => {
                const c = cortes.find((c) => c.id === t.id)!
                return (
                  <li key={t.id} className="flex items-center gap-4 py-4">
                    <img src={img(c.wide)} alt="" className="h-16 w-28 shrink-0 rounded-sm object-cover" />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-medium">{c.titulo}</h2>
                      <p className="mt-1 text-xs text-fg-3">{dur(c.fim - c.inicio)} · 9:16 · legenda karaokê</p>
                      <p className="timecode mt-1 truncate text-2xs text-fg-3">
                        {c.id}-{c.titulo.toLocaleLowerCase('pt-BR').replaceAll(' ', '-')}.{lote.formato}
                      </p>
                      {t.erro && <p className="mt-2 max-w-[60ch] text-xs text-danger">{t.erro}</p>}
                    </div>
                    <div className="w-44 shrink-0">
                      {t.etapa === 'erro' ? (
                        <Status tom="perigo">Falha na exportação</Status>
                      ) : t.etapa === 'concluido' ? (
                        <Status tom="sucesso">Concluído · simulação</Status>
                      ) : t.etapa === 'cancelado' ? (
                        <Status tom="rejeitado">Cancelado</Status>
                      ) : t.etapa === 'renderizando' ? (
                        <>
                          <Status tom={lote.estado === 'pausado' ? 'espera' : 'andamento'}>
                            {lote.estado === 'pausado' ? 'Pausado' : 'Renderizando'} · {num(t.progresso * 100, 0)}%
                          </Status>
                          <Progresso className="mt-2" valor={t.progresso} rotulo={`Renderização ${c.titulo}`} />
                        </>
                      ) : (
                        <Status tom="espera">
                          {lote.trabalhos.length
                            ? 'Na fila'
                            : status[c.id] === 'aprovado' || status[c.id] === 'exportado'
                              ? 'Aprovado · pronto'
                              : 'Aguardando aprovação'}
                        </Status>
                      )}
                    </div>
                    <div className="flex w-28 shrink-0 justify-end">
                      {(t.etapa === 'erro' || t.etapa === 'cancelado') && (
                        <Button tamanho="sm" icone={<RotateCcw size={13} />} onClick={() => repetir(t.id)}>
                          Tentar de novo
                        </Button>
                      )}
                      {t.etapa === 'concluido' && (
                        <IconButton
                          rotulo="Informações do arquivo de demonstração"
                          onClick={() =>
                            avisar(
                              'Simulação concluída',
                              'A exportação de arquivos depende do núcleo desktop. Nenhum arquivo foi criado.',
                            )
                          }
                        >
                          <Check size={15} />
                        </IconButton>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            <div className="mt-4 flex items-center justify-between gap-3 text-xs text-fg-3">
              <span className="flex items-center gap-1.5">
                <FileVideo size={13} />
                Demonstração do fluxo · sem renderização de arquivos
              </span>
              <span>Processamento local · uma exportação por vez</span>
            </div>
          </section>
        )}
      </div>
    </Tela>
  )
}
