import { isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { assinarProgressoMock } from '@core'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
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
  startedAtMs?: number | null
  alvo?: string | null
}

export type EstadoSalvamentoEditor = {
  estado: 'ocioso' | 'salvo' | 'erro'
  clipId?: number
  erro?: ErroCore
}

export type SalvamentoEditor = EstadoSalvamentoEditor & {
  limparErro: () => void
}

export type JobExterno = {
  id: string
  etapa: string
  percentual: number
  mensagem: string
  estado: EstadoJob
  erro?: { code: string; message: string }
  startedAtMs?: number | null
  alvo?: string | null
}

export type Fila = {
  aplicar(e: EventoProgresso): void
  jobs(): Job[]
  assinar(fn: () => void): () => void
  sincronizarExterno?(itens: readonly JobExterno[]): void
  limparProjeto?(): void
}

type RegistroJob = {
  job: Job
  vistoDesdeZero: boolean
  origem: 'evento' | 'externo'
  escopoProjeto: boolean
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
      ...(anterior?.job.startedAtMs !== undefined ? { startedAtMs: anterior.job.startedAtMs } : {}),
      ...(anterior?.job.alvo !== undefined ? { alvo: anterior.job.alvo } : {}),
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

    const escopoProjeto =
      anterior?.escopoProjeto ?? (e.project !== undefined && e.project !== null)
    mapa.set(e.job, { job: proximo, vistoDesdeZero, origem: 'evento', escopoProjeto })
    notificar()
  }

  function sincronizarExterno(itens: readonly JobExterno[]) {
    const idsRecebidos = new Set<string>()
    let mudou = false

    for (const item of itens) {
      if (!item.id || item.id === '0') continue
      idsRecebidos.add(item.id)
      const bruto = Number.isFinite(item.percentual) ? Math.min(100, Math.max(0, item.percentual)) : 0
      const anterior = mapa.get(item.id)

      // Nunca regride nem sobrescreve um job já acompanhado ao vivo por core-progress em estado terminal
      if (anterior && anterior.origem === 'evento' && anterior.job.estado !== 'rodando') {
        continue
      }

      const percentual = anterior ? Math.max(anterior.job.percentual, bruto) : bruto
      const startedAtMs =
        item.startedAtMs !== undefined ? item.startedAtMs : (anterior?.job.startedAtMs ?? null)
      const alvo = item.alvo !== undefined ? item.alvo : (anterior?.job.alvo ?? null)
      const mesmoEstado =
        anterior &&
        anterior.job.etapa === item.etapa &&
        anterior.job.percentual === percentual &&
        anterior.job.mensagem === item.mensagem &&
        anterior.job.estado === item.estado &&
        anterior.job.erro?.code === item.erro?.code &&
        (anterior.job.startedAtMs ?? null) === startedAtMs &&
        (anterior.job.alvo ?? null) === alvo

      if (mesmoEstado) continue

      const inicioMs =
        typeof startedAtMs === 'number' && Number.isFinite(startedAtMs) && startedAtMs > 0
          ? startedAtMs
          : anterior
            ? anterior.job.inicioMs
            : agora()

      const proximo: Job = {
        id: item.id,
        etapa: item.etapa,
        percentual,
        mensagem: item.mensagem,
        estado: item.estado,
        inicioMs,
        startedAtMs,
        alvo,
      }
      if (item.erro) {
        proximo.erro = { code: item.erro.code, message: item.erro.message }
      }

      mapa.set(item.id, {
        job: proximo,
        vistoDesdeZero: anterior ? anterior.vistoDesdeZero : false,
        origem: anterior?.origem ?? 'externo',
        escopoProjeto: true,
      })
      mudou = true
    }

    for (const [id, registro] of Array.from(mapa.entries())) {
      if (registro.origem === 'externo' && !idsRecebidos.has(id)) {
        mapa.delete(id)
        mudou = true
      }
    }

    if (mudou) {
      notificar()
    }
  }

  function limparProjeto() {
    let mudou = false
    for (const [id, registro] of Array.from(mapa.entries())) {
      if (registro.escopoProjeto) {
        mapa.delete(id)
        mudou = true
      }
    }
    if (mudou) {
      notificar()
    }
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

  const fila: Fila = { aplicar, jobs, assinar, sincronizarExterno, limparProjeto }
  canaisSalvamento.set(fila, canalSalvamento)
  return fila
}

let projetoDaFila: string | null = null

/** Define o ID do Projeto ativo lido pela fila padrão ao filtrar eventos `core-progress`. */
export function definirProjetoDaFila(id: string | null): void {
  projetoDaFila = id
}

export const filaPadrao: Fila = criarFila(() => projetoDaFila)
export const filaPadraoExportada: Fila = filaPadrao
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

/** Formata tempo decorrido a partir de `startedAtMs` em PT-BR (`45 s`, `2 min 5 s`, `1 h 1 min`). */
export function formatarTempoDecorrido(
  startedAtMs: number | null | undefined,
  agoraMs: number = Date.now(),
): string | null {
  if (typeof startedAtMs !== 'number' || !Number.isFinite(startedAtMs) || startedAtMs <= 0) {
    return null
  }
  const totalSeg = Math.max(0, Math.floor((agoraMs - startedAtMs) / 1000))
  if (totalSeg < 60) return `${totalSeg} s`
  if (totalSeg < 3600) {
    const min = Math.floor(totalSeg / 60)
    const seg = totalSeg % 60
    return seg > 0 ? `${min} min ${seg} s` : `${min} min`
  }
  const horas = Math.floor(totalSeg / 3600)
  const min = Math.floor((totalSeg % 3600) / 60)
  return min > 0 ? `${horas} h ${min} min` : `${horas} h`
}

/** Mantém o relógio atualizado apenas enquanto `ativo` for verdadeiro (para tempo decorrido). */
export function useAgoraMs(ativo: boolean, intervaloMs = 1000): number {
  const [agoraMs, setAgoraMs] = useState(() => Date.now())

  useEffect(() => {
    if (!ativo) return
    setAgoraMs(Date.now())
    const id = setInterval(() => {
      setAgoraMs(Date.now())
    }, intervaloMs)
    return () => clearInterval(id)
  }, [ativo, intervaloMs])

  return agoraMs
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
