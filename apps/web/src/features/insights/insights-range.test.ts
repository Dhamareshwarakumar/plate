import { describe, expect, it } from 'vitest';
import {
  canGoForward,
  isWeeklyView,
  parseRangeParams,
  periodFor,
  rangeLabel,
  rangeToParams,
  shiftRange,
  switchKind,
  type InsightsRange,
} from './insights-range';

const TODAY = '2025-10-19'; // a Sunday
const params = (s: string) => new URLSearchParams(s);

describe('parseRangeParams', () => {
  it('defaults to the week containing today, honouring the week start', () => {
    expect(parseRangeParams(params(''), TODAY, 1)).toEqual({
      kind: 'week',
      from: '2025-10-13',
      to: '2025-10-19',
    });
    expect(parseRangeParams(params(''), TODAY, 0)).toEqual({
      kind: 'week',
      from: '2025-10-19',
      to: '2025-10-25',
    });
    expect(parseRangeParams(params('range=bogus&from=2025-10-01'), TODAY, 1).kind).toBe('week');
  });

  it('snaps "from" to the start of the period', () => {
    expect(parseRangeParams(params('range=week&from=2025-10-15'), TODAY, 1)).toEqual({
      kind: 'week',
      from: '2025-10-13',
      to: '2025-10-19',
    });
    expect(parseRangeParams(params('range=month&from=2025-10-15'), TODAY, 1)).toEqual({
      kind: 'month',
      from: '2025-10-01',
      to: '2025-10-31',
    });
    // "from" names the first month of the block.
    expect(parseRangeParams(params('range=3m&from=2025-10-15'), TODAY, 1)).toEqual({
      kind: '3m',
      from: '2025-10-01',
      to: '2025-12-31',
    });
    expect(parseRangeParams(params('range=3m&from=2025-08-01'), TODAY, 1)).toEqual({
      kind: '3m',
      from: '2025-08-01',
      to: '2025-10-31',
    });
    expect(parseRangeParams(params('range=year&from=2025-10-15'), TODAY, 1)).toEqual({
      kind: 'year',
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it('anchors on today when "from" is missing or invalid', () => {
    expect(parseRangeParams(params('range=month'), TODAY, 1).from).toBe('2025-10-01');
    expect(parseRangeParams(params('range=month&from=2025-02-30'), TODAY, 1).from).toBe(
      '2025-10-01',
    );
  });

  it('accepts a custom span up to 731 days and falls back otherwise', () => {
    expect(
      parseRangeParams(params('range=custom&from=2025-09-01&to=2025-10-15'), TODAY, 1),
    ).toEqual({ kind: 'custom', from: '2025-09-01', to: '2025-10-15' });
    expect(
      parseRangeParams(params('range=custom&from=2024-01-01&to=2025-12-31'), TODAY, 1).kind,
    ).toBe('custom');
    for (const bad of [
      'range=custom&from=2024-01-01&to=2026-01-01', // 732 days
      'range=custom&from=2025-10-15&to=2025-09-01', // inverted
      'range=custom&from=2025-09-01', // no "to"
      'range=custom&from=2025-02-30&to=2025-03-01',
    ]) {
      expect(parseRangeParams(params(bad), TODAY, 1), bad).toEqual({
        kind: 'week',
        from: '2025-10-13',
        to: '2025-10-19',
      });
    }
  });
});

describe('rangeToParams', () => {
  it('writes the kind and start, plus the end for custom spans', () => {
    expect(rangeToParams(periodFor('month', TODAY, 1)).toString()).toBe(
      'range=month&from=2025-10-01',
    );
    expect(rangeToParams({ kind: 'custom', from: '2025-09-01', to: '2025-10-15' }).toString()).toBe(
      'range=custom&from=2025-09-01&to=2025-10-15',
    );
  });

  it('round-trips through parsing', () => {
    const ranges: [InsightsRange, 0 | 1][] = [
      [periodFor('week', TODAY, 0), 0],
      [periodFor('week', TODAY, 1), 1],
      [periodFor('month', TODAY, 1), 1],
      [periodFor('3m', TODAY, 1), 1],
      [periodFor('year', TODAY, 1), 1],
      [{ kind: 'custom', from: '2025-09-01', to: '2025-10-15' }, 1],
    ];
    for (const [range, weekStartsOn] of ranges) {
      expect(parseRangeParams(rangeToParams(range), TODAY, weekStartsOn)).toEqual(range);
    }
  });
});

describe('shiftRange', () => {
  it('moves weeks, months, quarters and years by one period', () => {
    const week = periodFor('week', TODAY, 1);
    expect(shiftRange(week, -1, 1)).toEqual({ kind: 'week', from: '2025-10-06', to: '2025-10-12' });
    expect(shiftRange(week, 1, 1)).toEqual({ kind: 'week', from: '2025-10-20', to: '2025-10-26' });

    const month = periodFor('month', TODAY, 1);
    expect(shiftRange(month, 1, 1)).toEqual({
      kind: 'month',
      from: '2025-11-01',
      to: '2025-11-30',
    });
    expect(shiftRange(periodFor('month', '2025-01-31', 1), 1, 1)).toEqual({
      kind: 'month',
      from: '2025-02-01',
      to: '2025-02-28',
    });

    const quarter = periodFor('3m', TODAY, 1); // Aug–Oct
    expect(shiftRange(quarter, -1, 1)).toEqual({
      kind: '3m',
      from: '2025-05-01',
      to: '2025-07-31',
    });
    expect(shiftRange(quarter, 1, 1)).toEqual({ kind: '3m', from: '2025-11-01', to: '2026-01-31' });

    const year = periodFor('year', TODAY, 1);
    expect(shiftRange(year, -1, 1)).toEqual({ kind: 'year', from: '2024-01-01', to: '2024-12-31' });
  });

  it('moves a custom span by its own length', () => {
    const custom: InsightsRange = { kind: 'custom', from: '2025-10-01', to: '2025-10-10' };
    expect(shiftRange(custom, 1, 1)).toEqual({
      kind: 'custom',
      from: '2025-10-11',
      to: '2025-10-20',
    });
    expect(shiftRange(custom, -1, 1)).toEqual({
      kind: 'custom',
      from: '2025-09-21',
      to: '2025-09-30',
    });
  });
});

describe('switchKind', () => {
  it('re-anchors on today when today is inside the range, else on the range start', () => {
    const thisWeek = periodFor('week', TODAY, 1);
    expect(switchKind(thisWeek, 'month', TODAY, 1).from).toBe('2025-10-01');
    const lastYear = periodFor('year', '2024-06-01', 1);
    expect(switchKind(lastYear, 'month', TODAY, 1)).toEqual({
      kind: 'month',
      from: '2024-01-01',
      to: '2024-01-31',
    });
    expect(switchKind(lastYear, 'week', TODAY, 1)).toEqual({
      kind: 'week',
      from: '2024-01-01',
      to: '2024-01-07',
    });
    const custom: InsightsRange = { kind: 'custom', from: '2025-09-01', to: '2025-10-25' };
    expect(switchKind(custom, '3m', TODAY, 1)).toEqual({
      kind: '3m',
      from: '2025-08-01',
      to: '2025-10-31',
    });
  });
});

describe('canGoForward', () => {
  it('stops once the next period would start after today', () => {
    expect(canGoForward(periodFor('week', TODAY, 1), TODAY, 1)).toBe(false);
    expect(canGoForward(periodFor('week', '2025-10-12', 1), TODAY, 1)).toBe(true);
    expect(canGoForward(periodFor('month', TODAY, 1), TODAY, 1)).toBe(false);
    expect(canGoForward(periodFor('month', '2025-09-30', 1), TODAY, 1)).toBe(true);
    expect(canGoForward(periodFor('year', TODAY, 1), TODAY, 1)).toBe(false);
    expect(canGoForward({ kind: 'custom', from: '2025-10-01', to: '2025-10-09' }, TODAY, 1)).toBe(
      true,
    );
    expect(canGoForward({ kind: 'custom', from: '2025-10-01', to: '2025-10-19' }, TODAY, 1)).toBe(
      false,
    );
  });
});

describe('rangeLabel', () => {
  it('formats each kind compactly', () => {
    expect(rangeLabel(periodFor('week', TODAY, 1))).toBe('13–19 Oct 2025');
    expect(rangeLabel(periodFor('week', '2025-10-01', 1))).toBe('29 Sep – 5 Oct 2025');
    expect(rangeLabel(periodFor('week', '2025-12-31', 1))).toBe('29 Dec 2025 – 4 Jan 2026');
    expect(rangeLabel(periodFor('month', TODAY, 1))).toBe('October 2025');
    expect(rangeLabel(periodFor('3m', TODAY, 1))).toBe('Aug–Oct 2025');
    expect(rangeLabel(periodFor('3m', '2026-01-15', 1))).toBe('Nov 2025 – Jan 2026');
    expect(rangeLabel(periodFor('year', TODAY, 1))).toBe('2025');
    expect(rangeLabel({ kind: 'custom', from: '2025-09-01', to: '2025-10-15' })).toBe(
      '1 Sep – 15 Oct 2025',
    );
    expect(rangeLabel({ kind: 'custom', from: '2025-10-15', to: '2025-10-15' })).toBe(
      '15 Oct 2025',
    );
  });
});

describe('isWeeklyView', () => {
  it('switches to weekly bars above 100 days', () => {
    expect(isWeeklyView(periodFor('3m', TODAY, 1))).toBe(false);
    expect(isWeeklyView(periodFor('year', TODAY, 1))).toBe(true);
    expect(isWeeklyView({ from: '2025-01-01', to: '2025-04-10' })).toBe(false); // 100 days
    expect(isWeeklyView({ from: '2025-01-01', to: '2025-04-11' })).toBe(true); // 101
  });
});
