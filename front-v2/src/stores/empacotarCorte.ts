import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { contarBytesUtf8 } from '~/componentes/ContadorLimite'
import { chamar, paraErroCore, type ErroCore } from '~/core/cliente'
import { useFila, type Fila, type Job } from '~/core/progresso'
import {
  resolverDestinoSelecao,
  type DestinoSelecao,
  type PerfilProvedorLista,
  type RespostaTarefasAssistente,
} from '~/stores/selecaoProjeto'
import type { OrcamentoJobs } from '~/stores/transformarCorte'

export interface CapaDoc {
  current: { instantUs: number; origin: 'ai' | 'user'; prompt?: string | null } | null
  history: Array<{ instantUs: number; origin: 'ai' | 'user' }>
  job: { id: number; state: string; code: string | null } | null
}

export interface EmpacotamentoDoc {
  schemaVersion: number
  revision: number
  detectedLanguage: string | null
  languageRequired: boolean
  current: {
    generation: number
    language: string
    edited: boolean
    title: string
    description: string
    tags: string[]
    hashtags: string[]
    fullDescription: string
  } | null
  credit: { text: string | null; warning: string | null }
  chapters: {
    applicable: boolean
    status: string
    canGenerate: boolean
    count: number
    block: string | null
    hasDelimiters: boolean
    generationWarning: { code: string; message: string } | null
    validationErrors: Array<{ code: string; message: string }>
  }
  job: { id: number; state: string; code: string | null; violations?: unknown[] } | null
  limits: {
    titleChars: number
    descriptionBytes: number
    creditBytes: number
    maxTags: number
    tagChars: number
    tagTotalChars: number
    maxHashtags: number
    hashtagChars: number
  }
  source: unknown
  generations: unknown[]
}

export interface GuardrailsDoc {
  blockers: Array<{ code: string; message: string }>
  warnings: Array<{ code: string; message: string }>
  permissionOk?: boolean
}

export interface ProxyDoc {
  job: number | null
  state: 'idle' | 'queued' | 'running' | 'ready' | 'failed'
  progress: number
  proxyPath: string | null
  error?: { code: string; message: string } | null
}

export interface RascunhoEmpacotamento {
  title: string
  description: string
  tags: string[]
  hashtags: string[]
}

export interface ErroValidacaoCapitulo {
  codigo:
    | 'chapter_format_invalid'
    | 'chapter_first_not_zero'
    | 'too_few_chapters'
    | 'chapter_out_of_order'
    | 'chapter_too_short'
    | 'chapter_past_end'
    | 'chapter_delimiters_missing'
  linha?: number
  mensagem: string
}

export interface FonteEmpacotar {
  id: number
  disponivel: boolean
  startUs?: number
  endUs?: number
}

export interface EstadoEmpacotarCorte {
  candidateId: number | null
  carregando: boolean
  erro: ErroCore | null
  capa: CapaDoc | null
  empacotamento: EmpacotamentoDoc | null
  guardrails: GuardrailsDoc | null
  proxy: ProxyDoc | null
  perfis: PerfilProvedorLista[]
  tarefas: RespostaTarefasAssistente | null
  orcamento: OrcamentoJobs | null
  rascunho: RascunhoEmpacotamento | null
  sujo: boolean
  conflitoRemoto: boolean
  remotoPendente: EmpacotamentoDoc | null
}

export interface StoreEmpacotarCorte {
  assinar: (listener: () => void) => () => void
  obterSnapshot: () => EstadoEmpacotarCorte
  definirCandidato: (candidateId: number | null) => void
  carregarTudo: (candidateId: number, fonte?: FonteEmpacotar | null, opcoes?: { silencioso?: boolean }) => Promise<void>
  solicitarProxy: (fonte: FonteEmpacotar) => Promise<void>
  recarregarCapa: (candidateId?: number) => Promise<void>
  recarregarEmpacotamento: (candidateId?: number) => Promise<void>
  recarregarGuardrails: (candidateId?: number) => Promise<void>
  editarRascunho: (parcial: Partial<RascunhoEmpacotamento>) => void
  marcarSalvo: (atualizado?: EmpacotamentoDoc) => void
  aceitarRemoto: () => void
  manterRascunho: () => void
  sincronizarJobs: (jobs: readonly Job[], fonte?: FonteEmpacotar | null) => void
}

/** Calcula os bytes UTF-8 reais da descrição somados aos bytes do bloco de crédito obrigatório. */
export function calcularBytesDescricao(description: string, creditBytes: number): number {
  return contarBytesUtf8(description) + Math.max(0, creditBytes)
}

