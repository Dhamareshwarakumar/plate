import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_TABLE_KEYS,
  BACKUP_TABLES,
  BACKUP_VERSION,
  backupCounts,
  backupDataSchema,
  parseBackup,
  restoreRequestSchema,
  restoreResultSchema,
  type Backup,
} from './backup.js';

const emptyData = () =>
  Object.fromEntries(BACKUP_TABLE_KEYS.map((key) => [key, []])) as unknown as Backup['data'];

const food = (id: number, name: string) => ({
  id,
  kind: 'food',
  name,
  brand: '',
  category_id: null,
  basis: 'g',
  kcal: 89,
  protein: 1.1,
  carbs: 22.8,
  fat: 0.3,
  fiber: 2.6,
  sugar: null,
  saturated_fat: null,
  sodium_mg: null,
  source: 'manual',
  off_code: null,
  cooked_weight_g: null,
  servings: null,
  stale_since: null,
  archived_at: null,
  created_at: '2025-10-01T08:00:00.000Z',
  updated_at: '2025-10-01T08:00:00.000Z',
});

const entry = (id: number, day: string) => ({
  id,
  day,
  slot_id: 1,
  logged_at: `${day}T08:00:00.000Z`,
  food_id: 1,
  name_snapshot: 'Banana',
  quantity: 118,
  basis: 'g',
  portion_label: '1 medium',
  portion_count: 1,
  note: null,
  kcal_100: 89,
  protein_100: 1.1,
  carbs_100: 22.8,
  fat_100: 0.3,
  fiber_100: 2.6,
  sugar_100: null,
  saturated_fat_100: null,
  sodium_mg_100: null,
  created_at: `${day}T08:00:00.000Z`,
  updated_at: `${day}T08:00:00.000Z`,
});

const validBackup = () => ({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  exportedAt: '2025-10-20T10:00:00.000Z',
  appVersion: '0.1.0',
  data: {
    ...emptyData(),
    settings: [
      { key: 'categories.seeded', value_json: 'true', updated_at: '2025-10-01T00:00:00Z' },
    ],
    categories: [{ id: 1, name: 'Fruit', sort_order: 0, archived_at: null }],
    mealSlots: [
      {
        id: 1,
        name: 'Breakfast',
        sort_order: 0,
        window_start_min: 300,
        window_end_min: 630,
        archived_at: null,
      },
    ],
    foods: [food(1, 'Banana'), food(2, 'Apple')],
    portions: [{ id: 1, food_id: 1, label: '1 medium', amount: 118, sort_order: 0 }],
    goals: [
      {
        id: 1,
        effective_from: '2025-10-01',
        kcal: 2000,
        protein_g: 150,
        carbs_g: 220,
        fat_g: 65,
        fiber_g: 30,
        water_ml: 2500,
        goal_weight_kg: null,
        goal_weight_date: null,
        created_at: '2025-10-01T00:00:00Z',
      },
    ],
    diaryEntries: [entry(1, '2025-10-19'), entry(2, '2025-10-19'), entry(3, '2025-10-20')],
    weights: [
      {
        id: 1,
        day: '2025-10-19',
        kg: 78.4,
        note: null,
        created_at: '2025-10-19T07:00:00Z',
        updated_at: '2025-10-19T07:00:00Z',
      },
    ],
  },
});

