import {
  computeDishPer100,
  dishPer100WithinBounds,
  dishRawWeight,
  servingGrams,
  type AiRecipeResponse,
  type AiSuggestedFood,
  type Category,
  type Dish,
  type Food,
  type FoodBasis,
  type Nutrients,
} from '@plate/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Controller, useFieldArray, useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { lazyNamed } from '@/app/lazy';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NumberField } from '@/components/ui/number-field';
import { Select } from '@/components/ui/select';
import { Tag } from '@/components/ui/chip';
import { FoodPickerSheet } from '@/features/foods/FoodPickerSheet';
import { cn } from '@/lib/cn';
import { formatGrams, formatKcal, formatQuantity } from '@/lib/format';
import {
  EMPTY_DISH_FORM,
  dishFormSchema,
  fromDish,
  parseAmount,
  type DishFormValues,
} from './dish-form-schema';

// Loaded the first time "Paste a recipe" is pressed (Phase 11); its own chunk.
const AiRecipeSheet = lazyNamed(() => import('@/features/ai/AiRecipeSheet'), 'AiRecipeSheet');

/** What the form needs to know about an ingredient food (current values, not a snapshot). */
export interface IngredientFood {
  name: string;
  brand: string | null;
  basis: FoodBasis;
  per100: Nutrients;
  archivedAt: string | null;
}

export interface DishFormProps {
  mode: 'create' | 'edit';
  dish?: Dish | undefined;
  categories: readonly Category[];
  /** The library (archived foods included) to resolve ingredient names and values. */
  library: readonly Food[];
  onSubmit: (values: DishFormValues) => Promise<void>;
  formRef?: (form: UseFormReturn<DishFormValues>) => void;
  submitting: boolean;
  /** Edit mode: recalculates the stored values from the ingredients (FR-R2). */
  onRecalculate?: (() => void) | undefined;
  recalculating?: boolean;
  secondaryActions?: ReactNode;
  /** Shows "Paste a recipe" (Phase 11); false unless the server has an AI provider configured. */
  aiEnabled?: boolean;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const isNotDish = (food: Food) => food.kind !== 'dish';

/** A proposed food shown like a library one until the save creates it. */
function pendingFood(pending: AiSuggestedFood): IngredientFood {
  return {
    name: pending.name,
    brand: null,
    basis: pending.basis,
    per100: pending.per100,
    archivedAt: null,
  };
}

/**
 * Dish editor (DESIGN §4.3): ingredient rows with a food picker and amounts, raw total, cooked
 * weight (defaults to the raw total until edited), servings, and the live per-100 card.
 */
export function DishForm({
  mode,
  dish,
  categories,
  library,
  onSubmit,
  formRef,
  submitting,
  onRecalculate,
  recalculating = false,
  secondaryActions,
  aiEnabled = false,
}: DishFormProps) {
  const form = useForm<DishFormValues>({
    resolver: zodResolver(dishFormSchema),
    defaultValues: dish ? fromDish(dish) : EMPTY_DISH_FORM,
    mode: 'onBlur',
  });
  useEffect(() => formRef?.(form), [form, formRef]);

  const ingredients = useFieldArray({ control: form.control, name: 'ingredients' });
  const watchedIngredients = useWatch({ control: form.control, name: 'ingredients' });
  const watchedCooked = useWatch({ control: form.control, name: 'cookedWeight' });
  const watchedServings = useWatch({ control: form.control, name: 'servings' });
  const errors = form.formState.errors;

  // The cooked weight follows the raw total until the user types one (FR-R1).
  const [cookedAuto, setCookedAuto] = useState(mode === 'create');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);
  // Mounted on first use (lazy chunk) and kept so the sheet animates closed.
  const [recipeMounted, setRecipeMounted] = useState(false);

