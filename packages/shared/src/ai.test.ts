import { describe, expect, it } from 'vitest';
import {
  AI_RECIPE_TEXT_MAX,
  AI_TEXT_MAX,
  aiEstimateFoodRequestSchema,
  aiEstimateFoodResponseSchema,
  aiImageSchema,
  aiParseMealRequestSchema,
  aiParseMealResponseSchema,
  aiRecipeRequestSchema,
  aiRecipeResponseSchema,
  aiUsageQuerySchema,
  aiWeeklyDigestModelSchema,
  aiWeeklyDigestQuerySchema,
  aiWeeklyDigestResponseSchema,
} from './ai.js';

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const image = { mimeType: 'image/png', base64: PNG_1PX } as const;

const per100 = (kcal: number, protein: number, carbs: number, fat: number) => ({
  kcal,
  protein,
  carbs,
  fat,
  fiber: null,
  sugar: null,
  saturatedFat: null,
  sodiumMg: null,
});

/** The fake driver's canned parse-meal answer (API `FAKE_RESPONSES.parse_meal`); keep the two in step. */
const FAKE_PARSE_MEAL = {
  items: [
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
        per100: { ...per100(297, 9, 56, 4), fiber: 7 },
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
      matchedFoodId: 999999,
      quantity: 118,
      basis: 'g',
      confidence: 'medium',
      suggestedFood: null,
    },
  ],
  notes: 'Fake provider: canned answer for screenshots and tests.',
};

/** The fake driver's canned recipe (API `FAKE_RESPONSES.parse_recipe`). */
const FAKE_RECIPE = {
  name: 'Dal tadka',
  ingredients: [
    { description: '200 g red lentils', matchedFoodId: 1, amount: 200, suggestedFood: null },
    {
      description: '1 tbsp ghee',
      matchedFoodId: null,
      amount: 15,
      suggestedFood: {
        name: 'Ghee',
        brand: null,
        basis: 'g',
        per100: { ...per100(900, 0, 0, 100), saturatedFat: 62 },
        portions: [{ label: '1 tbsp', amount: 15 }],
      },
    },
    {
      description: '1 onion',
      matchedFoodId: null,
      amount: 110,
      suggestedFood: {
        name: 'Onion',
        brand: null,
        basis: 'g',
        per100: { ...per100(40, 1.1, 9.3, 0.1), fiber: 1.7, sugar: 4.2, sodiumMg: 4 },
        portions: [{ label: '1 medium', amount: 110 }],
      },
    },
    { description: 'salt to taste', matchedFoodId: 777777, amount: 5, suggestedFood: null },
  ],
  cookedWeight: 800,
  servings: 4,
};

const issuePaths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => i.path.join('.'));

describe('aiParseMealRequestSchema', () => {
  const base = { day: '2026-11-02', slotId: 3 };

  it('needs text or a photo and reports it on the text field', () => {
    const r = aiParseMealRequestSchema.safeParse(base);
    expect(r.success).toBe(false);
    expect(r.error!.issues).toEqual([
      expect.objectContaining({ path: ['text'], message: 'Describe the meal or add a photo' }),
    ]);
    expect(aiParseMealRequestSchema.safeParse({ ...base, text: '   ' }).success).toBe(false);
    expect(aiParseMealRequestSchema.safeParse({}).success).toBe(false);
  });

  it('accepts text only, trimming it', () => {
    expect(aiParseMealRequestSchema.parse({ ...base, text: ' 2 rotis and dal ' })).toEqual({
      ...base,
      text: '2 rotis and dal',
    });
  });

  it('accepts a photo only, with blank text becoming null', () => {
    expect(aiParseMealRequestSchema.parse({ ...base, image })).toEqual({
      ...base,
      text: null,
      image,
    });
    expect(aiParseMealRequestSchema.parse({ ...base, text: '  ', image }).text).toBeNull();
  });

  it('caps the text and validates day and slot', () => {
    expect(
      issuePaths(
        aiParseMealRequestSchema.safeParse({ ...base, text: 'x'.repeat(AI_TEXT_MAX + 1) }),
      ),
    ).toEqual(['text']);
    expect(
      aiParseMealRequestSchema.safeParse({ ...base, text: 'x'.repeat(AI_TEXT_MAX) }).success,
    ).toBe(true);
    expect(
      issuePaths(aiParseMealRequestSchema.safeParse({ text: 'x', day: 'nope', slotId: 1 })),
    ).toEqual(['day']);
    expect(
      issuePaths(aiParseMealRequestSchema.safeParse({ text: 'x', day: '2026-11-02', slotId: 0 })),
    ).toEqual(['slotId']);
  });
});

