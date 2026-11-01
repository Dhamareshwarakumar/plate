import { z } from 'zod';
import { dayKeySchema } from './days.js';
import { idSchema, isoDateTimeSchema } from './foods.js';
import { KCAL_PER_GRAM, type Nutrients } from './nutrition.js';
import { ACTIVITY_FACTORS, type Activity, type Sex } from './settings.js';

// ---------- day status (FR-G3) ----------

export const dayStatusSchema = z.enum(['not_logged', 'no_goal', 'on_target', 'under', 'over']);
export type DayStatus = z.infer<typeof dayStatusSchema>;

/**
 * Judges a day against the kcal goal in effect on it. A day without entries is `not_logged` even
 * when a goal exists; a day with entries but no goal is `no_goal`. Inside the ± tolerance band
 * (inclusive, with a tiny epsilon so 10 % of 2,000 does not fail on float noise) it is `on_target`.
 */
export function computeDayStatus(
  eatenKcal: number,
  goalKcal: number | null,
  entryCount: number,
  tolerancePct: number,
): DayStatus {
  if (entryCount === 0) return 'not_logged';
  if (goalKcal === null) return 'no_goal';
  const band = (goalKcal * tolerancePct) / 100 + 1e-9;
  const diff = eatenKcal - goalKcal;
  if (Math.abs(diff) <= band) return 'on_target';
  return diff < 0 ? 'under' : 'over';
}

// ---------- goals (FR-G1, FR-G2) ----------

export const GOAL_KCAL_MIN = 500;
export const GOAL_KCAL_MAX = 10_000;
export const GOAL_MACRO_MAX = 1000;
export const GOAL_WATER_MAX = 20_000;

const kcalSchema = z
  .number()
  .min(GOAL_KCAL_MIN, `At least ${GOAL_KCAL_MIN} kcal`)
  .max(GOAL_KCAL_MAX, `At most ${GOAL_KCAL_MAX.toLocaleString()} kcal`);
const macroGramsSchema = (label: string) =>
  z
    .number()
    .min(0, `${label} cannot be negative`)
    .max(GOAL_MACRO_MAX, `${label} is unrealistically large`);
const waterMlSchema = z
  .number()
  .min(0, 'Water cannot be negative')
  .max(GOAL_WATER_MAX, 'Water is unrealistically large');

const goalFields = {
  /** The goal applies from this day until the next goal's `effectiveFrom` (FR-G1). */
  effectiveFrom: dayKeySchema,
  kcal: kcalSchema,
  proteinG: macroGramsSchema('Protein'),
  carbsG: macroGramsSchema('Carbs'),
  fatG: macroGramsSchema('Fat'),
};

export const goalInputSchema = z.object({
  ...goalFields,
  fiberG: macroGramsSchema('Fiber').nullable().default(null),
  waterMl: waterMlSchema.nullable().default(null),
});
export type GoalInput = z.input<typeof goalInputSchema>;
export type GoalInputParsed = z.output<typeof goalInputSchema>;

