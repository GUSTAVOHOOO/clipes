import { isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { assinarConsoleMock } from '@core'
import { useCallback, useSyncExternalStore } from 'react'
import { chamar } from '~/core/cliente'

export const LIMITE_PADRAO_CONSOLE = 500
export const LIMITE_MAXIMO_CONSOLE = 1000
export const MAX_CHARS_LINHA_CONSOLE = 512
const REDACTED = '[REDACTED]'

export type NivelConsole = 'info' | 'warn' | 'error'
export type OrigemConsole =
  | 'component'
  | 'uv'
  | 'ffmpeg'
  | 'yt-dlp'
  | 'worker'
  | 'tts'
  | 'ai'
  | 'job'
export type OrigemFiltro = 'todas' | OrigemConsole
export type ModoConsole = 'simples' | 'tecnico'

export type EventoConsole = {
  seq: number
  timestampMs: number
  job: string
  project?: string | null
  origin: string
  level: NivelConsole
  simple: string
  technical?: string | null
}

export type StoreConsole = {
  aplicar(evento: EventoConsole): void
  aplicarLote(eventos: readonly EventoConsole[]): void
  linhas(): readonly EventoConsole[]
  limpar(): void
  limparProjeto(): void
  exportarTexto(opcoes?: {
    filtroOrigem?: OrigemFiltro
    filtroJob?: string | null
    modo?: ModoConsole
  }): string
  assinar(fn: () => void): () => void
}

const ROTULOS_ORIGEM: Record<OrigemConsole, string> = {
  component: 'Componentes',
  uv: 'uv',
  ffmpeg: 'FFmpeg',
  'yt-dlp': 'yt-dlp',
  worker: 'Worker',
  tts: 'TTS',
  ai: 'IA',
  job: 'Fila',
}

export function normalizarOrigemConsole(origem: string): OrigemConsole {
  const norm = origem.trim().toLowerCase()
  if (norm === 'component' || norm === 'componente') return 'component'
  if (norm === 'uv') return 'uv'
  if (norm === 'ffmpeg') return 'ffmpeg'
  if (norm === 'yt-dlp') return 'yt-dlp'
  if (norm === 'worker') return 'worker'
  if (norm === 'tts' || norm === 'pocket-tts') return 'tts'
  if (norm === 'ai' || norm === 'ia') return 'ai'
  return 'job'
}

export function rotuloOrigemConsole(origem: string): string {
  return ROTULOS_ORIGEM[normalizarOrigemConsole(origem)]
}

export function formatarHoraConsole(timestampMs: number): string {
  const data = new Date(timestampMs)
  if (!Number.isFinite(data.getTime())) return '--:--:--'
  const hh = String(data.getHours()).padStart(2, '0')
  const mm = String(data.getMinutes()).padStart(2, '0')
  const ss = String(data.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

/** Sanitização defensiva no front para eventos de mock ou entradas diretas antes de exibir/copiar. */
export function sanitizarLinhaDefensiva(raw: string): string {
  const semAnsi = raw
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?=]*[A-Za-z@-~]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[@-Z\\-_]/g, '')

  const partes: string[] = []
  for (const linha of semAnsi.split('\n')) {
    const segmentos = linha.split('\r')
    let escolhido = ''
    for (let i = segmentos.length - 1; i >= 0; i -= 1) {
      // eslint-disable-next-line no-control-regex
      const limpo = segmentos[i].replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim()
      if (limpo.length > 0) {
        escolhido = limpo
        break
      }
    }
    if (escolhido) partes.push(escolhido)
  }

  let texto = partes.join(' ').trim()

  // Headers sensíveis e tokens Bearer
  texto = texto.replace(/\b(set-cookie|cookie)\s*:[^\r\n"']*/gi, '$1: ' + REDACTED)
  texto = texto.replace(
    /\b(authorization)\s*([:=])\s*(bearer|basic|token|digest)\s+[^\s;,"')\]>]+/gi,
    (_m, h: string, sep: string, sch: string) => `${h}${sep === ':' ? ': ' : '='}${sch} ${REDACTED}`,
  )
  texto = texto.replace(
    /\bbearer\s+(?!\[REDACTED\])[^\s;,"')\]>]+/gi,
    `Bearer ${REDACTED}`,
  )
  texto = texto.replace(
    /\b(x-api-key|x-auth-token|x-access-token|x-goog-api-key|api-key|proxy-authorization)\s*([:=])\s*["']?[^\s;,"')\]>]+["']?/gi,
    (_m, h: string, sep: string) => `${h}${sep === ':' ? ': ' : '='}${REDACTED}`,
  )

  // Parâmetros de query e chave=valor sensíveis
  texto = texto.replace(
    /([?&;\s]|^)(x-amz-security-token|x-amz-signature|x-amz-credential|x-goog-signature|x-goog-credential|refresh_token|access_token|client_secret|session_id|auth_token|signature|id_token|password|api_key|apikey|cookies|session|passwd|secret|cookie|token|auth|pwd|key|sig)=([^\s&;,"')\]>#]+)/gi,
    `$1$2=${REDACTED}`,
  )

  // Prefixos de chaves de API e JWT
  texto = texto.replace(/(^|[^A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{6,}/g, `$1${REDACTED}`)
  texto = texto.replace(/(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{6,}/g, `$1${REDACTED}`)
  texto = texto.replace(/(^|[^A-Za-z0-9])AIza[A-Za-z0-9_-]{10,}/g, `$1${REDACTED}`)
  texto = texto.replace(/(^|[^A-Za-z0-9])gsk_[A-Za-z0-9_-]{10,}/g, `$1${REDACTED}`)
  texto = texto.replace(/(^|[^A-Za-z0-9])(?:gh[pousr]|hf)_[A-Za-z0-9]{10,}/g, `$1${REDACTED}`)
  texto = texto.replace(
    /(^|[^A-Za-z0-9])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
    `$1${REDACTED}`,
  )

  // Tokens hex longos (>= 32 chars com pelo menos um dígito)
  texto = texto.replace(/(^|[^A-Za-z0-9])([0-9a-fA-F]{32,})(?![A-Za-z0-9])/g, (m, p: string, hex: string) =>
    /\d/.test(hex) ? `${p}${REDACTED}` : m,
  )

  // Caminhos pessoais -> ~
  texto = texto.replace(/(^|[^A-Za-z0-9])[A-Za-z]:([\\/])Users\2[^\\/"'<>\r\n\t:;*|]+(?=[\\/]|$|\s|["')\]])/gi, '$1~')
  texto = texto.replace(/(^|[^A-Za-z0-9_.-])\/(?:home|Users)\/[^/\s"'<>|;,)\]]+/g, '$1~')

  if (texto.length > MAX_CHARS_LINHA_CONSOLE) {
    return `${texto.slice(0, MAX_CHARS_LINHA_CONSOLE - 1)}…`
  }
  return texto
}

function normalizarEvento(e: EventoConsole): EventoConsole {
  const simple = sanitizarLinhaDefensiva(e.simple)
  const techRaw = e.technical ? sanitizarLinhaDefensiva(e.technical) : ''
  return {
    ...e,
    origin: normalizarOrigemConsole(e.origin),
    simple,
    technical: techRaw.length > 0 ? techRaw : null,
  }
}

export function criarStoreConsole(opcoes?: {
  limite?: number
  projetoAtual?: () => string | null
  throttleMs?: number
}): StoreConsole {
  const limite = Math.min(LIMITE_MAXIMO_CONSOLE, Math.max(1, opcoes?.limite ?? LIMITE_PADRAO_CONSOLE))
  const projetoAtual = opcoes?.projetoAtual ?? (() => null)
  const throttleMs = Math.max(0, opcoes?.throttleMs ?? 80)

  let buffer: EventoConsole[] = []
  let snapshot: readonly EventoConsole[] = buffer
  const seqsPresentes = new Set<number>()
  let maxSeqVisto = 0
  let limpadoAteSeq = 0
  const ouvintes = new Set<() => void>()
  let ultimoEnvioMs = -Infinity
  let timerCoalesce: ReturnType<typeof setTimeout> | null = null

  const emitirParaOuvintes = () => {
    ultimoEnvioMs = Date.now()
    for (const fn of ouvintes) fn()
  }

  const agendarNotificacao = (imediato = false) => {
    snapshot = buffer.slice()
    if (imediato || throttleMs === 0) {
      if (timerCoalesce !== null) {
        clearTimeout(timerCoalesce)
        timerCoalesce = null
      }
      emitirParaOuvintes()
      return
    }
    const agora = Date.now()
    const restante = throttleMs - (agora - ultimoEnvioMs)
    if (restante <= 0 && timerCoalesce === null) {
      emitirParaOuvintes()
      return
    }
    if (timerCoalesce === null) {
      timerCoalesce = setTimeout(() => {
        timerCoalesce = null
        emitirParaOuvintes()
      }, Math.max(1, restante))
    }
  }

  const aceitarProjeto = (e: EventoConsole): boolean => {
    if (e.project === undefined || e.project === null || e.project === '') return true
    return e.project === projetoAtual()
  }

  const inserir = (e: EventoConsole, checarLimpado: boolean): boolean => {
    if (!aceitarProjeto(e)) return false
    if (checarLimpado && e.seq > 0 && e.seq <= limpadoAteSeq) return false
    if (e.seq > 0 && seqsPresentes.has(e.seq)) return false

    const limpo = normalizarEvento(e)
    if (buffer.length >= limite) {
      const removido = buffer.shift()
      if (removido && removido.seq > 0) {
        seqsPresentes.delete(removido.seq)
      }
    }
    buffer.push(limpo)
    if (limpo.seq > 0) {
      seqsPresentes.add(limpo.seq)
      if (limpo.seq > maxSeqVisto) maxSeqVisto = limpo.seq
    }
    return true
  }

  return {
    aplicar(e) {
      if (inserir(e, false)) {
        agendarNotificacao(e.level === 'error')
      }
    },
    aplicarLote(eventos) {
      let mudou = false
      for (const e of eventos) {
        if (inserir(e, true)) mudou = true
      }
      if (mudou) agendarNotificacao(true)
    },
    linhas() {
      return snapshot
    },
    limpar() {
      limpadoAteSeq = Math.max(limpadoAteSeq, maxSeqVisto)
      buffer = []
      seqsPresentes.clear()
      agendarNotificacao(true)
    },
    limparProjeto() {
      const filtrados = buffer.filter((ev) => !ev.project)
      if (filtrados.length === buffer.length) return
      buffer = filtrados
      seqsPresentes.clear()
      for (const ev of buffer) {
        if (ev.seq > 0) seqsPresentes.add(ev.seq)
      }
      agendarNotificacao(true)
    },
    exportarTexto(opts) {
      const filtroOrigem = opts?.filtroOrigem ?? 'todas'
      const filtroJob = opts?.filtroJob ?? null
      const modo = opts?.modo ?? 'simples'
      return buffer
        .filter((ev) => {
          if (filtroOrigem !== 'todas' && normalizarOrigemConsole(ev.origin) !== filtroOrigem) {
            return false
          }
          if (filtroJob && ev.job !== filtroJob) {
            return false
          }
          return true
        })
        .map((ev) => {
          const hora = formatarHoraConsole(ev.timestampMs)
          if (modo === 'tecnico') {
            return `${hora} [${rotuloOrigemConsole(ev.origin)}] ${ev.technical ?? ev.simple}`
          }
          return `${hora} ${ev.simple}`
        })
        .join('\n')
    },
    assinar(fn) {
      ouvintes.add(fn)
      return () => {
        ouvintes.delete(fn)
      }
    },
  }
}

let projetoDoConsole: string | null = null

export const consolePadrao: StoreConsole = criarStoreConsole({
  projetoAtual: () => projetoDoConsole,
})

/** Define o ID do Projeto ativo lido pelo store global do console ao filtrar `core-console`. */
export function definirProjetoConsole(id: string | null): void {
  if (projetoDoConsole !== id) {
    projetoDoConsole = id
    consolePadrao.limparProjeto()
  }
}

type ListenerCompartilhado = {
  contagem: number
  promessa: Promise<UnlistenFn>
}

let listenerAtivo: ListenerCompartilhado | null = null
let destinoTauri: StoreConsole = consolePadrao

/** Assina `core-console` (Tauri) ou `assinarConsoleMock` (mock) e hidrata o histórico em memória. */
export async function iniciarConsole(store: StoreConsole = consolePadrao): Promise<() => void> {
  const hidratar = () => {
    void chamar<{ items?: EventoConsole[] }>('console.history', {
      ...(projetoDoConsole ? { project: projetoDoConsole } : {}),
    })
      .then((res) => {
        if (Array.isArray(res?.items) && res.items.length > 0) {
          store.aplicarLote(res.items)
        }
      })
      .catch(() => {})
  }

  if (!isTauri()) {
    if (import.meta.env.VITE_CORE_MOCK === '1') {
      const unsub = assinarConsoleMock((ev) => {
        store.aplicar(ev)
      })
      hidratar()
      return unsub
    }
    return () => {}
  }

  destinoTauri = store
  if (!listenerAtivo) {
    const promessa = listen<EventoConsole>('core-console', (evento) => {
      destinoTauri.aplicar(evento.payload)
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

  hidratar()

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

export function useConsole(store: StoreConsole = consolePadrao) {
  const linhas = useSyncExternalStore(store.assinar, store.linhas)
  const limpar = useCallback(() => store.limpar(), [store])
  const exportarTexto = useCallback(
    (opcoes?: { filtroOrigem?: OrigemFiltro; filtroJob?: string | null; modo?: ModoConsole }) =>
      store.exportarTexto(opcoes),
    [store],
  )
  return { linhas, limpar, exportarTexto }
}
