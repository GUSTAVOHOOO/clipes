import { useRef, type ReactNode, type RefObject } from 'react';
import { AlertDialog as AD } from '@base-ui/react/alert-dialog';
import { Button } from './Button';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
  finalFocus?: RefObject<HTMLElement | null>;
  children?: ReactNode;
};
export function ConfirmDialog({open,onOpenChange,title,description,cancelLabel,confirmLabel,onConfirm,finalFocus,children}: Props) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  return <AD.Root open={open} onOpenChange={onOpenChange}>
    <AD.Portal>
      <AD.Backdrop className="fixed inset-0 bg-scrim" style={{ zIndex: 'var(--z-scrim)' }} />
      <AD.Popup initialFocus={cancelButton} finalFocus={finalFocus} className="fixed top-[14vh] left-1/2 flex max-h-[76vh] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-line-strong bg-surface text-fg shadow-dialog outline-none" style={{ zIndex: 'var(--z-dialog)' }}>
        <div className="px-5 pt-4 pb-3"><AD.Title className="text-lg font-semibold">{title}</AD.Title><AD.Description className="mt-1 text-sm text-fg-2">{description}</AD.Description></div>
        {children}
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <AD.Close render={<Button ref={cancelButton} />}>{cancelLabel}</AD.Close>
          <Button variante="primario" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </AD.Popup>
    </AD.Portal>
  </AD.Root>;
}
