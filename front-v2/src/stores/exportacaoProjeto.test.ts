import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { criarFila } from '~/core/progresso'
import {
  TAMANHO_PAGINA,
  criarStoreExportacaoProjeto,
  useExportacaoProjeto,
} from '~/stores/exportacaoProjeto'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

function criarCandidatosMock(total: number) {
  const candidates = Array.from({ length: total }, (_, idx) => ({
    id: 100 + idx + 1,
    rank: idx,
    startId: (idx + 1) * 10,
    endId: (idx + 1) * 10 + 3,
    startUs: idx * 30_000_000,
    endUs: idx * 30_000_000 + 25_000_000,
    total: 8.5,
    title: `Corte ${idx + 1}`,
    windows: [0],
    profile: 'legacy',
    revision: 1,
    adjusted: false,
  }))
  const items = candidates.map((c) => ({
    candidate: c.id,
    status: 'approved' as const,
    adjusted: false,
    startId: c.startId,
    endId: c.endId,
    startUs: c.startUs,
    endUs: c.endUs,
    startText: 'Início',
    endText: 'Fim',
  }))
  return { candidates, items }
}

describe('store exportacaoProjeto (exportacaoProjeto.ts)', () => {
  beforeEach(() => {
    chamarMock.mockReset()
  })

  it('pagina packaging.get, thumbnail.get e guardrails.check em lotes de 12 (#298) e usa cache', async () => {
    const { candidates, items } = criarCandidatosMock(30)
    const packagingCalls: number[] = []
    const thumbnailCalls: number[] = []
    const guardrailsSingleCalls: number[] = []

    chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'sources.list') {
        return [
          {
            id: 4,
            path: '/videos/Live.mp4',
            status: 'available',
            available: true,
            verified: true,
            audio_track: 1,
            origin_url: null,
            language: 'pt',
            permission: { status: 'granted', who: 'Criador', where: 'Discord', scope: 'cortes' },
          },
        ]
      }
      if (cmd === 'export.settings') return { last_directory: '/exports' }
      if (cmd === 'export.encoder.status') {
        return { ffmpeg: true, detected: true, stale: false, passed: ['h264_nvenc', 'libx264'], selected: 'h264_nvenc', manual: null, effective: 'h264_nvenc', gpu: 'RTX', detected_at: 100 }
      }
      if (cmd === 'export.batch.list') return []
      if (cmd === 'guardrails.check') {
        if (args.scope === 'single') {
          guardrailsSingleCalls.push(args.candidate_id as number)
          return {
            scope: 'single',
            needsDirectNotice: false,
            videoKind: 'direct',
            durationUs: 25_000_000,
            over60s: false,
            permission: { status: 'granted', grantedCount: 1, missingCount: 0, totalCount: 1 },
            script: { applicable: false },
            narration: { applicable: false },
            audio: { hasAudio: false, assetCount: 0, unverifiedCount: 0 },
          }
        }
        return {
          scope: args.scope,
          directMonetizationAck: false,
          needsDirectNotice: true,
          videoKind: 'direct',
          hasDirect: true,
          hasTransformed: false,
          totalCuts: 30,
          over60sCount: 0,
          permission: { status: 'granted', grantedCount: 30, missingCount: 0, totalCount: 30 },
          script: { applicable: false },
          narration: { applicable: false },
          audio: { hasAudio: false, cutsWithAudio: 0, cutsWithUnverifiedAudio: 0, unverifiedCount: 0 },
        }
      }
      if (cmd === 'selection.list') {
        return [{ id: 1, state: 'completed', videoKind: 'direct', minUs: 20_000_000, maxUs: 60_000_000, planState: 'full', revision: 1, revisions: [1] }]
      }
      if (cmd === 'selection.get') {
        return { run: { id: 1, videoKind: 'direct' }, windows: [], candidates }
      }
      if (cmd === 'selection.review') {
        return { run: 1, items, canUndo: false }
      }
      if (cmd === 'packaging.get') {
        packagingCalls.push(args.candidate as number)
        return { current: { title: `Empacotado ${args.candidate}`, description: 'Desc' }, credit: { text: 'Crédito', warning: null }, chapters: { status: 'not_transformed' } }
      }
      if (cmd === 'thumbnail.get') {
        thumbnailCalls.push(args.candidate as number)
        return { current: { id: 1, instantUs: 10_000_000, origin: 'user' } }
      }
      return null
    })

    const store = criarStoreExportacaoProjeto()
    await store.definirProjeto('/projetos/Demo.clipes')

    expect(TAMANHO_PAGINA).toBe(12)
    expect(store.estado().aprovados).toHaveLength(30)
    // Só os 12 primeiros foram hidratados inicialmente (sem N+1 para 30!)
    expect(packagingCalls).toHaveLength(12)
    expect(thumbnailCalls).toHaveLength(12)
    expect(guardrailsSingleCalls).toHaveLength(12)

    await store.carregarMais()
    expect(packagingCalls).toHaveLength(24)
    expect(thumbnailCalls).toHaveLength(24)
    expect(guardrailsSingleCalls).toHaveLength(24)

    // Garantir que itens já cacheados não são buscados de novo ao garantir página 1
    await store.garantirDetalhesParaIds(candidates.slice(0, 12).map((c) => c.id))
    expect(packagingCalls).toHaveLength(24)
  })

  it('reage a export_batch em useFila() e zera cache quando projetoPath muda ou vira null', async () => {
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'sources.list') return []
      if (cmd === 'export.settings') return { last_directory: '/exports' }
      if (cmd === 'export.encoder.status') return { ffmpeg: true, detected: false, stale: false, passed: [], selected: 'libx264', manual: null, effective: 'libx264', gpu: '', detected_at: null }
      if (cmd === 'export.batch.list') {
        return [
          {
            id: 6405,
            scope: 'project',
            sourceId: null,
            outputDir: '/exports',
            state: 'running',
            status: 'running',
            progress: 10,
            counts: { total: 1, queued: 0, running: 1, completed: 0, failed: 0, cancelled: 0 },
            items: [{ position: 0, sourceId: 4, candidateId: 101, clipId: null, jobId: 5901, title: 'Corte', filename: 'c.mp4', durationUs: 20_000_000, state: 'running', progress: 10, error: null, encoder: null, encoderFallback: null }],
          },
        ]
      }
      if (cmd === 'guardrails.check') return { scope: 'project', totalCuts: 0 }
      return null
    })

    const fila = criarFila(() => 'demo')
    const store = criarStoreExportacaoProjeto()
    const { result, rerender } = renderHook(
      ({ caminho }: { caminho: string | null }) => useExportacaoProjeto(caminho, { store, fila }),
      { initialProps: { caminho: '/projetos/Demo.clipes' as string | null } },
    )

    await waitFor(() => expect(result.current.carregando).toBe(false))
    expect(result.current.lotes[0].progress).toBe(10)

    act(() => {
      fila.aplicar({
        job: 'export-batch-6405',
        project: 'demo',
        stage: 'export_batch',
        percentage: 75,
        message: 'Exportando',
        error: null,
      })
      fila.aplicar({
        job: '5901',
        project: 'demo',
        stage: 'export',
        percentage: 75,
        message: 'Exportando item',
        error: null,
      })
    })

    await waitFor(() => {
      expect(result.current.lotes[0].progress).toBe(75)
      expect(result.current.lotes[0].items[0].progress).toBe(75)
    })

    rerender({ caminho: null })
    expect(result.current.aprovados).toEqual([])
    expect(result.current.lotes).toEqual([])
    expect(result.current.detalhesPorCandidato).toEqual({})
  })
})
