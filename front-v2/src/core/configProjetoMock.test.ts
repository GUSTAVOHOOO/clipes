import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { coreDispatch, emitirProgressoMock } from '@core'

type BackupItem = { id: string; created_at: number; before_restore: boolean }
type BackupSettings = {
  interval_seconds: number
  copies: number
  default_interval_seconds: number
  default_copies: number
  warning: { code: string; message: string } | null
}

describe('mock de backups em src/lib/core.ts', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
  })

  afterEach(async () => {
    try {
      await coreDispatch('projects.close', {})
    } catch {
      // ignora
    }
    vi.unstubAllEnvs()
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
  })

  it('backups.settings.get e backups.list funcionam sem ?source-test e incluem default_* / warning / before_restore', async () => {
    await coreDispatch('projects.open', { path: '/projetos/MeuCanal.clipes' })

    const settings = await coreDispatch<BackupSettings>('backups.settings.get', {})
    expect(settings).toMatchObject({
      interval_seconds: 1800,
      copies: 10,
      default_interval_seconds: 1800,
      default_copies: 10,
      warning: null,
    })

    const lista = await coreDispatch<BackupItem[]>('backups.list', {})
    expect(lista.length).toBeGreaterThanOrEqual(2)
    expect(lista.some((b) => b.before_restore)).toBe(true)
    expect(lista.some((b) => !b.before_restore)).toBe(true)

    window.location.hash = '#/config/projeto?estado=vazio'
    expect(await coreDispatch<BackupItem[]>('backups.list', {})).toEqual([])
  })

  it('backups.settings.set valida inteiros positivos e atualiza configuração', async () => {
    await coreDispatch('projects.open', { path: '/projetos/MeuCanal.clipes' })

    await expect(
      coreDispatch('backups.settings.set', { interval_seconds: 0, copies: 5 }),
    ).rejects.toMatchObject({ code: 'backup_settings' })
    await expect(
      coreDispatch('backups.settings.set', { interval_seconds: 600, copies: 1.5 }),
    ).rejects.toMatchObject({ code: 'backup_settings' })

    await coreDispatch('backups.settings.set', { interval_seconds: 900, copies: 4 })
    const atualizado = await coreDispatch<BackupSettings>('backups.settings.get', {})
    expect(atualizado.interval_seconds).toBe(900)
    expect(atualizado.copies).toBe(4)

    await coreDispatch('backups.settings.set', { interval_seconds: 1800, copies: 10 })
  })

  it('backups.create adiciona backup e backups.restore respeita project_busy e cria before-restore', async () => {
    const aberto = await coreDispatch<{ id: string }>('projects.open', {
      path: '/projetos/MeuCanal.clipes',
    })

    await coreDispatch('backups.create', {})
    const aposCreate = await coreDispatch<BackupItem[]>('backups.list', {})
    expect(aposCreate[0].before_restore).toBe(false)

    await expect(coreDispatch('backups.restore', { id: 'inexistente.sqlite' })).rejects.toMatchObject({
      code: 'backup_invalid',
    })

    emitirProgressoMock({
      job: '501',
      project: aberto.id,
      stage: 'transcribing',
      percentage: 40,
      message: 'Transcrevendo',
      error: null,
    })

    await expect(coreDispatch('backups.restore', { id: aposCreate[0].id })).rejects.toMatchObject({
      code: 'project_busy',
    })

    emitirProgressoMock({
      job: '501',
      project: aberto.id,
      stage: 'complete',
      percentage: 100,
      message: 'Pronto',
      error: null,
    })

    await coreDispatch('backups.restore', { id: aposCreate[0].id })
    const aposRestore = await coreDispatch<BackupItem[]>('backups.list', {})
    expect(aposRestore[0].before_restore).toBe(true)
    expect(aposRestore[0].id).toMatch(/^before-restore-/)
  })
})
