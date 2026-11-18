import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assinarProgressoMock, coreDispatch, obterWavNarrationMock, type EventoProgressoMock } from '@core'

type Angle = { name: string; promise: string; audience?: string; sentence_ids?: number[] }

type ScriptDoc = {
  schemaVersion: number
  revision: number
  detectedLanguage: string | null
  languageRequired: boolean
  angle: Angle | null
  current: {
    generation: number
    language: string
    blocks: Array<{
      id: number
      position: number
      title: string
      intent: string
      refs: number[]
      narration: string | null
      status: 'aprovado' | 'pendente'
      stale: boolean
      version: number
      edited: boolean
      job: unknown
    }>
    totalChars: number
    pending: number
    approved: number
    complete: boolean
  } | null
  narrationAllowed: boolean
  busy: boolean
}

type NarrationDoc = {
  candidate: number
  narrationAllowed: boolean
  gateReason: string | null
  language: string
  alignPrerequisitesReady: boolean
  vadReady: boolean
  blocks: Array<{
    blockId: number
    position: number
    title: string
    narrationText: string | null
    audio: {
      id: number
      engineId: string
      voiceId: string
      modelId: string
      durationUs: number
      trimmed: boolean
      stale: boolean
      cleanup: {
        applicable: boolean
        enabled: boolean
        ready: boolean
        noiseFloorDb: number | null
        noiseFloorSource: string
      } | null
    } | null
    alignment: {
      status: 'pending' | 'aligned' | 'needs_review' | 'approved' | 'failed'
      choice: 'script' | 'spoken' | null
      spokenText: string | null
    } | null
  }>
  totalDurationUs: number
}

