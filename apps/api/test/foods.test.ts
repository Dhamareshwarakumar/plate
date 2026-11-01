import type { Category, Food } from '@plate/shared';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CategoryService } from '../src/categories/service.js';
import { createTestApp, login, type TestContext } from './helpers.js';

const per100 = {
  kcal: 89,
  protein: 1.1,
  carbs: 22.8,
  fat: 0.3,
  fiber: 2.6,
  sugar: 12.2,
  saturatedFat: null,
  sodiumMg: 1,
};

let ctx: TestContext;
let cookie: string;

beforeEach(async () => {
  ctx = await createTestApp();
  new CategoryService(ctx.opened.db).seedDefaults();
  cookie = await login(ctx.app);
});
afterEach(() => ctx.close());

const api = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
) => {
  const options: InjectOptions = { method, url, headers: { cookie } };
  if (payload !== undefined) options.payload = payload as InjectOptions['payload'];
  return ctx.app.inject(options);
};

async function createFood(overrides: Record<string, unknown> = {}): Promise<Food> {
  const res = await api('POST', '/api/foods', { name: 'Banana', per100, ...overrides });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Food>();
}

describe('auth gate on library routes', () => {
  it('denies anonymous access to foods and categories', async () => {
    for (const url of ['/api/foods', '/api/categories', '/api/foods/export.csv']) {
      const res = await ctx.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
    }
    const post = await ctx.app.inject({
      method: 'POST',
      url: '/api/foods/import',
      payload: 'name,kcal',
      headers: { 'content-type': 'text/csv' },
    });
    expect(post.statusCode).toBe(401);
  });
});

