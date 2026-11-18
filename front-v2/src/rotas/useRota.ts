import { useEffect, useSyncExternalStore } from 'react'
import { resolver, type Contexto, type Rota } from '~/rotas/rotas'

function assinarHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function lerHash(): string {
  return window.location.hash
}

/** Observa `window.location.hash`, aplica redirecionamentos das guardas via `location.replace` e devolve a `Rota` ativa. */
export function useRota(ctx: Contexto, aoRedirecionar?: (aviso: string) => void): Rota {
  const hash = useSyncExternalStore(assinarHash, lerHash, () => '#/inicio')
  const resolucao = resolver(hash, ctx)
  const destino = 'redirecionar' in resolucao ? resolucao.redirecionar : null
  const aviso = 'redirecionar' in resolucao ? resolucao.aviso : undefined

  useEffect(() => {
    if (!destino) return
    if (aviso) aoRedirecionar?.(aviso)
    window.location.replace(destino)
  }, [destino, aviso, aoRedirecionar])

  if ('rota' in resolucao) return resolucao.rota

  const aposRedirecionar = resolver(resolucao.redirecionar, ctx)
  return 'rota' in aposRedirecionar ? aposRedirecionar.rota : { tela: 'inicio' }
}
