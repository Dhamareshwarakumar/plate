import {
  AI_MAX_IMAGE_BYTES_DEFAULT,
  aiProviderKindSchema,
  type AiProviderKind,
} from '@plate/shared';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { APP_VERSION } from './version.js';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/**
 * Optional variables that compose passes through as `${VAR:-}`: an empty string means "not set", so
 * it must behave exactly like an absent variable (defaults apply, nothing is validated).
 */
const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

/**
 * Current Gemini Flash model, checked against https://ai.google.dev/gemini-api/docs/models on
 * 2026-11-02 ("Gemini 3.8 Flash, gemini-3.8-flash, stable"). `AI_MODEL` overrides it.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
/** The fake driver's model name, reported by `GET about` and the `x-ai-model` header. */
export const FAKE_AI_MODEL = 'fake-1';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  /**
   * Loopback by default: nothing is reachable from other machines unless explicitly asked for.
   * The Docker image sets HOST=0.0.0.0 because there the container network is the boundary and
   * exposure is decided by the compose `ports:` mapping.
   */
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_PATH: z.string().min(1).default('./data/plate.db'),
  /** Directory containing drizzle migrations. Defaults to <package>/drizzle. */
  MIGRATIONS_DIR: z.string().min(1).optional(),
  /** Used only when no password hash exists yet (first start, or `reset-password`). */
  APP_INITIAL_PASSWORD: z.string().optional(),
  APP_INITIAL_PASSWORD_FILE: z.string().optional(),
  /** Set to true only when a reverse proxy in front of the app sets X-Forwarded-* headers. */
  TRUST_PROXY: booleanString.default(false),
  /** auto = Secure flag when the request arrived over HTTPS (directly or via trusted proxy). */
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Directory with the built web app. When unset, only the API is served. */
  WEB_DIST_DIR: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /**
   * The optional "Search online" proxy to Open Food Facts (FR-F5). false = the app makes no
   * outbound network calls at all (NFR-7).
   */
  OFF_LOOKUP_ENABLED: booleanString.default(true),
  /** Identifies this install to Open Food Facts; defaults to `Plate/<version> (self-hosted diet ledger)`. */
  OFF_USER_AGENT: z.string().min(1).optional(),
  /**
   * VAPID "subject" sent to push services with every reminder (FR-N3): a `mailto:` address or an
   * `https:` URL they could use to contact the operator. Any syntactically valid value works.
   */
  PUSH_VAPID_SUBJECT: z
    .string()
    .regex(/^(mailto:.+|https:\/\/.+)$/, 'must be a mailto: address or an https: URL')
    .default('mailto:plate@localhost'),
  /**
   * AI assistance (Phase 11). `none` (default) = the feature is hidden and every AI route answers
   * 404 "AI assistance is disabled". `gemini` and `openai_compatible` need `AI_API_KEY`;
   * `openai_compatible` also needs `AI_BASE_URL` and `AI_MODEL`. `fake` is dev/test only: canned
   * answers, no key, no network; opt-in by this exact value and never a default.
   */
  AI_PROVIDER: z.preprocess(emptyToUndefined, aiProviderKindSchema.default('none')),
  /** Provider API key. Sent only to the provider, in a header; never logged, never in `GET about`. */
  AI_API_KEY: optionalString,
  /** Model name; defaults to `DEFAULT_GEMINI_MODEL` for gemini and is required for openai_compatible. */
  AI_MODEL: optionalString,
  /** OpenAI-compatible only: the API root the `/chat/completions` path is appended to. */
  AI_BASE_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .url()
      .regex(/^https?:\/\//, 'must be an http(s) URL')
      .transform((v) => v.replace(/\/+$/, ''))
      .optional(),
  ),
  /** Per-call timeout for the provider request. */
  AI_TIMEOUT_MS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1000).max(300_000).default(30_000),
  ),
  /** Largest decoded meal photo accepted by `POST ai/parse-meal`. */
  AI_MAX_IMAGE_BYTES: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number()
      .int()
      .min(64 * 1024)
      .max(20 * 1024 * 1024)
      .default(AI_MAX_IMAGE_BYTES_DEFAULT),
  ),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  nodeEnv: Env['NODE_ENV'];
  host: string;
  port: number;
  databasePath: string;
  migrationsDir: string | undefined;
  /** Resolved bootstrap password (from file or env), or undefined when neither is configured. */
  initialPassword: string | undefined;
  trustProxy: boolean;
  cookieSecure: 'auto' | 'true' | 'false';
  sessionTtlMs: number;
  webDistDir: string | undefined;
  logLevel: Env['LOG_LEVEL'];
  offLookupEnabled: boolean;
  offUserAgent: string;
  pushVapidSubject: string;
  /** AI assistance (Phase 11); `none` disables the feature and the routes. */
  aiProvider: AiProviderKind;
  aiApiKey: string | undefined;
  /** Configured or defaulted model name; null when the provider is `none`. */
  aiModel: string | null;
  aiBaseUrl: string | undefined;
  aiTimeoutMs: number;
  aiMaxImageBytes: number;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

