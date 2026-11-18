import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { criarStoreAtualizador } from '~/stores/atualizador'

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((msg: unknown) => void) | null = null
  },
}))

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(async () => '1.0.0'),
}))

const mockIsTauri = vi.mocked(isTauri)
const mockInvoke = vi.mocked(invoke)
const mockGetVersion = vi.mocked(getVersion)

describe('store atualizador (atualizador.ts)', () => {
  beforeEach(() => {
    mockIsTauri.mockReset()
    mockIsTauri.mockReturnValue(false)
    mockInvoke.mockReset()
    mockGetVersion.mockResolvedValue('1.0.0')
    vi.unstubAllEnvs()
    sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    window.location.hash = '#/sobre'
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  it('transiciona checking -> available sem iniciar downloadAndInstall automaticamente', async () => {
    vi.stubEnv('VITE_UPDATER_MOCK', 'available')
    const store = criarStoreAtualizador()

    const estados: string[] = []
    store.assinar(() => estados.push(store.estado().status))

    await store.verificar()

    expect(estados).toContain('checking')
    expect(store.estado().status).toBe('available')
    expect(store.estado().atualizacao?.version).toBe('0.2.0')
    expect(sessionStorage.getItem('clipes.mock-update-installed')).toBeNull()
  })

  it('?updater-test=invalid-signature marca signature: true e bloqueia instalação', async () => {
    window.history.replaceState(null, '', '/?updater-test=invalid-signature')
    const store = criarStoreAtualizador()

    await store.verificar()

    expect(store.estado().status).toBe('error')
    expect(store.estado().signature).toBe(true)
    expect(store.estado().atualizacao).toBeNull()

    await store.instalar()
    expect(store.estado().status).toBe('error')
    expect(sessionStorage.getItem('clipes.mock-update-installed')).toBeNull()
  })

  it('navigator.onLine === false entra em estado offline sem erro alarmante na checagem manual e ignora na automática', async () => {
    vi.stubEnv('VITE_UPDATER_MOCK', 'available')
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

    const store = criarStoreAtualizador()
    await store.verificar({ automatico: true })
    expect(store.estado().status).toBe('idle')

    await store.verificar({ automatico: false })
    expect(store.estado().status).toBe('offline')
    expect(store.estado().erro).toBeNull()
    expect(store.estado().signature).toBe(false)
  })

  it('verifica operacoesCriticasEmVoo (#291) antes de relaunch no Tauri', async () => {
    mockIsTauri.mockReturnValue(true)
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:updater|check') {
        return { rid: 10, currentVersion: '1.0.0', version: '1.1.0', date: '2026-11-18', body: 'Melhorias', rawJson: {} }
      }
      return undefined
    })

    const store = criarStoreAtualizador()
    await store.verificar()
    expect(store.estado().status).toBe('available')

    await store.instalar({
      jobsEmVoo: [
        { id: 'ffmpeg', etapa: 'download', percentual: 50, mensagem: 'Baixando', estado: 'rodando', inicioMs: 0 },
      ],
    })

    expect(store.estado().status).toBe('installed')
    expect(store.estado().reinicioPendentePorJobs).toBe(true)
    expect(mockInvoke).not.toHaveBeenCalledWith('plugin:process|restart')

    await store.reiniciarParaAplicar()
    expect(mockInvoke).toHaveBeenCalledWith('plugin:process|restart')
  })
})
