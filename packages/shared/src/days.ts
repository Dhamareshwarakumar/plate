import { z } from 'zod';
// Type-only: `settings.ts` imports `localDayKey` from here, so a value import would be a cycle (D67).
import type { WeekStart } from './settings.js';

export const DAY_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** True for `YYYY-MM-DD` strings naming a real calendar date (2024-02-29 yes, 2025-02-30 no). */
export function isValidDayKey(value: string): boolean {
  if (!DAY_KEY_REGEX.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const dayKeySchema = z
  .string()
  .refine(isValidDayKey, { message: 'Expected a calendar date as YYYY-MM-DD' });
export type DayKey = z.infer<typeof dayKeySchema>;

/** Whole days from `from` to `to` inclusive of both ends minus one (same day → 0). */
export function daysBetween(from: string, to: string): number {
  const ms = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  const start = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  return Math.round((ms - start) / 86_400_000);
}

/** The day key `days` calendar days after `day` (negative to go back); zone-free like `daysBetween`. */
export function shiftDayKey(day: string, days: number): string {
  const date = new Date(
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + days),
  );
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The first day (Monday or Sunday per the setting) of the week containing `day`; zone-free. */
export function weekStartKey(day: string, weekStart: WeekStart): string {
  const date = new Date(
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))),
  );
  const weekday = date.getUTCDay(); // 0 = Sunday … 6 = Saturday
  const offset = weekStart === 'sunday' ? weekday : (weekday + 6) % 7;
  return shiftDayKey(day, -offset);
}

/** `YYYY-MM-DD` of a Date in the caller's local zone (the browser's, or the server's as a fallback). */
export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
