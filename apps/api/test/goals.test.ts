import {
  ageInYears,
  localDayKey,
  type CalculatorResult,
  type DiaryDay,
  type Food,
  type Goal,
  type MealSlot,
} from '@plate/shared';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CategoryService } from '../src/categories/service.js';
import { MealSlotService } from '../src/mealSlots/service.js';
import { createTestApp, login, type TestContext } from './helpers.js';

/** 100 kcal per 100 g, so `quantity` grams = kcal and the status math is exact. */
const fuelPer100 = {
  kcal: 100,
  protein: 10,
  carbs: 10,
  fat: 2,
  fiber: 2,
  sugar: null,
  saturatedFat: null,
  sodiumMg: null,
};

const DAY = '2025-10-19';
const at = (time: string, day = DAY) => `${day}T${time}:00+02:00`;

const goalInput = {
  effectiveFrom: '2025-10-01',
  kcal: 2000,
  proteinG: 150,
  carbsG: 220,
  fatG: 65,
};

let ctx: TestContext;
let cookie: string;
let slots: MealSlot[];
let fuel: Food;

beforeEach(async () => {
  ctx = await createTestApp();
  new CategoryService(ctx.opened.db).seedDefaults();
  new MealSlotService(ctx.opened.db).seedDefaults();
  cookie = await login(ctx.app);
  slots = (await api('GET', '/api/meal-slots')).json<MealSlot[]>();
  const created = await api('POST', '/api/foods', { name: 'Fuel', per100: fuelPer100 });
  expect(created.statusCode, created.body).toBe(201);
  fuel = created.json<Food>();
});
afterEach(() => ctx.close());

const api = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
) => {
  const options: InjectOptions = { method, url, headers: { cookie } };
  if (payload !== undefined) options.payload = payload as NonNullable<InjectOptions['payload']>;
  return ctx.app.inject(options);
};

const paths = (res: { json: () => { error: { details?: unknown } } }) =>
  (res.json().error.details as { path: string }[]).map((d) => d.path);

async function createGoal(overrides: Record<string, unknown> = {}): Promise<Goal> {
  const res = await api('POST', '/api/goals', { ...goalInput, ...overrides });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Goal>();
}

async function activeFor(day: string): Promise<Goal | null> {
  const res = await api('GET', `/api/goals/active?day=${day}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Goal | null>();
}

/** Logs `kcal` kcal of Fuel on the day (1 g = 1 kcal). */
async function eat(kcal: number, day = DAY): Promise<void> {
  const res = await api('POST', '/api/diary/entries', {
    day,
    slotId: slots[0]!.id,
    loggedAt: at('12:00', day),
    foodId: fuel.id,
    quantity: kcal,
  });
  expect(res.statusCode, res.body).toBe(201);
}

async function getDay(day = DAY): Promise<DiaryDay> {
  const res = await api('GET', `/api/diary/${day}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<DiaryDay>();
}

describe('auth gate on goal routes', () => {
  it('denies anonymous access on every route', async () => {
    const routes: ['GET' | 'POST' | 'DELETE', string][] = [
      ['GET', '/api/goals'],
      ['GET', `/api/goals/active?day=${DAY}`],
      ['POST', '/api/goals'],
      ['POST', '/api/goals/calculate'],
      ['DELETE', '/api/goals/1'],
    ];
    for (const [method, url] of routes) {
      const options: InjectOptions = { method, url };
      if (method === 'POST') options.payload = goalInput;
      const res = await ctx.app.inject(options);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Session/);
    }
  });
});

