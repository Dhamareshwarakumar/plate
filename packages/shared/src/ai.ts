import { z } from 'zod';
import { dayKeySchema } from './days.js';
import { QUANTITY_MAX, loggedAtSchema } from './diary.js';
import { DISH_INGREDIENTS_MAX, DISH_SERVINGS_MAX, DISH_WEIGHT_MAX } from './dishes.js';
import {
  FOOD_BRAND_MAX,
  FOOD_NAME_MAX,
  PORTIONS_MAX,
  foodBasisSchema,
  idSchema,
  isoDateTimeSchema,
  portionInputSchema,
} from './foods.js';
import { nutrientsPer100Schema } from './nutrition.js';
import { optionalTrimmed, trimmed } from './zod-helpers.js';

/*
 * AI assistance (Phase 11). Everything here is confirm-first: the model proposes, the user edits
 * and confirms, only then is anything written. The request schemas validate what the browser
 * sends; the response schemas validate what the *model* returns (the server re-checks every bound
 * after the call, whatever the provider's structured-output mode promised) and what the API then
 * returns to the browser.
 *
 * Nothing imports this file, so it may import from any sibling.
 */

// ---------- limits ----------

/** Longest meal description the parse-meal route accepts (the textarea caps at the same length). */
export const AI_TEXT_MAX = 2000;
/** Longest pasted recipe. */
export const AI_RECIPE_TEXT_MAX = 8000;
/** Longest estimate rationale the model may return. */
export const AI_RATIONALE_MAX = 300;
/** Longest item/ingredient `description` the model may return, and longest estimate hint the user may type. */
export const AI_DESCRIPTION_MAX = 200;
/** Most items one parsed meal may hold. */
export const AI_MEAL_ITEMS_MAX = 30;
/** Longest free-text `notes` the model may attach to a parsed meal. */
export const AI_NOTES_MAX = 500;
export const AI_DIGEST_LINES_MIN = 3;
export const AI_DIGEST_LINES_MAX = 5;
export const AI_DIGEST_LINE_MAX = 300;
/** Longest "next week" suggestion in a digest. */
export const AI_SUGGESTION_MAX = 500;
/** Default `AI_MAX_IMAGE_BYTES`: decoded size of a meal photo (the client resizes to ≤ 1280 px JPEG first). */
export const AI_MAX_IMAGE_BYTES_DEFAULT = 4 * 1024 * 1024;
export const AI_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

// ---------- configuration surface ----------

/** `AI_PROVIDER` values. `fake` is dev/test only (canned answers, no key) and must be opted into by that exact value. */
export const aiProviderKindSchema = z.enum(['none', 'gemini', 'openai_compatible', 'fake']);
export type AiProviderKind = z.infer<typeof aiProviderKindSchema>;

/** The four features; also the `feature` column of `ai_usage`. */
export const aiFeatureSchema = z.enum([
  'parse_meal',
  'estimate_food',
  'parse_recipe',
  'weekly_digest',
]);
export type AiFeature = z.infer<typeof aiFeatureSchema>;

/** `GET about` → `ai`: what the browser needs to show or hide the features. Never the key. */
export const aiAboutSchema = z.object({
  enabled: z.boolean(),
  provider: aiProviderKindSchema,
  /** Model name as configured or defaulted; null when disabled. */
  model: z.string().nullable(),
});
export type AiAbout = z.infer<typeof aiAboutSchema>;

// ---------- building blocks ----------

export const aiConfidenceSchema = z.enum(['low', 'medium', 'high']);
export type AiConfidence = z.infer<typeof aiConfidenceSchema>;

/** A meal photo as uploaded: base64 of a JPEG/PNG/WebP. The server enforces the decoded size. */
export const aiImageSchema = z.object({
  mimeType: z.enum(AI_IMAGE_MIME_TYPES),
  base64: z
    .string()
    .min(1, 'Expected base64 image data')
    .regex(/^[A-Za-z0-9+/]+=*$/, 'Expected base64 image data'),
});
export type AiImage = z.infer<typeof aiImageSchema>;

