import { coreDispatch } from '@core'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('mock de Provedores em core.ts', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('persiste timeoutSeconds em provider.cli.configure e restaura padrão 300 com null', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')

    await coreDispatch('provider.cli.configure', { kind: 'codex', timeoutSeconds: 180 })
    const atualizado = await coreDispatch<{ selected: string; timeoutSeconds: number }>(
      'provider.cli.status',
      {},
    )
    expect(atualizado.selected).toBe('codex')
    expect(atualizado.timeoutSeconds).toBe(180)

    await coreDispatch('provider.cli.configure', { kind: 'codex', timeoutSeconds: null })
    const restaurado = await coreDispatch<{ timeoutSeconds: number }>('provider.cli.status', {})
    expect(restaurado.timeoutSeconds).toBe(300)

    await expect(
      coreDispatch('provider.cli.configure', { kind: 'codex', timeoutSeconds: 9999 }),
    ).rejects.toMatchObject({ code: 'invalid_settings' })
  })

  it('proíbe remoção do perfil legacy em provider.profiles.remove', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')

    await expect(
      coreDispatch('provider.profiles.remove', { profileId: 'legacy' }),
    ).rejects.toMatchObject({ code: 'invalid_settings' })
  })

  it('retorna timeouts globais em provider.status e perfis padrão sem query flag oculta', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')

    const status = await coreDispatch<{ timeouts: { remote: number; local: number } }>(
      'provider.status',
      {},
    )
    expect(status.timeouts).toEqual({ remote: 60, local: 300 })

    const lista = await coreDispatch<{ profiles: { id: string }[] }>('provider.profiles.list', {})
    expect(lista.profiles.some((p) => p.id === 'legacy')).toBe(true)
    expect(lista.profiles.some((p) => p.id === 'codex')).toBe(true)
  })
})
