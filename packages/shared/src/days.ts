import { z } from 'zod';

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

/** `YYYY-MM-DD` of a Date in the caller's local zone (the browser's, or the server's as a fallback). */
export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
