import type { Food } from '@plate/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoodPicker } from './FoodPicker';

const oats: Food = {
  id: 1,
  kind: 'food',
  name: 'Oats',
  brand: null,
  categoryId: null,
  basis: 'g',
  per100: {
    kcal: 389,
    protein: 16.9,
    carbs: 66.3,
    fat: 6.9,
    fiber: null,
    sugar: null,
    saturatedFat: null,
    sodiumMg: null,
  },
  portions: [],
  source: 'manual',
  offCode: null,
  estimatedAt: null,
  staleSince: null,
  archivedAt: null,
  createdAt: '2025-10-01T08:00:00.000Z',
  updatedAt: '2025-10-01T08:00:00.000Z',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** The picker's five requests; `templates` decides what `GET /meal-templates` answers. */
function stubApi(templates: () => Response) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/foods')) return json({ items: [oats], total: 1 });
    if (url.startsWith('/api/categories')) return json([]);
    if (url.startsWith('/api/diary/')) return json([]);
    if (url.startsWith('/api/meal-templates')) return templates();
    return json({ error: { code: 'NOT_FOUND', message: `unexpected ${url}` } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPicker(query = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onPickTemplate = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <FoodPicker query={query} onPick={vi.fn()} onPickTemplate={onPickTemplate} />
    </QueryClientProvider>,
  );
  return onPickTemplate;
}

const failure = () =>
  json({ error: { code: 'INTERNAL_ERROR', message: 'Database is locked' } }, 500);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FoodPicker meal templates', () => {
  it('shows the templates error with a retry on the Meals shelf instead of the empty text', async () => {
    let calls = 0;
    const fetchMock = stubApi(() => {
      calls += 1;
      return calls === 1 ? failure() : json([]);
    });
    renderPicker();
    const user = userEvent.setup();

    // The foods list is up; the Meals chip stays enabled although no template arrived.
    await screen.findByRole('button', { name: /^Oats/ });
    const mealsTab = screen.getByRole('tab', { name: 'Meals' });
    await waitFor(() => expect(mealsTab).toBeEnabled());
    await user.click(mealsTab);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Meal templates didn't load");
    expect(alert).toHaveTextContent('Database is locked');
    expect(screen.queryByText(/No meal templates yet/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/No meal templates yet/);
    expect(
      fetchMock.mock.calls.filter(([url]) => url.startsWith('/api/meal-templates')),
    ).toHaveLength(2);
  });

  it('tells a searching user that templates are missing from the results', async () => {
    stubApi(failure);
    renderPicker('oat');
    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent("Meal templates didn't load");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // Foods still match as usual.
    expect(screen.getByRole('button', { name: /^Oats/ })).toBeInTheDocument();
  });

  it('keeps the Meals chip disabled when the request succeeds with no templates', async () => {
    stubApi(() => json([]));
    renderPicker();
    await screen.findByRole('button', { name: /^Oats/ });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Meals' })).toBeDisabled());
  });
});
