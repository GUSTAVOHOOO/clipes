import { ProvedorDicas, ProvedorToast } from '@ds'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErroCore } from '~/core/cliente'
import { PainelTranscricaoTransformar } from '~/telas/corte/transformar/PainelTranscricaoTransformar'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

function envolver(children: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>{children}</ProvedorToast>
    </ProvedorDicas>
  )
}

const FRASES_MOCK = [
  { id: 10, start_us: 10_000_000, end_us: 14_000_000, language: 'pt', text: 'Primeira frase do corte.', first_position: 100, last_position: 103 },
  { id: 11, start_us: 14_000_000, end_us: 19_000_000, language: 'pt', text: 'Segunda frase importante.', first_position: 110, last_position: 112 },
  { id: 12, start_us: 19_000_000, end_us: 25_000_000, language: 'pt', text: 'Fechamento da ideia.', first_position: 120, last_position: 122 },
]

describe('<PainelTranscricaoTransformar>', () => {
  afterEach(() => {
    chamarMock.mockReset()
  })

  it('carrega Frases [startId..endId] via transcription.sentences e exibe #ID e timecode', async () => {
    chamarMock.mockResolvedValueOnce(FRASES_MOCK)

    render(
      envolver(
        <PainelTranscricaoTransformar
          sourceId={3}
          startId={10}
          endId={12}
          aberto={true}
          refsAtivas={[]}
          aoAlternarAberto={vi.fn()}
          aoClicarFrase={vi.fn()}
        />,
      ),
    )

    await waitFor(() => {
      expect(screen.getByText('Primeira frase do corte.')).toBeInTheDocument()
    })

    expect(chamarMock).toHaveBeenCalledWith('transcription.sentences', {
      source_id: 3,
      after_id: 9,
      limit: 3,
    })
    expect(screen.getByText('#10')).toBeInTheDocument()
    expect(screen.getByText('00:00:10')).toBeInTheDocument()
    expect(screen.getByText('Segunda frase importante.')).toBeInTheDocument()
    expect(screen.getByText('Fechamento da ideia.')).toBeInTheDocument()
  })

  it('marca visualmente as Frases presentes em refsAtivas e dispara aoClicarFrase ao clicar', async () => {
    chamarMock.mockResolvedValueOnce(FRASES_MOCK)
    const aoClicarFrase = vi.fn()
    const user = userEvent.setup()

    render(
      envolver(
        <PainelTranscricaoTransformar
          sourceId={3}
          startId={10}
          endId={12}
          aberto={true}
          refsAtivas={[11]}
          aoAlternarAberto={vi.fn()}
          aoClicarFrase={aoClicarFrase}
        />,
      ),
    )

    await waitFor(() => {
      expect(screen.getByText('Segunda frase importante.')).toBeInTheDocument()
    })

    const btn10 = screen.getByRole('button', { name: /#10/i })
    const btn11 = screen.getByRole('button', { name: /#11/i })
    expect(btn10).toHaveAttribute('aria-pressed', 'false')
    expect(btn11).toHaveAttribute('aria-pressed', 'true')
    expect(btn11.className).toContain('marcado')

    await user.click(btn10)
    expect(aoClicarFrase).toHaveBeenCalledWith(10)

    await user.click(btn11)
    expect(aoClicarFrase).toHaveBeenCalledWith(11)
  })

  it('rola até a Frase quando fraseDestacadaId muda (ex.: clique em chip do ângulo)', async () => {
    chamarMock.mockResolvedValueOnce(FRASES_MOCK)
    const scrollSpy = vi.fn()

    const { rerender } = render(
      envolver(
        <PainelTranscricaoTransformar
          sourceId={3}
          startId={10}
          endId={12}
          aberto={true}
          refsAtivas={[]}
          fraseDestacadaId={null}
          aoAlternarAberto={vi.fn()}
          aoClicarFrase={vi.fn()}
        />,
      ),
    )

    await waitFor(() => {
      expect(screen.getByText('Fechamento da ideia.')).toBeInTheDocument()
    })

    const btn12 = screen.getByRole('button', { name: /#12/i })
    btn12.scrollIntoView = scrollSpy

    rerender(
      envolver(
        <PainelTranscricaoTransformar
          sourceId={3}
          startId={10}
          endId={12}
          aberto={true}
          refsAtivas={[]}
          fraseDestacadaId={12}
          aoAlternarAberto={vi.fn()}
          aoClicarFrase={vi.fn()}
        />,
      ),
    )

    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled()
    })
    expect(btn12).toHaveAttribute('data-destacada', 'true')
  })

  it('exibe faixa recolhida quando aberto=false e alterna via aoAlternarAberto', async () => {
    chamarMock.mockResolvedValueOnce(FRASES_MOCK)
    const aoAlternarAberto = vi.fn()
    const user = userEvent.setup()

    render(
      envolver(
        <PainelTranscricaoTransformar
          sourceId={3}
          startId={10}
          endId={12}
          aberto={false}
          refsAtivas={[]}
          aoAlternarAberto={aoAlternarAberto}
          aoClicarFrase={vi.fn()}
        />,
      ),
    )

    const abrirBtn = screen.getByRole('button', { name: /Abrir Transcrição do Corte/i })
    await user.click(abrirBtn)
    expect(aoAlternarAberto).toHaveBeenCalledTimes(1)
  })

  it('renderiza BannerErroCore em role="alert" quando transcription.sentences falha e permite tentar de novo', async () => {
    chamarMock
      .mockRejectedValueOnce(new ErroCore('transcript_missing', 'Sem transcrição'))
      .mockResolvedValueOnce(FRASES_MOCK)
    const user = userEvent.setup()

    render(
      envolver(
        <PainelTranscricaoTransformar
          sourceId={3}
          startId={10}
          endId={12}
          aberto={true}
          refsAtivas={[]}
          aoAlternarAberto={vi.fn()}
          aoClicarFrase={vi.fn()}
        />,
      ),
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Tentar de novo/i }))
    await waitFor(() => {
      expect(screen.getByText('Primeira frase do corte.')).toBeInTheDocument()
    })
  })
})
