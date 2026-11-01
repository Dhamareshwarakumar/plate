import {
  entryTotals,
  minutesToTimeString,
  slotWindowMiddleMinute,
  type Food,
  type MealSlot,
} from '@plate/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { isToday } from '@/lib/dates';
import { formatGrams, formatKcal } from '@/lib/format';
import { defaultTimeFor } from './entry-helpers';
import { readLastQuantity } from './last-quantity';
import { parsePositive, quantityFormSchema, type QuantityFormValues } from './log-form-schemas';
import { QuantityPortionFields } from './QuantityPortionFields';

export interface QuantityStepProps {
  formId: string;
  food: Food;
  day: string;
  slots: MealSlot[];
  initialSlotId: number;
  /** Current day total, for the "Day after" line. */
  dayKcal: number;
  /** The day's kcal goal; shown after the "Day after" figure when set. */
  goalKcal?: number | undefined;
  onSubmit: (values: QuantityFormValues) => void;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Pre-fill: what was logged last time for this food, else its first portion, else 100. */
function initialQuantity(
  food: Food,
): Pick<QuantityFormValues, 'quantity' | 'portionLabel' | 'portionCount'> {
  const last = readLastQuantity(food.id);
  if (last) {
    const portion = last.portionLabel
      ? food.portions.find((p) => p.label === last.portionLabel)
      : undefined;
    if (portion && last.portionCount) {
      return {
        quantity: fmt(portion.amount * last.portionCount),
        portionLabel: portion.label,
        portionCount: fmt(last.portionCount),
      };
    }
    return { quantity: fmt(last.quantity), portionLabel: '', portionCount: '' };
  }
  const first = food.portions[0];
  if (first) return { quantity: fmt(first.amount), portionLabel: first.label, portionCount: '1' };
  return { quantity: '100', portionLabel: '', portionCount: '' };
}

/** Step 2 of the log flow: quantity (typed or portion × count), live preview, meal, time, note. */
export function QuantityStep({
  formId,
  food,
  day,
  slots,
  initialSlotId,
  dayKcal,
  goalKcal,
  onSubmit,
}: QuantityStepProps) {
  const form = useForm<QuantityFormValues>({
    resolver: zodResolver(quantityFormSchema),
    defaultValues: {
      ...initialQuantity(food),
      slotId: String(initialSlotId),
      time: defaultTimeFor(
        day,
        slots.find((s) => s.id === initialSlotId),
      ),
      note: '',
    },
    mode: 'onSubmit',
  });
  const [quantity, portionLabel, portionCount] = useWatch({
    control: form.control,
    name: ['quantity', 'portionLabel', 'portionCount'],
  });
  const errors = form.formState.errors;

  const parsed = parsePositive(quantity);
  const preview = parsed === null ? null : entryTotals(food.per100, parsed);

  const onSlotChange = (slotId: string) => {
    // Backdating: follow the slot's window unless the time was edited by hand.
    if (!isToday(day) && !form.getFieldState('time').isDirty) {
      const slot = slots.find((s) => String(s.id) === slotId);
      if (slot) form.setValue('time', minutesToTimeString(slotWindowMiddleMinute(slot)));
    }
  };

  return (
    <form
      id={formId}
      noValidate
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-5 pt-1"
    >
      <QuantityPortionFields
        basis={food.basis}
        portions={food.portions}
        value={{ quantity, portionLabel, portionCount }}
        onChange={(next) => {
          form.setValue('quantity', next.quantity, { shouldDirty: true });
          form.setValue('portionLabel', next.portionLabel);
          form.setValue('portionCount', next.portionCount);
          if (errors.quantity) void form.trigger('quantity');
        }}
        error={errors.quantity?.message}
        autoFocus
      />

      <div
        className="bg-surface-2 rounded-card flex flex-col gap-1 px-4 py-3"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-fg tabular text-lg font-semibold">
            {preview ? formatKcal(preview.kcal) : '—'}{' '}
            <span className="text-fg-muted text-sm font-normal">kcal</span>
          </span>
          <span className="text-fg-muted tabular text-sm">
            <span className="text-protein">P {preview ? formatGrams(preview.protein) : '–'}</span>
            {' · '}
            <span className="text-carbs">C {preview ? formatGrams(preview.carbs) : '–'}</span>
            {' · '}
            <span className="text-fat">F {preview ? formatGrams(preview.fat) : '–'}</span>
          </span>
        </div>
        <p className="text-fg-muted text-xs">
          Day after:{' '}
          <span className="text-fg tabular font-medium">
            {formatKcal(dayKcal + (preview?.kcal ?? 0))}
          </span>
          {goalKcal !== undefined ? (
            <span className="tabular"> / {formatKcal(goalKcal)}</span>
          ) : null}{' '}
          kcal
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Meal" error={errors.slotId?.message}>
          {(c) => (
            <Select
              id={c.id}
              aria-describedby={c['aria-describedby']}
              invalid={c.invalid}
              {...form.register('slotId', {
                onChange: (e: { target: { value: string } }) => onSlotChange(e.target.value),
              })}
            >
              {slots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Time" error={errors.time?.message}>
          {(c) => (
            <Input
              id={c.id}
              type="time"
              aria-describedby={c['aria-describedby']}
              invalid={c.invalid}
              {...form.register('time')}
            />
          )}
        </Field>
      </div>
      <Field label="Note" description="Optional" error={errors.note?.message}>
        {(c) => (
          <Input
            id={c.id}
            aria-describedby={c['aria-describedby']}
            invalid={c.invalid}
            placeholder="e.g. post-run"
            autoComplete="off"
            {...form.register('note')}
          />
        )}
      </Field>
    </form>
  );
}