/**
 * Valida capítulos do YouTube em tempo real a partir da descrição:
 * formato `MM:SS` / `H:MM:SS`, início em `00:00`, mínimo de 3 capítulos,
 * ordem crescente, duração >= 10 s entre segmentos e limite dentro do Corte.
 */
export function validarCapitulosTempoReal(
  description: string,
  cutDurationUs: number | null,
  opcoes?: { exigirSeDelimitadores?: boolean },
): ErroValidacaoCapitulo[] {
  const temInicio = description.includes('<!-- clipes:chapters:start -->')
  const temFim = description.includes('<!-- clipes:chapters:end -->')
  if (temInicio !== temFim) {
    return [
      {
        codigo: 'chapter_delimiters_missing',
        mensagem: 'Os delimitadores de capítulos automáticos estão incompletos na descrição.',
      },
    ]
  }

  let textoCapitulos = description
  if (temInicio && temFim) {
    const ini = description.indexOf('<!-- clipes:chapters:start -->')
    const fim = description.indexOf('<!-- clipes:chapters:end -->')
    textoCapitulos = description.slice(ini, fim)
  } else if (opcoes?.exigirSeDelimitadores) {
    return []
  }

  const linhas = textoCapitulos.split(/\r?\n/)
  const entradas: Array<{ linha: number; tempoUs: number }> = []
  const erros: ErroValidacaoCapitulo[] = []

  const rxValido = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+\S.*$/
  const rxSuspeitoTempo = /^\s*\d+(?::\d*)?(?:\s|$)/

  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i].trim()
    if (!linha || linha.startsWith('<!--')) continue
    const match = linha.match(rxValido)
    if (!match) {
      if (rxSuspeitoTempo.test(linha)) {
        erros.push({
          codigo: 'chapter_format_invalid',
          linha: i + 1,
          mensagem: `Linha ${i + 1}: use MM:SS ou H:MM:SS seguido de um título.`,
        })
      }
      continue
    }
    const horas = match[1] ? Number(match[1]) : 0
    const minutos = Number(match[2])
    const segundos = Number(match[3])
    if (minutos >= 60 || segundos >= 60) {
      erros.push({
        codigo: 'chapter_format_invalid',
        linha: i + 1,
        mensagem: `Linha ${i + 1}: minutos e segundos precisam ser menores que 60.`,
      })
      continue
    }
    const tempoUs = (horas * 3600 + minutos * 60 + segundos) * 1_000_000
    entradas.push({ linha: i + 1, tempoUs })
  }

  if (entradas.length === 0) {
    return erros
  }

  if (entradas[0].tempoUs !== 0) {
    erros.push({
      codigo: 'chapter_first_not_zero',
      linha: entradas[0].linha,
      mensagem: 'O primeiro capítulo precisa começar em 00:00.',
    })
  }

  if (entradas.length < 3) {
    erros.push({
      codigo: 'too_few_chapters',
      mensagem: 'O YouTube exige pelo menos 3 capítulos.',
    })
  }

  for (let i = 1; i < entradas.length; i += 1) {
    const anterior = entradas[i - 1]
    const atual = entradas[i]
    if (atual.tempoUs <= anterior.tempoUs) {
      erros.push({
        codigo: 'chapter_out_of_order',
        linha: atual.linha,
        mensagem: `Linha ${atual.linha}: capítulo precisa estar em ordem crescente.`,
      })
      continue
    }
    if (atual.tempoUs - anterior.tempoUs < 10_000_000) {
      erros.push({
        codigo: 'chapter_too_short',
        linha: anterior.linha,
        mensagem: `Linha ${anterior.linha}: cada capítulo precisa ter ao menos 10 s.`,
      })
    }
  }

  if (cutDurationUs != null && cutDurationUs > 0) {
    const ultimo = entradas[entradas.length - 1]
    if (ultimo.tempoUs >= cutDurationUs) {
      erros.push({
        codigo: 'chapter_past_end',
        linha: ultimo.linha,
        mensagem: `Linha ${ultimo.linha}: capítulo ultrapassa a duração do Corte.`,
      })
    } else if (cutDurationUs - ultimo.tempoUs < 10_000_000) {
      erros.push({
        codigo: 'chapter_too_short',
        linha: ultimo.linha,
        mensagem: `Linha ${ultimo.linha}: o último capítulo precisa durar ao menos 10 s até o fim do Corte.`,
      })
    }
  }

  return erros
}

