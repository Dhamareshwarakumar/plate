import type {
  DiaryDay,
  DiaryEntry,
  Dish,
  Food,
  LogTemplateResult,
  MealSlot,
  MealTemplate,
  TemplateFromMealResult,
} from '@plate/shared';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CategoryService } from '../src/categories/service.js';
import { MealSlotService } from '../src/mealSlots/service.js';
import { createTestApp, login, type TestContext } from './helpers.js';

const per100 = (kcal: number, protein: number, carbs: number, fat: number) => ({
  kcal,
  protein,
  carbs,
  fat,
  fiber: null,
  sugar: null,
  saturatedFat: null,
  sodiumMg: null,
});

const DAY = '2025-10-19';
const at = (time: string, day = DAY) => `${day}T${time}:00+02:00`;

let ctx: TestContext;
let cookie: string;
let slots: MealSlot[];
let oats: Food;
let milk: Food;
let banana: Food;
let dal: Dish;

beforeEach(async () => {
  ctx = await createTestApp();
  new CategoryService(ctx.opened.db).seedDefaults();
  new MealSlotService(ctx.opened.db).seedDefaults();
  cookie = await login(ctx.app);
  slots = (await api('GET', '/api/meal-slots')).json<MealSlot[]>();
  oats = await createFood({ name: 'Oats', per100: per100(389, 16.9, 66.3, 6.9) });
  milk = await createFood({ name: 'Milk', basis: 'ml', per100: per100(50, 3.4, 4.8, 2) });
  banana = await createFood({ name: 'Banana', per100: per100(89, 1.1, 22.8, 0.3) });
  const lentils = await createFood({ name: 'Lentils', per100: per100(352, 24.6, 63.4, 1.1) });
  const dishRes = await api('POST', '/api/dishes', {
    name: 'Dal',
    ingredients: [{ foodId: lentils.id, amount: 200 }],
    cookedWeight: 704,
  });
  expect(dishRes.statusCode, dishRes.body).toBe(201);
  dal = dishRes.json<Dish>(); // 100 kcal per 100 g
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

const breakfastInput = () => ({
  name: 'Usual breakfast',
  items: [
    { foodId: oats.id, amount: 80 },
    { foodId: milk.id, amount: 200 },
    { foodId: banana.id, amount: 118 },
  ],
});

async function createTemplate(overrides: Record<string, unknown> = {}): Promise<MealTemplate> {
  const res = await api('POST', '/api/meal-templates', { ...breakfastInput(), ...overrides });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<MealTemplate>();
}

const paths = (res: { json: () => { error: { details?: unknown } } }) =>
  (res.json().error.details as { path: string }[]).map((d) => d.path);

// 80 g oats 311.2 + 200 ml milk 100 + 118 g banana 105.02
const BREAKFAST_KCAL = 311.2 + 100 + 105.02;

describe('auth gate on meal template routes', () => {
  it('denies anonymous access on every route', async () => {
    const routes: ['GET' | 'POST' | 'PUT' | 'DELETE', string][] = [
      ['GET', '/api/meal-templates'],
      ['POST', '/api/meal-templates'],
      ['POST', '/api/meal-templates/from-meal'],
      ['GET', '/api/meal-templates/1'],
      ['PUT', '/api/meal-templates/1'],
      ['DELETE', '/api/meal-templates/1'],
      ['POST', '/api/meal-templates/1/log'],
    ];
    for (const [method, url] of routes) {
      const options: InjectOptions = { method, url };
      if (method !== 'GET' && method !== 'DELETE') options.payload = { name: 'x' };
      const res = await ctx.app.inject(options);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Session/);
    }
  });
});

describe('validation', () => {
  it('rejects an empty name, no items, too many items and unknown foods with paths', async () => {
    const noName = await api('POST', '/api/meal-templates', { ...breakfastInput(), name: ' ' });
    expect(noName.statusCode).toBe(400);
    expect(paths(noName)).toEqual(['name']);

    const noItems = await api('POST', '/api/meal-templates', { name: 'x', items: [] });
    expect(paths(noItems)).toEqual(['items']);

    const many = await api('POST', '/api/meal-templates', {
      name: 'x',
      items: Array.from({ length: 31 }, () => ({ foodId: oats.id, amount: 1 })),
    });
    expect(paths(many)).toEqual(['items']);

    const zero = await api('POST', '/api/meal-templates', {
      name: 'x',
      items: [{ foodId: oats.id, amount: 0 }],
    });
    expect(paths(zero)).toEqual(['items.0.amount']);

    const unknown = await api('POST', '/api/meal-templates', {
      name: 'x',
      items: [
        { foodId: oats.id, amount: 10 },
        { foodId: 4242, amount: 10 },
      ],
    });
    expect(unknown.statusCode).toBe(400);
    expect(paths(unknown)).toEqual(['items.1.foodId']);
  });

  it('keeps names unique, case-insensitively', async () => {
    const first = await createTemplate();
    const dup = await api('POST', '/api/meal-templates', {
      ...breakfastInput(),
      name: 'USUAL BREAKFAST',
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.details).toEqual({ templateId: first.id });
    // Renaming a template to its own name is fine.
    const same = await api('PUT', `/api/meal-templates/${first.id}`, breakfastInput());
    expect(same.statusCode, same.body).toBe(200);
  });

  it('404s on unknown templates', async () => {
    expect((await api('GET', '/api/meal-templates/4242')).statusCode).toBe(404);
    expect((await api('PUT', '/api/meal-templates/4242', breakfastInput())).statusCode).toBe(404);
    expect((await api('DELETE', '/api/meal-templates/4242')).statusCode).toBe(404);
    expect(
      (await api('POST', '/api/meal-templates/4242/log', { day: DAY, slotId: slot('Lunch').id }))
        .statusCode,
    ).toBe(404);
  });
});

describe('crud', () => {
  it('creates a template with the items in order, their current food data and SQL totals', async () => {
    const template = await createTemplate({
      items: [...breakfastInput().items, { foodId: dal.id, amount: 150 }],
    });
    expect(template.name).toBe('Usual breakfast');
    expect(template.items.map((i) => [i.name, i.amount, i.basis, i.kind, i.sortOrder])).toEqual([
      ['Oats', 80, 'g', 'food', 0],
      ['Milk', 200, 'ml', 'food', 1],
      ['Banana', 118, 'g', 'food', 2],
      ['Dal', 150, 'g', 'dish', 3],
    ]);
    expect(template.items[0]?.per100.kcal).toBe(389);
    expect(template.totals.kcal).toBeCloseTo(BREAKFAST_KCAL + 150, 5);
    expect(template.totals.protein).toBeCloseTo(13.52 + 6.8 + 1.298 + 1.5 * 24.6 * (200 / 704), 3);
    expect(template.totals.fiber).toBeNull();

    const list = (await api('GET', '/api/meal-templates')).json<MealTemplate[]>();
    expect(list).toEqual([template]);
    expect((await api('GET', `/api/meal-templates/${template.id}`)).json()).toEqual(template);
  });

  it('reflects later food edits in the preview (templates reference, they do not snapshot)', async () => {
    const template = await createTemplate();
    await api('PUT', `/api/foods/${oats.id}`, {
      name: 'Rolled oats',
      basis: 'g',
      per100: { ...oats.per100, kcal: 400 },
      portions: [],
    });
    const fresh = (await api('GET', `/api/meal-templates/${template.id}`)).json<MealTemplate>();
    expect(fresh.items[0]?.name).toBe('Rolled oats');
    expect(fresh.items[0]?.per100.kcal).toBe(400);
    expect(fresh.totals.kcal).toBeCloseTo(320 + 100 + 105.02, 5);
  });

  it('updates name and items, then deletes', async () => {
    const template = await createTemplate();
    const res = await api('PUT', `/api/meal-templates/${template.id}`, {
      name: 'Light breakfast',
      items: [{ foodId: banana.id, amount: 118 }],
    });
    expect(res.statusCode, res.body).toBe(200);
    const updated = res.json<MealTemplate>();
    expect(updated.name).toBe('Light breakfast');
    expect(updated.items.map((i) => i.name)).toEqual(['Banana']);
    expect(updated.totals.kcal).toBeCloseTo(105.02, 5);
    expect(updated.updatedAt >= template.updatedAt).toBe(true);

    const del = await api('DELETE', `/api/meal-templates/${template.id}`);
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });
    expect((await api('GET', `/api/meal-templates/${template.id}`)).statusCode).toBe(404);
    expect((await api('GET', '/api/meal-templates')).json()).toEqual([]);
    // Items went with it: the foods are deletable again.
    expect((await api('DELETE', `/api/foods/${banana.id}`)).statusCode).toBe(200);
  });
});

