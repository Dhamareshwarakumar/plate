import { describe, expect, it } from 'vitest';
import {
  ESTIMATE_FOOD_SYSTEM,
  LIBRARY_FUZZY_MAX,
  LIBRARY_INDEX_HEADER,
  LIBRARY_INDEX_MAX,
  LIBRARY_RECENT_MAX,
  PARSE_MEAL_SYSTEM,
  PARSE_RECIPE_SYSTEM,
  WEEKLY_DIGEST_SYSTEM,
  buildEstimateFoodPrompt,
  buildParseMealPrompt,
  buildParseRecipePrompt,
  buildWeeklyDigestPrompt,
  formatLibraryIndex,
  invalidResponseFollowUp,
  searchTokens,
  selectLibraryRows,
  truncateText,
  type LibraryIndexRow,
} from './ai-prompts.js';
import { AI_RECIPE_TEXT_MAX, AI_TEXT_MAX } from './ai.js';
import type { BySlot, DailyAggregate, InsightsSummary, TopFood } from './insights.js';

const row = (id: number, name: string, extra: Partial<LibraryIndexRow> = {}): LibraryIndexRow => ({
  id,
  name,
  brand: null,
  basis: 'g',
  kcal: 100,
  kind: 'food',
  ...extra,
});

const bigLibrary = (count: number): LibraryIndexRow[] =>
  Array.from({ length: count }, (_, i) => row(i + 1, `Food ${i + 1}`));

describe('formatLibraryIndex', () => {
  it('writes the header and one row per food, with - for a missing brand and whole kcal', () => {
    const text = formatLibraryIndex([
      row(1, 'Banana', { kcal: 88.6 }),
      row(2, 'Oat milk', { brand: 'Oatly', basis: 'ml', kcal: 46 }),
    ]);
    expect(text.split('\n')).toEqual([
      'id | name | brand | basis | kcal/100',
      '1 | Banana | - | g | 89',
      '2 | Oat milk | Oatly | ml | 46',
    ]);
    expect(LIBRARY_INDEX_HEADER).toBe('id | name | brand | basis | kcal/100');
  });

  it('keeps names and brands on one line without pipes', () => {
    const text = formatLibraryIndex([row(7, 'Dal | tadka\nhomemade', { brand: 'A|B' })]);
    expect(text.split('\n')[1]).toBe('7 | Dal tadka homemade | A B | g | 100');
  });

  it('marks an empty library', () => {
    expect(formatLibraryIndex([])).toBe('id | name | brand | basis | kcal/100\n(empty library)');
  });
});

describe('searchTokens', () => {
  it('lower-cases, drops short and stop words and stems plurals', () => {
    expect(searchTokens('2 Rotis, a bowl of dal and one Banana')).toEqual([
      'roti',
      'dal',
      'banana',
    ]);
    expect(searchTokens('eggs with toast')).toEqual(['egg', 'toast']);
    expect(searchTokens(null)).toEqual([]);
    expect(searchTokens('a of 12')).toEqual([]);
  });

  it('does not stem three-letter words or repeat tokens', () => {
    expect(searchTokens('gas gas peas')).toEqual(['gas', 'pea']);
  });
});

describe('selectLibraryRows', () => {
  it('returns every row while the library fits', () => {
    const rows = bigLibrary(LIBRARY_INDEX_MAX);
    const picked = selectLibraryRows(rows, [5, 4], '2 rotis and dal');
    expect(picked).toHaveLength(LIBRARY_INDEX_MAX);
    expect(picked).toEqual(rows);
    expect(picked).not.toBe(rows);
  });

  it('over the cap keeps the recent rows in order plus the rows matching the request', () => {
    const rows = [
      ...bigLibrary(1600),
      row(2001, 'Roti (whole wheat)'),
      row(2002, 'Dal tadka', { kind: 'dish' }),
      row(2003, 'Sandalwood tea'),
      row(2004, 'Masala dosa'),
    ];
    const recentIds = Array.from({ length: 350 }, (_, i) => 1600 - i); // 1600, 1599, … 1251
    const picked = selectLibraryRows(rows, recentIds, '2 rotis and dal');
    const ids = picked.map((r) => r.id);
    expect(ids.slice(0, LIBRARY_RECENT_MAX)).toEqual(recentIds.slice(0, LIBRARY_RECENT_MAX));
    expect(ids.slice(LIBRARY_RECENT_MAX)).toEqual([2001, 2002, 2003]);
    expect(ids).not.toContain(2004);
    expect(picked.length).toBeLessThanOrEqual(LIBRARY_INDEX_MAX);
  });

  it('ignores recent ids that are not in the library and skips duplicates', () => {
    const rows = bigLibrary(1501);
    const picked = selectLibraryRows(rows, [99999, 3, 3, 1], null);
    expect(picked.map((r) => r.id)).toEqual([3, 1]);
  });

  it('prefers rows matching more words and caps the matches', () => {
    const rows = [
      ...bigLibrary(1500),
      ...Array.from({ length: 250 }, (_, i) => row(5000 + i, `Dal variant ${i}`)),
      row(9000, 'Roti and dal thali'),
    ];
    const picked = selectLibraryRows(rows, [], 'roti dal');
    expect(picked[0]?.id).toBe(9000);
    expect(picked).toHaveLength(LIBRARY_FUZZY_MAX);
  });

  it('without recent ids or text an oversized library yields no rows', () => {
    expect(selectLibraryRows(bigLibrary(1501), [], null)).toEqual([]);
  });
});

