// Phase 9 UI verification: node tools/shots/phase9-polish.mjs
// Against the dev servers (API :8080, web :5173): the keyboard shortcuts help (desktop light + dark),
// the focus ring back on "Log food" after Escape closes the log sheet, the "Can't reach Plate" shell
// (phone dark + desktop) and the Today cold-load skeleton (phone).
// The "update available" toast needs a real service worker, which only the production build has:
// the script starts a throw-away production API on a free port serving a copy of apps/web/dist,
// lets the worker claim the page, appends a byte to the copy's sw.js, asks the registration to
// update and screenshots the toast (phone dark + desktop light), then presses Update and logs that
// the page reloaded. SKIP_BUILD=1 reuses the existing dist folders.
import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DEV_BASE = 'http://127.0.0.1:5173';
const PASSWORD = process.env.PLATE_PASSWORD ?? 'password';
const DIR = '/tmp/plate-shots';
const out = (name) => `${DIR}/${name}.png`;
mkdirSync(DIR, { recursive: true });

const PHONE = { ...devices['iPhone 14'], deviceScaleFactor: 2 };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

const wire = (page) => {
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('401'))
      console.log('CONSOLE', m.text().slice(0, 200));
  });
};

async function loginApi(page, base) {
  const res = await page.request.post(`${base}/api/auth/login`, { data: { password: PASSWORD } });
  if (!res.ok()) throw new Error(`login ${res.status()} ${await res.text()}`);
}

const browser = await chromium.launch({ channel: 'chrome' });

// ---------- shortcuts help: desktop light + dark ----------
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ ...DESKTOP, colorScheme: scheme });
  const page = await context.newPage();
  wire(page);
  await loginApi(page, DEV_BASE);
  await page.goto(`${DEV_BASE}/today`);
  await page.getByRole('region', { name: 'Day summary' }).waitFor();
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await help.waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out(`phase9-shortcuts-desktop-${scheme}`) });
  console.log(`shortcuts help (${scheme}): open via ?`);
  await page.keyboard.press('Escape');
  await help.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Shortcuts' }).click();
  await help.waitFor();
  console.log(`shortcuts help (${scheme}): open via sidebar button`);
  await context.close();
}

// ---------- focus returns to the sidebar "Log food" link after Escape ----------
{
  const context = await browser.newContext({ ...DESKTOP, colorScheme: 'light' });
  const page = await context.newPage();
  wire(page);
  await loginApi(page, DEV_BASE);
  await page.goto(`${DEV_BASE}/today`);
  await page.getByRole('region', { name: 'Day summary' }).waitFor();
  const logLink = page.getByRole('link', { name: 'Log food' });
  // Keyboard-driven: Tab to the link so :focus-visible applies when focus comes back.
  await logLink.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Log food' });
  await sheet.waitFor();
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
  console.log('after Escape, focus is on:', JSON.stringify(focused));
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('phase9-focus-return-desktop') });
  await context.close();
}

// ---------- "Can't reach Plate": phone dark + desktop light ----------
for (const [name, options] of [
  ['phone-dark', { ...PHONE, colorScheme: 'dark' }],
  ['desktop', { ...DESKTOP, colorScheme: 'light' }],
]) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  wire(page);
  await loginApi(page, DEV_BASE);
  await page.route('**/api/**', (route) => route.abort('connectionfailed'));
  await page.goto(`${DEV_BASE}/today`);
  await page.getByRole('alert').getByText("Can't reach Plate").waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: out(`phase9-unreachable-${name}`) });
  await page.unroute('**/api/**');
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('region', { name: 'Day summary' }).waitFor();
  console.log(`unreachable (${name}): error state shown, Try again recovered`);
  await context.close();
}

// ---------- Today cold-load skeleton (phone): the day request is held open ----------
{
  const context = await browser.newContext({ ...PHONE, colorScheme: 'light' });
  const page = await context.newPage();
  wire(page);
  await loginApi(page, DEV_BASE);
  await page.route('**/api/**', (route) => {
    if (/\/api\/auth\/session/.test(route.request().url())) return route.continue();
    return undefined; // held: the page keeps its skeletons
  });
  await page.goto(`${DEV_BASE}/today`);
  await page.locator('[aria-busy="true"]').first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('phase9-today-skeleton-phone') });
  console.log('today skeleton (phone): captured while /api/diary is pending');
  await context.close();
}

// ---------- update toast: production build + real service worker ----------
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => resolveRun(code ?? 1));
  });
}

async function waitForHealth(base) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`production API at ${base} did not come up`);
}

if (process.env.SKIP_BUILD !== '1') {
  const code = await run('pnpm', ['-r', 'build']);
  if (code !== 0) throw new Error(`pnpm -r build exited ${code}`);
}
const tmp = mkdtempSync(join(tmpdir(), 'plate-polish-'));
const distCopy = join(tmp, 'web');
cpSync(join(ROOT, 'apps/web/dist'), distCopy, { recursive: true });
const port = await freePort();
const PROD_BASE = `http://127.0.0.1:${port}`;
const api = spawn('node', ['apps/api/dist/server.js'], {
  cwd: ROOT,
  stdio: ['ignore', 'ignore', 'inherit'],
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATABASE_PATH: join(tmp, 'plate.db'),
    APP_INITIAL_PASSWORD: PASSWORD,
    WEB_DIST_DIR: distCopy,
    LOG_LEVEL: 'warn',
    OFF_LOOKUP_ENABLED: 'false',
  },
});
try {
  await waitForHealth(PROD_BASE);
  for (const [name, options] of [
    ['phone-dark', { ...PHONE, colorScheme: 'dark' }],
    ['desktop-light', { ...DESKTOP, colorScheme: 'light' }],
  ]) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    wire(page);
    await loginApi(page, PROD_BASE);
    await page.goto(`${PROD_BASE}/today`);
    await page.getByRole('region', { name: 'Day summary' }).waitFor();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (navigator.serviceWorker.controller) return;
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }),
      );
    });
    // A byte-different sw.js is "a new version"; the registration finds it on update().
    appendFileSync(join(distCopy, 'sw.js'), `\n// build ${Date.now()}\n`);
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
    });
    const toast = page.getByText('A new version of Plate is available');
    await toast.waitFor({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: out(`phase9-update-toast-${name}`) });
    await page.evaluate(() => {
      window.__plateMarker = true;
    });
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: 'Update' }).click(),
    ]);
    const reloaded = await page.evaluate(() => window.__plateMarker === undefined);
    await page.getByRole('region', { name: 'Day summary' }).waitFor();
    console.log(`update toast (${name}): shown; Update reloaded the page: ${reloaded}`);
    await context.close();
  }
} finally {
  api.kill('SIGTERM');
  rmSync(tmp, { recursive: true, force: true });
}

await browser.close();
console.log(`done → ${DIR}/phase9-*.png`);
