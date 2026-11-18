import { ProvedorDicas, ProvedorToast } from '@ds'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { ConfigCustos } from '~/telas/config/ConfigCustos'

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

function envolver(ui: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>{ui}</ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>
  )
}

function mockPadrao({
  budgets = [
    {
      scope: 'task',
      key: 'selection',
      maxCalls: 20,
      maxTokens: 100000,
      maxWallMs: null,
      maxCostMicroUsd: 1_000_000,
      unknownConfirmed: false,
      since: 1794900000000000,
      usage: {
        calls: 8,
        inputTokens: 32000,
        outputTokens: 10100,
        microUsd: 420_000,
        audioMicroUsd: 0,
        unknownCostCalls: 0,
        planQuotaCalls: 0,
        durationMs: 12000,
        costLabel: null,
      },
      paused: null,
    },
    {
      scope: 'batch',
      key: 'sources-3',
      maxCalls: null,
      maxTokens: null,
      maxWallMs: null,
      maxCostMicroUsd: 1_000_000,
      unknownConfirmed: false,
      since: 1794900000000000,
      usage: {
        calls: 4,
        inputTokens: 18000,
        outputTokens: 2400,
        microUsd: 0,
        audioMicroUsd: 0,
        unknownCostCalls: 1,
        planQuotaCalls: 0,
        durationMs: 8000,
        costLabel: 'custo desconhecido',
      },
      paused: 'cost_unknown',
    },
  ],
  costs = [
    {
      id: 1,
      jobId: 48,
      task: 'selection',
      taskVersion: 4,
      attempt: 1,
      outcome: 'ok',
      code: 'ok',
      batch: null,
      profile: 'legacy',
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputTokens: 14200,
      outputTokens: 1180,
      calls: 1,
      costKind: 'usd',
      microUsd: 30_000,
      estimateMicroUsd: 30_000,
      durationMs: 2400,
      priceSource: 'table',
      tableUpdatedAt: '2026-11-15',
      createdAt: 1794942840000000,
    },
    {
      id: 2,
      jobId: 47,
      task: 'packaging',
      taskVersion: 2,
      attempt: 1,
      outcome: 'invalid_json',
      code: 'invalid_json',
      batch: null,
      profile: 'legacy',
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputTokens: 6400,
      outputTokens: 920,
      calls: 1,
      costKind: 'usd',
      microUsd: 40_000,
      estimateMicroUsd: 30_000,
      durationMs: 3100,
      priceSource: 'table',
      tableUpdatedAt: '2026-11-15',
      createdAt: 1794942480000000,
    },
    {
      id: 3,
      jobId: 46,
      task: 'script',
      taskVersion: 1,
      attempt: 1,
      outcome: 'ok',
      code: 'ok',
      batch: null,
      profile: 'codex',
      provider: 'cli:codex',
      model: '',
      inputTokens: null,
      outputTokens: null,
      calls: 1,
      costKind: 'plan_quota',
      microUsd: null,
      estimateMicroUsd: null,
      durationMs: 4800,
      priceSource: null,
      tableUpdatedAt: '2026-11-15',
      createdAt: 1794941700000000,
    },
  ],
  audit = [
    {
      id: 1,
      providerKind: 'openai',
      host: 'api.openai.com',
      model: 'gpt-4o-mini',
      promptSha256: 'a'.repeat(64),
      inputSha256: '8f3a' + '0'.repeat(56) + '91c2',
      sentBytes: 54120,
      responseSha256: 'b'.repeat(64),
      task: 'selection',
      taskVersion: 4,
      outcome: 'ok',
      costId: 1,
      transcriptionCallId: null,
      job: 48,
    },
  ],
}: {
  budgets?: unknown[]
  costs?: unknown[]
  audit?: unknown[]
} = {}) {
  chamarMock.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case 'jobs.budget.get':
        return { budgets }
      case 'provider.cost.list':
        return costs
      case 'provider.audit.list':
        return audit
      case 'provider.prices.get':
        return {
          updatedAt: '2026-11-15',
          prices: [
            { provider: 'openai', model: 'gpt-4o-mini', inputPerMillion: 0.15, outputPerMillion: 0.6 },
            { provider: 'anthropic', model: 'claude-sonnet-4-5', inputPerMillion: 3, outputPerMillion: 15 },
          ],
          overrides: [],
        }
      case 'provider.profiles.list':
        return {
          profiles: [
            {
              id: 'legacy',
              label: 'Principal',
              kind: 'openai',
              endpoint: 'https://api.openai.com/v1',
              model: 'gpt-4o-mini',
              local: false,
              cli: false,
            },
          ],
        }
      case 'provider.cost.estimate':
        return {
          kind: 'usd',
          callsOnly: false,
          inputTokens: 12000,
          inputTokensRange: { min: 10000, max: 14000 },
          tier: null,
          maxOutputTokens: 2048,
          minMicroUsd: 31000,
          maxMicroUsd: 48000,
          priceSource: 'table',
          tableUpdatedAt: '2026-11-15',
          profileId: 'legacy',
        }
      default:
        return {}
    }
  })
}

