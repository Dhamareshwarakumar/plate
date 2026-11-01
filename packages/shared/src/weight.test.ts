import { describe, expect, it } from 'vitest';
import { shiftDayKey } from './days.js';
import {
  changeOver,
  computeWeightStats,
  movingAverage7,
  projectEta,
  weeklyRate,
  weightBodySchema,
  weightInputSchema,
  weightRangeQuerySchema,
  type Weight,
  type WeightPoint,
} from './weight.js';

const START = '2025-09-01';
const day = (i: number) => shiftDayKey(START, i);

/** 35 daily weigh-ins losing 0.05 kg a day: 80.0 on 1 Sep down to 78.3 on 5 Oct. */
function linearSeries(days = 35, start = 80, slopePerDay = -0.05): Weight[] {
  return Array.from({ length: days }, (_, i) => ({
    id: i + 1,
    day: day(i),
    kg: Math.round((start + slopePerDay * i) * 100) / 100,
    note: null,
    createdAt: '2025-10-05T07:00:00.000Z',
    updatedAt: '2025-10-05T07:00:00.000Z',
  }));
}
const points = (weights: Weight[]): WeightPoint[] => weights.map(({ day, kg }) => ({ day, kg }));

describe('movingAverage7', () => {
  it('averages whatever entries fall in the trailing seven days (gaps allowed)', () => {
    const ma = movingAverage7([
      { day: day(0), kg: 80 },
      { day: day(1), kg: 81 },
      { day: day(2), kg: 82 },
      { day: day(9), kg: 79 },
    ]);
    expect(ma).toEqual([
      { day: day(0), kg: 80 },
      { day: day(1), kg: 80.5 },
      { day: day(2), kg: 81 },
      { day: day(9), kg: 79 },
    ]);
  });

  it('drops the entry exactly seven days back', () => {
    const ma = movingAverage7([
      { day: day(0), kg: 70 },
      { day: day(6), kg: 72 },
      { day: day(7), kg: 74 },
    ]);
    expect(ma[1]!.kg).toBeCloseTo(71);
    expect(ma[2]!.kg).toBeCloseTo(73);
  });

  it('keeps the slope of a linear series once the window is full', () => {
    const ma = movingAverage7(points(linearSeries()));
    expect(ma).toHaveLength(35);
    expect(ma[0]!.kg).toBeCloseTo(80);
    expect(ma[3]!.kg).toBeCloseTo(79.925); // mean of 80 … 79.85
    expect(ma[6]!.kg).toBeCloseTo(79.85); // first full window: mean of 80 … 79.7
    expect(ma[34]!.kg).toBeCloseTo(78.45);
    expect(ma[34]!.kg - ma[27]!.kg).toBeCloseTo(-0.35);
  });

  it('is empty for no points', () => {
    expect(movingAverage7([])).toEqual([]);
  });
});

describe('weeklyRate', () => {
  it('needs at least two points inside the window', () => {
    expect(weeklyRate([])).toBeNull();
    expect(weeklyRate([{ day: day(0), kg: 80 }])).toBeNull();
    // A second point older than 28 days does not count.
    expect(
      weeklyRate([
        { day: day(0), kg: 80 },
        { day: day(40), kg: 78 },
      ]),
    ).toBeNull();
  });

  it('fits the moving average over the last 28 days only', () => {
    const recent = Array.from({ length: 8 }, (_, k) => ({ day: day(40 + k), kg: 80 - 0.1 * k }));
    const withOutlier = [{ day: day(0), kg: 100 }, ...recent];
    expect(weeklyRate(recent)).toBeCloseTo(-0.7);
    expect(weeklyRate(withOutlier)).toBeCloseTo(-0.7);
  });

  it('is −0.35 kg/week for the 0.05 kg/day series', () => {
    expect(weeklyRate(movingAverage7(points(linearSeries())))).toBeCloseTo(-0.35);
  });

  it('is zero for a flat series', () => {
    const flat = Array.from({ length: 10 }, (_, i) => ({ day: day(i), kg: 75 }));
    expect(weeklyRate(flat)).toBeCloseTo(0);
  });
});

describe('projectEta', () => {
  it('counts whole days toward the goal', () => {
    expect(projectEta(78.45, 76, -0.35)).toBe(49);
    expect(projectEta(70, 72, 0.35)).toBe(40);
    expect(projectEta(78.45, 76, -0.3)).toBe(58); // 2.45 / (0.3 / 7) = 57.17 → 58
  });

  it('is null away from the goal, for a flat trend, at the goal or without a rate', () => {
    expect(projectEta(78.45, 85, -0.35)).toBeNull();
    expect(projectEta(70, 65, 0.4)).toBeNull();
    expect(projectEta(78.45, 76, -0.04)).toBeNull();
    expect(projectEta(78.45, 76, 0.049)).toBeNull();
    expect(projectEta(76, 76, -0.35)).toBeNull();
    expect(projectEta(78.45, 76, null)).toBeNull();
  });
});

