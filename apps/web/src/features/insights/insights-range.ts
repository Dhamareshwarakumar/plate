import { daysBetween, INSIGHTS_RANGE_MAX_DAYS, isValidDayKey } from '@plate/shared';
import {
  addDays,
  addMonths,
  addYears,
  endOfMonth,
  endOfYear,
  format,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns';
import { parseDayKey, toDayKey, type WeekStartsOn } from '@/lib/dates';

/**
 * Insights ranges (FR-I, D99): calendar periods anchored on a day, or a custom span. The URL
 * carries `?range=<kind>&from=<day>` (plus `to` for custom); `from` is snapped to the period
 * start when parsed, so any day inside a period names it.
 */
export const RANGE_KINDS = ['week', 'month', '3m', 'year', 'custom'] as const;
export type RangeKind = (typeof RANGE_KINDS)[number];

export type PeriodKind = Exclude<RangeKind, 'custom'>;

export const RANGE_KIND_OPTIONS: readonly { value: PeriodKind; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: '3m', label: '3M' },
  { value: 'year', label: 'Year' },
];

export interface InsightsRange {
  kind: RangeKind;
  from: string;
  to: string;
}

/** Ranges longer than this are charted per week instead of per day (D103). */
export const WEEKLY_VIEW_MIN_DAYS = 101;

export function rangeDays(range: Pick<InsightsRange, 'from' | 'to'>): number {
  return daysBetween(range.from, range.to) + 1;
}

export function isWeeklyView(range: Pick<InsightsRange, 'from' | 'to'>): boolean {
  return rangeDays(range) >= WEEKLY_VIEW_MIN_DAYS;
}

/** The period of `kind` whose start is `start` snapped back to a period boundary (3M: three months from that month). */
export function periodStartingAt(
  kind: PeriodKind,
  start: string,
  weekStartsOn: WeekStartsOn,
): InsightsRange {
  const date = parseDayKey(start);
  switch (kind) {
    case 'week': {
      const first = startOfWeek(date, { weekStartsOn });
      return { kind, from: toDayKey(first), to: toDayKey(addDays(first, 6)) };
    }
    case 'month':
      return { kind, from: toDayKey(startOfMonth(date)), to: toDayKey(endOfMonth(date)) };
    case '3m': {
      const first = startOfMonth(date);
      return { kind, from: toDayKey(first), to: toDayKey(endOfMonth(addMonths(first, 2))) };
    }
    case 'year':
      return { kind, from: toDayKey(startOfYear(date)), to: toDayKey(endOfYear(date)) };
  }
}

/** The calendar period of `kind` containing `anchor`; 3M is the anchor's month and the two before it. */
export function periodFor(
  kind: PeriodKind,
  anchor: string,
  weekStartsOn: WeekStartsOn,
): InsightsRange {
  if (kind === '3m') {
    return periodStartingAt(kind, toDayKey(addMonths(parseDayKey(anchor), -2)), weekStartsOn);
  }
  return periodStartingAt(kind, anchor, weekStartsOn);
}

function isCustomSpan(from: string, to: string): boolean {
  return (
    isValidDayKey(from) &&
    isValidDayKey(to) &&
    to >= from &&
    daysBetween(from, to) + 1 <= INSIGHTS_RANGE_MAX_DAYS
  );
}

/** `?range=&from=&to=` → a range; anything unusable falls back to the week containing today. */
export function parseRangeParams(
  params: URLSearchParams,
  today: string,
  weekStartsOn: WeekStartsOn,
): InsightsRange {
  const kind = params.get('range');
  const from = params.get('from');
  const to = params.get('to');
  if (kind === 'custom') {
    if (from !== null && to !== null && isCustomSpan(from, to)) return { kind, from, to };
    return periodFor('week', today, weekStartsOn);
  }
  if (kind === 'week' || kind === 'month' || kind === '3m' || kind === 'year') {
    // The URL names the period's start; an invalid or missing one anchors on today.
    return from !== null && isValidDayKey(from)
      ? periodStartingAt(kind, from, weekStartsOn)
      : periodFor(kind, today, weekStartsOn);
  }
  return periodFor('week', today, weekStartsOn);
}

export function rangeToParams(range: InsightsRange): URLSearchParams {
  const params = new URLSearchParams({ range: range.kind, from: range.from });
  if (range.kind === 'custom') params.set('to', range.to);
  return params;
}

/** The previous (−1) or next (+1) period; a custom span moves by its own length. */
export function shiftRange(
  range: InsightsRange,
  delta: -1 | 1,
  weekStartsOn: WeekStartsOn,
): InsightsRange {
  const date = parseDayKey(range.from);
  switch (range.kind) {
    case 'week':
      return periodStartingAt('week', toDayKey(addDays(date, 7 * delta)), weekStartsOn);
    case 'month':
      return periodStartingAt('month', toDayKey(addMonths(date, delta)), weekStartsOn);
    case '3m':
      return periodStartingAt('3m', toDayKey(addMonths(date, 3 * delta)), weekStartsOn);
    case 'year':
      return periodStartingAt('year', toDayKey(addYears(date, delta)), weekStartsOn);
    case 'custom': {
      const days = rangeDays(range) * delta;
      return {
        kind: 'custom',
        from: toDayKey(addDays(date, days)),
        to: toDayKey(addDays(parseDayKey(range.to), days)),
      };
    }
  }
}

/** Re-anchors on today when today is inside the current range, else on the range's start (D99). */
export function switchKind(
  range: InsightsRange,
  kind: PeriodKind,
  today: string,
  weekStartsOn: WeekStartsOn,
): InsightsRange {
  const anchor = today >= range.from && today <= range.to ? today : range.from;
  return periodFor(kind, anchor, weekStartsOn);
}

/** The next period is reachable while it starts on or before today. */
export function canGoForward(range: InsightsRange, today: string, weekStartsOn: WeekStartsOn) {
  return shiftRange(range, 1, weekStartsOn).from <= today;
}

/** "13–19 Oct 2025", "29 Sep – 5 Oct 2025", "October 2025", "Aug–Oct 2025", "2025", "1 Sep – 15 Oct 2025". */
export function rangeLabel(range: InsightsRange): string {
  const from = parseDayKey(range.from);
  const to = parseDayKey(range.to);
  switch (range.kind) {
    case 'month':
      return format(from, 'MMMM yyyy');
    case 'year':
      return format(from, 'yyyy');
    case '3m':
      return from.getFullYear() === to.getFullYear()
        ? `${format(from, 'MMM')}–${format(to, 'MMM yyyy')}`
        : `${format(from, 'MMM yyyy')} – ${format(to, 'MMM yyyy')}`;
    case 'week':
    case 'custom':
      return spanLabel(from, to);
  }
}

function spanLabel(from: Date, to: Date): string {
  if (from.getTime() === to.getTime()) return format(from, 'd MMM yyyy');
  if (from.getFullYear() !== to.getFullYear()) {
    return `${format(from, 'd MMM yyyy')} – ${format(to, 'd MMM yyyy')}`;
  }
  if (from.getMonth() !== to.getMonth()) {
    return `${format(from, 'd MMM')} – ${format(to, 'd MMM yyyy')}`;
  }
  return `${format(from, 'd')}–${format(to, 'd MMM yyyy')}`;
}
