import { ProvedorDicas, ProvedorToast } from '@ds'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ErroCore } from '~/core/cliente'
import { DialogoResolverIncerteza } from '~/componentes/DialogoResolverIncerteza'

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

function envolver(ui: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>{ui}</ProvedorToast>
    </ProvedorDicas>
  )
}

describe('<DialogoResolverIncerteza>', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('chama jobs.estimate ao abrir, exibe ResumoCustoPrivacidade/aviso pago e mantém foco inicial em Cancelar', async () => {
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'jobs.estimate') {
        return {
          safety: 'paid',
          estimate: { kind: 'usd', minMicroUsd: 500, maxMicroUsd: 1800, inputTokens: 8000, windows: 1 },
        }
      }
      return null
    })

    render(
      envolver(
        <DialogoResolverIncerteza
          aberto
          jobId={2}
          rotuloJanela="Janela 3 (30:00–45:00)"
          aoFechar={vi.fn()}
          aoResolver={vi.fn()}
        />,
      ),
    )

    const dialogo = await screen.findByRole('alertdialog')
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('jobs.estimate', { id: 2 })
    })

    expect(dialogo).toHaveTextContent(/Janela 3/)
    expect(dialogo).toHaveTextContent(/cobrança|pago|custo/i)

    const btnCancelar = within(dialogo).getByRole('button', { name: 'Cancelar' })
    await waitFor(() => {
      expect(document.activeElement).toBe(btnCancelar)
    })
  })

  it('permite repetir chamada (jobs.retry com confirmed: true) e notifica aoResolver', async () => {
    const user = userEvent.setup()
    const aoFechar = vi.fn()
    const aoResolver = vi.fn()

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'jobs.estimate') return { safety: 'paid', estimate: { kind: 'unknown' } }
      return null
    })

    render(
      envolver(
        <DialogoResolverIncerteza
          aberto
          jobId={42}
          rotuloJanela="Janela 2"
          aoFechar={aoFechar}
          aoResolver={aoResolver}
        />,
      ),
    )

    const dialogo = await screen.findByRole('alertdialog')
    const btnRepetir = await within(dialogo).findByRole('button', { name: /Repetir chamada/i })
    await waitFor(() => expect(btnRepetir).toBeEnabled())
    await user.click(btnRepetir)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('jobs.retry', { id: 42, confirmed: true })
    })
    expect(aoResolver).toHaveBeenCalledWith('retry')
    expect(aoFechar).toHaveBeenCalledTimes(1)
  })

  it('permite descartar chamada (jobs.discard) e mantém diálogo aberto em role="alert" se falhar', async () => {
    const user = userEvent.setup()
    const aoFechar = vi.fn()
    const aoResolver = vi.fn()

    let deveFalhar = true
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'jobs.estimate') return { safety: 'free', estimate: { kind: 'zero' } }
      if (cmd === 'jobs.discard' && deveFalhar) {
        throw new ErroCore('project_busy', 'Projeto ocupado no momento.')
      }
      return null
    })

    render(
      envolver(
        <DialogoResolverIncerteza
          aberto
          jobId={7}
          rotuloJanela="Janela 1"
          aoFechar={aoFechar}
          aoResolver={aoResolver}
        />,
      ),
    )

    const dialogo = await screen.findByRole('alertdialog')
    const btnDescartar = await within(dialogo).findByRole('button', { name: /Descartar chamada/i })
    await waitFor(() => expect(btnDescartar).toBeEnabled())

    await user.click(btnDescartar)
    const alerta = await within(dialogo).findByRole('alert')
    expect(alerta).toHaveTextContent(/tarefa ativa|ocupad/i)
    expect(aoFechar).not.toHaveBeenCalled()

    deveFalhar = false
    await user.click(btnDescartar)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('jobs.discard', { id: 7 })
    })
    expect(aoResolver).toHaveBeenCalledWith('discard')
    expect(aoFechar).toHaveBeenCalledTimes(1)
  })

  it('UI-34: usa tokens do design-system-v2 sem variáveis CSS v1 (--borda, --raio-m, --texto-*)', async () => {
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'jobs.estimate') {
        return {
          safety: 'paid',
          estimate: { kind: 'usd', minMicroUsd: 500, maxMicroUsd: 1800, inputTokens: 8000, windows: 1 },
        }
      }
      return null
    })

    render(
      envolver(
        <DialogoResolverIncerteza
          aberto
          jobId={2}
          rotuloJanela="Janela 3"
          aoFechar={vi.fn()}
          aoResolver={vi.fn()}
        />,
      ),
    )

    const dialogo = await screen.findByRole('alertdialog')
    const avisoPago = await within(dialogo).findByText('Cobrança possível')
    const caixaAviso = avisoPago.closest('div')
    expect(caixaAviso).not.toBeNull()
    expect(caixaAviso).toHaveClass('bg-area', 'rounded-area')

    const textoRodape = within(dialogo).getByText('Ou encerre esta tentativa pendente:')
    expect(textoRodape).toHaveClass('text-pequeno', 'text-t3')
    const rodape = textoRodape.closest('div')
    expect(rodape).toHaveClass('border-t', 'border-linha')

    const classes = Array.from(dialogo.querySelectorAll('*'))
      .map((el) => el.getAttribute('class') ?? '')
      .join(' ')
    expect(classes).not.toMatch(/var\(--(borda|raio-|texto-|texto\))/)
  })
})
