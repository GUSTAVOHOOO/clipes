import {
  AreaRolagem,
  BannerErroCore,
  Botao,
  ConfirmDialog,
  EstadoTela,
  Progresso,
  Status,
  TabelaGrade,
  cn,
  duracao,
  useToast,
  type ColunaGrade,
  type TomStatus,
} from '@ds'
import { FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { abrirNoSistema } from '~/core/desktop'
import { mensagemDeErro } from '~/core/erros'
import { useFila, type Fila } from '~/core/progresso'
import type { ItemLoteExportacao, LoteExportacao } from '~/stores/filaGlobal'

export type HistoricoLotesProps = {
  projetoId: string
  lotes: LoteExportacao[]
  loteSelecionadoId: number | null
  aoSelecionarLote: (id: number) => void
  aoVoltarProntidao: () => void
  aoRecarregarLotes?: () => Promise<unknown>
  fila?: Fila
  zonaEsquerdaRef?: RefObject<HTMLDivElement | null>
  zonaDireitaRef?: RefObject<HTMLElement | null>
}

function rotuloStatusLote(status: LoteExportacao['status']): {
  tom: TomStatus
  texto: string
} {
  switch (status) {
    case 'running':
      return { tom: 'rodando', texto: 'Em andamento' }
    case 'completed':
      return { tom: 'sucesso', texto: 'Concluído' }
    case 'partial':
      return { tom: 'aviso', texto: 'Concluído com falhas' }
    case 'failed':
      return { tom: 'perigo', texto: 'Falhou' }
    case 'cancelled':
      return { tom: 'neutro', texto: 'Cancelado' }
  }
}

function ehErroDeFonte(code?: string): boolean {
  return code === 'source_offline' || code === 'source_changed' || code === 'source_missing'
}

/**
 * Histórico (Zona C) e Detalhe por Item (Zona D) dos lotes de exportação
 * (`#/projeto/:id/exportacao?sub=lotes`).
 */
export function HistoricoLotes({
  projetoId,
  lotes,
  loteSelecionadoId,
  aoSelecionarLote,
  aoVoltarProntidao,
  aoRecarregarLotes,
  fila,
  zonaEsquerdaRef,
  zonaDireitaRef,
}: HistoricoLotesProps) {
  const toast = useToast()
  const jobsFila = useFila(fila)
  const [apenasFalhas, setApenasFalhas] = useState(false)
  const [detalheLive, setDetalheLive] = useState<LoteExportacao | null>(null)
  const [confirmarCancelamento, setConfirmarCancelamento] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [erroAcao, setErroAcao] = useState<ErroCore | null>(null)
  const ultimaAssinaturaLoteRef = useRef<string | null>(null)

  const lotesOrdenados = useMemo(
    () => [...lotes].sort((a, b) => b.id - a.id),
    [lotes],
  )

  const loteBase = useMemo(() => {
    if (lotesOrdenados.length === 0) return null
    if (loteSelecionadoId !== null) {
      const encontrado = lotesOrdenados.find((l) => l.id === loteSelecionadoId)
      if (encontrado) return encontrado
    }
    return lotesOrdenados[0]
  }, [loteSelecionadoId, lotesOrdenados])

  useEffect(() => {
    setApenasFalhas(false)
    setDetalheLive(null)
    setErroAcao(null)
    ultimaAssinaturaLoteRef.current = null
  }, [loteBase?.id])

  const loteAtivoId = loteBase?.id ?? null

  // Atualiza detalhe por item via export.batch.status quando chegam eventos core-progress do lote selecionado
  useEffect(() => {
    if (loteAtivoId === null) return
    const eventoLote = jobsFila.find((j) => j.id === `export-batch-${loteAtivoId}`)
    if (!eventoLote) return

    const assinatura = `${eventoLote.estado}:${eventoLote.etapa}:${eventoLote.percentual}`
    if (ultimaAssinaturaLoteRef.current === assinatura) return
    ultimaAssinaturaLoteRef.current = assinatura

    let cancelado = false
    void chamar<LoteExportacao>('export.batch.status', { id: loteAtivoId })
      .then((atualizado) => {
        if (!cancelado) setDetalheLive(atualizado)
      })
      .catch((err) => {
        if (!cancelado) setErroAcao(paraErroCore(err))
      })

    if (
      eventoLote.etapa === 'export_batch_complete' ||
      eventoLote.etapa === 'export_batch_cancelled'
    ) {
      void aoRecarregarLotes?.()
    }

    return () => {
      cancelado = true
    }
  }, [aoRecarregarLotes, jobsFila, loteAtivoId])

  const loteDetalhe = useMemo(() => {
    if (!loteBase) return null
    if (detalheLive && detalheLive.id === loteBase.id) {
      return detalheLive
    }
    return loteBase
  }, [detalheLive, loteBase])

  const abrirCaminhoSistema = useCallback(
    async (caminho: string, descricaoCopia: string) => {
      const res = await abrirNoSistema(caminho)
      if (res.copiado) {
        toast.add({
          title: 'Caminho copiado para a área de transferência.',
          description: descricaoCopia,
        })
      }
    },
    [toast],
  )

  const executarCancelamentoLote = useCallback(async () => {
    if (!loteDetalhe || cancelando) return
    setCancelando(true)
    setErroAcao(null)
    try {
      const cancelado = await chamar<LoteExportacao>('export.batch.cancel', {
        id: loteDetalhe.id,
      })
      setDetalheLive(cancelado)
      setConfirmarCancelamento(false)
      toast.add({ title: `Lote #${loteDetalhe.id} cancelado.` })
      await aoRecarregarLotes?.()
    } catch (err) {
      setConfirmarCancelamento(false)
      setErroAcao(paraErroCore(err))
    } finally {
      setCancelando(false)
    }
  }, [aoRecarregarLotes, cancelando, loteDetalhe, toast])

  const encProjeto = encodeURIComponent(projetoId)

  const colunas = useMemo<ColunaGrade<ItemLoteExportacao>[]>(
    () => [
      {
        id: 'pos',
        titulo: '#',
        largura: '42px',
        render: (item) => <span className="num text-t3">{item.position + 1}</span>,
      },
      {
        id: 'corte',
        titulo: 'Corte / Arquivo',
        render: (item) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medio text-t1">{item.title}</span>
            <span className="truncate font-mono text-pequeno text-t3">{item.filename}</span>
          </div>
        ),
      },
      {
        id: 'duracao',
        titulo: 'Duração',
        largura: '84px',
        render: (item) => <span className="num text-t2">{duracao(item.durationUs)}</span>,
      },
      {
        id: 'estado',
        titulo: 'Estado',
        render: (item) => {
          if (item.state === 'completed') {
            return <Status tom="sucesso">Exportado</Status>
          }
          if (item.state === 'running') {
            return (
              <div className="flex min-w-[140px] flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <Status tom="rodando" forte>
                    Exportando
                  </Status>
                  <span className="num text-pequeno text-t2">{Math.round(item.progress)}%</span>
                </div>
                <Progresso
                  valor={item.progress}
                  rotulo={`Progresso de ${item.title}`}
                  compacto
                />
              </div>
            )
          }
          if (item.state === 'failed') {
            const msg = mensagemDeErro(
              new ErroCore(item.error?.code ?? 'export_failed', item.error?.message ?? ''),
            ).titulo
            return (
              <div className="flex flex-col gap-0.5">
                <Status tom="perigo" forte>
                  Falhou
                </Status>
                <span className="text-pequeno text-t2">{msg}</span>
              </div>
            )
          }
          if (item.state === 'cancelled') {
            return <Status tom="neutro">Cancelado</Status>
          }
          return <Status tom="pendente">Na fila</Status>
        },
      },
      {
        id: 'encoder',
        titulo: 'Encoder / Fallback',
        render: (item) => {
          if (item.encoderFallback) {
            return (
              <div className="flex flex-col gap-0.5">
                <Status tom="aviso" forte>
                  Caiu para x264
                </Status>
                <span className="text-micro text-t3">
                  de {item.encoderFallback.from}: {item.encoderFallback.reason}
                </span>
              </div>
            )
          }
          if (item.encoder) {
            return <span className="font-mono text-pequeno text-t2">{item.encoder}</span>
          }
          return <span className="text-t3">—</span>
        },
      },
      {
        id: 'acao',
        titulo: 'Ação',
        alinhar: 'dir',
        render: (item) => {
          if (item.state === 'completed') {
            return (
              <div className="flex justify-end gap-1.5">
                {item.output ? (
                  <Botao
                    tamanho="p"
                    variante="secundario"
                    onClick={() => void abrirCaminhoSistema(item.output!, item.output!)}
                  >
                    Abrir arquivo
                  </Botao>
                ) : (
                  <Botao
                    tamanho="p"
                    variante="secundario"
                    onClick={() =>
                      void abrirCaminhoSistema(loteDetalhe?.outputDir ?? '', item.filename)
                    }
                  >
                    Mostrar na pasta
                  </Botao>
                )}
              </div>
            )
          }
          if (item.state === 'failed') {
            if (ehErroDeFonte(item.error?.code)) {
              return (
                <Botao
                  tamanho="p"
                  variante="secundario"
                  onClick={() => {
                    window.location.hash = `#/projeto/${encProjeto}/fontes/${item.sourceId}`
                  }}
                >
                  Relocalizar Fonte
                </Botao>
              )
            }
            return (
              <Botao
                tamanho="p"
                variante="secundario"
                onClick={() => {
                  const runQ = item.runId ? `?run=${item.runId}` : ''
                  window.location.hash = `#/projeto/${encProjeto}/corte/${item.candidateId}/editar${runQ}`
                }}
              >
                Abrir Corte
              </Botao>
            )
          }
          if (item.state === 'running') {
            return <span className="text-pequeno text-t3">Em execução</span>
          }
          return (
            <Botao
              tamanho="p"
              variante="fantasma"
              onClick={() => {
                const runQ = item.runId ? `?run=${item.runId}` : ''
                window.location.hash = `#/projeto/${encProjeto}/corte/${item.candidateId}/editar${runQ}`
              }}
            >
              Abrir Corte
            </Botao>
          )
        },
      },
    ],
    [abrirCaminhoSistema, encProjeto, loteDetalhe?.outputDir],
  )

  if (lotesOrdenados.length === 0 || !loteDetalhe) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-area bg-area">
        <EstadoTela
          tipo="vazio"
          titulo="Nenhum lote exportado ainda"
          descricao="Dispare uma exportação na aba Prontidão e Lote para acompanhar o histórico e o progresso por item aqui."
          acaoPrimaria={{
            rotulo: 'Voltar para Prontidão e Lote',
            aoAcionar: aoVoltarProntidao,
          }}
        />
      </div>
    )
  }

  const itensExibidos = apenasFalhas
    ? loteDetalhe.items.filter((it) => it.state === 'failed')
    : loteDetalhe.items

  const escopoTexto =
    loteDetalhe.scope === 'source'
      ? `Fonte #${loteDetalhe.sourceId ?? ''}`
      : 'Todo o Projeto'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row">
      {/* Zona C: Lista de Lotes */}
      <div
        ref={zonaEsquerdaRef}
        tabIndex={-1}
        role="region"
        aria-label="Lista de lotes exportados"
        className="foco-interno flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-area bg-area p-2 lg:w-[320px] min-[1440px]:w-[360px]"
      >
        <div className="flex items-center justify-between px-2 py-1.5">
          <h2 className="text-pequeno font-medio text-t2">Lotes de exportação</h2>
          <span className="text-micro text-t3">Mais recentes</span>
        </div>

        <AreaRolagem rotulo="Lista de lotes de exportação" className="min-h-0 flex-1">
          <div className="flex flex-col gap-1 pr-1">
            {lotesOrdenados.map((lote) => {
              const sel = lote.id === loteDetalhe.id
              const st = rotuloStatusLote(lote.status)
              return (
                <button
                  key={lote.id}
                  type="button"
                  aria-pressed={sel}
                  onClick={() => aoSelecionarLote(lote.id)}
                  className={cn(
                    'foco flex w-full cursor-pointer flex-col gap-1.5 rounded-controle border-0 px-3 py-2.5 text-left transition-colors duration-(--dur-rapida) ease-saida',
                    sel ? 'marcado bg-elevado text-t1' : 'bg-transparent text-t2 hover:bg-hover',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="num font-medio text-t1">Lote #{lote.id}</span>
                    <Status tom={st.tom} forte={sel}>
                      {st.texto}
                    </Status>
                  </div>

                  <Progresso
                    valor={lote.progress}
                    rotulo={`Progresso do lote #${lote.id}`}
                    compacto
                  />

                  <div className="flex items-center justify-between gap-2 text-pequeno text-t3">
                    <span>
                      {lote.scope === 'source'
                        ? `Fonte #${lote.sourceId ?? ''}`
                        : 'Todo o Projeto'}
                      {' · '}
                      <span className="num">
                        {lote.counts.completed}/{lote.counts.total}
                      </span>{' '}
                      concluídos
                    </span>
                    <span className="num">{Math.round(lote.progress)}%</span>
                  </div>
                </button>
              )
            })}
          </div>
        </AreaRolagem>
      </div>

      {/* Zona D: Detalhe do Lote selecionado */}
      <section
        ref={zonaDireitaRef}
        tabIndex={-1}
        aria-label={`Detalhe do lote #${loteDetalhe.id}`}
        className="foco-interno flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-titulo font-forte tracking-[-0.01em] text-t1">
              Lote #{loteDetalhe.id} — {escopoTexto} ({loteDetalhe.counts.total} Cortes)
            </h2>
            <p className="truncate font-mono text-pequeno text-t3">
              Pasta: {loteDetalhe.outputDir}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Botao
              variante="secundario"
              icone={<FolderOpen />}
              onClick={() =>
                void abrirCaminhoSistema(loteDetalhe.outputDir, loteDetalhe.outputDir)
              }
            >
              Abrir pasta
            </Botao>
            {loteDetalhe.state === 'running' && (
              <Botao
                variante="perigo"
                onClick={() => setConfirmarCancelamento(true)}
              >
                Cancelar lote
              </Botao>
            )}
          </div>
        </div>

        {erroAcao && (
          <BannerErroCore
            erro={{ code: erroAcao.code, message: erroAcao.detalhe || erroAcao.message }}
            traduzir={(code) =>
              mensagemDeErro(new ErroCore(code, erroAcao.detalhe || erroAcao.message))
            }
            acaoRecuperacao={
              erroAcao.code === 'batch_not_found'
                ? {
                    rotulo: 'Recarregar histórico',
                    aoAcionar: () => {
                      setErroAcao(null)
                      void aoRecarregarLotes?.()
                    },
                  }
                : undefined
            }
            permitirRelato
          />
        )}

        <div className="flex flex-col gap-2 rounded-area bg-area p-3">
          <Progresso
            valor={loteDetalhe.progress}
            rotulo="Progresso total ponderado"
            detalhe={
              <span>
                {Math.round(loteDetalhe.progress)}% ({loteDetalhe.counts.completed} concluídos ·{' '}
                {loteDetalhe.counts.running} exportando · {loteDetalhe.counts.failed} com falha ·{' '}
                {loteDetalhe.counts.queued} na fila
                {loteDetalhe.counts.cancelled > 0
                  ? ` · ${loteDetalhe.counts.cancelled} cancelados`
                  : ''}
                )
              </span>
            }
          />
        </div>

        {loteDetalhe.status === 'partial' && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-area bg-area px-3 py-2"
          >
            <span className="text-pequeno text-t1">
              Lote concluído parcialmente: {loteDetalhe.counts.completed} de{' '}
              {loteDetalhe.counts.total} Cortes exportados e {loteDetalhe.counts.failed} com
              falha.
            </span>
            <Botao
              tamanho="p"
              variante="secundario"
              onClick={() => setApenasFalhas((v) => !v)}
            >
              {apenasFalhas
                ? 'Mostrar todos os itens'
                : `Mostrar apenas falhas (${loteDetalhe.counts.failed})`}
            </Botao>
          </div>
        )}

        <AreaRolagem rotulo={`Itens do lote #${loteDetalhe.id}`} className="min-h-0 flex-1">
          <TabelaGrade
            linhas={itensExibidos}
            colunas={colunas}
            obterId={(item) => `${item.position}-${item.candidateId}`}
            rotulo={`Itens do lote #${loteDetalhe.id}`}
          />
        </AreaRolagem>
      </section>

      <ConfirmDialog
        aberto={confirmarCancelamento}
        aoMudarAberto={(aberto) => {
          if (!aberto && !cancelando) setConfirmarCancelamento(false)
        }}
        titulo={`Cancelar lote #${loteDetalhe.id}?`}
        descricao="Cancelar exportação do lote? Cortes já concluídos serão mantidos."
        rotuloConfirmar="Cancelar lote"
        rotuloCancelar="Cancelar"
        variante="perigo"
        focoInicial="cancelar"
        ocupado={cancelando}
        aoConfirmar={executarCancelamentoLote}
      />
    </div>
  )
}
