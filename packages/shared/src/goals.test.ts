import { describe, expect, it } from 'vitest';
import {
  ageInYears,
  computeDayStatus,
  goalCalculateInputSchema,
  goalInputSchema,
  goalRemaining,
  macroPercentOfKcal,
  macroTargetsFromPreset,
  mifflinStJeor,
} from './goals.js';

describe('computeDayStatus', () => {
  it('needs entries first, then a goal', () => {
    expect(computeDayStatus(0, null, 0, 10)).toBe('not_logged');
    expect(computeDayStatus(0, 2000, 0, 10)).toBe('not_logged');
    expect(computeDayStatus(1500, null, 3, 10)).toBe('no_goal');
  });

  it('treats the band edges as on target', () => {
    expect(computeDayStatus(1800, 2000, 1, 10)).toBe('on_target');
    expect(computeDayStatus(2200, 2000, 1, 10)).toBe('on_target');
    expect(computeDayStatus(2000, 2000, 1, 10)).toBe('on_target');
    expect(computeDayStatus(1799.99, 2000, 1, 10)).toBe('under');
    expect(computeDayStatus(2200.01, 2000, 1, 10)).toBe('over');
  });

  it('survives float noise and a zero tolerance', () => {
    expect(computeDayStatus(1800.0000000002, 2000, 1, 10)).toBe('on_target');
    expect(computeDayStatus(2199.9999999998, 2000, 1, 10)).toBe('on_target');
    expect(computeDayStatus(2000, 2000, 1, 0)).toBe('on_target');
    expect(computeDayStatus(1999, 2000, 1, 0)).toBe('under');
    expect(computeDayStatus(2001, 2000, 1, 0)).toBe('over');
  });
});

describe('macroTargetsFromPreset', () => {
  it('fills whole grams from the presets', () => {
    expect(macroTargetsFromPreset(2000, 'balanced')).toEqual({
      proteinG: 150,
      carbsG: 200,
      fatG: 67,
    });
    expect(macroTargetsFromPreset(2000, 'high_protein')).toEqual({
      proteinG: 200,
      carbsG: 150,
      fatG: 67,
    });
    expect(macroTargetsFromPreset(2759, 'balanced')).toEqual({
      proteinG: 207,
      carbsG: 276,
      fatG: 92,
    });
  });

  it('accepts a custom split and rejects a bad one', () => {
    expect(macroTargetsFromPreset(1600, { protein: 25, carbs: 50, fat: 25 })).toEqual({
      proteinG: 100,
      carbsG: 200,
      fatG: 44,
    });
    expect(macroTargetsFromPreset(0, 'balanced')).toEqual({ proteinG: 0, carbsG: 0, fatG: 0 });
    expect(() => macroTargetsFromPreset(2000, { protein: 50, carbs: 40, fat: 30 })).toThrow(
      RangeError,
    );
    expect(() => macroTargetsFromPreset(-1, 'balanced')).toThrow(RangeError);
    expect(() => macroTargetsFromPreset(Number.NaN, 'balanced')).toThrow(RangeError);
  });
});

describe('macroPercentOfKcal', () => {
  it('shows each macro as a share of the kcal goal', () => {
    expect(macroPercentOfKcal({ kcal: 2000, proteinG: 150, carbsG: 200, fatG: 67 })).toEqual({
      protein: 30,
      carbs: 40,
      fat: 30,
    });
    expect(macroPercentOfKcal({ kcal: 0, proteinG: 150, carbsG: 200, fatG: 67 })).toBeNull();
  });
});

describe('ageInYears', () => {
  it('counts completed years, including a leap-day birthday', () => {
    expect(ageInYears('1995-06-15', '2025-10-19')).toBe(30);
    expect(ageInYears('1995-06-15', '2025-06-15')).toBe(30);
    expect(ageInYears('1995-06-15', '2025-06-14')).toBe(29);
    expect(ageInYears('2000-02-29', '2025-02-28')).toBe(24);
    expect(ageInYears('2000-02-29', '2025-03-01')).toBe(25);
    expect(ageInYears('2000-02-29', '2024-02-29')).toBe(24);
    expect(ageInYears('2030-01-01', '2025-01-01')).toBe(0);
  });
});

