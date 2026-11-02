import { z } from 'zod';
import { nutrientsPer100Schema } from './nutrition.js';

// Imports only nutrition.ts (never foods.ts): foods.ts imports this file for `offCode`.

/**
 * An Open Food Facts product code as stored and accepted by the API: digits only, so it is safe
 * to splice into the upstream URL. Wide (4–32) because OFF also keeps short internal codes.
 */
export const OFF_CODE_RE = /^\d{4,32}$/;
/** What the client treats as a barcode typed into the search box: EAN-8 … GTIN-14. */
export const OFF_BARCODE_RE = /^\d{8,14}$/;

/** True when the query looks like a barcode, so the sheet does a product lookup, not a text search. */
export function isOffBarcode(query: string): boolean {
  return OFF_BARCODE_RE.test(query.trim());
}

export const offCodeSchema = z.string().trim().regex(OFF_CODE_RE, 'Enter a barcode (digits only)');

/** Longest free-text query the proxy accepts; the lookup sheet caps its input at the same length. */
export const OFF_QUERY_MAX = 100;

export const offSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(2, 'Type at least 2 characters')
    .max(OFF_QUERY_MAX, `At most ${OFF_QUERY_MAX} characters`),
});
export type OffSearchQuery = z.infer<typeof offSearchQuerySchema>;

/** One lookup result, already mapped to Plate's per-100 shape and validated against its bounds. */
export const offResultSchema = z.object({
  code: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  per100: nutrientsPer100Schema,
  /** Package size as printed on OFF ("1l", "250 g"); display only. */
  quantity: z.string().nullable(),
});
export type OffResult = z.infer<typeof offResultSchema>;

export const offSearchResponseSchema = z.object({
  items: z.array(offResultSchema),
});
export type OffSearchResponse = z.infer<typeof offSearchResponseSchema>;
