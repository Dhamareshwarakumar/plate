import type { OffResult } from '@plate/shared';
import { readFileSync } from 'node:fs';

/** Raw upstream bodies trimmed to the fields the proxy requests (`test/fixtures/off-*.json`). */
export const offFixture = (name: 'off-search.json' | 'off-product.json'): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

/** What `off-product.json` maps to. */
export const TWIX: OffResult = {
  code: '5000159484695',
  name: 'Twix glacé',
  brand: 'Twix',
  quantity: '1 gram',
  per100: {
    kcal: 280.74,
    protein: 2.78,
    carbs: 34.8,
    fat: 14.62,
    fiber: null,
    sugar: 25.52,
    saturatedFat: 9.05,
    sodiumMg: 102,
  },
};
