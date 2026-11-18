import { BannerErroCore, Botao, BotaoIcone, Dica, Esqueleto, SeloTipoVideo, cn } from '@ds'
import { ArrowLeft, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtalhos, type Atalho } from '~/comandos/atalhos'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import type { Fila } from '~/core/progresso'
import { parsearCorteId } from '~/stores/editorCorte'
import type { FonteProjeto } from '~/stores/fontesProjeto'
import type {
  DetalheExecucaoSelecao,
  ItemRevisaoSelecao,
  ResumoRunSelecao,
  RevisaoExecucaoSelecao,
} from '~/stores/selecaoProjeto'
import { DialogoExportarCorte, type CorteParaExportar } from '~/telas/corte/DialogoExportarCorte'

export type SubAbaCorte = 'editar' | 'transformar' | 'empacotar'

export type ContextoCorteConectadoProps = {
  projetoId: string
  corteId: string
  subAbaAtiva: SubAbaCorte
  runId?: string | number
  fonte?: FonteProjeto | null
  clipId?: number
  aoAntesDeNavegar?: () => Promise<boolean>
  aoIrParaTranscricaoPalavra?: (posicao?: number) => void
  aoIrParaAudio?: () => void
  aoFonteRelocalizada?: (fonteAtualizada: FonteProjeto) => void
  aoAbrirExportacao?: () => void
  fila?: Fila
}

type ItemAprovadoResolvido = {
  corteId: string
  candidateId: number
  sourceId: number
  runId: number
  startId: number
  endId: number
  titulo: string
  videoKind: 'direct' | 'transformed'
}

type EstadoResolvido = {
  carregando: boolean
  erro: ErroCore | null
  aprovados: ItemAprovadoResolvido[]
  fontes: FonteProjeto[]
}

function tituloDoCandidato(
  item: ItemRevisaoSelecao,
  execucao: DetalheExecucaoSelecao | null,
): string {
  const cand = execucao?.candidates.find((c) => c.id === item.candidate)
  const bruto = cand?.title?.trim()
  if (bruto) return bruto
  const inicio = item.startText?.trim()
  if (inicio) return inicio
  return `Corte #${item.candidate}`
}

function extrairAprovadosDaExecucao(
  sourceId: number,
  execucao: DetalheExecucaoSelecao,
  revisao: RevisaoExecucaoSelecao,
): ItemAprovadoResolvido[] {
  const tipoExecucao = execucao.run.videoKind === 'transformed' ? 'transformed' : 'direct'
  return revisao.items
    .filter((item) => item.status === 'approved')
    .map((item) => {
      const itemComKind = item as ItemRevisaoSelecao & { videoKind?: 'direct' | 'transformed' }
      return {
        corteId: String(item.candidate),
        candidateId: item.candidate,
        sourceId,
        runId: execucao.run.id,
        startId: item.startId,
        endId: item.endId,
        titulo: tituloDoCandidato(item, execucao),
        videoKind: itemComKind.videoKind ?? tipoExecucao,
      }
    })
}

async function listarRunsDaFonte(sourceId: number): Promise<ResumoRunSelecao[]> {
  try {
    const lista = await chamar<ResumoRunSelecao[]>('selection.list', { source_id: sourceId })
    return Array.isArray(lista) ? lista : []
  } catch (err) {
    const coreErr = paraErroCore(err)
    if (coreErr.code === 'transcript_missing') return []
    throw coreErr
  }
}

function hashDoCorte(
  projetoId: string,
  alvoCorteId: string,
  aba: SubAbaCorte,
  runId?: string | number,
): string {
  const encProjeto = encodeURIComponent(projetoId)
  const encCorte = encodeURIComponent(alvoCorteId)
  const sufixoRun =
    runId !== undefined && String(runId).trim() !== ''
      ? `?run=${encodeURIComponent(String(runId))}`
      : ''
  return `#/projeto/${encProjeto}/corte/${encCorte}/${aba}${sufixoRun}`
}

/**
 * Cabeçalho `<ContextoCorte>` conectado ao Projeto/Execução (`?run=:runId` ou aprovados do Projeto),
 * com guarda `editor.flush` (`aoAntesDeNavegar`), trava `#292`, atalhos `Alt+PageUp/Down`/`Mod+E`
 * e Diálogo de Exportação Individual.
 */
