import { describe, expect, it } from 'vitest';
import { daysBetween, isValidDayKey, shiftDayKey, weekStartKey } from './days.js';

describe('weekStartKey', () => {
  it('finds the Monday or Sunday starting the week of a day', () => {
    // 2025-10-19 is a Sunday, 2025-10-20 a Monday, 2025-10-22 a Wednesday.
    expect(weekStartKey('2025-10-19', 'monday')).toBe('2025-10-13');
    expect(weekStartKey('2025-10-19', 'sunday')).toBe('2025-10-19');
    expect(weekStartKey('2025-10-20', 'monday')).toBe('2025-10-20');
    expect(weekStartKey('2025-10-20', 'sunday')).toBe('2025-10-19');
    expect(weekStartKey('2025-10-22', 'monday')).toBe('2025-10-20');
    expect(weekStartKey('2025-10-22', 'sunday')).toBe('2025-10-19');
  });

  it('crosses month and year boundaries', () => {
    // 2026-01-01 is a Thursday.
    expect(weekStartKey('2026-01-01', 'monday')).toBe('2025-12-29');
    expect(weekStartKey('2026-01-01', 'sunday')).toBe('2025-12-28');
  });
});

describe('shiftDayKey', () => {
  it('moves across month and year boundaries', () => {
    expect(shiftDayKey('2025-10-19', 0)).toBe('2025-10-19');
    expect(shiftDayKey('2025-10-19', 1)).toBe('2025-10-20');
    expect(shiftDayKey('2025-10-31', 1)).toBe('2025-11-01');
    expect(shiftDayKey('2025-12-31', 1)).toBe('2026-01-01');
    expect(shiftDayKey('2025-01-01', -1)).toBe('2024-12-31');
    expect(shiftDayKey('2025-10-19', 49)).toBe('2025-12-07');
  });

  it('knows leap days', () => {
    expect(shiftDayKey('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDayKey('2025-02-28', 1)).toBe('2025-03-01');
    expect(shiftDayKey('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('inverts daysBetween', () => {
    const from = '2025-09-01';
    for (const days of [0, 6, 27, 100, -45]) {
      const to = shiftDayKey(from, days);
      expect(isValidDayKey(to)).toBe(true);
      expect(daysBetween(from, to)).toBe(days);
    }
  });
});