describe('truncateText', () => {
  it('trims and leaves short text alone', () => {
    expect(truncateText('  dal  ', 10)).toBe('dal');
    expect(truncateText('abcd', 4)).toBe('abcd');
  });

  it('cuts to the maximum including the ellipsis', () => {
    expect(truncateText('abcdef', 4)).toBe('abc…');
    expect(truncateText('x'.repeat(5000), AI_TEXT_MAX)).toHaveLength(AI_TEXT_MAX);
    expect(truncateText('x'.repeat(5000), AI_TEXT_MAX).endsWith('…')).toBe(true);
  });

  it('never splits a surrogate pair', () => {
    expect(truncateText('ab😀cd', 4)).toBe('ab…');
    expect(truncateText('ab😀cd', 5)).toBe('ab😀…');
  });
});

describe('invalidResponseFollowUp', () => {
  it('embeds the issues and asks for JSON again', () => {
    const text = invalidResponseFollowUp('items.0.quantity: Too small; notes: Expected string');
    expect(text).toContain('items.0.quantity: Too small; notes: Expected string');
    expect(text).toMatch(/^Your previous answer did not match the required JSON schema: /);
    expect(text).toMatch(/JSON only, following the schema exactly\.$/);
  });
});

describe('system prompts', () => {
  it('state the role, confirm-first and JSON-only rules', () => {
    for (const system of [
      PARSE_MEAL_SYSTEM,
      ESTIMATE_FOOD_SYSTEM,
      PARSE_RECIPE_SYSTEM,
      WEEKLY_DIGEST_SYSTEM,
    ]) {
      expect(system).toContain('personal diet ledger');
      expect(system).toContain('the user reviews and edits every value before anything is written');
      expect(system).toContain('No prose, no markdown');
      expect(system).toContain('South Asian home cooking');
    }
  });

  it('explain library matching and the suggested food shape where they apply', () => {
    for (const system of [PARSE_MEAL_SYSTEM, PARSE_RECIPE_SYSTEM]) {
      expect(system).toContain('matchedFoodId');
      expect(system).toContain('brand is always null');
      expect(system).toContain('1 to 3 typical portions');
      expect(system).toContain('Never invent ids');
    }
    expect(PARSE_MEAL_SYSTEM).toContain('confidence');
    expect(PARSE_MEAL_SYSTEM).toContain('notes');
    expect(ESTIMATE_FOOD_SYSTEM).toContain('rationale: at most 300 characters');
    expect(ESTIMATE_FOOD_SYSTEM).toContain('"ml" for liquids');
    expect(PARSE_RECIPE_SYSTEM).toContain('1 cup flour ≈ 120 g');
    expect(PARSE_RECIPE_SYSTEM).toContain('cookedWeight');
    expect(PARSE_RECIPE_SYSTEM).toContain('servings');
    expect(WEEKLY_DIGEST_SYSTEM).toContain('3 to 5 short plain-text sentences');
    expect(WEEKLY_DIGEST_SYSTEM).toContain('No medical advice');
    expect(WEEKLY_DIGEST_SYSTEM).toContain('next week');
  });
});

