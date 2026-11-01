import { z } from 'zod';
import {
  FOOD_BRAND_MAX,
  FOOD_NAME_MAX,
  foodBasisSchema,
  foodSchema,
  idSchema,
  isoDateTimeSchema,
} from './foods.js';
import { nutrientsPer100Schema, sumNutrients, type Nutrients } from './nutrition.js';
import { optionalTrimmed, trimmed } from './zod-helpers.js';

export const DISH_INGREDIENTS_MIN = 1;
export const DISH_INGREDIENTS_MAX = 50;
export const DISH_WEIGHT_MAX = 100_000;
export const DISH_SERVINGS_MAX = 1000;
/** Label of the portion a dish gets when `servings` is set ("1 serving = 245 g"). */
export const SERVING_PORTION_LABEL = '1 serving';

const amountSchema = z
  .number()
  .positive('Amount must be greater than 0')
  .max(DISH_WEIGHT_MAX, 'Amount is unrealistically large');

export const dishIngredientInputSchema = z.object({
  foodId: idSchema,
  /** Raw amount in the ingredient's own basis (g or ml). */
  amount: amountSchema,
});
export type DishIngredientInput = z.infer<typeof dishIngredientInputSchema>;

/**
 * A dish (FR-R1): ingredient foods with raw amounts plus the cooked weight that the per-100 values
 * are spread over. `servings` creates the "1 serving" portion. Dishes are always measured in grams.
 */
export const dishInputSchema = z.object({
  name: trimmed(FOOD_NAME_MAX, 'Name'),
  brand: optionalTrimmed(FOOD_BRAND_MAX, 'Brand').default(null),
  categoryId: idSchema.nullable().default(null),
  ingredients: z
    .array(dishIngredientInputSchema)
    .min(DISH_INGREDIENTS_MIN, 'Add at least one ingredient')
    .max(DISH_INGREDIENTS_MAX, `At most ${DISH_INGREDIENTS_MAX} ingredients`),
  cookedWeight: z
    .number()
    .positive('Cooked weight must be greater than 0')
    .max(DISH_WEIGHT_MAX, 'Cooked weight is unrealistically large'),
  servings: z
    .number()
    .int('Servings must be a whole number')
    .positive('Servings must be at least 1')
    .max(DISH_SERVINGS_MAX, 'Servings is unrealistically large')
    .nullable()
    .default(null),
});
export type DishInput = z.input<typeof dishInputSchema>;
export type DishInputParsed = z.output<typeof dishInputSchema>;

/** An ingredient row with the *current* state of its food (not a snapshot; see `staleSince`). */
export const dishIngredientSchema = z.object({
  id: idSchema,
  foodId: idSchema,
  amount: z.number(),
  sortOrder: z.number().int(),
  name: z.string(),
  brand: z.string().nullable(),
  basis: foodBasisSchema,
  per100: nutrientsPer100Schema,
  archivedAt: isoDateTimeSchema.nullable(),
});
export type DishIngredient = z.infer<typeof dishIngredientSchema>;

/**
 * A dish is a food (`kind: 'dish'`) plus its recipe. `staleSince` is set when an ingredient food
 * was edited after the last calculation (FR-R2); the stored per-100 values stay until the dish is
 * saved or recalculated.
 */
export const dishSchema = foodSchema.extend({
  kind: z.literal('dish'),
  ingredients: z.array(dishIngredientSchema),
  cookedWeight: z.number().positive(),
  servings: z.number().int().positive().nullable(),
  staleSince: isoDateTimeSchema.nullable(),
});
export type Dish = z.infer<typeof dishSchema>;

// ---------- math ----------

export interface DishIngredientAmount {
  per100: Nutrients;
  amount: number;
}

/** Sum of the raw ingredient amounts; the default cooked weight (FR-R1). */
export function dishRawWeight(ingredients: readonly { amount: number }[]): number {
  return ingredients.reduce((sum, i) => sum + i.amount, 0);
}

/**
 * Per-100 g nutrition of a dish: `Σ(per100 × amount / 100) / cookedWeight × 100` for every
 * nutrient (TECH §4). Optional nutrients stay null only when no ingredient has a value.
 */
export function computeDishPer100(
  ingredients: readonly DishIngredientAmount[],
  cookedWeight: number,
): Nutrients {
  if (!Number.isFinite(cookedWeight) || cookedWeight <= 0) {
    throw new RangeError(`cookedWeight must be a positive finite number, got ${cookedWeight}`);
  }
  const total = sumNutrients(
    ingredients.map(({ per100, amount }) => {
      const factor = amount / 100;
      return {
        kcal: per100.kcal * factor,
        protein: per100.protein * factor,
        carbs: per100.carbs * factor,
        fat: per100.fat * factor,
        fiber: per100.fiber === null ? null : per100.fiber * factor,
        sugar: per100.sugar === null ? null : per100.sugar * factor,
        saturatedFat: per100.saturatedFat === null ? null : per100.saturatedFat * factor,
        sodiumMg: per100.sodiumMg === null ? null : per100.sodiumMg * factor,
      };
    }),
  );
  const factor = 100 / cookedWeight;
  return {
    kcal: total.kcal * factor,
    protein: total.protein * factor,
    carbs: total.carbs * factor,
    fat: total.fat * factor,
    fiber: total.fiber === null ? null : total.fiber * factor,
    sugar: total.sugar === null ? null : total.sugar * factor,
    saturatedFat: total.saturatedFat === null ? null : total.saturatedFat * factor,
    sodiumMg: total.sodiumMg === null ? null : total.sodiumMg * factor,
  };
}

/**
 * Checks a computed per-100 against the physical bounds of `nutrientsPer100Schema`. A cooked weight
 * far below the raw total (water does not turn into calories) produces values no food can have.
 */
export function dishPer100WithinBounds(per100: Nutrients): boolean {
  return nutrientsPer100Schema.safeParse(per100).success;
}

/** Grams of one serving, rounded to a tenth of a gram. */
export function servingGrams(cookedWeight: number, servings: number): number {
  return Math.round((cookedWeight / servings) * 10) / 10;
}
