import { describe, expect, it } from 'vitest';
import { shiftDayKey } from './days.js';
import type { DayStatus } from './goals.js';
import {
  computeStreaks,
  insightsRangeSchema,
  insightsSummaryQuerySchema,
  isLoggedStatus,
  isOnTargetStatus,
  summarize,
  weeklyIntake,
  type DailyAggregate,
} from './insights.js';

const TODAY = '2025-10-19';
const START = '2025-10-13';
const day = (i: number) => shiftDayKey(START, i);

function row(
  day: string,
  status: DayStatus,
  kcal = 0,
  goalKcal: number | null = 2000,
  macros = { protein: 0, carbs: 0, fat: 0 },
): DailyAggregate {
  const logged = status !== 'not_logged';
  return {
    day,
    entryCount: logged ? 3 : 0,
    totals: {
      kcal: logged ? kcal : 0,
      protein: logged ? macros.protein : 0,
      carbs: logged ? macros.carbs : 0,
      fat: logged ? macros.fat : 0,
      fiber: null,
      sugar: null,
      saturatedFat: null,
      sodiumMg: null,
    },
    goalKcal: status === 'no_goal' ? null : goalKcal,
    status,
  };
}

/** Seven days from 13 Oct with the given statuses (index 6 is `TODAY`). */
const week = (statuses: readonly DayStatus[]) => statuses.map((s, i) => row(day(i), s, 1900));

describe('computeStreaks', () => {
  const ON: DayStatus = 'on_target';
  const NO: DayStatus = 'not_logged';

  it('keeps the streak when today is not logged yet (counts from yesterday)', () => {
    const daily = week([ON, ON, ON, ON, ON, ON, NO]);
    expect(computeStreaks(daily, TODAY, isLoggedStatus)).toEqual({ current: 6, best: 6 });
  });

  it('counts today once it is logged', () => {
    const daily = week([ON, ON, ON, ON, ON, ON, ON]);
    expect(computeStreaks(daily, TODAY, isLoggedStatus)).toEqual({ current: 7, best: 7 });
  });

  it('breaks on a gap and keeps the best run inside the range', () => {
    expect(computeStreaks(week([ON, ON, NO, ON, ON, ON, ON]), TODAY, isLoggedStatus)).toEqual({
      current: 4,
      best: 4,
    });
    expect(computeStreaks(week([ON, ON, ON, ON, NO, ON, ON]), TODAY, isLoggedStatus)).toEqual({
      current: 2,
      best: 4,
    });
    // Yesterday and today both empty: nothing is current, the run before still counts as best.
    expect(computeStreaks(week([ON, ON, ON, ON, ON, NO, NO]), TODAY, isLoggedStatus)).toEqual({
      current: 0,
      best: 5,
    });
  });

  it('ignores days after today', () => {
    const daily = week([NO, ON, ON, NO, NO, ON, ON]);
    // Today is the 15th: only the 13th–15th count; the run on the 18th–19th has not happened.
    expect(computeStreaks(daily, day(2), isLoggedStatus)).toEqual({ current: 2, best: 2 });
  });

  it('is current when the range ends yesterday, but not when it ends earlier', () => {
    const daily = week([ON, ON, ON, ON, ON, ON, ON]);
    expect(computeStreaks(daily, shiftDayKey(TODAY, 1), isLoggedStatus)).toEqual({
      current: 7,
      best: 7,
    });
    expect(computeStreaks(daily, shiftDayKey(TODAY, 2), isLoggedStatus)).toEqual({
      current: 0,
      best: 7,
    });
  });

  it('judges the on-target streak with its own predicate', () => {
    const daily = week(['under', ON, ON, 'over', ON, ON, 'under']);
    // Today is "under" so far: provisional, the run ending yesterday stands.
    expect(computeStreaks(daily, TODAY, isOnTargetStatus)).toEqual({ current: 2, best: 2 });
    expect(
      computeStreaks(week(['no_goal', ON, 'no_goal', ON, ON, ON, ON]), TODAY, isOnTargetStatus),
    ).toEqual({ current: 4, best: 4 });
  });

  it('is all zeros for an empty range', () => {
    expect(computeStreaks([], TODAY, isLoggedStatus)).toEqual({ current: 0, best: 0 });
  });

  it('treats a missing day between rows as a gap', () => {
    const sparse = [row(day(0), ON), row(day(1), ON), row(day(3), ON), row(day(4), ON)];
    expect(computeStreaks(sparse, day(4), isLoggedStatus)).toEqual({ current: 2, best: 2 });
  });
});

