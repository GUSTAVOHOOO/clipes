import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { chamar, paraErroCore, type ErroCore } from '~/core/cliente'
import { useFila, type EventoProgresso, type Fila, type Job } from '~/core/progresso'

export type PermissaoFonte =
  | { status: 'none' }
  | { status: 'granted'; who: string; where: string; scope: string }

export type StreamMetadata = {
  index: number
  codec_type: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  tags?: { title?: string; language?: string }
}

export type FonteProjeto = {
  id: number
  path: string
  status: 'available' | 'offline' | 'changed'
  available: boolean
  verified: boolean
  audio_track: number
  origin_url: string | null
  language: string
  permission: PermissaoFonte
  metadata?: {
    format?: { duration?: string }
    streams?: StreamMetadata[]
  }
}

export type TranscriptInfo = {
  id: number
  state: 'running' | 'complete'
  resume_us: number
  duration_us: number
  model?: string | null
  engine: 'local' | 'groq'
  words: number
}

export type TranscriptJobInfo = {
  id: number
  state: 'queued' | 'running' | 'uncertain' | 'completed' | 'cancelled' | 'failed'
  progress: number
  code?: string | null
}

export type TranscriptStatusFonte = {
  language: string | null
  transcript: TranscriptInfo | null
  job: TranscriptJobInfo | null
}

export type LoteItem = {
  position: number
  sourceId: number
  name: string
  state: 'pending' | 'transcribing' | 'selecting' | 'completed' | 'paused' | 'cancelled'
  error: string | null
  resetAtMs?: number | null
  progress: number | null
  transcriptionJob: number | null
  selectionRun: number | null
  engine?: string
}

export type LoteFontes = {
  id: number
  key: string
  state: 'running' | 'paused' | 'completed' | 'cancelled'
  status: 'running' | 'paused' | 'budget_paused' | 'attention' | 'completed' | 'cancelled'
  engine: 'local' | 'groq' | string
  videoKind: 'direct' | 'transformed' | string
  minUs: number | null
  maxUs: number | null
  pause: string | null
  budget: {
    scope: string
    key: string
    maxCostMicroUsd: number | null
    unknownConfirmed?: boolean
    paused: string | null
    usage?: {
      microUsd: number
      audioMicroUsd?: number
      unknownCostCalls?: number
      costLabel: string | null
    }
  } | null
  counts: {
    total: number
    completed: number
    paused: number
    active: number
    pending: number
    cancelled: number
  }
  items: LoteItem[]
}

export type InvalidacoesFontes = {
  transcricao: number
  energia: number
  chat: number
  preview: number
  lotes: number
}

export type EstadoFontesProjeto = {
  projetoPath: string | null
  fontes: FonteProjeto[]
  carregando: boolean
  carregandoLotes: boolean
  erro: ErroCore | null
  erroLotes: ErroCore | null
  transcriptStatusBySource: Record<number, TranscriptStatusFonte>
  lotes: LoteFontes[]
  selecionadasParaLote: number[]
  copiaEmAndamento: boolean
  invalidacoes: InvalidacoesFontes
}

export type StoreFontesProjeto = {
  estado: () => EstadoFontesProjeto
  assinar: (fn: () => void) => () => void
  definirProjeto: (projetoPath: string | null) => Promise<void>
  recarregarFontes: () => Promise<FonteProjeto[]>
  recarregarFonte: (id: number) => Promise<void>
  recarregarLotes: () => Promise<LoteFontes[]>
  definirSelecionadasParaLote: (ids: number[]) => void
  definirCopiaEmAndamento: (ativo: boolean) => void
  aplicarEventoProgresso: (evento: EventoProgresso) => Promise<void>
  sincronizarJobs: (jobs: Job[]) => Promise<void>
}

function estadoInicial(projetoPath: string | null): EstadoFontesProjeto {
  return {
    projetoPath,
    fontes: [],
    carregando: Boolean(projetoPath),
    carregandoLotes: Boolean(projetoPath),
    erro: null,
    erroLotes: null,
    transcriptStatusBySource: {},
    lotes: [],
    selecionadasParaLote: [],
    copiaEmAndamento: false,
    invalidacoes: {
      transcricao: 0,
      energia: 0,
      chat: 0,
      preview: 0,
      lotes: 0,
    },
  }
}

