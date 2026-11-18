import { render, screen, waitFor } from '@testing-library/react'
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
  })
})
