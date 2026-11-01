import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface FieldProps {
  label: string;
  /** Right-aligned extra on the label row (e.g. a live "30 %" next to a gram field). */
  labelExtra?: ReactNode;
  /** Helper text shown under the control when there is no error. */
  description?: string;
  error?: string | undefined;
  /** Render-prop so the control receives the generated id and aria wiring. */
  children: (control: {
    id: string;
    'aria-describedby': string | undefined;
    invalid: boolean;
  }) => ReactNode;
  className?: string;
}

/** Label + control + description/error with the aria plumbing done once. */
export function Field({ label, labelExtra, description, error, children, className }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const hasMessage = Boolean(error ?? description);
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-fg text-sm font-medium">
          {label}
        </label>
        {labelExtra ? (
          <span className="text-fg-muted tabular text-xs" aria-live="polite">
            {labelExtra}
          </span>
        ) : null}
      </div>
      {children({
        id,
        'aria-describedby': hasMessage ? messageId : undefined,
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
