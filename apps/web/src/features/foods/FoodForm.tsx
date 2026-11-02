import {
  checkMacroSanity,
  type AiEstimateFoodResponse,
  type Category,
  type Food,
  type NutrientsPer100,
  type OffResult,
} from '@plate/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowDown,
  ArrowUp,
  Barcode,
  ChevronDown,
  Globe,
  GripVertical,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Reorder, useDragControls } from 'motion/react';
import { Suspense, useEffect, useState } from 'react';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type FieldError,
  type UseFormReturn,
} from 'react-hook-form';
import { toast } from 'sonner';
import { lazyNamed } from '@/app/lazy';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NumberField, parseDecimal } from '@/components/ui/number-field';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import {
  EMPTY_FOOD_FORM,
  estimateToFormValues,
  foodFormSchema,
  fromFood,
  offResultToFormValues,
  per100Equals,
  type FoodFormValues,
} from './food-form-schema';
import { OffLookupSheet } from './OffLookupSheet';

// Loaded the first time "Estimate with AI" is pressed (Phase 11); its own chunk.
const AiEstimateSheet = lazyNamed(() => import('@/features/ai/AiEstimateSheet'), 'AiEstimateSheet');

/** Passed with the values on submit; `estimated` tells the API to record `source = 'ai'`. */
export interface FoodSubmitMeta {
  /** True when the nutrition fields still hold an accepted AI estimate unchanged. */
  estimated: boolean;
}

export interface FoodFormProps {
  food?: Food | undefined;
  categories: readonly Category[];
  /** Pre-fills the name for "Create 'xyz'" from a search with no results. */
  initialName?: string | undefined;
  /** A scanned barcode Open Food Facts did not know (log flow → "Create food manually"); kept on the food. */
  initialOffCode?: string | undefined;
  onSubmit: (
    values: FoodFormValues,
    intent: 'save' | 'save-and-add',
    meta: FoodSubmitMeta,
  ) => Promise<void>;
  /** Called by the parent with the form instance so it can set server-side field errors. */
  formRef?: (form: UseFormReturn<FoodFormValues>) => void;
  submitting: boolean;
  mode: 'create' | 'edit';
  /** Rendered under the fields (archive/delete controls in edit mode). */
  secondaryActions?: React.ReactNode;
  /** Hidden when the editor was opened from the log flow (one food, then back to the diary). */
  hideSaveAndAdd?: boolean;
  /** Shows "Search online" (FR-F5); false when the deployment disabled the Open Food Facts proxy. */
  offEnabled?: boolean;
  /** Shows "Estimate with AI" (Phase 11); false unless the server has an AI provider configured. */
  aiEnabled?: boolean;
}

