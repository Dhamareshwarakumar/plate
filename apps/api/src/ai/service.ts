import {
  aiEstimateFoodResponseSchema,
  aiParseMealResponseSchema,
  aiRecipeResponseSchema,
  aiWeeklyDigestModelSchema,
  aiWeeklyDigestResponseSchema,
  buildEstimateFoodPrompt,
  buildParseMealPrompt,
  buildParseRecipePrompt,
  buildWeeklyDigestPrompt,
  invalidResponseFollowUp,
  LIBRARY_RECENT_MAX,
  localDayKey,
  selectLibraryRows,
  shiftDayKey,
  weekStartKey,
  type AiEstimateFoodRequestParsed,
  type AiEstimateFoodResponse,
  type AiFeature,
  type AiParseMealRequestParsed,
  type AiParseMealResponse,
  type AiPrompt,
  type AiRecipeRequest,
  type AiRecipeResponse,
  type AiSuggestedFood,
  type AiUsage,
  type AiWeeklyDigestRequest,
  type AiWeeklyDigestResponse,
  type Food,
  type LibraryIndexRow,
} from '@plate/shared';
import { eq, gte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/index.js';
import { aiUsage, settings } from '../db/schema.js';
import type { DiaryService } from '../diary/service.js';
import { AppError } from '../errors.js';
import type { FoodService } from '../foods/service.js';
import type { InsightsService } from '../insights/service.js';
import type { MealSlotService } from '../mealSlots/service.js';
import type { SettingsService } from '../settings/service.js';
import { providerJsonSchema } from './json-schema.js';
import { AiProviderError, type AiPart, type AiProvider } from './providers/index.js';

export interface AiServiceLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface AiServiceDeps {
  /** Null when `AI_PROVIDER=none`: every method then answers 404 "AI assistance is disabled". */
  provider: AiProvider | null;
  foods: FoodService;
  diary: DiaryService;
  mealSlots: MealSlotService;
  insights: InsightsService;
  settings: SettingsService;
  /** `AI_MAX_IMAGE_BYTES`: largest decoded meal photo. */
  maxImageBytes: number;
  logger?: AiServiceLogger | undefined;
}

/** What the route reports in `x-ai-*` headers: nothing secret, enough to judge a live call. */
export interface AiMeta {
  model: string;
  /** True when the first answer failed validation and the one retry produced this result. */
  retried: boolean;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AiOutcome<T> {
  result: T;
  meta: AiMeta;
}

/** Output caps per feature. Generous because thinking tokens count against them on Gemini 3.x/4. */
const MAX_OUTPUT_TOKENS = {
  parse_meal: 8192,
  estimate_food: 4096,
  parse_recipe: 8192,
  weekly_digest: 2048,
} as const satisfies Record<AiFeature, number>;

/** Settings key of a cached digest; the week start is the key the request validated. */
export const digestSettingKey = (weekStart: string): string => `ai.digest.${weekStart}`;

const disabledError = () => new AppError(404, 'NOT_FOUND', 'AI assistance is disabled');

/** 400 at `image`, shared by the size check and the route's body-limit mapping. */
export function imageTooLargeError(maxImageBytes: number): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'The photo is too large', [
    { path: 'image', message: `Photos must be at most ${formatLimit(maxImageBytes)}` },
  ]);
}

