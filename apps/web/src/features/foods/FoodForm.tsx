import { checkMacroSanity, type Category, type Food } from '@plate/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm, type UseFormReturn } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NumberField, parseDecimal } from '@/components/ui/number-field';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { EMPTY_FOOD_FORM, foodFormSchema, fromFood, type FoodFormValues } from './food-form-schema';

export interface FoodFormProps {
  food?: Food | undefined;
  categories: readonly Category[];
  /** Pre-fills the name for "Create 'xyz'" from a search with no results. */
  initialName?: string | undefined;
  onSubmit: (values: FoodFormValues, intent: 'save' | 'save-and-add') => Promise<void>;
  /** Called by the parent with the form instance so it can set server-side field errors. */
  formRef?: (form: UseFormReturn<FoodFormValues>) => void;
  submitting: boolean;
  mode: 'create' | 'edit';
  /** Rendered under the fields (archive/delete controls in edit mode). */
  secondaryActions?: React.ReactNode;
}

export function FoodForm({
  food,
  categories,
  initialName,
  onSubmit,
  formRef,
  submitting,
  mode,
  secondaryActions,
}: FoodFormProps) {
  const form = useForm<FoodFormValues>({
    resolver: zodResolver(foodFormSchema),
    defaultValues: food ? fromFood(food) : { ...EMPTY_FOOD_FORM, name: initialName ?? '' },
    mode: 'onBlur',
  });
  useEffect(() => formRef?.(form), [form, formRef]);

  const portions = useFieldArray({ control: form.control, name: 'portions' });
  const [moreOpen, setMoreOpen] = useState(() =>
    Boolean(
      food &&
      (food.per100.fiber !== null ||
        food.per100.sugar !== null ||
        food.per100.saturatedFat !== null ||
        food.per100.sodiumMg !== null),
    ),
  );

  const basis = form.watch('basis');
  const [kcal, protein, carbs, fat] = form.watch(['kcal', 'protein', 'carbs', 'fat']);
  const sanity = sanityHint({ kcal, protein, carbs, fat });

  const submit = (intent: 'save' | 'save-and-add') =>
    form.handleSubmit(async (values) => {
      await onSubmit(values, intent);
      if (intent === 'save-and-add') {
        form.reset({ ...EMPTY_FOOD_FORM, basis: values.basis, categoryId: values.categoryId });
        form.setFocus('name');
      }
    });

  const errors = form.formState.errors;

  return (
    <form onSubmit={submit('save')} noValidate className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <h3 className="text-fg-muted text-xs font-semibold tracking-wide uppercase">Basics</h3>
        <Field label="Name" error={errors.name?.message}>
          {(c) => (
            <Input
              id={c.id}
              aria-describedby={c['aria-describedby']}
              invalid={c.invalid}
              autoComplete="off"
              enterKeyHint="next"
              {...form.register('name')}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Brand" description="Optional" error={errors.brand?.message}>
            {(c) => (
              <Input
                id={c.id}
                aria-describedby={c['aria-describedby']}
                invalid={c.invalid}
                autoComplete="off"
                {...form.register('brand')}
              />
            )}
          </Field>
          <Field label="Category" error={errors.categoryId?.message}>
            {(c) => (
              <Select
                id={c.id}
                aria-describedby={c['aria-describedby']}
                invalid={c.invalid}
                {...form.register('categoryId')}
              >
                <option value="">No category</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-fg text-sm font-medium">Measured per 100</span>
          <Controller
            control={form.control}
            name="basis"
            render={({ field }) => (
              <Segmented
                aria-label="Unit"
                value={field.value}
                onChange={field.onChange}
                className="max-w-xs"
                options={[
                  { value: 'g', label: 'grams (g)' },
                  { value: 'ml', label: 'millilitres (ml)' },
                ]}
              />
            )}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-fg-muted text-xs font-semibold tracking-wide uppercase">
            Nutrition per 100 {basis}
          </h3>
          <p className="text-fg-muted mt-1 text-sm">
            Copy the "per 100 {basis}" column from the label.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
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
                enterKeyHint="next"
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
                enterKeyHint="next"
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
                enterKeyHint="next"
                {...form.register('fat')}
              />
            )}
          </Field>
        </div>
        {sanity ? (
          <p
            role={sanity.warn ? 'alert' : undefined}
            className={cn(
              'rounded-control px-3 py-2 text-sm',
              sanity.warn ? 'bg-under/10 text-under' : 'bg-surface-2 text-fg-muted',
            )}
          >
            {sanity.text}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className="text-accent flex items-center gap-1 self-start text-sm font-medium"
        >
          <ChevronDown
            className={cn('size-4 transition-transform', moreOpen && 'rotate-180')}
            aria-hidden="true"
          />
          {moreOpen ? 'Fewer nutrients' : 'More nutrients (fiber, sugar, saturated fat, sodium)'}
        </button>
        {moreOpen ? (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Fiber" error={errors.fiber?.message}>
              {(c) => (
                <NumberField
                  id={c.id}
                  aria-describedby={c['aria-describedby']}
                  invalid={c.invalid}
                  suffix="g"
                  {...form.register('fiber')}
                />
              )}
            </Field>
            <Field label="Sugar" error={errors.sugar?.message}>
              {(c) => (
                <NumberField
                  id={c.id}
                  aria-describedby={c['aria-describedby']}
                  invalid={c.invalid}
                  suffix="g"
                  {...form.register('sugar')}
                />
              )}
            </Field>
            <Field label="Saturated fat" error={errors.saturatedFat?.message}>
              {(c) => (
                <NumberField
                  id={c.id}
                  aria-describedby={c['aria-describedby']}
                  invalid={c.invalid}
                  suffix="g"
                  {...form.register('saturatedFat')}
                />
              )}
            </Field>
            <Field label="Sodium" error={errors.sodiumMg?.message}>
              {(c) => (
                <NumberField
                  id={c.id}
                  aria-describedby={c['aria-describedby']}
                  invalid={c.invalid}
                  suffix="mg"
                  {...form.register('sodiumMg')}
                />
              )}
            </Field>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-fg-muted text-xs font-semibold tracking-wide uppercase">Portions</h3>
          <p className="text-fg-muted mt-1 text-sm">
            Shortcuts for logging, like "1 medium = 118 {basis}". The diary always stores {basis}.
          </p>
        </div>
        {portions.fields.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {portions.fields.map((field, index) => {
              const rowErrors = errors.portions?.[index];
              return (
                <li
                  key={field.id}
                  className="grid grid-cols-[auto_1fr_7rem_auto] items-start gap-2"
                >
                  <span className="text-fg-faint flex h-11 items-center" aria-hidden="true">
                    <GripVertical className="size-4" />
                  </span>
                  <div>
                    <Input
                      aria-label={`Portion ${index + 1} label`}
                      placeholder="1 medium"
                      invalid={Boolean(rowErrors?.label)}
                      {...form.register(`portions.${index}.label`)}
                    />
                    {rowErrors?.label ? (
                      <p className="text-danger mt-1 text-xs">{rowErrors.label.message}</p>
                    ) : null}
                  </div>
                  <div>
                    <NumberField
                      aria-label={`Portion ${index + 1} amount in ${basis}`}
                      placeholder="118"
                      suffix={basis}
                      invalid={Boolean(rowErrors?.amount)}
                      {...form.register(`portions.${index}.amount`)}
                    />
                    {rowErrors?.amount ? (
                      <p className="text-danger mt-1 text-xs">{rowErrors.amount.message}</p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove portion ${index + 1}`}
                    onClick={() => portions.remove(index)}
                  >
                    <Trash2 className="text-fg-muted size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {(errors.portions?.root?.message ?? errors.portions?.message) ? (
          <p className="text-danger text-sm">
            {errors.portions.root?.message ?? errors.portions.message}
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => portions.append({ label: '', amount: '' })}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add portion
        </Button>
      </section>

      <div className="border-border flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">{secondaryActions}</div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {mode === 'create' ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void submit('save-and-add')()}
              disabled={submitting}
            >
              Save &amp; add another
            </Button>
          ) : null}
          <Button type="submit" loading={submitting}>
            {mode === 'create' ? 'Save food' : 'Save changes'}
          </Button>
        </div>
      </div>
    </form>
  );
}

function sanityHint(raw: {
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
}): { text: string; warn: boolean } | null {
  const kcal = parseDecimal(raw.kcal);
  const protein = parseDecimal(raw.protein);
  const carbs = parseDecimal(raw.carbs);
  const fat = parseDecimal(raw.fat);
  if ([kcal, protein, carbs, fat].some((v) => v === null || Number.isNaN(v))) return null;
  const check = checkMacroSanity({ kcal: kcal!, protein: protein!, carbs: carbs!, fat: fat! });
  const computed = Math.round(check.computedKcal);
  if (check.warn) {
    return {
      warn: true,
      text: `These macros add up to about ${computed} kcal, but you entered ${Math.round(kcal!)}. Double-check the label; one of them may be for a different serving size.`,
    };
  }
  return { warn: false, text: `Macros add up to about ${computed} kcal. Looks consistent.` };
}
