import { ProvedorDicas, ProvedorToast } from '@ds'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErroCore } from '~/core/cliente'
import { criarFila } from '~/core/progresso'
import type { AngulosDoc, RoteiroDoc, useTransformarCorte } from '~/stores/transformarCorte'
import { PassoAngulo } from '~/telas/corte/transformar/PassoAngulo'

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
    revision: 0,
    detectedLanguage: 'pt-BR',
    languageRequired: false,
    selected: null,
    angles: [],
    generations: [],
    job: null,
  }
  const roteiroBase: RoteiroDoc = {
    schemaVersion: 1,
    revision: 0,
    detectedLanguage: 'pt-BR',
    languageRequired: false,
    angle: null,
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
        id: 'openai-gpt4o',
        label: 'OpenAI GPT-4o',
        kind: 'openai',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        local: false,
        cli: false,
      },
      {
        id: 'local-qwen',
        label: 'Ollama Local',
        kind: 'ollama',
        endpoint: 'http://127.0.0.1:11434/v1',
        model: 'qwen3:8b',
        local: true,
        cli: false,
      },
    ],
    tarefas: null,
    orcamento: { limitMicroUsd: 1_000_000, spentMicroUsd: 200_000, remainingMicroUsd: 800_000, callsRemaining: 10, paused: false },
    somenteLocal: false,
    recarregar: vi.fn().mockResolvedValue(undefined),
    recarregarAngulos: vi.fn().mockResolvedValue(undefined),
    recarregarRoteiro: vi.fn().mockResolvedValue(undefined),
    recarregarNarracao: vi.fn().mockResolvedValue(undefined),
    recarregarTts: vi.fn().mockResolvedValue(undefined),
    resolverDestino: () => ({
      perfil: { id: 'openai-gpt4o', label: 'OpenAI GPT-4o', kind: 'api', model: 'gpt-4o' },
      localidade: 'remoto',
      saiDaMaquina: true,
      host: 'api.openai.com',
      bloqueadoSomenteLocal: false,
    }),
    ...overrides,
  }
}

