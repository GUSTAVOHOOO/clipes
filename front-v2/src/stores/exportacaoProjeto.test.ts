import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErroCore } from '~/core/cliente'
import { criarFila } from '~/core/progresso'
import {
  TAMANHO_PAGINA,
  criarStoreExportacaoProjeto,
  useExportacaoProjeto,
  type CorteAprovadoProntidao,
  type RespostaReadinessExportacao,
} from '~/stores/exportacaoProjeto'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

function criarItemReadiness(idx: number, sourceId = 4): CorteAprovadoProntidao {
  const candidateId = 100 + idx + 1
  return {
    candidateId,
    runId: 1,
    sourceId,
    clipId: null,
    videoKind: 'direct',
    candidateTitle: `Corte ${idx + 1}`,
    scoreTotal: 8.5,
    adjusted: false,
    startId: (idx + 1) * 10,
    endId: (idx + 1) * 10 + 3,
    startUs: idx * 30_000_000,
    endUs: idx * 30_000_000 + 25_000_000,
    durationUs: 25_000_000,
    source: {
      id: sourceId,
      name: sourceId === 4 ? 'Live.mp4' : 'SegundaLive.mp4',
      path: sourceId === 4 ? '/videos/Live.mp4' : '/videos/SegundaLive.mp4',
      status: 'available',
      available: true,
      online: true,
      permission: { status: 'granted', who: 'Criador', where: 'Discord', scope: 'cortes' },
    },
    packaging: {
      current: { title: `Empacotado ${candidateId}`, description: 'Desc' },
      credit: { text: 'Crédito', warning: null },
      chapters: { applicable: false, status: 'not_transformed', canGenerate: false },
    },
    thumbnail: {
      current: { id: 1, instantUs: 10_000_000, origin: 'user' },
    },
    script: { applicable: false },
    narration: { applicable: false },
    guardrails: {
      scope: 'single',
      needsDirectNotice: false,
      videoKind: 'direct',
      durationUs: 25_000_000,
      over60s: false,
      permission: { status: 'granted', grantedCount: 1, missingCount: 0, totalCount: 1 },
      script: { applicable: false },
      narration: { applicable: false },
      audio: { hasAudio: false, assetCount: 0, unverifiedCount: 0 },
    },
  }
}

function criarItensReadiness(total: number, sourceId = 4): CorteAprovadoProntidao[] {
  return Array.from({ length: total }, (_, idx) => criarItemReadiness(idx, sourceId))
}

function instalarMocksBase(
  todosItens: CorteAprovadoProntidao[],
  opcoes?: {
    onReadiness?: (
      args: Record<string, unknown>,
    ) => void | RespostaReadinessExportacao | Promise<RespostaReadinessExportacao | void>
    onGuardrails?: (args: Record<string, unknown>) => unknown
  },
) {
  chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
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
        {
          id: 7,
          path: '/videos/SegundaLive.mp4',
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
    if (cmd === 'export.settings') return { last_directory: '/exports' }
    if (cmd === 'export.encoder.status') {
      return {
        ffmpeg: true,
        detected: true,
        stale: false,
        passed: ['h264_nvenc', 'libx264'],
        selected: 'h264_nvenc',
        manual: null,
        effective: 'h264_nvenc',
        gpu: 'RTX',
        detected_at: 100,
      }
    }
    if (cmd === 'export.batch.list') return []
    if (cmd === 'guardrails.check') {
      if (opcoes?.onGuardrails) return opcoes.onGuardrails(args)
      return {
        scope: args.scope ?? 'project',
        directMonetizationAck: false,
        needsDirectNotice: true,
        videoKind: 'direct',
        hasDirect: true,
        hasTransformed: false,
        totalCuts: todosItens.length,
        over60sCount: 0,
        permission: {
          status: 'granted',
          grantedCount: todosItens.length,
          missingCount: 0,
          totalCount: todosItens.length,
        },
        script: { applicable: false },
        narration: { applicable: false },
        audio: { hasAudio: false, cutsWithAudio: 0, cutsWithUnverifiedAudio: 0, unverifiedCount: 0 },
      }
    }
    if (cmd === 'export.readiness') {
      if (opcoes?.onReadiness) {
        const custom = await opcoes.onReadiness(args)
        if (custom) return custom
      }
      const sid = typeof args.source_id === 'number' ? args.source_id : null
      const offset = typeof args.offset === 'number' ? args.offset : 0
      const limit = typeof args.limit === 'number' ? args.limit : null
      const filtrados = sid === null ? todosItens : todosItens.filter((x) => x.sourceId === sid)
      const slice = limit === null ? filtrados.slice(offset) : filtrados.slice(offset, offset + limit)
      return {
        total: filtrados.length,
        offset,
        limit,
        hasMore: offset + slice.length < filtrados.length,
        items: slice,
      } satisfies RespostaReadinessExportacao
    }
    return null
  })
}

