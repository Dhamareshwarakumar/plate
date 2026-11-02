import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface FieldControl {
  id: string;
  'aria-describedby': string | undefined;
  /** Set in `group` mode: the id of the label text, for the control's `aria-labelledby`. */
  'aria-labelledby': string | undefined;
  invalid: boolean;
}

export interface FieldProps {
  label: string;
  /** Right-aligned extra on the label row (e.g. a live "30 %" next to a gram field). */
  labelExtra?: ReactNode;
  /** Helper text shown under the control when there is no error. */
  description?: string;
  error?: string | undefined;
  /**
   * The control is a group of controls (`Segmented`, a chip row) rather than one labelable
   * element: the label is rendered as plain text that the control references through
   * `aria-labelledby` instead of a `<label for>` with nothing to point at.
   */
  group?: boolean;
  /** Render-prop so the control receives the generated id and aria wiring. */
  children: (control: FieldControl) => ReactNode;
  className?: string;
}

/** Label + control + description/error with the aria plumbing done once. */
export function Field({
  label,
  labelExtra,
  description,
  error,
  group = false,
  children,
  className,
}: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const labelId = `${id}-label`;
  const hasMessage = Boolean(error ?? description);
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        {group ? (
          <span id={labelId} className="text-fg text-sm font-medium">
            {label}
          </span>
        ) : (
          <label htmlFor={id} className="text-fg text-sm font-medium">
            {label}
          </label>
        )}
        {labelExtra ? (
          <span className="text-fg-muted tabular text-xs" aria-live="polite">
            {labelExtra}
          </span>
        ) : null}
      </div>
      {children({
        id,
        'aria-describedby': hasMessage ? messageId : undefined,
        'aria-labelledby': group ? labelId : undefined,
        invalid: Boolean(error),
      })}
      {hasMessage ? (
        <p
          id={messageId}
          role={error ? 'alert' : undefined}
          className={cn('text-sm', error ? 'text-danger' : 'text-fg-muted')}
        >
          {error ?? description}
        </p>
      ) : null}
    </div>
  );
}
