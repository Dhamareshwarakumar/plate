import { describe, expect, it } from 'vitest';
import { editDistance, normalize, searchItems } from './search';

const foods = [
  { name: 'Banana', brand: null },
  { name: 'Brown rice', brand: null },
  { name: 'Peanut butter', brand: 'Skippy' },
  { name: 'Greek yogurt', brand: 'Fage' },
  { name: 'Basmati rice', brand: null },
  { name: 'Chicken breast', brand: null },
];
const search = (q: string) =>
  searchItems(foods, q, (f) => ({ primary: f.name, secondary: f.brand })).map((m) => m.item.name);

describe('normalize', () => {
  it('lowercases, strips accents and punctuation', () => {
    expect(normalize('  Crème   Brûlée, (large)! ')).toBe('creme brulee large');
  });
});

describe('editDistance', () => {
  it('counts substitutions, insertions, deletions and transpositions', () => {
    expect(editDistance('banana', 'banana', 2)).toBe(0);
    expect(editDistance('banana', 'bananna', 2)).toBe(1);
    expect(editDistance('banana', 'bnaana', 2)).toBe(1);
    expect(editDistance('rice', 'mice', 2)).toBe(1);
  });
  it('bails out past the limit', () => {
    expect(editDistance('banana', 'chicken', 1)).toBe(2);
  });
});

describe('searchItems', () => {
  it('returns everything in order for an empty query', () => {
    expect(search('')).toHaveLength(foods.length);
  });
  it('ranks prefix matches above substring matches', () => {
    expect(search('rice')).toEqual(['Brown rice', 'Basmati rice']);
    expect(search('ba')[0]).toBe('Banana');
  });
  it('tolerates a typo', () => {
    expect(search('bananna')).toEqual(['Banana']);
    expect(search('yogurt')).toEqual(['Greek yogurt']);
    expect(search('chiken')).toEqual(['Chicken breast']);
  });
  it('matches on brand with a lower weight', () => {
    expect(search('skippy')).toEqual(['Peanut butter']);
    expect(search('fage')).toEqual(['Greek yogurt']);
  });
  it('requires every word of a multi-word query', () => {
    expect(search('brown rice')).toEqual(['Brown rice']);
    expect(search('rice brown')).toEqual(['Brown rice']);
    expect(search('rice chicken')).toEqual([]);
  });
});
