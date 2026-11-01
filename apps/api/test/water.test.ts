import type { DiaryDay, Food, MealSlot, WaterEntry } from '@plate/shared';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CategoryService } from '../src/categories/service.js';
import { MealSlotService } from '../src/mealSlots/service.js';
import { createTestApp, login, type TestContext } from './helpers.js';

const DAY = '2025-10-19';
const OTHER_DAY = '2025-10-20';

let ctx: TestContext;
let cookie: string;

beforeEach(async () => {
  ctx = await createTestApp();
  new CategoryService(ctx.opened.db).seedDefaults();
  new MealSlotService(ctx.opened.db).seedDefaults();
  cookie = await login(ctx.app);
});
afterEach(() => ctx.close());

const api = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) => {
  const options: InjectOptions = { method, url, headers: { cookie } };
  if (payload !== undefined) options.payload = payload as NonNullable<InjectOptions['payload']>;
  return ctx.app.inject(options);
};

const paths = (res: { json: () => { error: { details?: unknown } } }) =>
  (res.json().error.details as { path: string }[]).map((d) => d.path);

async function addWater(ml: number, day = DAY): Promise<WaterEntry> {
  const res = await api('POST', '/api/water', { day, ml });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<WaterEntry>();
}

async function getDay(day = DAY): Promise<DiaryDay> {
  const res = await api('GET', `/api/diary/${day}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<DiaryDay>();
}

describe('auth gate on water routes', () => {
  it('denies anonymous access', async () => {
    const routes: ['POST' | 'DELETE', string][] = [
      ['POST', '/api/water'],
      ['DELETE', '/api/water/1'],
    ];
    for (const [method, url] of routes) {
      const options: InjectOptions = { method, url };
      if (method === 'POST') options.payload = { day: DAY, ml: 250 };
      const res = await ctx.app.inject(options);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Session/);
    }
  });
});

describe('validation', () => {
  it('rejects amounts outside 1–5,000 whole millilitres', async () => {
    for (const ml of [0, 5001, 250.5, -250]) {
      const res = await api('POST', '/api/water', { day: DAY, ml });
      expect(res.statusCode, String(ml)).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      expect(paths(res), String(ml)).toEqual(['ml']);
    }
  });

  it('rejects an impossible day', async () => {
    const res = await api('POST', '/api/water', { day: '2025-02-30', ml: 250 });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['day']);
  });

  it('returns 404 for an unknown entry', async () => {
    const res = await api('DELETE', '/api/water/999');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('water on a day (FR-D9)', () => {
  it('creates an entry with a server timestamp', async () => {
    const entry = await addWater(250);
    expect(entry).toMatchObject({ day: DAY, ml: 250 });
    expect(entry.id).toBeGreaterThan(0);
    expect(Date.parse(entry.loggedAt)).not.toBeNaN();
  });

  it('sums per day and lists the additions in order', async () => {
    const first = await addWater(250);
    const second = await addWater(500);
    await addWater(330, OTHER_DAY);

    const day = await getDay();
    expect(day.water.ml).toBe(750);
    expect(day.water.entries.map((e) => e.id)).toEqual([first.id, second.id]);
    expect(day.water.entries[1]).toEqual(second);

    const other = await getDay(OTHER_DAY);
    expect(other.water.ml).toBe(330);
    expect(other.water.entries).toHaveLength(1);

    expect((await getDay('2025-10-21')).water).toEqual({ ml: 0, entries: [] });
  });

  it('does not count as logging', async () => {
    await addWater(1000);
    const day = await getDay();
    expect(day.entryCount).toBe(0);
    expect(day.status).toBe('not_logged');
    expect(day.totals.kcal).toBe(0);
  });

  it('removes an entry and the total drops', async () => {
    await addWater(250);
    const last = await addWater(500);
    const del = await api('DELETE', `/api/water/${last.id}`);
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });

    const day = await getDay();
    expect(day.water.ml).toBe(250);
    expect(day.water.entries).toHaveLength(1);
    expect((await api('DELETE', `/api/water/${last.id}`)).statusCode).toBe(404);
  });

  it('coexists with diary entries on the same day', async () => {
    const slots = (await api('GET', '/api/meal-slots')).json<MealSlot[]>();
    const food = (
      await api('POST', '/api/foods', {
        name: 'Fuel',
        per100: {
          kcal: 100,
          protein: 10,
          carbs: 10,
          fat: 2,
          fiber: null,
          sugar: null,
          saturatedFat: null,
          sodiumMg: null,
        },
      })
    ).json<Food>();
    const logged = await api('POST', '/api/diary/entries', {
      day: DAY,
      slotId: slots[0]!.id,
      loggedAt: `${DAY}T12:00:00+02:00`,
      foodId: food.id,
      quantity: 200,
    });
    expect(logged.statusCode, logged.body).toBe(201);
    await addWater(250);

    const day = await getDay();
    expect(day.entryCount).toBe(1);
    expect(day.totals.kcal).toBe(200);
    expect(day.water.ml).toBe(250);
  });
});
