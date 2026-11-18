import type { Preferencias } from '~/preferencias/preferencias'

/** Resolve o tema efetivo considerando a preferência `sistema` via `prefers-color-scheme`. */
export function resolverTemaEfetivo(tema: Preferencias['tema']): 'escuro' | 'claro' {
  if (tema === 'escuro' || tema === 'claro') return tema
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'escuro'
  }
  return 'escuro'
}

/** Aplica tema, alto contraste, escala de interface e idioma no elemento raiz `<html>`. */
export function aplicarPreferencias(prefs: Preferencias, doc: Document = document): void {
  const raiz = doc.documentElement
  raiz.setAttribute('data-tema', resolverTemaEfetivo(prefs.tema))

  if (prefs.altoContraste) {
    raiz.setAttribute('data-contrast', 'high')
  } else {
    raiz.removeAttribute('data-contrast')
  }

  if (prefs.escala === 115) {
    raiz.setAttribute('data-escala', '115')
  } else {
    raiz.removeAttribute('data-escala')
  }

  raiz.lang = prefs.idioma === 'en' ? 'en' : 'pt-BR'
}
