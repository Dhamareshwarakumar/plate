import { z } from 'zod';
import { nutrientsPer100Schema } from './nutrition.js';
import { offCodeSchema } from './off.js';
import { optionalTrimmed, trimmed } from './zod-helpers.js';

export const FOOD_NAME_MAX = 120;
export const FOOD_BRAND_MAX = 80;
export const PORTION_LABEL_MAX = 60;
export const PORTIONS_MAX = 20;
export const CATEGORY_NAME_MAX = 40;

export const idSchema = z.number().int().positive();
export const isoDateTimeSchema = z.string();

export const foodBasisSchema = z.enum(['g', 'ml']);
export type FoodBasis = z.infer<typeof foodBasisSchema>;

export const foodKindSchema = z.enum(['food', 'dish']);
export type FoodKind = z.infer<typeof foodKindSchema>;

/**
 * Where a food's nutrition came from: typed by hand, an Open Food Facts lookup, computed from a
 * dish's ingredients, or estimated by the AI assistant (Phase 11; such foods also carry `estimatedAt`).
 */
export const foodSourceSchema = z.enum(['manual', 'off', 'dish', 'ai']);
export type FoodSource = z.infer<typeof foodSourceSchema>;

// ---------- categories ----------

export const categoryInputSchema = z.object({
  name: trimmed(CATEGORY_NAME_MAX, 'Category name'),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

export const categorySchema = z.object({
  id: idSchema,
  name: z.string(),
  sortOrder: z.number().int(),
  archivedAt: isoDateTimeSchema.nullable(),
});
export type Category = z.infer<typeof categorySchema>;

export const reorderSchema = z.object({
  ids: z.array(idSchema).min(1).max(500),
});
export type ReorderInput = z.infer<typeof reorderSchema>;

export const DEFAULT_CATEGORIES = [
  'Fruit',
  'Vegetable',
  'Grain & Bread',
  'Protein',
  'Dairy',
  'Legume',
  'Nuts & Seeds',
  'Snack',
  'Beverage',
  'Cooked dish',
  'Condiment',
  'Other',
] as const;

// ---------- portions ----------

export const portionInputSchema = z.object({
  label: trimmed(PORTION_LABEL_MAX, 'Portion label'),
  /** Amount in the food's basis unit (g or ml). */
  amount: z
    .number()
    .positive('Amount must be greater than 0')
    .max(100_000, 'Amount is unrealistically large'),
});
export type PortionInput = z.infer<typeof portionInputSchema>;

export const portionSchema = portionInputSchema.extend({
  id: idSchema,
  sortOrder: z.number().int(),
});
export type Portion = z.infer<typeof portionSchema>;

// ---------- foods ----------

export const foodInputSchema = z.object({
  name: trimmed(FOOD_NAME_MAX, 'Name'),
  brand: optionalTrimmed(FOOD_BRAND_MAX, 'Brand').default(null),
  categoryId: idSchema.nullable().default(null),
  basis: foodBasisSchema.default('g'),
  per100: nutrientsPer100Schema,
  portions: z.array(portionInputSchema).max(PORTIONS_MAX).default([]),
  /** Open Food Facts product code when the values came from a lookup (FR-F5); sets `source = 'off'`. */
  offCode: offCodeSchema.nullable().default(null),
});
export type FoodInput = z.input<typeof foodInputSchema>;
export type FoodInputParsed = z.output<typeof foodInputSchema>;

export const foodSchema = z.object({
  id: idSchema,
  kind: foodKindSchema,
  name: z.string(),
  brand: z.string().nullable(),
  categoryId: idSchema.nullable(),
  basis: foodBasisSchema,
  per100: nutrientsPer100Schema,
  portions: z.array(portionSchema),
  source: foodSourceSchema,
  offCode: z.string().nullable(),
  /**
   * Set when the nutrition came from the AI estimate (`source = 'ai'`) and cleared when the user
   * saves edited nutrition; the library shows such foods with an "Estimated" tag (Phase 11).
   */
  estimatedAt: isoDateTimeSchema.nullable(),
  /** Dishes only: set when an ingredient changed after the last calculation (FR-R2). Null for foods. */
  staleSince: isoDateTimeSchema.nullable(),
  archivedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Food = z.infer<typeof foodSchema>;

export const foodListQuerySchema = z.object({
  query: z.string().trim().max(FOOD_NAME_MAX).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  kind: foodKindSchema.optional(),
});
export type FoodListQuery = z.infer<typeof foodListQuerySchema>;

export const foodListSchema = z.object({
  items: z.array(foodSchema),
  total: z.number().int().nonnegative(),
});
export type FoodList = z.infer<typeof foodListSchema>;

// ---------- CSV import ----------

export const importConflictStrategySchema = z.enum(['update', 'skip']);
export type ImportConflictStrategy = z.infer<typeof importConflictStrategySchema>;

export const importRowResultSchema = z.object({
  /** 1-based line number in the uploaded file (header is line 1). */
  line: z.number().int().positive(),
  name: z.string(),
  brand: z.string().nullable(),
  action: z.enum(['create', 'update', 'skip', 'error']),
  errors: z.array(z.string()),
});
export type ImportRowResult = z.infer<typeof importRowResultSchema>;

export const importResultSchema = z.object({
  dryRun: z.boolean(),
  rows: z.array(importRowResultSchema),
  summary: z.object({
    create: z.number().int().nonnegative(),
    update: z.number().int().nonnegative(),
    skip: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
  }),
});
export type ImportResult = z.infer<typeof importResultSchema>;
