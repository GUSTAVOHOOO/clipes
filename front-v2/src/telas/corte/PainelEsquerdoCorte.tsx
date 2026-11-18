import {
  Abas,
  AreaRolagem,
  Botao,
  BotaoIcone,
  Dica,
  Entrada,
  Esqueleto,
  Kbd,
  ListaVirtual,
  Menu,
  MenuItem,
  MenuSeparador,
  Status,
  cn,
  tc,
  useToast,
} from '@ds'
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Diamond,
  FileAudio,
  MessageSquareText,
  Mic,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Redo2,
  Scissors,
  Sparkles,
  Undo2,
  VolumeX,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { formatarTecla, useAtalhos, type Atalho } from '~/comandos/atalhos'
import { chamar, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import type { Fila } from '~/core/progresso'
import {
  useEditorCorte,
  type CropKeyframe,
  type EditableWord,
  type EditorDocumento,
  type EstadoEditorCorte,
  type SfxAnchor,
  type SilenceInterval,
  type StoreEditorCorte,
  type TimelineSentence,
} from '~/stores/editorCorte'

export type PainelEsquerdoCorteProps = {
  aberto: boolean
  aoAlternarAberto: () => void
  larguraCompacta?: boolean
  projetoId?: string
  projetoPath?: string | null
  corteId?: string | null
  fonteDisponivel?: boolean
  store?: StoreEditorCorte
  fila?: Fila
  tempoAtualUs?: number
  aoMudarTempoUs?: (us: number) => void
  aoOuvirEmContexto?: (us: number) => void
  aoFocarLegendaOverride?: (position: number) => void
  aoAbrirAbaAudio?: (anchor?: SfxAnchor) => void
  abaInicial?: 'transcricao' | 'indice'
  className?: string
}

type AbaPainel = 'transcricao' | 'indice'
type FiltroIndice = 'tudo' | 'frases' | 'silencios' | 'enquadramento' | 'narracao' | 'audio'

type PalavraExtra = {
  position: number
  text: string
  startUs?: number
  endUs?: number
  start_us?: number
  end_us?: number
  confidence?: number
  corrected?: boolean
}

type PalavraResolvida = {
  position: number
  text: string
  startUs: number
  endUs: number
  confidence?: number
  corrected: boolean
  override?: EditableWord['overrides']
  missingGlyph?: EditableWord['missingGlyph']
}

type RespostaCorrections = { can_undo: boolean; can_redo: boolean }

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

type ItemIndice =
  | {
      id: string
      categoria: 'frases'
      timeUs: number
      frase: TimelineSentence
      fora: boolean
    }
  | {
      id: string
      categoria: 'silencios'
      timeUs: number
      silencio: SilenceInterval
    }
  | {
      id: string
      categoria: 'enquadramento'
      timeUs: number
      painel: 'primary' | 'top' | 'bottom'
      indicePainel: number
      keyframe: CropKeyframe
      todosDoPainel: CropKeyframe[]
    }
  | {
      id: string
      categoria: 'narracao'
      timeUs: number
      blockId: number
      position: number
      title: string
      mode: 'automatic' | 'manual'
      pushedUs: number
      durationUs: number
    }
  | {
      id: string
      categoria: 'audio'
      subtipo: 'trilha' | 'sfx'
      timeUs: number
      titulo: string
      detalhe: string
      sfxId?: number
    }

const FILTROS_INDICE: Array<{ id: FiltroIndice; rotulo: string }> = [
  { id: 'tudo', rotulo: 'Tudo' },
  { id: 'frases', rotulo: 'Frases' },
  { id: 'silencios', rotulo: 'Silêncios' },
  { id: 'enquadramento', rotulo: 'Enquadramento' },
  { id: 'narracao', rotulo: 'Narração' },
  { id: 'audio', rotulo: 'Áudio e SFX' },
]

function normalizarTexto(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function formatarSegundos(us: number): string {
  return (Math.max(0, us) / 1_000_000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

function resolverPalavrasDaFrase(
  frase: TimelineSentence,
  wordsLegenda: EditableWord[],
  docStartUs: number,
  corrigidas: Map<number, string>,
): PalavraResolvida[] {
  const extras = (frase as TimelineSentence & { words?: PalavraExtra[] }).words
  if (Array.isArray(extras) && extras.length > 0) {
    return extras.map((w, idx) => {
      const dur = Math.max(1, frase.endUs - frase.startUs)
      const sUs = w.startUs ?? w.start_us ?? frase.startUs + Math.round((idx / extras.length) * dur)
      const eUs =
        w.endUs ?? w.end_us ?? frase.startUs + Math.round(((idx + 1) / extras.length) * dur)
      const leg = wordsLegenda.find((lw) => lw.position === w.position)
      const textoCorrigido = corrigidas.get(w.position)
      return {
        position: w.position,
        text: textoCorrigido ?? w.text.trim(),
        startUs: sUs,
        endUs: eUs,
        confidence: w.confidence,
        corrected: Boolean(w.corrected || textoCorrigido !== undefined),
        override: leg?.overrides,
        missingGlyph: leg?.missingGlyph,
      }
    })
  }

  const tokens = frase.text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  const dur = Math.max(1, frase.endUs - frase.startUs)

  return tokens.map((tok, idx) => {
    const startUs = frase.startUs + Math.round((idx / tokens.length) * dur)
    const endUs = frase.startUs + Math.round(((idx + 1) / tokens.length) * dur)
    const posPadrao = frase.id * 10 + idx

    const legPorPos = wordsLegenda.find((lw) => lw.position === posPadrao)
    const legPorTempo =
      legPorPos ??
      wordsLegenda.find((lw) => {
        const srcUs = lw.sourceStartUs ?? docStartUs + lw.startUs
        return (
          srcUs >= frase.startUs &&
          srcUs < frase.endUs &&
          normalizarTexto(lw.text.trim()) === normalizarTexto(tok)
        )
      })

    const position = legPorPos ? legPorPos.position : posPadrao
    const textoCorrigido = corrigidas.get(position)
    return {
      position,
      text: textoCorrigido ?? tok,
      startUs,
      endUs,
      corrected: textoCorrigido !== undefined,
      override: legPorTempo?.overrides,
      missingGlyph: legPorTempo?.missingGlyph,
    }
  })
}

function PainelEsquerdoComStore(
  props: PainelEsquerdoCorteProps & { store: StoreEditorCorte },
) {
  const estado = useSyncExternalStore(
    props.store.assinar,
    props.store.obterSnapshot,
    props.store.obterSnapshot,
  )
  return <PainelEsquerdoInterno {...props} estado={estado} store={props.store} />
}

function PainelEsquerdoComHook(props: PainelEsquerdoCorteProps) {
  const editor = useEditorCorte(props.projetoPath ?? null, props.corteId ?? null, {
    fonteDisponivel: props.fonteDisponivel,
    fila: props.fila,
  })
  return <PainelEsquerdoInterno {...props} estado={editor} store={editor.store} />
}

/** Painel esquerdo recolhível (`Ctrl+[`) com Transcrição do Corte e Índice do Corte 100% operável por teclado. */
export function PainelEsquerdoCorte(props: PainelEsquerdoCorteProps) {
  if (props.store) {
    return <PainelEsquerdoComStore {...props} store={props.store} />
  }
  return <PainelEsquerdoComHook {...props} />
}

function PainelEsquerdoInterno({
  aberto,
  aoAlternarAberto,
  larguraCompacta = false,
  projetoId = 'demo',
  store,
  estado,
  tempoAtualUs = 0,
  aoMudarTempoUs,
  aoOuvirEmContexto,
  aoFocarLegendaOverride,
  aoAbrirAbaAudio,
  abaInicial = 'transcricao',
  className,
}: PainelEsquerdoCorteProps & { estado: EstadoEditorCorte; store: StoreEditorCorte }) {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast

  const doc: EditorDocumento | null = estado.previaLocal ?? estado.oficial
  const sourceId = doc?.request.source_id ?? null

  const [aba, setAba] = useState<AbaPainel>(abaInicial)
  const [busca, setBusca] = useState('')
  const [indiceOcorrencia, setIndiceOcorrencia] = useState(0)
  const [filtroIndice, setFiltroIndice] = useState<FiltroIndice>('tudo')
  const [itemIndiceSel, setItemIndiceSel] = useState<string | null>(null)

  const [canUndoTranscricao, setCanUndoTranscricao] = useState(false)
  const [canRedoTranscricao, setCanRedoTranscricao] = useState(false)
  const [corrigidasLocais, setCorrigidasLocais] = useState<Map<number, string>>(() => new Map())
  const [frasesSincronizadas, setFrasesSincronizadas] = useState<TimelineSentence[] | null>(null)

  const [editandoPos, setEditandoPos] = useState<number | null>(null)
  const [textoEdicao, setTextoEdicao] = useState('')
  const [salvandoCorrecao, setSalvandoCorrecao] = useState(false)
  const [palavraMenu, setPalavraMenu] = useState<{
    fraseId: number
    palavra: PalavraResolvida
  } | null>(null)

  const containerTranscricaoRef = useRef<HTMLDivElement | null>(null)
  const buscaInputRef = useRef<HTMLInputElement | null>(null)
  const inputEdicaoRef = useRef<HTMLInputElement | null>(null)
  const devolverFocoPosRef = useRef<number | null>(null)

  useEffect(() => {
    setCorrigidasLocais(new Map())
    setFrasesSincronizadas(null)
    setEditandoPos(null)
    setPalavraMenu(null)
  }, [estado.corteId, doc?.clipId])

  useEffect(() => {
    setFrasesSincronizadas(null)
  }, [estado.frases])

  const atualizarEstadoCorrecoes = useCallback(async () => {
    try {
      const res = await chamar<RespostaCorrections>('transcription.corrections', {})
      setCanUndoTranscricao(Boolean(res?.can_undo))
      setCanRedoTranscricao(Boolean(res?.can_redo))
    } catch {
      // ignora em ambiente sem transcrição carregada
    }
  }, [])

  useEffect(() => {
    if (aberto) {
      void atualizarEstadoCorrecoes()
    }
  }, [aberto, doc?.clipId, atualizarEstadoCorrecoes])

  useEffect(() => {
    if (editandoPos !== null) {
      inputEdicaoRef.current?.focus()
      inputEdicaoRef.current?.select()
      return
    }
    const alvoPos = devolverFocoPosRef.current
    if (alvoPos !== null) {
      devolverFocoPosRef.current = null
      containerTranscricaoRef.current
        ?.querySelector<HTMLButtonElement>(`button[data-word="${alvoPos}"]`)
        ?.focus()
    }
  }, [editandoPos])

  const atalhosLocais = useMemo<Atalho[]>(() => {
    if (!aberto) return []
    return [
      {
        id: 'painel-corte.busca',
        titulo: 'Buscar na Transcrição ou Índice do Corte',
        grupo: 'Transcrição',
        tecla: 'Mod+F',
        executar: () => {
          buscaInputRef.current?.focus()
          buscaInputRef.current?.select()
        },
      },
    ]
  }, [aberto])

  useAtalhos(atalhosLocais)

  const frasesAtuais = useMemo(
    () => frasesSincronizadas ?? estado.frases,
    [frasesSincronizadas, estado.frases],
  )

  const wordsLegenda = estado.legendas?.words ?? []
  const silencios = useMemo(() => doc?.silences.intervals ?? [], [doc?.silences.intervals])

  const frasesComPalavras = useMemo(() => {
    const startUs = doc?.startUs ?? 0
    const endUs = doc?.endUs ?? 0
    return frasesAtuais.map((frase) => {
      const fora = doc ? frase.endUs <= startUs || frase.startUs >= endUs : false
      const ativa = Boolean(doc && !fora && tempoAtualUs >= frase.startUs && tempoAtualUs < frase.endUs)
      const palavras = resolverPalavrasDaFrase(frase, wordsLegenda, startUs, corrigidasLocais)
      return { frase, fora, ativa, palavras }
    })
  }, [corrigidasLocais, doc, frasesAtuais, tempoAtualUs, wordsLegenda])

  const termoBuscaNorm = useMemo(() => normalizarTexto(busca.trim()), [busca])

  const ocorrenciasBusca = useMemo(() => {
    if (!termoBuscaNorm) return [] as Array<{ fraseId: number; position: number; startUs: number }>
    const hits: Array<{ fraseId: number; position: number; startUs: number }> = []
    for (const item of frasesComPalavras) {
      for (const p of item.palavras) {
        if (normalizarTexto(p.text).includes(termoBuscaNorm)) {
          hits.push({ fraseId: item.frase.id, position: p.position, startUs: p.startUs })
        }
      }
    }
    return hits
  }, [frasesComPalavras, termoBuscaNorm])

  useEffect(() => {
    setIndiceOcorrencia(0)
  }, [termoBuscaNorm])

  const navegarOcorrencia = (delta: number) => {
    if (ocorrenciasBusca.length === 0) return
    const prox = (indiceOcorrencia + delta + ocorrenciasBusca.length) % ocorrenciasBusca.length
    setIndiceOcorrencia(prox)
    const alvo = ocorrenciasBusca[prox]
    aoMudarTempoUs?.(alvo.startUs)
    containerTranscricaoRef.current
      ?.querySelector<HTMLButtonElement>(`button[data-word="${alvo.position}"]`)
      ?.focus()
  }

  const iniciarEdicao = (palavra: PalavraResolvida) => {
    setPalavraMenu(null)
    setEditandoPos(palavra.position)
    setTextoEdicao(palavra.text)
  }

  const cancelarEdicao = (position: number) => {
    devolverFocoPosRef.current = position
    setEditandoPos(null)
  }

  const confirmarEdicao = async (position: number) => {
    if (salvandoCorrecao || sourceId === null) return
    const limpo = textoEdicao.trim()
    if (!limpo) {
      cancelarEdicao(position)
      return
    }
    setSalvandoCorrecao(true)
    try {
      await store.corrigirPalavraTranscricao(sourceId, position, limpo)
      setCorrigidasLocais((prev) => {
        const next = new Map(prev)
        next.set(position, limpo)
        return next
      })
      await atualizarEstadoCorrecoes()
      devolverFocoPosRef.current = position
      setEditandoPos(null)
    } catch (err) {
      toastRef.current.add({
        type: 'erro',
        title: mensagemDeErro(paraErroCore(err)).titulo,
      })
    } finally {
      setSalvandoCorrecao(false)
    }
  }

  const executarHistoricoTranscricao = useCallback(
    async (tipo: 'undo' | 'redo') => {
      try {
        const res = await chamar<RespostaPassoCorrecao>(
          tipo === 'undo' ? 'transcription.undo' : 'transcription.redo',
          {},
        )
        setCanUndoTranscricao(Boolean(res.can_undo))
        setCanRedoTranscricao(Boolean(res.can_redo))

        if (sourceId !== null && res.source_id === sourceId) {
          const textoLimpo = res.text.trim()
          setCorrigidasLocais((prev) => {
            const next = new Map(prev)
            if (res.corrected) next.set(res.position, textoLimpo)
            else next.delete(res.position)
            return next
          })
          if (doc) {
            const winStart = doc.windowStartUs ?? Math.max(0, doc.startUs - 120_000_000)
            const winEnd = doc.windowEndUs ?? doc.endUs + 120_000_000
            const [novasFrases] = await Promise.all([
              chamar<TimelineSentence[]>('editor.sentences', {
                source_id: sourceId,
                start_us: winStart,
                end_us: winEnd,
                after_id: 0,
                limit: 500,
              }).catch(() => null),
              store.recarregarLegendas(),
            ])
            if (Array.isArray(novasFrases) && novasFrases.length > 0) {
              setFrasesSincronizadas(novasFrases)
            }
          }
          requestAnimationFrame(() => {
            containerTranscricaoRef.current
              ?.querySelector<HTMLButtonElement>(`button[data-word="${res.position}"]`)
              ?.focus()
          })
        } else {
          const encProj = encodeURIComponent(projetoId)
          toastRef.current.add({
            title:
              tipo === 'undo'
                ? 'Correção desfeita em outra Fonte do Projeto.'
                : 'Correção refeita em outra Fonte do Projeto.',
            description: `Fonte ${res.source_id}`,
            actionProps: {
              children: 'Ir para Fonte',
              onClick: () => {
                window.location.hash = `#/projeto/${encProj}/fontes/${res.source_id}?frase=${res.sentence_id}`
              },
            },
          })
        }
      } catch (err) {
        const e = paraErroCore(err)
        if (e.code === 'nothing_to_undo') {
          setCanUndoTranscricao(false)
          return
        }
        if (e.code === 'nothing_to_redo') {
          setCanRedoTranscricao(false)
          return
        }
        toastRef.current.add({
          type: 'erro',
          title: mensagemDeErro(e).titulo,
        })
      }
    },
    [doc, projetoId, sourceId, store],
  )

  const tratarTeclaTranscricao = (e: KeyboardEvent<HTMLDivElement>) => {
    const alvo = e.target as HTMLElement | null
    if (alvo?.matches('input, textarea, select')) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      e.stopPropagation()
      void executarHistoricoTranscricao(e.shiftKey ? 'redo' : 'undo')
    }
  }

  const moverFocoPalavra = (atualPos: number, delta: number) => {
    const botoes = Array.from(
      containerTranscricaoRef.current?.querySelectorAll<HTMLButtonElement>('button[data-word]') ?? [],
    )
    const idx = botoes.findIndex((b) => Number(b.dataset.word) === atualPos)
    if (idx < 0) return
    botoes[idx + delta]?.focus()
  }

  const tratarTeclaPalavra = (
    e: KeyboardEvent<HTMLButtonElement>,
    fraseId: number,
    palavra: PalavraResolvida,
  ) => {
    if (e.key === 'F2' || e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      iniciarEdicao(palavra)
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      moverFocoPalavra(palavra.position, 1)
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      moverFocoPalavra(palavra.position, -1)
      return
    }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault()
      setPalavraMenu({ fraseId, palavra })
    }
  }

  const executarAcaoPalavra = async (
    acao: 'entrada' | 'saida' | 'legenda' | 'sfx',
    frase: TimelineSentence,
    palavra: PalavraResolvida,
  ) => {
    setPalavraMenu(null)
    if (acao === 'entrada') {
      await store.ajustarBorda({ edge: 'start', sentenceId: frase.id, preview: false })
      return
    }
    if (acao === 'saida') {
      await store.ajustarBorda({ edge: 'end', sentenceId: frase.id, preview: false })
      return
    }
    if (acao === 'legenda') {
      aoFocarLegendaOverride?.(palavra.position)
      return
    }
    if (acao === 'sfx') {
      const ancora: SfxAnchor = {
        kind: 'word',
        track: 'original',
        position: palavra.position,
        offsetUs: 0,
      }
      if (aoAbrirAbaAudio) {
        aoAbrirAbaAudio(ancora)
      } else {
        const primeiroSfx = estado.bibliotecaAudio.find((a) => a.kind === 'sfx')
        if (primeiroSfx) {
          await store.adicionarSfx({ asset_id: primeiroSfx.id, anchor: ancora })
        }
      }
    }
  }

  // Lista cronológica para a visão Transcrição (Frases + Silêncios entre Frases)
  const itensTranscricao = useMemo(() => {
    const startUs = doc?.startUs ?? 0
    const endUs = doc?.endUs ?? 0
    const silenciosUsados = new Set<number>()
    const blocos: Array<
      | {
          tipo: 'frase'
          chave: string
          frase: TimelineSentence
          fora: boolean
          ativa: boolean
          palavras: PalavraResolvida[]
          silenciosInternos: SilenceInterval[]
        }
      | { tipo: 'silencio'; chave: string; silencio: SilenceInterval }
    > = []

    const ordenadas = [...frasesComPalavras].sort((a, b) => a.frase.startUs - b.frase.startUs)
    const silOrdenados = [...silencios].sort((a, b) => a.startUs - b.startUs)

    for (let i = 0; i < ordenadas.length; i += 1) {
      const atual = ordenadas[i]
      const proxInicio = ordenadas[i + 1]?.frase.startUs ?? Number.POSITIVE_INFINITY

      for (const sil of silOrdenados) {
        if (silenciosUsados.has(sil.id)) continue
        if (sil.startUs < atual.frase.startUs) {
          silenciosUsados.add(sil.id)
          blocos.push({ tipo: 'silencio', chave: `sil-${sil.id}`, silencio: sil })
        }
      }

      const internos: SilenceInterval[] = []
      const entreFrases: SilenceInterval[] = []
      for (const sil of silOrdenados) {
        if (silenciosUsados.has(sil.id)) continue
        if (sil.startUs >= atual.frase.startUs && sil.startUs < atual.frase.endUs) {
          silenciosUsados.add(sil.id)
          internos.push(sil)
        } else if (sil.startUs >= atual.frase.endUs && sil.startUs < proxInicio) {
          silenciosUsados.add(sil.id)
          entreFrases.push(sil)
        }
      }

      blocos.push({
        tipo: 'frase',
        chave: `frase-${atual.frase.id}`,
        frase: atual.frase,
        fora: atual.fora,
        ativa: atual.ativa,
        palavras: atual.palavras,
        silenciosInternos: internos,
      })

      for (const sil of entreFrases) {
        blocos.push({ tipo: 'silencio', chave: `sil-${sil.id}`, silencio: sil })
      }
    }

    for (const sil of silOrdenados) {
      if (silenciosUsados.has(sil.id)) continue
      if (!doc || (sil.endUs >= startUs && sil.startUs <= endUs)) {
        blocos.push({ tipo: 'silencio', chave: `sil-${sil.id}`, silencio: sil })
      }
    }

    return blocos
  }, [doc, frasesComPalavras, silencios])

  // Itens do Índice do Corte (alternativa textual completa à timeline)
  const itensIndice = useMemo<ItemIndice[]>(() => {
    if (!doc) return []
    const lista: ItemIndice[] = []

    for (const { frase, fora } of frasesComPalavras) {
      lista.push({
        id: `frase-${frase.id}`,
        categoria: 'frases',
        timeUs: frase.startUs,
        frase,
        fora,
      })
    }

    for (const sil of silencios) {
      lista.push({
        id: `sil-${sil.id}`,
        categoria: 'silencios',
        timeUs: sil.startUs,
        silencio: sil,
      })
    }

    const registrarPainelCrop = (
      painel: 'primary' | 'top' | 'bottom',
      edits: CropKeyframe[],
    ) => {
      edits.forEach((kf, idx) => {
        lista.push({
          id: `kf-${painel}-${idx}-${kf.timeUs}`,
          categoria: 'enquadramento',
          timeUs: kf.timeUs,
          painel,
          indicePainel: idx,
          keyframe: kf,
          todosDoPainel: edits,
        })
      })
    }

    registrarPainelCrop('primary', doc.crop.edits)
    if (doc.crop.gameplayWebcam) {
      registrarPainelCrop('top', doc.crop.gameplayWebcam.top.edits)
      registrarPainelCrop('bottom', doc.crop.gameplayWebcam.bottom.edits)
    }
    if (doc.crop.twoPeople) {
      registrarPainelCrop('top', doc.crop.twoPeople.top.edits)
      registrarPainelCrop('bottom', doc.crop.twoPeople.bottom.edits)
    }

    if (doc.montage) {
      for (const blk of doc.montage.blocks) {
        lista.push({
          id: `nar-${blk.blockId}`,
          categoria: 'narracao',
          timeUs: blk.sourceStartUs,
          blockId: blk.blockId,
          position: blk.position,
          title: blk.title,
          mode: blk.mode,
          pushedUs: blk.pushedUs,
          durationUs: blk.durationUs,
        })
      }
    }

    if (doc.audioMix.soundtrack) {
      const st = doc.audioMix.soundtrack
      lista.push({
        id: `trilha-${st.assetId}`,
        categoria: 'audio',
        subtipo: 'trilha',
        timeUs: doc.startUs + st.startUs,
        titulo: st.name,
        detalhe: `${Math.round(st.volume * 100)}%`,
      })
    }

    for (const sfx of doc.audioMix.sfx) {
      lista.push({
        id: `sfx-${sfx.id}`,
        categoria: 'audio',
        subtipo: 'sfx',
        timeUs: sfx.sourceStartUs,
        titulo: sfx.name,
        detalhe: sfx.wordText ? `Ancorado em "${sfx.wordText}"` : 'Momento fixo',
        sfxId: sfx.id,
      })
    }

    lista.sort((a, b) => a.timeUs - b.timeUs)

    return lista.filter((it) => {
      if (filtroIndice !== 'tudo' && it.categoria !== filtroIndice) return false
      if (!termoBuscaNorm) return true
      if (it.categoria === 'frases') {
        return normalizarTexto(it.frase.text).includes(termoBuscaNorm)
      }
      if (it.categoria === 'silencios') {
        return 'silencio pausa'.includes(termoBuscaNorm)
      }
      if (it.categoria === 'enquadramento') {
        return 'keyframe enquadramento corte'.includes(termoBuscaNorm)
      }
      if (it.categoria === 'narracao') {
        return normalizarTexto(it.title).includes(termoBuscaNorm)
      }
      return (
        normalizarTexto(it.titulo).includes(termoBuscaNorm) ||
        normalizarTexto(it.detalhe).includes(termoBuscaNorm)
      )
    })
  }, [doc, filtroIndice, frasesComPalavras, silencios, termoBuscaNorm])

  const alternarCutKeyframe = async (item: Extract<ItemIndice, { categoria: 'enquadramento' }>) => {
    const proxEdits = item.todosDoPainel.map((k, idx) =>
      idx === item.indicePainel ? { ...k, cut: !k.cut } : k,
    )
    await store.definirEditsCrop(
      item.painel,
      proxEdits,
      false,
      doc?.crop.layout ?? undefined,
    )
  }

  const removerKeyframe = async (item: Extract<ItemIndice, { categoria: 'enquadramento' }>) => {
    const proxEdits = item.todosDoPainel.filter((_, idx) => idx !== item.indicePainel)
    await store.definirEditsCrop(
      item.painel,
      proxEdits,
      false,
      doc?.crop.layout ?? undefined,
    )
  }

  const tratarTeclaListboxIndice = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLElement && e.target.closest('button, input, textarea, select')) {
      return
    }
    const alvo =
      itensIndice.find((it) => it.id === itemIndiceSel) ?? itensIndice[0] ?? null
    if (!alvo) return
    if (e.key === 'Enter') {
      e.preventDefault()
      aoMudarTempoUs?.(alvo.timeUs)
      return
    }
    if (e.key === ' ') {
      e.preventDefault()
      if (alvo.categoria === 'silencios') {
        void store.alternarSilencio(alvo.silencio.id)
      } else if (alvo.categoria === 'enquadramento') {
        void alternarCutKeyframe(alvo)
      }
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      if (alvo.categoria === 'enquadramento') {
        void removerKeyframe(alvo)
      } else if (alvo.categoria === 'audio') {
        if (alvo.subtipo === 'trilha') void store.limparTrilhaSonora(false)
        else if (typeof alvo.sfxId === 'number') void store.removerSfx(alvo.sfxId, false)
      }
      return
    }
    if (e.key === '0' && alvo.categoria === 'narracao') {
      e.preventDefault()
      void store.definirInicioNarracao(alvo.blockId, null, false, false)
    }
  }

  if (!aberto) {
    return (
      <aside
        aria-label="Transcrição recolhida"
        className={cn(
          'flex w-10 shrink-0 flex-col items-center gap-3 border-r border-linha bg-area py-2',
          className,
        )}
      >
        <BotaoIcone
          rotulo="Abrir Transcrição (Ctrl+[)"
          atalho={formatarTecla('Mod+[')}
          tamanho="m"
          semDica
          onClick={aoAlternarAberto}
        >
          <PanelLeftOpen />
        </BotaoIcone>
        <span
          aria-hidden
          className="text-micro font-medio tracking-wide text-t3 select-none [writing-mode:vertical-rl] [transform:rotate(180deg)]"
        >
          Transcrição
        </span>
      </aside>
    )
  }

  const larguraClasse = larguraCompacta
    ? 'w-[clamp(330px,31vw,420px)]'
    : 'w-[clamp(330px,31vw,420px)] min-[1440px]:w-[clamp(420px,31vw,480px)]'

  const renderBotaoSilencio = (sil: SilenceInterval) => {
    const removido = sil.status === 'active'
    return (
      <button
        key={`sil-btn-${sil.id}`}
        type="button"
        aria-pressed={removido}
        onClick={() => void store.alternarSilencio(sil.id)}
        className={cn(
          'foco-interno inline-flex min-h-6 w-full cursor-pointer items-center gap-2 rounded-controle border border-dashed border-linha-forte px-2.5 py-1 text-left text-pequeno text-t2 transition-colors hover:text-t1',
          'bg-[repeating-linear-gradient(-45deg,var(--elevado)_0_3px,var(--chao)_3px_6px)]',
          !removido && 'opacity-70',
        )}
      >
        <VolumeX className="size-[13px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
        <span className={cn('num', removido && 'line-through')}>
          pausa {formatarSegundos(sil.endUs - sil.startUs)} s ({removido ? 'removida' : 'mantida'})
        </span>
        <span className="ml-auto text-micro text-t3">
          {removido ? 'Manter' : 'Remover'}
        </span>
      </button>
    )
  }

  return (
    <aside
      aria-label="Transcrição e Índice do Corte"
      className={cn(
        'flex min-h-0 shrink-0 flex-col border-r border-linha bg-area',
        larguraClasse,
        className,
      )}
    >
      {/* Cabeçalho com Abas e botão recolher */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-linha px-3">
        <Abas
          rotulo="Painel do Corte"
          valor={aba}
          aoMudar={setAba}
          tamanho="p"
          abas={[
            { valor: 'transcricao', rotulo: 'Transcrição' },
            { valor: 'indice', rotulo: 'Índice do Corte' },
          ]}
        />
        <BotaoIcone
          rotulo="Recolher Transcrição (Ctrl+[)"
          atalho={formatarTecla('Mod+[')}
          tamanho="p"
          onClick={aoAlternarAberto}
          className="ml-auto"
        >
          <PanelLeftClose />
        </BotaoIcone>
      </div>

      {/* Busca local (Ctrl+F) */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-linha px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <Entrada
              ref={buscaInputRef}
              tamanho="p"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={
                aba === 'transcricao' ? 'Filtrar fala do Corte…' : 'Filtrar no Índice…'
              }
              aria-label={
                aba === 'transcricao' ? 'Filtrar fala do Corte' : 'Filtrar no Índice'
              }
            />
          </div>
          {aba === 'transcricao' && termoBuscaNorm && (
            <>
              <span className="num shrink-0 text-pequeno text-t3">
                {ocorrenciasBusca.length > 0 ? indiceOcorrencia + 1 : 0}/{ocorrenciasBusca.length}
              </span>
              <BotaoIcone
                rotulo="Ocorrência anterior"
                tamanho="p"
                disabled={ocorrenciasBusca.length === 0}
                onClick={() => navegarOcorrencia(-1)}
              >
                <ChevronUp />
              </BotaoIcone>
              <BotaoIcone
                rotulo="Próxima ocorrência"
                tamanho="p"
                disabled={ocorrenciasBusca.length === 0}
                onClick={() => navegarOcorrencia(1)}
              >
                <ChevronDown />
              </BotaoIcone>
            </>
          )}
          {busca && (
            <BotaoIcone rotulo="Limpar filtro" tamanho="p" onClick={() => setBusca('')}>
              <X />
            </BotaoIcone>
          )}
        </div>

        {aba === 'transcricao' && (
          <div className="flex items-center justify-between gap-2 text-micro text-t3">
            <span className="truncate">Correções da Transcrição (Projeto)</span>
            <div className="flex shrink-0 items-center gap-1">
              <Dica texto="Desfaz a última correção de palavra no Projeto inteiro, sem prévia antecipada da Fonte afetada.">
                <span className="inline-flex">
                  <Botao
                    tamanho="p"
                    variante="fantasma"
                    icone={<Undo2 />}
                    disabled={!canUndoTranscricao}
                    onClick={() => void executarHistoricoTranscricao('undo')}
                    aria-label="Desfazer correção da Transcrição"
                  >
                    Desfazer
                  </Botao>
                </span>
              </Dica>
              <Dica texto="Refaz a última correção desfeita no Projeto inteiro, sem prévia antecipada da Fonte afetada.">
                <span className="inline-flex">
                  <Botao
                    tamanho="p"
                    variante="fantasma"
                    icone={<Redo2 />}
                    disabled={!canRedoTranscricao}
                    onClick={() => void executarHistoricoTranscricao('redo')}
                    aria-label="Refazer correção da Transcrição"
                  >
                    Refazer
                  </Botao>
                </span>
              </Dica>
            </div>
          </div>
        )}
      </div>

      {estado.carregando && !doc ? (
        <div className="flex-1 p-3">
          <Esqueleto variante="transcricao" />
        </div>
      ) : aba === 'transcricao' ? (
        <div
          ref={containerTranscricaoRef}
          onKeyDown={tratarTeclaTranscricao}
          className="flex min-h-0 flex-1 flex-col"
        >
          <AreaRolagem rotulo="Frases do Corte" className="flex-1">
            <div className="flex flex-col gap-1.5 p-3">
              {termoBuscaNorm && ocorrenciasBusca.length === 0 ? (
                <p className="py-6 text-center text-pequeno text-t3">
                  Nenhuma fala com &apos;{busca.trim()}&apos; neste Corte.
                </p>
              ) : (
                itensTranscricao.map((bloco) => {
                  if (bloco.tipo === 'silencio') {
                    return (
                      <div key={bloco.chave} className="py-0.5">
                        {renderBotaoSilencio(bloco.silencio)}
                      </div>
                    )
                  }

                  const { frase, fora, ativa, palavras, silenciosInternos } = bloco
                  const antesDoCorte = doc ? frase.endUs <= doc.startUs : false

                  return (
                    <article
                      key={bloco.chave}
                      aria-label={`Frase ${frase.id}`}
                      data-fora={fora ? 'true' : undefined}
                      className={cn(
                        'flex flex-col gap-1.5 rounded-controle px-2.5 py-2 transition-colors duration-(--dur-rapida) ease-saida',
                        ativa && 'marcado bg-elevado',
                        fora && 'bg-chao/40 opacity-45',
                        !ativa && !fora && 'hover:bg-elevado/60',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 text-micro text-t3">
                        <span className="num">
                          Frase {frase.id} · {tc(frase.startUs)}
                          {fora ? ' · fora do Corte' : ''}
                        </span>
                        {fora && (
                          <Botao
                            tamanho="p"
                            variante="suave"
                            onClick={() =>
                              void store.ajustarBorda({
                                edge: antesDoCorte ? 'start' : 'end',
                                sentenceId: frase.id,
                                preview: false,
                              })
                            }
                          >
                            Incluir no Corte
                          </Botao>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1 leading-[1.55]">
                        {palavras.map((w, idx) => {
                          const silAntes = silenciosInternos.filter(
                            (si) =>
                              si.startUs >= w.startUs &&
                              (idx === palavras.length - 1 || si.startUs < palavras[idx + 1].startUs),
                          )

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
                                      e.stopPropagation()
                                      void confirmarEdicao(w.position)
                                    } else if (e.key === 'Escape') {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      cancelarEdicao(w.position)
                                    }
                                  }}
                                  className="foco h-6 w-28 rounded-mini border border-foco bg-elevado px-1.5 text-base font-medio text-t1"
                                />
                              </span>
                            )
                          }

                          const falada =
                            !fora && tempoAtualUs >= w.startUs && tempoAtualUs < w.endUs
                          const baixaConf = w.confidence !== undefined && w.confidence < 0.7
                          const destaqueBusca =
                            termoBuscaNorm && normalizarTexto(w.text).includes(termoBuscaNorm)
                          const temOverride = Boolean(
                            w.override &&
                              (w.override.color ||
                                w.override.activeColor ||
                                w.override.hidden ||
                                w.override.highlight === false),
                          )

                          return (
                            <span key={w.position} className="inline-flex flex-wrap items-center gap-1">
                              <button
                                type="button"
                                data-word={w.position}
                                aria-current={falada ? 'time' : undefined}
                                aria-description={
                                  w.corrected
                                    ? 'Palavra corrigida'
                                    : baixaConf
                                      ? 'Baixa confiança na transcrição'
                                      : undefined
                                }
                                onClick={() => {
                                  aoMudarTempoUs?.(w.startUs)
                                  setPalavraMenu({ fraseId: frase.id, palavra: w })
                                }}
                                onContextMenu={(e: MouseEvent) => {
                                  e.preventDefault()
                                  setPalavraMenu({ fraseId: frase.id, palavra: w })
                                }}
                                onKeyDown={(e) => tratarTeclaPalavra(e, frase.id, w)}
                                className={cn(
                                  'foco inline-flex min-h-6 min-w-6 cursor-pointer items-center justify-center gap-1 rounded-mini border-0 bg-transparent px-1 py-0.5 text-base text-t1 hover:bg-hover',
                                  (baixaConf || w.corrected) &&
                                    'border-b-2 border-dotted border-linha-forte',
                                  temOverride && 'bg-elevado',
                                  destaqueBusca && 'bg-sinal-suave',
                                  falada && 'font-forte text-sinal-texto',
                                )}
                              >
                                <span>{w.text}</span>
                                {w.corrected && (
                                  <Pencil
                                    className="size-3 shrink-0 stroke-[1.75] text-t3"
                                    aria-hidden
                                  />
                                )}
                                {baixaConf && !w.corrected && (
                                  <AlertCircle
                                    className="size-3 shrink-0 stroke-[1.75] text-t3"
                                    aria-hidden
                                  />
                                )}
                                {temOverride && (
                                  <Sparkles
                                    className="size-3 shrink-0 stroke-[1.75] text-t3"
                                    aria-hidden
                                  />
                                )}
                              </button>
                              {silAntes.map((si) => (
                                <span key={`sil-inline-${si.id}`} className="inline-flex">
                                  {renderBotaoSilencio(si)}
                                </span>
                              ))}
                            </span>
                          )
                        })}
                      </div>

                      {palavraMenu && palavraMenu.fraseId === frase.id && (
                        <div className="mt-1 flex items-center justify-between gap-2 rounded-controle bg-elevado px-2 py-1 text-pequeno">
                          <span className="truncate text-t2">
                            Palavra: <strong className="text-t1">{palavraMenu.palavra.text}</strong>
                          </span>
                          <Menu
                            gatilho={
                              <Botao
                                tamanho="p"
                                variante="secundario"
                                icone={<MoreVertical />}
                                aria-label="Ações da palavra"
                              >
                                Ações
                              </Botao>
                            }
                          >
                            <MenuItem
                              atalho="F2 / Enter"
                              aoSelecionar={() => iniciarEdicao(palavraMenu.palavra)}
                            >
                              Corrigir grafia
                            </MenuItem>
                            <MenuSeparador />
                            <MenuItem
                              aoSelecionar={() =>
                                void executarAcaoPalavra('entrada', frase, palavraMenu.palavra)
                              }
                            >
                              Definir Entrada aqui
                            </MenuItem>
                            <MenuItem
                              aoSelecionar={() =>
                                void executarAcaoPalavra('saida', frase, palavraMenu.palavra)
                              }
                            >
                              Definir Saída aqui
                            </MenuItem>
                            <MenuItem
                              aoSelecionar={() =>
                                void executarAcaoPalavra('legenda', frase, palavraMenu.palavra)
                              }
                            >
                              Personalizar estilo da palavra
                            </MenuItem>
                            <MenuItem
                              aoSelecionar={() =>
                                void executarAcaoPalavra('sfx', frase, palavraMenu.palavra)
                              }
                            >
                              Ancorar SFX nesta palavra
                            </MenuItem>
                          </Menu>
                        </div>
                      )}
                    </article>
                  )
                })
              )}
            </div>
          </AreaRolagem>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Filtros do Índice do Corte */}
          <div
            role="group"
            aria-label="Filtros do Índice"
            className="flex shrink-0 flex-wrap gap-1 border-b border-linha px-3 py-2"
          >
            {FILTROS_INDICE.map((f) => {
              const ativo = filtroIndice === f.id
              return (
                <Botao
                  key={f.id}
                  tamanho="p"
                  variante={ativo ? 'secundario' : 'fantasma'}
                  aria-pressed={ativo}
                  className={cn(ativo && 'marcado text-t1')}
                  onClick={() => setFiltroIndice(f.id)}
                >
                  {f.rotulo}
                </Botao>
              )
            })}
          </div>

          {itensIndice.length === 0 ? (
            <p className="p-4 text-center text-pequeno text-t3">
              Nenhum item neste filtro do Índice do Corte.
            </p>
          ) : (
            <div
              onKeyDown={tratarTeclaListboxIndice}
              className="flex min-h-0 flex-1 flex-col"
            >
              <ListaVirtual<ItemIndice>
                papel="listbox"
                ariaLabel="Índice do Corte"
                itens={itensIndice}
                total={itensIndice.length}
                alturaItem={76}
                selecionadoId={itemIndiceSel ?? itensIndice[0]?.id ?? null}
                aoSelecionar={(it) => {
                  setItemIndiceSel(it.id)
                }}
                className="flex-1 px-2 py-1.5"
                renderizarItem={(it, _indice, selecionado) => (
                  <div
                    className={cn(
                      'flex flex-col gap-1 rounded-controle px-2.5 py-2 text-pequeno transition-colors',
                      selecionado ? 'marcado bg-elevado text-t1' : 'text-t2 hover:bg-elevado/60',
                    )}
                  >
                    {it.categoria === 'frases' && (
                      <>
                        <div className="flex items-center gap-2">
                          <Status tom={it.fora ? 'neutro' : 'info'} icone={<MessageSquareText className="size-[13px]" aria-hidden />}>
                            Frase {it.frase.id}
                          </Status>
                          <span className="num text-micro text-t3">{tc(it.timeUs)}</span>
                          <div className="ml-auto flex items-center gap-1">
                            <Botao
                              tamanho="p"
                              variante="suave"
                              onClick={(e) => {
                                e.stopPropagation()
                                aoMudarTempoUs?.(it.timeUs)
                              }}
                            >
                              Ir
                            </Botao>
                            <Botao
                              tamanho="p"
                              variante="suave"
                              onClick={(e) => {
                                e.stopPropagation()
                                void store.ajustarBorda({
                                  edge: 'start',
                                  sentenceId: it.frase.id,
                                  preview: false,
                                })
                              }}
                            >
                              Entrada
                            </Botao>
                            <Botao
                              tamanho="p"
                              variante="suave"
                              onClick={(e) => {
                                e.stopPropagation()
                                void store.ajustarBorda({
                                  edge: 'end',
                                  sentenceId: it.frase.id,
                                  preview: false,
                                })
                              }}
                            >
                              Saída
                            </Botao>
                          </div>
                        </div>
                        <p className="truncate text-t2">{it.frase.text}</p>
                      </>
                    )}

                    {it.categoria === 'silencios' && (
                      <>
                        <div className="flex items-center gap-2">
                          <Status tom="neutro" icone={<VolumeX className="size-[13px]" aria-hidden />}>
                            Silêncio · {it.silencio.status === 'active' ? 'removida' : 'mantida'}
                          </Status>
                          <span className="num text-micro text-t3">
                            {tc(it.timeUs)} · {formatarSegundos(it.silencio.endUs - it.silencio.startUs)} s
                          </span>
                          <div className="ml-auto flex items-center gap-1">
                            <Botao
                              tamanho="p"
                              variante="suave"
                              onClick={(e) => {
                                e.stopPropagation()
                                const inicio = Math.max(0, it.timeUs - 1_500_000)
                                if (aoOuvirEmContexto) aoOuvirEmContexto(inicio)
                                else aoMudarTempoUs?.(inicio)
                              }}
                            >
                              Ouvir
                            </Botao>
                            <Botao
                              tamanho="p"
                              variante="suave"
                              onClick={(e) => {
                                e.stopPropagation()
                                void store.alternarSilencio(it.silencio.id)
                              }}
                            >
                              {it.silencio.status === 'active' ? 'Manter pausa' : 'Remover pausa'}
                            </Botao>
                          </div>
                        </div>
                      </>
                    )}

                    {it.categoria === 'enquadramento' && (
                      <>
                        <div className="flex items-center gap-2">
                          <Status
                            tom="neutro"
                            icone={
                              it.keyframe.cut ? (
                                <Scissors className="size-[13px]" aria-hidden />
                              ) : (
                                <Diamond className="size-[13px]" aria-hidden />
                              )
                            }
                          >
                            Keyframe · {it.painel === 'primary' ? 'Principal' : it.painel === 'top' ? 'Topo' : 'Base'}
                          </Status>
                          <span className="num text-micro text-t3">{tc(it.timeUs)}</span>
                          <div className="ml-auto flex items-center gap-1">
                            <Botao
                              tamanho="p"
                              variante="suave"
                              aria-pressed={Boolean(it.keyframe.cut)}
                              onClick={(e) => {
                                e.stopPropagation()
                                void alternarCutKeyframe(it)
                              }}
                            >
                              Corte seco
                            </Botao>
                            <Botao
                              tamanho="p"
                              variante="suave"
                              onClick={(e) => {
                                e.stopPropagation()
                                void removerKeyframe(it)
                              }}
                            >
                              Remover
                            </Botao>
                          </div>
                        </div>
                        <p className="num truncate text-micro text-t3">
                          x: {it.keyframe.x.toFixed(2)} · y: {it.keyframe.y.toFixed(2)} · w:{' '}
                          {it.keyframe.width.toFixed(2)} · h: {it.keyframe.height.toFixed(2)}
                        </p>
                      </>
                    )}

                    {it.categoria === 'narracao' && (
                      <>
                        <div className="flex items-center gap-2">
                          <Status tom="neutro" icone={<Mic className="size-[13px]" aria-hidden />}>
                            Narração · Bloco {it.position}
                          </Status>
                          <span className="num text-micro text-t3">
                            {tc(it.timeUs)} · {formatarSegundos(it.durationUs)} s
                          </span>
                          <div className="ml-auto flex items-center gap-1">
                            <Botao
                              tamanho="p"
                              variante="suave"
                              onClick={(e) => {
                                e.stopPropagation()
                                void store.definirInicioNarracao(
                                  it.blockId,
                                  Math.max(0, it.timeUs - 1_000_000),
                                  false,
                                  false,
                                )
                              }}
                            >
                              −1F
                            </Botao>
                            <Botao
                              tamanho="p"
                              variante="suave"
                              onClick={(e) => {
                                e.stopPropagation()
                                void store.definirInicioNarracao(
                                  it.blockId,
                                  it.timeUs + 1_000_000,
                                  false,
                                  false,
                                )
                              }}
                            >
                              +1F
                            </Botao>
                            <Botao
                              tamanho="p"
                              variante="suave"
                              onClick={(e) => {
                                e.stopPropagation()
                                void store.definirInicioNarracao(it.blockId, null, false, false)
                              }}
                            >
                              Automático
                            </Botao>
                          </div>
                        </div>
                        <p className="truncate text-t2">
                          {it.title}
                          {it.pushedUs > 0
                            ? ` (empurrado +${formatarSegundos(it.pushedUs)} s)`
                            : ''}
                        </p>
                      </>
                    )}

                    {it.categoria === 'audio' && (
                      <>
                        <div className="flex items-center gap-2">
                          <Status tom="neutro" icone={<FileAudio className="size-[13px]" aria-hidden />}>
                            {it.subtipo === 'trilha' ? 'Trilha' : 'SFX'} · {it.titulo}
                          </Status>
                          <span className="num text-micro text-t3">{tc(it.timeUs)}</span>
                          <div className="ml-auto flex items-center gap-1">
                            <Botao
                              tamanho="p"
                              variante="suave"
                              onClick={(e) => {
                                e.stopPropagation()
                                aoMudarTempoUs?.(it.timeUs)
                              }}
                            >
                              Ir
                            </Botao>
                            <Botao
                              tamanho="p"
                              variante="suave"
                              onClick={(e) => {
                                e.stopPropagation()
                                if (it.subtipo === 'trilha') {
                                  void store.limparTrilhaSonora(false)
                                } else if (typeof it.sfxId === 'number') {
                                  void store.removerSfx(it.sfxId, false)
                                }
                              }}
                            >
                              Remover
                            </Botao>
                          </div>
                        </div>
                        <p className="truncate text-micro text-t3">{it.detalhe}</p>
                      </>
                    )}
                  </div>
                )}
              />
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
