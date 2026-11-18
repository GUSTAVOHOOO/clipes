import { ProvedorDicas, ProvedorToast } from '@ds'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ErroCore } from '~/core/cliente'
import { SeletorPerfilRedo } from '~/componentes/SeletorPerfilRedo'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {}
  }
  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }
})

function envolver(ui: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>{ui}</ProvedorToast>
    </ProvedorDicas>
  )
}

function configurarMocksPadrao(opcoes?: {
  projectLocalOnly?: boolean
  erroEstimativa?: ErroCore
  erroRedo?: ErroCore
}) {
  chamarMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'provider.profiles.list') {
      return {
        profiles: [
          {
            id: 'legacy',
            label: 'Principal Local',
            kind: 'ollama',
            endpoint: 'http://127.0.0.1:11434/v1',
            model: 'llama3:8b',
            local: true,
            cli: false,
          },
          {
            id: 'remoto-forte',
            label: 'Remoto Forte',
            kind: 'openai',
            endpoint: 'https://api.openai.com/v1',
            model: 'gpt-4o',
            local: false,
            cli: false,
          },
          {
            id: 'leve-local',
            label: 'Leve Local',
            kind: 'ollama',
            endpoint: 'http://127.0.0.1:11435/v1',
            model: 'qwen3:8b',
            local: true,
            cli: false,
          },
        ],
      }
    }
    if (cmd === 'assistant.tasks') {
      return {
        projectLocalOnly: Boolean(opcoes?.projectLocalOnly),
        tasks: [
          {
            task: 'selection',
            choice: 'endpoint',
            source: 'default',
            profile: { id: 'legacy', label: 'Principal Local', kind: 'ollama', local: true },
            localOnly: false,
            blocked: false,
            missing: null,
          },
        ],
      }
    }
    if (cmd === 'selection.estimate') {
      if (opcoes?.erroEstimativa) throw opcoes.erroEstimativa
      const profileId = String(args?.profileId ?? 'remoto-forte')
      const remoto = profileId === 'remoto-forte'
      return {
        run: args?.run ?? 1,
        windows: args?.windows ?? [0],
        profile: {
          id: profileId,
          label: remoto ? 'Remoto Forte' : 'Leve Local',
          kind: remoto ? 'openai' : 'ollama',
          model: remoto ? 'gpt-4o' : 'qwen3:8b',
        },
        paid: remoto,
        leavesMachine: remoto,
        estimate: remoto
          ? { kind: 'usd', minMicroUsd: 600, maxMicroUsd: 2400, inputTokens: 9000, windows: 1 }
          : { kind: 'zero', minMicroUsd: 0, maxMicroUsd: 0, inputTokens: 9000, windows: 1 },
      }
    }
    if (cmd === 'selection.redo') {
      if (opcoes?.erroRedo) throw opcoes.erroRedo
      return {
        run: args?.run ?? 1,
        windows: args?.windows ?? [0],
        profile: { id: String(args?.profileId ?? 'remoto-forte'), label: 'Remoto Forte' },
      }
    }
    return null
  })
}

