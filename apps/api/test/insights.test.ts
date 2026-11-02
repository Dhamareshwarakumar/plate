import {
  movingAverage7,
  shiftDayKey,
  type BySlot,
  type DailyAggregate,
  type DayStatus,
  type Dish,
  type Food,
  type InsightsSummary,
  type MealSlot,
  type TopFoods,
  type Weight,
  type WeightVsIntakePoint,
} from '@plate/shared';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CategoryService } from '../src/categories/service.js';
import { MealSlotService } from '../src/mealSlots/service.js';
import { createTestApp, login, type TestContext } from './helpers.js';

// A fortnight from Monday 6 Oct to Sunday 19 Oct 2025; "today" is the Sunday.
const START = '2025-10-06';
const END = '2025-10-19';
const TODAY = END;
const day = (i: number) => shiftDayKey(START, i);
const RANGE = `from=${START}&to=${END}`;
const at = (d: string, time: string) => `${d}T${time}:00+02:00`;

const oatsPer100 = {
  kcal: 389,
  protein: 16.9,
  carbs: 66.3,
  fat: 6.9,
  fiber: null,
  sugar: null,
  saturatedFat: null,
  sodiumMg: null,
};
const bananaPer100 = { ...oatsPer100, kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3, fiber: 2.6 };
const chickenPer100 = { ...oatsPer100, kcal: 165, protein: 31, carbs: 0, fat: 3.6 };
/** One bar is the unit ("100"), so quantity 100 logs one bar of 200 kcal. */
const barPerUnit = { ...oatsPer100, kcal: 200, protein: 20, carbs: 20, fat: 6 };

/** Which pattern each day of the fortnight gets (see `logDay`); `null` is an unlogged day. */
type Pattern = 'on2000' | 'under' | 'underBar' | 'over' | 'on1500' | null;
const PATTERNS: Pattern[] = [
  'on2000', // d0 Mon 6 Oct   2,001.5 kcal, goal 2,000 → on target
  'underBar', // d1          978 → under (oats + protein bar)
  'on2000', // d2            on target
  null, // d3                not logged
  'over', // d4              2,723 → over
  'on2000', // d5            on target
  'on2000', // d6 Sun 12 Oct on target
  'on2000', // d7 Mon 13 Oct 2,001.5 against the new 1,500 goal → over
  'underBar', // d8          978 → under
  'on1500', // d9            1,540 → on target for 1,500
  null, // d10               not logged
  'on1500', // d11           on target
  'on1500', // d12           on target
  null, // d13 Sun 19 Oct    today, nothing yet
];
const EXPECTED_STATUS: DayStatus[] = [
  'on_target',
  'under',
  'on_target',
  'not_logged',
  'over',
  'on_target',
  'on_target',
  'over',
  'under',
  'on_target',
  'not_logged',
  'on_target',
  'on_target',
  'not_logged',
];
const ON2000_KCAL = 2001.5; // oats 250 g (972.5) + chicken 300 g (495) + banana 600 g (534)
const UNDER_BAR_KCAL = 978; // oats 200 g (778) + one bar (200)
const OVER_KCAL = 2723; // oats 700 g
const ON1500_KCAL = 1540; // oats 200 g (778) + chicken 300 g (495) + banana 300 g (267)
const LOGGED_DAYS = 11;
const TOTAL_KCAL = 5 * ON2000_KCAL + 2 * UNDER_BAR_KCAL + OVER_KCAL + 3 * ON1500_KCAL;

/** Weigh-ins on eight of the fourteen days. */
const WEIGH_INS: [number, number][] = [
  [0, 80],
  [1, 79.8],
  [2, 79.9],
  [4, 79.5],
  [5, 79.6],
  [7, 79.2],
  [8, 79],
  [11, 78.8],
];

let ctx: TestContext;
let cookie: string;
let slots: MealSlot[];
let oats: Food;
let banana: Food;
let chicken: Food;

