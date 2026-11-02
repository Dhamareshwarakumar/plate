import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_PASSWORD } from './constants';

/**
 * End-to-end tests against the production build: `node apps/api/dist/server.js` serving
 * `apps/web/dist` with a throw-away SQLite file. `pnpm e2e` (tools/e2e.mjs) builds both, picks a
 * free port and sets PLATE_E2E_PORT / PLATE_E2E_DB; run directly, this file falls back to port
 * 4273 and a temp directory of its own.
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const apiDir = resolve(here, '../../api');
const webDist = resolve(here, '../dist');

const port = Number(process.env.PLATE_E2E_PORT ?? 4273);
const baseURL = `http://127.0.0.1:${port}`;
const dbPath =
  process.env.PLATE_E2E_DB ?? join(mkdtempSync(join(tmpdir(), 'plate-e2e-')), 'plate.db');

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // The locally installed Google Chrome, like tools/shots (no browser download needed).
    channel: 'chrome',
  },
  webServer: {
    command: 'node dist/server.js',
    cwd: apiDir,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: dbPath,
      APP_INITIAL_PASSWORD: E2E_PASSWORD,
      WEB_DIST_DIR: webDist,
      LOG_LEVEL: 'warn',
      OFF_LOOKUP_ENABLED: 'false',
    },
  },
  projects: [
    {
      // The primary target (DESIGN §1): an iPhone-sized Chrome with touch emulation.
      name: 'phone',
      use: { ...devices['iPhone 14'], browserName: 'chromium' },
      testIgnore: /keyboard\.spec\.ts/,
    },
    {
      // Desktop-only behaviour: keyboard shortcuts, focus return, sidebar.
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testMatch: /keyboard\.spec\.ts/,
    },
  ],
});
