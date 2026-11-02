import { AlertDialog } from 'radix-ui';
import { useRef, type ReactNode } from 'react';
import { buttonVariants } from './button';
import { cn } from '@/lib/cn';
import { rememberOpener, restoreFocus } from './focus';
import { Spinner } from './spinner';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}

/** Blocking confirmation for actions that cannot be undone. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  // The element that opened the dialog is often gone once the action ran (a deleted row), so focus
  // returns to <main> in that case instead of being dropped on <body>.
  const openerRef = useRef<HTMLElement | null>(null);
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => (pending && !next ? undefined : onOpenChange(next))}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="bg-overlay data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out fixed inset-0 z-50" />
        <AlertDialog.Content
          onOpenAutoFocus={() => rememberOpener(openerRef)}
          onCloseAutoFocus={(e) => restoreFocus(openerRef, e)}
          className="bg-surface border-border rounded-card data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 border p-5 shadow-2xl outline-none"
        >
          <AlertDialog.Title className="text-fg text-lg font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-fg-muted mt-2 text-sm">
            {description}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel
              className={buttonVariants({ variant: 'secondary' })}
              disabled={pending}
            >
              Cancel
            </AlertDialog.Cancel>
            <AlertDialog.Action
              className={cn(buttonVariants({ variant: destructive ? 'destructive' : 'primary' }))}
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {pending ? <Spinner className="size-4" /> : null}
              {confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
