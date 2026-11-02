import { z } from 'zod';
import { dayKeySchema, daysBetween, shiftDayKey, weekStartKey } from './days.js';
import { idSchema } from './foods.js';
import { dayStatusSchema, type DayStatus } from './goals.js';
import { nutrientsSchema } from './nutrition.js';
import type { WeekStart } from './settings.js';

// ---------- range (FR-I) ----------

/** Two years inclusive of both ends (TECH.md §5 caps insights ranges at two years). */
export const INSIGHTS_RANGE_MAX_DAYS = 731;

const rangeFields = { from: dayKeySchema, to: dayKeySchema };

/**
 * Both insights query schemas share the two range checks. They are applied by a helper rather
 * than inherited through `.extend()`, which does not carry refinements along in zod 4.
 */
function withRangeLimits<T extends z.ZodType<{ from: string; to: string }>>(schema: T): T {
  return schema
    .refine((v) => v.to >= v.from, { path: ['to'], message: '"to" must not be before "from"' })
    .refine((v) => daysBetween(v.from, v.to) + 1 <= INSIGHTS_RANGE_MAX_DAYS, {
      path: ['to'],
      message: `A range may span at most ${INSIGHTS_RANGE_MAX_DAYS} days`,
    });
}

export const insightsRangeSchema = withRangeLimits(z.object(rangeFields));
export type InsightsRange = z.infer<typeof insightsRangeSchema>;

/** `today` is the client's day key; streaks and "days elapsed" are judged against it (D100). */
export const insightsSummaryQuerySchema = withRangeLimits(
  z.object({ ...rangeFields, today: dayKeySchema.optional() }),
);
export type InsightsSummaryQuery = z.infer<typeof insightsSummaryQuerySchema>;

// ---------- daily aggregate (FR-I2, FR-I3, FR-I4) ----------

/** One row per day of the range, including days without entries (`entryCount` 0, `not_logged`). */
export const dailyAggregateSchema = z.object({
  day: dayKeySchema,
  entryCount: z.number().int().nonnegative(),
  totals: nutrientsSchema,
  /** The kcal goal in effect on the day, null when none was set yet. */
  goalKcal: z.number().nullable(),
  status: dayStatusSchema,
});
export type DailyAggregate = z.infer<typeof dailyAggregateSchema>;

// ---------- summary (FR-I1) ----------

export const streakSchema = z.object({
  current: z.number().int().nonnegative(),
  best: z.number().int().nonnegative(),
});
export type Streak = z.infer<typeof streakSchema>;

/**
 * Averages are over logged days (null when none). Adherence is on-target days ÷ logged days that
 * had a goal, as a whole percent (null when no logged day had a goal). `daysElapsed` counts the
 * days of the range on or before `today`, so "5 of 7 logged" can be judged against the days
 * that have actually happened.
 */
export const insightsSummarySchema = z.object({
  daysInRange: z.number().int().nonnegative(),
  daysElapsed: z.number().int().nonnegative(),
  daysLogged: z.number().int().nonnegative(),
  daysWithGoal: z.number().int().nonnegative(),
  daysOnTarget: z.number().int().nonnegative(),
  adherencePct: z.number().int().min(0).max(100).nullable(),
  avgKcal: z.number().nullable(),
  avgProtein: z.number().nullable(),
  avgCarbs: z.number().nullable(),
  avgFat: z.number().nullable(),
  loggingStreak: streakSchema,
  onTargetStreak: streakSchema,
});
export type InsightsSummary = z.infer<typeof insightsSummarySchema>;

// ---------- top foods (FR-I6) ----------

/** Library foods are grouped by id; ad-hoc entries by their (lower-cased) name, with a null id. */
export const topFoodSchema = z.object({
  foodId: idSchema.nullable(),
  name: z.string(),
  count: z.number().int().positive(),
  kcal: z.number(),
});
export type TopFood = z.infer<typeof topFoodSchema>;

export const topFoodsSchema = z.object({
  byCount: z.array(topFoodSchema),
  byKcal: z.array(topFoodSchema),
});
export type TopFoods = z.infer<typeof topFoodsSchema>;

// ---------- by meal slot (FR-I7) ----------

/** `avgKcal` is the slot's kcal ÷ logged days in the range, so the slots add up to the daily average. */
export const slotAverageSchema = z.object({
  slotId: idSchema,
  name: z.string(),
  archived: z.boolean(),
  entryCount: z.number().int().nonnegative(),
  /** Days on which the slot had at least one entry. */
  days: z.number().int().nonnegative(),
  totalKcal: z.number(),
  avgKcal: z.number(),
});
export type SlotAverage = z.infer<typeof slotAverageSchema>;

export const bySlotSchema = z.object({
  loggedDays: z.number().int().nonnegative(),
  slots: z.array(slotAverageSchema),
});
export type BySlot = z.infer<typeof bySlotSchema>;

// ---------- weekly buckets (FR-I5) ----------

/**
 * A week of the range, aligned to the week-start setting and clipped to the range's bounds
 * (`from`/`to`), so the first and last bucket may be short. Averages are over logged days.
 */
