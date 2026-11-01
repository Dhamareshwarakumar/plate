import { describe, expect, it } from 'vitest';
import { localDayKey } from './days.js';
import {
  ACTIVITY_FACTORS,
  ACTIVITY_LEVELS,
  DEFAULT_SETTINGS,
  profileInputSchema,
  settingsPatchSchema,
  settingsSchema,
} from './settings.js';

describe('settingsSchema', () => {
  it('has sane defaults and bounds the tolerance', () => {
    expect(settingsSchema.parse(DEFAULT_SETTINGS)).toEqual({
      tolerancePct: 10,
      weekStart: 'monday',
    });
    expect(settingsSchema.safeParse({ tolerancePct: 26, weekStart: 'monday' }).success).toBe(false);
    expect(settingsSchema.safeParse({ tolerancePct: -1, weekStart: 'monday' }).success).toBe(false);
    expect(settingsSchema.safeParse({ tolerancePct: 7.5, weekStart: 'monday' }).success).toBe(
      false,
    );
    expect(settingsSchema.safeParse({ tolerancePct: 25, weekStart: 'sunday' }).success).toBe(true);
    expect(settingsSchema.safeParse({ tolerancePct: 10, weekStart: 'friday' }).success).toBe(false);
  });

  it('patches need at least one key', () => {
    expect(settingsPatchSchema.safeParse({}).success).toBe(false);
    expect(settingsPatchSchema.parse({ tolerancePct: 15 })).toEqual({ tolerancePct: 15 });
    expect(settingsPatchSchema.parse({ weekStart: 'sunday' })).toEqual({ weekStart: 'sunday' });
  });
});

describe('profileInputSchema', () => {
  const base = { sex: 'male', birthDate: '1995-06-15', heightCm: 180, activity: 'moderate' };
  const path = (input: unknown) =>
    profileInputSchema.safeParse(input).error?.issues.map((i) => i.path.join('.'));

  it('accepts a complete profile', () => {
    expect(profileInputSchema.parse(base)).toEqual(base);
  });

  it('rejects impossible values with the offending path', () => {
    expect(path({ ...base, birthDate: '2999-01-01' })).toEqual(['birthDate']);
    expect(path({ ...base, birthDate: '1899-12-31' })).toEqual(['birthDate']);
    expect(path({ ...base, birthDate: '2025-02-30' })).toEqual(['birthDate']);
    expect(path({ ...base, heightCm: 90 })).toEqual(['heightCm']);
    expect(path({ ...base, heightCm: 251 })).toEqual(['heightCm']);
    expect(path({ ...base, sex: 'x' })).toEqual(['sex']);
    expect(path({ ...base, activity: 'couch' })).toEqual(['activity']);
    expect(
      profileInputSchema.safeParse({ ...base, birthDate: localDayKey(new Date()) }).success,
    ).toBe(true);
  });

  it('has a factor for every activity level', () => {
    for (const level of ACTIVITY_LEVELS) expect(ACTIVITY_FACTORS[level]).toBeGreaterThan(1);
  });
});
