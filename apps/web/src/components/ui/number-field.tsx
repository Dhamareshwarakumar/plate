import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { Input } from './input';

export interface NumberFieldProps extends Omit<ComponentProps<'input'>, 'type' | 'inputMode'> {
  invalid?: boolean;
  /** Unit shown inside the field on the right, e.g. "g" or "kcal". */
  suffix?: string;
}

/**
 * Decimal input that opens the numeric keypad on phones. Values are kept as strings in the form
 * and parsed with `parseDecimal`, so "1,5" and "1.5" both work.
 */
export function NumberField({ className, suffix, ...props }: NumberFieldProps) {
  return (
    <div className="relative">
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn('tabular', suffix && 'pr-12', className)}
        {...props}
      />
      {suffix ? (
        <span className="text-fg-muted pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

/** Parses user-typed decimals; returns null for empty input and NaN for garbage. */
export function parseDecimal(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  if (s === '') return null;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return Number.NaN;
  return Number(s);
}
