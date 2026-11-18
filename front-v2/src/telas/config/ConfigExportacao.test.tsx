import { coreDispatch } from '@core'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { ConfigExportacao } from '~/telas/config/ConfigExportacao'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

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
  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  chamarMock.mockReset()
  window.history.replaceState(null, '', '/')
  window.location.hash = '#/config/exportacao'
})

function envolver(ui: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>{ui}</ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>
  )
}

describe('mock exportMock para ?estado=', () => {
  it('simula ffmpeg: false com ?estado=erro e stale: true com ?estado=parcial', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    window.location.hash = '#/config/exportacao?estado=erro'
    const semFfmpeg = await coreDispatch<{ ffmpeg: boolean }>('export.encoder.status', {})
    expect(semFfmpeg.ffmpeg).toBe(false)
    await expect(coreDispatch('export.encoder.detect', {})).rejects.toMatchObject({
      code: 'component_missing',
    })

    window.location.hash = '#/config/exportacao?estado=parcial'
    const stale = await coreDispatch<{
      ffmpeg: boolean
      stale: boolean
      passed: string[]
    }>('export.encoder.status', {})
    expect(stale.ffmpeg).toBe(true)
    expect(stale.stale).toBe(true)
    expect(stale.passed.length).toBeGreaterThan(0)

    const aposDetectar = await coreDispatch<{
      detected: boolean
      stale: boolean
    }>('export.encoder.detect', {})
    expect(aposDetectar.detected).toBe(true)
    expect(aposDetectar.stale).toBe(false)
  })
})

