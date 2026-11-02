import { describe, expect, it } from 'vitest';
import { isOffBarcode, offCodeSchema, offSearchQuerySchema } from './off.js';

describe('isOffBarcode', () => {
  it('accepts EAN-8 to GTIN-14 digit strings, trimming whitespace', () => {
    expect(isOffBarcode('5000159484695')).toBe(true);
    expect(isOffBarcode(' 5000159484695 ')).toBe(true);
    expect(isOffBarcode('12345678')).toBe(true);
  });
  it('rejects short digit runs and text', () => {
    expect(isOffBarcode('12345')).toBe(false);
    expect(isOffBarcode('oat')).toBe(false);
    expect(isOffBarcode('123456789012345')).toBe(false);
  });
});

describe('offCodeSchema', () => {
  it('accepts digit codes from 4 characters and trims', () => {
    expect(offCodeSchema.parse('1234')).toBe('1234');
    expect(offCodeSchema.parse(' 5000159484695 ')).toBe('5000159484695');
  });
  it('rejects letters and too-short codes', () => {
    expect(offCodeSchema.safeParse('abc').success).toBe(false);
    expect(offCodeSchema.safeParse('123').success).toBe(false);
    expect(offCodeSchema.safeParse('../x').success).toBe(false);
  });
});

describe('offSearchQuerySchema', () => {
  it('trims the query', () => {
    expect(offSearchQuerySchema.parse({ q: '  oat milk ' })).toEqual({ q: 'oat milk' });
  });
  it('rejects a one-character query', () => {
    const r = offSearchQuerySchema.safeParse({ q: 'o' });
    expect(r.success).toBe(false);
    expect(offSearchQuerySchema.safeParse({ q: ' o ' }).success).toBe(false);
  });
});
