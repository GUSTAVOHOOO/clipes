import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
import { consolePadrao, registrarConsoleInline } from '~/core/console'
import { criarFila } from '~/core/progresso'
import { ComEstado, estadoForcado } from '~/shell/EstadoForcado'
import { Shell } from '~/shell/Shell'

const chamarMock = vi.fn()

vi.mock('~/core/cliente', async () => {
  const atual = await vi.importActual<typeof import('~/core/cliente')>('~/core/cliente')
  return {
    ...atual,
    chamar: (...args: unknown[]) => chamarMock(...args),
  }
})

vi.mock('@tauri-apps/api/core', async () => {
  const atual = await vi.importActual<typeof import('@tauri-apps/api/core')>('@tauri-apps/api/core')
  return {
    ...atual,
    isTauri: vi.fn(() => false),
  }
})

vi.mock('@tauri-apps/api/event', async () => {
  const atual = await vi.importActual<typeof import('@tauri-apps/api/event')>('@tauri-apps/api/event')
  return {
    ...atual,
    emit: vi.fn(async () => {}),
    listen: vi.fn(async () => () => {}),
  }
})

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({ destroy: vi.fn(async () => {}) })),
}))

const mockIsTauri = vi.mocked(isTauri)
const mockListen = vi.mocked(listen)
const mockEmit = vi.mocked(emit)
const mockGetCurrentWindow = vi.mocked(getCurrentWindow)

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

function envolver(children: ReactNode) {
  return (
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>{children}</ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>
  )
}

describe('estadoForcado', () => {
  it('reconhece os estados oficiais de QA em ?estado= e retorna null para valor desconhecido', () => {
    expect(estadoForcado('?estado=vazio')).toBe('vazio')
    expect(estadoForcado('?estado=erro')).toBe('erro')
    expect(estadoForcado('?estado=carregando')).toBe('carregando')
    expect(estadoForcado('?estado=parcial')).toBe('parcial')
    expect(estadoForcado('?estado=offline')).toBe('offline')
    expect(estadoForcado('?estado=erro-flush')).toBe('erro-flush')
    expect(estadoForcado('?estado=fallback')).toBe('fallback')
    expect(estadoForcado('#/inicio?estado=erro')).toBe('erro')

    expect(estadoForcado('?estado=qualquer')).toBeNull()
    expect(estadoForcado('')).toBeNull()
  })
})

describe('ComEstado', () => {
  it('exibe role="alert" com o título do mapeador quando em erro', () => {
    render(
      <ComEstado
        estado="erro"
        erro={new ErroCore('project_not_open', 'nenhum aberto')}
        carregando={<div>Carregando...</div>}
        vazio={<div>Vazio</div>}
      >
        <div>Conteúdo pronto</div>
      </ComEstado>,
    )

    const alerta = screen.getByRole('alert')
    expect(alerta).toHaveTextContent('Nenhum Projeto está aberto no momento.')
    expect(screen.getByRole('button', { name: 'Ir para Início' })).toBeInTheDocument()
    expect(screen.queryByText('Conteúdo pronto')).not.toBeInTheDocument()
  })

  it('exibe os slots carregando e vazio quando o estado corresponde', () => {
    const { rerender } = render(
      <ComEstado estado="carregando" carregando={<div>Esqueleto da tela</div>} vazio={<div>Sem itens</div>}>
        <div>Conteúdo pronto</div>
      </ComEstado>,
    )
    expect(screen.getByText('Esqueleto da tela')).toBeInTheDocument()
    expect(screen.queryByText('Conteúdo pronto')).not.toBeInTheDocument()

    rerender(
      <ComEstado estado="vazio" carregando={<div>Esqueleto da tela</div>} vazio={<div>Sem itens</div>}>
        <div>Conteúdo pronto</div>
      </ComEstado>,
    )
    expect(screen.getByText('Sem itens')).toBeInTheDocument()
    expect(screen.queryByText('Conteúdo pronto')).not.toBeInTheDocument()

    rerender(
      <ComEstado estado="pronto" carregando={<div>Esqueleto da tela</div>} vazio={<div>Sem itens</div>}>
        <div>Conteúdo pronto</div>
      </ComEstado>,
    )
    expect(screen.getByText('Conteúdo pronto')).toBeInTheDocument()
  })
})

