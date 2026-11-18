import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { Inicio } from '~/telas/inicio/Inicio'

const chamarMock = vi.fn()
const notificarMudancaProjetoMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

vi.mock('~/shell/Shell', async () => {
  const atual = await vi.importActual<typeof import('~/shell/Shell')>('~/shell/Shell')
  return {
    ...atual,
    notificarMudancaProjeto: () => notificarMudancaProjetoMock(),
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
})

function envolver(children: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>{children}</ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>
  )
}

function mockPadrao({
  recent = [
    { available: true, name: 'Meu Canal de Cortes', path: '/projetos/MeuCanal.clipes' },
    { available: false, name: 'Live Antiga', path: '/backup/Antiga.clipes' },
  ],
  current = null as { id: string; name: string; path: string; warning?: string | null } | null,
  needsSetup = false,
}: {
  recent?: Array<{ available: boolean; name: string; path: string }>
  current?: { id: string; name: string; path: string; warning?: string | null } | null
  needsSetup?: boolean
} = {}) {
  chamarMock.mockImplementation(async (cmd: string) => {
    if (cmd === 'projects.recent') return recent
    if (cmd === 'projects.current') return current
    if (cmd === 'assistant.status') return { needsSetup, completed: !needsSetup, skipped: false }
    return null
  })
}

