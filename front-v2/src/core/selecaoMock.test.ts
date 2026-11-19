import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assinarProgressoMock, coreDispatch, type EventoProgressoMock } from '@core'

type RunResumo = {
  id: number
  state: 'running' | 'completed' | 'partial'
  minUs: number
  maxUs: number
  planState: string
  revision: number
  revisions: number[]
  videoKind: 'direct' | 'transformed'
  budgetPause: string | null
  weights: Array<{ key: string; weight: number }>
  counts: { windows: number; completed: number; failed: number; kept: number; discarded: number; merged: number }
}

type WindowDetalhe = {
  index: number
  firstId: number
  lastId: number
  startUs: number
  endUs: number
  jobId: number | null
  state: string
  code: string | null
  resetAtMs: number | null
  profile: string
}

type CandidatoDetalhe = {
  id: number
  rank: number
  startId: number
  endId: number
  startUs: number
  endUs: number
  total: number
  title: string
  windows: number[]
  profile: string
  revision: number
  adjusted: boolean
}

type ReviewItem = {
  candidate: number
  status: 'pending' | 'approved' | 'rejected'
  adjusted: boolean
  startId: number
  endId: number
  startUs: number
  endUs: number
  startText: string
  endText: string
  moves: {
    startEarlier: boolean
    startLater: boolean
    endEarlier: boolean
    endLater: boolean
  }
}