describe('buildParseMealPrompt', () => {
  const library = [row(1, 'Dal', { kcal: 116 }), row(2, 'Banana', { kcal: 89 })];

  it('puts the meal context, the text and the index in the user turn', () => {
    const prompt = buildParseMealPrompt({
      text: '2 rotis, a bowl of dal and a banana',
      hasImage: false,
      day: '2026-11-02',
      slotName: 'Dinner',
      library,
    });
    expect(prompt.system).toBe(PARSE_MEAL_SYSTEM);
    expect(prompt.text).toContain('Meal: Dinner on 2026-11-02');
    expect(prompt.text).toContain('Description:\n2 rotis, a bowl of dal and a banana');
    expect(prompt.text).toContain(`Library index:\n${LIBRARY_INDEX_HEADER}\n1 | Dal | - | g | 116`);
    expect(prompt.text).not.toContain('photo');
  });

  it('points at the photo when there is no text, and mentions it next to text', () => {
    const photoOnly = buildParseMealPrompt({
      text: null,
      hasImage: true,
      day: '2026-11-02',
      slotName: 'Lunch',
      library: [],
    });
    expect(photoOnly.text).toContain('Description: (see the attached photo)');
    expect(photoOnly.text).toContain('(empty library)');
    const both = buildParseMealPrompt({
      text: 'thali',
      hasImage: true,
      day: '2026-11-02',
      slotName: 'Lunch',
      library,
    });
    expect(both.text).toContain('Description:\nthali');
    expect(both.text).toContain('(a photo of the meal is attached)');
  });

  it('truncates the text to the request limit', () => {
    const prompt = buildParseMealPrompt({
      text: 'y'.repeat(AI_TEXT_MAX + 500),
      hasImage: false,
      day: '2026-11-02',
      slotName: 'Dinner',
      library,
    });
    expect(prompt.text).toContain(`${'y'.repeat(AI_TEXT_MAX - 1)}…`);
    expect(prompt.text).not.toContain('y'.repeat(AI_TEXT_MAX));
  });
});

describe('buildEstimateFoodPrompt', () => {
  it('lists name, brand and hint, skipping what is missing', () => {
    expect(
      buildEstimateFoodPrompt({
        name: 'Sambar',
        brand: null,
        description: 'homemade, with drumstick',
      }),
    ).toEqual({
      system: ESTIMATE_FOOD_SYSTEM,
      text: 'Food: Sambar\nHint: homemade, with drumstick',
    });
    expect(
      buildEstimateFoodPrompt({ name: 'Oat milk', brand: 'Oatly', description: null }).text,
    ).toBe('Food: Oat milk\nBrand: Oatly');
  });
});

describe('buildParseRecipePrompt', () => {
  it('puts the recipe and the index in the user turn, truncating the recipe', () => {
    const prompt = buildParseRecipePrompt({
      text: '200 g red lentils\n1 tbsp ghee\n1 onion',
      library: [row(1, 'Red lentils', { kcal: 352 })],
    });
    expect(prompt.system).toBe(PARSE_RECIPE_SYSTEM);
    expect(prompt.text).toContain('Recipe:\n200 g red lentils\n1 tbsp ghee\n1 onion');
    expect(prompt.text).toContain(
      `Library index:\n${LIBRARY_INDEX_HEADER}\n1 | Red lentils | - | g | 352`,
    );
    const long = buildParseRecipePrompt({ text: 'z'.repeat(AI_RECIPE_TEXT_MAX + 1), library: [] });
    expect(long.text).toContain(`${'z'.repeat(AI_RECIPE_TEXT_MAX - 1)}…`);
    expect(long.text).not.toContain('z'.repeat(AI_RECIPE_TEXT_MAX));
  });
});

