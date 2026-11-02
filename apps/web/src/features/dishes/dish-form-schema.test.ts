import type { AiSuggestedFood, Dish } from '@plate/shared';
import { describe, expect, it } from 'vitest';
import { dishFormSchema, EMPTY_DISH_FORM, fromDish, toDishInput } from './dish-form-schema';

const ghee: AiSuggestedFood = {
  name: 'Ghee',
  brand: null,
  basis: 'g',
  per100: {
    kcal: 900,
    protein: 0,
    carbs: 0,
    fat: 100,
    fiber: null,
    sugar: null,
    saturatedFat: 62,
    sodiumMg: null,
  },
  portions: [{ label: '1 tbsp', amount: 15 }],
};

const base = { ...EMPTY_DISH_FORM, name: 'Dal tadka', cookedWeight: '800', servings: '4' };

describe('dishFormSchema ingredients', () => {
  it('accepts a library row and a pending (AI-proposed) row', () => {
    const result = dishFormSchema.safeParse({
      ...base,
      ingredients: [
        { foodId: 1, pending: null, amount: '200' },
        { foodId: null, pending: ghee, amount: '15' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a row with neither a food nor a pending one', () => {
    const result = dishFormSchema.safeParse({
      ...base,
      ingredients: [{ foodId: null, pending: null, amount: '5' }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => ({ path: i.path, message: i.message }))).toEqual([
      { path: ['ingredients', 0], message: 'Pick a food' },
    ]);
  });
});

describe('fromDish / toDishInput', () => {
  const dish: Dish = {
    id: 9,
    kind: 'dish',
    name: 'Dal tadka',
    brand: null,
    categoryId: null,
    basis: 'g',
    per100: {
      kcal: 120,
      protein: 7,
      carbs: 16,
      fat: 3,
      fiber: null,
      sugar: null,
      saturatedFat: null,
      sodiumMg: null,
    },
    portions: [],
    source: 'dish',
    offCode: null,
    estimatedAt: null,
    staleSince: null,
    archivedAt: null,
    createdAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    ingredients: [
      {
        id: 1,
        foodId: 1,
        sortOrder: 0,
        name: 'Red lentils',
        brand: null,
        basis: 'g',
        per100: {
          kcal: 350,
          protein: 24,
          carbs: 60,
          fat: 1,
          fiber: null,
          sugar: null,
          saturatedFat: null,
          sodiumMg: null,
        },
        amount: 200,
        archivedAt: null,
      },
    ],
    cookedWeight: 800,
    servings: 4,
  };

  it('loads a saved dish with no pending rows', () => {
    expect(fromDish(dish).ingredients).toEqual([{ foodId: 1, pending: null, amount: '200' }]);
  });

  it('builds the API input from resolved rows', () => {
    expect(
      toDishInput({
        ...base,
        ingredients: [
          { foodId: 1, amount: '200' },
          { foodId: 42, amount: '15' },
        ],
      }),
    ).toEqual({
      name: 'Dal tadka',
      brand: null,
      categoryId: null,
      ingredients: [
        { foodId: 1, amount: 200 },
        { foodId: 42, amount: 15 },
      ],
      cookedWeight: 800,
      servings: 4,
    });
  });
});
