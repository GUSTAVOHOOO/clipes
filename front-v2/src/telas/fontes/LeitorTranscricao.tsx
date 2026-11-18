import {
  Botao,
  Busca,
  Dica,
  ListaVirtual,
  Select,
  cn,
  tcLongo,
  useToast,
  type OpcaoSelect,
} from '@ds'
import { Pencil, Redo2, Undo2, VolumeX, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { formatarTecla, useAtalhos, type Atalho } from '~/comandos/atalhos'
import { chamar, ErroCore } from '~/core/cliente'

export type PalavraTimeline = {
  position: number
  text: string
  corrected: boolean
  start_us: number
}

export type ItemTimeline =
  | {
      type: 'sentence'
      id: number
      start_us: number
      end_us: number
      language: string
      text: string
      first_position: number
      last_position: number
      words: PalavraTimeline[]
    }
  | {
      type: 'silence'
      start_us: number
      end_us: number
    }

type RespostaTimeline = {
  total: number
  offset: number
  items: ItemTimeline[]
}

type RespostaCorrections = {
  can_undo: boolean
  can_redo: boolean
}

type RespostaPassoCorrecao = {
  changed: boolean
  source_id: number
  transcript_id: number
  position: number
  sentence_id: number
  text: string
  corrected: boolean
  can_undo: boolean
  can_redo: boolean
}

type ResultadoBusca = {
  transcript_id: number
  source_id: number
  source: string
  sentence_id: number
  start_us: number
  end_us: number
  row: number
  snippet: Array<{ text: string; match: boolean }>
}

type EscopoBusca = 'fonte' | 'projeto'

const OPCOES_ESCOPO: OpcaoSelect<EscopoBusca>[] = [
  { valor: 'fonte', rotulo: 'Nesta Fonte' },
  { valor: 'projeto', rotulo: 'Todo o Projeto' },
]

const TAMANHO_PAGINA = 200

function normalizarErro(err: unknown): ErroCore {
  if (err instanceof ErroCore) return err
  if (err && typeof err === 'object' && 'code' in err) {
    const e = err as { code?: unknown; message?: unknown }
    return new ErroCore(
      typeof e.code === 'string' && e.code ? e.code : 'desconhecido',
      typeof e.message === 'string' ? e.message : '',
    )
  }
  return new ErroCore('desconhecido', err instanceof Error ? err.message : String(err ?? ''))
}

export type LeitorTranscricaoProps = {
  projetoId: string
  fonteId: number
  totalPalavras?: number
  tempoAtualUs?: number
  scrollPara?: { frase?: number; row?: number } | null
  aoFocarPalavraTempo?: (startUs: number) => void
  aoErro?: (erro: ErroCore) => void
}

/** Leitor virtualizado da Transcrição sobre `transcription.timeline` com F2/Enter, undo/redo e FTS5. */
export function LeitorTranscricao({
  projetoId,
  fonteId,
  totalPalavras,
  tempoAtualUs = 0,
  scrollPara,
  aoFocarPalavraTempo,
  aoErro,
}: LeitorTranscricaoProps) {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const encProjeto = encodeURIComponent(projetoId)

  const [totalLinhas, setTotalLinhas] = useState(0)
  const [itensMap, setItensMap] = useState<Map<number, ItemTimeline>>(() => new Map())
  const [carregandoInicial, setCarregandoInicial] = useState(true)
  const [rolarPara, setRolarPara] = useState<number | null>(scrollPara?.row ?? null)
  const [fraseDestacada, setFraseDestacada] = useState<number | null>(scrollPara?.frase ?? null)

  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [editandoPos, setEditandoPos] = useState<number | null>(null)
  const [textoEdicao, setTextoEdicao] = useState('')
  const [salvandoCorrecao, setSalvandoCorrecao] = useState(false)

  const [escopoBusca, setEscopoBusca] = useState<EscopoBusca>('fonte')
  const [termoBusca, setTermoBusca] = useState('')
  const [termoSubmetido, setTermoSubmetido] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [resultadosBusca, setResultadosBusca] = useState<ResultadoBusca[]>([])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const buscaInputRef = useRef<HTMLInputElement | null>(null)
  const inputEdicaoRef = useRef<HTMLInputElement | null>(null)
  const devolverFocoPosRef = useRef<number | null>(null)
  const paginasEmVooRef = useRef<Set<number>>(new Set())
  const aoErroRef = useRef(aoErro)
  aoErroRef.current = aoErro

  const carregarPagina = useCallback(
    async (offset: number, _limit = TAMANHO_PAGINA) => {
      const inicioPagina = Math.max(0, Math.floor(offset / TAMANHO_PAGINA) * TAMANHO_PAGINA)
      if (paginasEmVooRef.current.has(inicioPagina)) return
      paginasEmVooRef.current.add(inicioPagina)
      try {
        const res = await chamar<RespostaTimeline>('transcription.timeline', {
          source_id: fonteId,
          offset: inicioPagina,
          limit: TAMANHO_PAGINA,
        })
        setTotalLinhas(res.total)
        setItensMap((prev) => {
          const prox = new Map(prev)
          res.items.forEach((it, idx) => {
            prox.set(res.offset + idx, it)
          })
          return prox
        })
      } catch (err) {
        aoErroRef.current?.(normalizarErro(err))
      } finally {
        paginasEmVooRef.current.delete(inicioPagina)
      }
    },
    [fonteId],
  )

  useEffect(() => {
    let cancelado = false
    paginasEmVooRef.current.clear()
    setItensMap(new Map())
    setTotalLinhas(0)
    setEditandoPos(null)
    setCarregandoInicial(true)

    const linhaAlvo = scrollPara?.row ?? null
    setRolarPara(linhaAlvo)
    setFraseDestacada(scrollPara?.frase ?? null)

    Promise.all([
      chamar('transcription.segment', { source_id: fonteId }).catch(() => null),
      chamar<RespostaCorrections>('transcription.corrections', {}).catch(() => ({
        can_undo: false,
        can_redo: false,
      })),
      chamar<RespostaTimeline>('transcription.timeline', {
        source_id: fonteId,
        offset: 0,
        limit: TAMANHO_PAGINA,
      }),
    ])
      .then(async ([, corr, timeline]) => {
        if (cancelado) return
        setCanUndo(Boolean(corr?.can_undo))
        setCanRedo(Boolean(corr?.can_redo))
        const mapa = new Map<number, ItemTimeline>()
        timeline.items.forEach((it, idx) => {
          mapa.set(timeline.offset + idx, it)
        })
        setTotalLinhas(timeline.total)
        setItensMap(mapa)

        if (linhaAlvo != null && !mapa.has(linhaAlvo)) {
          await carregarPagina(linhaAlvo, TAMANHO_PAGINA)
        }
      })
      .catch((err) => {
        if (!cancelado) aoErroRef.current?.(normalizarErro(err))
      })
      .finally(() => {
        if (!cancelado) setCarregandoInicial(false)
      })

    return () => {
      cancelado = true
    }
  }, [carregarPagina, fonteId, scrollPara?.frase, scrollPara?.row])

  // Restaura foco na palavra após confirmar ou cancelar edição inline
  useEffect(() => {
    if (editandoPos !== null) {
      inputEdicaoRef.current?.focus()
      inputEdicaoRef.current?.select()
      return
    }
    const posAlvo = devolverFocoPosRef.current
    if (posAlvo != null) {
      devolverFocoPosRef.current = null
      const el = containerRef.current?.querySelector<HTMLButtonElement>(
        `button[data-word="${posAlvo}"]`,
      )
      el?.focus()
    }
  }, [editandoPos])

  const atualizarPalavraNoMapa = useCallback(
    (position: number, texto: string, corrected: boolean) => {
      setItensMap((prev) => {
        let alterado = false
        const prox = new Map(prev)
        for (const [idx, item] of prev.entries()) {
          if (item.type !== 'sentence') continue
          const existe = item.words.some((w) => w.position === position)
          if (!existe) continue
          const novasPalavras = item.words.map((w) =>
            w.position === position ? { ...w, text: texto, corrected } : w,
          )
          prox.set(idx, {
            ...item,
            words: novasPalavras,
            text: novasPalavras.map((w) => w.text).join(' '),
          })
          alterado = true
          break
        }
        return alterado ? prox : prev
      })
    },
    [],
  )

  const iniciarEdicao = (palavra: PalavraTimeline) => {
    setEditandoPos(palavra.position)
    setTextoEdicao(palavra.text)
  }

  const cancelarEdicao = (position: number) => {
    devolverFocoPosRef.current = position
    setEditandoPos(null)
  }

  const confirmarEdicao = async (position: number) => {
    if (salvandoCorrecao) return
    setSalvandoCorrecao(true)
    try {
      const res = await chamar<RespostaPassoCorrecao>('transcription.correct', {
        source_id: fonteId,
        position,
        text: textoEdicao,
      })
      const textoLimpo = res.text.trim()
      atualizarPalavraNoMapa(res.position, textoLimpo, res.corrected)
      setCanUndo(res.can_undo)
      setCanRedo(res.can_redo)
      devolverFocoPosRef.current = res.position
      setEditandoPos(null)
    } catch (err) {
      aoErro?.(normalizarErro(err))
    } finally {
      setSalvandoCorrecao(false)
    }
  }

  const executarPassoHistorico = useCallback(
    async (tipo: 'undo' | 'redo') => {
      try {
        const res = await chamar<RespostaPassoCorrecao>(
          tipo === 'undo' ? 'transcription.undo' : 'transcription.redo',
          {},
        )
        setCanUndo(res.can_undo)
        setCanRedo(res.can_redo)

        if (res.source_id === fonteId) {
          atualizarPalavraNoMapa(res.position, res.text.trim(), res.corrected)
          requestAnimationFrame(() => {
            containerRef.current
              ?.querySelector<HTMLButtonElement>(`button[data-word="${res.position}"]`)
              ?.focus()
          })
        } else {
          toastRef.current.add({
            title:
              tipo === 'undo'
                ? 'Correção desfeita em outra Fonte do Projeto.'
                : 'Correção refeita em outra Fonte do Projeto.',
            description: `Fonte #${res.source_id}`,
            actionProps: {
              children: 'Ir para Fonte afetada',
              onClick: () => {
                window.location.hash = `#/projeto/${encProjeto}/fontes/${res.source_id}?frase=${res.sentence_id}`
              },
            },
          })
        }
      } catch (err) {
        const e = normalizarErro(err)
        if (e.code === 'nothing_to_undo' || e.code === 'nothing_to_redo') {
          setCanUndo(e.code !== 'nothing_to_undo' ? canUndo : false)
          setCanRedo(e.code !== 'nothing_to_redo' ? canRedo : false)
          return
        }
        aoErro?.(e)
      }
    },
    [aoErro, atualizarPalavraNoMapa, canRedo, canUndo, encProjeto, fonteId],
  )

  const executarBusca = async (e?: FormEvent) => {
    e?.preventDefault()
    const q = termoBusca.trim()
    if (!q) {
      setTermoSubmetido(null)
      setResultadosBusca([])
      return
    }
    setBuscando(true)
    setTermoSubmetido(q)
    try {
      const hits = await chamar<ResultadoBusca[]>('transcription.search', {
        query: q,
        limit: 50,
      })
      const lista = Array.isArray(hits) ? hits : []
      setResultadosBusca(
        escopoBusca === 'fonte' ? lista.filter((h) => h.source_id === fonteId) : lista,
      )
    } catch (err) {
      aoErro?.(normalizarErro(err))
      setResultadosBusca([])
    } finally {
      setBuscando(false)
    }
  }

  const limparBusca = () => {
    setTermoBusca('')
    setTermoSubmetido(null)
    setResultadosBusca([])
    buscaInputRef.current?.focus()
  }

  const atalhos = useMemo<Atalho[]>(
    () => [
      {
        id: 'busca.focar',
        titulo: 'Buscar na Transcrição',
        grupo: 'Transcrição',
        tecla: 'Mod+F',
        executar: () => {
          buscaInputRef.current?.focus()
          buscaInputRef.current?.select()
        },
      },
      {
        id: 'transcricao.desfazer',
        titulo: 'Desfazer correção de Transcrição',
        grupo: 'Transcrição',
        tecla: 'Mod+Z',
        executar: () => {
          if (editandoPos !== null || !canUndo) return
          void executarPassoHistorico('undo')
        },
      },
      {
        id: 'transcricao.refazer',
        titulo: 'Refazer correção de Transcrição',
        grupo: 'Transcrição',
        tecla: 'Mod+Shift+Z',
        executar: () => {
          if (editandoPos !== null || !canRedo) return
          void executarPassoHistorico('redo')
        },
      },
    ],
    [canRedo, canUndo, editandoPos, executarPassoHistorico],
  )

  useAtalhos(atalhos)

  const moverParaPalavraPorOffset = (atualPos: number, delta: number) => {
    const botoes = Array.from(
      containerRef.current?.querySelectorAll<HTMLButtonElement>('button[data-word]') ?? [],
    )
    const idx = botoes.findIndex((b) => Number(b.dataset.word) === atualPos)
    if (idx < 0) return
    const alvo = botoes[idx + delta]
    alvo?.focus()
  }

  const tratarTeclaPalavra = (
    e: KeyboardEvent<HTMLButtonElement>,
    frase: Extract<ItemTimeline, { type: 'sentence' }>,
    palavra: PalavraTimeline,
  ) => {
    if (e.key === 'F2' || e.key === 'Enter') {
      e.preventDefault()
      iniciarEdicao(palavra)
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
      e.preventDefault()
      aoFocarPalavraTempo?.(palavra.start_us)
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      moverParaPalavraPorOffset(palavra.position, 1)
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      moverParaPalavraPorOffset(palavra.position, -1)
      return
    }
    if (e.key === 'Home' && frase.words.length > 0) {
      e.preventDefault()
      const primeira = frase.words[0].position
      containerRef.current
        ?.querySelector<HTMLButtonElement>(`button[data-word="${primeira}"]`)
        ?.focus()
      return
    }
    if (e.key === 'End' && frase.words.length > 0) {
      e.preventDefault()
      const ultima = frase.words[frase.words.length - 1].position
      containerRef.current
        ?.querySelector<HTMLButtonElement>(`button[data-word="${ultima}"]`)
        ?.focus()
    }
  }

  const aoSelecionarResultado = async (hit: ResultadoBusca) => {
    if (hit.source_id === fonteId) {
      if (!itensMap.has(hit.row)) {
        await carregarPagina(hit.row, TAMANHO_PAGINA)
      }
      setFraseDestacada(hit.sentence_id)
      setRolarPara(hit.row)
      aoFocarPalavraTempo?.(hit.start_us)
    } else {
      window.location.hash = `#/projeto/${encProjeto}/fontes/${hit.source_id}?frase=${hit.sentence_id}&row=${hit.row}`
    }
  }

  const renderizarItem = (item: ItemTimeline) => {
    if (item.type === 'silence') {
      const seg = ((item.end_us - item.start_us) / 1_000_000).toLocaleString('pt-BR', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })
      return (
        <div className="px-2 py-1">
          <button
            type="button"
            onClick={() => aoFocarPalavraTempo?.(item.start_us)}
            className="foco flex min-h-7 w-full cursor-pointer items-center justify-between gap-3 rounded-controle border border-dashed border-linha-forte bg-[repeating-linear-gradient(-45deg,var(--area),var(--area)_6px,var(--chao)_6px,var(--chao)_12px)] px-3 py-1.5 text-left text-pequeno text-t2 hover:text-t1"
          >
            <span className="flex items-center gap-1.5 font-medio">
              <VolumeX className="size-[13px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
              Silêncio · {seg} s
            </span>
            <span className="num text-t3">
              {tcLongo(item.start_us)} – {tcLongo(item.end_us)}
            </span>
          </button>
        </div>
      )
    }

    const destacada = fraseDestacada === item.id

    return (
      <div className="px-2 py-1">
        <article
          aria-label={`Frase ${item.id}`}
          className={cn(
            'grid grid-cols-1 gap-2 rounded-area bg-area p-2.5 xl:grid-cols-[152px_minmax(0,72ch)]',
            destacada && 'marcado',
          )}
        >
          <header className="flex items-center gap-2 text-pequeno text-t3 xl:flex-col xl:items-start xl:gap-1">
            <span className="num">
              {tcLongo(item.start_us)} – {tcLongo(item.end_us)}
            </span>
            <span className="rounded-mini bg-elevado px-1.5 py-0.5 text-micro text-t2">
              {item.language}
            </span>
          </header>

          <div className="flex flex-wrap items-center gap-1 leading-[1.55]">
            {item.words.map((w) => {
              if (editandoPos === w.position) {
                return (
                  <span key={w.position} className="inline-flex items-center gap-1">
                    <input
                      ref={inputEdicaoRef}
                      type="text"
                      aria-label="Corrigir palavra"
                      value={textoEdicao}
                      disabled={salvandoCorrecao}
                      onChange={(e) => setTextoEdicao(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void confirmarEdicao(w.position)
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelarEdicao(w.position)
                        }
                      }}
                      className="foco h-6 w-32 rounded-mini border border-foco bg-elevado px-1.5 text-base font-medio text-t1"
                    />
                  </span>
                )
              }

              const ativa =
                tempoAtualUs > 0 &&
                tempoAtualUs >= w.start_us &&
                tempoAtualUs < w.start_us + 500_000

              return (
                <button
                  key={w.position}
                  type="button"
                  data-word={w.position}
                  aria-description={w.corrected ? 'Palavra corrigida' : undefined}
                  onClick={() => aoFocarPalavraTempo?.(w.start_us)}
                  onKeyDown={(e) => tratarTeclaPalavra(e, item, w)}
                  className={cn(
                    'foco inline-flex min-h-6 min-w-6 cursor-pointer items-center gap-1 rounded-mini border-0 bg-transparent px-1 py-0.5 text-left text-base text-t1 hover:bg-hover',
                    w.corrected && 'border-b-2 border-dotted border-linha-forte bg-elevado',
                    ativa && 'font-medio text-sinal-texto',
                  )}
                >
                  <span>{w.text}</span>
                  {w.corrected && (
                    <Pencil className="size-3 shrink-0 stroke-[1.75] text-t3" aria-hidden />
                  )}
                </button>
              )
            })}
          </div>
        </article>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden">
      {/* Barra de ferramentas do Leitor */}
      <div className="flex flex-wrap items-center gap-2 rounded-area bg-area px-3 py-2">
        <Dica texto="Desfaz a última correção de palavra no Projeto inteiro; prévia da Fonte afetada aguarda #302.">
          <span className="inline-flex">
            <Botao
              variante="secundario"
              tamanho="p"
              icone={<Undo2 />}
              atalho={formatarTecla('Mod+Z')}
              disabled={!canUndo}
              onClick={() => void executarPassoHistorico('undo')}
            >
              Desfazer
            </Botao>
          </span>
        </Dica>

        <Dica texto="Refaz a última correção desfeita no Projeto inteiro (#302).">
          <span className="inline-flex">
            <Botao
              variante="secundario"
              tamanho="p"
              icone={<Redo2 />}
              disabled={!canRedo}
              onClick={() => void executarPassoHistorico('redo')}
            >
              Refazer
            </Botao>
          </span>
        </Dica>

        <form onSubmit={(e) => void executarBusca(e)} className="ml-auto flex items-center gap-2">
          <div className="w-36 shrink-0">
            <Select
              valor={escopoBusca}
              aoMudar={setEscopoBusca}
              opcoes={OPCOES_ESCOPO}
              rotulo="Escopo da busca"
              className="w-36 min-w-32"
            />
          </div>
          <Busca
            ref={buscaInputRef}
            rotulo="Buscar na Transcrição"
            placeholder="Buscar falas…"
            atalho={formatarTecla('Mod+F')}
            value={termoBusca}
            onChange={(e) => setTermoBusca(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void executarBusca()
              }
            }}
            className="w-52 [&_input]:pr-14"
          />
        </form>

        {typeof totalPalavras === 'number' && totalPalavras > 0 && (
          <span className="num text-pequeno text-t3">
            {totalPalavras.toLocaleString('pt-BR')} palavras
          </span>
        )}
      </div>

      {/* Painel de resultados da busca (quando pesquisado) */}
      {termoSubmetido !== null && (
        <section
          aria-label="Resultados da busca na Transcrição"
          className="flex max-h-48 flex-col gap-2 overflow-y-auto rounded-area bg-area p-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-pequeno font-medio text-t1">
              {buscando
                ? 'Buscando…'
                : `${resultadosBusca.length} ocorrência(s) para "${termoSubmetido}"`}
            </span>
            <Botao tamanho="p" variante="fantasma" icone={<X />} onClick={limparBusca}>
              Limpar busca
            </Botao>
          </div>

          {!buscando && resultadosBusca.length === 0 ? (
            <p className="text-pequeno text-t2">
              Nenhum trecho encontrado para '{termoSubmetido}'.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {resultadosBusca.map((hit, idx) => (
                <li key={`${hit.source_id}-${hit.sentence_id}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => void aoSelecionarResultado(hit)}
                    className="foco flex w-full cursor-pointer flex-col gap-0.5 rounded-controle border-0 bg-chao px-2.5 py-1.5 text-left text-pequeno hover:bg-hover"
                  >
                    <span className="flex items-center justify-between gap-2 text-t3">
                      <span className="font-medio text-t2">{hit.source}</span>
                      <span className="num">
                        {tcLongo(hit.start_us)} – {tcLongo(hit.end_us)}
                      </span>
                    </span>
                    <span className="text-t1">
                      {hit.snippet.map((tok, tIdx) =>
                        tok.match ? (
                          <mark key={tIdx} className="rounded-mini bg-sinal-suave px-0.5 text-t1">
                            {tok.text}
                          </mark>
                        ) : (
                          <span key={tIdx}>{tok.text}</span>
                        ),
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Lista virtualizada sobre transcription.timeline */}
      {carregandoInicial ? (
        <div className="p-2 text-pequeno text-t3">Carregando Transcrição…</div>
      ) : (
        <ListaVirtual<ItemTimeline>
          papel="region"
          ariaLabel="Transcrição da Fonte"
          total={totalLinhas}
          alturaItem={80}
          obterItem={(idx) => itensMap.get(idx)}
          carregarPagina={carregarPagina}
          obterId={(item) =>
            item.type === 'silence' ? `silence-${item.start_us}` : `sentence-${item.id}`
          }
          rolarParaIndice={rolarPara}
          renderizarItem={(item) => renderizarItem(item)}
          className="min-h-0 flex-1 rounded-area bg-chao"
        />
      )}
    </div>
  )
}