describe('mock TS completo de Transformar e Empacotar (Pacote E)', () => {
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

  it('Projeto demo traz Cortes direto (102), transformado fresco (201), V1 pré-populado (202) e V1 offline sem Permissão (301)', async () => {
    // Corte direto 102 rejeita Transformar com script_requires_transformed
    await expect(coreDispatch('angles.get', { candidate: 102 })).rejects.toMatchObject({
      code: 'script_requires_transformed',
    })
    await expect(coreDispatch('script.get', { candidate: 102 })).rejects.toMatchObject({
      code: 'script_requires_transformed',
    })
    await expect(coreDispatch('narration.get', { candidate: 102 })).rejects.toMatchObject({
      code: 'script_requires_transformed',
    })

    // Corte transformado 201 começa sem ângulo e sem roteiro
    const ang201 = await coreDispatch<{ selected: Angle | null; angles: Angle[] }>('angles.get', { candidate: 201 })
    expect(ang201.selected).toBeNull()
    expect(ang201.angles).toEqual([])

    // Corte V1 online 202 já traz Roteiro aprovado, Narração e Empacotamento com capítulos válidos
    const scr202 = await coreDispatch<ScriptDoc>('script.get', { candidate: 202 })
    expect(scr202.narrationAllowed).toBe(true)
    expect(scr202.current?.blocks.length).toBeGreaterThanOrEqual(3)

    const pack202 = await coreDispatch<{
      current: { title: string; fullDescription: string } | null
      credit: { text: string | null; warning: string | null }
      chapters: { status: string; canGenerate: boolean }
    }>('packaging.get', { candidate: 202 })
    expect(pack202.current).not.toBeNull()
    expect(pack202.credit.text).toContain('Criador Exemplo')
    expect(pack202.credit.warning).toBeNull()
    expect(pack202.chapters.status).toBe('ready')

    // Corte V1 offline 301 mantém edição textual e de Narração sem Permissão, mas bloqueia thumbnail.export com source_offline
    const pack301 = await coreDispatch<{
      current: { title: string } | null
      credit: { text: string | null; warning: string | null }
    }>('packaging.get', { candidate: 301 })
    expect(pack301.current).not.toBeNull()
    expect(pack301.credit.text).toBeNull()
    expect(pack301.credit.warning).toBe('no_permission')
    await expect(
      coreDispatch('thumbnail.export', { candidate: 301, output: '/test/exports/capa-301.png' }),
    ).rejects.toMatchObject({ code: 'source_offline' })
  })

  it('angles.* e script.* operam isolados por candidate, respeitam profileId, local_only e emitem core-progress', async () => {
    await coreDispatch('provider.configure', {
      profileId: 'remoto-e',
      label: 'Remoto E',
      kind: 'openai',
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      nativeSchema: false,
    })
    await coreDispatch('provider.configure', {
      profileId: 'local-e',
      label: 'Local E',
      kind: 'ollama',
      endpoint: 'http://127.0.0.1:11434/v1',
      model: 'llama3',
      nativeSchema: false,
    })

    const est = await coreDispatch<{ paid: boolean; profile: string; estimate: { kind: string } }>(
      'angles.estimate',
      { candidate: 201 },
    )
    expect(est.paid).toBe(true)
    expect(typeof est.profile).toBe('string')
    expect(est.profile.length).toBeGreaterThan(0)

    await expect(coreDispatch('angles.generate', { candidate: 201 })).rejects.toMatchObject({
      code: 'confirmation_required',
    })

    const eventos: EventoProgressoMock[] = []
    const unsub = assinarProgressoMock((e) => eventos.push(e))

    await coreDispatch('angles.generate', { candidate: 201, confirmed: true })
    await vi.waitFor(
      async () => {
        const doc = await coreDispatch<{ angles: Angle[]; busy: boolean }>('angles.get', { candidate: 201 })
        expect(doc.busy).toBe(false)
        expect(doc.angles.length).toBeGreaterThanOrEqual(2)
      },
      { timeout: 2000 },
    )

    // Estado de 201 não vaza para 203 (outro candidato)
    const ang203 = await coreDispatch<{ angles: Angle[]; selected: Angle | null }>('angles.get', { candidate: 203 })
    expect(ang203.angles).toEqual([])
    expect(ang203.selected).toBeNull()

    // Escolher sugestão retorna o documento completo de angles.get
    const chosen = await coreDispatch<{
      angles: Angle[]
      generation: number | null
      selected: Angle | null
      busy: boolean
      job: unknown
    }>('angles.choose', { candidate: 201, generation: 1, index: 0 })
    expect(chosen.selected?.name).toBeTruthy()
    expect(Array.isArray(chosen.angles)).toBe(true)
    expect('busy' in chosen).toBe(true)

    // script.narration_allowed rejeita enquanto não houver Roteiro aprovado
    await expect(coreDispatch('script.narration_allowed', { candidate: 201 })).rejects.toMatchObject({
      code: 'script_not_approved',
    })

    // Gera Roteiro para 201
    await coreDispatch('script.generate', { candidate: 201, confirmed: true })
    await vi.waitFor(
      async () => {
        const doc = await coreDispatch<ScriptDoc>('script.get', { candidate: 201 })
        expect(doc.busy).toBe(false)
        expect(doc.current?.blocks.length).toBe(3)
      },
      { timeout: 2000 },
    )

    const docGerado = await coreDispatch<ScriptDoc>('script.get', { candidate: 201 })
    const b0 = docGerado.current!.blocks[0]

    // script.edit atualiza title, narration e refs
    const aposEdicao = await coreDispatch<ScriptDoc>('script.edit', {
      candidate: 201,
      block: b0.id,
      title: 'Título editado do bloco',
      narration: 'Fala revisada do bloco inicial.',
      refs: [10, 11],
    })
    const b0Editado = aposEdicao.current!.blocks[0]
    expect(b0Editado.title).toBe('Título editado do bloco')
    expect(b0Editado.narration).toBe('Fala revisada do bloco inicial.')
    expect(b0Editado.refs).toEqual([10, 11])
    expect(b0Editado.edited).toBe(true)
    expect(b0Editado.status).toBe('pendente')

    // Aprova todos os blocos -> script.narration_allowed passa
    for (const blk of aposEdicao.current!.blocks) {
      await coreDispatch('script.approve', { candidate: 201, block: blk.id })
    }
    const allowed = await coreDispatch<{ allowed: boolean }>('script.narration_allowed', { candidate: 201 })
    expect(allowed).toEqual({ allowed: true })

    // Editar após aprovar retorna bloco para pendente e re-trava narration_allowed
    await coreDispatch('script.edit', {
      candidate: 201,
      block: b0.id,
      narration: 'Edição após aprovação.',
    })
    await expect(coreDispatch('script.narration_allowed', { candidate: 201 })).rejects.toMatchObject({
      code: 'script_not_approved',
    })

    // script.estimate e script.regenerate suportam profileId (local-e vs remoto-e) e block
    const estLocal = await coreDispatch<{ paid: boolean; profile: string }>('script.estimate', {
      candidate: 201,
      block: b0.id,
      profileId: 'local-e',
    })
    expect(estLocal.paid).toBe(false)
    expect(estLocal.profile).toBe('local-e')

    await coreDispatch('projects.local_only.set', { enabled: true })
    await expect(
      coreDispatch('script.estimate', { candidate: 201, block: b0.id, profileId: 'remoto-e' }),
    ).rejects.toMatchObject({ code: 'local_only_violation' })
    await coreDispatch('projects.local_only.set', { enabled: false })

    await coreDispatch('script.regenerate', {
      candidate: 201,
      block: b0.id,
      profileId: 'local-e',
    })
    await vi.waitFor(
      async () => {
        const doc = await coreDispatch<ScriptDoc>('script.get', { candidate: 201 })
        expect(doc.busy).toBe(false)
        expect(doc.current!.blocks[0].narration).toContain('Nova fala')
      },
      { timeout: 2000 },
    )

    // Trocar ângulo com Roteiro existente exige angle_change_confirmation e marca stale: true
    await expect(
      coreDispatch('angles.choose', { candidate: 201, generation: 1, index: 1 }),
    ).rejects.toMatchObject({ code: 'angle_change_confirmation' })
    await coreDispatch('angles.choose', { candidate: 201, generation: 1, index: 1, confirmed: true })
    const aposTroca = await coreDispatch<ScriptDoc>('script.get', { candidate: 201 })
    expect(aposTroca.current!.blocks.every((b) => b.stale && b.status === 'pendente')).toBe(true)

    unsub()
    const stages = eventos.map((e) => e.stage)
    expect(stages.some((s) => s.startsWith('ai:angles:'))).toBe(true)
    expect(stages.some((s) => s.startsWith('ai:script:'))).toBe(true)
    expect(stages.some((s) => s.startsWith('ai:script_block:'))).toBe(true)
  })

  it('narration.* e tts.* operam por candidate, emitem core-progress (inclusive residual job "0" #293) e servem WAV PCM válido', async () => {
    await coreDispatch('angles.choose', {
      candidate: 201,
      angle: { name: 'Ângulo teste', promise: 'Promessa clara.' },
    })
    await coreDispatch('script.generate', { candidate: 201, confirmed: true })
    await vi.waitFor(async () => {
      const s = await coreDispatch<ScriptDoc>('script.get', { candidate: 201 })
      expect(s.current?.blocks.length).toBe(3)
    })
    const scr = await coreDispatch<ScriptDoc>('script.get', { candidate: 201 })
    for (const blk of scr.current!.blocks) {
      await coreDispatch('script.approve', { candidate: 201, block: blk.id })
    }
    const blocos = scr.current!.blocks

    // Instala pocket-tts e modelo PT-BR sem portões ocultos
    await expect(coreDispatch('narration.generate', { candidate: 201 })).rejects.toMatchObject({
      code: 'component_missing',
    })
    await coreDispatch('components.download', { id: 'pocket-tts', confirmed: true })
    await expect(coreDispatch('narration.generate', { candidate: 201 })).rejects.toMatchObject({
      code: 'tts_model_missing',
    })
    await coreDispatch('tts.models.download', {
      id: 'portuguese_24l',
      confirmed: true,
      termsAccepted: true,
    })

    const eventos: EventoProgressoMock[] = []
    const unsub = assinarProgressoMock((e) => eventos.push(e))

    // TTS global
    await coreDispatch('narration.generate', { candidate: 201 })
    await vi.waitFor(async () => {
      const n = await coreDispatch<NarrationDoc>('narration.get', { candidate: 201 })
      expect(n.blocks[0].audio).not.toBeNull()
    })

    // Gravação com teleprompter (emite narration_record + residual job "0" #293)
    await coreDispatch('narration.record_block', {
      candidate: 201,
      block: blocos[0].id,
      audioBase64: 'UklGRg==',
      mimeType: 'audio/wav',
    })
    // Sem fala
    await expect(
      coreDispatch('narration.record_block', {
        candidate: 201,
        block: blocos[0].id,
        audioBase64: 'SILENCE',
        mimeType: 'audio/wav',
      }),
    ).rejects.toMatchObject({
      code: 'no_speech_detected',
      usage: { hasDraft: true },
    })
    const disc = await coreDispatch<{ discarded: boolean }>('narration.discard_draft', {
      candidate: 201,
      block: blocos[0].id,
    })
    expect(disc.discarded).toBe(true)

    // Limpeza Antes/Depois
    const prep = await coreDispatch<{ ready: boolean; cleanRelPath: string }>('narration.cleanup.prepare', {
      candidate: 201,
      block: blocos[0].id,
    })
    expect(prep.ready).toBe(true)
    await coreDispatch('narration.cleanup.set', {
      candidate: 201,
      block: blocos[0].id,
      enabled: false,
    })

    // Importação de áudio e erro de formato
    await expect(
      coreDispatch('narration.import', { candidate: 201, block: blocos[1].id, path: '/tmp/ruim.txt' }),
    ).rejects.toMatchObject({ code: 'import_unsupported_format' })
    await coreDispatch('narration.import', {
      candidate: 201,
      block: blocos[1].id,
      path: '/tmp/fala-improviso.wav',
    })

    // Alinhamento e revisão needs_review
    await coreDispatch('narration.align_block', { candidate: 201, block: blocos[1].id })
    const nar = await coreDispatch<NarrationDoc>('narration.get', { candidate: 201 })
    expect(nar.blocks[1].alignment?.status).toBe('needs_review')
    await coreDispatch('narration.review', {
      candidate: 201,
      block: blocos[1].id,
      choice: 'spoken',
    })
    const narApos = await coreDispatch<NarrationDoc>('narration.get', { candidate: 201 })
    expect(narApos.blocks[1].alignment?.status).toBe('approved')

    unsub()
    expect(eventos.some((e) => e.stage === 'narration')).toBe(true)
    expect(eventos.some((e) => e.stage === 'narration_import')).toBe(true)
    expect(eventos.some((e) => e.stage === 'aligning')).toBe(true)
    expect(eventos.some((e) => e.job === 'narration_record' && e.stage === 'done')).toBe(true)
    expect(eventos.some((e) => e.job === '0' && e.stage === 'narration_record')).toBe(true)

    // WAV PCM válido simulado para narration-original/<id> e narration-clean/<id>
    const origWav = obterWavNarrationMock(`narration-original/${blocos[0].id}`)
    const cleanWav = obterWavNarrationMock(`narration-clean/${blocos[0].id}`)
    expect(origWav).not.toBeNull()
    expect(cleanWav).not.toBeNull()
    expect(String.fromCharCode(...origWav!.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...origWav!.slice(8, 12))).toBe('WAVE')
    expect(String.fromCharCode(...cleanWav!.slice(0, 4))).toBe('RIFF')
  })

  it('thumbnail.* e packaging.* operam por candidate, aplicam Permissão real e validam limites YouTube sem query flags', async () => {
    const eventos: EventoProgressoMock[] = []
    const unsub = assinarProgressoMock((e) => eventos.push(e))

    // thumbnail.estimate sem ?thumbnail-paid usa rota real do Projeto (remoto = paid: true)
    const thEst = await coreDispatch<{ paid: boolean; profile: string }>('thumbnail.estimate', { candidate: 201 })
    expect(thEst.paid).toBe(true)
    await expect(coreDispatch('thumbnail.suggest', { candidate: 201 })).rejects.toMatchObject({
      code: 'confirmation_required',
    })
    await coreDispatch('thumbnail.suggest', { candidate: 201, confirmed: true })
    await vi.waitFor(async () => {
      const th = await coreDispatch<{ current: { instantUs: number } | null; job: { state: string } | null }>(
        'thumbnail.get',
        { candidate: 201 },
      )
      expect(th.current).not.toBeNull()
      expect(th.job?.state).toBe('completed')
    })

    // Validação de bounds e export PNG
    await expect(
      coreDispatch('thumbnail.choose', { candidate: 201, instant_us: 1 }),
    ).rejects.toMatchObject({ code: 'instant_out_of_cut' })
    await expect(
      coreDispatch('thumbnail.export', { candidate: 201, output: 'relativo.txt' }),
    ).rejects.toMatchObject({ code: 'thumbnail_destination' })
    const expOk = await coreDispatch<{ output: string }>('thumbnail.export', {
      candidate: 201,
      output: '/test/exports/capa-201.png',
    })
    expect(expOk.output).toBe('/test/exports/capa-201.png')
    await expect(
      coreDispatch('thumbnail.export', { candidate: 201, output: '/test/exports/capa-201.png' }),
    ).rejects.toMatchObject({ code: 'thumbnail_exists' })

    // packaging.* sem ?packaging-paid
    const pkEst = await coreDispatch<{ paid: boolean; profile: string }>('packaging.estimate', { candidate: 201 })
    expect(pkEst.paid).toBe(true)
    await expect(coreDispatch('packaging.generate', { candidate: 201 })).rejects.toMatchObject({
      code: 'confirmation_required',
    })
    await coreDispatch('packaging.generate', { candidate: 201, confirmed: true })
    await vi.waitFor(async () => {
      const pk = await coreDispatch<{ current: { title: string } | null }>('packaging.get', { candidate: 201 })
      expect(pk.current).not.toBeNull()
    })

    // Validação de todos os limites YouTube em packaging.edit
    await expect(
      coreDispatch('packaging.edit', {
        candidate: 201,
        title: 'x'.repeat(101),
        description: 'ok',
        tags: [],
        hashtags: [],
      }),
    ).rejects.toMatchObject({
      code: 'edit_invalid',
      usage: { violations: expect.arrayContaining([expect.objectContaining({ code: 'title_too_long' })]) },
    })

    await expect(
      coreDispatch('packaging.edit', {
        candidate: 201,
        title: 'Título ok',
        description: 'é'.repeat(2501), // 5002 bytes UTF-8 > 5000
        tags: [],
        hashtags: [],
      }),
    ).rejects.toMatchObject({
      code: 'edit_invalid',
      usage: { violations: expect.arrayContaining([expect.objectContaining({ code: 'description_too_long' })]) },
    })

    await expect(
      coreDispatch('packaging.edit', {
        candidate: 201,
        title: 'Título ok',
        description: 'Desc',
        tags: Array.from({ length: 31 }, (_, i) => `t${i}`),
        hashtags: [],
      }),
    ).rejects.toMatchObject({
      code: 'edit_invalid',
      usage: { violations: expect.arrayContaining([expect.objectContaining({ code: 'too_many_tags' })]) },
    })

    await expect(
      coreDispatch('packaging.edit', {
        candidate: 201,
        title: 'Título ok',
        description: 'Desc',
        tags: ['t'.repeat(61)],
        hashtags: [],
      }),
    ).rejects.toMatchObject({
      code: 'edit_invalid',
      usage: { violations: expect.arrayContaining([expect.objectContaining({ code: 'tag_too_long' })]) },
    })

    await expect(
      coreDispatch('packaging.edit', {
        candidate: 201,
        title: 'Título ok',
        description: 'Desc',
        tags: [],
        hashtags: Array.from({ length: 16 }, (_, i) => `#tag${i}`),
      }),
    ).rejects.toMatchObject({
      code: 'edit_invalid',
      usage: { violations: expect.arrayContaining([expect.objectContaining({ code: 'too_many_hashtags' })]) },
    })

    await expect(
      coreDispatch('packaging.edit', {
        candidate: 201,
        title: 'Título ok',
        description: 'Desc',
        tags: [],
        hashtags: ['semhash'],
      }),
    ).rejects.toMatchObject({
      code: 'edit_invalid',
      usage: { violations: expect.arrayContaining([expect.objectContaining({ code: 'invalid_hashtag' })]) },
    })

    unsub()
    expect(eventos.some((e) => e.stage.startsWith('ai:thumbnail:'))).toBe(true)
    expect(eventos.some((e) => e.stage.startsWith('ai:packaging:'))).toBe(true)
  })
})
