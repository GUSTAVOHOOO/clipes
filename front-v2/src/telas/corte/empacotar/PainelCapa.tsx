import {
  Botao,
  ConfirmDialog,
  Dialogo,
  FaixaJob,
  PlayerProxy,
  Progresso,
  ResumoCustoPrivacidade,
  Status,
  cn,
  duracao,
  tc,
  useToast,
} from '@ds'
import { ChevronRight, Film, Pause, Play } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useAtalhos, type Atalho } from '~/comandos/atalhos'
import { SeletorCaminho } from '~/componentes/SeletorCaminho'
import { chamar, paraErroCore, type ErroCore } from '~/core/cliente'
import type {
  CapaDoc,
  FonteEmpacotar,
  ProxyDoc,
  useEmpacotarCorte,
} from '~/stores/empacotarCorte'
import { converterEstimativa, type EstimativaProvedorBruta } from '~/telas/corte/transformar/PassoAngulo'
import { salvarArquivo } from './dialogosNativos'
import { mediaUrl } from '../../../../../src/lib/media'
import { ErroEmpacotar } from './ErroEmpacotar'

type StoreEmpacotar = ReturnType<typeof useEmpacotarCorte>

type EntradaHistorico = {
  id?: number
  instantUs: number
  origin?: 'ai' | 'user'
  why?: string | null
}

/** Documento de capa como o núcleo devolve (a store tipa só o essencial). */
type CapaCompleta = CapaDoc & {
  cut?: { startUs: number; endUs: number }
  suggestions?: EntradaHistorico[]
  choices?: EntradaHistorico[]
  maxWhyChars?: number
}

type ProxyComChave = ProxyDoc & {
  key?: string | null
  windowStartUs?: number
}

export interface PainelCapaProps {
  candidateId: number
  /** Identificador do Corte na rota; compõe o nome padrão `capa-{corte}.png`. */
  corteId: string
  store: StoreEmpacotar
  fonte: FonteEmpacotar
  aoRelocalizarFonte: () => void
  aoMudarInstantPreview?: (instantUs: number) => void
  aoMudarModalAberto?: (aberto: boolean) => void
}

interface RespostaEstimativaCapa {
  paid: boolean
  profile?: string
  estimate: EstimativaProvedorBruta
}

const PASSO_QUADRO_US = 33_333
const PASSO_SEGUNDO_US = 1_000_000

function limitar(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor))
}

function hashDaFila(): string {
  return '#/fila'
}

/** Slider de instante com `role="slider"` (APG): setas ±1 quadro, PageUp/Down ±1 s, Home/End nos limites. */
function ScrubberCapa({
  valorUs,
  minUs,
  maxUs,
  aoMudar,
  desabilitado,
  refSlider,
}: {
  valorUs: number
  minUs: number
  maxUs: number
  aoMudar: (us: number) => void
  desabilitado: boolean
  refSlider: React.RefObject<HTMLDivElement | null>
}) {
  const trilhoRef = useRef<HTMLDivElement>(null)
  const span = Math.max(1, maxUs - minUs)
  const fracao = limitar((valorUs - minUs) / span, 0, 1)

  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (desabilitado) return
    let alvo: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') alvo = valorUs + PASSO_QUADRO_US
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') alvo = valorUs - PASSO_QUADRO_US
    else if (e.key === 'PageUp') alvo = valorUs + PASSO_SEGUNDO_US
    else if (e.key === 'PageDown') alvo = valorUs - PASSO_SEGUNDO_US
    else if (e.key === 'Home') alvo = minUs
    else if (e.key === 'End') alvo = maxUs
    if (alvo === null) return
    e.preventDefault()
    e.stopPropagation()
    aoMudar(limitar(alvo, minUs, maxUs))
  }

  const aoPonteiro = (clientX: number) => {
    const caixa = trilhoRef.current?.getBoundingClientRect()
    if (!caixa || caixa.width <= 0) return
    aoMudar(limitar(minUs + ((clientX - caixa.left) / caixa.width) * span, minUs, maxUs))
  }

  return (
    <div
      ref={trilhoRef}
      className={cn('relative flex h-6 w-full touch-none items-center', desabilitado && 'opacity-40')}
      onPointerDown={(e) => {
        if (desabilitado) return
        refSlider.current?.focus()
        aoPonteiro(e.clientX)
        const mover = (ev: PointerEvent) => aoPonteiro(ev.clientX)
        const soltar = () => {
          window.removeEventListener('pointermove', mover)
          window.removeEventListener('pointerup', soltar)
        }
        window.addEventListener('pointermove', mover)
        window.addEventListener('pointerup', soltar)
      }}
    >
      <div className="relative h-1 w-full rounded-full bg-chao shadow-[inset_0_0_0_1px_var(--linha)]">
        <div className="h-full rounded-full bg-t3" style={{ width: `${fracao * 100}%` }} />
        <div
          ref={refSlider}
          role="slider"
          tabIndex={desabilitado ? -1 : 0}
          aria-label="Instante da capa"
          aria-orientation="horizontal"
          aria-disabled={desabilitado || undefined}
          aria-valuemin={Math.round(minUs / 1000)}
          aria-valuemax={Math.round(maxUs / 1000)}
          aria-valuenow={Math.round(valorUs / 1000)}
          aria-valuetext={`${tc(valorUs - minUs)} de ${tc(span)}`}
          onKeyDown={aoTeclar}
          className="foco absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-transparent before:block before:size-3 before:rounded-full before:bg-t1 before:content-['']"
          style={{ left: `${fracao * 100}%` }}
        />
      </div>
    </div>
  )
}

