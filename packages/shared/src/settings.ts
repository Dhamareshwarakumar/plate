import { z } from 'zod';
import { dayKeySchema, localDayKey } from './days.js';

// ---------- settings (FR-G3, FR-S2) ----------

export const weekStartSchema = z.enum(['monday', 'sunday']);
export type WeekStart = z.infer<typeof weekStartSchema>;

export const TOLERANCE_MAX = 25;

/** User preferences stored one row per key in the `settings` table; absent keys fall back to defaults. */
export const settingsSchema = z.object({
  /** A day is on target when kcal eaten is within ± this percentage of the goal. */
  tolerancePct: z
    .number()
    .int('Tolerance must be a whole number')
    .min(0, 'Tolerance cannot be negative')
    .max(TOLERANCE_MAX, `Tolerance is at most ${TOLERANCE_MAX}%`),
  weekStart: weekStartSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = { tolerancePct: 10, weekStart: 'monday' };

export const settingsPatchSchema = settingsSchema
  .partial()
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'Nothing to update',
  });
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

// ---------- profile (FR-G4; used only by the goal calculator) ----------

export const sexSchema = z.enum(['male', 'female']);
export type Sex = z.infer<typeof sexSchema>;

export const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'active', 'very_active'] as const;
export const activitySchema = z.enum(ACTIVITY_LEVELS);
export type Activity = z.infer<typeof activitySchema>;

/** TDEE multipliers for the Mifflin-St Jeor BMR. */
export const ACTIVITY_FACTORS: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const PROFILE_BIRTH_MIN = '1900-01-01';
export const HEIGHT_CM_MIN = 100;
export const HEIGHT_CM_MAX = 250;

export const profileInputSchema = z.object({
  sex: sexSchema,
  birthDate: dayKeySchema
    .refine((d) => d >= PROFILE_BIRTH_MIN, { message: 'Birth date must be after 1900' })
    .refine((d) => d <= localDayKey(new Date()), { message: 'Birth date cannot be in the future' }),
  heightCm: z
    .number()
    .min(HEIGHT_CM_MIN, `Height must be at least ${HEIGHT_CM_MIN} cm`)
    .max(HEIGHT_CM_MAX, `Height must be at most ${HEIGHT_CM_MAX} cm`),
  activity: activitySchema,
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

/** The stored profile has the same shape as the input (single row, no id exposed). */
export const profileSchema = profileInputSchema;
export type Profile = z.infer<typeof profileSchema>;
