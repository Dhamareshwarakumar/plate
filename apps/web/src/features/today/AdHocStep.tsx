import { type MealSlot } from '@plate/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Minus, Plus } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NumberField } from '@/components/ui/number-field';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { formatGrams, formatKcal } from '@/lib/format';
import {
  adHocFormSchema,
  adHocUnitNutrients,
  parsePositive,
  type AdHocFormValues,
} from './log-form-schemas';
import { defaultTimeFor } from './entry-helpers';

export interface AdHocStepProps {
  formId: string;
  day: string;
  slots: MealSlot[];
  initialSlotId: number;
  initialName?: string;
  dayKcal: number;
  onSubmit: (values: AdHocFormValues) => void;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Quick ad-hoc entry: name + calories (+ optional macros) for one labelled unit, times a count.
 * "Also save to library" asks for the unit's weight so per-100 g values can be derived.
 */
export function AdHocStep({
  formId,
  day,
  slots,
  initialSlotId,
  initialName = '',
  dayKcal,
  onSubmit,
}: AdHocStepProps) {
  const form = useForm<AdHocFormValues>({
    resolver: zodResolver(adHocFormSchema),
    defaultValues: {
      name: initialName,
      kcal: '',
      protein: '',
      carbs: '',
      fat: '',
      label: '1 serving',
      count: '1',
      saveToLibrary: false,
      weight: '',
      slotId: String(initialSlotId),
      time: defaultTimeFor(
        day,
        slots.find((s) => s.id === initialSlotId),
      ),
      note: '',
    },
    mode: 'onSubmit',
  });
  const errors = form.formState.errors;
  const [kcal, protein, carbs, fat, count, saveToLibrary, label] = useWatch({
    control: form.control,
    name: ['kcal', 'protein', 'carbs', 'fat', 'count', 'saveToLibrary', 'label'],
  });

  const unit = adHocUnitNutrients({ kcal, protein, carbs, fat });
  const n = parsePositive(count) ?? 0;
  const hasKcal = parsePositive(kcal) !== null || kcal.trim() === '0';
  const totalKcal = unit.kcal * n;

  const step = (delta: number) => {
    const next = Math.max(0.5, Math.round(((parsePositive(count) ?? 1) + delta) * 2) / 2);
    form.setValue('count', fmt(next), { shouldDirty: true });
  };

  return (
    <form
      id={formId}
      noValidate
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-4 pt-1"
    >
      <Field label="What did you eat?" error={errors.name?.message}>
        {(c) => (
          <Input
            id={c.id}
            aria-describedby={c['aria-describedby']}
            invalid={c.invalid}
            placeholder="e.g. Pizza slice"
            autoComplete="off"
            enterKeyHint="next"
            {...form.register('name')}
          />
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Portion" error={errors.label?.message}>
          {(c) => (
            <Input
              id={c.id}
              aria-describedby={c['aria-describedby']}
              invalid={c.invalid}
              placeholder="e.g. 1 slice"
              autoComplete="off"
              {...form.register('label')}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-fg text-sm font-medium" id={`${formId}-count-label`}>
            How many
          </span>
          <div
            className="bg-surface-2 flex h-11 items-center justify-between rounded-control p-1"
            role="group"
            aria-labelledby={`${formId}-count-label`}
          >
            <button
              type="button"
              onClick={() => step(-0.5)}
              aria-label="Fewer"
              disabled={n <= 0.5}
              className="text-fg hover:bg-surface flex size-9 items-center justify-center rounded-[0.5rem] disabled:opacity-40"
            >
              <Minus className="size-4" />
            </button>
            <input
              aria-label="Count"
              inputMode="decimal"
              className="text-fg tabular w-12 bg-transparent text-center text-base font-semibold outline-none"
              {...form.register('count')}
            />
            <button
              type="button"
              onClick={() => step(0.5)}
              aria-label="More"
              className="text-fg hover:bg-surface flex size-9 items-center justify-center rounded-[0.5rem]"
            >
              <Plus className="size-4" />
            </button>
          </div>
          {errors.count ? (
            <p role="alert" className="text-danger text-sm">
              {errors.count.message}
            </p>
          ) : null}
        </div>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-fg-muted mb-2 text-xs font-semibold tracking-wide uppercase">
          Per {label.trim() || 'portion'}{' '}
          <span className="font-normal normal-case">· macros optional</span>
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Calories" error={errors.kcal?.message}>
            {(c) => (
              <NumberField
                id={c.id}
                aria-describedby={c['aria-describedby']}
                invalid={c.invalid}
                suffix="kcal"
                enterKeyHint="next"
                {...form.register('kcal')}
              />
            )}
          </Field>
          <Field label="Protein" error={errors.protein?.message}>
            {(c) => (
              <NumberField
                id={c.id}
                aria-describedby={c['aria-describedby']}
                invalid={c.invalid}
                suffix="g"
                {...form.register('protein')}
              />
            )}
          </Field>
          <Field label="Carbs" error={errors.carbs?.message}>
            {(c) => (
              <NumberField
                id={c.id}
                aria-describedby={c['aria-describedby']}
                invalid={c.invalid}
                suffix="g"
                {...form.register('carbs')}
              />
            )}
          </Field>
          <Field label="Fat" error={errors.fat?.message}>
            {(c) => (
              <NumberField
                id={c.id}
                aria-describedby={c['aria-describedby']}
                invalid={c.invalid}
                suffix="g"
                {...form.register('fat')}
              />
            )}
          </Field>
        </div>
      </fieldset>

      <div className="bg-surface-2 rounded-card flex flex-col gap-1 px-4 py-3" aria-live="polite">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-fg tabular text-lg font-semibold">
            {hasKcal ? formatKcal(totalKcal) : '—'}{' '}
            <span className="text-fg-muted text-sm font-normal">kcal</span>
          </span>
          <span className="text-fg-muted tabular text-sm">
            <span className="text-protein">P {formatGrams(unit.protein * n)}</span>
            {' · '}
            <span className="text-carbs">C {formatGrams(unit.carbs * n)}</span>
            {' · '}
            <span className="text-fat">F {formatGrams(unit.fat * n)}</span>
          </span>
        </div>
        <p className="text-fg-muted text-xs">
          Day after:{' '}
          <span className="text-fg tabular font-medium">
            {formatKcal(dayKcal + (hasKcal ? totalKcal : 0))}
          </span>{' '}
          kcal
        </p>
      </div>

      <Controller
        control={form.control}
        name="saveToLibrary"
        render={({ field }) => (
          <label className="border-border flex cursor-pointer items-start gap-3 rounded-control border px-3.5 py-3">
            <input
              type="checkbox"
              checked={field.value}
              onChange={(e) => field.onChange(e.target.checked)}
              className="accent-accent mt-0.5 size-4"
            />
            <span className="min-w-0 flex-1">
              <span className="text-fg block text-sm font-medium">Also save to library</span>
              <span className="text-fg-muted block text-xs">
                Stores per-100 g values so you can log it again later. Needs the unit's weight.
              </span>
            </span>
          </label>
        )}
      />
      {saveToLibrary ? (
        <Field label={`Weight of ${label.trim() || 'one unit'}`} error={errors.weight?.message}>
          {(c) => (
            <NumberField
              id={c.id}
              aria-describedby={c['aria-describedby']}
              invalid={c.invalid}
              suffix="g"
              placeholder="e.g. 120"
              {...form.register('weight')}
            />
          )}
        </Field>
      ) : null}

      <div className={cn('grid grid-cols-2 gap-3')}>
        <Field label="Meal" error={errors.slotId?.message}>
          {(c) => (
            <Select
              id={c.id}
              aria-describedby={c['aria-describedby']}
              invalid={c.invalid}
              {...form.register('slotId')}
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
            autoComplete="off"
            {...form.register('note')}
          />
        )}
      </Field>
    </form>
  );
}
