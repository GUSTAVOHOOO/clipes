import { ProvedorDicas, ProvedorToast } from '@ds'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarFila } from '~/core/progresso'
import type { AngulosDoc, RoteiroDoc, useTransformarCorte } from '~/stores/transformarCorte'
import { PassoRoteiro } from '~/telas/corte/transformar/PassoRoteiro'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

type StoreTransformarHook = ReturnType<typeof useTransformarCorte>

function envolver(children: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>{children}</ProvedorToast>
    </ProvedorDicas>
  )
}

function criarStoreFake(overrides?: Partial<StoreTransformarHook>): StoreTransformarHook {
  const angulosBase: AngulosDoc = {
    schemaVersion: 1,
    revision: 1,
    detectedLanguage: 'pt-BR',
    languageRequired: false,
    selected: { name: 'Custo da escolha', promise: 'Mostra o preço da decisão.' },
    angles: [],
    generations: [],
    job: null,
  }
  const roteiroBase: RoteiroDoc = {
    schemaVersion: 1,
    revision: 1,
    detectedLanguage: 'pt-BR',
    languageRequired: false,
    angle: { name: 'Custo da escolha', promise: 'Mostra o preço da decisão.' },
    current: null,
    narrationAllowed: false,
    busy: false,
    job: null,
    generations: [],
    limits: { titleChars: 80, narrationChars: 800, scriptChars: 6000, refs: 50 },
  }
  return {
    candidateId: 201,
    carregando: false,
    erro: null,
    angulos: angulosBase,
    roteiro: roteiroBase,
    narracao: null,
    catalogoTts: null,
    pocketTts: null,
    perfis: [
      {
        id: 'local-qwen',
        label: 'Ollama Local',
        kind: 'ollama',
        endpoint: 'http://127.0.0.1:11434/v1',
        model: 'qwen3:8b',
        local: true,
        cli: false,
      },
      {
        id: 'openai-gpt4o',
        label: 'OpenAI GPT-4o',
        kind: 'openai',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        local: false,
        cli: false,
      },
    ],
    tarefas: null,
    orcamento: { limitMicroUsd: 1_000_000, spentMicroUsd: 100_000, remainingMicroUsd: 900_000, callsRemaining: 8, paused: false },
    somenteLocal: false,
    recarregar: vi.fn().mockResolvedValue(undefined),
    recarregarAngulos: vi.fn().mockResolvedValue(undefined),
    recarregarRoteiro: vi.fn().mockResolvedValue(undefined),
    recarregarNarracao: vi.fn().mockResolvedValue(undefined),
    recarregarTts: vi.fn().mockResolvedValue(undefined),
    resolverDestino: (profileId) =>
      profileId === 'local-qwen'
        ? {
            perfil: { id: 'local-qwen', label: 'Ollama Local', kind: 'local', model: 'qwen3:8b' },
            localidade: 'local',
            saiDaMaquina: false,
            host: '127.0.0.1',
            bloqueadoSomenteLocal: false,
          }
        : {
            perfil: { id: 'openai-gpt4o', label: 'OpenAI GPT-4o', kind: 'api', model: 'gpt-4o' },
            localidade: 'remoto',
            saiDaMaquina: true,
            host: 'api.openai.com',
            bloqueadoSomenteLocal: false,
          },
    ...overrides,
  }
}

