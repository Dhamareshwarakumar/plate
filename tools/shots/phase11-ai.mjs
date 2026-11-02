// Phase 11 AI assistance: SKIP_BUILD=1 node tools/shots/phase11-ai.mjs
// Starts a throw-away production API (node apps/api/dist/server.js, temp SQLite, fresh database) on a
// free port with AI_PROVIDER=fake, so every AI state is reachable without a key and nothing touches the
// dev servers or apps/api/.env. Seeds a small library, a goal and a few entries of the current week,
// then captures: the log sheet's Sparkles button, the "Describe or photograph" sheet (compose, photo
// attached, analysing, review, pick a food, after picking, logged, error, empty), the food editor's
// "Estimate with AI" (button, idle, result, prefilled with the notice, "Estimated" tag in the list),
// the dish editor's "Paste a recipe" (result, applied form with "New food" tags, saved dish), the
// Insights week digest (Generate, generating, generated), the More card (enabled, disabled) and four
// desktop shots. PNGs /tmp/plate-shots/phase11-NN-<name>.png. Without SKIP_BUILD=1 it runs
// `pnpm -r build` first. The one `Failed to load resource: ... 502` console line is the error-state
// shot and is expected.
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
let counter = 0;
const out = (name) => `${DIR}/phase11-${String(++counter).padStart(2, '0')}-${name}.png`;
mkdirSync(DIR, { recursive: true });

const PHONE = { ...devices['iPhone 14'], deviceScaleFactor: 2 };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const TODAY = dayKey(now);
const daysAgo = (n) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
// Monday of the current week (the fresh database has the default week start).
const mondayOffset = (now.getDay() + 6) % 7;
const WEEK_START = daysAgo(mondayOffset);
function offsetOf(d) {
  const m = -d.getTimezoneOffset();
  const sign = m >= 0 ? '+' : '-';
  return `${sign}${pad(Math.floor(Math.abs(m) / 60))}:${pad(Math.abs(m) % 60)}`;
}
const at = (day, hhmm) => `${day}T${hhmm}:00${offsetOf(now)}`;

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

const tmp = mkdtempSync(join(tmpdir(), 'plate-ai-shots-'));
const port = await freePort();
const BASE = `http://127.0.0.1:${port}`;
// The production server reads only its environment (never apps/api/.env); the empty strings make
// sure nothing AI-related from the shell leaks in, and `fake` needs no key.
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
    AI_PROVIDER: 'fake',
    AI_API_KEY: '',
    AI_MODEL: '',
    AI_BASE_URL: '',
  },
});

const browser = await chromium.launch({ channel: 'chrome' });
let cookie;

const wire = (page) => {
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && !text.includes('401')) console.log('CONSOLE', text.slice(0, 200));
  });
};

async function open(options) {
  const context = await browser.newContext(options);
  await context.addCookies([cookie]);
  const page = await context.newPage();
  wire(page);
  return { context, page };
}

async function shot(page, name, { fullPage = false } = {}) {
  await page.waitForTimeout(600);
  const path = out(name);
  await page.screenshot({ path, fullPage });
  console.log('shot', path.slice(DIR.length + 1));
}

function apiFor(page) {
  return async (method, path, data) => {
    const res = await page.request.fetch(`${BASE}/api${path}`, {
      method,
      ...(data ? { data } : {}),
    });
    if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
    return res.status() === 204 ? null : res.json();
  };
}

/** Holds one request until `release()` is called (for the "analysing" / "generating" shots). */
function holdRoute(page, pattern, method) {
  let release;
  const held = new Promise((r) => (release = r));
  let finished = Promise.resolve();
  const handler = (route) => {
    if (route.request().method() !== method) return route.continue();
    finished = held.then(() => route.continue());
    return finished;
  };
  return {
    arm: () => page.route(pattern, handler),
    release: async () => {
      release();
      // Let the held handler finish continuing the request before the route is removed.
      await finished;
      await page.unroute(pattern, handler);
    },
  };
}

