import { isValidDayKey, type Weight } from '@plate/shared';
import type { WeightLogMode } from './WeightLogSheet';

/**
 * What the `?log=` URL state opens: `new` (or nothing) → a fresh weigh-in for today; a day that has
 * a weigh-in → editing it; another valid day → a new weigh-in for that day. Anything that is not a
 * calendar date falls back to today rather than filling the form with the bad value.
 */
export function resolveLogMode(logParam: string | null, entries: readonly Weight[]): WeightLogMode {
  if (logParam === null || logParam === 'new' || !isValidDayKey(logParam)) return { kind: 'new' };
  const existing = entries.find((w) => w.day === logParam);
  return existing ? { kind: 'edit', weight: existing } : { kind: 'new', day: logParam };
}
