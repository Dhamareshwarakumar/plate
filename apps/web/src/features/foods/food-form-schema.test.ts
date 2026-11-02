import type { OffResult } from '@plate/shared';
import { describe, expect, it } from 'vitest';
import { EMPTY_FOOD_FORM, offResultToFormValues, toFoodInput } from './food-form-schema';

const twix: OffResult = {
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

describe('offResultToFormValues', () => {
  it('turns a lookup result into form strings, null nutrients into empty fields', () => {
    expect(offResultToFormValues(twix)).toEqual({
      name: 'Twix glacé',
      brand: 'Twix',
      kcal: '280.74',
      protein: '2.78',
      carbs: '34.8',
      fat: '14.62',
      fiber: '',
      sugar: '25.52',
      saturatedFat: '9.05',
      sodiumMg: '102',
      offCode: '5000159484695',
    });
  });
  it('maps a missing brand to an empty string', () => {
    expect(offResultToFormValues({ ...twix, brand: null }).brand).toBe('');
  });
});

describe('toFoodInput', () => {
  it('sends offCode as null when the form has none and keeps a code otherwise', () => {
    const base = { ...EMPTY_FOOD_FORM, name: 'X', kcal: '1', protein: '0', carbs: '0', fat: '0' };
    expect(toFoodInput(base).offCode).toBeNull();
    expect(toFoodInput({ ...base, offCode: '5000159484695' })).toMatchObject({
      offCode: '5000159484695',
      per100: { kcal: 1, fiber: null },
    });
  });
});
