import {
  MEAL_TEMPLATE_ITEMS_MAX,
  type LogTemplateInputParsed,
  type LogTemplateResult,
  type MealTemplate,
  type MealTemplateInput,
  type MealTemplateItem,
  type Nutrients,
  type TemplateFromMealInput,
  type TemplateFromMealResult,
} from '@plate/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { diaryEntries, foods, mealTemplateItems, mealTemplates } from '../db/schema.js';
import type { DiaryService } from '../diary/service.js';
import { AppError } from '../errors.js';
import { per100Of } from '../foods/service.js';

type TemplateRow = typeof mealTemplates.$inferSelect;

/** Preview totals in SQL from the items' current per-100 values: `sum(value_100 * amount / 100)`. */
const totalsSelection = {
  kcal: sql<number>`coalesce(sum(${foods.kcal} * ${mealTemplateItems.amount} / 100), 0)`,
  protein: sql<number>`coalesce(sum(${foods.protein} * ${mealTemplateItems.amount} / 100), 0)`,
  carbs: sql<number>`coalesce(sum(${foods.carbs} * ${mealTemplateItems.amount} / 100), 0)`,
  fat: sql<number>`coalesce(sum(${foods.fat} * ${mealTemplateItems.amount} / 100), 0)`,
  fiber: sql<number | null>`sum(${foods.fiber} * ${mealTemplateItems.amount} / 100)`,
  sugar: sql<number | null>`sum(${foods.sugar} * ${mealTemplateItems.amount} / 100)`,
  saturatedFat: sql<number | null>`sum(${foods.saturatedFat} * ${mealTemplateItems.amount} / 100)`,
  sodiumMg: sql<number | null>`sum(${foods.sodiumMg} * ${mealTemplateItems.amount} / 100)`,
};

const ZERO: Nutrients = {
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: null,
  sugar: null,
  saturatedFat: null,
  sodiumMg: null,
};

/**
 * Meal templates (FR-R3): named lists of (food or dish, amount). Logging one creates a diary entry
 * per item through `DiaryService.addEntry`, so the entries snapshot the foods like any other.
 */
export class MealTemplateService {
  constructor(
    private readonly db: Db,
    private readonly diary: DiaryService,
  ) {}

  list(): MealTemplate[] {
    const rows = this.db
      .select()
      .from(mealTemplates)
      .orderBy(asc(sql`lower(${mealTemplates.name})`), asc(mealTemplates.id))
      .all();
    return this.hydrate(rows);
  }

  get(id: number): MealTemplate {
    const row = this.db.select().from(mealTemplates).where(eq(mealTemplates.id, id)).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Meal template not found');
    return this.hydrate([row])[0]!;
  }

  create(input: MealTemplateInput): MealTemplate {
    this.assertNameFree(input.name);
    this.assertFoodsExist(input.items);
    const now = new Date().toISOString();
    const id = this.db.transaction((tx) => {
      const row = tx
        .insert(mealTemplates)
        .values({ name: input.name, createdAt: now, updatedAt: now })
        .returning({ id: mealTemplates.id })
        .get();
      this.writeItems(tx, row.id, input.items);
      return row.id;
    });
    return this.get(id);
  }

  update(id: number, input: MealTemplateInput): MealTemplate {
    this.get(id);
    this.assertNameFree(input.name, id);
    this.assertFoodsExist(input.items);
    this.db.transaction((tx) => {
      tx.update(mealTemplates)
        .set({ name: input.name, updatedAt: new Date().toISOString() })
        .where(eq(mealTemplates.id, id))
        .run();
      this.writeItems(tx, id, input.items);
    });
    return this.get(id);
  }

  /** Hard delete; nothing references a template (diary entries point at foods, not templates). */
  delete(id: number): void {
    this.get(id);
    this.db.delete(mealTemplates).where(eq(mealTemplates.id, id)).run();
  }