describe('mock TS de Seleção, Revisão, Proxy, Sinais, Guardrails e Ângulos', () => {
  beforeEach(async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
    await coreDispatch('projects.open', { path: '/projetos/Demo.clipes' })
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

  it('Projeto demo inicial traz execução V1 concluída com minUs, maxUs, planState, revision, revisions e window.profile/jobId sem query flags', async () => {
    const runs = await coreDispatch<RunResumo[]>('selection.list', { source_id: 4 })
    expect(runs.length).toBeGreaterThanOrEqual(1)

    const demoRun = runs.find((r) => r.id === 1)
    expect(demoRun).toBeDefined()
    expect(demoRun?.state).toBe('completed')
    expect(demoRun?.minUs).toBeGreaterThan(0)
    expect(demoRun?.maxUs).toBeGreaterThan(demoRun!.minUs)
    expect(demoRun?.planState).toBe('full')
    expect(demoRun?.revisions).toEqual([1, 2])
    expect(demoRun?.revision).toBe(2)

    const rev2 = await coreDispatch<{ run: RunResumo; windows: WindowDetalhe[]; candidates: CandidatoDetalhe[] }>(
      'selection.get',
      { run: 1, revision: 2 },
    )
    expect(rev2.run.revision).toBe(2)
    expect(rev2.run.revisions).toEqual([1, 2])
    expect(rev2.windows.length).toBeGreaterThanOrEqual(3)
    expect(rev2.windows[0].profile).toBeTruthy()
    expect(typeof rev2.windows[0].jobId).toBe('number')
    expect(rev2.candidates.length).toBeGreaterThanOrEqual(2)
    expect(rev2.candidates.some((c) => c.title === '')).toBe(true)

    const rev1 = await coreDispatch<{ run: RunResumo; candidates: CandidatoDetalhe[] }>('selection.get', {
      run: 1,
      revision: 1,
    })
    expect(rev1.candidates[0].revision).toBe(1)
    expect(rev1.candidates[0].id).not.toBe(rev2.candidates[0].id)
  })

  it('selection.review, decide, adjust e undo preservam decisões entre revisões e rejeitam limites com códigos reais', async () => {
    await coreDispatch('selection.get', { run: 1, revision: 2 })
    const inicial = await coreDispatch<{ run: number; items: ReviewItem[]; canUndo: boolean }>('selection.review', {
      run: 1,
    })
    expect(inicial.run).toBe(1)
    expect(inicial.items.length).toBeGreaterThanOrEqual(3)
    expect(inicial.canUndo).toBe(true)

    const primeiro = inicial.items[0]
    const decidido = await coreDispatch<{ run: number; item: ReviewItem; canUndo: boolean }>('selection.decide', {
      candidate: primeiro.candidate,
      decision: 'approved',
    })
    expect(decidido.item.status).toBe('approved')
    expect(decidido.canUndo).toBe(true)

    // Alternar para revisão 1 preserva a decisão associada à mesma identidade (startId, endId)
    const rev1 = await coreDispatch<{ candidates: CandidatoDetalhe[] }>('selection.get', { run: 1, revision: 1 })
    const rev1Review = await coreDispatch<{ items: ReviewItem[] }>('selection.review', { run: 1 })
    const candRev1 = rev1.candidates.find((c) => c.startId === primeiro.startId && c.endId === primeiro.endId)!
    const itemRev1 = rev1Review.items.find((i) => i.candidate === candRev1.id)!
    expect(itemRev1.status).toBe('approved')

    // Volta para revisão 2 e testa adjust + erros de limite
    await coreDispatch('selection.get', { run: 1, revision: 2 })
    const segundo = inicial.items[1]
    // segundo tem 2 Frases (20 s = minUs): encurtar deve rejeitar com adjust_too_short
    await expect(
      coreDispatch('selection.adjust', { candidate: segundo.candidate, edge: 'end', delta: -1 }),
    ).rejects.toMatchObject({ code: 'adjust_too_short' })
    expect(segundo.moves.endEarlier).toBe(false)

    // Estender até passar do maxUs (60 s) rejeita com adjust_too_long
    let atualId = primeiro.candidate
    for (let i = 0; i < 4; i += 1) {
      try {
        await coreDispatch('selection.adjust', { candidate: atualId, edge: 'end', delta: 1 })
      } catch (err) {
        expect(err).toMatchObject({ code: 'adjust_too_long' })
        break
      }
    }

    // Desfaz tudo até esvaziar e receber nothing_to_undo
    for (let i = 0; i < 20; i += 1) {
      try {
        await coreDispatch('selection.undo', { run: 1 })
      } catch (err) {
        expect(err).toMatchObject({ code: 'nothing_to_undo' })
        break
      }
    }
    await expect(coreDispatch('selection.undo', { run: 1 })).rejects.toMatchObject({
      code: 'nothing_to_undo',
    })
  })

  it('selection.estimate, start e redo emitem core-progress (ai:selection:*, selection:window, selection:done) e respeitam local_only', async () => {
    const est = await coreDispatch<{
      paid: boolean
      profile: string
      minUs: number
      maxUs: number
      videoKind: string
      weights: Array<{ key: string; weight: number }>
      plan: { state: string; windows: unknown[] }
    }>('selection.estimate', {
      source_id: 4,
      minUs: 20_000_000,
      maxUs: 60_000_000,
      videoKind: 'transformed',
    })
    expect(est.videoKind).toBe('transformed')
    expect(est.weights[0]).toEqual({ key: 'commentary', weight: 0.3 })
    expect(est.minUs).toBe(20_000_000)
    expect(est.maxUs).toBe(60_000_000)
    expect(est.plan.state).toBe('full')

    const eventos: EventoProgressoMock[] = []
    const unsub = assinarProgressoMock((e) => eventos.push(e))

    const started = await coreDispatch<{ run: number; minUs: number; maxUs: number; planState: string }>(
      'selection.start',
      {
        source_id: 4,
        minUs: 20_000_000,
        maxUs: 60_000_000,
        videoKind: 'transformed',
        confirmed: true,
      },
    )
    expect(started.run).toBeGreaterThan(1)
    expect(started.planState).toBe('full')

    await vi.waitFor(
      async () => {
        const detalhe = await coreDispatch<{ run: RunResumo }>('selection.get', { run: started.run })
        expect(detalhe.run.state).toBe('completed')
      },
      { timeout: 2000 },
    )
    unsub()

    const stages = eventos.map((e) => e.stage)
    expect(stages.some((s) => s.startsWith('ai:selection'))).toBe(true)
    expect(stages).toContain('selection:window')
    expect(stages).toContain('selection:done')

    // Configura um perfil remoto e testa Modo 3 + local_only_violation + redo
    await coreDispatch('provider.configure', {
      profileId: 'remoto-forte',
      label: 'Remoto Forte',
      kind: 'openai',
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      nativeSchema: false,
    })

    const estModo3 = await coreDispatch<{
      profile: { id: string; label: string; kind: string; model: string | null }
      paid: boolean
      leavesMachine: boolean
      windows: number[]
    }>('selection.estimate', {
      run: started.run,
      windows: [0],
      profileId: 'remoto-forte',
    })
    expect(estModo3.profile.id).toBe('remoto-forte')
    expect(estModo3.leavesMachine).toBe(true)

    await coreDispatch('projects.local_only.set', { enabled: true })
    await expect(
      coreDispatch('selection.estimate', {
        run: started.run,
        windows: [0],
        profileId: 'remoto-forte',
      }),
    ).rejects.toMatchObject({ code: 'local_only_violation' })
    await coreDispatch('projects.local_only.set', { enabled: false })

    const redone = await coreDispatch<{ run: number; windows: number[]; profile: { id: string } }>('selection.redo', {
      run: started.run,
      windows: [0],
      profileId: 'remoto-forte',
      confirmed: true,
    })
    expect(redone.profile.id).toBe('remoto-forte')

    await vi.waitFor(
      async () => {
        const detalhe = await coreDispatch<{ run: RunResumo }>('selection.get', { run: started.run })
        expect(detalhe.run.revisions).toContain(2)
      },
      { timeout: 2000 },
    )
  })

  it('suporta ?estado=parcial com janela uncertain, bloqueia selection.resume/redo e resolve via jobs.estimate -> retry/discard', async () => {
    window.location.hash = '#/projeto/demo/cortes?estado=parcial'

    const detalhe = await coreDispatch<{ run: RunResumo; windows: WindowDetalhe[] }>('selection.get', { run: 1 })
    expect(detalhe.run.state).toBe('partial')
    const incerta = detalhe.windows.find((w) => w.state === 'uncertain')
    expect(incerta).toBeDefined()
    expect(incerta?.jobId).not.toBeNull()

    await expect(coreDispatch('selection.resume', { run: 1, confirmed: true })).rejects.toMatchObject({
      code: 'window_uncertain',
    })

    const estJob = await coreDispatch<{ safety: string; estimate: { kind: string } }>('jobs.estimate', {
      id: incerta!.jobId!,
    })
    expect(estJob.safety).toBe('paid')

    await expect(coreDispatch('jobs.retry', { id: incerta!.jobId! })).rejects.toMatchObject({
      code: 'confirmation_required',
    })
    await coreDispatch('jobs.discard', { id: incerta!.jobId! })

    const aposDescarte = await coreDispatch<{ windows: WindowDetalhe[] }>('selection.get', { run: 1 })
    const janelaAtualizada = aposDescarte.windows.find((w) => w.index === incerta!.index)
    expect(janelaAtualizada?.state).toBe('cancelled')
  })

  it('energy.start, chat.fetch/status e proxy.request/status/map_time emitem core-progress sem query flags', async () => {
    const eventos: EventoProgressoMock[] = []
    const unsub = assinarProgressoMock((e) => eventos.push(e))

    const energyStart = await coreDispatch<{ state: string; job: number }>('energy.start', { source_id: 4 })
    expect(energyStart.state).toBe('queued')
    const energyStatus = await coreDispatch<{ measured: boolean; marks: { high: number; peak: number } }>(
      'energy.status',
      { source_id: 4 },
    )
    expect(energyStatus.measured).toBe(true)
    expect(energyStatus.marks.high).toBeGreaterThan(0)

    const chatAntes = await coreDispatch<{ state: string; canFetch: boolean; intervals: number; messages: number }>(
      'chat.status',
      { source_id: 4 },
    )
    expect(chatAntes.canFetch).toBe(true)
    await coreDispatch('chat.fetch', { source_id: 4 })
    const chatDepois = await coreDispatch<{ state: string; intervals: number; messages: number; peaks: number }>(
      'chat.status',
      { source_id: 4 },
    )
    expect(chatDepois.state).toBe('available')
    expect(chatDepois.intervals).toBeGreaterThan(0)
    expect(chatDepois.messages).toBeGreaterThan(0)

    // Proxy em Fonte offline (id: 2) falha com source_offline
    await expect(
      coreDispatch('proxy.request', { source_id: 2, start_us: 10_000_000, end_us: 40_000_000 }),
    ).rejects.toMatchObject({ code: 'source_offline' })

    const proxyReq = await coreDispatch<{ state: string; key: string; job: number; windowStartUs: number; windowEndUs: number }>(
      'proxy.request',
      { source_id: 4, start_us: 90_000_000, end_us: 140_000_000 },
    )
    expect(proxyReq.key).toMatch(/^[0-9a-f]{64}$/)

    await vi.waitFor(
      async () => {
        const st = await coreDispatch<{ state: string; progress: number }>('proxy.status', { key: proxyReq.key })
        expect(st.state).toBe('ready')
        expect(st.progress).toBe(100)
      },
      { timeout: 2000 },
    )
    unsub()

    expect(eventos.some((e) => e.stage === 'energy')).toBe(true)
    expect(eventos.some((e) => e.stage === 'chat')).toBe(true)
    expect(eventos.some((e) => e.stage === 'proxy')).toBe(true)

    // proxy.map_time bidirecional
    const toProxy = await coreDispatch<{ proxyUs: number | null }>('proxy.map_time', {
      window_start_us: 50_000_000,
      window_end_us: 200_000_000,
      source_us: 90_000_000,
    })
    expect(toProxy.proxyUs).toBe(40_000_000)

    const toSource = await coreDispatch<{ sourceUs: number | null }>('proxy.map_time', {
      window_start_us: 50_000_000,
      window_end_us: 200_000_000,
      proxy_us: 40_000_000,
    })
    expect(toSource.sourceUs).toBe(90_000_000)

    const fora = await coreDispatch<{ proxyUs: number | null }>('proxy.map_time', {
      window_start_us: 50_000_000,
      window_end_us: 200_000_000,
      source_us: 10_000_000,
    })
    expect(fora.proxyUs).toBeNull()
  })

  it('guardrails.check usa hasAudio/unverifiedCount/freezeTail* e angles.estimate/choose alinham ao Rust', async () => {
    const gr = await coreDispatch<{
      scope: string
      audio: { hasAudio: boolean; unverifiedCount: number }
    }>('guardrails.check', { scope: 'project' })
    expect(typeof gr.audio.hasAudio).toBe('boolean')
    expect(typeof gr.audio.unverifiedCount).toBe('number')

    const est = await coreDispatch<{ paid: boolean; profile: string; estimate: { kind: string } }>('angles.estimate', {
      candidate: 1,
      language: 'pt',
    })
    expect(typeof est.profile).toBe('string')
    expect(est.profile.length).toBeGreaterThan(0)

    const chosen = await coreDispatch<{
      angles: unknown[]
      generation: number | null
      selected: { name: string; promise: string } | null
      busy: boolean
      job: unknown
    }>('angles.choose', {
      candidate: 1,
      angle: { name: 'Foco no risco', promise: 'Mostra o que mudou no jogo.' },
    })
    expect(chosen.selected).toEqual({ name: 'Foco no risco', promise: 'Mostra o que mudou no jogo.' })
    expect(Array.isArray(chosen.angles)).toBe(true)
    expect(typeof chosen.busy).toBe('boolean')
    expect('generation' in chosen).toBe(true)
    expect('job' in chosen).toBe(true)
  })

  it('selection.candidate.set_kind converte candidato direto para transformed, é idempotente e rejeita direct/inexistente/sem projeto', async () => {
    const rev2 = await coreDispatch<{ candidates: CandidatoDetalhe[] }>('selection.get', {
      run: 1,
      revision: 2,
    })
    const candA = rev2.candidates[0]
    const candB = rev2.candidates[1]

    // direct não é suportado
    await expect(
      coreDispatch('selection.candidate.set_kind', { candidate: candA.id, videoKind: 'direct' }),
    ).rejects.toMatchObject({ code: 'invalid_video_kind' })

    // candidato inexistente
    await expect(
      coreDispatch('selection.candidate.set_kind', { candidate: 999_999, videoKind: 'transformed' }),
    ).rejects.toMatchObject({ code: 'candidate_not_found' })

    // antes da conversão, angles.get bloqueia com script_requires_transformed
    await expect(coreDispatch('angles.get', { candidate: candA.id })).rejects.toMatchObject({
      code: 'script_requires_transformed',
    })

    // converte candA e valida idempotência
    const res1 = await coreDispatch<{
      run: number
      candidate: number
      videoKind: string
      item: ReviewItem & { videoKind?: string }
    }>('selection.candidate.set_kind', { candidate: candA.id, videoKind: 'transformed' })
    expect(res1.candidate).toBe(candA.id)
    expect(res1.videoKind).toBe('transformed')
    expect(res1.item.videoKind).toBe('transformed')

    const res2 = await coreDispatch<{ candidate: number; videoKind: string }>('selection.candidate.set_kind', {
      candidate: candA.id,
      videoKind: 'transformed',
    })
    expect(res2.videoKind).toBe('transformed')

    // selection.review e selection.get refletem transformed só em candA; angles.get e guardrails destravam só em candA
    const review = await coreDispatch<{ items: Array<ReviewItem & { videoKind?: string }> }>('selection.review', {
      run: 1,
    })
    expect(review.items.find((i) => i.candidate === candA.id)?.videoKind).toBe('transformed')
    expect(review.items.find((i) => i.candidate === candB.id)?.videoKind).toBe('direct')

    const getApos = await coreDispatch<{ candidates: Array<CandidatoDetalhe & { videoKind?: string }> }>(
      'selection.get',
      { run: 1, revision: 2 },
    )
    expect(getApos.candidates.find((c) => c.id === candA.id)?.videoKind).toBe('transformed')
    expect(getApos.candidates.find((c) => c.id === candB.id)?.videoKind).toBe('direct')

    await expect(coreDispatch('angles.get', { candidate: candA.id })).resolves.toBeTruthy()
    await expect(coreDispatch('angles.get', { candidate: candB.id })).rejects.toMatchObject({
      code: 'script_requires_transformed',
    })

    const gA = await coreDispatch<{ videoKind: string; script: { applicable: boolean } }>('guardrails.check', {
      scope: 'single',
      source_id: 4,
      candidate_id: candA.id,
    })
    expect(gA.videoKind).toBe('transformed')
    expect(gA.script.applicable).toBe(true)

    // sem projeto aberto deve falhar com project_not_open
    await coreDispatch('projects.close', {})
    await expect(
      coreDispatch('selection.candidate.set_kind', { candidate: candA.id, videoKind: 'transformed' }),
    ).rejects.toMatchObject({ code: 'project_not_open' })
  })
})
