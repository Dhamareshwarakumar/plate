import {
  FOOD_BRAND_MAX,
  FOOD_NAME_MAX,
  nutrientsPer100Schema,
  OFF_CODE_RE,
  type OffResult,
} from '@plate/shared';

const QUANTITY_MAX = 40;
const SEARCH_RESULTS_MAX = 20;
/** OFF reports energy in kJ when no kcal figure exists. */
const KJ_PER_KCAL = 4.184;
/** Sodium is 1/2.5 of salt by mass (NaCl is 39.3 % sodium). */
const SALT_TO_SODIUM = 1 / 2.5;

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null;

/** OFF nutriments are numbers, but older entries carry numeric strings. */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return cleaned === '' ? null : cleaned;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Maps one raw OFF product to Plate's per-100 shape. Returns null when the product cannot become
 * a valid food: no code, no name, no energy, or a value outside `nutrientsPer100Schema` bounds.
 */
export function mapOffProduct(raw: unknown): OffResult | null {
  if (!isObject(raw)) return null;
  const code =
    typeof raw.code === 'string' || typeof raw.code === 'number' ? String(raw.code).trim() : '';
  if (!OFF_CODE_RE.test(code)) return null;
  const name = text(raw.product_name, FOOD_NAME_MAX);
  if (name === null) return null;
  // "Oatly, Oatly AB" → "Oatly": the first brand is the one printed largest on the pack.
  const brand = text(
    typeof raw.brands === 'string' ? raw.brands.split(',')[0] : null,
    FOOD_BRAND_MAX,
  );
  const quantity = text(raw.quantity, QUANTITY_MAX);

  const n: Raw = isObject(raw.nutriments) ? raw.nutriments : {};
  const kcalDirect = num(n['energy-kcal_100g']);
  const kj = num(n['energy_100g']);
  const kcal = kcalDirect ?? (kj === null ? null : kj / KJ_PER_KCAL);
  if (kcal === null) return null;

  const sodiumG = num(n['sodium_100g']);
  const saltG = num(n['salt_100g']);
  const sodiumMg =
    sodiumG !== null ? sodiumG * 1000 : saltG !== null ? saltG * SALT_TO_SODIUM * 1000 : null;

  const optional = (key: string): number | null => {
    const v = num(n[key]);
    return v === null ? null : round2(v);
  };

  const per100 = {
    kcal: round2(kcal),
    protein: round2(num(n['proteins_100g']) ?? 0),
    carbs: round2(num(n['carbohydrates_100g']) ?? 0),
    fat: round2(num(n['fat_100g']) ?? 0),
    fiber: optional('fiber_100g'),
    sugar: optional('sugars_100g'),
    saturatedFat: optional('saturated-fat_100g'),
    sodiumMg: sodiumMg === null ? null : Math.round(sodiumMg),
  };
  const parsed = nutrientsPer100Schema.safeParse(per100);
  if (!parsed.success) return null;
  return { code, name, brand, per100: parsed.data, quantity };
}

/** `search.pl` body → valid products in upstream order, deduplicated by code, at most 20. */
export function mapOffSearch(body: unknown): OffResult[] {
  if (!isObject(body) || !Array.isArray(body.products)) return [];
  const seen = new Set<string>();
  const out: OffResult[] = [];
  for (const raw of body.products) {
    const mapped = mapOffProduct(raw);
    if (!mapped || seen.has(mapped.code)) continue;
    seen.add(mapped.code);
    out.push(mapped);
    if (out.length >= SEARCH_RESULTS_MAX) break;
  }
  return out;
}

/** `api/v2/product/<code>.json` body → the product, or null when OFF does not know the code. */
export function mapOffProductResponse(body: unknown): OffResult | null {
  if (!isObject(body) || body.status !== 1 || !isObject(body.product)) return null;
  return mapOffProduct(body.product);
}
