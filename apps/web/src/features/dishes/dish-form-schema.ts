import {
  aiSuggestedFoodSchema,
  DISH_INGREDIENTS_MAX,
  DISH_SERVINGS_MAX,
  DISH_WEIGHT_MAX,
  FOOD_BRAND_MAX,
  FOOD_NAME_MAX,
  type Dish,
  type DishInput,
} from '@plate/shared';
import { z } from 'zod';
import { parseDecimal } from '@/components/ui/number-field';

/** Positive decimal typed as a string; null when blank, NaN when garbage. */
export function parseAmount(raw: string): number | null {
  const n = parseDecimal(raw);
  return n === null || Number.isNaN(n) || n <= 0 ? null : n;
}

const positiveString = (label: string, max: number) =>
  z.string().superRefine((raw, ctx) => {
    const n = parseDecimal(raw);
    if (n === null) {
      ctx.addIssue({ code: 'custom', message: `${label} is required` });
      return;
    }
    if (Number.isNaN(n)) {
      ctx.addIssue({ code: 'custom', message: 'Enter a number' });
      return;
    }
    if (n <= 0) ctx.addIssue({ code: 'custom', message: `${label} must be above 0` });
    if (n > max) ctx.addIssue({ code: 'custom', message: `${label} is unrealistically large` });
  });

export const dishFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(FOOD_NAME_MAX, `At most ${FOOD_NAME_MAX} characters`),
  brand: z.string().trim().max(FOOD_BRAND_MAX, `At most ${FOOD_BRAND_MAX} characters`),
  /** '' means no category. */
  categoryId: z.string(),
  ingredients: z
    .array(
      z
        .object({
          /** A library food, or null while the line still waits for `pending` to be created. */
          foodId: z.number().int().positive().nullable(),
          /**
           * A food the recipe import proposed (Phase 11): shown as "New food" in the editor and
           * created with `source = 'ai'` when the dish is saved, never before.
           */
          pending: aiSuggestedFoodSchema.nullable(),
          amount: positiveString('Amount', DISH_WEIGHT_MAX),
        })
        .refine((i) => i.foodId !== null || i.pending !== null, { message: 'Pick a food' }),
    )
    .min(1, 'Add at least one ingredient')
    .max(DISH_INGREDIENTS_MAX, `At most ${DISH_INGREDIENTS_MAX} ingredients`),
  cookedWeight: positiveString('Cooked weight', DISH_WEIGHT_MAX),
  /** Optional whole number; '' means no serving portion. */
  servings: z.string().superRefine((raw, ctx) => {
    const n = parseDecimal(raw);
    if (n === null) return;
    if (Number.isNaN(n) || !Number.isInteger(n) || n < 1) {
      ctx.addIssue({ code: 'custom', message: 'Enter a whole number of servings' });
      return;
    }
    if (n > DISH_SERVINGS_MAX) ctx.addIssue({ code: 'custom', message: 'Too many servings' });
  }),
});
export type DishFormValues = z.infer<typeof dishFormSchema>;

export const EMPTY_DISH_FORM: DishFormValues = {
  name: '',
  brand: '',
  categoryId: '',
  ingredients: [],
  cookedWeight: '',
  servings: '',
};

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/** A validated form whose pending ingredients have been created: every line has a `foodId`. */
export type ResolvedDishFormValues = Omit<DishFormValues, 'ingredients'> & {
  ingredients: readonly { foodId: number; amount: string }[];
};

export function toDishInput(values: ResolvedDishFormValues): DishInput {
  const servings = parseDecimal(values.servings);
  return {
    name: values.name,
    brand: values.brand === '' ? null : values.brand,
    categoryId: values.categoryId === '' ? null : Number(values.categoryId),
    ingredients: values.ingredients.map((i) => ({
      foodId: i.foodId,
      amount: parseAmount(i.amount) ?? 0,
    })),
    cookedWeight: parseAmount(values.cookedWeight) ?? 0,
    servings: servings === null || Number.isNaN(servings) ? null : servings,
  };
}

export function fromDish(dish: Dish): DishFormValues {
  return {
    name: dish.name,
    brand: dish.brand ?? '',
    categoryId: dish.categoryId === null ? '' : String(dish.categoryId),
    ingredients: dish.ingredients.map((i) => ({
      foodId: i.foodId,
      pending: null,
      amount: fmt(i.amount),
    })),
    cookedWeight: fmt(dish.cookedWeight),
    servings: dish.servings === null ? '' : String(dish.servings),
  };
}
