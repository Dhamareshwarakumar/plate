// Phase 8 UI verification: node tools/shots/phase8-lookup.mjs
// Food editor "Search online" (Open Food Facts): button, sheet idle/loading/results/empty/error/
// barcode, prefilled editor + saved provenance, hidden when disabled; phone dark + desktop light.
// One real search goes to OFF through the API when the network allows; every other state is
// produced with page.route() mocks of /api/off/* and /api/about (nothing is mocked in the app).
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
const PASSWORD = process.env.PLATE_PASSWORD ?? 'password';
const DIR = '/tmp/plate-shots';
const out = (name) => `${DIR}/${name}.png`;
mkdirSync(DIR, { recursive: true });

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

// ---------- mocked lookup results (already in the API's mapped shape) ----------
const per100 = (kcal, protein, carbs, fat, extra = {}) => ({
  kcal,
  protein,
  carbs,
  fat,
  fiber: null,
  sugar: null,
  saturatedFat: null,
  sodiumMg: null,
  ...extra,
});
const OAT_RESULTS = {
  items: [
    {
      code: '7394376616228',
      name: 'The original oat-ly barista edition oat drink',
      brand: 'Oatly',
      quantity: '1l',
      per100: per100(61, 1.1, 7.1, 3, { fiber: 0.8, sugar: 3.4, saturatedFat: 0.3, sodiumMg: 39 }),
    },
    {
      code: '7394376123337',
      name: 'Organic oat drink',
      brand: 'Oatly',
      quantity: '1 l',
      per100: per100(39, 1.1, 7.2, 0.5, { fiber: 0.8, sugar: 3.4, saturatedFat: 0.1, sodiumMg: 0 }),
    },
    {
      code: '5060120281975',
      name: 'Oat Organic Drink',
      brand: 'Rude Health',
      quantity: '1 litre',
      per100: per100(49, 0.5, 6.3, 2.3, {
        fiber: 0.9,
        sugar: 4.6,
        saturatedFat: 0.3,
        sodiumMg: 10,
      }),
    },
    {
      code: '4061459329834',
      name: 'Oat Milk (Barista Style) with a deliberately long product name to check truncation',
      brand: 'Aldi',
      quantity: '1 l',
      per100: per100(49, 1, 6.6, 1.9, { sugar: 3.6, saturatedFat: 0.2, sodiumMg: 59 }),
    },
    {
      code: '8001505005707',
      name: 'Avena Drink',
      brand: null,
      quantity: null,
      per100: per100(47, 0.8, 7.5, 1.4),
    },
  ],
};
const TWIX = {
  code: '5000159484695',
  name: 'Twix glacé',
  brand: 'Twix',
  quantity: '1 gram',
  per100: per100(280.74, 2.78, 34.8, 14.62, { sugar: 25.52, saturatedFat: 9.05, sodiumMg: 102 }),
};
const fulfillJson = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Routes /api/off/* to the mocked results; `delayMs` holds the response to show the skeleton. */
async function mockLookup(page, { delayMs = 0, search = OAT_RESULTS, status = 200 } = {}) {
  await page.unroute('**/api/off/**').catch(() => {});
  await page.route('**/api/off/**', async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const url = route.request().url();
    if (url.includes('/api/off/product/')) return fulfillJson(route, TWIX);
    return fulfillJson(route, search, status);
  });
}

const sheet = (page) => page.getByRole('dialog', { name: 'Search online' });
const searchBox = (page) => sheet(page).getByLabel('Search Open Food Facts');
const openSheet = async (page) => {
  await page.getByRole('button', { name: 'Search online' }).click();
  await sheet(page).waitFor();
  await page.waitForTimeout(500);
};
const runSearch = async (page, text) => {
  await searchBox(page).fill(text);
  await searchBox(page).press('Enter');
};

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

const about = await api('GET', '/about');
console.log('about:', JSON.stringify(about));

// Free the food name the prefill flow will save.
for (const f of (await api('GET', '/foods?query=Twix&includeArchived=true')).items) {
  if (f.name === 'Twix glacé') {
    await api('DELETE', `/foods/${f.id}`).catch((e) => console.log('cleanup:', e.message));
  }
}

// (a) editor with the button
await page.goto(`${BASE}/foods/new`);
await page.waitForTimeout(1000);
console.log(
  'search online button visible:',
  await page.getByRole('button', { name: 'Search online' }).isVisible(),
);
await page.screenshot({ path: out('80-editor-search-online') });

// (b) sheet idle
await openSheet(page);
console.log(
  'search disabled when empty:',
  await sheet(page).getByRole('button', { name: 'Search' }).isDisabled(),
);
await page.screenshot({ path: out('81-lookup-idle') });

// (c) one real search through the API (network permitting)
try {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/off/search'), { timeout: 10000 }),
    runSearch(page, 'oat milk'),
  ]);
  const body = await res.json().catch(() => ({}));
  const n = body.items?.length ?? 0;
  console.log(`real search: ${res.status()} ${n} items`);
  if (res.status() === 200 && n > 0) {
    await sheet(page).getByRole('list', { name: 'Results' }).waitFor({ timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: out('82-lookup-real-results') });
  }
} catch (e) {
  console.log('real search skipped (network):', e.message.split('\n')[0]);
}

