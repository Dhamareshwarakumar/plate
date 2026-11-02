import type { DailyAggregate } from '@plate/shared';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shiftDay } from '@/lib/dates';
import { CaloriesChart } from './CaloriesChart';

const WIDTH = 640;
const HEIGHT = 260;

/** jsdom has no layout: give recharts' ResponsiveContainer a fixed box to draw into. */
class FixedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [{ contentRect: { width: WIDTH, height: HEIGHT } } as unknown as ResizeObserverEntry],
      this,
    );
  }
  unobserve() {}
  disconnect() {}
}

function dayRows(from: string, days: number, goalKcal: number | null): DailyAggregate[] {
  return Array.from({ length: days }, (_, i) => ({
    day: shiftDay(from, i),
    entryCount: 1,
    totals: {
      kcal: 1800,
      protein: 100,
      carbs: 200,
      fat: 60,
      fiber: null,
      sugar: null,
      saturatedFat: null,
      sodiumMg: null,
    },
    goalKcal,
    status: goalKcal === null ? 'no_goal' : 'on_target',
  }));
}

const num = (el: Element | null | undefined, attr: string) => {
  const value = el?.getAttribute(attr);
  expect(value, `${attr} attribute`).toBeTruthy();
  return Number(value);
};

function renderWeekly(daily: DailyAggregate[]) {
  return render(
    <CaloriesChart
      daily={daily}
      weekly
      weekStart="monday"
      tolerancePct={10}
      onSelectDay={() => {}}
      onSelectWeek={() => {}}
    />,
  ).container;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FixedResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: WIDTH,
    bottom: HEIGHT,
    width: WIDTH,
    height: HEIGHT,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// 2025-01-01 is a Wednesday: with Monday weeks the first bucket is clipped (weekStart 2024-12-30,
// from 2025-01-01). The band and line reference the week keys, so the axis must be keyed the same
// way or the first run falls outside the domain and recharts draws it from the SVG origin.
describe('CaloriesChart (weekly, clipped first week)', () => {
  it('draws the goal band and line from the first bar to the last, not from the SVG origin', () => {
    const container = renderWeekly(dayRows('2025-01-01', 120, 2000));

    const bars = container.querySelectorAll('.recharts-bar-rectangle path');
    expect(bars).toHaveLength(18);
    const firstBar = bars[0];
    const lastBar = bars[bars.length - 1];
    const plot = container.querySelector('defs clipPath rect');
    const bandRect = container.querySelector('.recharts-reference-area-rect');
    const goalLine = container.querySelector('.recharts-reference-line-line');

    // One goal run covers every week: the band is exactly the plot area behind the bars.
    const bandX = num(bandRect, 'x');
    const bandRight = bandX + num(bandRect, 'width');
    expect(bandX).toBe(num(plot, 'x'));
    expect(bandX).toBeLessThanOrEqual(num(firstBar, 'x'));
    expect(bandRight).toBeGreaterThanOrEqual(num(lastBar, 'x') + num(lastBar, 'width'));
    expect(bandRight).toBeCloseTo(num(plot, 'x') + num(plot, 'width'), 5);
    // The dashed goal line starts where the band starts.
    expect(num(goalLine, 'x1')).toBeCloseTo(bandX, 5);
  });

  it('gives a first week with its own goal a band over its bar instead of collapsing it', () => {
    const container = renderWeekly([
      ...dayRows('2025-01-01', 5, 1800),
      ...dayRows('2025-01-06', 115, 2000),
    ]);
    const bars = container.querySelectorAll('.recharts-bar-rectangle path');
    const bands = container.querySelectorAll('.recharts-reference-area-rect');
    expect(bands).toHaveLength(2);
    const [first, second] = bands;
    const firstX = num(first, 'x');
    const firstRight = firstX + num(first, 'width');
    expect(firstX).toBe(num(container.querySelector('defs clipPath rect'), 'x'));
    expect(firstRight).toBeGreaterThanOrEqual(num(bars[0], 'x') + num(bars[0], 'width'));
    expect(firstRight).toBeLessThanOrEqual(num(bars[1], 'x'));
    expect(num(second, 'x')).toBeCloseTo(firstRight, 5);
  });
});