beforeEach(async () => {
  ctx = await createTestApp();
  new CategoryService(ctx.opened.db).seedDefaults();
  new MealSlotService(ctx.opened.db).seedDefaults();
  cookie = await login(ctx.app);
  slots = (await api('GET', '/api/meal-slots')).json<MealSlot[]>();
  oats = await createFood({ name: 'Oats', per100: oatsPer100 });
  banana = await createFood({ name: 'Banana', per100: bananaPer100 });
  chicken = await createFood({ name: 'Chicken breast', per100: chickenPer100 });
});
afterEach(() => ctx.close());

const api = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
  const options: InjectOptions = { method, url, headers: { cookie } };
  if (payload !== undefined) options.payload = payload as NonNullable<InjectOptions['payload']>;
  return ctx.app.inject(options);
};

const paths = (res: { json: () => { error: { details?: unknown } } }) =>
  (res.json().error.details as { path: string }[]).map((d) => d.path);

async function createFood(body: Record<string, unknown>): Promise<Food> {
  const res = await api('POST', '/api/foods', body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Food>();
}

const slot = (name: string) => slots.find((s) => s.name === name)!;

async function log(d: string, slotName: string, time: string, body: Record<string, unknown>) {
  const res = await api('POST', '/api/diary/entries', {
    day: d,
    slotId: slot(slotName).id,
    loggedAt: at(d, time),
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
}

async function logDay(d: string, pattern: Pattern): Promise<void> {
  if (pattern === null) return;
  const oatsG = pattern === 'on2000' ? 250 : pattern === 'over' ? 700 : 200;
  await log(d, 'Breakfast', '07:30', { foodId: oats.id, quantity: oatsG });
  if (pattern === 'on2000' || pattern === 'on1500') {
    await log(d, 'Lunch', '12:30', { foodId: chicken.id, quantity: 300 });
    await log(d, 'Dinner', '19:00', {
      foodId: banana.id,
      quantity: pattern === 'on2000' ? 600 : 300,
    });
  }
  if (pattern === 'underBar') {
    await log(d, 'Lunch', '13:00', {
      foodId: null,
      name: 'Protein bar',
      quantity: 100,
      per100: barPerUnit,
    });
  }
}

async function seedFortnight(): Promise<void> {
  for (const [effectiveFrom, kcal] of [
    [START, 2000],
    [day(7), 1500],
  ] as const) {
    const res = await api('POST', '/api/goals', {
      effectiveFrom,
      kcal,
      proteinG: 150,
      carbsG: 220,
      fatG: 65,
    });
    expect(res.statusCode, res.body).toBe(201);
  }
  for (let i = 0; i < PATTERNS.length; i++) await logDay(day(i), PATTERNS[i]!);
  for (const [i, kg] of WEIGH_INS) {
    expect((await api('PUT', `/api/weights/${day(i)}`, { kg })).statusCode).toBe(200);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await api('GET', url);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<T>();
}

describe('auth gate on insights routes', () => {
  it('denies anonymous access on every route', async () => {
    for (const name of ['daily', 'summary', 'top-foods', 'by-slot', 'weight-vs-intake']) {
      const res = await ctx.app.inject({ method: 'GET', url: `/api/insights/${name}?${RANGE}` });
      expect(res.statusCode, name).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Session/);
    }
  });
});

describe('validation', () => {
  it('rejects inverted and oversized ranges on "to"', async () => {
    for (const name of ['daily', 'summary', 'top-foods', 'by-slot', 'weight-vs-intake']) {
      const inverted = await api('GET', `/api/insights/${name}?from=2025-10-19&to=2025-10-18`);
      expect(inverted.statusCode, name).toBe(400);
      expect(inverted.json().error.code).toBe('VALIDATION_ERROR');
      expect(paths(inverted), name).toEqual(['to']);
    }
    // 2024-01-01..2025-12-31 is 731 days inclusive and allowed; one more day is not.
    expect((await api('GET', '/api/insights/daily?from=2024-01-01&to=2025-12-31')).statusCode).toBe(
      200,
    );
    const tooLong = await api('GET', '/api/insights/daily?from=2024-01-01&to=2026-01-01');
    expect(tooLong.statusCode).toBe(400);
    expect(paths(tooLong)).toEqual(['to']);
  });

  it('rejects impossible or missing day keys on their own path', async () => {
    const from = await api('GET', '/api/insights/daily?from=2025-02-30&to=2025-03-01');
    expect(from.statusCode).toBe(400);
    expect(paths(from)).toEqual(['from']);
    expect((await api('GET', '/api/insights/daily?from=2025-10-13')).statusCode).toBe(400);
    expect((await api('GET', '/api/insights/top-foods')).statusCode).toBe(400);

    const today = await api('GET', `/api/insights/summary?${RANGE}&today=tomorrow`);
    expect(today.statusCode).toBe(400);
    expect(paths(today)).toEqual(['today']);
  });
});

describe('daily (FR-I2–I4)', () => {
  it('returns one row per day, zero rows for unlogged days, judged against the goal in effect', async () => {
    await seedFortnight();
    const rows = await getJson<DailyAggregate[]>(`/api/insights/daily?${RANGE}`);
    expect(rows.map((r) => r.day)).toEqual(Array.from({ length: 14 }, (_, i) => day(i)));
    expect(rows.map((r) => r.status)).toEqual(EXPECTED_STATUS);
    expect(rows.map((r) => r.goalKcal)).toEqual([
      ...Array<number>(7).fill(2000),
      ...Array<number>(7).fill(1500),
    ]);

    const unlogged = rows[3]!;
    expect(unlogged.entryCount).toBe(0);
    expect(unlogged.totals).toEqual({
      kcal: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: null,
      sugar: null,
      saturatedFat: null,
      sodiumMg: null,
    });

    // Oats 250 g + chicken 300 g + banana 600 g, by hand.
    const monday = rows[0]!;
    expect(monday.entryCount).toBe(3);
    expect(monday.totals.kcal).toBeCloseTo(ON2000_KCAL);
    expect(monday.totals.protein).toBeCloseTo(42.25 + 93 + 6.6);
    expect(monday.totals.carbs).toBeCloseTo(165.75 + 0 + 136.8);
    expect(monday.totals.fat).toBeCloseTo(17.25 + 10.8 + 1.8);
    expect(monday.totals.fiber).toBeCloseTo(15.6); // only the banana carries fiber
    expect(monday.totals.sugar).toBeNull();

    // The same intake is "on target" under the 2,000 goal and "over" under the 1,500 goal.
    expect(rows[6]!.totals.kcal).toBeCloseTo(rows[7]!.totals.kcal);
    expect([rows[6]!.status, rows[7]!.status]).toEqual(['on_target', 'over']);
  });

  it('is all not_logged with the goal in effect when nothing was eaten', async () => {
    await seedFortnight();
    const rows = await getJson<DailyAggregate[]>(
      '/api/insights/daily?from=2025-11-01&to=2025-11-07',
    );
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.status === 'not_logged' && r.goalKcal === 1500)).toBe(true);
  });

  it('has no goal before the first goal and no_goal for logged days without one', async () => {
    await logDay(START, 'on2000');
    const rows = await getJson<DailyAggregate[]>(`/api/insights/daily?from=${START}&to=${day(1)}`);
    expect(rows.map((r) => [r.goalKcal, r.status])).toEqual([
      [null, 'no_goal'],
      [null, 'not_logged'],
    ]);
  });
});

describe('summary (FR-I1)', () => {
  it('computes averages, adherence and streaks for the fortnight', async () => {
    await seedFortnight();
    const s = await getJson<InsightsSummary>(`/api/insights/summary?${RANGE}&today=${TODAY}`);
    expect(s).toMatchObject({
      daysInRange: 14,
      daysElapsed: 14,
      daysLogged: LOGGED_DAYS,
      daysWithGoal: LOGGED_DAYS,
      daysOnTarget: 7,
      adherencePct: 64, // 7 of 11
    });
    expect(s.avgKcal).toBeCloseTo(TOTAL_KCAL / LOGGED_DAYS);
    // Protein: 5 × 141.85 (on2000) + 2 × (33.8 + 20) + 118.3 (over) + 3 × (33.8 + 93 + 3.3).
    expect(s.avgProtein).toBeCloseTo((5 * 141.85 + 2 * 53.8 + 118.3 + 3 * 130.1) / LOGGED_DAYS);
    // Today is not logged yet: the logging streak is the 17th–18th; the best run is the 10th–15th.
    expect(s.loggingStreak).toEqual({ current: 2, best: 6 });
    expect(s.onTargetStreak).toEqual({ current: 2, best: 2 });
  });

  it('answers without "today" using the server day, and judges elapsed days against today', async () => {
    await seedFortnight();
    const res = await api('GET', `/api/insights/summary?${RANGE}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<InsightsSummary>().daysLogged).toBe(LOGGED_DAYS);

    const midway = await getJson<InsightsSummary>(`/api/insights/summary?${RANGE}&today=${day(6)}`);
    expect(midway.daysElapsed).toBe(7);
    expect(midway.loggingStreak).toEqual({ current: 3, best: 3 });

    // A one-week range still reports the streak that runs back past its start.
    const lastWeek = await getJson<InsightsSummary>(
      `/api/insights/summary?from=${day(11)}&to=${day(12)}&today=${day(12)}`,
    );
    expect(lastWeek.daysLogged).toBe(2);
    expect(lastWeek.loggingStreak).toEqual({ current: 2, best: 6 });
  });

  it('is nulls and zeros for a range without entries, with the streaks still about today', async () => {
    await seedFortnight();
    const s = await getJson<InsightsSummary>(
      `/api/insights/summary?from=2025-11-01&to=2025-11-07&today=${TODAY}`,
    );
    expect(s).toEqual({
      daysInRange: 7,
      daysElapsed: 0,
      daysLogged: 0,
      daysWithGoal: 0,
      daysOnTarget: 0,
      adherencePct: null,
      avgKcal: null,
      avgProtein: null,
      avgCarbs: null,
      avgFat: null,
      // Streaks are computed over the two years ending today, not the range (D100).
      loggingStreak: { current: 2, best: 6 },
      onTargetStreak: { current: 2, best: 2 },
    });
    // Far in the future nothing connects to today any more.
    const later = await getJson<InsightsSummary>(`/api/insights/summary?${RANGE}&today=2025-12-01`);
    expect(later.loggingStreak).toEqual({ current: 0, best: 6 });
  });
});

describe('top foods (FR-I6)', () => {
  it('ranks by count and by kcal, grouping ad-hoc entries by name', async () => {
    await seedFortnight();
    const top = await getJson<TopFoods>(`/api/insights/top-foods?${RANGE}`);
    expect(top.byCount.map((f) => [f.name, f.count])).toEqual([
      ['Oats', 11],
      ['Chicken breast', 8], // ties with the banana on count; more kcal wins
      ['Banana', 8],
      ['Protein bar', 2],
    ]);
    expect(top.byKcal.map((f) => f.name)).toEqual([
      'Oats',
      'Chicken breast',
      'Banana',
      'Protein bar',
    ]);
    const oatsRow = top.byKcal[0]!;
    expect(oatsRow.foodId).toBe(oats.id);
    expect(oatsRow.kcal).toBeCloseTo(5 * 972.5 + 5 * 778 + 2723);
    const bar = top.byCount[3]!;
    expect(bar).toMatchObject({ foodId: null, kind: null, name: 'Protein bar', count: 2 });
    expect(bar.kcal).toBeCloseTo(400);
    expect(oatsRow.kind).toBe('food');
  });

  it('tells dishes from foods so the client links the right editor', async () => {
    await seedFortnight();
    const created = await api('POST', '/api/dishes', {
      name: 'Banana porridge',
      ingredients: [
        { foodId: oats.id, amount: 100 },
        { foodId: banana.id, amount: 100 },
      ],
      cookedWeight: 400,
      servings: 2,
    });
    expect(created.statusCode, created.body).toBe(201);
    const dish = created.json<Dish>();
    // 478 kcal of raw ingredients over 400 g cooked → 119.5 kcal/100 g; 200 g logged → 239 kcal.
    await log(day(12), 'Snacks', '16:00', { foodId: dish.id, quantity: 200 });

    const top = await getJson<TopFoods>(`/api/insights/top-foods?${RANGE}`);
    const porridge = top.byCount.find((f) => f.name === 'Banana porridge')!;
    expect(porridge).toMatchObject({ foodId: dish.id, kind: 'dish', count: 1 });
    expect(porridge.kcal).toBeCloseTo(239);
    expect(top.byKcal.find((f) => f.name === 'Banana porridge')).toMatchObject({ kind: 'dish' });
    expect(top.byCount.map((f) => [f.name, f.kind])).toEqual([
      ['Oats', 'food'],
      ['Chicken breast', 'food'],
      ['Banana', 'food'],
      ['Protein bar', null],
      ['Banana porridge', 'dish'],
    ]);
  });

  it('uses the food name as it is now, counts only the range, and caps at ten', async () => {
    await seedFortnight();
    const renamed = await api('PUT', `/api/foods/${oats.id}`, {
      name: 'Rolled oats',
      per100: oatsPer100,
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const top = await getJson<TopFoods>(`/api/insights/top-foods?from=${START}&to=${day(6)}`);
    expect(top.byCount.map((f) => [f.name, f.count])).toEqual([
      ['Rolled oats', 6],
      ['Banana', 4], // ties with the chicken on count; 4 × 534 kcal beats 4 × 495
      ['Chicken breast', 4],
      ['Protein bar', 1],
    ]);

    for (let i = 0; i < 12; i++) {
      const extra = await createFood({ name: `Filler ${i}`, per100: oatsPer100 });
      await log(day(12), 'Snacks', '16:00', { foodId: extra.id, quantity: 10 });
    }
    const capped = await getJson<TopFoods>(`/api/insights/top-foods?${RANGE}`);
    expect(capped.byCount).toHaveLength(10);
    expect(capped.byKcal).toHaveLength(10);
  });

  it('is empty for a range without entries', async () => {
    await seedFortnight();
    expect(
      await getJson<TopFoods>('/api/insights/top-foods?from=2025-11-01&to=2025-11-07'),
    ).toEqual({ byCount: [], byKcal: [] });
  });
});

describe('by slot (FR-I7)', () => {
  it('lists every active slot in order, averaging over the logged days of the range', async () => {
    await seedFortnight();
    const res = await getJson<BySlot>(`/api/insights/by-slot?${RANGE}`);
    expect(res.loggedDays).toBe(LOGGED_DAYS);
    expect(res.slots.map((s) => [s.name, s.entryCount, s.days, s.archived])).toEqual([
      ['Breakfast', 11, 11, false],
      ['Lunch', 10, 10, false], // 8 × chicken + 2 × protein bar
      ['Snacks', 0, 0, false],
      ['Dinner', 8, 8, false],
    ]);
    const breakfast = res.slots[0]!;
    expect(breakfast.totalKcal).toBeCloseTo(5 * 972.5 + 5 * 778 + 2723);
    expect(breakfast.avgKcal).toBeCloseTo(breakfast.totalKcal / LOGGED_DAYS);
    const lunch = res.slots[1]!;
    expect(lunch.totalKcal).toBeCloseTo(8 * 495 + 400);
    expect(lunch.avgKcal).toBeCloseTo(lunch.totalKcal / LOGGED_DAYS);
    expect(res.slots[2]).toMatchObject({ totalKcal: 0, avgKcal: 0 });
    // The slot averages add up to the daily average.
    const sum = res.slots.reduce((a, s) => a + s.avgKcal, 0);
    expect(sum).toBeCloseTo(TOTAL_KCAL / LOGGED_DAYS);
  });

  it('shows an archived slot only when it has entries in the range', async () => {
    await seedFortnight();
    const archived = await api('POST', `/api/meal-slots/${slot('Dinner').id}/archive`);
    expect(archived.statusCode, archived.body).toBe(200);
    const withEntries = await getJson<BySlot>(`/api/insights/by-slot?${RANGE}`);
    expect(withEntries.slots.map((s) => [s.name, s.archived])).toEqual([
      ['Breakfast', false],
      ['Lunch', false],
      ['Snacks', false],
      ['Dinner', true],
    ]);
    const without = await getJson<BySlot>('/api/insights/by-slot?from=2025-11-01&to=2025-11-07');
    expect(without.loggedDays).toBe(0);
    expect(without.slots.map((s) => [s.name, s.avgKcal])).toEqual([
      ['Breakfast', 0],
      ['Lunch', 0],
      ['Snacks', 0],
    ]);
  });
});

describe('weight vs intake (FR-I5)', () => {
  it('buckets by the configured week start with the mean of the moving average per week', async () => {
    await seedFortnight();
    const weeks = await getJson<WeightVsIntakePoint[]>(`/api/insights/weight-vs-intake?${RANGE}`);
    expect(weeks.map((w) => [w.weekStart, w.from, w.to, w.days, w.loggedDays])).toEqual([
      [START, START, day(6), 7, 6],
      [day(7), day(7), END, 7, 5],
    ]);
    expect(weeks[0]!.avgKcal).toBeCloseTo((4 * ON2000_KCAL + UNDER_BAR_KCAL + OVER_KCAL) / 6);
    expect(weeks[1]!.avgKcal).toBeCloseTo((ON2000_KCAL + UNDER_BAR_KCAL + 3 * ON1500_KCAL) / 5);
    expect(weeks.map((w) => w.goalKcal)).toEqual([2000, 1500]);
    // Week 1 moving average by hand: 80, 79.9, 79.9, 79.8, 79.76 → mean 79.872 over 5 weigh-ins.
    expect(weeks[0]!.weighIns).toBe(5);
    expect(weeks[0]!.avgWeightKg).toBeCloseTo(79.872, 3);
    // Week 2: 79.6, 79.44, 79.15 (windows reach back into week 1).
    expect(weeks[1]!.weighIns).toBe(3);
    expect(weeks[1]!.avgWeightKg).toBeCloseTo((79.6 + 79.44 + 79.15) / 3, 3);
  });

  it('re-buckets after the week start changes and leaves weeks without weigh-ins null', async () => {
    await seedFortnight();
    expect((await api('PUT', '/api/settings', { weekStart: 'sunday' })).statusCode).toBe(200);
    const weeks = await getJson<WeightVsIntakePoint[]>(`/api/insights/weight-vs-intake?${RANGE}`);
    expect(weeks.map((w) => [w.weekStart, w.from, w.to, w.days])).toEqual([
      ['2025-10-05', START, day(5), 6],
      [day(6), day(6), day(12), 7],
      [END, END, END, 1],
    ]);
    expect(weeks[2]).toMatchObject({
      loggedDays: 0,
      avgKcal: null,
      avgWeightKg: null,
      weighIns: 0,
    });
  });

  it('lets the first week see weigh-ins from before the range', async () => {
    await seedFortnight();
    const before = await getJson<WeightVsIntakePoint[]>(`/api/insights/weight-vs-intake?${RANGE}`);
    expect((await api('PUT', `/api/weights/${day(-3)}`, { kg: 82 })).statusCode).toBe(200);
    const after = await getJson<WeightVsIntakePoint[]>(`/api/insights/weight-vs-intake?${RANGE}`);
    expect(after[0]!.weighIns).toBe(5);
    expect(after[0]!.avgWeightKg).toBeGreaterThan(before[0]!.avgWeightKg!);

    const all = await getJson<Weight[]>('/api/weights');
    const points = movingAverage7(all.map(({ day: d, kg }) => ({ day: d, kg }))).filter(
      (p) => p.day >= START && p.day <= day(6),
    );
    expect(after[0]!.avgWeightKg).toBeCloseTo(points.reduce((a, p) => a + p.kg, 0) / points.length);
    expect(after[1]).toEqual(before[1]);
  });

  it('is a single empty bucket chain without entries or weigh-ins', async () => {
    await seedFortnight();
    const weeks = await getJson<WeightVsIntakePoint[]>(
      '/api/insights/weight-vs-intake?from=2025-11-03&to=2025-11-09',
    );
    expect(weeks).toEqual([
      {
        weekStart: '2025-11-03',
        from: '2025-11-03',
        to: '2025-11-09',
        days: 7,
        loggedDays: 0,
        avgKcal: null,
        avgProtein: null,
        avgCarbs: null,
        avgFat: null,
        goalKcal: 1500,
        avgWeightKg: null,
        weighIns: 0,
      },
    ]);
  });
});