describe('store exportacaoProjeto (exportacaoProjeto.ts)', () => {
  beforeEach(() => {
    chamarMock.mockReset()
  })

  it('carrega a Mesa em 1 chamada export.readiness por página (offset/hasMore), sem N+1 por Corte', async () => {
    const todos = criarItensReadiness(30)
    const chamadasReadiness: Record<string, unknown>[] = []
    instalarMocksBase(todos, {
      onReadiness: (args) => {
        chamadasReadiness.push(args)
      },
    })

    const store = criarStoreExportacaoProjeto()
    await store.definirProjeto('/projetos/Demo.clipes')

    expect(TAMANHO_PAGINA).toBe(12)
    expect(chamadasReadiness).toEqual([{ offset: 0, limit: 12 }])
    expect(store.estado().aprovados).toHaveLength(12)
    expect(store.estado().totalAprovados).toBe(30)
    expect(store.estado().totalProjeto).toBe(30)
    expect(store.estado().temMais).toBe(true)

    // Garante que os comandos legados N+1 não são mais chamados
    const cmdsChamados = chamarMock.mock.calls.map(([cmd]) => cmd)
    expect(cmdsChamados).not.toContain('selection.list')
    expect(cmdsChamados).not.toContain('selection.get')
    expect(cmdsChamados).not.toContain('selection.review')
    expect(cmdsChamados).not.toContain('packaging.get')
    expect(cmdsChamados).not.toContain('thumbnail.get')
    expect(
      chamarMock.mock.calls.filter(
        ([cmd, args]) => cmd === 'guardrails.check' && (args as { scope?: string })?.scope === 'single',
      ),
    ).toHaveLength(0)

    // Página 2: 1 chamada export.readiness com offset: 12
    await store.carregarMais()
    expect(chamadasReadiness).toEqual([
      { offset: 0, limit: 12 },
      { offset: 12, limit: 12 },
    ])
    expect(store.estado().aprovados).toHaveLength(24)
    expect(store.estado().temMais).toBe(true)

    // Página 3 (final): 1 chamada export.readiness com offset: 24 e hasMore: false
    await store.carregarMais()
    expect(chamadasReadiness).toEqual([
      { offset: 0, limit: 12 },
      { offset: 12, limit: 12 },
      { offset: 24, limit: 12 },
    ])
    expect(store.estado().aprovados).toHaveLength(30)
    expect(store.estado().temMais).toBe(false)

    // Com hasMore === false, carregarMais não faz chamada extra
    await store.carregarMais()
    expect(chamadasReadiness).toHaveLength(3)
  })

  it('filtra por Fonte via source_id em export.readiness e preserva totalProjeto', async () => {
    const itensFonte4 = criarItensReadiness(14, 4)
    const itensFonte7 = criarItensReadiness(2, 7).map((it, idx) => ({
      ...it,
      candidateId: 700 + idx,
    }))
    const todos = [...itensFonte4, ...itensFonte7]
    const chamadasReadiness: Record<string, unknown>[] = []
    instalarMocksBase(todos, {
      onReadiness: (args) => {
        chamadasReadiness.push(args)
      },
    })

    const store = criarStoreExportacaoProjeto()
    await store.definirProjeto('/projetos/Demo.clipes')
    expect(store.estado().totalProjeto).toBe(16)

    await store.filtrarPorFonte(4)
    expect(chamadasReadiness.at(-1)).toEqual({ offset: 0, limit: 12, source_id: 4 })
    expect(store.estado().filtroFonteId).toBe(4)
    expect(store.estado().aprovados).toHaveLength(12)
    expect(store.estado().aprovados.every((c) => c.sourceId === 4)).toBe(true)
    expect(store.estado().totalAprovados).toBe(14)
    expect(store.estado().totalProjeto).toBe(16)
    expect(store.estado().temMais).toBe(true)

    await store.carregarMais()
    expect(chamadasReadiness.at(-1)).toEqual({ offset: 12, limit: 12, source_id: 4 })
    expect(store.estado().aprovados).toHaveLength(14)
    expect(store.estado().temMais).toBe(false)

    await store.filtrarPorFonte(null)
    expect(chamadasReadiness.at(-1)).toEqual({ offset: 0, limit: 12 })
    expect(store.estado().filtroFonteId).toBeNull()
    expect(store.estado().totalAprovados).toBe(16)
  })

  it('atualizarProntidao recarrega via export.readiness preservando filtro e itens carregados', async () => {
    const todos = criarItensReadiness(15)
    let versao = 1
    const chamadasReadiness: Record<string, unknown>[] = []
    instalarMocksBase(todos, {
      onReadiness: (args) => {
        chamadasReadiness.push(args)
        const offset = typeof args.offset === 'number' ? args.offset : 0
        const limit = typeof args.limit === 'number' ? args.limit : 12
        const slice = todos.slice(offset, offset + limit).map((it) => ({
          ...it,
          packaging: {
            ...it.packaging,
            current: { title: `v${versao} - ${it.candidateId}` },
          },
        }))
        return {
          total: todos.length,
          offset,
          limit,
          hasMore: offset + slice.length < todos.length,
          items: slice,
        }
      },
    })

    const store = criarStoreExportacaoProjeto()
    await store.definirProjeto('/projetos/Demo.clipes')
    expect(store.estado().aprovados[0].packaging.current?.title).toBe('v1 - 101')

    versao = 2
    await store.atualizarProntidao()
    expect(chamadasReadiness.at(-1)).toEqual({ offset: 0, limit: 12 })
    expect(store.estado().atualizandoProntidao).toBe(false)
    expect(store.estado().aprovados[0].packaging.current?.title).toBe('v2 - 101')
  })

  it('expõe ErroCore em erro / erroProntidao sem catch silencioso quando export.readiness ou guardrails falham', async () => {
    const todos = criarItensReadiness(3)
    let falharReadiness = true
    let falharGuardrails = false

    instalarMocksBase(todos, {
      onReadiness: () => {
        if (falharReadiness) {
          throw new ErroCore('project_read', 'Banco indisponível.')
        }
      },
      onGuardrails: (args) => {
        if (falharGuardrails && args.scope === 'source') {
          throw new ErroCore('source_missing', 'Fonte não encontrada.')
        }
        return { scope: args.scope ?? 'project', totalCuts: 3 }
      },
    })

    const store = criarStoreExportacaoProjeto()
    await store.definirProjeto('/projetos/Demo.clipes')

    expect(store.estado().carregando).toBe(false)
    expect(store.estado().erro).toBeInstanceOf(ErroCore)
    expect(store.estado().erro?.code).toBe('project_read')

    // Recupera ao recarregar com sucesso
    falharReadiness = false
    await store.recarregar()
    expect(store.estado().erro).toBeNull()
    expect(store.estado().aprovados).toHaveLength(3)

    // Erro em atualizarProntidao popula erroProntidao e permite tentarNovamenteProntidao
    falharReadiness = true
    await store.atualizarProntidao()
    expect(store.estado().atualizandoProntidao).toBe(false)
    expect(store.estado().erroProntidao?.code).toBe('project_read')

    falharReadiness = false
    await store.tentarNovamenteProntidao()
    expect(store.estado().erroProntidao).toBeNull()

    // Erro em carregarGuardrailsEscopo não é engolido silenciosamente
    falharGuardrails = true
    const res = await store.carregarGuardrailsEscopo(4)
    expect(res).toBeNull()
    expect(store.estado().erroProntidao?.code).toBe('source_missing')
  })

  it('reage a export_batch em useFila() e zera cache quando projetoPath muda ou vira null', async () => {
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'sources.list') return []
      if (cmd === 'export.readiness') return { total: 0, offset: 0, limit: 12, hasMore: false, items: [] }
      if (cmd === 'export.settings') return { last_directory: '/exports' }
      if (cmd === 'export.encoder.status') {
        return {
          ffmpeg: true,
          detected: false,
          stale: false,
          passed: [],
          selected: 'libx264',
          manual: null,
          effective: 'libx264',
          gpu: '',
          detected_at: null,
        }
      }
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
            items: [
              {
                position: 0,
                sourceId: 4,
                candidateId: 101,
                clipId: null,
                jobId: 5901,
                title: 'Corte',
                filename: 'c.mp4',
                durationUs: 20_000_000,
                state: 'running',
                progress: 10,
                error: null,
                encoder: null,
                encoderFallback: null,
              },
            ],
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
    expect(result.current.totalAprovados).toBe(0)
    expect(result.current.totalProjeto).toBe(0)
  })

  it('salvarPastaPadrao chama export.settings.set, atualiza settings e preserva valor anterior em erro (#484)', async () => {
    const itens = criarItensReadiness(1)
    instalarMocksBase(itens)
    const implBase = chamarMock.getMockImplementation()!
    chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd === 'export.settings.set') {
        if (args.last_directory === 'relativa') {
          throw { code: 'export_destination', message: 'Escolha uma pasta existente.' }
        }
        return { last_directory: args.last_directory }
      }
      return implBase(cmd, args)
    })

    const store = criarStoreExportacaoProjeto()
    await store.definirProjeto('/projetos/Demo.clipes')
    expect(store.estado().settings).toEqual({ last_directory: '/exports' })

    const salvo = await store.salvarPastaPadrao('/novos/cortes')
    expect(salvo).toEqual({ last_directory: '/novos/cortes' })
    expect(chamarMock).toHaveBeenCalledWith('export.settings.set', {
      last_directory: '/novos/cortes',
    })
    expect(store.estado().settings).toEqual({ last_directory: '/novos/cortes' })

    await expect(store.salvarPastaPadrao('relativa')).rejects.toMatchObject({
      code: 'export_destination',
    })
    expect(store.estado().settings).toEqual({ last_directory: '/novos/cortes' })
  })
})
