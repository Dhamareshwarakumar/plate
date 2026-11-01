import {
  computeDishPer100,
  dishPer100WithinBounds,
  SERVING_PORTION_LABEL,
  servingGrams,
  type Dish,
  type DishIngredient,
  type DishInputParsed,
  type Nutrients,
} from '@plate/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { dishIngredients, foods, portions } from '../db/schema.js';
import { AppError } from '../errors.js';
import { per100Of, toFood, type FoodService } from '../foods/service.js';

type FoodRow = typeof foods.$inferSelect;

interface IngredientLine {
  foodId: number;
  amount: number;
  food: FoodRow;
}

/**
 * Dishes are rows in `foods` with `kind = 'dish'` (D42) plus their recipe in `dish_ingredients`.
 * Per-100 values are computed on save and on an explicit recalculate (FR-R2, D26); edits to an
 * ingredient food only flag the dish stale (see `FoodService.update`).
 */
export class DishService {
  constructor(
    private readonly db: Db,
    private readonly foodService: FoodService,
  ) {}

  get(id: number): Dish {
    const row = this.db.select().from(foods).where(eq(foods.id, id)).get();
    if (!row || row.kind !== 'dish') throw new AppError(404, 'NOT_FOUND', 'Dish not found');
    return this.toDish(row);
  }

  create(input: DishInputParsed): Dish {
    this.foodService.assertCategory(input.categoryId);
    this.foodService.assertNameFree(input.name, input.brand);
    const lines = this.resolveIngredients(input.ingredients);
    const per100 = this.computePer100(lines, input.cookedWeight);
    const now = new Date().toISOString();
    const id = this.db.transaction((tx) => {
      const row = tx
        .insert(foods)
        .values({
          kind: 'dish',
          name: input.name,
          brand: input.brand ?? '',
          categoryId: input.categoryId,
          basis: 'g',
          ...per100,
          source: 'dish',
          cookedWeightG: input.cookedWeight,
          servings: input.servings,
          staleSince: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: foods.id })
        .get();
      this.writeRecipe(tx, row.id, lines, input.cookedWeight, input.servings);
      return row.id;
    });
    return this.get(id);
  }

  /** Replaces the recipe, recomputes the per-100 values and clears the stale flag. */
  update(id: number, input: DishInputParsed): Dish {
    this.get(id);
    this.foodService.assertCategory(input.categoryId);
    this.foodService.assertNameFree(input.name, input.brand, id);
    const lines = this.resolveIngredients(input.ingredients, id);
    const per100 = this.computePer100(lines, input.cookedWeight);
    const now = new Date().toISOString();
    this.db.transaction((tx) => {
      tx.update(foods)
        .set({
          name: input.name,
          brand: input.brand ?? '',
          categoryId: input.categoryId,
          ...per100,
          cookedWeightG: input.cookedWeight,
          servings: input.servings,
          staleSince: null,
          updatedAt: now,
        })
        .where(eq(foods.id, id))
        .run();
      this.writeRecipe(tx, id, lines, input.cookedWeight, input.servings);
    });
    return this.get(id);
  }

  /** Recomputes from the ingredients' current values and the stored cooked weight (FR-R2). */
  recalculate(id: number): Dish {
    const dish = this.get(id);
    const lines = this.resolveIngredients(
      dish.ingredients.map((i) => ({ foodId: i.foodId, amount: i.amount })),
      id,
    );
    const per100 = this.computePer100(lines, dish.cookedWeight);
    this.db
      .update(foods)
      .set({ ...per100, staleSince: null, updatedAt: new Date().toISOString() })
      .where(eq(foods.id, id))
      .run();
    return this.get(id);
  }

  private toDish(row: FoodRow): Dish {
    const portionRows = this.db.select().from(portions).where(eq(portions.foodId, row.id)).all();
    const lines = this.db
      .select({ line: dishIngredients, food: foods })
      .from(dishIngredients)
      .innerJoin(foods, eq(foods.id, dishIngredients.ingredientFoodId))
      .where(eq(dishIngredients.dishFoodId, row.id))
      .orderBy(asc(dishIngredients.sortOrder), asc(dishIngredients.id))
      .all();
    const ingredients: DishIngredient[] = lines.map(({ line, food }) => ({
      id: line.id,
      foodId: line.ingredientFoodId,
      amount: line.amount,
      sortOrder: line.sortOrder,
      name: food.name,
      brand: food.brand === '' ? null : food.brand,
      basis: food.basis,
      per100: per100Of(food),
      archivedAt: food.archivedAt,
    }));
    return {
      ...toFood(row, portionRows),
      kind: 'dish',
      ingredients,
      // Rows created as dishes always carry a cooked weight; the fallback only guards the type.
      cookedWeight: row.cookedWeightG ?? 100,
      servings: row.servings,
      staleSince: row.staleSince,
    };
  }

  /**
   * Loads the ingredient foods, refusing unknown ids and dishes (a dish inside a dish would need
   * recursive recalculation; combine dishes with a meal template instead).
   */
  private resolveIngredients(
    input: readonly { foodId: number; amount: number }[],
    dishId?: number,
  ): IngredientLine[] {
    const ids = [...new Set(input.map((i) => i.foodId))];
    const rows = ids.length ? this.db.select().from(foods).where(inArray(foods.id, ids)).all() : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return input.map((line, index) => {
      const food = byId.get(line.foodId);
      if (!food) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Unknown ingredient', [
          { path: `ingredients.${index}.foodId`, message: 'Unknown food' },
        ]);
      }
      if (food.kind === 'dish' || food.id === dishId) {
        throw new AppError(400, 'VALIDATION_ERROR', 'A dish cannot contain another dish', [
          {
            path: `ingredients.${index}.foodId`,
            message: 'A dish cannot contain another dish; combine dishes in a meal template',
          },
        ]);
      }
      return { foodId: line.foodId, amount: line.amount, food };
    });
  }

  private computePer100(lines: IngredientLine[], cookedWeight: number): Nutrients {
    const per100 = computeDishPer100(
      lines.map((l) => ({ per100: per100Of(l.food), amount: l.amount })),
      cookedWeight,
    );
    if (!dishPer100WithinBounds(per100)) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Cooked weight is too low for these ingredients',
        [
          {
            path: 'cookedWeight',
            message: `${Math.round(per100.kcal)} kcal per 100 g is more than pure fat; check the cooked weight`,
          },
        ],
      );
    }
    return per100;
  }

  /** Rewrites the ingredient lines and the single "1 serving" portion. */
  private writeRecipe(
    tx: Db,
    dishId: number,
    lines: IngredientLine[],
    cookedWeight: number,
    servings: number | null,
  ): void {
    tx.delete(dishIngredients).where(eq(dishIngredients.dishFoodId, dishId)).run();
    tx.insert(dishIngredients)
      .values(
        lines.map((l, i) => ({
          dishFoodId: dishId,
          ingredientFoodId: l.foodId,
          amount: l.amount,
          sortOrder: i,
        })),
      )
      .run();
    tx.delete(portions).where(eq(portions.foodId, dishId)).run();
    if (servings !== null) {
      tx.insert(portions)
        .values({
          foodId: dishId,
          label: SERVING_PORTION_LABEL,
          amount: servingGrams(cookedWeight, servings),
          sortOrder: 0,
        })
        .run();
    }
  }
}
