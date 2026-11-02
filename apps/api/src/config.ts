import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { APP_VERSION } from './version.js';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

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
  };
}
