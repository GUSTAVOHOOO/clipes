import {
  BannerErroCore,
  Botao,
  Campo,
  Checkbox,
  ConfirmDialog,
  Dialogo,
  Entrada,
  Progresso,
  Status,
  TabelaGrade,
  usd,
  useToast,
  type ColunaGrade,
  type TomStatus,
} from '@ds'
import { useCallback, useMemo, useState } from 'react'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import type { Job } from '~/core/progresso'
import type { LoteFontes, LoteItem } from '~/stores/fontesProjeto'

export type ListaLotesProps = {
  projetoId: string
  lotes: LoteFontes[]
  jobsAtivos?: Job[]
  aoAtualizar: () => Promise<void>
  aoAbrirFila?: () => void
}

function statusLote(lote: LoteFontes): { tom: TomStatus; texto: string } {
  switch (lote.status) {
    case 'running':
      return { tom: 'rodando', texto: `Em execução (${lote.counts.completed}/${lote.counts.total})` }
    case 'paused':
      return { tom: 'pausado', texto: 'Pausado pelo usuário' }
    case 'budget_paused':
      return { tom: 'aviso', texto: 'Pausado por orçamento' }
    case 'attention':
      return {
        tom: 'aviso',
        texto: `Requer atenção (${lote.counts.paused} ${lote.counts.paused === 1 ? 'pausada' : 'pausadas'})`,
      }
    case 'completed':
      return { tom: 'sucesso', texto: 'Concluído' }
    case 'cancelled':
      return { tom: 'neutro', texto: 'Cancelado' }
  }
}

function traduzirCausaItem(codigo: string | null): string {
  if (!codigo) return 'Pausado'
  if (codigo === 'provider_http') return 'Provedor recusou a chamada'
  return mensagemDeErro(new ErroCore(codigo, '')).titulo
}

function statusItem(item: LoteItem): { tom: TomStatus; texto: string; detalhe?: string } {
  switch (item.state) {
    case 'pending':
      return { tom: 'pendente', texto: 'Na fila' }
    case 'transcribing':
      return { tom: 'rodando', texto: 'Transcrevendo' }
    case 'selecting':
      return { tom: 'rodando', texto: 'Selecionando Cortes' }
    case 'completed':
      return { tom: 'sucesso', texto: 'Concluído' }
    case 'paused':
      return { tom: 'aviso', texto: 'Pausado', detalhe: traduzirCausaItem(item.error) }
    case 'cancelled':
      return { tom: 'neutro', texto: 'Cancelado' }
  }
}

function progressoItem(item: LoteItem, jobsAtivos: Job[]): number {
  let pct = item.progress ?? (item.state === 'completed' ? 100 : 0)
  if (item.transcriptionJob != null) {
    const j = jobsAtivos.find((job) => job.id === String(item.transcriptionJob))
    if (j && (item.state === 'transcribing' || j.estado === 'rodando')) {
      pct = Math.max(pct, Math.round(j.percentual))
    }
  }
  if (item.selectionRun != null) {
    const j = jobsAtivos.find((job) => job.id === `selection-${item.selectionRun}`)
    if (j && (item.state === 'selecting' || j.estado === 'rodando')) {
      pct = Math.max(pct, Math.round(j.percentual))
    }
  }
  return Math.min(100, Math.max(0, Math.round(pct)))
}

function rotuloProgressoItem(item: LoteItem): string {
  switch (item.state) {
    case 'transcribing':
      return 'Transcrição'
    case 'selecting':
      return 'Seleção'
    case 'completed':
      return 'Concluído'
    case 'paused':
      return 'Pausado'
    case 'cancelled':
      return 'Cancelado'
    default:
      return 'Na fila'
  }
}

type ConfirmacaoRetomadaItem = {
  loteId: number
  item: LoteItem
  codigo: string
  estimativa: { kind?: string; minMicroUsd?: number; maxMicroUsd?: number } | null
}

