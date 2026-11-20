// Mídia: <PlayerProxy> (quadro 9:16 com legenda), <Transporte>, <TimelineEditor> compacta
// e <BarraAcoes> (5 ações que abrem popovers ao lado do vídeo; Ctrl+] reabre o último).
import { Popover as P } from '@base-ui/react/popover'
import { FileQuestion, Film, Pause, Play, Plus, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { cn } from '@/lib/cn'
import { tc } from '@/lib/formato'
import { Botao, BotaoIcone } from '@/primitivas/Botao'
import { camadaBase, primeiroFocavel } from '@/primitivas/Flutuantes'

/* ---------- PlayerProxy ---------- */

export type Legenda = { antes?: string; ativa: string; depois?: string; estilo?: 'karaoke' | 'cinema' | 'simples' }

export interface PlayerProxyProps {
  sourceId: number
  fonteDisponivel: boolean
  startUs: number
  endUs: number
  /** URL do proxy ou do quadro (no app: mediaUrl("proxy/…")) */
  poster?: string
  /**
   * Vídeo do proxy (mediaUrl("proxy/…")). Com ele o quadro toca de verdade: `tempoAtualUs` é relativo a
   * `startUs` e `janelaInicioUs` é o início da janela do proxy na Fonte. Sem ele, `poster` é uma imagem.
   */
  videoSrc?: string
  janelaInicioUs?: number
  modo: 'previa_9_16' | 'fonte_16_9' | 'capa'
  enquadramento?: 'preencher' | 'ajustar' | 'duplo'
  legenda?: Legenda | null
  tempoAtualUs: number
  reproduzindo: boolean
  mostrarTransporte?: boolean
  aoMudarTempoUs: (us: number) => void
  aoMudarReproduzindo: (tocando: boolean) => void
  aoPedirRelocalizacao?: () => void
  /** ref do quadro, para ancorar popovers ao lado do vídeo */
  refQuadro?: RefObject<HTMLDivElement | null>
  className?: string
}

/** O vídeo é o conteúdo: quadro preto, cantos de 6 px, legenda com a cor do vídeo (não do app). */
export function PlayerProxy({ fonteDisponivel, poster, videoSrc, janelaInicioUs = 0, startUs, endUs, tempoAtualUs, reproduzindo, aoMudarTempoUs, aoMudarReproduzindo, modo, enquadramento = 'preencher', legenda, refQuadro, aoPedirRelocalizacao, className }: PlayerProxyProps) {
  const proporcao = modo === 'fonte_16_9' ? 'aspect-video' : 'aspect-[9/16]'
  const [imagemFalhou, setImagemFalhou] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const fonteDaMidia = videoSrc ?? poster

  useEffect(() => {
    setImagemFalhou(false)
  }, [fonteDaMidia])

  // Posição no vídeo do proxy (segundos) para um instante relativo ao início do Corte.
  const paraSegundos = (relativoUs: number) => Math.max(0, (startUs + relativoUs - janelaInicioUs) / 1_000_000)

  // Segue o instante pedido (scrubber, J/L, trocas de Corte) sem brigar com a reprodução em curso.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !videoSrc) return
    const alvo = paraSegundos(tempoAtualUs)
    if (Math.abs(v.currentTime - alvo) > 0.35) {
      try {
        v.currentTime = alvo
      } catch {
        // jsdom não implementa a atribuição em todos os estados
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tempoAtualUs, videoSrc, janelaInicioUs, startUs])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !videoSrc) return
    if (reproduzindo) {
      const p = v.play?.()
      if (p && typeof p.catch === 'function') p.catch(() => aoMudarReproduzindo(false))
    } else {
      v.pause?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reproduzindo, videoSrc])

  const aoAtualizarTempo = () => {
    const v = videoRef.current
    if (!v) return
    const relativo = Math.round(v.currentTime * 1_000_000 + janelaInicioUs - startUs)
    if (relativo >= endUs - startUs) {
      v.pause()
      aoMudarReproduzindo(false)
      aoMudarTempoUs(endUs - startUs)
      return
    }
    aoMudarTempoUs(Math.max(0, relativo))
  }

  return (
    <div ref={refQuadro} className={cn('relative overflow-hidden rounded-area bg-preto shadow-[0_0_0_1px_var(--contorno-controle)]', proporcao, className)}>
      {fonteDisponivel && fonteDaMidia ? (
        imagemFalhou ? (
          <div role="img" aria-label="Quadro do Corte" className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <Film className="size-6 stroke-[1.5] text-t3" aria-hidden />
            <span className="text-pequeno text-t3">Prévia indisponível</span>
          </div>
        ) : videoSrc ? (
          <video
            ref={videoRef}
            src={videoSrc}
            aria-label="Quadro do Corte"
            playsInline
            preload="auto"
            onLoadedMetadata={() => {
              const v = videoRef.current
              if (v) v.currentTime = paraSegundos(tempoAtualUs)
            }}
            onTimeUpdate={aoAtualizarTempo}
            onEnded={() => aoMudarReproduzindo(false)}
            onError={() => setImagemFalhou(true)}
            className={cn('block h-full w-full bg-preto', enquadramento === 'ajustar' ? 'object-contain' : 'object-cover')}
          />
        ) : (
          <img
            src={poster}
            alt="Quadro do Corte"
            onError={() => setImagemFalhou(true)}
            className={cn('block h-full w-full', enquadramento === 'ajustar' ? 'object-contain' : 'object-cover')}
          />
        )
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
          <FileQuestion className="size-5 stroke-[1.5] text-t3" aria-hidden />
          <p className="text-pequeno text-t2">A Fonte não está no lugar de antes.</p>
          {aoPedirRelocalizacao && (
            <Botao tamanho="p" variante="secundario" onClick={aoPedirRelocalizacao}>
              Localizar arquivo
            </Botao>
          )}
        </div>
      )}
      {enquadramento === 'duplo' && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[34%] h-px bg-branco/30" />}
      {legenda && fonteDisponivel && (
        <p
          className={cn(
            'absolute inset-x-[8%] bottom-[14%] text-center text-[clamp(14px,2.2vh,22px)] leading-[1.15] font-bold text-branco [text-shadow:0_2px_8px_rgb(0_0_0/.6)]',
            legenda.estilo === 'cinema' && 'bottom-[10%] font-medio tracking-[0.01em] [text-shadow:0_2px_12px_rgb(0_0_0/.85)]',
            legenda.estilo === 'simples' && 'inset-x-[12%] bottom-[10%] rounded-controle bg-preto/55 px-2 py-1 font-forte',
          )}
        >
          {legenda.antes} <b className="text-[#ffd23f]">{legenda.ativa}</b> {legenda.depois}
        </p>
      )}
    </div>
  )
}

