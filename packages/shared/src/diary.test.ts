import { describe, expect, it } from 'vitest';
import {
  copyDaySchema,
  dayKeySchema,
  dayRangeQuerySchema,
  daysBetween,
  dayTotals,
  diaryEntryInputSchema,
  diaryEntryPatchSchema,
  entryTotals,
  isValidDayKey,
  loggedAtSchema,
} from './diary.js';

const per100 = {
  kcal: 89,
  protein: 1.1,
  carbs: 22.8,
  fat: 0.3,
  fiber: 2.6,
  sugar: null,
  saturatedFat: null,
  sodiumMg: null,
};

describe('day keys', () => {
  it('accepts real calendar dates only', () => {
    expect(isValidDayKey('2025-10-19')).toBe(true);
    expect(isValidDayKey('2024-02-29')).toBe(true);
    expect(isValidDayKey('2025-02-29')).toBe(false);
    expect(isValidDayKey('2025-02-30')).toBe(false);
    expect(isValidDayKey('2025-13-01')).toBe(false);
    expect(isValidDayKey('2025-00-10')).toBe(false);
    expect(isValidDayKey('2025-1-5')).toBe(false);
    expect(isValidDayKey('20251019')).toBe(false);
    expect(isValidDayKey('2025-10-19T00:00')).toBe(false);
    expect(dayKeySchema.safeParse('2025-02-30').success).toBe(false);
    expect(dayKeySchema.safeParse('2025-02-28').success).toBe(true);
  });

  it('counts days between keys', () => {
    expect(daysBetween('2025-10-19', '2025-10-19')).toBe(0);
    expect(daysBetween('2025-10-19', '2025-10-26')).toBe(7);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2025-02-28', '2025-03-01')).toBe(1);
  });

  it('bounds day ranges', () => {
    expect(dayRangeQuerySchema.safeParse({ from: '2025-10-19', to: '2025-10-18' }).success).toBe(
      false,
    );
    expect(dayRangeQuerySchema.safeParse({ from: '2025-10-19', to: '2025-10-19' }).success).toBe(
      true,
    );
    expect(dayRangeQuerySchema.safeParse({ from: '2024-01-01', to: '2025-12-31' }).success).toBe(
      false,
    );
  });
});

describe('loggedAtSchema', () => {
  it('requires a parseable ISO timestamp with a date-time prefix', () => {
    expect(loggedAtSchema.safeParse('2025-10-19T07:42:13+02:00').success).toBe(true);
    expect(loggedAtSchema.safeParse('2025-10-19T07:42:13.000Z').success).toBe(true);
    expect(loggedAtSchema.safeParse('2025-10-19').success).toBe(false);
    expect(loggedAtSchema.safeParse('Oct 19 2025 07:42').success).toBe(false);
    expect(loggedAtSchema.safeParse('2025-10-19T99:00:00Z').success).toBe(false);
  });
});

describe('diaryEntryInputSchema', () => {
  const base = {
    day: '2025-10-19',
    slotId: 1,
    loggedAt: '2025-10-19T07:42:13+02:00',
    quantity: 450,
  };

  it('accepts a food entry without per100 and applies defaults', () => {
    const parsed = diaryEntryInputSchema.parse({ ...base, foodId: 3 });
    expect(parsed).toMatchObject({
      foodId: 3,
      basis: 'g',
      portionLabel: null,
      portionCount: null,
      note: null,
    });
    expect(parsed.per100).toBeUndefined();
  });

  it('requires name and per100 for an ad-hoc entry', () => {
    const result = diaryEntryInputSchema.safeParse({ ...base, foodId: null });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['name', 'per100']));

    const ok = diaryEntryInputSchema.parse({
      ...base,
      name: ' Pizza slice ',
      per100,
      portionLabel: '1 slice',
      portionCount: 2,
    });
    expect(ok.name).toBe('Pizza slice');
    expect(ok.foodId).toBeNull();
  });

  it('lets an ad-hoc unit exceed per-100 physical bounds', () => {
    const ok = diaryEntryInputSchema.safeParse({
      ...base,
      foodId: null,
      name: 'Burger meal',
      per100: { ...per100, kcal: 1250 },
      quantity: 100,
    });
    expect(ok.success).toBe(true);
  });

  it('rejects non-positive and absurd quantities, long notes and bad days', () => {
    expect(diaryEntryInputSchema.safeParse({ ...base, foodId: 1, quantity: 0 }).success).toBe(
      false,
    );
    expect(diaryEntryInputSchema.safeParse({ ...base, foodId: 1, quantity: 100_001 }).success).toBe(
      false,
    );
    expect(
      diaryEntryInputSchema.safeParse({ ...base, foodId: 1, note: 'x'.repeat(281) }).success,
    ).toBe(false);
    expect(diaryEntryInputSchema.safeParse({ ...base, foodId: 1, day: '2025-02-30' }).success).toBe(
      false,
    );
  });
});

describe('diaryEntryPatchSchema', () => {
  it('needs at least one field', () => {
    expect(diaryEntryPatchSchema.safeParse({}).success).toBe(false);
    expect(diaryEntryPatchSchema.safeParse({ note: '' }).data).toEqual({ note: null });
    expect(diaryEntryPatchSchema.safeParse({ quantity: 50 }).success).toBe(true);
    expect(
      diaryEntryPatchSchema.safeParse({ portionLabel: null, portionCount: null }).data,
    ).toEqual({ portionLabel: null, portionCount: null });
  });
});

describe('copyDaySchema', () => {
  it('rejects copying a day or meal onto itself and a target without a source meal', () => {
    expect(copyDaySchema.safeParse({ fromDay: '2025-10-18', toDay: '2025-10-18' }).success).toBe(
      false,
    );
    expect(
      copyDaySchema.safeParse({ fromDay: '2025-10-18', toDay: '2025-10-18', slotId: 1 }).success,
    ).toBe(false);
    expect(
      copyDaySchema.safeParse({
        fromDay: '2025-10-18',
        toDay: '2025-10-18',
        slotId: 1,
        targetSlotId: 1,
      }).success,
    ).toBe(false);
    expect(
      copyDaySchema.safeParse({
        fromDay: '2025-10-18',
        toDay: '2025-10-18',
        slotId: 1,
        targetSlotId: 2,
      }).success,
    ).toBe(true);
    expect(
      copyDaySchema.safeParse({ fromDay: '2025-10-18', toDay: '2025-10-19', targetSlotId: 2 })
        .success,
    ).toBe(false);
    expect(copyDaySchema.safeParse({ fromDay: '2025-10-18', toDay: '2025-10-19' }).success).toBe(
      true,
    );
  });
});

describe('totals', () => {
  it('scales the snapshot and sums entries', () => {
    const totals = entryTotals(per100, 450);
    expect(totals.kcal).toBeCloseTo(400.5);
    expect(totals.protein).toBeCloseTo(4.95);
    expect(totals.fiber).toBeCloseTo(11.7);
    expect(totals.sugar).toBeNull();

    const day = dayTotals([{ totals }, { totals: entryTotals({ ...per100, fiber: null }, 50) }]);
    expect(day.kcal).toBeCloseTo(445);
    expect(day.fiber).toBeCloseTo(11.7);
    expect(day.sugar).toBeNull();
  });
});
