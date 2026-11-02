import type { AiEstimateFoodResponse, OffResult } from '@plate/shared';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_FOOD_FORM,
  estimateToFormValues,
  offResultToFormValues,
  per100Equals,
  toFoodInput,
} from './food-form-schema';

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

// The fake provider's canned estimate (apps/api/src/ai/providers/fake.ts).
const sambar: AiEstimateFoodResponse = {
  per100: {
    kcal: 95,
    protein: 3.2,
    carbs: 11,
    fat: 4.1,
    fiber: 2.5,
    sugar: null,
    saturatedFat: null,
    sodiumMg: 310,
  },
  basis: 'g',
  portions: [{ label: '1 bowl', amount: 200 }],
  confidence: 'medium',
  rationale: 'Typical homemade sambar.',
};

describe('estimateToFormValues', () => {
  it('maps the estimate onto nutrition, basis and portions as form strings', () => {
    expect(estimateToFormValues(sambar)).toEqual({
      basis: 'g',
      kcal: '95',
      protein: '3.2',
      carbs: '11',
      fat: '4.1',
      fiber: '2.5',
      sugar: '',
      saturatedFat: '',
      sodiumMg: '310',
      portions: [{ label: '1 bowl', amount: '200' }],
    });
  });
});

describe('per100Equals', () => {
  const filled = { ...EMPTY_FOOD_FORM, ...estimateToFormValues(sambar) };
  it('is true while the fields hold the estimate (string vs number, blank vs null)', () => {
    expect(per100Equals(filled, sambar.per100)).toBe(true);
    expect(per100Equals({ ...filled, fat: '4,1' }, sambar.per100)).toBe(true);
  });
  it('turns false as soon as one value is edited, cleared or filled in', () => {
    expect(per100Equals({ ...filled, kcal: '96' }, sambar.per100)).toBe(false);
    expect(per100Equals({ ...filled, fiber: '' }, sambar.per100)).toBe(false);
    expect(per100Equals({ ...filled, sugar: '1' }, sambar.per100)).toBe(false);
    expect(per100Equals({ ...filled, protein: 'abc' }, sambar.per100)).toBe(false);
  });
  it('marks the API input as estimated only when asked', () => {
    const base = { ...filled, name: 'Sambar' };
    expect(toFoodInput(base).estimated).toBe(false);
    expect(toFoodInput(base, { estimated: true })).toMatchObject({
      estimated: true,
      per100: sambar.per100,
      portions: [{ label: '1 bowl', amount: 200 }],
    });
  });
});