describe('summarize', () => {
  const macros = (protein: number, carbs: number, fat: number) => ({ protein, carbs, fat });
  const daily: DailyAggregate[] = [
    row(day(0), 'on_target', 1900, 2000, macros(120, 200, 60)),
    row(day(1), 'under', 1500, 2000, macros(100, 150, 50)),
    row(day(2), 'not_logged'),
    row(day(3), 'over', 2500, 2000, macros(150, 280, 80)),
    row(day(4), 'on_target', 2050, 2000, macros(130, 220, 65)),
    row(day(5), 'no_goal', 1800, null, macros(110, 190, 55)),
    row(day(6), 'not_logged'),
  ];

  it('averages over logged days and judges adherence against logged days with a goal', () => {
    const s = summarize(daily, TODAY);
    expect(s).toMatchObject({
      daysInRange: 7,
      daysElapsed: 7,
      daysLogged: 5,
      daysWithGoal: 4,
      daysOnTarget: 2,
      adherencePct: 50,
    });
    expect(s.avgKcal).toBeCloseTo((1900 + 1500 + 2500 + 2050 + 1800) / 5);
    expect(s.avgProtein).toBeCloseTo((120 + 100 + 150 + 130 + 110) / 5);
    expect(s.avgCarbs).toBeCloseTo((200 + 150 + 280 + 220 + 190) / 5);
    expect(s.avgFat).toBeCloseTo((60 + 50 + 80 + 65 + 55) / 5);
    expect(s.loggingStreak).toEqual({ current: 3, best: 3 });
    expect(s.onTargetStreak).toEqual({ current: 0, best: 1 });
  });

  it('counts only the days that have happened as elapsed', () => {
    expect(summarize(daily, day(2)).daysElapsed).toBe(3);
    expect(summarize(daily, '2025-01-01').daysElapsed).toBe(0);
  });

  it('is all nulls and zeros when nothing was logged', () => {
    const s = summarize(week(['not_logged', 'not_logged', 'not_logged']), TODAY);
    expect(s).toEqual({
      daysInRange: 3,
      daysElapsed: 3,
      daysLogged: 0,
      daysWithGoal: 0,
      daysOnTarget: 0,
      adherencePct: null,
      avgKcal: null,
      avgProtein: null,
      avgCarbs: null,
      avgFat: null,
      loggingStreak: { current: 0, best: 0 },
      onTargetStreak: { current: 0, best: 0 },
    });
  });

  it('has a null adherence when the logged days had no goal', () => {
    const s = summarize(week(['no_goal', 'no_goal', 'not_logged']), TODAY);
    expect(s.daysLogged).toBe(2);
    expect(s.daysWithGoal).toBe(0);
    expect(s.adherencePct).toBeNull();
    expect(s.avgKcal).toBe(1900);
  });
});

