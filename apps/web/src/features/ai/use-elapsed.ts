import { useEffect, useState } from 'react';

/**
 * Whole seconds since `startedAt` (a `Date.now()` the caller stored when it fired the request),
 * ticking once a second while non-null. Powers the "Analysing… 4 s" hint of every AI wait, so a
 * slow provider reads as slow rather than stuck.
 */
export function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (startedAt === null) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
