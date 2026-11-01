import { shiftDayKey, type Goal, type Weight, type WeightStats } from '@plate/shared';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, login, type TestContext } from './helpers.js';

const DAY = '2025-10-19';
const START = '2025-09-01';
const day = (i: number) => shiftDayKey(START, i);

let ctx: TestContext;
let cookie: string;

beforeEach(async () => {
  ctx = await createTestApp();
  cookie = await login(ctx.app);
});
afterEach(() => ctx.close());

const api = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
  const options: InjectOptions = { method, url, headers: { cookie } };
  if (payload !== undefined) options.payload = payload as NonNullable<InjectOptions['payload']>;
  return ctx.app.inject(options);
};

const paths = (res: { json: () => { error: { details?: unknown } } }) =>
  (res.json().error.details as { path: string }[]).map((d) => d.path);

async function putWeight(day: string, kg: number, note?: string): Promise<Weight> {
  const res = await api('PUT', `/api/weights/${day}`, note === undefined ? { kg } : { kg, note });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Weight>();
}

async function list(query = ''): Promise<Weight[]> {
  const res = await api('GET', `/api/weights${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Weight[]>();
}

async function stats(): Promise<WeightStats> {
  const res = await api('GET', '/api/weights/stats');
  expect(res.statusCode, res.body).toBe(200);
  return res.json<WeightStats>();
}

/** 35 daily weigh-ins losing 0.1 kg a day: 80.0 on 1 Sep down to 76.6 on 5 Oct. */
async function seedSeries(): Promise<void> {
  for (let i = 0; i < 35; i++) await putWeight(day(i), Math.round((80 - 0.1 * i) * 10) / 10);
}

const goalInput = {
  effectiveFrom: '2025-01-01',
  kcal: 2000,
  proteinG: 150,
  carbsG: 220,
  fatG: 65,
};

describe('auth gate on weight routes', () => {
  it('denies anonymous access on every route', async () => {
    const routes: ['GET' | 'PUT' | 'DELETE', string][] = [
      ['GET', '/api/weights'],
      ['GET', '/api/weights/stats'],
      ['PUT', `/api/weights/${DAY}`],
      ['DELETE', `/api/weights/${DAY}`],
    ];
    for (const [method, url] of routes) {
      const options: InjectOptions = { method, url };
      if (method === 'PUT') options.payload = { kg: 78.4 };
      const res = await ctx.app.inject(options);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Session/);
    }
  });
});

describe('validation', () => {
  it('rejects a bad weight or note with the offending path', async () => {
    for (const kg of [10, 401, 78.44]) {
      const res = await api('PUT', `/api/weights/${DAY}`, { kg });
      expect(res.statusCode, String(kg)).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      expect(paths(res), String(kg)).toEqual(['kg']);
    }
    const note = await api('PUT', `/api/weights/${DAY}`, { kg: 78.4, note: 'x'.repeat(121) });
    expect(note.statusCode).toBe(400);
    expect(paths(note)).toEqual(['note']);
  });

  it('rejects an impossible day in the URL and an inverted range', async () => {
    const put = await api('PUT', '/api/weights/2025-02-30', { kg: 78.4 });
    expect(put.statusCode).toBe(400);
    expect(paths(put)).toEqual(['day']);

    const del = await api('DELETE', '/api/weights/2025-02-30');
    expect(del.statusCode).toBe(400);

    const range = await api('GET', '/api/weights?from=2025-10-19&to=2025-10-18');
    expect(range.statusCode).toBe(400);
    expect(paths(range)).toEqual(['to']);

    expect((await api('GET', '/api/weights?from=nope')).statusCode).toBe(400);
  });

  it('returns 404 when deleting a day without a weigh-in', async () => {
    const res = await api('DELETE', `/api/weights/${DAY}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('weigh-ins (FR-W1)', () => {
  it('stores one value per day and replaces it on re-log, keeping the id', async () => {
    const first = await putWeight(DAY, 78.9, ' post-run ');
    expect(first).toMatchObject({ day: DAY, kg: 78.9, note: 'post-run' });
    expect(first.id).toBeGreaterThan(0);

    const replaced = await putWeight(DAY, 78.4);
    expect(replaced.id).toBe(first.id);
    expect(replaced.kg).toBe(78.4);
    expect(replaced.note).toBeNull();
    expect(replaced.createdAt).toBe(first.createdAt);
    expect(replaced.updatedAt >= first.updatedAt).toBe(true);
    expect(await list()).toHaveLength(1);

    const blank = await putWeight(DAY, 78.4, '');
    expect(blank.note).toBeNull();
  });

  it('lists oldest first and filters by from/to', async () => {
    await putWeight('2025-10-19', 78.4);
    await putWeight('2025-10-01', 79.5);
    await putWeight('2025-10-10', 79);

    expect((await list()).map((w) => w.day)).toEqual(['2025-10-01', '2025-10-10', '2025-10-19']);
    expect((await list('?from=2025-10-05')).map((w) => w.day)).toEqual([
      '2025-10-10',
      '2025-10-19',
    ]);
    expect((await list('?to=2025-10-10')).map((w) => w.day)).toEqual(['2025-10-01', '2025-10-10']);
    expect((await list('?from=2025-10-02&to=2025-10-18')).map((w) => w.day)).toEqual([
      '2025-10-10',
    ]);
    expect(await list('?from=2025-11-01')).toEqual([]);
  });

  it('deletes a day and then reports 404 for it', async () => {
    await putWeight(DAY, 78.4);
    await putWeight('2025-10-18', 78.9);
    const del = await api('DELETE', `/api/weights/${DAY}`);
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });
    expect((await list()).map((w) => w.day)).toEqual(['2025-10-18']);
    expect((await api('DELETE', `/api/weights/${DAY}`)).statusCode).toBe(404);
  });
});