export function ContextoCorteConectado({
  projetoId,
  corteId,
  subAbaAtiva,
  runId,
  fonte: fonteProp,
  clipId,
  aoAntesDeNavegar,
  aoIrParaTranscricaoPalavra,
  aoIrParaAudio,
  aoFonteRelocalizada,
  aoAbrirExportacao,
  fila,
}: ContextoCorteConectadoProps) {
  const identidade = useMemo(() => parsearCorteId(corteId), [corteId])
  const avulso = identidade?.kind === 'avulso'
  const runNumerico = runId !== undefined && String(runId).trim() !== '' ? Number(runId) : NaN
  const temRunId = Number.isInteger(runNumerico) && runNumerico > 0

  const [estado, setEstado] = useState<EstadoResolvido>({
    carregando: !avulso,
    erro: null,
    aprovados: [],
    fontes: fonteProp ? [fonteProp] : [],
  })
  const [exportacaoAberta, setExportacaoAberta] = useState(false)
  const [navegando, setNavegando] = useState(false)
  const navegandoRef = useRef(false)

  const aoAntesDeNavegarRef = useRef(aoAntesDeNavegar)
  aoAntesDeNavegarRef.current = aoAntesDeNavegar

  useEffect(() => {
    let cancelado = false

    if (identidade?.kind === 'avulso') {
      if (fonteProp) {
        setEstado({ carregando: false, erro: null, aprovados: [], fontes: [fonteProp] })
        return
      }
      setEstado({ carregando: false, erro: null, aprovados: [], fontes: [] })
      void chamar<FonteProjeto[]>('sources.list', { project: projetoId })
        .then((lista) => {
          if (!cancelado && Array.isArray(lista)) {
            setEstado((prev) => ({ ...prev, fontes: lista }))
          }
        })
        .catch(() => undefined)
      return () => {
        cancelado = true
      }
    }

    setEstado((prev) => ({ ...prev, carregando: true, erro: null }))

    void (async () => {
      try {
        const fontes = fonteProp
          ? [fonteProp]
          : await chamar<FonteProjeto[]>('sources.list', { project: projetoId })
              .then((l) => (Array.isArray(l) ? l : []))
              .catch(() => [] as FonteProjeto[])

        if (cancelado) return

        if (temRunId) {
          const [execucao, revisao] = await Promise.all([
            chamar<DetalheExecucaoSelecao>('selection.get', { run: runNumerico }),
            chamar<RevisaoExecucaoSelecao>('selection.review', { run: runNumerico }),
          ])
          if (cancelado) return

          let sourceId = fonteProp?.id ?? fontes[0]?.id ?? 1
          for (const f of fontes) {
            const runs = await listarRunsDaFonte(f.id)
            if (runs.some((r) => r.id === runNumerico)) {
              sourceId = f.id
              break
            }
          }
          if (cancelado) return

          const aprovados = extrairAprovadosDaExecucao(sourceId, execucao, revisao)
          setEstado({ carregando: false, erro: null, aprovados, fontes })
          return
        }

        const todosAprovados: ItemAprovadoResolvido[] = []
        const vistos = new Set<number>()

        for (const f of fontes) {
          const runs = await listarRunsDaFonte(f.id)
          if (cancelado) return
          const detalhes = await Promise.all(
            runs.map((r) =>
              Promise.all([
                chamar<DetalheExecucaoSelecao>('selection.get', { run: r.id }),
                chamar<RevisaoExecucaoSelecao>('selection.review', { run: r.id }),
              ]),
            ),
          )
          if (cancelado) return
          for (const [execucao, revisao] of detalhes) {
            for (const item of extrairAprovadosDaExecucao(f.id, execucao, revisao)) {
              if (!vistos.has(item.candidateId)) {
                vistos.add(item.candidateId)
                todosAprovados.push(item)
              }
            }
          }
        }

        setEstado({ carregando: false, erro: null, aprovados: todosAprovados, fontes })
      } catch (err) {
        if (cancelado) return
        setEstado((prev) => ({ ...prev, carregando: false, erro: paraErroCore(err) }))
      }
    })()

    return () => {
      cancelado = true
    }
  }, [corteId, fonteProp, identidade?.kind, projetoId, runNumerico, temRunId])

  const atualIndex = useMemo(() => {
    if (identidade?.kind !== 'candidate') return -1
    return estado.aprovados.findIndex((a) => a.candidateId === identidade.candidateId)
  }, [estado.aprovados, identidade])

  const atualAprovado = atualIndex >= 0 ? estado.aprovados[atualIndex] : null
  const anteriorId = atualIndex > 0 ? estado.aprovados[atualIndex - 1].corteId : null
  const proximoId =
    atualIndex >= 0 && atualIndex < estado.aprovados.length - 1
      ? estado.aprovados[atualIndex + 1].corteId
      : null

  const candidateId = identidade?.kind === 'candidate' ? identidade.candidateId : null
  const videoKind: 'direct' | 'transformed' = atualAprovado?.videoKind ?? 'direct'
  const titulo = avulso ? 'Corte avulso' : (atualAprovado?.titulo ?? `Corte #${corteId}`)
  const posicao =
    avulso || atualIndex < 0
      ? `Corte #${corteId}`
      : `Corte ${atualIndex + 1}/${estado.aprovados.length}`

  const executarNavegacao = useCallback(async (hashDestino: string) => {
    if (navegandoRef.current) return
    navegandoRef.current = true
    setNavegando(true)
    try {
      if (aoAntesDeNavegarRef.current) {
        const podeSeguir = await aoAntesDeNavegarRef.current()
        if (!podeSeguir) return
      }
      window.location.hash = hashDestino
    } finally {
      navegandoRef.current = false
      setNavegando(false)
    }
  }, [])

  const navegarParaCorte = useCallback(
    (alvoCorteId: string) => {
      const destino = hashDoCorte(projetoId, alvoCorteId, subAbaAtiva, temRunId ? runNumerico : undefined)
      void executarNavegacao(destino)
    },
    [executarNavegacao, projetoId, runNumerico, subAbaAtiva, temRunId],
  )

  const navegarSubAba = useCallback(
    (aba: SubAbaCorte) => {
      if (aba === subAbaAtiva) return
      const destino = hashDoCorte(projetoId, corteId, aba, temRunId ? runNumerico : undefined)
      void executarNavegacao(destino)
    },
    [corteId, executarNavegacao, projetoId, runNumerico, subAbaAtiva, temRunId],
  )

  const voltarParaCortes = useCallback(() => {
    const enc = encodeURIComponent(projetoId)
    const destino = temRunId
      ? `#/projeto/${enc}/cortes/revisao/${runNumerico}`
      : `#/projeto/${enc}/cortes`
    void executarNavegacao(destino)
  }, [executarNavegacao, projetoId, runNumerico, temRunId])

  const abrirExportacao = useCallback(() => {
    if (aoAbrirExportacao) {
      aoAbrirExportacao()
      return
    }
    setExportacaoAberta(true)
  }, [aoAbrirExportacao])

  const atalhosContexto = useMemo<Atalho[]>(
    () => [
      {
        id: 'corte.anterior',
        titulo: 'Corte aprovado anterior',
        grupo: 'Corte',
        tecla: 'Alt+PageUp',
        teclaUnica: false,
        executar: () => {
          if (anteriorId) navegarParaCorte(anteriorId)
        },
      },
      {
        id: 'corte.proximo',
        titulo: 'Próximo Corte aprovado',
        grupo: 'Corte',
        tecla: 'Alt+PageDown',
        teclaUnica: false,
        executar: () => {
          if (proximoId) navegarParaCorte(proximoId)
        },
      },
      {
        id: 'corte.exportar',
        titulo: 'Exportar Corte atual',
        grupo: 'Corte',
        tecla: 'Mod+E',
        teclaUnica: false,
        executar: abrirExportacao,
      },
    ],
    [abrirExportacao, anteriorId, navegarParaCorte, proximoId],
  )

  useAtalhos(atalhosContexto)

  const corteParaExportar: CorteParaExportar | null = useMemo(() => {
    if (identidade?.kind === 'avulso') {
      return {
        corteId,
        titulo: `Corte avulso ${identidade.startId}-${identidade.endId}`,
        videoKind: 'direct',
        sourceId: identidade.sourceId,
        startId: identidade.startId,
        endId: identidade.endId,
        candidateId: null,
        clipId,
      }
    }
    if (!atualAprovado) return null
    return {
      corteId: atualAprovado.corteId,
      titulo: atualAprovado.titulo,
      videoKind: atualAprovado.videoKind,
      sourceId: atualAprovado.sourceId,
      startId: atualAprovado.startId,
      endId: atualAprovado.endId,
      candidateId: atualAprovado.candidateId,
      clipId,
    }
  }, [atualAprovado, clipId, corteId, identidade])

  const fonteAtual: FonteProjeto | null = useMemo(() => {
    if (fonteProp) return fonteProp
    if (!corteParaExportar) return null
    return estado.fontes.find((f) => f.id === corteParaExportar.sourceId) ?? null
  }, [corteParaExportar, estado.fontes, fonteProp])

  const subAbasVisiveis: Array<{ valor: SubAbaCorte; rotulo: string }> = useMemo(() => {
    const lista: Array<{ valor: SubAbaCorte; rotulo: string }> = [{ valor: 'editar', rotulo: 'Editar' }]
    if (!avulso && videoKind === 'transformed') {
      lista.push({ valor: 'transformar', rotulo: 'Transformar' })
    }
    if (!avulso) {
      lista.push({ valor: 'empacotar', rotulo: 'Empacotar' })
    }
    return lista
  }, [avulso, videoKind])

  const ehMac =
    typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)

  return (
    <>
      <div className="flex h-(--altura-subtopo) shrink-0 items-center gap-3 border-b border-linha px-4">
        <Botao
          icone={<ArrowLeft />}
          aria-label="Voltar para Cortes"
          disabled={navegando}
          onClick={voltarParaCortes}
        >
          Cortes
        </Botao>

        <div className="flex items-center">
          <BotaoIcone
            rotulo="Corte anterior"
            atalho="Alt PgUp"
            disabled={!anteriorId || navegando}
            onClick={() => anteriorId && navegarParaCorte(anteriorId)}
            tamanho="p"
          >
            <ChevronLeft />
          </BotaoIcone>
          <BotaoIcone
            rotulo="Próximo aprovado"
            atalho="Alt PgDn"
            disabled={!proximoId || navegando}
            onClick={() => proximoId && navegarParaCorte(proximoId)}
            tamanho="p"
          >
            <ChevronRight />
          </BotaoIcone>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap">
          {estado.carregando ? (
            <div className="w-56">
              <Esqueleto variante="linha" rotuloAcessivel="Carregando Corte" />
            </div>
          ) : estado.erro ? (
            <BannerErroCore
              erro={{ code: estado.erro.code, message: estado.erro.detalhe }}
              traduzir={(code) => mensagemDeErro(new ErroCore(code, estado.erro?.detalhe ?? ''))}
            />
          ) : (
            <>
              <h1 className="flex min-w-0 items-center gap-2 text-base font-normal whitespace-nowrap">
                <span className="num text-t3">{posicao}</span>
                <span aria-hidden className="text-t3">
                  ·
                </span>
                <strong className="truncate font-medio text-t1">{titulo}</strong>
              </h1>
              {!avulso && <SeloTipoVideo tipo={videoKind} className="ml-1 shrink-0" />}
              {videoKind === 'direct' && candidateId !== null && (
                <Dica texto="Conversão individual para Vídeo transformado aguarda comando no núcleo (#292).">
                  <span tabIndex={0} className="inline-flex shrink-0 rounded-controle">
                    <Botao tamanho="p" variante="fantasma" icone={<Sparkles />} disabled>
                      Converter em Vídeo transformado
                    </Botao>
                  </span>
                </Dica>
              )}
            </>
          )}
        </div>

        <nav aria-label="Etapas do Corte" className="flex shrink-0 items-center gap-0.5">
          {subAbasVisiveis.map((aba) => {
            const ativa = subAbaAtiva === aba.valor
            const href = hashDoCorte(
              projetoId,
              corteId,
              aba.valor,
              temRunId ? runNumerico : undefined,
            )
            return (
              <a
                key={aba.valor}
                href={href}
                aria-current={ativa ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  navegarSubAba(aba.valor)
                }}
                className={cn(
                  'foco inline-flex h-7 min-w-6 items-center rounded-controle px-2.5 text-base no-underline transition-colors duration-(--dur-rapida) ease-saida',
                  ativa
                    ? 'bg-elevado text-t1 shadow-[inset_0_0_0_1px_var(--contorno-controle)]'
                    : 'text-t3 hover:text-t2',
                )}
              >
                {aba.rotulo}
              </a>
            )
          })}
        </nav>

        <Botao
          variante="primario"
          atalho={ehMac ? '⌘E' : 'Ctrl+E'}
          disabled={estado.carregando || !corteParaExportar}
          onClick={abrirExportacao}
        >
          Exportar Corte
        </Botao>
      </div>

      {!aoAbrirExportacao && (
        <DialogoExportarCorte
          aberto={exportacaoAberta}
          aoFechar={() => setExportacaoAberta(false)}
          projetoId={projetoId}
          corte={corteParaExportar}
          fonte={fonteAtual}
          clipId={clipId}
          aoAntesDeAbrir={aoAntesDeNavegar}
          aoIrParaTranscricao={aoIrParaTranscricaoPalavra}
          aoIrParaAudio={aoIrParaAudio}
          aoFonteRelocalizada={(atualizada) => {
            setEstado((prev) => ({
              ...prev,
              fontes: prev.fontes.map((f) => (f.id === atualizada.id ? atualizada : f)),
            }))
            aoFonteRelocalizada?.(atualizada)
          }}
          fila={fila}
        />
      )}
    </>
  )
}
