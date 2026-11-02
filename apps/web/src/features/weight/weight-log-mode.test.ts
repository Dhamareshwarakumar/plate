import type { Weight } from '@plate/shared';
import { describe, expect, it } from 'vitest';
import { resolveLogMode } from './weight-log-mode';

const logged: Weight = {
  id: 3,
  day: '2025-10-19',
  kg: 78.4,
  note: null,
  createdAt: '2025-10-19T07:00:00.000Z',
  updatedAt: '2025-10-19T07:00:00.000Z',
};

describe('resolveLogMode', () => {
  it('opens a fresh weigh-in for "new" or nothing', () => {
    expect(resolveLogMode(null, [logged])).toEqual({ kind: 'new' });
    expect(resolveLogMode('new', [logged])).toEqual({ kind: 'new' });
  });

  it('edits the weigh-in of a day that has one, and prefills another valid day', () => {
    expect(resolveLogMode('2025-10-19', [logged])).toEqual({ kind: 'edit', weight: logged });
    expect(resolveLogMode('2025-10-18', [logged])).toEqual({ kind: 'new', day: '2025-10-18' });
  });

  it('falls back to today when the parameter is not a calendar date', () => {
    for (const bad of ['yesterday', '2025-02-30', '2025-10-19T07:00', '']) {
      expect(resolveLogMode(bad, [logged]), bad).toEqual({ kind: 'new' });
    }
  });
});
