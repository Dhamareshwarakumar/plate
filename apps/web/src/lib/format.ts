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

/** Millilitres as litres: "1.25", "0.5", "2" (unit added by the caller). */
export function formatLitres(ml: number): string {
  return (Math.round(ml / 10) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** "78.4" — body weight always shows one decimal, like a scale. */
export function formatKg(kg: number): string {
  return kg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** "+0.6" / "−0.6" (real minus sign) / "0.0" */
export function formatSignedKg(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return formatKg(0);
  return `${rounded > 0 ? '+' : '\u2212'}${formatKg(Math.abs(rounded))}`;
}
