import { z } from 'zod';
import { dayKeySchema } from './days.js';
import { diaryDaySchema, loggedAtSchema } from './diary.js';
import { foodBasisSchema, foodKindSchema, idSchema, isoDateTimeSchema } from './foods.js';
import { nutrientsPer100Schema, nutrientsSchema } from './nutrition.js';
import { trimmed } from './zod-helpers.js';

export const MEAL_TEMPLATE_NAME_MAX = 60;
export const MEAL_TEMPLATE_ITEMS_MIN = 1;
export const MEAL_TEMPLATE_ITEMS_MAX = 30;
export const MEAL_TEMPLATE_AMOUNT_MAX = 100_000;

const amountSchema = z
  .number()
  .positive('Amount must be greater than 0')
  .max(MEAL_TEMPLATE_AMOUNT_MAX, 'Amount is unrealistically large');

export const mealTemplateItemInputSchema = z.object({
  foodId: idSchema,
  /** Quantity in the food's basis (g or ml). */
  amount: amountSchema,
});
export type MealTemplateItemInput = z.infer<typeof mealTemplateItemInputSchema>;

/** A meal template (FR-R3): a named list of (food or dish, amount) logged in one tap. */
export const mealTemplateInputSchema = z.object({
  name: trimmed(MEAL_TEMPLATE_NAME_MAX, 'Name'),
  items: z
    .array(mealTemplateItemInputSchema)
    .min(MEAL_TEMPLATE_ITEMS_MIN, 'Add at least one item')
    .max(MEAL_TEMPLATE_ITEMS_MAX, `At most ${MEAL_TEMPLATE_ITEMS_MAX} items`),
});
export type MealTemplateInput = z.infer<typeof mealTemplateInputSchema>;

/** An item with the *current* name and per-100 values of its food, for the preview and review list. */
export const mealTemplateItemSchema = z.object({
  id: idSchema,
  foodId: idSchema,
  amount: z.number(),
  sortOrder: z.number().int(),
  name: z.string(),
  brand: z.string().nullable(),
  kind: foodKindSchema,
  basis: foodBasisSchema,
  per100: nutrientsPer100Schema,
  archivedAt: isoDateTimeSchema.nullable(),
});
export type MealTemplateItem = z.infer<typeof mealTemplateItemSchema>;

export const mealTemplateSchema = z.object({
  id: idSchema,
  name: z.string(),
  items: z.array(mealTemplateItemSchema),
  /** Preview totals from the items' current per-100 values. */
  totals: nutrientsSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type MealTemplate = z.infer<typeof mealTemplateSchema>;

// ---------- logging ----------

export const logTemplateOverrideSchema = z.object({
  /** Position in `items`. */
  index: z.number().int().nonnegative(),
  amount: amountSchema,
});
export type LogTemplateOverride = z.infer<typeof logTemplateOverrideSchema>;

/**
 * Logs every item of a template into one meal. `overrides` replace item amounts after the user
 * reviewed the list; `loggedAt` defaults to the server's current time when omitted.
 */
export const logTemplateSchema = z.object({
  day: dayKeySchema,
  slotId: idSchema,
  loggedAt: loggedAtSchema.optional(),
  overrides: z.array(logTemplateOverrideSchema).max(MEAL_TEMPLATE_ITEMS_MAX).default([]),
});
export type LogTemplateInput = z.input<typeof logTemplateSchema>;
export type LogTemplateInputParsed = z.output<typeof logTemplateSchema>;

export const logTemplateResultSchema = z.object({
  logged: z.number().int().nonnegative(),
  day: diaryDaySchema,
});
export type LogTemplateResult = z.infer<typeof logTemplateResultSchema>;

// ---------- save as meal ----------

/** Snapshots a logged meal's library foods and quantities into a new template ("Save as meal"). */
export const templateFromMealSchema = z.object({
  day: dayKeySchema,
  slotId: idSchema,
  name: trimmed(MEAL_TEMPLATE_NAME_MAX, 'Name'),
});
export type TemplateFromMealInput = z.infer<typeof templateFromMealSchema>;

export const templateFromMealResultSchema = z.object({
  template: mealTemplateSchema,
  /** Ad-hoc entries have no library food and cannot be part of a template. */
  skipped: z.number().int().nonnegative(),
});
export type TemplateFromMealResult = z.infer<typeof templateFromMealResultSchema>;
