import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Single-row table (id = 1) holding the app password hash. */
export const auth = sqliteTable('auth', {
  id: integer('id').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  /** 1 while the password is the bootstrap value (first start or reset), 0 once changed in-app. */
  passwordIsInitial: integer('password_is_initial').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Browser sessions. `id` is the SHA-256 of the random token held by the cookie, so a copy of the
 * database alone is not enough to hijack a session.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_expires_at_idx').on(t.expiresAt)],
);

/** Free-form key/value settings (JSON values). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [index('categories_sort_order_idx').on(t.sortOrder)],
);

/** Foods and dishes. Nutrition columns are per 100 g or 100 ml (see `basis`). */
export const foods = sqliteTable(
  'foods',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind', { enum: ['food', 'dish'] })
      .notNull()
      .default('food'),
    name: text('name').notNull(),
    /** Empty string means "no brand"; stored non-null so the uniqueness index below is simple. */
    brand: text('brand').notNull().default(''),
    categoryId: integer('category_id').references(() => categories.id),
    basis: text('basis', { enum: ['g', 'ml'] })
      .notNull()
      .default('g'),
    kcal: real('kcal').notNull(),
    protein: real('protein').notNull(),
    carbs: real('carbs').notNull(),
    fat: real('fat').notNull(),
    fiber: real('fiber'),
    sugar: real('sugar'),
    saturatedFat: real('saturated_fat'),
    sodiumMg: real('sodium_mg'),
    source: text('source', { enum: ['manual', 'off', 'dish'] })
      .notNull()
      .default('manual'),
    offCode: text('off_code'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('foods_name_idx').on(t.name),
    index('foods_category_id_idx').on(t.categoryId),
    // One food per (name, brand), case-insensitively.
    uniqueIndex('foods_name_brand_unique').on(sql`lower(${t.name})`, sql`lower(${t.brand})`),
  ],
);

/** Named amounts of a food ("1 medium = 118 g"); shortcuts only, the diary stores grams. */
export const portions = sqliteTable(
  'portions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    foodId: integer('food_id')
      .notNull()
      .references(() => foods.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    amount: real('amount').notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [index('portions_food_id_idx').on(t.foodId)],
);

/** Meal slots (Breakfast, Lunch…). Windows are minutes since midnight, [start, end), may wrap. */
export const mealSlots = sqliteTable(
  'meal_slots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull(),
    windowStartMin: integer('window_start_min').notNull(),
    windowEndMin: integer('window_end_min').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [index('meal_slots_sort_order_idx').on(t.sortOrder)],
);

/**
 * Diary entries. The `*_100` columns snapshot the food's per-100 values at logging time (FR-D10);
 * totals are always derived as `value_100 * quantity / 100`, in SQL and in the UI alike.
 */
export const diaryEntries = sqliteTable(
  'diary_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** `YYYY-MM-DD` in the client's time zone. */
    day: text('day').notNull(),
    slotId: integer('slot_id')
      .notNull()
      .references(() => mealSlots.id),
    loggedAt: text('logged_at').notNull(),
    /** Null for ad-hoc entries. No cascade: a logged food cannot be hard-deleted. */
    foodId: integer('food_id').references(() => foods.id),
    nameSnapshot: text('name_snapshot').notNull(),
    quantity: real('quantity').notNull(),
    basis: text('basis', { enum: ['g', 'ml'] })
      .notNull()
      .default('g'),
    portionLabel: text('portion_label'),
    portionCount: real('portion_count'),
    note: text('note'),
    kcal100: real('kcal_100').notNull(),
    protein100: real('protein_100').notNull(),
    carbs100: real('carbs_100').notNull(),
    fat100: real('fat_100').notNull(),
    fiber100: real('fiber_100'),
    sugar100: real('sugar_100'),
    saturatedFat100: real('saturated_fat_100'),
    sodiumMg100: real('sodium_mg_100'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('diary_entries_day_idx').on(t.day),
    index('diary_entries_food_id_idx').on(t.foodId),
    index('diary_entries_day_slot_idx').on(t.day, t.slotId),
    index('diary_entries_logged_at_idx').on(t.loggedAt),
  ],
);
