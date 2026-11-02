import { describe, expect, it } from 'vitest';
import { foodInputSchema } from './foods.js';

const per100 = {
  kcal: 89,
  protein: 1.1,
  carbs: 22.8,
  fat: 0.3,
  fiber: null,
  sugar: null,
  saturatedFat: null,
  sodiumMg: null,
};

describe('foodInputSchema', () => {
  it('trims and defaults optional fields', () => {
    const r = foodInputSchema.parse({ name: '  Banana ', per100 });
    expect(r).toMatchObject({
      name: 'Banana',
      brand: null,
      categoryId: null,
      basis: 'g',
      portions: [],
    });
  });
  it('turns an empty brand into null', () => {
    expect(foodInputSchema.parse({ name: 'Banana', brand: '   ', per100 }).brand).toBeNull();
  });
  it('rejects an empty name and too many portions', () => {
    expect(foodInputSchema.safeParse({ name: ' ', per100 }).success).toBe(false);
    const portions = Array.from({ length: 21 }, (_, i) => ({ label: `p${i}`, amount: 10 }));
    expect(foodInputSchema.safeParse({ name: 'x', per100, portions }).success).toBe(false);
  });
  it('rejects non-positive portion amounts', () => {
    expect(
      foodInputSchema.safeParse({ name: 'x', per100, portions: [{ label: 'cup', amount: 0 }] })
        .success,
    ).toBe(false);
  });
  it('defaults offCode to null and accepts only digit codes', () => {
    expect(foodInputSchema.parse({ name: 'x', per100 }).offCode).toBeNull();
    expect(foodInputSchema.parse({ name: 'x', per100, offCode: '5000159484695' }).offCode).toBe(
      '5000159484695',
    );
    const r = foodInputSchema.safeParse({ name: 'x', per100, offCode: 'x' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['offCode']);
  });
});