describe('<SeletorPerfilRedo>', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('carrega perfis excluindo perfilAtual, dispara selection.estimate Modo 3 e abre ConfirmDialog com foco inicial em Cancelar', async () => {
    configurarMocksPadrao()
    render(
      envolver(
        <SeletorPerfilRedo
          aberto
          run={1}
          windows={[0, 1]}
          perfilAtual="legacy"
          aoFechar={vi.fn()}
          aoConcluir={vi.fn()}
        />,
      ),
    )

    const dialogo = await screen.findByRole('alertdialog')
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.estimate', {
        run: 1,
        windows: [0, 1],
        profileId: 'remoto-forte',
      })
    })

    // Exclui perfilAtual ('Principal Local') e mantém os demais
    expect(within(dialogo).queryByText(/Principal Local/)).toBeNull()
    expect(dialogo).toHaveTextContent(/Remoto Forte/)
    expect(dialogo).not.toHaveTextContent(/#\d+/)

    const btnCancelar = within(dialogo).getByRole('button', { name: 'Cancelar' })
    await waitFor(() => {
      expect(document.activeElement).toBe(btnCancelar)
    })
  })

  it('troca perfil no Select, recalcula selection.estimate e confirma chamando selection.redo com confirmed: true (nunca jobs.redo)', async () => {
    const user = userEvent.setup()
    const aoFechar = vi.fn()
    const aoConcluir = vi.fn()
    configurarMocksPadrao()

    render(
      envolver(
        <SeletorPerfilRedo
          aberto
          run={1}
          windows={[2]}
          perfilAtual="legacy"
          aoFechar={aoFechar}
          aoConcluir={aoConcluir}
        />,
      ),
    )

    const dialogo = await screen.findByRole('alertdialog')
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.estimate', {
        run: 1,
        windows: [2],
        profileId: 'remoto-forte',
      })
    })

    const seletor = within(dialogo).getByRole('combobox')
    await user.click(seletor)
    const opcaoLeve = await screen.findByRole('option', { name: /Leve Local/ })
    await user.click(opcaoLeve)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.estimate', {
        run: 1,
        windows: [2],
        profileId: 'leve-local',
      })
    })

    const btnConfirmar = within(dialogo).getByRole('button', { name: /Refazer com este perfil/i })
    await user.click(btnConfirmar)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('selection.redo', {
        run: 1,
        windows: [2],
        profileId: 'leve-local',
        confirmed: true,
      })
    })
    expect(chamarMock.mock.calls.some((c) => c[0] === 'jobs.redo')).toBe(false)
    expect(aoConcluir).toHaveBeenCalledTimes(1)
    expect(aoFechar).toHaveBeenCalledTimes(1)
  })

  it('exibe local_only_violation e window_uncertain em role="alert" sem fechar o diálogo', async () => {
    const user = userEvent.setup()
    const aoFechar = vi.fn()

    configurarMocksPadrao({
      erroEstimativa: new ErroCore('local_only_violation', 'Somente local está ativo para este Projeto.'),
    })

    const { rerender } = render(
      envolver(
        <SeletorPerfilRedo
          aberto
          run={1}
          windows={[0]}
          perfilAtual="legacy"
          aoFechar={aoFechar}
          aoConcluir={vi.fn()}
        />,
      ),
    )

    const alertaLocal = await screen.findByRole('alert')
    expect(alertaLocal).toHaveTextContent(/Somente local/i)
    expect(aoFechar).not.toHaveBeenCalled()

    configurarMocksPadrao({
      erroRedo: new ErroCore('window_uncertain', 'A janela tem chamada incerta pendente.'),
    })

    rerender(
      envolver(
        <SeletorPerfilRedo
          aberto
          run={2}
          windows={[0]}
          perfilAtual="legacy"
          aoFechar={aoFechar}
          aoConcluir={vi.fn()}
        />,
      ),
    )

    const dialogo = await screen.findByRole('alertdialog')
    const btnConfirmar = await within(dialogo).findByRole('button', { name: /Refazer com este perfil/i })
    await waitFor(() => expect(btnConfirmar).toBeEnabled())
    await user.click(btnConfirmar)

    const alertaIncerta = await within(dialogo).findByRole('alert')
    expect(alertaIncerta).toHaveTextContent(/chamada.*incert/i)
    expect(aoFechar).not.toHaveBeenCalled()
  })

  it('UI-34: usa tokens do design-system-v2 sem variáveis CSS v1 no rodapé e quando não há outro perfil', async () => {
    configurarMocksPadrao()
    const { unmount } = render(
      envolver(
        <SeletorPerfilRedo
          aberto
          run={1}
          windows={[0]}
          perfilAtual="legacy"
          aoFechar={vi.fn()}
          aoConcluir={vi.fn()}
        />,
      ),
    )

    const dialogo = await screen.findByRole('alertdialog')
    const notaRevisao = await within(dialogo).findByText(/Gera uma nova revisão nesta execução/i)
    const linhaNota = notaRevisao.closest('div')
    expect(linhaNota).toHaveClass('text-pequeno', 'text-t3')

    const classesNormal = Array.from(dialogo.querySelectorAll('*'))
      .map((el) => el.getAttribute('class') ?? '')
      .join(' ')
    expect(classesNormal).not.toMatch(/var\(--(borda|raio-|texto-|texto\))/)
    unmount()

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'provider.profiles.list') {
        return {
          profiles: [
            {
              id: 'legacy',
              label: 'Principal Local',
              kind: 'ollama',
              endpoint: 'http://127.0.0.1:11434/v1',
              model: 'llama3:8b',
              local: true,
              cli: false,
            },
          ],
        }
      }
      if (cmd === 'assistant.tasks') {
        return { projectLocalOnly: false, tasks: [] }
      }
      return null
    })

    render(
      envolver(
        <SeletorPerfilRedo
          aberto
          run={1}
          windows={[0]}
          perfilAtual="legacy"
          aoFechar={vi.fn()}
          aoConcluir={vi.fn()}
        />,
      ),
    )

    const dialogoVazio = await screen.findByRole('alertdialog')
    const msgSemOutro = await within(dialogoVazio).findByText(/Nenhum outro Perfil de Provedor disponível/i)
    expect(msgSemOutro).toHaveClass('text-pequeno', 'text-t3')

    const classesVazio = Array.from(dialogoVazio.querySelectorAll('*'))
      .map((el) => el.getAttribute('class') ?? '')
      .join(' ')
    expect(classesVazio).not.toMatch(/var\(--(borda|raio-|texto-|texto\))/)
  })

  it('UI-35: não expõe número de ticket (#304), comandos internos nem "legacy" na UI', async () => {
    const user = userEvent.setup()

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'provider.profiles.list') {
        return {
          profiles: [
            {
              id: 'legacy',
              label: 'legacy',
              kind: 'openai',
              endpoint: 'https://api.openai.com/v1',
              model: 'gpt-4o-mini',
              local: false,
              cli: false,
            },
            {
              id: 'remoto-forte',
              label: 'Remoto Forte',
              kind: 'openai',
              endpoint: 'https://api.openai.com/v1',
              model: 'gpt-4o',
              local: false,
              cli: false,
            },
          ],
        }
      }
      if (cmd === 'assistant.tasks') {
        return { projectLocalOnly: false, tasks: [] }
      }
      if (cmd === 'selection.estimate') {
        return {
          run: 1,
          windows: [0],
          profile: { id: 'legacy', label: 'legacy', kind: 'openai', model: 'gpt-4o-mini' },
          paid: true,
          leavesMachine: true,
          estimate: { kind: 'usd', minMicroUsd: 500, maxMicroUsd: 1500, inputTokens: 6000, windows: 1 },
        }
      }
      return null
    })

    render(
      envolver(
        <SeletorPerfilRedo
          aberto
          run={1}
          windows={[0]}
          perfilAtual="remoto-forte"
          aoFechar={vi.fn()}
          aoConcluir={vi.fn()}
        />,
      ),
    )

    const dialogo = await screen.findByRole('alertdialog')
    const resumo = await within(dialogo).findByRole('region', {
      name: /Resumo de custo e privacidade/i,
    })

    const notaRevisao = within(dialogo).getByText(/Gera uma nova revisão nesta execução/i)
    await user.hover(notaRevisao)

    expect(document.body.textContent ?? '').not.toMatch(/#\d+/)
    expect(document.body.textContent ?? '').not.toContain('selection.redo')
    expect(dialogo).not.toHaveTextContent(/\blegacy\b/i)
    expect(within(dialogo).getByRole('combobox')).toHaveTextContent('Perfil configurado')
    expect(within(resumo).getByText('Perfil configurado')).toBeInTheDocument()
  })
})
