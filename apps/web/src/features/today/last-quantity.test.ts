import { beforeEach, describe, expect, it } from 'vitest';
import { readLastQuantity, writeLastQuantity } from './last-quantity';

beforeEach(() => localStorage.clear());

describe('last quantity per food', () => {
  it('round-trips through localStorage, keyed by food id', () => {
    expect(readLastQuantity(7)).toBeNull();
    writeLastQuantity(7, { quantity: 236, portionLabel: '1 medium', portionCount: 2 });
    expect(readLastQuantity(7)).toEqual({
      quantity: 236,
      portionLabel: '1 medium',
      portionCount: 2,
    });
    expect(readLastQuantity(8)).toBeNull();
    writeLastQuantity(7, { quantity: 450, portionLabel: null, portionCount: null });
    expect(readLastQuantity(7)?.quantity).toBe(450);
  });

  it('ignores corrupt or foreign values', () => {
    localStorage.setItem('plate.lastQuantity.9', '{not json');
    expect(readLastQuantity(9)).toBeNull();
    localStorage.setItem('plate.lastQuantity.9', JSON.stringify({ quantity: -1 }));
    expect(readLastQuantity(9)).toBeNull();
  });
});
