import { z } from 'zod';
import { dayKeySchema, daysBetween } from './days.js';
import {
  FOOD_NAME_MAX,
  PORTION_LABEL_MAX,
  foodBasisSchema,
  idSchema,
  isoDateTimeSchema,
} from './foods.js';
import { dayStatusSchema, goalRemainingSchema, goalSchema } from './goals.js';
import { mealSlotSchema } from './mealSlots.js';
import { nutrientsSchema, scaleNutrients, sumNutrients, type Nutrients } from './nutrition.js';
import { optionalTrimmed, trimmed } from './zod-helpers.js';

/**
 * Client-side local timestamp with offset, e.g. `2025-10-19T07:42:13+02:00`. The leading
 * `YYYY-MM-DDTHH:mm` is relied on for the CSV time column and for keeping the time of day when a
 * day is copied, so the shape is enforced beyond mere parseability.
 */
export const loggedAtSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, {
    message: 'Expected an ISO-8601 timestamp',
    abort: true,
  })
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Expected an ISO-8601 timestamp' });

export const DIARY_NOTE_MAX = 280;
export const QUANTITY_MAX = 100_000;
export const PORTION_COUNT_MAX = 1000;
export const DAY_RANGE_MAX_DAYS = 400;

// ---------- entries ----------

const quantitySchema = z
  .number()
  .positive('Quantity must be greater than 0')
  .max(QUANTITY_MAX, 'Quantity is unrealistically large');
const portionCountSchema = z
  .number()
  .positive('Count must be greater than 0')
  .max(PORTION_COUNT_MAX, 'Count is unrealistically large');

/**
 * Logging input. With `foodId` the server snapshots name, basis and per-100 values from the food
 * and `name`/`per100`/`basis` are ignored. Without it (ad-hoc) `name` and `per100` are required.
 */
export const diaryEntryInputSchema = z
  .object({
    day: dayKeySchema,
    slotId: idSchema,
    loggedAt: loggedAtSchema,
    foodId: idSchema.nullable().default(null),
    name: trimmed(FOOD_NAME_MAX, 'Name').optional(),
    quantity: quantitySchema,
    basis: foodBasisSchema.default('g'),
    portionLabel: optionalTrimmed(PORTION_LABEL_MAX, 'Portion label').default(null),
    portionCount: portionCountSchema.nullable().default(null),
    note: optionalTrimmed(DIARY_NOTE_MAX, 'Note').default(null),
    per100: nutrientsSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.foodId !== null) return;
    if (value.name === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'Name is required for an ad-hoc entry',
      });
    }
    if (value.per100 === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['per100'],
        message: 'Nutrition values are required for an ad-hoc entry',
      });
    }
  });
export type DiaryEntryInput = z.input<typeof diaryEntryInputSchema>;
export type DiaryEntryInputParsed = z.output<typeof diaryEntryInputSchema>;

