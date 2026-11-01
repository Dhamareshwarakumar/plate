import type { DiaryEntry, Dish, Food, MealSlot } from '@plate/shared';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CategoryService } from '../src/categories/service.js';
import { MealSlotService } from '../src/mealSlots/service.js';
import { createTestApp, login, type TestContext } from './helpers.js';

const per100 = (
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  fiber: number | null = null,
) => ({ kcal, protein, carbs, fat, fiber, sugar: null, saturatedFat: null, sodiumMg: null });

const DAY = '2025-10-19';

let ctx: TestContext;
let cookie: string;
let lentils: Food;
let oil: Food;
let onion: Food;

beforeEach(async () => {
  ctx = await createTestApp();
  new CategoryService(ctx.opened.db).seedDefaults();
  new MealSlotService(ctx.opened.db).seedDefaults();
  cookie = await login(ctx.app);
  lentils = await createFood({ name: 'Red lentils', per100: per100(352, 24.6, 63.4, 1.1, 10.7) });
  oil = await createFood({ name: 'Sunflower oil', basis: 'ml', per100: per100(884, 0, 0, 100) });
  onion = await createFood({ name: 'Onion', per100: per100(40, 1.1, 9.3, 0.1, 1.7) });
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

const dalInput = () => ({
  name: 'Dal',
  ingredients: [
    { foodId: lentils.id, amount: 200 },
    { foodId: oil.id, amount: 15 },
    { foodId: onion.id, amount: 100 },
  ],
  cookedWeight: 900,
  servings: 4,
});

async function createDish(overrides: Record<string, unknown> = {}): Promise<Dish> {
  const res = await api('POST', '/api/dishes', { ...dalInput(), ...overrides });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Dish>();
}

const paths = (res: { json: () => { error: { details?: unknown } } }) =>
  (res.json().error.details as { path: string }[]).map((d) => d.path);

// Raw totals of the dal: kcal 704 + 132.6 + 40 = 876.6; protein 49.2 + 1.1 = 50.3;
// carbs 126.8 + 9.3 = 136.1; fat 2.2 + 15 + 0.1 = 17.3; fiber 21.4 + 1.7 = 23.1.
const RAW_KCAL = 876.6;

describe('auth gate on dish routes', () => {
  it('denies anonymous access on every route', async () => {
    const routes: ['GET' | 'POST' | 'PUT', string][] = [
      ['POST', '/api/dishes'],
      ['GET', '/api/dishes/1'],
      ['PUT', '/api/dishes/1'],
      ['POST', '/api/dishes/1/recalculate'],
    ];
    for (const [method, url] of routes) {
      const options: InjectOptions = { method, url };
      if (method !== 'GET') options.payload = { name: 'x' };
      const res = await ctx.app.inject(options);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Session/);
    }
  });
});

describe('validation', () => {
  it('rejects an empty recipe, a zero cooked weight and bad servings with the right paths', async () => {
    const empty = await api('POST', '/api/dishes', { ...dalInput(), ingredients: [] });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe('VALIDATION_ERROR');
    expect(paths(empty)).toEqual(['ingredients']);

    const zero = await api('POST', '/api/dishes', { ...dalInput(), cookedWeight: 0 });
    expect(zero.statusCode).toBe(400);
    expect(paths(zero)).toEqual(['cookedWeight']);

    const half = await api('POST', '/api/dishes', { ...dalInput(), servings: 2.5 });
    expect(half.statusCode).toBe(400);
    expect(paths(half)).toEqual(['servings']);

    const noName = await api('POST', '/api/dishes', { ...dalInput(), name: '  ' });
    expect(paths(noName)).toEqual(['name']);

    const many = await api('POST', '/api/dishes', {
      ...dalInput(),
      ingredients: Array.from({ length: 51 }, () => ({ foodId: onion.id, amount: 1 })),
    });
    expect(many.statusCode).toBe(400);
    expect(paths(many)).toEqual(['ingredients']);
  });

  it('rejects unknown ingredients and dishes as ingredients', async () => {
    const unknown = await api('POST', '/api/dishes', {
      ...dalInput(),
      ingredients: [
        { foodId: onion.id, amount: 10 },
        { foodId: 4242, amount: 10 },
      ],
    });
    expect(unknown.statusCode).toBe(400);
    expect(paths(unknown)).toEqual(['ingredients.1.foodId']);

    const dal = await createDish();
    const nested = await api('POST', '/api/dishes', {
      name: 'Dal bowl',
      ingredients: [{ foodId: dal.id, amount: 250 }],
      cookedWeight: 250,
    });
    expect(nested.statusCode).toBe(400);
    expect(paths(nested)).toEqual(['ingredients.0.foodId']);
    expect(nested.json().error.message).toMatch(/cannot contain another dish/);
  });

  it('refuses a cooked weight that makes the dish denser than pure fat', async () => {
    const res = await api('POST', '/api/dishes', { ...dalInput(), cookedWeight: 90 });
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['cookedWeight']);
    expect(res.json().error.message).toMatch(/too low/);
  });

  it('treats dish names like food names: unique with foods, case-insensitively', async () => {
    const clash = await api('POST', '/api/dishes', { ...dalInput(), name: 'onion' });
    expect(clash.statusCode).toBe(409);
    await createDish();
    expect((await api('POST', '/api/dishes', dalInput())).statusCode).toBe(409);
    expect(
      (await api('POST', '/api/foods', { name: 'DAL', per100: per100(1, 0, 0, 0) })).statusCode,
    ).toBe(409);
  });

  it('404s for unknown dishes and for foods addressed as dishes', async () => {
    expect((await api('GET', '/api/dishes/4242')).statusCode).toBe(404);
    expect((await api('GET', `/api/dishes/${onion.id}`)).statusCode).toBe(404);
    expect((await api('PUT', `/api/dishes/${onion.id}`, dalInput())).statusCode).toBe(404);
    expect((await api('POST', `/api/dishes/${onion.id}/recalculate`)).statusCode).toBe(404);
  });
});