/** Scrolls the More card with this title to the top of the viewport (full-page shots paint the tab bar over it). */
async function scrollCardIntoView(page, title) {
  await page
    .getByRole('heading', { name: title })
    .locator('..')
    .evaluate((card) => card.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
}

/** A 640×480 "meal" JPEG drawn in the browser, so the photo path (resize + base64) is real. */
async function mealPhoto(page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f4e3c1';
    ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = '#c98a3b';
    ctx.beginPath();
    ctx.ellipse(220, 250, 150, 110, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e7c84a';
    ctx.beginPath();
    ctx.ellipse(450, 220, 110, 90, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5a8f3c';
    ctx.fillRect(380, 330, 160, 60);
    return canvas.toDataURL('image/jpeg', 0.9);
  });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

const per100 = (kcal, protein, carbs, fat) => ({
  kcal,
  protein,
  carbs,
  fat,
  fiber: null,
  sugar: null,
  saturatedFat: null,
  sodiumMg: null,
});

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

  // ---------- seed: Dal must be id 1 (the fake provider's canned match) ----------
  let slots;
  {
    const { context, page } = await open(PHONE);
    const call = apiFor(page);
    const dal = await call('POST', '/foods', { name: 'Dal', per100: per100(116, 9, 20, 0.4) });
    if (dal.id !== 1) throw new Error(`expected Dal to be food 1, got ${dal.id}`);
    const banana = await call('POST', '/foods', {
      name: 'Banana',
      per100: per100(89, 1.1, 22.8, 0.3),
      portions: [{ label: '1 medium', amount: 118 }],
    });
    const rice = await call('POST', '/foods', { name: 'Rice', per100: per100(130, 2.7, 28, 0.3) });
    await call('POST', '/foods', { name: 'Red lentils', per100: per100(350, 24, 60, 1) });
    await call('POST', '/goals', {
      effectiveFrom: daysAgo(14),
      kcal: 2000,
      proteinG: 150,
      carbsG: 220,
      fatG: 65,
    });
    slots = await call('GET', '/meal-slots');
    const slot = (n) => slots.find((s) => s.name === n)?.id ?? slots[0].id;
    // Entries on today and the earlier days of this week (up to three days), for the digest.
    const days = [0, 1, 2].map(daysAgo).filter((d) => d >= WEEK_START);
    for (const day of days) {
      for (const [slotName, hhmm, food, quantity] of [
        ['Breakfast', '08:10', banana, 118],
        ['Lunch', '13:05', rice, 180],
        ['Lunch', '13:06', dal, 200],
        ['Dinner', '19:40', rice, 150],
      ]) {
        await call('POST', '/diary/entries', {
          day,
          slotId: slot(slotName),
          loggedAt: at(day, hhmm),
          foodId: food.id,
          quantity,
          basis: 'g',
          portionLabel: null,
          portionCount: null,
          note: null,
        });
      }
    }
    console.log(`seeded ${days.length} day(s) of entries, week starting ${WEEK_START}`);
    await context.close();
  }

  // ---------- 01–10 log sheet: describe or photograph ----------
  {
    const { context, page } = await open(PHONE);
    await page.goto(`${BASE}/today/${TODAY}`);
    await page.getByRole('region', { name: 'Day summary' }).waitFor();
    await page.locator('button[aria-label="Log food"]').click();
    const sheet = page.getByRole('dialog', { name: 'Log food' });
    await sheet.getByRole('button', { name: 'Describe or photograph' }).waitFor();
    await shot(page, 'log-sheet-sparkles');

    await sheet.getByRole('button', { name: 'Describe or photograph' }).click();
    const ai = page.getByRole('dialog', { name: 'Describe or photograph' });
    await ai.getByRole('button', { name: 'Analyse' }).waitFor();
    console.log(
      'Analyse disabled while empty:',
      await ai.getByRole('button', { name: 'Analyse' }).isDisabled(),
    );
    await shot(page, 'ai-compose-empty');

    await ai.getByLabel('What did you eat?').fill('2 rotis, a bowl of dal and a banana');
    const photo = await mealPhoto(page);
    await ai
      .locator('input[type="file"]')
      .setInputFiles({ name: 'meal.jpg', mimeType: 'image/jpeg', buffer: photo });
    await ai.getByAltText('Meal photo to analyse').waitFor();
    console.log('photo line:', await ai.getByText(/Resized to a JPEG of/).textContent());
    await shot(page, 'ai-compose-text-photo');

    const hold = holdRoute(page, '**/api/ai/parse-meal', 'POST');
    await hold.arm();
    await ai.getByRole('button', { name: 'Analyse' }).click();
    await ai.getByRole('status').filter({ hasText: 'Analysing' }).waitFor();
    await page.waitForTimeout(2100);
    await shot(page, 'ai-analysing');
    await hold.release();

    const review = page.getByRole('dialog', { name: 'Review items' });
    await review.getByRole('button', { name: /^Log \d items?$/ }).waitFor();
    console.log(
      'review rows:',
      (
        await review
          .getByRole('list', { name: 'Recognised items' })
          .getByRole('listitem')
          .allInnerTexts()
      )
        .map((t) => t.replace(/\s+/g, ' ').trim())
        .join(' | '),
    );
    await shot(page, 'ai-review');

    await review.getByRole('button', { name: 'Pick a food' }).click();
    const picker = page.getByRole('dialog', { name: 'Pick a food' });
    await picker.getByRole('button', { name: /^Banana/ }).waitFor();
    await shot(page, 'ai-pick-food');
    await picker.getByRole('button', { name: /^Banana/ }).click();
    await picker.waitFor({ state: 'hidden' });

    const dalQuantity = review.getByLabel('a bowl of dal quantity in g');
    await dalQuantity.fill('150');
    await review.getByRole('button', { name: 'Log 3 items' }).waitFor();
    console.log(
      'totals line:',
      await review
        .getByText(/items? ·/)
        .first()
        .textContent(),
    );
    await shot(page, 'ai-review-picked');

    await review.getByRole('button', { name: 'Log 3 items' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 15_000 });
    await page.getByText('3 items logged').waitFor();
    await page.getByRole('button', { name: /^Edit Roti \(whole wheat\)/ }).waitFor();
    await page.waitForTimeout(1500);
    await shot(page, 'today-after-logging', { fullPage: true });

    // Error state: the fake provider fails on the word "fail".
    await page.locator('button[aria-label="Log food"]').click();
    await page
      .getByRole('dialog', { name: 'Log food' })
      .getByRole('button', { name: 'Describe or photograph' })
      .click();
    const ai2 = page.getByRole('dialog', { name: 'Describe or photograph' });
    await ai2.getByLabel('What did you eat?').fill('please fail');
    await ai2.getByRole('button', { name: 'Analyse' }).click();
    await ai2.getByRole('alert').waitFor();
    console.log('error text:', (await ai2.getByRole('alert').innerText()).replace(/\s+/g, ' '));
    await shot(page, 'ai-error');

    // Empty state: "nothing" → no items.
    await ai2.getByRole('button', { name: 'Back' }).click();
    await ai2.getByLabel('What did you eat?').fill('nothing');
    await ai2.getByRole('button', { name: 'Analyse' }).click();
    await ai2.getByText('Nothing recognised').waitFor();
    await shot(page, 'ai-empty');
    await context.close();
  }

  // ---------- 11–15 food editor: estimate with AI ----------
  let sambarId;
  {
    const { context, page } = await open(PHONE);
    await page.goto(`${BASE}/foods/new`);
    await page.getByLabel('Name', { exact: true }).fill('Homemade sambar');
    const estimate = page.getByRole('button', { name: 'Estimate with AI' });
    await estimate.waitFor();
    await shot(page, 'food-editor-estimate-button');

    await estimate.click();
    const sheet = page.getByRole('dialog', { name: 'Estimate with AI' });
    await sheet.getByRole('button', { name: 'Estimate' }).waitFor();
    await sheet.getByLabel('Anything that helps?').fill('homemade, with drumstick');
    await shot(page, 'estimate-sheet-idle');

    await sheet.getByRole('button', { name: 'Estimate' }).click();
    await sheet.getByRole('button', { name: 'Use these values' }).waitFor();
    await shot(page, 'estimate-sheet-result');

    await sheet.getByRole('button', { name: 'Use these values' }).click();
    await page.getByRole('status').filter({ hasText: 'Estimated by AI' }).waitFor();
    console.log(
      'prefilled kcal / fiber / portion:',
      await page.getByLabel('Calories', { exact: true }).inputValue(),
      await page.getByLabel('Fiber', { exact: true }).inputValue(),
      await page.getByLabel('Portion 1 label').inputValue(),
    );
    await shot(page, 'food-editor-prefilled', { fullPage: true });

    await page.getByRole('button', { name: 'Save food' }).click();
    await page.waitForURL(/\/foods$/);
    await page.getByRole('link', { name: /^Homemade sambar/ }).waitFor();
    const call = apiFor(page);
    const foods = await call('GET', '/foods');
    const sambar = foods.items.find((f) => f.name === 'Homemade sambar');
    sambarId = sambar.id;
    console.log(
      'saved sambar:',
      sambar.source,
      sambar.estimatedAt ? 'estimatedAt set' : 'NO estimatedAt',
    );
    await shot(page, 'foods-list-estimated-tag');
    await context.close();
  }

  // ---------- 16–18 dish editor: paste a recipe ----------
  {
    const { context, page } = await open(PHONE);
    await page.goto(`${BASE}/foods/dishes/new`);
    await page.getByRole('button', { name: 'Paste a recipe' }).click();
    const sheet = page.getByRole('dialog', { name: 'Paste a recipe' });
    await sheet
      .getByLabel('Recipe text')
      .fill('Dal tadka\n200 g red lentils\n1 tbsp ghee\n1 onion\nsalt to taste\nServes 4');
    await sheet.getByRole('button', { name: 'Parse recipe' }).click();
    await sheet.getByRole('button', { name: 'Use recipe' }).waitFor();
    await shot(page, 'recipe-sheet-result');

    await sheet.getByRole('button', { name: 'Use recipe' }).click();
    await sheet.waitFor({ state: 'hidden' });
    await page.getByText('New food').first().waitFor();
    console.log(
      'dish form: name / cooked / servings:',
      await page.getByLabel('Name', { exact: true }).inputValue(),
      await page.getByLabel('Cooked weight', { exact: true }).inputValue(),
      await page.getByLabel('Servings', { exact: true }).inputValue(),
      '/ new-food tags:',
      await page.getByText('New food').count(),
    );
    await shot(page, 'dish-form-after-recipe', { fullPage: true });

    await page.getByRole('button', { name: 'Save dish' }).click();
    await page.waitForURL(/tab=dishes/);
    await page.getByRole('link', { name: /^Dal tadka/ }).waitFor();
    await shot(page, 'dishes-list-after-save');
    const call = apiFor(page);
    const foods = await call('GET', '/foods');
    for (const name of ['Ghee', 'Onion']) {
      const food = foods.items.find((f) => f.name === name);
      console.log(
        `created ${name}:`,
        food ? `source=${food.source} estimatedAt=${food.estimatedAt ? 'set' : 'null'}` : 'MISSING',
      );
    }
    await context.close();
  }

  // ---------- 19–21 insights week: weekly digest ----------
  {
    const { context, page } = await open(PHONE);
    await page.goto(`${BASE}/insights?range=week&from=${WEEK_START}`);
    const generate = page.getByRole('button', { name: 'Generate' });
    await generate.waitFor();
    await shot(page, 'digest-generate', { fullPage: true });

    const hold = holdRoute(page, '**/api/ai/weekly-digest**', 'POST');
    await hold.arm();
    await generate.click();
    await page.getByRole('status').filter({ hasText: 'Writing the digest' }).waitFor();
    await page.waitForTimeout(1600);
    await shot(page, 'digest-generating');
    await hold.release();

    await page.getByText('Next week:').waitFor();
    console.log('digest footer:', await page.getByText(/^Generated /).textContent());
    await shot(page, 'digest-generated');
    await context.close();
  }

  // ---------- 22–23 More card ----------
  {
    const { context, page } = await open(PHONE);
    await page.goto(`${BASE}/more`);
    await page.getByRole('heading', { name: 'AI assistant' }).waitFor();
    await page.getByText('Requests today').waitFor();
    await page.getByText(/Fake provider \(development\)/).waitFor();
    await page.waitForTimeout(500);
    console.log(
      'usage:',
      (await page.getByRole('heading', { name: 'AI assistant' }).locator('..').innerText())
        .replace(/\s+/g, ' ')
        .slice(0, 160),
    );
    await scrollCardIntoView(page, 'AI assistant');
    await shot(page, 'more-ai-card-enabled');
    await context.close();
  }
  {
    // Disabled: the real about body with `ai` turned off; every AI entry point must vanish.
    const { context, page } = await open(PHONE);
    await page.route('**/api/about', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.ai = { enabled: false, provider: 'none', model: null };
      await route.fulfill({ response, json: body });
    });
    await page.goto(`${BASE}/more`);
    await page.getByRole('heading', { name: 'AI assistant' }).waitFor();
    await page.getByRole('link', { name: 'README' }).waitFor();
    await scrollCardIntoView(page, 'AI assistant');
    await shot(page, 'more-ai-card-disabled');

    await page.goto(`${BASE}/today/${TODAY}`);
    await page.locator('button[aria-label="Log food"]').click();
    await page.getByRole('button', { name: 'Scan barcode' }).waitFor();
    const sparkles = await page.getByRole('button', { name: 'Describe or photograph' }).count();
    await page.goto(`${BASE}/foods/new`);
    await page.getByLabel('Name', { exact: true }).waitFor();
    const estimate = await page.getByRole('button', { name: 'Estimate with AI' }).count();
    await page.goto(`${BASE}/foods/dishes/new`);
    await page.getByRole('button', { name: 'Add ingredient' }).waitFor();
    const paste = await page.getByRole('button', { name: 'Paste a recipe' }).count();
    await page.goto(`${BASE}/insights?range=week&from=${WEEK_START}`);
    await page.getByRole('heading', { name: /Calories per day/ }).waitFor();
    const digest = await page.getByRole('heading', { name: 'Weekly digest' }).count();
    console.log(
      `disabled → sparkles ${sparkles}, estimate ${estimate}, paste ${paste}, digest ${digest}`,
      sparkles + estimate + paste + digest === 0 ? '(all hidden)' : 'STILL VISIBLE',
    );
    await context.close();
  }

  // ---------- 24–27 desktop ----------
  {
    const { context, page } = await open(DESKTOP);
    await page.goto(`${BASE}/today/${TODAY}`);
    await page.getByRole('region', { name: 'Day summary' }).waitFor();
    // The phone FAB is hidden on desktop; getByRole skips hidden elements and finds the header button.
    await page.getByRole('button', { name: 'Log food' }).click();
    await page
      .getByRole('dialog', { name: 'Log food' })
      .getByRole('button', { name: 'Describe or photograph' })
      .click();
    const ai = page.getByRole('dialog', { name: 'Describe or photograph' });
    await ai.getByLabel('What did you eat?').fill('2 rotis, a bowl of dal and a banana');
    await ai.getByRole('button', { name: 'Analyse' }).click();
    await page
      .getByRole('dialog', { name: 'Review items' })
      .getByRole('button', { name: /^Log/ })
      .waitFor();
    await shot(page, 'desktop-review');

    await page.goto(`${BASE}/insights?range=week&from=${WEEK_START}`);
    await page.getByText('Next week:').waitFor();
    await shot(page, 'desktop-digest');

    await page.goto(`${BASE}/more`);
    await page.getByText('Requests today').waitFor();
    await page.waitForTimeout(500);
    await shot(page, 'desktop-more-ai-card');

    await page.goto(`${BASE}/foods/${sambarId}`);
    await page.getByRole('status').filter({ hasText: 'Estimated by AI' }).waitFor();
    await shot(page, 'desktop-food-editor-estimated');
    await context.close();
  }
} finally {
  await browser.close();
  api.kill('SIGTERM');
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`done → ${DIR}/phase11-*.png`);
