import {
  FOOD_BRAND_MAX,
  FOOD_NAME_MAX,
  PORTION_LABEL_MAX,
  PORTIONS_MAX,
  type Food,
  type FoodInput,
  type OffResult,
} from '@plate/shared';
import { z } from 'zod';
import { parseDecimal } from '@/components/ui/number-field';

/**
 * Numeric fields are edited as strings (so "1,5" and a half-typed "1." are fine while typing) and
 * validated here; `toFoodInput` converts the validated form into the API shape.
 */
function numberString(options: { label: string; max: number; required: boolean }) {
  return z.string().superRefine((raw, ctx) => {
    const n = parseDecimal(raw);
    if (n === null) {
      if (options.required)
        ctx.addIssue({ code: 'custom', message: `${options.label} is required` });
      return;
    }
    if (Number.isNaN(n)) {
      ctx.addIssue({ code: 'custom', message: 'Enter a number' });
      return;
    }
    if (n < 0) ctx.addIssue({ code: 'custom', message: 'Cannot be negative' });
    if (n > options.max)
      ctx.addIssue({ code: 'custom', message: `At most ${options.max} per 100` });
  });
}

export const foodFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(FOOD_NAME_MAX, `At most ${FOOD_NAME_MAX} characters`),
  brand: z.string().trim().max(FOOD_BRAND_MAX, `At most ${FOOD_BRAND_MAX} characters`),
  /** '' means no category. */
  categoryId: z.string(),
  basis: z.enum(['g', 'ml']),
  kcal: numberString({ label: 'Calories', max: 900, required: true }),
  protein: numberString({ label: 'Protein', max: 100, required: true }),
  carbs: numberString({ label: 'Carbs', max: 100, required: true }),
  fat: numberString({ label: 'Fat', max: 100, required: true }),
  fiber: numberString({ label: 'Fiber', max: 100, required: false }),
  sugar: numberString({ label: 'Sugar', max: 100, required: false }),
  saturatedFat: numberString({ label: 'Saturated fat', max: 100, required: false }),
  sodiumMg: numberString({ label: 'Sodium', max: 100_000, required: false }),
  portions: z
    .array(
      z.object({
        label: z
          .string()
          .trim()
          .min(1, 'Label is required')
          .max(PORTION_LABEL_MAX, `At most ${PORTION_LABEL_MAX} characters`),
        amount: z.string().superRefine((raw, ctx) => {
          const n = parseDecimal(raw);
          if (n === null || Number.isNaN(n) || n <= 0) {
            ctx.addIssue({ code: 'custom', message: 'Enter an amount above 0' });
          }
        }),
      }),
    )
    .max(PORTIONS_MAX, `At most ${PORTIONS_MAX} portions`),
  /** Open Food Facts code of the result that prefilled the form; '' = none. Never rendered as an input. */
  offCode: z.string(),
});
export type FoodFormValues = z.infer<typeof foodFormSchema>;

export const EMPTY_FOOD_FORM: FoodFormValues = {
  name: '',
  brand: '',
  categoryId: '',
  basis: 'g',
  kcal: '',
  protein: '',
  carbs: '',
  fat: '',
  fiber: '',
  sugar: '',
  saturatedFat: '',
  sodiumMg: '',
  portions: [],
  offCode: '',
};

const num = (raw: string): number => parseDecimal(raw) ?? 0;
const optionalNum = (raw: string): number | null => {
  const n = parseDecimal(raw);
  return n === null || Number.isNaN(n) ? null : n;
};
const fmt = (n: number | null): string => (n === null ? '' : String(n));

export function toFoodInput(values: FoodFormValues): FoodInput {
  return {
    name: values.name,
    brand: values.brand === '' ? null : values.brand,
    categoryId: values.categoryId === '' ? null : Number(values.categoryId),
    basis: values.basis,
    per100: {
      kcal: num(values.kcal),
      protein: num(values.protein),
      carbs: num(values.carbs),
      fat: num(values.fat),
      fiber: optionalNum(values.fiber),
      sugar: optionalNum(values.sugar),
      saturatedFat: optionalNum(values.saturatedFat),
      sodiumMg: optionalNum(values.sodiumMg),
    },
    portions: values.portions.map((p) => ({ label: p.label, amount: num(p.amount) })),
    offCode: values.offCode === '' ? null : values.offCode,
  };
}

export function fromFood(food: Food): FoodFormValues {
  return {
    name: food.name,
    brand: food.brand ?? '',
    categoryId: food.categoryId === null ? '' : String(food.categoryId),
    basis: food.basis,
    kcal: fmt(food.per100.kcal),
    protein: fmt(food.per100.protein),
    carbs: fmt(food.per100.carbs),
    fat: fmt(food.per100.fat),
    fiber: fmt(food.per100.fiber),
    sugar: fmt(food.per100.sugar),
    saturatedFat: fmt(food.per100.saturatedFat),
    sodiumMg: fmt(food.per100.sodiumMg),
    portions: food.portions.map((p) => ({ label: p.label, amount: String(p.amount) })),
    offCode: food.offCode ?? '',
  };
}

export type OffPrefill = Pick<
  FoodFormValues,
  | 'name'
  | 'brand'
  | 'kcal'
  | 'protein'
  | 'carbs'
  | 'fat'
  | 'fiber'
  | 'sugar'
  | 'saturatedFat'
  | 'sodiumMg'
  | 'offCode'
>;

/** The fields a picked Open Food Facts result overwrites (FR-F5); category, basis and portions stay. */
export function offResultToFormValues(result: OffResult): OffPrefill {
  return {
    name: result.name,
    brand: result.brand ?? '',
    kcal: fmt(result.per100.kcal),
    protein: fmt(result.per100.protein),
    carbs: fmt(result.per100.carbs),
    fat: fmt(result.per100.fat),
    fiber: fmt(result.per100.fiber),
    sugar: fmt(result.per100.sugar),
    saturatedFat: fmt(result.per100.saturatedFat),
    sodiumMg: fmt(result.per100.sodiumMg),
    offCode: result.code,
  };
}

/** Maps API validation paths (`per100.kcal`, `portions.1.amount`) onto form field names. */
export function apiPathToFormField(path: string): string {
  return path.replace(/^per100\./, '');
}
