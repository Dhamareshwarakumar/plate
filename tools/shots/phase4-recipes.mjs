// Phase 4 UI verification: node tools/shots/phase4-recipes.mjs
import { chromium, devices } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
const PASSWORD = process.env.PLATE_PASSWORD ?? 'password';
const out = (name) => `/tmp/plate-shots/${name}.png`;

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const TODAY = dayKey(now);
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

function apiFor(page) {
  return async (method, path, data, { allow = [] } = {}) => {
    const res = await page.request.fetch(`${BASE}/api${path}`, {
      method,
      ...(data ? { data } : {}),
    });
    if (!res.ok() && !allow.includes(res.status())) {
      throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
    }
    return res.status() === 204 ? null : res.json();
  };
}

const LIBRARY = [
  ['Banana', 'Fruit', 89, 1.1, 22.8, 0.3, 2.6, [['1 medium', 118]]],
  ['Oats', 'Grain & Bread', 389, 16.9, 66.3, 6.9, 10.6, [['1 cup', 80]]],
  ['Greek yogurt', 'Dairy', 59, 10, 3.6, 0.4, 0, [['1 pot', 150]]],
  ['Red lentils', 'Legume', 352, 24.6, 63.4, 1.1, 10.7, []],
  ['Sunflower oil', 'Condiment', 884, 0, 0, 100, 0, [['1 tbsp', 14]]],
  ['Onion', 'Vegetable', 40, 1.1, 9.3, 0.1, 1.7, [['1 medium', 110]]],
  ['Tomato', 'Vegetable', 18, 0.9, 3.9, 0.2, 1.2, [['1 medium', 123]]],
  ['Brown rice', 'Grain & Bread', 112, 2.3, 23.5, 0.8, 1.8, [['1 cup cooked', 195]]],
];

/** Foods present, no templates, no dish named Dal, today's entries cleared. */
async function seed(page) {
  const api = apiFor(page);
  const categories = await api('GET', '/categories');
  const all = (await api('GET', '/foods?includeArchived=true')).items;
  const byName = new Map(all.map((f) => [f.name.toLowerCase(), f]));
  for (const [name, cat, kcal, protein, carbs, fat, fiber, portions] of LIBRARY) {
    const existing = byName.get(name.toLowerCase());
    if (existing) {
      if (existing.archivedAt) await api('POST', `/foods/${existing.id}/unarchive`);
      continue;
    }
    const categoryId = categories.find((c) => c.name === cat)?.id ?? null;
    const created = await api('POST', '/foods', {
      name,
      categoryId,
      per100: { kcal, protein, carbs, fat, fiber, sugar: null, saturatedFat: null, sodiumMg: null },
      portions: portions.map(([label, amount]) => ({ label, amount })),
    });
    byName.set(name.toLowerCase(), created);
  }
  // Reset the lentils in case an earlier run left them edited.
  const lentils = byName.get('red lentils');
  await api('PUT', `/foods/${lentils.id}`, {
    name: 'Red lentils',
    basis: 'g',
    categoryId: lentils.categoryId,
    per100: { ...lentils.per100, kcal: 352 },
    portions: [],
  });
  for (const t of await api('GET', '/meal-templates'))
    await api('DELETE', `/meal-templates/${t.id}`);
  const view = await api('GET', `/diary/${TODAY}`);
  for (const slot of view.slots) {
    for (const entry of slot.entries) await api('DELETE', `/diary/entries/${entry.id}`);
  }
  // Free the name "Dal": delete the dish, or rename + archive it when history references it.
  for (const dish of all.filter((f) => f.kind === 'dish' && /^dal$/i.test(f.name))) {
    const del = await page.request.delete(`${BASE}/api/foods/${dish.id}`);
    if (!del.ok()) {
      const full = await api('GET', `/dishes/${dish.id}`);
      await api('PUT', `/dishes/${dish.id}`, {
        name: `Dal (old ${Date.now()})`,
        ingredients: full.ingredients.map((i) => ({ foodId: i.foodId, amount: i.amount })),
        cookedWeight: full.cookedWeight,
        servings: full.servings,
      });
      await api('POST', `/foods/${dish.id}/archive`);
    }
  }
  const slots = await api('GET', '/meal-slots');
  const slot = (n) => slots.find((s) => s.name === n).id;
  return { api, byName, slot };
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
const { api, byName, slot } = seeded;

const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
});
const d = await desktop.newPage();
wire(d);
await login(d);

