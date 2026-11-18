import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErroCore } from '~/core/cliente'
import { criarFila } from '~/core/progresso'
import { criarStoreFontesProjeto, useFontesProjeto } from '~/stores/fontesProjeto'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async (importOriginal) => {
  const atual = await importOriginal<typeof import('~/core/cliente')>()
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

describe('store fontesProjeto (fontesProjeto.ts)', () => {
  beforeEach(() => {
    chamarMock.mockReset()
  })

  it('carrega sources.list, preenche transcriptStatusBySource (#302) e carrega batches.list', async () => {
    chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'sources.list') {
        expect(args.project).toBe('/projetos/Demo.clipes')
        return [
          {
            id: 1,
            path: '/videos/a.mp4',
            status: 'available',
            available: true,
            verified: true,
            audio_track: 1,
            origin_url: null,
            language: 'pt',
            permission: { status: 'none' },
          },
          {
            id: 2,
            path: '/videos/b.mp4',
            status: 'offline',
            available: false,
            verified: false,
            audio_track: 1,
            origin_url: null,
            language: 'en',
            permission: { status: 'granted', who: 'Criador', where: 'Email', scope: 'cortes' },
          },
        ]
      }
      if (cmd === 'transcription.status') {
        const sid = args.source_id as number
        return {
          language: sid === 1 ? 'pt' : 'en',
          transcript:
            sid === 2
              ? { id: 2, state: 'complete', resume_us: 1_000_000, duration_us: 1_000_000, model: 'whisper-turbo', engine: 'local', words: 120 }
              : null,
          job: sid === 1 ? { id: 42, state: 'running', progress: 30, code: null } : null,
        }
      }
      if (cmd === 'batches.list') {
        return [{ id: 10, key: 'sources-10', state: 'running', status: 'running', items: [] }]
      }
      return null
    })

    const store = criarStoreFontesProjeto()
    await store.definirProjeto('/projetos/Demo.clipes')

    const estado = store.estado()
    expect(estado.carregando).toBe(false)
    expect(estado.erro).toBeNull()
    expect(estado.fontes).toHaveLength(2)
    expect(estado.transcriptStatusBySource[1]?.job?.id).toBe(42)
    expect(estado.transcriptStatusBySource[2]?.transcript?.state).toBe('complete')
    expect(estado.lotes).toHaveLength(1)
    expect(estado.lotes[0].id).toBe(10)
  })

  it('invalida e recarrega transcription.status da Fonte quando core-progress conclui transcrição', async () => {
    let statusFonte1 = {
      language: 'pt',
      transcript: { id: 1, state: 'running', resume_us: 500_000, duration_us: 1_000_000, model: 'whisper-turbo', engine: 'local', words: 0 },
      job: { id: 77, state: 'running', progress: 50, code: null },
    }

    chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'sources.list') {
        return [
          {
            id: 1,
            path: '/videos/live.mp4',
            status: 'available',
            available: true,
            verified: true,
            audio_track: 1,
            origin_url: null,
            language: 'pt',
            permission: { status: 'none' },
          },
        ]
      }
      if (cmd === 'transcription.status') {
        expect(args.source_id).toBe(1)
        return statusFonte1
      }
      if (cmd === 'batches.list') return []
      return null
    })

    const store = criarStoreFontesProjeto()
    await store.definirProjeto('/projetos/Demo.clipes')
    expect(store.estado().transcriptStatusBySource[1]?.transcript?.state).toBe('running')

    statusFonte1 = {
      language: 'pt',
      transcript: { id: 1, state: 'complete', resume_us: 1_000_000, duration_us: 1_000_000, model: 'whisper-turbo', engine: 'local', words: 450 },
      job: { id: 77, state: 'completed', progress: 100, code: null },
    }

    await store.aplicarEventoProgresso({
      job: '77',
      project: 'demo',
      stage: 'complete',
      percentage: 100,
      message: 'Transcrição concluída',
      error: null,
    })

    expect(store.estado().transcriptStatusBySource[1]?.transcript?.state).toBe('complete')
    expect(store.estado().invalidacoes.transcricao).toBeGreaterThan(0)
  })

  it('atualiza flags de energia, chat, preview, lotes e copiaEmAndamento (#307) via core-progress', async () => {
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'sources.list') return []
      if (cmd === 'batches.list') return [{ id: 1, key: 'sources-1', state: 'running', status: 'running', items: [] }]
      return null
    })

    const store = criarStoreFontesProjeto()
    await store.definirProjeto('/projetos/Demo.clipes')

    await store.aplicarEventoProgresso({
      job: 'source-copy-original',
      project: null,
      stage: 'hash',
      percentage: 45,
      message: 'Verificando Fonte',
      error: null,
    })
    expect(store.estado().copiaEmAndamento).toBe(true)

    await store.aplicarEventoProgresso({
      job: 'source-copy-check',
      project: null,
      stage: 'hash',
      percentage: 100,
      message: 'Verificando Fonte',
      error: null,
    })
    expect(store.estado().copiaEmAndamento).toBe(false)

    await store.aplicarEventoProgresso({
      job: '201',
      project: 'demo',
      stage: 'energy',
      percentage: 50,
      message: 'Medindo energia',
      error: null,
    })
    await store.aplicarEventoProgresso({
      job: '202',
      project: 'demo',
      stage: 'chat',
      percentage: 50,
      message: 'Agregando chat',
      error: null,
    })
    await store.aplicarEventoProgresso({
      job: '203',
      project: 'demo',
      stage: 'waveform',
      percentage: 40,
      message: 'Gerando onda',
      error: null,
    })
    await store.aplicarEventoProgresso({
      job: 'batch-1',
      project: 'demo',
      stage: 'batch:item',
      percentage: 0,
      message: 'Item atualizado',
      error: null,
    })

    const { invalidacoes } = store.estado()
    expect(invalidacoes.energia).toBeGreaterThan(0)
    expect(invalidacoes.chat).toBeGreaterThan(0)
    expect(invalidacoes.preview).toBeGreaterThan(0)
    expect(invalidacoes.lotes).toBeGreaterThan(0)
  })

  it('limpa cache integralmente ao fechar ou trocar Projeto e preserva seleção de lote no mesmo Projeto', async () => {
    chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'sources.list') {
        return [
          { id: 1, path: '/v/1.mp4', status: 'available', available: true, verified: true, audio_track: 1, origin_url: null, language: 'pt', permission: { status: 'none' } },
          { id: 3, path: '/v/3.mp4', status: 'available', available: true, verified: true, audio_track: 1, origin_url: null, language: 'pt', permission: { status: 'none' } },
        ]
      }
      if (cmd === 'transcription.status') {
        return { language: 'pt', transcript: null, job: null }
      }
      if (cmd === 'batches.list') return []
      return args
    })

    const store = criarStoreFontesProjeto()
    const fila = criarFila(() => 'demo')

    const { result, rerender } = renderHook(
      ({ caminho }: { caminho: string | null }) => useFontesProjeto(caminho, { store, fila }),
      { initialProps: { caminho: '/projetos/Demo.clipes' as string | null } },
    )

    await waitFor(() => expect(result.current.fontes).toHaveLength(2))

    act(() => {
      result.current.definirSelecionadasParaLote([1, 3])
    })
    expect(result.current.selecionadasParaLote).toEqual([1, 3])

    // Re-renderizando no mesmo Projeto (ex.: navegação para ?sub=lotes) preserva seleção
    rerender({ caminho: '/projetos/Demo.clipes' })
    expect(result.current.selecionadasParaLote).toEqual([1, 3])

    // Fechar Projeto (null) limpa integralmente
    rerender({ caminho: null })
    expect(result.current.fontes).toEqual([])
    expect(result.current.transcriptStatusBySource).toEqual({})
    expect(result.current.lotes).toEqual([])
    expect(result.current.selecionadasParaLote).toEqual([])
    expect(result.current.copiaEmAndamento).toBe(false)
  })

  it('expõe erro normalizado quando sources.list falha e permite recarregarFonte individual', async () => {
    let falhar = true
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'sources.list') {
        if (falhar) throw new ErroCore('project_busy', 'Ocupado')
        return [
          { id: 5, path: '/v/5.mp4', status: 'available', available: true, verified: true, audio_track: 1, origin_url: null, language: 'pt', permission: { status: 'none' } },
        ]
      }
      if (cmd === 'transcription.status') {
        return { language: 'pt', transcript: null, job: null }
      }
      if (cmd === 'batches.list') return []
      return null
    })

    const store = criarStoreFontesProjeto()
    await store.definirProjeto('/projetos/Demo.clipes')
    expect(store.estado().erro?.code).toBe('project_busy')

    falhar = false
    await store.recarregarFonte(5)
    expect(store.estado().erro).toBeNull()
    expect(store.estado().fontes).toHaveLength(1)
    expect(store.estado().transcriptStatusBySource[5]).toBeDefined()
  })
})
