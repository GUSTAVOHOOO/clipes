import { ProvedorDicas, ProvedorToast } from '@ds'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErroCore } from '~/core/cliente'
import type { JobPersistido, OrcamentoItem } from '~/stores/filaGlobal'
import {
  DialogoDescartarJob,
  DialogoOrcamento,
  DialogoRefazerJob,
  DialogoResultadoJob,
  DialogoTentarDeNovo,
} from '~/telas/fila/DialogosFila'

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

function criarJobBase(parcial: Partial<JobPersistido> = {}): JobPersistido {
  return {
    id: 14,
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
    ...parcial,
  }
}

describe('DialogosFila', () => {
  beforeEach(() => {
    chamarMock.mockReset()
  })

  it('Tentar de novo (uncertain paid) abre ConfirmDialog com ResumoCustoPrivacidade, foco inicial em Cancelar e envia confirmed: true', async () => {
    const user = userEvent.setup()
    const aoFechar = vi.fn()
    const aoConcluir = vi.fn()

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'jobs.estimate') {
        return {
          safety: 'paid',
          estimate: { kind: 'usd', minMicroUsd: 40_000, maxMicroUsd: 70_000, inputTokens: 18_400 },
        }
      }
      if (cmd === 'jobs.retry') return null
      return null
    })

    render(
      envolver(
        <DialogoTentarDeNovo
          aberto
          job={criarJobBase({ id: 14, safety: 'paid', state: 'uncertain' })}
          aoFechar={aoFechar}
          aoConcluir={aoConcluir}
        />,
      ),
    )

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('jobs.estimate', { id: 14 })
    })

    expect(
      await screen.findByRole('region', { name: /Resumo de custo e privacidade/i }),
    ).toBeInTheDocument()

    const btnCancelar = screen.getByRole('button', { name: 'Cancelar' })
    await waitFor(() => {
      expect(btnCancelar).toHaveFocus()
    })

    await user.click(screen.getByRole('button', { name: /Repetir/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('jobs.retry', { id: 14, confirmed: true })
    })
    expect(aoConcluir).toHaveBeenCalledTimes(1)
    expect(aoFechar).toHaveBeenCalledTimes(1)
  })

  it('Tentar de novo (uncertain local) exibe US$ 0,00 e chama jobs.retry sem exigir confirmed pago', async () => {
    const user = userEvent.setup()
    const aoFechar = vi.fn()
    const aoConcluir = vi.fn()

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'jobs.estimate') {
        return { safety: 'local', estimate: { kind: 'zero' } }
      }
      if (cmd === 'jobs.retry') return null
      return null
    })

    render(
      envolver(
        <DialogoTentarDeNovo
          aberto
          job={criarJobBase({ id: 19, kind: 'transcription', safety: 'local', profile: null })}
          aoFechar={aoFechar}
          aoConcluir={aoConcluir}
        />,
      ),
    )

    expect(await screen.findByText('US$ 0,00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Repetir/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('jobs.retry', { id: 19 })
    })
  })

  it('Descartar (uncertain) abre ConfirmDialog de perigo com foco inicial em Cancelar e chama jobs.discard', async () => {
    const user = userEvent.setup()
    const aoFechar = vi.fn()
    const aoConcluir = vi.fn()

    chamarMock.mockResolvedValue(null)

    render(
      envolver(
        <DialogoDescartarJob
          aberto
          job={criarJobBase({ id: 22 })}
          aoFechar={aoFechar}
          aoConcluir={aoConcluir}
        />,
      ),
    )

    const btnCancelar = await screen.findByRole('button', { name: 'Cancelar' })
    await waitFor(() => {
      expect(btnCancelar).toHaveFocus()
    })

    await user.click(screen.getByRole('button', { name: 'Descartar' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('jobs.discard', { id: 22 })
    })
    expect(aoConcluir).toHaveBeenCalledTimes(1)
    expect(aoFechar).toHaveBeenCalledTimes(1)
  })

  it('Refazer com outro Perfil exibe nota #304 em ai:selection, bloqueia com role="alert" em Somente local e confirma jobs.redo', async () => {
    const user = userEvent.setup()
    const aoFechar = vi.fn()
    const aoConcluir = vi.fn()
    let somenteLocalAtivo = true

    chamarMock.mockImplementation(async (cmd: string, args?: { profileId?: string }) => {
      if (cmd === 'provider.profiles.list') {
        return {
          profiles: [
            {
              id: 'remoto-forte',
              label: 'OpenAI GPT-4o',
              kind: 'openai',
              endpoint: 'https://api.openai.com/v1',
              model: 'gpt-4o',
              local: false,
              cli: false,
            },
            {
              id: 'local-ollama',
              label: 'Ollama Local',
              kind: 'ollama',
              endpoint: 'http://127.0.0.1:11434/v1',
              model: 'qwen3:8b',
              local: true,
              cli: false,
            },
          ],
        }
      }
      if (cmd === 'projects.local_only.get') {
        return { open: true, enabled: somenteLocalAtivo }
      }
      if (cmd === 'assistant.tasks') {
        return { projectLocalOnly: somenteLocalAtivo, tasks: [] }
      }
      if (cmd === 'jobs.redo.estimate') {
        if (somenteLocalAtivo && args?.profileId === 'remoto-forte') {
          throw new ErroCore('local_only_violation', 'Bloqueado pelo modo Somente local.')
        }
        if (args?.profileId === 'local-ollama') {
          return {
            profile: { id: 'local-ollama', label: 'Ollama Local', kind: 'ollama', model: 'qwen3:8b' },
            paid: false,
            leavesMachine: false,
            estimate: { kind: 'zero' },
          }
        }
        return {
          profile: { id: 'remoto-forte', label: 'OpenAI GPT-4o', kind: 'openai', model: 'gpt-4o' },
          paid: true,
          leavesMachine: true,
          estimate: { kind: 'usd', minMicroUsd: 20_000, maxMicroUsd: 50_000, inputTokens: 12_000 },
        }
      }
      if (cmd === 'jobs.redo') {
        return { job: 105, profile: { id: args?.profileId } }
      }
      return null
    })

    const { rerender } = render(
      envolver(
        <DialogoRefazerJob
          aberto
          job={criarJobBase({ id: 11, kind: 'ai:selection', state: 'failed', profile: 'legacy' })}
          aoFechar={aoFechar}
          aoConcluir={aoConcluir}
        />,
      ),
    )

    // Nota #304 + Dica visíveis para ai:selection
    expect(await screen.findByText(/#304/)).toBeInTheDocument()

    // Com Somente local ativo e perfil remoto selecionado primeiro, exibe role="alert" e bloqueia confirmação
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/Somente local/i)
    const btnConfirmar = screen.getByRole('button', { name: /Confirmar e enfileirar/i })
    expect(btnConfirmar).toBeDisabled()

    // Desliga Somente local e reabre com perfil remoto permitido -> envia confirmed: true
    somenteLocalAtivo = false
    rerender(
      envolver(
        <DialogoRefazerJob
          aberto={false}
          job={criarJobBase({ id: 11, kind: 'ai:selection', state: 'failed', profile: 'legacy' })}
          aoFechar={aoFechar}
          aoConcluir={aoConcluir}
        />,
      ),
    )
    rerender(
      envolver(
        <DialogoRefazerJob
          aberto
          job={criarJobBase({ id: 11, kind: 'ai:selection', state: 'failed', profile: 'legacy' })}
          aoFechar={aoFechar}
          aoConcluir={aoConcluir}
        />,
      ),
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Confirmar e enfileirar/i })).toBeEnabled()
    })

    await user.click(screen.getByRole('button', { name: /Confirmar e enfileirar/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('jobs.redo', {
        id: 11,
        profileId: 'remoto-forte',
        confirmed: true,
      })
    })
    expect(aoConcluir).toHaveBeenCalledTimes(1)
  })

  it('Ver resultado (jobs.result) exibe outcome, usage, cost e mantém JSON completo recolhido em <details>', async () => {
    const user = userEvent.setup()

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'jobs.result') {
        return {
          outcome: 'ok',
          code: 'ok',
          cost: '0.0300',
          calls: 1,
          usage: {
            inputTokens: 1420,
            outputTokens: 420,
            calls: 1,
            costKind: 'usd',
            microUsd: 30_000,
            durationMs: 4800,
          },
          data: { blocks: [{ position: 1, title: 'Gancho' }] },
          violations: [],
        }
      }
      return null
    })

    render(
      envolver(
        <DialogoResultadoJob
          aberto
          job={criarJobBase({ id: 12, kind: 'ai:script', state: 'completed', profile: 'codex' })}
          aoFechar={vi.fn()}
        />,
      ),
    )

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('jobs.result', { id: 12 })
    })

    expect(await screen.findByText(/1\.420 entrada \+ 420 saída/i)).toBeInTheDocument()
    expect(screen.getByText('US$ 0,03')).toBeInTheDocument()

    const summary = screen.getByText('Expandir JSON completo')
    const details = summary.closest('details')!
    expect(details.open).toBe(false)

    await user.click(summary)
    expect(details.open).toBe(true)
    expect(details).toHaveTextContent('"blocks"')
  })

  it('Ajustar orçamento e continuar exige checkbox confirmed: true em cost_unknown e chama jobs.budget.continue', async () => {
    const user = userEvent.setup()
    const aoFechar = vi.fn()
    const aoConcluir = vi.fn()

    chamarMock.mockResolvedValue({ budgets: [] })

    const orcamentoUnknown: OrcamentoItem = {
      scope: 'batch',
      key: 'sources-3',
      maxCalls: 20,
      maxTokens: 100_000,
      maxWallMs: null,
      maxCostMicroUsd: 1_000_000,
      unknownConfirmed: false,
      since: 1794900000000000,
      usage: {
        calls: 4,
        inputTokens: 18_000,
        outputTokens: 2_400,
        microUsd: 0,
        unknownCostCalls: 1,
        planQuotaCalls: 0,
        durationMs: 8000,
        costLabel: 'custo desconhecido',
      },
      paused: 'cost_unknown',
    }

    render(
      envolver(
        <DialogoOrcamento
          aberto
          orcamento={orcamentoUnknown}
          modoContinuar
          aoFechar={aoFechar}
          aoConcluir={aoConcluir}
        />,
      ),
    )

    const btnSalvar = await screen.findByRole('button', { name: /Salvar orçamento e retomar fila/i })
    expect(btnSalvar).toBeDisabled()

    const checkboxDesconhecido = screen.getByRole('checkbox', {
      name: /preço conhecido|cost_unknown|custo desconhecido/i,
    })
    await user.click(checkboxDesconhecido)
    expect(btnSalvar).toBeEnabled()

    const inputCusto = screen.getByLabelText(/Novo teto de custo/i)
    await user.clear(inputCusto)
    await user.type(inputCusto, '5.00')

    await user.click(btnSalvar)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('jobs.budget.continue', {
        scope: 'batch',
        key: 'sources-3',
        maxCostMicroUsd: 5_000_000,
        maxCalls: 20,
        maxTokens: 100_000,
        resetUsage: false,
        confirmed: true,
      })
    })
    expect(aoConcluir).toHaveBeenCalledTimes(1)
    expect(aoFechar).toHaveBeenCalledTimes(1)
  })

  it('DialogoOrcamento valida limite numérico negativo antes de enviar', async () => {
    const user = userEvent.setup()

    const orcamento: OrcamentoItem = {
      scope: 'task',
      key: 'selection',
      maxCalls: 20,
      maxTokens: 100_000,
      maxWallMs: null,
      maxCostMicroUsd: 1_000_000,
      unknownConfirmed: true,
      since: 1,
      usage: {
        calls: 5,
        inputTokens: 1000,
        outputTokens: 200,
        microUsd: 200_000,
        unknownCostCalls: 0,
        planQuotaCalls: 0,
        durationMs: 1000,
        costLabel: null,
      },
      paused: 'budget_cost',
    }

    render(
      envolver(
        <DialogoOrcamento
          aberto
          orcamento={orcamento}
          modoContinuar
          aoFechar={vi.fn()}
          aoConcluir={vi.fn()}
        />,
      ),
    )

    const inputCusto = await screen.findByLabelText(/Novo teto de custo/i)
    await user.clear(inputCusto)
    await user.type(inputCusto, '-2')
    await user.click(screen.getByRole('button', { name: /Salvar orçamento e retomar fila/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/maior ou igual a zero/i)
    expect(chamarMock).not.toHaveBeenCalled()
  })
})
