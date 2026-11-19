import { Botao, BotaoIcone, Dica, Progresso, Status, cn, duracao, tc, tcLongo } from '@ds'
import { Diamond, Minus, Music, Plus, Scissors, Sparkles, VolumeX, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { chamar } from '~/core/cliente'
import type { Fila } from '~/core/progresso'
import {
  PX_PER_SEC,
  sentenceAt,
  usToPx,
  useEditorCorte,
  visiblePx,
  visibleSentences,
  visibleThumbs,
  type CropKeyframe,
  type EditorDocumento,
  type EstadoEditorCorte,
  type StoreEditorCorte,
} from '~/stores/editorCorte'
import { mediaUrl } from '../../../../src/lib/media'

export type OverlayBorda = {
  lado: 'start' | 'end'
  timeUs: number
  livrePorQuadro: boolean
} | null

export type TimelineCorteProps = {
  videoKind: 'direct' | 'transformed'
  fonteDisponivel: boolean
  aoMudarOverlayBorda?: (overlay: OverlayBorda) => void
  projetoPath?: string | null
  corteId?: string | null
  store?: StoreEditorCorte
  fila?: Fila
  tempoAtualUs?: number
  aoMudarTempoUs?: (us: number, preview?: boolean) => void
  className?: string
}

const ROTULO_LARGURA = 128
const PASSOS_ZOOM = [0.5, 0.75, 1, 1.5, 2, 3, 4]

function formatarTcComMs(us: number): string {
  const limpo = Math.max(0, Math.round(us))
  const ms = Math.floor((limpo % 1_000_000) / 1000)
  return `${tcLongo(limpo)}.${String(ms).padStart(3, '0')}`
}

function formatarSegundosCurto(us: number): string {
  return (Math.max(0, us) / 1_000_000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

function TimelineComStore(props: TimelineCorteProps & { store: StoreEditorCorte }) {
  const estado = useSyncExternalStore(
    props.store.assinar,
    props.store.obterSnapshot,
    props.store.obterSnapshot,
  )
  return <TimelineInterna {...props} estado={estado} store={props.store} />
}

function TimelineComHook(props: TimelineCorteProps) {
  const editor = useEditorCorte(props.projetoPath ?? null, props.corteId ?? null, {
    fonteDisponivel: props.fonteDisponivel,
    fila: props.fila,
  })
  return <TimelineInterna {...props} estado={editor} store={editor.store} />
}

/** Timeline compacta do proxy (±2 min): 2 faixas padrão (Vídeo/Áudio) + expansão "+3 faixas". */
export function TimelineCorte(props: TimelineCorteProps) {
  if (props.store) {
    return <TimelineComStore {...props} store={props.store} />
  }
  return <TimelineComHook {...props} />
}

function TimelineInterna({
  videoKind,
  fonteDisponivel,
  aoMudarOverlayBorda,
  store,
  estado,
  tempoAtualUs = 0,
  aoMudarTempoUs,
  className,
}: TimelineCorteProps & { estado: EstadoEditorCorte; store: StoreEditorCorte }) {
  const doc: EditorDocumento | null = estado.previaLocal ?? estado.oficial
  const [faixasExtrasAbertas, setFaixasExtrasAbertas] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [altPressionado, setAltPressionado] = useState(false)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewportLargura, setViewportLargura] = useState(960)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pistaRef = useRef<HTMLDivElement | null>(null)
  const minimapaRef = useRef<HTMLDivElement | null>(null)

  const arrastoAgulhaRef = useRef(false)
  const arrastoAlcaRef = useRef<{ lado: 'start' | 'end'; alt: boolean } | null>(null)
  const arrastoNarracaoRef = useRef<{ blockId: number; alt: boolean } | null>(null)
  const arrastoSfxRef = useRef<{ sfxId: number; alt: boolean } | null>(null)
  const arrastoMinimapaRef = useRef(false)

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Alt') setAltPressionado(true)
    }
    const onKeyUp = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Alt') setAltPressionado(false)
    }
    const onBlur = () => setAltPressionado(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setViewportLargura(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const startUs = doc?.startUs ?? 0
  const endUs = doc?.endUs ?? 30_000_000
  const windowStartUs = doc?.windowStartUs ?? Math.max(0, startUs - 120_000_000)
  const windowEndUs = doc?.windowEndUs ?? endUs + 120_000_000
  const totalWindowUs = Math.max(1, windowEndUs - windowStartUs)
  const fps = doc?.fps && doc.fps > 0 ? doc.fps : 24
  const frameUs = Math.round(1_000_000 / fps)

  const pct = useCallback(
    (us: number) => `${Math.max(0, Math.min(100, ((us - windowStartUs) / totalWindowUs) * 100))}%`,
    [totalWindowUs, windowStartUs],
  )

  const larg = useCallback(
    (a: number, b: number) => `${Math.max(0, ((b - a) / totalWindowUs) * 100)}%`,
    [totalWindowUs],
  )

  const usDoElementoX = useCallback(
    (el: HTMLElement | null, clientX: number) => {
      if (!el) return startUs
      const rect = el.getBoundingClientRect()
      const w = rect.width > 0 ? rect.width : 1
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / w))
      return Math.round(windowStartUs + ratio * totalWindowUs)
    },
    [startUs, totalWindowUs, windowStartUs],
  )

  // Régua adaptativa
  const marcasRegua = useMemo(() => {
    const passo =
      [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
        .map((s) => s * 1_000_000)
        .find((s) => totalWindowUs / s <= 8) ?? 60_000_000
    const lista: number[] = []
    for (let m = windowStartUs; m < windowEndUs - passo * 0.35; m += passo) {
      lista.push(m)
    }
    lista.push(windowEndUs)
    return lista
  }, [totalWindowUs, windowEndUs, windowStartUs])

  // Faixa visível na janela com zoom para virtualização leve (timelineMath.ts)
  const totalBasePx = Math.max(1, usToPx(windowEndUs, windowStartUs))
  const faixaVisivelBase = useMemo(
    () => visiblePx(scrollLeft / zoom, viewportLargura / zoom, totalBasePx),
    [scrollLeft, totalBasePx, viewportLargura, zoom],
  )

  const frasesVisiveis = useMemo(
    () => visibleSentences(estado.frases, windowStartUs, faixaVisivelBase),
    [estado.frases, faixaVisivelBase, windowStartUs],
  )

  const thumbsVisiveis = useMemo(() => {
    const th = estado.timeline.thumbs
    if (!fonteDisponivel || !th || th.count <= 0) return []
    return visibleThumbs(th.count, th.intervalUs, faixaVisivelBase)
  }, [estado.timeline.thumbs, faixaVisivelBase, fonteDisponivel])

  const keyframesManuais = useMemo(() => {
    if (!doc) return [] as Array<{ id: string; kf: CropKeyframe }>
    const out: Array<{ id: string; kf: CropKeyframe }> = []
    doc.crop.edits.forEach((kf, i) => out.push({ id: `p-${i}`, kf }))
    if (doc.crop.gameplayWebcam) {
      doc.crop.gameplayWebcam.top.edits.forEach((kf, i) => out.push({ id: `gt-${i}`, kf }))
      doc.crop.gameplayWebcam.bottom.edits.forEach((kf, i) => out.push({ id: `gb-${i}`, kf }))
    }
    if (doc.crop.twoPeople) {
      doc.crop.twoPeople.top.edits.forEach((kf, i) => out.push({ id: `tp-${i}`, kf }))
      doc.crop.twoPeople.bottom.edits.forEach((kf, i) => out.push({ id: `tb-${i}`, kf }))
    }
    return out
  }, [doc])

  // Onda amostrada para ~96 pontos limpos
  const barrasOnda = useMemo(() => {
    const vals = estado.timeline.waveValues
    if (!fonteDisponivel || vals.length === 0) return []
    const alvo = 96
    if (vals.length <= alvo) {
      const maxVal = Math.max(1, ...vals)
      return vals.map((v) => Math.max(0.08, v / maxVal))
    }
    const bloco = vals.length / alvo
    const maxVal = Math.max(1, ...vals)
    return Array.from({ length: alvo }, (_, i) => {
      const idx = Math.min(vals.length - 1, Math.floor(i * bloco))
      return Math.max(0.08, vals[idx] / maxVal)
    })
  }, [estado.timeline.waveValues, fonteDisponivel])

  const alterarZoom = (direcao: -1 | 1) => {
    const idxAtual = PASSOS_ZOOM.findIndex((z) => z >= zoom)
    const baseIdx = idxAtual < 0 ? PASSOS_ZOOM.length - 1 : idxAtual
    const proxIdx = Math.min(PASSOS_ZOOM.length - 1, Math.max(0, baseIdx + direcao))
    setZoom(PASSOS_ZOOM[proxIdx])
  }

  const ajustarAoCorte = () => {
    const ratio = totalWindowUs / Math.max(1, endUs - startUs)
    const ideal = Math.min(4, Math.max(1, Math.round(ratio * 2) / 2))
    setZoom(ideal)
    if (scrollRef.current) {
      const totalLarg = scrollRef.current.scrollWidth || viewportLargura * ideal
      const alvoX = ((startUs - windowStartUs) / totalWindowUs) * totalLarg
      scrollRef.current.scrollLeft = Math.max(0, alvoX - 24)
      setScrollLeft(scrollRef.current.scrollLeft)
    }
  }

  const moverScrollPorMinimapa = (clientX: number) => {
    const mm = minimapaRef.current
    const sc = scrollRef.current
    if (!mm) return
    const rect = mm.getBoundingClientRect()
    const w = rect.width > 0 ? rect.width : 1
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / w))
    if (sc) {
      const maxScroll = Math.max(0, sc.scrollWidth - sc.clientWidth)
      const novoScroll = Math.round(ratio * maxScroll)
      sc.scrollLeft = novoScroll
      setScrollLeft(novoScroll)
    }
    const alvoUs = Math.round(windowStartUs + ratio * totalWindowUs)
    aoMudarTempoUs?.(alvoUs, false)
  }

  const ajustar5Frases = (lado: 'start' | 'end', direcao: -1 | 1) => {
    const posAtual = lado === 'start' ? startUs : endUs
    const ordenadas = [...estado.frases].sort((a, b) => a.startUs - b.startUs)
    if (ordenadas.length > 0) {
      const atualFrase =
        sentenceAt(ordenadas, lado === 'start' ? posAtual : Math.max(0, posAtual - 1)) ??
        ordenadas[0]
      const idxAtual = ordenadas.findIndex((f) => f.id === atualFrase.id)
      const idxAlvo = Math.min(
        ordenadas.length - 1,
        Math.max(0, (idxAtual >= 0 ? idxAtual : 0) + direcao * 5),
      )
      const fraseAlvo = ordenadas[idxAlvo]
      if (fraseAlvo) {
        void store.ajustarBorda({ edge: lado, sentenceId: fraseAlvo.id, preview: false })
        return
      }
    }
    const reqId = lado === 'start' ? (doc?.request.start_id ?? 1) : (doc?.request.end_id ?? 1)
    void store.ajustarBorda({
      edge: lado,
      sentenceId: Math.max(1, reqId + direcao * 5),
      preview: false,
    })
  }

  const tratarTeclaAlca = (e: KeyboardEvent<HTMLDivElement>, lado: 'start' | 'end') => {
    const posAtual = lado === 'start' ? startUs : endUs
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      e.stopPropagation()
      const dir: -1 | 1 = e.key === 'ArrowRight' ? 1 : -1
      if (e.altKey) {
        const novoUs = Math.min(windowEndUs, Math.max(windowStartUs, posAtual + dir * frameUs))
        void store.ajustarBorda({ edge: lado, timeUs: novoUs, free: true, preview: false })
      } else {
        void store.ajustarBorda({ edge: lado, sentenceDelta: dir, preview: false })
      }
      return
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
      e.stopPropagation()
      const dir: -1 | 1 = e.key === 'PageUp' ? 1 : -1
      ajustar5Frases(lado, dir)
    }
  }

  const tratarTeclaAgulha = (e: KeyboardEvent<HTMLDivElement>) => {
    const passo = e.shiftKey ? 1_000_000 : 100_000
    const mapa: Record<string, number> = {
      ArrowRight: tempoAtualUs + passo,
      ArrowLeft: tempoAtualUs - passo,
      Home: startUs,
      End: endUs,
    }
    if (e.key in mapa) {
      e.preventDefault()
      e.stopPropagation()
      const clamped = Math.min(windowEndUs, Math.max(windowStartUs, mapa[e.key]))
      aoMudarTempoUs?.(clamped, false)
    }
  }

  const mostrarNarracao = videoKind === 'transformed' && doc !== null && doc.montage !== null
  const mostrarProgressoTimeline =
    fonteDisponivel &&
    (estado.timeline.state === 'queued' || estado.timeline.state === 'running')

  // Janela visível no mini-mapa (%)
  const larguraScroll = scrollRef.current?.scrollWidth || viewportLargura * zoom
  const miniJanelaEsqPct =
    larguraScroll > 0 ? Math.min(100, (scrollLeft / larguraScroll) * 100) : 0
  const miniJanelaLargPct =
    larguraScroll > 0 ? Math.min(100 - miniJanelaEsqPct, (viewportLargura / larguraScroll) * 100) : 100

  const tempoCorteEfetivoUs = doc?.silences.effectiveDurationUs ?? Math.max(0, endUs - startUs)
  const removidoUs = doc?.silences.removedUs ?? 0

  return (
    <section
      data-regiao="timeline"
      aria-label="Timeline compacta do Corte"
      className={cn(
        'flex shrink-0 flex-col border-t border-linha bg-chao px-4 pt-1.5 pb-2 select-none',
        className,
      )}
    >
      {/* Cabeçalho da Timeline */}
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-pequeno">
        <div className="flex items-center gap-1">
          <span className="font-medio text-t2">Entrada</span>
          <Botao
            tamanho="p"
            variante="suave"
            aria-label="Recuar Entrada 1 Frase"
            onClick={() => void store.ajustarBorda({ edge: 'start', sentenceDelta: -1, preview: false })}
          >
            −1F
          </Botao>
          <Botao
            tamanho="p"
            variante="suave"
            aria-label="Avançar Entrada 1 Frase"
            onClick={() => void store.ajustarBorda({ edge: 'start', sentenceDelta: 1, preview: false })}
          >
            +1F
          </Botao>
        </div>

        <span aria-hidden className="text-linha-forte">
          |
        </span>

        <span className="num text-t2">
          Duração efetiva: <strong className="text-t1">{duracao(tempoCorteEfetivoUs)}</strong>
          {removidoUs > 0 && (
            <span className="ml-1.5 text-t3">(-{formatarSegundosCurto(removidoUs)} s silêncios)</span>
          )}
        </span>

        <Status tom={altPressionado ? 'info' : 'neutro'}>
          {altPressionado ? 'Livre por quadro (Alt)' : 'Encaixe em Frase'}
        </Status>

        <span aria-hidden className="text-linha-forte">
          |
        </span>

        <div className="flex items-center gap-1">
          <span className="font-medio text-t2">Saída</span>
          <Botao
            tamanho="p"
            variante="suave"
            aria-label="Recuar Saída 1 Frase"
            onClick={() => void store.ajustarBorda({ edge: 'end', sentenceDelta: -1, preview: false })}
          >
            −1F
          </Botao>
          <Botao
            tamanho="p"
            variante="suave"
            aria-label="Avançar Saída 1 Frase"
            onClick={() => void store.ajustarBorda({ edge: 'end', sentenceDelta: 1, preview: false })}
          >
            +1F
          </Botao>
        </div>

        {!fonteDisponivel && (
          <Status tom="aviso">Fonte offline — bordas por Frase disponíveis</Status>
        )}

        {mostrarProgressoTimeline && (
          <div className="flex items-center gap-2">
            <div className="w-40">
              <Progresso
                compacto
                valor={estado.timeline.progress}
                rotulo="Gerando miniaturas e onda"
              />
            </div>
            {estado.timeline.job !== null && (
              <Botao
                tamanho="p"
                variante="fantasma"
                onClick={() => void chamar('jobs.cancel', { id: estado.timeline.job })}
              >
                Cancelar
              </Botao>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Botao
            tamanho="p"
            variante={faixasExtrasAbertas ? 'secundario' : 'suave'}
            icone={faixasExtrasAbertas ? <X /> : <Plus />}
            aria-expanded={faixasExtrasAbertas}
            onClick={() => setFaixasExtrasAbertas((v) => !v)}
          >
            {faixasExtrasAbertas ? 'Recolher faixas' : '+3 faixas'}
          </Botao>

          <BotaoIcone
            rotulo="Diminuir zoom"
            tamanho="p"
            disabled={zoom <= PASSOS_ZOOM[0]}
            onClick={() => alterarZoom(-1)}
          >
            <Minus />
          </BotaoIcone>
          <span className="num min-w-10 text-center text-micro text-t3">
            {Math.round(zoom * 100)}%
          </span>
          <Botao
            tamanho="p"
            variante="fantasma"
            aria-label="Ajustar zoom ao Corte"
            onClick={ajustarAoCorte}
          >
            Ajustar ao Corte
          </Botao>
          <BotaoIcone
            rotulo="Aumentar zoom"
            tamanho="p"
            disabled={zoom >= PASSOS_ZOOM[PASSOS_ZOOM.length - 1]}
            onClick={() => alterarZoom(1)}
          >
            <Plus />
          </BotaoIcone>
        </div>
      </div>

      {/* Mini-mapa (Dual Timeline ±2 min) */}
      <div
        ref={minimapaRef}
        role="region"
        aria-label="Mini-mapa da timeline (±2 min)"
        onPointerDown={(e) => {
          arrastoMinimapaRef.current = true
          moverScrollPorMinimapa(e.clientX)
        }}
        onPointerMove={(e) => {
          if (arrastoMinimapaRef.current) moverScrollPorMinimapa(e.clientX)
        }}
        onPointerUp={() => {
          arrastoMinimapaRef.current = false
        }}
        className="relative mb-1.5 h-3.5 w-full cursor-pointer overflow-hidden rounded-mini bg-area"
      >
        <div
          aria-hidden
          className="absolute inset-y-0.5 rounded-[2px] bg-t2/35"
          style={{ left: pct(startUs), width: larg(startUs, endUs) }}
        />
        <div
          aria-hidden
          className="absolute inset-y-0 rounded-mini border border-linha-forte bg-elevado/40"
          style={{ left: `${miniJanelaEsqPct}%`, width: `${miniJanelaLargPct}%` }}
        />
        <div
          aria-hidden
          className="absolute inset-y-0 w-0.5 bg-sinal"
          style={{ left: pct(tempoAtualUs) }}
        />
      </div>

      {/* Trilhos com rótulos fixos à esquerda + viewport rolável */}
      <div className="flex min-w-0">
        {/* Coluna de rótulos */}
        <div className="flex shrink-0 flex-col gap-1 pr-2" style={{ width: ROTULO_LARGURA }}>
          <div className="h-[18px] text-micro text-t3">Régua</div>
          <div className="flex h-7 items-center text-pequeno text-t2">Vídeo</div>
          <div className="flex h-7 items-center text-pequeno text-t2">Áudio</div>
          {faixasExtrasAbertas && (
            <>
              <div className="flex h-7 items-center text-pequeno text-t2">
                Frases &amp; Keyframes
              </div>
              {mostrarNarracao && (
                <div className="flex h-7 items-center text-pequeno text-t2">Narração</div>
              )}
              <div className="flex h-7 items-center text-pequeno text-t2">Trilha &amp; SFX</div>
            </>
          )}
        </div>

        {/* Viewport horizontal da timeline */}
        <div
          ref={scrollRef}
          onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
          className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
        >
          <div
            ref={pistaRef}
            data-testid="timeline-pista"
            className="relative flex flex-col gap-1"
            style={{ width: `${Math.max(100, zoom * 100)}%` }}
          >
            {/* Régua */}
            <div
              onPointerDown={(e) => {
                arrastoAgulhaRef.current = true
                aoMudarTempoUs?.(usDoElementoX(pistaRef.current, e.clientX), true)
              }}
              onPointerMove={(e) => {
                if (!arrastoAgulhaRef.current) return
                aoMudarTempoUs?.(usDoElementoX(pistaRef.current, e.clientX), true)
              }}
              onPointerUp={(e) => {
                if (!arrastoAgulhaRef.current) return
                arrastoAgulhaRef.current = false
                aoMudarTempoUs?.(usDoElementoX(pistaRef.current, e.clientX), false)
              }}
              className="num relative h-[18px] cursor-pointer text-micro text-t3"
            >
              {marcasRegua.map((m, i) => (
                <span
                  key={m}
                  className="absolute top-0"
                  style={{
                    left: pct(m),
                    translate:
                      i === 0 ? '0' : i === marcasRegua.length - 1 ? '-100%' : '-50%',
                  }}
                >
                  {tc(m - windowStartUs).slice(0, 5)}
                </span>
              ))}
            </div>

            {/* Faixa 1: Vídeo + Alças Entrada/Saída */}
            <div className="relative h-7 overflow-hidden rounded-mini bg-area">
              {fonteDisponivel && estado.timeline.thumbs ? (
                <div className="pointer-events-none absolute inset-0">
                  {thumbsVisiveis.map((idx) => {
                    const th = estado.timeline.thumbs!
                    const thumbUs = windowStartUs + idx * th.intervalUs
                    const thumbEndUs = Math.min(windowEndUs, thumbUs + th.intervalUs)
                    const col = idx % th.columns
                    const row = Math.floor(idx / th.columns)
                    const totalRows = Math.max(1, Math.ceil(th.count / th.columns))
                    return (
                      <div
                        key={idx}
                        className="absolute inset-y-0 opacity-70"
                        style={{
                          left: pct(thumbUs),
                          width: larg(thumbUs, thumbEndUs),
                          backgroundImage: `url(${mediaUrl(th.id)})`,
                          backgroundSize: `${th.columns * 100}% ${totalRows * 100}%`,
                          backgroundPosition: `${(col / Math.max(1, th.columns - 1)) * 100}% ${(row / Math.max(1, totalRows - 1)) * 100}%`,
                        }}
                      />
                    )
                  })}
                </div>
              ) : (
                <div className="flex h-full items-center px-2 text-micro text-t3">
                  {fonteDisponivel ? 'Miniaturas aguardando proxy' : 'Sem miniaturas (Fonte offline)'}
                </div>
              )}

              {/* Destaque do intervalo do Corte */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 shadow-[inset_2px_0_0_var(--t2),inset_-2px_0_0_var(--t2)]"
                style={{ left: pct(startUs), width: larg(startUs, endUs) }}
              />

              {/* Alça Entrada (I) */}
              <div
                role="slider"
                tabIndex={0}
                aria-label="Alça Entrada"
                aria-valuemin={windowStartUs}
                aria-valuemax={windowEndUs}
                aria-valuenow={startUs}
                aria-valuetext={`Entrada em ${formatarTcComMs(startUs)} da Fonte`}
                onKeyDown={(e) => tratarTeclaAlca(e, 'start')}
                onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
                  e.stopPropagation()
                  e.currentTarget.setPointerCapture?.(e.pointerId)
                  const alt = e.altKey || altPressionado
                  arrastoAlcaRef.current = { lado: 'start', alt }
                  const u = usDoElementoX(pistaRef.current, e.clientX)
                  aoMudarOverlayBorda?.({ lado: 'start', timeUs: u, livrePorQuadro: alt })
                }}
                onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
                  if (arrastoAlcaRef.current?.lado !== 'start') return
                  const alt = e.altKey || arrastoAlcaRef.current.alt || altPressionado
                  const u = usDoElementoX(pistaRef.current, e.clientX)
                  aoMudarOverlayBorda?.({ lado: 'start', timeUs: u, livrePorQuadro: alt })
                  void store.ajustarBorda({ edge: 'start', timeUs: u, free: alt, preview: true })
                }}
                onPointerUp={(e: PointerEvent<HTMLDivElement>) => {
                  if (arrastoAlcaRef.current?.lado !== 'start') return
                  const alt = e.altKey || arrastoAlcaRef.current.alt || altPressionado
                  arrastoAlcaRef.current = null
                  const u = usDoElementoX(pistaRef.current, e.clientX)
                  void store.ajustarBorda({ edge: 'start', timeUs: u, free: alt, preview: false })
                  aoMudarOverlayBorda?.(null)
                }}
                style={{ left: pct(startUs) }}
                className="foco absolute inset-y-0 z-10 flex min-h-6 min-w-6 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-mini bg-elevado/90 text-micro font-forte text-t1 shadow-[inset_0_0_0_1px_var(--linha-forte)]"
              >
                I
              </div>

              {/* Alça Saída (O) */}
              <div
                role="slider"
                tabIndex={0}
                aria-label="Alça Saída"
                aria-valuemin={windowStartUs}
                aria-valuemax={windowEndUs}
                aria-valuenow={endUs}
                aria-valuetext={`Saída em ${formatarTcComMs(endUs)} da Fonte`}
                onKeyDown={(e) => tratarTeclaAlca(e, 'end')}
                onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
                  e.stopPropagation()
                  e.currentTarget.setPointerCapture?.(e.pointerId)
                  const alt = e.altKey || altPressionado
                  arrastoAlcaRef.current = { lado: 'end', alt }
                  const u = usDoElementoX(pistaRef.current, e.clientX)
                  aoMudarOverlayBorda?.({ lado: 'end', timeUs: u, livrePorQuadro: alt })
                }}
                onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
                  if (arrastoAlcaRef.current?.lado !== 'end') return
                  const alt = e.altKey || arrastoAlcaRef.current.alt || altPressionado
                  const u = usDoElementoX(pistaRef.current, e.clientX)
                  aoMudarOverlayBorda?.({ lado: 'end', timeUs: u, livrePorQuadro: alt })
                  void store.ajustarBorda({ edge: 'end', timeUs: u, free: alt, preview: true })
                }}
                onPointerUp={(e: PointerEvent<HTMLDivElement>) => {
                  if (arrastoAlcaRef.current?.lado !== 'end') return
                  const alt = e.altKey || arrastoAlcaRef.current.alt || altPressionado
                  arrastoAlcaRef.current = null
                  const u = usDoElementoX(pistaRef.current, e.clientX)
                  void store.ajustarBorda({ edge: 'end', timeUs: u, free: alt, preview: false })
                  aoMudarOverlayBorda?.(null)
                }}
                style={{ left: pct(endUs) }}
                className="foco absolute inset-y-0 z-10 flex min-h-6 min-w-6 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-mini bg-elevado/90 text-micro font-forte text-t1 shadow-[inset_0_0_0_1px_var(--linha-forte)]"
              >
                O
              </div>
            </div>

            {/* Faixa 2: Áudio e Silêncios */}
            <div className="relative flex h-7 items-center gap-0.5 overflow-hidden rounded-mini bg-area px-1">
              {barrasOnda.map((v, i) => (
                <span
                  key={i}
                  aria-hidden
                  className="flex-1 rounded-[1px] bg-t3 opacity-55"
                  style={{ height: `${Math.round(v * 100)}%` }}
                />
              ))}
              {doc?.silences.intervals.map((s) => {
                const removido = s.status === 'active'
                return (
                  <span
                    key={s.id}
                    title={
                      removido
                        ? `Silêncio removido (${formatarSegundosCurto(s.endUs - s.startUs)} s)`
                        : `Silêncio mantido (${formatarSegundosCurto(s.endUs - s.startUs)} s)`
                    }
                    className={cn(
                      'absolute inset-y-0.5 flex items-center justify-center overflow-hidden rounded-[2px] border border-dashed border-linha-forte px-1 text-[10px] text-t2',
                      'bg-[repeating-linear-gradient(-45deg,var(--elevado)_0_3px,var(--chao)_3px_6px)]',
                      !removido && 'opacity-55',
                    )}
                    style={{ left: pct(s.startUs), width: larg(s.startUs, s.endUs) }}
                  >
                    <VolumeX className="mr-0.5 size-2.5 shrink-0" aria-hidden />
                    <span className={cn('num truncate', removido && 'line-through')}>
                      -{formatarSegundosCurto(s.endUs - s.startUs)} s
                    </span>
                  </span>
                )
              })}
            </div>

            {/* +3 Faixas Extras */}
            {faixasExtrasAbertas && (
              <>
                {/* Faixa 3: Frases & Keyframes */}
                <div className="relative h-7 overflow-hidden rounded-mini bg-area">
                  {frasesVisiveis.map((s) => (
                    <span
                      key={s.id}
                      className="absolute inset-y-0.5 flex items-center truncate rounded-[2px] bg-elevado px-1.5 text-[10px] text-t2"
                      style={{ left: pct(s.startUs), width: larg(s.startUs, s.endUs) }}
                    >
                      Frase {s.id}
                    </span>
                  ))}
                  {keyframesManuais.map(({ id, kf }) => (
                    <Dica
                      key={id}
                      texto={`Keyframe ${kf.cut ? 'corte seco' : 'interpolado'} em ${tc(kf.timeUs)}`}
                    >
                      <span
                        data-cut={kf.cut ? 'true' : 'false'}
                        className={cn(
                          'absolute top-1 z-10 flex size-5 -translate-x-1/2 items-center justify-center rounded-mini bg-elevado text-t1 shadow-[inset_0_0_0_1px_var(--linha-forte)]',
                          kf.cut && 'border border-dashed border-t1',
                        )}
                        style={{ left: pct(kf.timeUs) }}
                      >
                        {kf.cut ? (
                          <Scissors className="size-3" aria-hidden />
                        ) : (
                          <Diamond className="size-3" aria-hidden />
                        )}
                      </span>
                    </Dica>
                  ))}
                </div>

                {/* Faixa 4: Narração (condicional: apenas Vídeo transformado com montage) */}
                {mostrarNarracao && doc.montage && (
                  <div className="relative h-7 overflow-hidden rounded-mini bg-area">
                    {doc.montage.blocks.map((blk) => {
                      const blocoStart = Math.max(windowStartUs, blk.sourceStartUs)
                      const blocoEnd = Math.min(windowEndUs, blocoStart + blk.durationUs)
                      return (
                        <div
                          key={blk.blockId}
                          data-testid={`narracao-bloco-${blk.blockId}`}
                          onPointerDown={(e) => {
                            e.stopPropagation()
                            e.currentTarget.setPointerCapture?.(e.pointerId)
                            const alt = e.altKey || altPressionado
                            arrastoNarracaoRef.current = { blockId: blk.blockId, alt }
                          }}
                          onPointerMove={(e) => {
                            if (arrastoNarracaoRef.current?.blockId !== blk.blockId) return
                            const alt = e.altKey || arrastoNarracaoRef.current.alt || altPressionado
                            const u = usDoElementoX(pistaRef.current, e.clientX)
                            void store.definirInicioNarracao(blk.blockId, u, alt, true)
                          }}
                          onPointerUp={(e) => {
                            if (arrastoNarracaoRef.current?.blockId !== blk.blockId) return
                            const alt = e.altKey || arrastoNarracaoRef.current.alt || altPressionado
                            arrastoNarracaoRef.current = null
                            const u = usDoElementoX(pistaRef.current, e.clientX)
                            void store.definirInicioNarracao(blk.blockId, u, alt, false)
                          }}
                          style={{ left: pct(blocoStart), width: larg(blocoStart, blocoEnd) }}
                          className="absolute inset-y-0.5 flex cursor-grab items-center gap-1.5 overflow-hidden rounded-[2px] bg-elevado px-1.5 text-[10px] text-t1"
                        >
                          <span className="truncate">{blk.title}</span>
                          {blk.pushedUs > 0 && (
                            <span className="num shrink-0 rounded-mini bg-hover px-1 text-t2">
                              +{formatarSegundosCurto(blk.pushedUs)} s empurrado
                            </span>
                          )}
                          {blk.mode === 'manual' && (
                            <button
                              type="button"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation()
                                void store.definirInicioNarracao(blk.blockId, null, false, false)
                              }}
                              className="ml-auto shrink-0 cursor-pointer rounded-mini border-0 bg-hover px-1 text-[10px] text-t2 hover:text-t1"
                            >
                              Auto
                            </button>
                          )}
                        </div>
                      )
                    })}

                    {doc.montage.freezeTailUs > 0 && (
                      <div
                        className="absolute inset-y-0.5 flex items-center overflow-hidden rounded-[2px] border border-dashed border-linha-forte bg-chao/60 px-1.5"
                        style={{
                          left: pct(endUs),
                          width: larg(endUs, Math.min(windowEndUs, endUs + doc.montage.freezeTailUs)),
                        }}
                      >
                        <Status
                          tom={doc.montage.freezeTailUs > 5_000_000 ? 'aviso' : 'neutro'}
                          className="text-[10px]"
                        >
                          Cauda congelada {formatarSegundosCurto(doc.montage.freezeTailUs)} s
                        </Status>
                      </div>
                    )}
                  </div>
                )}

                {/* Faixa 5: Trilha & SFX */}
                <div className="relative h-7 overflow-hidden rounded-mini bg-area">
                  {doc?.audioMix.soundtrack && (
                    <div
                      className="absolute inset-y-1 flex items-center gap-1.5 overflow-hidden rounded-[2px] bg-elevado px-2 text-[10px] text-t2"
                      style={{
                        left: pct(startUs + doc.audioMix.soundtrack.startUs),
                        width: larg(
                          startUs + doc.audioMix.soundtrack.startUs,
                          Math.min(
                            endUs,
                            startUs + doc.audioMix.soundtrack.startUs + doc.audioMix.soundtrack.playDurationUs,
                          ),
                        ),
                      }}
                    >
                      <Music className="size-3 shrink-0 text-t3" aria-hidden />
                      <span className="truncate">
                        {doc.audioMix.soundtrack.name} ·{' '}
                        {Math.round(doc.audioMix.soundtrack.volume * 100)}% (ducking -12 dB)
                      </span>
                    </div>
                  )}

                  {doc?.audioMix.sfx.map((sfx) => (
                    <div
                      key={sfx.id}
                      data-testid={`sfx-pino-${sfx.id}`}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        e.currentTarget.setPointerCapture?.(e.pointerId)
                        const alt = e.altKey || altPressionado
                        arrastoSfxRef.current = { sfxId: sfx.id, alt }
                      }}
                      onPointerMove={(e) => {
                        if (arrastoSfxRef.current?.sfxId !== sfx.id) return
                        const alt = e.altKey || arrastoSfxRef.current.alt || altPressionado
                        const u = usDoElementoX(pistaRef.current, e.clientX)
                        void store.atualizarSfx({ id: sfx.id, time_us: u, free: alt, preview: true })
                      }}
                      onPointerUp={(e) => {
                        if (arrastoSfxRef.current?.sfxId !== sfx.id) return
                        const alt = e.altKey || arrastoSfxRef.current.alt || altPressionado
                        arrastoSfxRef.current = null
                        const u = usDoElementoX(pistaRef.current, e.clientX)
                        void store.atualizarSfx({ id: sfx.id, time_us: u, free: alt, preview: false })
                      }}
                      style={{ left: pct(sfx.sourceStartUs) }}
                      className="absolute top-0.5 z-10 flex h-6 -translate-x-1/2 cursor-grab items-center gap-1 rounded-mini bg-elevado px-1.5 text-[10px] text-t1 shadow-[inset_0_0_0_1px_var(--linha-forte)]"
                    >
                      <Sparkles className="size-2.5 shrink-0 text-t3" aria-hidden />
                      <span className="truncate">{sfx.name}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Agulha única (lido pelo leitor de tela como role="slider") */}
            <div
              role="slider"
              tabIndex={0}
              aria-label="Agulha"
              aria-valuemin={windowStartUs}
              aria-valuemax={windowEndUs}
              aria-valuenow={tempoAtualUs}
              aria-valuetext={`${tc(tempoAtualUs - windowStartUs)} na janela`}
              onKeyDown={tratarTeclaAgulha}
              onPointerDown={(e) => {
                e.stopPropagation()
                e.currentTarget.setPointerCapture?.(e.pointerId)
                arrastoAgulhaRef.current = true
                aoMudarTempoUs?.(usDoElementoX(pistaRef.current, e.clientX), true)
              }}
              onPointerMove={(e) => {
                if (!arrastoAgulhaRef.current) return
                aoMudarTempoUs?.(usDoElementoX(pistaRef.current, e.clientX), true)
              }}
              onPointerUp={(e) => {
                if (!arrastoAgulhaRef.current) return
                arrastoAgulhaRef.current = false
                aoMudarTempoUs?.(usDoElementoX(pistaRef.current, e.clientX), false)
              }}
              style={{ left: pct(tempoAtualUs) }}
              className="foco pointer-events-auto absolute -inset-y-0.5 z-20 w-0.5 -translate-x-px cursor-ew-resize rounded-[1px] bg-sinal before:absolute before:-inset-x-[11px] before:inset-y-0 before:content-['']"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
