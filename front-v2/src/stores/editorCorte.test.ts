import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErroCore } from '~/core/cliente'
import type { Job } from '~/core/progresso'
import { criarStoreEditorCorte, parsearCorteId } from '~/stores/editorCorte'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

function criarDocEditor(parcial: Record<string, unknown> = {}) {
  return {
    clipId: 11,
    schemaVersion: 2,
    request: { source_id: 4, start_id: 10, end_id: 14, candidate_id: 102 },
    startUs: 90_000_000,
    endUs: 140_000_000,
    windowStartUs: 0,
    windowEndUs: 260_000_000,
    fps: 24,
    sourceAspect: 16 / 9,
    revision: 0,
    undoCount: 0,
    redoCount: 0,
    silences: {
      enabled: true,
      thresholdUs: 600_000,
      intervals: [
        { id: 1, startUs: 95_120_000, endUs: 95_920_000, gapStartUs: 95_000_000, gapEndUs: 96_000_000, status: 'active' },
      ],
      segments: [],
      removedUs: 800_000,
      effectiveDurationUs: 49_200_000,
    },
    crop: {
      layout: 'face',
      explicitLayout: 'face',
      splitRatio: 0.3,
      suggested: null,
      edits: [],
      gameplayWebcam: null,
      twoPeople: null,
      resolved: [],
      hasCrop: true,
    },
    montage: null,
    audioMix: {
      soundtrack: null,
      sfx: [],
      speechIntervals: [],
      totalDurationUs: 49_200_000,
      unverifiedCount: 0,
      warnings: [],
    },
    ...parcial,
  }
}

function criarLegendasBase(track: 'original' | 'translated' | 'narration' = 'original') {
  return {
    style: {
      schemaVersion: 1,
      revision: 0,
      preset: 'vertical',
      font: 'Noto Sans',
      fontSize: 64,
      color: '#FFFFFF',
      activeColor: '#FACC15',
      dimColor: '#FFFFFF',
      outlineColor: '#101010',
      outline: 6,
      shadow: 0,
      x: 540,
      y: 1440,
      highlight: true,
    },
    cues: [],
    emojiRemoved: 0,
    words: [],
    transcriptId: 4,
    start_us: 90_000_000,
    end_us: 140_000_000,
    missingGlyphs: [],
    track,
    availableTracks: ['original', 'translated'],
    narrationSummary: null,
  }
}

describe('parsearCorteId', () => {
  it('interpreta candidateId numérico e token avulso-<sourceId>-<startId>-<endId> e rejeita inválidos', () => {
    expect(parsearCorteId('12')).toEqual({ kind: 'candidate', candidateId: 12 })
    expect(parsearCorteId('avulso-2-5-9')).toEqual({
      kind: 'avulso',
      sourceId: 2,
      startId: 5,
      endId: 9,
    })

    expect(parsearCorteId('abc')).toBeNull()
    expect(parsearCorteId('')).toBeNull()
    expect(parsearCorteId('0')).toBeNull()
    expect(parsearCorteId('-3')).toBeNull()
    expect(parsearCorteId('12.5')).toBeNull()
    expect(parsearCorteId('avulso-0-5-9')).toBeNull()
    expect(parsearCorteId('avulso-2-9-5')).toBeNull()
    expect(parsearCorteId('avulso-2-5')).toBeNull()
  })
})

