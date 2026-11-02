import type { AiMealItem, Food } from '@plate/shared';
import { describe, expect, it } from 'vitest';
import { assignFood, loggableItems, reviewTotals, toReviewItems } from './review';

const dal: Food = {
  id: 1,
  kind: 'food',
  name: 'Dal',
  brand: null,
  categoryId: null,
  basis: 'g',
  per100: {
    kcal: 116,
    protein: 9,
    carbs: 20,
    fat: 0.4,
    fiber: null,
    sugar: null,
    saturatedFat: null,
    sodiumMg: null,
  },
  portions: [],
  source: 'manual',
  offCode: null,
  estimatedAt: null,
  staleSince: null,
  archivedAt: null,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};
const banana: Food = {
  ...dal,
  id: 2,
  name: 'Banana',
  basis: 'g',
  per100: { ...dal.per100, kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
};

// The fake provider's canned meal after the server sanitised it (item 3 named an unknown id).
const items: AiMealItem[] = [
  {
    description: '2 rotis',
    matchedFoodId: null,
    quantity: 80,
    basis: 'g',
    confidence: 'medium',
    suggestedFood: {
      name: 'Roti (whole wheat)',
      brand: null,
      basis: 'g',
      per100: {
        kcal: 297,
        protein: 9,
        carbs: 56,
        fat: 4,
        fiber: 7,
        sugar: null,
        saturatedFat: null,
        sodiumMg: null,
      },
      portions: [{ label: '1 roti', amount: 40 }],
    },
  },
  {
    description: 'a bowl of dal',
    matchedFoodId: 1,
    quantity: 200,
    basis: 'g',
    confidence: 'high',
    suggestedFood: null,
  },
  {
    description: 'one banana',
    matchedFoodId: null,
    quantity: 118,
    basis: 'g',
    confidence: 'medium',
    suggestedFood: null,
  },
];

describe('toReviewItems', () => {
  it('classifies rows as new / matched / needs_food and keeps the model quantity as text', () => {
    const rows = toReviewItems(items, [dal]);
    expect(rows.map((r) => r.state)).toEqual(['new', 'matched', 'needs_food']);
    expect(rows.map((r) => r.quantityText)).toEqual(['80', '200', '118']);
    expect(rows[1]?.food).toBe(dal);
    expect(rows[0]?.food).toBeNull();
    expect(rows.map((r) => r.key)).toEqual(['item-0', 'item-1', 'item-2']);
  });

  it('treats a matched id the library does not hold as needing a food', () => {
    const rows = toReviewItems(items, []);
    expect(rows[1]?.state).toBe('needs_food');
    expect(rows[1]?.food).toBeNull();
  });
});

describe('assignFood', () => {
  it('turns a needs_food row into a matched one in the food basis, keeping the quantity', () => {
    const [, , needs] = toReviewItems(items, [dal]);
    const picked = assignFood(needs!, { ...banana, basis: 'ml' });
    expect(picked.state).toBe('matched');
    expect(picked.matchedFoodId).toBe(2);
    expect(picked.basis).toBe('ml');
    expect(picked.quantityText).toBe('118');
    expect(picked.suggestedFood).toBeNull();
  });
});

describe('loggableItems / reviewTotals', () => {
  it('skips rows without a food and rows whose quantity is not above zero', () => {
    const rows = toReviewItems(items, [dal]);
    expect(loggableItems(rows).map((r) => r.description)).toEqual(['2 rotis', 'a bowl of dal']);
    const edited = rows.map((r) => (r.key === 'item-0' ? { ...r, quantityText: '0' } : r));
    expect(loggableItems(edited).map((r) => r.description)).toEqual(['a bowl of dal']);
    const garbage = rows.map((r) => (r.key === 'item-1' ? { ...r, quantityText: 'abc' } : r));
    expect(loggableItems(garbage).map((r) => r.description)).toEqual(['2 rotis']);
  });

  it('sums the suggested or library per-100 values at the edited quantities', () => {
    const rows = toReviewItems(items, [dal]);
    // 80 g roti → 237.6 kcal; 200 g dal → 232 kcal; the banana row has no food yet.
    expect(reviewTotals(rows).kcal).toBeCloseTo(469.6, 5);
    expect(reviewTotals(rows).protein).toBeCloseTo(7.2 + 18, 5);
    const halved = rows.map((r) => (r.key === 'item-1' ? { ...r, quantityText: '100' } : r));
    expect(reviewTotals(halved).kcal).toBeCloseTo(237.6 + 116, 5);
    expect(reviewTotals(toReviewItems([], [])).kcal).toBe(0);
  });
});
