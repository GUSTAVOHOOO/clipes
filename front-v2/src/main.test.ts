import { act, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockIsTauri = vi.fn<() => boolean>()
const mockInitMediaTransport = vi.fn<() => Promise<void>>()
const raizesAtivas = new Set<Root>()
const mockCreateRoot = vi.fn<(container: HTMLElement) => Root>()

vi.mock('react-dom/client', async () => {
  const real = await vi.importActual<typeof import('react-dom/client')>('react-dom/client')
  mockCreateRoot.mockImplementation((container) => {
    const root = real.createRoot(container)
    raizesAtivas.add(root)
    return root
  })
  return {
    ...real,
    createRoot: (container: HTMLElement) => mockCreateRoot(container),
  }
})

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => mockIsTauri(),
}))

vi.mock('../../src/lib/media', () => ({
  initMediaTransport: () => mockInitMediaTransport(),
}))

vi.mock('@ds/estilos.css', () => ({}))

vi.mock('~/App', () => ({
  App: () => createElement('div', { 'data-testid': 'app-montado' }, 'Clipes App'),
}))

describe('boot em main.tsx (iniciarApp)', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    mockIsTauri.mockReset()
    mockInitMediaTransport.mockReset()
    mockCreateRoot.mockClear()
    delete window.__CLIPES_E2E__
    sessionStorage.clear()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  afterEach(async () => {
    await act(async () => {
      for (const root of raizesAtivas) {
        root.unmount()
      }
      raizesAtivas.clear()
    })
    vi.unstubAllGlobals()
    container.remove()
    delete window.__CLIPES_E2E__
    sessionStorage.clear()
    vi.unstubAllEnvs()
  })

  it('no Tauri, aguarda initMediaTransport() antes de montar <App />', async () => {
    mockIsTauri.mockReturnValue(true)
    let resolverTransporte!: () => void
    mockInitMediaTransport.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolverTransporte = resolve
        }),
    )

    const { iniciarApp } = await import('~/main')
    const promessaBoot = iniciarApp(container)

    expect(mockInitMediaTransport).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid="app-montado"]')).toBeNull()

    await act(async () => {
      resolverTransporte()
      await promessaBoot
    })

    await waitFor(() => {
      expect(container.querySelector('[data-testid="app-montado"]')).not.toBeNull()
    })
  })

  it('no Tauri, faz fallback não bloqueante e monta <App /> se initMediaTransport() rejeitar', async () => {
    mockIsTauri.mockReturnValue(true)
    mockInitMediaTransport.mockRejectedValue(new Error('media_base_url falhou'))

    const { iniciarApp } = await import('~/main')
    await act(async () => {
      await expect(iniciarApp(container)).resolves.toBeUndefined()
    })

    expect(mockInitMediaTransport).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(container.querySelector('[data-testid="app-montado"]')).not.toBeNull()
    })
  })

  it('no navegador (isTauri() === false), monta <App /> sem chamar initMediaTransport()', async () => {
    mockIsTauri.mockReturnValue(false)

    const { iniciarApp } = await import('~/main')
    await act(async () => {
      await iniciarApp(container)
    })

    expect(mockInitMediaTransport).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(container.querySelector('[data-testid="app-montado"]')).not.toBeNull()
    })
  })

  it('inicializa window.__CLIPES_E2E__ no boot quando VITE_E2E=1', async () => {
    mockIsTauri.mockReturnValue(false)
    vi.stubEnv('VITE_E2E', '1')
    sessionStorage.setItem('clipes.e2e.updaterMode', 'available')

    const { iniciarApp } = await import('~/main')
    await act(async () => {
      await iniciarApp(container)
    })

    expect(window.__CLIPES_E2E__).toEqual({
      dialogQueue: [],
      dialogCalls: [],
      confirmQueue: [],
      confirmCalls: [],
      openedUrls: [],
      copiedText: null,
      updaterMode: 'available',
    })
    expect(container.querySelector('[data-testid="app-montado"]')).not.toBeNull()
  })

  it('não cria window.__CLIPES_E2E__ quando VITE_E2E não está ativo', async () => {
    mockIsTauri.mockReturnValue(false)

    const { iniciarApp } = await import('~/main')
    await act(async () => {
      await iniciarApp(container)
    })

    expect(window.__CLIPES_E2E__).toBeUndefined()
    expect(container.querySelector('[data-testid="app-montado"]')).not.toBeNull()
  })

  it('ignora raiz nula sem lançar exceção', async () => {
    mockIsTauri.mockReturnValue(true)

    const { iniciarApp } = await import('~/main')
    await expect(iniciarApp(null)).resolves.toBeUndefined()
    expect(mockInitMediaTransport).not.toHaveBeenCalled()
  })

  it('não agenda renderização se o ambiente DOM for desmontado durante initMediaTransport()', async () => {
    mockIsTauri.mockReturnValue(true)
    let resolverTransporte!: () => void
    mockInitMediaTransport.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolverTransporte = resolve
        }),
    )

    const { iniciarApp } = await import('~/main')
    const promessaBoot = iniciarApp(container)

    try {
      vi.stubGlobal('window', undefined)
      resolverTransporte()
      await expect(promessaBoot).resolves.toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }

    expect(mockCreateRoot).not.toHaveBeenCalled()
  })
})
