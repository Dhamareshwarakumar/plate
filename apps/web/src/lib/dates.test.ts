import { describe, expect, it } from 'vitest';
import {
  formatDayLabel,
  formatMonthLabel,
  isoAt,
  minutesOfIso,
  monthBounds,
  monthGrid,
  shiftDay,
  shiftMonth,
  timeOfIso,
  weekDays,
} from './dates';

describe('day arithmetic', () => {
  it('shifts across month and year ends', () => {
    expect(shiftDay('2025-10-31', 1)).toBe('2025-11-01');
    expect(shiftDay('2025-01-01', -1)).toBe('2024-12-31');
    expect(shiftDay('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDay('2025-10-19', 7)).toBe('2025-10-26');
  });

  it('moves by whole months to the first of the month', () => {
    expect(shiftMonth('2025-10-19', 1)).toBe('2025-11-01');
    expect(shiftMonth('2025-01-31', 1)).toBe('2025-02-01');
    expect(shiftMonth('2025-01-15', -1)).toBe('2024-12-01');
  });

  it('formats labels', () => {
    expect(formatDayLabel('2025-10-19')).toBe('Sun 19 Oct');
    expect(formatMonthLabel('2025-10-19')).toBe('Oct 2025');
  });
});

describe('grids', () => {
  it('builds a Monday-start week around the day', () => {
    expect(weekDays('2025-10-19')).toEqual([
      '2025-10-13',
      '2025-10-14',
      '2025-10-15',
      '2025-10-16',
      '2025-10-17',
      '2025-10-18',
      '2025-10-19',
    ]);
    expect(weekDays('2025-10-13')[0]).toBe('2025-10-13');
  });

  it('covers the month with full weeks', () => {
    const grid = monthGrid('2025-10-19');
    expect(grid).toHaveLength(5);
    expect(grid[0]).toEqual([
      '2025-09-29',
      '2025-09-30',
      '2025-10-01',
      '2025-10-02',
      '2025-10-03',
      '2025-10-04',
      '2025-10-05',
    ]);
    expect(grid[4]?.[6]).toBe('2025-11-02');
    expect(monthBounds('2025-02-10')).toEqual({ start: '2025-02-01', end: '2025-02-28' });
  });
});

describe('timestamps', () => {
  it('round-trips a day + minutes through a local ISO string', () => {
    const iso = isoAt('2025-10-19', 7 * 60 + 42);
    expect(iso.startsWith('2025-10-19T07:42:00')).toBe(true);
    expect(timeOfIso(iso)).toBe('07:42');
    expect(minutesOfIso(iso)).toBe(462);
  });
});