// (d) mocked states: loading → results
await mockLookup(page, { delayMs: 3000 });
await runSearch(page, 'oat drink');
await page.waitForTimeout(300);
await page.screenshot({ path: out('83-lookup-loading') });
await sheet(page).getByRole('list', { name: 'Results' }).waitFor({ timeout: 6000 });
await page.waitForTimeout(400);
await page.screenshot({ path: out('84-lookup-results') });
console.log('results rows:', await sheet(page).getByRole('listitem').count());

// (e) empty
await mockLookup(page, { search: { items: [] } });
await runSearch(page, 'zzzz');
await sheet(page).getByText('No products found').waitFor();
await page.waitForTimeout(300);
await page.screenshot({ path: out('85-lookup-empty') });

// (f) error + retry (the "Failed to load resource" console line for the mocked 502 is expected).
// A query not searched before: the client caches results for ten minutes.
await mockLookup(page, {
  search: { error: { code: 'UPSTREAM_ERROR', message: 'Open Food Facts did not respond in time' } },
  status: 502,
});
await runSearch(page, 'soy drink');
await sheet(page).getByRole('alert').waitFor();
await page.waitForTimeout(300);
await page.screenshot({ path: out('86-lookup-error') });
console.log(
  'error text:',
  (await sheet(page).getByRole('alert').innerText()).replace(/\n/g, ' | '),
);
await mockLookup(page);
await sheet(page).getByRole('button', { name: 'Try again' }).click();
await sheet(page).getByRole('list', { name: 'Results' }).waitFor({ timeout: 6000 });
console.log('retry recovered:', await sheet(page).getByRole('listitem').count(), 'rows');

// (g) barcode → product
await runSearch(page, '5000159484695');
await sheet(page).getByText('Twix glacé').waitFor();
await page.waitForTimeout(300);
await page.screenshot({ path: out('87-lookup-barcode') });

// (h) pick → prefilled editor
await sheet(page)
  .getByRole('button', { name: /Twix glacé/ })
  .click();
await page.waitForTimeout(700);
console.log('sheet closed after pick:', (await page.getByRole('dialog').count()) === 0);
const fieldValue = (label) => page.getByLabel(label, { exact: true }).inputValue();
const values = {};
for (const label of [
  'Name',
  'Brand',
  'Calories',
  'Protein',
  'Carbs',
  'Fat',
  'Fiber',
  'Sugar',
  'Saturated fat',
  'Sodium',
]) {
  values[label] = await fieldValue(label);
}
console.log('prefilled:', JSON.stringify(values));
console.log(
  'hint:',
  await page
    .getByText(/^Barcode/)
    .first()
    .innerText(),
);
console.log(
  'more nutrients expanded:',
  await page.getByRole('button', { name: 'Fewer nutrients' }).isVisible(),
);
await page.screenshot({ path: out('88-editor-prefilled'), fullPage: true });

// (i) save → provenance on the server → delete again
const [created] = await Promise.all([
  page.waitForResponse((r) => r.url().endsWith('/api/foods') && r.request().method() === 'POST'),
  page.getByRole('button', { name: 'Save food' }).click(),
]);
console.log('POST /api/foods →', created.status());
const saved = await created.json();
const fetched = await api('GET', `/foods/${saved.id}`);
console.log(
  'saved provenance:',
  fetched.source,
  fetched.offCode,
  fetched.source === 'off' && fetched.offCode === '5000159484695' ? 'OK' : 'MISMATCH',
);
await page.waitForTimeout(800);
await api('DELETE', `/foods/${saved.id}`);
console.log('deleted food', saved.id);

// (j) disabled deployment: about says offEnabled false → no button
await page.route('**/api/about', (route) => fulfillJson(route, { ...about, offEnabled: false }));
await page.goto(`${BASE}/foods/new`);
await page.waitForTimeout(1000);
console.log(
  'button hidden when disabled:',
  (await page.getByRole('button', { name: 'Search online' }).count()) === 0,
);
await page.screenshot({ path: out('89-editor-lookup-disabled') });
await page.unroute('**/api/about');

// (k) desktop light
await mockLookup(d);
await d.goto(`${BASE}/foods/new`);
await d.waitForTimeout(1000);
await d.getByLabel('Name', { exact: true }).fill('oat drink');
await openSheet(d);
await sheet(d).getByRole('list', { name: 'Results' }).waitFor({ timeout: 6000 });
await d.waitForTimeout(400);
await d.screenshot({ path: out('90-desktop-lookup-results') });
await sheet(d)
  .getByRole('button', { name: /Organic oat drink/ })
  .click();
await d.waitForTimeout(700);
await d.screenshot({ path: out('91-desktop-prefilled') });
console.log('desktop prefilled name:', await d.getByLabel('Name', { exact: true }).inputValue());

await phone.close();
await desktop.close();
await browser.close();
console.log('done');