// 50: Dishes tab (empty unless the dev database already has dishes)
await page.goto(`${BASE}/foods?tab=dishes`);
await page.waitForTimeout(900);
await page.screenshot({ path: out('50-dishes-tab') });

// 51: dish editor filled in through the UI
await page.goto(`${BASE}/foods/dishes/new`);
await page.waitForTimeout(700);
await page.getByLabel('Name', { exact: true }).fill('Dal');
await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Cooked dish' });
for (const [name, amount] of [
  ['Red lentils', '200'],
  ['Sunflower oil', '15'],
  ['Onion', '100'],
  ['Tomato', '120'],
]) {
  await page.getByRole('button', { name: 'Add ingredient' }).click();
  await page.waitForTimeout(400);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Search foods').fill(name);
  await page.waitForTimeout(250);
  await dialog.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await page.waitForTimeout(350);
  await page.getByLabel(`${name} amount in`).fill(amount);
}
await page.waitForTimeout(300);
console.log('51 raw total line:', await page.getByText(/^Raw total \d/).innerText());
await page.screenshot({ path: out('51-dish-editor-ingredients') });
await page.getByLabel('Cooked weight', { exact: true }).fill('980');
await page.getByLabel('Servings', { exact: true }).fill('4');
await page.waitForTimeout(300);
await page.getByLabel('Cooked weight', { exact: true }).scrollIntoViewIfNeeded();
await page.screenshot({ path: out('51b-dish-editor-cooked') });
console.log(
  '51 per-100 card:',
  (await page.getByText('Per 100 g', { exact: true }).locator('../..').innerText()).replace(
    /\n/g,
    ' | ',
  ),
);
await page.getByRole('button', { name: 'Save dish' }).click();
await page.waitForURL(/\/foods\?tab=dishes/);
await page.waitForTimeout(900);
// 52: Dishes tab with the dish
await page.screenshot({ path: out('52-dishes-list') });
const dal = (await api('GET', '/foods?kind=dish')).items.find((f) => f.name === 'Dal');
console.log(
  '52 dal:',
  dal &&
    `${Math.round(dal.per100.kcal)} kcal/100g, portions=${JSON.stringify(dal.portions.map((p) => [p.label, p.amount]))}`,
);

// 53: stale banner after an ingredient edit, then recalculate
const lentils = byName.get('red lentils');
await api('PUT', `/foods/${lentils.id}`, {
  name: 'Red lentils',
  basis: 'g',
  categoryId: lentils.categoryId,
  per100: { ...lentils.per100, kcal: 400 },
  portions: [],
});
await page.reload();
await page.waitForTimeout(900);
await page.screenshot({ path: out('53-dishes-list-stale') });
await page.getByRole('link', { name: /^Dal/ }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: out('53b-dish-editor-stale') });
await page.getByRole('button', { name: 'Recalculate' }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: out('53c-dish-editor-recalculated') });
console.log(
  '53 after recalculate:',
  JSON.stringify((await api('GET', `/dishes/${dal.id}`)).staleSince),
  Math.round((await api('GET', `/dishes/${dal.id}`)).per100.kcal),
  'kcal/100g',
);
// Put the lentils back and recalculate so the dev database stays consistent.
await api('PUT', `/foods/${lentils.id}`, {
  name: 'Red lentils',
  basis: 'g',
  categoryId: lentils.categoryId,
  per100: { ...lentils.per100, kcal: 352 },
  portions: [],
});
await api('POST', `/dishes/${dal.id}/recalculate`);

// 54: Meals tab, empty
await page.goto(`${BASE}/foods?tab=meals`);
await page.waitForTimeout(900);
await page.screenshot({ path: out('54-meals-tab-empty') });

