import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  criarRegistro,
  detectarConflitoAtalho,
  formatarEventoTeclado,
  MAPA_ATALHOS_OFICIAL,
  ProvedorAtalhos,
  resolverTeclaExibida,
  substituirAtalho,
  useAtalhos,
  type Atalho,
} from '~/comandos/atalhos'

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

function eventoTecla(
  key: string,
  init: KeyboardEventInit & { target?: EventTarget } = {},
): KeyboardEvent {
  const { target, ...rest } = init
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...rest })
  if (target) {
    Object.defineProperty(ev, 'target', { value: target, configurable: true })
  }
  return ev
}

describe('criarRegistro', () => {
  it('dispara tecla única A quando teclasUnicas é true e bloqueia quando é false (WCAG 2.1.4)', () => {
    const reg = criarRegistro()
    const executar = vi.fn()
    reg.registrar([{ id: 'aprovar', titulo: 'Aprovar', grupo: 'Revisão', tecla: 'A', teclaUnica: true, executar }])

    const ev1 = eventoTecla('a')
    expect(reg.tratar(ev1, { teclasUnicas: true })).toBe(true)
    expect(ev1.defaultPrevented).toBe(true)
    expect(executar).toHaveBeenCalledTimes(1)

    const ev2 = eventoTecla('a')
    expect(reg.tratar(ev2, { teclasUnicas: false })).toBe(false)
    expect(ev2.defaultPrevented).toBe(false)
    expect(executar).toHaveBeenCalledTimes(1)
  })

  it('bloqueia tecla única sem teclaUnica explícito quando teclasUnicas é false', () => {
    const reg = criarRegistro()
    const executar = vi.fn()
    reg.registrar([{ id: 'rejeitar', titulo: 'Rejeitar', grupo: 'Revisão', tecla: 'R', executar }])

    expect(reg.tratar(eventoTecla('r'), { teclasUnicas: false })).toBe(false)
    expect(executar).not.toHaveBeenCalled()

    expect(reg.tratar(eventoTecla('r'), { teclasUnicas: true })).toBe(true)
    expect(executar).toHaveBeenCalledTimes(1)
  })

  it('não dispara tecla única em input, textarea ou [contenteditable], mas dispara Mod+tecla', () => {
    const reg = criarRegistro()
    const acaoSimples = vi.fn()
    const acaoMod = vi.fn()
    reg.registrar([
      { id: 'aprovar', titulo: 'Aprovar', grupo: 'Revisão', tecla: 'A', executar: acaoSimples },
      { id: 'salvar', titulo: 'Salvar', grupo: 'Editor', tecla: 'Mod+S', executar: acaoMod },
    ])

    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')

    for (const campo of [input, textarea, editable]) {
      expect(reg.tratar(eventoTecla('a', { target: campo }), { teclasUnicas: true })).toBe(false)
      expect(reg.tratar(eventoTecla('s', { ctrlKey: true, target: campo }), { teclasUnicas: false })).toBe(true)
    }

    expect(acaoSimples).not.toHaveBeenCalled()
    expect(acaoMod).toHaveBeenCalledTimes(3)
  })

  it('suporta Mod+K (Ctrl ou Cmd) e Alt+PageDown mesmo com teclasUnicas: false', () => {
    const reg = criarRegistro()
    const paleta = vi.fn()
    const proximo = vi.fn()
    reg.registrar([
      { id: 'paleta', titulo: 'Abrir paleta', grupo: 'App', tecla: 'Mod+K', executar: paleta },
      { id: 'proximo', titulo: 'Próximo Corte', grupo: 'Corte', tecla: 'Alt+PageDown', executar: proximo },
    ])

    expect(reg.tratar(eventoTecla('k', { ctrlKey: true }), { teclasUnicas: false })).toBe(true)
    expect(reg.tratar(eventoTecla('k', { metaKey: true }), { teclasUnicas: false })).toBe(true)
    expect(reg.tratar(eventoTecla('PageDown', { altKey: true }), { teclasUnicas: false })).toBe(true)

    expect(paleta).toHaveBeenCalledTimes(2)
    expect(proximo).toHaveBeenCalledTimes(1)
  })

  it('em conflito, o atalho registrado por último vence e restaurar ao remover', () => {
    const reg = criarRegistro()
    const doShell = vi.fn()
    const daTela = vi.fn()

    reg.registrar([{ id: 'shell.a', titulo: 'Shell A', grupo: 'Shell', tecla: 'A', executar: doShell }])
    const removerTela = reg.registrar([
      { id: 'tela.a', titulo: 'Tela A', grupo: 'Tela', tecla: 'A', executar: daTela },
    ])

    expect(reg.tratar(eventoTecla('a'), { teclasUnicas: true })).toBe(true)
    expect(daTela).toHaveBeenCalledTimes(1)
    expect(doShell).not.toHaveBeenCalled()

    removerTela()
    expect(reg.tratar(eventoTecla('a'), { teclasUnicas: true })).toBe(true)
    expect(doShell).toHaveBeenCalledTimes(1)
  })
})

