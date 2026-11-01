import type { WeekStart } from '@plate/shared';
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  formatISO,
  parse,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

/**
 * Day keys are `YYYY-MM-DD` in the device's own time zone (TECH.md §3): the phone decides which
 * day a meal belongs to, never the server. Weeks start on Monday unless the week-start setting
 * says Sunday (FR-S2, D74).
 */
export const DAY_KEY_FORMAT = 'yyyy-MM-dd';

/** date-fns convention: 0 = Sunday, 1 = Monday. */
export type WeekStartsOn = 0 | 1;

export function weekStartsOnFor(weekStart: WeekStart): WeekStartsOn {
  return weekStart === 'sunday' ? 0 : 1;
}

/** Rotates Monday-first weekday labels so the first one matches the week start. */
export function weekdayLabels<T>(weekStartsOn: WeekStartsOn, mondayFirst: readonly T[]): T[] {
  return weekStartsOn === 0 ? [mondayFirst[6]!, ...mondayFirst.slice(0, 6)] : [...mondayFirst];
}

export function toDayKey(date: Date): string {
  return format(date, DAY_KEY_FORMAT);
}

/** Local midnight of a day key. */
export function parseDayKey(day: string): Date {
  return parse(day, DAY_KEY_FORMAT, new Date());
}

export function todayKey(): string {
  return toDayKey(new Date());
}

export function isToday(day: string): boolean {
  return day === todayKey();
}

export function shiftDay(day: string, days: number): string {
  return toDayKey(addDays(parseDayKey(day), days));
}

/** First of the month `months` away from the given day's month. */
export function shiftMonth(day: string, months: number): string {
  return toDayKey(startOfMonth(addMonths(parseDayKey(day), months)));
}

/** "Sat 19 Oct" */
export function formatDayLabel(day: string): string {
  return format(parseDayKey(day), 'EEE d MMM');
}

/** "Saturday, 19 October 2025" */
export function formatDayLong(day: string): string {
  return format(parseDayKey(day), 'EEEE, d MMMM yyyy');
}

/** "Oct 2025" */
export function formatMonthLabel(day: string): string {
  return format(parseDayKey(day), 'MMM yyyy');
}

/** "October 2025" */
export function formatMonthLong(day: string): string {
  return format(parseDayKey(day), 'MMMM yyyy');
}

/** The seven day keys of the week containing `day`, starting on the given weekday. */
export function weekDays(day: string, weekStartsOn: WeekStartsOn = 1): string[] {
  const start = startOfWeek(parseDayKey(day), { weekStartsOn });
  return Array.from({ length: 7 }, (_, i) => toDayKey(addDays(start, i)));
}

/** Full weeks covering the month of `day`; cells outside the month are included. */
export function monthGrid(day: string, weekStartsOn: WeekStartsOn = 1): string[][] {
  const date = parseDayKey(day);
  const start = startOfWeek(startOfMonth(date), { weekStartsOn });
  const end = endOfWeek(endOfMonth(date), { weekStartsOn });
  const days = eachDayOfInterval({ start, end }).map(toDayKey);
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

export function monthBounds(day: string): { start: string; end: string } {
  const date = parseDayKey(day);
  return { start: toDayKey(startOfMonth(date)), end: toDayKey(endOfMonth(date)) };
}

/** Local ISO-8601 timestamp with the device offset, e.g. `2025-10-19T07:42:13+02:00`. */
export function localIsoNow(): string {
  return formatISO(new Date());
}

/** Local ISO timestamp for a day key at `minutes` past midnight. */
export function isoAt(day: string, minutes: number): string {
  const date = parseDayKey(day);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return formatISO(date);
}

/** Minutes since local midnight of the current moment. */
export function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/** "07:42" for a stored timestamp, shown in the device zone. */
export function timeOfIso(iso: string): string {
  return format(parseISO(iso), 'HH:mm');
}

export function minutesOfIso(iso: string): number {
  const date = parseISO(iso);
  return date.getHours() * 60 + date.getMinutes();
}
