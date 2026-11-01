import type { FoodBasis } from '@plate/shared';
import { Minus, Plus } from 'lucide-react';
import { Chip } from '@/components/ui/chip';
import { NumberField } from '@/components/ui/number-field';
import { cn } from '@/lib/cn';
import { formatQuantity } from '@/lib/format';
import { parsePositive, type QuantityFields } from './log-form-schemas';

export interface PortionOption {
  label: string;
  amount: number;
}

interface QuantityPortionFieldsProps {
  basis: FoodBasis;
  portions: readonly PortionOption[];
  value: QuantityFields;
  onChange: (next: QuantityFields) => void;
  error?: string | undefined;
  /** Large hero field for the log flow; compact for the edit sheet. */
  size?: 'hero' | 'compact';
  autoFocus?: boolean;
  inputId?: string;
  describedBy?: string | undefined;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Quantity in grams/ml with portion chips. Tapping a chip derives the quantity from
 * `amount × count` and shows a stepper; typing a quantity clears the chip (FR-F2: grams stay canonical).
 */
export function QuantityPortionFields({
  basis,
  portions,
  value,
  onChange,
  error,
  size = 'hero',
  autoFocus = false,
  inputId,
  describedBy,
}: QuantityPortionFieldsProps) {
  const selected = portions.find((p) => p.label === value.portionLabel);
  const count = parsePositive(value.portionCount) ?? 1;

  const pick = (portion: PortionOption) => {
    if (selected?.label === portion.label) {
      onChange({ ...value, portionLabel: '', portionCount: '' });
      return;
    }
    const nextCount = selected ? count : 1;
    onChange({
      quantity: fmt(portion.amount * nextCount),
      portionLabel: portion.label,
      portionCount: fmt(nextCount),
    });
  };

  const step = (delta: number) => {
    if (!selected) return;
    const nextCount = Math.max(0.5, Math.round((count + delta) * 2) / 2);
    onChange({
      quantity: fmt(selected.amount * nextCount),
      portionLabel: selected.label,
      portionCount: fmt(nextCount),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className={cn(size === 'hero' && 'mx-auto w-full max-w-[14rem]')}>
        <NumberField
          id={inputId}
          aria-label="Quantity"
          aria-describedby={describedBy}
          invalid={Boolean(error)}
          suffix={basis}
          value={value.quantity}
          autoFocus={autoFocus}
          enterKeyHint="done"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) =>
            onChange({ quantity: e.target.value, portionLabel: '', portionCount: '' })
          }
          className={cn(
            size === 'hero' && 'h-16 text-center text-[2rem] font-semibold tracking-tight',
          )}
        />
        {error ? (
          <p role="alert" className="text-danger mt-1.5 text-center text-sm">
            {error}
          </p>
        ) : null}
      </div>

      {portions.length > 0 ? (
        <div className="flex flex-col items-center gap-3">
          <div className="scrollbar-none -mx-5 flex max-w-[calc(100%+2.5rem)] gap-2 overflow-x-auto px-5">
            {portions.map((p) => (
              <Chip
                key={p.label}
                selected={selected?.label === p.label}
                onClick={() => pick(p)}
                aria-label={`${p.label}, ${formatQuantity(p.amount, basis)}`}
              >
                {p.label}
                <span className="text-fg-faint text-xs font-normal">
                  {formatQuantity(p.amount, basis)}
                </span>
              </Chip>
            ))}
          </div>
          {selected ? (
            <div
              className="bg-surface-2 flex items-center gap-1 rounded-full p-1"
              role="group"
              aria-label="Portion count"
            >
              <button
                type="button"
                onClick={() => step(-0.5)}
                aria-label="Fewer"
                disabled={count <= 0.5}
                className="text-fg hover:bg-surface flex size-9 items-center justify-center rounded-full transition-colors disabled:opacity-40"
              >
                <Minus className="size-4" />
              </button>
              <span className="text-fg tabular min-w-[5.5rem] text-center text-sm font-medium">
                {fmt(count)} × {selected.label}
              </span>
              <button
                type="button"
                onClick={() => step(0.5)}
                aria-label="More"
                className="text-fg hover:bg-surface flex size-9 items-center justify-center rounded-full transition-colors"
              >
                <Plus className="size-4" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
