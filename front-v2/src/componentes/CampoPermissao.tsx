import { Campo, Entrada, Status, cn } from '@ds'
import { AlertCircle } from 'lucide-react'
import { useId, useState, type KeyboardEvent } from 'react'
import type { PermissaoFonte } from '~/stores/fontesProjeto'

export type { PermissaoFonte }

export type ErrosCamposPermissao = {
  who?: string
  where?: string
  scope?: string
}

/** Retorna erros de validação por campo quando a Permissão está como `granted`. */
export function errosPermissao(valor: PermissaoFonte): ErrosCamposPermissao {
  if (valor.status !== 'granted') return {}
  const erros: ErrosCamposPermissao = {}
  if (!valor.who.trim()) {
    erros.who = 'Informe quem autorizou o uso da Fonte.'
  }
  if (!valor.where.trim()) {
    erros.where = 'Informe onde foi autorizada (ex.: Email, Discord, Programa).'
  }
  if (!valor.scope.trim()) {
    erros.scope = 'Informe o escopo autorizado (ex.: cortes diretos, tradução).'
  }
  return erros
}

/** Verifica se a Permissão está pronta para envio ao núcleo. */
export function permissaoValida(valor: PermissaoFonte): boolean {
  if (valor.status === 'none') return true
  const erros = errosPermissao(valor)
  return !erros.who && !erros.where && !erros.scope
}

export type CampoPermissaoProps = {
  valor: PermissaoFonte
  aoMudar: (proximo: PermissaoFonte) => void
  somenteLeitura?: boolean
  obrigatorio?: boolean
  erro?: string
  rotulo?: string
  className?: string
}

/** Seletor e editor acessível de Permissão de uso da Fonte (`none` vs. `granted`). */
export function CampoPermissao({
  valor,
  aoMudar,
  somenteLeitura = false,
  obrigatorio = false,
  erro,
  rotulo = 'Permissão de uso',
  className,
}: CampoPermissaoProps) {
  const baseId = useId()
  const [tocado, setTocado] = useState<{ who?: boolean; where?: boolean; scope?: boolean }>({})

  const errosCampos = obrigatorio ? errosPermissao(valor) : {}

  function selecionarModo(proximoStatus: 'none' | 'granted') {
    if (somenteLeitura || valor.status === proximoStatus) return
    setTocado({})
    if (proximoStatus === 'none') {
      aoMudar({ status: 'none' })
      return
    }
    aoMudar({ status: 'granted', who: '', where: '', scope: '' })
  }

  function aoTeclarNoGrupo(e: KeyboardEvent<HTMLDivElement>) {
    if (somenteLeitura) return
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') {
      return
    }
    e.preventDefault()
    const proximo = valor.status === 'none' ? 'granted' : 'none'
    selecionarModo(proximo)
    requestAnimationFrame(() => {
      document.getElementById(`${baseId}-radio-${proximo}`)?.focus()
    })
  }

  function atualizarCampo(campo: 'who' | 'where' | 'scope', texto: string) {
    if (somenteLeitura || valor.status !== 'granted') return
    aoMudar({ ...valor, [campo]: texto })
  }

  return (
    <fieldset className={cn('m-0 flex flex-col gap-3 border-0 p-0', className)}>
      <legend className="mb-1.5 text-pequeno font-medio text-t1">
        {rotulo}
        {obrigatorio && (
          <span className="text-t3" aria-hidden>
            {' '}
            *
          </span>
        )}
      </legend>

      <div
        role="radiogroup"
        aria-label={rotulo}
        onKeyDown={aoTeclarNoGrupo}
        className="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
      >
        <button
          id={`${baseId}-radio-none`}
          type="button"
          role="radio"
          aria-checked={valor.status === 'none'}
          tabIndex={valor.status === 'none' ? 0 : -1}
          disabled={somenteLeitura}
          onClick={() => selecionarModo('none')}
          className={cn(
            'foco flex min-h-7 cursor-pointer items-center justify-between gap-2 rounded-controle border-0 px-3 py-1.5 text-left text-pequeno transition-colors duration-(--dur-rapida) ease-saida disabled:cursor-default disabled:opacity-60',
            valor.status === 'none'
              ? 'marcado bg-elevado font-medio text-t1'
              : 'bg-chao text-t2 hover:bg-hover hover:text-t1',
          )}
        >
          <span>Sem permissão registrada</span>
        </button>

        <button
          id={`${baseId}-radio-granted`}
          type="button"
          role="radio"
          aria-checked={valor.status === 'granted'}
          tabIndex={valor.status === 'granted' ? 0 : -1}
          disabled={somenteLeitura}
          onClick={() => selecionarModo('granted')}
          className={cn(
            'foco flex min-h-7 cursor-pointer items-center justify-between gap-2 rounded-controle border-0 px-3 py-1.5 text-left text-pequeno transition-colors duration-(--dur-rapida) ease-saida disabled:cursor-default disabled:opacity-60',
            valor.status === 'granted'
              ? 'marcado bg-elevado font-medio text-t1'
              : 'bg-chao text-t2 hover:bg-hover hover:text-t1',
          )}
        >
          <span>Tenho permissão do criador</span>
        </button>
      </div>

      {valor.status === 'none' ? (
        <div className="flex flex-col gap-1 rounded-controle bg-area px-3 py-2">
          <Status tom="neutro">Sem permissão</Status>
          <p className="text-pequeno text-t3">
            Sem Permissão registrada, o crédito automático na descrição fica vazio e a tradução de
            legendas no Editor fica bloqueada.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 rounded-controle bg-area p-3">
          <Campo
            rotulo="Quem autorizou"
            erro={tocado.who ? errosCampos.who : undefined}
          >
            {(propsAria) => (
              <Entrada
                {...propsAria}
                value={valor.who}
                readOnly={somenteLeitura}
                disabled={somenteLeitura}
                required={obrigatorio}
                placeholder="Ex.: Canal do Criador"
                onChange={(e) => atualizarCampo('who', e.target.value)}
                onBlur={() => setTocado((prev) => ({ ...prev, who: true }))}
              />
            )}
          </Campo>

          <Campo
            rotulo="Onde foi autorizada"
            erro={tocado.where ? errosCampos.where : undefined}
          >
            {(propsAria) => (
              <Entrada
                {...propsAria}
                value={valor.where}
                readOnly={somenteLeitura}
                disabled={somenteLeitura}
                required={obrigatorio}
                placeholder="Ex.: Discord, Email, Programa de cortes"
                onChange={(e) => atualizarCampo('where', e.target.value)}
                onBlur={() => setTocado((prev) => ({ ...prev, where: true }))}
              />
            )}
          </Campo>

          <Campo
            rotulo="Escopo"
            ajuda="Inclua 'tradução' se autorizada para traduzir legendas"
            erro={tocado.scope ? errosCampos.scope : undefined}
          >
            {(propsAria) => (
              <Entrada
                {...propsAria}
                value={valor.scope}
                readOnly={somenteLeitura}
                disabled={somenteLeitura}
                required={obrigatorio}
                placeholder="Ex.: cortes diretos e tradução"
                onChange={(e) => atualizarCampo('scope', e.target.value)}
                onBlur={() => setTocado((prev) => ({ ...prev, scope: true }))}
              />
            )}
          </Campo>
        </div>
      )}

      {erro && (
        <p role="alert" className="flex items-start gap-1.5 text-pequeno text-erro">
          <AlertCircle className="mt-px size-[13px] shrink-0 stroke-[1.75]" aria-hidden />
          {erro}
        </p>
      )}
    </fieldset>
  )
}
