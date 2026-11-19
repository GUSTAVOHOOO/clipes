import { invoke, isTauri } from '@tauri-apps/api/core'

export type FiltroDialogo = {
  name: string
  extensions: string[]
}

export type OpcoesSalvarDialogo = {
  title?: string
  defaultPath?: string
  filters?: FiltroDialogo[]
}

export type ResultadoAbertura = {
  ok: boolean
  copiado: boolean
}

export type ComportamentoUpdater = 'real' | 'mock-available' | 'off'

function obterEstadoE2E() {
  if (typeof window === 'undefined') return undefined
  return window.__CLIPES_E2E__
}

export function garantirEstadoE2E() {
  if (typeof window === 'undefined') return undefined
  if (!window.__CLIPES_E2E__) {
    let updaterMode: 'off' | 'available' | 'real' = 'off'
    try {
      const salvo = sessionStorage.getItem('clipes.e2e.updaterMode')
      if (salvo === 'available' || salvo === 'real' || salvo === 'off') {
        updaterMode = salvo
      }
    } catch {
      // sessionStorage indisponível
    }
    window.__CLIPES_E2E__ = {
      dialogQueue: [],
      dialogCalls: [],
      confirmQueue: [],
      confirmCalls: [],
      openedUrls: [],
      copiedText: null,
      updaterMode,
    }
  }
  return window.__CLIPES_E2E__
}

if (import.meta.env.VITE_E2E === '1' && typeof window !== 'undefined') {
  garantirEstadoE2E()
}

/** Copia texto para a área de transferência respeitando `window.__CLIPES_E2E__` e Tauri. */
export async function copiarTexto(texto: string): Promise<boolean> {
  const e2e = obterEstadoE2E() ?? (import.meta.env.VITE_E2E === '1' ? garantirEstadoE2E() : undefined)
  if (e2e) {
    e2e.copiedText = texto
    return true
  }

  if (isTauri()) {
    try {
      await invoke('plugin:clipboard-manager|write_text', { text: texto })
      return true
    } catch {
      // Tenta fallback de navegador se a WebView permitir
    }
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto)
      return true
    }
  } catch {
    // Área de transferência indisponível
  }
  return false
}

/** Abre o diálogo nativo de salvar arquivo (ou fila E2E). No navegador retorna `null`. */
export async function salvarDialogo(options?: OpcoesSalvarDialogo): Promise<string | null> {
  const e2e = obterEstadoE2E() ?? (import.meta.env.VITE_E2E === '1' ? garantirEstadoE2E() : undefined)
  if (e2e) {
    e2e.dialogCalls.push({ kind: 'save', options: options as Record<string, unknown> | undefined })
    return e2e.dialogQueue.length > 0 ? (e2e.dialogQueue.shift() ?? null) : null
  }

  if (isTauri()) {
    try {
      return await invoke<string | null>('plugin:dialog|save', { options: options ?? {} })
    } catch {
      return null
    }
  }

  return null
}

/**
 * Abre URL externa no navegador do sistema. Se o `opener` do Tauri recusar por capability,
 * copia a URL para a área de transferência sem lançar exceção.
 */
export async function abrirUrlExterna(url: string): Promise<ResultadoAbertura> {
  const e2e = obterEstadoE2E() ?? (import.meta.env.VITE_E2E === '1' ? garantirEstadoE2E() : undefined)
  if (e2e) {
    e2e.openedUrls = e2e.openedUrls ?? []
    e2e.openedUrls.push(url)
    return { ok: true, copiado: false }
  }

  if (isTauri()) {
    try {
      await invoke('plugin:opener|open_url', { url })
      return { ok: true, copiado: false }
    } catch {
      const copiado = await copiarTexto(url)
      return { ok: false, copiado }
    }
  }

  try {
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(url, '_blank', 'noopener,noreferrer')
      return { ok: true, copiado: false }
    }
  } catch {
    // Fallback para clipboard abaixo
  }

  const copiado = await copiarTexto(url)
  return { ok: false, copiado }
}

async function obterSistemaOperacionalTauri(): Promise<string | null> {
  try {
    const res = await invoke<{ os?: unknown }>('core_dispatch', {
      name: 'app.platform',
      arguments: {},
    })
    return typeof res?.os === 'string' && res.os.length > 0 ? res.os : null
  } catch {
    return null
  }
}

/**
 * Abre arquivo ou pasta no gerenciador do SO. No Windows usa `open_path_windows`
 * (contorna o travamento do `tauri-plugin-opener` em `ShellExecuteExW`); nos demais SOs
 * usa `plugin:opener|open_path`. Em qualquer falha ou fora do Tauri, copia o caminho
 * para a área de transferência sem lançar exceção.
 */
export async function abrirNoSistema(caminho: string): Promise<ResultadoAbertura> {
  const e2e = obterEstadoE2E() ?? (import.meta.env.VITE_E2E === '1' ? garantirEstadoE2E() : undefined)
  if (e2e) {
    e2e.openedUrls = e2e.openedUrls ?? []
    e2e.openedUrls.push(caminho)
    return { ok: true, copiado: false }
  }

  if (isTauri()) {
    try {
      const os = await obterSistemaOperacionalTauri()
      if (os === 'windows') {
        await invoke('open_path_windows', { path: caminho })
      } else {
        await invoke('plugin:opener|open_path', { path: caminho })
      }
      return { ok: true, copiado: false }
    } catch {
      const copiado = await copiarTexto(caminho)
      return { ok: false, copiado }
    }
  }

  const copiado = await copiarTexto(caminho)
  return { ok: false, copiado }
}

/** Envia notificação nativa do SO quando disponível e permitida, sem nunca lançar exceção. */
export async function notificarSistema(titulo: string, corpo?: string): Promise<boolean> {
  try {
    if (typeof Notification === 'undefined') return false
    if (Notification.permission !== 'granted') return false
    new Notification(titulo, corpo ? { body: corpo } : undefined)
    return true
  } catch {
    return false
  }
}

/** Reinicia o aplicativo Tauri após atualização instalada; fora do Tauri é no-op. */
export async function relaunchApp(): Promise<void> {
  if (!isTauri()) return
  await invoke('plugin:process|restart')
}

/** Determina o comportamento do verificador de atualizações (real, mock ou desligado). */
export function getUpdaterBehavior(): ComportamentoUpdater {
  if (import.meta.env.VITE_UPDATER_MOCK === 'available') return 'mock-available'
  const e2e = obterEstadoE2E() ?? (import.meta.env.VITE_E2E === '1' ? garantirEstadoE2E() : undefined)
  if (e2e) {
    if (e2e.updaterMode === 'available') return 'mock-available'
    if (e2e.updaterMode === 'real') return 'real'
    return 'off'
  }
  return isTauri() ? 'real' : 'off'
}
