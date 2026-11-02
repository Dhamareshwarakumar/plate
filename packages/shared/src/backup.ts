import { z } from 'zod';
import { dayKeySchema } from './days.js';
import { foodBasisSchema, foodKindSchema, foodSourceSchema } from './foods.js';
import { activitySchema, sexSchema } from './settings.js';

/**
 * Backup document (FR-S4): raw table rows with snake_case keys exactly as stored and ids preserved,
 * so a restore puts the database back byte-for-byte (minus `auth`, `sessions` and the autoincrement
 * counters). Every column is present on every row (`nullable`, never `optional`): the API inserts
 * rows with named parameters and SQLite refuses a statement with a missing one.
 */
export const BACKUP_FORMAT = 'plate-backup';
export const BACKUP_VERSION = 1;
export const RESTORE_CONFIRMATION = 'REPLACE';

const int = z.number().int();
const nullableInt = int.nullable();
const num = z.number();
const nullableNum = num.nullable();
const str = z.string();
const nullableStr = str.nullable();

export const settingsRowSchema = z.object({ key: str, value_json: str, updated_at: str });
export const profileRowSchema = z.object({
  id: int,
  sex: sexSchema,
  birth_date: str,
  height_cm: num,
  activity: activitySchema,
});
export const categoryRowSchema = z.object({
  id: int,
  name: str,
  sort_order: int,
  archived_at: nullableStr,
});
export const mealSlotRowSchema = z.object({
  id: int,
  name: str,
  sort_order: int,
  window_start_min: int,
  window_end_min: int,
  archived_at: nullableStr,
});
export const foodRowSchema = z.object({
  id: int,
  kind: foodKindSchema,
  name: str,
  brand: str,
  category_id: nullableInt,
  basis: foodBasisSchema,
  kcal: num,
  protein: num,
  carbs: num,
  fat: num,
  fiber: nullableNum,
  sugar: nullableNum,
  saturated_fat: nullableNum,
  sodium_mg: nullableNum,
  source: foodSourceSchema,
  off_code: nullableStr,
  cooked_weight_g: nullableNum,
  servings: nullableInt,
  stale_since: nullableStr,
  archived_at: nullableStr,
  created_at: str,
  updated_at: str,
});
export const portionRowSchema = z.object({
  id: int,
  food_id: int,
  label: str,
  amount: num,
  sort_order: int,
});
export const dishIngredientRowSchema = z.object({
  id: int,
  dish_food_id: int,
  ingredient_food_id: int,
  amount: num,
  sort_order: int,
});
export const mealTemplateRowSchema = z.object({
  id: int,
  name: str,
  created_at: str,
  updated_at: str,
});
export const mealTemplateItemRowSchema = z.object({
  id: int,
  template_id: int,
  food_id: int,
  amount: num,
  sort_order: int,
});
export const goalRowSchema = z.object({
  id: int,
  effective_from: str,
  kcal: num,
  protein_g: num,
  carbs_g: num,
  fat_g: num,
  fiber_g: nullableNum,
  water_ml: nullableNum,
  goal_weight_kg: nullableNum,
  goal_weight_date: nullableStr,
  created_at: str,
});
export const diaryEntryRowSchema = z.object({
  id: int,
  day: str,
  slot_id: int,
  logged_at: str,
  food_id: nullableInt,
  name_snapshot: str,
  quantity: num,
  basis: foodBasisSchema,
  portion_label: nullableStr,
  portion_count: nullableNum,
  note: nullableStr,
  kcal_100: num,
  protein_100: num,
  carbs_100: num,
  fat_100: num,
  fiber_100: nullableNum,
  sugar_100: nullableNum,
  saturated_fat_100: nullableNum,
  sodium_mg_100: nullableNum,
  created_at: str,
  updated_at: str,
});
export const waterEntryRowSchema = z.object({ id: int, day: str, ml: int, logged_at: str });
export const weightRowSchema = z.object({
  id: int,
  day: str,
  kg: num,
  note: nullableStr,
  created_at: str,
  updated_at: str,
});

/**
 * Data key → table name, in FK-safe insert order (parents before children). A restore deletes in
 * the reverse order and inserts in this order.
 */
export const BACKUP_TABLES = {
  settings: 'settings',
  profile: 'profile',
  categories: 'categories',
  mealSlots: 'meal_slots',
  foods: 'foods',
  portions: 'portions',
  dishIngredients: 'dish_ingredients',
  mealTemplates: 'meal_templates',
  mealTemplateItems: 'meal_template_items',
  goals: 'goals',
  diaryEntries: 'diary_entries',
  waterEntries: 'water_entries',
  weights: 'weights',
} as const;
export type BackupDataKey = keyof typeof BACKUP_TABLES;
export const BACKUP_TABLE_KEYS = Object.keys(BACKUP_TABLES) as BackupDataKey[];

