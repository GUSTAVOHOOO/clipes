import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { coreDispatch } from '@core'
import { App } from '~/App'

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {}
  }
})

describe('App', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    window.location.hash = ''
  })

  it('renderiza o título Clipes', () => {
    render(<App />)
    expect(screen.getByText('Clipes')).toBeInTheDocument()
  })

  it('resolve @core e o @/ interno do v1 no modo mock', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    const encoder = await coreDispatch<{ effective: string }>('export.encoder.status', {})
    expect(encoder.effective).toBe('libx264')
  })

  it('renderiza a tela Início e respeita ?estado=erro', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    window.location.hash = '#/inicio'
    const { rerender } = render(<App />)

    expect(await screen.findByRole('heading', { name: 'Projetos' })).toBeInTheDocument()

    window.location.hash = '#/inicio?estado=erro'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    rerender(<App />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('renderiza placeholder de Relatos e redireciona rota de Projeto sem Projeto aberto', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    window.location.hash = '#/relatos'
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Relatos e diagnóstico' })).toBeInTheDocument()

    window.location.hash = '#/projeto/x/cortes'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    await waitFor(() => {
      expect(window.location.hash).toBe('#/inicio')
    })
  })
})
