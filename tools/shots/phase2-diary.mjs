// Phase 2 UI verification: node tools/shots/phase2-diary.mjs
import { chromium, devices } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
const PASSWORD = process.env.PLATE_PASSWORD ?? 'password';
const out = (name) => `/tmp/plate-shots/${name}.png`;

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const TODAY = dayKey(now);
const YESTERDAY = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
const at = (day, hhmm) => `${day}T${hhmm}:00${offsetOf(now)}`;
function offsetOf(d) {
  const m = -d.getTimezoneOffset();
  const sign = m >= 0 ? '+' : '-';
  return `${sign}${pad(Math.floor(Math.abs(m) / 60))}:${pad(Math.abs(m) % 60)}`;
}

const browser = await chromium.launch({ channel: 'chrome' });

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/today/);
  await page.waitForTimeout(500);
}

/** Seeds a small library when empty and clears today/yesterday so the shots are deterministic. */
async function seed(page) {
  const api = async (method, path, data) => {
    const res = await page.request.fetch(`${BASE}/api${path}`, {
      method,
      ...(data ? { data } : {}),
    });
    if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
    return res.status() === 204 ? null : res.json();
  };
  const foods = (await api('GET', '/foods')).items;
  const want = [
    [
      'Banana',
      'Fruit',
      89,
      1.1,
      22.8,
      0.3,
      [
        ['1 medium', 118],
        ['1 large', 136],
      ],
    ],
    ['Oats', 'Grain & Bread', 389, 16.9, 66.3, 6.9, [['1 cup', 80]]],
    ['Chicken breast', 'Protein', 165, 31, 0, 3.6, []],
    ['Greek yogurt', 'Dairy', 59, 10, 3.6, 0.4, [['1 pot', 150]]],
    ['Peanut butter', 'Nuts & Seeds', 588, 25, 20, 50, [['1 tbsp', 16]]],
    ['Brown rice', 'Grain & Bread', 112, 2.3, 23.5, 0.8, [['1 cup cooked', 195]]],
  ];
  const categories = await api('GET', '/categories');
  const byName = new Map(foods.map((f) => [f.name.toLowerCase(), f]));
  for (const [name, cat, kcal, protein, carbs, fat, portions] of want) {
    if (byName.has(name.toLowerCase())) continue;
    const categoryId = categories.find((c) => c.name === cat)?.id ?? null;
    const created = await api('POST', '/foods', {
      name,
      categoryId,
      per100: {
        kcal,
        protein,
        carbs,
        fat,
        fiber: null,
        sugar: null,
        saturatedFat: null,
        sodiumMg: null,
      },
      portions: portions.map(([label, amount]) => ({ label, amount })),
    });
    byName.set(name.toLowerCase(), created);
  }
  // Banana must have portions for the portion-chip shots.
  const banana = byName.get('banana');
  if (banana && banana.portions.length === 0) {
    await api('PUT', `/foods/${banana.id}`, {
      name: banana.name,
      brand: banana.brand,
      categoryId: banana.categoryId,
      basis: banana.basis,
      per100: banana.per100,
      portions: [
        { label: '1 medium', amount: 118 },
        { label: '1 large', amount: 136 },
      ],
    });
  }
  for (const day of [TODAY, YESTERDAY]) {
    const view = await api('GET', `/diary/${day}`);
    for (const slot of view.slots) {
      for (const entry of slot.entries) await api('DELETE', `/diary/entries/${entry.id}`);
    }
  }
  const slots = await api('GET', '/meal-slots');
  const slot = (n) => slots.find((s) => s.name === n).id;
  // Yesterday gets a few entries so the strip shows a dot and "copy from yesterday" has material.
  for (const [food, qty, s, time] of [
    ['oats', 80, 'Breakfast', '07:30'],
    ['chicken breast', 180, 'Lunch', '12:45'],
    ['brown rice', 195, 'Lunch', '12:46'],
  ]) {
    await api('POST', '/diary/entries', {
      day: YESTERDAY,
      slotId: slot(s),
      loggedAt: at(YESTERDAY, time),
      foodId: byName.get(food).id,
      quantity: qty,
    });
  }
  return { byName, slot };
}

