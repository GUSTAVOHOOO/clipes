import { Abas, Botao, Select, Status, cn, useToast, type Aba, type OpcaoSelect, type TomStatus } from '@ds'
import { ArrowDown, ChevronDown, ChevronRight, Copy, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  consolePadrao,
  formatarHoraConsole,
  normalizarOrigemConsole,
  rotuloOrigemConsole,
  useConsole,
  type EventoConsole,
  type ModoConsole,
  type NivelConsole,
  type OrigemConsole,
  type OrigemFiltro,
  type StoreConsole,
} from '~/core/console'
import { copiarTexto } from '~/core/desktop'

const ABAS_BASE: readonly OrigemFiltro[] = ['todas', 'component', 'uv', 'ffmpeg', 'worker', 'ai']
const ORIGENS_EXTRAS: readonly OrigemConsole[] = ['yt-dlp', 'tts', 'job']
const INTERVALO_ANUNCIO_MS = 1500

export type ConsoleAoVivoProps = {
  titulo?: string
  recolhivel?: boolean
  aberto?: boolean
  aoMudarAberto?: (aberto: boolean) => void
  abertoInicial?: boolean
  redimensionavel?: boolean
  alturaInicial?: number
  origemInicial?: OrigemFiltro
  filtroJob?: string | null
  aoMudarFiltroJob?: (job: string | null) => void
  store?: StoreConsole
  className?: string
}

function tomPorNivel(nivel: NivelConsole): TomStatus {
  if (nivel === 'error') return 'perigo'
  if (nivel === 'warn') return 'aviso'
  return 'info'
}

function rotuloNivel(nivel: NivelConsole): string {
  if (nivel === 'error') return 'Erro'
  if (nivel === 'warn') return 'Aviso'
  return 'Informação'
}

function pareceMarcoConclusao(texto: string): boolean {
  return /^(pronto|conclu[ií]do|instalado|cancelado|modelo pronto|worker pronto|ffmpeg respondeu)/i.test(
    texto.trim(),
  )
}

