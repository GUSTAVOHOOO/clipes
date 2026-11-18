import { isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useSyncExternalStore } from 'react'

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

export type Fila = {
  aplicar(e: EventoProgresso): void
  jobs(): Job[]
  assinar(fn: () => void): () => void
}

type RegistroJob = {
  job: Job
  vistoDesdeZero: boolean
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

  return { aplicar, jobs, assinar }
}

let filaAtiva: Fila = criarFila(() => null)

type ListenerCompartilhado = {
  contagem: number
  promessa: Promise<UnlistenFn>
}

let listenerAtivo: ListenerCompartilhado | null = null

/** Assina uma única vez o evento `core-progress` no Tauri; fora do Tauri, é no-op. */
export async function iniciarProgresso(fila: Fila = filaAtiva): Promise<() => void> {
  filaAtiva = fila

  if (!isTauri()) {
    return () => {}
  }

  if (!listenerAtivo) {
    const promessa = listen<EventoProgresso>('core-progress', (evento) => {
      filaAtiva.aplicar(evento.payload)
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
export function useFila(fila: Fila = filaAtiva): Job[] {
  return useSyncExternalStore(fila.assinar, fila.jobs, fila.jobs)
}