describe('ConfigExportacao (#/config/exportacao)', () => {
  it('estado loading exibe Esqueleto antes de export.encoder.status responder', () => {
    chamarMock.mockImplementation(() => new Promise(() => {}))
    render(envolver(<ConfigExportacao projetoAberto={null} />))

    expect(screen.getByRole('status', { name: /Carregando/i })).toBeInTheDocument()
  })

  it('estado empty quando detected: false explica fallback x264 e oferece Detectar encoders agora', async () => {
    const user = userEvent.setup()
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'export.encoder.status') {
        return {
          ffmpeg: true,
          detected: false,
          stale: false,
          passed: [],
          selected: 'libx264',
          manual: null,
          effective: 'libx264',
          gpu: '',
          detected_at: null,
        }
      }
      if (cmd === 'export.encoder.detect') {
        return {
          ffmpeg: true,
          detected: true,
          stale: false,
          passed: ['h264_nvenc', 'libx264'],
          selected: 'h264_nvenc',
          manual: null,
          effective: 'h264_nvenc',
          gpu: 'RTX 3050',
          detected_at: 1794942840,
        }
      }
      return null
    })

    render(envolver(<ConfigExportacao projetoAberto={null} />))

    expect(await screen.findByText(/Ainda não testamos os encoders deste computador/i)).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: /Detectar encoders agora/i })
    await user.click(btn)

    expect(chamarMock).toHaveBeenCalledWith('export.encoder.detect', {})
    expect(
      await screen.findByRole('radio', { name: /Placa NVIDIA \(NVENC\)/i }),
    ).toBeInTheDocument()
  })

  it('estado error com ffmpeg: false exibe aviso e botão Ir para Componentes (#/config/componentes)', async () => {
    const user = userEvent.setup()
    chamarMock.mockResolvedValue({
      ffmpeg: false,
      detected: false,
      stale: false,
      passed: [],
      effective: 'libx264',
    })

    render(envolver(<ConfigExportacao projetoAberto={null} />))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/FFmpeg não está instalado/i)

    await user.click(screen.getByRole('button', { name: /Ir para Componentes/i }))
    expect(window.location.hash).toBe('#/config/componentes')
  })

  it('estado error traduz component_missing, encoder_invalid e export_failed em role="alert"', async () => {
    const user = userEvent.setup()
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'export.encoder.status') {
        return {
          ffmpeg: true,
          detected: true,
          stale: false,
          passed: ['h264_nvenc', 'libx264'],
          selected: 'h264_nvenc',
          manual: null,
          effective: 'h264_nvenc',
          gpu: 'RTX 3050',
          detected_at: 1794942840,
        }
      }
      if (cmd === 'export.encoder.detect') {
        throw new ErroCore('export_failed', 'timeout 30s')
      }
      if (cmd === 'export.encoder.set') {
        throw new ErroCore('encoder_invalid', 'not passed')
      }
      return null
    })

    render(envolver(<ConfigExportacao projetoAberto={null} />))

    await user.click(await screen.findByRole('button', { name: /Detectar encoders novamente/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Não foi possível concluir o teste dos encoders/i,
    )

    await user.click(screen.getByRole('radio', { name: /Processador \/ CPU \(x264\)/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Este encoder não está disponível ou ainda não foi testado neste computador\./i,
    )

    chamarMock.mockRejectedValueOnce(new ErroCore('component_missing', 'ffmpeg missing'))
    await user.click(screen.getByRole('button', { name: /Detectar encoders novamente/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /FFmpeg ou FFprobe ausente/i,
    )
  })

  it('estado job_running coloca botão em carregando e desabilita rádios durante export.encoder.detect', async () => {
    const user = userEvent.setup()
    let resolver: (v: unknown) => void = () => {}
    chamarMock.mockImplementation((cmd: string) => {
      if (cmd === 'export.encoder.status') {
        return Promise.resolve({
          ffmpeg: true,
          detected: true,
          stale: false,
          passed: ['h264_nvenc', 'libx264'],
          selected: 'h264_nvenc',
          manual: null,
          effective: 'h264_nvenc',
          gpu: 'RTX 3050',
          detected_at: 1794942840,
        })
      }
      if (cmd === 'export.encoder.detect') {
        return new Promise((r) => {
          resolver = r
        })
      }
      return Promise.resolve(null)
    })

    render(envolver(<ConfigExportacao projetoAberto={null} />))

    const btnDetectar = await screen.findByRole('button', { name: /Detectar encoders novamente/i })
    await user.click(btnDetectar)

    const btnTestando = screen.getByRole('button', { name: /Testando encoders/i })
    expect(btnTestando).toBeDisabled()
    expect(btnTestando).toHaveAttribute('aria-busy', 'true')

    const radios = screen.getAllByRole('radio')
    for (const r of radios) {
      expect(r).toBeDisabled()
    }

    resolver({
      ffmpeg: true,
      detected: true,
      stale: false,
      passed: ['h264_nvenc', 'libx264'],
      selected: 'h264_nvenc',
      manual: null,
      effective: 'h264_nvenc',
      gpu: 'RTX 3050',
      detected_at: 1794942900,
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Detectar encoders novamente/i })).toBeEnabled()
    })
  })

  it('estado partial quando stale: true exibe faixa sugerindo nova detecção e mantém encoders visíveis', async () => {
    chamarMock.mockResolvedValue({
      ffmpeg: true,
      detected: false,
      stale: true,
      passed: ['h264_nvenc', 'libx264'],
      selected: 'h264_nvenc',
      manual: null,
      effective: 'h264_nvenc',
      gpu: 'RTX 3050',
      detected_at: 1794942840,
    })

    render(envolver(<ConfigExportacao projetoAberto={null} />))

    expect(
      await screen.findByText(/O FFmpeg ou o driver de vídeo mudou desde o último teste/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: /Escolha de encoder/i })).toBeInTheDocument()
  })

  it('navega no radiogroup por teclado (setas) e chama export.encoder.set com encoder ou null', async () => {
    const user = userEvent.setup()
    let manualAtual: string | null = null

    chamarMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'export.encoder.status') {
        return {
          ffmpeg: true,
          detected: true,
          stale: false,
          passed: ['h264_nvenc', 'libx264'],
          selected: 'h264_nvenc',
          manual: manualAtual,
          effective: manualAtual ?? 'h264_nvenc',
          gpu: 'RTX 3050',
          detected_at: 1794942840,
        }
      }
      if (cmd === 'export.encoder.set') {
        manualAtual = (args as { encoder: string | null }).encoder
        return {
          ffmpeg: true,
          detected: true,
          stale: false,
          passed: ['h264_nvenc', 'libx264'],
          selected: 'h264_nvenc',
          manual: manualAtual,
          effective: manualAtual ?? 'h264_nvenc',
          gpu: 'RTX 3050',
          detected_at: 1794942840,
        }
      }
      return null
    })

    render(envolver(<ConfigExportacao projetoAberto={null} />))

    const radioAuto = await screen.findByRole('radio', { name: /Automático/i })
    expect(radioAuto).toHaveAttribute('aria-checked', 'true')

    // Opções não aprovadas ficam desabilitadas com texto Indisponível
    expect(screen.getByRole('radio', { name: /Intel Quick Sync/i })).toBeDisabled()

    radioAuto.focus()
    await user.keyboard('{ArrowDown}')

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('export.encoder.set', { encoder: 'h264_nvenc' })
    })

    await user.keyboard('{ArrowUp}')
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('export.encoder.set', { encoder: null })
    })
  })

  it('UI-10: Status atual e Escolha de encoder são headings h2 reais', async () => {
    chamarMock.mockResolvedValue({
      ffmpeg: true,
      detected: true,
      stale: false,
      passed: ['h264_nvenc', 'libx264'],
      selected: 'h264_nvenc',
      manual: null,
      effective: 'h264_nvenc',
      gpu: 'RTX 3050',
      detected_at: 1794942840,
    })

    render(envolver(<ConfigExportacao projetoAberto={null} />))

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Status atual' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Escolha de encoder' }),
    ).toBeInTheDocument()
  })
})