describe('store editorCorte', () => {
  beforeEach(() => {
    chamarMock.mockReset()
  })

  it('abrir Corte dispara editor.open, editor.sentences, export.captions, audio.list, translation.get, captions.remap_status e proxy.request (e omite proxy.request em Fonte offline)', async () => {
    const chamadas: string[] = []
    chamarMock.mockImplementation(async (cmd: string) => {
      chamadas.push(cmd)
      if (cmd === 'editor.open') return criarDocEditor()
      if (cmd === 'editor.sentences') return [{ id: 10, startUs: 90_000_000, endUs: 100_000_000, text: 'Frase 10' }]
      if (cmd === 'export.captions') return criarLegendasBase('original')
      if (cmd === 'audio.list') return []
      if (cmd === 'translation.get') return { clipId: 11, sourceId: 4, activeTrack: 'original', hasTranslation: false, sentences: [] }
      if (cmd === 'captions.remap_status') return { discarded: 0 }
      if (cmd === 'proxy.request') return { state: 'running', key: 'abc', job: 7, progress: 40, error: null }
      return null
    })

    const store = criarStoreEditorCorte()
    store.definirProjeto('/projetos/Demo.clipes')
    await store.abrir({
      corteId: '102',
      sourceId: 4,
      startId: 10,
      endId: 14,
      candidateId: 102,
      fonteDisponivel: true,
    })

    expect(chamadas[0]).toBe('editor.open')
    expect(chamadas).toContain('editor.sentences')
    expect(chamadas).toContain('export.captions')
    expect(chamadas).toContain('audio.list')
    expect(chamadas).toContain('translation.get')
    expect(chamadas).toContain('captions.remap_status')
    expect(chamadas).toContain('proxy.request')
    expect(store.obterSnapshot().modoSomenteLeituraMidia).toBe(false)
    expect(store.obterSnapshot().frases).toHaveLength(1)

    // Fonte offline não chama proxy.request e ativa modoSomenteLeituraMidia
    chamadas.length = 0
    await store.abrir({
      corteId: 'avulso-2-5-9',
      sourceId: 2,
      startId: 5,
      endId: 9,
      fonteDisponivel: false,
    })

    expect(chamadas).toContain('editor.open')
    expect(chamadas).toContain('editor.sentences')
    expect(chamadas).not.toContain('proxy.request')
    expect(store.obterSnapshot().modoSomenteLeituraMidia).toBe(true)
  })

  it('preview: true atualiza previaLocal sem incrementar undoCount nem marcar dirty; preview: false atualiza oficial e marca dirty', async () => {
    const docInicial = criarDocEditor()
    chamarMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'editor.open') return docInicial
      if (cmd === 'editor.sentences') return []
      if (cmd === 'export.captions') return criarLegendasBase('original')
      if (cmd === 'audio.list') return []
      if (cmd === 'translation.get') return { clipId: 11, sourceId: 4, activeTrack: 'original', hasTranslation: false, sentences: [] }
      if (cmd === 'captions.remap_status') return { discarded: 0 }
      if (cmd === 'proxy.request') return { state: 'running', key: 'abc', job: 7, progress: 40, error: null }
      if (cmd === 'editor.adjust') {
        if (args?.preview) {
          return criarDocEditor({ startUs: 80_000_000, undoCount: 0, revision: 0 })
        }
        return criarDocEditor({ startUs: 80_000_000, undoCount: 1, revision: 1 })
      }
      return null
    })

    const store = criarStoreEditorCorte()
    store.definirProjeto('/projetos/Demo.clipes')
    await store.abrir({
      corteId: '102',
      sourceId: 4,
      startId: 10,
      endId: 14,
      candidateId: 102,
      fonteDisponivel: true,
    })

    await store.ajustarBorda({ edge: 'start', sentenceDelta: -1, preview: true })
    let snap = store.obterSnapshot()
    expect(snap.previaLocal?.startUs).toBe(80_000_000)
    expect(snap.oficial?.startUs).toBe(90_000_000)
    expect(snap.oficial?.undoCount).toBe(0)
    expect(snap.dirty).toBe(false)

    await store.ajustarBorda({ edge: 'start', sentenceDelta: -1, preview: false })
    snap = store.obterSnapshot()
    expect(snap.previaLocal).toBeNull()
    expect(snap.oficial?.startUs).toBe(80_000_000)
    expect(snap.oficial?.undoCount).toBe(1)
    expect(snap.dirty).toBe(true)
  })

  it('reverte atualização otimista quando editor.silences.toggle falha', async () => {
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'editor.open') return criarDocEditor()
      if (cmd === 'editor.sentences') return []
      if (cmd === 'export.captions') return criarLegendasBase('original')
      if (cmd === 'audio.list') return []
      if (cmd === 'translation.get') return { clipId: 11, sourceId: 4, activeTrack: 'original', hasTranslation: false, sentences: [] }
      if (cmd === 'captions.remap_status') return { discarded: 0 }
      if (cmd === 'proxy.request') return { state: 'running', key: 'abc', job: 7, progress: 40, error: null }
      if (cmd === 'editor.silences.toggle') {
        throw new ErroCore('invalid_silence_interval', 'Falha no intervalo')
      }
      return null
    })

    const store = criarStoreEditorCorte()
    store.definirProjeto('/projetos/Demo.clipes')
    await store.abrir({
      corteId: '102',
      sourceId: 4,
      startId: 10,
      endId: 14,
      candidateId: 102,
      fonteDisponivel: true,
    })

    await expect(store.alternarSilencio(1)).rejects.toMatchObject({ code: 'invalid_silence_interval' })
    const snap = store.obterSnapshot()
    expect(snap.oficial?.silences.intervals[0].status).toBe('active')
    expect(snap.dirty).toBe(false)
  })

  it('garantirSalvoParaSaida() chama editor.flush e retorna { ok: false, erro } quando rejeita; editor_saved limpa dirty e editor_save_failed preserva dirty', async () => {
    let falharFlush = true
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'editor.open') return criarDocEditor()
      if (cmd === 'editor.sentences') return []
      if (cmd === 'export.captions') return criarLegendasBase('original')
      if (cmd === 'audio.list') return []
      if (cmd === 'translation.get') return { clipId: 11, sourceId: 4, activeTrack: 'original', hasTranslation: false, sentences: [] }
      if (cmd === 'captions.remap_status') return { discarded: 0 }
      if (cmd === 'proxy.request') return { state: 'running', key: 'abc', job: 7, progress: 40, error: null }
      if (cmd === 'editor.adjust') return criarDocEditor({ startUs: 80_000_000, undoCount: 1 })
      if (cmd === 'editor.flush') {
        if (falharFlush) throw new ErroCore('project_write', 'Disco cheio')
        return null
      }
      return null
    })

    const store = criarStoreEditorCorte()
    store.definirProjeto('/projetos/Demo.clipes')
    await store.abrir({
      corteId: '102',
      sourceId: 4,
      startId: 10,
      endId: 14,
      candidateId: 102,
      fonteDisponivel: true,
    })
    await store.ajustarBorda({ edge: 'start', sentenceDelta: -1, preview: false })
    expect(store.obterSnapshot().dirty).toBe(true)

    const falhou = await store.garantirSalvoParaSaida()
    expect(falhou.ok).toBe(false)
    if (!falhou.ok) {
      expect(falhou.erro.code).toBe('project_write')
    }
    expect(store.obterSnapshot().dirty).toBe(true)

    // editor_save_failed preserva dirty
    store.sincronizarSalvamento({
      estado: 'erro',
      erro: new ErroCore('project_write', 'Erro no autosave'),
    })
    expect(store.obterSnapshot().dirty).toBe(true)
    expect(store.obterSnapshot().erroSalvamento?.code).toBe('project_write')

    // editor_saved para este clipId limpa dirty
    store.sincronizarSalvamento({ estado: 'salvo', clipId: 11 })
    expect(store.obterSnapshot().dirty).toBe(false)
    expect(store.obterSnapshot().erroSalvamento).toBeNull()

    falharFlush = false
    const ok = await store.garantirSalvoParaSaida()
    expect(ok).toEqual({ ok: true })
  })

  it('translation.start registra job_id -> clipId (#297), ai:translation:done recarrega translation.get e invalida export.captions se faixa Traduzida ativa', async () => {
    let captionsCalls = 0
    let translationGetCalls = 0
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'editor.open') return criarDocEditor({ clipId: 11 })
      if (cmd === 'editor.sentences') return []
      if (cmd === 'export.captions') {
        captionsCalls += 1
        return criarLegendasBase('translated')
      }
      if (cmd === 'audio.list') return []
      if (cmd === 'translation.get') {
        translationGetCalls += 1
        return { clipId: 11, sourceId: 4, activeTrack: 'translated', hasTranslation: translationGetCalls > 1, sentences: [] }
      }
      if (cmd === 'captions.remap_status') return { discarded: 0 }
      if (cmd === 'proxy.request') return { state: 'running', key: 'abc', job: 7, progress: 40, error: null }
      if (cmd === 'translation.start') {
        return { run: 3, jobs: [701], batches: 1, sourceLanguage: 'pt-BR', targetLanguage: 'en' }
      }
      return null
    })

    const store = criarStoreEditorCorte()
    store.definirProjeto('/projetos/Demo.clipes')
    await store.abrir({
      corteId: '102',
      sourceId: 4,
      startId: 10,
      endId: 14,
      candidateId: 102,
      fonteDisponivel: true,
    })

    await store.iniciarTraducao({ target_language: 'en', confirmed: true })
    expect(store.obterSnapshot().translationJobToClip[701]).toBe(11)

    const capAntes = captionsCalls
    const transAntes = translationGetCalls

    // Evento de outro job não mapeado para o clipId ativo não recarrega
    store.registrarEventoProgresso({
      job: '999',
      project: 'demo',
      stage: 'ai:translation:done',
      percentage: 100,
      message: 'Outro corte',
      error: null,
    })
    await Promise.resolve()
    expect(translationGetCalls).toBe(transAntes)

    // Evento do job 701 recarrega translation.get e export.captions
    const jobsTraducao: Job[] = [
      {
        id: '701',
        etapa: 'ai:translation:done',
        percentual: 100,
        mensagem: 'Concluída',
        estado: 'concluido',
        inicioMs: 0,
      },
    ]
    await store.sincronizarJobs(jobsTraducao)
    expect(translationGetCalls).toBe(transAntes + 1)
    expect(captionsCalls).toBe(capAntes + 1)
  })

  it('transcription.correct e translation.edit invalidam export.captions; editor.adjust além da janela carrega página faltante de editor.sentences', async () => {
    let captionsCalls = 0
    const sentenceCalls: Array<Record<string, unknown>> = []
    chamarMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'editor.open') {
        return criarDocEditor({
          startUs: 90_000_000,
          endUs: 140_000_000,
          windowStartUs: 50_000_000,
          windowEndUs: 200_000_000,
        })
      }
      if (cmd === 'editor.sentences') {
        sentenceCalls.push(args ?? {})
        if (Number(args?.start_us) < 50_000_000) {
          return [{ id: 3, startUs: 20_000_000, endUs: 30_000_000, text: 'Frase 3' }]
        }
        return [{ id: 10, startUs: 90_000_000, endUs: 100_000_000, text: 'Frase 10' }]
      }
      if (cmd === 'export.captions') {
        captionsCalls += 1
        return criarLegendasBase('translated')
      }
      if (cmd === 'audio.list') return []
      if (cmd === 'translation.get') return { clipId: 11, sourceId: 4, activeTrack: 'translated', hasTranslation: true, sentences: [] }
      if (cmd === 'captions.remap_status') return { discarded: 0 }
      if (cmd === 'proxy.request') return { state: 'running', key: 'abc', job: 7, progress: 40, error: null }
      if (cmd === 'transcription.correct') return { changed: true, source_id: 4, position: 100, text: ' Nova' }
      if (cmd === 'translation.edit') return { clipId: 11, sourceId: 4, activeTrack: 'translated', hasTranslation: true, sentences: [{ id: 10, translatedText: 'Editada', edited: true }] }
      if (cmd === 'editor.adjust') {
        return criarDocEditor({
          startUs: 20_000_000,
          endUs: 140_000_000,
          windowStartUs: 0,
          windowEndUs: 200_000_000,
          undoCount: 1,
        })
      }
      return null
    })

    const store = criarStoreEditorCorte()
    store.definirProjeto('/projetos/Demo.clipes')
    await store.abrir({
      corteId: '102',
      sourceId: 4,
      startId: 10,
      endId: 14,
      candidateId: 102,
      fonteDisponivel: true,
    })

    const capInicial = captionsCalls
    await store.corrigirPalavraTranscricao(4, 100, 'Nova')
    expect(captionsCalls).toBe(capInicial + 1)

    await store.editarTraducao(10, 'Editada')
    expect(captionsCalls).toBe(capInicial + 2)

    const sentInicial = sentenceCalls.length
    await store.ajustarBorda({ edge: 'start', timeUs: 20_000_000, preview: false })
    expect(sentenceCalls.length).toBe(sentInicial + 1)
    expect(store.obterSnapshot().frases.some((f) => f.id === 3)).toBe(true)

    // Limpeza integral quando Projeto troca/fecha
    store.definirProjeto(null)
    const limpo = store.obterSnapshot()
    expect(limpo.oficial).toBeNull()
    expect(limpo.frases).toEqual([])
    expect(limpo.dirty).toBe(false)
    expect(limpo.translationJobToClip).toEqual({})
  })

  it('UI-61: salvarAgora / executarFlush limpa erro global de salvamento na Fila quando conclui sem erro (mesmo sem dirty)', async () => {
    const { criarFila, estadoSalvamentoEditor } = await import('~/core/progresso')
    const fila = criarFila(() => '/projetos/Demo.clipes')

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'editor.open') return criarDocEditor()
      if (cmd === 'editor.sentences') return []
      if (cmd === 'export.captions') return criarLegendasBase()
      if (cmd === 'audio.list') return []
      if (cmd === 'translation.get') return { clipId: 11, sourceId: 4, activeTrack: 'original', hasTranslation: false, sentences: [] }
      if (cmd === 'captions.remap_status') return { discarded: 0 }
      if (cmd === 'proxy.request') return { state: 'ready', key: 'p1', job: null, progress: 100, error: null }
      if (cmd === 'editor.flush') return null
      return null
    })

    const store = criarStoreEditorCorte({ fila })
    store.definirProjeto('/projetos/Demo.clipes')
    await store.abrir({
      corteId: '102',
      sourceId: 4,
      startId: 10,
      endId: 14,
      candidateId: 102,
      fonteDisponivel: true,
    })

    fila.aplicar({
      job: 'editor',
      project: null,
      stage: 'editor_save_failed',
      percentage: 0,
      message: 'Falha ao salvar',
      error: { code: 'project_write', message: 'disco cheio' },
    })
    expect(estadoSalvamentoEditor(fila).estado).toBe('erro')

    const res = await store.salvarAgora()
    expect(res.ok).toBe(true)
    expect(estadoSalvamentoEditor(fila).estado).not.toBe('erro')
  })
})