export const weeklyIntakeSchema = z.object({
  weekStart: dayKeySchema,
  from: dayKeySchema,
  to: dayKeySchema,
  days: z.number().int().positive(),
  loggedDays: z.number().int().nonnegative(),
  avgKcal: z.number().nullable(),
  avgProtein: z.number().nullable(),
  avgCarbs: z.number().nullable(),
  avgFat: z.number().nullable(),
  /** The kcal goal in effect on the last day of the bucket. */
  goalKcal: z.number().nullable(),
});
export type WeeklyIntake = z.infer<typeof weeklyIntakeSchema>;

/** Weekly intake plus the mean of the 7-day weight moving average inside the week (FR-I5). */
export const weightVsIntakePointSchema = weeklyIntakeSchema.extend({
  avgWeightKg: z.number().nullable(),
  weighIns: z.number().int().nonnegative(),
});
export type WeightVsIntakePoint = z.infer<typeof weightVsIntakePointSchema>;

// ---------- math ----------

export function isLoggedStatus(status: DayStatus): boolean {
  return status !== 'not_logged';
}

export function isOnTargetStatus(status: DayStatus): boolean {
  return status === 'on_target';
}

/**
 * Runs of consecutive qualifying days. `best` is the longest run in the range (days after
 * `today` are ignored). `current` is the run ending today, or the run ending yesterday when
 * today does not qualify yet: today is provisional, so an unlogged morning or a day that is still
 * "under" at breakfast does not zero the streak. When the range ends before yesterday the run
 * cannot connect to today and `current` is 0.
 */
export function computeStreaks(
  daily: readonly Pick<DailyAggregate, 'day' | 'status'>[],
  today: string,
  qualifies: (status: DayStatus) => boolean,
): Streak {
  const rows = daily.filter((d) => d.day <= today).sort((a, b) => a.day.localeCompare(b.day));
  const yesterday = shiftDayKey(today, -1);
  let best = 0;
  let run = 0;
  let endingToday = 0;
  let endingYesterday = 0;
  let previous: string | null = null;
  for (const row of rows) {
    const consecutive = previous !== null && daysBetween(previous, row.day) === 1;
    run = qualifies(row.status) ? (consecutive ? run + 1 : 1) : 0;
    if (run > best) best = run;
    if (row.day === today) endingToday = run;
    else if (row.day === yesterday) endingYesterday = run;
    previous = row.day;
  }
  return { current: endingToday > 0 ? endingToday : endingYesterday, best };
}

const average = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

/**
 * The FR-I1 numbers for a range of daily aggregates (see `insightsSummarySchema` for the rules).
 * Streaks are a "now" statistic (DESIGN §5 shows a 12-day streak on a week view), so they are
 * computed from `streakDaily`, normally a trailing window ending today, rather than the range.
 */
export function summarize(
  daily: readonly DailyAggregate[],
  today: string,
  streakDaily: readonly DailyAggregate[] = daily,
): InsightsSummary {
  const logged = daily.filter((d) => d.entryCount > 0);
  const withGoal = logged.filter((d) => d.goalKcal !== null);
  const daysOnTarget = daily.filter((d) => d.status === 'on_target').length;
  return {
    daysInRange: daily.length,
    daysElapsed: daily.filter((d) => d.day <= today).length,
    daysLogged: logged.length,
    daysWithGoal: withGoal.length,
    daysOnTarget,
    adherencePct: withGoal.length === 0 ? null : Math.round((daysOnTarget / withGoal.length) * 100),
    avgKcal: average(logged.map((d) => d.totals.kcal)),
    avgProtein: average(logged.map((d) => d.totals.protein)),
    avgCarbs: average(logged.map((d) => d.totals.carbs)),
    avgFat: average(logged.map((d) => d.totals.fat)),
    loggingStreak: computeStreaks(streakDaily, today, isLoggedStatus),
    onTargetStreak: computeStreaks(streakDaily, today, isOnTargetStatus),
  };
}

/**
 * Groups daily aggregates into weeks starting on the configured weekday. Buckets are clipped to
 * the days actually present, so a range starting mid-week yields a short first bucket.
 */
export function weeklyIntake(
  daily: readonly DailyAggregate[],
  weekStart: WeekStart,
): WeeklyIntake[] {
  const sorted = [...daily].sort((a, b) => a.day.localeCompare(b.day));
  const buckets = new Map<string, DailyAggregate[]>();
  for (const row of sorted) {
    const key = weekStartKey(row.day, weekStart);
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }
  return [...buckets.entries()].map(([weekStartDay, rows]) => {
    const logged = rows.filter((d) => d.entryCount > 0);
    return {
      weekStart: weekStartDay,
      from: rows[0]!.day,
      to: rows[rows.length - 1]!.day,
      days: rows.length,
      loggedDays: logged.length,
      avgKcal: average(logged.map((d) => d.totals.kcal)),
      avgProtein: average(logged.map((d) => d.totals.protein)),
      avgCarbs: average(logged.map((d) => d.totals.carbs)),
      avgFat: average(logged.map((d) => d.totals.fat)),
      goalKcal: rows[rows.length - 1]!.goalKcal,
    };
  });
}
