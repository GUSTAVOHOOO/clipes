import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErroCore } from '~/core/cliente'
import { criarFila, type Fila } from '~/core/progresso'
import type { FonteProjeto } from '~/stores/fontesProjeto'
import { DialogoExportarCorte } from '~/telas/corte/DialogoExportarCorte'

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
      <ProvedorToast>{children}</ProvedorToast>
    </ProvedorDicas>
  )
}

const FONTE_ONLINE: FonteProjeto = {
  id: 4,
  path: '/videos/Live_12_11_final.mp4',
  status: 'available',
  available: true,
  verified: true,
  audio_track: 1,
  origin_url: null,
  language: 'pt',
  permission: { status: 'granted', who: 'Criador', where: 'Discord', scope: 'cortes' },
}

const CORTE_PADRAO = {
  corteId: '102',
  titulo: 'A virada do jogo',
  videoKind: 'direct' as const,
  sourceId: 4,
  startId: 40,
  endId: 41,
  candidateId: 102,
  clipId: 11,
}

function guardrailsBase(override: Record<string, unknown> = {}) {
  return {
    scope: 'single',
    directMonetizationAck: false,
    needsDirectNotice: true,
    videoKind: 'direct',
    hasDirect: true,
    hasTransformed: false,
    totalCuts: 1,
    durationUs: 50_000_000,
    over60s: false,
    over60sCount: 0,
    shortClaimLimitUs: 60_000_000,
    permission: { status: 'granted', grantedCount: 1, missingCount: 0, totalCount: 1, who: 'Criador', where: 'Discord', scope: 'cortes' },
    script: { applicable: false },
    narration: { applicable: false },
    audio: { hasAudio: false, assetCount: 0, unverifiedCount: 0 },
    ...override,
  }
}

