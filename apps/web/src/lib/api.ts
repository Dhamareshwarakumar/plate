import { apiErrorSchema, type ApiErrorCode } from '@plate/shared';
import type { z } from 'zod';

/** Thrown for any non-2xx response or network failure. `status` is 0 when the server was unreachable. */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  /** Field-level messages from validation errors, keyed by dotted path. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (!Array.isArray(this.details)) return out;
    for (const item of this.details as unknown[]) {
      if (
        typeof item === 'object' &&
        item !== null &&
        'path' in item &&
        'message' in item &&
        typeof item.path === 'string' &&
        typeof item.message === 'string'
      ) {
        out[item.path] = item.message;
      }
    }
    return out;
  }
}

type UnauthenticatedHandler = () => void;
let onUnauthenticated: UnauthenticatedHandler | undefined;

/** The auth layer registers a handler so a 401 anywhere drops the cached session and shows login. */
export function setUnauthenticatedHandler(handler: UnauthenticatedHandler | undefined): void {
  onUnauthenticated = handler;
}

export interface RequestOptions<TSchema extends z.ZodType> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Response schema; the parsed value is returned. Omit for empty responses. */
  schema?: TSchema;
  signal?: AbortSignal;
  /** Set false for the login call so a 401 there is a normal "wrong password" result. */
  notifyUnauthenticated?: boolean;
}

export async function apiRequest<TSchema extends z.ZodType>(
  path: string,
  options: RequestOptions<TSchema> = {},
): Promise<z.infer<TSchema>> {
  const { method = 'GET', body, schema, signal, notifyUnauthenticated = true } = options;

  let response: Response;
  try {
    const init: RequestInit = { method, credentials: 'same-origin' };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    if (signal) init.signal = signal;
    response = await fetch(`/api${path}`, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiClientError(0, 'NETWORK_ERROR', "Can't reach the server. Check your connection.");
  }

  if (!response.ok) {
    const error = await parseError(response);
    if (response.status === 401 && notifyUnauthenticated) onUnauthenticated?.();
    throw error;
  }

  if (!schema) return undefined as z.infer<TSchema>;
  const json: unknown = await response.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiClientError(
      response.status,
      'INTERNAL_ERROR',
      'Unexpected response from the server.',
    );
  }
  return parsed.data;
}

async function parseError(response: Response): Promise<ApiClientError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  const parsed = apiErrorSchema.safeParse(payload);
  if (parsed.success) {
    const { code, message, details } = parsed.data.error;
    return new ApiClientError(response.status, code, message, details);
  }
  if (response.status === 429) {
    return new ApiClientError(
      429,
      'RATE_LIMITED',
      'Too many requests. Try again in a few minutes.',
    );
  }
  return new ApiClientError(
    response.status,
    'INTERNAL_ERROR',
    `The server returned an unexpected error (${response.status}).`,
  );
}