describe('weeklyIntake', () => {
  // Monday 6 Oct to Sunday 19 Oct 2025: two whole Monday-aligned weeks.
  const fortnight: DailyAggregate[] = Array.from({ length: 14 }, (_, i) => {
    const d = shiftDayKey('2025-10-06', i);
    const unlogged = i === 2 || i === 9;
    const goal = d >= '2025-10-12' ? 1500 : 2000;
    return row(d, unlogged ? 'not_logged' : 'on_target', 1000 + i * 100, goal, {
      protein: 100 + i,
      carbs: 200,
      fat: 50,
    });
  });

  it('buckets by Monday weeks, averaging over logged days only', () => {
    const weeks = weeklyIntake(fortnight, 'monday');
    expect(weeks.map((w) => [w.weekStart, w.from, w.to, w.days, w.loggedDays])).toEqual([
      ['2025-10-06', '2025-10-06', '2025-10-12', 7, 6],
      ['2025-10-13', '2025-10-13', '2025-10-19', 7, 6],
    ]);
    // Week 1 kcal: 1000,1100,(1200 skipped),1300,1400,1500,1600 → 7900 / 6.
    expect(weeks[0]!.avgKcal).toBeCloseTo(7900 / 6);
    expect(weeks[0]!.avgProtein).toBeCloseTo((100 + 101 + 103 + 104 + 105 + 106) / 6);
    expect(weeks[0]!.avgCarbs).toBe(200);
    expect(weeks[0]!.avgFat).toBe(50);
    // The goal of the last covered day (Sunday 12 Oct already has the 1,500 goal).
    expect(weeks[0]!.goalKcal).toBe(1500);
    expect(weeks[1]!.goalKcal).toBe(1500);
  });

  it('clips to the range with a Sunday week start', () => {
    const weeks = weeklyIntake(fortnight, 'sunday');
    expect(weeks.map((w) => [w.weekStart, w.from, w.to, w.days])).toEqual([
      ['2025-10-05', '2025-10-06', '2025-10-11', 6],
      ['2025-10-12', '2025-10-12', '2025-10-18', 7],
      ['2025-10-19', '2025-10-19', '2025-10-19', 1],
    ]);
    expect(weeks[0]!.goalKcal).toBe(2000);
    expect(weeks[2]!.avgKcal).toBe(2300);
  });

  it('yields null averages for a week without logged days and nothing for no days', () => {
    const empty = weeklyIntake(week(['not_logged', 'not_logged', 'not_logged']), 'monday');
    expect(empty).toHaveLength(1);
    expect(empty[0]).toMatchObject({ loggedDays: 0, avgKcal: null, avgProtein: null });
    expect(weeklyIntake([], 'monday')).toEqual([]);
  });

  it('accepts rows in any order', () => {
    const shuffled = [...fortnight].reverse();
    expect(weeklyIntake(shuffled, 'monday')).toEqual(weeklyIntake(fortnight, 'monday'));
  });
});

describe('range schemas', () => {
  const pathsOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
    result.success ? [] : result.error!.issues.map((i) => i.path.join('.'));

  it('rejects an inverted range on "to"', () => {
    const result = insightsRangeSchema.safeParse({ from: '2025-10-19', to: '2025-10-18' });
    expect(result.success).toBe(false);
    expect(pathsOf(result)).toEqual(['to']);
  });

  it('accepts exactly two years inclusive and rejects one day more', () => {
    expect(insightsRangeSchema.safeParse({ from: '2024-01-01', to: '2025-12-31' }).success).toBe(
      true,
    );
    const tooLong = insightsRangeSchema.safeParse({ from: '2024-01-01', to: '2026-01-01' });
    expect(tooLong.success).toBe(false);
    expect(pathsOf(tooLong)).toEqual(['to']);
    expect(insightsRangeSchema.safeParse({ from: '2025-10-19', to: '2025-10-19' }).success).toBe(
      true,
    );
  });

  it('rejects impossible day keys on their own path', () => {
    const bad = insightsRangeSchema.safeParse({ from: '2025-02-30', to: '2025-03-01' });
    expect(pathsOf(bad)).toEqual(['from']);
  });

  it('shares the checks with the summary query and validates "today"', () => {
    expect(
      insightsSummaryQuerySchema.safeParse({ from: '2025-10-13', to: '2025-10-19' }).success,
    ).toBe(true);
    const inverted = insightsSummaryQuerySchema.safeParse({
      from: '2025-10-19',
      to: '2025-10-13',
      today: '2025-10-19',
    });
    expect(pathsOf(inverted)).toEqual(['to']);
    const badToday = insightsSummaryQuerySchema.safeParse({
      from: '2025-10-13',
      to: '2025-10-19',
      today: 'yesterday',
    });
    expect(pathsOf(badToday)).toEqual(['today']);
  });
});