describe('stats (FR-W2)', () => {
  it('is empty without weigh-ins', async () => {
    expect(await stats()).toEqual({
      latest: null,
      count: 0,
      change7d: null,
      change30d: null,
      movingAverage: [],
      ratePerWeek: null,
      goalKg: null,
      goalDate: null,
      remaining: null,
      eta: null,
    });
  });

  it('computes changes, moving average and rate on a series with a known slope', async () => {
    await seedSeries();
    const s = await stats();
    expect(s.latest?.day).toBe(day(34));
    expect(s.latest?.kg).toBe(76.6);
    expect(s.count).toBe(35);
    expect(s.change7d).toBeCloseTo(-0.7);
    expect(s.change30d).toBeCloseTo(-3);
    expect(s.movingAverage).toHaveLength(35);
    expect(s.movingAverage[34]!.kg).toBeCloseTo(76.9);
    expect(s.ratePerWeek).toBeCloseTo(-0.7);
    expect(s.goalKg).toBeNull();
    expect(s.remaining).toBeNull();
    expect(s.eta).toBeNull();
  });

  it('projects an ETA toward the goal weight of the goal in effect', async () => {
    await seedSeries();
    const goal = await api('POST', '/api/goals', {
      ...goalInput,
      goalWeightKg: 76,
      goalWeightDate: '2026-01-31',
    });
    expect(goal.statusCode, goal.body).toBe(201);
    expect(goal.json<Goal>()).toMatchObject({ goalWeightKg: 76, goalWeightDate: '2026-01-31' });

    const s = await stats();
    expect(s.goalKg).toBe(76);
    expect(s.goalDate).toBe('2026-01-31');
    expect(s.remaining).toBeCloseTo(-0.6);
    // Moving average 76.9 → 76 at 0.1 kg/day = 9 days after the last weigh-in.
    expect(s.eta).toBe(shiftDayKey(day(34), 9));
  });

  it('has no ETA when the trend points away from the goal', async () => {
    await seedSeries();
    expect((await api('POST', '/api/goals', { ...goalInput, goalWeightKg: 85 })).statusCode).toBe(
      201,
    );
    const s = await stats();
    expect(s.goalKg).toBe(85);
    expect(s.remaining).toBeCloseTo(8.4);
    expect(s.eta).toBeNull();
  });

  it('ignores a goal that only starts in the future', async () => {
    await putWeight(DAY, 78.4);
    expect(
      (
        await api('POST', '/api/goals', {
          ...goalInput,
          effectiveFrom: '2999-01-01',
          goalWeightKg: 74,
        })
      ).statusCode,
    ).toBe(201);
    const s = await stats();
    expect(s.goalKg).toBeNull();
    expect(s.remaining).toBeNull();
  });
});