/**
 * A food the model proposes to create because nothing in the library matched. `brand` is literally
 * null: AI-created foods never carry a brand (the user adds one in the editor). Created on confirm
 * with `source = 'ai'` and `estimatedAt` set.
 */
export const aiSuggestedFoodSchema = z.object({
  name: trimmed(FOOD_NAME_MAX, 'Name'),
  brand: z.null(),
  basis: foodBasisSchema,
  per100: nutrientsPer100Schema,
  portions: z.array(portionInputSchema).max(PORTIONS_MAX),
});
export type AiSuggestedFood = z.infer<typeof aiSuggestedFoodSchema>;

// ---------- parse meal ----------

/**
 * "Describe or photograph" input: text and/or a photo, plus the diary slot the result is logged to.
 * Blank text becomes null (like every optional text field), so "text or image required" is one
 * check on the parsed value.
 */
export const aiParseMealRequestSchema = z
  .object({
    text: optionalTrimmed(AI_TEXT_MAX, 'Description').default(null),
    image: aiImageSchema.optional(),
    day: dayKeySchema,
    slotId: idSchema,
  })
  .superRefine((v, ctx) => {
    if (v.text === null && v.image === undefined) {
      ctx.addIssue({ code: 'custom', path: ['text'], message: 'Describe the meal or add a photo' });
    }
  });
export type AiParseMealRequest = z.input<typeof aiParseMealRequestSchema>;
export type AiParseMealRequestParsed = z.output<typeof aiParseMealRequestSchema>;

/**
 * One recognised item. `matchedFoodId` points at a library row (the server drops ids that do not
 * exist); otherwise `suggestedFood` carries a new food to create; both null means "needs a food"
 * and the user picks one by hand. `quantity` is the amount eaten, in the item's `basis`.
 */
export const aiMealItemSchema = z.object({
  description: trimmed(AI_DESCRIPTION_MAX, 'Description'),
  matchedFoodId: idSchema.nullable(),
  quantity: z.number().positive().max(QUANTITY_MAX),
  basis: foodBasisSchema,
  confidence: aiConfidenceSchema,
  suggestedFood: aiSuggestedFoodSchema.nullable(),
});
export type AiMealItem = z.infer<typeof aiMealItemSchema>;

export const aiParseMealResponseSchema = z.object({
  items: z.array(aiMealItemSchema).max(AI_MEAL_ITEMS_MAX),
  /** Anything the model was unsure about, shown under the review list. */
  notes: z.string().max(AI_NOTES_MAX).nullable(),
});
export type AiParseMealResponse = z.infer<typeof aiParseMealResponseSchema>;

// ---------- estimate food ----------

export const aiEstimateFoodRequestSchema = z.object({
  name: trimmed(FOOD_NAME_MAX, 'Name'),
  brand: optionalTrimmed(FOOD_BRAND_MAX, 'Brand').default(null),
  /** Free hint from the user ("homemade, with coconut"). */
  description: optionalTrimmed(AI_DESCRIPTION_MAX, 'Description').default(null),
});
export type AiEstimateFoodRequest = z.input<typeof aiEstimateFoodRequestSchema>;
export type AiEstimateFoodRequestParsed = z.output<typeof aiEstimateFoodRequestSchema>;

export const aiEstimateFoodResponseSchema = z.object({
  per100: nutrientsPer100Schema,
  basis: foodBasisSchema,
  portions: z.array(portionInputSchema).max(PORTIONS_MAX),
  confidence: aiConfidenceSchema,
  /** One or two sentences on how the values were arrived at, shown before the user applies them. */
  rationale: z.string().max(AI_RATIONALE_MAX),
});
export type AiEstimateFoodResponse = z.infer<typeof aiEstimateFoodResponseSchema>;

