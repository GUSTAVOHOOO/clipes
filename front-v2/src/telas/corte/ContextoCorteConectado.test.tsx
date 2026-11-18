import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { criarFila, type Fila } from '~/core/progresso'
import { ContextoCorteConectado } from '~/telas/corte/ContextoCorteConectado'

const chamarMock = vi.fn()
let filaTeste: Fila = criarFila(() => 'demo')

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

vi.mock('~/core/progresso', async () => {
  const atual = await vi.importActual<typeof import('~/core/progresso')>('~/core/progresso')
  return {
    ...atual,
    useFila: () => atual.useFila(filaTeste),
  }
})

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>{children}</ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>
  )
}

const FONTES_MOCK = [
  {
    id: 4,
    path: '/videos/Live_12_11_final.mp4',
    status: 'available',
    available: true,
    verified: true,
    audio_track: 1,
    origin_url: null,
    language: 'pt',
    permission: { status: 'granted', who: 'Criador', where: 'Discord', scope: 'cortes' },
  },
]

function configurarMocksPadrao() {
  chamarMock.mockImplementation(async (comando: string, args: Record<string, unknown> = {}) => {
    if (comando === 'sources.list') return FONTES_MOCK
    if (comando === 'selection.list') {
      if (args.source_id === 4) {
        return [
          { id: 1, videoKind: 'direct', state: 'completed', revision: 2, revisions: [1, 2], minUs: 20e6, maxUs: 60e6, planState: 'full' },
          { id: 2, videoKind: 'transformed', state: 'completed', revision: 1, revisions: [1], minUs: 20e6, maxUs: 60e6, planState: 'full' },
        ]
      }
      return []
    }
    if (comando === 'selection.get') {
      if (args.run === 1) {
        return {
          run: { id: 1, transcriptId: 4, videoKind: 'direct', revision: 2, revisions: [1, 2] },
          windows: [],
          candidates: [
            { id: 101, startId: 10, endId: 14, startUs: 90e6, endUs: 140e6, title: 'Abertura da live' },
            { id: 102, startId: 40, endId: 41, startUs: 390e6, endUs: 410e6, title: 'Corte direto aprovado' },
          ],
        }
      }
      if (args.run === 2) {
        return {
          run: { id: 2, transcriptId: 4, videoKind: 'transformed', revision: 1, revisions: [1] },
          windows: [],
          candidates: [
            { id: 201, startId: 10, endId: 14, startUs: 90e6, endUs: 140e6, title: 'A virada do jogo' },
            { id: 202, startId: 40, endId: 41, startUs: 390e6, endUs: 410e6, title: 'Segundo transformado' },
          ],
        }
      }
    }
    if (comando === 'selection.review') {
      if (args.run === 1) {
        return {
          run: 1,
          canUndo: false,
          items: [
            { candidate: 101, status: 'pending', adjusted: false, videoKind: 'direct', startId: 10, endId: 14, startUs: 90e6, endUs: 140e6, startText: 'Frase 10', endText: 'Frase 14' },
            { candidate: 102, status: 'approved', adjusted: false, videoKind: 'direct', startId: 40, endId: 41, startUs: 390e6, endUs: 410e6, startText: 'Frase 40', endText: 'Frase 41' },
          ],
        }
      }
      if (args.run === 2) {
        return {
          run: 2,
          canUndo: false,
          items: [
            { candidate: 201, status: 'approved', adjusted: false, videoKind: 'transformed', startId: 10, endId: 14, startUs: 90e6, endUs: 140e6, startText: 'Frase 10', endText: 'Frase 14' },
            { candidate: 202, status: 'approved', adjusted: false, videoKind: 'transformed', startId: 40, endId: 41, startUs: 390e6, endUs: 410e6, startText: 'Frase 40', endText: 'Frase 41' },
          ],
        }
      }
    }
    if (comando === 'guardrails.check') {
      return {
        scope: 'single',
        directMonetizationAck: false,
        needsDirectNotice: false,
        videoKind: 'transformed',
        hasDirect: false,
        hasTransformed: true,
        totalCuts: 1,
        durationUs: 50_000_000,
        over60s: false,
        over60sCount: 0,
        shortClaimLimitUs: 60_000_000,
        permission: { status: 'granted', grantedCount: 1, missingCount: 0, totalCount: 1, who: 'Criador', where: 'Discord', scope: 'cortes' },
        script: { applicable: true, exists: true, approved: true, pendingBlocks: 0, totalBlocks: 2 },
        narration: { applicable: true, hasTts: false, generatedBlocks: 0, totalBlocks: 2, voices: [], freezeTailUs: 0, longFreezeTail: false },
        audio: { hasAudio: false, assetCount: 0, unverifiedCount: 0 },
      }
    }
    if (comando === 'export.captions') {
      return { missingGlyphs: [], emojiRemoved: 0, words: [] }
    }
    if (comando === 'export.settings') {
      return { last_directory: '/test/exports' }
    }
    return null
  })
}

