import type { AboutResponse, ApiError, OffResult, OffSearchResponse } from '@plate/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { mapOffSearch } from '../src/off/mapping.js';
import { createTestApp, login, type TestContext } from './helpers.js';
import { offFixture, TWIX } from './off-fixtures.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;
type FetchMock = ReturnType<typeof vi.fn<FetchImpl>>;

/** Stubs the global fetch the service calls at request time (the service always passes a string URL). */
function stubFetch(impl: FetchImpl): FetchMock {
  const mock = vi.fn<FetchImpl>(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
}

const urlOf = (mock: FetchMock, call = 0): string => mock.mock.calls[call]?.[0] ?? '';
const headersOf = (mock: FetchMock, call = 0): Record<string, string> =>
  (mock.mock.calls[call]?.[1]?.headers ?? {}) as Record<string, string>;

let ctx: TestContext;
let cookie: string;

beforeEach(async () => {
  ctx = await createTestApp();
  cookie = await login(ctx.app);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await ctx.close();
});

const get = (url: string) => ctx.app.inject({ method: 'GET', url, headers: { cookie } });

describe('auth and validation', () => {
  it('denies anonymous access to both routes', async () => {
    for (const url of ['/api/off/search?q=oat', '/api/off/product/5000159484695']) {
      const res = await ctx.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it('rejects a missing or one-character query with path q', async () => {
    for (const url of ['/api/off/search', '/api/off/search?q=o', '/api/off/search?q=%20o%20']) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(400);
      const body = res.json<ApiError>();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect((body.error.details as { path: string }[]).map((d) => d.path)).toEqual(['q']);
    }
  });

  it('rejects a non-numeric product code with path code, without calling upstream', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(json({})));
    const res = await get('/api/off/product/abc');
    expect(res.statusCode).toBe(400);
    expect((res.json<ApiError>().error.details as { path: string }[]).map((d) => d.path)).toEqual([
      'code',
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/off/search', () => {
  it('proxies to search.pl with the documented query string and User-Agent, mapping the body', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(json(offFixture('off-search.json'))));
    const res = await get('/api/off/search?q=oat%20milk');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<OffSearchResponse>()).toEqual({
      items: mapOffSearch(offFixture('off-search.json')),
    });
    expect(res.json<OffSearchResponse>().items).toHaveLength(3);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = urlOf(fetchMock);
    expect(url.startsWith('https://world.openfoodfacts.org/cgi/search.pl?')).toBe(true);
    expect(url).toContain('search_terms=oat%20milk');
    expect(url).toContain('&search_simple=1&action=process&json=1&page_size=20');
    expect(url).toContain('&fields=code,product_name,brands,nutriments,quantity');
    expect(headersOf(fetchMock)['user-agent']).toBe('Plate/test');
  });

  it('serves repeated queries from the cache, case- and whitespace-insensitively', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(json(offFixture('off-search.json'))));
    const first = await get('/api/off/search?q=oat%20milk');
    const second = await get('/api/off/search?q=Oat%20Milk%20');
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await get('/api/off/search?q=almond');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns an empty list when OFF finds nothing', async () => {
    stubFetch(() => Promise.resolve(json({ count: 0, products: [] })));
    const res = await get('/api/off/search?q=zzzz');
    expect(res.statusCode).toBe(200);
    expect(res.json<OffSearchResponse>()).toEqual({ items: [] });
  });

  it('answers 502 UPSTREAM_ERROR when OFF times out', async () => {
    stubFetch(() => Promise.reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    const res = await get('/api/off/search?q=oat');
    expect(res.statusCode).toBe(502);
    expect(res.json<ApiError>().error).toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: expect.stringMatching(/did not respond/) as string,
    });
  });

  it('answers 502 UPSTREAM_ERROR on an upstream 500, a network failure or invalid JSON', async () => {
    stubFetch(() => Promise.resolve(json({ error: 'boom' }, 500)));
    let res = await get('/api/off/search?q=oat');
    expect(res.statusCode).toBe(502);
    expect(res.json<ApiError>().error.message).toMatch(/unavailable/);

    vi.unstubAllGlobals();
    stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    res = await get('/api/off/search?q=oats');
    expect(res.statusCode).toBe(502);
    expect(res.json<ApiError>().error.code).toBe('UPSTREAM_ERROR');

    vi.unstubAllGlobals();
    stubFetch(() =>
      Promise.resolve(
        new Response('<html>down</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    res = await get('/api/off/search?q=oatmeal');
    expect(res.statusCode).toBe(502);
    expect(res.json<ApiError>().error.message).toMatch(/unavailable/);
  });

  it('does not cache failures', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(json({}, 503)));
    expect((await get('/api/off/search?q=oat')).statusCode).toBe(502);
    vi.unstubAllGlobals();
    const ok = stubFetch(() => Promise.resolve(json(offFixture('off-search.json'))));
    expect((await get('/api/off/search?q=oat')).statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('caps each client at 60 lookups per minute', async () => {
    stubFetch(() => Promise.resolve(json(offFixture('off-search.json'))));
    for (let i = 0; i < 60; i++) {
      const res = await get('/api/off/search?q=oat');
      expect(res.statusCode, `request ${i + 1}`).toBe(200);
    }
    const blocked = await get('/api/off/search?q=oat');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<ApiError>().error.code).toBe('RATE_LIMITED');
    // Other routes are unaffected by the lookup cap.
    expect((await get('/api/about')).statusCode).toBe(200);
  });
});

describe('GET /api/off/product/:code', () => {
  it('proxies to the v2 product endpoint and maps the body', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(json(offFixture('off-product.json'))));
    const res = await get('/api/off/product/5000159484695');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<OffResult>()).toEqual(TWIX);
    expect(urlOf(fetchMock)).toBe(
      'https://world.openfoodfacts.org/api/v2/product/5000159484695.json?fields=code,product_name,brands,nutriments,quantity',
    );
    expect(headersOf(fetchMock)['user-agent']).toBe('Plate/test');

    const again = await get('/api/off/product/5000159484695');
    expect(again.json()).toEqual(TWIX);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers 404 NOT_FOUND for an unknown code (status 0 body or upstream 404)', async () => {
    stubFetch(() =>
      Promise.resolve(json({ code: '00000000', status: 0, status_verbose: 'product not found' })),
    );
    let res = await get('/api/off/product/00000000');
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiError>().error).toEqual({ code: 'NOT_FOUND', message: 'Product not found' });

    vi.unstubAllGlobals();
    stubFetch(() => Promise.resolve(json({ status: 0 }, 404)));
    res = await get('/api/off/product/00000001');
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiError>().error.message).toBe('Product not found');
  });

  it('answers 404 when the product exists but has no usable nutrition', async () => {
    stubFetch(() =>
      Promise.resolve(
        json({ status: 1, product: { code: '12345678', product_name: 'Mystery', nutriments: {} } }),
      ),
    );
    const res = await get('/api/off/product/12345678');
    expect(res.statusCode).toBe(404);
  });

  it('answers 502 on a timeout', async () => {
    stubFetch(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    const res = await get('/api/off/product/5000159484695');
    expect(res.statusCode).toBe(502);
    expect(res.json<ApiError>().error.message).toMatch(/did not respond/);
  });
});

