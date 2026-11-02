import type { AiFeature, AiProviderKind } from '@plate/shared';

/** One piece of the user turn: text, or an inline image (base64, no data-URL prefix). */
export type AiPart = { text: string } | { imageBase64: string; mimeType: string };

export interface AiCompletionRequest {
  /** Which feature is asking; real drivers ignore it, the fake driver picks its canned answer by it. */
  feature: AiFeature;
  /** System instruction (role, rules, output contract). */
  system: string;
  /** The user turn, in order; the service appends a follow-up part for the one retry. */
  parts: AiPart[];
  /** JSON Schema the answer must match, already normalised by `providerJsonSchema`. */
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface AiCompletionResult {
  /** The raw answer text; the service parses and validates it. */
  text: string;
  /** Token counts as reported by the provider; null when it reported none. */
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * One model behind one HTTP API. Drivers only ship bytes: the prompt builders in shared decide
 * what is said, the service validates what comes back. The API key lives inside the driver and
 * must never appear in anything a driver returns, throws or logs.
 */
export interface AiProvider {
  readonly kind: AiProviderKind;
  readonly model: string;
  complete(req: AiCompletionRequest): Promise<AiCompletionResult>;
}

export type AiProviderErrorReason = 'timeout' | 'network' | 'http' | 'empty';

/**
 * A failed round-trip, classified so the service can word the 502 for the user. `message` is
 * already safe to show: a scrubbed, trimmed upstream detail at most, never a URL, header or body.
 */
export class AiProviderError extends Error {
  constructor(
    readonly reason: AiProviderErrorReason,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export const isTimeout = (err: unknown): boolean =>
  err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');

/** Longest upstream error detail that reaches the user. */
export const UPSTREAM_DETAIL_MAX = 200;

/**
 * An upstream error detail safe to surface: the key replaced wherever it appears (some gateways
 * echo the request), whitespace collapsed, cut to `UPSTREAM_DETAIL_MAX`.
 */
export function scrubDetail(text: string, apiKey: string): string {
  const scrubbed = apiKey.length > 0 ? text.split(apiKey).join('[redacted]') : text;
  return scrubbed.replace(/\s+/g, ' ').trim().slice(0, UPSTREAM_DETAIL_MAX);
}

/** `error.message` of a JSON error body (Gemini and OpenAI-style APIs agree on this shape), else the raw text. */
export function upstreamErrorDetail(bodyText: string): string {
  try {
    const body = JSON.parse(bodyText) as unknown;
    if (body && typeof body === 'object' && 'error' in body) {
      const { error } = body;
      if (error && typeof error === 'object' && 'message' in error) {
        const { message } = error;
        if (typeof message === 'string' && message.length > 0) return message;
      }
      if (typeof error === 'string' && error.length > 0) return error;
    }
  } catch {
    // Not JSON: the text itself is the detail.
  }
  return bodyText;
}

/**
 * Reads the whole response body as text with the timeout still in force (`AbortSignal.timeout`
 * also fires while the body is streaming); a timeout mid-body is reported as such.
 */
export async function readBody(response: Response, timeoutMs: number): Promise<string> {
  try {
    return await response.text();
  } catch (err) {
    if (isTimeout(err)) throw timeoutError(timeoutMs);
    throw new AiProviderError('network', 'The connection to the AI provider was interrupted.');
  }
}

export const timeoutError = (timeoutMs: number): AiProviderError =>
  new AiProviderError(
    'timeout',
    `The AI provider did not respond within ${Math.round(timeoutMs / 1000)} s.`,
  );

/** Shared driver options; `baseUrl` is required for OpenAI-compatible servers and optional for Gemini. */
export interface HttpProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  baseUrl?: string | undefined;
  logger?: AiProviderLogger | undefined;
}

export interface AiProviderLogger {
  warn(obj: object, msg: string): void;
}
