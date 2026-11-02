import {
  localDayKey,
  shiftDayKey,
  weekStartKey,
  type AboutResponse,
  type AiEstimateFoodResponse,
  type AiParseMealResponse,
  type AiRecipeResponse,
  type AiUsage,
  type AiWeeklyDigestCached,
  type AiWeeklyDigestResponse,
  type ApiError,
  type Food,
  type MealSlot,
} from '@plate/shared';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAKE_INPUT_TOKENS, FAKE_OUTPUT_TOKENS, FAKE_RESPONSES } from '../src/ai/providers/fake.js';
import { sanitiseMatches } from '../src/ai/service.js';
import { ConfigError, DEFAULT_GEMINI_MODEL, loadConfig } from '../src/config.js';
import { MealSlotService } from '../src/mealSlots/service.js';
import { createTestApp, login, type TestContext } from './helpers.js';

const per100 = {
  kcal: 116,
  protein: 9,
  carbs: 20,
  fat: 0.4,
  fiber: 8,
  sugar: null,
  saturatedFat: null,
  sodiumMg: null,
};

/** A 1×1 PNG. */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const TODAY = localDayKey(new Date());
const WEEK_START = weekStartKey(TODAY, 'monday');

interface UsageRow {
  id: number;
  feature: string;
  requested_at: string;
  input_tokens: number | null;
  output_tokens: number | null;
  ok: number;
}

let ctx: TestContext;
let cookie: string;
let slots: MealSlot[];

beforeEach(async () => {
  ctx = await createTestApp();
  new MealSlotService(ctx.opened.db).seedDefaults();
  cookie = await login(ctx.app);
  slots = (await api('GET', '/api/meal-slots')).json<MealSlot[]>();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await ctx.close();
});

const api = (method: 'GET' | 'POST', url: string, payload?: unknown) => {
  const options: InjectOptions = { method, url, headers: { cookie } };
  if (payload !== undefined) options.payload = payload as NonNullable<InjectOptions['payload']>;
  return ctx.app.inject(options);
};
const post = (url: string, payload: unknown) => api('POST', url, payload);

const paths = (res: { json: () => { error: { details?: unknown } } }) =>
  (res.json().error.details as { path: string }[]).map((d) => d.path);

const usageRows = (): UsageRow[] =>
  ctx.opened.sqlite.prepare('SELECT * FROM ai_usage ORDER BY id').all() as UsageRow[];

/** The first food of a fresh database gets id 1, which the canned answers match. */
async function seedFood(overrides: Record<string, unknown> = {}): Promise<Food> {
  const res = await post('/api/foods', { name: 'Dal', per100, ...overrides });
  expect(res.statusCode, res.body).toBe(201);
  const food = res.json<Food>();
  expect(food.id).toBe(1);
  return food;
}

const slot = (name: string) => slots.find((s) => s.name === name)!;

const mealBody = (text: string, extra: Record<string, unknown> = {}) => ({
  text,
  day: TODAY,
  slotId: slot('Dinner').id,
  ...extra,
});

const ROUTES: ['GET' | 'POST', string][] = [
  ['POST', '/api/ai/parse-meal'],
  ['POST', '/api/ai/estimate-food'],
  ['POST', '/api/ai/parse-recipe'],
  ['POST', `/api/ai/weekly-digest`],
  ['GET', `/api/ai/weekly-digest?weekStart=${WEEK_START}`],
  ['GET', '/api/ai/usage?dayStart=2026-11-02T00:00:00.000Z'],
];

describe('auth gate', () => {
  it('denies anonymous access on every AI route', async () => {
    for (const [method, url] of ROUTES) {
      const res = await ctx.app.inject({
        method,
        url,
        ...(method === 'POST' ? { payload: {} } : {}),
      });
      expect(res.statusCode, url).toBe(401);
    }
  });
});

