import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aplicarPreferencias, resolverTemaEfetivo } from '~/preferencias/aplicarPreferencias'
import { criarPreferencias, PADRAO, usePreferencias } from '~/preferencias/preferencias'

function memoriaStorage(inicial: Record<string, string> = {}) {
  const dados = new Map<string, string>(Object.entries(inicial))
  return {
    dados,
    getItem(chave: string) {
      return dados.get(chave) ?? null
    },
    setItem(chave: string, valor: string) {
      dados.set(chave, valor)
    },
  }
}

describe('criarPreferencias', () => {
  it('retorna PADRAO quando não há nada salvo', () => {
    const store = criarPreferencias(memoriaStorage())
    expect(store.ler()).toEqual(PADRAO)
  })

  it('persiste alterações na chave clipes.preferencias.v1 e devolve em ler()', () => {
    const storage = memoriaStorage()
    const store = criarPreferencias(storage)

    store.mudar({ tema: 'claro', teclasUnicas: false })

    expect(store.ler()).toEqual({
      ...PADRAO,
      tema: 'claro',
      teclasUnicas: false,
      modoTeclasUnicas: 'desligadas',
    })
    expect(storage.dados.get('clipes.preferencias.v1')).toBeTruthy()

    const outraInstancia = criarPreferencias(storage)
    expect(outraInstancia.ler()).toEqual({
      ...PADRAO,
      tema: 'claro',
      teclasUnicas: false,
      modoTeclasUnicas: 'desligadas',
    })
  })

  it('cai no PADRAO quando o JSON salvo é inválido', () => {
    const storage = memoriaStorage({ 'clipes.preferencias.v1': '{json-quebrado' })
    const store = criarPreferencias(storage)
    expect(store.ler()).toEqual(PADRAO)
  })

  it('cai no PADRAO sem lançar quando getItem e setItem lançam', () => {
    const quebrado = {
      getItem() {
        throw new Error('storage bloqueado')
      },
      setItem() {
        throw new Error('quota excedida')
      },
    }
    const store = criarPreferencias(quebrado)
    expect(store.ler()).toEqual(PADRAO)
    expect(() => store.mudar({ escala: 115 })).not.toThrow()
    expect(store.ler()).toEqual({ ...PADRAO, escala: 115 })
  })

  it('ignora campos desconhecidos e valores inválidos salvos', () => {
    const storage = memoriaStorage({
      'clipes.preferencias.v1': JSON.stringify({
        tema: 'claro',
        escala: 999,
        idioma: 'es',
        desconhecido: 'extra',
        atalhos: { 'corte.aprovar': 'A', invalido: 42 },
      }),
    })
    const store = criarPreferencias(storage)
    const lido = store.ler()

    expect(lido).toEqual({
      ...PADRAO,
      tema: 'claro',
      atalhos: { 'corte.aprovar': 'A' },
    })
    expect(lido).not.toHaveProperty('desconhecido')
  })

  it('notifica assinantes e permite cancelar assinatura', () => {
    const store = criarPreferencias(memoriaStorage())
    const fn = vi.fn()
    const parar = store.assinar(fn)

    store.mudar({ altoContraste: true })
    expect(fn).toHaveBeenCalledTimes(1)

    parar()
    store.mudar({ idioma: 'en' })
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('usePreferencias', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('lê e atualiza preferências reativamente', () => {
    const { result } = renderHook(() => usePreferencias())
    expect(result.current[0]).toEqual(PADRAO)

    act(() => {
      result.current[1]({ tema: 'sistema', teclasUnicas: false })
    })

    expect(result.current[0]).toEqual({
      ...PADRAO,
      tema: 'sistema',
      teclasUnicas: false,
      modoTeclasUnicas: 'desligadas',
    })
  })

  it('sincroniza modoTeclasUnicas com teclasUnicas legado e suporta paineisSoPorClique', () => {
    const storage = memoriaStorage({
      'clipes.preferencias.v1': JSON.stringify({ teclasUnicas: false }),
    })
    const store = criarPreferencias(storage)
    expect(store.ler().modoTeclasUnicas).toBe('desligadas')
    expect(store.ler().teclasUnicas).toBe(false)

    store.mudar({ modoTeclasUnicas: 'alt', paineisSoPorClique: false })
    expect(store.ler().modoTeclasUnicas).toBe('alt')
    expect(store.ler().teclasUnicas).toBe(true)
    expect(store.ler().paineisSoPorClique).toBe(false)

    store.mudar({ modoTeclasUnicas: 'desligadas' })
    expect(store.ler().teclasUnicas).toBe(false)
  })
})

describe('aplicarPreferencias', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-tema')
    document.documentElement.removeAttribute('data-contrast')
    document.documentElement.removeAttribute('data-escala')
    document.documentElement.lang = ''
    vi.restoreAllMocks()
  })

  it('aplica data-tema, data-contrast="high", data-escala="115" e resolve tema sistema', () => {
    aplicarPreferencias({
      ...PADRAO,
      tema: 'claro',
      altoContraste: true,
      escala: 115,
      idioma: 'en',
    })

    expect(document.documentElement.getAttribute('data-tema')).toBe('claro')
    expect(document.documentElement.getAttribute('data-contrast')).toBe('high')
    expect(document.documentElement.getAttribute('data-escala')).toBe('115')
    expect(document.documentElement.lang).toBe('en')

    aplicarPreferencias({ ...PADRAO, tema: 'escuro', altoContraste: false, escala: 100 })
    expect(document.documentElement.getAttribute('data-tema')).toBe('escuro')
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false)
    expect(document.documentElement.hasAttribute('data-escala')).toBe(false)
    expect(document.documentElement.lang).toBe('pt-BR')

    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        media: '(prefers-color-scheme: light)',
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    )
    expect(resolverTemaEfetivo('sistema')).toBe('claro')
    vi.unstubAllGlobals()
  })
})
