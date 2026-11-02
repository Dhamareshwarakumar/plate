import type { OffResult } from '@plate/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OffLookupSheet } from './OffLookupSheet';

const oatly: OffResult = {
  code: '7394376616228',
  name: 'The original oat-ly barista edition oat drink',
  brand: 'Oatly',
  quantity: '1l',
  per100: {
    kcal: 61,
    protein: 1.1,
    carbs: 7.1,
    fat: 3,
    fiber: 0.8,
    sugar: 3.4,
    saturatedFat: 0.3,
    sodiumMg: 39,
  },
};
const rude: OffResult = {
  code: '5060120281975',
  name: 'Oat Organic Drink',
  brand: null,
  quantity: null,
  per100: { ...oatly.per100, kcal: 49.4 },
};
const twix: OffResult = {
  code: '5000159484695',
  name: 'Twix glacé',
  brand: 'Twix',
  quantity: '1 gram',
  per100: {
    kcal: 280.74,
    protein: 2.78,
    carbs: 34.8,
    fat: 14.62,
    fiber: null,
    sugar: 25.52,
    saturatedFat: 9.05,
    sodiumMg: 102,
  },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function renderSheet(props: { initialQuery?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const onPick = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <OffLookupSheet open onOpenChange={onOpenChange} onPick={onPick} {...props} />
    </QueryClientProvider>,
  );
  return { onOpenChange, onPick };
}

const searchBox = () => screen.getByLabelText('Search Open Food Facts');
const searchButton = () => screen.getByRole('button', { name: 'Search' });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OffLookupSheet', () => {
  it('starts idle with the attribution and a disabled Search button, searching only on submit', async () => {
    const fetchMock = vi.fn(async (_url: string) => json({ items: [oatly, rude] }));
    vi.stubGlobal('fetch', fetchMock);
    renderSheet();
    const user = userEvent.setup();

    expect(screen.getByText('Search Open Food Facts', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Food Facts' })).toHaveAttribute(
      'href',
      'https://world.openfoodfacts.org',
    );
    expect(searchButton()).toBeDisabled();

    await user.type(searchBox(), 'oat milk');
    expect(searchButton()).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(
      await screen.findByText('The original oat-ly barista edition oat drink'),
    ).toBeInTheDocument();
    expect(screen.getByText('Oatly · 1l')).toBeInTheDocument();
    expect(screen.getByText('Oat Organic Drink')).toBeInTheDocument();
    expect(screen.getAllByText('61')[0]).toBeInTheDocument();
    expect(screen.getByText('49')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/off/search?q=oat%20milk');
  });

  it('hands the picked result back and closes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ items: [oatly] })),
    );
    const { onPick, onOpenChange } = renderSheet();
    const user = userEvent.setup();

    await user.type(searchBox(), 'oat milk');
    await user.click(searchButton());
    await user.click(await screen.findByRole('button', { name: /The original oat-ly/ }));

    expect(onPick).toHaveBeenCalledWith(oatly);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('looks up a barcode through the product route', async () => {
    const fetchMock = vi.fn(async (_url: string) => json(twix));
    vi.stubGlobal('fetch', fetchMock);
    renderSheet();
    const user = userEvent.setup();

    await user.type(searchBox(), '5000159484695{Enter}');

    expect(await screen.findByText('Twix glacé')).toBeInTheDocument();
    expect(screen.getByText('Twix · 1 gram')).toBeInTheDocument();
    expect(screen.getByText('281')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/off/product/5000159484695');
  });

  it('searches the initial query straight away', async () => {
    const fetchMock = vi.fn(async (_url: string) => json({ items: [oatly] }));
    vi.stubGlobal('fetch', fetchMock);
    renderSheet({ initialQuery: 'Oatly' });

    expect(await screen.findByText(/The original oat-ly/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/off/search?q=Oatly');
    expect(searchBox()).toHaveValue('Oatly');
  });

  it('shows the empty state for no results and for an unknown barcode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.startsWith('/api/off/product/')
          ? json({ error: { code: 'NOT_FOUND', message: 'Product not found' } }, 404)
          : json({ items: [] }),
      ),
    );
    renderSheet();
    const user = userEvent.setup();

    await user.type(searchBox(), 'zzzz{Enter}');
    expect(await screen.findByText('No products found')).toBeInTheDocument();
    expect(screen.getByText(/No results for “zzzz”/)).toBeInTheDocument();

    await user.clear(searchBox());
    await user.type(searchBox(), '00000000{Enter}');
    expect(await screen.findByText(/No results for “00000000”/)).toBeInTheDocument();
  });

  it('shows the server message on failure and retries', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? json(
              {
                error: {
                  code: 'UPSTREAM_ERROR',
                  message: 'Open Food Facts did not respond in time',
                },
              },
              502,
            )
          : json({ items: [oatly] });
      }),
    );
    renderSheet();
    const user = userEvent.setup();

    await user.type(searchBox(), 'oat milk{Enter}');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Open Food Facts did not respond in time');

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByText(/The original oat-ly/)).toBeInTheDocument();
  });
});
