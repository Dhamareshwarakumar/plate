import type { DayWater } from '@plate/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WaterCard } from './WaterCard';

// What the card shows right after navigating from 19 Oct to 20 Oct: the previous day's water is
// still on screen (keepPreviousData) while the new day loads.
const previousDayWater: DayWater = {
  ml: 250,
  entries: [{ id: 7, day: '2025-10-19', ml: 250, loggedAt: '2025-10-19T08:00:00.000Z' }],
};

function renderCard(props: Partial<ComponentProps<typeof WaterCard>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WaterCard day="2025-10-20" water={previousDayWater} goalMl={null} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The JSON body `apiRequest` sent (it always serialises to a string). */
function sentBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
}

describe('WaterCard', () => {
  it('posts to the viewed day, not to the day of the entries it is showing', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = sentBody(init) as { day: string; ml: number };
      return new Response(
        JSON.stringify({ id: 8, ...body, loggedAt: '2025-10-20T08:00:00.000Z' }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderCard();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Add 250 ml of water' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/water');
    expect(init?.method).toBe('POST');
    expect(sentBody(init)).toEqual({ day: '2025-10-20', ml: 250 });
  });

  it('blocks every write while the shown water is still the previous day placeholder', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderCard({ disabled: true });

    for (const name of [
      'Add 250 ml of water',
      'Add 500 ml of water',
      'Add a custom amount of water',
      'Undo last water entry',
    ]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('enables undo once the viewed day has loaded with a settled entry', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderCard({
      water: {
        ml: 500,
        entries: [{ id: 9, day: '2025-10-20', ml: 500, loggedAt: '2025-10-20T09:00:00.000Z' }],
      },
    });

    expect(screen.getByRole('button', { name: 'Undo last water entry' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add 250 ml of water' })).toBeEnabled();
  });
});