describe('validation', () => {
  it('rejects bad goals with the offending path', async () => {
    const kcal = await api('POST', '/api/goals', { ...goalInput, kcal: 400 });
    expect(kcal.statusCode).toBe(400);
    expect(kcal.json().error.code).toBe('VALIDATION_ERROR');
    expect(paths(kcal)).toEqual(['kcal']);

    const day = await api('POST', '/api/goals', { ...goalInput, effectiveFrom: '2025-02-30' });
    expect(day.statusCode).toBe(400);
    expect(paths(day)).toEqual(['effectiveFrom']);

    const protein = await api('POST', '/api/goals', { ...goalInput, proteinG: -1 });
    expect(protein.statusCode).toBe(400);
    expect(paths(protein)).toEqual(['proteinG']);

    const water = await api('POST', '/api/goals', { ...goalInput, waterMl: 50_000 });
    expect(water.statusCode).toBe(400);
    expect(paths(water)).toEqual(['waterMl']);

    const weight = await api('POST', '/api/goals', { ...goalInput, goalWeightKg: 10 });
    expect(weight.statusCode).toBe(400);
    expect(paths(weight)).toEqual(['goalWeightKg']);

    const weightDate = await api('POST', '/api/goals', {
      ...goalInput,
      goalWeightDate: '2025-02-30',
    });
    expect(weightDate.statusCode).toBe(400);
    expect(paths(weightDate)).toEqual(['goalWeightDate']);
  });

  it('rejects a bad day on the active lookup and a bad weight on calculate', async () => {
    const active = await api('GET', '/api/goals/active?day=nope');
    expect(active.statusCode).toBe(400);
    expect(paths(active)).toEqual(['day']);
    expect((await api('GET', '/api/goals/active')).statusCode).toBe(400);

    const weight = await api('POST', '/api/goals/calculate', { weightKg: 10 });
    expect(weight.statusCode).toBe(400);
    expect(paths(weight)).toEqual(['weightKg']);
  });

  it('returns 404 for an unknown goal', async () => {
    const res = await api('DELETE', '/api/goals/999');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('goals', () => {
  it('creates a goal with null optional targets and lists newest first', async () => {
    const goal = await createGoal();
    expect(goal).toMatchObject({
      ...goalInput,
      fiberG: null,
      waterMl: null,
      goalWeightKg: null,
      goalWeightDate: null,
    });
    expect(goal.id).toBeGreaterThan(0);
    expect(Date.parse(goal.createdAt)).not.toBeNaN();

    const later = await createGoal({ effectiveFrom: '2025-11-01', kcal: 1800 });
    const earlier = await createGoal({ effectiveFrom: '2025-06-01', kcal: 2200, fiberG: 30 });
    const list = (await api('GET', '/api/goals')).json<Goal[]>();
    expect(list.map((g) => g.id)).toEqual([later.id, goal.id, earlier.id]);
    expect(list[2]!.fiberG).toBe(30);
  });

  it('round-trips a goal weight and its target day', async () => {
    const goal = await createGoal({ goalWeightKg: 74, goalWeightDate: '2026-03-01' });
    expect(goal).toMatchObject({ goalWeightKg: 74, goalWeightDate: '2026-03-01' });
    expect(await activeFor(DAY)).toEqual(goal);

    const cleared = await createGoal({ goalWeightKg: 74.5 });
    expect(cleared.id).toBe(goal.id);
    expect(cleared.goalWeightKg).toBe(74.5);
    expect(cleared.goalWeightDate).toBeNull();
  });

  it('replaces the goal that starts on the same day instead of adding one', async () => {
    const first = await createGoal();
    const replaced = await createGoal({ kcal: 1900, waterMl: 2500 });
    expect(replaced.id).toBe(first.id);
    expect(replaced.kcal).toBe(1900);
    expect(replaced.waterMl).toBe(2500);
    expect(replaced.createdAt).toBe(first.createdAt);
    expect((await api('GET', '/api/goals')).json<Goal[]>()).toHaveLength(1);
  });

  it('resolves the goal in effect on a day across several effective dates', async () => {
    const jan = await createGoal({ effectiveFrom: '2025-01-01', kcal: 2100 });
    const jun = await createGoal({ effectiveFrom: '2025-06-01', kcal: 1900 });
    const oct = await createGoal({ effectiveFrom: '2025-10-01', kcal: 2000 });

    expect(await activeFor('2024-12-31')).toBeNull();
    expect((await activeFor('2025-01-01'))?.id).toBe(jan.id);
    expect((await activeFor('2025-05-31'))?.id).toBe(jan.id);
    expect((await activeFor('2025-06-01'))?.id).toBe(jun.id);
    expect((await activeFor('2025-09-30'))?.id).toBe(jun.id);
    expect((await activeFor('2025-10-01'))?.id).toBe(oct.id);
    expect((await activeFor('2025-12-01'))?.id).toBe(oct.id);

    // Deleting the June goal hands its days back to the January goal.
    const del = await api('DELETE', `/api/goals/${jun.id}`);
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });
    expect((await activeFor('2025-07-01'))?.id).toBe(jan.id);
    expect((await api('GET', '/api/goals')).json<Goal[]>()).toHaveLength(2);
  });

  it('may delete the only goal; days then have no goal', async () => {
    const goal = await createGoal();
    expect((await api('DELETE', `/api/goals/${goal.id}`)).statusCode).toBe(200);
    expect(await activeFor(DAY)).toBeNull();
    expect((await api('GET', '/api/goals')).json<Goal[]>()).toEqual([]);
  });
});

describe('day status (FR-G3)', () => {
  it('fills goal, status and remaining on the day view', async () => {
    const goal = await createGoal();

    const empty = await getDay();
    expect(empty.goal).toEqual(goal);
    expect(empty.status).toBe('not_logged');
    expect(empty.remaining).toEqual({ kcal: 2000, protein: 150, carbs: 220, fat: 65, fiber: null });

    await eat(1500);
    const under = await getDay();
    expect(under.status).toBe('under');
    expect(under.remaining?.kcal).toBeCloseTo(500);
    expect(under.remaining?.protein).toBeCloseTo(0);
    expect(under.remaining?.carbs).toBeCloseTo(70);
    expect(under.remaining?.fat).toBeCloseTo(35);

    await eat(300);
    expect((await getDay()).status).toBe('on_target'); // exactly 1800 = lower band edge

    await eat(401);
    const over = await getDay();
    expect(over.status).toBe('over'); // 2201
    expect(over.remaining?.kcal).toBeCloseTo(-201);
  });

  it('judges a day only against the goal in effect on it', async () => {
    await createGoal(); // effective 2025-10-01
    await eat(1500, '2025-09-15');
    const before = await getDay('2025-09-15');
    expect(before.goal).toBeNull();
    expect(before.status).toBe('no_goal');
    expect(before.remaining).toBeNull();

    const after = await getDay('2025-10-02');
    expect(after.goal?.kcal).toBe(2000);
    expect(after.status).toBe('not_logged');
  });

  it('reads the tolerance from settings', async () => {
    await createGoal();
    await eat(1990);
    expect((await getDay()).status).toBe('on_target');

    expect((await api('PUT', '/api/settings', { tolerancePct: 0 })).statusCode).toBe(200);
    expect((await getDay()).status).toBe('under');

    expect((await api('PUT', '/api/settings', { tolerancePct: 25 })).statusCode).toBe(200);
    expect((await getDay()).status).toBe('on_target');
  });

  it('a wide tolerance makes 1,500 of 2,000 on target', async () => {
    await createGoal();
    await eat(1500);
    expect((await api('PUT', '/api/settings', { tolerancePct: 25 })).statusCode).toBe(200);
    expect((await getDay()).status).toBe('on_target');
  });

  it('reports remaining fiber only when the goal sets fiber', async () => {
    await createGoal({ fiberG: 30 });
    await eat(500); // 10 g fiber
    const day = await getDay();
    expect(day.remaining?.fiber).toBeCloseTo(20);

    await createGoal({ fiberG: null });
    expect((await getDay()).remaining?.fiber).toBeNull();
  });
});

describe('calculator (FR-G4)', () => {
  const profile = { sex: 'male', birthDate: '1995-06-15', heightCm: 180, activity: 'moderate' };

  it('needs a profile first', async () => {
    const res = await api('POST', '/api/goals/calculate', { weightKg: 80 });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['profile']);
  });

  it('needs a weight when nothing is logged', async () => {
    expect((await api('PUT', '/api/profile', profile)).statusCode).toBe(200);
    const res = await api('POST', '/api/goals/calculate', {});
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['weightKg']);
  });

  it('uses the latest logged weight when weightKg is omitted', async () => {
    expect((await api('PUT', '/api/profile', profile)).statusCode).toBe(200);
    expect((await api('PUT', '/api/weights/2025-10-01', { kg: 90 })).statusCode).toBe(200);
    expect((await api('PUT', `/api/weights/${DAY}`, { kg: 80 })).statusCode).toBe(200);

    const implicit = await api('POST', '/api/goals/calculate', {});
    expect(implicit.statusCode, implicit.body).toBe(200);
    const explicit = await api('POST', '/api/goals/calculate', { weightKg: 80 });
    expect(implicit.json()).toEqual(explicit.json());
    // An explicit weight still wins over the log.
    const heavier = await api('POST', '/api/goals/calculate', { weightKg: 90 });
    expect(heavier.json<CalculatorResult>().bmr).toBeGreaterThan(
      implicit.json<CalculatorResult>().bmr,
    );
  });

  it('matches the hand-computed Mifflin-St Jeor numbers', async () => {
    expect((await api('PUT', '/api/profile', profile)).statusCode).toBe(200);
    const res = await api('POST', '/api/goals/calculate', { weightKg: 80 });
    expect(res.statusCode, res.body).toBe(200);
    const result = res.json<CalculatorResult>();

    const age = ageInYears(profile.birthDate, localDayKey(new Date()));
    const bmr = Math.round(10 * 80 + 6.25 * 180 - 5 * age + 5);
    const tdee = Math.round(bmr * 1.55);
    expect(result).toEqual({
      bmr,
      tdee,
      suggestions: { maintain: tdee, lose025: tdee - 275, lose05: tdee - 550, gain025: tdee + 275 },
      caution: false,
    });
  });
});
