import { z } from 'zod';

/** What was logged last time for a food, so the quantity step opens pre-filled (FR-D3). */
export const lastQuantitySchema = z.object({
  quantity: z.number().positive(),
  portionLabel: z.string().nullable(),
  portionCount: z.number().positive().nullable(),
});
export type LastQuantity = z.infer<typeof lastQuantitySchema>;

const PREFIX = 'plate.lastQuantity.';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readLastQuantity(foodId: number): LastQuantity | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(`${PREFIX}${foodId}`);
  if (raw === null) return null;
  try {
    const parsed = lastQuantitySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeLastQuantity(foodId: number, value: LastQuantity): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(`${PREFIX}${foodId}`, JSON.stringify(value));
  } catch {
    // Storage full or disabled: the default quantity is a convenience, not data.
  }
}
