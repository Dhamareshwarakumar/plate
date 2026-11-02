// Phase 9 empty / loading / error audit: node tools/shots/phase9-states.mjs
// Starts a throw-away production API (node apps/api/dist/server.js, temp SQLite, fresh database) on a
// free port serving apps/web/dist, then captures every screen in three states:
//   empty    fresh database, nothing routed
//   loading  every /api request except the session probe is held open (skeletons)
//   error    every /api request except the session probe is aborted (error states + Try again)
// plus the unreachable shell (session probe aborted too), Login and 404. Phone (iPhone 14, 2x) for
// everything, desktop (1440×900) for Today, Foods and Insights. SKIP_BUILD=1 reuses the dist folders.
// Expected console lines: `Failed to load resource: net::ERR_FAILED` for the aborted requests.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PASSWORD = 'password';
const DIR = '/tmp/plate-shots';
const out = (name) => `${DIR}/phase9-${name}.png`;
mkdirSync(DIR, { recursive: true });

const PHONE = { ...devices['iPhone 14'], deviceScaleFactor: 2 };
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const SESSION = /\/api\/auth\/session/;

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
      if ((await fetch(`${base}/api/health`)).ok) return;
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

const tmp = mkdtempSync(join(tmpdir(), 'plate-states-'));
const port = await freePort();
const BASE = `http://127.0.0.1:${port}`;
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
    WEB_DIST_DIR: join(ROOT, 'apps/web/dist'),
    LOG_LEVEL: 'warn',
    OFF_LOOKUP_ENABLED: 'false',
  },
});

const browser = await chromium.launch({ channel: 'chrome' });
let cookie;

const wire = (page) => {
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && !text.includes('401') && !text.includes('net::ERR_FAILED'))
      console.log('CONSOLE', text.slice(0, 200));
  });
};

/** New context with the session cookie, optional network behaviour for /api. */
async function open(options, mode) {
  const context = await browser.newContext(options);
  await context.addCookies([cookie]);
  const page = await context.newPage();
  wire(page);
  if (mode === 'loading') {
    await page.route('**/api/**', (route) =>
      SESSION.test(route.request().url()) ? route.continue() : undefined,
    );
  } else if (mode === 'error') {
    await page.route('**/api/**', (route) =>
      SESSION.test(route.request().url()) ? route.continue() : route.abort('failed'),
    );
  } else if (mode === 'unreachable') {
    await page.route('**/api/**', (route) => route.abort('failed'));
  }
  return { context, page };
}

async function shot(page, name, { fullPage = false } = {}) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: out(name), fullPage });
  console.log('shot', name);
}

async function capture(label, path, options, variant, { ready, fullPage } = {}) {
  for (const mode of ['empty', 'loading', 'error']) {
    const { context, page } = await open(options, mode);
    await page.goto(`${BASE}${path}`);
    if (mode === 'empty' && ready) await ready(page);
    if (mode === 'loading') await page.locator('[aria-busy="true"]').first().waitFor();
    if (mode === 'error') await page.getByRole('alert').first().waitFor();
    await shot(page, `${label}-${mode}-${variant}`, { fullPage: fullPage && mode === 'empty' });
    if (mode === 'error') {
      // Every error state must offer a retry.
      const retry = page.getByRole('button', { name: 'Try again' });
      if ((await retry.count()) === 0) console.log('MISSING RETRY on', label);
    }
    await context.close();
  }
}

