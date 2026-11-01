import { describe, expect, it } from 'vitest';
import {
  logTemplateSchema,
  mealTemplateInputSchema,
  templateFromMealSchema,
} from './mealTemplates.js';

describe('mealTemplateInputSchema', () => {
  it('trims the name and keeps item order', () => {
    const parsed = mealTemplateInputSchema.parse({
      name: '  Usual breakfast ',
      items: [
        { foodId: 2, amount: 80 },
        { foodId: 1, amount: 118 },
      ],
    });
    expect(parsed.name).toBe('Usual breakfast');
    expect(parsed.items.map((i) => i.foodId)).toEqual([2, 1]);
  });

  it('requires 1 to 30 items with positive amounts', () => {
    expect(mealTemplateInputSchema.safeParse({ name: 'x', items: [] }).success).toBe(false);
    const many = Array.from({ length: 31 }, (_, i) => ({ foodId: i + 1, amount: 10 }));
    expect(mealTemplateInputSchema.safeParse({ name: 'x', items: many }).success).toBe(false);
    expect(
      mealTemplateInputSchema.safeParse({ name: 'x', items: [{ foodId: 1, amount: -1 }] }).success,
    ).toBe(false);
  });

  it('rejects a blank or overlong name', () => {
    expect(
      mealTemplateInputSchema.safeParse({ name: '  ', items: [{ foodId: 1, amount: 1 }] }).success,
    ).toBe(false);
    expect(
      mealTemplateInputSchema.safeParse({ name: 'x'.repeat(61), items: [{ foodId: 1, amount: 1 }] })
        .success,
    ).toBe(false);
  });
});

describe('logTemplateSchema', () => {
  it('defaults overrides to an empty list and accepts an optional time', () => {
    expect(logTemplateSchema.parse({ day: '2025-10-19', slotId: 1 })).toEqual({
      day: '2025-10-19',
      slotId: 1,
      overrides: [],
    });
    const withTime = logTemplateSchema.parse({
      day: '2025-10-19',
      slotId: 1,
      loggedAt: '2025-10-19T07:40:00+02:00',
      overrides: [{ index: 0, amount: 150 }],
    });
    expect(withTime.overrides).toEqual([{ index: 0, amount: 150 }]);
  });

  it('rejects invalid days, negative indexes and zero amounts', () => {
    expect(logTemplateSchema.safeParse({ day: '2025-02-30', slotId: 1 }).success).toBe(false);
    expect(
      logTemplateSchema.safeParse({
        day: '2025-10-19',
        slotId: 1,
        overrides: [{ index: -1, amount: 1 }],
      }).success,
    ).toBe(false);
    expect(
      logTemplateSchema.safeParse({
        day: '2025-10-19',
        slotId: 1,
        overrides: [{ index: 0, amount: 0 }],
      }).success,
    ).toBe(false);
  });
});

describe('templateFromMealSchema', () => {
  it('needs a day, a slot and a name', () => {
    expect(
      templateFromMealSchema.safeParse({ day: '2025-10-19', slotId: 1, name: 'Lunch' }).success,
    ).toBe(true);
    expect(templateFromMealSchema.safeParse({ day: '2025-10-19', slotId: 1 }).success).toBe(false);
  });
});
