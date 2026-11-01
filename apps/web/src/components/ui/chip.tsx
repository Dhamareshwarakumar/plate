import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

/** Filter chip (single or multi select). Horizontal lists of these scroll on phones. */
export function Chip({ selected = false, className, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors',
        selected
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-border-strong text-fg-muted hover:text-fg hover:bg-surface-2 bg-transparent',
        className,
      )}
      {...props}
    />
  );
}

export function Tag({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'bg-surface-2 text-fg-muted inline-flex h-5 items-center rounded-md px-1.5 text-[0.6875rem] font-medium',
        className,
      )}
      {...props}
    />
  );
}