describe('AI_PROVIDER=none', () => {
  it('answers 404 "AI assistance is disabled" on every route, never 500, and reports it in about', async () => {
    await ctx.close();
    ctx = await createTestApp({ aiProvider: 'none', aiModel: null });
    new MealSlotService(ctx.opened.db).seedDefaults();
    cookie = await login(ctx.app);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const bodies: Record<string, unknown> = {
      '/api/ai/parse-meal': { text: '2 rotis', day: TODAY, slotId: 1 },
      '/api/ai/estimate-food': { name: 'Sambar' },
      '/api/ai/parse-recipe': { text: '200 g lentils' },
      '/api/ai/weekly-digest': { weekStart: WEEK_START },
    };
    for (const [method, url] of ROUTES) {
      const res = await api(method, url, method === 'POST' ? bodies[url] : undefined);
      expect(res.statusCode, url).toBe(404);
      expect(res.json<ApiError>().error).toEqual({
        code: 'NOT_FOUND',
        message: 'AI assistance is disabled',
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await api('GET', '/api/about')).json<AboutResponse>().ai).toEqual({
      enabled: false,
      provider: 'none',
      model: null,
    });
  });
});

describe('GET /api/about', () => {
  it('reports the fake provider and its model, and never a key', async () => {
    const res = await api('GET', '/api/about');
    expect(res.statusCode).toBe(200);
    expect(res.json<AboutResponse>().ai).toEqual({
      enabled: true,
      provider: 'fake',
      model: 'fake-1',
    });
    expect(res.body).not.toMatch(/key/i);
  });
});

describe('validation', () => {
  it('parse-meal needs text or a photo, a real day and a known slot', async () => {
    let res = await post('/api/ai/parse-meal', { day: TODAY, slotId: slot('Dinner').id });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['text']);
    expect(res.json<ApiError>().error.code).toBe('VALIDATION_ERROR');

    res = await post('/api/ai/parse-meal', { text: '   ', day: TODAY, slotId: slot('Dinner').id });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['text']);

    res = await post('/api/ai/parse-meal', { text: 'x', day: 'nope', slotId: 1 });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['day']);

    res = await post('/api/ai/parse-meal', { text: 'x', day: TODAY, slotId: 4242 });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['slotId']);
    expect(usageRows()).toEqual([]);
  });

  it('estimate-food needs a name; parse-recipe caps the text; digest and usage check their keys', async () => {
    let res = await post('/api/ai/estimate-food', {});
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['name']);

    res = await post('/api/ai/parse-recipe', { text: 'x'.repeat(8001) });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['text']);

    // 2026-11-03 is a Tuesday; weeks start on Monday by default.
    res = await post('/api/ai/weekly-digest', { weekStart: '2026-11-03' });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['weekStart']);
    expect(res.json<ApiError>().error.message).toBe('Expected the first day of a week');

    res = await post('/api/ai/weekly-digest?refresh=maybe', { weekStart: WEEK_START });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['refresh']);

    res = await api('GET', '/api/ai/usage');
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['dayStart']);
    expect(usageRows()).toEqual([]);
  });

  it('follows the week-start setting for the digest key', async () => {
    // A Sunday is never a week boundary under the default (Monday) setting …
    const sundayStart = weekStartKey(TODAY, 'sunday');
    let res = await post('/api/ai/weekly-digest', { weekStart: sundayStart });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['weekStart']);
    expect(res.json<ApiError>().error.message).toBe('Expected the first day of a week');

    // … and is one once the user picks Sunday weeks.
    const settings = await ctx.app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { weekStart: 'sunday' },
      headers: { cookie },
    });
    expect(settings.statusCode).toBe(200);
    res = await post('/api/ai/weekly-digest', { weekStart: sundayStart });
    // Past the boundary check: the week has nothing logged yet.
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiError>().error.message).toBe('Nothing is logged in this week yet');
  });
});