/** Resolve o destino de rede e privacidade para a tarefa `packaging`. */
export function resolverDestinoEmpacotar(
  profileIdOrName: string | null | undefined,
  perfis: readonly PerfilProvedorLista[],
  tarefas?: RespostaTarefasAssistente | null,
): DestinoSelecao {
  const tarefasAdaptadas = tarefas
    ? {
        ...tarefas,
        tasks: tarefas.tasks.map((t) => ({
          ...t,
          task: t.task === 'packaging' ? 'selection' : t.task === 'selection' ? '_selection' : t.task,
        })),
      }
    : tarefas
  return resolverDestinoSelecao(profileIdOrName, perfis, tarefasAdaptadas)
}

function paraRascunho(doc: EmpacotamentoDoc | null): RascunhoEmpacotamento | null {
  if (!doc?.current) return null
  return {
    title: doc.current.title,
    description: doc.current.description,
    tags: [...doc.current.tags],
    hashtags: [...doc.current.hashtags],
  }
}

function estadoInicial(candidateId: number | null = null): EstadoEmpacotarCorte {
  return {
    candidateId,
    carregando: false,
    erro: null,
    capa: null,
    empacotamento: null,
    guardrails: null,
    proxy: null,
    perfis: [],
    tarefas: null,
    orcamento: null,
    rascunho: null,
    sujo: false,
    conflitoRemoto: false,
    remotoPendente: null,
  }
}