/** Cria um store reativo em memória para Fontes, status de Transcrição (#302) e Lotes do Projeto. */
export function criarStoreFontesProjeto(): StoreFontesProjeto {
  let atual: EstadoFontesProjeto = estadoInicial(null)
  let seqProjeto = 0
  const ouvintes = new Set<() => void>()
  const jobsVistos = new Map<string, { estado: Job['estado']; etapa: string; percentual: number }>()

  function publicar(proximo: EstadoFontesProjeto) {
    atual = proximo
    for (const fn of ouvintes) {
      fn()
    }
  }

  function atualizar(patch: Partial<EstadoFontesProjeto>) {
    publicar({ ...atual, ...patch })
  }

  async function carregarStatusTranscricao(sourceId: number, seqEsperado: number): Promise<void> {
    try {
      const status = await chamar<TranscriptStatusFonte>('transcription.status', {
        source_id: sourceId,
      })
      if (seqEsperado !== seqProjeto || !atual.projetoPath) return
      atualizar({
        transcriptStatusBySource: {
          ...atual.transcriptStatusBySource,
          [sourceId]: status,
        },
      })
    } catch {
      // Silencia falha pontual de consulta individual para não derrubar a lista inteira
    }
  }

  async function recarregarFontes(): Promise<FonteProjeto[]> {
    const caminho = atual.projetoPath
    if (!caminho) return []
    const seq = seqProjeto
    atualizar({ carregando: true, erro: null })

    try {
      const lista = await chamar<FonteProjeto[]>('sources.list', { project: caminho })
      if (seq !== seqProjeto || atual.projetoPath !== caminho) return []

      const fontes = Array.isArray(lista) ? lista : []
      const idsValidos = new Set(fontes.map((f) => f.id))
      const selecionadasFiltradas = atual.selecionadasParaLote.filter((id) => idsValidos.has(id))

      atualizar({
        fontes,
        carregando: false,
        erro: null,
        selecionadasParaLote: selecionadasFiltradas,
      })

      await Promise.all(fontes.map((f) => carregarStatusTranscricao(f.id, seq)))
      return fontes
    } catch (err) {
      if (seq !== seqProjeto || atual.projetoPath !== caminho) return []
      atualizar({ carregando: false, erro: paraErroCore(err) })
      return []
    }
  }

  async function recarregarLotes(): Promise<LoteFontes[]> {
    const caminho = atual.projetoPath
    if (!caminho) return []
    const seq = seqProjeto
    atualizar({ carregandoLotes: true, erroLotes: null })

    try {
      const lista = await chamar<LoteFontes[]>('batches.list', {})
      if (seq !== seqProjeto || atual.projetoPath !== caminho) return []
      const lotes = Array.isArray(lista) ? lista : []
      atualizar({ lotes, carregandoLotes: false, erroLotes: null })
      return lotes
    } catch (err) {
      if (seq !== seqProjeto || atual.projetoPath !== caminho) return []
      atualizar({ carregandoLotes: false, erroLotes: paraErroCore(err) })
      return []
    }
  }

  async function recarregarFonte(id: number): Promise<void> {
    const caminho = atual.projetoPath
    if (!caminho) return
    const seq = seqProjeto
    try {
      const lista = await chamar<FonteProjeto[]>('sources.list', { project: caminho })
      if (seq !== seqProjeto || atual.projetoPath !== caminho) return
      const fontes = Array.isArray(lista) ? lista : []
      atualizar({ fontes, erro: null })
      await carregarStatusTranscricao(id, seq)
    } catch (err) {
      if (seq !== seqProjeto || atual.projetoPath !== caminho) return
      atualizar({ erro: paraErroCore(err) })
    }
  }

  async function definirProjeto(projetoPath: string | null): Promise<void> {
    if (projetoPath === atual.projetoPath) return
    seqProjeto += 1
    jobsVistos.clear()
    publicar(estadoInicial(projetoPath))

    if (!projetoPath) return
    await Promise.all([recarregarFontes(), recarregarLotes()])
  }

  function definirSelecionadasParaLote(ids: number[]): void {
    const unicos = Array.from(new Set(ids.filter((id) => Number.isInteger(id))))
    atualizar({ selecionadasParaLote: unicos })
  }

  function definirCopiaEmAndamento(ativo: boolean): void {
    if (atual.copiaEmAndamento === ativo) return
    atualizar({ copiaEmAndamento: ativo })
  }

  async function aplicarEventoProgresso(evento: EventoProgresso): Promise<void> {
    if (!atual.projetoPath) return
    const seq = seqProjeto

    if (evento.job === 'source-copy-original' || evento.job === 'source-copy-check') {
      const terminou =
        Boolean(evento.error) ||
        evento.stage === 'failed' ||
        (evento.job === 'source-copy-check' && evento.percentage >= 100)
      atualizar({ copiaEmAndamento: !terminou && evento.stage === 'hash' })
      if (terminou) {
        await recarregarFontes()
      }
      return
    }

    if (evento.job.startsWith('batch-') || evento.stage.startsWith('batch:')) {
      atualizar({
        invalidacoes: { ...atual.invalidacoes, lotes: atual.invalidacoes.lotes + 1 },
      })
      await recarregarLotes()
      return
    }

    if (evento.stage === 'energy') {
      atualizar({
        invalidacoes: { ...atual.invalidacoes, energia: atual.invalidacoes.energia + 1 },
      })
      return
    }

    if (evento.stage === 'chat') {
      atualizar({
        invalidacoes: { ...atual.invalidacoes, chat: atual.invalidacoes.chat + 1 },
      })
      return
    }

    if (evento.stage === 'waveform' || evento.stage === 'thumbnails') {
      atualizar({
        invalidacoes: { ...atual.invalidacoes, preview: atual.invalidacoes.preview + 1 },
      })
      return
    }

    if (evento.stage === 'complete' || evento.stage === 'failed') {
      const jobNum = Number(evento.job)
      const fontesAfetadas = new Set<number>()

      if (Number.isFinite(jobNum) && jobNum > 0) {
        for (const [sidStr, status] of Object.entries(atual.transcriptStatusBySource)) {
          if (status?.job?.id === jobNum) {
            fontesAfetadas.add(Number(sidStr))
          }
        }
        for (const lote of atual.lotes) {
          for (const item of lote.items) {
            if (item.transcriptionJob === jobNum) {
              fontesAfetadas.add(item.sourceId)
            }
          }
        }
      }

      const msgLower = (evento.message || '').toLowerCase()
      const pareceEnergia = msgLower.includes('energia')
      const pareceChat = msgLower.includes('chat')
      const parecePreview = msgLower.includes('prévia') || msgLower.includes('preview') || msgLower.includes('onda')

      if (pareceEnergia) {
        atualizar({
          invalidacoes: { ...atual.invalidacoes, energia: atual.invalidacoes.energia + 1 },
        })
      }
      if (pareceChat) {
        atualizar({
          invalidacoes: { ...atual.invalidacoes, chat: atual.invalidacoes.chat + 1 },
        })
      }
      if (parecePreview) {
        atualizar({
          invalidacoes: { ...atual.invalidacoes, preview: atual.invalidacoes.preview + 1 },
        })
      }

      if (fontesAfetadas.size > 0 || (!pareceEnergia && !pareceChat && !parecePreview)) {
        atualizar({
          invalidacoes: { ...atual.invalidacoes, transcricao: atual.invalidacoes.transcricao + 1 },
        })
        const alvos = fontesAfetadas.size > 0 ? Array.from(fontesAfetadas) : atual.fontes.map((f) => f.id)
        await Promise.all(alvos.map((sid) => carregarStatusTranscricao(sid, seq)))
      }
    }
  }

  async function sincronizarJobs(jobs: Job[]): Promise<void> {
    if (!atual.projetoPath) return

    const alterados: Job[] = []
    for (const j of jobs) {
      const prev = jobsVistos.get(j.id)
      if (!prev || prev.estado !== j.estado || prev.etapa !== j.etapa || prev.percentual !== j.percentual) {
        jobsVistos.set(j.id, { estado: j.estado, etapa: j.etapa, percentual: j.percentual })
        alterados.push(j)
      }
    }

    for (const j of alterados) {
      await aplicarEventoProgresso({
        job: j.id,
        project: null,
        stage: j.etapa,
        percentage: j.percentual,
        message: j.mensagem,
        error: j.erro ?? null,
      })
    }
  }

  return {
    estado: () => atual,
    assinar: (fn) => {
      ouvintes.add(fn)
      return () => {
        ouvintes.delete(fn)
      }
    },
    definirProjeto,
    recarregarFontes,
    recarregarFonte,
    recarregarLotes,
    definirSelecionadasParaLote,
    definirCopiaEmAndamento,
    aplicarEventoProgresso,
    sincronizarJobs,
  }
}

