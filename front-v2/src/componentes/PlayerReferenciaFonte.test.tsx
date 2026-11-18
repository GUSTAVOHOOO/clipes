import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProvedorDicas } from '@ds'
import { PlayerReferenciaFonte } from '~/componentes/PlayerReferenciaFonte'

describe('<PlayerReferenciaFonte>', () => {
  it('aponta <video> para mediaUrl("source/" + fonteId), reage a seekUs e emite aoMudarTempoUs', () => {
    const aoMudarTempoUs = vi.fn()
    const { rerender } = render(
      <ProvedorDicas>
        <PlayerReferenciaFonte
          fonteId={4}
          disponivel
          duracaoUs={3_600_000_000}
          seekUs={null}
          aoMudarTempoUs={aoMudarTempoUs}
        />
      </ProvedorDicas>,
    )

    const video = screen.getByLabelText(/Player de referência da Fonte/i) as HTMLVideoElement
    expect(video.tagName.toLowerCase()).toBe('video')
    expect(video.getAttribute('src')).toContain('/__clipes-media__/source/4')

    rerender(
      <ProvedorDicas>
        <PlayerReferenciaFonte
          fonteId={4}
          disponivel
          duracaoUs={3_600_000_000}
          seekUs={14_500_000}
          aoMudarTempoUs={aoMudarTempoUs}
        />
      </ProvedorDicas>,
    )

    expect(video.currentTime).toBeCloseTo(14.5, 2)

    video.currentTime = 22.25
    fireEvent.timeUpdate(video)
    expect(aoMudarTempoUs).toHaveBeenCalledWith(22_250_000)
  })

  it('degrada graciosamente em erro de codec sem quebrar a página', () => {
    render(
      <ProvedorDicas>
        <PlayerReferenciaFonte fonteId={1} disponivel duracaoUs={60_000_000} />
      </ProvedorDicas>,
    )

    const video = screen.getByLabelText(/Player de referência da Fonte/i)
    fireEvent.error(video)

    expect(
      screen.getByText(/Não foi possível reproduzir o vídeo neste formato na WebView/i),
    ).toBeInTheDocument()
    const audio = screen.getByLabelText(/Reprodução de áudio de referência/i) as HTMLAudioElement
    expect(audio.getAttribute('src')).toContain('/__clipes-media__/source/1')
  })

  it('quando disponivel=false (offline/changed), não carrega mídia e exibe banner de relocalização (#296)', async () => {
    const user = userEvent.setup()
    const aoPedirRelocalizacao = vi.fn()

    const { container } = render(
      <ProvedorDicas>
        <PlayerReferenciaFonte
          fonteId={2}
          disponivel={false}
          aoPedirRelocalizacao={aoPedirRelocalizacao}
        />
      </ProvedorDicas>,
    )

    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('audio')).toBeNull()
    expect(screen.getByText(/Vídeo indisponível no disco/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Relocalizar \/ Verificar/i }))
    expect(aoPedirRelocalizacao).toHaveBeenCalledTimes(1)
  })

  it('UI-28: Dica de "Tira de miniaturas" não expõe referência de ticket nem comandos internos', async () => {
    const user = userEvent.setup()
    render(
      <ProvedorDicas>
        <PlayerReferenciaFonte fonteId={4} disponivel duracaoUs={3_600_000_000} />
      </ProvedorDicas>,
    )

    const btnMiniaturas = screen.getByRole('button', { name: /Tira de miniaturas/i })
    await user.hover(btnMiniaturas.parentElement as HTMLElement)

    const dica = await screen.findByText(/Tira de miniaturas ainda indisponível para esta Fonte\./i)
    expect(dica).toBeInTheDocument()
    expect(screen.queryByText(/#\d{2,4}\b|jobs\.preview|clipes-media/)).not.toBeInTheDocument()
  })
})
