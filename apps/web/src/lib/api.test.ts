import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiClientError, apiRequest, setUnauthenticatedHandler } from './api';

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthenticatedHandler(undefined);
});

describe('apiRequest', () => {
  it('parses a successful response with the given schema', async () => {
    mockFetch(200, { ok: true });
    await expect(apiRequest('/x', { schema: z.object({ ok: z.literal(true) }) })).resolves.toEqual({
      ok: true,
    });
  });

  it('maps API error envelopes to ApiClientError with code and field details', async () => {
    mockFetch(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'bad',
        details: [{ path: 'name', message: 'Required' }],
      },
    });
    const err = await apiRequest('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    const apiErr = err as ApiClientError;
    expect(apiErr.status).toBe(400);
    expect(apiErr.code).toBe('VALIDATION_ERROR');
    expect(apiErr.fieldErrors()).toEqual({ name: 'Required' });
  });

  it('notifies the unauthenticated handler on 401 unless told not to', async () => {
    const handler = vi.fn();
    setUnauthenticatedHandler(handler);
    mockFetch(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in' } });
    await expect(apiRequest('/x')).rejects.toBeInstanceOf(ApiClientError);
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(apiRequest('/x', { notifyUnauthenticated: false })).rejects.toBeInstanceOf(
      ApiClientError,
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('turns a network failure into a NETWORK_ERROR with status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const err = (await apiRequest('/x').catch((e: unknown) => e)) as ApiClientError;
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.status).toBe(0);
  });

  it('rejects a response that does not match the schema', async () => {
    mockFetch(200, { nope: 1 });
    const err = (await apiRequest('/x', { schema: z.object({ ok: z.boolean() }) }).catch(
      (e: unknown) => e,
    )) as ApiClientError;
    expect(err.code).toBe('INTERNAL_ERROR');
  });
});