describe('aiImageSchema', () => {
  it('accepts base64 of the three allowed types', () => {
    expect(aiImageSchema.parse(image)).toEqual(image);
    expect(aiImageSchema.safeParse({ mimeType: 'image/jpeg', base64: '/9j/4AAQ' }).success).toBe(
      true,
    );
    expect(aiImageSchema.safeParse({ mimeType: 'image/webp', base64: 'UklGRg==' }).success).toBe(
      true,
    );
  });

  it('rejects non-base64 data, empty data, data URLs and other mime types', () => {
    expect(
      issuePaths(aiImageSchema.safeParse({ mimeType: 'image/png', base64: 'not base64!' })),
    ).toEqual(['base64']);
    expect(aiImageSchema.safeParse({ mimeType: 'image/png', base64: '' }).success).toBe(false);
    expect(
      aiImageSchema.safeParse({ mimeType: 'image/png', base64: `data:image/png;base64,${PNG_1PX}` })
        .success,
    ).toBe(false);
    expect(issuePaths(aiImageSchema.safeParse({ mimeType: 'image/gif', base64: PNG_1PX }))).toEqual(
      ['mimeType'],
    );
  });
});

describe('aiParseMealResponseSchema', () => {
  it("accepts the fake driver's canned answer", () => {
    expect(aiParseMealResponseSchema.parse(FAKE_PARSE_MEAL)).toEqual(FAKE_PARSE_MEAL);
  });

  it('re-applies the per-100 bounds to a suggested food', () => {
    const item = FAKE_PARSE_MEAL.items[0]!;
    const bad = {
      items: [{ ...item, suggestedFood: { ...item.suggestedFood, per100: per100(950, 9, 56, 4) } }],
      notes: null,
    };
    expect(issuePaths(aiParseMealResponseSchema.safeParse(bad))).toEqual([
      'items.0.suggestedFood.per100.kcal',
    ]);
  });

  it('rejects a brand on a suggested food, non-positive quantities and unknown confidence', () => {
    const item = FAKE_PARSE_MEAL.items[0]!;
    expect(
      issuePaths(
        aiParseMealResponseSchema.safeParse({
          items: [{ ...item, suggestedFood: { ...item.suggestedFood, brand: 'Aashirvaad' } }],
          notes: null,
        }),
      ),
    ).toEqual(['items.0.suggestedFood.brand']);
    expect(
      issuePaths(
        aiParseMealResponseSchema.safeParse({ items: [{ ...item, quantity: 0 }], notes: null }),
      ),
    ).toEqual(['items.0.quantity']);
    expect(
      aiParseMealResponseSchema.safeParse({ items: [{ ...item, confidence: 'sure' }], notes: null })
        .success,
    ).toBe(false);
  });

  it('accepts an empty result with notes and rejects more than 30 items', () => {
    expect(aiParseMealResponseSchema.parse({ items: [], notes: 'No food found.' })).toEqual({
      items: [],
      notes: 'No food found.',
    });
    const items = Array.from({ length: 31 }, () => FAKE_PARSE_MEAL.items[1]);
    expect(issuePaths(aiParseMealResponseSchema.safeParse({ items, notes: null }))).toEqual([
      'items',
    ]);
  });
});

describe('aiEstimateFoodRequestSchema', () => {
  it('trims the name and turns blank brand and hint into null', () => {
    expect(
      aiEstimateFoodRequestSchema.parse({ name: ' Sambar ', brand: '  ', description: '' }),
    ).toEqual({
      name: 'Sambar',
      brand: null,
      description: null,
    });
    expect(aiEstimateFoodRequestSchema.parse({ name: 'Sambar' })).toEqual({
      name: 'Sambar',
      brand: null,
      description: null,
    });
  });

  it('requires a name', () => {
    expect(issuePaths(aiEstimateFoodRequestSchema.safeParse({}))).toEqual(['name']);
    expect(issuePaths(aiEstimateFoodRequestSchema.safeParse({ name: '  ' }))).toEqual(['name']);
  });
});

