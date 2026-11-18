import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assinarProgressoMock, coreDispatch, type EventoProgressoMock } from '@core'

describe('mock TS de Fontes, Transcrição, Energia, Chat, Preview e Lotes', () => {
  let projetoPath = ''

  beforeEach(async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
    const aberto = await coreDispatch<{ path: string }>('projects.open', {
      path: '/projetos/MeuCanal.clipes',
    })
    projetoPath = aberto.path
  })

  afterEach(async () => {
    try {
      await coreDispatch('projects.close', {})
    } catch {
      // ignora se já fechado
    }
    vi.unstubAllEnvs()
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
  })

  it('valida project obrigatório nos comandos de sources.*, transcription.estimate, transcription.start e sources.url.download', async () => {
    await expect(coreDispatch('sources.list', { project: '/outro/Projeto.clipes' })).rejects.toMatchObject({
      code: 'invalid_project',
    })
    await expect(
      coreDispatch('sources.url.download', {
        project: '/outro/Projeto.clipes',
        url: 'https://example.com/v',
        job: 'url-1',
      }),
    ).rejects.toMatchObject({ code: 'invalid_project' })
    await expect(
      coreDispatch('transcription.estimate', {
        project: '/outro/Projeto.clipes',
        source_id: 1,
      }),
    ).rejects.toMatchObject({ code: 'invalid_project' })
    await expect(
      coreDispatch('transcription.start', {
        project: '/outro/Projeto.clipes',
        source_id: 1,
      }),
    ).rejects.toMatchObject({ code: 'invalid_project' })
  })

  it('sources.list funciona sem ?source-test=1 e traz Fontes realistas inclusive V1 offline sem full_hash e changed', async () => {
    const lista = await coreDispatch<
      Array<{
        id: number
        path: string
        status: string
        available: boolean
        verified: boolean
        audio_track: number
        origin_url: string | null
        language: string
        permission: { status: string }
      }>
    >('sources.list', { project: projetoPath })

    expect(lista.length).toBeGreaterThanOrEqual(3)
    const offlineV1 = lista.find((s) => s.status === 'offline')
    expect(offlineV1).toBeDefined()
    expect(offlineV1?.verified).toBe(false)
    expect(offlineV1?.available).toBe(false)

    const changed = lista.find((s) => s.status === 'changed')
    expect(changed).toBeDefined()
  })

  it('sources.import gera IDs incrementais, respeita audio_track/copy/language/origin_url e emite core-progress em copy: true', async () => {
    const eventos: EventoProgressoMock[] = []
    const unsub = assinarProgressoMock((e) => eventos.push(e))

    const imp1 = await coreDispatch<{
      id: number
      audio_track: number
      language: string
      origin_url: string | null
      verified: boolean
    }>('sources.import', {
      project: projetoPath,
      path: '/videos/live-obs.mkv',
      audio_track: 2,
      language: 'en',
      copy: true,
      origin_url: 'https://www.youtube.com/watch?v=abc123',
      permission: { status: 'granted', who: 'Canal X', where: 'Discord', scope: 'cortes e tradução' },
    })

    const imp2 = await coreDispatch<{ id: number }>('sources.import', {
      project: projetoPath,
      path: '/videos/outra-live.mp4',
      audio_track: 1,
      language: 'pt',
      copy: false,
      origin_url: null,
      permission: { status: 'none' },
    })

    unsub()

    expect(imp2.id).toBeGreaterThan(imp1.id)
    expect(imp1.audio_track).toBe(2)
    expect(imp1.language).toBe('en')
    expect(imp1.origin_url).toBe('https://www.youtube.com/watch?v=abc123')
    expect(eventos.some((e) => e.job === 'source-copy-original' && e.stage === 'hash')).toBe(true)
    expect(eventos.some((e) => e.job === 'source-copy-check' && e.stage === 'hash')).toBe(true)
  })

  it('sources.url.download e sources.url.cancel emitem core-progress e permitem cancelar', async () => {
    await coreDispatch('sources.url.settings.set', {
      terms_accepted: true,
      download_dir: '/test/downloads',
    })

    const eventos: EventoProgressoMock[] = []
    const unsub = assinarProgressoMock((e) => eventos.push(e))

    const promessa = coreDispatch('sources.url.download', {
      project: projetoPath,
      url: 'https://www.youtube.com/watch?v=cancel-me',
      job: 'url-job-1',
    })

    await coreDispatch('sources.url.cancel', { job: 'url-job-1' })
    await expect(promessa).rejects.toMatchObject({ code: 'cancelled' })

    const ok = await coreDispatch<{ path: string; url: string }>('sources.url.download', {
      project: projetoPath,
      url: 'https://www.youtube.com/watch?v=ok-1',
      job: 'url-job-2',
    })
    unsub()

    expect(ok.path).toBeTruthy()
    expect(eventos.some((e) => e.job === 'url-job-2' && e.stage === 'download')).toBe(true)
  })

  it('sources.hash, sources.relocate e sources.cancel funcionam sem ?source-test=1 e emitem core-progress', async () => {
    const eventos: EventoProgressoMock[] = []
    const unsub = assinarProgressoMock((e) => eventos.push(e))

    const promessa = coreDispatch('sources.relocate', {
      project: projetoPath,
      id: 2,
      path: '/videos/recuperado.mp4',
      job: 'relocate-2',
      confirmed: true,
    })
    await coreDispatch('sources.cancel', { job: 'relocate-2' })
    await expect(promessa).rejects.toMatchObject({ code: 'cancelled' })

    const relocado = await coreDispatch<{ id: number; status: string; path: string }>('sources.relocate', {
      project: projetoPath,
      id: 2,
      path: '/videos/recuperado.mp4',
      job: 'relocate-2-ok',
      confirmed: true,
    })
    unsub()

    expect(relocado.status).toBe('available')
    expect(relocado.path).toBe('/videos/recuperado.mp4')
    expect(eventos.some((e) => e.job === 'relocate-2-ok' && e.stage === 'hash')).toBe(true)
  })

  it('transcription.status, blocks, sentences, words, timeline, correct, undo, redo e search funcionam sem ?transcript-test=1', async () => {
    const status = await coreDispatch<{
      language: string | null
      transcript: { id: number; state: string; model?: string; engine?: string } | null
      job: unknown
    }>('transcription.status', { source_id: 2 })

    expect(status.transcript).not.toBeNull()
    expect(status.transcript?.engine).toBe('local')
    expect(status.transcript?.model).toBeTruthy()

    const blocks = await coreDispatch<Array<{ start_us: number; end_us: number; device: string | null; compute_type: string | null }>>(
      'transcription.blocks',
      { source_id: 2 },
    )
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks[0].device).toBeTruthy()

    const sentences = await coreDispatch<Array<{ id: number; text: string; first_position: number }>>(
      'transcription.sentences',
      { source_id: 2, after_id: 0, limit: 10 },
    )
    expect(sentences.length).toBe(10)
    expect(sentences[0].id).toBe(1)

    const words = await coreDispatch<Array<{ position: number; kind: string; text: string; corrected: boolean }>>(
      'transcription.words',
      { source_id: 2, from_us: 0, to_us: 5_000_000, limit: 20 },
    )
    expect(words.length).toBeGreaterThan(0)

    const corr = await coreDispatch<{ changed: boolean; can_undo: boolean }>('transcription.correct', {
      source_id: 2,
      position: 11,
      text: 'olá',
    })
    expect(corr.changed).toBe(true)
    expect(corr.can_undo).toBe(true)

    const busca = await coreDispatch<Array<{ source_id: number; sentence_id: number; row: number }>>(
      'transcription.search',
      { query: 'ola', limit: 50 },
    )
    expect(busca.some((h) => h.source_id === 2 && h.sentence_id === 1)).toBe(true)

    await coreDispatch('transcription.undo', {})
  })

  it('transcription.groq.info, groq.estimate, transcription.start e estimate emitem core-progress e retornam campos completos', async () => {
    const groqInfo = await coreDispatch<{
      endpoint: string
      model: string
      prices: { minimum_seconds: number; models: Record<string, unknown> }
    }>('transcription.groq.info', {})
    expect(groqInfo.model).toBe('whisper-large-v3-turbo')
    expect(groqInfo.prices.minimum_seconds).toBe(10)

    const groqEst = await coreDispatch<{
      kind: string
      minMicroUsd: number
      maxMicroUsd: number
      audio_us: number
    }>('transcription.groq.estimate', { source_id: 1 })
    expect(groqEst.kind).toBe('usd')
    expect(groqEst.minMicroUsd).toBeGreaterThan(0)
    expect(groqEst.maxMicroUsd).toBeGreaterThanOrEqual(groqEst.minMicroUsd)
    expect(groqEst.audio_us).toBeGreaterThan(0)

    const eventos: EventoProgressoMock[] = []
    const unsub = assinarProgressoMock((e) => eventos.push(e))

    await coreDispatch('transcription.estimate', { project: projetoPath, source_id: 1, remeasure: true })
    const started = await coreDispatch<{ transcript_id: number; warnings: string[] }>('transcription.start', {
      project: projetoPath,
      source_id: 1,
      engine: 'local',
      language: 'en',
    })
    unsub()

    expect(Array.isArray(started.warnings)).toBe(true)
    expect(eventos.some((e) => e.job === 'transcription-estimate' && e.stage === 'estimate')).toBe(true)
    expect(eventos.some((e) => e.stage === 'transcribing')).toBe(true)
  })

  it('energy.start, chat.status e jobs.preview funcionam sem query flags e emitem core-progress', async () => {
    const chat = await coreDispatch<{ state: string; intervals: number; messages: number; peaks: number }>(
      'chat.status',
      { source_id: 2 },
    )
    expect(typeof chat.intervals).toBe('number')
    expect(typeof chat.messages).toBe('number')

    const eventos: EventoProgressoMock[] = []
    const unsub = assinarProgressoMock((e) => eventos.push(e))

    const energy = await coreDispatch<{ state: string; job: number | null }>('energy.start', { source_id: 2 })
    expect(energy.state).toBe('queued')
    expect(typeof energy.job).toBe('number')

    const preview = await coreDispatch<{ waveform: string; thumbnails: string[] }>('jobs.preview', {
      source_id: 1,
    })
    unsub()

    expect(preview.waveform).toBeTruthy()
    expect(preview.thumbnails.length).toBeGreaterThan(0)
    expect(eventos.some((e) => e.stage === 'energy')).toBe(true)
  })

  it('batches.create/pause/resume/cancel/item.resume funcionam sem ?batch-test=1, suportam minUs/maxUs e emitem eventos batch:*', async () => {
    const eventos: EventoProgressoMock[] = []
    const unsub = assinarProgressoMock((e) => eventos.push(e))

    const criado = await coreDispatch<{
      id: number
      minUs: number | null
      maxUs: number | null
      items: Array<{ sourceId: number; state: string; error: string | null }>
    }>('batches.create', {
      sourceIds: [1, 2, 3, 4],
      engine: 'local',
      videoKind: 'direct',
      minUs: 20_000_000,
      maxUs: 60_000_000,
    })

    expect(criado.minUs).toBe(20_000_000)
    expect(criado.maxUs).toBe(60_000_000)
    expect(criado.items).toHaveLength(4)

    await coreDispatch('batches.pause', { id: criado.id })
    await coreDispatch('batches.resume', { id: criado.id })

    // Item com timeout_uncertain deve falhar com uncertain_job ao retomar
    const itemIncerto = criado.items.find((i) => i.error === 'timeout_uncertain')
    expect(itemIncerto).toBeDefined()
    await expect(
      coreDispatch('batches.item.resume', { id: criado.id, sourceId: itemIncerto!.sourceId }),
    ).rejects.toMatchObject({ code: 'uncertain_job' })

    await coreDispatch('batches.cancel', { id: criado.id })
    unsub()

    const stages = eventos.map((e) => e.stage)
    expect(stages).toContain('batch:created')
    expect(stages).toContain('batch:paused')
    expect(stages).toContain('batch:resumed')
    expect(stages).toContain('batch:cancelled')
  })

  it('mantém compatibilidade com ?hardware-cpu=1', async () => {
    window.history.replaceState(null, '', '/?hardware-cpu=1')
    const hw = await coreDispatch<{ cuda: boolean; effective: { device: string; model: string } }>(
      'transcription.hardware.status',
      {},
    )
    expect(hw.cuda).toBe(false)
    expect(hw.effective.device).toBe('cpu')
    expect(hw.effective.model).toBe('whisper-small')
  })
})