/** Cria uma instância isolada da store reativa de `Empacotar`. */
export function criarStoreEmpacotarCorte(): StoreEmpacotarCorte {
  let estado = estadoInicial(null)
  const ouvintes = new Set<() => void>()
  const assinaturaJobs = new Map<string, string>()
  let versao = 0

  const notificar = () => {
    for (const listener of ouvintes) listener()
  }

  const definirCandidato = (candidateId: number | null) => {
    if (estado.candidateId === candidateId) return
    versao += 1
    assinaturaJobs.clear()
    estado = estadoInicial(candidateId)
    notificar()
  }

  const aplicarEmpacotamentoRemoto = (doc: EmpacotamentoDoc) => {
    if (estado.sujo) {
      estado = {
        ...estado,
        empacotamento: doc,
        remotoPendente: doc,
        conflitoRemoto: true,
      }
      notificar()
      return
    }
    estado = {
      ...estado,
      empacotamento: doc,
      rascunho: paraRascunho(doc),
      sujo: false,
      conflitoRemoto: false,
      remotoPendente: null,
    }
    notificar()
  }

  const carregarTudo = async (
    candidateId: number,
    fonte?: FonteEmpacotar | null,
    opcoes?: { silencioso?: boolean },
  ) => {
    const reqVersao = ++versao
    if (!opcoes?.silencioso) {
      estado = { ...estado, candidateId, carregando: true, erro: null }
      notificar()
    }
    try {
      const proxyArgs =
        fonte?.disponivel && fonte.id != null
          ? {
              source_id: fonte.id,
              ...(fonte.startUs != null ? { start_us: fonte.startUs } : {}),
              ...(fonte.endUs != null ? { end_us: fonte.endUs } : {}),
            }
          : null
      const proxyPromise = proxyArgs
        ? chamar<ProxyDoc>('proxy.request', proxyArgs).catch(() => null)
        : Promise.resolve(null)

      const [capa, empacotamento, guardrails, perfisResp, tarefas, orcamento, proxy] =
        await Promise.all([
          chamar<CapaDoc>('thumbnail.get', { candidate: candidateId }),
          chamar<EmpacotamentoDoc>('packaging.get', { candidate: candidateId }),
          chamar<GuardrailsDoc>('guardrails.check', { candidate_id: candidateId, scope: 'single' }),
          chamar<{ profiles: PerfilProvedorLista[] }>('provider.profiles.list', {}),
          chamar<RespostaTarefasAssistente>('assistant.tasks', {}),
          chamar<OrcamentoJobs>('jobs.budget.get', {}),
          proxyPromise,
        ])

      if (reqVersao !== versao || estado.candidateId !== candidateId) return

      estado = {
        ...estado,
        candidateId,
        carregando: false,
        erro: null,
        capa,
        guardrails,
        proxy: proxy ?? estado.proxy,
        perfis: perfisResp.profiles ?? [],
        tarefas,
        orcamento,
      }
      aplicarEmpacotamentoRemoto(empacotamento)
    } catch (e) {
      if (reqVersao !== versao || estado.candidateId !== candidateId) return
      estado = { ...estado, carregando: false, erro: paraErroCore(e) }
      notificar()
    }
  }

  const solicitarProxy = async (fonte: FonteEmpacotar) => {
    const reqVersao = versao
    try {
      const proxy = await chamar<ProxyDoc>('proxy.request', {
        source_id: fonte.id,
        ...(fonte.startUs != null ? { start_us: fonte.startUs } : {}),
        ...(fonte.endUs != null ? { end_us: fonte.endUs } : {}),
      })
      if (reqVersao !== versao) return
      estado = { ...estado, proxy }
      notificar()
    } catch {
      // Proxy ausente não bloqueia edição textual de Empacotar
    }
  }

  const recarregarCapa = async (candidateId = estado.candidateId ?? undefined) => {
    if (candidateId == null || candidateId !== estado.candidateId) return
    const reqVersao = versao
    try {
      const [capa, guardrails] = await Promise.all([
        chamar<CapaDoc>('thumbnail.get', { candidate: candidateId }),
        chamar<GuardrailsDoc>('guardrails.check', { candidate_id: candidateId, scope: 'single' }),
      ])
      if (reqVersao !== versao || estado.candidateId !== candidateId) return
      estado = { ...estado, capa, guardrails }
      notificar()
    } catch (e) {
      if (reqVersao !== versao) return
      estado = { ...estado, erro: paraErroCore(e) }
      notificar()
    }
  }

  const recarregarEmpacotamento = async (candidateId = estado.candidateId ?? undefined) => {
    if (candidateId == null || candidateId !== estado.candidateId) return
    const reqVersao = versao
    try {
      const [empacotamento, guardrails] = await Promise.all([
        chamar<EmpacotamentoDoc>('packaging.get', { candidate: candidateId }),
        chamar<GuardrailsDoc>('guardrails.check', { candidate_id: candidateId, scope: 'single' }),
      ])
      if (reqVersao !== versao || estado.candidateId !== candidateId) return
      estado = { ...estado, guardrails }
      aplicarEmpacotamentoRemoto(empacotamento)
    } catch (e) {
      if (reqVersao !== versao) return
      estado = { ...estado, erro: paraErroCore(e) }
      notificar()
    }
  }

  const recarregarGuardrails = async (candidateId = estado.candidateId ?? undefined) => {
    if (candidateId == null || candidateId !== estado.candidateId) return
    const reqVersao = versao
    try {
      const guardrails = await chamar<GuardrailsDoc>('guardrails.check', {
        candidate_id: candidateId,
        scope: 'single',
      })
      if (reqVersao !== versao || estado.candidateId !== candidateId) return
      estado = { ...estado, guardrails }
      notificar()
    } catch {
      // ignora erro secundário de revalidação
    }
  }

  const editarRascunho = (parcial: Partial<RascunhoEmpacotamento>) => {
    const base = estado.rascunho ?? { title: '', description: '', tags: [], hashtags: [] }
    estado = {
      ...estado,
      rascunho: { ...base, ...parcial },
      sujo: true,
    }
    notificar()
  }

  const marcarSalvo = (atualizado?: EmpacotamentoDoc) => {
    if (atualizado) {
      estado = {
        ...estado,
        empacotamento: atualizado,
        rascunho: paraRascunho(atualizado),
        sujo: false,
        conflitoRemoto: false,
        remotoPendente: null,
      }
    } else {
      estado = {
        ...estado,
        sujo: false,
        conflitoRemoto: false,
        remotoPendente: null,
      }
    }
    notificar()
  }

  const aceitarRemoto = () => {
    const remoto = estado.remotoPendente ?? estado.empacotamento
    estado = {
      ...estado,
      rascunho: paraRascunho(remoto),
      sujo: false,
      conflitoRemoto: false,
      remotoPendente: null,
    }
    notificar()
  }

  const manterRascunho = () => {
    estado = {
      ...estado,
      conflitoRemoto: false,
      remotoPendente: null,
    }
    notificar()
  }

  const sincronizarJobs = (jobs: readonly Job[], fonte?: FonteEmpacotar | null) => {
    if (estado.candidateId == null) return
    let recCapa = false
    let recPack = false
    let recProxy = false
    let recGuard = false

    for (const job of jobs) {
      const assinatura = `${job.etapa}:${job.estado}:${job.percentual}`
      if (assinaturaJobs.get(job.id) === assinatura) continue
      assinaturaJobs.set(job.id, assinatura)

      const concluiuOuFalhou =
        job.estado === 'concluido' ||
        job.estado === 'falhou' ||
        job.etapa.endsWith(':done') ||
        job.etapa === 'complete'

      if (!concluiuOuFalhou) continue

      if (job.etapa.startsWith('ai:thumbnail:')) recCapa = true
      else if (job.etapa.startsWith('ai:packaging:')) recPack = true
      else if (job.etapa === 'proxy') recProxy = true
      else if (job.etapa === 'export') recGuard = true
    }

    if (recCapa) void recarregarCapa(estado.candidateId)
    if (recPack) void recarregarEmpacotamento(estado.candidateId)
    if (recProxy && fonte?.disponivel) void solicitarProxy(fonte)
    if (recGuard && !recCapa && !recPack) void recarregarGuardrails(estado.candidateId)
  }

  return {
    assinar: (listener) => {
      ouvintes.add(listener)
      return () => ouvintes.delete(listener)
    },
    obterSnapshot: () => estado,
    definirCandidato,
    carregarTudo,
    solicitarProxy,
    recarregarCapa,
    recarregarEmpacotamento,
    recarregarGuardrails,
    editarRascunho,
    marcarSalvo,
    aceitarRemoto,
    manterRascunho,
    sincronizarJobs,
  }
}