describe('<PassoAngulo>', () => {
  afterEach(() => {
    chamarMock.mockReset()
  })

  it('exibe estado vazio com "Nenhum ângulo sugerido ainda" e CTAs iniciais', () => {
    const store = criarStoreFake()

    render(
      envolver(
        <PassoAngulo
          candidateId={201}
          store={store}
          fila={criarFila(() => 'demo')}
          aoClicarChipFrase={vi.fn()}
          aoAvancarPasso={vi.fn()}
        />,
      ),
    )

    expect(screen.getByText('Nenhum ângulo sugerido ainda')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sugerir ângulos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Escrever meu próprio ângulo' })).toBeInTheDocument()
  })

  it('abre <ConfirmDialog focoInicial="cancelar"> com <ResumoCustoPrivacidade> antes de angles.generate em Provedor pago', async () => {
    const store = criarStoreFake()
    const user = userEvent.setup()

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'angles.estimate') {
        return {
          paid: true,
          profile: 'openai-gpt4o',
          estimate: { kind: 'usd', minMicroUsd: 15_000, maxMicroUsd: 35_000, inputTokens: 1200 },
        }
      }
      if (cmd === 'angles.generate') {
        return { job: 301 }
      }
      return {}
    })

    render(
      envolver(
        <PassoAngulo
          candidateId={201}
          store={store}
          fila={criarFila(() => 'demo')}
          aoClicarChipFrase={vi.fn()}
          aoAvancarPasso={vi.fn()}
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Sugerir ângulos' }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('angles.estimate', { candidate: 201, language: 'pt-BR' })
    })

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByLabelText(/Resumo de custo e privacidade/i)).toBeInTheDocument()
    expect(within(dialog).getByText('OpenAI GPT-4o')).toBeInTheDocument()
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })

    expect(chamarMock).not.toHaveBeenCalledWith('angles.generate', expect.anything())

    await user.click(within(dialog).getByRole('button', { name: /Confirmar e sugerir/i }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('angles.generate', {
        candidate: 201,
        language: 'pt-BR',
        confirmed: true,
      })
    })
    expect(store.recarregarAngulos).toHaveBeenCalled()
  })

  it('valida ângulo manual (nome 1..60, promessa 1..200) e envia angles.choose quando válido', async () => {
    const store = criarStoreFake()
    const aoMudarRefEmFoco = vi.fn()
    const user = userEvent.setup()
    chamarMock.mockResolvedValue({ selected: { name: 'Novo ângulo', promise: 'Promessa clara.' }, angles: [], job: null })

    render(
      envolver(
        <PassoAngulo
          candidateId={201}
          store={store}
          fila={criarFila(() => 'demo')}
          aoClicarChipFrase={vi.fn()}
          aoMudarRefEmFoco={aoMudarRefEmFoco}
          aoAvancarPasso={vi.fn()}
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Escrever meu próprio ângulo' }))

    const nomeInput = screen.getByLabelText(/Nome do ângulo/i)
    const promessaInput = screen.getByLabelText(/Promessa em uma frase/i)
    const usarBtn = screen.getByRole('button', { name: 'Usar meu ângulo' })

    // Submissão vazia falha com foco no primeiro campo inválido
    await user.click(usarBtn)
    expect(screen.getByText(/Informe o nome do ângulo/i)).toBeInTheDocument()
    expect(nomeInput).toHaveFocus()
    expect(chamarMock).not.toHaveBeenCalled()

    // Excesso de caracteres (> 60 no nome e > 200 na promessa)
    fireEvent.change(nomeInput, { target: { value: 'A'.repeat(61) } })
    fireEvent.change(promessaInput, { target: { value: 'B'.repeat(201) } })
    await user.click(usarBtn)
    expect(screen.getByText(/máximo 60 caracteres/i)).toBeInTheDocument()
    expect(screen.getByText(/máximo 200 caracteres/i)).toBeInTheDocument()
    expect(nomeInput).toHaveFocus()
    expect(chamarMock).not.toHaveBeenCalled()

    // Preenche corretamente e adiciona frase de apoio
    fireEvent.change(nomeInput, { target: { value: 'Custo oculto' } })
    fireEvent.change(promessaInput, { target: { value: 'Mostra o impacto real da decisão.' } })
    const refsInput = screen.getByLabelText(/Frases de apoio/i)
    await user.type(refsInput, '10{Enter}')

    expect(aoMudarRefEmFoco).toHaveBeenCalled()
    await user.click(usarBtn)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('angles.choose', {
        candidate: 201,
        angle: {
          name: 'Custo oculto',
          promise: 'Mostra o impacto real da decisão.',
          sentence_ids: [10],
        },
      })
    })
    expect(store.recarregarAngulos).toHaveBeenCalled()
    expect(store.recarregarRoteiro).toHaveBeenCalled()
  })

  it('clicar em chip de Frase da sugestão chama aoClicarChipFrase e troca com Roteiro intercepta angle_change_confirmation', async () => {
    const store = criarStoreFake({
      angulos: {
        schemaVersion: 1,
        revision: 1,
        detectedLanguage: 'pt-BR',
        languageRequired: false,
        selected: { name: 'Ângulo atual', promise: 'Promessa atual.', sentence_ids: [10] },
        angles: [
          { name: 'Custo da escolha', promise: 'Entenda a escolha.', audience: 'Iniciantes', sentence_ids: [11, 12] },
        ],
        generations: [{ generation: 1 }],
        job: null,
      },
      roteiro: {
        schemaVersion: 1,
        revision: 1,
        detectedLanguage: 'pt-BR',
        languageRequired: false,
        angle: { name: 'Ângulo atual', promise: 'Promessa atual.' },
        current: {
          generation: 1,
          language: 'pt-BR',
          blocks: [
            { id: 1, position: 1, title: 'B1', intent: 'Abertura', refs: [10], narration: 'Texto', status: 'aprovado', stale: false, version: 1, edited: false, job: null },
          ],
          totalChars: 5,
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
    const aoClicarChipFrase = vi.fn()
    const user = userEvent.setup()

    chamarMock.mockImplementation(async (_cmd: string, args: { confirmed?: boolean }) => {
      if (!args.confirmed) {
        throw new ErroCore('angle_change_confirmation', 'Confirme a troca do ângulo.')
      }
      return { selected: { name: 'Custo da escolha', promise: 'Entenda a escolha.' }, angles: store.angulos?.angles ?? [] }
    })

    render(
      envolver(
        <PassoAngulo
          candidateId={201}
          store={store}
          fila={criarFila(() => 'demo')}
          aoClicarChipFrase={aoClicarChipFrase}
          aoAvancarPasso={vi.fn()}
        />,
      ),
    )

    // Clique no chip #11 da sugestão rola a Transcrição
    await user.click(screen.getByRole('button', { name: '#11' }))
    expect(aoClicarChipFrase).toHaveBeenCalledWith(11)

    // Escolher sugestão com Roteiro existente intercepta angle_change_confirmation
    await user.click(screen.getByRole('button', { name: 'Escolher este ângulo' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/os blocos do Roteiro ficarão desatualizados/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })

    await user.click(within(dialog).getByRole('button', { name: 'Trocar ângulo' }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenLastCalledWith('angles.choose', {
        candidate: 201,
        generation: 1,
        index: 0,
        confirmed: true,
      })
    })
    expect(store.recarregarAngulos).toHaveBeenCalled()
    expect(store.recarregarRoteiro).toHaveBeenCalled()
  })

  it('UI-105: não duplica o cartão do ângulo escolhido na lista de sugestões abaixo', () => {
    const anguloEscolhido = {
      name: 'Custo da escolha',
      promise: 'Entenda por que decidir cedo muda o resultado.',
      audience: 'Quem precisa decidir',
      sentence_ids: [10, 11],
    }
    const store = criarStoreFake({
      angulos: {
        schemaVersion: 1,
        revision: 1,
        detectedLanguage: 'pt-BR',
        languageRequired: false,
        selected: anguloEscolhido,
        angles: [
          anguloEscolhido,
          { name: 'Aprender com o erro', promise: 'Descubra como transformar uma falha.', sentence_ids: [12] },
        ],
        generations: [{ generation: 1 }],
        job: null,
      },
    })

    render(
      envolver(
        <PassoAngulo
          candidateId={201}
          store={store}
          fila={criarFila(() => 'demo')}
          aoClicarChipFrase={vi.fn()}
          aoAvancarPasso={vi.fn()}
        />,
      ),
    )

    expect(screen.getAllByText('Custo da escolha')).toHaveLength(1)
    expect(screen.getByText('Aprender com o erro')).toBeInTheDocument()
  })

  it('UI-111: omite o rótulo "Orçamento" no <ResumoCustoPrivacidade> quando os valores de teto são nulos', async () => {
    const user = userEvent.setup()
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'angles.estimate') {
        return {
          paid: true,
          profile: 'openai-gpt4o',
          language: 'pt-BR',
          estimate: { kind: 'usd', minMicroUsd: 10_000, maxMicroUsd: 30_000, inputTokens: 1500 },
        }
      }
      return null
    })

    const store = criarStoreFake({
      orcamento: {
        limitMicroUsd: null,
        spentMicroUsd: 0,
        remainingMicroUsd: null,
        callsRemaining: null,
        paused: false,
      },
    })

    render(
      envolver(
        <PassoAngulo
          candidateId={201}
          store={store}
          fila={criarFila(() => 'demo')}
          aoClicarChipFrase={vi.fn()}
          aoAvancarPasso={vi.fn()}
        />,
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Sugerir ângulos' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByLabelText(/Resumo de custo e privacidade/i)).toBeInTheDocument()
    expect(within(dialog).queryByText('Orçamento')).not.toBeInTheDocument()
  })
})