  /**
   * Logs every item into one meal, with per-item amount overrides from the review list. All
   * entries are written in one transaction, so a bad slot or food leaves nothing behind.
   */
  log(id: number, input: LogTemplateInputParsed): LogTemplateResult {
    const template = this.get(id);
    const amounts = template.items.map((item) => item.amount);
    input.overrides.forEach((override, i) => {
      if (override.index >= amounts.length) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Override points outside the template', [
          { path: `overrides.${i}.index`, message: `The template has ${amounts.length} items` },
        ]);
      }
      amounts[override.index] = override.amount;
    });
    const loggedAt = input.loggedAt ?? new Date().toISOString();
    this.db.transaction(() => {
      template.items.forEach((item, index) => {
        this.diary.addEntry({
          day: input.day,
          slotId: input.slotId,
          loggedAt,
          foodId: item.foodId,
          quantity: amounts[index]!,
          basis: item.basis,
          portionLabel: null,
          portionCount: null,
          note: null,
        });
      });
    });
    return { logged: template.items.length, day: this.diary.getDay(input.day) };
  }

  /**
   * "Save as meal": the library foods of a logged meal, with their quantities, become a template.
   * Ad-hoc entries have no food to point at and are skipped; a meal with none left is refused.
   */
  fromMeal(input: TemplateFromMealInput): TemplateFromMealResult {
    const rows = this.db
      .select({ foodId: diaryEntries.foodId, quantity: diaryEntries.quantity })
      .from(diaryEntries)
      .where(and(eq(diaryEntries.day, input.day), eq(diaryEntries.slotId, input.slotId)))
      .orderBy(asc(diaryEntries.loggedAt), asc(diaryEntries.id))
      .all();
    if (rows.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Nothing is logged in this meal yet', [
        { path: 'slotId', message: 'Nothing is logged in this meal yet' },
      ]);
    }
    const items = rows
      .filter((r): r is { foodId: number; quantity: number } => r.foodId !== null)
      .map((r) => ({ foodId: r.foodId, amount: r.quantity }));
    if (items.length === 0) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'This meal only has quick entries; a template needs foods from your library',
        [{ path: 'slotId', message: 'Only quick (ad-hoc) entries in this meal' }],
      );
    }
    if (items.length > MEAL_TEMPLATE_ITEMS_MAX) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `A template holds at most ${MEAL_TEMPLATE_ITEMS_MAX} items`,
        [{ path: 'slotId', message: `This meal has ${items.length} library entries` }],
      );
    }
    const template = this.create({ name: input.name, items });
    return { template, skipped: rows.length - items.length };
  }

  private hydrate(rows: TemplateRow[]): MealTemplate[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const lines = this.db
      .select({ item: mealTemplateItems, food: foods })
      .from(mealTemplateItems)
      .innerJoin(foods, eq(foods.id, mealTemplateItems.foodId))
      .where(inArray(mealTemplateItems.templateId, ids))
      .orderBy(asc(mealTemplateItems.sortOrder), asc(mealTemplateItems.id))
      .all();
    const totals = this.db
      .select({ templateId: mealTemplateItems.templateId, ...totalsSelection })
      .from(mealTemplateItems)
      .innerJoin(foods, eq(foods.id, mealTemplateItems.foodId))
      .where(inArray(mealTemplateItems.templateId, ids))
      .groupBy(mealTemplateItems.templateId)
      .all();
    const itemsByTemplate = new Map<number, MealTemplateItem[]>();
    for (const { item, food } of lines) {
      const list = itemsByTemplate.get(item.templateId) ?? [];
      list.push({
        id: item.id,
        foodId: item.foodId,
        amount: item.amount,
        sortOrder: item.sortOrder,
        name: food.name,
        brand: food.brand === '' ? null : food.brand,
        kind: food.kind,
        basis: food.basis,
        per100: per100Of(food),
        archivedAt: food.archivedAt,
      });
      itemsByTemplate.set(item.templateId, list);
    }
    const totalsByTemplate = new Map(totals.map(({ templateId, ...t }) => [templateId, t]));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      items: itemsByTemplate.get(row.id) ?? [],
      totals: totalsByTemplate.get(row.id) ?? ZERO,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  private writeItems(tx: Db, templateId: number, items: MealTemplateInput['items']): void {
    tx.delete(mealTemplateItems).where(eq(mealTemplateItems.templateId, templateId)).run();
    tx.insert(mealTemplateItems)
      .values(
        items.map((item, i) => ({
          templateId,
          foodId: item.foodId,
          amount: item.amount,
          sortOrder: i,
        })),
      )
      .run();
  }

  /** Any library food or dish may be an item (archived ones included, as with logging). */
  private assertFoodsExist(items: MealTemplateInput['items']): void {
    const ids = [...new Set(items.map((i) => i.foodId))];
    const found = new Set(
      this.db
        .select({ id: foods.id })
        .from(foods)
        .where(inArray(foods.id, ids))
        .all()
        .map((r) => r.id),
    );
    items.forEach((item, index) => {
      if (!found.has(item.foodId)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Unknown food', [
          { path: `items.${index}.foodId`, message: 'Unknown food' },
        ]);
      }
    });
  }

  private assertNameFree(name: string, exceptId?: number): void {
    const clash = this.db
      .select({ id: mealTemplates.id })
      .from(mealTemplates)
      .where(sql`lower(${mealTemplates.name}) = lower(${name})`)
      .get();
    if (clash && clash.id !== exceptId) {
      throw new AppError(409, 'CONFLICT', `A meal template named "${name}" already exists`, {
        templateId: clash.id,
      });
    }
  }
}