// 55: "Save as meal template…" from a logged breakfast (one ad-hoc entry gets skipped)
for (const [food, qty, time] of [
  ['oats', 80, '07:30'],
  ['greek yogurt', 150, '07:31'],
  ['banana', 118, '07:32'],
]) {
  await api('POST', '/diary/entries', {
    day: TODAY,
    slotId: slot('Breakfast'),
    loggedAt: at(TODAY, time),
    foodId: byName.get(food).id,
    quantity: qty,
  });
}
await api('POST', '/diary/entries', {
  day: TODAY,
  slotId: slot('Breakfast'),
  loggedAt: at(TODAY, '07:33'),
  foodId: null,
  name: 'Mystery bar',
  quantity: 100,
  portionLabel: '1 bar',
  portionCount: 1,
  per100: {
    kcal: 180,
    protein: 5,
    carbs: 20,
    fat: 8,
    fiber: null,
    sugar: null,
    saturatedFat: null,
    sodiumMg: null,
  },
});
await page.goto(`${BASE}/today/${TODAY}`);
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Breakfast actions' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: out('55-meal-menu') });
await page.getByRole('menuitem', { name: 'Save as meal template…' }).click();
await page.waitForTimeout(600);
await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Usual breakfast');
await page.waitForTimeout(200);
await page.screenshot({ path: out('55b-save-as-meal-sheet') });
await page.getByRole('button', { name: 'Save template' }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: out('55c-save-as-meal-toast') });
const templates = await api('GET', '/meal-templates');
console.log(
  '55 templates:',
  templates
    .map(
      (t) =>
        `${t.name}: ${t.items.map((i) => `${i.name} ${i.amount}`).join(', ')} = ${Math.round(t.totals.kcal)} kcal`,
    )
    .join(' | '),
);

// 56: Meals tab with the template; 57: its editor with a dish added
await page.goto(`${BASE}/foods?tab=meals`);
await page.waitForTimeout(900);
await page.screenshot({ path: out('56-meals-list') });
await page.getByRole('link', { name: /^Usual breakfast/ }).click();
await page.waitForTimeout(900);
await page.getByRole('button', { name: 'Add food or dish' }).click();
await page.waitForTimeout(400);
const mealPicker = page.getByRole('dialog');
await mealPicker.getByRole('tab', { name: 'Dishes' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: out('57-meal-picker-dishes-shelf') });
await mealPicker.getByRole('button', { name: /^Dal/ }).click();
await page.waitForTimeout(400);
await page.getByLabel('Dal amount in g').fill('250');
await page.waitForTimeout(300);
await page.screenshot({ path: out('57b-meal-editor') });
await page.getByRole('button', { name: 'Save changes' }).click();
await page.waitForTimeout(1000);

// 58: log sheet → Meals chip → review step → logged
await page.goto(`${BASE}/today/${TODAY}`);
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Log food' }).first().click();
await page.waitForTimeout(600);
const logSheet = page.getByRole('dialog');
await logSheet.getByRole('tab', { name: 'Dishes' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: out('58-log-sheet-dishes-chip') });
await logSheet.getByRole('tab', { name: 'Meals' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: out('58b-log-sheet-meals-chip') });
await logSheet.getByRole('button', { name: /^Usual breakfast/ }).click();
await page.waitForTimeout(500);
await logSheet.getByLabel('Meal', { exact: true }).selectOption({ label: 'Lunch' });
await logSheet.getByLabel('Oats amount in g').fill('60');
await page.waitForTimeout(300);
await page.screenshot({ path: out('59-log-sheet-template-review') });
await logSheet.getByRole('button', { name: /^Log \d+ items/ }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: out('60-today-after-template-log') });
const lunch = (await api('GET', `/diary/${TODAY}`)).slots.find((s) => s.slot.name === 'Lunch');
console.log(
  '60 lunch entries:',
  lunch.entries.map((e) => `${e.name} ${e.quantity}${e.basis}`).join(', '),
);

// 61: deep link from the Meals tab "Log" button opens the review step directly
await page.goto(`${BASE}/foods?tab=meals`);
await page.waitForTimeout(800);
await page.getByRole('link', { name: /^Log Usual breakfast now/ }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: out('61-log-deep-link') });
await page.getByRole('button', { name: 'Close' }).click();
await page.waitForTimeout(400);

// ---------- desktop, light ----------
await d.goto(`${BASE}/foods/dishes/${dal.id}`);
await d.waitForTimeout(1000);
await d.screenshot({ path: out('62-desktop-dish-editor') });
await d.goto(`${BASE}/foods/meals/${templates[0].id}`);
await d.waitForTimeout(1000);
await d.screenshot({ path: out('63-desktop-meal-editor') });
await d.goto(`${BASE}/today/${TODAY}?log=t${templates[0].id}`);
await d.waitForTimeout(1200);
await d.screenshot({ path: out('64-desktop-log-template-review') });
await d.getByRole('button', { name: 'Close' }).click();
await d.waitForTimeout(400);
await d.goto(`${BASE}/foods?tab=meals`);
await d.waitForTimeout(900);
await d.screenshot({ path: out('65-desktop-meals-list') });

await phone.close();
await desktop.close();
await browser.close();
console.log('done');
