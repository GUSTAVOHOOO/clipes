import { BannerErroCore, Esqueleto, EstadoTela } from '@ds'
import { isValidElement, useSyncExternalStore, type ReactNode } from 'react'
import { ErroCore } from '~/core/cliente'
import { mensagemDeErro, type Recuperacao } from '~/core/erros'

export type TipoEstadoForcado =
  | 'vazio'
  | 'erro'
  | 'carregando'
  | 'parcial'
  | 'offline'
  | 'erro-flush'
  | 'fallback'

export type EstadoComEstado = TipoEstadoForcado | 'pronto'

const ESTADOS_VALIDOS = new Set<TipoEstadoForcado>([
  'vazio',
  'erro',
  'carregando',
  'parcial',
  'offline',
  'erro-flush',
  'fallback',
])

/** Extrai e valida `?estado=` da query string (ou de um hash contendo query). */
export function estadoForcado(search: string): TipoEstadoForcado | null {
  if (!search) return null
  const idx = search.indexOf('?')
  const bruto = idx >= 0 ? search.slice(idx + 1) : search
  const params = new URLSearchParams(bruto)
  const valor = params.get('estado')
  if (!valor || !ESTADOS_VALIDOS.has(valor as TipoEstadoForcado)) {
    return null
  }
  return valor as TipoEstadoForcado
}

function assinarLocalizacao(aoMudar: () => void): () => void {
  window.addEventListener('hashchange', aoMudar)
  window.addEventListener('popstate', aoMudar)
  return () => {
    window.removeEventListener('hashchange', aoMudar)
    window.removeEventListener('popstate', aoMudar)
  }
}

function lerLocalizacao(): string {
  return `${window.location.search}|${window.location.hash}`
}

/** Observa `?estado=` tanto na query da janela quanto na query do hash. */
export function useEstadoForcado(): TipoEstadoForcado | null {
  const loc = useSyncExternalStore(assinarLocalizacao, lerLocalizacao, () => '|')
  const [search, hash] = loc.split('|')
  return estadoForcado(hash) ?? estadoForcado(search)
}

export type ErroEntrada = ErroCore | { code: string; message?: string; detalhe?: string }

function normalizarParaErroCore(erro?: ErroEntrada | null): ErroCore {
  if (erro instanceof ErroCore) return erro
  if (erro && typeof erro === 'object' && typeof erro.code === 'string') {
    return new ErroCore(erro.code, erro.detalhe ?? erro.message ?? '')
  }
  return new ErroCore('desconhecido', 'Simulação de erro via ?estado=erro.')
}

export type ComEstadoProps = {
  estado?: EstadoComEstado | null
  carregando?: ReactNode
  vazio?: ReactNode
  erro?: ErroEntrada | ReactNode | null
  parcial?: ReactNode
  aoRecuperar?: (recuperacao: Recuperacao) => void
  children: ReactNode
}

/** Controla os estados padronizados de tela (`carregando`, `vazio`, `erro`, `parcial`, `pronto`). */
export function ComEstado({
  estado,
  carregando,
  vazio,
  erro,
  parcial,
  aoRecuperar,
  children,
}: ComEstadoProps) {
  const atual = estado ?? 'pronto'

  if (atual === 'carregando') {
    return <>{carregando ?? <Esqueleto variante="painel" />}</>
  }

  if (atual === 'vazio') {
    return (
      <>
        {vazio ?? (
          <EstadoTela
            tipo="vazio"
            titulo="Nada por aqui ainda"
            descricao="Nenhum dado disponível nesta tela no momento."
          />
        )}
      </>
    )
  }

  if (atual === 'erro') {
    if (isValidElement(erro)) {
      return erro
    }
    const erroCore = normalizarParaErroCore(erro as ErroEntrada | null | undefined)
    const traducao = mensagemDeErro(erroCore)
    const recuperacao = traducao.recuperacao
    const acaoRecuperacao = recuperacao
      ? {
          rotulo: recuperacao.rotulo,
          aoAcionar: () => {
            if (aoRecuperar) {
              aoRecuperar(recuperacao)
              return
            }
            if (recuperacao.rota) {
              window.location.hash = recuperacao.rota
            }
          },
        }
      : undefined

    return (
      <BannerErroCore
        erro={{ code: erroCore.code, message: erroCore.detalhe || erroCore.message }}
        traduzir={() => ({ titulo: traducao.titulo })}
        acaoRecuperacao={acaoRecuperacao}
        permitirRelato
      />
    )
  }

  if (atual === 'parcial') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {parcial ?? (
          <EstadoTela
            tipo="parcial"
            compacto
            titulo="Conclusão parcial"
            descricao="Parte do conteúdo já está disponível; o restante pode ser retomado."
          />
        )}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    )
  }

  return <>{children}</>
}
