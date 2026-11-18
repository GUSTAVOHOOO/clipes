import { ProvedorDicas, ProvedorToast } from '@ds'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ProvedorAtalhos } from '~/comandos/atalhos'
import { CHAVE_PREFERENCIAS } from '~/preferencias/preferencias'
import { ConfigAparencia } from '~/telas/config/ConfigAparencia'

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

function renderTela(projetoAberto: string | null = null) {
  return render(
    <ProvedorDicas>
      <ProvedorToast>
        <ProvedorAtalhos>
          <ConfigAparencia projetoAberto={projetoAberto} />
        </ProvedorAtalhos>
      </ProvedorToast>
    </ProvedorDicas>,
  )
}

describe('ConfigAparencia (#/config/aparencia)', () => {
  afterEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
    document.documentElement.removeAttribute('data-tema')
    document.documentElement.removeAttribute('data-contrast')
    document.documentElement.removeAttribute('data-escala')
    document.documentElement.lang = ''
    vi.unstubAllGlobals()
  })

  it('renderiza loading com ?estado=carregando e estado ready síncrono com as 3 seções', () => {
    window.location.hash = '#/config/aparencia?estado=carregando'
    const { unmount } = renderTela()
    expect(screen.getByRole('status', { name: /carregando/i })).toBeInTheDocument()
    expect(screen.queryByText('1. Visual e Idioma')).not.toBeInTheDocument()
    unmount()

    window.location.hash = '#/config/aparencia'
    renderTela()
    expect(screen.getByRole('heading', { name: 'Aparência e Teclado' })).toBeInTheDocument()
    expect(screen.getByText('1. Visual e Idioma')).toBeInTheDocument()
    expect(screen.getByText('2. Acessibilidade de Teclado (WCAG 2.1.4)')).toBeInTheDocument()
    expect(screen.getByText('3. Mapa de Atalhos')).toBeInTheDocument()
  })

  it('aplica data-tema, data-contrast="high" e data-escala="115" imediatamente ao alterar controles', async () => {
    const user = userEvent.setup()
    renderTela()

    const grupoTema = screen.getByRole('radiogroup', { name: 'Tema' })
    await user.click(within(grupoTema).getByRole('radio', { name: 'Claro' }))
    expect(document.documentElement.getAttribute('data-tema')).toBe('claro')

    const swContraste = screen.getByRole('switch', { name: /Modo Alto Contraste/i })
    await user.click(swContraste)
    expect(document.documentElement.getAttribute('data-contrast')).toBe('high')

    const grupoEscala = screen.getByRole('radiogroup', { name: 'Escala da interface' })
    await user.click(within(grupoEscala).getByRole('radio', { name: /115%/ }))
    expect(document.documentElement.getAttribute('data-escala')).toBe('115')

    const swPaineis = screen.getByRole('switch', {
      name: /Abrir gavetas e painéis só por clique ou atalho/i,
    })
    await user.click(swPaineis)
    const salvo = JSON.parse(localStorage.getItem(CHAVE_PREFERENCIAS) ?? '{}')
    expect(salvo.paineisSoPorClique).toBe(false)
  })

  it('alterna modo WCAG 2.1.4 (ativas, alt e desligadas) atualizando <Kbd> da tabela', async () => {
    const user = userEvent.setup()
    renderTela()

    const grupoWcag = screen.getByRole('radiogroup', { name: 'Modo de teclas únicas' })
    await user.click(within(grupoWcag).getByRole('radio', { name: /Exigir modificador Alt/i }))

    expect(screen.getByText('Alt+A')).toBeInTheDocument()

    await user.click(within(grupoWcag).getByRole('radio', { name: /Desligar todos os atalhos/i }))
    expect(screen.queryByText('Alt+A')).not.toBeInTheDocument()
    expect(screen.getAllByText('Desligado (WCAG 2.1.4)').length).toBeGreaterThan(0)
    expect(screen.getByText('Ctrl+K')).toBeInTheDocument()
  })

  it('busca no mapa de atalhos entra em empty e Limpar busca restaura a lista', async () => {
    const user = userEvent.setup()
    renderTela()

    const busca = screen.getByRole('searchbox', { name: 'Buscar atalho' })
    await user.type(busca, 'xyz-inexistente')

    expect(screen.getByText("Nenhum atalho corresponde a 'xyz-inexistente'.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Limpar busca' }))
    expect(screen.getByText('Abrir paleta de comandos')).toBeInTheDocument()
  })

  it('captura nova tecla, detecta conflito com role="alert", substitui e restaura padrão individual', async () => {
    const user = userEvent.setup()
    renderTela()

    await user.click(screen.getByRole('button', { name: 'Remapear Aprovar candidato' }))
    expect(
      screen.getByText(/Gravando atalho para Aprovar candidato\. Pressione a nova tecla ou Esc para cancelar\./),
    ).toBeInTheDocument()

    // Esc cancela captura
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(
      screen.queryByText(/Gravando atalho para Aprovar candidato/),
    ).not.toBeInTheDocument()

    // Captura tecla em conflito (R pertence a Rejeitar candidato no mesmo escopo)
    await user.click(screen.getByRole('button', { name: 'Remapear Aprovar candidato' }))
    fireEvent.keyDown(window, { key: 'r' })

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/Conflito/)
    expect(alerta).toHaveTextContent(/Rejeitar candidato/)

    await user.click(within(alerta).getByRole('button', { name: 'Substituir' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    const btnRestaurarItem = screen.getByRole('button', {
      name: 'Restaurar padrão de Aprovar candidato',
    })
    expect(btnRestaurarItem).toBeInTheDocument()

    await user.click(btnRestaurarItem)
    expect(
      screen.queryByRole('button', { name: 'Restaurar padrão de Aprovar candidato' }),
    ).not.toBeInTheDocument()
  })

  it('Restaurar padrões abre ConfirmDialog com foco inicial em Cancelar e restaura tudo ao confirmar', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      CHAVE_PREFERENCIAS,
      JSON.stringify({ modoTeclasUnicas: 'alt', atalhos: { 'revisao.aprovar': 'G' } }),
    )
    renderTela()

    await user.click(screen.getByRole('button', { name: 'Restaurar padrões' }))

    const dialogo = await screen.findByRole('alertdialog')
    await waitFor(() => {
      expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })

    await user.click(within(dialogo).getByRole('button', { name: 'Restaurar padrões' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    const salvo = JSON.parse(localStorage.getItem(CHAVE_PREFERENCIAS) ?? '{}')
    expect(salvo.modoTeclasUnicas).toBe('ativas')
    expect(salvo.atalhos).toEqual({})
  })

  it('UI-13: mantém English desabilitado com "Em preparação" e não altera document.documentElement.lang', async () => {
    const user = userEvent.setup()
    renderTela()

    expect(document.documentElement.lang).toBe('pt-BR')

    const comboIdioma = screen.getByRole('combobox', { name: 'Idioma' })
    await user.click(comboIdioma)

    const opcaoEn = await screen.findByRole('option', { name: /English/i })
    expect(opcaoEn).toHaveAttribute('aria-disabled', 'true')
    expect(within(opcaoEn).getByText('Em preparação')).toBeInTheDocument()

    await user.click(opcaoEn)
    expect(document.documentElement.lang).toBe('pt-BR')
  })
})