describe('creating dishes', () => {
  it('computes the per-100 values from the ingredients and cooked weight', async () => {
    const dal = await createDish();
    expect(dal).toMatchObject({
      kind: 'dish',
      name: 'Dal',
      basis: 'g',
      source: 'dish',
      cookedWeight: 900,
      servings: 4,
      staleSince: null,
    });
    expect(dal.per100.kcal).toBeCloseTo(RAW_KCAL / 9, 5);
    expect(dal.per100.protein).toBeCloseTo(50.3 / 9, 5);
    expect(dal.per100.carbs).toBeCloseTo(136.1 / 9, 5);
    expect(dal.per100.fat).toBeCloseTo(17.3 / 9, 5);
    expect(dal.per100.fiber).toBeCloseTo(23.1 / 9, 5);
    expect(dal.per100.sugar).toBeNull();
    expect(dal.ingredients.map((i) => [i.name, i.amount, i.basis, i.sortOrder])).toEqual([
      ['Red lentils', 200, 'g', 0],
      ['Sunflower oil', 15, 'ml', 1],
      ['Onion', 100, 'g', 2],
    ]);
    expect(dal.ingredients[0]?.per100.kcal).toBe(352);
    // servings → "1 serving = 225 g"
    expect(dal.portions).toEqual([
      expect.objectContaining({ label: '1 serving', amount: 225, sortOrder: 0 }),
    ]);

    const fetched = await api('GET', `/api/dishes/${dal.id}`);
    expect(fetched.json()).toEqual(dal);
  });

  it('appears in the food list as kind dish and can be filtered', async () => {
    const dal = await createDish();
    const all = (await api('GET', '/api/foods')).json<{ items: Food[] }>();
    const listed = all.items.find((f) => f.id === dal.id)!;
    expect(listed).toMatchObject({ kind: 'dish', source: 'dish', staleSince: null });
    expect(listed.per100.kcal).toBeCloseTo(dal.per100.kcal);
    const dishesOnly = (await api('GET', '/api/foods?kind=dish')).json<{ items: Food[] }>();
    expect(dishesOnly.items.map((f) => f.name)).toEqual(['Dal']);
    const foodsOnly = (await api('GET', '/api/foods?kind=food')).json<{ items: Food[] }>();
    expect(foodsOnly.items.some((f) => f.kind === 'dish')).toBe(false);
  });

  it('is logged like any food, by grams or by the serving portion', async () => {
    const dal = await createDish();
    const slots = (await api('GET', '/api/meal-slots')).json<MealSlot[]>();
    const grams = await api('POST', '/api/diary/entries', {
      day: DAY,
      slotId: slots[0]!.id,
      loggedAt: `${DAY}T12:30:00+02:00`,
      foodId: dal.id,
      quantity: 250,
    });
    expect(grams.statusCode, grams.body).toBe(201);
    expect(grams.json<DiaryEntry>().name).toBe('Dal');
    expect(grams.json<DiaryEntry>().totals.kcal).toBeCloseTo((RAW_KCAL / 9) * 2.5, 5);

    const serving = await api('POST', '/api/diary/entries', {
      day: DAY,
      slotId: slots[0]!.id,
      loggedAt: `${DAY}T19:30:00+02:00`,
      foodId: dal.id,
      quantity: 1,
      portionLabel: '1 serving',
      portionCount: 2,
    });
    expect(serving.statusCode, serving.body).toBe(201);
    expect(serving.json<DiaryEntry>().quantity).toBe(450);
  });

  it('omits the serving portion when servings is not set, and clears it on update', async () => {
    const dish = await createDish({ servings: null });
    expect(dish.servings).toBeNull();
    expect(dish.portions).toEqual([]);

    const withServings = await api('PUT', `/api/dishes/${dish.id}`, { ...dalInput(), servings: 3 });
    expect(withServings.json<Dish>().portions[0]?.amount).toBe(300);
    const without = await api('PUT', `/api/dishes/${dish.id}`, { ...dalInput(), servings: null });
    expect(without.json<Dish>().portions).toEqual([]);
  });
});

