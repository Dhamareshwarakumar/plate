import type { OffResult } from '@plate/shared';
import { AppError } from '../errors.js';
import { LruCache } from './lru.js';
import { mapOffProductResponse, mapOffSearch } from './mapping.js';

export interface OffLookupOptions {
  enabled: boolean;
  /** Sent as User-Agent; OFF asks every client to identify itself. */
  userAgent: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  cacheMax?: number;
  baseUrl?: string;
  now?: () => number;
  logger?: { warn(obj: object, msg: string): void };
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CACHE_MAX = 200;
const DEFAULT_BASE_URL = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,brands,nutriments,quantity';

const disabledError = () => new AppError(404, 'NOT_FOUND', 'Online lookup is disabled');
const notFoundError = () => new AppError(404, 'NOT_FOUND', 'Product not found');
const timeoutError = () =>
  new AppError(502, 'UPSTREAM_ERROR', 'Open Food Facts did not respond in time');
const unavailableError = () =>
  new AppError(502, 'UPSTREAM_ERROR', 'Open Food Facts is unavailable right now');
const isTimeout = (err: unknown) =>
  err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');

/** Cached answer: search results, one product, or `null` for a barcode OFF does not know. */
type CacheEntry = OffResult[] | OffResult | null;

/**
 * Server-side proxy to Open Food Facts (FR-F5). The browser never talks to OFF (NFR-7): the API
 * fetches with a 5 s timeout, keeps a small LRU of recent answers (unknown barcodes included, so a
 * repeated scan of an unlisted product does not reach upstream again within the TTL) and maps the
 * upstream shape to `offResultSchema`. Disabled installs answer 404 for both routes.
 */
export class OffLookupService {
  readonly enabled: boolean;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly logger: OffLookupOptions['logger'];
  private readonly cache: LruCache<CacheEntry>;

  constructor(options: OffLookupOptions) {
    this.enabled = options.enabled;
    this.userAgent = options.userAgent;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.logger = options.logger;
    this.cache = new LruCache(
      options.cacheMax ?? DEFAULT_CACHE_MAX,
      options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      options.now ?? Date.now,
    );
  }

  /** Free-text search; at most 20 valid products in OFF's relevance order. */
  async search(q: string): Promise<OffResult[]> {
    this.assertEnabled();
    const key = `search:${q.trim().toLowerCase()}`;
    const cached = this.cache.get(key);
    if (Array.isArray(cached)) return cached;
    const url =
      `${this.baseUrl}/cgi/search.pl?search_terms=${encodeURIComponent(q)}` +
      `&search_simple=1&action=process&json=1&page_size=20&fields=${FIELDS}`;
    const body = await this.fetchJson(url);
    const items = mapOffSearch(body);
    this.cache.set(key, items);
    return items;
  }

  /** Barcode lookup. 404 when OFF does not know the code or the product has no usable nutrition. */
  async product(code: string): Promise<OffResult> {
    this.assertEnabled();
    const key = `product:${code}`;
    const cached = this.cache.get(key);
    if (cached === null) throw notFoundError();
    if (cached && !Array.isArray(cached)) return cached;
    const url = `${this.baseUrl}/api/v2/product/${code}.json?fields=${FIELDS}`;
    const body = await this.fetchJson(url, { notFoundIsNull: true });
    const item = body === null ? null : mapOffProductResponse(body);
    this.cache.set(key, item);
    if (!item) throw notFoundError();
    return item;
  }

  private assertEnabled(): void {
    if (!this.enabled) throw disabledError();
  }

  /**
   * One upstream call. Uses the global `fetch` at request time (not captured at import) so tests
   * can stub it. Timeouts and network failures become 502 `UPSTREAM_ERROR`; an upstream 404 is
   * returned as `null` when the caller asked for it (unknown barcode), otherwise it is a 502 too.
   */
  private async fetchJson(
    url: string,
    options: { notFoundIsNull?: boolean } = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'user-agent': this.userAgent, accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      this.logger?.warn({ err, url }, 'open food facts request failed');
      if (isTimeout(err)) throw timeoutError();
      throw unavailableError();
    }
    if (response.status === 404 && options.notFoundIsNull) return null;
    if (!response.ok) {
      this.logger?.warn({ status: response.status, url }, 'open food facts returned an error');
      throw unavailableError();
    }
    try {
      return await response.json();
    } catch (err) {
      // The 5 s timeout can also fire while the body is still arriving.
      if (isTimeout(err)) {
        this.logger?.warn({ err, url }, 'open food facts request failed');
        throw timeoutError();
      }
      this.logger?.warn({ err, url }, 'open food facts returned invalid JSON');
      throw unavailableError();
    }
  }
}
