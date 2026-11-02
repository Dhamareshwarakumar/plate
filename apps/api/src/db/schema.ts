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
    /** Dishes only: the cooked weight the per-100 values are spread over. */
    cookedWeightG: real('cooked_weight_g'),
    /** Dishes only: number of servings behind the "1 serving" portion. */
    servings: integer('servings'),
    /** Dishes only: set when an ingredient food changed after the last calculation (FR-R2). */
    staleSince: text('stale_since'),
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

/**
 * Recipe lines of a dish (FR-R1). Deleting the dish removes its lines; an ingredient food that is
 * still used here cannot be hard-deleted (no cascade, counted by `FoodService.countReferences`).
 */
export const dishIngredients = sqliteTable(
  'dish_ingredients',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    dishFoodId: integer('dish_food_id')
      .notNull()
      .references(() => foods.id, { onDelete: 'cascade' }),
    ingredientFoodId: integer('ingredient_food_id')
      .notNull()
      .references(() => foods.id),
    /** Raw amount in the ingredient's basis. */
    amount: real('amount').notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [
    index('dish_ingredients_dish_food_id_idx').on(t.dishFoodId),
    index('dish_ingredients_ingredient_food_id_idx').on(t.ingredientFoodId),
  ],
);

/** Meal templates (FR-R3): named lists of (food, amount) logged in one tap. */
export const mealTemplates = sqliteTable('meal_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const mealTemplateItems = sqliteTable(
  'meal_template_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    templateId: integer('template_id')
      .notNull()
      .references(() => mealTemplates.id, { onDelete: 'cascade' }),
    /** No cascade: a food in a template cannot be hard-deleted. */
    foodId: integer('food_id')
      .notNull()
      .references(() => foods.id),
    amount: real('amount').notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [
    index('meal_template_items_template_id_idx').on(t.templateId),
    index('meal_template_items_food_id_idx').on(t.foodId),
  ],
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

/**
 * Goals, each in effect from `effective_from` until the next goal's date (FR-G1). One goal per
 * start day; posting the same `effective_from` again replaces that goal.
 */
export const goals = sqliteTable(
  'goals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** `YYYY-MM-DD`; the first day the goal applies to. */
    effectiveFrom: text('effective_from').notNull(),
    kcal: real('kcal').notNull(),
    proteinG: real('protein_g').notNull(),
    carbsG: real('carbs_g').notNull(),
    fatG: real('fat_g').notNull(),
    fiberG: real('fiber_g'),
    waterMl: real('water_ml'),
    /** Target body weight (FR-W2) and the day it is aimed at; both optional. */
    goalWeightKg: real('goal_weight_kg'),
    goalWeightDate: text('goal_weight_date'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('goals_effective_from_unique').on(t.effectiveFrom)],
);

/** Single-row table (id = 1) with what the goal calculator needs; weight comes from the weight log. */
export const profile = sqliteTable('profile', {
  id: integer('id').primaryKey(),
  sex: text('sex', { enum: ['male', 'female'] }).notNull(),
  /** `YYYY-MM-DD` */
  birthDate: text('birth_date').notNull(),
  heightCm: real('height_cm').notNull(),
  activity: text('activity', {
    enum: ['sedentary', 'light', 'moderate', 'active', 'very_active'],
  }).notNull(),
});

/** Water additions (FR-D9): a day's total is `sum(ml)`; "undo last" deletes the newest row. */
export const waterEntries = sqliteTable(
  'water_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** `YYYY-MM-DD` in the client's time zone. */
    day: text('day').notNull(),
    ml: integer('ml').notNull(),
    loggedAt: text('logged_at').notNull(),
  },
  (t) => [index('water_entries_day_idx').on(t.day)],
);

/** Body weight (FR-W1): one row per day; `PUT weights/:day` replaces it. */
export const weights = sqliteTable(
  'weights',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** `YYYY-MM-DD` in the client's time zone. */
    day: text('day').notNull(),
    kg: real('kg').notNull(),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('weights_day_unique').on(t.day)],
);

/**
 * Web Push subscriptions (FR-N2), one per browser that enabled reminders. The endpoint is a
 * capability URL issued by the push service; it is never logged in full. Rows are deleted when the
 * push service answers 404/410, and `failures` counts other consecutive delivery errors.
 */
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    /** "Chrome on Android", derived by the client. */
    deviceLabel: text('device_label').notNull(),
    /** IANA zone of the device when it subscribed. */
    timezone: text('timezone').notNull(),
    createdAt: text('created_at').notNull(),
    /** Last successful delivery. */
    lastUsedAt: text('last_used_at'),
    failures: integer('failures').notNull().default(0),
  },
  (t) => [uniqueIndex('push_subscriptions_endpoint_unique').on(t.endpoint)],
);

/**
 * Reminder ledger (FR-N3): one row per reminder per local day, written before the push goes out,
 * so a reminder fires at most once a day however many scheduler ticks see it as due.
 */
export const reminderSends = sqliteTable(
  'reminder_sends',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** `meal:<slotId>`, `weigh-in` or `water` (see `reminderKeys` in shared). */
    reminderKey: text('reminder_key').notNull(),
    /** `YYYY-MM-DD` in the configured reminder time zone. */
    day: text('day').notNull(),
    sentAt: text('sent_at').notNull(),
  },
  (t) => [uniqueIndex('reminder_sends_key_day_unique').on(t.reminderKey, t.day)],
);
