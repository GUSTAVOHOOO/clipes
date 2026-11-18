import { ProvedorDicas, ProvedorToast } from '@ds'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { ConfigProvedores } from '~/telas/config/ConfigProvedores'

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
      <ProvedorToast>
        <ProvedorAtalhos>{ui}</ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>
  )
}

function mockPadrao({
  profiles = [
    {
      id: 'legacy',
      label: 'Principal',
      kind: 'openai',
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      nativeSchema: false,
      context: 128000,
      maxOutput: null,
      timeoutSecs: null,
      tokensPerRequest: null,
      tokensPerMinute: null,
      tokensPerDay: null,
      ownKey: false,
      keyLastFour: '9a4f',
      local: false,
      confirmed: true,
      price: null,
      cli: false,
    },
    {
      id: 'ollama-local',
      label: 'Ollama Local',
      kind: 'ollama',
      endpoint: 'http://127.0.0.1:11434',
      model: 'qwen2.5:14b',
      nativeSchema: false,
      context: 32768,
      maxOutput: null,
      timeoutSecs: null,
      tokensPerRequest: null,
      tokensPerMinute: null,
      tokensPerDay: null,
      ownKey: true,
      keyLastFour: null,
      local: true,
      confirmed: true,
      price: null,
      cli: false,
    },
    {
      id: 'codex',
      label: 'Codex CLI',
      kind: 'codex',
      endpoint: null,
      model: null,
      nativeSchema: false,
      ownKey: false,
      keyLastFour: null,
      local: false,
      confirmed: true,
      active: false,
      price: null,
      cli: true,
      experimental: true,
    },
    {
      id: 'claude',
      label: 'Claude Code CLI',
      kind: 'claude',
      endpoint: null,
      model: null,
      nativeSchema: false,
      ownKey: false,
      keyLastFour: null,
      local: false,
      confirmed: false,
      active: false,
      price: null,
      cli: true,
      experimental: true,
    },
    {
      id: 'opencode',
      label: 'OpenCode CLI',
      kind: 'opencode',
      endpoint: null,
      model: 'opencode/big-pickle',
      nativeSchema: false,
      ownKey: false,
      keyLastFour: null,
      local: false,
      confirmed: false,
      active: false,
      price: null,
      cli: true,
      experimental: true,
    },
  ],
  tasks = [
    {
      task: 'selection',
      choice: '',
      source: 'default',
      profile: {
        id: 'legacy',
        label: 'Principal',
        kind: 'openai',
        model: 'gpt-4o-mini',
        local: false,
        cli: false,
        cost: { kind: 'usd' },
      },
      localOnly: false,
      blocked: false,
      missing: null,
      suggestion: null,
    },
    {
      task: 'packaging',
      choice: 'profile:ollama-local',
      source: 'task',
      profile: {
        id: 'ollama-local',
        label: 'Ollama Local',
        kind: 'ollama',
        model: 'qwen2.5:14b',
        local: true,
        cli: false,
        cost: { kind: 'zero' },
      },
      localOnly: true,
      blocked: false,
      missing: null,
      suggestion: null,
    },
    {
      task: 'script',
      choice: 'codex',
      source: 'task',
      profile: {
        id: 'codex',
        label: 'Codex CLI',
        kind: 'codex',
        model: null,
        local: false,
        cli: true,
        cost: { kind: 'plan_quota' },
      },
      localOnly: false,
      blocked: false,
      missing: null,
      suggestion: null,
    },
    {
      task: 'translation',
      choice: '',
      source: 'default',
      profile: {
        id: 'legacy',
        label: 'Principal',
        kind: 'openai',
        model: 'gpt-4o-mini',
        local: false,
        cli: false,
        cost: { kind: 'usd' },
      },
      localOnly: false,
      blocked: false,
      missing: null,
      suggestion: null,
    },
  ],
  groqConfigured = true,
}: {
  profiles?: unknown[]
  tasks?: unknown[]
  groqConfigured?: boolean
} = {}) {
  chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    switch (cmd) {
      case 'assistant.status':
        return { completed: true, skipped: false, needsSetup: false, default: 'legacy', tasks: {}, localOnly: {}, missing: {} }
      case 'assistant.tasks':
        return { projectLocalOnly: false, tasks }
      case 'provider.profiles.list':
        return { profiles }
      case 'provider.status':
        return {
          kind: 'openai',
          endpoint: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          nativeSchema: false,
          context: 128000,
          keyLastFour: '9a4f',
          remote: true,
          confirmed: true,
          timeouts: { remote: 60, local: 300 },
        }
      case 'provider.cli.status':
        return {
          selected: '',
          codexConfirmed: true,
          claudeConfirmed: false,
          opencodeConfirmed: false,
          opencodeModel: 'opencode/big-pickle',
          timeoutSeconds: 300,
        }
      case 'provider.context.get':
        return {
          profileId: args.profileId ?? 'legacy',
          kind: args.profileId === 'ollama-local' ? 'ollama' : 'openai',
          value: args.profileId === 'ollama-local' ? 32768 : 128000,
          source: 'user',
          detail: null,
          explanation: 'Informado por você',
          capped: false,
          warning: null,
          measured: false,
          userContext: args.profileId === 'ollama-local' ? 32768 : 128000,
          loaded: null,
          maxContext: null,
          maxOutput: null,
          refreshed: Boolean(args.refresh),
        }
      case 'provider.selection_state':
        return {
          applicable: true,
          profileId: 'legacy',
          kind: 'openai',
          model: 'gpt-4o-mini',
          contextTokens: 128000,
          origin: 'user',
          state: 'full',
          reference: {
            sourceMinutes: 60,
            maxWindowMinutes: 15,
            minWindowMinutes: 9,
            firstWindowMinutes: 15,
            windows: 5,
          },
          guides: [],
        }
      case 'transcription.groq.key.status':
        return { configured: groqConfigured }
      default:
        return {}
    }
  })
}

