import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProvedorDicas, ProvedorToast } from '@ds'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { ErroCore } from '~/core/cliente'
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
})