try {
  await waitForHealth(BASE);

  // Session cookie once; every context reuses it.
  {
    const context = await browser.newContext(PHONE);
    const page = await context.newPage();
    const res = await page.request.post(`${BASE}/api/auth/login`, { data: { password: PASSWORD } });
    if (!res.ok()) throw new Error(`login ${res.status()}`);
    cookie = (await context.cookies()).find((c) => c.name === 'plate_session');
    await context.close();
  }

  // ---------- fresh database: every screen, phone ----------
  const summaryReady = (page) => page.getByRole('region', { name: 'Day summary' }).waitFor();
  await capture('today', '/today', PHONE, 'phone', { ready: summaryReady });
  await capture('foods', '/foods', PHONE, 'phone');
  await capture('dishes', '/foods?tab=dishes', PHONE, 'phone');
  await capture('meals', '/foods?tab=meals', PHONE, 'phone');
  await capture('insights', '/insights', PHONE, 'phone', { fullPage: true });
  await capture('weight', '/weight', PHONE, 'phone');
  await capture('more', '/more', PHONE, 'phone', { fullPage: true });
  await capture('categories', '/more/categories', PHONE, 'phone');
  await capture('meal-slots', '/more/meal-slots', PHONE, 'phone');

  // New-item editors have no data to load: empty form only, plus the categories query failing.
  for (const [label, path] of [
    ['food-editor-new', '/foods/new'],
    ['dish-editor-new', '/foods/dishes/new'],
    ['meal-editor-new', '/foods/meals/new'],
  ]) {
    for (const mode of ['empty', 'error']) {
      const { context, page } = await open(PHONE, mode);
      await page.goto(`${BASE}${path}`);
      if (mode === 'error') await page.getByRole('alert').first().waitFor();
      else await page.getByRole('heading', { level: 2 }).first().waitFor();
      await shot(page, `${label}-${mode}-phone`, { fullPage: mode === 'empty' });
      await context.close();
    }
  }

  // ---------- desktop: Today, Foods, Insights ----------
  await capture('today', '/today', DESKTOP, 'desktop', { ready: summaryReady });
  await capture('foods', '/foods', DESKTOP, 'desktop');
  await capture('insights', '/insights', DESKTOP, 'desktop');

  // ---------- shell, login, 404 ----------
  for (const [variant, options] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ]) {
    const { context, page } = await open(options, 'unreachable');
    await page.goto(`${BASE}/today`);
    await page.getByRole('alert').getByText("Can't reach Plate").waitFor();
    await shot(page, `shell-unreachable-${variant}`);
    await context.close();
  }
  {
    const context = await browser.newContext(PHONE);
    const page = await context.newPage();
    wire(page);
    await page.goto(`${BASE}/login`);
    await page.getByRole('button', { name: 'Sign in' }).waitFor();
    await shot(page, 'login-empty-phone');
    await page.getByLabel('Password', { exact: true }).fill('wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('alert').first().waitFor();
    await shot(page, 'login-error-phone');
    await page.goto(`${BASE}/nowhere/at/all`);
    await page.getByText("This page doesn't exist").waitFor();
    await shot(page, 'not-found-phone');
    await context.close();
  }

  // ---------- editors of existing items: loading + error need an id ----------
  {
    const context = await browser.newContext(PHONE);
    await context.addCookies([cookie]);
    const page = await context.newPage();
    const call = async (method, path, data) => {
      const res = await page.request.fetch(`${BASE}/api${path}`, {
        method,
        ...(data ? { data } : {}),
      });
      if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
      return res.json();
    };
    const per100 = { kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 };
    const nulls = { fiber: null, sugar: null, saturatedFat: null, sodiumMg: null };
    const banana = await call('POST', '/foods', {
      name: 'Banana',
      per100: { ...per100, ...nulls },
    });
    const dish = await call('POST', '/dishes', {
      name: 'Banana mash',
      cookedWeight: 200,
      servings: 2,
      ingredients: [{ foodId: banana.id, amount: 240 }],
    });
    const meal = await call('POST', '/meal-templates', {
      name: 'Breakfast bowl',
      items: [{ foodId: banana.id, amount: 118 }],
    });
    await context.close();
    for (const [label, path] of [
      ['food-editor', `/foods/${banana.id}`],
      ['dish-editor', `/foods/dishes/${dish.id}`],
      ['meal-editor', `/foods/meals/${meal.id}`],
    ]) {
      for (const mode of ['empty', 'loading', 'error']) {
        const { context: ctx, page: p } = await open(PHONE, mode);
        await p.goto(`${BASE}${path}`);
        if (mode === 'loading') await p.locator('[aria-busy="true"]').first().waitFor();
        if (mode === 'error') await p.getByRole('alert').first().waitFor();
        if (mode === 'empty') await p.getByLabel('Name', { exact: true }).waitFor();
        await shot(p, `${label}-${mode === 'empty' ? 'loaded' : mode}-phone`);
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
  api.kill('SIGTERM');
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`done → ${DIR}/phase9-*.png`);