/* ---------- Toolbar com roving tabindex ---------- */

function rovingSetas(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
  const bts = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
  const i = bts.indexOf(document.activeElement as HTMLButtonElement)
  if (i < 0) return
  e.preventDefault()
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? bts.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + bts.length) % bts.length
  bts.forEach((b, j) => (b.tabIndex = j === n ? 0 : -1))
  bts[n].focus()
}

/* ---------- Transporte ---------- */

type TransporteProps = {
  tempoUs: number
  duracaoUs: number
  reproduzindo: boolean
  mudo?: boolean
  compacto?: boolean
  desabilitado?: boolean
  atalhoReproduzir?: string | null
  atalhoEntrada?: string | null
  atalhoSaida?: string | null
  aoAlternar: () => void
  aoInicio?: () => void
  aoFim?: () => void
  aoMarcarEntrada?: () => void
  aoMarcarSaida?: () => void
  aoAlternarMudo?: () => void
  className?: string
}

export function Transporte({
  tempoUs,
  duracaoUs,
  reproduzindo,
  mudo,
  compacto = false,
  desabilitado = false,
  atalhoReproduzir,
  atalhoEntrada,
  atalhoSaida,
  aoAlternar,
  aoInicio,
  aoFim,
  aoMarcarEntrada,
  aoMarcarSaida,
  aoAlternarMudo,
  className,
}: TransporteProps) {
  const tam = compacto ? 'p' : 'm'
  const kbdReproduzir = atalhoReproduzir === undefined ? 'Espaço' : atalhoReproduzir || undefined
  const kbdEntrada = atalhoEntrada === undefined ? 'I' : atalhoEntrada || undefined
  const kbdSaida = atalhoSaida === undefined ? 'O' : atalhoSaida || undefined

  return (
    <div
      role="toolbar"
      aria-label="Controles de reprodução"
      aria-disabled={desabilitado || undefined}
      onKeyDown={rovingSetas}
      className={cn(
        'flex h-(--altura-barra) items-center rounded-area bg-area',
        compacto ? 'gap-0.5 px-1.5' : 'gap-1 px-2',
        className,
      )}
    >
      <BotaoIcone tamanho={tam} rotulo="Ir para Entrada" disabled={desabilitado} onClick={aoInicio}>
        <SkipBack />
      </BotaoIcone>
      <BotaoIcone tamanho={tam} rotulo={reproduzindo ? 'Pausar' : 'Reproduzir'} atalho={kbdReproduzir} disabled={desabilitado} onClick={aoAlternar} tabIndex={-1}>
        {reproduzindo ? <Pause /> : <Play />}
      </BotaoIcone>
      <BotaoIcone tamanho={tam} rotulo="Ir para Saída" disabled={desabilitado} onClick={aoFim} tabIndex={-1}>
        <SkipForward />
      </BotaoIcone>
      <span
        className={cn('num shrink-0 whitespace-nowrap text-pequeno text-t2', compacto ? 'px-1' : 'px-2', desabilitado && 'opacity-40')}
        aria-label={`Posição ${tc(tempoUs)} de ${tc(duracaoUs)}`}
      >
        {tc(tempoUs)} <span className="text-t3">/ {tc(duracaoUs)}</span>
      </span>
      <span aria-hidden className="mx-0.5 h-3.5 w-px shrink-0 bg-linha" />
      {aoMarcarEntrada && (
        <BotaoIcone tamanho={tam} rotulo="Definir Entrada" atalho={kbdEntrada} disabled={desabilitado} onClick={aoMarcarEntrada} tabIndex={-1}>
          <span className="num text-base">I</span>
        </BotaoIcone>
      )}
      {aoMarcarSaida && (
        <BotaoIcone tamanho={tam} rotulo="Definir Saída" atalho={kbdSaida} disabled={desabilitado} onClick={aoMarcarSaida} tabIndex={-1}>
          <span className="num text-base">O</span>
        </BotaoIcone>
      )}
      <BotaoIcone tamanho={tam} rotulo={mudo ? 'Ligar áudio' : 'Silenciar'} disabled={desabilitado} onClick={aoAlternarMudo} tabIndex={-1} aria-pressed={!!mudo}>
        {mudo ? <VolumeX /> : <Volume2 />}
      </BotaoIcone>
    </div>
  )
}

