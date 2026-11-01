/**
 * Small typo-tolerant search for a few thousand short strings (food names). No dependency: we
 * need prefix, word-prefix, substring and single-typo matching, and nothing else.
 */

export interface Searchable {
  /** Primary text, weighted highest. */
  primary: string;
  /** Secondary text (e.g. brand), weighted lower. */
  secondary?: string | null;
}

export interface ScoredMatch<T> {
  item: T;
  score: number;
}

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Damerau-Levenshtein distance with early exit once the limit is exceeded. */
export function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const prev2: number[] = new Array<number>(cols).fill(0);
  let prev: number[] = Array.from({ length: cols }, (_, j) => j);
  let curr: number[] = new Array<number>(cols).fill(0);
  for (let i = 1; i < rows; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prev2[j - 2]! + 1);
      }
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > limit) return limit + 1;
    for (let j = 0; j < cols; j++) prev2[j] = prev[j]!;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[cols - 1]!;
}

function scoreText(text: string, term: string): number {
  if (text === '') return 0;
  if (text === term) return 100;
  if (text.startsWith(term)) return 90;
  const words = text.split(' ');
  if (words.some((w) => w.startsWith(term))) return 80;
  if (text.includes(term)) return 60;
  // Typo tolerance: one edit for terms of 4+ chars, two for 8+, against each word and the whole.
  const allowed = term.length >= 8 ? 2 : term.length >= 4 ? 1 : 0;
  if (allowed === 0) return 0;
  for (const candidate of [text, ...words]) {
    const d = editDistance(
      candidate.slice(0, Math.max(term.length, candidate.length)),
      term,
      allowed,
    );
    if (d <= allowed) return 50 - d * 10;
    // Prefix with typo: compare against the same-length prefix of each word.
    if (candidate.length > term.length) {
      const dp = editDistance(candidate.slice(0, term.length), term, allowed);
      if (dp <= allowed) return 45 - dp * 10;
    }
  }
  return 0;
}

/**
 * Ranks items against a query. Multi-word queries require every word to match somewhere.
 * Returns only matches, best first; ties keep the input order (so pass a sensibly sorted list).
 */
export function searchItems<T>(
  items: readonly T[],
  query: string,
  toSearchable: (item: T) => Searchable,
): ScoredMatch<T>[] {
  const terms = normalize(query).split(' ').filter(Boolean);
  if (terms.length === 0) return items.map((item) => ({ item, score: 0 }));

  const out: ScoredMatch<T>[] = [];
  for (const item of items) {
    const s = toSearchable(item);
    const primary = normalize(s.primary);
    const secondary = s.secondary ? normalize(s.secondary) : '';
    let total = 0;
    let matched = true;
    for (const term of terms) {
      const best = Math.max(scoreText(primary, term), scoreText(secondary, term) * 0.7);
      if (best === 0) {
        matched = false;
        break;
      }
      total += best;
    }
    if (matched) out.push({ item, score: total / terms.length });
  }
  return out.sort((a, b) => b.score - a.score);
}