describe('OFF_LOOKUP_ENABLED=false', () => {
  it('answers 404 "Online lookup is disabled" without calling upstream and reports offEnabled: false', async () => {
    await ctx.close();
    ctx = await createTestApp({ offLookupEnabled: false });
    cookie = await login(ctx.app);
    const fetchMock = stubFetch(() => Promise.resolve(json(offFixture('off-search.json'))));

    for (const url of ['/api/off/search?q=oat', '/api/off/product/5000159484695']) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.json<ApiError>().error).toEqual({
        code: 'NOT_FOUND',
        message: 'Online lookup is disabled',
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await get('/api/about')).json<AboutResponse>().offEnabled).toBe(false);
  });
});

describe('config', () => {
  it('defaults to enabled with a Plate User-Agent', () => {
    const config = loadConfig({});
    expect(config.offLookupEnabled).toBe(true);
    expect(config.offUserAgent).toMatch(/^Plate\/.+\(self-hosted diet ledger\)$/);
  });
  it('reads OFF_LOOKUP_ENABLED and OFF_USER_AGENT', () => {
    const config = loadConfig({ OFF_LOOKUP_ENABLED: 'false', OFF_USER_AGENT: 'x/1' });
    expect(config.offLookupEnabled).toBe(false);
    expect(config.offUserAgent).toBe('x/1');
  });
});