/** Lista de Lotes de Fontes com grid navegável por setas, controles e resolução de pausas. */
export function ListaLotes({
  projetoId,
  lotes,
  jobsAtivos = [],
  aoAtualizar,
  aoAbrirFila,
}: ListaLotesProps) {
  const toast = useToast()
  const encProjeto = encodeURIComponent(projetoId)

  const [ocupadoId, setOcupadoId] = useState<string | null>(null)
  const [erroAcao, setErroAcao] = useState<ErroCore | null>(null)
  const [loteCancelar, setLoteCancelar] = useState<LoteFontes | null>(null)
  const [confirmacaoItem, setConfirmacaoItem] = useState<ConfirmacaoRetomadaItem | null>(null)
  const [itensIncertos, setItensIncertos] = useState<Record<string, boolean>>({})

  const [loteOrcamento, setLoteOrcamento] = useState<LoteFontes | null>(null)
  const [tetoOrcamentoTexto, setTetoOrcamentoTexto] = useState('')
  const [cienciaDesconhecido, setCienciaDesconhecido] = useState(false)
  const [exigeCienciaDesconhecido, setExigeCienciaDesconhecido] = useState(false)
  const [erroOrcamento, setErroOrcamento] = useState<string | null>(null)

  const abrirFila = useCallback(() => {
    if (aoAbrirFila) {
      aoAbrirFila()
      return
    }
    const ev = new KeyboardEvent('keydown', {
      key: 'j',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    const naoCancelado = window.dispatchEvent(ev)
    if (naoCancelado) {
      toast.add({
        title: 'Fila de Jobs',
        description: 'Use Ctrl+J ou o botão Fila no topo para resolver tarefas incertas.',
      })
    }
  }, [aoAbrirFila, toast])

  const executarControleLote = async (
    comando: 'batches.pause' | 'batches.resume' | 'batches.cancel',
    lote: LoteFontes,
  ) => {
    const chave = `${comando}:${lote.id}`
    setOcupadoId(chave)
    setErroAcao(null)
    try {
      await chamar(comando, { id: lote.id })
      setLoteCancelar(null)
      await aoAtualizar()
    } catch (err) {
      setErroAcao(paraErroCore(err))
    } finally {
      setOcupadoId(null)
    }
  }

  const retomarItem = async (loteId: number, item: LoteItem, confirmar: boolean) => {
    const chave = `resume:${loteId}:${item.sourceId}`
    setOcupadoId(chave)
    setErroAcao(null)
    try {
      await chamar('batches.item.resume', {
        id: loteId,
        sourceId: item.sourceId,
        ...(confirmar ? { confirmed: true } : {}),
      })
      setConfirmacaoItem(null)
      await aoAtualizar()
    } catch (err) {
      const coreErr = paraErroCore(err)
      if (coreErr.code === 'uncertain_job') {
        setItensIncertos((prev) => ({ ...prev, [`${loteId}:${item.sourceId}`]: true }))
        setConfirmacaoItem(null)
        setErroAcao(coreErr)
      } else if (
        (coreErr.code === 'confirmation_required' ||
          coreErr.code === 'transcription_retry_confirmation') &&
        !confirmar
      ) {
        const usage = coreErr.usage as { estimate?: ConfirmacaoRetomadaItem['estimativa'] } | undefined
        setConfirmacaoItem({
          loteId,
          item,
          codigo: coreErr.code,
          estimativa: usage?.estimate ?? null,
        })
      } else {
        setConfirmacaoItem(null)
        setErroAcao(coreErr)
      }
    } finally {
      setOcupadoId(null)
    }
  }

  const abrirModalOrcamento = (lote: LoteFontes) => {
    const cap = lote.budget?.maxCostMicroUsd
    setLoteOrcamento(lote)
    setTetoOrcamentoTexto(cap != null ? (cap / 1_000_000).toFixed(2) : '')
    const ehDesconhecido =
      lote.pause === 'cost_unknown' || lote.budget?.paused === 'cost_unknown'
    setExigeCienciaDesconhecido(ehDesconhecido)
    setCienciaDesconhecido(false)
    setErroOrcamento(null)
  }

  const confirmarOrcamento = async () => {
    if (!loteOrcamento) return
    setErroOrcamento(null)

    const limpo = tetoOrcamentoTexto.trim().replace(',', '.')
    let maxCostMicroUsd: number | null = null
    if (limpo !== '') {
      const val = Number(limpo)
      if (!Number.isFinite(val) || val < 0) {
        setErroOrcamento('Informe um teto numérico em USD maior ou igual a zero.')
        return
      }
      maxCostMicroUsd = Math.round(val * 1_000_000)
    }

    const chave = `budget:${loteOrcamento.id}`
    setOcupadoId(chave)
    try {
      await chamar('jobs.budget.continue', {
        scope: 'batch',
        key: `sources-${loteOrcamento.id}`,
        maxCostMicroUsd,
        ...(cienciaDesconhecido ? { confirmed: true } : {}),
      })
      setLoteOrcamento(null)
      await aoAtualizar()
    } catch (err) {
      const coreErr = paraErroCore(err)
      const usage = coreErr.usage as { reason?: string } | undefined
      if (coreErr.code === 'confirmation_required' && usage?.reason === 'cost_unknown') {
        setExigeCienciaDesconhecido(true)
        setErroOrcamento('Confirme a ciência de custo desconhecido para continuar.')
      } else {
        setErroOrcamento(mensagemDeErro(coreErr).titulo)
      }
    } finally {
      setOcupadoId(null)
    }
  }

  const traducaoErroAcao = erroAcao ? mensagemDeErro(erroAcao) : null

  const colunasBase = useMemo(
    () =>
      (lote: LoteFontes): ColunaGrade<LoteItem>[] => [
        {
          id: 'pos',
          titulo: '#',
          largura: '36px',
          render: (item) => <span className="num text-t3">{item.position + 1}</span>,
        },
        {
          id: 'fonte',
          titulo: 'Fonte',
          render: (item) => <span className="font-medio text-t1">{item.name}</span>,
        },
        {
          id: 'estado',
          titulo: 'Etapa / Estado',
          render: (item) => {
            const st = statusItem(item)
            return (
              <div className="flex min-w-0 flex-col py-1">
                <Status tom={st.tom}>{st.texto}</Status>
                {st.detalhe && <span className="text-pequeno text-t3">{st.detalhe}</span>}
              </div>
            )
          },
        },
        {
          id: 'progresso',
          titulo: 'Progresso',
          largura: '148px',
          render: (item) => {
            const pct = progressoItem(item, jobsAtivos)
            return (
              <Progresso
                valor={pct}
                rotulo={rotuloProgressoItem(item)}
                detalhe={`${pct}%`}
              />
            )
          },
        },
        {
          id: 'acao',
          titulo: 'Ação',
          alinhar: 'dir',
          render: (item) => {
            const chaveIncerto = `${lote.id}:${item.sourceId}`
            const ehIncerto =
              item.state === 'paused' &&
              (item.error === 'timeout_uncertain' || Boolean(itensIncertos[chaveIncerto]))

            return (
              <div className="flex items-center justify-end gap-1.5">
                {item.state === 'paused' &&
                  (ehIncerto ? (
                    <Botao tamanho="p" variante="secundario" onClick={abrirFila}>
                      Resolver na Fila de Jobs
                    </Botao>
                  ) : (
                    <Botao
                      tamanho="p"
                      variante="secundario"
                      carregando={ocupadoId === `resume:${lote.id}:${item.sourceId}`}
                      onClick={() => void retomarItem(lote.id, item, false)}
                    >
                      Retomar item
                    </Botao>
                  ))}

                {item.state === 'completed' && item.selectionRun != null && (
                  <Botao
                    tamanho="p"
                    variante="secundario"
                    onClick={() => {
                      window.location.hash = `#/projeto/${encProjeto}/cortes?fonte=${item.sourceId}&run=${item.selectionRun}`
                    }}
                  >
                    Revisar Cortes →
                  </Botao>
                )}

                <Botao
                  tamanho="p"
                  variante="fantasma"
                  onClick={() => {
                    window.location.hash = `#/projeto/${encProjeto}/fontes/${item.sourceId}`
                  }}
                >
                  Abrir
                </Botao>
              </div>
            )
          },
        },
      ],
    [abrirFila, encProjeto, itensIncertos, jobsAtivos, ocupadoId],
  )

  return (
    <div className="flex flex-col gap-3">
      {erroAcao && traducaoErroAcao && (
        <BannerErroCore
          erro={{
            code: erroAcao.code,
            message: erroAcao.detalhe || erroAcao.message,
          }}
          traduzir={() => ({ titulo: traducaoErroAcao.titulo })}
          acaoRecuperacao={
            traducaoErroAcao.recuperacao?.acao === 'abrir-fila'
              ? { rotulo: traducaoErroAcao.recuperacao.rotulo, aoAcionar: abrirFila }
              : traducaoErroAcao.recuperacao?.rota
                ? {
                    rotulo: traducaoErroAcao.recuperacao.rotulo,
                    aoAcionar: () => {
                      window.location.hash = traducaoErroAcao.recuperacao!.rota!
                    },
                  }
                : undefined
          }
          aoDispensar={() => setErroAcao(null)}
        />
      )}

      {lotes.map((lote) => {
        const st = statusLote(lote)
        const gastoTexto =
          lote.budget?.usage?.costLabel ?? usd(lote.budget?.usage?.microUsd ?? 0)
        const tetoTexto =
          lote.budget?.maxCostMicroUsd != null ? usd(lote.budget.maxCostMicroUsd) : 'Sem teto'
        const faixaTexto =
          lote.minUs != null && lote.maxUs != null
            ? `${Math.round(lote.minUs / 1_000_000)}–${Math.round(lote.maxUs / 1_000_000)} s`
            : null

        return (
          <article
            key={lote.id}
            aria-label={`Lote #${lote.id}`}
            className="flex flex-col gap-2.5 rounded-area bg-area p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="num text-base font-forte text-t1">Lote #{lote.id}</h3>
                <Status tom={st.tom} forte>
                  {st.texto}
                </Status>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {lote.status === 'running' && (
                  <Botao
                    tamanho="p"
                    variante="secundario"
                    carregando={ocupadoId === `batches.pause:${lote.id}`}
                    onClick={() => void executarControleLote('batches.pause', lote)}
                  >
                    Pausar lote
                  </Botao>
                )}
                {lote.status === 'paused' && (
                  <Botao
                    tamanho="p"
                    variante="secundario"
                    carregando={ocupadoId === `batches.resume:${lote.id}`}
                    onClick={() => void executarControleLote('batches.resume', lote)}
                  >
                    Retomar lote
                  </Botao>
                )}
                {lote.status !== 'completed' && lote.status !== 'cancelled' && (
                  <Botao
                    tamanho="p"
                    variante="perigo"
                    onClick={() => setLoteCancelar(lote)}
                  >
                    Cancelar lote
                  </Botao>
                )}
              </div>
            </div>

            <p className="num text-pequeno text-t3">
              {[
                `Motor: ${lote.engine === 'groq' ? 'Groq (remoto)' : 'Local'}`,
                lote.videoKind === 'transformed' ? 'Vídeo transformado' : 'Corte direto',
                faixaTexto ? `Duração: ${faixaTexto}` : null,
                `Teto: ${tetoTexto}`,
                `Gasto até agora: ${gastoTexto}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>

            {lote.status === 'budget_paused' && (
              <div
                role="status"
                className="flex flex-wrap items-center justify-between gap-2 rounded-controle bg-elevado px-3 py-2"
              >
                <p className="num text-pequeno text-t1">
                  {lote.pause === 'cost_unknown' || lote.budget?.paused === 'cost_unknown'
                    ? 'Lote pausado porque o custo do Provedor é desconhecido.'
                    : `Gasto acumulado (${gastoTexto}) atingiu o teto configurado (${tetoTexto}).`}
                </p>
                <Botao
                  tamanho="p"
                  variante="secundario"
                  onClick={() => abrirModalOrcamento(lote)}
                >
                  Ajustar orçamento e continuar
                </Botao>
              </div>
            )}

            {lote.status === 'attention' && (
              <div role="status" className="rounded-controle bg-elevado px-3 py-2 text-pequeno text-t2">
                {lote.counts.completed} {lote.counts.completed === 1 ? 'Fonte já concluiu' : 'Fontes já concluíram'} e pode ser revisada em Cortes;{' '}
                {lote.counts.paused} {lote.counts.paused === 1 ? 'Fonte pausou' : 'Fontes pausaram'} por erro do Provedor.
              </div>
            )}

            <div className="overflow-x-auto">
              <TabelaGrade
                rotulo={`Itens do Lote #${lote.id}`}
                linhas={lote.items}
                colunas={colunasBase(lote)}
                obterId={(item) => `${lote.id}-${item.sourceId}-${item.position}`}
              />
            </div>
          </article>
        )
      })}

      {/* ConfirmDialog de cancelar lote */}
      <ConfirmDialog
        aberto={Boolean(loteCancelar)}
        aoMudarAberto={(aberto) => {
          if (!aberto) setLoteCancelar(null)
        }}
        titulo={`Cancelar Lote #${loteCancelar?.id ?? ''}?`}
        descricao="Cancelar este lote? Itens ainda não concluídos serão cancelados, mas resultados já gravados permanecem salvos."
        rotuloConfirmar="Cancelar lote"
        rotuloCancelar="Cancelar"
        variante="perigo"
        focoInicial="cancelar"
        ocupado={loteCancelar != null && ocupadoId === `batches.cancel:${loteCancelar.id}`}
        aoConfirmar={async () => {
          if (!loteCancelar) return
          await executarControleLote('batches.cancel', loteCancelar)
        }}
      />

      {/* ConfirmDialog de retomar item pago / repetição */}
      <ConfirmDialog
        aberto={Boolean(confirmacaoItem)}
        aoMudarAberto={(aberto) => {
          if (!aberto) setConfirmacaoItem(null)
        }}
        titulo={`Retomar ${confirmacaoItem?.item.name ?? 'item'}?`}
        descricao={
          confirmacaoItem?.codigo === 'transcription_retry_confirmation'
            ? 'A Transcrição parcial desta Fonte usará chamada paga ao retomar. Deseja confirmar?'
            : 'Retomar esta etapa executará uma nova chamada ao Provedor.'
        }
        rotuloConfirmar="Confirmar e retomar"
        rotuloCancelar="Cancelar"
        focoInicial="cancelar"
        ocupado={
          confirmacaoItem != null &&
          ocupadoId === `resume:${confirmacaoItem.loteId}:${confirmacaoItem.item.sourceId}`
        }
        aoConfirmar={async () => {
          if (!confirmacaoItem) return
          await retomarItem(confirmacaoItem.loteId, confirmacaoItem.item, true)
        }}
      >
        {confirmacaoItem?.estimativa &&
          typeof confirmacaoItem.estimativa.minMicroUsd === 'number' &&
          typeof confirmacaoItem.estimativa.maxMicroUsd === 'number' && (
            <p className="num text-pequeno text-t2">
              Estimativa da retomada: ~{usd(confirmacaoItem.estimativa.minMicroUsd)} –{' '}
              {usd(confirmacaoItem.estimativa.maxMicroUsd)}
            </p>
          )}
      </ConfirmDialog>

      {/* Dialogo para ajustar orçamento e continuar (inclui ciência cost_unknown) */}
      <Dialogo
        aberto={Boolean(loteOrcamento)}
        aoMudarAberto={(aberto) => {
          if (!aberto) setLoteOrcamento(null)
        }}
        titulo={`Ajustar orçamento do Lote #${loteOrcamento?.id ?? ''}`}
        descricao="Informe o novo teto de custo em USD ou deixe vazio para remover o teto antes de retomar."
        rodape={
          <>
            <Botao variante="fantasma" onClick={() => setLoteOrcamento(null)}>
              Cancelar
            </Botao>
            <Botao
              variante="primario"
              disabled={exigeCienciaDesconhecido && !cienciaDesconhecido}
              carregando={loteOrcamento != null && ocupadoId === `budget:${loteOrcamento.id}`}
              onClick={() => void confirmarOrcamento()}
            >
              Continuar lote
            </Botao>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Campo
            rotulo="Novo teto de custo (USD)"
            ajuda="Deixe vazio para remover o teto de parada deste lote."
            erro={erroOrcamento ?? undefined}
          >
            {(props) => (
              <Entrada
                {...props}
                type="number"
                step="0.01"
                min="0"
                placeholder="Sem teto"
                value={tetoOrcamentoTexto}
                onChange={(e) => setTetoOrcamentoTexto(e.target.value)}
                className="num"
              />
            )}
          </Campo>

          {exigeCienciaDesconhecido && (
            <Checkbox
              marcado={cienciaDesconhecido}
              aoMudar={setCienciaDesconhecido}
              className="text-pequeno"
            >
              Entendo que o custo deste Provedor é desconhecido e desejo continuar mesmo assim
            </Checkbox>
          )}
        </div>
      </Dialogo>
    </div>
  )
}
