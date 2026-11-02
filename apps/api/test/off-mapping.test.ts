import { describe, expect, it } from 'vitest';
import { LruCache } from '../src/off/lru.js';
import { mapOffProduct, mapOffProductResponse, mapOffSearch } from '../src/off/mapping.js';
import { offFixture as fixture, TWIX } from './off-fixtures.js';

describe('mapOffSearch', () => {
  const items = mapOffSearch(fixture('off-search.json'));

  it('keeps only valid products, in upstream order, deduplicated by code', () => {
    expect(items.map((i) => i.code)).toEqual(['7394376616228', '5060120281975', '4061459329834']);
  });

  it('maps a complete product: first brand only, sodium in mg, two decimals', () => {
    expect(items[0]).toEqual({
      code: '7394376616228',
      name: 'The original oat-ly barista edition oat drink',
      brand: 'Oatly',
      quantity: '1l',
      per100: {
        kcal: 61,
        protein: 1.1,
        carbs: 7.1,
        fat: 3,
        fiber: 0.8,
        sugar: 3.4,
        saturatedFat: 0.3,
        sodiumMg: 39,
      },
    });
  });

  it('falls back to kJ ÷ 4.184 for kcal and salt ÷ 2.5 for sodium', () => {
    expect(items[1]).toMatchObject({
      brand: 'Rude Health',
      quantity: '1 litre',
      per100: {
        kcal: 281.98,
        protein: 0.5,
        carbs: 6.3,
        fat: 2.3,
        fiber: null,
        sugar: null,
        saturatedFat: null,
        sodiumMg: 100,
      },
    });
  });

  it('coerces numeric strings, collapses whitespace in names and turns an empty brand into null', () => {
    expect(items[2]).toEqual({
      code: '4061459329834',
      name: 'Oat Milk (Barista Style)',
      brand: null,
      quantity: '1 l',
      per100: {
        kcal: 49,
        protein: 3.4,
        carbs: 5.9,
        fat: 1.8,
        fiber: null,
        sugar: 3.3,
        saturatedFat: null,
        sodiumMg: null,
      },
    });
  });

  it('returns an empty list for bodies without a products array', () => {
    expect(mapOffSearch({})).toEqual([]);
    expect(mapOffSearch(null)).toEqual([]);
    expect(mapOffSearch('nope')).toEqual([]);
  });
});

describe('mapOffProduct', () => {
  it('skips products without energy, without a name, or outside the per-100 bounds', () => {
    const base = { code: '4000000000009', product_name: 'X' };
    expect(mapOffProduct({ ...base, nutriments: { proteins_100g: 1 } })).toBeNull();
    expect(
      mapOffProduct({ ...base, product_name: '  ', nutriments: { 'energy-kcal_100g': 1 } }),
    ).toBeNull();
    expect(mapOffProduct({ ...base, nutriments: { 'energy-kcal_100g': 1500 } })).toBeNull();
    expect(
      mapOffProduct({ ...base, nutriments: { 'energy-kcal_100g': 10, fat_100g: -1 } }),
    ).toBeNull();
  });

  it('rejects codes that are not digit strings and accepts numeric codes', () => {
    const nutriments = { 'energy-kcal_100g': 10 };
    expect(mapOffProduct({ code: 'abc', product_name: 'X', nutriments })).toBeNull();
    expect(mapOffProduct({ code: '12', product_name: 'X', nutriments })).toBeNull();
    expect(mapOffProduct({ code: 12345678, product_name: 'X', nutriments })?.code).toBe('12345678');
  });

  it('defaults missing macros to 0 and rounds sodium to whole milligrams', () => {
    const r = mapOffProduct({
      code: '12345678',
      product_name: 'Water',
      nutriments: { 'energy-kcal_100g': 0, sodium_100g: 0.0012345 },
    });
    expect(r?.per100).toEqual({
      kcal: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: null,
      sugar: null,
      saturatedFat: null,
      sodiumMg: 1,
    });
  });
});

describe('mapOffProductResponse', () => {
  it('maps the v2 product body', () => {
    expect(mapOffProductResponse(fixture('off-product.json'))).toEqual(TWIX);
  });
  it('returns null for an unknown product or a malformed body', () => {
    expect(mapOffProductResponse({ status: 0, status_verbose: 'product not found' })).toBeNull();
    expect(mapOffProductResponse({ status: 1 })).toBeNull();
    expect(mapOffProductResponse(undefined)).toBeNull();
  });
});

describe('LruCache', () => {
  it('expires entries after the TTL', () => {
    let now = 1000;
    const cache = new LruCache<string>(10, 100, () => now);
    cache.set('a', 'A');
    now = 1099;
    expect(cache.get('a')).toBe('A');
    now = 1100;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently used entry once full, and a hit refreshes recency', () => {
    const cache = new LruCache<number>(2, 10_000, () => 0);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1); // a is now the most recent
    cache.set('c', 3); // evicts b
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('overwrites an existing key without growing', () => {
    const cache = new LruCache<number>(1, 10_000, () => 0);
    cache.set('a', 1);
    cache.set('a', 2);
    expect(cache.get('a')).toBe(2);
    expect(cache.size).toBe(1);
  });
});
