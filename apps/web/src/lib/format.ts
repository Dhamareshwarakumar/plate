import { roundNutrient, type FoodBasis } from '@plate/shared';

/** "1,420" */
export function formatKcal(value: number): string {
  return Math.round(value).toLocaleString();
}

/** "4.9" (one decimal, trailing .0 dropped) */
export function formatGrams(value: number): string {
  return roundNutrient('protein', value).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/** "450 g", "236.5 g", "250 ml" */
export function formatQuantity(quantity: number, basis: FoodBasis): string {
  const rounded = Math.round(quantity * 10) / 10;
  return `${rounded.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${basis}`;
}

/** "2 × 1 medium" or "1 medium" */
export function formatPortion(label: string, count: number | null): string {
  if (count === null || count === 1) return label;
  const rounded = Math.round(count * 100) / 100;
  return `${rounded.toLocaleString(undefined, { maximumFractionDigits: 2 })} × ${label}`;
}