  const foodById = useMemo(() => {
    const map = new Map<number, IngredientFood>();
    for (const i of dish?.ingredients ?? []) {
      map.set(i.foodId, {
        name: i.name,
        brand: i.brand,
        basis: i.basis,
        per100: i.per100,
        archivedAt: i.archivedAt,
      });
    }
    for (const f of library) {
      map.set(f.id, {
        name: f.name,
        brand: f.brand,
        basis: f.basis,
        per100: f.per100,
        archivedAt: f.archivedAt,
      });
    }
    return map;
  }, [dish, library]);

  const lines = (watchedIngredients ?? []).map((row) => ({
    food:
      row.foodId !== null
        ? foodById.get(row.foodId)
        : row.pending
          ? pendingFood(row.pending)
          : undefined,
    pending: row.foodId === null && row.pending !== null,
    amount: parseAmount(row.amount),
  }));
  const rawWeight = dishRawWeight(
    lines.map((l) => ({ amount: l.amount ?? 0 })).filter((l) => l.amount > 0),
  );
  const cookedValue = cookedAuto ? (rawWeight > 0 ? fmt(rawWeight) : '') : watchedCooked;
  const cooked = parseAmount(cookedValue);
  const complete = lines.length > 0 && lines.every((l) => l.food && l.amount !== null);
  const per100 =
    complete && cooked !== null
      ? computeDishPer100(
          lines.map((l) => ({ per100: l.food!.per100, amount: l.amount! })),
          cooked,
        )
      : null;
  const outOfBounds = per100 !== null && !dishPer100WithinBounds(per100);
  const servings = parseAmount(watchedServings);
  const servingSize =
    servings !== null && Number.isInteger(servings) && cooked !== null
      ? servingGrams(cooked, servings)
      : null;

  // The same ingredient may appear on more than one line (oil for frying and for finishing, say);
  // the per-100 math simply sums the lines.
  const addIngredient = (food: Food) => {
    ingredients.append({
      foodId: food.id,
      pending: null,
      amount: fmt(food.portions[0]?.amount ?? 100),
    });
  };

