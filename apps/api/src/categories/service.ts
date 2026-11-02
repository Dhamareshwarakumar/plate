import { DEFAULT_CATEGORIES, type Category } from '@plate/shared';
import { asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { categories, foods, settings } from '../db/schema.js';
import { AppError } from '../errors.js';

const SEEDED_SETTING_KEY = 'categories.seeded';

function toCategory(row: typeof categories.$inferSelect): Category {
  return { id: row.id, name: row.name, sortOrder: row.sortOrder, archivedAt: row.archivedAt };
}

export class CategoryService {
  constructor(private readonly db: Db) {}

  /**
   * Inserts the default list exactly once per database, so archiving them all later sticks. A
   * table that already has rows (e.g. after restoring a backup written before the flag existed)
   * counts as seeded and only gets the flag.
   */
  seedDefaults(): number {
    const seeded = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, SEEDED_SETTING_KEY))
      .get();
    if (seeded) return 0;
    const now = new Date().toISOString();
    const existing = this.db.select({ n: count() }).from(categories).get();
    if ((existing?.n ?? 0) > 0) {
      this.db
        .insert(settings)
        .values({ key: SEEDED_SETTING_KEY, valueJson: 'true', updatedAt: now })
        .run();
      return 0;
    }
    this.db.transaction((tx) => {
      tx.insert(categories)
        .values(DEFAULT_CATEGORIES.map((name, i) => ({ name, sortOrder: i })))
        .run();
      tx.insert(settings)
        .values({ key: SEEDED_SETTING_KEY, valueJson: 'true', updatedAt: now })
        .run();
    });
    return DEFAULT_CATEGORIES.length;
  }

  list(includeArchived: boolean): Category[] {
    const query = this.db
      .select()
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.id));
    const rows = includeArchived ? query.all() : query.where(isNull(categories.archivedAt)).all();
    return rows.map(toCategory);
  }

  get(id: number): Category {
    const row = this.db.select().from(categories).where(eq(categories.id, id)).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Category not found');
    return toCategory(row);
  }

  create(name: string): Category {
    this.assertNameFree(name);
    const next = this.db
      .select({ max: sql<number | null>`max(${categories.sortOrder})` })
      .from(categories)
      .get();
    const sortOrder = (next?.max ?? -1) + 1;
    const row = this.db.insert(categories).values({ name, sortOrder }).returning().get();
    return toCategory(row);
  }

  rename(id: number, name: string): Category {
    this.get(id);
    this.assertNameFree(name, id);
    const row = this.db
      .update(categories)
      .set({ name })
      .where(eq(categories.id, id))
      .returning()
      .get();
    return toCategory(row);
  }

  setArchived(id: number, archived: boolean): Category {
    this.get(id);
    const row = this.db
      .update(categories)
      .set({ archivedAt: archived ? new Date().toISOString() : null })
      .where(eq(categories.id, id))
      .returning()
      .get();
    return toCategory(row);
  }

  /** Hard delete, only when no food points at the category; otherwise the caller should archive. */
  delete(id: number): void {
    this.get(id);
    const used = this.db.select({ n: count() }).from(foods).where(eq(foods.categoryId, id)).get();
    if ((used?.n ?? 0) > 0) {
      throw new AppError(409, 'CONFLICT', 'This category is used by foods. Archive it instead.', {
        foodsUsingCategory: used?.n ?? 0,
      });
    }
    this.db.delete(categories).where(eq(categories.id, id)).run();
  }

  /** Applies the given order; categories not listed keep their relative order after the listed ones. */
  reorder(ids: number[]): Category[] {
    const existing = this.db
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.id, ids))
      .all();
    if (existing.length !== new Set(ids).size) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Unknown category id in order list');
    }
    this.db.transaction((tx) => {
      ids.forEach((id, index) => {
        tx.update(categories).set({ sortOrder: index }).where(eq(categories.id, id)).run();
      });
      const rest = tx
        .select({ id: categories.id })
        .from(categories)
        .orderBy(asc(categories.sortOrder), asc(categories.id))
        .all()
        .filter((r) => !ids.includes(r.id));
      rest.forEach((r, index) => {
        tx.update(categories)
          .set({ sortOrder: ids.length + index })
          .where(eq(categories.id, r.id))
          .run();
      });
    });
    return this.list(true);
  }

  private assertNameFree(name: string, exceptId?: number): void {
    const clash = this.db
      .select({ id: categories.id })
      .from(categories)
      .where(sql`lower(${categories.name}) = lower(${name})`)
      .get();
    if (clash && clash.id !== exceptId) {
      throw new AppError(409, 'CONFLICT', `A category named "${name}" already exists`, {
        categoryId: clash.id,
      });
    }
  }
}