/* ---------- BarraAcoes (padrão do editor) ---------- */

export type AcaoBarra = { id: string; rotulo: string; icone: ReactNode; titulo?: string; conteudo: ReactNode }

type BarraAcoesProps = {
  acoes: AcaoBarra[]
  aberta: string | null
  aoMudarAberta: (id: string | null) => void
  /** elemento ao lado do qual o popover abre (o quadro 9:16) */
  ancora?: RefObject<HTMLElement | null>
  /** limite de colisão para conter o popover entre cabeçalho e barra inferior */
  limiteColisao?: HTMLElement | null | RefObject<HTMLElement | null>
  rotulo?: string
  className?: string
}

/** 5 ações sob o vídeo. Uma de cada vez abre um popover flutuante ao lado do quadro; Ctrl+] reabre a última. */
export function BarraAcoes({ acoes, aberta, aoMudarAberta, ancora, limiteColisao, rotulo = 'Ferramentas do Corte', className }: BarraAcoesProps) {
  const ultima = useRef<string | null>(aberta ?? acoes[0]?.id ?? null)
  const refsGatilho = useRef<Record<string, HTMLButtonElement | null>>({})
  const refsConteudo = useRef<Record<string, HTMLDivElement | null>>({})
  useEffect(() => {
    if (aberta) ultima.current = aberta
  }, [aberta])
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.shiftKey) return
      if ((e.ctrlKey || e.metaKey) && e.key === ']') {
        e.preventDefault()
        aoMudarAberta(aberta ? null : ultima.current)
      }
    }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  }, [aberta, aoMudarAberta])

  const boundary =
    limiteColisao && 'current' in limiteColisao
      ? (limiteColisao.current ?? undefined)
      : (limiteColisao ?? undefined)

  return (
    <div role="toolbar" aria-label={rotulo} onKeyDown={rovingSetas} className={cn('flex h-(--altura-barra) items-center gap-0.5 rounded-area bg-area px-1.5', className)}>
      {acoes.map((a, i) => (
        <P.Root
          key={a.id}
          open={aberta === a.id}
          onOpenChange={(v, details) => {
            aoMudarAberta(v ? a.id : aberta === a.id ? null : aberta)
            if (!v && (details?.reason === 'escape-key' || details?.reason === 'close-press')) {
              const g = refsGatilho.current[a.id]
              if (g) queueMicrotask(() => g.focus())
            }
          }}
          modal={false}
        >
          <P.Trigger
            tabIndex={i === 0 ? 0 : -1}
            render={
              <Botao
                ref={(el) => {
                  refsGatilho.current[a.id] = el
                }}
                className={cn(aberta === a.id && 'marcado bg-hover text-t1')}
                icone={a.icone}
              >
                {a.rotulo}
              </Botao>
            }
          />
          <P.Portal>
            <P.Positioner
              anchor={ancora}
              side="right"
              align="center"
              sideOffset={16}
              collisionBoundary={boundary}
              collisionPadding={12}
              style={{ zIndex: 'var(--z-popover)' }}
            >
              <P.Popup
                data-nao-modal=""
                initialFocus={() => primeiroFocavel(refsConteudo.current[a.id] ?? null) ?? true}
                finalFocus={() => refsGatilho.current[a.id] ?? true}
                className={cn(
                  camadaBase,
                  'flex max-h-[min(520px,var(--available-height))] w-[308px] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0',
                )}
              >
                <div className="flex shrink-0 items-center justify-between px-3 pt-3 pb-2">
                  <P.Title className="text-base font-forte">{a.titulo ?? a.rotulo}</P.Title>
                  <P.Close render={<Botao tamanho="p" className="w-6 px-0" aria-label="Fechar (Esc)" />}>
                    <X />
                  </P.Close>
                </div>
                <div
                  ref={(el) => {
                    refsConteudo.current[a.id] = el
                  }}
                  className="min-h-0 flex-1 overflow-y-auto px-3 pt-0.5 pb-3"
                >
                  {a.conteudo}
                </div>
              </P.Popup>
            </P.Positioner>
          </P.Portal>
        </P.Root>
      ))}
    </div>
  )
}