describe('Shell', () => {
  beforeEach(() => {
    chamarMock.mockReset()
    mockIsTauri.mockReturnValue(false)
    mockListen.mockClear()
    mockEmit.mockClear()
    mockGetCurrentWindow.mockClear()
    window.location.hash = '#/inicio'
  })

  afterEach(() => {
    window.location.hash = ''
  })

  it('sem Projeto aberto oculta a navegação de etapas e mantém Paleta e Fila', async () => {
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return null
      if (cmd === 'projects.local_only.get') return { open: false, enabled: false }
      return null
    })

    render(envolver(<Shell><div>Corpo Início</div></Shell>))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('projects.current', {})
    })

    expect(screen.getByText('Clipes')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Etapas do Projeto' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Abrir comandos/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Fila de jobs: 0 ativos/i })).toBeInTheDocument()
    expect(screen.queryByText('Somente local')).not.toBeInTheDocument()
  })

  it('com Projeto aberto exibe o nome, as 3 etapas e marca a etapa da rota com aria-current="page"', async () => {
    window.location.hash = '#/projeto/canal-1/cortes'
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return { id: 'canal-1', name: 'Canal de Cortes', path: '/tmp/Canal.clipes' }
      if (cmd === 'projects.local_only.get') return { open: true, enabled: false }
      return null
    })

    render(envolver(<Shell><div>Corpo Cortes</div></Shell>))

    expect(await screen.findByText('Canal de Cortes')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Etapas do Projeto' })
    expect(nav).toBeInTheDocument()

    const linkFontes = screen.getByRole('link', { name: 'Fontes' })
    const linkCortes = screen.getByRole('link', { name: 'Cortes' })
    const linkExportacao = screen.getByRole('link', { name: 'Exportação' })

    expect(linkFontes).not.toHaveAttribute('aria-current', 'page')
    expect(linkCortes).toHaveAttribute('aria-current', 'page')
    expect(linkExportacao).not.toHaveAttribute('aria-current', 'page')
  })

  it('mostra o selo Somente local quando projects.local_only.get retorna enabled: true', async () => {
    window.location.hash = '#/projeto/canal-1/fontes'
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return { id: 'canal-1', name: 'Canal de Cortes' }
      if (cmd === 'projects.local_only.get') return { open: true, enabled: true }
      return null
    })

    render(envolver(<Shell><div>Corpo Fontes</div></Shell>))

    expect(await screen.findByText('Somente local')).toBeInTheDocument()
  })

  it('mostra "2" no gatilho da Fila quando há 2 jobs rodando', async () => {
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return null
      if (cmd === 'projects.local_only.get') return { open: false, enabled: false }
      return null
    })

    const fila = criarFila(() => null)
    fila.aplicar({ job: '1', stage: 'transcription', percentage: 30, message: 'Transcrevendo', error: null })
    fila.aplicar({ job: '2', stage: 'proxy', percentage: 60, message: 'Gerando prévia', error: null })
    fila.aplicar({ job: '3', stage: 'export', percentage: 100, message: 'Pronto', error: null })

    render(envolver(<Shell fila={fila}><div>Corpo</div></Shell>))

    const botaoFila = await screen.findByRole('button', { name: /Fila de jobs: 2 ativos/i })
    expect(botaoFila).toHaveTextContent('2')
  })

  it('usa modoMinimo na rota assistente ocultando etapas, Fila e Paleta', async () => {
    window.location.hash = '#/assistente?passo=1'
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return { id: 'canal-1', name: 'Canal de Cortes' }
      if (cmd === 'projects.local_only.get') return { open: true, enabled: true }
      return null
    })

    render(envolver(<Shell><div>Assistente</div></Shell>))

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('projects.current', {})
    })

    expect(screen.getByText('Clipes')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Etapas do Projeto' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Abrir comandos/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Fila de jobs/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configurações' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mais ações' })).not.toBeInTheDocument()
  })

  it('UI-01: menu do Projeto navega para Trocar (#/inicio), Configurações (#/config/projeto), troca outro recente e fecha via projects.close', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/projeto/canal-1/cortes'
    let projetoAtual: { id: string; name: string; path: string } | null = {
      id: 'canal-1',
      name: 'Canal de Cortes',
      path: '/tmp/Canal.clipes',
    }
    chamarMock.mockImplementation(async (cmd: string, args?: { path?: string }) => {
      if (cmd === 'projects.current') return projetoAtual
      if (cmd === 'projects.local_only.get') return { open: Boolean(projetoAtual), enabled: false }
      if (cmd === 'projects.recent') {
        return [
          { available: true, name: 'Canal de Cortes', path: '/tmp/Canal.clipes' },
          { available: true, name: 'Outro Canal', path: '/tmp/Outro.clipes' },
          { available: false, name: 'Ausente', path: '/tmp/Ausente.clipes' },
        ]
      }
      if (cmd === 'projects.open' && args?.path === '/tmp/Outro.clipes') {
        projetoAtual = { id: 'outro-canal', name: 'Outro Canal', path: '/tmp/Outro.clipes' }
        return projetoAtual
      }
      if (cmd === 'projects.close') {
        projetoAtual = null
        return null
      }
      return null
    })

    render(envolver(<Shell><div>Corpo Cortes</div></Shell>))

    const botaoProjeto = await screen.findByRole('button', { name: /Canal de Cortes/i })

    await user.click(botaoProjeto)
    await user.click(await screen.findByRole('menuitem', { name: 'Configurações do Projeto' }))
    expect(window.location.hash).toBe('#/config/projeto')

    await user.click(screen.getByRole('button', { name: /Canal de Cortes/i }))
    await user.click(await screen.findByRole('menuitem', { name: 'Trocar Projeto…' }))
    expect(window.location.hash).toBe('#/inicio')

    await user.click(screen.getByRole('button', { name: /Canal de Cortes/i }))
    expect(screen.queryByRole('menuitem', { name: 'Ausente' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('menuitem', { name: 'Outro Canal' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('projects.open', { path: '/tmp/Outro.clipes' })
      expect(window.location.hash).toBe('#/projeto/outro-canal/fontes')
    })

    await user.click(await screen.findByRole('button', { name: /Outro Canal/i }))
    await user.click(await screen.findByRole('menuitem', { name: 'Fechar Projeto' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('projects.close', {})
      expect(window.location.hash).toBe('#/inicio')
    })
  })

  it('UI-01: Fechar Projeto mostra erro humano com Abrir Fila de Jobs quando projects.close falha com project_busy', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/projeto/canal-1/cortes'
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return { id: 'canal-1', name: 'Canal de Cortes', path: '/tmp/Canal.clipes' }
      if (cmd === 'projects.local_only.get') return { open: true, enabled: false }
      if (cmd === 'projects.recent') return []
      if (cmd === 'projects.close') {
        throw new ErroCore('project_busy', 'job em andamento')
      }
      return null
    })

    render(envolver(<Shell><div>Corpo Cortes</div></Shell>))

    await user.click(await screen.findByRole('button', { name: /Canal de Cortes/i }))
    await user.click(await screen.findByRole('menuitem', { name: 'Fechar Projeto' }))

    expect(
      await screen.findByText('Há uma tarefa ativa bloqueando esta operação no Projeto.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir Fila de Jobs' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/projeto/canal-1/cortes')
  })

  it('UI-04: Barra Superior expõe Configurações, menu Mais (Relatos, Sobre, Atalhos) e Somente local clicável', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/projeto/canal-1/fontes'
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return { id: 'canal-1', name: 'Canal de Cortes', path: '/tmp/Canal.clipes' }
      if (cmd === 'projects.local_only.get') return { open: true, enabled: true }
      if (cmd === 'projects.recent') return []
      return null
    })

    render(envolver(<Shell><div>Corpo Fontes</div></Shell>))

    const botaoLocal = await screen.findByRole('button', { name: /Somente local/i })
    await user.click(botaoLocal)
    expect(window.location.hash).toBe('#/config/projeto')

    await user.click(screen.getByRole('button', { name: 'Configurações' }))
    expect(window.location.hash).toBe('#/config/provedores')

    await user.click(screen.getByRole('button', { name: 'Mais ações' }))
    await user.click(await screen.findByRole('menuitem', { name: /Relatos/i }))
    expect(window.location.hash).toBe('#/relatos')

    await user.click(screen.getByRole('button', { name: 'Mais ações' }))
    await user.click(await screen.findByRole('menuitem', { name: /Sobre/i }))
    expect(window.location.hash).toBe('#/sobre')

    await user.click(screen.getByRole('button', { name: 'Mais ações' }))
    await user.click(await screen.findByRole('menuitem', { name: /Ajuda de atalhos/i }))
    expect(await screen.findByRole('dialog', { name: /Atalhos de teclado/i })).toBeInTheDocument()
  })

  it('UI-04: F6/Shift+F6 ciclam entre Barra Superior, conteúdo e Barra de Status; Ctrl+J abre Fila e ? abre atalhos', async () => {
    const aoAbrirFila = vi.fn()
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return null
      if (cmd === 'projects.local_only.get') return { open: false, enabled: false }
      return null
    })

    render(
      envolver(
        <Shell aoAbrirFila={aoAbrirFila}>
          <button type="button">Ação do conteúdo</button>
        </Shell>,
      ),
    )

    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('projects.current', {})
    })

    const header = document.querySelector('header')!
    const main = document.querySelector('main')!
    const footer = document.querySelector('footer')!

    // F6: body -> barra superior -> conteúdo -> barra inferior -> barra superior
    fireEvent.keyDown(window, { key: 'F6' })
    expect(header.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(main.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ação do conteúdo' }))

    fireEvent.keyDown(window, { key: 'F6' })
    expect(footer.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(header.contains(document.activeElement)).toBe(true)

    // Shift+F6 volta para a barra inferior
    fireEvent.keyDown(window, { key: 'F6', shiftKey: true })
    expect(footer.contains(document.activeElement)).toBe(true)

    // Ctrl+J dispara a superfície da Fila existente
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    expect(aoAbrirFila).toHaveBeenCalledTimes(1)

    // ? abre ajuda rápida de atalhos
    fireEvent.keyDown(window, { key: '?', shiftKey: true })
    expect(await screen.findByRole('dialog', { name: /Atalhos de teclado/i })).toBeInTheDocument()
  })

  it('semPaddingConteudo remove overflow-auto e p-4 do <main> e aceita statusSalvamento na BarraStatus', async () => {
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return { id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }
      if (cmd === 'projects.local_only.get') return { open: true, enabled: false }
      if (cmd === 'projects.recent') return []
      return null
    })

    render(
      envolver(
        <Shell semPaddingConteudo statusSalvamento={<span>Alterações pendentes…</span>}>
          <div>Palco do Editor</div>
        </Shell>,
      ),
    )

    const main = document.querySelector('main')!
    expect(main).not.toHaveClass('overflow-auto')
    expect(main).not.toHaveClass('p-4')

    const footer = document.querySelector('footer')!
    expect(footer).toHaveTextContent('Alterações pendentes…')
  })

  it('editor_save_failed exibe role="alert" acionável na BarraStatus e dialog de recuperação sem duplicar app-close-requested', async () => {
    const user = userEvent.setup()
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return { id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }
      if (cmd === 'projects.local_only.get') return { open: true, enabled: false }
      if (cmd === 'projects.recent') return []
      if (cmd === 'editor.flush') return null
      return null
    })

    const fila = criarFila(() => 'demo')
    render(
      envolver(
        <Shell fila={fila} statusSalvamento={<span>Salvo</span>}>
          <div>Editor</div>
        </Shell>,
      ),
    )

    await screen.findByRole('button', { name: /Demo/i })

    fila.aplicar({
      job: 'editor',
      project: null,
      stage: 'editor_save_failed',
      percentage: 0,
      message: 'Não foi possível salvar o Corte.',
      error: { code: 'project_write', message: 'Sem espaço no disco' },
    })

    const footer = document.querySelector('footer')!
    const alertaFooter = await waitFor(() => {
      const el = footer.querySelector('[role="alert"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(alertaFooter).toHaveTextContent(/Falha ao salvar/i)
    const btnTentarRodape = within(alertaFooter).getByRole('button', { name: 'Tentar novamente' })
    expect(btnTentarRodape.className).toContain('min-h-6')

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/gravar as edições no disco/i)

    await user.click(screen.getByRole('button', { name: 'Tentar salvar novamente' }))
    await waitFor(() => {
      expect(chamarMock).toHaveBeenCalledWith('editor.flush', {})
    })
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(footer.querySelector('[role="alert"]')).toBeNull()
    })
  })

  it('Ctrl+J e GatilhoFila abrem PainelFilaJobs sem sair da rota, Esc devolve foco ao gatilho e F6 inclui a gaveta', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/projeto/demo/cortes'
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return { id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }
      if (cmd === 'projects.local_only.get') return { open: true, enabled: false }
      if (cmd === 'projects.recent') return []
      if (cmd === 'jobs.list') return []
      if (cmd === 'batches.list') return []
      if (cmd === 'export.batch.list') return []
      if (cmd === 'jobs.budget.get') return { budgets: [] }
      return null
    })

    render(
      envolver(
        <Shell>
          <button type="button">Botão da rota</button>
        </Shell>,
      ),
    )

    const gatilho = await screen.findByRole('button', { name: /Fila de jobs:/i })
    await user.click(gatilho)

    const aside = await screen.findByRole('complementary', { name: 'Fila de Jobs' })
    expect(aside).toBeInTheDocument()
    expect(window.location.hash).toBe('#/projeto/demo/cortes')

    // Esc fecha e devolve foco ao gatilho da Fila
    fireEvent.keyDown(aside, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: 'Fila de Jobs' })).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(gatilho).toHaveFocus()
    })

    // Ctrl+J abre novamente sem mudar a rota, e F6 inclui o aside no ciclo
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    const asideReaberto = await screen.findByRole('complementary', { name: 'Fila de Jobs' })
    expect(window.location.hash).toBe('#/projeto/demo/cortes')

    const header = document.querySelector('header')!
    const main = document.querySelector('main')!
    const footer = document.querySelector('footer')!

    const btnTopo = within(header).getByRole('button', { name: /Demo/i })
    btnTopo.focus()
    fireEvent.keyDown(window, { key: 'F6' })
    expect(main.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(asideReaberto.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(footer.contains(document.activeElement)).toBe(true)
  })

  it('mantem a falha de tarefa visivel no topo depois que o toast some (UI-81)', async () => {
    mockIsTauri.mockReturnValue(false)
    window.location.hash = '#/projeto/demo/cortes'
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return { id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }
      if (cmd === 'projects.local_only.get') return { open: true, enabled: false }
      if (cmd === 'projects.recent') return []
      if (cmd === 'jobs.list') {
        return [
          {
            id: 7, kind: 'ai:selection', safety: 'local', state: 'failed', attempts: 1,
            checkpoint: null, progress: 0, project: 'demo', outcome: 'failed', cost: null,
            batch: null, profile: null, budgetPause: null,
          },
        ]
      }
      if (cmd === 'batches.list' || cmd === 'export.batch.list') return []
      if (cmd === 'jobs.budget.get') return { budgets: [] }
      return null
    })
    const fila = criarFila(() => 'demo')
    render(envolver(<Shell fila={fila}><div>Conteúdo</div></Shell>))
    const header = document.querySelector('header')!
    expect(
      await within(header).findByRole('button', { name: /Tarefa falhou: abrir Fila de Jobs/i }),
    ).toBeInTheDocument()
  })

  it('exibe alertas prioritários de uncertain e ai_pauses no topo/BarraStatus e alimenta FechamentoJanela (#291) sem duplicar app-close-requested', async () => {
    const user = userEvent.setup()
    mockIsTauri.mockReturnValue(true)
    let closeHandler: ((ev: { event: string; id: number; payload: unknown }) => void) | undefined
    mockListen.mockImplementation(async (eventName, cb) => {
      if (eventName === 'app-close-requested') {
        closeHandler = cb as typeof closeHandler
      }
      return () => {}
    })

    window.location.hash = '#/projeto/demo/cortes'
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return { id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }
      if (cmd === 'projects.local_only.get') return { open: true, enabled: false }
      if (cmd === 'projects.recent') return []
      if (cmd === 'jobs.list') {
        return [
          {
            id: 2,
            kind: 'ai:selection',
            safety: 'paid',
            state: 'uncertain',
            attempts: 1,
            checkpoint: null,
            progress: 0,
            project: 'demo',
            outcome: 'uncertain',
            cost: 'unknown',
            batch: null,
            profile: 'legacy',
            budgetPause: null,
          },
          {
            id: 9,
            kind: 'export',
            safety: 'local',
            state: 'running',
            attempts: 1,
            checkpoint: null,
            progress: 40,
            project: 'demo',
            outcome: null,
            cost: null,
            batch: null,
            profile: null,
            budgetPause: null,
          },
        ]
      }
      if (cmd === 'batches.list') return []
      if (cmd === 'export.batch.list') return []
      if (cmd === 'jobs.budget.get') {
        return {
          budgets: [
            {
              scope: 'task',
              key: 'selection',
              maxCalls: 10,
              maxTokens: null,
              maxWallMs: null,
              maxCostMicroUsd: 1_000_000,
              unknownConfirmed: false,
              since: 1,
              usage: { calls: 10, inputTokens: 0, outputTokens: 0, microUsd: 1_050_000, unknownCostCalls: 0, planQuotaCalls: 0, durationMs: 0, costLabel: null },
              paused: 'budget_cost',
            },
          ],
        }
      }
      return null
    })

    const fila = criarFila(() => 'demo')
    render(envolver(<Shell fila={fila}><div>Conteúdo</div></Shell>))

    // Alerta prioritário no topo para uncertain e pausa de orçamento
    expect(await screen.findByText(/1 incerto/i)).toBeInTheDocument()
    expect(screen.getByText(/Orçamento pausado/i)).toBeInTheDocument()

    // BarraStatus exibe resumo clicável do job ativo e abre a gaveta ao clicar
    const footer = document.querySelector('footer')!
    const btnResumoStatus = await within(footer).findByRole('button', { name: /Exportação de Corte|40%/i })
    await user.click(btnResumoStatus)
    expect(await screen.findByRole('complementary', { name: 'Fila de Jobs' })).toBeInTheDocument()

    // Apenas um listener app-close-requested registrado (sem duplicação)
    const closeListeners = mockListen.mock.calls.filter((c) => c[0] === 'app-close-requested')
    expect(closeListeners).toHaveLength(1)

    // Ao disparar app-close-requested, FechamentoJanela enxerga a exportação hidratada de jobs.list
    closeHandler?.({ event: 'app-close-requested', id: 1, payload: null })
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/Fechar o Clipes com operações em andamento/i)
  })

  it('exibe targetLabel e tempo decorrido de startedAtMs na BarraStatus para job ativo de jobs.list (#484)', async () => {
    mockIsTauri.mockReturnValue(false)
    const agoraFixo = Date.now()
    window.location.hash = '#/projeto/demo/cortes'
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return { id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }
      if (cmd === 'projects.local_only.get') return { open: true, enabled: false }
      if (cmd === 'projects.recent') return []
      if (cmd === 'jobs.list') {
        return [
          {
            id: 9,
            kind: 'export',
            safety: 'local',
            state: 'running',
            attempts: 1,
            checkpoint: null,
            progress: 40,
            project: 'demo',
            outcome: null,
            cost: null,
            batch: null,
            profile: null,
            budgetPause: null,
            startedAtMs: agoraFixo - 42_000,
            targetLabel: 'Corte da final',
          },
        ]
      }
      if (cmd === 'batches.list' || cmd === 'export.batch.list') return []
      if (cmd === 'jobs.budget.get') return { budgets: [] }
      return null
    })

    const fila = criarFila(() => 'demo')
    render(envolver(<Shell fila={fila}><div>Conteúdo</div></Shell>))

    const footer = document.querySelector('footer')!
    expect(await within(footer).findByText(/Corte da final/)).toBeInTheDocument()
    expect(within(footer).getByText(/40%/)).toBeInTheDocument()
    expect(within(footer).getByText(/4[23] s/)).toBeInTheDocument()
  })

  it('UI-106: não empilha toasts de conclusão silenciosa de Timeline/Preview de fundo', async () => {
    mockIsTauri.mockReturnValue(false)
    window.location.hash = '#/projeto/demo/corte/102/editar'
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return { id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }
      if (cmd === 'projects.local_only.get') return { open: true, enabled: false }
      if (cmd === 'projects.recent') return []
      if (cmd === 'jobs.list' || cmd === 'batches.list' || cmd === 'export.batch.list') return []
      if (cmd === 'jobs.budget.get') return { budgets: [] }
      return null
    })

    const fila = criarFila(() => 'demo')
    render(envolver(<Shell fila={fila}><div>Conteúdo</div></Shell>))

    act(() => {
      fila.aplicar({ job: '7', project: 'demo', stage: 'proxy', percentage: 40, message: 'Preparando preview', error: null })
      fila.aplicar({ job: '7', project: 'demo', stage: 'complete', percentage: 100, message: 'Preview concluído.', error: null })
      fila.aplicar({ job: '8', project: 'demo', stage: 'timeline', percentage: 40, message: 'Gerando miniaturas e onda', error: null })
      fila.aplicar({ job: '8', project: 'demo', stage: 'complete', percentage: 100, message: 'Timeline pronta', error: null })
    })

    await waitFor(() => {
      expect(screen.queryByText(/Preview concluído\./i)).not.toBeInTheDocument()
      expect(screen.queryByText(/Timeline pronta/i)).not.toBeInTheDocument()
    })
  })

  it('UI-81: Shell desloca --toast-right para a esquerda da Fila quando a gaveta está aberta e limpa ao fechar', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/projeto/demo/exportacao'
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return { id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }
      if (cmd === 'projects.local_only.get') return { open: true, enabled: false }
      if (cmd === 'projects.recent') return []
      if (cmd === 'jobs.list' || cmd === 'batches.list' || cmd === 'export.batch.list') return []
      if (cmd === 'jobs.budget.get') return { budgets: [] }
      return null
    })

    render(
      envolver(
        <Shell>
          <div>Conteúdo</div>
        </Shell>,
      ),
    )

    const gatilho = await screen.findByRole('button', { name: /Fila de jobs:/i })
    expect(document.documentElement.style.getPropertyValue('--toast-right')).toBe('')

    await user.click(gatilho)
    await screen.findByRole('complementary', { name: 'Fila de Jobs' })
    expect(document.documentElement.style.getPropertyValue('--toast-right')).toMatch(/486px|576px/)

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: 'Fila de Jobs' })).not.toBeInTheDocument()
    })
    expect(document.documentElement.style.getPropertyValue('--toast-right')).toBe('')
  })

  it('dock do Console ao vivo começa recolhido, abre por BarraStatus e Paleta, entra no ciclo F6 e Esc devolve o foco', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/inicio'
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return null
      if (cmd === 'projects.local_only.get') return { open: false, enabled: false }
      return null
    })

    consolePadrao.limpar()
    consolePadrao.aplicar({
      seq: 1,
      timestampMs: Date.now(),
      job: 'ffmpeg',
      project: null,
      origin: 'ffmpeg',
      level: 'info',
      simple: 'Exportando Corte…',
      technical: 'ffmpeg: frame=120',
    })

    render(
      envolver(
        <Shell>
          <button type="button">Ação principal</button>
        </Shell>,
      ),
    )

    const footer = document.querySelector('footer')!
    const gatilhoConsole = await within(footer).findByRole('button', { name: /Console/i })
    expect(gatilhoConsole).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('[data-regiao="console"]')).toBeNull()

    // Abre pelo botão discreto na BarraStatus
    await user.click(gatilhoConsole)
    const dock = document.querySelector<HTMLElement>('[data-regiao="console"]')!
    expect(dock).toBeInTheDocument()
    expect(gatilhoConsole).toHaveAttribute('aria-expanded', 'true')
    const log = within(dock).getByRole('log')
    expect(log).toBeInTheDocument()
    expect(within(log).getByText('Exportando Corte…')).toBeInTheDocument()

    // Ciclo F6 inclui [data-regiao="console"] antes do rodapé
    const header = document.querySelector('header')!
    const main = document.querySelector('main')!
    within(header).getByRole('button', { name: /Abrir comandos/i }).focus()

    fireEvent.keyDown(window, { key: 'F6' })
    expect(main.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(dock.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(footer.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'F6', shiftKey: true })
    expect(dock.contains(document.activeElement)).toBe(true)

    // Esc dentro do dock fecha e devolve o foco ao gatilho na BarraStatus
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(document.querySelector('[data-regiao="console"]')).toBeNull()
    })
    expect(gatilhoConsole).toHaveFocus()
    expect(gatilhoConsole).toHaveAttribute('aria-expanded', 'false')

    // Paleta Ctrl+K: comando "Alternar console ao vivo" abre e fecha o dock
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const paleta = await screen.findByRole('dialog', { name: 'Paleta de comandos' })
    await user.click(within(paleta).getByText('Alternar console ao vivo'))
    await waitFor(() => {
      expect(document.querySelector('[data-regiao="console"]')).not.toBeNull()
    })

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const paleta2 = await screen.findByRole('dialog', { name: 'Paleta de comandos' })
    await user.click(within(paleta2).getByText('Alternar console ao vivo'))
    await waitFor(() => {
      expect(document.querySelector('[data-regiao="console"]')).toBeNull()
    })

    consolePadrao.limpar()
  })

  it('"Ver console" na PainelFilaJobs abre o dock filtrado pelo job sem fechar a Fila, e Esc no dock devolve foco sem fechar a Fila', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/projeto/demo/cortes'
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return { id: 'demo', name: 'Demo', path: '/projetos/Demo.clipes' }
      if (cmd === 'projects.local_only.get') return { open: true, enabled: false }
      if (cmd === 'projects.recent') return []
      if (cmd === 'jobs.list') {
        return [
          {
            id: 10,
            kind: 'transcription',
            safety: 'local',
            state: 'running',
            attempts: 1,
            checkpoint: null,
            progress: 40,
            project: 'demo',
            outcome: null,
            cost: null,
            batch: null,
            profile: null,
            budgetPause: null,
            targetLabel: 'aula.mp4',
          },
        ]
      }
      if (cmd === 'batches.list' || cmd === 'export.batch.list') return []
      if (cmd === 'jobs.budget.get') return { budgets: [] }
      return null
    })

    consolePadrao.limpar()
    consolePadrao.aplicarLote([
      {
        seq: 101,
        timestampMs: Date.now(),
        job: '10',
        project: null,
        origin: 'worker',
        level: 'info',
        simple: 'Transcrevendo bloco 1…',
        technical: 'worker: block=1',
      },
      {
        seq: 102,
        timestampMs: Date.now(),
        job: '99',
        project: null,
        origin: 'ffmpeg',
        level: 'info',
        simple: 'Outro job rodando',
        technical: 'ffmpeg: other',
      },
    ])

    render(
      envolver(
        <Shell>
          <div>Conteúdo</div>
        </Shell>,
      ),
    )

    const gatilhoFila = await screen.findByRole('button', { name: /Fila de jobs:/i })
    await user.click(gatilhoFila)

    const aside = await screen.findByRole('complementary', { name: 'Fila de Jobs' })
    const card10 = await within(aside).findByTestId('fila-job-10')
    const btnVerConsole = within(card10).getByRole('button', { name: 'Ver console' })
    await user.click(btnVerConsole)

    const dock = document.querySelector<HTMLElement>('[data-regiao="console"]')!
    expect(dock).toBeInTheDocument()
    expect(aside).toBeInTheDocument()
    const log = within(dock).getByRole('log')
    expect(within(log).getByText('Transcrevendo bloco 1…')).toBeInTheDocument()
    expect(within(log).queryByText('Outro job rodando')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(dock.contains(document.activeElement)).toBe(true)
    })

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(document.querySelector('[data-regiao="console"]')).toBeNull()
    })
    // A Fila continua aberta e o foco voltou para o botão "Ver console"
    expect(screen.getByRole('complementary', { name: 'Fila de Jobs' })).toBeInTheDocument()
    expect(btnVerConsole).toHaveFocus()

    consolePadrao.limpar()
  })

  it('nunca exibe dock duplicado quando um console inline está montado e aciona foco no inline', async () => {
    const user = userEvent.setup()
    window.location.hash = '#/config/componentes'
    chamarMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'projects.current') return null
      if (cmd === 'projects.local_only.get') return { open: false, enabled: false }
      return null
    })

    render(
      envolver(
        <Shell>
          <div>Tela Componentes</div>
        </Shell>,
      ),
    )

    const footer = document.querySelector('footer')!
    const gatilhoConsole = await within(footer).findByRole('button', { name: /Console/i })

    // Abre o dock antes do registro inline
    await user.click(gatilhoConsole)
    expect(document.querySelector('[data-regiao="console"]')).not.toBeNull()

    // Registra console inline (como Ticket 3 fará em ConfigComponentes)
    const aoFocar = vi.fn()
    let limparInline!: () => void
    act(() => {
      limparInline = registrarConsoleInline({ aoFocar })
    })

    // Dock desaparece imediatamente para não duplicar
    expect(document.querySelector('[data-regiao="console"]')).toBeNull()

    // Clicar no gatilho da BarraStatus redireciona para o inline em vez de abrir o dock
    await user.click(gatilhoConsole)
    expect(aoFocar).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-regiao="console"]')).toBeNull()

    act(() => {
      limparInline()
    })
  })
})