function readInitialPassword(env: Env): string | undefined {
  if (env.APP_INITIAL_PASSWORD_FILE) {
    let raw: string;
    try {
      raw = readFileSync(env.APP_INITIAL_PASSWORD_FILE, 'utf8');
    } catch (err) {
      throw new ConfigError(
        `APP_INITIAL_PASSWORD_FILE points to ${env.APP_INITIAL_PASSWORD_FILE} but it could not be read: ${
          (err as Error).message
        }`,
      );
    }
    // Secret files commonly end with a newline that is not part of the password.
    const value = raw.replace(/\r?\n$/, '');
    return value.length > 0 ? value : undefined;
  }
  const value = env.APP_INITIAL_PASSWORD;
  return value !== undefined && value.length > 0 ? value : undefined;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;
  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    databasePath: env.DATABASE_PATH,
    migrationsDir: env.MIGRATIONS_DIR,
    initialPassword: readInitialPassword(env),
    trustProxy: env.TRUST_PROXY,
    cookieSecure: env.COOKIE_SECURE,
    sessionTtlMs: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    webDistDir: env.WEB_DIST_DIR,
    logLevel: env.LOG_LEVEL,
    offLookupEnabled: env.OFF_LOOKUP_ENABLED,
    offUserAgent: env.OFF_USER_AGENT ?? `Plate/${APP_VERSION} (self-hosted diet ledger)`,
    pushVapidSubject: env.PUSH_VAPID_SUBJECT,
    aiProvider: env.AI_PROVIDER,
    aiApiKey: env.AI_API_KEY,
    aiModel: resolveAiModel(env),
    aiBaseUrl: env.AI_BASE_URL,
    aiTimeoutMs: env.AI_TIMEOUT_MS,
    aiMaxImageBytes: env.AI_MAX_IMAGE_BYTES,
  };
}

/** The model per provider, after checking the variables each real provider cannot run without. */
function resolveAiModel(env: Env): string | null {
  switch (env.AI_PROVIDER) {
    case 'none':
      return null;
    case 'fake':
      return FAKE_AI_MODEL;
    case 'gemini':
      if (!env.AI_API_KEY) throw new ConfigError('AI_PROVIDER=gemini needs AI_API_KEY');
      return env.AI_MODEL ?? DEFAULT_GEMINI_MODEL;
    case 'openai_compatible':
      if (!env.AI_API_KEY) throw new ConfigError('AI_PROVIDER=openai_compatible needs AI_API_KEY');
      if (!env.AI_BASE_URL) {
        throw new ConfigError(
          'AI_PROVIDER=openai_compatible needs AI_BASE_URL (e.g. https://openrouter.ai/api/v1)',
        );
      }
      if (!env.AI_MODEL) throw new ConfigError('AI_PROVIDER=openai_compatible needs AI_MODEL');
      return env.AI_MODEL;
  }
}