  /**
   * A parsed recipe replaces the ingredient lines (matched foods by id, proposed ones as pending
   * rows created on save) and fills name, cooked weight and servings where the form has none.
   * Lines the model could neither match nor describe are dropped and counted in a toast.
   */
  const applyRecipe = (result: AiRecipeResponse) => {
    if (form.getValues('name').trim() === '') {
      form.setValue('name', result.name, { shouldDirty: true });
    }
    let skipped = 0;
    const rows: DishFormValues['ingredients'] = [];
    for (const line of result.ingredients) {
      if (line.matchedFoodId !== null && foodById.has(line.matchedFoodId)) {
        rows.push({ foodId: line.matchedFoodId, pending: null, amount: fmt(line.amount) });
      } else if (line.suggestedFood) {
        rows.push({ foodId: null, pending: line.suggestedFood, amount: fmt(line.amount) });
      } else {
        skipped += 1;
      }
    }
    ingredients.replace(rows);
    if (result.cookedWeight !== null) {
      setCookedAuto(false);
      form.setValue('cookedWeight', fmt(result.cookedWeight), { shouldDirty: true });
    }
    if (result.servings !== null) {
      form.setValue('servings', String(result.servings), { shouldDirty: true });
    }
    if (skipped > 0) {
      toast.message(
        `${skipped} ${skipped === 1 ? 'line needs' : 'lines need'} a food you pick by hand`,
        { description: 'Use "Add ingredient" for what the model could not place.' },
      );
    } else {
      toast.success(
        `Recipe applied: ${rows.length} ${rows.length === 1 ? 'ingredient' : 'ingredients'}`,
      );
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (cookedAuto) form.setValue('cookedWeight', cookedValue, { shouldDirty: true });
    void form.handleSubmit(onSubmit)();
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      {dish?.staleSince && onRecalculate ? (
        <div
          role="status"
          className="bg-under/10 text-under-fg rounded-card flex flex-col gap-3 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              <span className="font-medium">Ingredients changed since the last calculation.</span>{' '}
              Saved values: {formatKcal(dish.per100.kcal)} kcal per 100 g
              {per100 ? <>; the ingredients now give {formatKcal(per100.kcal)}</> : null}. Saving
              also recalculates.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 self-start sm:self-auto"
            onClick={onRecalculate}
            loading={recalculating}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Recalculate
          </Button>
        </div>
      ) : null}

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
              placeholder="e.g. Dal"
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
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-fg-muted text-xs font-semibold tracking-wide uppercase">
            Ingredients
          </h3>
          <p className="text-fg-muted mt-1 text-sm">
            Raw amounts, as weighed before cooking. Foods only; combine dishes in a meal template.
          </p>
        </div>
        {ingredients.fields.length > 0 ? (
          <ul className="divide-border border-border rounded-card divide-y border">
            {ingredients.fields.map((field, index) => {
              const line = lines[index];
              const food = line?.food;
              const rowError = errors.ingredients?.[index]?.amount?.message;
              const lineError = errors.ingredients?.[index]?.message;
              const kcal =
                food && line?.amount !== null && line?.amount !== undefined
                  ? (food.per100.kcal * line.amount) / 100
                  : null;
              return (
                <li key={field.id} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1 pt-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-fg truncate text-sm font-medium">
                        {food?.name ?? 'Unknown food'}
                      </span>
                      {food?.archivedAt ? <Tag>Archived</Tag> : null}
                      {line?.pending ? (
                        <Tag className="bg-accent-soft text-accent shrink-0">New food</Tag>
                      ) : null}
                    </div>
                    {lineError ? <p className="text-danger mt-0.5 text-xs">{lineError}</p> : null}
                    <div className="text-fg-muted tabular mt-0.5 text-xs">
                      {food ? `${formatKcal(food.per100.kcal)} kcal/100 ${food.basis}` : '—'}
                      {kcal !== null ? (
                        <>
                          {' · '}
                          <span className="text-fg font-medium">{formatKcal(kcal)} kcal</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="w-28 shrink-0">
                    <NumberField
                      aria-label={`${food?.name ?? 'Ingredient'} amount in ${food?.basis ?? 'g'}`}
                      suffix={food?.basis ?? 'g'}
                      invalid={Boolean(rowError)}
                      enterKeyHint="next"
                      {...form.register(`ingredients.${index}.amount`, {
                        onChange: () => {
                          if (errors.ingredients?.[index]?.amount) {
                            void form.trigger(`ingredients.${index}.amount`);
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
                    aria-label={`Remove ${food?.name ?? 'ingredient'}`}
                    onClick={() => ingredients.remove(index)}
                  >
                    <Trash2 className="text-fg-muted size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-fg-faint border-border rounded-card border border-dashed px-4 py-6 text-center text-sm">
            No ingredients yet.
          </p>
        )}
        {(errors.ingredients?.root?.message ?? errors.ingredients?.message) ? (
          <p role="alert" className="text-danger text-sm">
            {errors.ingredients.root?.message ?? errors.ingredients.message}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Add ingredient
            </Button>
            {aiEnabled ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setRecipeMounted(true);
                  setRecipeOpen(true);
                }}
              >
                <Sparkles className="size-4" aria-hidden="true" />
                Paste a recipe
              </Button>
            ) : null}
          </div>
          <span className="text-fg-muted tabular text-sm">
            Raw total <span className="text-fg font-medium">{formatQuantity(rawWeight, 'g')}</span>
          </span>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-fg-muted text-xs font-semibold tracking-wide uppercase">
          Cooked weight &amp; servings
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <Controller
            control={form.control}
            name="cookedWeight"
            render={({ field }) => (
              <Field
                label="Cooked weight"
                error={errors.cookedWeight?.message}
                labelExtra={
                  !cookedAuto && rawWeight > 0 ? (
                    <button
                      type="button"
                      className="text-accent font-medium"
                      onClick={() => {
                        setCookedAuto(true);
                        field.onChange(fmt(rawWeight));
                      }}
                    >
                      Use raw total
                    </button>
                  ) : cookedAuto ? (
                    'Raw total'
                  ) : undefined
                }
                {...(!errors.cookedWeight
                  ? {
                      description:
                        'Weigh the pot after cooking; water lost or added changes the density.',
                    }
                  : {})}
              >
                {(c) => (
                  <NumberField
                    id={c.id}
                    aria-describedby={c['aria-describedby']}
                    invalid={c.invalid}
                    suffix="g"
                    enterKeyHint="next"
                    name={field.name}
                    ref={field.ref}
                    value={cookedValue}
                    onBlur={() => {
                      // Validation reads the form value: sync the followed raw total first.
                      if (cookedAuto) field.onChange(cookedValue);
                      field.onBlur();
                    }}
                    onChange={(e) => {
                      setCookedAuto(false);
                      field.onChange(e.target.value);
                    }}
                  />
                )}
              </Field>
            )}
          />
          <Field
            label="Servings"
            error={errors.servings?.message}
            {...(!errors.servings
              ? {
                  description:
                    servingSize !== null
                      ? `Adds the portion “1 serving = ${formatQuantity(servingSize, 'g')}”.`
                      : 'Optional. Adds a “1 serving” portion for logging.',
                }
              : {})}
          >
            {(c) => (
              <NumberField
                id={c.id}
                aria-describedby={c['aria-describedby']}
                invalid={c.invalid}
                placeholder="4"
                enterKeyHint="done"
                {...form.register('servings')}
              />
            )}
          </Field>
        </div>
      </section>

      <section
        className={cn(
          'rounded-card flex flex-col gap-2 px-4 py-3',
          outOfBounds ? 'bg-danger/10' : 'bg-surface-2',
        )}
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-fg-muted text-xs font-semibold tracking-wide uppercase">
            Per 100 g
          </span>
          <span className="text-fg tabular text-lg font-semibold">
            {per100 ? formatKcal(per100.kcal) : '—'}{' '}
            <span className="text-fg-muted text-sm font-normal">kcal</span>
          </span>
        </div>
        <div className="text-fg-muted tabular flex flex-wrap gap-x-3 text-sm">
          <span className="text-protein">P {per100 ? formatGrams(per100.protein) : '–'}</span>
          <span className="text-carbs">C {per100 ? formatGrams(per100.carbs) : '–'}</span>
          <span className="text-fat">F {per100 ? formatGrams(per100.fat) : '–'}</span>
          {per100?.fiber !== null && per100?.fiber !== undefined ? (
            <span className="text-fiber">Fiber {formatGrams(per100.fiber)}</span>
          ) : null}
        </div>
        {outOfBounds ? (
          <p role="alert" className="text-danger text-sm">
            More calories per 100 g than pure fat: the cooked weight is too low for these
            ingredients.
          </p>
        ) : !complete ? (
          <p className="text-fg-faint text-xs">
            Add ingredients with amounts and a cooked weight to see the nutrition.
          </p>
        ) : null}
      </section>

      <div className="border-border flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">{secondaryActions}</div>
        <Button type="submit" loading={submitting} disabled={outOfBounds}>
          {mode === 'create' ? 'Save dish' : 'Save changes'}
        </Button>
      </div>

      <FoodPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Add ingredient"
        description="Raw ingredients from your library."
        filter={isNotDish}
        onPick={addIngredient}
      />
      {aiEnabled && recipeMounted ? (
        <Suspense fallback={null}>
          <AiRecipeSheet open={recipeOpen} onOpenChange={setRecipeOpen} onApply={applyRecipe} />
        </Suspense>
      ) : null}
    </form>
  );
}
