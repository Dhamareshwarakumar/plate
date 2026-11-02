import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeeklyDigestCard } from './WeeklyDigestCard';

const weekA = '2026-10-26';
const weekB = '2026-11-02';

const digestB = {
  weekStart: weekB,
  lines: ['Five of seven days logged.', 'Protein averaged 92 g a day.', 'Fibre fell short twice.'],
  suggestion: 'Add a bowl of dal to lunch on the two low-fibre days.',
  generatedAt: '2026-11-08T20:00:00.000Z',
  model: 'fake-1',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function stubApi() {
  const posted: { url: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'POST') {
      const body = JSON.parse(init?.body as string) as { weekStart: string };
      posted.push({ url, body });
      // The first attempt fails the way a provider outage does; a retry succeeds.
      if (posted.length === 1) {
        return json(
          { error: { code: 'AI_UNAVAILABLE', message: 'The AI provider timed out.' } },
          502,
        );
      }
      return json({
        ...digestB,
        weekStart: body.weekStart,
        lines: ['Written on retry.', 'b', 'c'],
      });
    }
    if (url === `/api/ai/weekly-digest?weekStart=${weekA}`) return json({ digest: null });
    if (url === `/api/ai/weekly-digest?weekStart=${weekB}`) return json({ digest: digestB });
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
  return { posted };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WeeklyDigestCard', () => {
  it('keeps a failed generation with its own week; other weeks show their cached digest', async () => {
    const { posted } = stubApi();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    // Insights keeps one card mounted while the user steps through weeks, so the week changes
    // through props, not a remount.
    const card = (weekStart: string) => (
      <QueryClientProvider client={client}>
        <WeeklyDigestCard weekStart={weekStart} />
      </QueryClientProvider>
    );
    const { rerender } = render(card(weekA));

    await user.click(await screen.findByRole('button', { name: 'Generate' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not write the digest');
    expect(alert).toHaveTextContent('The AI provider timed out.');

    rerender(card(weekB));
    expect(await screen.findByText('Five of seven days logged.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();

    rerender(card(weekA));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not write the digest');
    expect(posted).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Written on retry.')).toBeInTheDocument();
    expect(posted).toEqual([
      { url: '/api/ai/weekly-digest?refresh=false', body: { weekStart: weekA } },
      { url: '/api/ai/weekly-digest?refresh=false', body: { weekStart: weekA } },
    ]);
  });
});
