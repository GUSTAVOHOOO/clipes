import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { coreDispatch } from '@core'
import { App } from '~/App'

describe('App', () => {
  it('renderiza o título Clipes', () => {
    render(<App />)
    expect(screen.getByText('Clipes')).toBeInTheDocument()
  })

  it('resolve @core e o @/ interno do v1 no modo mock', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    try {
      const encoder = await coreDispatch<{ effective: string }>('export.encoder.status', {})
      expect(encoder.effective).toBe('libx264')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
