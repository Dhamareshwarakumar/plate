import { z } from 'zod';

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
});
export type AboutResponse = z.infer<typeof aboutResponseSchema>;

export const okResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof okResponseSchema>;