describe('updating and recalculating', () => {
  it('recomputes on update and replaces the recipe', async () => {
    const dal = await createDish();
    const res = await api('PUT', `/api/dishes/${dal.id}`, {
      name: 'Dal, thick',
      ingredients: [
        { foodId: lentils.id, amount: 200 },
        { foodId: onion.id, amount: 50 },
      ],
      cookedWeight: 600,
      servings: 2,
    });
    expect(res.statusCode, res.body).toBe(200);
    const updated = res.json<Dish>();
    expect(updated.name).toBe('Dal, thick');
    expect(updated.ingredients.map((i) => [i.foodId, i.amount])).toEqual([
      [lentils.id, 200],
      [onion.id, 50],
    ]);
    // kcal: 704 + 20 = 724 over 600 g
    expect(updated.per100.kcal).toBeCloseTo(724 / 6, 5);
    expect(updated.cookedWeight).toBe(600);
    expect(updated.portions[0]?.amount).toBe(300);
    expect(updated.updatedAt >= dal.updatedAt).toBe(true);
  });

  it('flags the dish stale when an ingredient changes nutrition, keeps its values, and recalculates on demand', async () => {
    const dal = await createDish();
    const before = dal.per100.kcal;

    // A rename alone is not a nutrition change.
    const renamed = await api('PUT', `/api/foods/${onion.id}`, {
      name: 'Onion, red',
      basis: 'g',
      per100: onion.per100,
      portions: [],
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect((await api('GET', `/api/dishes/${dal.id}`)).json<Dish>().staleSince).toBeNull();

    const edited = await api('PUT', `/api/foods/${lentils.id}`, {
      name: 'Red lentils',
      basis: 'g',
      per100: { ...lentils.per100, kcal: 400 },
      portions: [],
    });
    expect(edited.statusCode, edited.body).toBe(200);

    const stale = (await api('GET', `/api/dishes/${dal.id}`)).json<Dish>();
    expect(stale.staleSince).not.toBeNull();
    expect(stale.per100.kcal).toBeCloseTo(before, 5);
    expect(stale.ingredients[0]?.per100.kcal).toBe(400);
    expect(stale.ingredients[2]?.name).toBe('Onion, red');
    // The flag also rides along in the food list for the Dishes tab.
    const listed = (await api('GET', '/api/foods?kind=dish')).json<{ items: Food[] }>();
    expect(listed.items[0]?.staleSince).toBe(stale.staleSince);

    const recalculated = await api('POST', `/api/dishes/${dal.id}/recalculate`);
    expect(recalculated.statusCode, recalculated.body).toBe(200);
    const fresh = recalculated.json<Dish>();
    expect(fresh.staleSince).toBeNull();
    // kcal: 800 + 132.6 + 40 = 972.6 over 900 g
    expect(fresh.per100.kcal).toBeCloseTo(972.6 / 9, 5);
    expect(fresh.cookedWeight).toBe(900);

    // Saving the dish clears the flag too.
    await api('PUT', `/api/foods/${lentils.id}`, {
      name: 'Red lentils',
      basis: 'g',
      per100: { ...lentils.per100, kcal: 352 },
      portions: [],
    });
    expect((await api('GET', `/api/dishes/${dal.id}`)).json<Dish>().staleSince).not.toBeNull();
    const saved = await api('PUT', `/api/dishes/${dal.id}`, dalInput());
    expect(saved.json<Dish>().staleSince).toBeNull();
    expect(saved.json<Dish>().per100.kcal).toBeCloseTo(before, 5);
  });

  it('refuses the generic food editor for dishes', async () => {
    const dal = await createDish();
    const res = await api('PUT', `/api/foods/${dal.id}`, {
      name: 'Dal',
      basis: 'g',
      per100: per100(1, 0, 0, 0),
      portions: [],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/edited through their ingredients/);
  });

  it('does not change a diary entry logged before the dish was recalculated (FR-D10)', async () => {
    const dal = await createDish();
    const slots = (await api('GET', '/api/meal-slots')).json<MealSlot[]>();
    const entry = (
      await api('POST', '/api/diary/entries', {
        day: DAY,
        slotId: slots[0]!.id,
        loggedAt: `${DAY}T12:30:00+02:00`,
        foodId: dal.id,
        quantity: 100,
      })
    ).json<DiaryEntry>();
    await api('PUT', `/api/dishes/${dal.id}`, { ...dalInput(), cookedWeight: 450 });
    const day = await api('GET', `/api/diary/${DAY}`);
    const stored = day.json().slots[0].entries[0] as DiaryEntry;
    expect(stored.id).toBe(entry.id);
    expect(stored.per100.kcal).toBeCloseTo(dal.per100.kcal, 5);
  });
});

describe('deletion rules', () => {
  it('refuses to delete an ingredient food while a dish uses it, and allows archiving', async () => {
    const dal = await createDish();
    const del = await api('DELETE', `/api/foods/${onion.id}`);
    expect(del.statusCode).toBe(409);
    expect(del.json().error.details).toEqual({ references: 1 });
    expect((await api('POST', `/api/foods/${onion.id}/archive`)).statusCode).toBe(200);
    const stillThere = (await api('GET', `/api/dishes/${dal.id}`)).json<Dish>();
    expect(stillThere.ingredients[2]?.archivedAt).not.toBeNull();

    // Deleting the dish removes its recipe lines, which frees the ingredient.
    expect((await api('DELETE', `/api/foods/${dal.id}`)).statusCode).toBe(200);
    expect((await api('GET', `/api/dishes/${dal.id}`)).statusCode).toBe(404);
    expect((await api('DELETE', `/api/foods/${onion.id}`)).statusCode).toBe(200);
  });

  it('refuses to delete a logged dish', async () => {
    const dal = await createDish();
    const slots = (await api('GET', '/api/meal-slots')).json<MealSlot[]>();
    await api('POST', '/api/diary/entries', {
      day: DAY,
      slotId: slots[0]!.id,
      loggedAt: `${DAY}T12:30:00+02:00`,
      foodId: dal.id,
      quantity: 250,
    });
    expect((await api('DELETE', `/api/foods/${dal.id}`)).statusCode).toBe(409);
    expect(
      (await api('POST', `/api/foods/${dal.id}/archive`)).json<Food>().archivedAt,
    ).not.toBeNull();
  });
});
