import type {
  AiEstimateFoodResponse,
  AiParseMealResponse,
  ApiError,
  MealSlot,
} from '@plate/shared';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAKE_RESPONSES } from '../src/ai/providers/fake.js';
import type { AppConfig } from '../src/config.js';
import { MealSlotService } from '../src/mealSlots/service.js';
import { createTestApp, login, type TestContext } from './helpers.js';

const KEY = 'secret-key-123';
const TODAY = '2026-11-02';
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;
type FetchMock = ReturnType<typeof vi.fn<FetchImpl>>;

/** Stubs the global fetch the drivers call at request time (always with a string URL). */
function stubFetch(impl: FetchImpl): FetchMock {
  const mock = vi.fn<FetchImpl>(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
}
/** Answers in order; the last answer repeats. */
function stubSequence(...responses: (() => Promise<Response>)[]): FetchMock {
  let call = 0;
  return stubFetch(() => {
    const next = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return next();
  });
}

const urlOf = (mock: FetchMock, call = 0): string => mock.mock.calls[call]?.[0] ?? '';
const headersOf = (mock: FetchMock, call = 0): Record<string, string> =>
  (mock.mock.calls[call]?.[1]?.headers ?? {}) as Record<string, string>;
const bodyOf = (mock: FetchMock, call = 0): Record<string, unknown> =>
  JSON.parse((mock.mock.calls[call]?.[1]?.body as string) ?? '{}') as Record<string, unknown>;
const rawRequest = (mock: FetchMock, call = 0): string =>
  `${urlOf(mock, call)} ${JSON.stringify(mock.mock.calls[call]?.[1] ?? {})}`;

interface UsageRow {
  feature: string;
  input_tokens: number | null;
  output_tokens: number | null;
  ok: number;
}

let ctx: TestContext;
let cookie: string;
let slotId: number;

async function start(overrides: Partial<AppConfig>): Promise<void> {
  ctx = await createTestApp(overrides);
  new MealSlotService(ctx.opened.db).seedDefaults();
  cookie = await login(ctx.app);
  slotId = (await api('GET', '/api/meal-slots')).json<MealSlot[]>()[0]!.id;
}
afterEach(async () => {
  vi.unstubAllGlobals();
  await ctx.close();
});

const api = (method: 'GET' | 'POST', url: string, payload?: unknown) => {
  const options: InjectOptions = { method, url, headers: { cookie } };
  if (payload !== undefined) options.payload = payload as NonNullable<InjectOptions['payload']>;
  return ctx.app.inject(options);
};
const estimate = () => api('POST', '/api/ai/estimate-food', { name: 'Sambar' });
const parseMealWithPhoto = () =>
  api('POST', '/api/ai/parse-meal', {
    text: 'dal and rice',
    image: { mimeType: 'image/png', base64: TINY_PNG },
    day: TODAY,
    slotId,
  });
const usageRows = (): UsageRow[] =>
  ctx.opened.sqlite
    .prepare('SELECT feature, input_tokens, output_tokens, ok FROM ai_usage ORDER BY id')
    .all() as UsageRow[];

const ESTIMATE = FAKE_RESPONSES.estimate_food as AiEstimateFoodResponse;

// ---------- Gemini ----------

const geminiRaw = (text: string, usage: Record<string, number> | null) =>
  json({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    ...(usage ? { usageMetadata: usage } : {}),
  });
const geminiAnswer = (
  payload: unknown,
  usage: Record<string, number> | null = {
    promptTokenCount: 10,
    candidatesTokenCount: 5,
    thoughtsTokenCount: 3,
  },
) => geminiRaw(JSON.stringify(payload), usage);

describe('gemini driver', () => {
  beforeEach(() => start({ aiProvider: 'gemini', aiApiKey: KEY, aiModel: 'gemini-3.8-flash' }));

  it('posts to generateContent with the key in a header, a system instruction, JSON mode and the schema', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(geminiAnswer(ESTIMATE)));
    const res = await estimate();
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<AiEstimateFoodResponse>()).toEqual(ESTIMATE);
    expect(res.headers['x-ai-model']).toBe('gemini-3.8-flash');
    expect(res.headers['x-ai-retried']).toBe('0');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    );
    expect(headersOf(fetchMock)['x-goog-api-key']).toBe(KEY);
    expect(headersOf(fetchMock)['content-type']).toBe('application/json');
    expect(mock(fetchMock).init.method).toBe('POST');
    expect(mock(fetchMock).init.signal).toBeInstanceOf(AbortSignal);

    const body = bodyOf(fetchMock) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string; parts: { text?: string }[] }[];
      generationConfig: Record<string, unknown>;
    };
    expect(body.systemInstruction.parts[0]!.text).toMatch(/JSON/);
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0]!.role).toBe('user');
    expect(body.contents[0]!.parts[0]!.text).toContain('Food: Sambar');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.maxOutputTokens).toBe(4096);
    const schema = body.generationConfig.responseJsonSchema as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    const schemaText = JSON.stringify(schema);
    expect(schemaText).not.toContain('$schema');
    expect(schemaText).not.toContain('exclusiveMinimum');
    expect(schemaText).not.toContain('maxLength');
    expect(body.generationConfig.responseSchema).toBeUndefined();
    expect(body.generationConfig.thinkingConfig).toBeUndefined();
    // The key is only in the header: never in the URL or the body.
    expect(urlOf(fetchMock)).not.toContain(KEY);
    expect(JSON.stringify(body)).not.toContain(KEY);

    // Output tokens are the answer plus the thinking tokens.
    expect(usageRows()).toEqual([
      { feature: 'estimate_food', input_tokens: 10, output_tokens: 8, ok: 1 },
    ]);
  });

  it('sends a photo as inlineData after the text part', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(geminiAnswer(FAKE_RESPONSES.parse_meal)));
    const res = await parseMealWithPhoto();
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<AiParseMealResponse>().items).toHaveLength(3);
    const body = bodyOf(fetchMock) as {
      contents: { parts: Record<string, unknown>[] }[];
      generationConfig: { maxOutputTokens: number };
    };
    const parts = body.contents[0]!.parts;
    expect(parts).toHaveLength(2);
    expect(parts[0]!.text).toContain('Library index:');
    expect(parts[0]!.text).toContain('(a photo of the meal is attached)');
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: TINY_PNG } });
    expect(body.generationConfig.maxOutputTokens).toBe(8192);
  });

  it('ignores thought parts and copes without usage metadata', async () => {
    stubFetch(() =>
      Promise.resolve(
        json({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Let me think…', thought: true },
                  { text: JSON.stringify(ESTIMATE) },
                ],
              },
            },
          ],
        }),
      ),
    );
    const res = await estimate();
    expect(res.statusCode, res.body).toBe(200);
    expect(usageRows()).toEqual([
      { feature: 'estimate_food', input_tokens: null, output_tokens: null, ok: 1 },
    ]);
  });

  it('maps a timeout to 502 with the seconds and "Try again"', async () => {
    stubFetch(() => Promise.reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    const res = await estimate();
    expect(res.statusCode).toBe(502);
    expect(res.json<ApiError>().error).toEqual({
      code: 'AI_UNAVAILABLE',
      message: 'The AI provider did not respond within 30 s. Try again.',
    });
    expect(usageRows()).toEqual([
      { feature: 'estimate_food', input_tokens: null, output_tokens: null, ok: 0 },
    ]);

    vi.unstubAllGlobals();
    stubFetch(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    expect((await estimate()).json<ApiError>().error.message).toMatch(/did not respond/);
  });

  it('maps a network failure to "Could not reach"', async () => {
    stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    const res = await estimate();
    expect(res.statusCode).toBe(502);
    expect(res.json<ApiError>().error.message).toBe('Could not reach the AI provider.');
  });

  it('surfaces the upstream status and a scrubbed, trimmed detail', async () => {
    stubFetch(() =>
      Promise.resolve(
        json(
          { error: { code: 404, message: 'models/x is not found for API version v1beta' } },
          404,
        ),
      ),
    );
    let res = await estimate();
    expect(res.statusCode).toBe(502);
    expect(res.json<ApiError>().error.message).toBe(
      'The AI provider rejected the request (404): models/x is not found for API version v1beta',
    );

    vi.unstubAllGlobals();
    stubFetch(() =>
      Promise.resolve(json({ error: { message: `API key not valid: ${KEY} (see docs)` } }, 400)),
    );
    res = await estimate();
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain(KEY);
    expect(res.json<ApiError>().error.message).toContain('[redacted]');

    vi.unstubAllGlobals();
    stubFetch(() => Promise.resolve(json({ error: { message: 'Resource exhausted' } }, 429)));
    res = await estimate();
    expect(res.json<ApiError>().error.message).toBe(
      'The AI provider is rate-limiting requests (429). Wait a minute and try again.',
    );

    vi.unstubAllGlobals();
    stubFetch(() =>
      Promise.resolve(
        new Response(`<html>${'x'.repeat(400)}</html>`, {
          status: 503,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    res = await estimate();
    const message = res.json<ApiError>().error.message;
    expect(message.startsWith('The AI provider rejected the request (503): <html>')).toBe(true);
    expect(message.length).toBeLessThanOrEqual(
      'The AI provider rejected the request (503): '.length + 200,
    );
    expect(usageRows().map((r) => r.ok)).toEqual([0, 0, 0, 0]);
  });

  it('treats an answer without text as empty, naming the finish reason', async () => {
    stubFetch(() =>
      Promise.resolve(
        json({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }),
      ),
    );
    let res = await estimate();
    expect(res.statusCode).toBe(502);
    expect(res.json<ApiError>().error.message).toBe(
      'The AI provider returned an empty answer (MAX_TOKENS).',
    );
    vi.unstubAllGlobals();
    stubFetch(() => Promise.resolve(json({ promptFeedback: { blockReason: 'OTHER' } })));
    res = await estimate();
    expect(res.json<ApiError>().error.message).toBe('The AI provider returned an empty answer.');
  });

  it('retries once with the validation problem when the answer is not JSON, then succeeds', async () => {
    const fetchMock = stubSequence(
      () =>
        Promise.resolve(geminiRaw('not json {', { promptTokenCount: 10, candidatesTokenCount: 5 })),
      () =>
        Promise.resolve(geminiAnswer(ESTIMATE, { promptTokenCount: 12, candidatesTokenCount: 6 })),
    );
    const res = await estimate();
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['x-ai-retried']).toBe('1');
    expect(res.json<AiEstimateFoodResponse>()).toEqual(ESTIMATE);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const second = bodyOf(fetchMock, 1) as { contents: { parts: { text: string }[] }[] };
    const parts = second.contents[0]!.parts;
    expect(parts).toHaveLength(2);
    expect(parts[0]!.text).toContain('Food: Sambar');
    expect(parts[1]!.text).toContain('did not match the required JSON schema: not valid JSON');
    expect(usageRows()).toEqual([
      { feature: 'estimate_food', input_tokens: 22, output_tokens: 11, ok: 1 },
    ]);
  });

  it('names the failing fields when the JSON does not fit the schema', async () => {
    const fetchMock = stubSequence(
      () =>
        Promise.resolve(geminiAnswer({ ...ESTIMATE, per100: { ...ESTIMATE.per100, kcal: 950 } })),
      () => Promise.resolve(geminiAnswer(ESTIMATE)),
    );
    const res = await estimate();
    expect(res.statusCode, res.body).toBe(200);
    const second = bodyOf(fetchMock, 1) as { contents: { parts: { text: string }[] }[] };
    expect(second.contents[0]!.parts[1]!.text).toContain('per100.kcal');
  });

  it('gives up after two unusable answers with a 502 and one failed usage row', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        geminiRaw('{"nope": true}', { promptTokenCount: 10, candidatesTokenCount: 5 }),
      ),
    );
    const res = await estimate();
    expect(res.statusCode).toBe(502);
    expect(res.json<ApiError>().error).toEqual({
      code: 'AI_UNAVAILABLE',
      message: 'The AI model returned an answer Plate could not use. Try rephrasing.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(usageRows()).toEqual([
      { feature: 'estimate_food', input_tokens: 20, output_tokens: 10, ok: 0 },
    ]);
    // Neither request carried the key anywhere but the header.
    for (const call of [0, 1]) {
      expect(rawRequest(fetchMock, call).replace(`"x-goog-api-key":"${KEY}"`, '')).not.toContain(
        KEY,
      );
    }
  });

  it('honours AI_BASE_URL for a Gemini-compatible proxy', async () => {
    await ctx.close();
    await start({
      aiProvider: 'gemini',
      aiApiKey: KEY,
      aiModel: 'gemini-3.8-flash',
      aiBaseUrl: 'https://proxy.example.test/gemini',
    });
    const fetchMock = stubFetch(() => Promise.resolve(geminiAnswer(ESTIMATE)));
    expect((await estimate()).statusCode).toBe(200);
    expect(urlOf(fetchMock)).toBe(
      'https://proxy.example.test/gemini/v1beta/models/gemini-3.8-flash:generateContent',
    );
  });
});

