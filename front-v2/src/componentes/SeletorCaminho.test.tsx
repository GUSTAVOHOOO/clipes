import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SeletorCaminho } from '~/componentes/SeletorCaminho'

describe('SeletorCaminho', () => {
  afterEach(() => {
    delete window.__CLIPES_E2E__
  })

  it('renderiza rótulo acessível, ajuda e dispara aoMudar ao digitar', async () => {
    const user = userEvent.setup()
    const aoMudar = vi.fn()

    render(
      <SeletorCaminho
        rotulo="Pasta onde salvar"
        valor="/tmp"
        aoMudar={aoMudar}
        ajuda="O Projeto será salvo nesta pasta."
        placeholder="C:\\Videos"
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Pasta onde salvar' })
    expect(input).toHaveValue('/tmp')
    expect(input).toHaveAttribute('aria-describedby')
    expect(screen.getByText('O Projeto será salvo nesta pasta.')).toHaveAttribute(
      'id',
      input.getAttribute('aria-describedby') ?? '',
    )
    expect(screen.getByRole('button', { name: 'Escolher pasta' })).toBeInTheDocument()

    await user.type(input, '/clipes')
    expect(aoMudar).toHaveBeenCalled()
  })

  it('exibe erro ligado por aria-describedby e aria-invalid', () => {
    render(
      <SeletorCaminho
        rotulo="Pasta do Projeto"
        valor=""
        aoMudar={() => {}}
        erro="Escolha uma pasta válida."
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Pasta do Projeto' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const descId = input.getAttribute('aria-describedby')
    expect(descId).toBeTruthy()
    expect(screen.getByText('Escolha uma pasta válida.')).toHaveAttribute('id', descId!)
  })

  it('usa rótulo "Escolher arquivo" em modo="arquivo" e respeita desabilitado', () => {
    render(
      <SeletorCaminho
        rotulo="Executável do FFmpeg"
        valor="/usr/bin/ffmpeg"
        aoMudar={() => {}}
        modo="arquivo"
        desabilitado
      />,
    )

    expect(screen.getByRole('textbox', { name: 'Executável do FFmpeg' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Escolher arquivo' })).toBeDisabled()
  })

  it('aplica caminho da fila E2E ao clicar em Escolher pasta e foca input no fallback sem fila', async () => {
    const user = userEvent.setup()
    const aoMudar = vi.fn()

    window.__CLIPES_E2E__ = {
      dialogQueue: ['/projetos/Canal.clipes'],
      dialogCalls: [],
      confirmQueue: [],
      confirmCalls: [],
      openedUrls: [],
      copiedText: null,
      updaterMode: 'off',
    }

    const { rerender } = render(
      <SeletorCaminho rotulo="Pasta .clipes" valor="" aoMudar={aoMudar} />,
    )

    await user.click(screen.getByRole('button', { name: 'Escolher pasta' }))
    expect(aoMudar).toHaveBeenCalledWith('/projetos/Canal.clipes')
    expect(window.__CLIPES_E2E__?.dialogCalls).toHaveLength(1)

    delete window.__CLIPES_E2E__
    rerender(<SeletorCaminho rotulo="Pasta .clipes" valor="" aoMudar={aoMudar} />)

    await user.click(screen.getByRole('button', { name: 'Escolher pasta' }))
    expect(screen.getByRole('textbox', { name: 'Pasta .clipes' })).toHaveFocus()
  })
})
