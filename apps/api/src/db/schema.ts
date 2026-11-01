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
