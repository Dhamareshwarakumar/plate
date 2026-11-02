import { z } from 'zod';
import { aiAboutSchema } from './ai.js';

/** Stable machine-readable error codes returned by the API. */
export const apiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INVALID_CREDENTIALS',
  'INTERNAL_ERROR',
  /** A third-party service the server proxied to (Open Food Facts) failed or timed out. */
  'UPSTREAM_ERROR',
  /** The configured AI provider failed, timed out or answered unusably (Phase 11); 502. */
  'AI_UNAVAILABLE',
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  dbOk: z.boolean(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** More → About (FR-S6): version, database footprint and headline counts. */
export const aboutResponseSchema = z.object({
  version: z.string(),
  dbSizeBytes: z.number().int().nonnegative(),
  /** File name only; the directory stays on the server. */
  dbPath: z.string(),
  counts: z.object({
    foods: z.number().int().nonnegative(),
    entries: z.number().int().nonnegative(),
    /** Distinct diary days. */
    days: z.number().int().nonnegative(),
  }),
  /** Whether the Open Food Facts proxy is on (`OFF_LOOKUP_ENABLED`); hides "Search online" when false. */
  offEnabled: z.boolean(),
  /** AI assistance (Phase 11): enabled flag, provider kind and model name. Never the key. */
  ai: aiAboutSchema,
});
export type AboutResponse = z.infer<typeof aboutResponseSchema>;

export const okResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof okResponseSchema>;
