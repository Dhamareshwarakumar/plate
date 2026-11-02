import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';
import { SessionStore } from '../src/auth/sessions.js';
import type { AppConfig } from '../src/config.js';
import { openDb, type OpenedDb } from '../src/db/index.js';

export const TEST_PASSWORD = 'test-password-1';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    databasePath: ':memory:',
    migrationsDir: undefined,
    initialPassword: TEST_PASSWORD,
    trustProxy: false,
    cookieSecure: 'auto',
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
    webDistDir: undefined,
    logLevel: 'silent',
    offLookupEnabled: true,
    offUserAgent: 'Plate/test',
    ...overrides,
  };
}

export interface TestContext {
  app: FastifyInstance;
  opened: OpenedDb;
  config: AppConfig;
  close: () => Promise<void>;
}

/** Fresh in-memory database, migrated and bootstrapped, wrapped in a ready app instance. */
export async function createTestApp(
  overrides: Partial<AppConfig> = {},
  appOverrides: { rateLimitMax?: number } = {},
): Promise<TestContext> {
  const config = testConfig(overrides);
  const opened = openDb({ path: ':memory:' });
  const auth = new AuthService(opened.db, new SessionStore(opened.db, config.sessionTtlMs));
  await auth.bootstrap(config.initialPassword);
  const app = await buildApp({
    config,
    db: opened.db,
    sqlite: opened.sqlite,
    logger: false,
    ...appOverrides,
  });
  await app.ready();
  return {
    app,
    opened,
    config,
    close: async () => {
      await app.close();
      opened.close();
    },
  };
}

/** Logs in and returns the Cookie header value to send on later requests. */
export async function login(app: FastifyInstance, password = TEST_PASSWORD): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  }
  const cookie = res.cookies.find((c) => c.name === 'plate_session');
  if (!cookie) throw new Error('no session cookie set');
  return `${cookie.name}=${cookie.value}`;
}