export const diaryEntrySchema = z.object({
  id: idSchema,
  day: dayKeySchema,
  slotId: idSchema,
  loggedAt: isoDateTimeSchema,
  /** Null for ad-hoc entries. */
  foodId: idSchema.nullable(),
  name: z.string(),
  quantity: z.number(),
  basis: foodBasisSchema,
  portionLabel: z.string().nullable(),
  portionCount: z.number().nullable(),
  note: z.string().nullable(),
  /** Snapshot taken when the entry was logged; never changes when the library does (FR-D10). */
  per100: nutrientsSchema,
  /** Derived: per100 × quantity / 100. */
  totals: nutrientsSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type DiaryEntry = z.infer<typeof diaryEntrySchema>;

/**
 * Partial edit. The server re-derives `quantity` from a food portion only when the patch itself sets
 * `portionLabel`/`portionCount`; a patch that sends only `quantity` is taken as grams/millilitres.
 */
export const diaryEntryPatchSchema = z
  .object({
    quantity: quantitySchema.optional(),
    portionLabel: optionalTrimmed(PORTION_LABEL_MAX, 'Portion label').optional(),
    portionCount: portionCountSchema.nullable().optional(),
    slotId: idSchema.optional(),
    loggedAt: loggedAtSchema.optional(),
    day: dayKeySchema.optional(),
    note: optionalTrimmed(DIARY_NOTE_MAX, 'Note').optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'Nothing to update',
  });
export type DiaryEntryPatch = z.input<typeof diaryEntryPatchSchema>;
export type DiaryEntryPatchParsed = z.output<typeof diaryEntryPatchSchema>;

export const duplicateEntrySchema = z.object({
  loggedAt: loggedAtSchema.optional(),
});
export type DuplicateEntryInput = z.infer<typeof duplicateEntrySchema>;

// ---------- day view ----------

export const diaryDaySlotSchema = z.object({
  slot: mealSlotSchema,
  entries: z.array(diaryEntrySchema),
  totals: nutrientsSchema,
});
export type DiaryDaySlot = z.infer<typeof diaryDaySlotSchema>;

/**
 * One day of the diary. `goal` is the goal in effect on that day (FR-G1) or null, `status` judges
 * the day's kcal against it with the adherence tolerance (FR-G3) and `remaining` is goal minus
 * totals (null without a goal). `water` is a placeholder that Phase 5 fills in.
 */
export const diaryDaySchema = z.object({
  day: dayKeySchema,
  slots: z.array(diaryDaySlotSchema),
  totals: nutrientsSchema,
  entryCount: z.number().int().nonnegative(),
  goal: goalSchema.nullable(),
  status: dayStatusSchema,
  remaining: goalRemainingSchema.nullable(),
  water: z.object({ ml: z.number().nonnegative() }),
});
export type DiaryDay = z.infer<typeof diaryDaySchema>;

export const dayRangeQuerySchema = z
  .object({ from: dayKeySchema, to: dayKeySchema })
  .refine((v) => v.to >= v.from, { path: ['to'], message: '"to" must not be before "from"' })
  .refine((v) => daysBetween(v.from, v.to) <= DAY_RANGE_MAX_DAYS, {
    path: ['to'],
    message: `A range may span at most ${DAY_RANGE_MAX_DAYS} days`,
  });
export type DayRangeQuery = z.infer<typeof dayRangeQuerySchema>;

/** Lightweight per-day summary for day strips and calendars. Days without entries are omitted. */
export const diaryDaySummarySchema = z.object({
  day: dayKeySchema,
  entryCount: z.number().int().nonnegative(),
  kcal: z.number(),
});
export type DiaryDaySummary = z.infer<typeof diaryDaySummarySchema>;

// ---------- copy ----------

/**
 * Copies a whole day (`slotId` omitted) or one meal. `targetSlotId` redirects a copied meal into
 * another slot. Copying a meal onto itself (same day, same slot) or a day onto itself is rejected.
 */
export const copyDaySchema = z
  .object({
    fromDay: dayKeySchema,
    toDay: dayKeySchema,
    slotId: idSchema.optional(),
    targetSlotId: idSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.targetSlotId !== undefined && value.slotId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetSlotId'],
        message: 'Pick the meal to copy before choosing where it goes',
      });
    }
    const sameSlot =
      value.slotId === undefined || (value.targetSlotId ?? value.slotId) === value.slotId;
    if (value.fromDay === value.toDay && sameSlot) {
      ctx.addIssue({
        code: 'custom',
        path: ['toDay'],
        message: 'Source and destination are the same',
      });
    }
  });
export type CopyDayInput = z.infer<typeof copyDaySchema>;

export const copyResultSchema = z.object({
  copied: z.number().int().nonnegative(),
  day: diaryDaySchema,
});
export type CopyResult = z.infer<typeof copyResultSchema>;

// ---------- recent / frequent ----------

export const foodUsageSchema = z.object({
  foodId: idSchema,
  lastLoggedAt: isoDateTimeSchema,
  count: z.number().int().positive(),
});
export type FoodUsage = z.infer<typeof foodUsageSchema>;

// ---------- math ----------

/** Nutrients of an entry: its per-100 snapshot scaled to the logged quantity. */
export function entryTotals(per100: Nutrients, quantity: number): Nutrients {
  return scaleNutrients(per100, quantity);
}

/** Sum of entry totals (a meal or a day). */
export function dayTotals(entries: readonly { totals: Nutrients }[]): Nutrients {
  return sumNutrients(entries.map((e) => e.totals));
}
