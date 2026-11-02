import type { Food } from '@plate/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiLogSheet } from './AiLogSheet';

const dal: Food = {
  id: 1,
  kind: 'food',
  name: 'Dal',
  brand: null,
  categoryId: null,
  basis: 'g',
  per100: {
    kcal: 116,
    protein: 9,
    carbs: 20,
    fat: 0.4,
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
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

// The fake provider's canned meal (apps/api/src/ai/providers/fake.ts) after the server sanitised
// the unknown id of the banana line.
const parsed = {
  items: [
    {
      description: '2 rotis',
      matchedFoodId: null,
      quantity: 80,
      basis: 'g',
      confidence: 'medium',
      suggestedFood: {
        name: 'Roti (whole wheat)',
        brand: null,
        basis: 'g',
        per100: {
          kcal: 297,
          protein: 9,
          carbs: 56,
          fat: 4,
          fiber: 7,
          sugar: null,
          saturatedFat: null,
          sodiumMg: null,
        },
        portions: [{ label: '1 roti', amount: 40 }],
      },
    },
    {
      description: 'a bowl of dal',
      matchedFoodId: 1,
      quantity: 200,
      basis: 'g',
      confidence: 'high',
      suggestedFood: null,
    },
    {
      description: 'one banana',
      matchedFoodId: null,
      quantity: 118,
      basis: 'g',
      confidence: 'medium',
      suggestedFood: null,
    },
  ],
  notes: 'Fake provider: canned answer for screenshots and tests.',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function stubApi(options: { parse?: () => Response } = {}) {
  const posted: { url: string; body: unknown }[] = [];
  let nextFoodId = 50;
  let nextEntryId = 500;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST') {
      const body: unknown = JSON.parse(init?.body as string);
      posted.push({ url, body });
      if (url === '/api/ai/parse-meal') return (options.parse ?? (() => json(parsed)))();
      if (url === '/api/foods') {
        const input = body as { name: string; basis: 'g' | 'ml'; per100: Food['per100'] };
        const food: Food = {
          ...dal,
          id: nextFoodId++,
          name: input.name,
          basis: input.basis,
          per100: input.per100,
          source: 'ai',
          estimatedAt: '2026-11-02T10:00:00.000Z',
        };
        return json(food, 201);
      }
      if (url === '/api/diary/entries') {
        const input = body as { quantity: number; foodId: number };
        return json(
          {
            id: nextEntryId++,
            day: '2026-11-02',
            slotId: 1,
            loggedAt: '2026-11-02T12:00:00.000Z',
            foodId: input.foodId,
            name: 'x',
            quantity: input.quantity,
            basis: 'g',
            portionLabel: null,
            portionCount: null,
            note: null,
            per100: dal.per100,
            totals: dal.per100,
            createdAt: '2026-11-02T12:00:00.000Z',
            updatedAt: '2026-11-02T12:00:00.000Z',
          },
          201,
        );
      }
    }
    if (url.startsWith('/api/foods')) return json({ items: [dal], total: 1 });
    if (url.startsWith('/api/categories')) return json([]);
    if (url.startsWith('/api/diary/')) return json([]);
    if (url.startsWith('/api/meal-templates')) return json([]);
    if (url.startsWith('/api/about')) {
      return json({
        version: '0.1.0',
        dbSizeBytes: 1,
        dbPath: 'plate.db',
        counts: { foods: 1, entries: 0, days: 0 },
        offEnabled: false,
        ai: { enabled: true, provider: 'fake', model: 'fake-1' },
      });
    }
    return json({ error: { code: 'NOT_FOUND', message: `unexpected ${url}` } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, posted };
}

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onLogged = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AiLogSheet
        open
        onOpenChange={onOpenChange}
        day="2026-11-02"
        slotId={1}
        slotName="Lunch"
        onLogged={onLogged}
      />
    </QueryClientProvider>,
  );
  return { onLogged, onOpenChange };
}

const textarea = () => screen.getByLabelText('What did you eat?');
const analyse = () => screen.getByRole('button', { name: 'Analyse' });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AiLogSheet', () => {
  it('needs text or a photo before Analyse, then shows the three kinds of row', async () => {
    const { posted } = stubApi();
    renderSheet();
    const user = userEvent.setup();

    expect(screen.getByRole('dialog', { name: 'Describe or photograph' })).toBeInTheDocument();
    expect(screen.getByText('Logging to Lunch · Mon 2 Nov')).toBeInTheDocument();
    expect(analyse()).toBeDisabled();
    expect(await screen.findByText(/Sent to the fake provider \(fake-1\)/)).toBeInTheDocument();

    await user.type(textarea(), '2 rotis, a bowl of dal, one banana');
    expect(analyse()).toBeEnabled();
    await user.click(analyse());

    expect(await screen.findByRole('dialog', { name: 'Review items' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Recognised items' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('2 rotis');
    expect(rows[0]).toHaveTextContent('Roti (whole wheat)');
    expect(rows[0]).toHaveTextContent('Estimated, new food');
    expect(rows[0]).toHaveTextContent('medium confidence');
    expect(rows[1]).toHaveTextContent('a bowl of dal');
    expect(rows[1]).toHaveTextContent('Dal');
    expect(rows[1]).toHaveTextContent('Library');
    expect(rows[1]).toHaveTextContent('high confidence');
    expect(rows[2]).toHaveTextContent('Needs a food');
    expect(within(rows[2]!).getByRole('button', { name: 'Pick a food' })).toBeInTheDocument();
    expect(screen.getByLabelText('a bowl of dal quantity in g')).toHaveValue('200');
    expect(screen.getByText(/Fake provider: canned answer/)).toBeInTheDocument();
    // 80 g roti (237.6) + 200 g dal (232) = 470 kcal; the banana row has no food yet.
    expect(screen.getByText('470 kcal')).toBeInTheDocument();

    const request = posted.find((p) => p.url === '/api/ai/parse-meal');
    expect(request?.body).toEqual({
      text: '2 rotis, a bowl of dal, one banana',
      day: '2026-11-02',
      slotId: 1,
    });
    expect(screen.getByRole('button', { name: 'Log 2 items' })).toBeEnabled();
  });

  it('removes a row, edits a quantity, then creates the new food and logs the entries in order', async () => {
    const { posted } = stubApi();
    const { onLogged } = renderSheet();
    const user = userEvent.setup();

    await user.type(textarea(), '2 rotis, a bowl of dal, one banana');
    await user.click(analyse());
    await screen.findByRole('dialog', { name: 'Review items' });

    await user.click(screen.getByRole('button', { name: 'Remove one banana' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    const dalQuantity = screen.getByLabelText('a bowl of dal quantity in g');
    await user.clear(dalQuantity);
    await user.type(dalQuantity, '150');
    expect(screen.getByText('412 kcal')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Log 2 items' }));
    await waitFor(() => expect(onLogged).toHaveBeenCalledWith(2));

    const foods = posted.filter((p) => p.url === '/api/foods').map((p) => p.body);
    expect(foods).toEqual([
      {
        name: 'Roti (whole wheat)',
        brand: null,
        basis: 'g',
        per100: parsed.items[0]!.suggestedFood!.per100,
        portions: [{ label: '1 roti', amount: 40 }],
        estimated: true,
      },
    ]);
    const entries = posted.filter((p) => p.url === '/api/diary/entries').map((p) => p.body);
    expect(entries).toMatchObject([
      { day: '2026-11-02', slotId: 1, foodId: 50, quantity: 80, basis: 'g' },
      { day: '2026-11-02', slotId: 1, foodId: 1, quantity: 150, basis: 'g' },
    ]);
  });

  it('shows the empty state when the model found nothing, with a way back to the text', async () => {
    stubApi({ parse: () => json({ items: [], notes: 'No food found in the description.' }) });
    renderSheet();
    const user = userEvent.setup();

    await user.type(textarea(), 'nothing');
    await user.click(analyse());
    expect(await screen.findByText('Nothing recognised')).toBeInTheDocument();
    expect(screen.getByText('No food found in the description.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit description' }));
    expect(textarea()).toHaveValue('nothing');
  });

  it('shows the server message on a 502 and retries the same request', async () => {
    let calls = 0;
    const { posted } = stubApi({
      parse: () => {
        calls += 1;
        return calls === 1
          ? json(
              {
                error: {
                  code: 'AI_UNAVAILABLE',
                  message: 'The AI provider rejected the request (503): fake provider failure',
                },
              },
              502,
            )
          : json(parsed);
      },
    });
    renderSheet();
    const user = userEvent.setup();

    await user.type(textarea(), 'please fail');
    await user.click(analyse());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The AI provider rejected the request (503)');

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('dialog', { name: 'Review items' })).toBeInTheDocument();
    const requests = posted.filter((p) => p.url === '/api/ai/parse-meal');
    expect(requests).toHaveLength(2);
    expect(requests[1]?.body).toEqual(requests[0]?.body);
  });

  it('lets the user pick a library food for a row the model could not place', async () => {
    stubApi();
    renderSheet();
    const user = userEvent.setup();

    await user.type(textarea(), '2 rotis, a bowl of dal, one banana');
    await user.click(analyse());
    await screen.findByRole('dialog', { name: 'Review items' });

    await user.click(screen.getByRole('button', { name: 'Pick a food' }));
    const picker = await screen.findByRole('dialog', { name: 'Pick a food' });
    await user.click(await within(picker).findByRole('button', { name: /^Dal/ }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Pick a food' })).not.toBeInTheDocument(),
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows[2]).toHaveTextContent('Dal');
    expect(rows[2]).toHaveTextContent('Library');
    expect(rows[2]).not.toHaveTextContent('Needs a food');
    expect(screen.getByRole('button', { name: 'Log 3 items' })).toBeEnabled();
  });
});
