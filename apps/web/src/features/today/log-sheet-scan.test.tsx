import type { Food, MealSlot, OffResult } from '@plate/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LogSheet } from './LogSheet';

// The camera sheet is replaced by a button that "reads" whatever `scan.code` holds.
const scan = { code: '5000159484695' };
vi.mock('@/features/scan/BarcodeScannerSheet', () => ({
  BarcodeScannerSheet: ({
    open,
    onDetected,
  }: {
    open: boolean;
    onDetected: (code: string) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onDetected(scan.code)}>
        fake camera read
      </button>
    ) : null,
}));

const per100 = {
  kcal: 61,
  protein: 1.1,
  carbs: 7.1,
  fat: 3,
  fiber: null,
  sugar: null,
  saturatedFat: null,
  sodiumMg: null,
};
const oatly: Food = {
  id: 1,
  kind: 'food',
  name: 'Oat drink',
  brand: 'Oatly',
  categoryId: null,
  basis: 'ml',
  per100,
  portions: [],
  source: 'off',
  // The 12-digit UPC-A form, as a CSV import could hold it; the scanner reports 13 digits.
  offCode: '049000006346',
  estimatedAt: null,
  staleSince: null,
  archivedAt: null,
  createdAt: '2025-10-01T08:00:00.000Z',
  updatedAt: '2025-10-01T08:00:00.000Z',
};
const twixResult: OffResult = {
  code: '5000159484695',
  name: 'Twix glacé',
  brand: 'Twix',
  quantity: '1 gram',
  per100: { ...per100, kcal: 280.74, protein: 2.78, carbs: 34.8, fat: 14.62 },
};
const twixFood: Food = {
  ...oatly,
  id: 2,
  name: twixResult.name,
  brand: twixResult.brand,
  basis: 'g',
  per100: twixResult.per100,
  offCode: twixResult.code,
};
const breakfast: MealSlot = {
  id: 1,
  name: 'Breakfast',
  windowStartMin: 360,
  windowEndMin: 600,
  sortOrder: 0,
  archivedAt: null,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function stubApi(options: { offEnabled?: boolean; product?: () => Response } = {}) {
  const posted: unknown[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/foods') && init?.method === 'POST') {
      posted.push(JSON.parse(init.body as string));
      return json(twixFood, 201);
    }
    if (url.startsWith('/api/foods')) return json({ items: [oatly], total: 1 });
    if (url.startsWith('/api/categories')) return json([]);
    if (url.startsWith('/api/diary/')) return json([]);
    if (url.startsWith('/api/meal-templates')) return json([]);
    if (url.startsWith('/api/about')) {
      return json({
        version: '0.1.0',
        dbSizeBytes: 1,
        dbPath: 'plate.db',
        counts: { foods: 1, entries: 0, days: 0 },
        offEnabled: options.offEnabled ?? true,
        ai: { enabled: false, provider: 'none', model: null },
      });
    }
    if (url.startsWith('/api/off/product/')) return (options.product ?? (() => json(twixResult)))();
    return json({ error: { code: 'NOT_FOUND', message: `unexpected ${url}` } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, posted };
}

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCreateFood = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <LogSheet
        open
        onClose={vi.fn()}
        day="2025-10-19"
        slots={[breakfast]}
        dayKcal={0}
        onCreateFood={onCreateFood}
      />
    </QueryClientProvider>,
  );
  return { onCreateFood };
}

async function scanCode(code: string) {
  scan.code = code;
  const user = userEvent.setup();
  await screen.findByRole('button', { name: 'Scan barcode' });
  await user.click(screen.getByRole('button', { name: 'Scan barcode' }));
  await user.click(await screen.findByRole('button', { name: 'fake camera read' }));
  return user;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LogSheet barcode scanning', () => {
  it('jumps to the quantity step when a library food carries the code (UPC-A padding ignored)', async () => {
    const { fetchMock } = stubApi();
    renderSheet();
    await screen.findByText('Oat drink'); // library loaded

    await scanCode('0049000006346');
    expect(await screen.findByRole('heading', { name: 'Oat drink' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Quantity/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/off/'))).toBe(false);
  });

  it('looks the code up and "Add to library and log" creates the food, then asks for the quantity', async () => {
    const { posted } = stubApi();
    renderSheet();
    await screen.findByText('Oat drink');

    const user = await scanCode('5000159484695');
    expect(
      await screen.findByRole('heading', { name: 'Barcode 5000159484695' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Twix glacé')).toBeInTheDocument();
    expect(screen.getByText('Twix · 1 gram')).toBeInTheDocument();
    expect(screen.getByText(/Per 100 g\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add to library and log' }));
    expect(await screen.findByRole('heading', { name: 'Twix glacé' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Quantity/)).toBeInTheDocument();
    expect(posted).toEqual([
      {
        name: 'Twix glacé',
        brand: 'Twix',
        categoryId: null,
        basis: 'g',
        per100: twixResult.per100,
        portions: [],
        offCode: '5000159484695',
      },
    ]);
  });

  it('offers to create the food manually, with the code, when Open Food Facts has nothing', async () => {
    stubApi({
      product: () => json({ error: { code: 'NOT_FOUND', message: 'Product not found' } }, 404),
    });
    const { onCreateFood } = renderSheet();
    await screen.findByText('Oat drink');

    const user = await scanCode('96385074');
    expect(await screen.findByText('Not on Open Food Facts')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to library and log' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create food manually' }));
    expect(onCreateFood).toHaveBeenCalledWith('', '96385074');
  });

  it('explains that online lookup is off and still offers the manual path', async () => {
    const { fetchMock } = stubApi({ offEnabled: false });
    const { onCreateFood } = renderSheet();
    await screen.findByText('Oat drink');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/about'))).toBe(true),
    );

    const user = await scanCode('5000159484695');
    expect(await screen.findByText('Not in your library')).toBeInTheDocument();
    expect(screen.getByText(/Online lookup is turned off on this server/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/off/'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Create food manually' }));
    expect(onCreateFood).toHaveBeenCalledWith('', '5000159484695');
  });

  it('shows the lookup error with a retry', async () => {
    let calls = 0;
    stubApi({
      product: () => {
        calls += 1;
        return calls === 1
          ? json(
              { error: { code: 'UPSTREAM_ERROR', message: 'Open Food Facts is unavailable' } },
              502,
            )
          : json(twixResult);
      },
    });
    renderSheet();
    await screen.findByText('Oat drink');

    const user = await scanCode('5000159484695');
    expect(await screen.findByRole('alert')).toHaveTextContent('Open Food Facts is unavailable');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Twix glacé')).toBeInTheDocument();
  });
});
