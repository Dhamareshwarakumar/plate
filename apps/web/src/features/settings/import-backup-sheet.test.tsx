import { BACKUP_FORMAT, BACKUP_TABLE_KEYS, BACKUP_VERSION } from '@plate/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportBackupSheet } from './ImportBackupSheet';

const about = {
  version: 'dev',
  dbSizeBytes: 282_624,
  dbPath: 'plate.db',
  counts: { foods: 23, entries: 334, days: 31 },
};

const validBackup = () => ({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  exportedAt: '2025-10-20T10:00:00.000Z',
  appVersion: '0.1.0',
  data: {
    ...Object.fromEntries(BACKUP_TABLE_KEYS.map((k) => [k, []])),
    foods: [
      {
        id: 1,
        kind: 'food',
        name: 'Banana',
        brand: '',
        category_id: null,
        basis: 'g',
        kcal: 89,
        protein: 1.1,
        carbs: 22.8,
        fat: 0.3,
        fiber: null,
        sugar: null,
        saturated_fat: null,
        sodium_mg: null,
        source: 'manual',
        off_code: null,
        cooked_weight_g: null,
        servings: null,
        stale_since: null,
        archived_at: null,
        created_at: '2025-10-01T08:00:00.000Z',
        updated_at: '2025-10-01T08:00:00.000Z',
      },
    ],
  },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function renderSheet() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ImportBackupSheet open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

/** The JSON body `apiRequest` sent (it always serialises to a string). */
function sentBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
}

const fileInput = () => screen.getByLabelText<HTMLInputElement>(/Choose a backup file/);
const restoreButton = () => screen.getByRole('button', { name: 'Restore backup' });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ImportBackupSheet', () => {
  it('shows the staged message for a file that is not a Plate backup and keeps Restore disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(about)),
    );
    renderSheet();
    const user = userEvent.setup();

    expect(restoreButton()).toBeDisabled();
    await user.upload(
      fileInput(),
      new File(['{"hello":1}'], 'notes.json', { type: 'application/json' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('This file is not a Plate backup');
    expect(restoreButton()).toBeDisabled();
    expect(screen.queryByLabelText('Type REPLACE to confirm')).not.toBeInTheDocument();
  });

  it('previews file vs server counts and enables Restore only after typing REPLACE, then posts the backup', async () => {
    const backup = validBackup();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/about') return json(about);
      if (url === '/api/backup/restore') {
        return json({
          restored: Object.fromEntries(BACKUP_TABLE_KEYS.map((k) => [k, k === 'foods' ? 1 : 0])),
        });
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onOpenChange } = renderSheet();
    const user = userEvent.setup();

    await user.upload(
      fileInput(),
      new File([JSON.stringify(backup)], 'plate-backup-2025-10-20.json', {
        type: 'application/json',
      }),
    );

    expect(await screen.findByText(/Exported .* · Plate 0\.1\.0/)).toBeInTheDocument();
    const foodsRow = screen.getByRole('row', { name: /^Foods/ });
    await waitFor(() => expect(foodsRow).toHaveTextContent('Foods123'));
    expect(screen.getByRole('row', { name: /^Diary entries/ })).toHaveTextContent(
      'Diary entries0334',
    );
    expect(restoreButton()).toBeDisabled();

    const confirm = screen.getByLabelText('Type REPLACE to confirm');
    await user.type(confirm, 'replace');
    expect(restoreButton()).toBeDisabled();
    await user.clear(confirm);
    await user.type(confirm, 'REPLACE');
    expect(restoreButton()).toBeEnabled();

    await user.click(restoreButton());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const restoreCall = fetchMock.mock.calls.find(([url]) => url === '/api/backup/restore');
    expect(restoreCall).toBeDefined();
    const [, init] = restoreCall!;
    expect(init?.method).toBe('POST');
    expect(sentBody(init)).toEqual({ confirm: 'REPLACE', backup });
  });

  it('keeps the sheet open and shows the server message when the restore is refused', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/about') return json(about);
      return json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The backup is inconsistent: FOREIGN KEY constraint failed',
            details: [{ path: 'backup', message: 'x' }],
          },
        },
        400,
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onOpenChange } = renderSheet();
    const user = userEvent.setup();

    await user.upload(
      fileInput(),
      new File([JSON.stringify(validBackup())], 'b.json', { type: 'application/json' }),
    );
    await user.type(await screen.findByLabelText('Type REPLACE to confirm'), 'REPLACE');
    await user.click(restoreButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The backup is inconsistent: FOREIGN KEY constraint failed',
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(restoreButton()).toBeEnabled();
  });
});
