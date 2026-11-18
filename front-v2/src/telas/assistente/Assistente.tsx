import { cn } from '@ds'
import { Check } from 'lucide-react'
import { useCallback, useState } from 'react'
import { chamar } from '~/core/cliente'
import { PassoEssencial } from '~/telas/assistente/PassoEssencial'
import { PassoProvedor } from '~/telas/assistente/PassoProvedor'

export type AssistenteProps = {
  passo: 1 | 2
}

function lerRetorno(): 'config' | null {
  const hash = typeof window !== 'undefined' ? window.location.hash : ''
  const qIdx = hash.indexOf('?')
  if (qIdx >= 0) {
    const retorno = new URLSearchParams(hash.slice(qIdx + 1)).get('retorno')
    if (retorno === 'config') return 'config'
  }
  return null
}

function destinoFinal(): string {
  return lerRetorno() === 'config' ? '#/config/provedores' : '#/inicio'
}

/** Assistente de Primeiro Uso (`#/assistente?passo=1|2`): 2 passos para FFmpeg/Motor local e Provedor. */
export function Assistente({ passo }: AssistenteProps) {
  const [pulando, setPulando] = useState(false)

  const irParaPasso = useCallback((proximo: 1 | 2) => {
    const retorno = lerRetorno()
    window.location.hash = retorno
      ? `#/assistente?passo=${proximo}&retorno=${retorno}`
      : `#/assistente?passo=${proximo}`
  }, [])

  const concluirNavegacao = useCallback(() => {
    window.location.hash = destinoFinal()
  }, [])

  const pular = useCallback(async () => {
    if (pulando) return
    setPulando(true)
    try {
      await chamar('assistant.complete', { skipped: true })
    } catch {
      // Mesmo se houver erro transitório no mock/núcleo, libera retorno sem prender o usuário.
    } finally {
      setPulando(false)
      window.location.hash = destinoFinal()
    }
  }, [pulando])

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col gap-3 py-1">
      <nav
        aria-label="Etapas da configuração inicial"
        className="flex items-center justify-center gap-3 py-1"
      >
        <button
          type="button"
          aria-current={passo === 1 ? 'step' : undefined}
          onClick={() => irParaPasso(1)}
          className={cn(
            'foco inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border-0 px-3 text-pequeno transition-colors duration-(--dur-rapida)',
            passo === 1
              ? 'bg-elevado font-forte text-t1'
              : 'bg-area text-t2 hover:bg-hover hover:text-t1',
          )}
        >
          {passo === 2 && <Check className="size-3 stroke-[2]" aria-hidden />}
          <span>1. Essencial e Hardware</span>
        </button>

        <span aria-hidden className="h-px w-10 bg-linha" />

        <button
          type="button"
          aria-current={passo === 2 ? 'step' : undefined}
          onClick={() => irParaPasso(2)}
          className={cn(
            'foco inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border-0 px-3 text-pequeno transition-colors duration-(--dur-rapida)',
            passo === 2
              ? 'bg-elevado font-forte text-t1'
              : 'bg-area text-t3 hover:bg-hover hover:text-t1',
          )}
        >
          <span>2. Provedor de IA</span>
        </button>
      </nav>

      {passo === 1 ? (
        <PassoEssencial
          aoAvancar={() => irParaPasso(2)}
          aoPular={pular}
          pulando={pulando}
        />
      ) : (
        <PassoProvedor
          aoVoltar={() => irParaPasso(1)}
          aoConcluir={concluirNavegacao}
          aoPular={pular}
          pulando={pulando}
        />
      )}
    </div>
  )
}
