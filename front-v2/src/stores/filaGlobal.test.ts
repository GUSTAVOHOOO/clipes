import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listen } from '@tauri-apps/api/event'
import { notificarSistema } from '~/core/desktop'
import { criarFila } from '~/core/progresso'
import { operacoesCriticasEmVoo } from '~/shell/FechamentoJanela'
import { criarStoreFilaGlobal, useFilaGlobal } from '~/stores/filaGlobal'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

vi.mock('~/core/desktop', () => ({
  notificarSistema: vi.fn(async () => true),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

const mockNotificarSistema = vi.mocked(notificarSistema)
const mockListen = vi.mocked(listen)

describe('store filaGlobal (filaGlobal.ts)', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    mockNotificarSistema.mockClear()
    mockListen.mockClear()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  })

  it('carrega as 3 trilhas de Projeto + orçamentos + operações globais e limpa trilhas de Projeto quando projetoPath vira null', async () => {
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'jobs.list') {
        return [
          { id: 2, kind: 'ai:selection', safety: 'paid', state: 'uncertain', attempts: 1, checkpoint: null, progress: 0, project: 'demo', outcome: 'uncertain', cost: 'unknown', batch: null, profile: 'legacy', budgetPause: null },
          { id: 10, kind: 'transcription', safety: 'local', state: 'running', attempts: 1, checkpoint: null, progress: 40, project: 'demo', outcome: null, cost: null, batch: null, profile: null, budgetPause: null },
        ]
      }
      if (cmd === 'batches.list') {
        return [{ id: 1, key: 'sources-1', state: 'running', status: 'running', engine: 'local', videoKind: 'direct', minUs: null, maxUs: null, pause: null, budget: null, counts: { total: 1, completed: 0, paused: 0, active: 1, pending: 0, cancelled: 0 }, items: [] }]
      }
      if (cmd === 'export.batch.list') {
        return [{ id: 6401, scope: 'project', sourceId: null, outputDir: '/exports', state: 'running', status: 'running', progress: 50, counts: { total: 2, queued: 1, running: 1, completed: 0, failed: 0, cancelled: 0 }, items: [] }]
      }
      if (cmd === 'jobs.budget.get') {
        return {
          budgets: [
            { scope: 'task', key: 'selection', maxCalls: 10, maxTokens: null, maxWallMs: null, maxCostMicroUsd: 1_000_000, unknownConfirmed: false, since: 1, usage: { calls: 10, inputTokens: 0, outputTokens: 0, microUsd: 0, audioMicroUsd: 0, unknownCostCalls: 0, planQuotaCalls: 0, durationMs: 0, costLabel: null }, paused: 'budget_calls' },
          ],
        }
      }
      return null
    })

    const fila = criarFila(() => 'demo')
    fila.aplicar({ job: 'ffmpeg', project: null, stage: 'download', percentage: 35, message: 'Baixando FFmpeg', error: null })
    // app.version não deve permanecer na lista de operações globais
    fila.aplicar({ job: 'app.version', project: null, stage: 'complete', percentage: 100, message: 'Version loaded', error: null })

    const store = criarStoreFilaGlobal({ fila, debounceMs: 0 })
    const { result, rerender } = renderHook(
      ({ caminho }: { caminho: string | null }) => useFilaGlobal(caminho, { store, fila }),
      { initialProps: { caminho: '/projetos/Demo.clipes' as string | null } },
    )

    await waitFor(() => expect(result.current.carregando).toBe(false))

    expect(result.current.jobs).toHaveLength(2)
    expect(result.current.lotesFontes).toHaveLength(1)
    expect(result.current.lotesExportacao).toHaveLength(1)
    expect(result.current.pausasOrcamento).toHaveLength(1)
    expect(result.current.contagemIncertos).toBe(1)
    expect(result.current.contagemAtivos).toBeGreaterThanOrEqual(2)
    expect(result.current.operacoesGlobais.map((o) => o.id)).toEqual(['ffmpeg'])

    // Ao fechar Projeto (null), oculta trilhas do Projeto e mantém operações globais
    rerender({ caminho: null })
    expect(result.current.jobs).toEqual([])
    expect(result.current.lotesFontes).toEqual([])
    expect(result.current.lotesExportacao).toEqual([])
    expect(result.current.orcamentos).toEqual([])
    expect(result.current.pausasOrcamento).toEqual([])
    expect(result.current.operacoesGlobais.map((o) => o.id)).toEqual(['ffmpeg'])
  })

  it('evento export_batch_complete dispara refresh de export.batch.list, invalida domínio e notifica SO apenas sem foco', async () => {
    let lotes: Array<Record<string, unknown>> = [
      { id: 6401, scope: 'project', sourceId: null, outputDir: '/exports', state: 'running', status: 'running', progress: 40, counts: { total: 1, queued: 0, running: 1, completed: 0, failed: 0, cancelled: 0 }, items: [] },
    ]
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'jobs.list') return []
      if (cmd === 'batches.list') return []
      if (cmd === 'export.batch.list') return lotes
      if (cmd === 'jobs.budget.get') return { budgets: [] }
      return null
    })

    const fila = criarFila(() => 'demo')
    const invalidacoes: string[] = []
    const store = criarStoreFilaGlobal({
      fila,
      debounceMs: 10,
      aoInvalidar: (dominio) => invalidacoes.push(dominio),
    })

    const { result } = renderHook(() => useFilaGlobal('/projetos/Demo.clipes', { store, fila }))
    await waitFor(() => expect(result.current.carregando).toBe(false))

    const chamadasAntes = chamarMock.mock.calls.filter((c) => c[0] === 'export.batch.list').length

    // Com janela focada e visível -> NÃO notifica SO
    lotes = [
      { id: 6401, scope: 'project', sourceId: null, outputDir: '/exports', state: 'completed', status: 'completed', progress: 100, counts: { total: 1, queued: 0, running: 0, completed: 1, failed: 0, cancelled: 0 }, items: [] },
    ]
    act(() => {
      fila.aplicar({
        job: 'export-batch-6401',
        project: 'demo',
        stage: 'export_batch_complete',
        percentage: 100,
        message: 'Lote concluído',
        error: null,
      })
    })

    await waitFor(() => {
      expect(chamarMock.mock.calls.filter((c) => c[0] === 'export.batch.list').length).toBeGreaterThan(chamadasAntes)
    })
    expect(invalidacoes).toContain('exportacao')
    expect(mockNotificarSistema).not.toHaveBeenCalled()

    // Com document.hidden === true -> notifica SO
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    act(() => {
      fila.aplicar({
        job: 'export-batch-6402',
        project: 'demo',
        stage: 'export_batch_complete',
        percentage: 100,
        message: 'Segundo lote concluído',
        error: null,
      })
    })

    await waitFor(() => {
      expect(mockNotificarSistema).toHaveBeenCalledTimes(1)
    })
  })

  it('reconcilia job running hidratado de jobs.list para FechamentoJanela (#291) sem duplicar listen("core-progress")', async () => {
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'jobs.list') {
        return [
          { id: 15, kind: 'export', safety: 'local', state: 'running', attempts: 1, checkpoint: null, progress: 55, project: 'demo', outcome: null, cost: null, batch: null, profile: null, budgetPause: null, startedAtMs: 1_700_000_000_000, targetLabel: 'Melhor jogada da live' },
        ]
      }
      if (cmd === 'batches.list') return []
      if (cmd === 'export.batch.list') return []
      if (cmd === 'jobs.budget.get') return { budgets: [] }
      return null
    })

    const fila = criarFila(() => 'demo')
    const store = criarStoreFilaGlobal({ fila, debounceMs: 0 })

    renderHook(() => useFilaGlobal('/projetos/Demo.clipes', { store, fila }))

    await waitFor(() => {
      const criticos = operacoesCriticasEmVoo(fila.jobs())
      expect(criticos.some((j) => j.id === '15' && j.etapa === 'export')).toBe(true)
    })

    const job15 = fila.jobs().find((j) => j.id === '15')
    expect(job15?.startedAtMs).toBe(1_700_000_000_000)
    expect(job15?.alvo).toBe('Melhor jogada da live')

    expect(mockListen).not.toHaveBeenCalled()
  })
})
