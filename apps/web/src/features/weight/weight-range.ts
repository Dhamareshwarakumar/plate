import { subMonths, subYears } from 'date-fns';
import { parseDayKey, toDayKey } from '@/lib/dates';

/** Chart ranges (FR-W3): trailing windows ending today, or the whole log. */
export const WEIGHT_RANGES = ['1m', '3m', '6m', '1y', 'all'] as const;
export type WeightRange = (typeof WEIGHT_RANGES)[number];

export const RANGE_OPTIONS: readonly { value: WeightRange; label: string }[] = [
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
];

const DEFAULT_RANGE: WeightRange = '1m';

/** `?range=` → a known range, `1m` for anything else. */
export function parseRange(param: string | null): WeightRange {
  return (WEIGHT_RANGES as readonly string[]).includes(param ?? '')
    ? (param as WeightRange)
    : DEFAULT_RANGE;
}

export interface DayBounds {
  from: string;
  to: string;
}

/**
 * Inclusive day bounds of a range. Trailing ranges end today; `all` spans the log (`span`) and
 * still reaches today, so a stale log shows the gap since the last weigh-in.
 */
export function rangeBounds(
  range: WeightRange,
  today: string,
  span: { first: string; last: string } | null,
): DayBounds {
  if (range === 'all') {
    if (!span) return { from: today, to: today };
    return {
      from: span.first < today ? span.first : today,
      to: span.last > today ? span.last : today,
    };
  }
  const date = parseDayKey(today);
  const from =
    range === '1y'
      ? subYears(date, 1)
      : subMonths(date, range === '1m' ? 1 : range === '3m' ? 3 : 6);
  return { from: toDayKey(from), to: today };
}

export function inRange<T extends { day: string }>(
  points: readonly T[],
  { from, to }: DayBounds,
): T[] {
  return points.filter((p) => p.day >= from && p.day <= to);
}
