import type { AiSuggestedFood, Food, FoodInput } from '@plate/shared';
import { ApiClientError } from '@/lib/api';

/** A row that either already points at a library food or carries the food the model proposed. */
export interface PendingFoodRow {
  foodId: number | null;
  pending: AiSuggestedFood | null;
}

/** The API shape of a suggested food: AI-created, no brand, marked estimated (`source = 'ai'`). */
export function suggestedFoodInput(suggested: AiSuggestedFood): FoodInput {
  return {
    name: suggested.name,
    brand: null,
    basis: suggested.basis,
    per100: suggested.per100,
    portions: suggested.portions,
    estimated: true,
  };
}

/**
 * Creates every pending food, one after the other (the library mutations invalidate shared caches,
 * so parallel creates would race), and returns the rows with a real `foodId`. A name that already
 * exists in the library (409 with the clashing id, not archived) is reused instead of failing: the
 * model often proposes a food the user added since the request. Any other failure is rethrown with
 * the food's name in front so the toast says which line broke. Shared by the AI log sheet and the
 * dish editor's recipe import (both create on confirm, never on parse).
 */
export type ResolvedRow<T extends PendingFoodRow> = Omit<T, 'foodId'> & { foodId: number };

export async function resolvePendingFoods<T extends PendingFoodRow>(
  rows: readonly T[],
  create: (input: FoodInput) => Promise<Food>,
): Promise<ResolvedRow<T>[]> {
  const resolved: ResolvedRow<T>[] = [];
  for (const row of rows) {
    if (row.foodId !== null) {
      resolved.push({ ...row, foodId: row.foodId });
      continue;
    }
    if (!row.pending) {
      throw new Error('Pick a food for every line first.');
    }
    const name = row.pending.name;
    try {
      const food = await create(suggestedFoodInput(row.pending));
      resolved.push({ ...row, foodId: food.id });
    } catch (err) {
      const reuse = reusableFoodId(err);
      if (reuse !== null) {
        resolved.push({ ...row, foodId: reuse });
        continue;
      }
      if (err instanceof ApiClientError) {
        throw new ApiClientError(err.status, err.code, `“${name}”: ${err.message}`, err.details);
      }
      throw new Error(`“${name}”: could not be saved. Try again.`, { cause: err });
    }
  }
  return resolved;
}

/** The id of an active food whose name clashed (409), or null when the error is anything else. */
function reusableFoodId(err: unknown): number | null {
  if (!(err instanceof ApiClientError) || err.status !== 409) return null;
  const details = err.details as { foodId?: unknown; archived?: unknown } | undefined;
  if (typeof details?.foodId !== 'number' || details.archived === true) return null;
  return details.foodId;
}
