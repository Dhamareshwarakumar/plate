import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './foods.js';
import { trimmed } from './zod-helpers.js';

export const MEAL_SLOT_NAME_MAX = 40;
export const MINUTES_PER_DAY = 1440;

/** Minutes since local midnight, 0..1439. */
export const minutesOfDaySchema = z
  .number()
  .int()
  .min(0)
  .max(MINUTES_PER_DAY - 1);

/**
 * A slot's time window is [start, end) in minutes since midnight. `start > end` wraps past midnight
 * (22:00–02:00); `start === end` covers the whole day.
 */
export const mealSlotInputSchema = z.object({
  name: trimmed(MEAL_SLOT_NAME_MAX, 'Meal name'),
  windowStartMin: minutesOfDaySchema,
  windowEndMin: minutesOfDaySchema,
});
export type MealSlotInput = z.infer<typeof mealSlotInputSchema>;

export const mealSlotSchema = z.object({
  id: idSchema,
  name: z.string(),
  sortOrder: z.number().int(),
  windowStartMin: minutesOfDaySchema,
  windowEndMin: minutesOfDaySchema,
  archivedAt: isoDateTimeSchema.nullable(),
});
export type MealSlot = z.infer<typeof mealSlotSchema>;

export const DEFAULT_MEAL_SLOTS = [
  { name: 'Breakfast', windowStartMin: 5 * 60, windowEndMin: 10 * 60 + 30 },
  { name: 'Lunch', windowStartMin: 10 * 60 + 30, windowEndMin: 14 * 60 + 30 },
  { name: 'Snacks', windowStartMin: 14 * 60 + 30, windowEndMin: 17 * 60 + 30 },
  { name: 'Dinner', windowStartMin: 17 * 60 + 30, windowEndMin: 22 * 60 },
] as const satisfies readonly MealSlotInput[];

type SlotWindow = Pick<MealSlot, 'windowStartMin' | 'windowEndMin'>;
type PickableSlot = SlotWindow & Pick<MealSlot, 'sortOrder' | 'archivedAt'>;

/** Start inclusive, end exclusive, wrap-aware. */
export function slotContainsMinute(slot: SlotWindow, minute: number): boolean {
  const { windowStartMin: start, windowEndMin: end } = slot;
  if (start === end) return true;
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

/** Length of the window in minutes; a zero-length window means the whole day. */
export function slotWindowLengthMinutes(slot: SlotWindow): number {
  const length = (slot.windowEndMin - slot.windowStartMin + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return length === 0 ? MINUTES_PER_DAY : length;
}

/** Middle of the window, wrap-aware (22:00–02:00 → 00:00). Used as the default time when backdating. */
export function slotWindowMiddleMinute(slot: SlotWindow): number {
  return (slot.windowStartMin + Math.floor(slotWindowLengthMinutes(slot) / 2)) % MINUTES_PER_DAY;
}

function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, MINUTES_PER_DAY - d);
}

/**
 * Picks the slot to preselect for a time of day: the active slot whose window contains the minute,
 * else the active slot whose window boundary is nearest (ties go to the earlier slot in sort order).
 * With no active slots the first slot by sort order is returned; an empty list yields undefined.
 */
export function pickSlotForTime<T extends PickableSlot>(
  slots: readonly T[],
  minute: number,
): T | undefined {
  const sorted = [...slots].sort((a, b) => a.sortOrder - b.sortOrder);
  const active = sorted.filter((s) => s.archivedAt === null);
  if (active.length === 0) return sorted[0];
  const containing = active.find((s) => slotContainsMinute(s, minute));
  if (containing) return containing;
  let best = active[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const slot of active) {
    const distance = Math.min(
      circularDistance(minute, slot.windowStartMin),
      circularDistance(minute, slot.windowEndMin),
    );
    if (distance < bestDistance) {
      best = slot;
      bestDistance = distance;
    }
  }
  return best;
}

/** 450 → "07:30". */
export function minutesToTimeString(minutes: number): string {
  const m = (((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY) | 0;
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** "07:30" → 450; null for anything that is not HH:mm. */
export function timeStringToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}