export const backupDataSchema = z.object({
  settings: z.array(settingsRowSchema),
  profile: z.array(profileRowSchema),
  categories: z.array(categoryRowSchema),
  mealSlots: z.array(mealSlotRowSchema),
  foods: z.array(foodRowSchema),
  portions: z.array(portionRowSchema),
  dishIngredients: z.array(dishIngredientRowSchema),
  mealTemplates: z.array(mealTemplateRowSchema),
  mealTemplateItems: z.array(mealTemplateItemRowSchema),
  goals: z.array(goalRowSchema),
  diaryEntries: z.array(diaryEntryRowSchema),
  waterEntries: z.array(waterEntryRowSchema),
  weights: z.array(weightRowSchema),
} satisfies Record<BackupDataKey, z.ZodType>);
export type BackupData = z.infer<typeof backupDataSchema>;

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  /** ISO-8601 timestamp of the export. */
  exportedAt: z.string(),
  /** Plate version that wrote the file. */
  appVersion: z.string(),
  data: backupDataSchema,
});
export type Backup = z.infer<typeof backupSchema>;

/** Just enough to tell a Plate backup from any other JSON and to read its format version. */
export const backupEnvelopeSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().min(1),
});

export const restoreRequestSchema = z.object({
  confirm: z.literal(RESTORE_CONFIRMATION, { error: 'Type REPLACE to confirm' }),
  /** Validated by `parseBackup` in the service so the staged messages reach the client. */
  backup: z.record(z.string(), z.unknown()),
});
export type RestoreRequest = z.infer<typeof restoreRequestSchema>;

/**
 * `GET backup.json?day=` / `GET backup.sqlite?day=`: the client's local day for the download's file
 * name (the server may run in UTC inside Docker); without it the server's own local day is used.
 */
export const backupDownloadQuerySchema = z.object({
  day: dayKeySchema.optional(),
});
export type BackupDownloadQuery = z.infer<typeof backupDownloadQuerySchema>;

const rowCount = z.number().int().nonnegative();
export const restoreResultSchema = z.object({
  restored: z.object({
    settings: rowCount,
    profile: rowCount,
    categories: rowCount,
    mealSlots: rowCount,
    foods: rowCount,
    portions: rowCount,
    dishIngredients: rowCount,
    mealTemplates: rowCount,
    mealTemplateItems: rowCount,
    goals: rowCount,
    diaryEntries: rowCount,
    waterEntries: rowCount,
    weights: rowCount,
  } satisfies Record<BackupDataKey, z.ZodType>),
});
export type RestoreResult = z.infer<typeof restoreResultSchema>;

export type BackupParseFailureCode = 'not_a_backup' | 'newer_version' | 'invalid';

export interface BackupIssue {
  path: string;
  message: string;
}

export type ParseBackupResult =
  | { ok: true; backup: Backup }
  | { ok: false; code: BackupParseFailureCode; message: string; issues: BackupIssue[] };

const MAX_REPORTED_ISSUES = 20;

/**
 * Staged validation shared by the API and the import sheet, so both give the same message:
 * 1. envelope (is this a Plate backup at all?), 2. format version newer than this build,
 * 3. the full schema. Issue paths are prefixed with `backup.` to match the restore request body.
 */
export function parseBackup(input: unknown): ParseBackupResult {
  const envelope = backupEnvelopeSchema.safeParse(input);
  if (!envelope.success) {
    return {
      ok: false,
      code: 'not_a_backup',
      message: 'This file is not a Plate backup',
      issues: [{ path: 'backup', message: 'Expected a Plate backup document' }],
    };
  }
  if (envelope.data.version > BACKUP_VERSION) {
    return {
      ok: false,
      code: 'newer_version',
      message: `This backup was made by a newer version of Plate (format ${envelope.data.version}); update Plate first`,
      issues: [
        {
          path: 'backup.version',
          message: `Supported format versions: 1 to ${BACKUP_VERSION}`,
        },
      ],
    };
  }
  const full = backupSchema.safeParse(input);
  if (!full.success) {
    return {
      ok: false,
      code: 'invalid',
      message: 'This backup file is damaged or incomplete',
      issues: full.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({
        path: ['backup', ...issue.path.map(String)].join('.'),
        message: issue.message,
      })),
    };
  }
  return { ok: true, backup: full.data };
}

export interface BackupCounts {
  foods: number;
  entries: number;
  /** Distinct diary days. */
  days: number;
  weights: number;
  goals: number;
}

/** What the import sheet shows next to the server's current counts before a restore. */
export function backupCounts(backup: Backup): BackupCounts {
  const { data } = backup;
  return {
    foods: data.foods.length,
    entries: data.diaryEntries.length,
    days: new Set(data.diaryEntries.map((e) => e.day)).size,
    weights: data.weights.length,
    goals: data.goals.length,
  };
}