/**
 * Coluna esquerda de Empacotar: preview do quadro, scrubber da capa (`role="slider"`),
 * ficha do momento escolhido, ações (sugerir, usar quadro, salvar PNG) e histórico recolhível.
 */
export function PainelCapa({
  candidateId,
  corteId,
  store,
  fonte,
  aoRelocalizarFonte,
  aoMudarInstantPreview,
  aoMudarModalAberto,
}: PainelCapaProps) {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast

  const capa = store.capa as CapaCompleta | null
  const cut = useMemo(
    () => ({
      startUs: capa?.cut?.startUs ?? fonte.startUs ?? 0,
      endUs: capa?.cut?.endUs ?? fonte.endUs ?? 0,
    }),
    [capa?.cut?.startUs, capa?.cut?.endUs, fonte.startUs, fonte.endUs],
  )
  const fonteDisponivel = fonte.disponivel
  const atual = capa?.current ?? null

  const [instanteUs, setInstanteUs] = useState<number>(() =>
    limitar(atual?.instantUs ?? cut.startUs, cut.startUs, Math.max(cut.startUs, cut.endUs)),
  )
  const [reproduzindo, setReproduzindo] = useState(false)
  const [erro, setErro] = useState<ErroCore | null>(null)
  const [estimando, setEstimando] = useState(false)
  const [sugerindo, setSugerindo] = useState(false)
  const [escolhendo, setEscolhendo] = useState(false)
  const [exportando, setExportando] = useState(false)
  const [confirmacao, setConfirmacao] = useState<RespostaEstimativaCapa | null>(null)
  const [dialogoSalvarAberto, setDialogoSalvarAberto] = useState(false)
  const [caminhoSalvar, setCaminhoSalvar] = useState('')
  const [proxyLocal, setProxyLocal] = useState<ProxyComChave | null>(null)
  const sliderRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const algumModalAberto = confirmacao !== null || dialogoSalvarAberto
  useEffect(() => {
    aoMudarModalAberto?.(algumModalAberto)
  }, [algumModalAberto, aoMudarModalAberto])

  const limitarAoCorte = useCallback(
    (us: number) => limitar(us, cut.startUs, Math.max(cut.startUs, cut.endUs)),
    [cut.endUs, cut.startUs],
  )

  const mudarInstante = useCallback(
    (us: number) => {
      const proximo = limitarAoCorte(us)
      setInstanteUs(proximo)
      aoMudarInstantPreview?.(proximo)
    },
    [aoMudarInstantPreview, limitarAoCorte],
  )

  // Ao carregar/mudar a capa atual, posiciona o scrubber nela.
  const instanteAtualCapa = atual?.instantUs ?? null
  useEffect(() => {
    if (instanteAtualCapa !== null) setInstanteUs(limitarAoCorte(instanteAtualCapa))
  }, [instanteAtualCapa, limitarAoCorte])

  // Se o Corte só chegou depois, reposiciona dentro dos novos limites.
  useEffect(() => {
    setInstanteUs((v) => limitarAoCorte(v))
  }, [limitarAoCorte])

  // Transporte simulado: avança o instante enquanto reproduz, parando no fim do Corte.
  useEffect(() => {
    if (!reproduzindo) return
    const id = window.setInterval(() => {
      setInstanteUs((v) => {
        const proximo = limitarAoCorte(v + 100_000)
        if (proximo >= cut.endUs) setReproduzindo(false)
        return proximo
      })
    }, 100)
    return () => window.clearInterval(id)
  }, [cut.endUs, limitarAoCorte, reproduzindo])

  const proxyStore = store.proxy as ProxyComChave | null
  const proxyAtual = proxyLocal ?? proxyStore
  const proxyChave = proxyStore?.key ?? null
  const proxyEstadoStore = proxyStore?.state ?? 'idle'

  useEffect(() => {
    setProxyLocal(null)
  }, [proxyChave, candidateId])

  // O núcleo devolve `running` ao pedir o proxy; acompanha com `proxy.status` até ficar pronto.
  useEffect(() => {
    if (!fonteDisponivel || !proxyChave) return
    if (proxyEstadoStore !== 'queued' && proxyEstadoStore !== 'running') return
    let cancelado = false
    const consultar = async () => {
      try {
        const status = await chamar<ProxyComChave>('proxy.status', { key: proxyChave })
        if (!cancelado) setProxyLocal({ ...status, key: proxyChave })
      } catch {
        // Falha ao consultar o proxy não bloqueia a edição textual.
      }
    }
    void consultar()
    const id = window.setInterval(() => {
      if (!cancelado) void consultar()
    }, 600)
    return () => {
      cancelado = true
      window.clearInterval(id)
    }
  }, [fonteDisponivel, proxyChave, proxyEstadoStore])

  const proxyPronto = fonteDisponivel && proxyAtual?.state === 'ready' && Boolean(proxyAtual.key)
  const proxyEmAndamento =
    fonteDisponivel && (proxyAtual?.state === 'queued' || proxyAtual?.state === 'running')
  const urlProxy = proxyPronto && proxyAtual?.key ? mediaUrl(`proxy/${proxyAtual.key}`) : undefined
  const origemProxyUs =
    proxyAtual?.windowStartUs ?? Math.max(0, cut.startUs - 120_000_000)

  // Sincroniza o quadro do <video> do proxy com o instante do scrubber.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    try {
      v.currentTime = Math.max(0, (instanteUs - origemProxyUs) / 1_000_000)
    } catch {
      // jsdom não implementa a atribuição em todos os estados
    }
  }, [instanteUs, origemProxyUs, urlProxy])

  const cancelarProxy = async () => {
    if (proxyAtual?.job == null) return
    try {
      await chamar('jobs.cancel', { id: proxyAtual.job })
    } catch (e) {
      setErro(paraErroCore(e))
    }
  }

  const jobCapa = capa?.job ?? null
  const gerandoSugestao = sugerindo || jobCapa?.state === 'running' || jobCapa?.state === 'queued'

  const dispararSugestao = async (confirmed: boolean) => {
    setErro(null)
    setSugerindo(true)
    try {
      await chamar('thumbnail.suggest', { candidate: candidateId, confirmed })
      setConfirmacao(null)
      await store.recarregarCapa(candidateId)
    } catch (e) {
      const err = paraErroCore(e)
      if (err.code === 'confirmation_required' && !confirmed) {
        const est = await chamar<RespostaEstimativaCapa>('thumbnail.estimate', {
          candidate: candidateId,
        }).catch(() => null)
        if (est) setConfirmacao(est)
        else setErro(err)
      } else {
        setConfirmacao(null)
        setErro(err)
      }
    } finally {
      setSugerindo(false)
    }
  }

  const sugerir = async () => {
    setErro(null)
    setEstimando(true)
    try {
      const est = await chamar<RespostaEstimativaCapa>('thumbnail.estimate', {
        candidate: candidateId,
      })
      const destino = store.resolverDestino(est.profile)
      if (est.paid || destino.localidade === 'cli' || destino.saiDaMaquina) {
        setConfirmacao(est)
        return
      }
      await dispararSugestao(false)
    } catch (e) {
      setErro(paraErroCore(e))
    } finally {
      setEstimando(false)
    }
  }

  const instanteDentroDoCorte = instanteUs >= cut.startUs && instanteUs <= cut.endUs
  const podeUsarQuadro =
    fonteDisponivel && instanteDentroDoCorte && instanteUs !== (atual?.instantUs ?? null)

  const usarQuadro = async () => {
    if (!podeUsarQuadro || escolhendo) return
    setErro(null)
    setEscolhendo(true)
    try {
      await chamar('thumbnail.choose', { candidate: candidateId, instant_us: instanteUs })
      await store.recarregarCapa(candidateId)
    } catch (e) {
      setErro(paraErroCore(e))
    } finally {
      setEscolhendo(false)
    }
  }

  const nomePadrao = `capa-${corteId}.png`

  const exportarPara = async (output: string) => {
    setExportando(true)
    setErro(null)
    try {
      await chamar('thumbnail.export', {
        candidate: candidateId,
        output,
        instant_us: atual?.instantUs ?? instanteUs,
      })
      setDialogoSalvarAberto(false)
      toastRef.current.add({ title: 'Capa salva', description: output })
    } catch (e) {
      setErro(paraErroCore(e))
    } finally {
      setExportando(false)
    }
  }

  const salvarCapa = async () => {
    if (atual === null || !fonteDisponivel || exportando) return
    setErro(null)
    let escolhido: string | null
    try {
      escolhido = await salvarArquivo({
        defaultPath: nomePadrao,
        filters: [{ name: 'Imagem PNG', extensions: ['png'] }],
      })
    } catch {
      // Fora do app nativo: pede o caminho em um diálogo próprio.
      setCaminhoSalvar((c) => c || '')
      setDialogoSalvarAberto(true)
      return
    }
    if (!escolhido) return
    await exportarPara(escolhido)
  }

  // Handlers estáveis para atalhos e Paleta (sem recriar o registro a cada render).
  const acoesRef = useRef({ sugerir, usarQuadro, salvarCapa })
  acoesRef.current = { sugerir, usarQuadro, salvarCapa }

  const atalhos = useMemo<Atalho[]>(
    () => [
      {
        id: 'transporte.reproduzir',
        titulo: 'Reproduzir / Pausar o preview da capa',
        grupo: 'Capa',
        tecla: 'Espaço',
        teclaUnica: true,
        executar: () => setReproduzindo((v) => !v),
      },
      {
        id: 'transporte.rebobinar',
        titulo: 'Voltar 1 s no preview da capa',
        grupo: 'Capa',
        tecla: 'J',
        teclaUnica: true,
        executar: () => setInstanteUs((v) => limitar(v - PASSO_SEGUNDO_US, cut.startUs, cut.endUs)),
      },
      {
        id: 'transporte.pausar',
        titulo: 'Pausar o preview da capa',
        grupo: 'Capa',
        tecla: 'K',
        teclaUnica: true,
        executar: () => setReproduzindo(false),
      },
      {
        id: 'transporte.avancar',
        titulo: 'Avançar 1 s no preview da capa',
        grupo: 'Capa',
        tecla: 'L',
        teclaUnica: true,
        executar: () => setInstanteUs((v) => limitar(v + PASSO_SEGUNDO_US, cut.startUs, cut.endUs)),
      },
      {
        id: 'capa.quadroAnterior',
        titulo: 'Quadro anterior da capa',
        grupo: 'Capa',
        tecla: 'ArrowLeft',
        teclaUnica: true,
        executar: () => setInstanteUs((v) => limitar(v - PASSO_QUADRO_US, cut.startUs, cut.endUs)),
      },
      {
        id: 'capa.quadroSeguinte',
        titulo: 'Quadro seguinte da capa',
        grupo: 'Capa',
        tecla: 'ArrowRight',
        teclaUnica: true,
        executar: () => setInstanteUs((v) => limitar(v + PASSO_QUADRO_US, cut.startUs, cut.endUs)),
      },
      {
        id: 'empacotar.sugerirCapa',
        titulo: 'Sugerir capa',
        grupo: 'Empacotar',
        executar: () => void acoesRef.current.sugerir(),
      },
      {
        id: 'empacotar.usarQuadro',
        titulo: 'Usar quadro atual como capa',
        grupo: 'Empacotar',
        executar: () => void acoesRef.current.usarQuadro(),
      },
      {
        id: 'empacotar.exportarCapa',
        titulo: 'Exportar capa PNG',
        grupo: 'Empacotar',
        executar: () => void acoesRef.current.salvarCapa(),
      },
    ],
    [cut.endUs, cut.startUs],
  )
  useAtalhos(atalhos)

  const historico = useMemo(() => {
    const sugestoes: EntradaHistorico[] = (capa?.suggestions ?? []).map((s) => ({ ...s, origin: 'ai' as const }))
    const escolhas: EntradaHistorico[] = (capa?.choices ?? []).map((c) => ({ ...c, origin: c.origin ?? ('user' as const) }))
    const legado: EntradaHistorico[] = (capa?.history ?? []).map((h) => ({ instantUs: h.instantUs, origin: h.origin }))
    return { sugestoes, escolhas, legado }
  }, [capa?.choices, capa?.history, capa?.suggestions])
  const totalHistorico =
    historico.sugestoes.length + historico.escolhas.length + historico.legado.length

  const destinoConfirmacao = confirmacao ? store.resolverDestino(confirmacao.profile) : null
  const duracaoCorte = Math.max(0, cut.endUs - cut.startUs)
  const posicaoRelativa = instanteUs - cut.startUs
  const tempoRotulo = `${tc(posicaoRelativa)} / ${tc(duracaoCorte)}`

  const porcentoProxy = proxyAtual?.progress ?? null

  const botaoExportarDesabilitado = atual === null || !fonteDisponivel || exportando

  return (
    <section aria-label="Capa e preview" className="flex min-w-0 flex-col gap-3 p-4">
      <h2 className="m-0 text-base font-forte text-t1">Capa e preview</h2>
      {erro && (
        <ErroEmpacotar
          erro={erro}
          acoes={{
            reabrirSalvar: () => void salvarCapa(),
            relocalizarFonte: aoRelocalizarFonte,
            abrirFila: () => {
              window.location.hash = hashDaFila()
            },
            focarCampo: () => sliderRef.current?.focus(),
          }}
          aoDispensar={() => setErro(null)}
        />
      )}

      {!fonteDisponivel && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-area bg-area px-3 py-2.5 text-pequeno"
        >
          <div className="flex items-center gap-2">
            <Status tom="aviso">Fonte offline</Status>
            <span className="text-t2">
              A Fonte foi movida ou alterada no disco. Você pode editar os textos, mas precisa
              relocalizar para ver o preview ou exportar a capa.
            </span>
          </div>
          <div>
            <Botao tamanho="p" variante="secundario" onClick={aoRelocalizarFonte}>
              Relocalizar Fonte
            </Botao>
          </div>
        </div>
      )}

      {proxyEmAndamento && (
        <div className="flex items-center gap-3">
          <Progresso
            valor={porcentoProxy}
            rotulo="Preparando o preview do Corte"
            className="min-w-0 flex-1"
          />
          {proxyAtual?.job != null && (
            <Botao tamanho="p" variante="fantasma" onClick={() => void cancelarProxy()}>
              Cancelar
            </Botao>
          )}
        </div>
      )}

      <div className="relative mx-auto w-full max-w-[420px]">
        {fonteDisponivel && !urlProxy ? (
          <div
            role="img"
            aria-label={proxyEmAndamento ? 'Preparando prévia do Corte' : 'Prévia do quadro do Corte'}
            className="relative flex aspect-[9/16] max-h-[42vh] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-area bg-preto p-4 text-center shadow-[0_0_0_1px_var(--contorno-controle)]"
          >
            <Film className="size-6 stroke-[1.5] text-t3" aria-hidden />
            <span className="text-pequeno text-t2">
              {proxyEmAndamento ? 'Preparando quadro…' : 'Prévia em preparação…'}
            </span>
          </div>
        ) : (
          <PlayerProxy
            sourceId={fonte.id}
            fonteDisponivel={fonteDisponivel}
            startUs={cut.startUs}
            endUs={cut.endUs}
            poster={urlProxy}
            modo="capa"
            tempoAtualUs={instanteUs}
            reproduzindo={reproduzindo}
            aoMudarTempoUs={mudarInstante}
            aoMudarReproduzindo={setReproduzindo}
            className="max-h-[42vh] w-full"
          />
        )}
        {urlProxy && (
          <video
            ref={videoRef}
            src={urlProxy}
            muted
            playsInline
            aria-hidden
            className="pointer-events-none absolute inset-0 block h-full w-full rounded-area bg-preto object-contain"
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <ScrubberCapa
          valorUs={instanteUs}
          minUs={cut.startUs}
          maxUs={Math.max(cut.startUs, cut.endUs)}
          aoMudar={mudarInstante}
          desabilitado={!fonteDisponivel}
          refSlider={sliderRef}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Botao
              tamanho="p"
              variante="fantasma"
              disabled={!fonteDisponivel}
              onClick={() => mudarInstante(instanteUs - PASSO_SEGUNDO_US)}
            >
              -1 s
            </Botao>
            <Botao
              tamanho="p"
              variante="fantasma"
              disabled={!fonteDisponivel}
              icone={reproduzindo ? <Pause /> : <Play />}
              onClick={() => setReproduzindo((v) => !v)}
            >
              {reproduzindo ? 'Pausar' : 'Reproduzir'}
            </Botao>
            <Botao
              tamanho="p"
              variante="fantasma"
              disabled={!fonteDisponivel}
              onClick={() => mudarInstante(instanteUs + PASSO_SEGUNDO_US)}
            >
              +1 s
            </Botao>
          </div>
          <span className="num text-pequeno text-t2" aria-label="Instante atual do Corte">
            {tempoRotulo}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 rounded-area bg-area px-3 py-2.5">
        {atual ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="num text-t1">{tc(atual.instantUs - cut.startUs)}</span>
              <Status tom="info">
                {atual.origin !== 'user' ? 'Sugerido pelo Provedor' : 'Escolhido por você'}
              </Status>
              <span className="num text-pequeno text-t3">
                Duração do Corte: {duracao(duracaoCorte)}
              </span>
            </div>
            {(() => {
              const motivo = (atual as { why?: string | null }).why
              return atual.origin !== 'user' && motivo ? (
                <p className="text-pequeno text-t2">{motivo.slice(0, capa?.maxWhyChars ?? 200)}</p>
              ) : null
            })()}
          </>
        ) : (
          <p className="text-t2">Nenhum momento de capa escolhido ainda.</p>
        )}
      </div>

      {gerandoSugestao && (
        <FaixaJob
          rotulo="Sugerindo momento da capa…"
          aoCancelar={
            jobCapa?.id != null
              ? () => {
                  void chamar('jobs.cancel', { id: jobCapa.id })
                    .then(() => store.recarregarCapa(candidateId))
                    .catch((e) => setErro(paraErroCore(e)))
                }
              : undefined
          }
        />
      )}

      <div className="flex flex-wrap gap-2">
        <Botao
          variante="secundario"
          carregando={estimando}
          disabled={gerandoSugestao}
          onClick={() => void sugerir()}
        >
          {(atual && atual.origin !== 'user') || (capa?.suggestions?.length ?? 0) > 0
            ? 'Sugerir de novo'
            : 'Sugerir momento da capa'}
        </Botao>
        <Botao
          variante="secundario"
          carregando={escolhendo}
          disabled={!podeUsarQuadro}
          onClick={() => void usarQuadro()}
        >
          Usar quadro atual como capa
        </Botao>
        <Botao
          variante="secundario"
          carregando={exportando}
          disabled={botaoExportarDesabilitado}
          onClick={() => void salvarCapa()}
        >
          Salvar capa (PNG)
        </Botao>
      </div>

      <details className="group rounded-area bg-area px-3 py-2 text-pequeno">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-t2">
          <ChevronRight
            className="size-[14px] stroke-[1.75] transition-transform group-open:rotate-90"
            aria-hidden
          />
          Histórico de sugestões <span className="num text-t3">({totalHistorico})</span>
        </summary>
        <div className="mt-2 flex flex-col gap-1">
          {totalHistorico === 0 && <p className="text-t3">Nenhuma sugestão ou escolha ainda.</p>}
          {[...historico.sugestoes, ...historico.escolhas, ...historico.legado].map((item, i) => (
            <div key={`${item.origin}-${item.id ?? i}-${item.instantUs}`} className="flex items-center gap-2">
              <span className="num text-t1">{tc(item.instantUs - cut.startUs)}</span>
              <span className="text-t3">
                {item.origin !== 'user' ? 'Sugerido pelo Provedor' : 'Escolhido por você'}
              </span>
              {item.why && <span className="min-w-0 flex-1 truncate text-t3">{item.why}</span>}
              <Botao
                tamanho="p"
                variante="fantasma"
                className="ml-auto"
                onClick={() => mudarInstante(item.instantUs)}
              >
                Ver quadro
              </Botao>
            </div>
          ))}
        </div>
      </details>

      <ConfirmDialog
        aberto={confirmacao !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto && !sugerindo) setConfirmacao(null)
        }}
        titulo="Confirmar sugestão de capa"
        descricao="Confira o Perfil de Provedor, o destino de privacidade e o custo estimado. Só texto da Transcrição é enviado."
        rotuloConfirmar="Confirmar e sugerir"
        rotuloCancelar="Cancelar"
        focoInicial="cancelar"
        ocupado={sugerindo}
        confirmarDesabilitado={Boolean(destinoConfirmacao?.bloqueadoSomenteLocal)}
        aoConfirmar={() => void dispararSugestao(true)}
      >
        {confirmacao && destinoConfirmacao && (
          <ResumoCustoPrivacidade
            tarefa="Sugestão de momento da capa"
            perfil={destinoConfirmacao.perfil}
            localidade={destinoConfirmacao.localidade}
            saiDaMaquina={destinoConfirmacao.saiDaMaquina}
            host={destinoConfirmacao.host}
            estimativa={converterEstimativa(confirmacao.estimate)}
            orcamento={
              store.orcamento
                ? {
                    restanteMicroUsd: store.orcamento.remainingMicroUsd ?? null,
                    callsRestantes: store.orcamento.callsRemaining ?? null,
                    pausado: Boolean(store.orcamento.paused),
                  }
                : null
            }
            bloqueadoSomenteLocal={destinoConfirmacao.bloqueadoSomenteLocal}
          />
        )}
      </ConfirmDialog>

      <Dialogo
        aberto={dialogoSalvarAberto}
        aoMudarAberto={setDialogoSalvarAberto}
        titulo="Salvar capa (PNG)"
        descricao="Informe a pasta e o nome do arquivo PNG. A capa sai no tamanho original do vídeo, sem legenda nem filtros."
        rodape={
          <>
            <Botao variante="fantasma" disabled={exportando} onClick={() => setDialogoSalvarAberto(false)}>
              Cancelar
            </Botao>
            <Botao
              variante="primario"
              carregando={exportando}
              disabled={!caminhoSalvar.trim()}
              onClick={() => void exportarPara(caminhoSalvar.trim())}
            >
              Salvar capa
            </Botao>
          </>
        }
      >
        <SeletorCaminho
          modo="arquivo"
          rotulo="Arquivo PNG da capa"
          valor={caminhoSalvar}
          aoMudar={setCaminhoSalvar}
          placeholder={nomePadrao}
        />
      </Dialogo>
    </section>
  )
}
