import { ChecklistGuardaCorpos } from '@ds'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

const itens = [{ id: 'a', estado: 'atencao' as const, titulo: 'Fonte ausente' }]

describe('ChecklistGuardaCorpos (UI-85)', () => {
  it('abre quando os avisos chegam depois da primeira renderizacao', () => {
    const { rerender } = render(<ChecklistGuardaCorpos escopo="project" itens={[]} abertoPorPadrao={false} />)
    expect(screen.getByRole('button', { name: /Antes de exportar/i })).toHaveAttribute('aria-expanded', 'false')
    rerender(<ChecklistGuardaCorpos escopo="project" itens={itens} abertoPorPadrao />)
    expect(screen.getByRole('button', { name: /Antes de exportar/i })).toHaveAttribute('aria-expanded', 'true')
  })

  it('nao reabre depois que a pessoa recolheu manualmente', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ChecklistGuardaCorpos escopo="project" itens={itens} abertoPorPadrao />)
    await user.click(screen.getByRole('button', { name: /Antes de exportar/i }))
    rerender(<ChecklistGuardaCorpos escopo="project" itens={[...itens]} abertoPorPadrao />)
    expect(screen.getByRole('button', { name: /Antes de exportar/i })).toHaveAttribute('aria-expanded', 'false')
  })
})