describe('DialogoExportarCorte', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    filaTeste = criarFila(() => 'demo')
    window.location.hash = '#/projeto/demo/corte/102/editar'
  })

  afterEach(() => {
    delete window.__CLIPES_E2E__
    window.location.hash = ''
  })

  it('cobre loading (<Esqueleto>) e estado empty quando sem Corte', async () => {
    let resolver!: (v: unknown) => void
    chamarMock.mockImplementation(() => new Promise((r) => { resolver = r }))

    const { rerender } = render(
      <Wrapper>
        <DialogoExportarCorte
          aberto
          aoFechar={vi.fn()}
          projetoId="demo"
          corte={CORTE_PADRAO}
          fonte={FONTE_ONLINE}
          fila={filaTeste}
        />
      </Wrapper>,
    )

    expect(screen.getByRole('status', { name: 'Carregando conferência de exportação' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Iniciar exportação' })).toBeDisabled()

    resolver(guardrailsBase())

    rerender(
      <Wrapper>
        <DialogoExportarCorte
          aberto
          aoFechar={vi.fn()}
          projetoId="demo"
          corte={null}
          fonte={null}
          fila={filaTeste}
        />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText('Nenhum Corte selecionado')).toBeInTheDocument()
    })
  })

  it('bloqueia exportação em Fonte offline e permite relocalizar via sources.relocate', async () => {
    const user = userEvent.setup()
    const fonteOffline: FonteProjeto = { ...FONTE_ONLINE, status: 'offline', available: false }
    window.__CLIPES_E2E__ = {
      dialogQueue: ['/videos/Live_12_11_final.mp4'],
      dialogCalls: [],
    }

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'sources.relocate') return FONTE_ONLINE
      if (cmd === 'guardrails.check') return guardrailsBase()
      if (cmd === 'export.captions') return { missingGlyphs: [], emojiRemoved: 0, words: [] }
      if (cmd === 'export.settings') return { last_directory: '/test/exports' }
      return null
    })

    render(
      <Wrapper>
        <DialogoExportarCorte
          aberto
          aoFechar={vi.fn()}
          projetoId="demo"
          corte={CORTE_PADRAO}
          fonte={fonteOffline}
          fila={filaTeste}
        />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Iniciar exportação' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Relocalizar Fonte' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('sources.relocate', {
        id: 4,
        path: '/videos/Live_12_11_final.mp4',
        confirmed: true,
      })
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Iniciar exportação' })).toBeEnabled()
    })
  })

  it('carrega checklist, confirma guardrails.ack_direct_notice, bloqueia missingGlyphs e envia export.start com SeletorCaminho (#303)', async () => {
    const user = userEvent.setup()
    const aoIrParaTranscricao = vi.fn()
    let acked = false
    let comGlifoFaltando = true

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'guardrails.check') {
        return guardrailsBase({
          directMonetizationAck: acked,
          needsDirectNotice: !acked,
          over60s: true,
          audio: { hasAudio: true, assetCount: 1, unverifiedCount: 1 },
        })
      }
      if (cmd === 'guardrails.ack_direct_notice') {
        acked = true
        return { directMonetizationAck: true }
      }
      if (cmd === 'export.captions') {
        return {
          missingGlyphs: comGlifoFaltando
            ? [{ position: 10, sentence_id: 1, word: '来', char: '来', codepoint: 'U+6765', start_us: 90_000_000 }]
            : [],
          emojiRemoved: 0,
          words: [],
        }
      }
      if (cmd === 'export.settings') return { last_directory: '/test/exports' }
      if (cmd === 'export.start') return { job: 5901, state: 'queued' }
      return null
    })

    const { rerender } = render(
      <Wrapper>
        <DialogoExportarCorte
          aberto
          aoFechar={vi.fn()}
          projetoId="demo"
          corte={CORTE_PADRAO}
          fonte={FONTE_ONLINE}
          aoIrParaTranscricao={aoIrParaTranscricao}
          fila={filaTeste}
        />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByText(/U\+6765/)).toBeInTheDocument()
    })
    // Botão de corrigir glifo funciona e Iniciar exportação fica bloqueado
    expect(screen.getByRole('button', { name: 'Iniciar exportação' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Corrigir palavras na Transcrição' }))
    expect(aoIrParaTranscricao).toHaveBeenCalledWith(10)

    // Reabre já sem glifos ausentes
    comGlifoFaltando = false
    rerender(
      <Wrapper>
        <DialogoExportarCorte
          aberto={false}
          aoFechar={vi.fn()}
          projetoId="demo"
          corte={CORTE_PADRAO}
          fonte={FONTE_ONLINE}
          fila={filaTeste}
        />
      </Wrapper>,
    )
    rerender(
      <Wrapper>
        <DialogoExportarCorte
          aberto
          aoFechar={vi.fn()}
          projetoId="demo"
          corte={CORTE_PADRAO}
          fonte={FONTE_ONLINE}
          fila={filaTeste}
        />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Entendi o risco' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Entendi o risco' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('guardrails.ack_direct_notice', {})
    })
    expect(screen.queryByRole('button', { name: 'Entendi o risco' })).not.toBeInTheDocument()

    // Campo de destino pré-preenchido via export.settings e editável (#303, sem export.settings.set)
    const campoDestino = screen.getByRole('textbox', { name: 'Arquivo de destino (.mp4)' })
    expect(campoDestino).toHaveValue('/test/exports/A virada do jogo.mp4')
    await user.clear(campoDestino)
    await user.type(campoDestino, '/test/exports/meu-corte.mp4')

    await user.click(screen.getByRole('button', { name: 'Iniciar exportação' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('export.start', {
        source_id: 4,
        start_id: 40,
        end_id: 41,
        candidate_id: 102,
        clip_id: 11,
        output: '/test/exports/meu-corte.mp4',
      })
    })
    expect(chamarMock).not.toHaveBeenCalledWith('export.settings.set', expect.anything())
  })

  it('trata erros export_exists, export_destination, component_missing e audio_asset_missing', async () => {
    const user = userEvent.setup()
    const aoIrParaAudio = vi.fn()
    let erroAtual = 'export_exists'

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'guardrails.check') return guardrailsBase({ needsDirectNotice: false, directMonetizationAck: true })
      if (cmd === 'export.captions') return { missingGlyphs: [], emojiRemoved: 0, words: [] }
      if (cmd === 'export.settings') return { last_directory: '/test/exports' }
      if (cmd === 'export.start') throw new ErroCore(erroAtual, 'Erro simulado')
      return null
    })

    render(
      <Wrapper>
        <DialogoExportarCorte
          aberto
          aoFechar={vi.fn()}
          projetoId="demo"
          corte={CORTE_PADRAO}
          fonte={FONTE_ONLINE}
          aoIrParaAudio={aoIrParaAudio}
          fila={filaTeste}
        />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Iniciar exportação' })).toBeEnabled()
    })

    // export_exists foca campo de destino
    await user.click(screen.getByRole('button', { name: 'Iniciar exportação' }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Já existe um arquivo com esse nome na pasta escolhida.')
    })
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Arquivo de destino (.mp4)' })).toHaveFocus()
    })

    // export_destination foca campo de destino
    erroAtual = 'export_destination'
    await user.click(screen.getByRole('button', { name: 'Iniciar exportação' }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Escolha uma pasta existente e um nome terminado em .mp4.')
    })
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Arquivo de destino (.mp4)' })).toHaveFocus()
    })

    // component_missing oferece recuperação
    erroAtual = 'component_missing'
    await user.click(screen.getByRole('button', { name: 'Iniciar exportação' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Instalar componente' })).toBeInTheDocument()
    })

    // audio_asset_missing oferece ação para aba Áudio
    erroAtual = 'audio_asset_missing'
    await user.click(screen.getByRole('button', { name: 'Iniciar exportação' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Abrir aba Áudio e SFX' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Abrir aba Áudio e SFX' }))
    expect(aoIrParaAudio).toHaveBeenCalledTimes(1)
  })

  it('acompanha job_running via core-progress, permite jobs.cancel e exibe aviso encoder_fallback (#289)', async () => {
    const user = userEvent.setup()

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'guardrails.check') return guardrailsBase({ needsDirectNotice: false, directMonetizationAck: true })
      if (cmd === 'export.captions') return { missingGlyphs: [], emojiRemoved: 0, words: [] }
      if (cmd === 'export.settings') return { last_directory: '/test/exports' }
      if (cmd === 'export.start') return { job: 5901, state: 'queued' }
      if (cmd === 'jobs.cancel') return { job: 5901, state: 'cancelled' }
      if (cmd === 'export.status') {
        return {
          job: 5901,
          state: 'completed',
          progress: 100,
          output: '/test/exports/A virada do jogo.mp4',
          error: null,
          encoder: 'libx264',
          encoderFallback: { from: 'h264_nvenc', reason: 'encoder_failed' },
        }
      }
      return null
    })

    render(
      <Wrapper>
        <DialogoExportarCorte
          aberto
          aoFechar={vi.fn()}
          projetoId="demo"
          corte={CORTE_PADRAO}
          fonte={FONTE_ONLINE}
          fila={filaTeste}
        />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Iniciar exportação' })).toBeEnabled()
    })
    await user.click(screen.getByRole('button', { name: 'Iniciar exportação' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancelar exportação' })).toBeInTheDocument()
    })

    act(() => {
      filaTeste.aplicar({
        job: '5901',
        project: 'demo',
        stage: 'export',
        percentage: 45,
        message: 'Exportando Corte',
        error: null,
      })
    })
    expect(screen.getByText('45%')).toBeInTheDocument()

    // Testa cancelamento antes de concluir
    await user.click(screen.getByRole('button', { name: 'Cancelar exportação' }))
    expect(chamarMock).toHaveBeenCalledWith('jobs.cancel', { id: 5901 })

    // Inicia novamente e conclui com fallback para CPU (#289)
    await user.click(screen.getByRole('button', { name: 'Iniciar exportação' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancelar exportação' })).toBeInTheDocument()
    })

    act(() => {
      filaTeste.aplicar({
        job: '5901',
        project: 'demo',
        stage: 'complete',
        percentage: 100,
        message: 'Corte exportado.',
        error: null,
      })
    })

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('export.status', { job: 5901 })
      expect(
        screen.getByText(/A exportação usou a CPU .* porque o encoder de placa de vídeo falhou/i),
      ).toBeInTheDocument()
    })
    expect(screen.getByText('/test/exports/A virada do jogo.mp4')).toBeInTheDocument()
  })

  it('executa aoAntesDeAbrir (cancela se false), suporta Corte avulso e botão Escolher arquivo via __CLIPES_E2E__', async () => {
    const user = userEvent.setup()
    const aoFechar = vi.fn()
    const aoAntesDeAbrir = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    window.__CLIPES_E2E__ = {
      dialogQueue: ['/escolhido/corte-avulso.mp4'],
      dialogCalls: [],
    }

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'guardrails.check') return guardrailsBase({ needsDirectNotice: false, directMonetizationAck: true })
      if (cmd === 'export.captions') return { missingGlyphs: [], emojiRemoved: 0, words: [] }
      if (cmd === 'export.settings') return { last_directory: '/test/exports' }
      if (cmd === 'export.start') return { job: 5902, state: 'queued' }
      return null
    })

    const corteAvulso = {
      corteId: 'avulso-4-10-14',
      titulo: 'Corte avulso 10-14',
      videoKind: 'direct' as const,
      sourceId: 4,
      startId: 10,
      endId: 14,
      candidateId: null,
    }

    const { rerender } = render(
      <Wrapper>
        <DialogoExportarCorte
          aberto
          aoFechar={aoFechar}
          projetoId="demo"
          corte={corteAvulso}
          fonte={FONTE_ONLINE}
          aoAntesDeAbrir={aoAntesDeAbrir}
          fila={filaTeste}
        />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(aoFechar).toHaveBeenCalledTimes(1)
    })
    expect(chamarMock).not.toHaveBeenCalledWith('export.start', expect.anything())

    rerender(
      <Wrapper>
        <DialogoExportarCorte
          aberto={false}
          aoFechar={aoFechar}
          projetoId="demo"
          corte={corteAvulso}
          fonte={FONTE_ONLINE}
          aoAntesDeAbrir={aoAntesDeAbrir}
          fila={filaTeste}
        />
      </Wrapper>,
    )
    rerender(
      <Wrapper>
        <DialogoExportarCorte
          aberto
          aoFechar={aoFechar}
          projetoId="demo"
          corte={corteAvulso}
          fonte={FONTE_ONLINE}
          aoAntesDeAbrir={aoAntesDeAbrir}
          fila={filaTeste}
        />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Escolher arquivo' })).toBeEnabled()
    })

    await user.click(screen.getByRole('button', { name: 'Escolher arquivo' }))
    expect(window.__CLIPES_E2E__?.dialogCalls[0]?.kind).toBe('save')
    expect(screen.getByRole('textbox', { name: 'Arquivo de destino (.mp4)' })).toHaveValue(
      '/escolhido/corte-avulso.mp4',
    )

    await user.click(screen.getByRole('button', { name: 'Iniciar exportação' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('export.start', {
        source_id: 4,
        start_id: 10,
        end_id: 14,
        output: '/escolhido/corte-avulso.mp4',
      })
    })
  })
})
