// Avisos (Sonner): confirmação curta de uma ação ("Silêncios removidos: −2,3 s"), canto inferior direito.
// Erro que exige ação não é aviso: vira estado inline na tela.
import { Toaster as Sonner, toast } from 'sonner'
import { useTema } from '@/lib/tema'

export function Toaster() {
  const { efetivo } = useTema()
  return (
    <Sonner
      theme={efetivo === 'claro' ? 'light' : 'dark'}
      position="bottom-right"
      offset={16}
      gap={8}
      visibleToasts={3}
      style={{ zIndex: 'var(--z-toast)' } as React.CSSProperties}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-[356px] items-start gap-2.5 rounded-lg border border-line-strong bg-raised px-3.5 py-3 text-sm text-fg shadow-overlay',
          title: 'font-medium leading-snug',
          description: 'mt-0.5 text-xs text-fg-2',
          icon: 'mt-px shrink-0',
          actionButton:
            'foco ml-auto h-7 shrink-0 rounded-md border border-line-strong bg-field px-2.5 text-xs text-fg hover:bg-hover',
          cancelButton: 'foco h-7 shrink-0 rounded-md px-2 text-xs text-fg-2 hover:bg-hover',
          error: '[&_[data-icon]]:text-danger',
          success: '[&_[data-icon]]:text-success',
          warning: '[&_[data-icon]]:text-warning',
          info: '[&_[data-icon]]:text-info',
        },
      }}
    />
  )
}

/** Aviso curto. Use `avisar.desfazer` quando a ação puder voltar. */
export const avisar = Object.assign((titulo: string, descricao?: string) => toast(titulo, { description: descricao, duration: 2200 }), {
  sucesso: (titulo: string, descricao?: string) => toast.success(titulo, { description: descricao }),
  erro: (titulo: string, descricao?: string) => toast.error(titulo, { description: descricao, duration: 6000 }),
  atencao: (titulo: string, descricao?: string) => toast.warning(titulo, { description: descricao, duration: 4000 }),
  desfazer: (titulo: string, desfazer: () => void) =>
    toast(titulo, { duration: 5000, action: { label: 'Desfazer', onClick: desfazer } }),
})