describe('logging a template', () => {
  it('creates one entry per item in the chosen meal and returns the day', async () => {
    const template = await createTemplate();
    const res = await api('POST', `/api/meal-templates/${template.id}/log`, {
      day: DAY,
      slotId: slot('Breakfast').id,
      loggedAt: at('07:45'),
    });
    expect(res.statusCode, res.body).toBe(201);
    const result = res.json<LogTemplateResult>();
    expect(result.logged).toBe(3);
    expect(result.day.day).toBe(DAY);
    expect(result.day.entryCount).toBe(3);
    const breakfast = result.day.slots.find((s) => s.slot.name === 'Breakfast')!;
    expect(breakfast.entries.map((e) => [e.name, e.quantity, e.basis, e.foodId])).toEqual([
      ['Oats', 80, 'g', oats.id],
      ['Milk', 200, 'ml', milk.id],
      ['Banana', 118, 'g', banana.id],
    ]);
    expect(breakfast.entries.every((e) => e.loggedAt === at('07:45'))).toBe(true);
    expect(breakfast.totals.kcal).toBeCloseTo(BREAKFAST_KCAL, 5);
    // Entries carry their own snapshot like any logged food.
    expect(breakfast.entries[0]?.per100.kcal).toBe(389);
  });

  it('applies amount overrides by index and refuses an index outside the template', async () => {
    const template = await createTemplate();
    const res = await api('POST', `/api/meal-templates/${template.id}/log`, {
      day: DAY,
      slotId: slot('Lunch').id,
      loggedAt: at('12:30'),
      overrides: [
        { index: 2, amount: 236 },
        { index: 0, amount: 40 },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    const lunch = res.json<LogTemplateResult>().day.slots.find((s) => s.slot.name === 'Lunch')!;
    expect(lunch.entries.map((e) => [e.name, e.quantity])).toEqual([
      ['Oats', 40],
      ['Milk', 200],
      ['Banana', 236],
    ]);

    const bad = await api('POST', `/api/meal-templates/${template.id}/log`, {
      day: DAY,
      slotId: slot('Lunch').id,
      overrides: [{ index: 3, amount: 10 }],
    });
    expect(bad.statusCode).toBe(400);
    expect(paths(bad)).toEqual(['overrides.0.index']);
    // Nothing from the failed call was written.
    expect((await api('GET', `/api/diary/${DAY}`)).json<DiaryDay>().entryCount).toBe(3);
  });

  it('validates day and slot and defaults the time when omitted', async () => {
    const template = await createTemplate();
    const badDay = await api('POST', `/api/meal-templates/${template.id}/log`, {
      day: '2025-02-30',
      slotId: slot('Lunch').id,
    });
    expect(badDay.statusCode).toBe(400);
    expect(paths(badDay)).toEqual(['day']);

    const badSlot = await api('POST', `/api/meal-templates/${template.id}/log`, {
      day: DAY,
      slotId: 4242,
    });
    expect(badSlot.statusCode).toBe(400);
    expect(paths(badSlot)).toEqual(['slotId']);
    expect((await api('GET', `/api/diary/${DAY}`)).json<DiaryDay>().entryCount).toBe(0);

    const noTime = await api('POST', `/api/meal-templates/${template.id}/log`, {
      day: DAY,
      slotId: slot('Dinner').id,
    });
    expect(noTime.statusCode, noTime.body).toBe(201);
    const dinner = noTime
      .json<LogTemplateResult>()
      .day.slots.find((s) => s.slot.name === 'Dinner')!;
    expect(dinner.entries).toHaveLength(3);
    expect(dinner.entries[0]?.loggedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('still logs an item whose food was archived since (D62)', async () => {
    const template = await createTemplate();
    await api('POST', `/api/foods/${milk.id}/archive`);
    const res = await api('POST', `/api/meal-templates/${template.id}/log`, {
      day: DAY,
      slotId: slot('Breakfast').id,
      loggedAt: at('07:45'),
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<LogTemplateResult>().logged).toBe(3);
    const fresh = (await api('GET', `/api/meal-templates/${template.id}`)).json<MealTemplate>();
    expect(fresh.items[1]?.archivedAt).not.toBeNull();
  });
});

describe('save as meal (from-meal)', () => {
  async function log(body: Record<string, unknown>): Promise<DiaryEntry> {
    const res = await api('POST', '/api/diary/entries', {
      day: DAY,
      slotId: slot('Breakfast').id,
      loggedAt: at('07:40'),
      ...body,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<DiaryEntry>();
  }

  it('snapshots the library foods of a meal and skips ad-hoc entries, then round-trips', async () => {
    await log({ foodId: oats.id, quantity: 80, loggedAt: at('07:30') });
    await log({ foodId: dal.id, quantity: 150, loggedAt: at('07:35') });
    await log({
      foodId: null,
      name: 'Mystery bar',
      quantity: 100,
      per100: per100(200, 5, 20, 10),
      loggedAt: at('07:36'),
    });
    await log({ foodId: banana.id, quantity: 236, loggedAt: at('07:40') });

    const res = await api('POST', '/api/meal-templates/from-meal', {
      day: DAY,
      slotId: slot('Breakfast').id,
      name: 'Saved breakfast',
    });
    expect(res.statusCode, res.body).toBe(201);
    const { template, skipped } = res.json<TemplateFromMealResult>();
    expect(skipped).toBe(1);
    expect(template.name).toBe('Saved breakfast');
    expect(template.items.map((i) => [i.foodId, i.amount])).toEqual([
      [oats.id, 80],
      [dal.id, 150],
      [banana.id, 236],
    ]);

    // Round trip: logging it on another day reproduces the meal minus the ad-hoc line.
    const logged = await api('POST', `/api/meal-templates/${template.id}/log`, {
      day: '2025-10-20',
      slotId: slot('Breakfast').id,
      loggedAt: at('08:00', '2025-10-20'),
    });
    expect(logged.statusCode, logged.body).toBe(201);
    const copy = logged
      .json<LogTemplateResult>()
      .day.slots.find((s) => s.slot.name === 'Breakfast')!;
    const original = (await api('GET', `/api/diary/${DAY}`))
      .json<DiaryDay>()
      .slots.find((s) => s.slot.name === 'Breakfast')!;
    expect(copy.entries.map((e) => [e.name, e.quantity])).toEqual(
      original.entries.filter((e) => e.foodId !== null).map((e) => [e.name, e.quantity]),
    );
    expect(copy.totals.kcal).toBeCloseTo(original.totals.kcal - 200, 5);
  });

  it('refuses an empty meal and a meal with only ad-hoc entries', async () => {
    const empty = await api('POST', '/api/meal-templates/from-meal', {
      day: DAY,
      slotId: slot('Lunch').id,
      name: 'Nothing',
    });
    expect(empty.statusCode).toBe(400);
    expect(paths(empty)).toEqual(['slotId']);
    expect(empty.json().error.message).toMatch(/Nothing is logged/);

    await log({
      foodId: null,
      name: 'Mystery bar',
      quantity: 100,
      per100: per100(200, 5, 20, 10),
    });
    const adHocOnly = await api('POST', '/api/meal-templates/from-meal', {
      day: DAY,
      slotId: slot('Breakfast').id,
      name: 'Quick stuff',
    });
    expect(adHocOnly.statusCode).toBe(400);
    expect(paths(adHocOnly)).toEqual(['slotId']);
    expect(adHocOnly.json().error.message).toMatch(/quick entries/);
    expect((await api('GET', '/api/meal-templates')).json()).toEqual([]);
  });

  it('refuses a duplicate name', async () => {
    await createTemplate({ name: 'Breakfast' });
    await log({ foodId: oats.id, quantity: 80 });
    const res = await api('POST', '/api/meal-templates/from-meal', {
      day: DAY,
      slotId: slot('Breakfast').id,
      name: 'breakfast',
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('food deletion rules', () => {
  it('refuses to delete a food that a template uses, counting it as a reference', async () => {
    await createTemplate();
    const del = await api('DELETE', `/api/foods/${oats.id}`);
    expect(del.statusCode).toBe(409);
    expect(del.json().error.details).toEqual({ references: 1 });
    expect((await api('POST', `/api/foods/${oats.id}/archive`)).statusCode).toBe(200);

    const dishDel = await api('DELETE', `/api/foods/${dal.id}`);
    expect(dishDel.statusCode).toBe(200); // the dish is not in the template
  });
});