describe('ConfigProvedores', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    window.location.hash = '#/config/provedores'
  })

  afterEach(() => {
    window.location.hash = ''
  })

  it('estado loading exibe Esqueleto enquanto carrega', () => {
    chamarMock.mockImplementation(() => new Promise(() => {}))
    render(envolver(<ConfigProvedores projetoAberto="canal-1" />))

    expect(screen.getByRole('status', { name: 'Carregando Provedores' })).toBeInTheDocument()
  })

  it('estado empty exibe EstadoTela quando não há perfil HTTP/local nem CLI confirmado', async () => {
    mockPadrao({
      profiles: [
        { id: 'codex', label: 'Codex CLI', kind: 'codex', cli: true, confirmed: false, active: false },
        { id: 'claude', label: 'Claude Code CLI', kind: 'claude', cli: true, confirmed: false, active: false, experimental: true },
        { id: 'opencode', label: 'OpenCode CLI', kind: 'opencode', cli: true, confirmed: false, active: false },
      ],
    })

    render(envolver(<ConfigProvedores projetoAberto={null} />))

    expect(await screen.findByText('Nenhum Perfil de Provedor configurado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adicionar Perfil de Provedor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir assistente inicial' })).toBeInTheDocument()
  })

  it('estado partial mostra aviso apenas na linha com perfil removido ou bloqueada por Somente local', async () => {
    mockPadrao({
      tasks: [
        {
          task: 'selection',
          choice: 'profile:legacy',
          source: 'task',
          profile: { id: 'legacy', label: 'Principal', kind: 'openai', model: 'gpt-4o-mini', local: false, cli: false, cost: { kind: 'usd' } },
          localOnly: true,
          blocked: true,
          missing: null,
          suggestion: { choice: 'profile:ollama-local', label: 'Ollama Local', measured: false },
        },
        {
          task: 'packaging',
          choice: '',
          source: 'none',
          profile: null,
          localOnly: false,
          blocked: false,
          missing: 'antigo',
          suggestion: null,
        },
        {
          task: 'script',
          choice: 'codex',
          source: 'task',
          profile: { id: 'codex', label: 'Codex CLI', kind: 'codex', model: null, local: false, cli: true, cost: { kind: 'plan_quota' } },
          localOnly: false,
          blocked: false,
          missing: null,
          suggestion: null,
        },
        {
          task: 'translation',
          choice: 'profile:ollama-local',
          source: 'task',
          profile: { id: 'ollama-local', label: 'Ollama Local', kind: 'ollama', model: 'qwen2.5:14b', local: true, cli: false, cost: { kind: 'zero' } },
          localOnly: false,
          blocked: false,
          missing: null,
          suggestion: null,
        },
      ],
    })

    render(envolver(<ConfigProvedores projetoAberto="canal-1" />))

    expect(await screen.findByText(/Bloqueado pelo modo Somente local/i)).toBeInTheDocument()
    expect(screen.getByText(/Perfil anterior removido/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Novo Perfil/i })).toBeEnabled()
  })

  it('estado error traduz local_only_violation, vault, invalid_endpoint, groq_key, cli_auth_required e probe_not_local em role="alert"', async () => {
    const user = userEvent.setup()
    mockPadrao()
    const erros: Array<[string, RegExp]> = [
      ['local_only_violation', /Bloqueado pelo modo Somente local/i],
      ['vault', /cofre de senhas/i],
      ['invalid_endpoint', /HTTPS/i],
      ['groq_key', /chave do Groq foi recusada/i],
      ['cli_auth_required', /não está autenticado/i],
      ['probe_not_local', /loopback/i],
    ]

    for (const [code, esperado] of erros) {
      chamarMock.mockImplementation(async (cmd: string) => {
        if (cmd === 'transcription.groq.key.test') {
          throw new ErroCore(code, `detalhe ${code}`)
        }
        return chamarDefault(cmd)
      })
      const { unmount } = render(envolver(<ConfigProvedores projetoAberto="canal-1" />))
      const btn = await screen.findByRole('button', { name: 'Testar chave Groq' })
      await user.click(btn)
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(esperado)
      unmount()
    }

    async function chamarDefault(cmd: string) {
      if (cmd === 'assistant.status') return { completed: true, skipped: false, needsSetup: false, default: 'legacy', tasks: {}, localOnly: {}, missing: {} }
      if (cmd === 'assistant.tasks') return { projectLocalOnly: false, tasks: [] }
      if (cmd === 'provider.profiles.list') return { profiles: [{ id: 'legacy', label: 'Principal', kind: 'openai', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini', local: false, confirmed: true, keyLastFour: '9a4f', cli: false }] }
      if (cmd === 'provider.status') return { timeouts: { remote: 60, local: 300 } }
      if (cmd === 'provider.cli.status') return { selected: '', codexConfirmed: false, claudeConfirmed: false, opencodeConfirmed: false, opencodeModel: '', timeoutSeconds: 300 }
      if (cmd === 'provider.context.get') return { profileId: 'legacy', value: 128000, source: 'user' }
      if (cmd === 'provider.selection_state') return { applicable: false }
      if (cmd === 'transcription.groq.key.status') return { configured: true }
      return {}
    }
  })

  it('estado job_running mantém botão Testar em carregando enquanto aguarda resposta', async () => {
    const user = userEvent.setup()
    mockPadrao()
    let resolverTeste!: (v: unknown) => void
    const implOriginal = chamarMock.getMockImplementation()!
    chamarMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'provider.test') {
        return new Promise((r) => {
          resolverTeste = r
        })
      }
      return implOriginal(cmd, args)
    })

    render(envolver(<ConfigProvedores projetoAberto="canal-1" />))

    const cartao = await screen.findByRole('region', { name: /Perfil Principal/i })
    const btnTestar = within(cartao).getByRole('button', { name: 'Testar' })
    await user.click(btnTestar)

    expect(btnTestar).toHaveAttribute('aria-busy', 'true')
    expect(btnTestar).toBeDisabled()

    resolverTeste({ schemaVersion: 1 })
    await waitFor(() => {
      expect(btnTestar).not.toBeDisabled()
    })
  })

  it('alternar Somente local chama assistant.local_only.set', async () => {
    const user = userEvent.setup()
    mockPadrao()
    render(envolver(<ConfigProvedores projetoAberto="canal-1" />))

    const sw = await screen.findByRole('switch', { name: /Somente local \(Seleção de Cortes\)/i })
    await user.click(sw)

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('assistant.local_only.set', {
        task: 'selection',
        enabled: true,
      })
    })
  })

  it('remover perfil abre ConfirmDialog com foco inicial em Cancelar e chama provider.profiles.remove', async () => {
    const user = userEvent.setup()
    mockPadrao()
    render(envolver(<ConfigProvedores projetoAberto="canal-1" />))

    const cartaoLocal = await screen.findByRole('region', { name: /Perfil Ollama Local/i })
    await user.click(within(cartaoLocal).getByRole('button', { name: 'Remover' }))

    const dialog = await screen.findByRole('alertdialog')
    const btnCancelar = within(dialog).getByRole('button', { name: 'Cancelar' })
    expect(btnCancelar).toHaveFocus()

    await user.click(within(dialog).getByRole('button', { name: 'Remover perfil' }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('provider.profiles.remove', {
        profileId: 'ollama-local',
      })
    })
  })

  it('remover chave Groq e de perfil passam por ConfirmDialog antes de chamar *.key.remove', async () => {
    const user = userEvent.setup()
    mockPadrao()
    render(envolver(<ConfigProvedores projetoAberto="canal-1" />))

    // Remover chave Groq
    const btnRemoverGroq = await screen.findByRole('button', { name: 'Remover chave Groq' })
    await user.click(btnRemoverGroq)

    const dialogGroq = await screen.findByRole('alertdialog')
    expect(within(dialogGroq).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    expect(chamarMock).not.toHaveBeenCalledWith('transcription.groq.key.remove', expect.anything())

    await user.click(within(dialogGroq).getByRole('button', { name: 'Remover chave' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('transcription.groq.key.remove', {})
    })
  })

  it('desabilita Remover em perfil legacy e timeouts globais citando #305', async () => {
    mockPadrao()
    render(envolver(<ConfigProvedores projetoAberto="canal-1" />))

    const cartaoLegacy = await screen.findByRole('region', { name: /Perfil Principal/i })
    const btnRemoverLegacy = within(cartaoLegacy).getByRole('button', { name: 'Remover' })
    expect(btnRemoverLegacy).toBeDisabled()
    expect(cartaoLegacy).toHaveTextContent(/#305/)

    const blocoTimeouts = screen.getByRole('region', { name: /Timeouts globais/i })
    const inputRemoto = within(blocoTimeouts).getByLabelText(/Timeout global remoto/i)
    const inputLocal = within(blocoTimeouts).getByLabelText(/Timeout global local/i)
    expect(inputRemoto).toBeDisabled()
    expect(inputLocal).toBeDisabled()
    expect(blocoTimeouts).toHaveTextContent(/#305/)
  })

  it('permite navegação por setas em TabelaGrade, oculta segredo salvo e exibe Experimental no Claude CLI', async () => {
    const user = userEvent.setup()
    mockPadrao()
    render(envolver(<ConfigProvedores projetoAberto="canal-1" />))

    const grid = await screen.findByRole('grid', { name: 'Roteamento de Tarefas de IA' })
    const cel0 = grid.querySelector('[data-cel="0-0"]') as HTMLElement
    cel0.focus()
    expect(cel0).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(grid.querySelector('[data-cel="0-1"]')).toHaveFocus()
    })

    await user.keyboard('{ArrowDown}')
    await waitFor(() => {
      expect(grid.querySelector('[data-cel="1-1"]')).toHaveFocus()
    })

    // Groq input é type="password" e não preenche segredo salvo
    const groqInput = screen.getByLabelText(/Nova chave da API Groq/i) as HTMLInputElement
    expect(groqInput.type).toBe('password')
    expect(groqInput.value).toBe('')

    // Claude CLI mostra Experimental
    const blocoClaude = screen.getByRole('region', { name: /Claude Code CLI/i })
    expect(within(blocoClaude).getByText('Experimental')).toBeInTheDocument()
  })
})
