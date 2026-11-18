import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  CampoPermissao,
  errosPermissao,
  permissaoValida,
  type PermissaoFonte,
} from '~/componentes/CampoPermissao'

function WrapperControlado({
  inicial = { status: 'none' } as PermissaoFonte,
  somenteLeitura = false,
  obrigatorio = false,
  erro,
}: {
  inicial?: PermissaoFonte
  somenteLeitura?: boolean
  obrigatorio?: boolean
  erro?: string
}) {
  const [valor, setValor] = useState<PermissaoFonte>(inicial)
  return (
    <CampoPermissao
      valor={valor}
      aoMudar={setValor}
      somenteLeitura={somenteLeitura}
      obrigatorio={obrigatorio}
      erro={erro}
    />
  )
}

describe('<CampoPermissao>', () => {
  it('renderiza fieldset, legend e radiogroup acessíveis com opções none e granted', () => {
    render(<WrapperControlado />)

    const grupoCampos = screen.getByRole('group', { name: /Permissão/i })
    expect(grupoCampos.tagName).toBe('FIELDSET')

    const radiogroup = screen.getByRole('radiogroup')
    expect(radiogroup).toBeInTheDocument()

    const radioSem = screen.getByRole('radio', { name: /Sem permissão registrada/i })
    const radioCom = screen.getByRole('radio', { name: /Tenho permissão do criador/i })
    expect(radioSem).toHaveAttribute('aria-checked', 'true')
    expect(radioCom).toHaveAttribute('aria-checked', 'false')

    expect(screen.queryByLabelText(/Quem autorizou/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Onde foi autorizada/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Escopo/i)).not.toBeInTheDocument()
  })

  it('alternar entre none e granted mostra/oculta campos who, where, scope e exibe dica de tradução', async () => {
    const user = userEvent.setup()
    render(<WrapperControlado />)

    await user.click(screen.getByRole('radio', { name: /Tenho permissão do criador/i }))

    const campoQuem = screen.getByLabelText(/Quem autorizou/i)
    const campoOnde = screen.getByLabelText(/Onde foi autorizada/i)
    const campoEscopo = screen.getByLabelText(/Escopo/i)

    expect(campoQuem).toBeInTheDocument()
    expect(campoOnde).toBeInTheDocument()
    expect(campoEscopo).toBeInTheDocument()
    expect(screen.getByText(/Inclua 'tradução' se autorizada para traduzir legendas/i)).toBeInTheDocument()

    await user.type(campoQuem, 'Streamer X')
    await user.type(campoOnde, 'Discord')
    await user.type(campoEscopo, 'cortes e tradução')

    expect(campoQuem).toHaveValue('Streamer X')
    expect(campoOnde).toHaveValue('Discord')
    expect(campoEscopo).toHaveValue('cortes e tradução')

    await user.click(screen.getByRole('radio', { name: /Sem permissão registrada/i }))
    expect(screen.queryByLabelText(/Quem autorizou/i)).not.toBeInTheDocument()
  })

  it('valida campos obrigatórios quando granted e exibe erro ao desfocar campo vazio', async () => {
    const user = userEvent.setup()
    expect(permissaoValida({ status: 'none' })).toBe(true)
    expect(permissaoValida({ status: 'granted', who: '', where: 'Discord', scope: 'cortes' })).toBe(false)
    expect(permissaoValida({ status: 'granted', who: 'Criador', where: 'Email', scope: 'cortes' })).toBe(true)
    expect(errosPermissao({ status: 'granted', who: ' ', where: '', scope: 'ok' })).toMatchObject({
      who: expect.any(String),
      where: expect.any(String),
    })

    render(
      <WrapperControlado
        inicial={{ status: 'granted', who: '', where: '', scope: '' }}
        obrigatorio
        erro="Preencha todos os campos da Permissão."
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Preencha todos os campos da Permissão.')

    const campoQuem = screen.getByLabelText(/Quem autorizou/i)
    await user.click(campoQuem)
    await user.tab()

    expect(campoQuem).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/Informe quem autorizou/i)).toBeInTheDocument()
  })

  it('no modo somenteLeitura não altera estado nem dispara aoMudar', async () => {
    const user = userEvent.setup()
    const aoMudar = vi.fn()
    render(
      <CampoPermissao
        valor={{ status: 'granted', who: 'Canal Oficial', where: 'Email', scope: 'cortes e tradução' }}
        aoMudar={aoMudar}
        somenteLeitura
      />,
    )

    const radioSem = screen.getByRole('radio', { name: /Sem permissão registrada/i })
    expect(radioSem).toBeDisabled()
    await user.click(radioSem)
    expect(aoMudar).not.toHaveBeenCalled()

    const campoQuem = screen.getByLabelText(/Quem autorizou/i)
    await user.type(campoQuem, 'Outro')
    expect(aoMudar).not.toHaveBeenCalled()
    expect(campoQuem).toHaveValue('Canal Oficial')
  })

  it('suporta navegação por setas no radiogroup', async () => {
    const user = userEvent.setup()
    render(<WrapperControlado />)

    const radioSem = screen.getByRole('radio', { name: /Sem permissão registrada/i })
    radioSem.focus()
    await user.keyboard('{ArrowRight}')

    const radioCom = screen.getByRole('radio', { name: /Tenho permissão do criador/i })
    expect(radioCom).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText(/Quem autorizou/i)).toBeInTheDocument()
  })
})
