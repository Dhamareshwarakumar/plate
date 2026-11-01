import { describe, expect, it } from 'vitest';
import {
  checkMacroSanity,
  macroSplit,
  nutrientsPer100Schema,
  roundNutrient,
  scaleNutrients,
  sumNutrients,
  type Nutrients,
} from './nutrition.js';

const banana: Nutrients = {
  kcal: 89,
  protein: 1.1,
  carbs: 22.8,
  fat: 0.3,
  fiber: 2.6,
  sugar: 12.2,
  saturatedFat: null,
  sodiumMg: 1,
};

describe('scaleNutrients', () => {
  it('scales every nutrient by quantity/100', () => {
    const r = scaleNutrients(banana, 450);
    expect(r.kcal).toBeCloseTo(400.5);
    expect(r.protein).toBeCloseTo(4.95);
    expect(r.carbs).toBeCloseTo(102.6);
    expect(r.fiber).toBeCloseTo(11.7);
    expect(r.saturatedFat).toBeNull();
    expect(r.sodiumMg).toBeCloseTo(4.5);
  });
  it('returns zeros for quantity 0', () => {
    expect(scaleNutrients(banana, 0).kcal).toBe(0);
  });
  it('rejects negative or non-finite quantities', () => {
    expect(() => scaleNutrients(banana, -1)).toThrow(RangeError);
    expect(() => scaleNutrients(banana, Number.NaN)).toThrow(RangeError);
  });
});

describe('sumNutrients', () => {
  it('adds required nutrients and keeps optional ones null only when null everywhere', () => {
    const a: Nutrients = { ...banana, fiber: null };
    const b: Nutrients = { ...banana, fiber: 3, saturatedFat: null };
    const total = sumNutrients([a, b]);
    expect(total.kcal).toBeCloseTo(178);
    expect(total.fiber).toBeCloseTo(3);
    expect(total.saturatedFat).toBeNull();
  });
  it('returns zero nutrients for an empty list', () => {
    expect(sumNutrients([]).kcal).toBe(0);
    expect(sumNutrients([]).fiber).toBeNull();
  });
});

describe('checkMacroSanity', () => {
  it('does not warn when macros match the stated kcal', () => {
    const r = checkMacroSanity({ kcal: 389, protein: 16.9, carbs: 66.3, fat: 6.9 });
    expect(r.warn).toBe(false);
    expect(r.deviation).toBeLessThan(0.25);
  });
  it('warns when kcal disagrees with the macros by more than 25%', () => {
    const r = checkMacroSanity({ kcal: 100, protein: 20, carbs: 20, fat: 20 });
    expect(r.computedKcal).toBe(340);
    expect(r.warn).toBe(true);
  });
  it('warns for 0 kcal with meaningful macros, not for water', () => {
    expect(checkMacroSanity({ kcal: 0, protein: 0, carbs: 0, fat: 0 }).warn).toBe(false);
    expect(checkMacroSanity({ kcal: 0, protein: 10, carbs: 0, fat: 0 }).warn).toBe(true);
  });
});

describe('macroSplit', () => {
  it('splits calories by macro and sums to 1', () => {
    const s = macroSplit({ protein: 30, carbs: 40, fat: 10 });
    expect(s).not.toBeNull();
    expect(s!.protein + s!.carbs + s!.fat).toBeCloseTo(1);
    expect(s!.fat).toBeCloseTo(90 / 370);
  });
  it('is null with no macros', () => {
    expect(macroSplit({ protein: 0, carbs: 0, fat: 0 })).toBeNull();
  });
});

describe('roundNutrient', () => {
  it('rounds kcal and sodium to integers and grams to one decimal', () => {
    expect(roundNutrient('kcal', 400.49)).toBe(400);
    expect(roundNutrient('sodiumMg', 4.5)).toBe(5);
    expect(roundNutrient('protein', 4.95)).toBe(5);
    expect(roundNutrient('carbs', 102.64)).toBe(102.6);
  });
});

describe('nutrientsPer100Schema', () => {
  it('accepts a label and rejects impossible values', () => {
    expect(nutrientsPer100Schema.safeParse(banana).success).toBe(true);
    expect(nutrientsPer100Schema.safeParse({ ...banana, fat: 101 }).success).toBe(false);
    expect(nutrientsPer100Schema.safeParse({ ...banana, kcal: -1 }).success).toBe(false);
  });
});
