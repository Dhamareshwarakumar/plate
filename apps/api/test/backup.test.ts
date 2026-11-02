import {
  BACKUP_TABLE_KEYS,
  BACKUP_TABLES,
  backupDataSchema,
  backupSchema,
  DEFAULT_CATEGORIES,
  DEFAULT_MEAL_SLOTS,
  type AboutResponse,
  type Backup,
  type BackupDataKey,
  type Category,
  type DiaryDay,
  type Food,
  type MealSlot,
  type RestoreResult,
} from '@plate/shared';
import Database from 'better-sqlite3';
import type { InjectOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const DAY_2 = '2025-10-20';
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00.000Z`;

let ctx: TestContext;
let cookie: string;
let slots: MealSlot[];
let banana: Food;
let lentils: Food;
let oil: Food;

type TableDump = Record<BackupDataKey, Record<string, unknown>[]>;

/**
 * Every backed-up table, raw rows in the export order. The `push.*` settings (the VAPID key pair the
 * app creates on start) are server state, not user data, and stay out of the JSON backup.
 */
function dumpAll(sqlite: Database.Database = ctx.opened.sqlite): TableDump {
  const out: Partial<TableDump> = {};
  for (const key of BACKUP_TABLE_KEYS) {
    const where = key === 'settings' ? "WHERE key NOT LIKE 'push.%'" : '';
    const orderBy = key === 'settings' ? 'key' : 'id';
    out[key] = sqlite
      .prepare(`SELECT * FROM ${BACKUP_TABLES[key]} ${where} ORDER BY ${orderBy}`)
      .all() as Record<string, unknown>[];
  }
  return out as TableDump;
}

const countRows = (table: string, sqlite: Database.Database = ctx.opened.sqlite) =>
  (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

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

async function ok(res: Promise<Awaited<ReturnType<typeof api>>>, status = 200) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

async function createFood(body: Record<string, unknown>): Promise<Food> {
  return (await ok(api('POST', '/api/foods', body), 201)).json<Food>();
}

/** Touches every backed-up table through the public API. */
async function seedRichDataset() {
  await ok(api('PUT', '/api/settings', { tolerancePct: 15, weekStart: 'sunday' }));
  await ok(
    api('PUT', '/api/profile', {
      sex: 'female',
      birthDate: '1990-03-12',
      heightCm: 168,
      activity: 'light',
    }),
  );
  const supplements = (
    await ok(api('POST', '/api/categories', { name: 'Supplements' }), 201)
  ).json<Category>();
  await ok(api('POST', `/api/categories/${supplements.id}/archive`));
  slots = (await api('GET', '/api/meal-slots')).json<MealSlot[]>();
  const dinner = slots.find((s) => s.name === 'Dinner')!;
  await ok(
    api('PATCH', `/api/meal-slots/${dinner.id}`, {
      name: 'Supper',
      windowStartMin: dinner.windowStartMin,
      windowEndMin: dinner.windowEndMin,
    }),
  );

  banana = await createFood({
    name: 'Banana',
    brand: 'Chiquita',
    per100: per100(89, 1.1, 22.8, 0.3, 2.6),
    portions: [
      { label: '1 medium', amount: 118 },
      { label: '1 large', amount: 136 },
    ],
  });
  lentils = await createFood({ name: 'Red lentils', per100: per100(352, 24.6, 63.4, 1.1, 10.7) });
  oil = await createFood({ name: 'Sunflower oil', basis: 'ml', per100: per100(884, 0, 0, 100) });
  await ok(
    api('POST', '/api/dishes', {
      name: 'Dal',
      ingredients: [
        { foodId: lentils.id, amount: 200 },
        { foodId: oil.id, amount: 15 },
      ],
      cookedWeight: 600,
      servings: 3,
    }),
    201,
  );
  await ok(
    api('POST', '/api/meal-templates', {
      name: 'Quick breakfast',
      items: [
        { foodId: banana.id, amount: 118 },
        { foodId: lentils.id, amount: 50 },
      ],
    }),
    201,
  );

  const breakfast = slots.find((s) => s.name === 'Breakfast')!;
  const lunch = slots.find((s) => s.name === 'Lunch')!;
  await ok(
    api('POST', '/api/diary/entries', {
      day: DAY,
      slotId: breakfast.id,
      loggedAt: at(DAY, '07:40'),
      foodId: banana.id,
      quantity: 236,
      portionLabel: '1 medium',
      portionCount: 2,
    }),
    201,
  );
  await ok(
    api('POST', '/api/diary/entries', {
      day: DAY,
      slotId: lunch.id,
      loggedAt: at(DAY, '12:30'),
      foodId: null,
      name: 'Pizza slice',
      quantity: 200,
      note: 'office party',
      per100: per100(285, 12, 36, 10),
    }),
    201,
  );
  await ok(
    api('POST', '/api/diary/entries', {
      day: DAY_2,
      slotId: lunch.id,
      loggedAt: at(DAY_2, '13:05'),
      foodId: oil.id,
      quantity: 10,
    }),
    201,
  );
  await ok(api('POST', '/api/water', { day: DAY, ml: 250 }), 201);
  await ok(api('POST', '/api/water', { day: DAY_2, ml: 500 }), 201);
  await ok(api('PUT', `/api/weights/${DAY}`, { kg: 78.4, note: 'morning' }));
  await ok(api('PUT', `/api/weights/${DAY_2}`, { kg: 78.1 }));
  await ok(
    api('POST', '/api/goals', {
      effectiveFrom: '2025-10-01',
      kcal: 2000,
      proteinG: 150,
      carbsG: 220,
      fatG: 65,
      fiberG: 30,
      waterMl: 2500,
    }),
    201,
  );
  await ok(
    api('POST', '/api/goals', {
      effectiveFrom: DAY_2,
      kcal: 1900,
      proteinG: 150,
      carbsG: 200,
      fatG: 60,
      goalWeightKg: 74,
      goalWeightDate: '2026-02-01',
    }),
    201,
  );
}

async function exportBackup(): Promise<Backup> {
  const res = await ok(api('GET', '/api/backup.json'));
  return backupSchema.parse(res.json());
}

const emptyBackup = (): Backup => ({
  format: 'plate-backup',
  version: 1,
  exportedAt: '2025-10-20T10:00:00.000Z',
  appVersion: 'test',
  data: Object.fromEntries(BACKUP_TABLE_KEYS.map((k) => [k, []])) as unknown as Backup['data'],
});

const restore = (backup: unknown, confirm = 'REPLACE') =>
  api('POST', '/api/backup/restore', { confirm, backup });

beforeEach(async () => {
  ctx = await createTestApp();
  new CategoryService(ctx.opened.db).seedDefaults();
  new MealSlotService(ctx.opened.db).seedDefaults();
  cookie = await login(ctx.app);
  await seedRichDataset();
});
afterEach(() => ctx.close());

describe('auth gate on backup routes', () => {
  it('denies anonymous access on every route', async () => {
    const routes: ['GET' | 'POST', string][] = [
      ['GET', '/api/backup.json'],
      ['POST', '/api/backup/restore'],
      ['GET', '/api/backup.sqlite'],
      ['GET', '/api/about'],
    ];
    for (const [method, url] of routes) {
      const options: InjectOptions = { method, url };
      if (method === 'POST') options.payload = { confirm: 'REPLACE', backup: {} };
      const res = await ctx.app.inject(options);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Session/);
    }
  });
});

describe('GET /api/backup.json', () => {
  it('downloads a dated JSON document that matches the shared schema and the raw tables', async () => {
    const res = await ok(api('GET', '/api/backup.json'));
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="plate-backup-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(res.headers['cache-control']).toBe('no-store');

    const backup = backupSchema.parse(res.json());
    expect(backup.appVersion).toBe('dev');
    expect(Date.parse(backup.exportedAt)).not.toBeNaN();

    const dump = dumpAll();
    for (const key of BACKUP_TABLE_KEYS) {
      expect(backup.data[key], key).toEqual(dump[key]);
    }
    expect(Object.keys(backup.data).sort()).toEqual([...BACKUP_TABLE_KEYS].sort());
    expect(backup.data.foods).toHaveLength(4);
    expect(backup.data.diaryEntries).toHaveLength(3);
    expect(backup.data.settings.map((s) => s.key)).toEqual([
      'categories.seeded',
      'mealSlots.seeded',
      'tolerancePct',
      'weekStart',
    ]);
    const raw = res.json<Record<string, unknown>>();
    expect(raw).not.toHaveProperty('auth');
    expect(raw['data']).not.toHaveProperty('auth');
    expect(raw['data']).not.toHaveProperty('sessions');
    expect(raw['data']).not.toHaveProperty('pushSubscriptions');
  });

  it('leaves the VAPID key pair out of the export and keeps it across a restore', async () => {
    const vapidRow = () =>
      ctx.opened.sqlite
        .prepare("SELECT value_json FROM settings WHERE key = 'push.vapid'")
        .get() as { value_json: string } | undefined;
    const before = vapidRow();
    expect(before).toBeDefined();
    expect(JSON.parse(before!.value_json)).toMatchObject({
      publicKey: expect.any(String) as string,
      privateKey: expect.any(String) as string,
    });

    const backup = await exportBackup();
    expect(backup.data.settings.some((s) => s.key.startsWith('push.'))).toBe(false);
    expect(JSON.stringify(backup)).not.toContain(JSON.parse(before!.value_json).privateKey);

    // A foreign `push.vapid` row in a backup is ignored too: this server's pair stays in force.
    const tampered: Backup = {
      ...backup,
      data: {
        ...backup.data,
        settings: [
          ...backup.data.settings,
          { key: 'push.vapid', value_json: '{"publicKey":"x","privateKey":"y"}', updated_at: 'z' },
        ],
      },
    };
    const restored = await ok(restore(tampered));
    expect(restored.json<RestoreResult>().restored.settings).toBe(backup.data.settings.length);
    expect(vapidRow()).toEqual(before);
    expect(
      (await ok(api('GET', '/api/push/vapid-public-key'))).json<{ publicKey: string }>().publicKey,
    ).toBe(JSON.parse(before!.value_json).publicKey);
  });

  it('keeps the row schemas in step with the database columns', () => {
    for (const key of BACKUP_TABLE_KEYS) {
      const columns = (
        ctx.opened.sqlite.prepare(`PRAGMA table_info(${BACKUP_TABLES[key]})`).all() as {
          name: string;
        }[]
      )
        .map((c) => c.name)
        .sort();
      expect(Object.keys(backupDataSchema.shape[key].element.shape).sort(), key).toEqual(columns);
    }
  });
});

describe('POST /api/backup/restore', () => {
  it('round-trips: export → wipe → restore reproduces every table and keeps the session', async () => {
    const before = dumpAll();
    const dayBefore = (await ok(api('GET', `/api/diary/${DAY}`))).json<DiaryDay>();
    const sessionsBefore = countRows('sessions');
    const backup = await exportBackup();

    const wiped = await ok(restore(emptyBackup()));
    expect(wiped.json<RestoreResult>().restored.foods).toBe(0);
    const emptyAbout = (await ok(api('GET', '/api/about'))).json<AboutResponse>();
    expect(emptyAbout.counts).toEqual({ foods: 0, entries: 0, days: 0 });
    // The seeding guards re-add the defaults to an empty database and set their flags again.
    expect(countRows('categories')).toBe(DEFAULT_CATEGORIES.length);
    expect(countRows('meal_slots')).toBe(DEFAULT_MEAL_SLOTS.length);
    expect(dumpAll().settings.map((s) => s['key'])).toEqual([
      'categories.seeded',
      'mealSlots.seeded',
    ]);

    const restored = await ok(restore(backup));
    expect(restored.json<RestoreResult>().restored).toEqual({
      settings: 4,
      profile: 1,
      categories: DEFAULT_CATEGORIES.length + 1,
      mealSlots: DEFAULT_MEAL_SLOTS.length,
      foods: 4,
      portions: 3,
      dishIngredients: 2,
      mealTemplates: 1,
      mealTemplateItems: 2,
      goals: 2,
      diaryEntries: 3,
      waterEntries: 2,
      weights: 2,
    });
    expect(dumpAll()).toEqual(before);
    expect((await ok(api('GET', `/api/diary/${DAY}`))).json<DiaryDay>()).toEqual(dayBefore);
    expect(countRows('sessions')).toBe(sessionsBefore);
    expect(countRows('auth')).toBe(1);

    // New rows continue above the restored ids instead of colliding with them.
    const maxFoodId = Math.max(...before.foods.map((f) => f['id'] as number));
    const next = await createFood({ name: 'Apple', per100: per100(52, 0.3, 14, 0.2) });
    expect(next.id).toBeGreaterThan(maxFoodId);
  });

  it('refuses bad files and leaves the data intact', async () => {
    const before = dumpAll();

    const notBackup = await restore({ hello: 1 });
    expect(notBackup.statusCode).toBe(400);
    expect(notBackup.json().error.code).toBe('VALIDATION_ERROR');
    expect(notBackup.json().error.message).toBe('This file is not a Plate backup');
    expect(paths(notBackup)).toEqual(['backup']);

    const wrongWord = await restore(emptyBackup(), 'yes');
    expect(wrongWord.statusCode).toBe(400);
    expect(paths(wrongWord)).toEqual(['confirm']);

    const notObject = await api('POST', '/api/backup/restore', { confirm: 'REPLACE', backup: 'x' });
    expect(notObject.statusCode).toBe(400);
    expect(paths(notObject)).toEqual(['backup']);

    const newer = await restore({ ...emptyBackup(), version: 2 });
    expect(newer.statusCode).toBe(400);
    expect(newer.json().error.message).toMatch(/newer version/);
    expect(paths(newer)).toEqual(['backup.version']);

    const damaged = await exportBackup();
    (damaged.data.foods[0] as Record<string, unknown>)['kcal'] = 'x';
    const damagedRes = await restore(damaged);
    expect(damagedRes.statusCode).toBe(400);
    expect(damagedRes.json().error.message).toMatch(/damaged or incomplete/);
    expect(paths(damagedRes)).toEqual(['backup.data.foods.0.kcal']);

    const orphan = await exportBackup();
    orphan.data.diaryEntries[0]!.slot_id = 999;
    const orphanRes = await restore(orphan);
    expect(orphanRes.statusCode).toBe(400);
    expect(orphanRes.json().error.message).toMatch(/inconsistent: FOREIGN KEY/);
    expect(paths(orphanRes)).toEqual(['backup']);

    const duplicate = await exportBackup();
    duplicate.data.foods.push({ ...duplicate.data.foods[0]! });
    const duplicateRes = await restore(duplicate);
    expect(duplicateRes.statusCode).toBe(400);
    expect(duplicateRes.json().error.message).toMatch(/inconsistent: UNIQUE/);

    expect(dumpAll()).toEqual(before);
    expect((await ok(api('GET', '/api/about'))).json<AboutResponse>().counts).toEqual({
      foods: 4,
      entries: 3,
      days: 2,
    });
  });

  it('does not re-add default categories or slots to a backup that has its own but no flags', async () => {
    const backup = await exportBackup();
    backup.data.settings = backup.data.settings.filter((s) => !s.key.endsWith('.seeded'));
    const categoryCount = backup.data.categories.length;
    const slotCount = backup.data.mealSlots.length;

    await ok(restore(backup));

    expect(countRows('categories')).toBe(categoryCount);
    expect(countRows('meal_slots')).toBe(slotCount);
    expect(dumpAll().settings.map((s) => s['key'])).toEqual([
      'categories.seeded',
      'mealSlots.seeded',
      'tolerancePct',
      'weekStart',
    ]);
    // The renamed slot survived, no "Dinner" came back.
    const names = (await ok(api('GET', '/api/meal-slots'))).json<MealSlot[]>().map((s) => s.name);
    expect(names).toEqual(['Breakfast', 'Lunch', 'Snacks', 'Supper']);
  });

  it('seeds the defaults when the backup has no categories, slots or flags', async () => {
    await ok(restore(emptyBackup()));
    const categories = (await ok(api('GET', '/api/categories'))).json<Category[]>();
    expect(categories.map((c) => c.name)).toEqual([...DEFAULT_CATEGORIES]);
    const slotNames = (await ok(api('GET', '/api/meal-slots')))
      .json<MealSlot[]>()
      .map((s) => s.name);
    expect(slotNames).toEqual(DEFAULT_MEAL_SLOTS.map((s) => s.name));
  });
});

describe('GET /api/backup.sqlite', () => {
  it('streams a VACUUM INTO snapshot with the same rows and removes the temp file', async () => {
    const snapshotsBefore = new Set(
      readdirSync(tmpdir()).filter((f) => f.startsWith('plate-snapshot-')),
    );
    const res = await ok(api('GET', '/api/backup.sqlite'));
    expect(res.headers['content-type']).toMatch(/application\/vnd\.sqlite3/);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="plate-\d{4}-\d{2}-\d{2}\.sqlite"$/,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Number(res.headers['content-length'])).toBe(res.rawPayload.length);
    expect(res.rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3');

    const file = join(tmpdir(), `plate-test-${randomUUID()}.sqlite`);
    writeFileSync(file, res.rawPayload);
    const copy = new Database(file, { readonly: true });
    try {
      for (const table of ['foods', 'diary_entries', 'weights', 'goals', 'sessions']) {
        expect(countRows(table, copy), table).toBe(countRows(table));
      }
      expect(dumpAll(copy)).toEqual(dumpAll());
    } finally {
      copy.close();
      unlinkSync(file);
    }

    // The snapshot file is unlinked when the response stream closes; give that a moment.
    const deadline = Date.now() + 2000;
    let leftovers: string[];
    do {
      leftovers = readdirSync(tmpdir()).filter(
        (f) => f.startsWith('plate-snapshot-') && !snapshotsBefore.has(f),
      );
      if (leftovers.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    expect(leftovers).toEqual([]);
  });
});

describe('download file names', () => {
  it("date the file with the client's day when given, and reject an impossible one with path day", async () => {
    const json = await ok(api('GET', '/api/backup.json?day=2025-10-19'));
    expect(json.headers['content-disposition']).toBe(
      'attachment; filename="plate-backup-2025-10-19.json"',
    );
    const sqlite = await ok(api('GET', '/api/backup.sqlite?day=2025-10-19'));
    expect(sqlite.headers['content-disposition']).toBe(
      'attachment; filename="plate-2025-10-19.sqlite"',
    );

    for (const url of ['/api/backup.json?day=2025-02-30', '/api/backup.sqlite?day=today']) {
      const res = await api('GET', url);
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      expect(paths(res)).toEqual(['day']);
    }
  });
});

describe('GET /api/about', () => {
  it('reports version, database size, file name and counts', async () => {
    const about = (await ok(api('GET', '/api/about'))).json<AboutResponse>();
    expect(about).toEqual({
      version: 'dev',
      dbSizeBytes: expect.any(Number) as number,
      dbPath: ':memory:',
      counts: { foods: 4, entries: 3, days: 2 },
      offEnabled: true,
    });
    expect(about.dbSizeBytes).toBeGreaterThan(0);
    expect(about.dbSizeBytes % 4096).toBe(0);
  });
});
