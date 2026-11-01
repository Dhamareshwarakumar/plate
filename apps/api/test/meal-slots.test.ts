import type { MealSlot } from '@plate/shared';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CategoryService } from '../src/categories/service.js';
import { MealSlotService } from '../src/mealSlots/service.js';
import { createTestApp, login, type TestContext } from './helpers.js';

let ctx: TestContext;
let cookie: string;

beforeEach(async () => {
  ctx = await createTestApp();
  new CategoryService(ctx.opened.db).seedDefaults();
  new MealSlotService(ctx.opened.db).seedDefaults();
  cookie = await login(ctx.app);
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

const listSlots = async (includeArchived = false) =>
  (await api('GET', `/api/meal-slots?includeArchived=${includeArchived}`)).json<MealSlot[]>();

describe('meal slots', () => {
  it('denies anonymous access on every route', async () => {
    const routes: ['GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', string][] = [
      ['GET', '/api/meal-slots'],
      ['POST', '/api/meal-slots'],
      ['PATCH', '/api/meal-slots/1'],
      ['POST', '/api/meal-slots/1/archive'],
      ['POST', '/api/meal-slots/1/unarchive'],
      ['PUT', '/api/meal-slots/order'],
    ];
    for (const [method, url] of routes) {
      const options: InjectOptions = { method, url };
      if (method !== 'GET') options.payload = { name: 'Brunch' };
      const res = await ctx.app.inject(options);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Session/);
    }
  });

  it('seeds the defaults once, in order, with their windows', async () => {
    const slots = await listSlots();
    expect(slots.map((s) => [s.name, s.windowStartMin, s.windowEndMin, s.sortOrder])).toEqual([
      ['Breakfast', 300, 630, 0],
      ['Lunch', 630, 870, 1],
      ['Snacks', 870, 1050, 2],
      ['Dinner', 1050, 1320, 3],
    ]);
    expect(slots.every((s) => s.archivedAt === null)).toBe(true);
    expect(new MealSlotService(ctx.opened.db).seedDefaults()).toBe(0);
    expect((await listSlots()).length).toBe(4);
  });

  it('creates, renames and moves the window, reorders, archives and restores', async () => {
    const created = await api('POST', '/api/meal-slots', {
      name: '  Late night ',
      windowStartMin: 1320,
      windowEndMin: 120,
    });
    expect(created.statusCode, created.body).toBe(201);
    const slot = created.json<MealSlot>();
    expect(slot).toMatchObject({ name: 'Late night', windowStartMin: 1320, windowEndMin: 120 });
    expect(slot.sortOrder).toBe(4);

    const patched = await api('PATCH', `/api/meal-slots/${slot.id}`, {
      name: 'Supper',
      windowStartMin: 1260,
      windowEndMin: 60,
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json<MealSlot>()).toMatchObject({
      name: 'Supper',
      windowStartMin: 1260,
      windowEndMin: 60,
    });

    const reordered = await api('PUT', '/api/meal-slots/order', { ids: [slot.id] });
    expect(reordered.statusCode).toBe(200);
    const order = reordered.json<MealSlot[]>();
    expect(order[0]?.id).toBe(slot.id);
    expect(order.slice(1).map((s) => s.name)).toEqual(['Breakfast', 'Lunch', 'Snacks', 'Dinner']);

    const archived = await api('POST', `/api/meal-slots/${slot.id}/archive`);
    expect(archived.json<MealSlot>().archivedAt).not.toBeNull();
    expect((await listSlots()).some((s) => s.id === slot.id)).toBe(false);
    expect((await listSlots(true)).some((s) => s.id === slot.id)).toBe(true);

    const restored = await api('POST', `/api/meal-slots/${slot.id}/unarchive`);
    expect(restored.json<MealSlot>().archivedAt).toBeNull();
  });

  it('validates the window and the name', async () => {
    const res = await api('POST', '/api/meal-slots', {
      name: 'Tea',
      windowStartMin: 900,
      windowEndMin: 1440,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect((res.json().error.details as { path: string }[]).map((d) => d.path)).toContain(
      'windowEndMin',
    );

    const blank = await api('POST', '/api/meal-slots', {
      name: '  ',
      windowStartMin: 0,
      windowEndMin: 1,
    });
    expect(blank.statusCode).toBe(400);
    expect((blank.json().error.details as { path: string }[]).map((d) => d.path)).toContain('name');
  });

  it('refuses duplicate names, case-insensitively', async () => {
    const res = await api('POST', '/api/meal-slots', {
      name: 'lunch',
      windowStartMin: 0,
      windowEndMin: 1,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('keeps at least one active slot and has no hard delete', async () => {
    const slots = await listSlots();
    for (const slot of slots.slice(0, 3)) {
      expect((await api('POST', `/api/meal-slots/${slot.id}/archive`)).statusCode).toBe(200);
    }
    const last = await api('POST', `/api/meal-slots/${slots[3]!.id}/archive`);
    expect(last.statusCode).toBe(400);
    expect(last.json().error.message).toMatch(/at least one active/);
    expect((await listSlots()).length).toBe(1);

    const del = await api('DELETE', `/api/meal-slots/${slots[0]!.id}`);
    expect(del.statusCode).toBe(404);
  });

  it('rejects reordering with unknown ids and 404s for unknown slots', async () => {
    expect((await api('PUT', '/api/meal-slots/order', { ids: [4242] })).statusCode).toBe(400);
    expect(
      (
        await api('PATCH', '/api/meal-slots/4242', {
          name: 'x',
          windowStartMin: 0,
          windowEndMin: 1,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('still accepts a new entry in an archived slot (undo restores where it was) but not an unknown slot', async () => {
    const slots = await listSlots();
    const snacks = slots.find((s) => s.name === 'Snacks')!;
    await api('POST', `/api/meal-slots/${snacks.id}/archive`);
    const entry = {
      day: '2025-10-19',
      slotId: snacks.id,
      loggedAt: '2025-10-19T15:00:00+02:00',
      foodId: null,
      name: 'Apple',
      quantity: 100,
      per100: {
        kcal: 52,
        protein: 0.3,
        carbs: 14,
        fat: 0.2,
        fiber: null,
        sugar: null,
        saturatedFat: null,
        sodiumMg: null,
      },
    };
    const res = await api('POST', '/api/diary/entries', entry);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<{ slotId: number }>().slotId).toBe(snacks.id);

    const unknown = await api('POST', '/api/diary/entries', { ...entry, slotId: 4242 });
    expect(unknown.statusCode).toBe(400);
    expect((unknown.json().error.details as { path: string }[])[0]?.path).toBe('slotId');
  });
});