export function FoodForm({
  food,
  categories,
  initialName,
  initialOffCode,
  onSubmit,
  formRef,
  submitting,
  mode,
  secondaryActions,
  hideSaveAndAdd = false,
  offEnabled = false,
  aiEnabled = false,
}: FoodFormProps) {
  const form = useForm<FoodFormValues>({
    resolver: zodResolver(foodFormSchema),
    defaultValues: food
      ? fromFood(food)
      : { ...EMPTY_FOOD_FORM, name: initialName ?? '', offCode: initialOffCode ?? '' },
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

  // `useWatch` rather than `form.watch()`: the React Compiler cannot memoize around `watch`.
  const basis = useWatch({ control: form.control, name: 'basis' });
  const offCode = useWatch({ control: form.control, name: 'offCode' });
  const name = useWatch({ control: form.control, name: 'name' });
  const brand = useWatch({ control: form.control, name: 'brand' });
  const [kcal, protein, carbs, fat, fiber, sugar, saturatedFat, sodiumMg] = useWatch({
    control: form.control,
    name: ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'saturatedFat', 'sodiumMg'],
  });
  const sanity = sanityHint({ kcal, protein, carbs, fat });
  const [lookupOpen, setLookupOpen] = useState(false);
  const [estimateOpen, setEstimateOpen] = useState(false);
  // Mounted on first use (lazy chunk) and kept so the sheet animates closed.
  const [estimateMounted, setEstimateMounted] = useState(false);
  // The per-100 values an accepted estimate wrote (or the saved estimate of an existing food).
  // While the fields still equal them the notice shows and the save keeps `source = 'ai'`.
  const [appliedEstimate, setAppliedEstimate] = useState<NutrientsPer100 | null>(
    food?.estimatedAt ? food.per100 : null,
  );
  const stillEstimated =
    appliedEstimate !== null &&
    per100Equals(
      { kcal, protein, carbs, fat, fiber, sugar, saturatedFat, sodiumMg },
      appliedEstimate,
    );

  /** Overwrites name, brand and every nutrition field; category, basis and portions stay as set. */
  const applyOffResult = (result: OffResult) => {
    // reset() rather than setValue() so stale field errors from a previous attempt are cleared too.
    form.reset(
      { ...form.getValues(), ...offResultToFormValues(result) },
      { keepDefaultValues: true },
    );
    const { fiber, sugar, saturatedFat, sodiumMg } = result.per100;
    if ([fiber, sugar, saturatedFat, sodiumMg].some((v) => v !== null)) setMoreOpen(true);
    toast.success(`Prefilled from ${result.name}`);
  };

  /** A barcode without an Open Food Facts product: remembered so a later scan finds this food. */
  const keepOffCode = (code: string) => {
    form.setValue('offCode', code, { shouldDirty: true });
    toast.success(`Barcode ${code} kept on this food`);
  };

  /** Overwrites nutrition, basis and portions with the accepted estimate; name and brand stay. */
  const applyEstimate = (result: AiEstimateFoodResponse) => {
    form.reset(
      { ...form.getValues(), ...estimateToFormValues(result) },
      { keepDefaultValues: true },
    );
    const optional = [
      result.per100.fiber,
      result.per100.sugar,
      result.per100.saturatedFat,
      result.per100.sodiumMg,
    ];
    if (optional.some((v) => v !== null)) setMoreOpen(true);
    setAppliedEstimate(result.per100);
    toast.success('Estimated — check the values before saving');
  };

  const submit = (intent: 'save' | 'save-and-add') =>
    form.handleSubmit(async (values) => {
      await onSubmit(values, intent, {
        estimated: appliedEstimate !== null && per100Equals(values, appliedEstimate),
      });
      if (intent === 'save-and-add') {
        form.reset({ ...EMPTY_FOOD_FORM, basis: values.basis, categoryId: values.categoryId });
        setAppliedEstimate(null);
        form.setFocus('name');
      }
    });

  const errors = form.formState.errors;
  const portionIds = portions.fields.map((field) => field.id);
  const movePortion = (from: number, to: number) => {
    if (to < 0 || to >= portions.fields.length || from === to) return;
    portions.move(from, to);
  };

  return (
    <>
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-[14rem] flex-1">
              <h3 className="text-fg-muted text-xs font-semibold tracking-wide uppercase">
                Nutrition per 100 {basis}
              </h3>
              <p className="text-fg-muted mt-1 text-sm">
                Copy the "per 100 {basis}" column from the label.
              </p>
            </div>
            {offEnabled || aiEnabled ? (
              // Wraps under the text on narrow screens, right-aligned, instead of squeezing it.
              <div className="ml-auto flex shrink-0 gap-2">
                {offEnabled ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setLookupOpen(true)}
                  >
                    <Globe className="size-4" aria-hidden="true" />
                    Search online
                  </Button>
                ) : null}
                {aiEnabled ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={name.trim() === ''}
                    title={name.trim() === '' ? 'Type a name first' : undefined}
                    onClick={() => {
                      setEstimateMounted(true);
                      setEstimateOpen(true);
                    }}
                  >
                    <Sparkles className="size-4" aria-hidden="true" />
                    Estimate with AI
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          {stillEstimated ? (
            <p
              role="status"
              className="bg-accent-soft text-accent -mt-1 flex items-start gap-2 rounded-control px-3 py-2 text-sm"
            >
              <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>Estimated by AI; verify against a label when you can.</span>
            </p>
          ) : null}
          {offCode !== '' ? (
            <p className="text-fg-muted -mt-1 flex items-center gap-1.5 text-xs">
              <Barcode className="text-accent size-3.5 shrink-0" aria-hidden="true" />
              <span>
                Barcode <span className="tabular">{offCode}</span> · scanning it logs this food
              </span>
            </p>
          ) : null}
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
            <h3 className="text-fg-muted text-xs font-semibold tracking-wide uppercase">
              Portions
            </h3>
            <p className="text-fg-muted mt-1 text-sm">
              Shortcuts for logging, like "1 medium = 118 {basis}". The diary always stores {basis}.
            </p>
          </div>
          {portions.fields.length > 0 ? (
            // Drag the handle (or press Space on a focused row, then the arrows) to reorder; the
            // move buttons are the keyboard fallback. `values` are the field-array ids, which
            // react-hook-form keeps stable across moves.
            <Reorder.Group
              axis="y"
              values={portionIds}
              onReorder={(order, moved) =>
                movePortion(portionIds.indexOf(moved), order.indexOf(moved))
              }
              className="flex flex-col gap-2"
              aria-label="Portions"
            >
              {portions.fields.map((field, index) => (
                <PortionRow
                  key={field.id}
                  id={field.id}
                  index={index}
                  count={portions.fields.length}
                  basis={basis}
                  form={form}
                  errors={errors.portions?.[index]}
                  onMove={movePortion}
                  onRemove={() => portions.remove(index)}
                />
              ))}
            </Reorder.Group>
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
            {mode === 'create' && !hideSaveAndAdd ? (
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
      {offEnabled ? (
        <OffLookupSheet
          open={lookupOpen}
          onOpenChange={setLookupOpen}
          initialQuery={form.getValues('name')}
          onPick={applyOffResult}
          onKeepCode={keepOffCode}
        />
      ) : null}
      {aiEnabled && estimateMounted ? (
        <Suspense fallback={null}>
          <AiEstimateSheet
            open={estimateOpen}
            onOpenChange={setEstimateOpen}
            name={name}
            brand={brand}
            onApply={applyEstimate}
          />
        </Suspense>
      ) : null}
    </>
  );
}

interface PortionRowProps {
  /** The field-array id; also the row's `Reorder.Item` value. */
  id: string;
  index: number;
  count: number;
  basis: FoodFormValues['basis'];
  form: UseFormReturn<FoodFormValues>;
  errors: { label?: FieldError | undefined; amount?: FieldError | undefined } | undefined;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}

/** One portion line: drag handle, label, amount, move up/down (keyboard fallback), remove. */
function PortionRow({ id, index, count, basis, form, errors, onMove, onRemove }: PortionRowProps) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02 }}
      className="bg-bg lg:bg-surface grid grid-cols-[auto_1fr_7rem_auto_auto] items-start gap-2 rounded-control"
    >
      <span
        aria-hidden="true"
        onPointerDown={(event) => controls.start(event)}
        className="text-fg-faint flex h-11 cursor-grab touch-none items-center active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </span>
      <div>
        <Input
          aria-label={`Portion ${index + 1} label`}
          placeholder="1 medium"
          invalid={Boolean(errors?.label)}
          {...form.register(`portions.${index}.label`)}
        />
        {errors?.label ? <p className="text-danger mt-1 text-xs">{errors.label.message}</p> : null}
      </div>
      <div>
        <NumberField
          aria-label={`Portion ${index + 1} amount in ${basis}`}
          placeholder="118"
          suffix={basis}
          invalid={Boolean(errors?.amount)}
          {...form.register(`portions.${index}.amount`)}
        />
        {errors?.amount ? (
          <p className="text-danger mt-1 text-xs">{errors.amount.message}</p>
        ) : null}
      </div>
      <div className="flex flex-col">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-5.5"
          aria-label={`Move portion ${index + 1} up`}
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-5.5"
          aria-label={`Move portion ${index + 1} down`}
          disabled={index === count - 1}
          onClick={() => onMove(index, index + 1)}
        >
          <ArrowDown className="size-3.5" />
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Remove portion ${index + 1}`}
        onClick={onRemove}
      >
        <Trash2 className="text-fg-muted size-4" />
      </Button>
    </Reorder.Item>
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
