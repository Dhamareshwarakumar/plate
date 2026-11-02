// End-to-end runner: pnpm e2e [playwright args…]
// Builds shared → api → web, picks a free loopback port and a throw-away database directory, then
// runs the Playwright suite in apps/web/e2e; its webServer starts the production API
// (node apps/api/dist/server.js) against those. The temp directory is removed afterwards.
// SKIP_BUILD=1 reuses the existing dist folders. Needs Google Chrome (channel: 'chrome').
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolvePromise(code ?? (signal ? 1 : 0)));
  });
}

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePromise(port));
    });
  });
}

if (process.env.SKIP_BUILD !== '1') {
  const built = await run('pnpm', ['-r', 'build']);
  if (built !== 0) process.exit(built);
}

const port = await freePort();
const dataDir = mkdtempSync(join(tmpdir(), 'plate-e2e-'));
console.log(`e2e: API on http://127.0.0.1:${port}, database in ${dataDir}`);

let code = 1;
try {
  code = await run(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      '--config',
      'apps/web/e2e/playwright.config.ts',
      ...process.argv.slice(2),
    ],
    {
      env: {
        ...process.env,
        PLATE_E2E_PORT: String(port),
        PLATE_E2E_DB: join(dataDir, 'plate.db'),
      },
    },
  );
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(code);
