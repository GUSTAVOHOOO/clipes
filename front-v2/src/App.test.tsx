import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { coreDispatch, emitirProgressoMock } from '@core'
import { BannerErroCore, Botao, caixaCampo, Entrada, EstadoTela, Segmentado, Select } from '@ds'
import { App } from '~/App'

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

describe('App', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
  })

  it('renderiza o título Clipes', () => {
    render(<App />)
    expect(screen.getByText('Clipes')).toBeInTheDocument()
  })

  it('resolve @core e o @/ interno do v1 no modo mock', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    const encoder = await coreDispatch<{ effective: string }>('export.encoder.status', {})
    expect(encoder.effective).toBe('libx264')
  })

  it('renderiza a tela Início e respeita ?estado=erro', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    window.location.hash = '#/inicio'
    const { rerender } = render(<App />)

    expect(await screen.findByRole('heading', { name: 'Projetos' })).toBeInTheDocument()

    window.location.hash = '#/inicio?estado=erro'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    rerender(<App />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('renderiza placeholder de Relatos e redireciona rota de Projeto sem Projeto aberto', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    window.location.hash = '#/relatos'
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Relatos e diagnóstico' })).toBeInTheDocument()

    window.location.hash = '#/projeto/x/cortes'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    await waitFor(() => {
      expect(window.location.hash).toBe('#/inicio')
    })
  })

  it('renderiza placeholder de Exportação com único h1 quando há Projeto aberto', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    window.history.replaceState(null, '', '/?source-test=1#/projeto/test-project/exportacao')
    render(<App />)

    const h1 = await screen.findByRole('heading', { level: 1, name: 'Exportação' })
    expect(h1).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('propaga eventos core-progress do Projeto ativo para BarraStatus via fila padrão única', async () => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    window.history.replaceState(null, '', '/?source-test=1#/projeto/test-project/exportacao')
    render(<App />)

    await screen.findByRole('heading', { level: 1, name: 'Exportação' })

    act(() => {
      emitirProgressoMock({
        job: '91',
        project: 'test-project',
        stage: 'selection:window',
        percentage: 55,
        message: 'Janela 2 de 4',
        error: null,
      })
    })

    expect(await screen.findByText('Janela 2 de 4')).toBeInTheDocument()
    expect(screen.getByText('55%')).toBeInTheDocument()
  })
})

describe('A11y AA — primitivas @ds (UI-07, UI-08, UI-09, UI-10)', () => {
  it('UI-07: caixaCampo, Entrada e Select usam contorno token e superfície contrastante em bg-elevado', () => {
    expect(caixaCampo).toContain('--contorno-campo')
    expect(caixaCampo).toContain('in-[.bg-elevado]:bg-chao')

    render(
      <div className="bg-elevado">
        <Entrada aria-label="Campo teste" />
        <Select
          rotulo="Select teste"
          valor="a"
          aoMudar={() => {}}
          opcoes={[{ valor: 'a', rotulo: 'Opção A' }]}
        />
      </div>,
    )

    const entrada = screen.getByRole('textbox', { name: 'Campo teste' })
    expect(entrada.className).toContain('--contorno-campo')
    expect(entrada.className).toContain('in-[.bg-elevado]:bg-chao')

    const select = screen.getByRole('combobox', { name: 'Select teste' })
    expect(select.className).toContain('--contorno-campo')
    expect(select.className).toContain('in-[.bg-elevado]:bg-chao')
  })

  it('UI-08: BannerErroCore aplica altura mínima de 24 px (min-h-6) no summary e no link de relato', () => {
    render(
      <BannerErroCore
        erro={{ code: 'network', message: 'timeout' }}
        permitirRelato
      />,
    )

    const summary = screen.getByText('Ver detalhe técnico').closest('summary')
    expect(summary).not.toBeNull()
    expect(summary!.className).toContain('min-h-6')

    const link = screen.getByRole('link', { name: /Mandar relato/i })
    expect(link.className).toContain('min-h-6')
  })

  it('UI-09: Botao secundário/suave e Segmentado recebem contorno via token --contorno-controle', () => {
    render(
      <div>
        <Botao variante="secundario">Secundário</Botao>
        <Botao variante="suave">Suave</Botao>
        <Segmentado
          rotulo="Tema"
          valor="escuro"
          aoMudar={() => {}}
          opcoes={[
            { valor: 'escuro', rotulo: 'Escuro' },
            { valor: 'claro', rotulo: 'Claro' },
          ]}
        />
      </div>,
    )

    expect(screen.getByRole('button', { name: 'Secundário' }).className).toContain('--contorno-controle')
    expect(screen.getByRole('button', { name: 'Suave' }).className).toContain('--contorno-controle')

    const grupo = screen.getByRole('radiogroup', { name: 'Tema' })
    expect(grupo.className).toContain('--contorno-controle')
    const radioAtivo = screen.getByRole('radio', { name: 'Escuro' })
    expect(radioAtivo.className).toContain('--contorno-controle')
  })

  it('UI-10: EstadoTela mantém h2 por padrão e aceita nivelTitulo="h1"', () => {
    const { rerender } = render(
      <EstadoTela tipo="vazio" titulo="Sem itens" descricao="Descrição" />,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Sem itens' })).toBeInTheDocument()

    rerender(
      <EstadoTela tipo="vazio" titulo="Sem itens" descricao="Descrição" nivelTitulo="h1" />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Sem itens' })).toBeInTheDocument()
  })
})