async function logViaApi(page, { byName, slot }, rows) {
  for (const [food, qty, s, time, portion] of rows) {
    const res = await page.request.post(`${BASE}/api/diary/entries`, {
      data: {
        day: TODAY,
        slotId: slot(s),
        loggedAt: at(TODAY, time),
        foodId: byName.get(food).id,
        quantity: qty,
        ...(portion ? { portionLabel: portion[0], portionCount: portion[1] } : {}),
      },
    });
    if (!res.ok()) throw new Error(`log ${food} → ${res.status()} ${await res.text()}`);
  }
}

// ---------- phone, dark ----------
const phone = await browser.newContext({ ...devices['iPhone 14'], colorScheme: 'dark' });
const page = await phone.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200));
});

await login(page);
const seeded = await seed(page);
await page.goto(`${BASE}/today/${TODAY}`);
await page.waitForTimeout(900);
await page.screenshot({ path: out('30-today-empty') });

// Log flow: FAB → pick → quantity
await page.getByRole('button', { name: 'Log food' }).first().click();
await page.waitForTimeout(700);
await page.screenshot({ path: out('31-log-step1') });
await page.getByRole('button', { name: /^Banana/ }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: out('32-log-step2') });
await page.getByLabel('Quantity').fill('450');
await page.waitForTimeout(300);
await page.screenshot({ path: out('32b-log-step2-typed') });
await page.getByRole('button', { name: 'Log', exact: true }).click();
await page.waitForTimeout(1200);

// More entries through the API (one via portion), then the populated day
await logViaApi(page, seeded, [
  ['oats', 80, 'Breakfast', '07:35'],
  ['greek yogurt', 150, 'Breakfast', '07:36', ['1 pot', 1]],
  ['chicken breast', 150, 'Lunch', '12:40'],
  ['brown rice', 195, 'Lunch', '12:41', ['1 cup cooked', 1]],
  ['peanut butter', 32, 'Snacks', '16:10', ['1 tbsp', 2]],
]);
await page.reload();
await page.waitForTimeout(1000);
await page.screenshot({ path: out('33-today-entries') });
await page.screenshot({ path: out('33b-today-entries-full'), fullPage: true });

// Entry edit sheet
await page.getByRole('button', { name: /^Edit Chicken breast,/ }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: out('34-entry-edit') });
await page.getByRole('button', { name: 'Close' }).click();
await page.waitForTimeout(500);

// Swipe a row left to reveal Delete (mouse drag with steps)
const row = page.getByRole('button', { name: /^Edit Oats,/ });
const box = await row.boundingBox();
if (!box) throw new Error('no row box');
const y = box.y + box.height / 2;
await page.mouse.move(box.x + box.width - 40, y);
await page.mouse.down();
await page.mouse.move(box.x + box.width - 60, y, { steps: 3 });
await page.mouse.move(box.x + box.width - 140, y, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: out('35-swipe-revealed') });

// Meal slot manager
await page.goto(`${BASE}/more/meal-slots`);
await page.waitForTimeout(800);
await page.screenshot({ path: out('36-meal-slots') });

// Ad-hoc step
await page.goto(`${BASE}/today/${TODAY}?log=new`);
await page.waitForTimeout(800);
await page.getByRole('button', { name: /Quick ad-hoc entry/ }).click();
await page.waitForTimeout(500);
await page.getByLabel('What did you eat?').fill('Pizza slice');
await page.getByLabel('Portion', { exact: true }).fill('1 slice');
await page.getByLabel('Calories', { exact: true }).fill('285');
await page.waitForTimeout(300);
await page.screenshot({ path: out('36b-adhoc') });
await phone.close();

// ---------- desktop, light ----------
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
});
const d = await desktop.newPage();
d.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await login(d);
await d.goto(`${BASE}/today/${TODAY}`);
await d.waitForTimeout(1000);
await d.getByRole('button', { name: /^Edit Chicken breast,/ }).hover();
await d.waitForTimeout(300);
await d.screenshot({ path: out('37-desktop-today') });
await d.keyboard.press('n');
await d.waitForTimeout(700);
await d.screenshot({ path: out('38-desktop-log-dialog') });
await d.getByRole('button', { name: /^Banana/ }).click();
await d.waitForTimeout(600);
await d.screenshot({ path: out('38b-desktop-log-quantity') });
await desktop.close();

await browser.close();
console.log('done');
