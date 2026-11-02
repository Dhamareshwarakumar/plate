import type { OffResult } from '@plate/shared';
import { describe, expect, it } from 'vitest';
import { inferBasis, scannedResultToFoodInput } from './scan-helpers';

describe('inferBasis', () => {
  it('reads a volume in the package size as millilitres', () => {
    expect(inferBasis('1l')).toBe('ml');
    expect(inferBasis('1 L')).toBe('ml');
    expect(inferBasis('330 ml')).toBe('ml');
    expect(inferBasis('33cl')).toBe('ml');
    expect(inferBasis('12 fl oz')).toBe('ml');
    expect(inferBasis('1 litre')).toBe('ml');
  });

  it('defaults to grams for weights, unknown units and missing sizes', () => {
    expect(inferBasis('250 g')).toBe('g');
    expect(inferBasis('1 kg')).toBe('g');
    expect(inferBasis('6 x 45g')).toBe('g');
    expect(inferBasis('large')).toBe('g');
    expect(inferBasis(null)).toBe('g');
  });
});

describe('scannedResultToFoodInput', () => {
  it('copies the product into a library food with the code kept and no portions', () => {
    const oatly: OffResult = {
      code: '7394376616228',
      name: 'Oat drink',
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
    };
    expect(scannedResultToFoodInput(oatly)).toEqual({
      name: 'Oat drink',
      brand: 'Oatly',
      categoryId: null,
      basis: 'ml',
      per100: oatly.per100,
      portions: [],
      offCode: '7394376616228',
    });
  });
});
