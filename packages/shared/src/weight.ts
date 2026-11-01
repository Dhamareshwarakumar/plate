import { z } from 'zod';
import { dayKeySchema, daysBetween, shiftDayKey } from './days.js';
import { idSchema, isoDateTimeSchema } from './foods.js';
import { optionalTrimmed } from './zod-helpers.js';

// ---------- weights (FR-W1) ----------

export const WEIGHT_KG_MIN = 20;
export const WEIGHT_KG_MAX = 400;
export const WEIGHT_NOTE_MAX = 120;
/** Trailing window of the moving average, in calendar days (gaps allowed). */
export const MOVING_AVERAGE_DAYS = 7;
/** The rate is the least-squares slope of the moving average over this many trailing days. */
export const RATE_WINDOW_DAYS = 28;
/** Below this |kg/week| the trend counts as flat and no ETA is projected. */
export const ETA_MIN_RATE = 0.05;

/** Body weight in kilograms with at most one decimal (what a scale shows). */
export const weightKgSchema = z
  .number()
  .min(WEIGHT_KG_MIN, `At least ${WEIGHT_KG_MIN} kg`)
  .max(WEIGHT_KG_MAX, `At most ${WEIGHT_KG_MAX} kg`)
  .refine((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9, 'Use at most one decimal');

export const weightInputSchema = z.object({
  day: dayKeySchema,
  kg: weightKgSchema,
  note: optionalTrimmed(WEIGHT_NOTE_MAX, 'Note').default(null),
});
export type WeightInput = z.input<typeof weightInputSchema>;
export type WeightInputParsed = z.output<typeof weightInputSchema>;

/** Body of `PUT weights/:day`; the day is the URL. */
export const weightBodySchema = weightInputSchema.omit({ day: true });
export type WeightBody = z.input<typeof weightBodySchema>;
export type WeightBodyParsed = z.output<typeof weightBodySchema>;

export const weightSchema = z.object({
  id: idSchema,
  day: dayKeySchema,
  kg: z.number(),
  note: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Weight = z.infer<typeof weightSchema>;

export const weightPointSchema = z.object({ day: dayKeySchema, kg: z.number() });
export type WeightPoint = z.infer<typeof weightPointSchema>;

export const weightRangeQuerySchema = z
  .object({ from: dayKeySchema.optional(), to: dayKeySchema.optional() })
  .refine((v) => v.from === undefined || v.to === undefined || v.to >= v.from, {
    path: ['to'],
    message: '"to" must not be before "from"',
  });
export type WeightRangeQuery = z.infer<typeof weightRangeQuerySchema>;

/**
 * What the Weight page shows above the chart (FR-W2). `change7d`/`change30d` compare the latest
 * weigh-in with the one on or just before 7 / 30 days earlier; `ratePerWeek` is the trend of the
 * moving average over the last 28 days; `remaining` is goal minus latest (negative while above
 * the goal); `eta` is the projected day the moving average meets the goal at the current rate.
 */
export const weightStatsSchema = z.object({
  latest: weightSchema.nullable(),
  count: z.number().int().nonnegative(),
  change7d: z.number().nullable(),
  change30d: z.number().nullable(),
  movingAverage: z.array(weightPointSchema),
  ratePerWeek: z.number().nullable(),
  goalKg: z.number().nullable(),
  goalDate: dayKeySchema.nullable(),
  remaining: z.number().nullable(),
  eta: dayKeySchema.nullable(),
});
export type WeightStats = z.infer<typeof weightStatsSchema>;

// ---------- math (FR-W2) ----------
// All functions take points sorted ascending by day with at most one point per day.

/**
 * Trailing 7-day mean at every entry day: the mean of the entries dated within the six days
 * before the day and the day itself. Days without a weigh-in simply do not contribute, so a
 * sparse log still gets a smooth line.
 */
export function movingAverage7(points: readonly WeightPoint[]): WeightPoint[] {
  const out: WeightPoint[] = [];
  let start = 0;
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    while (daysBetween(points[start]!.day, point.day) >= MOVING_AVERAGE_DAYS) start++;
    let sum = 0;
    for (let j = start; j <= i; j++) sum += points[j]!.kg;
    out.push({ day: point.day, kg: sum / (i - start + 1) });
  }
  return out;
}

/**
 * Least-squares slope of the moving-average points within the 28 days ending at the latest one,
 * in kg per week. Null with fewer than two points in that window.
 */
export function weeklyRate(movingAverage: readonly WeightPoint[]): number | null {
  const last = movingAverage[movingAverage.length - 1];
  if (!last) return null;
  const window = movingAverage.filter((p) => daysBetween(p.day, last.day) < RATE_WINDOW_DAYS);
  if (window.length < 2) return null;
  const first = window[0]!;
  const xs = window.map((p) => daysBetween(first.day, p.day));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = window.reduce((a, p) => a + p.kg, 0) / window.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < window.length; i++) {
    const dx = xs[i]! - meanX;
    num += dx * (window[i]!.kg - meanY);
    den += dx * dx;
  }
  if (den === 0) return null;
  return (num / den) * 7;
}

/**
 * Whole days until `goalKg` is reached from `currentKg` at `ratePerWeek`, or null when there is no
 * usable trend (|rate| < 0.05 kg/week), the trend points away from the goal, or the goal is met.
 */
export function projectEta(
  currentKg: number,
  goalKg: number,
  ratePerWeek: number | null,
): number | null {
  if (ratePerWeek === null || Math.abs(ratePerWeek) < ETA_MIN_RATE) return null;
  const diff = goalKg - currentKg;
  if (Math.abs(diff) < 1e-9) return null;
  if (Math.sign(diff) !== Math.sign(ratePerWeek)) return null;
  const days = diff / (ratePerWeek / 7);
  return Math.max(0, Math.ceil(days - 1e-9));
}

/**
 * `latest.kg` minus the newest weigh-in dated on or before `days` days earlier, as long as that
 * one is not older than `2 × days` (a 7-day change against a weigh-in from last month is noise).
 */
export function changeOver(
  points: readonly WeightPoint[],
  latest: WeightPoint,
  days: number,
): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i]!;
    const age = daysBetween(point.day, latest.day);
    if (age < days) continue;
    if (age > 2 * days) return null;
    return latest.kg - point.kg;
  }
  return null;
}

export interface WeightGoal {
  goalWeightKg: number | null;
  goalWeightDate: string | null;
}

/** Everything the Weight page's stats block needs, from the full log and the goal in effect. */
export function computeWeightStats(
  entries: readonly Weight[],
  goal: WeightGoal | null,
): WeightStats {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  const latest = sorted[sorted.length - 1] ?? null;
  const points: WeightPoint[] = sorted.map(({ day, kg }) => ({ day, kg }));
  const movingAverage = movingAverage7(points);
  const latestAverage = movingAverage[movingAverage.length - 1] ?? null;
  const ratePerWeek = weeklyRate(movingAverage);
  const goalKg = goal?.goalWeightKg ?? null;
  const etaDays =
    latestAverage && goalKg !== null ? projectEta(latestAverage.kg, goalKg, ratePerWeek) : null;
  return {
    latest,
    count: sorted.length,
    change7d: latest ? changeOver(points, latest, 7) : null,
    change30d: latest ? changeOver(points, latest, 30) : null,
    movingAverage,
    ratePerWeek,
    goalKg,
    goalDate: goal?.goalWeightDate ?? null,
    remaining: latest && goalKg !== null ? goalKg - latest.kg : null,
    eta: latestAverage && etaDays !== null ? shiftDayKey(latestAverage.day, etaDays) : null,
  };
}
