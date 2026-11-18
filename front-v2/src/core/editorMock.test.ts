import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assinarProgressoMock, coreDispatch, type EventoProgressoMock } from '@core'

describe('mock TS completo do Editor, Legendas, Reframe, Tradução, Áudio e Exportação (sem flags ocultas)', () => {
  beforeEach(async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
    await coreDispatch('projects.open', { path: '/projetos/Demo.clipes' })
  })

  afterEach(async () => {
    try {
      await coreDispatch('projects.close', {})
    } catch {
      // ignora
    }
    vi.unstubAllEnvs()
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
  })

  it('Demo.clipes traz Corte direto, Vídeo transformado, Corte V1 com edições e Corte avulso sem query flags', async () => {
    const runs4 = await coreDispatch<Array<{ id: number; videoKind: string }>>('selection.list', { source_id: 4 })
    expect(runs4.some((r) => r.videoKind === 'direct')).toBe(true)

    const runs5 = await coreDispatch<Array<{ id: number; videoKind: string }>>('selection.list', { source_id: 5 })
    expect(runs5.some((r) => r.videoKind === 'transformed')).toBe(true)

    // Corte direto
    const direto = await coreDispatch<{ clipId: number; montage: unknown }>('editor.open', {
      source_id: 4,
      start_id: 40,
      end_id: 41,
      candidate_id: 102,
    })
    expect(direto.clipId).toBeGreaterThan(0)
    expect(direto.montage).toBeNull()

    // Vídeo transformado com montagem existente
    const transformado = await coreDispatch<{ clipId: number; montage: { blocks: unknown[] } | null }>('editor.open', {
      source_id: 5,
      start_id: 10,
      end_id: 14,
      candidate_id: 201,
    })
    expect(transformado.montage).not.toBeNull()
    expect(transformado.montage!.blocks.length).toBeGreaterThan(0)

    // Corte V1 com edições pré-existentes e snapshots
    const v1 = await coreDispatch<{ clipId: number; crop: { layout: string | null } }>('editor.open', {
      source_id: 5,
      start_id: 40,
      end_id: 41,
      candidate_id: 202,
    })
    expect(v1.crop.layout).toBe('face')
    const snapsV1 = await coreDispatch<Array<{ snapshot_id: number }>>('editor.snapshots', { clip_id: v1.clipId })
    expect(snapsV1.length).toBeGreaterThan(0)

    // Corte avulso (sem candidate_id)
    const avulso = await coreDispatch<{ clipId: number; request: { candidate_id?: number } }>('editor.open', {
      source_id: 4,
      start_id: 10,
      end_id: 14,
    })
    expect(avulso.request.candidate_id).toBeUndefined()
  })

  it('editor.sentences, editor.timeline/wave emitindo core-progress, editor.adjust (preview vs commit), undo/redo, snapshots e flush (?estado=erro-flush)', async () => {
    const aberto = await coreDispatch<{
      clipId: number
      startUs: number
      endUs: number
      windowStartUs: number
      windowEndUs: number
      undoCount: number
    }>('editor.open', {
      source_id: 4,
      start_id: 10,
      end_id: 14,
      candidate_id: 102,
    })

    const frases = await coreDispatch<Array<{ id: number; startUs: number; endUs: number; text: string }>>(
      'editor.sentences',
      { source_id: 4, start_us: aberto.windowStartUs, end_us: aberto.windowEndUs, after_id: 0, limit: 50 },
    )
    expect(frases.length).toBeGreaterThan(0)

    const eventos: EventoProgressoMock[] = []
    const unsub = assinarProgressoMock((e) => eventos.push(e))

    const tl = await coreDispatch<{ state: string; key: string }>('editor.timeline', {
      source_id: 4,
      start_us: aberto.startUs,
      end_us: aberto.endUs,
    })
    expect(tl.key).toBeTruthy()
    await vi.waitFor(() => {
      expect(eventos.some((e) => e.stage === 'timeline' || e.stage === 'complete')).toBe(true)
    })

    const wave = await coreDispatch<{ blockUs: number; values: number[] }>('editor.wave', { key: tl.key })
    expect(wave.values.length).toBeGreaterThan(0)

    // preview: true não cria passo no undo
    const previa = await coreDispatch<{ startUs: number; undoCount: number }>('editor.adjust', {
      clip_id: aberto.clipId,
      edge: 'start',
      sentence_delta: -1,
      preview: true,
    })
    expect(previa.startUs).toBeLessThan(aberto.startUs)
    expect(previa.undoCount).toBe(aberto.undoCount)

    // preview: false grava undo e permite undo/redo
    const confirmado = await coreDispatch<{ startUs: number; undoCount: number }>('editor.adjust', {
      clip_id: aberto.clipId,
      edge: 'start',
      sentence_delta: -1,
      preview: false,
    })
    expect(confirmado.undoCount).toBe(aberto.undoCount + 1)

    const desfeito = await coreDispatch<{ startUs: number; undoCount: number; redoCount: number }>('editor.undo', {
      clip_id: aberto.clipId,
    })
    expect(desfeito.startUs).toBe(aberto.startUs)
    expect(desfeito.redoCount).toBe(1)

    const refeito = await coreDispatch<{ startUs: number; undoCount: number }>('editor.redo', {
      clip_id: aberto.clipId,
    })
    expect(refeito.startUs).toBe(confirmado.startUs)

    // editor.flush grava snapshot e emite editor_saved
    await coreDispatch('editor.flush', {})
    expect(eventos.some((e) => e.stage === 'editor_saved' && e.job === `editor:${aberto.clipId}`)).toBe(true)

    const snaps = await coreDispatch<Array<{ snapshot_id: number; range: { startUs: number } }>>('editor.snapshots', {
      clip_id: aberto.clipId,
    })
    expect(snaps.length).toBeGreaterThan(0)
    expect(snaps[0].range.startUs).toBe(confirmado.startUs)

    // ?estado=erro-flush rejeita com project_write e emite editor_save_failed
    window.location.hash = '#/projeto/demo/corte/102/editar?estado=erro-flush'
    await expect(coreDispatch('editor.flush', {})).rejects.toMatchObject({ code: 'project_write' })
    expect(eventos.some((e) => e.stage === 'editor_save_failed' && e.job === 'editor')).toBe(true)

    unsub()
  })

  it('editor.crop.*, reframe.start/status com core-progress e preservação de edits manuais', async () => {
    const aberto = await coreDispatch<{ clipId: number; startUs: number; endUs: number }>('editor.open', {
      source_id: 4,
      start_id: 10,
      end_id: 14,
      candidate_id: 101,
    })

    const eventos: EventoProgressoMock[] = []
    const unsub = assinarProgressoMock((e) => eventos.push(e))

    const editManual = [{ timeUs: aberto.startUs, x: 0.1, y: 0.1, width: 0.3, height: 0.8 }]
    const comEdit = await coreDispatch<{ edits: unknown[] }>('editor.crop.set_edits', {
      clip_id: aberto.clipId,
      panel: 'primary',
      edits: editManual,
      preview: false,
    })
    expect(comEdit.edits).toHaveLength(1)

    const ref = await coreDispatch<{ id: number; job: number }>('reframe.start', {
      source: 4,
      startUs: aberto.startUs,
      endUs: aberto.endUs,
      layout: 'face',
    })
    await vi.waitFor(() => {
      expect(eventos.some((e) => e.job === String(ref.job) && e.stage === 'complete')).toBe(true)
    })
    unsub()
    expect(eventos.some((e) => e.stage === 'reframe_faces')).toBe(true)

    const st = await coreDispatch<{ state: string; timeline: unknown }>('reframe.status', { id: ref.id })
    expect(st.state).toBe('completed')
    expect(st.timeline).not.toBeNull()

    const aplicado = await coreDispatch<{ suggested: unknown; edits: unknown[]; undoCount: number }>(
      'editor.crop.set_suggested',
      { clip_id: aberto.clipId, reframe_id: ref.id },
    )
    expect(aplicado.suggested).not.toBeNull()
    expect(aplicado.edits).toHaveLength(1)
    expect(aplicado.undoCount).toBe(1) // set_suggested não entra no undo
  })

  it('captions.* isola overrides por transcript_id e translation.* respeita permissão por sourceId + emite ai:translation:*', async () => {
    // Fonte 4 tem permissão com escopo tradução; Fonte 1 não tem permissão
    const aberto4 = await coreDispatch<{ clipId: number }>('editor.open', {
      source_id: 4,
      start_id: 10,
      end_id: 14,
      candidate_id: 102,
    })
    const aberto1 = await coreDispatch<{ clipId: number }>('editor.open', {
      source_id: 1,
      start_id: 10,
      end_id: 14,
    })

    // Isolamento por transcript_id em captions.override / export.captions
    await coreDispatch('captions.override', {
      transcript_id: 4,
      position: 0,
      overrides: { color: '#00FF00' },
    })
    const cap4 = await coreDispatch<{ words: Array<{ position: number; overrides: { color?: string } }> }>(
      'export.captions',
      { clip_id: aberto4.clipId, transcript_id: 4, start_us: 0, end_us: 4_500_000 },
    )
    const cap1 = await coreDispatch<{ words: Array<{ position: number; overrides: { color?: string } }> }>(
      'export.captions',
      { clip_id: aberto1.clipId, transcript_id: 1, start_us: 0, end_us: 4_500_000 },
    )
    expect(cap4.words[0].overrides.color).toBe('#00FF00')
    expect(cap1.words[0].overrides.color).toBeUndefined()

    // Permissão por sourceId em translation.*
    const doc1 = await coreDispatch<{ permitted: boolean; permissionError: { code: string } | null }>(
      'translation.get',
      { clip_id: aberto1.clipId },
    )
    expect(doc1.permitted).toBe(false)
    expect(doc1.permissionError?.code).toBe('translation_permission_required')

    const doc4 = await coreDispatch<{ permitted: boolean; sourceId: number }>('translation.get', {
      clip_id: aberto4.clipId,
    })
    expect(doc4.permitted).toBe(true)
    expect(doc4.sourceId).toBe(4)

    const eventos: EventoProgressoMock[] = []
    const unsub = assinarProgressoMock((e) => eventos.push(e))

    const started = await coreDispatch<{ run: number; jobs: number[] }>('translation.start', {
      clip_id: aberto4.clipId,
      target_language: 'en',
      confirmed: true,
    })
    expect(started.jobs.length).toBeGreaterThan(0)

    await vi.waitFor(() => {
      expect(eventos.some((e) => e.job === String(started.jobs[0]) && e.stage === 'ai:translation:done')).toBe(true)
    })
    unsub()

    const docApos = await coreDispatch<{ hasTranslation: boolean }>('translation.get', {
      clip_id: aberto4.clipId,
    })
    expect(docApos.hasTranslation).toBe(true)
  })

  it('audio.* alinha defaults ao Rust (0.30/0/0/0.80), exige atribuição em cc_by e export.* emite core-progress + ?estado=fallback', async () => {
    const aberto = await coreDispatch<{ clipId: number }>('editor.open', {
      source_id: 4,
      start_id: 10,
      end_id: 14,
      candidate_id: 102,
    })

    await expect(
      coreDispatch('audio.import', { kind: 'music', path: '/tmp/musica.mp3', license_kind: 'cc_by' }),
    ).rejects.toMatchObject({ code: 'attribution_required' })

    const musica = await coreDispatch<{ id: number }>('audio.import', {
      kind: 'music',
      path: '/tmp/musica.mp3',
      license_kind: 'cc_by',
      license_attribution: 'Artista CC-BY',
    })
    const sfx = await coreDispatch<{ id: number }>('audio.import', {
      kind: 'sfx',
      path: '/tmp/whoosh.wav',
      license_kind: 'cc0',
    })

    const comTrilha = await coreDispatch<{
      audioMix: { soundtrack: { volume: number; fadeInUs: number; fadeOutUs: number } | null }
    }>('editor.audio.soundtrack.set', { clip_id: aberto.clipId, asset_id: musica.id })
    expect(comTrilha.audioMix.soundtrack?.volume).toBe(0.3)
    expect(comTrilha.audioMix.soundtrack?.fadeInUs).toBe(0)
    expect(comTrilha.audioMix.soundtrack?.fadeOutUs).toBe(0)

    const comSfx = await coreDispatch<{ audioMix: { sfx: Array<{ volume: number }> } }>('editor.audio.sfx.add', {
      clip_id: aberto.clipId,
      asset_id: sfx.id,
      anchor: { kind: 'moment', sourceUs: 395_000_000 },
    })
    expect(comSfx.audioMix.sfx[0].volume).toBe(0.8)

    const gr = await coreDispatch<{ audio: { hasAudio: boolean; unverifiedCount: number } }>('guardrails.check', {
      scope: 'single',
      source_id: 4,
      candidate_id: 102,
      clip_id: aberto.clipId,
    })
    expect(gr.audio.hasAudio).toBe(true)
    expect(gr.audio.unverifiedCount).toBe(0)

    // export.start + export.status + core-progress + ?estado=fallback
    window.location.hash = '#/projeto/demo/corte/102/editar?estado=fallback'
    const eventos: EventoProgressoMock[] = []
    const unsub = assinarProgressoMock((e) => eventos.push(e))

    const exp = await coreDispatch<{ job: number; state: string }>('export.start', {
      source_id: 4,
      start_id: 40,
      end_id: 41,
      candidate_id: 102,
      clip_id: aberto.clipId,
      output: '/test/exports/corte-102.mp4',
    })
    expect(exp.state).toBe('queued')

    await vi.waitFor(() => {
      expect(eventos.some((e) => e.job === String(exp.job) && e.stage === 'complete')).toBe(true)
    })
    unsub()

    const status = await coreDispatch<{
      job: number
      state: string
      encoder: string | null
      encoderFallback: { from: string; reason: string } | null
    }>('export.status', { job: exp.job })
    expect(status.state).toBe('completed')
    expect(status.encoder).toBe('libx264')
    expect(status.encoderFallback).not.toBeNull()
  })
})