describe('photo limits', () => {
  beforeEach(async () => {
    await ctx.close();
    ctx = await createTestApp({ aiMaxImageBytes: 64 * 1024 });
    new MealSlotService(ctx.opened.db).seedDefaults();
    cookie = await login(ctx.app);
    slots = (await api('GET', '/api/meal-slots')).json<MealSlot[]>();
  });

  it('rejects a photo above AI_MAX_IMAGE_BYTES with path image', async () => {
    const base64 = Buffer.alloc(70 * 1024, 1).toString('base64');
    const res = await post('/api/ai/parse-meal', {
      image: { mimeType: 'image/jpeg', base64 },
      day: TODAY,
      slotId: slot('Dinner').id,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiError>().error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'The photo is too large',
      details: [{ path: 'image', message: 'Photos must be at most 64 KB' }],
    });
    expect(usageRows()).toEqual([]);
  });

  it('maps a body above the route limit to the same 400, not 413', async () => {
    const base64 = Buffer.alloc(200 * 1024, 1).toString('base64');
    const res = await post('/api/ai/parse-meal', {
      image: { mimeType: 'image/jpeg', base64 },
      day: TODAY,
      slotId: slot('Dinner').id,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiError>().error.code).toBe('VALIDATION_ERROR');
    expect(paths(res)).toEqual(['image']);
  });

  it('rejects a non-base64 photo or an unsupported type with path image', async () => {
    let res = await post('/api/ai/parse-meal', {
      image: { mimeType: 'image/jpeg', base64: 'not base64!' },
      day: TODAY,
      slotId: slot('Dinner').id,
    });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['image.base64']);
    res = await post('/api/ai/parse-meal', {
      image: { mimeType: 'image/gif', base64: TINY_PNG },
      day: TODAY,
      slotId: slot('Dinner').id,
    });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['image.mimeType']);
  });

  it('accepts a small photo with no text', async () => {
    const res = await post('/api/ai/parse-meal', {
      image: { mimeType: 'image/png', base64: TINY_PNG },
      day: TODAY,
      slotId: slot('Dinner').id,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<AiParseMealResponse>().items).toHaveLength(3);
  });
});

describe('POST /api/ai/parse-meal', () => {
  it('returns the canned items with matches sanitised against the library and writes one usage row', async () => {
    // Basis ml so the matched item visibly takes the library food's basis over the model's "g".
    const dal = await seedFood({ basis: 'ml' });
    const res = await post('/api/ai/parse-meal', mealBody('2 rotis, a bowl of dal, one banana'));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['x-ai-model']).toBe('fake-1');
    expect(res.headers['x-ai-retried']).toBe('0');
    expect(res.headers['x-ai-duration-ms']).toMatch(/^\d+$/);

    const body = res.json<AiParseMealResponse>();
    const canned = FAKE_RESPONSES.parse_meal as AiParseMealResponse;
    expect(body.items).toHaveLength(3);
    expect(body.items[0]).toEqual(canned.items[0]);
    expect(body.items[0]?.suggestedFood?.name).toBe('Roti (whole wheat)');
    expect(body.items[1]).toEqual({
      ...canned.items[1],
      matchedFoodId: dal.id,
      basis: 'ml',
      suggestedFood: null,
    });
    expect(body.items[2]).toEqual({ ...canned.items[2], matchedFoodId: null, suggestedFood: null });
    expect(body.notes).toBe(canned.notes);

    expect(usageRows()).toEqual([
      expect.objectContaining({
        feature: 'parse_meal',
        ok: 1,
        input_tokens: FAKE_INPUT_TOKENS,
        output_tokens: FAKE_OUTPUT_TOKENS,
        requested_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) as string,
      }),
    ]);
  });

  it('does not match an archived food', async () => {
    const dal = await seedFood();
    expect((await post(`/api/foods/${dal.id}/archive`, {})).statusCode).toBe(200);
    const res = await post('/api/ai/parse-meal', mealBody('a bowl of dal'));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<AiParseMealResponse>().items[1]?.matchedFoodId).toBeNull();
  });

  it('returns an empty item list when the model finds no food', async () => {
    const res = await post('/api/ai/parse-meal', mealBody('nothing really'));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<AiParseMealResponse>()).toEqual({
      items: [],
      notes: 'No food found in the description.',
    });
  });

  it('maps a provider failure to 502 AI_UNAVAILABLE and records the failed round-trip', async () => {
    const res = await post('/api/ai/parse-meal', mealBody('please fail'));
    expect(res.statusCode).toBe(502);
    expect(res.json<ApiError>().error).toEqual({
      code: 'AI_UNAVAILABLE',
      message: 'The AI provider rejected the request (503): fake provider failure',
    });
    expect(usageRows()).toEqual([
      expect.objectContaining({
        feature: 'parse_meal',
        ok: 0,
        input_tokens: null,
        output_tokens: null,
      }),
    ]);
  });

  it('retries once after an unusable answer and sums the tokens of both calls', async () => {
    const res = await post('/api/ai/parse-meal', mealBody('garbage first, then dal'));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['x-ai-retried']).toBe('1');
    expect(res.json<AiParseMealResponse>().items).toHaveLength(3);
    expect(usageRows()).toEqual([
      expect.objectContaining({
        feature: 'parse_meal',
        ok: 1,
        input_tokens: FAKE_INPUT_TOKENS * 2,
        output_tokens: FAKE_OUTPUT_TOKENS * 2,
      }),
    ]);
  });
});