describe('categories', () => {
  it('seeds defaults once and lists them in order', async () => {
    const res = await api('GET', '/api/categories');
    const list = res.json<Category[]>();
    expect(list.map((c) => c.name)).toEqual([
      'Fruit',
      'Vegetable',
      'Grain & Bread',
      'Protein',
      'Dairy',
      'Legume',
      'Nuts & Seeds',
      'Snack',
      'Beverage',
      'Cooked dish',
      'Condiment',
      'Other',
    ]);
    expect(new CategoryService(ctx.opened.db).seedDefaults()).toBe(0);
  });

  it('creates, renames, reorders, archives and deletes', async () => {
    const created = await api('POST', '/api/categories', { name: '  Supplements ' });
    expect(created.statusCode).toBe(201);
    const cat = created.json<Category>();
    expect(cat.name).toBe('Supplements');

    const dup = await api('POST', '/api/categories', { name: 'supplements' });
    expect(dup.statusCode).toBe(409);

    const renamed = await api('PATCH', `/api/categories/${cat.id}`, { name: 'Supps' });
    expect(renamed.json<Category>().name).toBe('Supps');

    const reordered = await api('PUT', '/api/categories/order', { ids: [cat.id] });
    expect(reordered.statusCode).toBe(200);
    const order = reordered.json<Category[]>();
    expect(order[0]?.id).toBe(cat.id);
    expect(order[1]?.name).toBe('Fruit');

    const archived = await api('POST', `/api/categories/${cat.id}/archive`);
    expect(archived.json<Category>().archivedAt).not.toBeNull();
    const visible = (await api('GET', '/api/categories')).json<Category[]>();
    expect(visible.some((c) => c.id === cat.id)).toBe(false);
    const all = (await api('GET', '/api/categories?includeArchived=true')).json<Category[]>();
    expect(all.some((c) => c.id === cat.id)).toBe(true);

    const deleted = await api('DELETE', `/api/categories/${cat.id}`);
    expect(deleted.statusCode).toBe(200);
    expect((await api('GET', '/api/categories?includeArchived=true')).json()).not.toContainEqual(
      expect.objectContaining({ id: cat.id }),
    );
  });

  it('refuses to delete a category that foods use', async () => {
    const fruit = (await api('GET', '/api/categories')).json<Category[]>()[0]!;
    await createFood({ categoryId: fruit.id });
    const res = await api('DELETE', `/api/categories/${fruit.id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('rejects reordering with unknown ids', async () => {
    const res = await api('PUT', '/api/categories/order', { ids: [99999] });
    expect(res.statusCode).toBe(400);
  });
});

describe('foods', () => {
  it('creates a food with portions and reads it back', async () => {
    const food = await createFood({
      brand: ' Chiquita ',
      portions: [
        { label: '1 medium', amount: 118 },
        { label: '1 large', amount: 136 },
      ],
    });
    expect(food).toMatchObject({
      name: 'Banana',
      brand: 'Chiquita',
      basis: 'g',
      kind: 'food',
      source: 'manual',
    });
    expect(food.per100).toEqual(per100);
    expect(food.portions.map((p) => [p.label, p.amount, p.sortOrder])).toEqual([
      ['1 medium', 118, 0],
      ['1 large', 136, 1],
    ]);

    const fetched = await api('GET', `/api/foods/${food.id}`);
    expect(fetched.json()).toEqual(food);
  });

  it('validates input', async () => {
    const res = await api('POST', '/api/foods', { name: '', per100: { ...per100, fat: 200 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    const paths = (res.json().error.details as { path: string }[]).map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'per100.fat']));
  });

  it('rejects an unknown category', async () => {
    const res = await api('POST', '/api/foods', { name: 'X', per100, categoryId: 4242 });
    expect(res.statusCode).toBe(400);
  });

  it('treats (name, brand) as unique, case-insensitively, with no brand as its own value', async () => {
    await createFood();
    const sameNoBrand = await api('POST', '/api/foods', { name: 'banana', per100 });
    expect(sameNoBrand.statusCode).toBe(409);
    expect(sameNoBrand.json().error.details).toMatchObject({ archived: false });

    const branded = await api('POST', '/api/foods', { name: 'Banana', brand: 'Dole', per100 });
    expect(branded.statusCode).toBe(201);
  });

  it('updates a food, replacing its portions', async () => {
    const food = await createFood({ portions: [{ label: 'small', amount: 100 }] });
    const res = await api('PUT', `/api/foods/${food.id}`, {
      name: 'Banana, ripe',
      basis: 'g',
      per100: { ...per100, kcal: 95 },
      portions: [{ label: 'big', amount: 150 }],
    });
    expect(res.statusCode, res.body).toBe(200);
    const updated = res.json<Food>();
    expect(updated.name).toBe('Banana, ripe');
    expect(updated.per100.kcal).toBe(95);
    expect(updated.portions.map((p) => p.label)).toEqual(['big']);
  });

  it('lists with filters and hides archived foods by default', async () => {
    const fruit = (await api('GET', '/api/categories')).json<Category[]>()[0]!;
    const banana = await createFood({ categoryId: fruit.id });
    await createFood({ name: 'Oats', per100: { ...per100, kcal: 389 } });

    const all = (await api('GET', '/api/foods')).json();
    expect(all.total).toBe(2);
    expect((all.items as Food[]).map((f) => f.name)).toEqual(['Banana', 'Oats']);

    const byCategory = (await api('GET', `/api/foods?categoryId=${fruit.id}`)).json();
    expect(byCategory.total).toBe(1);

    const search = (await api('GET', '/api/foods?query=oat')).json();
    expect((search.items as Food[]).map((f) => f.name)).toEqual(['Oats']);

    const archived = await api('POST', `/api/foods/${banana.id}/archive`);
    expect(archived.json<Food>().archivedAt).not.toBeNull();
    expect((await api('GET', '/api/foods')).json().total).toBe(1);
    expect((await api('GET', '/api/foods?includeArchived=true')).json().total).toBe(2);

    const restored = await api('POST', `/api/foods/${banana.id}/unarchive`);
    expect(restored.json<Food>().archivedAt).toBeNull();
  });

  it('escapes LIKE wildcards in search', async () => {
    await createFood({ name: '100% juice' });
    await createFood({ name: 'Apple' });
    const res = (await api('GET', '/api/foods?query=%25')).json();
    expect((res.items as Food[]).map((f) => f.name)).toEqual(['100% juice']);
  });

  it('deletes an unreferenced food and 404s afterwards', async () => {
    const food = await createFood();
    expect((await api('DELETE', `/api/foods/${food.id}`)).statusCode).toBe(200);
    expect((await api('GET', `/api/foods/${food.id}`)).statusCode).toBe(404);
  });
});

describe('csv export and import', () => {
  const csv = [
    'name,brand,category,basis,kcal,protein,carbs,fat,fiber,sugar,saturated_fat,sodium_mg,portions',
    'Banana,,Fruit,g,89,1.1,22.8,0.3,2.6,12.2,,1,1 medium=118;1 large=136',
    '"Milk, whole",Arla,Dairy,ml,64,3.3,4.8,3.6,,,2.3,44,1 cup=240',
    'Mystery,,Nope,g,10,1,1,1,,,,,',
    'Bad kcal,,,g,abc,1,1,1,,,,,',
    'banana,,Fruit,g,90,1,20,0,,,,,',
  ].join('\n');

  const importCsv = (query: string) =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/foods/import${query}`,
      headers: { cookie, 'content-type': 'text/csv' },
      payload: csv,
    });

  it('previews without writing, reporting per-row outcomes', async () => {
    const res = await importCsv('?dryRun=true');
    expect(res.statusCode, res.body).toBe(200);
    const result = res.json();
    expect(result.dryRun).toBe(true);
    expect(result.summary).toEqual({ create: 2, update: 0, skip: 0, error: 3 });
    const byLine = Object.fromEntries(
      (result.rows as { line: number; action: string; errors: string[] }[]).map((r) => [r.line, r]),
    );
    expect(byLine[2]?.action).toBe('create');
    expect(byLine[3]?.action).toBe('create');
    expect(byLine[4]?.errors[0]).toMatch(/unknown category/);
    expect(byLine[5]?.errors[0]).toMatch(/kcal is not a number/);
    expect(byLine[6]?.errors[0]).toMatch(/duplicate of line 2/);
    expect((await api('GET', '/api/foods')).json().total).toBe(0);
  });

  it('imports, then skips or updates existing rows depending on the strategy', async () => {
    const first = await importCsv('');
    expect(first.json().summary).toMatchObject({ create: 2 });
    const foods = (await api('GET', '/api/foods')).json().items as Food[];
    const milk = foods.find((f) => f.name === 'Milk, whole')!;
    expect(milk).toMatchObject({ brand: 'Arla', basis: 'ml' });
    expect(milk.per100.saturatedFat).toBe(2.3);
    expect(milk.portions).toEqual([expect.objectContaining({ label: '1 cup', amount: 240 })]);

    const skipped = await importCsv('?onConflict=skip');
    expect(skipped.json().summary).toMatchObject({ create: 0, skip: 2 });

    const updated = await importCsv('?onConflict=update');
    expect(updated.json().summary).toMatchObject({ create: 0, update: 2 });
    expect((await api('GET', '/api/foods')).json().total).toBe(2);
  });

  it('rejects files without the required columns or with broken quoting', async () => {
    const missing = await ctx.app.inject({
      method: 'POST',
      url: '/api/foods/import',
      headers: { cookie, 'content-type': 'text/csv' },
      payload: 'name,kcal\nBanana,89\n',
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.message).toMatch(/protein, carbs, fat/);

    const broken = await ctx.app.inject({
      method: 'POST',
      url: '/api/foods/import',
      headers: { cookie, 'content-type': 'text/csv' },
      payload: 'name,kcal,protein,carbs,fat\n"Banana,89,1,1,1\n',
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json().error.message).toMatch(/Could not parse CSV/);
  });

  it('exports what was imported, including archived foods, and the export re-imports cleanly', async () => {
    await importCsv('');
    const foods = (await api('GET', '/api/foods')).json().items as Food[];
    await api('POST', `/api/foods/${foods[0]!.id}/archive`);

    const res = await api('GET', '/api/foods/export.csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/plate-foods-\d{4}-\d{2}-\d{2}\.csv/);
    const lines = res.body.trim().split('\r\n');
    expect(lines[0]).toBe(
      'name,brand,category,basis,kcal,protein,carbs,fat,fiber,sugar,saturated_fat,sodium_mg,portions',
    );
    expect(lines).toHaveLength(3);
    expect(
      lines.some((l) =>
        l.startsWith('"Milk, whole",Arla,Dairy,ml,64,3.3,4.8,3.6,,,2.3,44,1 cup=240'),
      ),
    ).toBe(true);

    const again = await ctx.app.inject({
      method: 'POST',
      url: '/api/foods/import?dryRun=true&onConflict=update',
      headers: { cookie, 'content-type': 'text/csv' },
      payload: res.body,
    });
    expect(again.json().summary).toEqual({ create: 0, update: 2, skip: 0, error: 0 });
  });
});
