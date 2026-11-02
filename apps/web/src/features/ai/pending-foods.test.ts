import type { AiSuggestedFood, Food, FoodInput } from '@plate/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/api';
import { resolvePendingFoods, suggestedFoodInput } from './pending-foods';

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
const onion: AiSuggestedFood = {
  ...ghee,
  name: 'Onion',
  per100: { ...ghee.per100, kcal: 40, fat: 0.1, saturatedFat: null },
  portions: [{ label: '1 medium', amount: 110 }],
};

const created = (id: number, input: FoodInput): Food => ({
  id,
  kind: 'food',
  name: input.name,
  brand: null,
  categoryId: null,
  basis: input.basis ?? 'g',
  per100: input.per100,
  portions: [],
  source: 'ai',
  offCode: null,
  estimatedAt: '2026-11-02T10:00:00.000Z',
  staleSince: null,
  archivedAt: null,
  createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
});

describe('suggestedFoodInput', () => {
  it('marks the food as estimated and never carries a brand', () => {
    expect(suggestedFoodInput(ghee)).toEqual({
      name: 'Ghee',
      brand: null,
      basis: 'g',
      per100: ghee.per100,
      portions: ghee.portions,
      estimated: true,
    });
  });
});

describe('resolvePendingFoods', () => {
  it('creates the pending rows in order and leaves resolved rows alone', async () => {
    let nextId = 10;
    const create = vi.fn(async (input: FoodInput) => created(nextId++, input));
    const rows = [
      { foodId: 1, pending: null, amount: '200' },
      { foodId: null, pending: ghee, amount: '15' },
      { foodId: null, pending: onion, amount: '110' },
    ];
    const resolved = await resolvePendingFoods(rows, create);
    expect(resolved.map((r) => r.foodId)).toEqual([1, 10, 11]);
    expect(resolved.map((r) => r.amount)).toEqual(['200', '15', '110']);
    expect(create.mock.calls.map(([input]) => input.name)).toEqual(['Ghee', 'Onion']);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ estimated: true, brand: null });
  });

  it('reuses an active food whose name already exists (409) instead of failing', async () => {
    const create = vi.fn(async (input: FoodInput) => {
      if (input.name === 'Ghee') {
        throw new ApiClientError(409, 'CONFLICT', '"Ghee" already exists', {
          foodId: 42,
          archived: false,
        });
      }
      return created(11, input);
    });
    const resolved = await resolvePendingFoods(
      [
        { foodId: null, pending: ghee },
        { foodId: null, pending: onion },
      ],
      create,
    );
    expect(resolved.map((r) => r.foodId)).toEqual([42, 11]);
  });

  it('surfaces an archived clash and other failures with the food name in front', async () => {
    const archived = vi.fn(async () => {
      throw new ApiClientError(409, 'CONFLICT', '"Ghee" already exists (archived)', {
        foodId: 42,
        archived: true,
      });
    });
    await expect(
      resolvePendingFoods([{ foodId: null, pending: ghee }], archived),
    ).rejects.toMatchObject({ status: 409, message: '“Ghee”: "Ghee" already exists (archived)' });

    const invalid = vi.fn(async () => {
      throw new ApiClientError(400, 'VALIDATION_ERROR', 'Validation failed');
    });
    await expect(
      resolvePendingFoods([{ foodId: null, pending: onion }], invalid),
    ).rejects.toMatchObject({ status: 400, message: '“Onion”: Validation failed' });

    const network = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(resolvePendingFoods([{ foodId: null, pending: onion }], network)).rejects.toThrow(
      '“Onion”: could not be saved. Try again.',
    );
  });

  it('refuses a row with neither a food nor a suggestion', async () => {
    const create = vi.fn();
    await expect(resolvePendingFoods([{ foodId: null, pending: null }], create)).rejects.toThrow(
      'Pick a food for every line first.',
    );
    expect(create).not.toHaveBeenCalled();
  });
});