describe('Tela Início e Projetos (#/inicio)', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    notificarMudancaProjetoMock.mockReset()
    delete window.__CLIPES_E2E__
    window.history.replaceState(null, '', '/')
    window.location.hash = '#/inicio'
  })

  afterEach(() => {
    delete window.__CLIPES_E2E__
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
  })

  it('loading exibe <Esqueleto> sem mostrar "Nenhum Projeto recente ainda"', async () => {
    let resolverRecentes!: (v: unknown) => void
    chamarMock.mockImplementation((cmd: string) => {
      if (cmd === 'projects.recent') {
        return new Promise((res) => {
          resolverRecentes = res
        })
      }
      if (cmd === 'projects.current') return Promise.resolve(null)
      if (cmd === 'assistant.status') return Promise.resolve({ needsSetup: false })
      return Promise.resolve(null)
    })

    render(envolver(<Inicio />))

    expect(screen.getByRole('status', { name: /Carregando Projetos recentes/i })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.queryByText('Nenhum Projeto recente ainda')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Novo Projeto/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Abrir pasta \.clipes/i })).toBeEnabled()

    resolverRecentes([])
    expect(await screen.findByText('Nenhum Projeto recente ainda')).toBeInTheDocument()
  })

  it('empty (?estado=vazio ou recent: []) exibe "Nenhum Projeto recente ainda" e "Criar primeiro Projeto"', async () => {
    mockPadrao({ recent: [] })
    render(envolver(<Inicio />))

    expect(await screen.findByText('Nenhum Projeto recente ainda')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Criar primeiro Projeto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Abrir pasta \.clipes/i })).toBeInTheDocument()

    window.location.hash = '#/inicio?estado=vazio'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    mockPadrao()
    expect(await screen.findByText('Nenhum Projeto recente ainda')).toBeInTheDocument()
  })

  it('error traduz newer_project e project_busy dentro de role="alert"', async () => {
    const user = userEvent.setup()
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.recent') {
        return [{ available: true, name: 'Futuro', path: '/tmp/futuro.clipes' }]
      }
      if (cmd === 'projects.current') return null
      if (cmd === 'assistant.status') return { needsSetup: false }
      if (cmd === 'projects.open') throw new ErroCore('newer_project', 'schema v9 > v5')
      return null
    })

    render(envolver(<Inicio />))
    const btnAbrir = await screen.findByRole('button', { name: /Abrir Projeto Futuro/i })
    await user.click(btnAbrir)

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Este Projeto foi salvo por uma versão mais nova do Clipes.')
    expect(within(alerta).getByRole('button', { name: 'Verificar atualizações' })).toBeInTheDocument()

    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.recent') return []
      if (cmd === 'projects.current') {
        return { id: 'p1', name: 'Ativo', path: '/tmp/Ativo.clipes', warning: null }
      }
      if (cmd === 'assistant.status') return { needsSetup: false }
      if (cmd === 'projects.close') throw new ErroCore('project_busy', 'transcrevendo')
      return null
    })

    render(envolver(<Inicio />))
    const btnFechar = await screen.findByRole('button', { name: 'Fechar Projeto' })
    await user.click(btnFechar)

    const alertas = await screen.findAllByRole('alert')
    const alertaOcupado = alertas[alertas.length - 1]
    expect(alertaOcupado).toHaveTextContent('Há uma tarefa ativa bloqueando esta operação no Projeto.')
    expect(within(alertaOcupado).getByRole('button', { name: 'Abrir Fila de Jobs' })).toBeInTheDocument()
  })

  it('ready renderiza Projeto disponível com "Abrir", indisponível com Status "Indisponível no disco" + "Localizar pasta…", e faixa de Projeto ativo com warning', async () => {
    mockPadrao({
      current: {
        id: 'meu-canal',
        name: 'Meu Canal de Cortes',
        path: '/projetos/MeuCanal.clipes',
        warning: 'Backup falhou',
      },
    })

    render(envolver(<Inicio />))

    expect(await screen.findByRole('heading', { name: 'Projetos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continuar no Projeto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fechar Projeto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Falha no backup automático/i })).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /Abrir Projeto Meu Canal de Cortes/i })).toBeInTheDocument()
    expect(screen.getByText('Indisponível no disco')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Localizar pasta/i })).toBeInTheDocument()
  })

  it('job_running mantém botão em aria-busy durante criação/abertura/migração', async () => {
    const user = userEvent.setup()
    let resolverOpen!: (v: unknown) => void
    chamarMock.mockImplementation((cmd: string) => {
      if (cmd === 'projects.recent') {
        return Promise.resolve([
          { available: true, name: 'Legado V1', path: '/v1/LegadoV1.clipes' },
        ])
      }
      if (cmd === 'projects.current') return Promise.resolve(null)
      if (cmd === 'assistant.status') return Promise.resolve({ needsSetup: false })
      if (cmd === 'projects.open') {
        return new Promise((res) => {
          resolverOpen = res
        })
      }
      return Promise.resolve(null)
    })

    render(envolver(<Inicio />))
    const btnAbrir = await screen.findByRole('button', { name: /Abrir Projeto Legado V1/i })
    await user.click(btnAbrir)

    expect(btnAbrir).toHaveAttribute('aria-busy', 'true')
    expect(btnAbrir).toBeDisabled()

    resolverOpen({ id: 'legado-v1', name: 'Legado V1', path: '/v1/LegadoV1.clipes' })
    await waitFor(() => {
      expect(window.location.hash).toBe('#/projeto/legado-v1/fontes')
    })
  })

  it('needsSetup: true redireciona para #/assistente?passo=1 (exceto se ?estado= estiver ativo)', async () => {
    mockPadrao({ needsSetup: true })
    const { unmount } = render(envolver(<Inicio />))

    await waitFor(() => {
      expect(window.location.hash).toBe('#/assistente?passo=1')
    })

    unmount()
    window.location.hash = '#/inicio?estado=vazio'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    render(envolver(<Inicio />))

    expect(await screen.findByText('Nenhum Projeto recente ainda')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/inicio?estado=vazio')
  })

  it('ações: criar Projeto chama projects.create e navega; abrir V1 chama projects.open e navega; fechar Projeto chama projects.close', async () => {
    const user = userEvent.setup()
    chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'projects.recent') {
        return [
          { available: true, name: 'V1 Existente', path: 'C:\\V1\\CanalAntigo.clipes' },
          { available: false, name: 'Movido', path: '/antigo/Movido.clipes' },
        ]
      }
      if (cmd === 'projects.current') {
        return { id: 'ativo', name: 'Ativo', path: '/tmp/Ativo.clipes', warning: null }
      }
      if (cmd === 'assistant.status') return { needsSetup: false }
      if (cmd === 'projects.create') {
        return {
          id: 'canal-teste',
          name: String(args.name),
          path: `${args.parent}/${args.name}.clipes`,
        }
      }
      if (cmd === 'projects.open') {
        return { id: 'canal-antigo', name: 'V1 Existente', path: String(args.path) }
      }
      if (cmd === 'projects.close') return null
      return null
    })

    render(envolver(<Inicio />))

    // Fechar projeto ativo
    await user.click(await screen.findByRole('button', { name: 'Fechar Projeto' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('projects.close', {})
      expect(notificarMudancaProjetoMock).toHaveBeenCalled()
    })

    // Criar novo Projeto com validação de nome inválido primeiro
    await user.click(screen.getByRole('button', { name: /Novo Projeto/i }))
    const dialogo = await screen.findByRole('dialog', { name: 'Novo Projeto' })
    const campoNome = within(dialogo).getByRole('textbox', { name: 'Nome do Projeto' })
    const campoPasta = within(dialogo).getByRole('textbox', { name: 'Pasta onde salvar' })

    await user.type(campoNome, 'a/b')
    await user.type(campoPasta, '/tmp/clipes')
    await user.click(within(dialogo).getByRole('button', { name: 'Criar Projeto' }))

    expect(campoNome).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialogo).getByText(/Escolha um nome válido/i)).toBeInTheDocument()
    expect(chamarMock).not.toHaveBeenCalledWith('projects.create', expect.anything())

    await user.clear(campoNome)
    await user.type(campoNome, 'Canal Teste')
    expect(within(dialogo).getByText(/\/tmp\/clipes\/Canal Teste\.clipes/)).toBeInTheDocument()
    await user.click(within(dialogo).getByRole('button', { name: 'Criar Projeto' }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('projects.create', {
        name: 'Canal Teste',
        parent: '/tmp/clipes',
      })
      expect(window.location.hash).toBe('#/projeto/canal-teste/fontes')
    })

    // Abrir projeto V1 existente pela lista
    window.location.hash = '#/inicio'
    await user.click(screen.getByRole('button', { name: /Abrir Projeto V1 Existente/i }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('projects.open', {
        path: 'C:\\V1\\CanalAntigo.clipes',
      })
      expect(window.location.hash).toBe('#/projeto/canal-antigo/fontes')
    })
  })

  it('teclado: Ctrl+N abre Novo Projeto com foco inicial em Nome do Projeto e Ctrl+O aciona Abrir pasta .clipes', async () => {
    const user = userEvent.setup()
    mockPadrao()
    render(envolver(<Inicio />))

    await screen.findByRole('heading', { name: 'Projetos' })

    await user.keyboard('{Control>}n{/Control}')
    const dialogoNovo = await screen.findByRole('dialog', { name: 'Novo Projeto' })
    const campoNome = within(dialogoNovo).getByRole('textbox', { name: 'Nome do Projeto' })
    await waitFor(() => {
      expect(campoNome).toHaveFocus()
    })

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Novo Projeto' })).not.toBeInTheDocument()
    })

    await user.keyboard('{Control>}o{/Control}')
    expect(await screen.findByRole('dialog', { name: 'Abrir pasta .clipes' })).toBeInTheDocument()
  })

  it('Localizar pasta… em item indisponível chama projects.open com novo caminho e filtro aparece quando > 8 itens', async () => {
    const user = userEvent.setup()
    const muitos = Array.from({ length: 9 }, (_, i) => ({
      available: i !== 0,
      name: `Canal ${i + 1}`,
      path: `/projetos/Canal${i + 1}.clipes`,
    }))

    chamarMock.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'projects.recent') return muitos
      if (cmd === 'projects.current') return null
      if (cmd === 'assistant.status') return { needsSetup: false }
      if (cmd === 'projects.open') return { id: 'canal-1', name: 'Canal 1', path: String(args.path) }
      return null
    })

    render(envolver(<Inicio />))

    const busca = await screen.findByRole('searchbox', { name: 'Filtrar projetos recentes' })
    await user.type(busca, 'Canal 1')
    expect(screen.getByText('Canal 1')).toBeInTheDocument()
    expect(screen.queryByText('Canal 2')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Localizar pasta/i }))
    const dialogo = await screen.findByRole('dialog', { name: /Localizar pasta de Canal 1/i })
    const campo = within(dialogo).getByRole('textbox', { name: 'Pasta .clipes' })
    await user.clear(campo)
    await user.type(campo, '/novo/Canal1.clipes')
    await user.click(within(dialogo).getByRole('button', { name: 'Abrir Projeto' }))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('projects.open', { path: '/novo/Canal1.clipes' })
      expect(window.location.hash).toBe('#/projeto/canal-1/fontes')
    })
  })

  it('erro library ao ler recentes mantém "Abrir pasta .clipes" acionável', async () => {
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.recent') throw new ErroCore('library', 'json corrompido')
      if (cmd === 'projects.current') return null
      if (cmd === 'assistant.status') return { needsSetup: false }
      return null
    })

    render(envolver(<Inicio />))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(
      'Não foi possível ler a lista de Projetos recentes, mas você ainda pode abrir qualquer pasta .clipes diretamente.',
    )
    expect(within(alerta).getByRole('button', { name: 'Abrir pasta .clipes' })).toBeInTheDocument()
  })
})
