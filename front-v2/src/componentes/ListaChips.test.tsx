import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ListaChips } from '~/componentes/ListaChips'

function EnvoltorioChips({
  iniciais = [],
  maxItens = 3,
  maxCharsItem = 12,
  prefixo,
  erro,
}: {
  iniciais?: string[]
  maxItens?: number
  maxCharsItem?: number
  prefixo?: '#'
  erro?: string | null
}) {
  const [itens, setItens] = useState(iniciais)
  return (
    <ListaChips
      itens={itens}
      aoAlterar={setItens}
      maxItens={maxItens}
      maxCharsItem={maxCharsItem}
      prefixo={prefixo}
      rotulo="Tags"
      placeholder="Digite e pressione Enter"
      erro={erro}
    />
  )
}

describe('<ListaChips>', () => {
  it('adiciona itens por Enter e vírgula, deduplica e anuncia em aria-live="polite"', async () => {
    const user = userEvent.setup()
    render(<EnvoltorioChips />)

    const entrada = screen.getByLabelText('Tags')
    await user.type(entrada, 'clipes{Enter}')
    expect(screen.getByText('clipes')).toBeInTheDocument()

    await user.type(entrada, 'live,')
    expect(screen.getByText('live')).toBeInTheDocument()

    // Deduplicação silenciosa mantém 2 itens
    await user.type(entrada, 'clipes{Enter}')
    expect(screen.getAllByRole('button', { name: /^Remover / })).toHaveLength(2)

    const regiaoViva = document.querySelector('[aria-live="polite"]')
    expect(regiaoViva?.textContent).toMatch(/live/i)
  })

  it('remove chip pelo botão acessível aria-label="Remover {item}" e anuncia remoção', async () => {
    const user = userEvent.setup()
    render(<EnvoltorioChips iniciais={['clipes', 'live']} />)

    const btnRemover = screen.getByRole('button', { name: 'Remover clipes' })
    await user.click(btnRemover)

    expect(screen.queryByRole('button', { name: 'Remover clipes' })).not.toBeInTheDocument()
    const regiaoViva = document.querySelector('[aria-live="polite"]')
    expect(regiaoViva?.textContent).toMatch(/remov/i)
  })

  it('aplica prefixo "#" automaticamente e bloqueia acima de maxItens ou maxCharsItem', async () => {
    const user = userEvent.setup()
    const aoAlterar = vi.fn()
    const { rerender } = render(
      <ListaChips
        itens={['#a', '#b']}
        aoAlterar={aoAlterar}
        maxItens={2}
        maxCharsItem={8}
        prefixo="#"
        rotulo="Hashtags"
      />,
    )

    const entrada = screen.getByLabelText('Hashtags')
    await user.type(entrada, 'terceiro{Enter}')
    expect(aoAlterar).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/máximo de 2/i)

    // Sem limite de quantidade, testa maxCharsItem e auto-prefixo #
    rerender(
      <ListaChips
        itens={[]}
        aoAlterar={aoAlterar}
        maxItens={5}
        maxCharsItem={8}
        prefixo="#"
        rotulo="Hashtags"
      />,
    )
    await user.clear(entrada)
    await user.type(entrada, 'muitolongomesmo{Enter}')
    expect(aoAlterar).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/8/)

    await user.clear(entrada)
    await user.type(entrada, 'curto{Enter}')
    expect(aoAlterar).toHaveBeenCalledWith(['#curto'])
  })
})