describe('buildWeeklyDigestPrompt', () => {
  const totals = (kcal: number, protein: number, carbs: number, fat: number) => ({
    kcal,
    protein,
    carbs,
    fat,
    fiber: null,
    sugar: null,
    saturatedFat: null,
    sodiumMg: null,
  });
  const day = (
    date: string,
    kcal: number,
    status: DailyAggregate['status'],
    goalKcal: number | null = 2000,
  ): DailyAggregate => ({
    day: date,
    entryCount: status === 'not_logged' ? 0 : 3,
    totals: status === 'not_logged' ? totals(0, 0, 0, 0) : totals(kcal, 118.4, 190.2, 61.6),
    goalKcal,
    status,
  });
  // 2026-10-26 is a Monday.
  const daily = [
    day('2026-10-26', 1820, 'on_target'),
    day('2026-10-27', 0, 'not_logged'),
    day('2026-10-28', 2350, 'over'),
    day('2026-10-29', 1600, 'under'),
    day('2026-10-30', 1900, 'no_goal', null),
    day('2026-10-31', 0, 'not_logged'),
    day('2026-11-01', 1630, 'under'),
  ];
  const summary: InsightsSummary = {
    daysInRange: 7,
    daysElapsed: 7,
    daysLogged: 5,
    daysWithGoal: 4,
    daysOnTarget: 1,
    adherencePct: 25,
    avgKcal: 1860,
    avgProtein: 118.4,
    avgCarbs: 190.2,
    avgFat: 61.6,
    loggingStreak: { current: 1, best: 3 },
    onTargetStreak: { current: 0, best: 1 },
  };
  const bySlot: BySlot = {
    loggedDays: 5,
    slots: [
      {
        slotId: 1,
        name: 'Breakfast',
        archived: false,
        entryCount: 5,
        days: 5,
        totalKcal: 2100,
        avgKcal: 420,
      },
      {
        slotId: 2,
        name: 'Lunch',
        archived: false,
        entryCount: 6,
        days: 4,
        totalKcal: 3050,
        avgKcal: 610,
      },
      {
        slotId: 3,
        name: 'Snack',
        archived: false,
        entryCount: 0,
        days: 0,
        totalKcal: 0,
        avgKcal: 0,
      },
    ],
  };
  const topFoods: TopFood[] = [
    { foodId: 1, kind: 'food', name: 'Oats', count: 5, kcal: 1900 },
    { foodId: 2, kind: 'food', name: 'Dal', count: 4, kcal: 930 },
    { foodId: 3, kind: 'dish', name: 'Rajma chawal', count: 2, kcal: 1100 },
    { foodId: 4, kind: 'food', name: 'Banana', count: 2, kcal: 210 },
    { foodId: 5, kind: 'food', name: 'Curd', count: 2, kcal: 200 },
    { foodId: 6, kind: 'food', name: 'Secret sixth food', count: 1, kcal: 10 },
  ];

  it('describes the week with the summary line, one line per logged day, meals and top-5 foods', () => {
    const prompt = buildWeeklyDigestPrompt({
      weekStart: '2026-10-26',
      weekEnd: '2026-11-01',
      summary,
      daily,
      bySlot,
      topFoods,
    });
    expect(prompt.system).toBe(WEEKLY_DIGEST_SYSTEM);
    const lines = prompt.text.split('\n');
    expect(lines[0]).toBe('Week 2026-10-26 to 2026-11-01');
    expect(lines[1]).toBe(
      'Logged days: 5 of 7 · adherence 25% · avg 1860 kcal (P 118 g, C 190 g, F 62 g)',
    );
    expect(lines.filter((l) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) 2026-/.test(l))).toEqual([
      'Mon 2026-10-26: 1820 kcal (P 118 g, C 190 g, F 62 g) · goal 2000 · on_target',
      'Wed 2026-10-28: 2350 kcal (P 118 g, C 190 g, F 62 g) · goal 2000 · over',
      'Thu 2026-10-29: 1600 kcal (P 118 g, C 190 g, F 62 g) · goal 2000 · under',
      'Fri 2026-10-30: 1900 kcal (P 118 g, C 190 g, F 62 g) · no goal · no_goal',
      'Sun 2026-11-01: 1630 kcal (P 118 g, C 190 g, F 62 g) · goal 2000 · under',
    ]);
    expect(lines).toContain('Not logged: Tue, Sat');
    expect(lines).toContain(
      'By meal: Breakfast 420 kcal avg on 5 days, Lunch 610 kcal avg on 4 days',
    );
    expect(lines).toContain('Top foods: Oats ×5, Dal ×4, Rajma chawal ×2, Banana ×2, Curd ×2');
    expect(lines).toContain('Logging streak: 1 day');
    expect(prompt.text).not.toContain('Secret sixth food');
    expect(prompt.text).not.toContain('Snack');
    expect(prompt.text).not.toContain('Week in progress');
  });

  it('describes a week in progress and a week without a goal or any logging', () => {
    const partial = buildWeeklyDigestPrompt({
      weekStart: '2026-10-26',
      weekEnd: '2026-11-01',
      summary: { ...summary, daysElapsed: 3, daysLogged: 2, adherencePct: null },
      daily,
      bySlot,
      topFoods: [],
    });
    expect(partial.text).toContain('Week in progress: 3 of 7 days so far');
    expect(partial.text).toContain('Logged days: 2 of 3 · adherence n/a (no goal) · avg 1860 kcal');
    expect(partial.text).toContain('Not logged: Tue');
    expect(partial.text).not.toContain('Sat');
    expect(partial.text).not.toContain('Top foods');
    const empty = buildWeeklyDigestPrompt({
      weekStart: '2026-10-26',
      weekEnd: '2026-11-01',
      summary: {
        ...summary,
        daysLogged: 0,
        daysWithGoal: 0,
        daysOnTarget: 0,
        adherencePct: null,
        avgKcal: null,
        avgProtein: null,
        avgCarbs: null,
        avgFat: null,
        loggingStreak: { current: 0, best: 0 },
      },
      daily: daily.map((d) => day(d.day, 0, 'not_logged')),
      bySlot: { loggedDays: 0, slots: [] },
      topFoods: [],
    });
    expect(empty.text.split('\n')).toEqual([
      'Week 2026-10-26 to 2026-11-01',
      'Logged days: 0 of 7 · adherence n/a (no goal) · no days logged',
      'Not logged: Mon, Tue, Wed, Thu, Fri, Sat, Sun',
    ]);
  });
});