/** Grupo rotulado dentro de um popover de ajuste. */
export function GrupoAjuste({ rotulo, valor, children }: { rotulo: string; valor?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-col gap-2 last:mb-0">
      <div className="flex items-center justify-between text-pequeno text-t3">
        <span>{rotulo}</span>
        {valor != null && <span className="num text-t2">{valor}</span>}
      </div>
      {children}
    </div>
  )
}

/* ---------- TimelineEditor ---------- */

export type Intervalo = { inicioUs: number; fimUs: number }

export interface TimelineEditorProps {
  windowStartUs: number
  windowEndUs: number
  startUs: number
  endUs: number
  tempoAtualUs: number
  thumbs: string[]
  waveValues: number[]
  silences?: (Intervalo & { removido: boolean })[]
  sentences?: (Intervalo & { texto: string })[]
  narracao?: (Intervalo & { rotulo: string })[]
  trilha?: { rotulo: string; sfxUs?: number[] } | null
  /** faixas extras visíveis (Frases, Narração, Trilha/SFX); padrão recolhido */
  faixasExtrasAbertas?: boolean
  aoAlternarFaixasExtras?: () => void
  aoMoverAgulha: (us: number, preview: boolean) => void
  className?: string
}

const ROTULO = 72

function Faixa({ nome, children, className }: { nome: string; children: ReactNode; className?: string }) {
  return (
    <div className="grid h-[26px] items-center" style={{ gridTemplateColumns: `${ROTULO}px 1fr` }}>
      <span className="text-pequeno text-t3">{nome}</span>
      <div className={cn('relative h-5 overflow-hidden rounded-mini bg-area', className)}>{children}</div>
    </div>
  )
}

