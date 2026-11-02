import type { Food } from '@plate/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dishKeys, foodKeys, mealTemplateKeys } from '@/lib/query-keys';
import { useDeleteFood, useSetFoodArchived, useUpdateFood } from './api';

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

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** A client with a dish detail and the templates list already cached and fresh. */
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(dishKeys.detail(9), { id: 9 });
  client.setQueryData(mealTemplateKeys.list, []);
  client.setQueryData(foodKeys.list(false), { items: [oats], total: 1 });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const stale = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated === true;
  return { client, wrapper, stale };
}

afterEach(() => vi.unstubAllGlobals());

describe('food mutations stale the caches that read current food values', () => {
  it('after an edit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(oats)),
    );
    const { wrapper, stale } = setup();
    const { result } = renderHook(() => useUpdateFood(), { wrapper });

    await result.current.mutateAsync({ id: oats.id, input: { name: 'Rolled oats' } as never });

    await waitFor(() => expect(stale(foodKeys.list(false))).toBe(true));
    expect(stale(dishKeys.detail(9))).toBe(true);
    expect(stale(mealTemplateKeys.list)).toBe(true);
  });

  it('after archiving', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ ...oats, archivedAt: '2025-10-20T08:00:00Z' })),
    );
    const { wrapper, stale } = setup();
    const { result } = renderHook(() => useSetFoodArchived(), { wrapper });

    await result.current.mutateAsync({ id: oats.id, archived: true });

    await waitFor(() => expect(stale(dishKeys.detail(9))).toBe(true));
    expect(stale(mealTemplateKeys.list)).toBe(true);
  });

  it('after a delete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ ok: true })),
    );
    const { wrapper, stale } = setup();
    const { result } = renderHook(() => useDeleteFood(), { wrapper });

    await result.current.mutateAsync(oats.id);

    await waitFor(() => expect(stale(dishKeys.detail(9))).toBe(true));
    expect(stale(mealTemplateKeys.list)).toBe(true);
  });
});
