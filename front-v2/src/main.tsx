import { isTauri } from '@tauri-apps/api/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@ds/estilos.css'
import { App } from '~/App'
import { garantirEstadoE2E } from '~/core/desktop'
import { initMediaTransport } from '../../src/lib/media'

/**
 * Boot do app. No Tauri, aguarda o transporte de mídia (servidor loopback do
 * Linux WebKitGTK, #246) antes de montar; se falhar, monta mesmo assim.
 */
export async function iniciarApp(raiz: HTMLElement | null = document.getElementById('raiz')): Promise<void> {
  if (!raiz) return

  if (import.meta.env.VITE_E2E === '1') {
    garantirEstadoE2E()
  }

  if (isTauri()) {
    try {
      await initMediaTransport()
    } catch {
      // Sem transporte loopback, a mídia segue pelo esquema clipes-media://.
    }
  }

  createRoot(raiz).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void iniciarApp()
