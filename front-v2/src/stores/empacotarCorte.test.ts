import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarFila } from '~/core/progresso'
import {
  calcularBytesDescricao,
  useEmpacotarCorte,
  validarCapitulosTempoReal,
} from '~/stores/empacotarCorte'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

function setupMockEmpacotar(opts?: { title?: string }) {
  const title = opts?.title ?? 'Título inicial'
  chamarMock.mockImplementation(async (comando: string) => {
    switch (comando) {
      case 'thumbnail.get':
        return { current: { instantUs: 15_000_000, origin: 'user' }, history: [], job: null }
      case 'packaging.get':
        return {
          schemaVersion: 1,
          revision: 1,
          detectedLanguage: 'pt-BR',
          languageRequired: false,
          current: {
            generation: 1,
            language: 'pt-BR',
            edited: false,
            title,
            description: 'Resumo inicial.',
            tags: ['corte'],
            hashtags: ['#corte'],
            fullDescription: 'Resumo inicial.\n\nFonte: Criador',
          },
          credit: { text: 'Fonte: Criador', warning: null },
          chapters: { applicable: true, status: 'ready', canGenerate: true, count: 3, block: null, hasDelimiters: false, generationWarning: null, validationErrors: [] },
          job: null,
          limits: { titleChars: 100, descriptionBytes: 5000, creditBytes: 15, maxTags: 30, tagChars: 30, tagTotalChars: 500, maxHashtags: 15, hashtagChars: 100 },
          source: { id: 4, author: 'Criador', title: 'Live' },
          generations: [],
        }
      case 'guardrails.check':
        return { blockers: [], warnings: [], permissionOk: true }
      case 'proxy.request':
        return { job: 120, state: 'ready', progress: 100, proxyPath: '/cache/proxy.mp4' }
      case 'provider.profiles.list':
        return { profiles: [] }
      case 'assistant.tasks':
        return { projectLocalOnly: false, tasks: [] }
      case 'jobs.budget.get':
        return { limitMicroUsd: null, spentMicroUsd: 0, remainingMicroUsd: null, paused: false }
      default:
        return {}
    }
  })
}

describe('store empacotarCorte', () => {
  afterEach(() => {
    chamarMock.mockReset()
  })

  it('calcula bytes UTF-8 incluindo creditBytes e valida capítulos em tempo real', () => {
    expect(calcularBytesDescricao('é 😀', 15)).toBe(7 + 15)

    // Faltando 00:00 e menos de 3 capítulos
    const erradoInicio = validarCapitulosTempoReal(
      '00:05 Intro\n00:20 Meio',
      90_000_000,
    )
    expect(erradoInicio.map((e) => e.codigo)).toEqual(
      expect.arrayContaining(['chapter_first_not_zero', 'too_few_chapters']),
    )

    // Duração < 10 s, ordem invertida e além do fim do Corte
    const erradoOrdem = validarCapitulosTempoReal(
      '00:00 Início\n00:05 Curto\n00:30 Meio\n00:20 Invertido\n01:50 Passou',
      90_000_000,
    )
    expect(erradoOrdem.map((e) => e.codigo)).toEqual(
      expect.arrayContaining(['chapter_too_short', 'chapter_out_of_order', 'chapter_past_end']),
    )

    // Válido
    const valido = validarCapitulosTempoReal(
      '00:00 Abertura\n00:15 Virada\n00:35 Fechamento',
      90_000_000,
    )
    expect(valido).toEqual([])
  })

  it('carrega dados iniciais e omite proxy.request quando Fonte está offline', async () => {
    setupMockEmpacotar()
    const fila = criarFila(() => 'demo')
    const { result, rerender } = renderHook(
      ({ fonteOnline }: { fonteOnline: boolean }) =>
        useEmpacotarCorte(301, { id: 2, disponivel: fonteOnline }, fila),
      { initialProps: { fonteOnline: false } },
    )

    await waitFor(() => expect(result.current.carregando).toBe(false))
    expect(chamarMock.mock.calls.map((c) => c[0])).not.toContain('proxy.request')
    expect(result.current.rascunho?.title).toBe('Título inicial')
    expect(result.current.sujo).toBe(false)

    chamarMock.mockClear()
    rerender({ fonteOnline: true })
    await waitFor(() =>
      expect(chamarMock.mock.calls.map((c) => c[0])).toContain('proxy.request'),
    )
  })

  it('preserva rascunho não salvo em conflito quando ai:packaging:done chega com sujo=true', async () => {
    setupMockEmpacotar({ title: 'Título original' })
    const fila = criarFila(() => 'demo')
    const { result } = renderHook(() =>
      useEmpacotarCorte(201, { id: 4, disponivel: true }, fila),
    )
    await waitFor(() => expect(result.current.carregando).toBe(false))

    act(() => {
      result.current.editarRascunho({ title: 'Minha edição local' })
    })
    expect(result.current.sujo).toBe(true)
    expect(result.current.rascunho?.title).toBe('Minha edição local')

    setupMockEmpacotar({ title: 'Título gerado remotamente' })
    act(() => {
      fila.aplicar({
        job: '601',
        project: 'demo',
        stage: 'ai:packaging:done',
        percentage: 100,
        message: 'Empacotamento pronto',
        error: null,
      })
    })

    await waitFor(() => expect(result.current.conflitoRemoto).toBe(true))
    expect(result.current.rascunho?.title).toBe('Minha edição local')

    act(() => {
      result.current.aceitarRemoto()
    })
    expect(result.current.conflitoRemoto).toBe(false)
    expect(result.current.sujo).toBe(false)
    expect(result.current.rascunho?.title).toBe('Título gerado remotamente')
  })
})
