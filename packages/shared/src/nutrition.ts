import { z } from 'zod';

/** Nutrient values per 100 g or 100 ml of a food, or absolute totals for an entry/day. */
export interface Nutrients {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
  sugar: number | null;
  saturatedFat: number | null;
  sodiumMg: number | null;
}

export const NUTRIENT_KEYS = [
  'kcal',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'sugar',
  'saturatedFat',
  'sodiumMg',
] as const satisfies readonly (keyof Nutrients)[];
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

export const OPTIONAL_NUTRIENT_KEYS = ['fiber', 'sugar', 'saturatedFat', 'sodiumMg'] as const;

const nonNegative = (max: number) => z.number().min(0).max(max);

/**
 * Per-100 values with physical upper bounds: nothing has more than 100 g of a macro per 100 g,
 * and pure fat is 900 kcal per 100 g.
 */
export const nutrientsPer100Schema = z.object({
  kcal: nonNegative(900),
  protein: nonNegative(100),
  carbs: nonNegative(100),
  fat: nonNegative(100),
  fiber: nonNegative(100).nullable(),
  sugar: nonNegative(100).nullable(),
  saturatedFat: nonNegative(100).nullable(),
  sodiumMg: nonNegative(100_000).nullable(),
});
export type NutrientsPer100 = z.infer<typeof nutrientsPer100Schema>;

export const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 } as const;

/** Scales per-100 values to an absolute quantity (grams or millilitres). Optional nutrients stay null. */
export function scaleNutrients(per100: Nutrients, quantity: number): Nutrients {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new RangeError(`quantity must be a non-negative finite number, got ${quantity}`);
  }
  const factor = quantity / 100;
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
}

export const ZERO_NUTRIENTS: Nutrients = {
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: null,
  sugar: null,
  saturatedFat: null,
  sodiumMg: null,
};

/**
 * Adds nutrient sets. An optional nutrient is null in the sum only when it is null in every input,
 * so one food without a fiber value does not erase the fiber of the others.
 */
export function sumNutrients(items: readonly Nutrients[]): Nutrients {
  const total: Nutrients = { ...ZERO_NUTRIENTS };
  for (const item of items) {
    total.kcal += item.kcal;
    total.protein += item.protein;
    total.carbs += item.carbs;
    total.fat += item.fat;
    for (const key of OPTIONAL_NUTRIENT_KEYS) {
      const value = item[key];
      if (value !== null) total[key] = (total[key] ?? 0) + value;
    }
  }
  return total;
}

export interface MacroSanityCheck {
  /** 4·protein + 4·carbs + 9·fat */
  computedKcal: number;
  /** |computed − stated| ÷ stated, or null when the stated kcal is 0. */
  deviation: number | null;
  /** True when the stated kcal disagrees with the macros by more than the threshold. */
  warn: boolean;
}

export const MACRO_SANITY_THRESHOLD = 0.25;

/** FR-F7: flags label typos such as kcal entered for a different serving size than the macros. */
export function checkMacroSanity(
  values: Pick<Nutrients, 'kcal' | 'protein' | 'carbs' | 'fat'>,
  threshold: number = MACRO_SANITY_THRESHOLD,
): MacroSanityCheck {
  const computedKcal =
    values.protein * KCAL_PER_GRAM.protein +
    values.carbs * KCAL_PER_GRAM.carbs +
    values.fat * KCAL_PER_GRAM.fat;
  if (values.kcal <= 0) {
    // 0 kcal with non-zero macros is the one case worth flagging here.
    return { computedKcal, deviation: null, warn: computedKcal > 20 };
  }
  const deviation = Math.abs(computedKcal - values.kcal) / values.kcal;
  return { computedKcal, deviation, warn: deviation > threshold };
}

export interface MacroSplit {
  protein: number;
  carbs: number;
  fat: number;
}

/** Share of calories from each macro (0..1). Normalised by the macro-derived kcal so the three add up to 1. */
export function macroSplit(
  values: Pick<Nutrients, 'protein' | 'carbs' | 'fat'>,
): MacroSplit | null {
  const p = values.protein * KCAL_PER_GRAM.protein;
  const c = values.carbs * KCAL_PER_GRAM.carbs;
  const f = values.fat * KCAL_PER_GRAM.fat;
  const total = p + c + f;
  if (total <= 0) return null;
  return { protein: p / total, carbs: c / total, fat: f / total };
}

/** Display rounding: kcal as whole numbers, grams to one decimal, sodium to whole mg. */
export function roundNutrient(key: NutrientKey, value: number): number {
  if (key === 'kcal' || key === 'sodiumMg') return Math.round(value);
  return Math.round(value * 10) / 10;
}
