import {
  BannerErroCore,
  Botao,
  Campo,
  Checkbox,
  ConfirmDialog,
  Entrada,
  ResumoCustoPrivacidade,
  Segmentado,
  Status,
  cn,
  tcLongo,
  usd,
  type ResumoCustoPrivacidadeProps,
} from '@ds'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import type {
  FonteProjeto,
  LoteFontes,
  TranscriptStatusFonte,
} from '~/stores/fontesProjeto'
import { basenameCaminho } from '~/telas/fontes/EntradaFonte'

type MotorTranscricao = 'local' | 'groq'
type TipoVideo = 'direct' | 'transformed'

type ChannelProfileResp = {
  videoKind?: TipoVideo | string
  minUs?: number
  maxUs?: number
  limits?: {
    technicalMaxUs?: number
  }
}

type TarefaSelecaoResp = {
  task: string
  profile: {
    id: string
    label: string
    kind: string
    model: string | null
    local: boolean
    cli: boolean
    cost?: { kind: string }
  } | null
  localOnly?: boolean
  blocked?: boolean
}

type AssistantTasksResp = {
  projectLocalOnly?: boolean
  tasks?: TarefaSelecaoResp[]
}

type LocalOnlyResp = {
  open?: boolean
  enabled?: boolean
}

type ConfirmacaoLoteUsage = {
  selectionPaid?: boolean
  transcriptionPaid?: boolean
  audioEstimateMicroUsd?: number | null
  profile?: string | null
  maxCostMicroUsd?: number | null
  sources?: number
}

export type ConstrutorLoteProps = {
  projetoPath: string
  fontes: FonteProjeto[]
  transcriptStatusBySource: Record<number, TranscriptStatusFonte>
  selecionadasInicial: number[]
  aoMudarSelecionadas?: (ids: number[]) => void
  aoCriarLote: (lote: LoteFontes) => Promise<void> | void
  listaFontesRef?: RefObject<HTMLFieldSetElement | null>
  forcadoErro?: ErroCore | null
}

function textoEstadoTranscricaoFonte(
  fonte: FonteProjeto,
  st?: TranscriptStatusFonte,
): string {
  const seg = Number(fonte.metadata?.format?.duration ?? 0)
  const durUs = Number.isFinite(seg) && seg > 0 ? Math.round(seg * 1_000_000) : 0
  const durTxt = durUs > 0 ? tcLongo(durUs) : null

  let estadoTxt = 'Não transcrita'
  if (st?.transcript?.state === 'complete') {
    estadoTxt = 'Pronta'
  } else if (st?.transcript && st.transcript.resume_us > 0 && st.transcript.duration_us > 0) {
    const pct = Math.min(99, Math.round((st.transcript.resume_us / st.transcript.duration_us) * 100))
    estadoTxt = `Parcial ${pct}%`
  }

  return [durTxt, estadoTxt].filter(Boolean).join(' · ')
}

function mapearResumoSelecao(
  rotaSelecao: TarefaSelecaoResp | null,
  somenteLocal: boolean,
  maxCostMicroUsd: number | null,
): ResumoCustoPrivacidadeProps {
  const perfil = rotaSelecao?.profile
  if (!perfil) {
    return {
      tarefa: 'Seleção de Cortes',
      perfil: { id: 'nenhum', label: 'Não configurado', kind: 'api', model: null },
      localidade: 'remoto',
      saiDaMaquina: true,
      estimativa: { kind: 'unknown' },
      bloqueadoSomenteLocal: somenteLocal,
      compacto: true,
    }
  }

  const localidade: 'local' | 'remoto' | 'cli' = perfil.cli
    ? 'cli'
    : perfil.local
      ? 'local'
      : 'remoto'
  const kind: 'local' | 'api' | 'cli' = perfil.cli ? 'cli' : perfil.local ? 'local' : 'api'
  const estimativa: ResumoCustoPrivacidadeProps['estimativa'] =
    perfil.cost?.kind === 'zero' || perfil.local
      ? { kind: 'zero' }
      : perfil.cost?.kind === 'plan_quota' || perfil.cli
        ? { kind: 'plan_quota' }
        : { kind: 'unknown' }

  return {
    tarefa: 'Seleção de Cortes',
    perfil: { id: perfil.id, label: perfil.label, kind, model: perfil.model },
    localidade,
    saiDaMaquina: !perfil.local,
    estimativa,
    orcamento: maxCostMicroUsd != null ? { restanteMicroUsd: maxCostMicroUsd } : null,
    bloqueadoSomenteLocal: Boolean(rotaSelecao?.blocked || (somenteLocal && !perfil.local)),
    compacto: true,
  }
}

