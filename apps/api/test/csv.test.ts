import { describe, expect, it } from 'vitest';
import { CsvParseError, csvEscape, parseCsv, toCsvLine } from '../src/foods/csv.js';

describe('parseCsv', () => {
  it('parses a simple file with CRLF and a BOM', () => {
    const r = parseCsv('\uFEFFname,kcal\r\nBanana,89\r\nOats,389\r\n');
    expect(r.header).toEqual(['name', 'kcal']);
    expect(r.rows).toEqual([
      { line: 2, cells: ['Banana', '89'] },
      { line: 3, cells: ['Oats', '389'] },
    ]);
  });

  it('handles quoted fields with commas, quotes and newlines', () => {
    const r = parseCsv('name,note\n"Rice, basmati","He said ""hi""\nand left"\n');
    expect(r.rows[0]?.cells).toEqual(['Rice, basmati', 'He said "hi"\nand left']);
    expect(r.rows[0]?.line).toBe(2);
  });

  it('skips blank lines and keeps line numbers aligned to the source', () => {
    const r = parseCsv('name\n\nA\n\n\nB');
    expect(r.rows).toEqual([
      { line: 3, cells: ['A'] },
      { line: 6, cells: ['B'] },
    ]);
  });

  it('rejects an unterminated quote', () => {
    expect(() => parseCsv('name\n"oops')).toThrow(CsvParseError);
  });

  it('returns empty header for an empty file', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] });
  });
});

describe('csv writing', () => {
  it('escapes only when needed', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(12.5)).toBe('12.5');
  });

  it('round-trips through the parser', () => {
    const line = toCsvLine(['Rice, basmati', 'He said "hi"', 3]);
    const parsed = parseCsv(`a,b,c\n${line}\n`);
    expect(parsed.rows[0]?.cells).toEqual(['Rice, basmati', 'He said "hi"', '3']);
  });
});