describe('POST /api/ai/estimate-food', () => {
  it('returns the canned estimate', async () => {
    const res = await post('/api/ai/estimate-food', { name: 'Sambar', description: 'homemade' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<AiEstimateFoodResponse>()).toEqual(FAKE_RESPONSES.estimate_food);
    expect(res.headers['x-ai-model']).toBe('fake-1');
    expect(usageRows().map((r) => r.feature)).toEqual(['estimate_food']);
  });
});

describe('POST /api/ai/parse-recipe', () => {
  it('returns the canned recipe with matches sanitised', async () => {
    const lentils = await seedFood({ name: 'Red lentils' });
    const res = await post('/api/ai/parse-recipe', {
      text: '200 g red lentils\n1 tbsp ghee\n1 onion\nsalt to taste',
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<AiRecipeResponse>();
    const canned = FAKE_RESPONSES.parse_recipe as AiRecipeResponse;
    expect(body.name).toBe('Dal tadka');
    expect(body.cookedWeight).toBe(800);
    expect(body.servings).toBe(4);
    expect(body.ingredients).toHaveLength(4);
    expect(body.ingredients[0]).toEqual({ ...canned.ingredients[0], matchedFoodId: lentils.id });
    expect(body.ingredients[1]).toEqual(canned.ingredients[1]);
    expect(body.ingredients[2]?.suggestedFood?.name).toBe('Onion');
    expect(body.ingredients[3]).toEqual({
      ...canned.ingredients[3],
      matchedFoodId: null,
      suggestedFood: null,
    });
    expect(usageRows().map((r) => r.feature)).toEqual(['parse_recipe']);
  });
});

describe('sanitiseMatches', () => {
  const food = (id: number, kind: 'food' | 'dish'): Food => ({
    id,
    kind,
    name: kind === 'dish' ? 'Dal tadka' : 'Dal',
    brand: null,
    categoryId: null,
    basis: 'g',
    per100,
    portions: [],
    source: 'manual',
    offCode: null,
    estimatedAt: null,
    staleSince: null,
    archivedAt: null,
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
  });
  const library = new Map([
    [1, food(1, 'food')],
    [2, food(2, 'dish')],
  ]);
  const suggestion = (FAKE_RESPONSES.parse_meal as AiParseMealResponse).items[0]!.suggestedFood;
  const items = [
    { matchedFoodId: 1, suggestedFood: suggestion },
    { matchedFoodId: 2, suggestedFood: null },
    { matchedFoodId: 3, suggestedFood: suggestion },
    { matchedFoodId: null, suggestedFood: null },
  ];

  it('keeps dishes as matches for a meal and drops them for a recipe', () => {
    expect(sanitiseMatches(items, library, { allowDishes: true })).toEqual([
      { matchedFoodId: 1, suggestedFood: null },
      { matchedFoodId: 2, suggestedFood: null },
      { matchedFoodId: null, suggestedFood: suggestion },
      { matchedFoodId: null, suggestedFood: null },
    ]);
    expect(sanitiseMatches(items, library, { allowDishes: false })[1]).toEqual({
      matchedFoodId: null,
      suggestedFood: null,
    });
  });
});

describe('weekly digest', () => {
  async function logToday(quantity: number): Promise<void> {
    const res = await post('/api/diary/entries', {
      day: TODAY,
      slotId: slot('Breakfast').id,
      loggedAt: `${TODAY}T08:00:00.000Z`,
      foodId: 1,
      quantity,
    });
    expect(res.statusCode, res.body).toBe(201);
  }

  it('refuses a week with nothing logged, without calling the provider', async () => {
    const res = await post('/api/ai/weekly-digest', { weekStart: WEEK_START });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['weekStart']);
    expect(usageRows()).toEqual([]);
    const cached = await api('GET', `/api/ai/weekly-digest?weekStart=${WEEK_START}`);
    expect(cached.json<AiWeeklyDigestCached>()).toEqual({ digest: null });
  });

  it('generates, caches per week in settings, serves the cache, and regenerates on refresh', async () => {
    await seedFood();
    await logToday(200);
    await logToday(150);

    const first = await post('/api/ai/weekly-digest', { weekStart: WEEK_START });
    expect(first.statusCode, first.body).toBe(200);
    const digest = first.json<AiWeeklyDigestResponse>();
    const canned = FAKE_RESPONSES.weekly_digest as { lines: string[]; suggestion: string };
    expect(digest).toEqual({
      weekStart: WEEK_START,
      lines: canned.lines,
      suggestion: canned.suggestion,
      model: 'fake-1',
      generatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) as string,
    });
    expect(digest.lines).toHaveLength(4);
    expect(usageRows().map((r) => r.feature)).toEqual(['weekly_digest']);

    const row = ctx.opened.sqlite
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get(`ai.digest.${WEEK_START}`) as { value_json: string } | undefined;
    expect(row && (JSON.parse(row.value_json) as AiWeeklyDigestResponse)).toEqual(digest);

    const again = await post('/api/ai/weekly-digest', { weekStart: WEEK_START });
    expect(again.statusCode).toBe(200);
    expect(again.json<AiWeeklyDigestResponse>()).toEqual(digest);
    expect(again.headers['x-ai-model']).toBe('fake-1');
    expect(usageRows()).toHaveLength(1);

    const cached = await api('GET', `/api/ai/weekly-digest?weekStart=${WEEK_START}`);
    expect(cached.statusCode).toBe(200);
    expect(cached.json<AiWeeklyDigestCached>()).toEqual({ digest });

    const otherWeek = await api(
      'GET',
      `/api/ai/weekly-digest?weekStart=${shiftDayKey(WEEK_START, -7)}`,
    );
    expect(otherWeek.json<AiWeeklyDigestCached>()).toEqual({ digest: null });

    await new Promise((resolve) => setTimeout(resolve, 2));
    const refreshed = await post(`/api/ai/weekly-digest?refresh=true`, { weekStart: WEEK_START });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    const next = refreshed.json<AiWeeklyDigestResponse>();
    expect(next.generatedAt > digest.generatedAt).toBe(true);
    expect(usageRows()).toHaveLength(2);
    expect(
      (
        await api('GET', `/api/ai/weekly-digest?weekStart=${WEEK_START}`)
      ).json<AiWeeklyDigestCached>(),
    ).toEqual({ digest: next });
  });

  it('ignores an unreadable cached row', async () => {
    ctx.opened.sqlite
      .prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run(`ai.digest.${WEEK_START}`, '{"lines": 1}', '2026-11-02T00:00:00.000Z');
    const res = await api('GET', `/api/ai/weekly-digest?weekStart=${WEEK_START}`);
    expect(res.statusCode).toBe(200);
    expect(res.json<AiWeeklyDigestCached>()).toEqual({ digest: null });
  });
});

describe('GET /api/ai/usage', () => {
  it('counts every round-trip, failed ones included, since local midnight and over 30 days', async () => {
    await seedFood();
    expect((await post('/api/ai/estimate-food', { name: 'Sambar' })).statusCode).toBe(200);
    expect((await post('/api/ai/estimate-food', { name: 'please fail' })).statusCode).toBe(502);
    expect((await post('/api/ai/parse-meal', mealBody('garbage then dal'))).statusCode).toBe(200);
    const rows = usageRows();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.ok)).toEqual([1, 0, 1]);

    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const res = await api(
      'GET',
      `/api/ai/usage?dayStart=${encodeURIComponent(midnight.toISOString())}`,
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<AiUsage>()).toEqual({ today: rows.length, last30Days: rows.length });

    const tomorrow = new Date(midnight.getTime() + 86_400_000);
    const none = await api(
      'GET',
      `/api/ai/usage?dayStart=${encodeURIComponent(tomorrow.toISOString())}`,
    );
    expect(none.json<AiUsage>().today).toBe(0);

    // A local-time offset is accepted and normalised like every other loggedAt.
    const offset = await api(
      'GET',
      `/api/ai/usage?dayStart=${encodeURIComponent(`${TODAY}T00:00:00+14:00`)}`,
    );
    expect(offset.statusCode).toBe(200);
  });
});

