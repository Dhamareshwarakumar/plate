import { z } from 'zod';
import { dayKeySchema } from './days.js';
import { idSchema, isoDateTimeSchema } from './foods.js';

// ---------- water (FR-D9) ----------

export const WATER_ML_MIN = 1;
export const WATER_ML_MAX = 5000;
/** The quick-add buttons on the Today water card. */
export const WATER_QUICK_ML = [250, 500] as const;

/** One addition of water on a day; whole millilitres, up to a jug at a time. */
export const waterEntryInputSchema = z.object({
  day: dayKeySchema,
  ml: z
    .number()
    .int('Whole millilitres only')
    .min(WATER_ML_MIN, `At least ${WATER_ML_MIN} ml`)
    .max(WATER_ML_MAX, `At most ${WATER_ML_MAX.toLocaleString()} ml at once`),
});
export type WaterEntryInput = z.infer<typeof waterEntryInputSchema>;

export const waterEntrySchema = z.object({
  id: idSchema,
  day: dayKeySchema,
  ml: z.number(),
  /** Server time of the addition; only used to find "the last one" for undo. */
  loggedAt: isoDateTimeSchema,
});
export type WaterEntry = z.infer<typeof waterEntrySchema>;

/** A day's water: the SQL-summed total plus the additions in logging order. */
export const dayWaterSchema = z.object({
  ml: z.number().nonnegative(),
  entries: z.array(waterEntrySchema),
});
export type DayWater = z.infer<typeof dayWaterSchema>;