export const goalSchema = z.object({
  id: idSchema,
  ...goalFields,
  fiberG: macroGramsSchema('Fiber').nullable(),
  waterMl: waterMlSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type Goal = z.infer<typeof goalSchema>;

/** What is left of the goal after the day's totals; negative when over. Fiber only when the goal sets it. */
export const goalRemainingSchema = z.object({
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
  fiber: z.number().nullable(),
});
export type GoalRemaining = z.infer<typeof goalRemainingSchema>;

export function goalRemaining(
  goal: Pick<Goal, 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'fiberG'>,
  totals: Nutrients,
): GoalRemaining {
  return {
    kcal: goal.kcal - totals.kcal,
    protein: goal.proteinG - totals.protein,
    carbs: goal.carbsG - totals.carbs,
    fat: goal.fatG - totals.fat,
    fiber: goal.fiberG === null ? null : goal.fiberG - (totals.fiber ?? 0),
  };
}

// ---------- macro presets (FR-G2, FR-G4) ----------

export interface MacroPercentages {
  protein: number;
  carbs: number;
  fat: number;
}

export const MACRO_PRESETS = {
  balanced: { protein: 30, carbs: 40, fat: 30 },
  high_protein: { protein: 40, carbs: 30, fat: 30 },
} as const satisfies Record<string, MacroPercentages>;
export type MacroPreset = keyof typeof MACRO_PRESETS;

export interface MacroTargets {
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Whole grams of each macro for a kcal target and a % split (4/4/9 kcal per gram). */
export function macroTargetsFromPreset(
  kcal: number,
  preset: MacroPreset | MacroPercentages,
): MacroTargets {
  if (!Number.isFinite(kcal) || kcal < 0) {
    throw new RangeError(`kcal must be a non-negative finite number, got ${kcal}`);
  }
  const pct = typeof preset === 'string' ? MACRO_PRESETS[preset] : preset;
  const sum = pct.protein + pct.carbs + pct.fat;
  if (Math.abs(sum - 100) > 0.01) {
    throw new RangeError(`Macro percentages must add up to 100, got ${sum}`);
  }
  return {
    proteinG: Math.round((kcal * pct.protein) / 100 / KCAL_PER_GRAM.protein),
    carbsG: Math.round((kcal * pct.carbs) / 100 / KCAL_PER_GRAM.carbs),
    fatG: Math.round((kcal * pct.fat) / 100 / KCAL_PER_GRAM.fat),
  };
}

/**
 * Share of the goal's kcal that each macro gram target represents, as whole percents (FR-G2).
 * Unlike `macroSplit` (eaten food, normalised by macro-derived kcal) this uses the stated kcal
 * goal as the denominator, so the three may not add up to exactly 100.
 */
export function macroPercentOfKcal(
  goal: Pick<Goal, 'kcal' | 'proteinG' | 'carbsG' | 'fatG'>,
): MacroPercentages | null {
  if (goal.kcal <= 0) return null;
  const pct = (grams: number, kcalPerGram: number) =>
    Math.round(((grams * kcalPerGram) / goal.kcal) * 100);
  return {
    protein: pct(goal.proteinG, KCAL_PER_GRAM.protein),
    carbs: pct(goal.carbsG, KCAL_PER_GRAM.carbs),
    fat: pct(goal.fatG, KCAL_PER_GRAM.fat),
  };
}

// ---------- calculator (FR-G4) ----------

export const CAUTION_KCAL = 1200;
/** Energy in one kilogram of body weight; 0.25 kg/week ≈ 275 kcal/day, 0.5 kg/week ≈ 550. */
export const KCAL_PER_KG = 7700;
export const DAILY_DELTA_025 = Math.round((0.25 * KCAL_PER_KG) / 7);
export const DAILY_DELTA_05 = Math.round((0.5 * KCAL_PER_KG) / 7);

export interface CalculatorInput {
  sex: Sex;
  birthDate: string;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  /** Day key the age is computed against. */
  today: string;
}

export const calculatorResultSchema = z.object({
  bmr: z.number(),
  tdee: z.number(),
  suggestions: z.object({
    maintain: z.number(),
    lose025: z.number(),
    lose05: z.number(),
    gain025: z.number(),
  }),
  /** True when the lowest suggestion falls under 1,200 kcal/day. */
  caution: z.boolean(),
});
export type CalculatorResult = z.infer<typeof calculatorResultSchema>;

export const goalCalculateInputSchema = z.object({
  weightKg: z
    .number()
    .min(20, 'Weight must be at least 20 kg')
    .max(500, 'Weight must be at most 500 kg')
    .optional(),
});
export type GoalCalculateInput = z.infer<typeof goalCalculateInputSchema>;

const splitDay = (day: string): [number, number, number] => [
  Number(day.slice(0, 4)),
  Number(day.slice(5, 7)),
  Number(day.slice(8, 10)),
];

/** Completed years between two day keys; a 29 Feb birthday counts on 1 Mar in common years. */
export function ageInYears(birthDate: string, today: string): number {
  const [by, bm, bd] = splitDay(birthDate);
  const [ty, tm, td] = splitDay(today);
  let years = ty - by;
  if (tm < bm || (tm === bm && td < bd)) years -= 1;
  return Math.max(0, years);
}

/**
 * Mifflin-St Jeor: BMR = 10·kg + 6.25·cm − 5·age + (male ? 5 : −161); TDEE = BMR × activity.
 * Every output is a whole kcal; the suggestions are offsets from the rounded TDEE.
 */
export function mifflinStJeor(input: CalculatorInput): CalculatorResult {
  const age = ageInYears(input.birthDate, input.today);
  const bmr =
    10 * input.weightKg + 6.25 * input.heightCm - 5 * age + (input.sex === 'male' ? 5 : -161);
  const tdee = Math.round(bmr * ACTIVITY_FACTORS[input.activity]);
  const suggestions = {
    maintain: tdee,
    lose025: tdee - DAILY_DELTA_025,
    lose05: tdee - DAILY_DELTA_05,
    gain025: tdee + DAILY_DELTA_025,
  };
  return {
    bmr: Math.round(bmr),
    tdee,
    suggestions,
    caution: suggestions.lose05 < CAUTION_KCAL,
  };
}