// ---------- OpenAI-compatible ----------

const chatAnswer = (
  content: unknown,
  usage: Record<string, number> | null = { prompt_tokens: 7, completion_tokens: 4 },
) =>
  json({
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    ...(usage ? { usage } : {}),
  });

describe('openai_compatible driver', () => {
  beforeEach(() =>
    start({
      aiProvider: 'openai_compatible',
      aiApiKey: KEY,
      aiModel: 'qwen-plus',
      aiBaseUrl: 'https://example.test/v1',
    }),
  );

  it('posts to chat/completions with a Bearer key, a system message and strict json_schema', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(chatAnswer(JSON.stringify(ESTIMATE))));
    const res = await estimate();
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<AiEstimateFoodResponse>()).toEqual(ESTIMATE);
    expect(res.headers['x-ai-model']).toBe('qwen-plus');

    expect(urlOf(fetchMock)).toBe('https://example.test/v1/chat/completions');
    expect(headersOf(fetchMock).authorization).toBe(`Bearer ${KEY}`);
    const body = bodyOf(fetchMock) as {
      model: string;
      messages: { role: string; content: unknown }[];
      response_format: { type: string; json_schema: Record<string, unknown> };
      max_tokens: number;
    };
    expect(body.model).toBe('qwen-plus');
    expect(body.messages[0]!.role).toBe('system');
    expect(body.messages[0]!.content).toMatch(/JSON/);
    expect(body.messages[1]!.role).toBe('user');
    expect(body.messages[1]!.content).toEqual([
      { type: 'text', text: expect.stringContaining('Food: Sambar') as string },
    ]);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.name).toBe('estimate_food');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect((body.response_format.json_schema.schema as { type: string }).type).toBe('object');
    expect(body.max_tokens).toBe(4096);
    expect(urlOf(fetchMock)).not.toContain(KEY);
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(usageRows()).toEqual([
      { feature: 'estimate_food', input_tokens: 7, output_tokens: 4, ok: 1 },
    ]);
  });

  it('sends a photo as an image_url data URL', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(chatAnswer(JSON.stringify(FAKE_RESPONSES.parse_meal))),
    );
    const res = await parseMealWithPhoto();
    expect(res.statusCode, res.body).toBe(200);
    const body = bodyOf(fetchMock) as { messages: { content: Record<string, unknown>[] }[] };
    expect(body.messages[1]!.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${TINY_PNG}` },
    });
  });

  it('falls back to json_object when the server rejects json_schema, and remembers it', async () => {
    const fetchMock = stubSequence(
      () =>
        Promise.resolve(
          json(
            {
              error: {
                message: 'response_format json_schema is not supported',
                type: 'invalid_request_error',
              },
            },
            400,
          ),
        ),
      () => Promise.resolve(chatAnswer(JSON.stringify(ESTIMATE))),
    );
    const res = await estimate();
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['x-ai-retried']).toBe('0');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = bodyOf(fetchMock, 1) as {
      messages: { role: string; content: string }[];
      response_format: { type: string };
    };
    expect(second.response_format).toEqual({ type: 'json_object' });
    expect(second.messages[0]!.content).toContain('Return JSON matching this schema:');
    expect(second.messages[0]!.content).toContain('"type":"object"');
    // The same server never sees the failing attempt again.
    expect((await estimate()).statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((bodyOf(fetchMock, 2) as { response_format: unknown }).response_format).toEqual({
      type: 'json_object',
    });
    expect(usageRows().map((r) => r.ok)).toEqual([1, 1]);
  });

  it('does not fall back on an unrelated 400', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(json({ error: { message: 'model qwen-plus does not exist' } }, 400)),
    );
    const res = await estimate();
    expect(res.statusCode).toBe(502);
    expect(res.json<ApiError>().error.message).toBe(
      'The AI provider rejected the request (400): model qwen-plus does not exist',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('joins content parts, treats an empty answer as empty, and maps a timeout', async () => {
    stubFetch(() =>
      Promise.resolve(
        chatAnswer([
          { type: 'text', text: JSON.stringify(ESTIMATE).slice(0, 20) },
          { type: 'text', text: JSON.stringify(ESTIMATE).slice(20) },
        ]),
      ),
    );
    expect((await estimate()).statusCode).toBe(200);

    vi.unstubAllGlobals();
    stubFetch(() =>
      Promise.resolve(json({ choices: [{ message: { content: null }, finish_reason: 'length' }] })),
    );
    let res = await estimate();
    expect(res.statusCode).toBe(502);
    expect(res.json<ApiError>().error.message).toBe(
      'The AI provider returned an empty answer (length).',
    );

    vi.unstubAllGlobals();
    stubFetch(() => Promise.reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    res = await estimate();
    expect(res.statusCode).toBe(502);
    expect(res.json<ApiError>().error.message).toMatch(/did not respond within 30 s/);
  });
});

function mock(fetchMock: FetchMock, call = 0): { init: RequestInit } {
  return { init: fetchMock.mock.calls[call]?.[1] ?? {} };
}
