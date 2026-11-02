import type { DailyAggregate } from '@plate/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { CalendarHeatmap } from './CalendarHeatmap';

const TODAY = '2025-10-19';

function row(day: string, status: DailyAggregate['status'], kcal = 0): DailyAggregate {
  const logged = status !== 'not_logged';
  return {
    day,
    entryCount: logged ? 2 : 0,
    totals: {
      kcal,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: null,
      sugar: null,
      saturatedFat: null,
      sodiumMg: null,
    },
    goalKcal: status === 'no_goal' ? null : 2000,
    status,
  };
}

function renderHeatmap(props: Partial<Parameters<typeof CalendarHeatmap>[0]> = {}) {
  return render(
    <MemoryRouter>
      <CalendarHeatmap
        daily={[row('2025-10-18', 'under', 1500), row('2025-10-19', 'on_target', 1960)]}
        from="2025-10-13"
        to="2025-10-19"
        today={TODAY}
        weekStartsOn={1}
        {...props}
      />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('CalendarHeatmap', () => {
  it('renders past days as labelled links to that day in Today', () => {
    renderHeatmap();
    const cell = screen.getByRole('link', {
      name: /Sunday, 19 October 2025: on target, 1,960 kcal/,
    });
    expect(cell).toHaveAttribute('href', '/today/2025-10-19');
    expect(
      screen.getByRole('link', { name: /Saturday, 18 October 2025: under, 1,500 kcal/ }),
    ).toHaveAttribute('href', '/today/2025-10-18');
    // Days without a row are "not logged" and still open the day.
    expect(screen.getByRole('link', { name: /Monday, 13 October 2025: not logged/ })).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(7);
  });

  it('does not link future days', () => {
    renderHeatmap({ today: '2025-10-16' });
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.queryByRole('link', { name: /19 October/ })).toBeNull();
  });

  it('keeps the weekday letters above the cells for a custom range shorter than a week', () => {
    renderHeatmap({ from: '2025-10-17', to: '2025-10-19' });
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/today/2025-10-17',
      '/today/2025-10-18',
      '/today/2025-10-19',
    ]);
    // Letters and cells are two separate rows, so no cell can land on the letter row.
    const cellRow = links[0]!.parentElement!;
    expect(cellRow.children).toHaveLength(3);
    const letterRow = cellRow.previousElementSibling!;
    expect(letterRow.getAttribute('aria-hidden')).toBe('true');
    expect(Array.from(letterRow.children).map((c) => c.textContent)).toEqual(['F', 'S', 'S']);
    expect(letterRow.querySelector('a')).toBeNull();
  });

  it('shows one grid per month for a quarter and the year strip for a year', () => {
    renderHeatmap({ from: '2025-08-01', to: '2025-10-31' });
    expect(screen.getByRole('region', { name: 'August 2025' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'October 2025' })).toBeTruthy();
    // 31 + 30 + 19 past days are links; 12 future October days are not.
    expect(screen.getAllByRole('link')).toHaveLength(80);
    cleanup();

    renderHeatmap({ from: '2025-01-01', to: '2025-12-31' });
    expect(screen.queryByRole('region', { name: 'October 2025' })).toBeNull();
    // 1 Jan to 19 Oct inclusive.
    expect(screen.getAllByRole('link')).toHaveLength(292);
  });
});
