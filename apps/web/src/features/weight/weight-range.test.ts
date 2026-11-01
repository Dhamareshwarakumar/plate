import { describe, expect, it } from 'vitest';
import { inRange, parseRange, rangeBounds } from './weight-range';

describe('parseRange', () => {
  it('accepts the known ranges and falls back to 1m', () => {
    expect(parseRange('3m')).toBe('3m');
    expect(parseRange('all')).toBe('all');
    expect(parseRange(null)).toBe('1m');
    expect(parseRange('2w')).toBe('1m');
    expect(parseRange('')).toBe('1m');
  });
});

describe('rangeBounds', () => {
  const span = { first: '2025-02-10', last: '2025-10-18' };

  it('ends today and reaches back by calendar months or a year', () => {
    expect(rangeBounds('1m', '2025-10-19', span)).toEqual({ from: '2025-09-19', to: '2025-10-19' });
    expect(rangeBounds('3m', '2025-10-19', span)).toEqual({ from: '2025-07-19', to: '2025-10-19' });
    expect(rangeBounds('6m', '2025-10-19', span)).toEqual({ from: '2025-04-19', to: '2025-10-19' });
    expect(rangeBounds('1y', '2025-10-19', span)).toEqual({ from: '2024-10-19', to: '2025-10-19' });
  });

  it('clamps month arithmetic at month ends and leap days', () => {
    expect(rangeBounds('1m', '2025-03-31', span).from).toBe('2025-02-28');
    expect(rangeBounds('1y', '2024-02-29', span).from).toBe('2023-02-28');
    expect(rangeBounds('1m', '2025-01-05', span).from).toBe('2024-12-05');
  });

  it('spans the whole log for "all", still reaching today', () => {
    expect(rangeBounds('all', '2025-10-19', span)).toEqual({
      from: '2025-02-10',
      to: '2025-10-19',
    });
    expect(rangeBounds('all', '2025-10-19', { first: '2025-10-01', last: '2025-10-25' })).toEqual({
      from: '2025-10-01',
      to: '2025-10-25',
    });
    expect(rangeBounds('all', '2025-10-19', null)).toEqual({
      from: '2025-10-19',
      to: '2025-10-19',
    });
  });
});

describe('inRange', () => {
  it('keeps points inside the inclusive bounds', () => {
    const points = [
      { day: '2025-09-18' },
      { day: '2025-09-19' },
      { day: '2025-10-19' },
      { day: '2025-10-20' },
    ];
    expect(inRange(points, { from: '2025-09-19', to: '2025-10-19' })).toEqual([
      { day: '2025-09-19' },
      { day: '2025-10-19' },
    ]);
  });
});
