import {
  scaleNutrients,
  sumNutrients,
  type Food,
  type FoodBasis,
  type FoodKind,
  type MealTemplate,
  type Nutrients,
} from '@plate/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useFieldArray, useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NumberField } from '@/components/ui/number-field';
import { FoodPickerSheet } from '@/features/foods/FoodPickerSheet';
import { formatGrams, formatKcal } from '@/lib/format';
import {
  EMPTY_MEAL_FORM,
  fromTemplate,
  mealFormSchema,
  parseAmount,
  type MealFormValues,
} from './meal-form-schema';

interface ItemFood {
  name: string;
  kind: FoodKind;
  basis: FoodBasis;
  per100: Nutrients;
  archivedAt: string | null;
}

export interface MealTemplateFormProps {
  mode: 'create' | 'edit';
  template?: MealTemplate | undefined;
  /** The library (archived foods included) to resolve item names and values. */
  library: readonly Food[];
  onSubmit: (values: MealFormValues) => Promise<void>;
  formRef?: (form: UseFormReturn<MealFormValues>) => void;
  submitting: boolean;
  /** Rendered next to the save button (archive/delete, "Log now"). */
  secondaryActions?: ReactNode;
  primaryExtra?: ReactNode;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Meal template editor (DESIGN §4.4): name, items with a food/dish picker and amounts, total preview. */
export function MealTemplateForm({
  mode,
  template,
  library,
  onSubmit,
  formRef,
  submitting,
  secondaryActions,
  primaryExtra,
}: MealTemplateFormProps) {
  const form = useForm<MealFormValues>({
    resolver: zodResolver(mealFormSchema),
    defaultValues: template ? fromTemplate(template) : EMPTY_MEAL_FORM,
    mode: 'onBlur',
  });
  useEffect(() => formRef?.(form), [form, formRef]);

  const items = useFieldArray({ control: form.control, name: 'items' });
  const watchedItems = useWatch({ control: form.control, name: 'items' });
  const errors = form.formState.errors;
  const [pickerOpen, setPickerOpen] = useState(false);

  const foodById = useMemo(() => {
    const map = new Map<number, ItemFood>();
    for (const i of template?.items ?? []) {
      map.set(i.foodId, {
        name: i.name,
        kind: i.kind,
        basis: i.basis,
        per100: i.per100,
        archivedAt: i.archivedAt,
      });
    }
    for (const f of library) {
      map.set(f.id, {
        name: f.name,
        kind: f.kind,
        basis: f.basis,
        per100: f.per100,
        archivedAt: f.archivedAt,
      });
    }
    return map;
  }, [template, library]);

  const lines = (watchedItems ?? []).map((row) => {
    const food = foodById.get(row.foodId);
    const amount = parseAmount(row.amount);
    return {
      food,
      amount,
      totals: food && amount !== null ? scaleNutrients(food.per100, amount) : null,
    };
  });
  const totals = sumNutrients(lines.flatMap((l) => (l.totals ? [l.totals] : [])));

  const addItem = (food: Food) => {
    if ((watchedItems ?? []).some((i) => i.foodId === food.id)) {
      toast(`${food.name} is already in this meal`);
      return;
    }
    items.append({ foodId: food.id, amount: fmt(food.portions[0]?.amount ?? 100) });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      <Field label="Name" error={errors.name?.message}>
        {(c) => (
          <Input
            id={c.id}
            aria-describedby={c['aria-describedby']}
            invalid={c.invalid}
            autoComplete="off"
            enterKeyHint="next"
            placeholder="e.g. Usual breakfast"
            {...form.register('name')}
          />
        )}
      </Field>

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-fg-muted text-xs font-semibold tracking-wide uppercase">Items</h3>
          <p className="text-fg-muted mt-1 text-sm">
            Foods and dishes with the amount you usually have. Each becomes its own diary entry.
          </p>
        </div>
        {items.fields.length > 0 ? (
          <ul className="divide-border border-border rounded-card divide-y border">
            {items.fields.map((field, index) => {
              const line = lines[index];
              const food = line?.food;
              const rowError = errors.items?.[index]?.amount?.message;
              return (
                <li key={field.id} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1 pt-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-fg truncate text-sm font-medium">
                        {food?.name ?? 'Unknown food'}
                      </span>
                      {food?.kind === 'dish' ? <Tag>Dish</Tag> : null}
                      {food?.archivedAt ? <Tag>Archived</Tag> : null}
                    </div>
                    <div className="text-fg-muted tabular mt-0.5 text-xs">
                      {food ? `${formatKcal(food.per100.kcal)} kcal/100 ${food.basis}` : '—'}
                      {line?.totals ? (
                        <>
                          {' · '}
                          <span className="text-fg font-medium">
                            {formatKcal(line.totals.kcal)} kcal
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="w-28 shrink-0">
                    <NumberField
                      aria-label={`${food?.name ?? 'Item'} amount in ${food?.basis ?? 'g'}`}
                      suffix={food?.basis ?? 'g'}
                      invalid={Boolean(rowError)}
                      enterKeyHint="next"
                      {...form.register(`items.${index}.amount`, {
                        onChange: () => {
                          if (errors.items?.[index]?.amount) {
                            void form.trigger(`items.${index}.amount`);
                          }
                        },
                      })}
                    />
                    {rowError ? <p className="text-danger mt-1 text-xs">{rowError}</p> : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${food?.name ?? 'item'}`}
                    onClick={() => items.remove(index)}
                  >
                    <Trash2 className="text-fg-muted size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-fg-faint border-border rounded-card border border-dashed px-4 py-6 text-center text-sm">
            No items yet.
          </p>
        )}
        {(errors.items?.root?.message ?? errors.items?.message) ? (
          <p role="alert" className="text-danger text-sm">
            {errors.items.root?.message ?? errors.items.message}
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setPickerOpen(true)}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add food or dish
        </Button>
      </section>

      <section
        className="bg-surface-2 rounded-card flex flex-col gap-2 px-4 py-3"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-fg-muted text-xs font-semibold tracking-wide uppercase">
            Total per log
          </span>
          <span className="text-fg tabular text-lg font-semibold">
            {formatKcal(totals.kcal)}{' '}
            <span className="text-fg-muted text-sm font-normal">kcal</span>
          </span>
        </div>
        <div className="text-fg-muted tabular flex flex-wrap gap-x-3 text-sm">
          <span className="text-protein">P {formatGrams(totals.protein)}</span>
          <span className="text-carbs">C {formatGrams(totals.carbs)}</span>
          <span className="text-fat">F {formatGrams(totals.fat)}</span>
          {totals.fiber !== null ? (
            <span className="text-fiber">Fiber {formatGrams(totals.fiber)}</span>
          ) : null}
        </div>
      </section>

      <div className="border-border flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">{secondaryActions}</div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {primaryExtra}
          <Button type="submit" loading={submitting}>
            {mode === 'create' ? 'Save meal' : 'Save changes'}
          </Button>
        </div>
      </div>

      <FoodPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Add to meal"
        description="Foods and dishes from your library."
        onPick={addItem}
      />
    </form>
  );
}
