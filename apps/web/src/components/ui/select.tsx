import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export interface SelectProps extends ComponentProps<'select'> {
  invalid?: boolean;
}

/** Native select, styled: phones get their own picker, which beats any custom popover for thumbs. */
export function Select({ className, invalid = false, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        aria-invalid={invalid || undefined}
        className={cn(
          'bg-surface text-fg h-11 w-full appearance-none rounded-control border px-3.5 pr-10 text-base',
          'border-border-strong transition-colors focus:border-accent focus:outline-none focus:ring-3 focus:ring-ring/40',
          'disabled:cursor-not-allowed disabled:opacity-60',
          invalid && 'border-danger focus:border-danger focus:ring-danger/30',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="text-fg-muted pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
    </div>
  );
}