function rotuloJobSeguro(job: string): string {
  const limpo = job.replace(/#\d+/g, '').trim()
  if (!limpo) return 'Tarefa'
  if (/^\d+$/.test(limpo)) return `Tarefa ${limpo}`
  return limpo
}

export function ConsoleAoVivo({
  titulo = 'Console ao vivo',
  recolhivel = false,
  aberto,
  aoMudarAberto,
  abertoInicial,
  redimensionavel = false,
  alturaInicial = 208,
  origemInicial = 'todas',
  filtroJob,
  aoMudarFiltroJob,
  store = consolePadrao,
  className,
}: ConsoleAoVivoProps) {
  const toast = useToast()
  const { linhas, limpar, exportarTexto } = useConsole(store)
  const corpoId = useId()

  const [abertoLocal, setAbertoLocal] = useState(abertoInicial ?? !recolhivel)
  const estaAberto = aberto !== undefined ? aberto : abertoLocal
  const definirAberto = useCallback(
    (proximo: boolean) => {
      if (aberto === undefined) setAbertoLocal(proximo)
      aoMudarAberto?.(proximo)
    },
    [aberto, aoMudarAberto],
  )

  const [altura, setAltura] = useState(alturaInicial)
  const [modo, setModo] = useState<ModoConsole>('simples')
  const [origem, setOrigem] = useState<OrigemFiltro>(origemInicial)
  const [jobLocal, setJobLocal] = useState<string | null>(filtroJob ?? null)
  const jobAtivo = filtroJob !== undefined ? filtroJob : jobLocal
  const definirJob = useCallback(
    (proximo: string | null) => {
      if (filtroJob === undefined) setJobLocal(proximo)
      aoMudarFiltroJob?.(proximo)
    },
    [filtroJob, aoMudarFiltroJob],
  )

  const [autoRolagem, setAutoRolagem] = useState(true)
  const [avisoCopia, setAvisoCopia] = useState('')
  const [anuncioStatus, setAnuncioStatus] = useState('')

  const logRef = useRef<HTMLDivElement>(null)
  const timerCopiaRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ultimoSeqAnunciadoRef = useRef(0)
  const ultimoAnuncioMsRef = useRef(0)
  const jobsVistosRef = useRef(new Set<string>())

  useEffect(() => {
    return () => {
      if (timerCopiaRef.current !== null) clearTimeout(timerCopiaRef.current)
    }
  }, [])

  const contagemPorOrigem = useMemo(() => {
    const mapa = new Map<OrigemConsole, number>()
    for (const l of linhas) {
      const norm = normalizarOrigemConsole(l.origin)
      mapa.set(norm, (mapa.get(norm) ?? 0) + 1)
    }
    return mapa
  }, [linhas])

  const jobsDistintos = useMemo(() => {
    const vistos = new Set<string>()
    for (const l of linhas) {
      if (l.job) vistos.add(l.job)
    }
    return Array.from(vistos)
  }, [linhas])

  const abas: Aba<OrigemFiltro>[] = useMemo(() => {
    const lista: OrigemFiltro[] = [...ABAS_BASE]
    for (const extra of ORIGENS_EXTRAS) {
      if ((contagemPorOrigem.get(extra) ?? 0) > 0 || origem === extra) {
        lista.push(extra)
      }
    }
    return lista.map((o) => {
      const qtd = o === 'todas' ? 0 : (contagemPorOrigem.get(o) ?? 0)
      return {
        valor: o,
        rotulo: (
          <span className="inline-flex items-center gap-1">
            <span>{o === 'todas' ? 'Tudo' : rotuloOrigemConsole(o)}</span>
            {qtd > 0 && <span className="num text-micro text-t3">{qtd}</span>}
          </span>
        ),
      }
    })
  }, [contagemPorOrigem, origem])

  const opcoesJob: OpcaoSelect<string>[] = useMemo(
    () => [
      { valor: '__todos__', rotulo: 'Todas as tarefas' },
      ...jobsDistintos.map((j) => ({ valor: j, rotulo: rotuloJobSeguro(j) })),
    ],
    [jobsDistintos],
  )

  const linhasVisiveis = useMemo(() => {
    return linhas.filter((l) => {
      if (origem !== 'todas' && normalizarOrigemConsole(l.origin) !== origem) return false
      if (jobAtivo && l.job !== jobAtivo) return false
      return true
    })
  }, [linhas, origem, jobAtivo])

  useEffect(() => {
    if (!estaAberto || !autoRolagem || !logRef.current) return
    logRef.current.scrollTop = logRef.current.scrollHeight
  }, [linhasVisiveis, estaAberto, autoRolagem])

  useEffect(() => {
    if (linhas.length === 0) return
    const ultima: EventoConsole = linhas[linhas.length - 1]
    if (ultima.seq > 0 && ultima.seq <= ultimoSeqAnunciadoRef.current) return
    if (ultima.seq > 0) ultimoSeqAnunciadoRef.current = ultima.seq

    const agora = Date.now()
    const primeiroDoJob = !jobsVistosRef.current.has(ultima.job)
    if (primeiroDoJob) jobsVistosRef.current.add(ultima.job)

    const ehErro = ultima.level === 'error'
    const ehAviso = ultima.level === 'warn'
    const ehConclusao = pareceMarcoConclusao(ultima.simple)
    const dentroJanela = agora - ultimoAnuncioMsRef.current < INTERVALO_ANUNCIO_MS

    if (ehErro || primeiroDoJob || ((ehAviso || ehConclusao) && !dentroJanela)) {
      ultimoAnuncioMsRef.current = agora
      setAnuncioStatus(ultima.simple)
    }
  }, [linhas])

  const aoRolar = () => {
    const el = logRef.current
    if (!el) return
    const noFim = el.scrollTop + el.clientHeight >= el.scrollHeight - 16
    if (!noFim && autoRolagem) setAutoRolagem(false)
    if (noFim && !autoRolagem) setAutoRolagem(true)
  }

  const retomarRolagem = () => {
    setAutoRolagem(true)
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }

  const handleCopiar = async () => {
    const txt = exportarTexto({
      filtroOrigem: origem,
      filtroJob: jobAtivo,
      modo,
    })
    const ok = await copiarTexto(txt)
    const msg = ok ? 'Console copiado.' : 'Não foi possível copiar.'
    setAvisoCopia(msg)
    setAnuncioStatus(msg)
    if (ok) {
      toast?.add?.({ title: msg })
    }
    if (timerCopiaRef.current !== null) clearTimeout(timerCopiaRef.current)
    timerCopiaRef.current = setTimeout(() => setAvisoCopia(''), 2000)
  }

  const handleLimpar = () => {
    limpar()
    jobsVistosRef.current.clear()
    setAnuncioStatus('Console limpo.')
  }

  const ultimaLinha = linhas[linhas.length - 1]

  return (
    <section
      aria-label={titulo}
      data-console-ao-vivo=""
      className={cn('flex flex-col border-t border-linha bg-area text-t1', className)}
    >
      {recolhivel && (
        <div className="flex min-h-8 items-center gap-2 px-3 py-1">
          <Botao
            variante="fantasma"
            tamanho="p"
            aria-expanded={estaAberto}
            aria-controls={corpoId}
            icone={estaAberto ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            onClick={() => definirAberto(!estaAberto)}
          >
            {titulo}
          </Botao>
          {!estaAberto && (
            <span className="min-w-0 flex-1 truncate text-pequeno text-t2">
              {ultimaLinha ? ultimaLinha.simple : 'Nada rodando agora.'}
            </span>
          )}
        </div>
      )}

      {estaAberto && (
        <div
          id={corpoId}
          className={cn(
            'flex flex-col bg-chao',
            recolhivel && 'border-t border-linha',
          )}
          style={{ height: altura }}
        >
          {redimensionavel && (
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Redimensionar console"
              className="h-1 shrink-0 cursor-row-resize bg-linha transition-colors hover:bg-t3"
              onPointerDown={(e) => {
                const y0 = e.clientY
                const h0 = altura
                const mover = (ev: PointerEvent) => {
                  setAltura(Math.min(420, Math.max(112, h0 + (y0 - ev.clientY))))
                }
                const soltar = () => {
                  window.removeEventListener('pointermove', mover)
                  window.removeEventListener('pointerup', soltar)
                }
                window.addEventListener('pointermove', mover)
                window.addEventListener('pointerup', soltar)
              }}
            />
          )}

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-linha bg-area px-2 py-1">
            <Abas
              valor={origem}
              aoMudar={setOrigem}
              abas={abas}
              rotulo="Origem"
              tamanho="p"
            />
          </div>

          <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-2 border-b border-linha bg-area px-3 py-1">
            <div role="group" aria-label="Nível de detalhe" className="flex items-center gap-1">
              <Botao
                variante={modo === 'simples' ? 'secundario' : 'fantasma'}
                tamanho="p"
                aria-pressed={modo === 'simples'}
                onClick={() => setModo('simples')}
              >
                Simples
              </Botao>
              <Botao
                variante={modo === 'tecnico' ? 'secundario' : 'fantasma'}
                tamanho="p"
                aria-pressed={modo === 'tecnico'}
                onClick={() => setModo('tecnico')}
              >
                Técnico
              </Botao>
            </div>

            {(jobsDistintos.length > 1 || jobAtivo !== null) && (
              <Select
                valor={jobAtivo ?? '__todos__'}
                aoMudar={(v) => definirJob(v === '__todos__' ? null : v)}
                opcoes={opcoesJob}
                rotulo="Filtrar por tarefa"
                className="h-6 min-w-32"
              />
            )}

            <div className="ml-auto flex items-center gap-1.5">
              {avisoCopia && <span className="text-pequeno text-t2">{avisoCopia}</span>}
              {!autoRolagem && (
                <Botao
                  variante="suave"
                  tamanho="p"
                  icone={<ArrowDown aria-hidden />}
                  onClick={retomarRolagem}
                >
                  Retomar rolagem
                </Botao>
              )}
              <Botao
                variante="fantasma"
                tamanho="p"
                icone={<Copy aria-hidden />}
                disabled={linhasVisiveis.length === 0}
                onClick={handleCopiar}
              >
                Copiar
              </Botao>
              <Botao
                variante="fantasma"
                tamanho="p"
                icone={<Trash2 aria-hidden />}
                disabled={linhas.length === 0}
                onClick={handleLimpar}
              >
                Limpar
              </Botao>
            </div>
          </div>

          <div
            ref={logRef}
            onScroll={aoRolar}
            role="log"
            aria-label="Registro de atividade ao vivo"
            aria-live="off"
            tabIndex={0}
            className={cn(
              'foco-interno min-h-0 flex-1 overflow-y-auto px-3 py-1.5 text-pequeno',
              modo === 'tecnico' && 'font-mono',
            )}
          >
            {linhasVisiveis.length === 0 ? (
              <p className="m-0 py-3 text-t3">
                Nada rodando agora. Quando algo começar, você acompanha por aqui.
              </p>
            ) : (
              linhasVisiveis.map((l) => {
                const texto = modo === 'simples' ? l.simple : (l.technical ?? l.simple)
                return (
                  <div
                    key={l.seq > 0 ? l.seq : `${l.timestampMs}-${l.job}-${l.simple}`}
                    className="flex items-baseline gap-2 py-px leading-5"
                  >
                    <span className="num shrink-0 text-t3">{formatarHoraConsole(l.timestampMs)}</span>
                    <Status tom={tomPorNivel(l.level)} className="shrink-0">
                      <span className="sr-only">{rotuloNivel(l.level)}</span>
                    </Status>
                    {modo === 'tecnico' && (
                      <span className="w-24 shrink-0 truncate text-t3">
                        {rotuloOrigemConsole(l.origin)}
                      </span>
                    )}
                    <span
                      className={cn(
                        'min-w-0 break-words',
                        l.level === 'error'
                          ? 'text-erro'
                          : l.level === 'warn'
                            ? 'text-t1'
                            : 'text-t2',
                      )}
                    >
                      {texto}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {anuncioStatus}
      </div>
    </section>
  )
}
