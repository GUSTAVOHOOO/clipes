import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErroCore } from '~/core/cliente'
import { criarFila } from '~/core/progresso'
import type { LoteExportacao } from '~/stores/filaGlobal'
import { HistoricoLotes } from '~/telas/exportacao/HistoricoLotes'

const chamarMock = vi.fn()
const abrirNoSistemaMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

vi.mock('~/core/desktop', async () => {
  const atual = await vi.importActual<typeof import('~/core/desktop')>('~/core/desktop')
  return {
    ...atual,
    abrirNoSistema: (...args: unknown[]) => abrirNoSistemaMock(...args),
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

const LOTE_PARCIAL_V1: LoteExportacao = {
  id: 6399,
  scope: 'project',
  sourceId: null,
  outputDir: '/test/exports',
  state: 'completed',
  status: 'partial',
  progress: 100,
  counts: { total: 3, queued: 0, running: 0, completed: 2, failed: 1, cancelled: 0 },
  items: [
    {
      position: 0,
      sourceId: 4,
      runId: 1,
      candidateId: 102,
      clipId: null,
      jobId: 5891,
      title: 'Segundo corte',
      filename: 'Live_12_11_final-01-06m30s.mp4',
      output: '/test/exports/Live_12_11_final-01-06m30s.mp4',
      durationUs: 20_000_000,
      state: 'completed',
      progress: 100,
      error: null,
      encoder: 'libx264',
      encoderFallback: { from: 'h264_nvenc', reason: 'encoder_failed' },
    },
    {
      position: 1,
      sourceId: 1,
      runId: 1,
      candidateId: 104,
      clipId: null,
      jobId: 5892,
      title: 'Resumo final do jogo',
      filename: 'changed-02-11m30s.mp4',
      output: '/test/exports/changed-02-11m30s.mp4',
      durationUs: 40_000_000,
      state: 'failed',
      progress: 0,
      error: { code: 'source_changed', message: 'O arquivo da Fonte foi alterado no disco.' },
      encoder: null,
      encoderFallback: null,
    },
    {
      position: 2,
      sourceId: 4,
      runId: 1,
      candidateId: 101,
      clipId: null,
      jobId: 5893,
      title: 'A virada do jogo',
      filename: 'Live_12_11_final-03-01m30s.mp4',
      output: '/test/exports/Live_12_11_final-03-01m30s.mp4',
      durationUs: 50_000_000,
      state: 'completed',
      progress: 100,
      error: null,
      encoder: 'h264_nvenc',
      encoderFallback: null,
    },
  ],
}

const LOTE_RODANDO: LoteExportacao = {
  id: 6402,
  scope: 'project',
  sourceId: null,
  outputDir: '/test/exports',
  state: 'running',
  status: 'running',
  progress: 40,
  counts: { total: 2, queued: 1, running: 1, completed: 0, failed: 0, cancelled: 0 },
  items: [
    {
      position: 0,
      sourceId: 4,
      runId: 1,
      candidateId: 101,
      clipId: null,
      jobId: 5901,
      title: 'Corte ativo 1',
      filename: 'live-01.mp4',
      output: '/test/exports/live-01.mp4',
      durationUs: 25_000_000,
      state: 'running',
      progress: 40,
      error: null,
      encoder: 'h264_nvenc',
      encoderFallback: null,
    },
    {
      position: 1,
      sourceId: 4,
      runId: 1,
      candidateId: 102,
      clipId: null,
      jobId: 5902,
      title: 'Corte na fila 2',
      filename: 'live-02.mp4',
      output: '/test/exports/live-02.mp4',
      durationUs: 30_000_000,
      state: 'queued',
      progress: 0,
      error: null,
      encoder: null,
      encoderFallback: null,
    },
  ],
}

describe('HistoricoLotes', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    abrirNoSistemaMock.mockReset()
    abrirNoSistemaMock.mockResolvedValue({ ok: true, copiado: false })
    window.location.hash = '#/projeto/demo/exportacao?sub=lotes'
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('exibe estado vazio com CTA para voltar a Prontidão e Lote', async () => {
    const user = userEvent.setup()
    const aoVoltar = vi.fn()
    render(
      <ProvedorDicas>
        <ProvedorToast>
          <HistoricoLotes
            projetoId="demo"
            lotes={[]}
            loteSelecionadoId={null}
            aoSelecionarLote={vi.fn()}
            aoVoltarProntidao={aoVoltar}
          />
        </ProvedorToast>
      </ProvedorDicas>,
    )

    expect(screen.getByText('Nenhum lote exportado ainda')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Voltar para Prontidão e Lote' }))
    expect(aoVoltar).toHaveBeenCalledTimes(1)
  })

  it('exibe lote V1 partial, filtro "Mostrar apenas falhas", selo "Caiu para x264", recuperação e "Abrir arquivo"', async () => {
    const user = userEvent.setup()
    render(
      <ProvedorDicas>
        <ProvedorToast>
          <HistoricoLotes
            projetoId="demo"
            lotes={[LOTE_PARCIAL_V1]}
            loteSelecionadoId={6399}
            aoSelecionarLote={vi.fn()}
            aoVoltarProntidao={vi.fn()}
          />
        </ProvedorToast>
      </ProvedorDicas>,
    )

    // Faixa partial
    expect(
      screen.getByText(/Lote concluído parcialmente: 2 de 3 Cortes exportados e 1 com falha\./i),
    ).toBeInTheDocument()

    // Grid com fallback x264 e erro traduzido
    const grade = screen.getByRole('grid', { name: /Itens do lote #6399/i })
    expect(within(grade).getByText('Caiu para x264')).toBeInTheDocument()
    expect(within(grade).getByText(/de placa de vídeo NVIDIA: a codificação falhou/i)).toBeInTheDocument()
    expect(screen.queryByText(/h264_nvenc|encoder_failed/)).not.toBeInTheDocument()
    expect(
      within(grade).getByText(/O arquivo da Fonte foi movido, apagado ou alterado no disco\./i),
    ).toBeInTheDocument()

    // Botão "Abrir pasta" e "Abrir arquivo"
    await user.click(screen.getByRole('button', { name: 'Abrir pasta' }))
    expect(abrirNoSistemaMock).toHaveBeenCalledWith('/test/exports')

    const botoesArquivo = within(grade).getAllByRole('button', { name: 'Abrir arquivo' })
    await user.click(botoesArquivo[0])
    expect(abrirNoSistemaMock).toHaveBeenCalledWith('/test/exports/Live_12_11_final-01-06m30s.mp4')

    // Filtro "Mostrar apenas falhas"
    await user.click(screen.getByRole('button', { name: /Mostrar apenas falhas \(1\)/i }))
    expect(within(grade).queryByText('Segundo corte')).not.toBeInTheDocument()
    expect(within(grade).getByText('Resumo final do jogo')).toBeInTheDocument()

    // Botão de recuperação "Relocalizar Fonte" navega para a Fonte
    await user.click(within(grade).getByRole('button', { name: 'Relocalizar Fonte' }))
    expect(window.location.hash).toBe('#/projeto/demo/fontes/1')
  })

  it('cancela lote em andamento via ConfirmDialog e reage a core-progress (export_batch / export_batch_complete)', async () => {
    const user = userEvent.setup()
    const fila = criarFila(() => 'demo')
    const aoRecarregarLotes = vi.fn().mockResolvedValue([])

    chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'export.batch.cancel') {
        return {
          ...LOTE_RODANDO,
          state: 'cancelled',
          status: 'cancelled',
          counts: { total: 2, queued: 0, running: 0, completed: 0, failed: 0, cancelled: 2 },
          items: LOTE_RODANDO.items.map((it) => ({ ...it, state: 'cancelled' as const })),
        }
      }
      if (cmd === 'export.batch.status') {
        if (args.id === 6402) {
          return {
            ...LOTE_RODANDO,
            progress: 70,
            items: [
              { ...LOTE_RODANDO.items[0], state: 'completed' as const, progress: 100 },
              { ...LOTE_RODANDO.items[1], state: 'running' as const, progress: 50 },
            ],
          }
        }
        throw new ErroCore('batch_not_found', 'Lote não encontrado.')
      }
      return null
    })

    const { rerender } = render(
      <ProvedorDicas>
        <ProvedorToast>
          <HistoricoLotes
            projetoId="demo"
            lotes={[LOTE_RODANDO, LOTE_PARCIAL_V1]}
            loteSelecionadoId={6402}
            aoSelecionarLote={vi.fn()}
            aoVoltarProntidao={vi.fn()}
            aoRecarregarLotes={aoRecarregarLotes}
            fila={fila}
          />
        </ProvedorToast>
      </ProvedorDicas>,
    )

    // Evento core-progress atualiza o progresso e consulta export.batch.status
    act(() => {
      fila.aplicar({
        job: 'export-batch-6402',
        project: 'demo',
        stage: 'export_batch',
        percentage: 70,
        message: 'Exportando lote',
        error: null,
      })
    })

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('export.batch.status', { id: 6402 })
    })

    // Cancelar lote pede ConfirmDialog com foco inicial em Cancelar
    await user.click(screen.getByRole('button', { name: 'Cancelar lote' }))
    const dlg = await screen.findByRole('alertdialog')
    await waitFor(() => {
      expect(within(dlg).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })

    await user.click(within(dlg).getByRole('button', { name: 'Cancelar lote' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('export.batch.cancel', { id: 6402 })
    })
    expect(aoRecarregarLotes).toHaveBeenCalled()

    // Evento export_batch_complete aciona recarga
    act(() => {
      fila.aplicar({
        job: 'export-batch-6402',
        project: 'demo',
        stage: 'export_batch_complete',
        percentage: 100,
        message: 'Concluído',
        error: null,
      })
    })
    await waitFor(() => {
      expect(aoRecarregarLotes.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    rerender(
      <ProvedorDicas>
        <ProvedorToast>
          <HistoricoLotes
            projetoId="demo"
            lotes={[LOTE_PARCIAL_V1]}
            loteSelecionadoId={6399}
            aoSelecionarLote={vi.fn()}
            aoVoltarProntidao={vi.fn()}
            fila={fila}
          />
        </ProvedorToast>
      </ProvedorDicas>,
    )
    expect(screen.queryByRole('button', { name: 'Cancelar lote' })).not.toBeInTheDocument()
  })
})
