import { isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { assinarProgressoMock } from '@core'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { ErroCore } from '~/core/cliente'

export type EventoProgresso = {
  job: string
  project?: string | null
  stage: string
  percentage: number
  message: string
  error: { code: string; message: string } | null
}

export type EstadoJob = 'rodando' | 'concluido' | 'falhou' | 'pausado' | 'incerto'

export type Job = {
  id: string
  etapa: string
  percentual: number
  mensagem: string
  estado: EstadoJob
  erro?: { code: string; message: string }
  inicioMs: number
  etaMs?: number
}

export type EstadoSalvamentoEditor = {
  estado: 'ocioso' | 'salvo' | 'erro'
  clipId?: number
  erro?: ErroCore
}

export type SalvamentoEditor = EstadoSalvamentoEditor & {
  limparErro: () => void
}

export type Fila = {
  aplicar(e: EventoProgresso): void
  jobs(): Job[]
  assinar(fn: () => void): () => void
}

type RegistroJob = {
  job: Job
  vistoDesdeZero: boolean
}

type CanalSalvamento = {
  obter: () => EstadoSalvamentoEditor
  assinar: (fn: () => void) => () => void
  atualizar: (proximo: EstadoSalvamentoEditor) => void
  limparErro: () => void
}

const canaisSalvamento = new WeakMap<Fila, CanalSalvamento>()
const ESTADO_SALVAMENTO_PADRAO: EstadoSalvamentoEditor = { estado: 'ocioso' }

function criarCanalSalvamento(): CanalSalvamento {
  let snapshot: EstadoSalvamentoEditor = ESTADO_SALVAMENTO_PADRAO
  const ouvintes = new Set<() => void>()

  const notificar = () => {
    for (const fn of ouvintes) fn()
  }

  return {
    obter: () => snapshot,
    assinar: (fn) => {
      ouvintes.add(fn)
      return () => {
        ouvintes.delete(fn)
      }
    },
    atualizar: (proximo) => {
      snapshot = proximo
      notificar()
    },
    limparErro: () => {
      if (snapshot.estado === 'ocioso' && !snapshot.erro) return
      snapshot = { estado: 'ocioso' }
      notificar()
    },
  }
}

function extrairClipIdEditor(job: string): number | undefined {
  if (!job.startsWith('editor:')) return undefined
  const bruto = Number(job.slice(7))
  return Number.isInteger(bruto) && bruto > 0 ? bruto : undefined
}

function classificarEstado(
  e: EventoProgresso,
  percentual: number,
  estadoAnterior?: EstadoJob,
): EstadoJob {
  if (e.error) {
    if (e.error.code === 'timeout_uncertain') return 'incerto'
    if (e.error.code.startsWith('budget_') || e.error.code === 'time_budget_exhausted') {
      return 'pausado'
    }
    return 'falhou'
  }
  if (e.stage.endsWith(':paused') || e.stage === 'batch:paused') {
    return 'pausado'
  }
  if (percentual >= 100 || estadoAnterior === 'concluido') {
    return 'concluido'
  }
  return 'rodando'
}

/** Cria um store em memória para os jobs recebidos via `core-progress`. */
export function criarFila(
  projetoAtual: () => string | null,
  agora: () => number = Date.now,
): Fila {
  const mapa = new Map<string, RegistroJob>()
  const ouvintes = new Set<() => void>()
  const canalSalvamento = criarCanalSalvamento()
  let snapshot: Job[] = []

  function notificar() {
    snapshot = Array.from(mapa.values(), (entrada) => entrada.job)
    for (const fn of ouvintes) {
      fn()
    }
  }

  function aplicar(e: EventoProgresso) {
    if (!e.job || e.job === '0') return
    if (e.project !== undefined && e.project !== null && e.project !== projetoAtual()) {
      return
    }

    if (e.stage === 'editor_saved') {
      const clipId = extrairClipIdEditor(e.job)
      canalSalvamento.atualizar({
        estado: 'salvo',
        ...(clipId !== undefined ? { clipId } : {}),
      })
      return
    }

    if (e.stage === 'editor_save_failed') {
      const clipId = extrairClipIdEditor(e.job)
      const erro = e.error
        ? new ErroCore(e.error.code || 'project_write', e.error.message || e.message)
        : new ErroCore('project_write', e.message || 'Não foi possível salvar o Corte.')
      canalSalvamento.atualizar({
        estado: 'erro',
        ...(clipId !== undefined ? { clipId } : {}),
        erro,
      })
      return
    }

    const bruto = Number.isFinite(e.percentage) ? Math.min(100, Math.max(0, e.percentage)) : 0
    const anterior = mapa.get(e.job)
    const vistoDesdeZero = anterior ? anterior.vistoDesdeZero : bruto === 0
    const inicioMs = anterior ? anterior.job.inicioMs : agora()
    const percentual = anterior ? Math.max(anterior.job.percentual, bruto) : bruto
    const regrediu = anterior !== undefined && !e.error && bruto < anterior.job.percentual

    const etapa = regrediu ? anterior.job.etapa : e.stage
    const mensagem = regrediu ? anterior.job.mensagem : e.message
    const estado = classificarEstado(e, percentual, anterior?.job.estado)

    const proximo: Job = {
      id: e.job,
      etapa,
      percentual,
      mensagem,
      estado,
      inicioMs,
    }

    if (e.error) {
      proximo.erro = { code: e.error.code, message: e.error.message }
    }

    if (
      estado === 'rodando' &&
      vistoDesdeZero &&
      !etapa.startsWith('ai:') &&
      percentual > 0 &&
      percentual < 100
    ) {
      const decorrido = Math.max(0, agora() - inicioMs)
      proximo.etaMs = Math.round((decorrido * (100 - percentual)) / percentual)
    }

    mapa.set(e.job, { job: proximo, vistoDesdeZero })
    notificar()
  }

  function jobs(): Job[] {
    return snapshot
  }

  function assinar(fn: () => void): () => void {
    ouvintes.add(fn)
    return () => {
      ouvintes.delete(fn)
    }
  }

  const fila: Fila = { aplicar, jobs, assinar }
  canaisSalvamento.set(fila, canalSalvamento)
  return fila
}

let projetoDaFila: string | null = null

/** Define o ID do Projeto ativo lido pela fila padrão ao filtrar eventos `core-progress`. */
export function definirProjetoDaFila(id: string | null): void {
  projetoDaFila = id
}

const filaPadrao: Fila = criarFila(() => projetoDaFila)
let filaDestinoTauri: Fila = filaPadrao

function canalDe(fila: Fila): CanalSalvamento | undefined {
  return canaisSalvamento.get(fila)
}

/** Assina diretamente mudanças de `editor_saved` / `editor_save_failed`. */
export function assinarSalvamentoEditor(fn: () => void, fila: Fila = filaPadrao): () => void {
  return canalDe(fila)?.assinar(fn) ?? (() => {})
}

/** Lê o estado atual de salvamento do Editor fora de componentes React. */
export function estadoSalvamentoEditor(fila: Fila = filaPadrao): EstadoSalvamentoEditor {
  return canalDe(fila)?.obter() ?? ESTADO_SALVAMENTO_PADRAO
}

/** Limpa o estado de erro de salvamento do Editor após recuperação ou dispensa. */
export function limparErroSalvamentoEditor(fila: Fila = filaPadrao): void {
  canalDe(fila)?.limparErro()
}

type ListenerCompartilhado = {
  contagem: number
  promessa: Promise<UnlistenFn>
}

let listenerAtivo: ListenerCompartilhado | null = null

/** Assina uma única vez o evento `core-progress` no Tauri; fora do Tauri, é no-op. */
export async function iniciarProgresso(fila: Fila = filaPadrao): Promise<() => void> {
  if (!isTauri()) {
    if (import.meta.env.VITE_CORE_MOCK === '1') {
      return assinarProgressoMock((evento) => {
        fila.aplicar(evento)
      })
    }
    return () => {}
  }

  filaDestinoTauri = fila

  if (!listenerAtivo) {
    const promessa = listen<EventoProgresso>('core-progress', (evento) => {
      filaDestinoTauri.aplicar(evento.payload)
    })
    listenerAtivo = { contagem: 0, promessa }
  }

  const entrada = listenerAtivo
  entrada.contagem += 1

  let unlisten: UnlistenFn
  try {
    unlisten = await entrada.promessa
  } catch (erro) {
    entrada.contagem -= 1
    if (entrada.contagem <= 0 && listenerAtivo === entrada) {
      listenerAtivo = null
    }
    throw erro
  }

  let liberado = false
  return () => {
    if (liberado) return
    liberado = true
    entrada.contagem -= 1
    if (entrada.contagem <= 0) {
      if (listenerAtivo === entrada) {
        listenerAtivo = null
      }
      unlisten()
    }
  }
}

/** Hook reativo para ler a lista de jobs da Fila via `useSyncExternalStore`. */
export function useFila(fila: Fila = filaPadrao): Job[] {
  return useSyncExternalStore(fila.assinar, fila.jobs, fila.jobs)
}

/** Hook reativo para acompanhar `editor_saved` / `editor_save_failed` sem poluir a Fila Global. */
export function useSalvamentoEditor(fila: Fila = filaPadrao): SalvamentoEditor {
  const assinar = useCallback((fn: () => void) => assinarSalvamentoEditor(fn, fila), [fila])
  const obter = useCallback(() => estadoSalvamentoEditor(fila), [fila])
  const estado = useSyncExternalStore(assinar, obter, obter)
  const limparErro = useCallback(() => limparErroSalvamentoEditor(fila), [fila])

  return useMemo(() => ({ ...estado, limparErro }), [estado, limparErro])
}