describe('ContextoCorteConectado', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => 'demo')
    configurarMocksPadrao()
    window.location.hash = '#/projeto/demo/corte/201/editar?run=2'
  })

  afterEach(() => {
    window.location.hash = ''
  })

  it('usa a execução de ?run=:runId para < Anterior | Próximo aprovado > e preserva ?run= na URL', async () => {
    const user = userEvent.setup()
    render(
      <Wrapper>
        <ContextoCorteConectado projetoId="demo" corteId="201" subAbaAtiva="editar" runId="2" />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText('A virada do jogo')).toBeInTheDocument()
    })
    expect(screen.getByText('Corte 1/2')).toBeInTheDocument()
    expect(screen.getByText('Vídeo transformado')).toBeInTheDocument()

    // Todas as 3 sub-abas visíveis para Vídeo transformado
    const nav = screen.getByRole('navigation', { name: 'Etapas do Corte' })
    expect(nav.querySelectorAll('a')).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'Editar' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Transformar' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Empacotar' })).toBeInTheDocument()

    const btnAnterior = screen.getByRole('button', { name: /Corte anterior/i })
    const btnProximo = screen.getByRole('button', { name: /Próximo aprovado/i })
    expect(btnAnterior).toBeDisabled()
    expect(btnProximo).toBeEnabled()

    await user.click(btnProximo)
    await waitFor(() => {
      expect(window.location.hash).toBe('#/projeto/demo/corte/202/editar?run=2')
    })
  })

  it('agrega todos os aprovados do Projeto quando ?run= está ausente', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/projeto/demo/corte/102/editar'

    render(
      <Wrapper>
        <ContextoCorteConectado projetoId="demo" corteId="102" subAbaAtiva="editar" />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText('Corte direto aprovado')).toBeInTheDocument()
    })
    // 102 (run 1) + 201, 202 (run 2) = 3 aprovados no Projeto
    expect(screen.getByText('Corte 1/3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Próximo aprovado/i }))
    await waitFor(() => {
      expect(window.location.hash).toBe('#/projeto/demo/corte/201/editar')
    })
  })

  it('oculta Transformar em Corte direto e exibe "Converter em Vídeo transformado" desabilitado com <Dica> sem expor ticket (UI-12)', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/projeto/demo/corte/102/editar'

    render(
      <Wrapper>
        <ContextoCorteConectado projetoId="demo" corteId="102" subAbaAtiva="editar" />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText('Corte direto aprovado')).toBeInTheDocument()
    })
    expect(screen.getByText('Corte direto')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Transformar' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Editar' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Empacotar' })).toBeInTheDocument()

    const btnConverter = screen.getByRole('button', { name: 'Converter em Vídeo transformado' })
    expect(btnConverter).toBeDisabled()

    await user.hover(btnConverter.parentElement!)
    const dicaTexto = await screen.findByText(
      'A conversão individual para Vídeo transformado ainda não está disponível nesta versão.',
    )
    expect(dicaTexto).toBeInTheDocument()
    expect(dicaTexto.textContent ?? '').not.toMatch(/#\d+/)
  })

  it('exibe "Corte #avulso-..." sem Transformar/Empacotar e desabilita navegação anterior/próximo', async () => {
    window.location.hash = '#/projeto/demo/corte/avulso-4-10-14/editar'

    render(
      <Wrapper>
        <ContextoCorteConectado projetoId="demo" corteId="avulso-4-10-14" subAbaAtiva="editar" />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText('Corte #avulso-4-10-14')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Corte anterior/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Próximo aprovado/i })).toBeDisabled()
    expect(screen.queryByRole('link', { name: 'Transformar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Empacotar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Converter em Vídeo transformado' })).not.toBeInTheDocument()
  })

  it('executa aoAntesDeNavegar (editor.flush) antes de navegar e cancela se retornar false', async () => {
    const user = userEvent.setup()
    const aoAntesDeNavegar = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    render(
      <Wrapper>
        <ContextoCorteConectado
          projetoId="demo"
          corteId="201"
          subAbaAtiva="editar"
          runId="2"
          aoAntesDeNavegar={aoAntesDeNavegar}
        />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText('A virada do jogo')).toBeInTheDocument()
    })

    // 1ª tentativa: retorna false -> cancela navegação
    await user.click(screen.getByRole('button', { name: /Próximo aprovado/i }))
    expect(aoAntesDeNavegar).toHaveBeenCalledTimes(1)
    expect(window.location.hash).toBe('#/projeto/demo/corte/201/editar?run=2')

    // 2ª tentativa: retorna true -> navega
    await user.click(screen.getByRole('link', { name: 'Empacotar' }))
    await waitFor(() => {
      expect(window.location.hash).toBe('#/projeto/demo/corte/201/empacotar?run=2')
    })
    expect(aoAntesDeNavegar).toHaveBeenCalledTimes(2)
  })

  it('responde aos atalhos Alt+PageDown, Alt+PageUp e Ctrl+E', async () => {
    const aoAntesDeNavegar = vi.fn().mockResolvedValue(true)

    const { rerender } = render(
      <Wrapper>
        <ContextoCorteConectado
          projetoId="demo"
          corteId="201"
          subAbaAtiva="editar"
          runId="2"
          aoAntesDeNavegar={aoAntesDeNavegar}
        />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText('A virada do jogo')).toBeInTheDocument()
    })

    // Alt+PageDown vai para 202
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', altKey: true, bubbles: true }))
    })
    await waitFor(() => {
      expect(window.location.hash).toBe('#/projeto/demo/corte/202/editar?run=2')
    })

    // Re-renderiza no 202 e Alt+PageUp volta para 201
    rerender(
      <Wrapper>
        <ContextoCorteConectado
          projetoId="demo"
          corteId="202"
          subAbaAtiva="editar"
          runId="2"
          aoAntesDeNavegar={aoAntesDeNavegar}
        />
      </Wrapper>,
    )
    await waitFor(() => {
      expect(screen.getByText('Segundo transformado')).toBeInTheDocument()
    })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', altKey: true, bubbles: true }))
    })
    await waitFor(() => {
      expect(window.location.hash).toBe('#/projeto/demo/corte/201/editar?run=2')
    })

    // Ctrl+E abre diálogo de exportação
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true }))
    })
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})
