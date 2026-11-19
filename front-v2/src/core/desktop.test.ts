import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke, isTauri } from '@tauri-apps/api/core'
import {
  abrirNoSistema,
  abrirUrlExterna,
  copiarTexto,
  getUpdaterBehavior,
  notificarSistema,
  relaunchApp,
  salvarDialogo,
} from '~/core/desktop'

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
}))

const mockIsTauri = vi.mocked(isTauri)
const mockInvoke = vi.mocked(invoke)

describe('helpers desktop (desktop.ts)', () => {
  beforeEach(() => {
    mockIsTauri.mockReset()
    mockIsTauri.mockReturnValue(false)
    mockInvoke.mockReset()
    delete window.__CLIPES_E2E__
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    delete window.__CLIPES_E2E__
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('usa window.__CLIPES_E2E__ em copiarTexto, salvarDialogo e abrirUrlExterna', async () => {
    window.__CLIPES_E2E__ = {
      dialogQueue: ['/tmp/diagnostico.txt'],
      dialogCalls: [],
      confirmQueue: [],
      confirmCalls: [],
      openedUrls: [],
      copiedText: null,
      updaterMode: 'off',
    }

    const copiou = await copiarTexto('diagnostico limpo')
    expect(copiou).toBe(true)
    expect(window.__CLIPES_E2E__.copiedText).toBe('diagnostico limpo')

    const salvo = await salvarDialogo({
      defaultPath: 'clipes-diagnostico.txt',
      filters: [{ name: 'Texto', extensions: ['txt'] }],
    })
    expect(salvo).toBe('/tmp/diagnostico.txt')
    expect(window.__CLIPES_E2E__.dialogCalls).toHaveLength(1)
    expect(window.__CLIPES_E2E__.dialogCalls[0].kind).toBe('save')

    const abriu = await abrirUrlExterna('https://github.com/GUSTAVOHOOO/clipes/issues/new')
    expect(abriu).toEqual({ ok: true, copiado: false })
    expect(window.__CLIPES_E2E__.openedUrls).toEqual(['https://github.com/GUSTAVOHOOO/clipes/issues/new'])
  })

  it('no Tauri chama os plugins via invoke e faz fallback para clipboard sem lançar quando opener é recusado pelas capabilities', async () => {
    mockIsTauri.mockReturnValue(true)
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:dialog|save') return 'C:\\Exports\\diag.txt'
      if (cmd === 'plugin:opener|open_url') throw new Error('opener: URL not allowed by capability')
      if (cmd === 'plugin:opener|open_path') throw new Error('opener: open_path not allowed')
      return null
    })

    const caminho = await salvarDialogo({ defaultPath: 'diag.txt' })
    expect(caminho).toBe('C:\\Exports\\diag.txt')
    expect(mockInvoke).toHaveBeenCalledWith('plugin:dialog|save', { options: { defaultPath: 'diag.txt' } })

    const resUrl = await abrirUrlExterna('https://github.com/GUSTAVOHOOO/clipes/blob/master/SECURITY.md')
    expect(resUrl).toEqual({ ok: false, copiado: true })
    expect(mockInvoke).toHaveBeenCalledWith('plugin:clipboard-manager|write_text', {
      text: 'https://github.com/GUSTAVOHOOO/clipes/blob/master/SECURITY.md',
    })

    const resPasta = await abrirNoSistema('C:\\Exports')
    expect(resPasta).toEqual({ ok: false, copiado: true })
    expect(mockInvoke).toHaveBeenCalledWith('plugin:clipboard-manager|write_text', {
      text: 'C:\\Exports',
    })
  })

  it('abrirNoSistema no Windows usa open_path_windows e faz fallback para clipboard em erro', async () => {
    mockIsTauri.mockReturnValue(true)
    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'core_dispatch' && (args as { name?: string })?.name === 'app.platform') {
        return { os: 'windows' }
      }
      if (cmd === 'open_path_windows') {
        const p = (args as { path?: string })?.path
        if (p === 'C:\\Exports\\inexistente') {
          throw { code: 'path_not_found', message: 'A pasta ou o arquivo informado não existe.' }
        }
        return undefined
      }
      return null
    })

    const okRes = await abrirNoSistema('C:\\Exports\\corte.mp4')
    expect(okRes).toEqual({ ok: true, copiado: false })
    expect(mockInvoke).toHaveBeenCalledWith('open_path_windows', { path: 'C:\\Exports\\corte.mp4' })
    expect(mockInvoke).not.toHaveBeenCalledWith('plugin:opener|open_path', expect.anything())

    const errRes = await abrirNoSistema('C:\\Exports\\inexistente')
    expect(errRes).toEqual({ ok: false, copiado: true })
    expect(mockInvoke).toHaveBeenCalledWith('plugin:clipboard-manager|write_text', {
      text: 'C:\\Exports\\inexistente',
    })
  })

  it('abrirNoSistema em Linux/macOS usa plugin:opener|open_path e faz fallback para clipboard em erro', async () => {
    mockIsTauri.mockReturnValue(true)
    for (const os of ['linux', 'macos'] as const) {
      mockInvoke.mockReset()
      mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === 'core_dispatch' && (args as { name?: string })?.name === 'app.platform') {
          return { os }
        }
        if (cmd === 'plugin:opener|open_path') {
          if ((args as { path?: string })?.path === '/exports/bloqueado.exe') {
            throw new Error('Not allowed to open path')
          }
          return undefined
        }
        return null
      })

      const okRes = await abrirNoSistema('/exports/lote')
      expect(okRes).toEqual({ ok: true, copiado: false })
      expect(mockInvoke).toHaveBeenCalledWith('plugin:opener|open_path', { path: '/exports/lote' })
      expect(mockInvoke).not.toHaveBeenCalledWith('open_path_windows', expect.anything())

      const errRes = await abrirNoSistema('/exports/bloqueado.exe')
      expect(errRes).toEqual({ ok: false, copiado: true })
      expect(mockInvoke).toHaveBeenCalledWith('plugin:clipboard-manager|write_text', {
        text: '/exports/bloqueado.exe',
      })
    }
  })

  it('fora do Tauri e fora do E2E usa navigator.clipboard / window.open com fallback seguro', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    expect(await copiarTexto('texto navegador')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('texto navegador')

    expect(await salvarDialogo({ defaultPath: 'relato.txt' })).toBeNull()

    const urlRes = await abrirUrlExterna('https://github.com/GUSTAVOHOOO/clipes/issues/new')
    expect(urlRes.ok).toBe(true)
    expect(openSpy).toHaveBeenCalledWith('https://github.com/GUSTAVOHOOO/clipes/issues/new', '_blank', 'noopener,noreferrer')

    // abrirNoSistema no navegador não abre caminho local direto, mas copia para a área de transferência sem lançar
    const pathRes = await abrirNoSistema('/exports/lote')
    expect(pathRes).toEqual({ ok: false, copiado: true })
    expect(writeText).toHaveBeenCalledWith('/exports/lote')
  })

  it('notificarSistema e relaunchApp respeitam ambiente sem lançar exceção', async () => {
    expect(await notificarSistema('Clipes', 'Lote concluído')).toBe(false)
    await expect(relaunchApp()).resolves.toBeUndefined()

    mockIsTauri.mockReturnValue(true)
    mockInvoke.mockResolvedValue(undefined)
    await relaunchApp()
    expect(mockInvoke).toHaveBeenCalledWith('plugin:process|restart')
  })

  it('getUpdaterBehavior respeita VITE_UPDATER_MOCK, __CLIPES_E2E__.updaterMode e isTauri()', () => {
    expect(getUpdaterBehavior()).toBe('off')

    mockIsTauri.mockReturnValue(true)
    expect(getUpdaterBehavior()).toBe('real')

    mockIsTauri.mockReturnValue(false)
    window.__CLIPES_E2E__ = {
      dialogQueue: [],
      dialogCalls: [],
      updaterMode: 'available',
    }
    expect(getUpdaterBehavior()).toBe('mock-available')

    vi.stubEnv('VITE_UPDATER_MOCK', 'available')
    expect(getUpdaterBehavior()).toBe('mock-available')
  })
})
