import { ChevronLeft, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { rememberOpener, restoreFocus } from './focus';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Visually hidden when omitted, but always present for screen readers. */
  description?: string;
  children: ReactNode;
  /** Sticky footer, typically the action buttons. */
  footer?: ReactNode;
  /** Desktop width class. Phones always use the full width as a bottom sheet. */
  className?: string;
  /** Prevents closing by overlay click / Escape while an action is in flight. */
  locked?: boolean;
  /** Renders a back arrow before the title for multi-step sheets. */
  onBack?: (() => void) | undefined;
  /** Extra content under the title inside the header (e.g. a search field that must stay put). */
  headerExtra?: ReactNode;
  /** Set when the first field should not be auto-focused (phones: keeps the keyboard closed). */
  autoFocusFirstField?: boolean;
}

/**
 * The one modal container of the app: a bottom sheet with a drag handle on phones, a centered
 * dialog on larger screens. Radix handles focus trapping, scroll lock and aria wiring.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  locked = false,
  onBack,
  headerExtra,
  autoFocusFirstField = true,
}: SheetProps) {
  // Focus goes back to whatever opened the sheet, or to <main> when that element is gone (DESIGN §10).
  const openerRef = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => (locked && !next ? undefined : onOpenChange(next))}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="bg-overlay data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out fixed inset-0 z-50 backdrop-blur-[2px]" />
        <Dialog.Content
          onOpenAutoFocus={(e) => {
            rememberOpener(openerRef);
            // Let the marked field, else the first field (not the close button), take focus.
            const root = e.currentTarget as HTMLElement;
            const marked = root.querySelector<HTMLElement>('[data-autofocus]');
            const target =
              marked ??
              (autoFocusFirstField
                ? root.querySelector<HTMLElement>('input, select, textarea')
                : null);
            if (target) {
              e.preventDefault();
              target.focus();
            } else if (!autoFocusFirstField) {
              e.preventDefault();
              root.focus();
            }
          }}
          onCloseAutoFocus={(e) => restoreFocus(openerRef, e)}
          className={cn(
            'bg-surface text-fg fixed z-50 flex flex-col outline-none',
            // Phone: bottom sheet.
            'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-[1.25rem] border-t border-border',
            'data-[state=open]:animate-sheet-up data-[state=closed]:animate-sheet-down',
            // Desktop: centered card.
            'sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2',
            'sm:max-h-[85dvh] sm:rounded-card sm:border sm:shadow-2xl',
            'sm:data-[state=open]:animate-dialog-in sm:data-[state=closed]:animate-dialog-out',
            className,
          )}
        >
          <div
            className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border-strong sm:hidden"
            aria-hidden="true"
          />
          <header className="flex shrink-0 flex-col gap-3 px-5 pt-3 pb-3 sm:pt-5">
            <div className="flex items-start justify-between gap-3">
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  aria-label="Back"
                  className="text-fg-muted hover:bg-surface-2 hover:text-fg -ml-2 flex size-9 shrink-0 items-center justify-center rounded-full"
                >
                  <ChevronLeft className="size-5" />
                </button>
              ) : null}
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-fg truncate text-lg font-semibold">
                  {title}
                </Dialog.Title>
                <Dialog.Description
                  className={cn('text-fg-muted mt-0.5 text-sm', !description && 'sr-only')}
                >
                  {description ?? title}
                </Dialog.Description>
              </div>
              <Dialog.Close
                className="text-fg-muted hover:bg-surface-2 hover:text-fg -mr-2 flex size-9 shrink-0 items-center justify-center rounded-full"
                aria-label="Close"
                disabled={locked}
              >
                <X className="size-5" />
              </Dialog.Close>
            </div>
            {headerExtra}
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer ? (
            <footer className="border-border pb-safe bg-surface flex shrink-0 justify-end gap-2 border-t px-5 pt-3 [padding-bottom:calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-4">
              {footer}
            </footer>
          ) : (
            <div className="pb-safe shrink-0" />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
