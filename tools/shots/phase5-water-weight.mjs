// Phase 5 UI verification: node tools/shots/phase5-water-weight.mjs
import { chromium, devices } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
const PASSWORD = process.env.PLATE_PASSWORD ?? 'password';
const out = (name) => `/tmp/plate-shots/${name}.png`;

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const TODAY = dayKey(now);
const daysAgo = (n) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
const WEEK_AGO = daysAgo(7);
const at = (day, hhmm) => `${day}T${hhmm}:00${offsetOf(now)}`;
function offsetOf(d) {
  const m = -d.getTimezoneOffset();
  const sign = m >= 0 ? '+' : '-';
  return `${sign}${pad(Math.floor(Math.abs(m) / 60))}:${pad(Math.abs(m) % 60)}`;
}

const GOAL = {
  effectiveFrom: WEEK_AGO,
  kcal: 2000,
  proteinG: 150,
  carbsG: 220,
  fatG: 65,
  fiberG: 30,
  waterMl: 2500,
  goalWeightKg: 74,
  goalWeightDate: daysAgo(-120),
};

// Deterministic noise so the chart looks the same on every run.
let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const browser = await chromium.launch({ channel: 'chrome' });

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/today/);
  await page.waitForTimeout(500);
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

const wire = (page) => {
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('401'))
      console.log('CONSOLE', m.text().slice(0, 200));
  });
};

/** Removes every weigh-in and today's water so the empty states can be photographed. */
async function clearAll(api) {
  for (const w of await api('GET', '/weights')) await api('DELETE', `/weights/${w.day}`);
  const view = await api('GET', `/diary/${TODAY}`);
  for (const e of view.water.entries) await api('DELETE', `/water/${e.id}`);
  for (const slot of view.slots) {
    for (const entry of slot.entries) await api('DELETE', `/diary/entries/${entry.id}`);
  }
  for (const goal of await api('GET', '/goals')) await api('DELETE', `/goals/${goal.id}`);
}

/** ~45 days of weigh-ins ending today with a gentle downward trend, a few days skipped. */
async function seedWeights(api) {
  const skipped = new Set([3, 11, 19, 30]);
  for (let i = 44; i >= 0; i--) {
    if (skipped.has(i)) continue;
    const kg = Math.round((80 - 0.045 * (44 - i) + (rand() - 0.5) * 0.8) * 10) / 10;
    await api('PUT', `/weights/${daysAgo(i)}`, {
      kg,
      ...(i === 0 ? { note: 'post-run' } : i === 1 ? { note: 'after breakfast' } : {}),
    });
  }
}

async function seedToday(api) {
  await api('POST', '/goals', GOAL);
  const foods = (await api('GET', '/foods')).items;
  const slots = await api('GET', '/meal-slots');
  const slot = (n) => slots.find((s) => s.name === n)?.id ?? slots[0].id;
  const byName = new Map(foods.map((f) => [f.name.toLowerCase(), f]));
  const rows = [
    ['oats', 80, 'Breakfast', '07:30'],
    ['greek yogurt', 150, 'Breakfast', '07:31'],
    ['banana', 118, 'Breakfast', '07:32'],
    ['chicken breast', 180, 'Lunch', '12:40'],
    ['brown rice', 195, 'Lunch', '12:41'],
  ];
  for (const [food, qty, s, time] of rows) {
    const f = byName.get(food);
    if (!f) continue;
    await api('POST', '/diary/entries', {
      day: TODAY,
      slotId: slot(s),
      loggedAt: at(TODAY, time),
      foodId: f.id,
      quantity: qty,
    });
  }
}

// ---------- contexts ----------
const phone = await browser.newContext({ ...devices['iPhone 14'], colorScheme: 'dark' });
const page = await phone.newPage();
wire(page);
await login(page);
const api = apiFor(page);

const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
});
const d = await desktop.newPage();
wire(d);
await login(d);

// (a) empty states
await clearAll(api);
await page.goto(`${BASE}/weight`);
await page.waitForTimeout(1000);
await page.screenshot({ path: out('50-weight-empty') });
await d.goto(`${BASE}/weight`);
await d.waitForTimeout(1000);
await d.screenshot({ path: out('60-desktop-weight-empty') });

// (b) seed
await seedWeights(api);
await seedToday(api);
console.log('seeded weights:', (await api('GET', '/weights')).length);

