import {
  minutesToTimeString,
  slotWindowMiddleMinute,
  type DiaryEntry,
  type MealSlot,
} from '@plate/shared';
import { isToday, nowMinutes } from '@/lib/dates';
import { formatPortion, formatQuantity } from '@/lib/format';

/** Column template shared by the meal header row and entry rows in wide containers. */
export const ENTRY_COLS =
  '@2xl:grid @2xl:grid-cols-[minmax(0,1fr)_10rem_3rem_2.75rem_2.75rem_2.75rem_3.5rem_6.5rem] @2xl:items-center @2xl:gap-2';

/**
 * "2 × 1 medium (236 g)" for food entries logged by portion, the label alone for ad-hoc entries
 * (their grams are synthetic, D50), else "450 g".
 */
export function quantityText(entry: DiaryEntry): string {
  if (entry.portionLabel === null) return formatQuantity(entry.quantity, entry.basis);
  const portion = formatPortion(entry.portionLabel, entry.portionCount);
  if (entry.foodId === null) return portion;
  return `${portion} (${formatQuantity(entry.quantity, entry.basis)})`;
}

/** Time default for a new entry: now for today, the middle of the slot's window when backdating (FR-D5). */
export function defaultTimeFor(day: string, slot: MealSlot | undefined): string {
  if (isToday(day) || !slot) return minutesToTimeString(nowMinutes());
  return minutesToTimeString(slotWindowMiddleMinute(slot));
}
