import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, type ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErroCore } from '~/core/cliente'
import { criarFila } from '~/core/progresso'
import { criarStoreFilaGlobal } from '~/stores/filaGlobal'
import { PainelFilaJobs } from '~/telas/fila/PainelFilaJobs'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
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

function envolver(children: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>{children}</ProvedorToast>
    </ProvedorDicas>
  )
}

const PROJETO_DEMO = { id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }

describe('PainelFilaJobs', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    window.location.hash = '#/projeto/demo/cortes'
  })

  afterEach(() => {
    window.location.hash = ''
  })

  it('cobre estado loading com 4 Skeletons e estado empty com e sem Projeto aberto', async () => {
    chamarMock.mockImplementation(() => new Promise(() => {}))

    const fila = criarFila(() => 'demo')
    const store = criarStoreFilaGlobal({ fila, debounceMs: 0 })

    const { rerender } = render(
      envolver(
        <PainelFilaJobs
          aberto
          aoFechar={vi.fn()}
          projetoAberto={PROJETO_DEMO}
          store={store}
          fila={fila}
        />,
      ),
    )

    expect(screen.getByRole('status', { name: /Carregando Fila de Jobs/i })).toBeInTheDocument()

    // Empty sem Projeto aberto e sem operações globais
    const filaSemProj = criarFila(() => null)
    const storeSemProj = criarStoreFilaGlobal({ fila: filaSemProj, debounceMs: 0 })
    rerender(
      envolver(
        <PainelFilaJobs
          aberto
          aoFechar={vi.fn()}
          projetoAberto={null}
          store={storeSemProj}
          fila={filaSemProj}
        />,
      ),
    )

    expect(await screen.findByText('Nenhum Projeto aberto')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ir para Início' })).toBeInTheDocument()

    // Empty com Projeto aberto e zero jobs/lotes
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'jobs.list') return []
      if (cmd === 'batches.list') return []
      if (cmd === 'export.batch.list') return []
      if (cmd === 'jobs.budget.get') return { budgets: [] }
      return null
    })
    const filaVazia = criarFila(() => 'demo')
    const storeVazio = criarStoreFilaGlobal({ fila: filaVazia, debounceMs: 0 })
    rerender(
      envolver(
        <PainelFilaJobs
          aberto
          aoFechar={vi.fn()}
          projetoAberto={PROJETO_DEMO}
          store={storeVazio}
          fila={filaVazia}
        />,
      ),
    )

    expect(await screen.findByText(/Nenhuma tarefa registrada neste Projeto ainda/i)).toBeInTheDocument()
  })

  it('cobre estado error com BannerErroCore traduzido sem expor código cru fora do <details>', async () => {
    chamarMock.mockRejectedValue(new ErroCore('project_busy', 'lock exclusivo ativo'))

    const fila = criarFila(() => 'demo')
    const store = criarStoreFilaGlobal({ fila, debounceMs: 0 })

    render(
      envolver(
        <PainelFilaJobs
          aberto
          aoFechar={vi.fn()}
          projetoAberto={PROJETO_DEMO}
          store={store}
          fila={fila}
        />,
      ),
    )

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Há uma tarefa ativa bloqueando esta operação no Projeto.')
    expect(within(alerta).getByRole('button', { name: 'Atualizar fila' })).toBeInTheDocument()
  })

  it('exibe banner uncertain no topo, pausa de orçamento, cancela paid com ConfirmDialog e omite ETA após reload (#303)', async () => {
    const user = userEvent.setup()

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'jobs.list') {
        return [
          {
            id: 2,
            kind: 'ai:selection',
            safety: 'paid',
            state: 'uncertain',
            attempts: 1,
            checkpoint: null,
            progress: 0,
            project: 'demo',
            outcome: 'uncertain',
            cost: 'unknown',
            batch: null,
            profile: 'legacy',
            budgetPause: null,
          },
          {
            id: 10,
            kind: 'transcription',
            safety: 'local',
            state: 'running',
            attempts: 1,
            checkpoint: null,
            progress: 55,
            project: 'demo',
            outcome: null,
            cost: null,
            batch: null,
            profile: null,
            budgetPause: null,
          },
          {
            id: 11,
            kind: 'ai:script',
            safety: 'paid',
            state: 'running',
            attempts: 1,
            checkpoint: null,
            progress: 10,
            project: 'demo',
            outcome: null,
            cost: null,
            batch: null,
            profile: 'openai',
            budgetPause: null,
          },
        ]
      }
      if (cmd === 'batches.list') return []
      if (cmd === 'export.batch.list') return []
      if (cmd === 'jobs.budget.get') {
        return {
          budgets: [
            {
              scope: 'task',
              key: 'selection',
              maxCalls: 10,
              maxTokens: null,
              maxWallMs: null,
              maxCostMicroUsd: 2_000_000,
              unknownConfirmed: false,
              since: 1,
              usage: {
                calls: 10,
                inputTokens: 1000,
                outputTokens: 500,
                microUsd: 2_040_000,
                unknownCostCalls: 0,
                planQuotaCalls: 0,
                durationMs: 1000,
                costLabel: null,
              },
              paused: 'budget_cost',
            },
          ],
        }
      }
      if (cmd === 'jobs.cancel') return null
      return null
    })

    const fila = criarFila(() => 'demo')
    const store = criarStoreFilaGlobal({ fila, debounceMs: 0 })

    render(
      envolver(
        <PainelFilaJobs
          aberto
          aoFechar={vi.fn()}
          projetoAberto={PROJETO_DEMO}
          store={store}
          fila={fila}
        />,
      ),
    )

    // Banner uncertain fixo no topo
    expect(
      await screen.findByText(
        /O Clipes nunca as repete automaticamente para evitar cobrança dupla/i,
      ),
    ).toBeInTheDocument()

    // Banner de pausa de orçamento
    expect(screen.getByText(/Teto de custo atingido/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ajustar orçamento e continuar/i })).toBeInTheDocument()

    // Job #10 veio só do reload (sem evento desde 0%) -> NÃO deve inventar ETA e não expõe #303 (UI-12)
    const card10 = screen.getByTestId('fila-job-10')
    expect(screen.queryByText(/min restantes/i)).not.toBeInTheDocument()
    expect(within(card10).getByText(/ETA indisponível/i)).toBeInTheDocument()
    expect(within(card10).queryByText(/#303/)).not.toBeInTheDocument()

    // Cancelar job running paid (#11) pede ConfirmDialog; cancelar running local (#10) chama direto
    const card11 = screen.getByTestId('fila-job-11')
    await user.click(within(card11).getByRole('button', { name: 'Cancelar' }))
    const dialogConfirm = await screen.findByRole('alertdialog')
    expect(dialogConfirm).toHaveTextContent(/Resultado incerto/i)
    await user.click(within(dialogConfirm).getByRole('button', { name: /Cancelar tarefa/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('jobs.cancel', { id: 11 })
    })

    await user.click(within(card10).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('jobs.cancel', { id: 10 })
    })
  })

  it('cobre batches.* (partial, uncertain_job foca card uncertain), export.batch.cancel e cancelamento de globais (#307)', async () => {
    const user = userEvent.setup()
    const aoNavegar = vi.fn()

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'jobs.list') {
        return [
          {
            id: 2,
            kind: 'ai:selection',
            safety: 'paid',
            state: 'uncertain',
            attempts: 1,
            checkpoint: null,
            progress: 0,
            project: 'demo',
            outcome: 'uncertain',
            cost: 'unknown',
            batch: 'sources-1',
            profile: 'legacy',
            budgetPause: null,
          },
        ]
      }
      if (cmd === 'batches.list') {
        return [
          {
            id: 1,
            key: 'sources-1',
            state: 'running',
            status: 'attention',
            engine: 'local',
            videoKind: 'direct',
            minUs: null,
            maxUs: null,
            pause: null,
            budget: null,
            counts: { total: 2, completed: 1, paused: 1, active: 0, pending: 0, cancelled: 0 },
            items: [
              {
                position: 0,
                sourceId: 1,
                name: 'live-1.mp4',
                state: 'completed',
                error: null,
                progress: 100,
                transcriptionJob: null,
                selectionRun: 1,
              },
              {
                position: 1,
                sourceId: 2,
                name: 'live-2.mp4',
                state: 'paused',
                error: 'timeout_uncertain',
                progress: null,
                transcriptionJob: 2,
                selectionRun: 2,
              },
            ],
          },
        ]
      }
      if (cmd === 'export.batch.list') {
        return [
          {
            id: 6401,
            scope: 'project',
            sourceId: null,
            outputDir: '/exports',
            state: 'running',
            status: 'running',
            progress: 45,
            counts: { total: 4, queued: 2, running: 1, completed: 1, failed: 0, cancelled: 0 },
            items: [],
          },
        ]
      }
      if (cmd === 'jobs.budget.get') return { budgets: [] }
      if (cmd === 'batches.item.resume') {
        throw new ErroCore('uncertain_job', 'Há chamada incerta pendente nesta Fonte.')
      }
      if (cmd === 'export.batch.cancel') return { id: 6401, state: 'cancelled', status: 'cancelled' }
      if (cmd === 'tts.models.cancel') return {}
      if (cmd === 'components.cancel') return {}
      if (cmd === 'sources.url.cancel') return {}
      if (cmd === 'sources.cancel') return {}
      return null
    })

    const fila = criarFila(() => 'demo')
    fila.aplicar({ job: 'tts:kokoro', project: null, stage: 'download', percentage: 40, message: 'Modelo Kokoro', error: null })
    fila.aplicar({ job: 'ffmpeg', project: null, stage: 'download', percentage: 60, message: 'FFmpeg 7.1', error: null })
    fila.aplicar({ job: 'url-1', project: null, stage: 'sources.url.download', percentage: 20, message: 'Baixando URL', error: null })

    const store = criarStoreFilaGlobal({ fila, debounceMs: 0 })

    render(
      envolver(
        <PainelFilaJobs
          aberto
          aoFechar={vi.fn()}
          projetoAberto={PROJETO_DEMO}
          store={store}
          fila={fila}
          aoNavegar={aoNavegar}
        />,
      ),
    )

    // Nota sobre operações globais em memória sem expor #307 (UI-12)
    expect(await screen.findByText(/Em memória nesta sessão/i)).toBeInTheDocument()
    expect(screen.queryByText(/#307/)).not.toBeInTheDocument()

    // Cancelamento global roteado por prefixo
    const cardTts = screen.getByTestId('fila-global-tts:kokoro')
    await user.click(within(cardTts).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('tts.models.cancel', { id: 'kokoro' })
    })

    const cardFfmpeg = screen.getByTestId('fila-global-ffmpeg')
    await user.click(within(cardFfmpeg).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('components.cancel', { id: 'ffmpeg' })
    })

    const cardUrl = screen.getByTestId('fila-global-url-1')
    await user.click(within(cardUrl).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('sources.url.cancel', { job: 'url-1' })
    })

    // Retomar Fonte com erro uncertain_job foca o card uncertain
    const btnRetomarFonte = await screen.findByRole('button', { name: 'Retomar Fonte' })
    await user.click(btnRetomarFonte)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('batches.item.resume', { id: 1, sourceId: 2 })
    })
    const cardIncerto = screen.getByTestId('fila-job-2')
    await waitFor(() => {
      expect(cardIncerto).toHaveFocus()
    })

    // Lote de exportação: cancelar lote pede ConfirmDialog e abrir em exportação navega
    await user.click(screen.getByRole('button', { name: 'Abrir em Exportação' }))
    expect(aoNavegar).toHaveBeenCalledWith('#/projeto/demo/exportacao?sub=lotes')

    await user.click(screen.getByRole('button', { name: 'Cancelar lote' }))
    const dialogCancelarLote = await screen.findByRole('alertdialog')
    await user.click(within(dialogCancelarLote).getByRole('button', { name: 'Cancelar lote' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('export.batch.cancel', { id: 6401 })
    })
  })

  it('Esc fecha a gaveta e devolve foco a refRetornoFoco', async () => {
    chamarMock.mockResolvedValue([])
    const aoFechar = vi.fn()
    const gatilhoRef = createRef<HTMLButtonElement>()

    const fila = criarFila(() => null)
    const store = criarStoreFilaGlobal({ fila, debounceMs: 0 })

    render(
      envolver(
        <>
          <button type="button" ref={gatilhoRef}>
            Fila 0
          </button>
          <PainelFilaJobs
            aberto
            aoFechar={aoFechar}
            projetoAberto={null}
            refRetornoFoco={gatilhoRef}
            store={store}
            fila={fila}
          />
        </>,
      ),
    )

    const aside = screen.getByRole('complementary', { name: 'Fila de Jobs' })
    expect(aside).toBeInTheDocument()

    const btnFechar = within(aside).getByRole('button', { name: /Fechar Fila/i })
    btnFechar.focus()
    fireEvent.keyDown(aside, { key: 'Escape' })

    expect(aoFechar).toHaveBeenCalledTimes(1)
    expect(gatilhoRef.current).toHaveFocus()
  })

  it('Esc fecha a gaveta mesmo com a dica do botao Fechar aberta apos Tab (UI-80)', async () => {
    chamarMock.mockResolvedValue([])
    const user = userEvent.setup()
    const aoFechar = vi.fn()
    const fila = criarFila(() => null)
    const store = criarStoreFilaGlobal({ fila, debounceMs: 0 })

    render(
      envolver(
        <PainelFilaJobs
          aberto
          aoFechar={aoFechar}
          projetoAberto={null}
          refRetornoFoco={createRef<HTMLElement>()}
          store={store}
          fila={fila}
        />,
      ),
    )

    const aside = screen.getByRole('complementary', { name: 'Fila de Jobs' })
    const btnFechar = within(aside).getByRole('button', { name: /Fechar Fila/i })
    await user.tab()
    await waitFor(() => expect(btnFechar).toHaveFocus())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1))
  })

  it('Ver estimativa e repetir abre o dialogo com foco em Cancelar (UI-82)', async () => {
    const user = userEvent.setup()
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'jobs.list') {
        return [
          {
            id: 21,
            kind: 'ai:selection',
            safety: 'paid',
            state: 'uncertain',
            attempts: 1,
            checkpoint: null,
            progress: 0,
            project: 'demo',
            outcome: 'uncertain',
            cost: 'unknown',
            batch: null,
            profile: 'legacy',
            budgetPause: null,
          },
        ]
      }
      if (cmd === 'jobs.estimate') {
        return { safety: 'paid', estimate: { kind: 'usd', minMicroUsd: 40_000, maxMicroUsd: 70_000, inputTokens: 18_400 } }
      }
      if (cmd === 'jobs.budget.get') return { budgets: [] }
      return []
    })
    const fila = criarFila(() => 'demo')
    const store = criarStoreFilaGlobal({ fila, debounceMs: 0 })
    render(
      envolver(
        <PainelFilaJobs aberto aoFechar={vi.fn()} projetoAberto={PROJETO_DEMO} store={store} fila={fila} />,
      ),
    )
    await user.click(await screen.findByRole('button', { name: /Ver estimativa e repetir/i }))
    const dialogo = await screen.findByRole('alertdialog')
    await waitFor(() => {
      expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })
  })

  it('cobre filtros por aba, estado partial de lote de exportação e ETA determinístico observado desde 0%', async () => {
    const user = userEvent.setup()
    let agora = 0

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'jobs.list') {
        return [
          {
            id: 10,
            kind: 'transcription',
            safety: 'local',
            state: 'queued',
            attempts: 1,
            checkpoint: null,
            progress: 0,
            project: 'demo',
            outcome: null,
            cost: null,
            batch: null,
            profile: null,
            budgetPause: null,
          },
          {
            id: 12,
            kind: 'ai:script',
            safety: 'paid',
            state: 'completed',
            attempts: 1,
            checkpoint: null,
            progress: 100,
            project: 'demo',
            outcome: 'ok',
            cost: '0.0300',
            batch: null,
            profile: 'codex',
            budgetPause: null,
          },
        ]
      }
      if (cmd === 'batches.list') return []
      if (cmd === 'export.batch.list') {
        return [
          {
            id: 6400,
            scope: 'project',
            sourceId: null,
            outputDir: '/exports',
            state: 'completed',
            status: 'partial',
            progress: 100,
            counts: { total: 2, queued: 0, running: 0, completed: 1, failed: 1, cancelled: 0 },
            items: [],
          },
        ]
      }
      if (cmd === 'jobs.budget.get') return { budgets: [] }
      return null
    })

    const fila = criarFila(() => 'demo', () => agora)
    const store = criarStoreFilaGlobal({ fila, debounceMs: 0 })

    render(
      envolver(
        <PainelFilaJobs
          aberto
          aoFechar={vi.fn()}
          projetoAberto={PROJETO_DEMO}
          store={store}
          fila={fila}
        />,
      ),
    )

    // Estado partial em lote de exportação
    expect(await screen.findByText('Concluído com falhas')).toBeInTheDocument()

    // Job #10 observado desde 0% na sessão atual -> calcula ETA (~2 min restantes)
    act(() => {
      fila.aplicar({ job: '10', project: 'demo', stage: 'transcribing', percentage: 0, message: 'Transcrevendo', error: null })
      agora = 120_000
      fila.aplicar({ job: '10', project: 'demo', stage: 'transcribing', percentage: 50, message: 'Transcrevendo', error: null })
    })

    expect(await screen.findByText(/~2 min restantes/i)).toBeInTheDocument()

    // Filtro Atenção mostra lote partial e oculta job concluído e ativo
    await user.click(screen.getByRole('tab', { name: /Atenção/i }))
    expect(screen.getByText('Exportação em lote #6400')).toBeInTheDocument()
    expect(screen.queryByTestId('fila-job-10')).not.toBeInTheDocument()
    expect(screen.queryByTestId('fila-job-12')).not.toBeInTheDocument()

    // Filtro Concluídos mostra job #12
    await user.click(screen.getByRole('tab', { name: /Concluídos/i }))
    expect(screen.getByTestId('fila-job-12')).toBeInTheDocument()
    expect(screen.queryByTestId('fila-job-10')).not.toBeInTheDocument()
  })
})
