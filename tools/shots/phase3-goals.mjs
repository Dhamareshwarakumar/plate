// Phase 3 UI verification: node tools/shots/phase3-goals.mjs
import { chromium, devices } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
const PASSWORD = process.env.PLATE_PASSWORD ?? 'password';
const out = (name) => `/tmp/plate-shots/${name}.png`;

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const TODAY = dayKey(now);
const WEEK_AGO = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
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

/** Seeds the small library when empty, resets settings/goals, clears today's entries. */
async function seed(page) {
  const api = apiFor(page);
  const foods = (await api('GET', '/foods')).items;
  const want = [
    [
      'Banana',
      'Fruit',
      89,
      1.1,
      22.8,
      0.3,
      2.6,
      [
        ['1 medium', 118],
        ['1 large', 136],
      ],
    ],
    ['Oats', 'Grain & Bread', 389, 16.9, 66.3, 6.9, 10.6, [['1 cup', 80]]],
    ['Chicken breast', 'Protein', 165, 31, 0, 3.6, 0, []],
    ['Greek yogurt', 'Dairy', 59, 10, 3.6, 0.4, 0, [['1 pot', 150]]],
    ['Peanut butter', 'Nuts & Seeds', 588, 25, 20, 50, 6, [['1 tbsp', 16]]],
    ['Brown rice', 'Grain & Bread', 112, 2.3, 23.5, 0.8, 1.8, [['1 cup cooked', 195]]],
  ];
  const categories = await api('GET', '/categories');
  const byName = new Map(foods.map((f) => [f.name.toLowerCase(), f]));
  for (const [name, cat, kcal, protein, carbs, fat, fiber, portions] of want) {
    if (byName.has(name.toLowerCase())) continue;
    const categoryId = categories.find((c) => c.name === cat)?.id ?? null;
    const created = await api('POST', '/foods', {
      name,
      categoryId,
      per100: { kcal, protein, carbs, fat, fiber, sugar: null, saturatedFat: null, sodiumMg: null },
      portions: portions.map(([label, amount]) => ({ label, amount })),
    });
    byName.set(name.toLowerCase(), created);
  }
  await api('PUT', '/settings', { tolerancePct: 10, weekStart: 'monday' });
  for (const goal of await api('GET', '/goals')) await api('DELETE', `/goals/${goal.id}`);
  await api('POST', '/goals', GOAL);
  const view = await api('GET', `/diary/${TODAY}`);
  for (const slot of view.slots) {
    for (const entry of slot.entries) await api('DELETE', `/diary/entries/${entry.id}`);
  }
  const slots = await api('GET', '/meal-slots');
  const slot = (n) => slots.find((s) => s.name === n).id;
  return { api, byName, slot };
}

async function logViaApi({ api, byName, slot }, rows) {
  for (const [food, qty, s, time] of rows) {
    await api('POST', '/diary/entries', {
      day: TODAY,
      slotId: slot(s),
      loggedAt: at(TODAY, time),
      foodId: byName.get(food).id,
      quantity: qty,
    });
  }
}

async function dayStatus(api) {
  const view = await api('GET', `/diary/${TODAY}`);
  return `${Math.round(view.totals.kcal)} kcal → ${view.status}`;
}

const wire = (page) => {
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('401'))
      console.log('CONSOLE', m.text().slice(0, 200));
  });
};

// ---------- phone, dark ----------
const phone = await browser.newContext({ ...devices['iPhone 14'], colorScheme: 'dark' });
const page = await phone.newPage();
wire(page);
await login(page);
const seeded = await seed(page);

// A desktop (light) context shares the data; opened now so both can look at the same day states.
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
});
const d = await desktop.newPage();
wire(d);
await login(d);

// 40: under the goal (~1,200 kcal)
await logViaApi(seeded, [
  ['oats', 80, 'Breakfast', '07:30'],
  ['greek yogurt', 150, 'Breakfast', '07:31'],
  ['banana', 118, 'Breakfast', '07:32'],
  ['chicken breast', 180, 'Lunch', '12:40'],
  ['brown rice', 195, 'Lunch', '12:41'],
  ['peanut butter', 32, 'Snacks', '16:10'],
]);
console.log('40', await dayStatus(seeded.api));
await page.goto(`${BASE}/today/${TODAY}`);
await page.waitForTimeout(1200);
await page.screenshot({ path: out('40-today-under') });

// 41: inside the band (~1,965 kcal), phone + desktop
await logViaApi(seeded, [
  ['chicken breast', 200, 'Dinner', '19:10'],
  ['brown rice', 195, 'Dinner', '19:11'],
  ['banana', 136, 'Dinner', '19:12'],
  ['greek yogurt', 150, 'Dinner', '19:13'],
]);
console.log('41', await dayStatus(seeded.api));
await page.reload();
await page.waitForTimeout(1200);
await page.screenshot({ path: out('41-today-on-target') });
await d.goto(`${BASE}/today/${TODAY}`);
await d.waitForTimeout(1200);
await d.screenshot({ path: out('46-desktop-today-on-target') });

// 41b: the log sheet shows "Day after: x / 2,000"
await page.getByRole('button', { name: 'Log food' }).first().click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: /^Banana/ }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: out('41b-log-step2-goal') });
await page.getByRole('button', { name: 'Close' }).click();
await page.waitForTimeout(400);

