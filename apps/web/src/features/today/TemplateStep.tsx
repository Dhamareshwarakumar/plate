import {
  minutesToTimeString,
  scaleNutrients,
  slotWindowMiddleMinute,
  sumNutrients,
  type MealSlot,
  type MealTemplate,
} from '@plate/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { Tag } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NumberField } from '@/components/ui/number-field';
import { Select } from '@/components/ui/select';
import { isToday } from '@/lib/dates';
import { formatGrams, formatKcal } from '@/lib/format';
import { defaultTimeFor } from './entry-helpers';
import {
  parsePositive,
  templateLogFormSchema,
  type TemplateLogFormValues,
} from './log-form-schemas';

export interface TemplateStepProps {
  formId: string;
  template: MealTemplate;
  day: string;
  slots: MealSlot[];
  initialSlotId: number;
  dayKcal: number;
  goalKcal?: number | undefined;
  onSubmit: (values: TemplateLogFormValues) => void;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Review list of a meal template (DESIGN §3): every item with an editable amount, one total, one "Log N items". */
export function TemplateStep({
  formId,
  template,
  day,
  slots,
  initialSlotId,
  dayKcal,
  goalKcal,
  onSubmit,
}: TemplateStepProps) {
  const form = useForm<TemplateLogFormValues>({
    resolver: zodResolver(templateLogFormSchema),
    defaultValues: {
      amounts: template.items.map((i) => fmt(i.amount)),
      slotId: String(initialSlotId),
      time: defaultTimeFor(
        day,
        slots.find((s) => s.id === initialSlotId),
      ),
    },
    mode: 'onSubmit',
  });
  const amounts = useWatch({ control: form.control, name: 'amounts' });
  const errors = form.formState.errors;

  const lines = template.items.map((item, index) => {
    const amount = parsePositive(amounts?.[index] ?? '');
    return { item, totals: amount === null ? null : scaleNutrients(item.per100, amount) };
  });
  const totals = sumNutrients(lines.flatMap((l) => (l.totals ? [l.totals] : [])));

  const onSlotChange = (slotId: string) => {
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
      <ul className="divide-border -mx-2 divide-y">
        {lines.map(({ item, totals: itemTotals }, index) => {
          const error = errors.amounts?.[index]?.message;
          return (
            <li key={item.id} className="flex items-start gap-3 px-2 py-2.5">
              <div className="min-w-0 flex-1 pt-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-fg truncate text-sm font-medium">{item.name}</span>
                  {item.kind === 'dish' ? <Tag>Dish</Tag> : null}
                </div>
                <div className="text-fg-muted tabular mt-0.5 text-xs">
                  {itemTotals ? (
                    <>
                      <span className="text-fg font-medium">
                        {formatKcal(itemTotals.kcal)} kcal
                      </span>
                      {' · '}P {formatGrams(itemTotals.protein)} · C {formatGrams(itemTotals.carbs)}{' '}
                      · F {formatGrams(itemTotals.fat)}
                    </>
                  ) : (
                    `${formatKcal(item.per100.kcal)} kcal per 100 ${item.basis}`
                  )}
                </div>
              </div>
              <div className="w-28 shrink-0">
                <NumberField
                  aria-label={`${item.name} amount in ${item.basis}`}
                  suffix={item.basis}
                  invalid={Boolean(error)}
                  enterKeyHint="next"
                  onFocus={(e) => e.currentTarget.select()}
                  {...form.register(`amounts.${index}`, {
                    onChange: () => {
                      if (errors.amounts?.[index]) void form.trigger(`amounts.${index}`);
                    },
                  })}
                />
                {error ? <p className="text-danger mt-1 text-xs">{error}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>

      <div
        className="bg-surface-2 rounded-card flex flex-col gap-1 px-4 py-3"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-fg tabular text-lg font-semibold">
            {formatKcal(totals.kcal)}{' '}
            <span className="text-fg-muted text-sm font-normal">kcal</span>
          </span>
          <span className="text-fg-muted tabular text-sm">
            <span className="text-protein">P {formatGrams(totals.protein)}</span>
            {' · '}
            <span className="text-carbs">C {formatGrams(totals.carbs)}</span>
            {' · '}
            <span className="text-fat">F {formatGrams(totals.fat)}</span>
          </span>
        </div>
        <p className="text-fg-muted text-xs">
          Day after:{' '}
          <span className="text-fg tabular font-medium">{formatKcal(dayKcal + totals.kcal)}</span>
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
    </form>
  );
}
