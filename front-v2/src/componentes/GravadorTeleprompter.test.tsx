import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GravadorTeleprompter } from '~/componentes/GravadorTeleprompter'

function mockMatchMedia(reducedMotion: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

function instalarMockMidiaComSucesso() {
  const stopTrack = vi.fn()
  const stream = {
    getTracks: () => [{ stop: stopTrack }],
    getAudioTracks: () => [{ stop: stopTrack }],
  } as unknown as MediaStream

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(stream),
    },
  })

  class MockAudioContext {
    sampleRate = 48000
    state: AudioContextState = 'running'
    destination = {} as AudioDestinationNode
    createMediaStreamSource() {
      return { connect: vi.fn(), disconnect: vi.fn() }
    }
    createAnalyser() {
      return {
        fftSize: 256,
        frequencyBinCount: 128,
        getByteTimeDomainData: (arr: Uint8Array) => {
          arr.fill(140)
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
    }
    createScriptProcessor() {
      return {
        onaudioprocess: null as ((e: AudioProcessingEvent) => void) | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
    }
    async close() {
      this.state = 'closed'
    }
  }
  vi.stubGlobal('AudioContext', MockAudioContext)
  return { stopTrack }
}

describe('<GravadorTeleprompter>', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('com prefers-reduced-motion: reduce inicia em Passo e navega com ArrowDown / ArrowUp', async () => {
    mockMatchMedia(true)
    render(
      <GravadorTeleprompter
        aberto
        bloco={{ id: 10, position: 1, title: 'Abertura', narration: 'Primeira frase.\n\nSegunda frase.' }}
        totalBlocos={3}
        aoSalvarAudio={vi.fn()}
        aoDescartarRascunho={vi.fn()}
        aoFechar={vi.fn()}
      />,
    )

    const radioPasso = screen.getByRole('radio', { name: 'Passo' })
    expect(radioPasso).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Passo 1 de 2/i)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(screen.getByText(/Passo 2 de 2/i)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(screen.getByText(/Passo 1 de 2/i)).toBeInTheDocument()
  })

  it('Esc ocioso fecha diretamente; durante gravação abre confirmação com foco em Cancelar', async () => {
    mockMatchMedia(false)
    const { stopTrack } = instalarMockMidiaComSucesso()
    const aoFechar = vi.fn()
    const user = userEvent.setup()

    const { rerender } = render(
      <GravadorTeleprompter
        aberto
        bloco={{ id: 10, position: 1, title: 'Abertura', narration: 'Texto do bloco.' }}
        totalBlocos={2}
        aoSalvarAudio={vi.fn()}
        aoDescartarRascunho={vi.fn()}
        aoFechar={aoFechar}
      />,
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(aoFechar).toHaveBeenCalledTimes(1)

    aoFechar.mockClear()
    rerender(
      <GravadorTeleprompter
        aberto
        bloco={{ id: 10, position: 1, title: 'Abertura', narration: 'Texto do bloco.' }}
        totalBlocos={2}
        aoSalvarAudio={vi.fn()}
        aoDescartarRascunho={vi.fn()}
        aoFechar={aoFechar}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Gravar/i }))
    expect(screen.getByLabelText('Nível do microfone')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    const btnCancelar = await screen.findByRole('button', { name: /Continuar gravando/i })
    await waitFor(() => expect(btnCancelar).toHaveFocus())
    expect(aoFechar).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /Descartar gravação/i }))
    expect(stopTrack).toHaveBeenCalled()
    expect(aoFechar).toHaveBeenCalledTimes(1)
  })

  it('NotAllowedError oferece Importar áudio e Usar TTS local', async () => {
    mockMatchMedia(false)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' })),
      },
    })
    const aoAlternarParaImportar = vi.fn()
    const aoAlternarParaTts = vi.fn()
    const user = userEvent.setup()

    render(
      <GravadorTeleprompter
        aberto
        bloco={{ id: 10, position: 1, title: 'Abertura', narration: 'Texto.' }}
        totalBlocos={2}
        aoSalvarAudio={vi.fn()}
        aoDescartarRascunho={vi.fn()}
        aoAlternarParaImportar={aoAlternarParaImportar}
        aoAlternarParaTts={aoAlternarParaTts}
        aoFechar={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Gravar/i }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/microfone/i)

    await user.click(screen.getByRole('button', { name: /Importar áudio/i }))
    expect(aoAlternarParaImportar).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /Usar TTS local/i }))
    expect(aoAlternarParaTts).toHaveBeenCalledTimes(1)
  })

  it('ao receber no_speech_detected com hasDraft mantém modal aberto com player e Descartar rascunho', async () => {
    mockMatchMedia(false)
    instalarMockMidiaComSucesso()
    const aoSalvarAudio = vi.fn().mockRejectedValue({
      code: 'no_speech_detected',
      message: 'Nenhuma fala detectada.',
      usage: { hasDraft: true, durationUs: 1_500_000 },
    })
    const aoDescartarRascunho = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(
      <GravadorTeleprompter
        aberto
        bloco={{ id: 10, position: 1, title: 'Abertura', narration: 'Texto.' }}
        totalBlocos={2}
        aoSalvarAudio={aoSalvarAudio}
        aoDescartarRascunho={aoDescartarRascunho}
        aoFechar={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Gravar/i }))
    await user.click(screen.getByRole('button', { name: /Parar e salvar/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/fala/i)
    expect(document.querySelector('audio')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Gravar novamente/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Descartar rascunho/i }))
    expect(aoDescartarRascunho).toHaveBeenCalledWith(10)
  })
})
