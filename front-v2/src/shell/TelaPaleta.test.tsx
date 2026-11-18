import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Paleta, ProvedorDicas, SeletorProjeto } from '@ds'

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

describe('SeletorProjeto (@ds)', () => {
  it('dispara aoSelecionar, aoTrocar, aoConfigurar e aoFechar ao clicar nos itens do menu', async () => {
    const user = userEvent.setup()
    const aoSelecionar = vi.fn()
    const aoTrocar = vi.fn()
    const aoConfigurar = vi.fn()
    const aoFechar = vi.fn()

    render(
      <ProvedorDicas>
        <SeletorProjeto
          nome="Canal Principal"
          outros={['Canal Secundário']}
          aoSelecionar={aoSelecionar}
          aoTrocar={aoTrocar}
          aoConfigurar={aoConfigurar}
          aoFechar={aoFechar}
        />
      </ProvedorDicas>,
    )

    await user.click(screen.getByRole('button', { name: /Canal Principal/i }))
    await user.click(await screen.findByRole('menuitem', { name: 'Canal Secundário' }))
    expect(aoSelecionar).toHaveBeenCalledWith('Canal Secundário')

    await user.click(screen.getByRole('button', { name: /Canal Principal/i }))
    await user.click(await screen.findByRole('menuitem', { name: 'Trocar Projeto…' }))
    expect(aoTrocar).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /Canal Principal/i }))
    await user.click(await screen.findByRole('menuitem', { name: 'Configurações do Projeto' }))
    expect(aoConfigurar).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /Canal Principal/i }))
    await user.click(await screen.findByRole('menuitem', { name: 'Fechar Projeto' }))
    expect(aoFechar).toHaveBeenCalledTimes(1)
  })
})

describe('Paleta (@ds)', () => {
  it('exibe o rodapé "Enter para executar · Esc para fechar" quando aberta', () => {
    render(
      <Paleta
        aberto
        aoMudarAberto={() => {}}
        comandos={[{ id: 'cmd.teste', rotulo: 'Comando teste', aoExecutar: () => {} }]}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Paleta de comandos' })).toBeInTheDocument()
    expect(screen.getByText('Enter para executar · Esc para fechar')).toBeInTheDocument()
  })
})
