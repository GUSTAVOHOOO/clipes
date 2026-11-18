import { Campo, Entrada, cn } from '@ds'
import { AlertCircle, X } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'

export interface ListaChipsProps {
  itens: string[]
  aoAlterar: (proximos: string[]) => void
  maxItens: number
  maxCharsItem?: number
  /** Prefixo aplicado automaticamente caso falte (ex.: `#` em hashtags). */
  prefixo?: string
  rotulo: string
  placeholder?: string
  ajuda?: string
  desabilitado?: boolean
  erro?: string | null
  /** Chamado opcionalmente ao clicar no texto de um chip existente (ex.: destacar Frase). */
  aoClicarChip?: (item: string) => void
  className?: string
}

function normalizarItem(bruto: string, prefixo?: string): string {
  const limpo = bruto.trim()
  if (!limpo) return ''
  if (prefixo && !limpo.startsWith(prefixo)) {
    return `${prefixo}${limpo}`
  }
  return limpo
}

/**
 * Editor acessível de lista de chips/tags/hashtags/referências.
 * Adiciona por `Enter` ou vírgula, deduplica, aplica prefixo opcional e anuncia alterações em `aria-live="polite"`.
 */
export function ListaChips({
  itens,
  aoAlterar,
  maxItens,
  maxCharsItem,
  prefixo,
  rotulo,
  placeholder,
  ajuda,
  desabilitado,
  erro,
  aoClicarChip,
  className,
}: ListaChipsProps) {
  const [rascunho, setRascunho] = useState('')
  const [erroLocal, setErroLocal] = useState<string | null>(null)
  const [anuncio, setAnuncio] = useState('')

  const erroAtivo = erro ?? erroLocal ?? undefined

  const tentarAdicionarLote = (brutos: string[]) => {
    let atuais = [...itens]
    let adicionados = 0
    let ultimoAdicionado = ''

    for (const pedaco of brutos) {
      const item = normalizarItem(pedaco, prefixo)
      if (!item || item === prefixo) continue
      if (atuais.includes(item)) {
        setErroLocal(null)
        continue
      }
      if (atuais.length >= maxItens) {
        setErroLocal(`Máximo de ${maxItens} itens permitido.`)
        return false
      }
      if (maxCharsItem !== undefined && [...item].length > maxCharsItem) {
        setErroLocal(`Cada item pode ter no máximo ${maxCharsItem} caracteres.`)
        return false
      }
      atuais.push(item)
      adicionados += 1
      ultimoAdicionado = item
    }

    setErroLocal(null)
    if (adicionados > 0) {
      aoAlterar(atuais)
      setAnuncio(adicionados === 1 ? `Item adicionado: ${ultimoAdicionado}` : `${adicionados} itens adicionados`)
    }
    return true
  }

  const confirmarRascunho = () => {
    if (!rascunho.trim()) {
      setRascunho('')
      setErroLocal(null)
      return
    }
    const ok = tentarAdicionarLote(rascunho.split(','))
    if (ok) {
      setRascunho('')
    }
  }

  const aoMudarTexto = (valor: string) => {
    if (valor.includes(',')) {
      const partes = valor.split(',')
      const resto = partes.pop() ?? ''
      const ok = tentarAdicionarLote(partes)
      setRascunho(ok ? resto : valor.replace(/,+$/, ''))
      return
    }
    if (erroLocal) setErroLocal(null)
    setRascunho(valor)
  }

  const aoTeclar = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      confirmarRascunho()
      return
    }
    if (e.key === 'Backspace' && rascunho === '' && itens.length > 0 && !desabilitado) {
      e.preventDefault()
      const removido = itens[itens.length - 1]
      aoAlterar(itens.slice(0, -1))
      setErroLocal(null)
      setAnuncio(`Item removido: ${removido}`)
    }
  }

  const removerItem = (item: string) => {
    if (desabilitado) return
    aoAlterar(itens.filter((x) => x !== item))
    setErroLocal(null)
    setAnuncio(`Item removido: ${item}`)
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Campo rotulo={rotulo} ajuda={ajuda}>
        {({ id, 'aria-describedby': ariaDescribedby }) => (
          <div className="flex flex-col gap-1.5">
            {itens.length > 0 && (
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {itens.map((item) => (
                  <li
                    key={item}
                    className="inline-flex min-h-6 items-center gap-1 rounded-controle bg-elevado pl-2 pr-0.5 text-pequeno text-t1 shadow-[inset_0_0_0_1px_var(--contorno-controle)]"
                  >
                    {aoClicarChip ? (
                      <button
                        type="button"
                        onClick={() => aoClicarChip(item)}
                        className="min-h-6 cursor-pointer border-0 bg-transparent px-1 text-pequeno text-t1 hover:underline"
                      >
                        {item}
                      </button>
                    ) : (
                      <span>{item}</span>
                    )}
                    <button
                      type="button"
                      disabled={desabilitado}
                      aria-label={`Remover ${item}`}
                      onClick={() => removerItem(item)}
                      className="inline-flex size-6 min-h-6 min-w-6 cursor-pointer items-center justify-center rounded-mini border-0 bg-transparent text-t3 transition-colors duration-(--dur-rapida) ease-saida hover:bg-hover hover:text-t1 focus-visible:outline-2 focus-visible:outline-foco disabled:pointer-events-none disabled:opacity-40"
                    >
                      <X className="size-3 stroke-[1.75]" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <Entrada
              id={id}
              value={rascunho}
              disabled={desabilitado}
              placeholder={placeholder}
              aria-describedby={ariaDescribedby}
              aria-invalid={erroAtivo ? true : undefined}
              onChange={(e) => aoMudarTexto(e.target.value)}
              onKeyDown={aoTeclar}
              onBlur={() => {
                if (rascunho.trim()) confirmarRascunho()
              }}
            />
          </div>
        )}
      </Campo>

      {erroAtivo && (
        <p role="alert" className="m-0 flex items-start gap-1.5 text-pequeno text-erro">
          <AlertCircle className="mt-px size-[13px] shrink-0 stroke-[1.75]" aria-hidden />
          {erroAtivo}
        </p>
      )}

      <span className="sr-only" aria-live="polite">
        {anuncio}
      </span>
    </div>
  )
}
