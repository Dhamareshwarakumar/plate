import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEAL_SLOTS,
  mealSlotInputSchema,
  minutesToTimeString,
  pickSlotForTime,
  slotContainsMinute,
  slotWindowMiddleMinute,
  timeStringToMinutes,
  type MealSlot,
} from './mealSlots.js';

const slots: MealSlot[] = DEFAULT_MEAL_SLOTS.map((s, i) => ({
  id: i + 1,
  sortOrder: i,
  archivedAt: null,
  ...s,
}));
const byName = (name: string) => slots.find((s) => s.name === name)!;

describe('pickSlotForTime', () => {
  it('picks the slot whose window contains the time (start inclusive, end exclusive)', () => {
    expect(pickSlotForTime(slots, 7 * 60 + 40)?.name).toBe('Breakfast');
    expect(pickSlotForTime(slots, 10 * 60 + 30)?.name).toBe('Lunch');
    expect(pickSlotForTime(slots, 10 * 60 + 29)?.name).toBe('Breakfast');
    expect(pickSlotForTime(slots, 19 * 60)?.name).toBe('Dinner');
  });

  it('handles windows that wrap past midnight', () => {
    const late: MealSlot = {
      id: 9,
      name: 'Late night',
      sortOrder: 9,
      windowStartMin: 22 * 60,
      windowEndMin: 2 * 60,
      archivedAt: null,
    };
    expect(slotContainsMinute(late, 23 * 60)).toBe(true);
    expect(slotContainsMinute(late, 60)).toBe(true);
    expect(slotContainsMinute(late, 2 * 60)).toBe(false);
    expect(slotContainsMinute(late, 12 * 60)).toBe(false);
    expect(pickSlotForTime([...slots, late], 60)?.name).toBe('Late night');
  });

  it('resolves a gap to the nearest window boundary', () => {
    expect(pickSlotForTime(slots, 23 * 60)?.name).toBe('Dinner');
    expect(pickSlotForTime(slots, 4 * 60)?.name).toBe('Breakfast');
    // 01:30 is 210 min after Dinner ends and 210 min before Breakfast starts: the earlier slot wins.
    expect(pickSlotForTime(slots, 90)?.name).toBe('Breakfast');
  });

  it('falls back to the first slot by sort order when every slot is archived', () => {
    const archived = slots.map((s) => ({ ...s, archivedAt: '2025-01-01T00:00:00.000Z' }));
    expect(pickSlotForTime([...archived].reverse(), 12 * 60)?.name).toBe('Breakfast');
  });

  it('ignores archived slots when an active one exists', () => {
    const lunchArchived = slots.map((s) =>
      s.name === 'Lunch' ? { ...s, archivedAt: '2025-01-01T00:00:00.000Z' } : s,
    );
    expect(pickSlotForTime(lunchArchived, 12 * 60)?.name).toBe('Breakfast');
  });

  it('returns undefined for an empty list', () => {
    expect(pickSlotForTime([], 0)).toBeUndefined();
  });
});

describe('slotWindowMiddleMinute', () => {
  it('finds the middle of a normal window', () => {
    expect(slotWindowMiddleMinute(byName('Breakfast'))).toBe(7 * 60 + 45);
  });
  it('finds the middle of a wrapping window', () => {
    expect(slotWindowMiddleMinute({ windowStartMin: 22 * 60, windowEndMin: 2 * 60 })).toBe(0);
    expect(slotWindowMiddleMinute({ windowStartMin: 23 * 60, windowEndMin: 60 })).toBe(0);
  });
  it('treats an empty window as the whole day', () => {
    expect(slotWindowMiddleMinute({ windowStartMin: 300, windowEndMin: 300 })).toBe(
      (300 + 720) % 1440,
    );
  });
});

describe('time strings', () => {
  it('round-trips HH:mm', () => {
    expect(minutesToTimeString(0)).toBe('00:00');
    expect(minutesToTimeString(7 * 60 + 5)).toBe('07:05');
    expect(minutesToTimeString(23 * 60 + 59)).toBe('23:59');
    expect(timeStringToMinutes('07:05')).toBe(425);
    expect(timeStringToMinutes('23:59:30')).toBe(1439);
    expect(timeStringToMinutes('24:00')).toBeNull();
    expect(timeStringToMinutes('')).toBeNull();
  });
});

describe('mealSlotInputSchema', () => {
  it('bounds the window to minutes of a day', () => {
    expect(
      mealSlotInputSchema.safeParse({ name: 'Tea', windowStartMin: 0, windowEndMin: 1440 }).success,
    ).toBe(false);
    expect(
      mealSlotInputSchema.safeParse({ name: ' Tea ', windowStartMin: 900, windowEndMin: 960 }).data,
    ).toEqual({ name: 'Tea', windowStartMin: 900, windowEndMin: 960 });
  });
});