// (c) Today: water card
await page.goto(`${BASE}/today/${TODAY}`);
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Add 250 ml of water' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Add 500 ml of water' }).click();
await page.waitForTimeout(700);
await page.getByRole('heading', { name: 'Water' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.screenshot({ path: out('51-today-water') });
console.log('51 water after +250 +500:', (await api('GET', `/diary/${TODAY}`)).water.ml);
await page.getByRole('button', { name: 'Add a custom amount of water' }).click();
await page.waitForTimeout(600);
await page.getByRole('dialog').getByRole('button', { name: '330 ml' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: out('52-water-sheet') });
await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
await page.waitForTimeout(700);
console.log('52 water after custom 330:', (await api('GET', `/diary/${TODAY}`)).water.ml);
await page.getByRole('button', { name: 'Undo last water entry' }).click();
await page.waitForTimeout(700);
console.log('52 water after undo:', (await api('GET', `/diary/${TODAY}`)).water.ml);
await page.screenshot({ path: out('52b-today-water-undone') });

// (d) Weight page
await page.goto(`${BASE}/weight`);
await page.waitForTimeout(1400);
await page.screenshot({ path: out('53-weight-1m') });
await page.screenshot({ path: out('53b-weight-1m-full'), fullPage: true });
await page.getByRole('radio', { name: 'All' }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: out('54-weight-all') });
console.log('54 url:', page.url());
await page.reload();
await page.waitForTimeout(1200);
console.log(
  '54 range survives reload:',
  await page.getByRole('radio', { name: 'All' }).getAttribute('aria-checked'),
);

await page.getByRole('button', { name: 'Log', exact: true }).click();
await page.waitForTimeout(700);
await page.getByLabel('Weight', { exact: true }).fill('77.2');
await page.waitForTimeout(200);
await page.screenshot({ path: out('55-weight-log-sheet') });
await page.getByLabel('Day').fill(daysAgo(1));
await page.waitForTimeout(400);
await page.screenshot({ path: out('55b-weight-log-replaces') });
console.log('55b notice:', await page.getByRole('status').innerText());
await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(500);

// Back closes the sheet: open, go back, expect no dialog.
await page.getByRole('button', { name: 'Log', exact: true }).click();
await page.waitForTimeout(500);
await page.goBack();
await page.waitForTimeout(500);
console.log('back closes sheet:', (await page.getByRole('dialog').count()) === 0);

const firstRow = page.getByRole('button', { name: /^Edit weigh-in on/ }).first();
await firstRow.click();
await page.waitForTimeout(700);
await page.screenshot({ path: out('56-weight-edit-sheet') });
await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(500);

// Swipe the second row left to reveal Delete (mouse drag, like the diary rows).
const rows = page.getByRole('list', { name: 'Weigh-ins' }).locator('li');
await rows.nth(1).scrollIntoViewIfNeeded();
const box = await rows.nth(1).boundingBox();
if (!box) throw new Error('no row box');
const y = box.y + box.height / 2;
await page.mouse.move(box.x + box.width - 40, y);
await page.mouse.down();
await page.mouse.move(box.x + box.width - 60, y, { steps: 3 });
await page.mouse.move(box.x + box.width - 140, y, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: out('57-weight-swipe-delete') });

// Delete + undo round trip through the toast.
const before = (await api('GET', '/weights')).length;
await page
  .getByRole('list', { name: 'Weigh-ins' })
  .locator('li')
  .nth(1)
  .getByRole('button', { name: 'Delete' })
  .click();
await page.waitForTimeout(600);
await page.screenshot({ path: out('57b-weight-deleted-toast') });
const during = (await api('GET', '/weights')).length;
await page.getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(800);
const after = (await api('GET', '/weights')).length;
console.log('delete/undo counts:', before, during, after);

// (e) desktop
await d.goto(`${BASE}/today/${TODAY}`);
await d.waitForTimeout(1200);
await d.screenshot({ path: out('61-desktop-today-water') });
// The water card closes the sticky left column; on a 900 px viewport it shows at the page end.
await d.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await d.waitForTimeout(500);
await d.screenshot({ path: out('61b-desktop-today-water-card') });
await d.goto(`${BASE}/weight?range=3m`);
await d.waitForTimeout(1400);
await d.screenshot({ path: out('62-desktop-weight') });
await d.screenshot({ path: out('62b-desktop-weight-full'), fullPage: true });
// Hover a row to show the delete icon.
await d.getByRole('list', { name: 'Weigh-ins' }).locator('li').first().hover();
await d.waitForTimeout(300);
await d.screenshot({ path: out('62c-desktop-weight-hover'), fullPage: true });
await d.getByRole('button', { name: 'Log', exact: true }).click();
await d.waitForTimeout(600);
await d.screenshot({ path: out('62d-desktop-weight-log') });
await d.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
await d.waitForTimeout(400);

await d.goto(`${BASE}/more?goal=edit`);
await d.waitForTimeout(1000);
const dialog = d.getByRole('dialog');
await dialog.getByLabel('Goal weight').scrollIntoViewIfNeeded();
await d.waitForTimeout(300);
await d.screenshot({ path: out('63-desktop-goal-weight') });
console.log(
  '63 goal weight fields:',
  await dialog.getByLabel('Goal weight').inputValue(),
  await dialog.getByLabel('Target date').inputValue(),
);
await dialog.getByRole('button', { name: 'Calculate for me' }).click();
await d.waitForTimeout(300);
console.log(
  '63 calculator weight prefill:',
  await dialog.getByLabel('Current weight').inputValue(),
);
await dialog.getByRole('button', { name: 'Cancel' }).click();
await d.waitForTimeout(400);
await d.goto(`${BASE}/more`);
await d.waitForTimeout(1000);
await d.screenshot({ path: out('64-desktop-more-goal-card') });

// Phone goal editor with the weight goal group visible.
await page.goto(`${BASE}/more?goal=edit`);
await page.waitForTimeout(1000);
await page.getByRole('dialog').getByLabel('Goal weight').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: out('58-goal-editor-weight') });
await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(300);
await page.goto(`${BASE}/more`);
await page.waitForTimeout(900);
await page.screenshot({ path: out('59-more-goal-card') });

// Leave the seeded weights and goal in the dev database.
await phone.close();
await desktop.close();
await browser.close();
console.log('done');
