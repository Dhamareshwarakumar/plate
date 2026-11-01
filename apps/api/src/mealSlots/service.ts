import { DEFAULT_MEAL_SLOTS, type MealSlot, type MealSlotInput } from '@plate/shared';
import { and, asc, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { mealSlots, settings } from '../db/schema.js';
import { AppError } from '../errors.js';

const SEEDED_SETTING_KEY = 'mealSlots.seeded';

export function toMealSlot(row: typeof mealSlots.$inferSelect): MealSlot {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    windowStartMin: row.windowStartMin,
    windowEndMin: row.windowEndMin,
    archivedAt: row.archivedAt,
  };
}

/**
 * Meal slots are never hard-deleted (diary entries point at them); archiving hides a slot from
 * logging while days that used it keep showing it.
 */
export class MealSlotService {
  constructor(private readonly db: Db) {}

  /** Inserts the default slots exactly once per database. */
  seedDefaults(): number {
    const seeded = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, SEEDED_SETTING_KEY))
      .get();
    if (seeded) return 0;
    const now = new Date().toISOString();
    this.db.transaction((tx) => {
      tx.insert(mealSlots)
        .values(DEFAULT_MEAL_SLOTS.map((slot, i) => ({ ...slot, sortOrder: i })))
        .run();
      tx.insert(settings)
        .values({ key: SEEDED_SETTING_KEY, valueJson: 'true', updatedAt: now })
        .run();
    });
    return DEFAULT_MEAL_SLOTS.length;
  }

  list(includeArchived: boolean): MealSlot[] {
    const query = this.db
      .select()
      .from(mealSlots)
      .orderBy(asc(mealSlots.sortOrder), asc(mealSlots.id));
    const rows = includeArchived ? query.all() : query.where(isNull(mealSlots.archivedAt)).all();
    return rows.map(toMealSlot);
  }

  get(id: number): MealSlot {
    const row = this.db.select().from(mealSlots).where(eq(mealSlots.id, id)).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Meal slot not found');
    return toMealSlot(row);
  }

  create(input: MealSlotInput): MealSlot {
    this.assertNameFree(input.name);
    const next = this.db
      .select({ max: sql<number | null>`max(${mealSlots.sortOrder})` })
      .from(mealSlots)
      .get();
    const row = this.db
      .insert(mealSlots)
      .values({ ...input, sortOrder: (next?.max ?? -1) + 1 })
      .returning()
      .get();
    return toMealSlot(row);
  }

  /** Rename and/or change the time window. */
  update(id: number, input: MealSlotInput): MealSlot {
    this.get(id);
    this.assertNameFree(input.name, id);
    const row = this.db.update(mealSlots).set(input).where(eq(mealSlots.id, id)).returning().get();
    return toMealSlot(row);
  }

  /** Archiving the last active slot is refused: logging always needs somewhere to go. */
  setArchived(id: number, archived: boolean): MealSlot {
    const current = this.get(id);
    if (archived && current.archivedAt === null) {
      const others = this.db
        .select({ n: count() })
        .from(mealSlots)
        .where(and(isNull(mealSlots.archivedAt), ne(mealSlots.id, id)))
        .get();
      if ((others?.n ?? 0) === 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Keep at least one active meal slot');
      }
    }
    const row = this.db
      .update(mealSlots)
      .set({ archivedAt: archived ? new Date().toISOString() : null })
      .where(eq(mealSlots.id, id))
      .returning()
      .get();
    return toMealSlot(row);
  }

  /** Applies the given order; slots not listed keep their relative order after the listed ones. */
  reorder(ids: number[]): MealSlot[] {
    const existing = this.db
      .select({ id: mealSlots.id })
      .from(mealSlots)
      .where(inArray(mealSlots.id, ids))
      .all();
    if (existing.length !== new Set(ids).size) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Unknown meal slot id in order list');
    }
    this.db.transaction((tx) => {
      ids.forEach((id, index) => {
        tx.update(mealSlots).set({ sortOrder: index }).where(eq(mealSlots.id, id)).run();
      });
      const rest = tx
        .select({ id: mealSlots.id })
        .from(mealSlots)
        .orderBy(asc(mealSlots.sortOrder), asc(mealSlots.id))
        .all()
        .filter((r) => !ids.includes(r.id));
      rest.forEach((r, index) => {
        tx.update(mealSlots)
          .set({ sortOrder: ids.length + index })
          .where(eq(mealSlots.id, r.id))
          .run();
      });
    });
    return this.list(true);
  }

  private assertNameFree(name: string, exceptId?: number): void {
    const clash = this.db
      .select({ id: mealSlots.id })
      .from(mealSlots)
      .where(sql`lower(${mealSlots.name}) = lower(${name})`)
      .get();
    if (clash && clash.id !== exceptId) {
      throw new AppError(409, 'CONFLICT', `A meal slot named "${name}" already exists`, {
        slotId: clash.id,
      });
    }
  }
}
