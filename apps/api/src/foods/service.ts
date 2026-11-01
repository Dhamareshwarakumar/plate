import type { Food, FoodInputParsed, FoodListQuery, Portion } from '@plate/shared';
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { categories, foods, portions } from '../db/schema.js';
import { AppError } from '../errors.js';

type FoodRow = typeof foods.$inferSelect;
type PortionRow = typeof portions.$inferSelect;

const MAX_LIST = 5000;

function toPortion(row: PortionRow): Portion {
  return { id: row.id, label: row.label, amount: row.amount, sortOrder: row.sortOrder };
}

export function toFood(row: FoodRow, portionRows: PortionRow[]): Food {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    brand: row.brand === '' ? null : row.brand,
    categoryId: row.categoryId,
    basis: row.basis,
    per100: {
      kcal: row.kcal,
      protein: row.protein,
      carbs: row.carbs,
      fat: row.fat,
      fiber: row.fiber,
      sugar: row.sugar,
      saturatedFat: row.saturatedFat,
      sodiumMg: row.sodiumMg,
    },
    portions: portionRows.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map(toPortion),
    source: row.source,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class FoodService {
  constructor(private readonly db: Db) {}

  list(query: FoodListQuery): { items: Food[]; total: number } {
    const conditions: SQL[] = [];
    if (!query.includeArchived) conditions.push(isNull(foods.archivedAt));
    if (query.categoryId !== undefined) conditions.push(eq(foods.categoryId, query.categoryId));
    if (query.kind) conditions.push(eq(foods.kind, query.kind));
    if (query.query) {
      const pattern = `%${escapeLike(query.query)}%`;
      conditions.push(
        or(
          sql`${foods.name} LIKE ${pattern} ESCAPE '\\'`,
          sql`${foods.brand} LIKE ${pattern} ESCAPE '\\'`,
        )!,
      );
    }

    const rows = this.db
      .select()
      .from(foods)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(sql`lower(${foods.name})`), asc(foods.id))
      .limit(MAX_LIST)
      .all();

    const portionRows = rows.length
      ? this.db
          .select()
          .from(portions)
          .where(
            inArray(
              portions.foodId,
              rows.map((r) => r.id),
            ),
          )
          .all()
      : [];
    const byFood = new Map<number, PortionRow[]>();
    for (const p of portionRows) {
      const list = byFood.get(p.foodId);
      if (list) list.push(p);
      else byFood.set(p.foodId, [p]);
    }
    return { items: rows.map((r) => toFood(r, byFood.get(r.id) ?? [])), total: rows.length };
  }

  get(id: number): Food {
    const row = this.db.select().from(foods).where(eq(foods.id, id)).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Food not found');
    const portionRows = this.db.select().from(portions).where(eq(portions.foodId, id)).all();
    return toFood(row, portionRows);
  }

  /** Case-insensitive lookup by (name, brand); used by CSV import to detect existing rows. */
  findByNameAndBrand(name: string, brand: string | null): FoodRow | undefined {
    return this.db
      .select()
      .from(foods)
      .where(
        and(
          sql`lower(${foods.name}) = lower(${name})`,
          sql`lower(${foods.brand}) = lower(${brand ?? ''})`,
        ),
      )
      .get();
  }

  create(input: FoodInputParsed, source: 'manual' | 'off' = 'manual'): Food {
    this.assertCategory(input.categoryId);
    this.assertNameFree(input.name, input.brand);
    const now = new Date().toISOString();
    const id = this.db.transaction((tx) => {
      const row = tx
        .insert(foods)
        .values({
          kind: 'food',
          name: input.name,
          brand: input.brand ?? '',
          categoryId: input.categoryId,
          basis: input.basis,
          ...input.per100,
          source,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: foods.id })
        .get();
      this.replacePortions(tx, row.id, input.portions);
      return row.id;
    });
    return this.get(id);
  }

  update(id: number, input: FoodInputParsed): Food {
    const existing = this.db.select().from(foods).where(eq(foods.id, id)).get();
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Food not found');
    if (existing.kind === 'dish') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Dishes are edited through their ingredients');
    }
    this.assertCategory(input.categoryId);
    this.assertNameFree(input.name, input.brand, id);
    const now = new Date().toISOString();
    this.db.transaction((tx) => {
      tx.update(foods)
        .set({
          name: input.name,
          brand: input.brand ?? '',
          categoryId: input.categoryId,
          basis: input.basis,
          ...input.per100,
          updatedAt: now,
        })
        .where(eq(foods.id, id))
        .run();
      this.replacePortions(tx, id, input.portions);
    });
    return this.get(id);
  }

  setArchived(id: number, archived: boolean): Food {
    this.get(id);
    this.db
      .update(foods)
      .set({
        archivedAt: archived ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(foods.id, id))
      .run();
    return this.get(id);
  }

  /** Hard delete. Refused (409) once anything references the food; the caller should archive instead. */
  delete(id: number): void {
    this.get(id);
    const references = this.countReferences(id);
    if (references > 0) {
      throw new AppError(
        409,
        'CONFLICT',
        'This food is used in your diary or recipes. Archive it instead.',
        {
          references,
        },
      );
    }
    this.db.delete(foods).where(eq(foods.id, id)).run();
  }

  /**
   * Number of diary entries, dish ingredients and meal-template items pointing at the food.
   * Extended as those tables arrive in later phases.
   */
  countReferences(_id: number): number {
    return 0;
  }

  private replacePortions(tx: Db, foodId: number, input: FoodInputParsed['portions']): void {
    tx.delete(portions).where(eq(portions.foodId, foodId)).run();
    if (input.length === 0) return;
    tx.insert(portions)
      .values(input.map((p, i) => ({ foodId, label: p.label, amount: p.amount, sortOrder: i })))
      .run();
  }

  private assertCategory(categoryId: number | null): void {
    if (categoryId === null) return;
    const row = this.db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .get();
    if (!row)
      throw new AppError(400, 'VALIDATION_ERROR', 'Unknown category', [
        { path: 'categoryId', message: 'Unknown category' },
      ]);
  }

  private assertNameFree(name: string, brand: string | null, exceptId?: number): void {
    const clash = this.findByNameAndBrand(name, brand);
    if (clash && clash.id !== exceptId) {
      const where = clash.archivedAt ? ' (archived)' : '';
      throw new AppError(
        409,
        'CONFLICT',
        `"${name}"${brand ? ` by ${brand}` : ''} already exists${where}`,
        {
          foodId: clash.id,
          archived: clash.archivedAt !== null,
        },
      );
    }
  }
}

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}
