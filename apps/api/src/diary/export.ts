import { toCsvLine } from '../foods/csv.js';
import type { DiaryExportRow } from './service.js';

/** TECH.md §5.3 diary CSV columns. Nutrient columns are entry totals, rounded to 2 decimals. */
export const DIARY_CSV_COLUMNS = [
  'day',
  'time',
  'slot',
  'food',
  'brand',
  'quantity',
  'basis',
  'portion',
  'kcal',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'sugar',
  'saturated_fat',
  'sodium_mg',
  'note',
] as const;

const round2 = (value: number | null): number | null =>
  value === null ? null : Math.round(value * 100) / 100;

/** `HH:mm` sliced from the stored local timestamp (`2025-10-19T07:42:13+02:00` → `07:42`). */
export function timeOfLoggedAt(loggedAt: string): string {
  const match = /T(\d{2}:\d{2})/.exec(loggedAt);
  return match?.[1] ?? '';
}

export function portionText(label: string | null, count: number | null): string {
  if (label === null) return '';
  return count === null || count === 1 ? label : `${count} × ${label}`;
}

export function diaryToCsv(rows: readonly DiaryExportRow[]): string {
  const lines = [toCsvLine(DIARY_CSV_COLUMNS)];
  for (const r of rows) {
    lines.push(
      toCsvLine([
        r.day,
        timeOfLoggedAt(r.loggedAt),
        r.slotName,
        r.name,
        r.brand,
        r.quantity,
        r.basis,
        portionText(r.portionLabel, r.portionCount),
        round2(r.totals.kcal),
        round2(r.totals.protein),
        round2(r.totals.carbs),
        round2(r.totals.fat),
        round2(r.totals.fiber),
        round2(r.totals.sugar),
        round2(r.totals.saturatedFat),
        round2(r.totals.sodiumMg),
        r.note,
      ]),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
