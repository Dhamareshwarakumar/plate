import type { DiaryDay, MealSlot } from '@plate/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopySheet, type CopyRequest } from './CopySheet';

const slot = (id: number, name: string, archivedAt: string | null = null): MealSlot => ({
  id,
  name,
  windowStartMin: 0,
  windowEndMin: 0,
  sortOrder: id,
  archivedAt,
});
const breakfast = slot(1, 'Breakfast');
const lunch = slot(2, 'Lunch');
const supper = slot(9, 'Supper', '2025-10-10T08:00:00.000Z');

const ZERO = {
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: null,
  sugar: null,
  saturatedFat: null,
  sodiumMg: null,
};
/** What `POST /diary/copy` answers: the destination day (empty is enough for the sheet). */
const destinationDay: DiaryDay = {
  day: '2025-10-19',
  slots: [],
  totals: ZERO,
  entryCount: 0,
  goal: null,
  status: 'no_goal',
  remaining: null,
  water: { ml: 0, entries: [] },
};
const copyResponse = (count: number) =>
  new Response(JSON.stringify({ copied: count, day: destinationDay }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function renderSheet(request: CopyRequest) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <CopySheet
        request={request}
        day="2025-10-20"
        slots={[breakfast, lunch, supper]}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { onClose };
}

function sentBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CopySheet target meal', () => {
  it('offers "Same meal" for an active source and sends no targetSlotId for it', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => copyResponse(2));
    vi.stubGlobal('fetch', fetchMock);
    renderSheet({ mode: 'to', slotId: lunch.id });

    const target = screen.getByLabelText<HTMLSelectElement>('Into meal');
    expect(Array.from(target.options).map((o) => o.textContent)).toEqual([
      'Same meal',
      'Breakfast',
    ]);
    expect(target.value).toBe('same');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(fetchMock.mock.calls[0]![1])).toEqual({
      fromDay: '2025-10-20',
      toDay: '2025-10-19',
      slotId: lunch.id,
    });
  });

  it('sends the copies of an archived meal into the first active meal instead of "Same meal"', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => copyResponse(1));
    vi.stubGlobal('fetch', fetchMock);
    renderSheet({ mode: 'to', slotId: supper.id });

    const target = screen.getByLabelText<HTMLSelectElement>('Into meal');
    expect(Array.from(target.options).map((o) => o.textContent)).toEqual(['Breakfast', 'Lunch']);
    expect(target.value).toBe(String(breakfast.id));
    expect(screen.getByText(/That meal is archived/)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(fetchMock.mock.calls[0]![1])).toEqual({
      fromDay: '2025-10-20',
      toDay: '2025-10-19',
      slotId: supper.id,
      targetSlotId: breakfast.id,
    });
  });
});