export const storeFontesProjeto = criarStoreFontesProjeto()

export type ResultadoUseFontesProjeto = EstadoFontesProjeto & {
  recarregarFontes: () => Promise<FonteProjeto[]>
  recarregarFonte: (id: number) => Promise<void>
  recarregarLotes: () => Promise<LoteFontes[]>
  definirSelecionadasParaLote: (ids: number[]) => void
  definirCopiaEmAndamento: (ativo: boolean) => void
}

/** Hook reativo para consumir o cache de Fontes, Transcrições (#302) e Lotes do Projeto ativo. */
export function useFontesProjeto(
  projetoPath: string | null,
  opcoes?: { store?: StoreFontesProjeto; fila?: Fila },
): ResultadoUseFontesProjeto {
  const store = opcoes?.store ?? storeFontesProjeto
  const estado = useSyncExternalStore(store.assinar, store.estado, store.estado)
  const jobs = useFila(opcoes?.fila)
  const projetoAnteriorRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (projetoAnteriorRef.current === projetoPath) return
    projetoAnteriorRef.current = projetoPath
    void store.definirProjeto(projetoPath)
  }, [projetoPath, store])

  useEffect(() => {
    if (!projetoPath || jobs.length === 0) return
    void store.sincronizarJobs(jobs)
  }, [jobs, projetoPath, store])

  return useMemo(
    () => ({
      ...estado,
      recarregarFontes: store.recarregarFontes,
      recarregarFonte: store.recarregarFonte,
      recarregarLotes: store.recarregarLotes,
      definirSelecionadasParaLote: store.definirSelecionadasParaLote,
      definirCopiaEmAndamento: store.definirCopiaEmAndamento,
    }),
    [estado, store],
  )
}