describe('aiEstimateFoodResponseSchema', () => {
  const estimate = {
    per100: { ...per100(95, 3.2, 11, 4.1), fiber: 2.5, sodiumMg: 310 },
    basis: 'g',
    portions: [{ label: '1 bowl', amount: 200 }],
    confidence: 'medium',
    rationale: 'Typical homemade sambar: lentils, vegetables, tamarind and a tempering of oil.',
  };

  it("accepts the fake driver's estimate and caps the rationale", () => {
    expect(aiEstimateFoodResponseSchema.parse(estimate)).toEqual(estimate);
    expect(
      issuePaths(
        aiEstimateFoodResponseSchema.safeParse({ ...estimate, rationale: 'x'.repeat(301) }),
      ),
    ).toEqual(['rationale']);
  });
});

describe('aiRecipeRequestSchema', () => {
  it('caps the recipe text and requires it', () => {
    expect(aiRecipeRequestSchema.safeParse({ text: 'x'.repeat(AI_RECIPE_TEXT_MAX) }).success).toBe(
      true,
    );
    expect(
      issuePaths(aiRecipeRequestSchema.safeParse({ text: 'x'.repeat(AI_RECIPE_TEXT_MAX + 1) })),
    ).toEqual(['text']);
    expect(issuePaths(aiRecipeRequestSchema.safeParse({ text: '  ' }))).toEqual(['text']);
  });
});

describe('aiRecipeResponseSchema', () => {
  it("accepts the fake driver's recipe", () => {
    expect(aiRecipeResponseSchema.parse(FAKE_RECIPE)).toEqual(FAKE_RECIPE);
  });

  it('allows unknown cooked weight and servings but rejects zero or fractional servings', () => {
    expect(
      aiRecipeResponseSchema.safeParse({ ...FAKE_RECIPE, cookedWeight: null, servings: null })
        .success,
    ).toBe(true);
    expect(issuePaths(aiRecipeResponseSchema.safeParse({ ...FAKE_RECIPE, servings: 0 }))).toEqual([
      'servings',
    ]);
    expect(issuePaths(aiRecipeResponseSchema.safeParse({ ...FAKE_RECIPE, servings: 2.5 }))).toEqual(
      ['servings'],
    );
    expect(
      issuePaths(aiRecipeResponseSchema.safeParse({ ...FAKE_RECIPE, cookedWeight: 0 })),
    ).toEqual(['cookedWeight']);
  });
});

describe('weekly digest schemas', () => {
  const lines = [
    'You logged 5 of 7 days.',
    'Protein averaged 118 g.',
    'Oats showed up five times.',
  ];

  it('needs 3 to 5 lines', () => {
    expect(aiWeeklyDigestModelSchema.safeParse({ lines, suggestion: 'Plan Friday.' }).success).toBe(
      true,
    );
    expect(
      issuePaths(
        aiWeeklyDigestModelSchema.safeParse({ lines: lines.slice(0, 2), suggestion: 's' }),
      ),
    ).toEqual(['lines']);
    expect(
      issuePaths(
        aiWeeklyDigestModelSchema.safeParse({ lines: [...lines, 'a', 'b', 'c'], suggestion: 's' }),
      ),
    ).toEqual(['lines']);
  });

  it('the API response adds week, time and model', () => {
    const digest = {
      lines,
      suggestion: 'Plan Friday.',
      weekStart: '2026-10-26',
      generatedAt: '2026-11-02T09:00:00.000Z',
      model: 'fake-1',
    };
    expect(aiWeeklyDigestResponseSchema.parse(digest)).toEqual(digest);
    expect(
      issuePaths(aiWeeklyDigestResponseSchema.safeParse({ ...digest, weekStart: '2026-13-01' })),
    ).toEqual(['weekStart']);
  });

  it('the refresh flag defaults to false', () => {
    expect(aiWeeklyDigestQuerySchema.parse({})).toEqual({ refresh: false });
    expect(aiWeeklyDigestQuerySchema.parse({ refresh: 'true' })).toEqual({ refresh: true });
    expect(aiWeeklyDigestQuerySchema.safeParse({ refresh: 'yes' }).success).toBe(false);
  });
});

describe('aiUsageQuerySchema', () => {
  it('takes the local midnight as an ISO instant', () => {
    expect(aiUsageQuerySchema.parse({ dayStart: '2026-11-02T00:00:00+05:30' })).toEqual({
      dayStart: '2026-11-02T00:00:00+05:30',
    });
    expect(issuePaths(aiUsageQuerySchema.safeParse({}))).toEqual(['dayStart']);
    expect(issuePaths(aiUsageQuerySchema.safeParse({ dayStart: '2026-11-02' }))).toEqual([
      'dayStart',
    ]);
  });
});
