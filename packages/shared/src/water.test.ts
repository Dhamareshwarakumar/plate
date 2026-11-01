import { describe, expect, it } from 'vitest';
import { dayWaterSchema, waterEntryInputSchema } from './water.js';

describe('waterEntryInputSchema', () => {
  const path = (input: unknown) =>
    waterEntryInputSchema.safeParse(input).error?.issues.map((i) => i.path.join('.'));

  it('accepts whole millilitres between 1 and 5,000', () => {
    expect(waterEntryInputSchema.parse({ day: '2025-10-19', ml: 250 })).toEqual({
      day: '2025-10-19',
      ml: 250,
    });
    expect(waterEntryInputSchema.safeParse({ day: '2025-10-19', ml: 1 }).success).toBe(true);
    expect(waterEntryInputSchema.safeParse({ day: '2025-10-19', ml: 5000 }).success).toBe(true);
  });

  it('rejects out-of-range, fractional and bad-day input with the offending path', () => {
    expect(path({ day: '2025-10-19', ml: 0 })).toEqual(['ml']);
    expect(path({ day: '2025-10-19', ml: 5001 })).toEqual(['ml']);
    expect(path({ day: '2025-10-19', ml: 250.5 })).toEqual(['ml']);
    expect(path({ day: '2025-02-30', ml: 250 })).toEqual(['day']);
    expect(path({ ml: 250 })).toEqual(['day']);
  });
});

describe('dayWaterSchema', () => {
  it('describes a day total with its entries', () => {
    expect(
      dayWaterSchema.parse({
        ml: 750,
        entries: [{ id: 1, day: '2025-10-19', ml: 750, loggedAt: '2025-10-19T07:00:00.000Z' }],
      }).ml,
    ).toBe(750);
    expect(dayWaterSchema.safeParse({ ml: -1, entries: [] }).success).toBe(false);
  });
});
