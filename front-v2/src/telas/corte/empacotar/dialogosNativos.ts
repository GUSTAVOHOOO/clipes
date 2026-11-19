import { invoke, isTauri } from '@tauri-apps/api/core'
import type { SeletorCaminhoProps } from '~/componentes/SeletorCaminho'

// Referência de tipo: a augmentação global de `window.__CLIPES_E2E__` vive em SeletorCaminho.tsx.
export type _TipoE2E = SeletorCaminhoProps

export type OpcoesSalvarArquivo = {
  defaultPath?: string
  filters?: Array<{ name: string; extensions: string[] }>
}

/**
 * Diálogo nativo de salvar arquivo. No app (Tauri) usa o plugin de diálogo; nos testes E2E
 * consome a fila `window.__CLIPES_E2E__.dialogQueue`. Fora dos dois, rejeita para que a tela
 * ofereça o campo de caminho como alternativa.
 */
export async function salvarArquivo(opcoes?: OpcoesSalvarArquivo): Promise<string | null> {
  const e2e = typeof window !== 'undefined' ? window.__CLIPES_E2E__ : undefined
  if (e2e) {
    e2e.dialogCalls.push({ kind: 'save', options: opcoes as Record<string, unknown> | undefined })
    return e2e.dialogQueue.length > 0 ? (e2e.dialogQueue.shift() ?? null) : null
  }
  if (isTauri()) {
    const escolhido = await invoke<string | null>('plugin:dialog|save', { options: opcoes ?? {} })
    return escolhido ?? null
  }
  throw new Error('dialogo_nativo_indisponivel')
}

/** Copia texto para a área de transferência (Tauri, fila E2E ou `navigator.clipboard`). */
export async function copiarTexto(texto: string): Promise<void> {
  const e2e = typeof window !== 'undefined' ? window.__CLIPES_E2E__ : undefined
  if (e2e) {
    e2e.copiedText = texto
    return
  }
  if (isTauri()) {
    await invoke('plugin:clipboard-manager|write_text', { text: texto })
    return
  }
  await navigator.clipboard.writeText(texto)
}