export function TimelineEditor(p: TimelineEditorProps) {
  const total = p.windowEndUs - p.windowStartUs
  const pct = (us: number) => `${((us - p.windowStartUs) / total) * 100}%`
  const larg = (a: number, b: number) => `${((b - a) / total) * 100}%`
  const pistaRef = useRef<HTMLDivElement>(null)
  const [arrastando, setArrastando] = useState(false)
  const extras = [p.sentences && 'Frases', p.narracao && 'Narração', p.trilha && 'Trilha'].filter(Boolean).length
  // marcas em passos redondos (00:10, 00:20…) e a última no fim da janela
  const passo = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].map((s) => s * 1e6).find((s) => total / s <= 5) ?? 600e6
  const marcas: number[] = []
  for (let m = 0; m < total - passo * 0.35; m += passo) marcas.push(m)
  marcas.push(total)

  const usDoPonteiro = (x: number) => {
    const r = pistaRef.current!.getBoundingClientRect()
    return p.windowStartUs + Math.min(1, Math.max(0, (x - r.left) / r.width)) * total
  }
  const teclas = (e: KeyboardEvent) => {
    const passo = e.shiftKey ? 1_000_000 : 100_000
    const m: Record<string, number> = { ArrowRight: p.tempoAtualUs + passo, ArrowLeft: p.tempoAtualUs - passo, Home: p.startUs, End: p.endUs }
    if (e.key in m) {
      e.preventDefault()
      p.aoMoverAgulha(Math.min(p.windowEndUs, Math.max(p.windowStartUs, m[e.key])), false)
    }
  }

  return (
    <section aria-label="Timeline do Corte" className={cn('shrink-0 border-t border-linha px-4 pt-1.5 pb-2', p.className)}>
      <div className="mb-1 flex h-[26px] items-center gap-2.5">
        {extras > 0 && (
          <Botao tamanho="p" icone={p.faixasExtrasAbertas ? <X /> : <Plus />} aria-expanded={!!p.faixasExtrasAbertas} onClick={p.aoAlternarFaixasExtras}>
            {p.faixasExtrasAbertas ? 'Recolher faixas' : `+${extras} faixas`}
          </Botao>
        )}
        <span className="num ml-auto text-pequeno text-t3">
          Entrada {tc(p.startUs - p.windowStartUs)} · Saída {tc(p.endUs - p.windowStartUs)}
        </span>
      </div>
      <div className="relative">
        <div className="mb-1" style={{ paddingLeft: ROTULO }} aria-hidden>
          <div className="num relative h-[15px] text-micro text-t3">
            {marcas.map((m, i) => (
              <span key={m} className="absolute top-0" style={{ left: `${(m / total) * 100}%`, translate: i === 0 ? '0' : i === marcas.length - 1 ? '-100%' : '-50%' }}>
                {tc(m).slice(0, 5)}
              </span>
            ))}
          </div>
        </div>
        <div className="relative">
          <Faixa nome="Vídeo" className="grid gap-px bg-chao">
            <div className="absolute inset-0 grid gap-px" style={{ gridTemplateColumns: `repeat(${p.thumbs.length}, 1fr)` }}>
              {p.thumbs.map((t, i) => (
                <img key={i} src={t} alt="" className="block h-full w-full object-cover opacity-70" />
              ))}
            </div>
            <div className="pointer-events-none absolute inset-y-0 shadow-[inset_2px_0_0_var(--t2),inset_-2px_0_0_var(--t2)]" style={{ left: pct(p.startUs), width: larg(p.startUs, p.endUs) }} />
          </Faixa>
          <Faixa nome="Áudio" className="flex items-center gap-0.5 px-1">
            {p.waveValues.map((v, i) => (
              <span key={i} className="flex-1 rounded-[1px] bg-t3 opacity-55" style={{ height: `${Math.max(8, v * 100)}%` }} />
            ))}
            {p.silences?.map((s) => (
              <span key={s.inicioUs} title={s.removido ? 'Silêncio removido' : 'Silêncio mantido'}
                className={cn('absolute inset-y-px rounded-[2px] border border-dashed border-linha bg-[repeating-linear-gradient(-45deg,var(--elevado)_0_3px,var(--chao)_3px_6px)]', !s.removido && 'opacity-60')}
                style={{ left: pct(s.inicioUs), width: larg(s.inicioUs, s.fimUs) }}
              />
            ))}
          </Faixa>
          {p.faixasExtrasAbertas && p.sentences && (
            <Faixa nome="Frases">
              {p.sentences.map((s) => (
                <span key={s.inicioUs} className="absolute inset-y-0.5 flex items-center truncate rounded-[2px] bg-elevado px-1.5 text-[10px] text-t3" style={{ left: pct(s.inicioUs), width: larg(s.inicioUs, s.fimUs) }}>
                  {s.texto}
                </span>
              ))}
            </Faixa>
          )}
          {p.faixasExtrasAbertas && p.narracao && (
            <Faixa nome="Narração">
              {p.narracao.map((n) => (
                <span key={n.inicioUs} className="absolute inset-y-0.5 flex items-center truncate rounded-[2px] bg-hover px-1.5 text-[10px] text-t2" style={{ left: pct(n.inicioUs), width: larg(n.inicioUs, n.fimUs) }}>
                  {n.rotulo}
                </span>
              ))}
            </Faixa>
          )}
          {p.faixasExtrasAbertas && p.trilha && (
            <Faixa nome="Trilha/SFX">
              <span className="absolute inset-x-1 inset-y-[3px] flex items-center rounded-[2px] bg-elevado px-1.5 text-[10px] text-t3">{p.trilha.rotulo}</span>
              {p.trilha.sfxUs?.map((s) => (
                <span key={s} className="absolute inset-y-0.5 w-1 rounded-[2px] bg-t2" style={{ left: pct(s) }} />
              ))}
            </Faixa>
          )}
          {/* área de arraste + agulha (slider acessível) */}
          <div ref={pistaRef} className="absolute inset-y-0 right-0 cursor-pointer" style={{ left: ROTULO }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              setArrastando(true)
              p.aoMoverAgulha(usDoPonteiro(e.clientX), true)
            }}
            onPointerMove={(e) => arrastando && p.aoMoverAgulha(usDoPonteiro(e.clientX), true)}
            onPointerUp={(e) => {
              setArrastando(false)
              p.aoMoverAgulha(usDoPonteiro(e.clientX), false)
            }}
          >
            <div role="slider" tabIndex={0} aria-label="Agulha" aria-valuemin={0} aria-valuemax={total} aria-valuenow={p.tempoAtualUs - p.windowStartUs}
              aria-valuetext={`${tc(p.tempoAtualUs - p.windowStartUs)} do Corte`} onKeyDown={teclas}
              className="absolute -inset-y-0.5 w-0.5 -translate-x-px rounded-[1px] bg-sinal outline-offset-4 before:absolute before:-inset-x-[11px] before:inset-y-0 before:content-['']"
              style={{ left: pct(p.tempoAtualUs) }}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