/** Construtor de Lote de Fontes (`batches.create`) com seleção, Motor, faixa e `<ResumoCustoPrivacidade>`. */
export function ConstrutorLote({
  projetoPath,
  fontes,
  transcriptStatusBySource,
  selecionadasInicial,
  aoMudarSelecionadas,
  aoCriarLote,
  listaFontesRef,
  forcadoErro = null,
}: ConstrutorLoteProps) {
  const fontesDisponiveis = useMemo(
    () => fontes.filter((f) => f.status !== 'offline'),
    [fontes],
  )
  const idsDisponiveis = useMemo(
    () => new Set(fontesDisponiveis.map((f) => f.id)),
    [fontesDisponiveis],
  )

  const [selecionadas, setSelecionadas] = useState<number[]>(() =>
    selecionadasInicial.filter((id) => idsDisponiveis.has(id)),
  )
  const inicializadoRef = useRef(false)

  useEffect(() => {
    setSelecionadas((atual) => {
      const filtradasAtual = atual.filter((id) => idsDisponiveis.has(id))
      if (!inicializadoRef.current && selecionadasInicial.length > 0) {
        inicializadoRef.current = true
        return selecionadasInicial.filter((id) => idsDisponiveis.has(id))
      }
      return filtradasAtual
    })
  }, [idsDisponiveis, selecionadasInicial])

  const [motor, setMotor] = useState<MotorTranscricao>('local')
  const [tipoVideo, setTipoVideo] = useState<TipoVideo>('direct')
  const [minSegTexto, setMinSegTexto] = useState('20')
  const [maxSegTexto, setMaxSegTexto] = useState('60')
  const [limiteTecnicoSeg, setLimiteTecnicoSeg] = useState(300)
  const [tetoUsdTexto, setTetoUsdTexto] = useState('')

  const [somenteLocal, setSomenteLocal] = useState(false)
  const [rotaSelecao, setRotaSelecao] = useState<TarefaSelecaoResp | null>(null)
  const [modeloGroq, setModeloGroq] = useState('whisper-large-v3-turbo')

  const [enviando, setEnviando] = useState(false)
  const [erroCriar, setErroCriar] = useState<ErroCore | null>(null)
  const erroBannerRef = useRef<HTMLDivElement>(null)
  const [confirmacaoPendente, setConfirmacaoPendente] = useState<{
    payload: Record<string, unknown>
    usage: ConfirmacaoLoteUsage
  } | null>(null)

  useEffect(() => {
    if (!erroCriar) return
    const el = erroBannerRef.current
    if (!el) return
    el.scrollIntoView({ block: 'nearest' })
    el.focus({ preventScroll: true })
  }, [erroCriar])

  useEffect(() => {
    let cancelado = false
    Promise.allSettled([
      chamar<ChannelProfileResp>('channel_profile.get', {}),
      chamar<AssistantTasksResp>('assistant.tasks', {}),
      chamar<LocalOnlyResp>('projects.local_only.get', {}),
      chamar<{ model?: string }>('transcription.groq.info', {}),
    ]).then(([resPerfil, resTarefas, resLocal, resGroq]) => {
      if (cancelado) return
      if (resPerfil.status === 'fulfilled' && resPerfil.value) {
        const p = resPerfil.value
        if (p.videoKind === 'direct' || p.videoKind === 'transformed') {
          setTipoVideo(p.videoKind)
        }
        if (typeof p.minUs === 'number' && p.minUs > 0) {
          setMinSegTexto(String(Math.round(p.minUs / 1_000_000)))
        }
        if (typeof p.maxUs === 'number' && p.maxUs > 0) {
          setMaxSegTexto(String(Math.round(p.maxUs / 1_000_000)))
        }
        if (typeof p.limits?.technicalMaxUs === 'number' && p.limits.technicalMaxUs > 0) {
          setLimiteTecnicoSeg(Math.round(p.limits.technicalMaxUs / 1_000_000))
        }
      }
      const projLocal =
        (resLocal.status === 'fulfilled' && Boolean(resLocal.value?.enabled)) ||
        (resTarefas.status === 'fulfilled' && Boolean(resTarefas.value?.projectLocalOnly))
      setSomenteLocal(projLocal)
      if (resTarefas.status === 'fulfilled' && Array.isArray(resTarefas.value?.tasks)) {
        const sel = resTarefas.value.tasks.find((t) => t.task === 'selection') ?? null
        setRotaSelecao(sel)
      }
      if (resGroq.status === 'fulfilled' && resGroq.value?.model) {
        setModeloGroq(resGroq.value.model)
      }
    })
    return () => {
      cancelado = true
    }
  }, [projetoPath])

  const alternarFonte = useCallback(
    (id: number, marcado: boolean) => {
      if (!idsDisponiveis.has(id)) return
      const prox = marcado
        ? Array.from(new Set([...selecionadas, id]))
        : selecionadas.filter((item) => item !== id)
      setSelecionadas(prox)
      aoMudarSelecionadas?.(prox)
    },
    [aoMudarSelecionadas, idsDisponiveis, selecionadas],
  )

  const tetoMicroUsd = useMemo(() => {
    const limpo = tetoUsdTexto.trim().replace(',', '.')
    if (!limpo) return null
    const val = Number(limpo)
    if (!Number.isFinite(val) || val < 0) return NaN
    return Math.round(val * 1_000_000)
  }, [tetoUsdTexto])

  const enviarLote = async (payload: Record<string, unknown>, confirmar: boolean) => {
    setEnviando(true)
    setErroCriar(null)
    try {
      const criado = await chamar<LoteFontes>('batches.create', {
        ...payload,
        ...(confirmar ? { confirmed: true } : {}),
      })
      setConfirmacaoPendente(null)
      setSelecionadas([])
      aoMudarSelecionadas?.([])
      await aoCriarLote(criado)
    } catch (err) {
      const coreErr = paraErroCore(err)
      if (coreErr.code === 'confirmation_required' && !confirmar) {
        const rawUsage = coreErr.usage
        const usageObj =
          rawUsage && typeof rawUsage === 'object'
            ? (rawUsage as ConfirmacaoLoteUsage)
            : {
                selectionPaid: Boolean(rotaSelecao?.profile && !rotaSelecao.profile.local && !rotaSelecao.profile.cli),
                transcriptionPaid: motor === 'groq',
                audioEstimateMicroUsd: motor === 'groq' ? 12000 : null,
                profile: rotaSelecao?.profile?.id ?? null,
                maxCostMicroUsd: Number.isFinite(tetoMicroUsd ?? NaN) ? tetoMicroUsd : null,
                sources: selecionadas.length,
              }
        setConfirmacaoPendente({ payload, usage: usageObj })
      } else {
        setConfirmacaoPendente(null)
        setErroCriar(coreErr)
      }
    } finally {
      setEnviando(false)
    }
  }

  const aoSubmeter = async (e: FormEvent) => {
    e.preventDefault()
    setErroCriar(null)

    if (selecionadas.length === 0 || selecionadas.length > 500) {
      setErroCriar(new ErroCore('invalid_batch', 'Selecione entre 1 e 500 Fontes disponíveis.'))
      return
    }

    const minSeg = Number(minSegTexto)
    const maxSeg = Number(maxSegTexto)
    if (
      !Number.isFinite(minSeg) ||
      !Number.isFinite(maxSeg) ||
      minSeg <= 0 ||
      maxSeg <= minSeg ||
      maxSeg > limiteTecnicoSeg
    ) {
      setErroCriar(
        new ErroCore(
          'invalid_batch',
          `Informe duração mínima e máxima válidas (até ${limiteTecnicoSeg} s).`,
        ),
      )
      return
    }

    if (Number.isNaN(tetoMicroUsd)) {
      setErroCriar(new ErroCore('invalid_budget', 'Informe um teto de custo válido em USD (≥ 0).'))
      return
    }

    const payload: Record<string, unknown> = {
      sourceIds: selecionadas,
      engine: motor,
      videoKind: tipoVideo,
      minUs: Math.round(minSeg * 1_000_000),
      maxUs: Math.round(maxSeg * 1_000_000),
      ...(tetoMicroUsd != null ? { maxCostMicroUsd: tetoMicroUsd } : {}),
    }

    await enviarLote(payload, false)
  }

  const erroExibido = forcadoErro ?? erroCriar
  const traducaoErro = erroExibido ? mensagemDeErro(erroExibido) : null
  const todasOffline = fontes.length > 0 && fontesDisponiveis.length === 0

  const resumoPreview = useMemo(
    () =>
      mapearResumoSelecao(
        rotaSelecao,
        somenteLocal,
        tetoMicroUsd != null && !Number.isNaN(tetoMicroUsd) ? tetoMicroUsd : null,
      ),
    [rotaSelecao, somenteLocal, tetoMicroUsd],
  )

  const rotuloBotao =
    selecionadas.length === 1
      ? 'Iniciar lote com 1 Fonte'
      : `Iniciar lote com ${selecionadas.length} Fontes`

  return (
    <section
      aria-label="Construtor de Lote de Fontes"
      className="flex flex-col gap-3 rounded-area bg-area p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-titulo font-forte tracking-[-0.01em] text-t1">Novo Lote de Fontes</h2>
        <span className="num text-pequeno text-t3">1–500 Fontes</span>
      </div>

      {erroExibido && traducaoErro && (
        <div ref={erroBannerRef} tabIndex={-1} className="rounded-area foco-interno">
          <BannerErroCore
            erro={{
              code: erroExibido.code,
              message: erroExibido.detalhe || erroExibido.message,
            }}
            traduzir={() => ({ titulo: traducaoErro.titulo })}
            acaoRecuperacao={
              erroExibido.code === 'local_only_violation'
                ? {
                    rotulo: 'Escolher Perfil local',
                    aoAcionar: () => {
                      window.location.hash = '#/config/provedores'
                    },
                  }
                : traducaoErro.recuperacao
                  ? {
                      rotulo: traducaoErro.recuperacao.rotulo,
                      aoAcionar: () => {
                        if (traducaoErro.recuperacao?.rota) {
                          window.location.hash = traducaoErro.recuperacao.rota
                        }
                      },
                    }
                  : undefined
            }
            acaoSecundaria={
              erroExibido.code === 'local_only_violation'
                ? {
                    rotulo: 'Revisar Somente local',
                    aoAcionar: () => {
                      window.location.hash = '#/config/projeto'
                    },
                  }
                : undefined
            }
            aoDispensar={() => setErroCriar(null)}
          />
        </div>
      )}

      <form onSubmit={(e) => void aoSubmeter(e)} className="flex flex-col gap-2.5">
        {/* 1. Fontes do lote */}
        <fieldset ref={listaFontesRef} className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 flex w-full items-baseline justify-between text-pequeno font-medio text-t1">
            <span>Fontes do lote</span>
            <span className="num text-t3">
              {selecionadas.length} de {fontes.length}
            </span>
          </legend>

          {todasOffline && (
            <Status tom="aviso" forte>
              Relocalize uma Fonte offline para incluí-la num lote.
            </Status>
          )}

          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto pr-1">
            {fontes.map((fonte) => {
              const offline = fonte.status === 'offline'
              const marcada = !offline && selecionadas.includes(fonte.id)
              const nome = basenameCaminho(fonte.path)
              return (
                <div
                  key={fonte.id}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-controle px-2 py-1.5',
                    marcada ? 'marcado bg-elevado' : 'bg-chao/50',
                  )}
                >
                  <Checkbox
                    marcado={marcada}
                    desabilitado={offline}
                    aoMudar={(v) => alternarFonte(fonte.id, v)}
                    className="min-w-0 flex-1"
                  >
                    <span className="truncate text-pequeno text-t1">{nome}</span>
                  </Checkbox>

                  {offline ? (
                    <Status tom="aviso" className="shrink-0">
                      Offline — não pode ser transcrita agora
                    </Status>
                  ) : (
                    <span className="num shrink-0 text-pequeno text-t3">
                      {textoEstadoTranscricaoFonte(fonte, transcriptStatusBySource[fonte.id])}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </fieldset>

        {/* 2. Motor de transcrição */}
        <div className="flex flex-col gap-1.5">
          <span className="text-pequeno font-medio text-t1">Motor de transcrição</span>
          <div
            role="radiogroup"
            aria-label="Motor de transcrição"
            className="flex flex-col gap-1.5"
          >
            <label className="flex min-h-6 cursor-pointer items-center gap-2 text-pequeno text-t1">
              <input
                type="radio"
                name="motor-lote"
                value="local"
                checked={motor === 'local'}
                onChange={() => setMotor('local')}
                className="accent-sinal"
              />
              <span>Local (US$ 0,00)</span>
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex min-h-6 cursor-pointer items-center gap-2 text-pequeno text-t1">
                <input
                  type="radio"
                  name="motor-lote"
                  value="groq"
                  checked={motor === 'groq'}
                  onChange={() => setMotor('groq')}
                  className="accent-sinal"
                />
                <span>Groq (remoto)</span>
              </label>
              {somenteLocal && <Status tom="aviso">Bloqueado por Somente local</Status>}
            </div>
          </div>
        </div>

        {/* 3. Seleção de Cortes */}
        <div className="flex flex-col gap-2">
          <span className="text-pequeno font-medio text-t1">Seleção de Cortes</span>
          <Segmentado<TipoVideo>
            rotulo="Tipo de vídeo"
            valor={tipoVideo}
            aoMudar={setTipoVideo}
            opcoes={[
              { valor: 'direct', rotulo: 'Corte direto' },
              { valor: 'transformed', rotulo: 'Vídeo transformado' },
            ]}
          />
          <div className="grid grid-cols-2 gap-2">
            <Campo rotulo="Duração mínima (s)">
              {(props) => (
                <Entrada
                  {...props}
                  tamanho="p"
                  type="number"
                  min={1}
                  max={limiteTecnicoSeg - 1}
                  value={minSegTexto}
                  onChange={(e) => setMinSegTexto(e.target.value)}
                  className="num"
                />
              )}
            </Campo>
            <Campo rotulo="Duração máxima (s)" extra={`até ${limiteTecnicoSeg} s`}>
              {(props) => (
                <Entrada
                  {...props}
                  tamanho="p"
                  type="number"
                  min={2}
                  max={limiteTecnicoSeg}
                  value={maxSegTexto}
                  onChange={(e) => setMaxSegTexto(e.target.value)}
                  className="num"
                />
              )}
            </Campo>
          </div>
        </div>

        {/* 4. Teto de custo opcional */}
        <Campo
          rotulo="Teto de custo opcional (USD)"
          ajuda="Quando o teto for atingido, o lote pausa automaticamente antes da próxima chamada paga."
        >
          {(props) => (
            <Entrada
              {...props}
              tamanho="p"
              type="number"
              step="0.01"
              min="0"
              placeholder="Vazio = sem teto"
              value={tetoUsdTexto}
              onChange={(e) => setTetoUsdTexto(e.target.value)}
              className="num"
            />
          )}
        </Campo>

        {/* Resumo de Custo e Privacidade */}
        {motor === 'groq' && (
          <ResumoCustoPrivacidade
            tarefa="Transcrição (Groq)"
            perfil={{ id: 'groq', label: 'Groq', kind: 'groq', model: modeloGroq }}
            localidade="remoto"
            saiDaMaquina
            host="api.groq.com"
            estimativa={{ kind: 'unknown' }}
            bloqueadoSomenteLocal={somenteLocal}
            compacto
          />
        )}
        <ResumoCustoPrivacidade {...resumoPreview} />

        <Botao
          type="submit"
          variante="primario"
          disabled={selecionadas.length === 0 || todasOffline}
          carregando={enviando}
          className="w-full"
        >
          {rotuloBotao}
        </Botao>
      </form>

      {/* Confirmação pré-disparo para lote pago/remoto (`confirmation_required`) */}
      <ConfirmDialog
        aberto={Boolean(confirmacaoPendente)}
        aoMudarAberto={(aberto) => {
          if (!aberto && !enviando) setConfirmacaoPendente(null)
        }}
        titulo={`Confirmar início do lote (${selecionadas.length} ${selecionadas.length === 1 ? 'Fonte' : 'Fontes'})?`}
        descricao="Este lote executará chamadas pagas ou remotas para fora da sua máquina. Revise o resumo antes de confirmar."
        rotuloConfirmar="Confirmar e iniciar lote"
        rotuloCancelar="Cancelar"
        focoInicial="cancelar"
        ocupado={enviando}
        aoConfirmar={async () => {
          if (!confirmacaoPendente) return
          await enviarLote(confirmacaoPendente.payload, true)
        }}
      >
        {confirmacaoPendente && (
          <div className="flex flex-col gap-2">
            {confirmacaoPendente.usage.transcriptionPaid && (
              <ResumoCustoPrivacidade
                tarefa="Transcrição (Groq)"
                perfil={{ id: 'groq', label: 'Groq', kind: 'groq', model: modeloGroq }}
                localidade="remoto"
                saiDaMaquina
                host="api.groq.com"
                estimativa={
                  typeof confirmacaoPendente.usage.audioEstimateMicroUsd === 'number'
                    ? {
                        kind: 'usd',
                        minMicroUsd: confirmacaoPendente.usage.audioEstimateMicroUsd,
                        maxMicroUsd: confirmacaoPendente.usage.audioEstimateMicroUsd,
                      }
                    : { kind: 'unknown' }
                }
                compacto
              />
            )}
            <ResumoCustoPrivacidade
              tarefa="Seleção de Cortes"
              perfil={
                rotaSelecao?.profile
                  ? {
                      id: rotaSelecao.profile.id,
                      label: rotaSelecao.profile.label,
                      kind: rotaSelecao.profile.cli
                        ? 'cli'
                        : rotaSelecao.profile.local
                          ? 'local'
                          : 'api',
                      model: rotaSelecao.profile.model,
                    }
                  : {
                      id:
                        confirmacaoPendente.usage.profile &&
                        confirmacaoPendente.usage.profile !== 'legacy'
                          ? confirmacaoPendente.usage.profile
                          : 'nao-configurado',
                      label:
                        confirmacaoPendente.usage.profile &&
                        confirmacaoPendente.usage.profile !== 'legacy'
                          ? confirmacaoPendente.usage.profile
                          : confirmacaoPendente.usage.selectionPaid
                            ? 'Perfil configurado'
                            : 'Não configurado',
                      kind: 'api',
                      model: null,
                    }
              }
              localidade={
                rotaSelecao?.profile?.cli
                  ? 'cli'
                  : rotaSelecao?.profile?.local
                    ? 'local'
                    : 'remoto'
              }
              saiDaMaquina={!rotaSelecao?.profile?.local}
              estimativa={
                confirmacaoPendente.usage.selectionPaid
                  ? { kind: 'unknown' }
                  : resumoPreview.estimativa
              }
              orcamento={
                typeof confirmacaoPendente.usage.maxCostMicroUsd === 'number'
                  ? { restanteMicroUsd: confirmacaoPendente.usage.maxCostMicroUsd }
                  : null
              }
              compacto
            />
            {typeof confirmacaoPendente.usage.maxCostMicroUsd === 'number' && (
              <p className="num text-pequeno text-t2">
                Teto do lote: {usd(confirmacaoPendente.usage.maxCostMicroUsd)}
              </p>
            )}
          </div>
        )}
      </ConfirmDialog>
    </section>
  )
}