// ---------- parse recipe ----------

export const aiRecipeRequestSchema = z.object({
  text: trimmed(AI_RECIPE_TEXT_MAX, 'Recipe'),
});
export type AiRecipeRequest = z.infer<typeof aiRecipeRequestSchema>;

/** One ingredient line; `amount` is the raw amount in grams or millilitres (the matched food's basis). */
export const aiRecipeIngredientSchema = z.object({
  description: trimmed(AI_DESCRIPTION_MAX, 'Description'),
  matchedFoodId: idSchema.nullable(),
  amount: z.number().positive().max(DISH_WEIGHT_MAX),
  suggestedFood: aiSuggestedFoodSchema.nullable(),
});
export type AiRecipeIngredient = z.infer<typeof aiRecipeIngredientSchema>;

export const aiRecipeResponseSchema = z.object({
  name: trimmed(FOOD_NAME_MAX, 'Name'),
  ingredients: z.array(aiRecipeIngredientSchema).max(DISH_INGREDIENTS_MAX),
  /** Estimated weight after cooking, in grams; null when the model cannot tell. */
  cookedWeight: z.number().positive().max(DISH_WEIGHT_MAX).nullable(),
  servings: z.number().int().positive().max(DISH_SERVINGS_MAX).nullable(),
});
export type AiRecipeResponse = z.infer<typeof aiRecipeResponseSchema>;

// ---------- weekly digest ----------

/** `weekStart` is the first day of a week per the week-start setting; the server rejects other days. */
export const aiWeeklyDigestRequestSchema = z.object({
  weekStart: dayKeySchema,
});
export type AiWeeklyDigestRequest = z.infer<typeof aiWeeklyDigestRequestSchema>;

/** What the model returns: a few plain-text lines plus one concrete suggestion. */
export const aiWeeklyDigestModelSchema = z.object({
  lines: z
    .array(z.string().max(AI_DIGEST_LINE_MAX))
    .min(AI_DIGEST_LINES_MIN)
    .max(AI_DIGEST_LINES_MAX),
  suggestion: z.string().max(AI_SUGGESTION_MAX),
});
export type AiWeeklyDigestModel = z.infer<typeof aiWeeklyDigestModelSchema>;

/** What the API returns and caches (settings key `ai.digest.<weekStart>`). */
export const aiWeeklyDigestResponseSchema = aiWeeklyDigestModelSchema.extend({
  weekStart: dayKeySchema,
  generatedAt: isoDateTimeSchema,
  model: z.string(),
});
export type AiWeeklyDigestResponse = z.infer<typeof aiWeeklyDigestResponseSchema>;

/** `GET ai/weekly-digest`: the cached digest for the week, or null when none was generated yet. */
export const aiWeeklyDigestCachedSchema = z.object({
  digest: aiWeeklyDigestResponseSchema.nullable(),
});
export type AiWeeklyDigestCached = z.infer<typeof aiWeeklyDigestCachedSchema>;

/** `POST ai/weekly-digest?refresh=true` regenerates instead of returning the cached digest. */
export const aiWeeklyDigestQuerySchema = z.object({
  refresh: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(false),
});
export type AiWeeklyDigestQuery = z.input<typeof aiWeeklyDigestQuerySchema>;

// ---------- usage ----------

/** `dayStart` is the client's local midnight as an ISO instant, so "today" follows the browser's zone. */
export const aiUsageQuerySchema = z.object({
  dayStart: loggedAtSchema,
});
export type AiUsageQuery = z.infer<typeof aiUsageQuerySchema>;

/** Provider round-trips (successful or not) since local midnight and over the last 30 days. */
export const aiUsageSchema = z.object({
  today: z.number().int().nonnegative(),
  last30Days: z.number().int().nonnegative(),
});
export type AiUsage = z.infer<typeof aiUsageSchema>;
