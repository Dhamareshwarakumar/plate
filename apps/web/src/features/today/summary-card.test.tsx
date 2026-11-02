import type { DiaryDay, Goal } from '@plate/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SummaryCard } from './SummaryCard';

const goal: Goal = {
  id: 1,
  effectiveFrom: '2025-10-01',
  kcal: 2000,
  proteinG: 150,
  carbsG: 200,
  fatG: 70,
  fiberG: null,
  waterMl: null,
  goalWeightKg: null,
  goalWeightDate: null,
  createdAt: '2025-10-01T08:00:00.000Z',
};

function day(overrides: Partial<DiaryDay> = {}): DiaryDay {
  return {
    day: '2025-10-20',
    slots: [],
    totals: {
      kcal: 135,
      protein: 2.7,
      carbs: 34,
      fat: 0.7,
      fiber: null,
      sugar: null,
      saturatedFat: null,
      sodiumMg: null,
    },
    entryCount: 1,
    goal,
    status: 'under',
    remaining: { kcal: 1865, protein: 147.3, carbs: 166, fat: 69.3, fiber: null },
    water: { ml: 0, entries: [] },
    ...overrides,
  };
}

function renderCard(value: DiaryDay) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SummaryCard day={value} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The one polite live region of the card (the visible "left" line is no longer live). */
function liveRegion(): HTMLElement {
  const regions = screen
    .getByRole('region', { name: 'Day summary' })
    .querySelectorAll<HTMLElement>('[aria-live]');
  expect(regions).toHaveLength(1);
  return regions[0]!;
}

describe('SummaryCard live announcements', () => {
  it('announces eaten, goal and what is left once per change when a goal is set', () => {
    const { rerender } = renderCard(day());
    const region = liveRegion();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).toHaveTextContent('135 of 2,000 kcal, 1,865 left');

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <SummaryCard
            day={day({
              totals: {
                kcal: 2150,
                protein: 120,
                carbs: 250,
                fat: 80,
                fiber: null,
                sugar: null,
                saturatedFat: null,
                sodiumMg: null,
              },
              status: 'over',
              remaining: { kcal: -150, protein: 30, carbs: -50, fat: -10, fiber: null },
            })}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(liveRegion()).toHaveTextContent('2,150 of 2,000 kcal, 150 over, over goal');
    // The ring stays a progressbar with its own text alternative (the macro bars are progressbars too).
    const valueTexts = screen
      .getAllByRole('progressbar')
      .map((el) => el.getAttribute('aria-valuetext'));
    expect(valueTexts).toContain('2,150 of 2,000 kcal');
  });

  it('announces the eaten total when no goal applies', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    renderCard(day({ goal: null, status: 'no_goal', remaining: null }));
    const region = liveRegion();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('135 kcal eaten');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