describe('rate cap', () => {
  it('caps each client at 30 AI requests per minute across the AI routes, without touching other routes', async () => {
    for (let i = 0; i < 30; i++) {
      const res = await post('/api/ai/estimate-food', { name: 'Sambar' });
      expect(res.statusCode, `request ${i + 1}`).toBe(200);
    }
    const blocked = await post('/api/ai/estimate-food', { name: 'Sambar' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<ApiError>().error.code).toBe('RATE_LIMITED');
    // One budget for all AI routes, cache-only reads included.
    expect((await post('/api/ai/parse-meal', mealBody('dal'))).statusCode).toBe(429);
    expect((await api('GET', `/api/ai/weekly-digest?weekStart=${WEEK_START}`)).statusCode).toBe(
      429,
    );
    expect((await api('GET', '/api/about')).statusCode).toBe(200);
    expect(usageRows()).toHaveLength(30);
  });
});

describe('config', () => {
  it('defaults to none with no model', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      aiProvider: 'none',
      aiApiKey: undefined,
      aiModel: null,
      aiBaseUrl: undefined,
      aiTimeoutMs: 30_000,
      aiMaxImageBytes: 4 * 1024 * 1024,
    });
  });

  it('treats empty strings (compose passthrough) as unset', () => {
    const config = loadConfig({
      AI_PROVIDER: '',
      AI_API_KEY: '',
      AI_MODEL: '',
      AI_BASE_URL: '',
      AI_TIMEOUT_MS: '',
      AI_MAX_IMAGE_BYTES: '',
    });
    expect(config).toMatchObject({ aiProvider: 'none', aiModel: null, aiTimeoutMs: 30_000 });
    expect(loadConfig({ AI_PROVIDER: 'fake', AI_API_KEY: '' })).toMatchObject({
      aiProvider: 'fake',
      aiModel: 'fake-1',
      aiApiKey: undefined,
    });
  });

  it('requires a key for the real providers and defaults the Gemini model', () => {
    expect(() => loadConfig({ AI_PROVIDER: 'gemini' })).toThrow(ConfigError);
    expect(() => loadConfig({ AI_PROVIDER: 'gemini' })).toThrow(/AI_API_KEY/);
    expect(loadConfig({ AI_PROVIDER: 'gemini', AI_API_KEY: 'k' })).toMatchObject({
      aiProvider: 'gemini',
      aiApiKey: 'k',
      aiModel: DEFAULT_GEMINI_MODEL,
    });
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.8-flash');
    expect(
      loadConfig({ AI_PROVIDER: 'gemini', AI_API_KEY: 'k', AI_MODEL: 'gemini-3.5-flash-lite' })
        .aiModel,
    ).toBe('gemini-3.5-flash-lite');
  });

  it('requires base URL and model for openai_compatible and strips a trailing slash', () => {
    expect(() => loadConfig({ AI_PROVIDER: 'openai_compatible', AI_API_KEY: 'k' })).toThrow(
      /AI_BASE_URL/,
    );
    expect(() =>
      loadConfig({
        AI_PROVIDER: 'openai_compatible',
        AI_API_KEY: 'k',
        AI_BASE_URL: 'https://openrouter.ai/api/v1/',
      }),
    ).toThrow(/AI_MODEL/);
    expect(() =>
      loadConfig({
        AI_PROVIDER: 'openai_compatible',
        AI_API_KEY: 'k',
        AI_BASE_URL: 'ftp://x',
        AI_MODEL: 'x',
      }),
    ).toThrow(/AI_BASE_URL/);
    expect(
      loadConfig({
        AI_PROVIDER: 'openai_compatible',
        AI_API_KEY: 'k',
        AI_BASE_URL: 'https://openrouter.ai/api/v1/',
        AI_MODEL: 'qwen/qwen3-235b',
      }),
    ).toMatchObject({ aiBaseUrl: 'https://openrouter.ai/api/v1', aiModel: 'qwen/qwen3-235b' });
  });

  it('bounds the timeout and the image cap', () => {
    expect(() => loadConfig({ AI_TIMEOUT_MS: '10' })).toThrow(/AI_TIMEOUT_MS/);
    expect(() => loadConfig({ AI_MAX_IMAGE_BYTES: '1' })).toThrow(/AI_MAX_IMAGE_BYTES/);
    expect(loadConfig({ AI_TIMEOUT_MS: '60000', AI_MAX_IMAGE_BYTES: '8388608' })).toMatchObject({
      aiTimeoutMs: 60_000,
      aiMaxImageBytes: 8 * 1024 * 1024,
    });
    expect(() => loadConfig({ AI_PROVIDER: 'openai' })).toThrow(/AI_PROVIDER/);
  });
});