const storesPorFila = new WeakMap<object, StoreEmpacotarCorte>()
const storePadrao = criarStoreEmpacotarCorte()

function obterStore(fila?: Fila): StoreEmpacotarCorte {
  if (!fila) return storePadrao
  let store = storesPorFila.get(fila)
  if (!store) {
    store = criarStoreEmpacotarCorte()
    storesPorFila.set(fila, store)
  }
  return store
}

/**
 * Hook React vinculado ao `candidateId` e à `fonte` em `Empacotar`:
 * carrega capa, empacotamento, guardrails e proxy (quando a Fonte está disponível),
 * mantém rascunho/sujo com resolução de conflito e expõe cálculo de bytes e validação de capítulos.
 */
export function useEmpacotarCorte(
  candidateId: number | null,
  fonte?: FonteEmpacotar | null,
  fila?: Fila,
) {
  const store = obterStore(fila)
  const jobs = useFila(fila)

  const fonteId = fonte?.id ?? null
  const fonteDisponivel = Boolean(fonte?.disponivel)
  const fonteStartUs = fonte?.startUs
  const fonteEndUs = fonte?.endUs
  const proxySolicitadoParaRef = useRef<string | null>(null)

  useEffect(() => {
    store.definirCandidato(candidateId)
    if (candidateId != null) {
      const podePedirProxy = fonteId != null && fonteDisponivel
      proxySolicitadoParaRef.current = podePedirProxy ? `${candidateId}:${fonteId}` : null
      void store.carregarTudo(
        candidateId,
        fonteId != null
          ? { id: fonteId, disponivel: fonteDisponivel, startUs: fonteStartUs, endUs: fonteEndUs }
          : null,
      )
    } else {
      proxySolicitadoParaRef.current = null
    }
  }, [store, candidateId])

  useEffect(() => {
    if (candidateId != null && fonteId != null && fonteDisponivel) {
      const chave = `${candidateId}:${fonteId}`
      if (proxySolicitadoParaRef.current === chave) return
      proxySolicitadoParaRef.current = chave
      void store.solicitarProxy({
        id: fonteId,
        disponivel: true,
        startUs: fonteStartUs,
        endUs: fonteEndUs,
      })
    }
  }, [store, candidateId, fonteId, fonteDisponivel, fonteStartUs, fonteEndUs])

  useEffect(() => {
    if (candidateId != null) {
      store.sincronizarJobs(
        jobs,
        fonteId != null
          ? { id: fonteId, disponivel: fonteDisponivel, startUs: fonteStartUs, endUs: fonteEndUs }
          : null,
      )
    }
  }, [store, candidateId, jobs, fonteId, fonteDisponivel, fonteStartUs, fonteEndUs])

  const estado = useSyncExternalStore(store.assinar, store.obterSnapshot, store.obterSnapshot)

  const bytesDescricao = useMemo(() => {
    const desc = estado.rascunho?.description ?? ''
    const creditBytes = estado.empacotamento?.limits?.creditBytes ?? 0
    return calcularBytesDescricao(desc, creditBytes)
  }, [estado.rascunho?.description, estado.empacotamento?.limits?.creditBytes])

  const resolverDestino = useCallback(
    (profileIdOrName?: string | null) =>
      resolverDestinoEmpacotar(profileIdOrName, estado.perfis, estado.tarefas),
    [estado.perfis, estado.tarefas],
  )

  return useMemo(
    () => ({
      ...estado,
      bytesDescricao,
      editarRascunho: store.editarRascunho,
      marcarSalvo: store.marcarSalvo,
      aceitarRemoto: store.aceitarRemoto,
      manterRascunho: store.manterRascunho,
      recarregarCapa: store.recarregarCapa,
      recarregarEmpacotamento: store.recarregarEmpacotamento,
      recarregarGuardrails: store.recarregarGuardrails,
      resolverDestino,
    }),
    [estado, bytesDescricao, store, resolverDestino],
  )
}
