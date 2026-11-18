import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarFila, type EventoProgresso } from '~/core/progresso'
import { resolverDestinoTransformar, useTransformarCorte } from '~/stores/transformarCorte'
import type { PerfilProvedorLista, RespostaTarefasAssistente } from '~/stores/selecaoProjeto'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

const PERFIS: PerfilProvedorLista[] = [
  {
    id: 'local-ollama',
    label: 'Ollama Local',
    kind: 'ollama',
    endpoint: 'http://127.0.0.1:11434/v1',
    model: 'qwen3:8b',
    local: true,
    cli: false,
  },
  {
    id: 'remoto-openai',
    label: 'OpenAI GPT-4o',
    kind: 'openai',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    local: false,
    cli: false,
  },
]

const TAREFAS: RespostaTarefasAssistente = {
  projectLocalOnly: true,
  tasks: [
    {
      task: 'script',
      choice: 'profile:local-ollama',
      source: 'task',
      localOnly: true,
      blocked: false,
      missing: null,
      profile: { id: 'local-ollama', label: 'Ollama Local', kind: 'ollama', local: true, cli: false },
    },
  ],
}

function configurarRespostasPadrao() {
  chamarMock.mockImplementation(async (comando: string) => {
    switch (comando) {
      case 'angles.get':
        return { schemaVersion: 1, revision: 0, detectedLanguage: 'pt-BR', languageRequired: false, selected: null, angles: [], generations: [], job: null }
      case 'script.get':
        return { schemaVersion: 1, revision: 0, detectedLanguage: 'pt-BR', languageRequired: false, angle: null, current: null, narrationAllowed: false, busy: false, job: null, generations: [], limits: { titleChars: 80, narrationChars: 600, scriptChars: 3000, refs: 6 } }
      case 'narration.get':
        return { candidate: 201, narrationAllowed: false, gateReason: 'no_script', language: 'pt', defaultVoiceId: '13063', activeModelId: 'portuguese_24l', busy: false, job: null, importBusy: false, importJob: null, alignBusy: false, alignJob: null, alignPrerequisitesReady: true, vadReady: true, blocks: [], totalDurationUs: 0 }
      case 'tts.catalog':
        return { componentInstalled: false, activeModels: { pt: 'portuguese_24l', en: 'english' }, engines: [], models: [], voices: [] }
      case 'components.pocket_tts.status':
        return { installed: false, version: null, pinned: '3.3.0', outdated: false }
      case 'provider.profiles.list':
        return { profiles: PERFIS }
      case 'assistant.tasks':
        return TAREFAS
      case 'jobs.budget.get':
        return { limitMicroUsd: null, spentMicroUsd: 0, remainingMicroUsd: null, paused: false }
      case 'projects.local_only.get':
        return { enabled: true }
      default:
        return {}
    }
  })
}

describe('store transformarCorte', () => {
  afterEach(() => {
    chamarMock.mockReset()
  })

  it('carrega os 9 comandos em paralelo e limpa cache ao trocar candidateId ou desmontar', async () => {
    configurarRespostasPadrao()
    const fila = criarFila(() => 'demo')

    const { result, rerender } = renderHook(
      ({ candidateId }: { candidateId: number | null }) => useTransformarCorte(candidateId, fila),
      { initialProps: { candidateId: 201 as number | null } },
    )

    await waitFor(() => expect(result.current.carregando).toBe(false))
    const comandos = chamarMock.mock.calls.map((c) => c[0])
    expect(comandos).toEqual(
      expect.arrayContaining([
        'angles.get',
        'script.get',
        'narration.get',
        'tts.catalog',
        'components.pocket_tts.status',
        'provider.profiles.list',
        'assistant.tasks',
        'jobs.budget.get',
        'projects.local_only.get',
      ]),
    )
    expect(result.current.angulos).not.toBeNull()
    expect(result.current.somenteLocal).toBe(true)

    rerender({ candidateId: null })
    expect(result.current.angulos).toBeNull()
    expect(result.current.roteiro).toBeNull()
    expect(result.current.narracao).toBeNull()
  })

  it('reage a core-progress por domínio e ignora residual job === "0" (#293)', async () => {
    configurarRespostasPadrao()
    const fila = criarFila(() => 'demo')

    const { result } = renderHook(() => useTransformarCorte(201, fila))
    await waitFor(() => expect(result.current.carregando).toBe(false))
    chamarMock.mockClear()

    // Evento residual #293 deve ser ignorado completamente
    act(() => {
      const ev: EventoProgresso = {
        job: '0',
        project: 'demo',
        stage: 'narration_record',
        percentage: 50,
        message: 'Residual',
        error: null,
      }
      fila.aplicar(ev)
    })
    expect(chamarMock).not.toHaveBeenCalled()

    // Eventos reais disparam reload apenas dos domínios afetados
    act(() => {
      fila.aplicar({
        job: '501',
        project: 'demo',
        stage: 'ai:angles:done',
        percentage: 100,
        message: 'Ângulos prontos',
        error: null,
      })
    })
    await waitFor(() => expect(chamarMock).toHaveBeenCalledWith('angles.get', { candidate: 201 }))

    chamarMock.mockClear()
    act(() => {
      fila.aplicar({
        job: '502',
        project: 'demo',
        stage: 'ai:script_block:done',
        percentage: 100,
        message: 'Bloco pronto',
        error: null,
      })
    })
    await waitFor(() => expect(chamarMock).toHaveBeenCalledWith('script.get', { candidate: 201 }))

    chamarMock.mockClear()
    act(() => {
      fila.aplicar({
        job: 'narration_record',
        project: 'demo',
        stage: 'done',
        percentage: 100,
        message: 'Gravação concluída',
        error: null,
      })
    })
    await waitFor(() => expect(chamarMock).toHaveBeenCalledWith('narration.get', { candidate: 201 }))
  })

  it('resolve destino/privacidade para script e profileId específico bloqueado em Somente local', () => {
    const destLocal = resolverDestinoTransformar('local-ollama', PERFIS, TAREFAS)
    expect(destLocal.localidade).toBe('local')
    expect(destLocal.saiDaMaquina).toBe(false)
    expect(destLocal.bloqueadoSomenteLocal).toBe(false)

    const destRemoto = resolverDestinoTransformar('remoto-openai', PERFIS, TAREFAS)
    expect(destRemoto.localidade).toBe('remoto')
    expect(destRemoto.saiDaMaquina).toBe(true)
    expect(destRemoto.bloqueadoSomenteLocal).toBe(true)
  })
})
