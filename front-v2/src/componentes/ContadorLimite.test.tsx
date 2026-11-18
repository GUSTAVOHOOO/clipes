import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContadorLimite, contarBytesUtf8 } from '~/componentes/ContadorLimite'

describe('<ContadorLimite>', () => {
  it('exibe contagem em tabular-nums para caracteres, bytes UTF-8 multi-byte e tags', () => {
    expect(contarBytesUtf8('é 😀')).toBe(7)

    const { rerender } = render(<ContadorLimite usado={62} maximo={100} unidade="caracteres" />)
    const leitura = screen.getByText('62/100 caracteres')
    expect(leitura).toHaveClass('num')

    rerender(<ContadorLimite usado={contarBytesUtf8('é 😀')} maximo={5000} unidade="bytes" />)
    expect(screen.getByText('7/5000 bytes')).toBeInTheDocument()

    rerender(<ContadorLimite usado={3} maximo={30} unidade="tags" />)
    expect(screen.getByText('3/30 tags')).toBeInTheDocument()
  })

  it('alterna indicador orientativo Curto / Ideal / Pode truncar no mobile sem bloquear', () => {
    const { rerender } = render(
      <ContadorLimite usado={35} maximo={100} unidade="caracteres" faixaIdeal={[50, 70]} />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Curto')

    rerender(<ContadorLimite usado={60} maximo={100} unidade="caracteres" faixaIdeal={[50, 70]} />)
    expect(screen.getByRole('status')).toHaveTextContent('Ideal')

    rerender(<ContadorLimite usado={82} maximo={100} unidade="caracteres" faixaIdeal={[50, 70]} />)
    expect(screen.getByRole('status')).toHaveTextContent('Pode truncar no mobile')
  })

  it('exibe estado de erro quando usado ultrapassa maximo', () => {
    render(<ContadorLimite usado={5001} maximo={5000} unidade="bytes" />)
    const texto = screen.getByText('5001/5000 bytes')
    expect(texto.className).toMatch(/erro|perigo|text-erro/)
    expect(screen.getByRole('status')).toHaveTextContent(/acima do limite/i)
  })
})