// 42: over the band (~2,440 kcal)
await logViaApi(seeded, [
  ['peanut butter', 48, 'Snacks', '21:00'],
  ['oats', 50, 'Snacks', '21:01'],
]);
console.log('42', await dayStatus(seeded.api));
await page.reload();
await page.waitForTimeout(1200);
await page.screenshot({ path: out('42-today-over') });

// 43: goal editor with the calculator expanded and filled in (scoped to the dialog: the Profile
// card behind it has the same labels)
await page.goto(`${BASE}/more?goal=edit`);
await page.waitForTimeout(900);
const sheet = page.getByRole('dialog');
await sheet.getByRole('button', { name: 'Calculate for me' }).click();
await page.waitForTimeout(300);
await sheet.getByRole('radio', { name: 'Male', exact: true }).click();
await sheet.getByLabel('Birth date').fill('1995-06-15');
await sheet.getByLabel('Height').fill('180');
await sheet.getByLabel('Activity').selectOption('moderate');
await sheet.getByLabel('Current weight').fill('80');
await page.waitForTimeout(400);
await page.screenshot({ path: out('43-goal-editor-calculator') });
// The sheet scrolls internally, so scroll its content to the suggestions and to the macro fields.
await sheet.getByRole('group', { name: 'Suggested calorie goals' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.screenshot({ path: out('43b-goal-editor-suggestions') });
await sheet.getByRole('button', { name: /^Maintain/ }).click();
await sheet.getByRole('button', { name: /^Balanced/ }).click();
await page.waitForTimeout(300);
console.log(
  '43 grams after Maintain + Balanced:',
  await sheet.getByLabel('Calories per day').inputValue(),
  await sheet.getByLabel('Protein').inputValue(),
  await sheet.getByLabel('Carbs').inputValue(),
  await sheet.getByLabel('Fat').inputValue(),
);
await sheet.getByLabel('Applies from').scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.screenshot({ path: out('43c-goal-editor-macros') });
await sheet.getByLabel('Calories per day').scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.screenshot({ path: out('43d-goal-editor-top') });
await sheet.getByRole('button', { name: 'Save goal' }).click();
await page.waitForTimeout(1200);
console.log('43 profile after save:', JSON.stringify(await seeded.api('GET', '/profile')));
console.log(
  '43 goals after save:',
  (await seeded.api('GET', '/goals'))
    .map((g) => `${g.effectiveFrom}:${g.kcal} P${g.proteinG} fiber=${g.fiberG} water=${g.waterMl}`)
    .join(' | '),
);

// 44: More with the goal card and its history open
await page.getByRole('button', { name: /Goal history/ }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: out('44-more-goal-card') });
await page.screenshot({ path: out('44b-more-full'), fullPage: true });
await d.goto(`${BASE}/more`);
await d.waitForTimeout(900);
await d.getByRole('button', { name: /Goal history/ }).click();
await d.waitForTimeout(400);
await d.screenshot({ path: out('47-desktop-more') });
await d.screenshot({ path: out('47b-desktop-more-full'), fullPage: true });
// Desktop dialog variant of the editor with the calculator open (profile is saved by now).
await d.goto(`${BASE}/more?goal=edit`);
await d.waitForTimeout(900);
const dialog = d.getByRole('dialog');
await dialog.getByRole('button', { name: 'Calculate for me' }).click();
await dialog.getByLabel('Current weight').fill('80');
await d.waitForTimeout(400);
await d.screenshot({ path: out('47c-desktop-goal-editor') });
await dialog.getByRole('button', { name: 'Cancel' }).click();
await d.waitForTimeout(300);

// 44c: deleting a goal asks for confirmation
await page
  .getByRole('button', { name: /^Delete goal from/ })
  .first()
  .click();
await page.waitForTimeout(400);
await page.screenshot({ path: out('44c-delete-goal-confirm') });
await page.getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(300);

// 45: first-run checklist (no goals, flag cleared)
for (const goal of await seeded.api('GET', '/goals'))
  await seeded.api('DELETE', `/goals/${goal.id}`);
await page.goto(`${BASE}/today/${TODAY}`);
await page.evaluate(() => localStorage.removeItem('plate.firstRun.dismissed'));
await page.reload();
await page.waitForTimeout(1200);
await page.screenshot({ path: out('45-first-run') });
await d.goto(`${BASE}/today/${TODAY}`);
await d.evaluate(() => localStorage.removeItem('plate.firstRun.dismissed'));
await d.reload();
await d.waitForTimeout(1200);
await d.screenshot({ path: out('45b-desktop-first-run') });

// 48: week start = Sunday reshapes the strip (and the desktop mini calendar)
await seeded.api('PUT', '/settings', { weekStart: 'sunday' });
await page.goto(`${BASE}/today/${TODAY}`);
await page.waitForTimeout(1000);
await page.screenshot({
  path: out('48-today-week-sunday'),
  clip: { x: 0, y: 0, width: 390, height: 260 },
});
console.log(
  '48 first strip label:',
  await page.getByLabel('Days of the week').locator('li').first().innerText(),
);
await seeded.api('PUT', '/settings', { weekStart: 'monday' });

// Leave the dev database with the week-old goal in place.
await seeded.api('POST', '/goals', GOAL);

await phone.close();
await desktop.close();
await browser.close();
console.log('done');
