// Diálogo: só quando a decisão precisa interromper (confirmar exclusão, consentimento do Provedor).
// O resto é inline ou gaveta. Esc fecha; o foco volta ao gatilho.
import { AlertDialog as AD } from '@base-ui/react/alert-dialog'
import { Dialog as D } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { IconButton } from './Button'

const fundo =
  'fixed inset-0 bg-scrim transition-opacity duration-(--dur-base) ease-out data-starting-style:opacity-0 data-ending-style:opacity-0'
const janela =
  'fixed top-[14vh] left-1/2 flex max-h-[76vh] w-[min(var(--largura),calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden ' +
  'rounded-xl border border-line-strong bg-surface text-fg shadow-dialog outline-none ' +
  'transition-[opacity,translate,scale] duration-(--dur-base) ease-out ' +
  'data-starting-style:-translate-y-1 data-starting-style:scale-[0.985] data-starting-style:opacity-0 ' +
  'data-ending-style:scale-[0.985] data-ending-style:opacity-0'

type Props = {
  aberto: boolean
  onAbrir: (v: boolean) => void
  titulo: ReactNode
  descricao?: ReactNode
  children?: ReactNode
  /** botões; o primário fica à direita */
  rodape?: ReactNode
  largura?: number
}

const estilo = (largura: number): CSSProperties => ({ zIndex: 'var(--z-dialog)', ['--largura' as string]: `${largura}px` })

export function Dialog({ aberto, onAbrir, titulo, descricao, children, rodape, largura = 480 }: Props) {
  return (
    <D.Root open={aberto} onOpenChange={v => onAbrir(v)}>
      <D.Portal>
        <D.Backdrop className={fundo} style={{ zIndex: 'var(--z-scrim)' }} />
        <D.Popup className={janela} style={estilo(largura)}>
          <div className="flex items-start gap-3 px-5 pt-4 pb-3">
            <div className="min-w-0 flex-1">
              <D.Title className="text-lg font-semibold tracking-[-0.01em]">{titulo}</D.Title>
              {descricao && <D.Description className="mt-1 text-sm text-fg-2">{descricao}</D.Description>}
            </div>
            <D.Close render={<IconButton rotulo="Fechar (Esc)" tamanho="sm" className="-mt-0.5 -mr-1.5" />}>
              <X size={15} />
            </D.Close>
          </div>
          {children && <div className="min-h-0 flex-1 overflow-auto px-5 pb-4">{children}</div>}
          {rodape && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{rodape}</div>}
        </D.Popup>
      </D.Portal>
    </D.Root>
  )
}

/** Confirmação que exige resposta (não fecha clicando fora). */
export function Confirmar({ aberto, onAbrir, titulo, descricao, children, rodape, largura = 420 }: Props) {
  return (
    <AD.Root open={aberto} onOpenChange={v => onAbrir(v)}>
      <AD.Portal>
        <AD.Backdrop className={fundo} style={{ zIndex: 'var(--z-scrim)' }} />
        <AD.Popup className={janela} style={estilo(largura)}>
          <div className="px-5 pt-4 pb-3">
            <AD.Title className="text-lg font-semibold tracking-[-0.01em]">{titulo}</AD.Title>
            {descricao && <AD.Description className="mt-1 text-sm text-fg-2">{descricao}</AD.Description>}
          </div>
          {children && <div className="px-5 pb-4">{children}</div>}
          {rodape && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{rodape}</div>}
        </AD.Popup>
      </AD.Portal>
    </AD.Root>
  )
}
export const FecharConfirmar = AD.Close
export const FecharDialog = D.Close