describe('ProvedorAtalhos e useAtalhos', () => {
  afterEach(() => {
    localStorage.clear()
  })

  function ComAtalhos({ atalhos }: { atalhos: Atalho[] }) {
    useAtalhos(atalhos)
    return null
  }

  it('Ctrl+K abre a Paleta e Esc fecha; enquanto aberta, outros atalhos não disparam', () => {
    const aoAprovar = vi.fn()

    render(
      <ProvedorAtalhos>
        <ComAtalhos
          atalhos={[{ id: 'aprovar', titulo: 'Aprovar Corte', grupo: 'Revisão', tecla: 'A', executar: aoAprovar }]}
        />
      </ProvedorAtalhos>,
    )

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: 'Paleta de comandos' })).toBeInTheDocument()
    expect(screen.getByText('Aprovar Corte')).toBeInTheDocument()

    // Com a Paleta aberta, tecla única 'a' não pode disparar o atalho da tela
    fireEvent.keyDown(window, { key: 'a' })
    expect(aoAprovar).not.toHaveBeenCalled()

    // Ctrl+K novamente fecha a Paleta
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.queryByRole('dialog', { name: 'Paleta de comandos' })).not.toBeInTheDocument()
  })

  it('desmontar o componente remove seus atalhos', () => {
    const aoExecutar = vi.fn()
    const { rerender } = render(
      <ProvedorAtalhos>
        <ComAtalhos
          atalhos={[{ id: 'acao', titulo: 'Ação temporária', grupo: 'Teste', tecla: 'A', executar: aoExecutar }]}
        />
      </ProvedorAtalhos>,
    )

    fireEvent.keyDown(window, { key: 'a' })
    expect(aoExecutar).toHaveBeenCalledTimes(1)

    rerender(<ProvedorAtalhos>{null}</ProvedorAtalhos>)
    fireEvent.keyDown(window, { key: 'a' })
    expect(aoExecutar).toHaveBeenCalledTimes(1)
  })

  it('último componente montado vence em conflito e respeita teclasUnicas das preferências', () => {
    const acaoShell = vi.fn()
    const acaoTela = vi.fn()

    const { rerender } = render(
      <ProvedorAtalhos>
        <ComAtalhos
          atalhos={[{ id: 'shell.a', titulo: 'Shell', grupo: 'Shell', tecla: 'A', executar: acaoShell }]}
        />
        <ComAtalhos
          atalhos={[{ id: 'tela.a', titulo: 'Tela', grupo: 'Tela', tecla: 'A', executar: acaoTela }]}
        />
      </ProvedorAtalhos>,
    )

    fireEvent.keyDown(window, { key: 'a' })
    expect(acaoTela).toHaveBeenCalledTimes(1)
    expect(acaoShell).not.toHaveBeenCalled()

    // Desliga teclasUnicas nas preferências
    act(() => {
      localStorage.setItem('clipes.preferencias.v1', JSON.stringify({ teclasUnicas: false }))
    })
    rerender(
      <ProvedorAtalhos>
        <ComAtalhos
          atalhos={[{ id: 'shell.a', titulo: 'Shell', grupo: 'Shell', tecla: 'A', executar: acaoShell }]}
        />
        <ComAtalhos
          atalhos={[{ id: 'tela.a', titulo: 'Tela', grupo: 'Tela', tecla: 'A', executar: acaoTela }]}
        />
      </ProvedorAtalhos>,
    )

    fireEvent.keyDown(window, { key: 'a' })
    expect(acaoTela).toHaveBeenCalledTimes(1)
  })

  it('executa comando selecionado na Paleta e fecha com Esc; respeita campo de texto para tecla única', async () => {
    const user = userEvent.setup()
    const aoAprovar = vi.fn()
    const aoSalvar = vi.fn()

    render(
      <ProvedorAtalhos>
        <ComAtalhos
          atalhos={[
            { id: 'aprovar', titulo: 'Aprovar Corte', grupo: 'Revisão', tecla: 'A', executar: aoAprovar },
            { id: 'salvar', titulo: 'Salvar Edição', grupo: 'Editor', tecla: 'Mod+S', executar: aoSalvar },
          ]}
        />
        <input aria-label="Busca" />
      </ProvedorAtalhos>,
    )

    const campo = screen.getByLabelText('Busca')
    campo.focus()
    fireEvent.keyDown(campo, { key: 'a' })
    expect(aoAprovar).not.toHaveBeenCalled()

    fireEvent.keyDown(campo, { key: 's', ctrlKey: true })
    expect(aoSalvar).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: 'Paleta de comandos' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Paleta de comandos' })).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await user.click(screen.getByText('Aprovar Corte'))
    expect(aoAprovar).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'Paleta de comandos' })).not.toBeInTheDocument()
  })

  it('modoTeclasUnicas "alt" exige Alt+tecla, atualiza <Kbd> na Paleta para Alt+A e "desligadas" mantém Ctrl+K', () => {
    const aoAprovar = vi.fn()
    localStorage.setItem(
      'clipes.preferencias.v1',
      JSON.stringify({ modoTeclasUnicas: 'alt', teclasUnicas: true }),
    )

    render(
      <ProvedorAtalhos>
        <ComAtalhos
          atalhos={[{ id: 'aprovar', titulo: 'Aprovar Corte', grupo: 'Revisão', tecla: 'A', executar: aoAprovar }]}
        />
      </ProvedorAtalhos>,
    )

    fireEvent.keyDown(window, { key: 'a' })
    expect(aoAprovar).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'a', altKey: true })
    expect(aoAprovar).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: 'Paleta de comandos' })).toBeInTheDocument()
    expect(screen.getByText('Alt+A')).toBeInTheDocument()
  })

  it('tratar respeita modoTeclasUnicas alt/desligadas e remapeamento com conflito por escopo', () => {
    const reg = criarRegistro()
    const aprovar = vi.fn()
    const paleta = vi.fn()
    reg.registrar([
      { id: 'revisao.aprovar', titulo: 'Aprovar', grupo: 'Revisão', tecla: 'A', executar: aprovar },
      { id: 'paleta.abrir', titulo: 'Paleta', grupo: 'Global', tecla: 'Mod+K', executar: paleta },
    ])

    expect(reg.tratar(eventoTecla('a'), { modoTeclasUnicas: 'alt' })).toBe(false)
    expect(reg.tratar(eventoTecla('a', { altKey: true }), { modoTeclasUnicas: 'alt' })).toBe(true)
    expect(aprovar).toHaveBeenCalledTimes(1)

    expect(reg.tratar(eventoTecla('a', { altKey: true }), { modoTeclasUnicas: 'desligadas' })).toBe(false)
    expect(reg.tratar(eventoTecla('k', { ctrlKey: true }), { modoTeclasUnicas: 'desligadas' })).toBe(true)
    expect(paleta).toHaveBeenCalledTimes(1)

    expect(resolverTeclaExibida('A', 'alt')).toBe('Alt+A')
    expect(resolverTeclaExibida('A', 'desligadas')).toBeUndefined()
    expect(resolverTeclaExibida('Mod+K', 'desligadas')).toBe('Mod+K')

    expect(formatarEventoTeclado(eventoTecla('Shift'))).toBeNull()
    expect(formatarEventoTeclado(eventoTecla('r', { altKey: true }))).toBe('Alt+R')

    const conflito = detectarConflitoAtalho('revisao.aprovar', 'R', MAPA_ATALHOS_OFICIAL, {})
    expect(conflito?.id).toBe('revisao.rejeitar')

    // Mesmo atalho em escopos separados (I em Revisão vs Editor) não gera conflito
    const semConflito = detectarConflitoAtalho('revisao.bordaInicio', 'I', MAPA_ATALHOS_OFICIAL, {})
    expect(semConflito).toBeNull()

    const remapeados = substituirAtalho({}, 'revisao.aprovar', 'R', 'revisao.rejeitar')
    expect(remapeados['revisao.aprovar']).toBe('R')
    expect(remapeados['revisao.rejeitar']).toBe('')
  })
})