describe('mifflinStJeor', () => {
  it('matches hand-computed values for a moderately active man', () => {
    const result = mifflinStJeor({
      sex: 'male',
      birthDate: '1995-06-15',
      heightCm: 180,
      weightKg: 80,
      activity: 'moderate',
      today: '2025-10-19',
    });
    // 10·80 + 6.25·180 − 5·30 + 5 = 1780; × 1.55 = 2759
    expect(result).toEqual({
      bmr: 1780,
      tdee: 2759,
      suggestions: { maintain: 2759, lose025: 2484, lose05: 2209, gain025: 3034 },
      caution: false,
    });
  });

  it('flags a caution when the lowest suggestion drops under 1,200 kcal', () => {
    const result = mifflinStJeor({
      sex: 'female',
      birthDate: '2000-06-15',
      heightCm: 160,
      weightKg: 55,
      activity: 'sedentary',
      today: '2025-10-19',
    });
    // 10·55 + 6.25·160 − 5·25 − 161 = 1264; × 1.2 = 1516.8 → 1517
    expect(result.bmr).toBe(1264);
    expect(result.tdee).toBe(1517);
    expect(result.suggestions.lose05).toBe(967);
    expect(result.caution).toBe(true);
  });
});

describe('goalRemaining', () => {
  const totals = {
    kcal: 1420,
    protein: 86,
    carbs: 150,
    fat: 48,
    fiber: 18,
    sugar: null,
    saturatedFat: null,
    sodiumMg: null,
  };

  it('subtracts totals from the goal and allows negatives', () => {
    expect(
      goalRemaining({ kcal: 2000, proteinG: 150, carbsG: 220, fatG: 65, fiberG: 30 }, totals),
    ).toEqual({ kcal: 580, protein: 64, carbs: 70, fat: 17, fiber: 12 });
    expect(
      goalRemaining({ kcal: 1200, proteinG: 80, carbsG: 100, fatG: 40, fiberG: null }, totals),
    ).toEqual({ kcal: -220, protein: -6, carbs: -50, fat: -8, fiber: null });
  });

  it('treats missing fiber totals as zero when the goal sets fiber', () => {
    expect(
      goalRemaining(
        { kcal: 2000, proteinG: 150, carbsG: 220, fatG: 65, fiberG: 30 },
        { ...totals, fiber: null },
      ).fiber,
    ).toBe(30);
  });
});

describe('goalInputSchema', () => {
  const base = { effectiveFrom: '2025-10-01', kcal: 2000, proteinG: 150, carbsG: 220, fatG: 65 };

  it('defaults optional targets to null', () => {
    expect(goalInputSchema.parse(base)).toEqual({ ...base, fiberG: null, waterMl: null });
    expect(goalInputSchema.parse({ ...base, fiberG: 30, waterMl: 2500 })).toMatchObject({
      fiberG: 30,
      waterMl: 2500,
    });
  });

  it('enforces the bounds with the offending path', () => {
    const path = (input: unknown) =>
      goalInputSchema.safeParse(input).error?.issues.map((i) => i.path.join('.'));
    expect(path({ ...base, kcal: 400 })).toEqual(['kcal']);
    expect(path({ ...base, kcal: 10_001 })).toEqual(['kcal']);
    expect(path({ ...base, effectiveFrom: '2025-02-30' })).toEqual(['effectiveFrom']);
    expect(path({ ...base, proteinG: -1 })).toEqual(['proteinG']);
    expect(path({ ...base, fatG: 1001 })).toEqual(['fatG']);
    expect(path({ ...base, waterMl: 20_001 })).toEqual(['waterMl']);
  });
});

describe('goalCalculateInputSchema', () => {
  it('accepts an empty body and bounds the weight', () => {
    expect(goalCalculateInputSchema.parse({})).toEqual({});
    expect(goalCalculateInputSchema.parse({ weightKg: 80 })).toEqual({ weightKg: 80 });
    expect(goalCalculateInputSchema.safeParse({ weightKg: 10 }).success).toBe(false);
    expect(goalCalculateInputSchema.safeParse({ weightKg: 501 }).success).toBe(false);
  });
});
