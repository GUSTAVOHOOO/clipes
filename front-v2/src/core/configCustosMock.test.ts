import { coreDispatch } from '@core'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('mock de Custos, Orçamentos e Auditoria em core.ts e batchMock.ts', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    window.history.replaceState(null, '', '/')
  })

  it('jobs.budget.get, set e continue suportam scope task e batch no formato { budgets: [...] }', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    window.history.replaceState(null, '', '/?source-test=1')

    const inicial = await coreDispatch<{ budgets: { scope: string; key: string; paused: string | null }[] }>(
      'jobs.budget.get',
      {},
    )
    expect(inicial.budgets.length).toBeGreaterThanOrEqual(2)
    expect(inicial.budgets.some((b) => b.scope === 'task')).toBe(true)
    expect(inicial.budgets.some((b) => b.scope === 'batch')).toBe(true)

    const criado = await coreDispatch<{ budgets: { scope: string; key: string; maxCostMicroUsd: number | null }[] }>(
      'jobs.budget.set',
      { scope: 'task', key: 'packaging', maxCostMicroUsd: 2_500_000, maxCalls: 10 },
    )
    expect(criado.budgets).toHaveLength(1)
    expect(criado.budgets[0]).toMatchObject({
      scope: 'task',
      key: 'packaging',
      maxCostMicroUsd: 2_500_000,
    })

    await expect(
      coreDispatch('jobs.budget.set', { scope: 'task', key: 'packaging', maxCostMicroUsd: -5 }),
    ).rejects.toMatchObject({ code: 'invalid_budget' })

    const pausado = inicial.budgets.find((b) => b.paused === 'cost_unknown')
    expect(pausado).toBeDefined()

    await expect(
      coreDispatch('jobs.budget.continue', { scope: pausado!.scope, key: pausado!.key }),
    ).rejects.toMatchObject({ code: 'confirmation_required' })

    const retomado = await coreDispatch<{ budgets: { paused: string | null; unknownConfirmed: boolean }[] }>(
      'jobs.budget.continue',
      { scope: pausado!.scope, key: pausado!.key, confirmed: true },
    )
    expect(retomado.budgets[0].paused).toBeNull()
    expect(retomado.budgets[0].unknownConfirmed).toBe(true)
  })

  it('provider.cost.list inclui falha cobrada e provider.audit.list lista hashes sem texto', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    window.history.replaceState(null, '', '/?source-test=1')

    const custos = await coreDispatch<{ outcome?: string | null; microUsd: number | null }[]>(
      'provider.cost.list',
      {},
    )
    expect(
      custos.some((c) => c.outcome != null && c.outcome !== 'ok' && (c.microUsd ?? 0) > 0),
    ).toBe(true)

    const auditoria = await coreDispatch<{ job: number; inputSha256: string; host: string }[]>(
      'provider.audit.list',
      {},
    )
    expect(auditoria.length).toBeGreaterThan(0)
    expect(auditoria[0].inputSha256).toMatch(/^[0-9a-f]{64}$/)

    const filtrada = await coreDispatch<{ job: number }[]>('provider.audit.list', {
      job: auditoria[0].job,
    })
    expect(filtrada.every((r) => r.job === auditoria[0].job)).toBe(true)
  })

  it('provider.prices.get lista múltiplos modelos e provider.cost.estimate simula zero, plan_quota e unknown', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')

    const tabela = await coreDispatch<{ prices: { provider: string; model: string }[] }>(
      'provider.prices.get',
      {},
    )
    expect(tabela.prices.length).toBeGreaterThanOrEqual(4)

    await coreDispatch('provider.configure', {
      profileId: 'local-ollama',
      label: 'Ollama',
      kind: 'ollama',
      endpoint: 'http://127.0.0.1:11434',
      model: 'qwen2.5:14b',
      nativeSchema: false,
    })
    const estLocal = await coreDispatch<{ kind: string; minMicroUsd: number | null }>(
      'provider.cost.estimate',
      { profileId: 'local-ollama', instruction: '', transcript: 'olá mundo', schema: {}, nativeSchema: false },
    )
    expect(estLocal.kind).toBe('zero')
    expect(estLocal.minMicroUsd).toBe(0)

    await coreDispatch('provider.cli.configure', { kind: 'codex' })
    await coreDispatch('provider.cli.confirm', { kind: 'codex' })
    const estCli = await coreDispatch<{ kind: string }>('provider.cost.estimate', {
      profileId: 'codex',
      instruction: '',
      transcript: 'olá mundo',
      schema: {},
      nativeSchema: false,
    })
    expect(estCli.kind).toBe('plan_quota')

    await coreDispatch('provider.configure', {
      profileId: 'sem-preco',
      label: 'Sem Preço',
      kind: 'openai',
      endpoint: 'https://api.custom.example/v1',
      model: 'modelo-desconhecido-xyz',
      nativeSchema: false,
    })
    const estUnknown = await coreDispatch<{ kind: string }>('provider.cost.estimate', {
      profileId: 'sem-preco',
      instruction: '',
      transcript: 'olá mundo',
      schema: {},
      nativeSchema: false,
    })
    expect(estUnknown.kind).toBe('unknown')
  })
})