function formatLimit(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return mib >= 1 ? `${Math.round(mib * 10) / 10} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** Decoded size of base64 text: three bytes per four characters minus the padding. */
export function base64DecodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Drops `matchedFoodId`s that are not in the library (or name a dish where only ingredient foods
 * may match); a matched item never also carries a suggestion. An unmatched item keeps whatever
 * suggestion the model attached; with none it is the UI's "needs a food".
 */
export function sanitiseMatches<
  T extends { matchedFoodId: number | null; suggestedFood: AiSuggestedFood | null },
>(items: T[], library: Map<number, Food>, options: { allowDishes: boolean }): T[] {
  return items.map((item) => {
    if (item.matchedFoodId === null) return item;
    const food = library.get(item.matchedFoodId);
    if (!food || (!options.allowDishes && food.kind === 'dish')) {
      return { ...item, matchedFoodId: null };
    }
    return item.suggestedFood === null ? item : { ...item, suggestedFood: null };
  });
}

const toIndexRow = (food: Food): LibraryIndexRow => ({
  id: food.id,
  name: food.name,
  brand: food.brand,
  basis: food.basis,
  kcal: food.per100.kcal,
  kind: food.kind,
});

type Parsed<T> = { ok: true; data: T } | { ok: false; issues: string };

/** Parses and validates a model answer; the issue summary feeds the one retry. */
function parseAnswer<T>(text: string, schema: z.ZodType<T>): Parsed<T> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, issues: 'not valid JSON' };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return { ok: false, issues };
}

const sumTokens = (a: number | null, b: number | null): number | null =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0);

/**
 * The AI assistance features (Phase 11). The service owns everything between the validated
 * request and the validated answer: the library index, the prompt (built in shared), the one
 * retry after an unusable answer, sanitising of matched ids, the digest cache, the usage ledger
 * and the mapping of driver failures to `AI_UNAVAILABLE`. It never sees the key.
 */
export class AiService {
  constructor(
    private readonly db: Db,
    private readonly deps: AiServiceDeps,
  ) {}

  get enabled(): boolean {
    return this.deps.provider !== null;
  }

  /** "Describe or photograph": the items eaten, matched against the library or proposed as new foods. */
  async parseMeal(input: AiParseMealRequestParsed): Promise<AiOutcome<AiParseMealResponse>> {
    this.requireProvider();
    let slotName: string;
    try {
      slotName = this.deps.mealSlots.get(input.slotId).name;
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 404) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Unknown meal slot', [
          { path: 'slotId', message: 'Unknown meal slot' },
        ]);
      }
      throw err;
    }
    if (input.image && base64DecodedBytes(input.image.base64) > this.deps.maxImageBytes) {
      throw imageTooLargeError(this.deps.maxImageBytes);
    }
    const library = this.library();
    const recentIds = this.deps.diary.recentFoods(LIBRARY_RECENT_MAX).map((u) => u.foodId);
    const rows = selectLibraryRows([...library.values()].map(toIndexRow), recentIds, input.text);
    const prompt = buildParseMealPrompt({
      text: input.text,
      hasImage: input.image !== undefined,
      day: input.day,
      slotName,
      library: rows,
    });
    const extra: AiPart[] = input.image
      ? [{ imageBase64: input.image.base64, mimeType: input.image.mimeType }]
      : [];
    const { result, meta } = await this.complete(
      'parse_meal',
      prompt,
      extra,
      aiParseMealResponseSchema,
    );
    const items = sanitiseMatches(result.items, library, { allowDishes: true }).map((item) => {
      const matched = item.matchedFoodId === null ? undefined : library.get(item.matchedFoodId);
      if (matched) return { ...item, basis: matched.basis };
      if (item.suggestedFood) return { ...item, basis: item.suggestedFood.basis };
      return item;
    });
    return { result: { items, notes: result.notes }, meta };
  }

  /** Label-style nutrition for a named food; no library involved. */
  async estimateFood(
    input: AiEstimateFoodRequestParsed,
  ): Promise<AiOutcome<AiEstimateFoodResponse>> {
    this.requireProvider();
    const prompt = buildEstimateFoodPrompt(input);
    return this.complete('estimate_food', prompt, [], aiEstimateFoodResponseSchema);
  }

  /** A pasted recipe as a dish: ingredients match only against plain foods (an ingredient cannot be a dish). */
  async parseRecipe(input: AiRecipeRequest): Promise<AiOutcome<AiRecipeResponse>> {
    this.requireProvider();
    const library = this.library();
    const rows = [...library.values()].filter((f) => f.kind === 'food').map(toIndexRow);
    const recentIds = this.deps.diary.recentFoods(LIBRARY_RECENT_MAX).map((u) => u.foodId);
    const prompt = buildParseRecipePrompt({
      text: input.text,
      library: selectLibraryRows(rows, recentIds, input.text),
    });
    const { result, meta } = await this.complete(
      'parse_recipe',
      prompt,
      [],
      aiRecipeResponseSchema,
    );
    return {
      result: {
        ...result,
        ingredients: sanitiseMatches(result.ingredients, library, { allowDishes: false }),
      },
      meta,
    };
  }

  /**
   * The week's digest, cached in `settings` under `ai.digest.<weekStart>`; `refresh` regenerates.
   * `today` is the server's local day unless the caller knows better (D70 approximation).
   */
  async weeklyDigest(
    input: AiWeeklyDigestRequest,
    refresh: boolean,
    today = localDayKey(new Date()),
  ): Promise<AiOutcome<AiWeeklyDigestResponse>> {
    const provider = this.requireProvider();
    const { weekStart } = input;
    if (weekStartKey(weekStart, this.deps.settings.get().weekStart) !== weekStart) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Expected the first day of a week', [
        { path: 'weekStart', message: 'Expected the first day of a week' },
      ]);
    }
    if (!refresh) {
      const cached = this.cachedDigest(weekStart);
      if (cached) {
        return {
          result: cached,
          meta: {
            model: cached.model,
            retried: false,
            durationMs: 0,
            inputTokens: null,
            outputTokens: null,
          },
        };
      }
    }
    const weekEnd = shiftDayKey(weekStart, 6);
    const { insights } = this.deps;
    const summary = insights.summary(weekStart, weekEnd, today);
    if (summary.daysLogged === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Nothing is logged in this week yet', [
        { path: 'weekStart', message: 'Log at least one day of this week first' },
      ]);
    }
    const prompt = buildWeeklyDigestPrompt({
      weekStart,
      weekEnd,
      summary,
      daily: insights.daily(weekStart, weekEnd),
      bySlot: insights.bySlot(weekStart, weekEnd),
      topFoods: insights.topFoods(weekStart, weekEnd, 5).byCount,
    });
    const { result, meta } = await this.complete(
      'weekly_digest',
      prompt,
      [],
      aiWeeklyDigestModelSchema,
    );
    const digest: AiWeeklyDigestResponse = {
      ...result,
      weekStart,
      generatedAt: new Date().toISOString(),
      model: provider.model,
    };
    const now = digest.generatedAt;
    const valueJson = JSON.stringify(digest);
    this.db
      .insert(settings)
      .values({ key: digestSettingKey(weekStart), valueJson, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { valueJson, updatedAt: now } })
      .run();
    return { result: digest, meta };
  }

  /** The cached digest of a week, or null when none was generated (or the stored row is unreadable). */
  cachedDigest(weekStart: string): AiWeeklyDigestResponse | null {
    this.requireProvider();
    const row = this.db
      .select({ valueJson: settings.valueJson })
      .from(settings)
      .where(eq(settings.key, digestSettingKey(weekStart)))
      .get();
    if (!row) return null;
    let json: unknown;
    try {
      json = JSON.parse(row.valueJson);
    } catch {
      return null;
    }
    const parsed = aiWeeklyDigestResponseSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  }

  /**
   * Provider round-trips since `dayStart` (the browser's local midnight) and over the 30 days
   * ending with that day. Stored timestamps are UTC ISO strings, so they compare as text.
   */
  usage(dayStart: string): AiUsage {
    this.requireProvider();
    const start = Date.parse(dayStart);
    if (Number.isNaN(start)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Expected an ISO-8601 timestamp', [
        { path: 'dayStart', message: 'Expected an ISO-8601 timestamp' },
      ]);
    }
    const since = new Date(start).toISOString();
    const since30 = new Date(start - 29 * 86_400_000).toISOString();
    const countSince = (iso: string): number =>
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(aiUsage)
        .where(gte(aiUsage.requestedAt, iso))
        .get()?.n ?? 0;
    return { today: countSince(since), last30Days: countSince(since30) };
  }

  private requireProvider(): AiProvider {
    if (!this.deps.provider) throw disabledError();
    return this.deps.provider;
  }

  /** Active foods and dishes by id: the match targets and the source of the prompt's index. */
  private library(): Map<number, Food> {
    return new Map(this.deps.foods.list({}).items.map((food) => [food.id, food]));
  }

  /**
   * One feature call: the provider round-trip, JSON parsing and schema validation, one retry that
   * tells the model what was wrong, one usage row whatever the outcome, and the mapping of driver
   * failures to a user-readable 502. Logs numbers only, never prompts, answers or the key.
   */
  private async complete<T>(
    feature: AiFeature,
    prompt: AiPrompt,
    extraParts: AiPart[],
    schema: z.ZodType<T>,
  ): Promise<AiOutcome<T>> {
    const provider = this.requireProvider();
    const requestedAt = new Date().toISOString();
    const started = Date.now();
    const jsonSchema = providerJsonSchema(schema);
    const parts: AiPart[] = [{ text: prompt.text }, ...extraParts];
    const request = {
      feature,
      system: prompt.system,
      jsonSchema,
      maxOutputTokens: MAX_OUTPUT_TOKENS[feature],
    };
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let retried = false;
    try {
      let answer = await provider.complete({ ...request, parts });
      inputTokens = sumTokens(inputTokens, answer.inputTokens);
      outputTokens = sumTokens(outputTokens, answer.outputTokens);
      let parsed = parseAnswer(answer.text, schema);
      if (!parsed.ok) {
        retried = true;
        answer = await provider.complete({
          ...request,
          parts: [...parts, { text: invalidResponseFollowUp(parsed.issues) }],
        });
        inputTokens = sumTokens(inputTokens, answer.inputTokens);
        outputTokens = sumTokens(outputTokens, answer.outputTokens);
        parsed = parseAnswer(answer.text, schema);
        if (!parsed.ok) {
          this.deps.logger?.warn(
            { feature, model: provider.model, issues: parsed.issues },
            'ai answer failed validation twice',
          );
          throw new AppError(
            502,
            'AI_UNAVAILABLE',
            'The AI model returned an answer Plate could not use. Try rephrasing.',
          );
        }
      }
      const durationMs = Date.now() - started;
      this.recordUsage(feature, requestedAt, true, inputTokens, outputTokens);
      this.deps.logger?.info(
        { feature, model: provider.model, durationMs, retried, inputTokens, outputTokens },
        'ai request completed',
      );
      return {
        result: parsed.data,
        meta: { model: provider.model, retried, durationMs, inputTokens, outputTokens },
      };
    } catch (err) {
      this.recordUsage(feature, requestedAt, false, inputTokens, outputTokens);
      if (err instanceof AiProviderError) throw toAppError(err);
      throw err;
    }
  }

  private recordUsage(
    feature: AiFeature,
    requestedAt: string,
    ok: boolean,
    inputTokens: number | null,
    outputTokens: number | null,
  ): void {
    this.db
      .insert(aiUsage)
      .values({ feature, requestedAt, inputTokens, outputTokens, ok: ok ? 1 : 0 })
      .run();
  }
}

/** The user-readable 502 for each failure class (D192). The detail is already scrubbed by the driver. */
function toAppError(err: AiProviderError): AppError {
  switch (err.reason) {
    case 'timeout':
      return new AppError(502, 'AI_UNAVAILABLE', `${err.message} Try again.`);
    case 'network':
      return new AppError(502, 'AI_UNAVAILABLE', 'Could not reach the AI provider.');
    case 'http':
      if (err.status === 429) {
        return new AppError(
          502,
          'AI_UNAVAILABLE',
          'The AI provider is rate-limiting requests (429). Wait a minute and try again.',
        );
      }
      return new AppError(
        502,
        'AI_UNAVAILABLE',
        `The AI provider rejected the request (${err.status ?? 'error'})${
          err.message ? `: ${err.message}` : ''
        }`,
      );
    case 'empty':
      return new AppError(502, 'AI_UNAVAILABLE', err.message);
  }
}