describe('<PassoRoteiro>', () => {
  afterEach(() => {
    chamarMock.mockReset()
  })

  it('exibe banner ADR-0001 e gera Roteiro após <ResumoCustoPrivacidade> + <ConfirmDialog>', async () => {
    const store = criarStoreFake()
    const user = userEvent.setup()

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'script.estimate') {
        return {
          paid: true,
          profile: 'openai-gpt4o',
          language: 'pt-BR',
          estimate: { kind: 'usd', minMicroUsd: 20_000, maxMicroUsd: 50_000, inputTokens: 2000 },
        }
      }
      if (cmd === 'script.generate') {
        return { job: 401 }
      }
      return {}
    })

    render(
      envolver(
        <PassoRoteiro
          candidateId={201}
          store={store}
          fila={criarFila(() => 'demo')}
          aoAvancarNarracao={vi.fn()}
        />,
      ),
    )

    expect(screen.getByText('Revisão humana obrigatória antes da Narração')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sugerir Roteiro' }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('script.estimate', { candidate: 201, language: 'pt-BR' })
    })

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByLabelText(/Resumo de custo e privacidade/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })

    await user.click(within(dialog).getByRole('button', { name: /Confirmar e sugerir/i }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('script.generate', {
        candidate: 201,
        language: 'pt-BR',
        confirmed: true,
      })
    })
    expect(store.recarregarRoteiro).toHaveBeenCalled()
  })

  it('bloqueia "Aprovar bloco" enquanto sujo e salva edição com Ctrl+S retornando bloco para Pendente', async () => {
    const store = criarStoreFake({
      roteiro: {
        schemaVersion: 1,
        revision: 2,
        detectedLanguage: 'pt-BR',
        languageRequired: false,
        angle: { name: 'Custo da escolha', promise: 'Mostra o preço da decisão.' },
        current: {
          generation: 1,
          language: 'pt-BR',
          blocks: [
            {
              id: 11,
              position: 1,
              title: 'Abertura',
              intent: 'Contextualiza o gancho.',
              refs: [10],
              narration: 'Texto original aprovado.',
              status: 'aprovado',
              stale: false,
              version: 1,
              edited: false,
              job: null,
            },
          ],
          totalChars: 24,
          pending: 0,
          approved: 1,
          complete: true,
        },
        narrationAllowed: true,
        busy: false,
        job: null,
        generations: [],
        limits: { titleChars: 80, narrationChars: 800, scriptChars: 6000, refs: 50 },
      },
    })
    const user = userEvent.setup()

    chamarMock.mockResolvedValueOnce({
      ...store.roteiro,
      narrationAllowed: false,
      current: {
        ...store.roteiro!.current!,
        pending: 1,
        approved: 0,
        blocks: [
          {
            ...store.roteiro!.current!.blocks[0],
            narration: 'Texto editado pelo usuário.',
            status: 'pendente',
            edited: true,
            version: 2,
          },
        ],
      },
    })

    render(
      envolver(
        <PassoRoteiro
          candidateId={201}
          store={store}
          fila={criarFila(() => 'demo')}
          aoAvancarNarracao={vi.fn()}
        />,
      ),
    )

    const salvarBtn = screen.getByRole('button', { name: 'Salvar edição' })
    const aprovarBtn = screen.getByRole('button', { name: 'Aprovar bloco' })
    expect(salvarBtn).toBeDisabled()
    expect(aprovarBtn).toBeDisabled()

    const textarea = screen.getByLabelText(/Texto da Narração/i)
    await user.clear(textarea)
    await user.type(textarea, 'Texto editado pelo usuário.')

    expect(salvarBtn).toBeEnabled()
    expect(aprovarBtn).toBeDisabled()

    await user.keyboard('{Control>}s{/Control}')

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('script.edit', {
        candidate: 201,
        block: 11,
        title: 'Abertura',
        narration: 'Texto editado pelo usuário.',
        refs: [10],
      })
    })
    expect(store.recarregarRoteiro).toHaveBeenCalled()
  })

  it('aprovar último bloco pendente chama script.narration_allowed e habilita "Avançar para Narração →"', async () => {
    const aoAvancarNarracao = vi.fn()
    const store = criarStoreFake({
      roteiro: {
        schemaVersion: 1,
        revision: 3,
        detectedLanguage: 'pt-BR',
        languageRequired: false,
        angle: { name: 'Custo da escolha', promise: 'Mostra o preço da decisão.' },
        current: {
          generation: 1,
          language: 'pt-BR',
          blocks: [
            {
              id: 11,
              position: 1,
              title: 'Abertura',
              intent: 'Contextualiza.',
              refs: [10],
              narration: 'Texto pronto.',
              status: 'pendente',
              stale: false,
              version: 1,
              edited: false,
              job: null,
            },
          ],
          totalChars: 13,
          pending: 1,
          approved: 0,
          complete: true,
        },
        narrationAllowed: false,
        busy: false,
        job: null,
        generations: [],
        limits: { titleChars: 80, narrationChars: 800, scriptChars: 6000, refs: 50 },
      },
    })
    const user = userEvent.setup()

    const docLiberado: RoteiroDoc = {
      ...store.roteiro!,
      narrationAllowed: true,
      current: {
        ...store.roteiro!.current!,
        pending: 0,
        approved: 1,
        blocks: [{ ...store.roteiro!.current!.blocks[0], status: 'aprovado' }],
      },
    }

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'script.approve') return docLiberado
      if (cmd === 'script.narration_allowed') return { allowed: true }
      return {}
    })

    const { rerender } = render(
      envolver(
        <PassoRoteiro
          candidateId={201}
          store={store}
          fila={criarFila(() => 'demo')}
          aoAvancarNarracao={aoAvancarNarracao}
        />,
      ),
    )

    const avancarBtn = screen.getByRole('button', { name: /Avançar para Narração/i })
    expect(avancarBtn).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Aprovar bloco' }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('script.approve', { candidate: 201, block: 11 })
      expect(chamarMock).toHaveBeenCalledWith('script.narration_allowed', { candidate: 201 })
    })
    expect(store.recarregarRoteiro).toHaveBeenCalled()

    const storeLiberada = criarStoreFake({ roteiro: docLiberado })
    rerender(
      envolver(
        <PassoRoteiro
          candidateId={201}
          store={storeLiberada}
          fila={criarFila(() => 'demo')}
          aoAvancarNarracao={aoAvancarNarracao}
        />,
      ),
    )

    const avancarLiberado = screen.getByRole('button', { name: /Avançar para Narração/i })
    expect(avancarLiberado).toBeEnabled()
    expect(screen.getByText(/Todos os blocos aprovados — Narração liberada/i)).toBeInTheDocument()

    await user.click(avancarLiberado)
    expect(aoAvancarNarracao).toHaveBeenCalledTimes(1)
  })

  it('"Refazer com outro Perfil…" chama script.estimate { block, profileId } + <ConfirmDialog> -> script.regenerate', async () => {
    const store = criarStoreFake({
      roteiro: {
        schemaVersion: 1,
        revision: 3,
        detectedLanguage: 'pt-BR',
        languageRequired: false,
        angle: { name: 'Custo da escolha', promise: 'Mostra o preço da decisão.' },
        current: {
          generation: 1,
          language: 'pt-BR',
          blocks: [
            {
              id: 22,
              position: 1,
              title: 'Desenvolvimento',
              intent: 'Analisa a escolha.',
              refs: [11],
              narration: 'Fala do bloco.',
              status: 'pendente',
              stale: false,
              version: 1,
              edited: false,
              job: null,
            },
          ],
          totalChars: 14,
          pending: 1,
          approved: 0,
          complete: true,
        },
        narrationAllowed: false,
        busy: false,
        job: null,
        generations: [],
        limits: { titleChars: 80, narrationChars: 800, scriptChars: 6000, refs: 50 },
      },
    })
    const user = userEvent.setup()

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'script.estimate') {
        return {
          paid: true,
          profile: 'openai-gpt4o',
          language: 'pt-BR',
          estimate: { kind: 'usd', minMicroUsd: 5_000, maxMicroUsd: 12_000, inputTokens: 600 },
        }
      }
      if (cmd === 'script.regenerate') {
        return { job: 405, block: 22 }
      }
      return {}
    })

    render(
      envolver(
        <PassoRoteiro
          candidateId={201}
          store={store}
          fila={criarFila(() => 'demo')}
          aoAvancarNarracao={vi.fn()}
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Regenerar bloco' }))
    await user.click(await screen.findByRole('menuitem', { name: /Refazer com outro Perfil/i }))

    const pickerDialog = await screen.findByRole('dialog')
    await user.click(within(pickerDialog).getByRole('button', { name: /OpenAI GPT-4o/i }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('script.estimate', {
        candidate: 201,
        block: 22,
        profileId: 'openai-gpt4o',
        language: 'pt-BR',
      })
    })

    const confirmDialog = await screen.findByRole('alertdialog')
    expect(within(confirmDialog).getByLabelText(/Resumo de custo e privacidade/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(within(confirmDialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })

    await user.click(within(confirmDialog).getByRole('button', { name: /Confirmar e regenerar/i }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('script.regenerate', {
        candidate: 201,
        block: 22,
        profileId: 'openai-gpt4o',
        language: 'pt-BR',
        confirmed: true,
      })
    })
    expect(store.recarregarRoteiro).toHaveBeenCalled()
  })

  it('exibe faixa partial, badges stale/edited e permite inserir/alternar Frase no bloco em foco', async () => {
    const aoMudarRefEmFoco = vi.fn()
    const store = criarStoreFake({
      roteiro: {
        schemaVersion: 1,
        revision: 4,
        detectedLanguage: 'pt-BR',
        languageRequired: false,
        angle: { name: 'Custo da escolha', promise: 'Mostra o preço da decisão.' },
        current: {
          generation: 1,
          language: 'pt-BR',
          blocks: [
            {
              id: 31,
              position: 1,
              title: 'Bloco 1',
              intent: 'Abertura',
              refs: [10],
              narration: 'Texto já gerado.',
              status: 'pendente',
              stale: true,
              version: 2,
              edited: true,
              job: null,
            },
            {
              id: 32,
              position: 2,
              title: 'Bloco 2',
              intent: 'Fechamento',
              refs: [],
              narration: null,
              status: 'pendente',
              stale: false,
              version: 1,
              edited: false,
              job: null,
            },
          ],
          totalChars: 16,
          pending: 2,
          approved: 0,
          complete: false,
        },
        narrationAllowed: false,
        busy: false,
        job: null,
        generations: [],
        limits: { titleChars: 80, narrationChars: 800, scriptChars: 6000, refs: 50 },
      },
    })
    render(
      envolver(
        <PassoRoteiro
          candidateId={201}
          store={store}
          fila={criarFila(() => 'demo')}
          aoMudarRefEmFoco={aoMudarRefEmFoco}
          aoAvancarNarracao={vi.fn()}
          blocoFocadoInicial={31}
        />,
      ),
    )

    expect(screen.getByText(/Roteiro parcial:/i)).toBeInTheDocument()
    expect(screen.getByText(/1 de 2 blocos gerados/i)).toBeInTheDocument()
    expect(screen.getByText('Desatualizado — ângulo mudou')).toBeInTheDocument()
    expect(screen.getByText('Editado')).toBeInTheDocument()

    // Foco inicial no bloco 31 registra alvo de inserção de Frases
    await waitFor(() => {
      const ultimoAlvo = aoMudarRefEmFoco.mock.calls.at(-1)?.[0]
      expect(ultimoAlvo?.chave).toBe('bloco-31')
      expect(ultimoAlvo?.refs).toEqual([10])
    })

    // Alternar ID 12 via callback adiciona #12 ao bloco 31
    const alvo = aoMudarRefEmFoco.mock.calls.at(-1)?.[0]
    act(() => {
      alvo.alternarId(12)
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remover #12' })).toBeInTheDocument()
    })
  })
})
