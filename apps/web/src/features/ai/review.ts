import {
  scaleNutrients,
  sumNutrients,
  type AiMealItem,
  type Food,
  type Nutrients,
  type NutrientsPer100,
} from '@plate/shared';
import { parseDecimal } from '@/components/ui/number-field';

/**
 * How a parsed meal item will be logged: against a library food (`matched`), against a food the
 * model proposes and "Log" creates first (`new`), or not at all until the user picks a food
 * (`needs_food`: the model named nothing the library has and suggested nothing usable).
 */
export type ReviewState = 'matched' | 'new' | 'needs_food';

export interface ReviewItem extends AiMealItem {
  /** Stable row key (rows are removed and re-assigned while reviewing). */
  key: string;
  /** The quantity as edited in the `NumberField`; `quantity` keeps the model's number. */
  quantityText: string;
  /** The library food this item logs against; null for `new` and `needs_food`. */
  food: Food | null;
  state: ReviewState;
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/** Positive decimal typed as a string; null when blank, garbage or not above 0. */
export function parsePositive(raw: string): number | null {
  const n = parseDecimal(raw);
  return n === null || Number.isNaN(n) || n <= 0 ? null : n;
}

/**
 * Pairs the server's items with the library the browser holds. A `matchedFoodId` the library does
 * not have (the list is stale, or the food was archived meanwhile) is treated like no match.
 */
export function toReviewItems(
  items: readonly AiMealItem[],
  library: readonly Food[],
): ReviewItem[] {
  const byId = new Map(library.map((food) => [food.id, food]));
  return items.map((item, index) => {
    const food = item.matchedFoodId === null ? null : (byId.get(item.matchedFoodId) ?? null);
    const state: ReviewState = food ? 'matched' : item.suggestedFood ? 'new' : 'needs_food';
    return {
      ...item,
      key: `item-${index}`,
      quantityText: fmt(item.quantity),
      food,
      ...(food ? { basis: food.basis, matchedFoodId: food.id } : {}),
      state,
    };
  });
}

/** The user picked a library food for a row: it logs against that food, in that food's basis. */
export function assignFood(item: ReviewItem, food: Food): ReviewItem {
  return {
    ...item,
    matchedFoodId: food.id,
    basis: food.basis,
    food,
    suggestedFood: null,
    state: 'matched',
  };
}

/** The per-100 values the row will be logged with, or null while it still needs a food. */
export function itemPer100(item: ReviewItem): NutrientsPer100 | null {
  if (item.food) return item.food.per100;
  if (item.suggestedFood) return item.suggestedFood.per100;
  return null;
}

/** Rows "Log N items" will write: they have a food (or one to create) and a positive quantity. */
export function loggableItems(items: readonly ReviewItem[]): ReviewItem[] {
  return items.filter(
    (item) => item.state !== 'needs_food' && parsePositive(item.quantityText) !== null,
  );
}

/** Totals of the loggable rows at their edited quantities, for the "N items · 640 kcal" line. */
export function reviewTotals(items: readonly ReviewItem[]): Nutrients {
  return sumNutrients(
    loggableItems(items).flatMap((item) => {
      const per100 = itemPer100(item);
      const quantity = parsePositive(item.quantityText);
      return per100 && quantity !== null ? [scaleNutrients(per100, quantity)] : [];
    }),
  );
}
