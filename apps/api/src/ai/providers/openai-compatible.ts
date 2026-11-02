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

/** The slice of a `chat/completions` response the driver reads. */
interface ChatCompletionResponse {
  choices?: {
    message?: { content?: string | { type?: string; text?: string }[] | null };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

type ResponseFormat =
  | { type: 'json_schema'; json_schema: { name: string; schema: unknown; strict: true } }
  | { type: 'json_object' };

/**
 * Driver for any server speaking the OpenAI chat-completions dialect (OpenRouter, DashScope's
 * compatible mode, Moonshot, a local llama.cpp…): `POST <AI_BASE_URL>/chat/completions` with a
 * Bearer key. Structured output through `response_format: json_schema` (strict); when the server
 * answers 400 about that field the call is retried with `json_object` and the schema pasted into
 * the system message, and the instance remembers to skip the failing attempt from then on.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly kind = 'openai_compatible' as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly logger: AiProviderLogger | undefined;
  /** Set once the server rejected `json_schema`; later calls go straight to `json_object`. */
  private jsonSchemaUnsupported = false;

  constructor(options: HttpProviderOptions & { baseUrl: string }) {
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.logger = options.logger;
  }

  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    if (!this.jsonSchemaUnsupported) {
      try {
        return await this.send(req, {
          type: 'json_schema',
          json_schema: { name: req.feature, schema: req.jsonSchema, strict: true },
        });
      } catch (err) {
        if (!isJsonSchemaRejection(err)) throw err;
        this.jsonSchemaUnsupported = true;
        this.logger?.warn(
          { feature: req.feature },
          'ai provider rejected response_format json_schema; falling back to json_object',
        );
      }
    }
    return this.send(req, { type: 'json_object' });
  }

  private async send(
    req: AiCompletionRequest,
    responseFormat: ResponseFormat,
  ): Promise<AiCompletionResult> {
    const system =
      responseFormat.type === 'json_object'
        ? `${req.system}\nReturn JSON matching this schema:\n${JSON.stringify(req.jsonSchema)}`
        : req.system;
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: req.parts.map((part) =>
            'text' in part
              ? { type: 'text', text: part.text }
              : {
                  type: 'image_url',
                  image_url: { url: `data:${part.mimeType};base64,${part.imageBase64}` },
                },
          ),
        },
      ],
      response_format: responseFormat,
      max_tokens: req.maxOutputTokens,
    };
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
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
    const parsed = parseJson(text) as ChatCompletionResponse | undefined;
    const content = parsed?.choices?.[0]?.message?.content;
    const answer =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((part) => (typeof part.text === 'string' ? part.text : '')).join('')
          : '';
    if (answer.trim().length === 0) {
      const finish = parsed?.choices?.[0]?.finish_reason;
      const error = new AiProviderError(
        'empty',
        finish && finish !== 'stop'
          ? `The AI provider returned an empty answer (${finish}).`
          : 'The AI provider returned an empty answer.',
      );
      this.warn(req, error, started);
      throw error;
    }
    return {
      text: answer,
      inputTokens: parsed?.usage?.prompt_tokens ?? null,
      outputTokens: parsed?.usage?.completion_tokens ?? null,
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

/** A 400 whose detail mentions the structured-output field: the server does not support it. */
function isJsonSchemaRejection(err: unknown): boolean {
  return (
    err instanceof AiProviderError &&
    err.reason === 'http' &&
    err.status === 400 &&
    /response_format|json_schema/i.test(err.message)
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
