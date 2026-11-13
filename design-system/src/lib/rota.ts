// Roteamento por hash: o app desktop não tem URL pública, e o hash sobrevive ao recarregar do Vite.
//   #/cortes   #/corte/c1/editar   #/config/provedor   #/galeria/botoes
// Query depois do hash: #/cortes?estado=vazio (estados vazios e de erro para revisão e screenshots).
import { useEffect, useState } from 'react'

export type Rota = { caminho: string; partes: string[]; query: URLSearchParams }

function ler(): Rota {
  const h = location.hash.replace(/^#/, '') || '/fontes'
  const [caminho, q = ''] = h.split('?')
  return { caminho, partes: caminho.split('/').filter(Boolean), query: new URLSearchParams(q) }
}

export function ir(caminho: string) {
  if (location.hash !== '#' + caminho) location.hash = caminho
}

export function useRota() {
  const [r, setR] = useState(ler)
  useEffect(() => {
    const f = () => setR(ler())
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return r
}
