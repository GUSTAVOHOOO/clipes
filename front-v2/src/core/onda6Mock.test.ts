import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assinarProgressoMock, coreDispatch, type EventoProgressoMock } from '@core'

describe('mock TS da Onda 6 (jobs.*, export.batch.*, diagnostic.*, transcription.hardware.diagnostic)', () => {
  let projetoPath = ''

  beforeEach(async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
    const aberto = await coreDispatch<{ id: string; path: string }>('projects.open', {
      path: '/projetos/Demo.clipes',
    })
    projetoPath = aberto.path
  })

  afterEach(async () => {
    try {
      await coreDispatch('projects.local_only.set', { enabled: false })
    } catch {
      // ignora
    }
    try {
      await coreDispatch('projects.close', {})
    } catch {
      // ignora
    }
    vi.unstubAllEnvs()
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
  })

  it('jobs.list funciona sem ?source-test e traz jobs realistas (running, uncertain, budgetPause, ai:* concluído/falho)', async () => {
    const jobs = await coreDispatch<
      Array<{
        id: number
        kind: string
        safety: string
        state: string
        project: string
        budgetPause: string | null
        profile: string | null
      }>
    >('jobs.list', {})

    expect(jobs.length).toBeGreaterThanOrEqual(4)
    expect(jobs.every((j) => j.project === 'demo')).toBe(true)
    expect(jobs.some((j) => j.state === 'uncertain' && j.safety === 'paid')).toBe(true)
    expect(jobs.some((j) => j.budgetPause === 'cost_unknown')).toBe(true)
    expect(jobs.some((j) => j.kind.startsWith('ai:') && j.state === 'completed')).toBe(true)
    expect(jobs.some((j) => j.kind.startsWith('ai:') && j.state === 'failed')).toBe(true)
  })

  it('jobs.estimate, jobs.retry (confirmation_required vs confirmed: true e local sem confirmar) e jobs.discard funcionam sem query flags', async () => {
    const jobs = await coreDispatch<Array<{ id: number; safety: string; state: string }>>('jobs.list', {})
    const incerto = jobs.find((j) => j.state === 'uncertain' && j.safety === 'paid')!
    const localJob = jobs.find((j) => j.safety === 'local')!

    const est = await coreDispatch<{ safety: string; estimate: { kind: string } }>('jobs.estimate', {
      id: incerto.id,
    })
    expect(est.safety).toBe('paid')

    const estLocal = await coreDispatch<{ safety: string; estimate: { kind: string } }>('jobs.estimate', {
      id: localJob.id,
    })
    expect(estLocal.safety).toBe('local')
    expect(estLocal.estimate.kind).toBe('zero')

    await expect(coreDispatch('jobs.retry', { id: incerto.id })).rejects.toMatchObject({
      code: 'confirmation_required',
    })

    await coreDispatch('jobs.retry', { id: incerto.id, confirmed: true })
    const aposRetry = await coreDispatch<Array<{ id: number; state: string }>>('jobs.list', {})
    expect(aposRetry.find((j) => j.id === incerto.id)?.state).toBe('queued')

    // Reabre projeto para restaurar job uncertain e testar jobs.discard
    await coreDispatch('projects.open', { path: '/projetos/Demo.clipes' })
    await coreDispatch('jobs.discard', { id: incerto.id })
    const aposDiscard = await coreDispatch<Array<{ id: number; state: string }>>('jobs.list', {})
    expect(aposDiscard.find((j) => j.id === incerto.id)?.state).toBe('cancelled')
  })

  it('jobs.redo.estimate, jobs.redo e jobs.result implementam contrato do núcleo e respeitam Somente local', async () => {
    await coreDispatch('provider.configure', {
      profileId: 'remoto-forte',
      label: 'Remoto Forte',
      kind: 'openai',
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      nativeSchema: false,
    })
    await coreDispatch('provider.configure', {
      profileId: 'local-ollama',
      label: 'Ollama Local',
      kind: 'ollama',
      endpoint: 'http://127.0.0.1:11434/v1',
      model: 'qwen3:8b',
      nativeSchema: false,
    })

    const jobs = await coreDispatch<Array<{ id: number; kind: string; state: string }>>('jobs.list', {})
    const aiConcluido = jobs.find((j) => j.kind.startsWith('ai:') && j.state === 'completed')!
    const aiIncerto = jobs.find((j) => j.kind.startsWith('ai:') && j.state === 'uncertain')!
    const naoAi = jobs.find((j) => !j.kind.startsWith('ai:'))!

    await expect(
      coreDispatch('jobs.redo.estimate', { id: aiIncerto.id, profileId: 'local-ollama' }),
    ).rejects.toMatchObject({ code: 'job_uncertain' })

    await expect(
      coreDispatch('jobs.redo.estimate', { id: naoAi.id, profileId: 'local-ollama' }),
    ).rejects.toMatchObject({ code: 'invalid_job' })

    const estRemoto = await coreDispatch<{
      profile: { id: string; label: string; kind: string; model: string | null }
      paid: boolean
      leavesMachine: boolean
      estimate: { kind: string }
    }>('jobs.redo.estimate', { id: aiConcluido.id, profileId: 'remoto-forte' })
    expect(estRemoto.profile.id).toBe('remoto-forte')
    expect(estRemoto.paid).toBe(true)
    expect(estRemoto.leavesMachine).toBe(true)

    await coreDispatch('projects.local_only.set', { enabled: true })
    await expect(
      coreDispatch('jobs.redo.estimate', { id: aiConcluido.id, profileId: 'remoto-forte' }),
    ).rejects.toMatchObject({ code: 'local_only_violation' })
    await coreDispatch('projects.local_only.set', { enabled: false })

    await expect(
      coreDispatch('jobs.redo', { id: aiConcluido.id, profileId: 'remoto-forte' }),
    ).rejects.toMatchObject({ code: 'confirmation_required' })

    const redone = await coreDispatch<{ job: number; profile: { id: string } }>('jobs.redo', {
      id: aiConcluido.id,
      profileId: 'remoto-forte',
      confirmed: true,
    })
    expect(typeof redone.job).toBe('number')
    expect(redone.profile.id).toBe('remoto-forte')

    const resultado = await coreDispatch<{
      outcome: string
      calls: number
      usage: { inputTokens: number; outputTokens: number }
      data: unknown
    }>('jobs.result', { id: aiConcluido.id })
    expect(resultado.outcome).toBe('ok')
    expect(resultado.calls).toBeGreaterThanOrEqual(1)
    expect(resultado.usage.inputTokens).toBeGreaterThan(0)
    expect(resultado.data).toBeTruthy()
  })

  it('export.batch.list traz lote histórico V1 partial com encoderFallback e export.batch.start/cancel emitem core-progress sem query flags', async () => {
    const iniciais = await coreDispatch<
      Array<{
        id: number
        status: string
        items: Array<{ state: string; encoderFallback: { from: string; reason: string } | null; error: { code: string } | null }>
      }>
    >('export.batch.list', {})

    const parcialV1 = iniciais.find((b) => b.status === 'partial')
    expect(parcialV1).toBeDefined()
    expect(parcialV1?.items.some((i) => i.encoderFallback?.from === 'h264_nvenc')).toBe(true)
    expect(parcialV1?.items.some((i) => i.state === 'failed' && i.error?.code)).toBe(true)

    await expect(
      coreDispatch('export.batch.start', {
        project: '/outro/Projeto.clipes',
        output_dir: '/test/exports',
      }),
    ).rejects.toMatchObject({ code: 'invalid_project' })

    await expect(
      coreDispatch('export.batch.start', {
        project: projetoPath,
        output_dir: '/test/conflitos',
      }),
    ).rejects.toMatchObject({
      code: 'confirmation_required',
      usage: { conflicts: expect.any(Array) },
    })

    const eventos: EventoProgressoMock[] = []
    const unsub = assinarProgressoMock((e) => eventos.push(e))

    const iniciado = await coreDispatch<{ id: number; state: string; items: Array<{ jobId: number | null }> }>(
      'export.batch.start',
      {
        project: projetoPath,
        output_dir: '/test/conflitos',
        confirmed: true,
      },
    )
    expect(iniciado.state).toBe('running')

    const status = await coreDispatch<{ id: number }>('export.batch.status', { id: iniciado.id })
    expect(status.id).toBe(iniciado.id)

    await vi.waitFor(
      async () => {
        const atual = await coreDispatch<{ state: string; status: string }>('export.batch.status', {
          id: iniciado.id,
        })
        expect(atual.state).toBe('completed')
      },
      { timeout: 3000 },
    )

    expect(eventos.some((e) => e.job === `export-batch-${iniciado.id}` && e.stage === 'export_batch')).toBe(true)
    expect(eventos.some((e) => e.job === `export-batch-${iniciado.id}` && e.stage === 'export_batch_complete')).toBe(true)

    // Testa cancelamento emitindo export_batch_cancelled
    const segundo = await coreDispatch<{ id: number }>('export.batch.start', {
      project: projetoPath,
      output_dir: '/test/exports',
    })
    const cancelado = await coreDispatch<{ state: string; status: string }>('export.batch.cancel', {
      id: segundo.id,
    })
    unsub()

    expect(cancelado.state).toBe('cancelled')
    expect(cancelado.status).toBe('cancelled')
    expect(
      eventos.some((e) => e.job === `export-batch-${segundo.id}` && e.stage === 'export_batch_cancelled'),
    ).toBe(true)
  })

  it('diagnostic.get, diagnostic.export e transcription.hardware.diagnostic cumprem contrato e respeitam ?estado=vazio', async () => {
    const diag = await coreDispatch<{ text: string }>('diagnostic.get', {})
    expect(diag.text).toContain('Clipes:')
    expect(diag.text).toContain('GPU / VRAM:')
    expect(diag.text).toContain('Encoder:')
    expect(diag.text).toContain('Motor de transcrição:')
    expect(diag.text).toContain('Provedor:')
    expect(diag.text).not.toMatch(/[A-Za-z]:\\Users\\|\/home\//)

    await expect(
      coreDispatch('diagnostic.export', { path: 'relativo.txt', text: diag.text }),
    ).rejects.toMatchObject({ code: 'invalid_path' })
    await expect(
      coreDispatch('diagnostic.export', { path: '/tmp/diag.log', text: diag.text }),
    ).rejects.toMatchObject({ code: 'invalid_path' })
    await expect(
      coreDispatch('diagnostic.export', { path: '/tmp/diag.txt', text: '   ' }),
    ).rejects.toMatchObject({ code: 'invalid_text' })
    await expect(
      coreDispatch('diagnostic.export', { path: '/tmp/diag.txt', text: diag.text }),
    ).resolves.toEqual({})

    const hwDiag = await coreDispatch<{
      key: { gpu: string | null; ct2_version: string; model: string }
      chosen: { device: string; compute_type: string }
      verified: boolean
      vram_free_mib: number | null
      measured_at: number
      attempts: Array<{ device: string; compute_type: string; ok: boolean }>
    } | null>('transcription.hardware.diagnostic', {})
    expect(hwDiag).not.toBeNull()
    expect(hwDiag?.key.gpu).toBeTruthy()
    expect(hwDiag?.chosen.device).toBeTruthy()
    expect(typeof hwDiag?.verified).toBe('boolean')
    expect(typeof hwDiag?.measured_at).toBe('number')

    window.location.hash = '#/relatos?estado=vazio'
    const hwVazio = await coreDispatch<null>('transcription.hardware.diagnostic', {})
    expect(hwVazio).toBeNull()
  })

  it('compatibilidade V1: ?source-test=1&budget-test=1 expõe budget_cost, cost_unknown e cota do plano em jobs.list', async () => {
    window.history.replaceState(null, '', '/?source-test=1&budget-test=1')
    await coreDispatch('projects.open', { path: '/projetos/Demo.clipes' })
    const jobs = await coreDispatch<
      Array<{
        id: number
        state: string
        budgetPause: string | null
        taskCost: { costLabel: string | null } | null
        batchCost: { costLabel: string | null } | null
      }>
    >('jobs.list', {})

    expect(jobs.some((j) => j.state === 'queued' && j.budgetPause === 'budget_cost')).toBe(true)
    expect(jobs.some((j) => j.state === 'queued' && j.budgetPause === 'cost_unknown')).toBe(true)
    expect(
      jobs.some((j) => (j.batchCost?.costLabel ?? j.taskCost?.costLabel) === 'custo desconhecido'),
    ).toBe(true)
    expect(
      jobs.some((j) => (j.batchCost?.costLabel ?? j.taskCost?.costLabel) === 'consome a cota do plano'),
    ).toBe(true)
  })
})
