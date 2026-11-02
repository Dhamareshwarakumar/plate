import type { FoodBasis, OffResult } from '@plate/shared';

/**
 * Open Food Facts results carry no unit, only the package size as printed ("1l", "330 ml", "250 g").
 * A volume there means the per-100 values are per 100 ml, so the food logs in millilitres.
 */
export function inferBasis(quantity: string | null): FoodBasis {
  if (quantity === null) return 'g';
  return /\d\s*(ml|cl|dl|l|litres?|liters?|fl\.?\s?oz)\b/i.test(quantity) ? 'ml' : 'g';
}

/** The food the log flow creates from a scanned product: no category, no portions, the code kept. */
export function scannedResultToFoodInput(result: OffResult) {
  return {
    name: result.name,
    brand: result.brand,
    categoryId: null,
    basis: inferBasis(result.quantity),
    per100: result.per100,
    portions: [],
    offCode: result.code,
  };
}
