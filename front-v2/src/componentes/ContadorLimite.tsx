import { cn } from '@ds'

export interface ContadorLimiteProps {
  usado: number
  maximo: number
  unidade: 'caracteres' | 'bytes' | 'tags'
  /** Faixa orientativa `[mínimoIdeal, máximoIdeal]` exibida como ajuda sem bloquear ação. */
  faixaIdeal?: [number, number]
  className?: string
}

/** Mede o tamanho exato em bytes UTF-8 de um texto (caracteres acentuados e emojis contam multi-byte). */
export function contarBytesUtf8(texto: string): number {
  return new TextEncoder().encode(texto).length
}

/**
 * Contador tabular para limites do Roteiro e Empacotamento.
 * Exibe `usado/maximo unidade`, orientação opcional (`Curto` / `Ideal` / `Pode truncar no mobile`)
 * e estado visual discreto de erro sem fundo colorido quando `usado > maximo`.
 */
export function ContadorLimite({ usado, maximo, unidade, faixaIdeal, className }: ContadorLimiteProps) {
  const excedido = usado > maximo
  const textoOrientativo = (() => {
    if (excedido) return 'Acima do limite permitido'
    if (!faixaIdeal) return null
    const [minIdeal, maxIdeal] = faixaIdeal
    if (usado < minIdeal) return 'Curto'
    if (usado <= maxIdeal) return 'Ideal'
    return 'Pode truncar no mobile'
  })()

  return (
    <span className={cn('inline-flex items-baseline gap-2 text-pequeno', className)}>
      <span className={cn('num', excedido ? 'font-medio text-erro' : 'text-t3')}>
        {usado}/{maximo} {unidade}
      </span>
      {textoOrientativo && (
        <span role="status" className={cn(excedido ? 'text-erro' : 'text-t3')}>
          {textoOrientativo}
        </span>
      )}
    </span>
  )
}
