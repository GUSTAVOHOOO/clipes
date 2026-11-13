// Tema: escuro por padrão. O usuário escolhe em Configurações › Aparência (ou pela paleta).
import { useEffect, useState } from 'react'

export type Tema = 'escuro' | 'claro' | 'sistema'
const CHAVE = 'clipes.tema'

function ler(): Tema {
  try {
    const v = localStorage.getItem(CHAVE)
    return v === 'claro' || v === 'sistema' ? v : 'escuro'
  } catch {
    return 'escuro'
  }
}

function aplicar(t: Tema) {
  const claro = t === 'claro' || (t === 'sistema' && matchMedia('(prefers-color-scheme: light)').matches)
  document.documentElement.dataset.theme = claro ? 'light' : 'dark'
}

let atual: Tema = typeof window === 'undefined' ? 'escuro' : ler()
const ouvintes = new Set<(t: Tema) => void>()

export function definirTema(t: Tema) {
  atual = t
  try {
    localStorage.setItem(CHAVE, t)
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
  aplicar(t)
  ouvintes.forEach(f => f(t))
}

/** ?tema=claro|escuro na URL força o tema (screenshots e testes). */
export function iniciarTema() {
  const q = new URLSearchParams(location.search).get('tema')
  if (q === 'claro' || q === 'escuro') atual = q
  aplicar(atual)
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => atual === 'sistema' && aplicar('sistema'))
}

export function useTema() {
  const [t, setT] = useState(atual)
  useEffect(() => {
    ouvintes.add(setT)
    return () => void ouvintes.delete(setT)
  }, [])
  const efetivo: 'escuro' | 'claro' =
    t === 'sistema' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'escuro') : t
  return { tema: t, efetivo, definir: definirTema }
}
