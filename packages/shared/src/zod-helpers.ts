import { z } from 'zod';

/** Required text: trimmed, 1..max characters. */
export const trimmed = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

/** Optional text: trimmed, blank becomes null. */
export const optionalTrimmed = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable();
