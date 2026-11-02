import type { Food } from '@plate/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MealTemplateForm } from './MealTemplateForm';

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
  portions: [{ id: 1, label: '1 bowl', amount: 80, sortOrder: 0 }],
  source: 'manual',
  offCode: null,
  estimatedAt: null,
  staleSince: null,
  archivedAt: null,
  createdAt: '2025-10-01T08:00:00.000Z',
  updatedAt: '2025-10-01T08:00:00.000Z',
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MealTemplateForm items', () => {
  it('adds the same food twice as two lines, each with the first portion as its amount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/foods')) return json({ items: [oats], total: 1 });
        if (url.startsWith('/api/categories')) return json([]);
        return json([]);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MealTemplateForm
          mode="create"
          library={[oats]}
          onSubmit={vi.fn(async () => undefined)}
          submitting={false}
        />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    for (let i = 0; i < 2; i++) {
      await user.click(screen.getByRole('button', { name: 'Add food or dish' }));
      await user.click(await screen.findByRole('button', { name: /^Oats/ }));
    }

    const amounts = screen.getAllByLabelText<HTMLInputElement>('Oats amount in g');
    expect(amounts.map((a) => a.value)).toEqual(['80', '80']);
    expect(screen.getAllByRole('button', { name: 'Remove Oats' })).toHaveLength(2);
    // Two 80 g lines of 389 kcal/100 g.
    expect(screen.getByText('622')).toBeInTheDocument();
  });
});