describe('ConfigCustos', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    window.location.hash = '#/config/custos'
  })

  afterEach(() => {
    window.location.hash = ''
  })

  it('estado loading exibe Esqueleto enquanto carrega', () => {
    chamarMock.mockImplementation(() => new Promise(() => {}))
    render(envolver(<ConfigCustos projetoAberto="canal-1" />))

    expect(screen.getByRole('status', { name: /Carregando/i })).toBeInTheDocument()
  })

  it('estado empty sem Projeto aberto exibe EstadoTela nas abas Orçamentos e Auditoria e mantém Preços/Estimador funcional', async () => {
    const user = userEvent.setup()
    mockPadrao()
    render(envolver(<ConfigCustos projetoAberto={null} />))

    expect(await screen.findByText('Nenhum Projeto aberto')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ir para Início' })).toBeInTheDocument()

    // Aba Auditoria também mostra vazio sem Projeto
    const tablist = screen.getByRole('tablist', { name: 'Seções de Custos' })
    await user.click(within(tablist).getByRole('tab', { name: 'Auditoria' }))
    expect(await screen.findByText('Nenhum Projeto aberto')).toBeInTheDocument()

    // Aba Tabela de Preços e Estimador funciona normalmente sem Projeto
    await user.click(within(tablist).getByRole('tab', { name: 'Tabela de Preços e Estimador' }))
    expect(await screen.findByText(/Estimador manual de custo/i)).toBeInTheDocument()
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Simular custo' }))
    expect(await screen.findByLabelText(/Resumo de custo e privacidade/i)).toBeInTheDocument()
  })

  it('nunca engole erro de provider.cost.list e exibe role="alert" com Tentar novamente', async () => {
    const user = userEvent.setup()
    mockPadrao()
    const baseImpl = chamarMock.getMockImplementation()!
    let falhar = true
    chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'provider.cost.list' && falhar) {
        throw new ErroCore('project_read', 'falha ao ler provider_costs')
      }
      return baseImpl(cmd, args)
    })

    render(envolver(<ConfigCustos projetoAberto="canal-1" />))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/Não foi possível carregar os registros de custo do Projeto/i)

    falhar = false
    await user.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }))

    expect(await screen.findByText(/Histórico real de chamadas/i)).toBeInTheDocument()
  })

  it('estado partial exibe faixa de orçamento pausado e exige confirmação em cost_unknown ao retomar', async () => {
    const user = userEvent.setup()
    mockPadrao()
    render(envolver(<ConfigCustos projetoAberto="canal-1" />))

    const faixa = await screen.findByRole('region', { name: /Orçamento pausado/i })
    expect(faixa).toHaveTextContent(/custo desconhecido/i)

    await user.click(within(faixa).getByRole('button', { name: /Ajustar e continuar/i }))

    const dialog = await screen.findByRole('dialog')
    const btnConfirmar = within(dialog).getByRole('button', { name: /Confirmar e continuar/i })
    expect(btnConfirmar).toBeDisabled()

    await user.click(within(dialog).getByRole('checkbox', { name: /custo é desconhecido/i }))
    expect(btnConfirmar).toBeEnabled()

    await user.click(btnConfirmar)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith(
        'jobs.budget.continue',
        expect.objectContaining({
          scope: 'batch',
          key: 'sources-3',
          confirmed: true,
        }),
      )
    })
  })

  it('soma falhas cobradas no total e exibe status explícito de erro', async () => {
    const user = userEvent.setup()
    mockPadrao()
    render(envolver(<ConfigCustos projetoAberto="canal-1" />))

    // Total = US$ 0,03 + US$ 0,04 = US$ 0,07 (70_000 microUsd)
    expect(await screen.findByText(/Total:\s*US\$ 0,07/)).toBeInTheDocument()
    expect(screen.getByText(/Falha cobrada/i)).toBeInTheDocument()

    // Valores monetários usam classe tabular .num
    const totalEl = screen.getByText(/Total:\s*US\$ 0,07/)
    expect(totalEl).toHaveClass('num')

    // Filtro somente falhas cobradas oculta chamadas ok
    await user.click(screen.getByRole('checkbox', { name: /Somente falhas cobradas/i }))
    expect(screen.getByText(/Falha cobrada/i)).toBeInTheDocument()
    expect(screen.queryByText('Concluído')).not.toBeInTheDocument()
  })

  it('estado job_running coloca Simular custo em carregando enquanto aguarda resposta', async () => {
    const user = userEvent.setup()
    mockPadrao()
    const baseImpl = chamarMock.getMockImplementation()!
    let resolverEst!: (v: unknown) => void
    chamarMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'provider.cost.estimate') {
        return new Promise((r) => {
          resolverEst = r
        })
      }
      return baseImpl(cmd, args)
    })

    render(envolver(<ConfigCustos projetoAberto="canal-1" />))
    const tablist = await screen.findByRole('tablist', { name: 'Seções de Custos' })
    await user.click(within(tablist).getByRole('tab', { name: 'Tabela de Preços e Estimador' }))

    const btn = await screen.findByRole('button', { name: 'Simular custo' })
    await user.click(btn)

    expect(btn).toHaveAttribute('aria-busy', 'true')
    expect(btn).toBeDisabled()

    resolverEst({
      kind: 'zero',
      callsOnly: false,
      inputTokens: 100,
      inputTokensRange: { min: 100, max: 120 },
      tier: null,
      maxOutputTokens: null,
      minMicroUsd: 0,
      maxMicroUsd: 0,
      priceSource: null,
      tableUpdatedAt: '2026-11-15',
    })
    await waitFor(() => {
      expect(btn).not.toBeDisabled()
    })
  })

  it('aba Auditoria copia hash SHA-256 para área de transferência e anuncia "Hash copiado"', async () => {
    const user = userEvent.setup()
    const writeSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    mockPadrao()
    render(envolver(<ConfigCustos projetoAberto="canal-1" />))

    const tablist = await screen.findByRole('tablist', { name: 'Seções de Custos' })
    await user.click(within(tablist).getByRole('tab', { name: 'Auditoria' }))

    expect(
      await screen.findByText(/Nenhum texto de Transcrição, Roteiro ou chave de API é salvo aqui/i),
    ).toBeInTheDocument()

    const btnCopiar = await screen.findByRole('button', {
      name: /Copiar hash de entrada da chamada 1/i,
    })
    await user.click(btnCopiar)

    await waitFor(() => {
      expect(writeSpy).toHaveBeenCalledWith('8f3a' + '0'.repeat(56) + '91c2')
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Hash copiado')
  })
})