describe('parseBackup', () => {
  it('refuses anything that is not a Plate backup (stage 1)', () => {
    for (const input of [
      null,
      'text',
      42,
      [],
      {},
      { format: 'other', version: 1 },
      { version: 1 },
    ]) {
      const result = parseBackup(input);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe('not_a_backup');
      expect(result.message).toBe('This file is not a Plate backup');
      expect(result.issues.map((i) => i.path)).toEqual(['backup']);
    }
  });

  it('refuses a backup from a newer format version before looking at the rows (stage 2)', () => {
    const result = parseBackup({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('newer_version');
    expect(result.message).toMatch(/newer version of Plate \(format 2\)/);
    expect(result.issues.map((i) => i.path)).toEqual(['backup.version']);
  });

  it('reports damaged rows with their paths (stage 3), capped at 20 issues', () => {
    const backup = validBackup();
    (backup.data.foods[0] as Record<string, unknown>).kcal = 'x';
    delete (backup.data.foods[1] as Record<string, unknown>).name;
    const result = parseBackup(backup);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid');
    expect(result.message).toBe('This backup file is damaged or incomplete');
    expect(result.issues.map((i) => i.path)).toEqual([
      'backup.data.foods.0.kcal',
      'backup.data.foods.1.name',
    ]);

    const missingTables = parseBackup({ ...validBackup(), data: {} });
    expect(missingTables.ok).toBe(false);
    if (missingTables.ok) return;
    expect(missingTables.issues).toHaveLength(BACKUP_TABLE_KEYS.length);

    const many = validBackup();
    many.data.weights = Array.from({ length: 30 }, (_, i) => ({
      ...many.data.weights[0]!,
      id: i + 1,
      kg: 'heavy' as unknown as number,
    }));
    const capped = parseBackup(many);
    expect(capped.ok).toBe(false);
    if (capped.ok) return;
    expect(capped.issues).toHaveLength(20);
  });

  it('accepts a valid backup and strips unknown keys from rows', () => {
    const backup = validBackup();
    (backup.data.categories[0] as Record<string, unknown>).colour = 'red';
    const result = parseBackup(backup);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backup.data.categories[0]).toEqual({
      id: 1,
      name: 'Fruit',
      sort_order: 0,
      archived_at: null,
    });
    expect(result.backup.data.foods).toHaveLength(2);
    expect(parseBackup({ ...validBackup(), data: emptyData() }).ok).toBe(true);
  });
});

describe('backupCounts', () => {
  it('counts foods, entries, distinct days, weights and goals', () => {
    const result = parseBackup(validBackup());
    if (!result.ok) throw new Error(result.message);
    expect(backupCounts(result.backup)).toEqual({
      foods: 2,
      entries: 3,
      days: 2,
      weights: 1,
      goals: 1,
    });
  });
});

describe('BACKUP_TABLES', () => {
  const order = (key: keyof typeof BACKUP_TABLES) => BACKUP_TABLE_KEYS.indexOf(key);

  it('lists parents before children (FK-safe insert order)', () => {
    expect(order('categories')).toBeLessThan(order('foods'));
    expect(order('foods')).toBeLessThan(order('portions'));
    expect(order('foods')).toBeLessThan(order('dishIngredients'));
    expect(order('foods')).toBeLessThan(order('mealTemplateItems'));
    expect(order('foods')).toBeLessThan(order('diaryEntries'));
    expect(order('mealSlots')).toBeLessThan(order('diaryEntries'));
    expect(order('mealTemplates')).toBeLessThan(order('mealTemplateItems'));
  });

  it('matches the data schema and the restore result key for key', () => {
    expect(Object.keys(backupDataSchema.shape).sort()).toEqual([...BACKUP_TABLE_KEYS].sort());
    expect(Object.keys(restoreResultSchema.shape.restored.shape).sort()).toEqual(
      [...BACKUP_TABLE_KEYS].sort(),
    );
    expect(new Set(Object.values(BACKUP_TABLES)).size).toBe(BACKUP_TABLE_KEYS.length);
  });
});

describe('restoreRequestSchema', () => {
  it('requires the literal confirmation and an object body', () => {
    expect(restoreRequestSchema.safeParse({ confirm: 'REPLACE', backup: {} }).success).toBe(true);
    const wrong = restoreRequestSchema.safeParse({ confirm: 'yes', backup: {} });
    expect(wrong.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['confirm', 'Type REPLACE to confirm'],
    ]);
    const notObject = restoreRequestSchema.safeParse({ confirm: 'REPLACE', backup: 'nope' });
    expect(notObject.error?.issues.map((i) => i.path.join('.'))).toEqual(['backup']);
  });
});
