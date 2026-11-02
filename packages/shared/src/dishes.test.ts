import { describe, expect, it } from 'vitest';
import {
  computeDishPer100,
  dishInputSchema,
  dishPer100WithinBounds,
  dishRawWeight,
  servingGrams,
} from './dishes.js';
import type { Nutrients } from './nutrition.js';

const per100 = (
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  fiber: number | null = null,
): Nutrients => ({
  kcal,
  protein,
  carbs,
  fat,
  fiber,
  sugar: null,
  saturatedFat: null,
  sodiumMg: null,
});

// Dal: 200 g red lentils, 15 g oil, 100 g onion, 20 g ghee; cooked with water to 980 g.
const lentils = per100(352, 24.6, 63.4, 1.1, 10.7);
const oil = per100(884, 0, 0, 100);
const onion = per100(40, 1.1, 9.3, 0.1, 1.7);
const ghee = per100(900, 0, 0, 100);
const dal = [
  { per100: lentils, amount: 200 },
  { per100: oil, amount: 15 },
  { per100: onion, amount: 100 },
  { per100: ghee, amount: 20 },
];

describe('computeDishPer100', () => {
  it('spreads the ingredient totals over the cooked weight (dal example)', () => {
    const result = computeDishPer100(dal, 980);
    // Raw totals: kcal 704 + 132.6 + 40 + 180 = 1056.6; protein 49.2 + 1.1 = 50.3; carbs 126.8 + 9.3 = 136.1;
    // fat 2.2 + 15 + 0.1 + 20 = 37.3; fiber 21.4 + 1.7 = 23.1. Per 100 g of 980 g cooked:
    expect(result.kcal).toBeCloseTo(107.82, 1);
    expect(result.protein).toBeCloseTo(5.13, 2);
    expect(result.carbs).toBeCloseTo(13.89, 2);
    expect(result.fat).toBeCloseTo(3.81, 2);
    expect(result.fiber).toBeCloseTo(2.36, 2);
    expect(result.sugar).toBeNull();
    expect(result.sodiumMg).toBeNull();
  });

  it('concentrates when the cooked weight is below the raw sum (water boiled off)', () => {
    const raw = dishRawWeight(dal);
    expect(raw).toBe(335);
    const reduced = computeDishPer100(dal, 300);
    const asIs = computeDishPer100(dal, raw);
    expect(reduced.kcal).toBeGreaterThan(asIs.kcal);
    expect(reduced.kcal).toBeCloseTo(1056.6 / 3, 5);
    expect(asIs.kcal).toBeCloseTo(1056.6 / 3.35, 5);
    // Physically impossible density (1,057 kcal per 100 g): the bounds check catches it for the API.
    expect(dishPer100WithinBounds(computeDishPer100(dal, 100))).toBe(false);
    expect(dishPer100WithinBounds(reduced)).toBe(true);
    expect(dishPer100WithinBounds(asIs)).toBe(true);
  });

  it('rejects a zero or negative cooked weight', () => {
    expect(() => computeDishPer100(dal, 0)).toThrow(RangeError);
    expect(() => computeDishPer100(dal, -5)).toThrow(RangeError);
    expect(() => computeDishPer100(dal, Number.NaN)).toThrow(RangeError);
  });

  it('stays within bounds on the 900 kcal edge instead of failing on float noise', () => {
    // 900 × 1.1 × (100 / 110) is 900.0000000000001 in IEEE 754; the result is rounded to 1e-6.
    const pureGhee = computeDishPer100([{ per100: ghee, amount: 110 }], 110);
    expect(pureGhee.kcal).toBe(900);
    expect(pureGhee.fat).toBe(100);
    expect(dishPer100WithinBounds(pureGhee)).toBe(true);
    // A real excess is still caught.
    expect(dishPer100WithinBounds(computeDishPer100([{ per100: ghee, amount: 110 }], 109))).toBe(
      false,
    );
  });

  it('keeps an optional nutrient null only when every ingredient lacks it', () => {
    const none = computeDishPer100(
      [
        { per100: oil, amount: 10 },
        { per100: ghee, amount: 10 },
      ],
      20,
    );
    expect(none.fiber).toBeNull();
    const some = computeDishPer100(
      [
        { per100: oil, amount: 10 },
        { per100: onion, amount: 100 },
      ],
      110,
    );
    expect(some.fiber).toBeCloseTo(1.7 / 1.1, 5);
  });

  it('returns zeros for an empty ingredient list', () => {
    expect(computeDishPer100([], 100)).toMatchObject({ kcal: 0, protein: 0, fiber: null });
  });
});

describe('servingGrams', () => {
  it('divides the cooked weight and rounds to a tenth', () => {
    expect(servingGrams(980, 4)).toBe(245);
    expect(servingGrams(1000, 3)).toBe(333.3);
  });
});

describe('dishInputSchema', () => {
  const valid = {
    name: ' Dal ',
    ingredients: [{ foodId: 1, amount: 200 }],
    cookedWeight: 980,
  };

  it('trims, defaults and accepts servings', () => {
    expect(dishInputSchema.parse(valid)).toEqual({
      name: 'Dal',
      brand: null,
      categoryId: null,
      ingredients: [{ foodId: 1, amount: 200 }],
      cookedWeight: 980,
      servings: null,
    });
    expect(dishInputSchema.parse({ ...valid, servings: 4 }).servings).toBe(4);
  });

  it('requires at least one and at most 50 ingredients', () => {
    expect(dishInputSchema.safeParse({ ...valid, ingredients: [] }).success).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => ({ foodId: i + 1, amount: 10 }));
    expect(dishInputSchema.safeParse({ ...valid, ingredients: many }).success).toBe(false);
  });

  it('rejects non-positive amounts, cooked weight and fractional or zero servings', () => {
    expect(
      dishInputSchema.safeParse({ ...valid, ingredients: [{ foodId: 1, amount: 0 }] }).success,
    ).toBe(false);
    expect(dishInputSchema.safeParse({ ...valid, cookedWeight: 0 }).success).toBe(false);
    expect(dishInputSchema.safeParse({ ...valid, servings: 0 }).success).toBe(false);
    expect(dishInputSchema.safeParse({ ...valid, servings: 2.5 }).success).toBe(false);
  });
});
