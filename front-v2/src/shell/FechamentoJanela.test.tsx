import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { criarFila, type Job } from '~/core/progresso'
import { operacoesCriticasEmVoo } from '~/shell/FechamentoJanela'
import { Shell } from '~/shell/Shell'

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => false),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(),
}))

const mockIsTauri = vi.mocked(isTauri)
const mockListen = vi.mocked(listen)
const mockGetCurrentWindow = vi.mocked(getCurrentWindow)

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

function envolver(children: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>{children}</ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>
  )
}

function job(parcial: Partial<Job> & Pick<Job, 'id' | 'etapa'>): Job {
  return {
    percentual: 40,
    mensagem: 'Em execução',
    estado: 'rodando',
    inicioMs: 0,
    ...parcial,
  }
}

describe('operacoesCriticasEmVoo', () => {
  it('ignora jobs locais ou não-rodando e identifica downloads globais, exportações e chamadas pagas rodando', () => {
    const lista: Job[] = [
      job({ id: '1', etapa: 'transcribing' }),
      job({ id: '2', etapa: 'proxy' }),
      job({ id: '3', etapa: 'narration' }),
      job({ id: '4', etapa: 'export', estado: 'concluido', percentual: 100 }),
      job({ id: '5', etapa: 'ai:selection:call', estado: 'pausado' }),
      job({ id: '6', etapa: 'ai:script:done', estado: 'incerto' }),
      job({ id: 'ffmpeg', etapa: 'download' }),
      job({ id: 'tts:kokoro', etapa: 'download' }),
      job({ id: 'url-1', etapa: 'sources.url.download' }),
      job({ id: '7', etapa: 'export' }),
      job({ id: 'export-batch-2', etapa: 'export_batch' }),
      job({ id: '8', etapa: 'ai:selection:call' }),
      job({ id: 'provider.structured', etapa: 'starting' }),
    ]

    const criticos = operacoesCriticasEmVoo(lista)
    expect(criticos.map((j) => j.id)).toEqual([
      'ffmpeg',
      'tts:kokoro',
      'url-1',
      '7',
      'export-batch-2',
      '8',
      'provider.structured',
    ])
  })
})

describe('Fechamento da janela no Shell (app-close-requested)', () => {
  let destroyMock: ReturnType<typeof vi.fn<() => Promise<void>>>
  let unlistenMock: ReturnType<typeof vi.fn<() => void>>
  let closeHandler: ((ev: { event: string; id: number; payload: unknown }) => void) | undefined

  beforeEach(() => {
    mockIsTauri.mockReset()
    mockIsTauri.mockReturnValue(false)
    mockListen.mockReset()
    mockGetCurrentWindow.mockReset()
    destroyMock = vi.fn(async () => {})
    unlistenMock = vi.fn()
    closeHandler = undefined
    mockGetCurrentWindow.mockReturnValue({ destroy: destroyMock } as unknown as ReturnType<typeof getCurrentWindow>)
    mockListen.mockImplementation(async (eventName, cb) => {
      if (eventName === 'app-close-requested') {
        closeHandler = cb as typeof closeHandler
      }
      return unlistenMock
    })
    window.location.hash = '#/inicio'
  })

  afterEach(() => {
    window.location.hash = ''
  })

  it('é no-op fora do Tauri', () => {
    mockIsTauri.mockReturnValue(false)
    const fila = criarFila(() => null)

    render(
      envolver(
        <Shell projeto={null} somenteLocal={false} carregando={false} fila={fila}>
          <div>Conteúdo</div>
        </Shell>,
      ),
    )

    expect(mockListen).not.toHaveBeenCalled()
  })

  it('chama destroy() imediatamente quando não há operação crítica rodando na Fila', async () => {
    mockIsTauri.mockReturnValue(true)
    const fila = criarFila(() => 'proj-1')
    fila.aplicar({ job: '1', project: 'proj-1', stage: 'transcribing', percentage: 35, message: 'Transcrevendo', error: null })
    fila.aplicar({ job: '2', project: 'proj-1', stage: 'export', percentage: 100, message: 'Concluído', error: null })

    const { unmount } = render(
      envolver(
        <Shell projeto={{ id: 'proj-1', name: 'Meu Projeto' }} somenteLocal={false} carregando={false} fila={fila}>
          <div>Conteúdo</div>
        </Shell>,
      ),
    )

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalledWith('app-close-requested', expect.any(Function))
    })
    expect(mockListen).toHaveBeenCalledTimes(1)

    act(() => {
      closeHandler?.({ event: 'app-close-requested', id: 1, payload: null })
    })

    await waitFor(() => {
      expect(destroyMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    unmount()
    expect(unlistenMock).toHaveBeenCalledTimes(1)
  })

  it('abre ConfirmDialog com foco inicial em cancelar quando há download global, exportação ou chamada paga rodando e só chama destroy() após confirmar', async () => {
    mockIsTauri.mockReturnValue(true)
    const user = userEvent.setup()
    const fila = criarFila(() => 'proj-1')
    fila.aplicar({ job: 'tts:kokoro', project: null, stage: 'download', percentage: 42, message: 'Baixando modelo TTS', error: null })
    fila.aplicar({ job: '11', project: 'proj-1', stage: 'export', percentage: 58, message: 'Exportando Corte', error: null })
    fila.aplicar({ job: '14', project: 'proj-1', stage: 'ai:selection:call', percentage: 10, message: 'Selecionando Cortes', error: null })

    render(
      envolver(
        <Shell projeto={{ id: 'proj-1', name: 'Meu Projeto' }} somenteLocal={false} carregando={false} fila={fila}>
          <div>Conteúdo</div>
        </Shell>,
      ),
    )

    await waitFor(() => {
      expect(closeHandler).toBeDefined()
    })

    act(() => {
      closeHandler?.({ event: 'app-close-requested', id: 1, payload: null })
    })

    const dialog = await screen.findByRole('alertdialog')
    expect(destroyMock).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent(/Fechar o Clipes com operações em andamento/i)
    expect(dialog).toHaveTextContent(/Provedor|Projeto/i)

    const botaoCancelar = screen.getByRole('button', { name: 'Continuar trabalhando' })
    await waitFor(() => {
      expect(botaoCancelar).toHaveFocus()
    })

    await user.click(botaoCancelar)
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(destroyMock).not.toHaveBeenCalled()

    act(() => {
      closeHandler?.({ event: 'app-close-requested', id: 2, payload: null })
    })
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: 'Fechar mesmo assim' }))

    await waitFor(() => {
      expect(destroyMock).toHaveBeenCalledTimes(1)
    })
  })
})
