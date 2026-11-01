import type {
  CopyResult,
  DiaryDay,
  DiaryDaySummary,
  DiaryEntry,
  Food,
  FoodUsage,
  MealSlot,
} from '@plate/shared';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CategoryService } from '../src/categories/service.js';
import { MealSlotService } from '../src/mealSlots/service.js';
import { createTestApp, login, type TestContext } from './helpers.js';

const bananaPer100 = {
  kcal: 89,
  protein: 1.1,
  carbs: 22.8,
  fat: 0.3,
  fiber: 2.6,
  sugar: 12.2,
  saturatedFat: null,
  sodiumMg: 1,
};
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

const DAY = '2025-10-19';
const at = (time: string, day = DAY) => `${day}T${time}:00+02:00`;

let ctx: TestContext;
let cookie: string;
let slots: MealSlot[];
let banana: Food;
let oats: Food;

beforeEach(async () => {
  ctx = await createTestApp();
  new CategoryService(ctx.opened.db).seedDefaults();
  new MealSlotService(ctx.opened.db).seedDefaults();
  cookie = await login(ctx.app);
  slots = (await api('GET', '/api/meal-slots')).json<MealSlot[]>();
  banana = await createFood({
    name: 'Banana',
    brand: 'Chiquita',
    per100: bananaPer100,
    portions: [
      { label: '1 medium', amount: 118 },
      { label: '1 large', amount: 136 },
    ],
  });
  oats = await createFood({ name: 'Oats', per100: oatsPer100 });
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

async function createFood(body: Record<string, unknown>): Promise<Food> {
  const res = await api('POST', '/api/foods', body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Food>();
}

const slot = (name: string) => slots.find((s) => s.name === name)!;

async function log(overrides: Record<string, unknown>): Promise<DiaryEntry> {
  const res = await api('POST', '/api/diary/entries', {
    day: DAY,
    slotId: slot('Breakfast').id,
    loggedAt: at('07:40'),
    foodId: banana.id,
    quantity: 100,
    ...overrides,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<DiaryEntry>();
}

const getDay = async (day = DAY) => {
  const res = await api('GET', `/api/diary/${day}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<DiaryDay>();
};

const paths = (res: { json: () => { error: { details?: unknown } } }) =>
  (res.json().error.details as { path: string }[]).map((d) => d.path);

describe('auth gate on diary routes', () => {
  it('denies anonymous access on every route', async () => {
    const range = 'from=2025-10-13&to=2025-10-19';
    const routes: ['GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', string][] = [
      ['GET', `/api/diary/${DAY}`],
      ['GET', `/api/diary/days?${range}`],
      ['GET', '/api/diary/recent-foods'],
      ['GET', '/api/diary/frequent-foods'],
      ['GET', `/api/diary/export.csv?${range}`],
      ['POST', '/api/diary/entries'],
      ['PATCH', '/api/diary/entries/1'],
      ['DELETE', '/api/diary/entries/1'],
      ['POST', '/api/diary/entries/1/duplicate'],
      ['POST', '/api/diary/copy'],
    ];
    for (const [method, url] of routes) {
      const options: InjectOptions = { method, url };
      if (method !== 'GET') options.payload = { day: DAY };
      const res = await ctx.app.inject(options);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Session/);
    }
  });
});

describe('validation', () => {
  it('rejects invalid day keys', async () => {
    const res = await api('GET', '/api/diary/2025-02-30');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(paths(res)).toEqual(['day']);
    expect((await api('GET', '/api/diary/20251019')).statusCode).toBe(400);
  });

  it('rejects inverted and oversized day ranges', async () => {
    const inverted = await api('GET', '/api/diary/days?from=2025-10-19&to=2025-10-18');
    expect(inverted.statusCode).toBe(400);
    expect(paths(inverted)).toContain('to');
    expect(
      (await api('GET', '/api/diary/export.csv?from=2024-01-01&to=2025-12-31')).statusCode,
    ).toBe(400);
    expect((await api('GET', '/api/diary/days?from=2025-10-19')).statusCode).toBe(400);
  });

  it('rejects bad entries with the offending path', async () => {
    const zero = await api('POST', '/api/diary/entries', {
      day: DAY,
      slotId: slot('Breakfast').id,
      loggedAt: at('07:40'),
      foodId: banana.id,
      quantity: 0,
    });
    expect(zero.statusCode).toBe(400);
    expect(paths(zero)).toEqual(['quantity']);

    const adHoc = await api('POST', '/api/diary/entries', {
      day: DAY,
      slotId: slot('Breakfast').id,
      loggedAt: at('07:40'),
      foodId: null,
      quantity: 100,
    });
    expect(adHoc.statusCode).toBe(400);
    expect(paths(adHoc)).toEqual(expect.arrayContaining(['name', 'per100']));

    const note = await api('POST', '/api/diary/entries', {
      day: DAY,
      slotId: slot('Breakfast').id,
      loggedAt: at('07:40'),
      foodId: banana.id,
      quantity: 100,
      note: 'x'.repeat(281),
    });
    expect(note.statusCode).toBe(400);
    expect(paths(note)).toEqual(['note']);

    const badTime = await api('POST', '/api/diary/entries', {
      day: DAY,
      slotId: slot('Breakfast').id,
      loggedAt: 'yesterday',
      foodId: banana.id,
      quantity: 100,
    });
    expect(badTime.statusCode).toBe(400);
    expect(paths(badTime)).toEqual(['loggedAt']);
  });

  it('rejects unknown slot and food ids', async () => {
    const slotRes = await api('POST', '/api/diary/entries', {
      day: DAY,
      slotId: 4242,
      loggedAt: at('07:40'),
      foodId: banana.id,
      quantity: 100,
    });
    expect(slotRes.statusCode).toBe(400);
    expect(paths(slotRes)).toEqual(['slotId']);

    const foodRes = await api('POST', '/api/diary/entries', {
      day: DAY,
      slotId: slot('Breakfast').id,
      loggedAt: at('07:40'),
      foodId: 4242,
      quantity: 100,
    });
    expect(foodRes.statusCode).toBe(400);
    expect(paths(foodRes)).toEqual(['foodId']);
  });
});

describe('logging and the day view', () => {
  it('shows an empty day with every active slot in order', async () => {
    const day = await getDay();
    expect(day).toMatchObject({
      day: DAY,
      entryCount: 0,
      goal: null,
      status: 'not_logged',
      water: { ml: 0 },
    });
    expect(day.slots.map((s) => s.slot.name)).toEqual(['Breakfast', 'Lunch', 'Snacks', 'Dinner']);
    expect(day.slots.every((s) => s.entries.length === 0)).toBe(true);
    expect(day.totals).toEqual({
      kcal: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: null,
      sugar: null,
      saturatedFat: null,
      sodiumMg: null,
    });
  });

  it('snapshots the food and derives totals from per100 × quantity / 100', async () => {
    const entry = await log({ quantity: 450, note: ' post-run ' });
    expect(entry).toMatchObject({
      day: DAY,
      slotId: slot('Breakfast').id,
      loggedAt: at('07:40'),
      foodId: banana.id,
      name: 'Banana',
      basis: 'g',
      quantity: 450,
      portionLabel: null,
      portionCount: null,
      note: 'post-run',
      per100: bananaPer100,
    });
    expect(entry.totals.kcal).toBeCloseTo(400.5);
    expect(entry.totals.protein).toBeCloseTo(4.95);
    expect(entry.totals.fiber).toBeCloseTo(11.7);
    expect(entry.totals.saturatedFat).toBeNull();
    expect(entry.totals.sodiumMg).toBeCloseTo(4.5);
  });

  it('groups entries by slot with SQL totals per slot and per day', async () => {
    await log({ quantity: 450, loggedAt: at('07:40') });
    await log({ foodId: oats.id, quantity: 80, loggedAt: at('07:30') });
    await log({
      foodId: oats.id,
      quantity: 50,
      slotId: slot('Dinner').id,
      loggedAt: at('19:00'),
    });

    const day = await getDay();
    expect(day.entryCount).toBe(3);
    expect(day.status).toBe('no_goal');
    const breakfast = day.slots.find((s) => s.slot.name === 'Breakfast')!;
    expect(breakfast.entries.map((e) => e.name)).toEqual(['Oats', 'Banana']);
    expect(breakfast.totals.kcal).toBeCloseTo(389 * 0.8 + 400.5);
    expect(breakfast.totals.protein).toBeCloseTo(16.9 * 0.8 + 4.95);
    expect(breakfast.totals.fiber).toBeCloseTo(11.7);
    expect(breakfast.totals.saturatedFat).toBeNull();

    const dinner = day.slots.find((s) => s.slot.name === 'Dinner')!;
    expect(dinner.totals.kcal).toBeCloseTo(389 * 0.5);
    expect(dinner.totals.fiber).toBeNull();

    const lunch = day.slots.find((s) => s.slot.name === 'Lunch')!;
    expect(lunch.entries).toEqual([]);
    expect(lunch.totals.kcal).toBe(0);

    expect(day.totals.kcal).toBeCloseTo(389 * 1.3 + 400.5);
    expect(day.totals.fiber).toBeCloseTo(11.7);
    expect(day.totals.sodiumMg).toBeCloseTo(4.5);
  });

  it('lists an archived slot last when it still has entries that day', async () => {
    const snacks = slot('Snacks');
    await log({ slotId: snacks.id, loggedAt: at('16:00') });
    await api('POST', `/api/meal-slots/${snacks.id}/archive`);
    const day = await getDay();
    expect(day.slots.map((s) => s.slot.name)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snacks']);
    expect(day.slots[3]?.slot.archivedAt).not.toBeNull();
    const other = await getDay('2025-10-20');
    expect(other.slots.map((s) => s.slot.name)).toEqual(['Breakfast', 'Lunch', 'Dinner']);
  });

  it('turns a matching portion label into amount × count, case-insensitively', async () => {
    const two = await log({ quantity: 1, portionLabel: '1 MEDIUM', portionCount: 2 });
    expect(two.quantity).toBe(236);
    expect(two.portionLabel).toBe('1 MEDIUM');
    expect(two.portionCount).toBe(2);
    expect(two.totals.kcal).toBeCloseTo(89 * 2.36);

    const unknown = await log({ quantity: 90, portionLabel: 'handful', portionCount: 3 });
    expect(unknown.quantity).toBe(90);
  });

  it('stores ad-hoc entries as sent, with basis g by default', async () => {
    const entry = await log({
      foodId: null,
      name: 'Pizza slice',
      quantity: 200,
      portionLabel: '1 slice',
      portionCount: 2,
      per100: { ...oatsPer100, kcal: 285, protein: 12, carbs: 36, fat: 10 },
    });
    expect(entry).toMatchObject({
      foodId: null,
      name: 'Pizza slice',
      basis: 'g',
      quantity: 200,
      portionLabel: '1 slice',
      portionCount: 2,
    });
    expect(entry.per100.kcal).toBe(285);
    expect(entry.totals.kcal).toBeCloseTo(570);

    const ml = await log({
      foodId: null,
      name: 'Latte',
      basis: 'ml',
      quantity: 250,
      per100: { ...oatsPer100, kcal: 60, protein: 3, carbs: 5, fat: 3 },
    });
    expect(ml.basis).toBe('ml');
  });

  it('keeps the snapshot when the food is edited later (FR-D10)', async () => {
    const entry = await log({ quantity: 100 });
    const edited = await api('PUT', `/api/foods/${banana.id}`, {
      name: 'Banana, ripe',
      basis: 'g',
      per100: { ...bananaPer100, kcal: 120 },
      portions: [],
    });
    expect(edited.statusCode, edited.body).toBe(200);

    const day = await getDay();
    const stored = day.slots[0]!.entries[0]!;
    expect(stored.id).toBe(entry.id);
    expect(stored.name).toBe('Banana');
    expect(stored.per100.kcal).toBe(89);
    expect(stored.totals.kcal).toBeCloseTo(89);

    // Patching the quantity recomputes from the entry's own snapshot, not the edited food.
    const patched = await api('PATCH', `/api/diary/entries/${entry.id}`, { quantity: 200 });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json<DiaryEntry>().totals.kcal).toBeCloseTo(178);
    expect(patched.json<DiaryEntry>().per100.kcal).toBe(89);
  });
});

describe('editing entries', () => {
  it('patches slot, day, note and time, and re-resolves portions', async () => {
    const entry = await log({ quantity: 100 });
    const res = await api('PATCH', `/api/diary/entries/${entry.id}`, {
      slotId: slot('Lunch').id,
      day: '2025-10-20',
      note: 'moved',
      loggedAt: at('12:30', '2025-10-20'),
    });
    expect(res.statusCode, res.body).toBe(200);
    const moved = res.json<DiaryEntry>();
    expect(moved).toMatchObject({
      slotId: slot('Lunch').id,
      day: '2025-10-20',
      note: 'moved',
      loggedAt: at('12:30', '2025-10-20'),
      quantity: 100,
    });
    expect(moved.updatedAt >= entry.updatedAt).toBe(true);
    expect((await getDay()).entryCount).toBe(0);
    expect((await getDay('2025-10-20')).entryCount).toBe(1);

    const portioned = await api('PATCH', `/api/diary/entries/${entry.id}`, {
      portionLabel: '1 large',
      portionCount: 3,
    });
    expect(portioned.json<DiaryEntry>().quantity).toBe(408);
    expect(portioned.json<DiaryEntry>().totals.kcal).toBeCloseTo(89 * 4.08);

    // A plain quantity keeps the portion fields unless the client clears them.
    const grams = await api('PATCH', `/api/diary/entries/${entry.id}`, {
      quantity: 50,
      portionLabel: null,
      portionCount: null,
    });
    expect(grams.json<DiaryEntry>()).toMatchObject({
      quantity: 50,
      portionLabel: null,
      portionCount: null,
    });

    const cleared = await api('PATCH', `/api/diary/entries/${entry.id}`, { note: '' });
    expect(cleared.json<DiaryEntry>().note).toBeNull();
  });

  it('rejects an empty patch, a move into an archived slot and unknown entries', async () => {
    const entry = await log({});
    expect((await api('PATCH', `/api/diary/entries/${entry.id}`, {})).statusCode).toBe(400);

    const snacks = slot('Snacks');
    await api('POST', `/api/meal-slots/${snacks.id}/archive`);
    const archived = await api('PATCH', `/api/diary/entries/${entry.id}`, { slotId: snacks.id });
    expect(archived.statusCode).toBe(400);
    expect(paths(archived)).toEqual(['slotId']);

    expect((await api('PATCH', '/api/diary/entries/4242', { quantity: 1 })).statusCode).toBe(404);
  });

  it('keeps editing an entry that sits in a slot archived after logging', async () => {
    const snacks = slot('Snacks');
    const entry = await log({ slotId: snacks.id, loggedAt: at('15:30') });
    await api('POST', `/api/meal-slots/${snacks.id}/archive`);

    const quantity = await api('PATCH', `/api/diary/entries/${entry.id}`, { quantity: 50 });
    expect(quantity.statusCode, quantity.body).toBe(200);
    expect(quantity.json<DiaryEntry>()).toMatchObject({ quantity: 50, slotId: snacks.id });

    // Sending the unchanged (archived) slot id, as the edit sheet does, is not a move.
    const samePlace = await api('PATCH', `/api/diary/entries/${entry.id}`, {
      slotId: snacks.id,
      note: 'still here',
    });
    expect(samePlace.statusCode, samePlace.body).toBe(200);
    expect(samePlace.json<DiaryEntry>()).toMatchObject({ slotId: snacks.id, note: 'still here' });

    const day = await getDay();
    const last = day.slots[day.slots.length - 1]!;
    expect(last.slot.id).toBe(snacks.id);
    expect(last.entries.map((e) => e.id)).toEqual([entry.id]);

    // Moving into a different archived slot is still refused.
    const dinner = slot('Dinner');
    await api('POST', `/api/meal-slots/${dinner.id}/archive`);
    const moved = await api('PATCH', `/api/diary/entries/${entry.id}`, { slotId: dinner.id });
    expect(moved.statusCode).toBe(400);
    expect(paths(moved)).toEqual(['slotId']);
  });

  it('deletes, then 404s on later edits', async () => {
    const entry = await log({});
    const del = await api('DELETE', `/api/diary/entries/${entry.id}`);
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });
    expect((await api('PATCH', `/api/diary/entries/${entry.id}`, { quantity: 1 })).statusCode).toBe(
      404,
    );
    expect((await api('DELETE', `/api/diary/entries/${entry.id}`)).statusCode).toBe(404);
    expect((await getDay()).entryCount).toBe(0);
  });

  it('duplicates into the same day and slot with the given time', async () => {
    const entry = await log({ quantity: 450, portionLabel: 'handful', portionCount: 1 });
    const res = await api('POST', `/api/diary/entries/${entry.id}/duplicate`, {
      loggedAt: at('08:05'),
    });
    expect(res.statusCode, res.body).toBe(201);
    const copy = res.json<DiaryEntry>();
    expect(copy.id).not.toBe(entry.id);
    expect(copy).toMatchObject({
      day: DAY,
      slotId: entry.slotId,
      foodId: banana.id,
      name: 'Banana',
      quantity: 450,
      portionLabel: 'handful',
      portionCount: 1,
      loggedAt: at('08:05'),
    });
    expect(copy.totals).toEqual(entry.totals);
    expect((await getDay()).entryCount).toBe(2);

    const noBody = await api('POST', `/api/diary/entries/${entry.id}/duplicate`);
    expect(noBody.statusCode, noBody.body).toBe(201);
    expect((await api('POST', '/api/diary/entries/4242/duplicate', {})).statusCode).toBe(404);
  });
});

describe('copying days and meals', () => {
  it('copies a whole day keeping times, appending on repeat', async () => {
    await log({ quantity: 450, loggedAt: at('07:40') });
    await log({ foodId: oats.id, quantity: 60, slotId: slot('Dinner').id, loggedAt: at('19:15') });

    const first = await api('POST', '/api/diary/copy', { fromDay: DAY, toDay: '2025-10-20' });
    expect(first.statusCode, first.body).toBe(200);
    const result = first.json<CopyResult>();
    expect(result.copied).toBe(2);
    expect(result.day.day).toBe('2025-10-20');
    expect(result.day.entryCount).toBe(2);
    const copied = result.day.slots.flatMap((s) => s.entries);
    expect(copied.map((e) => e.loggedAt)).toEqual([
      at('07:40', '2025-10-20'),
      at('19:15', '2025-10-20'),
    ]);
    expect(copied.map((e) => e.slotId)).toEqual([slot('Breakfast').id, slot('Dinner').id]);
    expect(result.day.totals.kcal).toBeCloseTo((await getDay()).totals.kcal);

    const again = await api('POST', '/api/diary/copy', { fromDay: DAY, toDay: '2025-10-20' });
    expect(again.json<CopyResult>().copied).toBe(2);
    expect((await getDay()).entryCount).toBe(2);
    expect((await getDay('2025-10-20')).entryCount).toBe(4);
  });

  it('copies one meal into another slot and refuses the same source and target', async () => {
    await log({ quantity: 450, loggedAt: at('07:40') });
    await log({ foodId: oats.id, quantity: 60, slotId: slot('Dinner').id, loggedAt: at('19:15') });

    const res = await api('POST', '/api/diary/copy', {
      fromDay: DAY,
      toDay: '2025-10-20',
      slotId: slot('Breakfast').id,
      targetSlotId: slot('Lunch').id,
    });
    expect(res.statusCode, res.body).toBe(200);
    const result = res.json<CopyResult>();
    expect(result.copied).toBe(1);
    const lunch = result.day.slots.find((s) => s.slot.name === 'Lunch')!;
    expect(lunch.entries.map((e) => e.name)).toEqual(['Banana']);
    expect(result.day.entryCount).toBe(1);

    const same = await api('POST', '/api/diary/copy', {
      fromDay: DAY,
      toDay: DAY,
      slotId: slot('Breakfast').id,
    });
    expect(same.statusCode).toBe(400);
    expect((await api('POST', '/api/diary/copy', { fromDay: DAY, toDay: DAY })).statusCode).toBe(
      400,
    );

    const sameDayOtherMeal = await api('POST', '/api/diary/copy', {
      fromDay: DAY,
      toDay: DAY,
      slotId: slot('Breakfast').id,
      targetSlotId: slot('Snacks').id,
    });
    expect(sameDayOtherMeal.statusCode).toBe(200);
    expect(sameDayOtherMeal.json<CopyResult>().copied).toBe(1);
  });

  it('copies nothing from an empty day and refuses an archived target slot', async () => {
    const empty = await api('POST', '/api/diary/copy', { fromDay: '2025-01-01', toDay: DAY });
    expect(empty.statusCode).toBe(200);
    expect(empty.json<CopyResult>().copied).toBe(0);

    const snacks = slot('Snacks');
    await api('POST', `/api/meal-slots/${snacks.id}/archive`);
    const res = await api('POST', '/api/diary/copy', {
      fromDay: '2025-01-01',
      toDay: DAY,
      slotId: slot('Breakfast').id,
      targetSlotId: snacks.id,
    });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['targetSlotId']);
  });
});

describe('recent and frequent foods', () => {
  it('orders recent by latest logging, distinct, excluding archived foods and ad-hoc entries', async () => {
    const yogurt = await createFood({ name: 'Yogurt', per100: oatsPer100 });
    await log({ foodId: oats.id, loggedAt: at('07:00') });
    await log({ foodId: banana.id, loggedAt: at('08:00') });
    await log({ foodId: oats.id, loggedAt: at('09:00') });
    await log({ foodId: yogurt.id, loggedAt: at('10:00') });
    await log({ foodId: null, name: 'Mystery', per100: oatsPer100, loggedAt: at('11:00') });
    await api('POST', `/api/foods/${yogurt.id}/archive`);

    const res = await api('GET', '/api/diary/recent-foods');
    expect(res.statusCode).toBe(200);
    const recent = res.json<FoodUsage[]>();
    expect(recent.map((r) => r.foodId)).toEqual([oats.id, banana.id]);
    expect(recent[0]).toMatchObject({ lastLoggedAt: at('09:00'), count: 2 });
  });

  it('orders frequent by count within the window', async () => {
    const today = new Date();
    const dayKey = (offset: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
      ).padStart(2, '0')}`;
    };
    await log({ foodId: banana.id, day: dayKey(1), loggedAt: at('07:00', dayKey(1)) });
    await log({ foodId: oats.id, day: dayKey(1), loggedAt: at('08:00', dayKey(1)) });
    await log({ foodId: oats.id, day: dayKey(2), loggedAt: at('08:00', dayKey(2)) });
    // Old entries fall outside the 60-day window.
    for (let i = 0; i < 5; i++) {
      await log({ foodId: banana.id, day: dayKey(90 + i), loggedAt: at('08:00', dayKey(90 + i)) });
    }

    const frequent = (await api('GET', '/api/diary/frequent-foods')).json<FoodUsage[]>();
    expect(frequent.map((r) => [r.foodId, r.count])).toEqual([
      [oats.id, 2],
      [banana.id, 1],
    ]);
  });
});

describe('day summaries and CSV export', () => {
  it('summarises only the requested range', async () => {
    await log({ day: '2025-10-18', loggedAt: at('08:00', '2025-10-18'), quantity: 100 });
    await log({ day: '2025-10-19', loggedAt: at('08:00'), quantity: 100 });
    await log({ day: '2025-10-19', loggedAt: at('12:00'), foodId: oats.id, quantity: 100 });
    await log({ day: '2025-10-21', loggedAt: at('08:00', '2025-10-21'), quantity: 100 });

    const res = await api('GET', '/api/diary/days?from=2025-10-18&to=2025-10-20');
    expect(res.statusCode, res.body).toBe(200);
    const days = res.json<DiaryDaySummary[]>();
    expect(days.map((d) => [d.day, d.entryCount])).toEqual([
      ['2025-10-18', 1],
      ['2025-10-19', 2],
    ]);
    expect(days[1]?.kcal).toBeCloseTo(89 + 389);
  });

  it('exports the TECH §5.3 columns with time, slot, brand, portion and totals', async () => {
    await log({ quantity: 1, portionLabel: '1 medium', portionCount: 2, loggedAt: at('07:40') });
    await log({
      foodId: null,
      name: 'Pizza, "the good one"',
      quantity: 100,
      portionLabel: '1 slice',
      note: 'late',
      slotId: slot('Dinner').id,
      loggedAt: at('21:05'),
      per100: { ...oatsPer100, kcal: 285, protein: 12, carbs: 36, fat: 10 },
    });

    const res = await api('GET', `/api/diary/export.csv?from=${DAY}&to=${DAY}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="plate-diary-${DAY}_${DAY}.csv"`,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    const lines = res.body.trim().split('\r\n');
    expect(lines[0]).toBe(
      'day,time,slot,food,brand,quantity,basis,portion,kcal,protein,carbs,fat,fiber,sugar,saturated_fat,sodium_mg,note',
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      `${DAY},07:40,Breakfast,Banana,Chiquita,236,g,2 × 1 medium,210.04,2.6,53.81,0.71,6.14,28.79,,2.36,`,
    );
    expect(lines[2]).toBe(
      `${DAY},21:05,Dinner,"Pizza, ""the good one""",,100,g,1 slice,285,12,36,10,,,,,late`,
    );
  });
});

describe('food deletion rules', () => {
  it('refuses to delete a logged food (409 with the reference count) but archives it', async () => {
    const entry = await log({});
    const del = await api('DELETE', `/api/foods/${banana.id}`);
    expect(del.statusCode).toBe(409);
    expect(del.json().error.code).toBe('CONFLICT');
    expect(del.json().error.details).toEqual({ references: 1 });

    const archived = await api('POST', `/api/foods/${banana.id}/archive`);
    expect(archived.statusCode).toBe(200);
    expect(archived.json<Food>().archivedAt).not.toBeNull();
    // History is intact and an archived food may still be logged (undo re-posts it).
    expect((await getDay()).entryCount).toBe(1);
    expect(
      (
        await api('POST', '/api/diary/entries', {
          day: DAY,
          slotId: slot('Lunch').id,
          loggedAt: at('12:00'),
          foodId: banana.id,
          quantity: 50,
        })
      ).statusCode,
    ).toBe(201);

    await api('DELETE', `/api/diary/entries/${entry.id}`);
    expect((await api('DELETE', `/api/foods/${banana.id}`)).statusCode).toBe(409);
    const remaining = (await getDay()).slots.flatMap((s) => s.entries);
    for (const e of remaining) await api('DELETE', `/api/diary/entries/${e.id}`);
    expect((await api('DELETE', `/api/foods/${banana.id}`)).statusCode).toBe(200);
  });
});