describe('changeOver', () => {
  const series = points(linearSeries());
  const latest = series[34]!;

  it('uses the entry exactly N days back when it exists', () => {
    expect(changeOver(series, latest, 7)).toBeCloseTo(-0.35);
    expect(changeOver(series, latest, 30)).toBeCloseTo(-1.5);
  });

  it('falls back to the nearest older entry within twice the span', () => {
    const sparse: WeightPoint[] = [
      { day: day(20), kg: 80 },
      { day: day(26), kg: 79 },
      { day: day(34), kg: 78 },
    ];
    // Nothing on day 27 (7 back); day 26 is the next older one and within 14 days.
    expect(changeOver(sparse, sparse[2]!, 7)).toBeCloseTo(-1);
    // 30 back would be day 4; day 20 is 14 days back, too recent, and nothing older exists.
    expect(changeOver(sparse, sparse[2]!, 30)).toBeNull();
  });

  it('refuses an entry older than twice the span', () => {
    const wide: WeightPoint[] = [
      { day: day(0), kg: 80 },
      { day: day(34), kg: 78 },
    ];
    expect(changeOver(wide, wide[1]!, 7)).toBeNull();
    expect(changeOver(wide, wide[1]!, 30)).toBeCloseTo(-2);
  });

  it('is null with a single entry', () => {
    expect(changeOver([latest], latest, 7)).toBeNull();
  });
});

describe('computeWeightStats', () => {
  it('is all empty without weigh-ins', () => {
    expect(computeWeightStats([], null)).toEqual({
      latest: null,
      count: 0,
      change7d: null,
      change30d: null,
      movingAverage: [],
      ratePerWeek: null,
      goalKg: null,
      goalDate: null,
      remaining: null,
      eta: null,
    });
    const withGoal = computeWeightStats([], { goalWeightKg: 74, goalWeightDate: '2026-03-01' });
    expect(withGoal.goalKg).toBe(74);
    expect(withGoal.goalDate).toBe('2026-03-01');
    expect(withGoal.remaining).toBeNull();
    expect(withGoal.eta).toBeNull();
  });

  it('summarises the 35-day series against a goal below it', () => {
    const series = linearSeries();
    // Order of input must not matter.
    const stats = computeWeightStats([...series].reverse(), {
      goalWeightKg: 76,
      goalWeightDate: null,
    });
    expect(stats.latest?.kg).toBe(78.3);
    expect(stats.latest?.day).toBe(day(34));
    expect(stats.count).toBe(35);
    expect(stats.change7d).toBeCloseTo(-0.35);
    expect(stats.change30d).toBeCloseTo(-1.5);
    expect(stats.movingAverage).toHaveLength(35);
    expect(stats.ratePerWeek).toBeCloseTo(-0.35);
    expect(stats.goalKg).toBe(76);
    expect(stats.goalDate).toBeNull();
    expect(stats.remaining).toBeCloseTo(-2.3);
    expect(stats.eta).toBe(shiftDayKey(day(34), 49));
  });

  it('gives no ETA when the trend points away from the goal', () => {
    const stats = computeWeightStats(linearSeries(), { goalWeightKg: 85, goalWeightDate: null });
    expect(stats.remaining).toBeCloseTo(6.7);
    expect(stats.eta).toBeNull();
  });

  it('has no rate or changes with a single weigh-in', () => {
    const stats = computeWeightStats(linearSeries(1), null);
    expect(stats.latest?.kg).toBe(80);
    expect(stats.change7d).toBeNull();
    expect(stats.change30d).toBeNull();
    expect(stats.ratePerWeek).toBeNull();
    expect(stats.movingAverage).toEqual([{ day: day(0), kg: 80 }]);
  });
});

describe('weightInputSchema', () => {
  const path = (input: unknown) =>
    weightInputSchema.safeParse(input).error?.issues.map((i) => i.path.join('.'));

  it('accepts a one-decimal weight and trims the note', () => {
    expect(weightInputSchema.parse({ day: '2025-10-19', kg: 78.4, note: ' post-run ' })).toEqual({
      day: '2025-10-19',
      kg: 78.4,
      note: 'post-run',
    });
    expect(weightInputSchema.parse({ day: '2025-10-19', kg: 78 }).note).toBeNull();
    expect(weightInputSchema.parse({ day: '2025-10-19', kg: 78, note: '' }).note).toBeNull();
  });

  it('enforces the bounds with the offending path', () => {
    expect(path({ day: '2025-10-19', kg: 10 })).toEqual(['kg']);
    expect(path({ day: '2025-10-19', kg: 401 })).toEqual(['kg']);
    expect(path({ day: '2025-10-19', kg: 78.44 })).toEqual(['kg']);
    expect(path({ day: '2025-10-19', kg: 78.4, note: 'x'.repeat(121) })).toEqual(['note']);
    expect(path({ day: '2025-02-30', kg: 78.4 })).toEqual(['day']);
  });

  it('has a body variant without the day', () => {
    expect(weightBodySchema.parse({ kg: 78.4 })).toEqual({ kg: 78.4, note: null });
    expect(weightBodySchema.safeParse({ day: '2025-10-19', kg: 78.4 }).success).toBe(true);
  });
});

describe('weightRangeQuerySchema', () => {
  it('accepts open ranges and rejects an inverted one on "to"', () => {
    expect(weightRangeQuerySchema.parse({})).toEqual({});
    expect(weightRangeQuerySchema.parse({ from: '2025-10-01' })).toEqual({ from: '2025-10-01' });
    const inverted = weightRangeQuerySchema.safeParse({ from: '2025-10-19', to: '2025-10-18' });
    expect(inverted.error?.issues.map((i) => i.path.join('.'))).toEqual(['to']);
  });
});
