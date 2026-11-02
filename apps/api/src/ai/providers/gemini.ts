import {
  AiProviderError,
  isTimeout,
  readBody,
  scrubDetail,
  timeoutError,
  upstreamErrorDetail,
  type AiCompletionRequest,
  type AiCompletionResult,
  type AiProvider,
  type AiProviderLogger,
  type HttpProviderOptions,
} from './types.js';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

/** The slice of a `generateContent` response the driver reads; everything else is ignored. */
interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

/**
 * Gemini API driver (`models/<model>:generateContent`), structured output through
 * `responseMimeType: application/json` + `responseJsonSchema`. The key travels in the
 * `x-goog-api-key` header, never in the URL, so no log line that carries a URL can leak it. Uses
 * the global `fetch` at call time (like the Open Food Facts proxy) so tests can stub it.
 */
export class GeminiProvider implements AiProvider {
  readonly kind = 'gemini' as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly logger: AiProviderLogger | undefined;

  constructor(options: HttpProviderOptions) {
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
    this.baseUrl = (options.baseUrl ?? GEMINI_BASE_URL).replace(/\/+$/, '');
    this.logger = options.logger;
  }

  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [
        {
          role: 'user',
          parts: req.parts.map((part) =>
            'text' in part
              ? { text: part.text }
              : { inlineData: { mimeType: part.mimeType, data: part.imageBase64 } },
          ),
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: req.jsonSchema,
        maxOutputTokens: req.maxOutputTokens,
      },
    };
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'x-goog-api-key': this.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const error = isTimeout(err)
        ? timeoutError(this.timeoutMs)
        : new AiProviderError('network', 'Could not reach the AI provider.');
      this.warn(req, error, started);
      throw error;
    }
    const text = await readBody(response, this.timeoutMs);
    if (!response.ok) {
      const detail = scrubDetail(upstreamErrorDetail(text), this.apiKey);
      const error = new AiProviderError('http', detail, response.status);
      this.warn(req, error, started);
      throw error;
    }
    const parsed = parseJson(text) as GeminiResponse | undefined;
    const parts = parsed?.candidates?.[0]?.content?.parts ?? [];
    const answer = parts
      .filter((part) => part.thought !== true && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    if (answer.length === 0) {
      const finish = parsed?.candidates?.[0]?.finishReason;
      const error = new AiProviderError(
        'empty',
        finish && finish !== 'STOP'
          ? `The AI provider returned an empty answer (${finish}).`
          : 'The AI provider returned an empty answer.',
      );
      this.warn(req, error, started);
      throw error;
    }
    const usage = parsed?.usageMetadata;
    return {
      text: answer,
      inputTokens: usage?.promptTokenCount ?? null,
      // Thinking tokens are billed and count against maxOutputTokens, so they belong to the output.
      outputTokens: usage
        ? (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)
        : null,
    };
  }

  /** Never the URL, headers or bodies: the status and the classification are enough to debug. */
  private warn(req: AiCompletionRequest, error: AiProviderError, started: number): void {
    this.logger?.warn(
      {
        feature: req.feature,
        reason: error.reason,
        status: error.status ?? null,
        durationMs: Date.now() - started,
      },
      'ai provider request failed',
    );
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
