// Phase 10a UI verification: node tools/shots/phase10-followups.mjs
// Reviewer follow-ups: portion drag handles + move buttons in the food editor, the food picker's
// Meals shelf error (and the notice while searching), "Copy to another day…" from an archived meal,
// the summary card over the goal but on target, the lazy-chunk error page inside the shell, the
// adherence card's loading headline, the profile Sex group, weekly x-axis ticks on Insights and the
// goal band over a clipped first week (year view with a goal on every day, mocked).
// Phone dark + desktop light. Mocks are page.route() only (nothing is mocked in the app); the one
// piece of real data it creates (a food with three portions, an archived "Followups supper" slot
// with one entry) is removed again except the archived, empty slot (slots are never deleted).
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
const PASSWORD = process.env.PLATE_PASSWORD ?? 'password';
const DIR = '/tmp/plate-shots';
const out = (name) => `${DIR}/${name}.png`;
mkdirSync(DIR, { recursive: true });

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

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
    if (
      m.type() === 'error' &&
      !/401|500|Failed to load resource|dynamically imported/.test(m.text())
    )
      console.log('CONSOLE', m.text().slice(0, 200));
  });
};

const fulfillJson = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

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

// ---------- data: a food with three portions ----------
for (const f of (await api('GET', '/foods?query=Followups&includeArchived=true')).items) {
  if (f.name.startsWith('Followups')) {
    await api('DELETE', `/foods/${f.id}`).catch((e) => console.log('cleanup:', e.message));
  }
}
const banana = await api('POST', '/foods', {
  name: 'Followups banana',
  per100: {
    kcal: 89,
    protein: 1.1,
    carbs: 22.8,
    fat: 0.3,
    fiber: null,
    sugar: null,
    saturatedFat: null,
    sodiumMg: null,
  },
  portions: [
    { label: '1 small', amount: 101 },
    { label: '1 medium', amount: 118 },
    { label: '1 large', amount: 136 },
  ],
});

// (a) food editor: portions with drag handles and move buttons; then one move.
await page.goto(`${BASE}/foods/${banana.id}`);
await page.getByLabel('Portion 1 label').waitFor();
await page.getByLabel('Portion 1 label').scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.screenshot({ path: out('100-portions-phone') });
await page.getByRole('button', { name: 'Move portion 1 down' }).click();
await page.waitForTimeout(500);
console.log(
  'portion order after move:',
  await Promise.all([1, 2, 3].map((n) => page.getByLabel(`Portion ${n} label`).inputValue())),
);
await page.screenshot({ path: out('101-portions-moved-phone') });
// A real pointer drag on the handle: row 1 ("1 medium" now) dragged below row 2.
const handle = page.getByRole('list', { name: 'Portions' }).locator('[aria-hidden="true"]').first();
const rows = page.getByRole('list', { name: 'Portions' }).getByRole('listitem');
const from = await handle.boundingBox();
const target = await rows.nth(1).boundingBox();
if (from && target) {
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(
      from.x + from.width / 2,
      from.y + from.height / 2 + ((target.y + target.height - from.y) * i) / 8,
      { steps: 2 },
    );
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
  console.log(
    'portion order after drag:',
    await Promise.all([1, 2, 3].map((n) => page.getByLabel(`Portion ${n} label`).inputValue())),
  );
}

await d.goto(`${BASE}/foods/${banana.id}`);
await d.getByLabel('Portion 1 label').waitFor();
await d.getByLabel('Portion 1 label').scrollIntoViewIfNeeded();
await d.waitForTimeout(400);
await d.screenshot({ path: out('102-portions-desktop') });

// (b) food picker: meal templates fail → Meals shelf error, notice while searching.
await page.route('**/api/meal-templates', (route) =>
  fulfillJson(route, { error: { code: 'INTERNAL_ERROR', message: 'Database is locked' } }, 500),
);
await page.goto(`${BASE}/today/${TODAY}?log=new`);
const logSheet = page.getByRole('dialog');
await logSheet.waitFor();
await logSheet.getByRole('tab', { name: 'Meals' }).click();
await logSheet.getByRole('alert').waitFor();
await page.waitForTimeout(300);
await page.screenshot({ path: out('103-picker-meals-error-phone') });
console.log('meals error:', (await logSheet.getByRole('alert').innerText()).replace(/\n/g, ' | '));
await logSheet.getByLabel('Search foods').fill('ban');
await page.waitForTimeout(400);
await page.screenshot({ path: out('104-picker-search-templates-notice-phone') });
await page.unroute('**/api/meal-templates');

// (c) copy sheet from an archived meal: create a slot, log into it, archive it.
const slots = await api('GET', '/meal-slots?includeArchived=true');
let supper = slots.find((s) => s.name === 'Followups supper');
if (!supper) {
  supper = await api('POST', '/meal-slots', {
    name: 'Followups supper',
    windowStartMin: 1320,
    windowEndMin: 60,
  });
}
if (supper.archivedAt) await api('POST', `/meal-slots/${supper.id}/unarchive`);
const entry = await api('POST', '/diary/entries', {
  day: TODAY,
  slotId: supper.id,
  loggedAt: `${TODAY}T22:10:00.000Z`,
  foodId: banana.id,
  quantity: 118,
  basis: 'g',
  portionLabel: '1 medium',
  portionCount: 1,
  note: null,
});
await api('POST', `/meal-slots/${supper.id}/archive`);
await page.goto(`${BASE}/today/${TODAY}`);
const menuButton = page.getByRole('button', { name: 'Followups supper actions' });
await menuButton.waitFor();
await menuButton.scrollIntoViewIfNeeded();
await menuButton.click();
await page.getByRole('menuitem', { name: 'Copy to another day…' }).click();
const copySheet = page.getByRole('dialog', { name: 'Copy to another day' });
await copySheet.waitFor();
await page.waitForTimeout(400);
const options = await copySheet.getByLabel('Into meal').locator('option').allInnerTexts();
console.log('into-meal options for the archived source:', options);
await page.screenshot({ path: out('105-copy-from-archived-phone') });
await page.keyboard.press('Escape');
await api('DELETE', `/diary/entries/${entry.id}`);

// (d) summary card: over the goal but inside the band (mocked day response).
await page.route(`**/api/diary/${TODAY}`, async (route) => {
  const res = await route.fetch();
  const day = await res.json();
  if (day.goal) {
    const kcal = Math.round(day.goal.kcal * 1.05);
    day.totals.kcal = kcal;
    day.status = 'on_target';
    day.remaining = { ...day.remaining, kcal: day.goal.kcal - kcal };
  }
  return fulfillJson(route, day);
});
await page.goto(`${BASE}/today/${TODAY}`);
await page.getByText('On target', { exact: true }).waitFor();
await page.waitForTimeout(600);
await page.screenshot({ path: out('106-summary-over-on-target-phone') });
console.log(
  'over line classes:',
  await page
    .getByText(/ over$/)
    .first()
    .locator('..')
    .getAttribute('class'),
);
await page.unroute(`**/api/diary/${TODAY}`);

// (e) lazy chunk failure → error page inside the shell (dev serves modules individually).
await page.route('**/features/insights/InsightsPage.tsx*', (route) => route.abort());
await page.goto(`${BASE}/today/${TODAY}`);
await page.getByRole('link', { name: 'Insights' }).click();
await page.getByRole('alert').waitFor();
await page.waitForTimeout(300);
await page.screenshot({ path: out('107-chunk-error-phone') });
console.log('chunk error:', (await page.getByRole('alert').innerText()).replace(/\n/g, ' | '));
await page.unroute('**/features/insights/InsightsPage.tsx*');
await page.getByRole('button', { name: 'Reload' }).click();
await page.getByRole('heading', { name: 'Insights' }).waitFor();
console.log('reload recovered the Insights page');

await d.route('**/features/weight/WeightPage.tsx*', (route) => route.abort());
await d.goto(`${BASE}/today/${TODAY}`);
await d.getByRole('link', { name: 'Weight' }).click();
await d.getByRole('alert').waitFor();
await d.waitForTimeout(300);
await d.screenshot({ path: out('108-chunk-error-desktop') });
await d.unroute('**/features/weight/WeightPage.tsx*');

// (f) More: adherence headline while settings load, then the profile Sex group.
await page.route('**/api/settings', async (route) => {
  await new Promise((r) => setTimeout(r, 2500));
  return route.continue();
});
await page.goto(`${BASE}/more`);
await page.getByText('Adherence tolerance').waitFor();
await page.waitForTimeout(300);
await page.screenshot({ path: out('109-adherence-loading-phone') });
// Let the delayed handler answer before removing it (unrouting earlier cancels it).
await page.waitForTimeout(2800);
await page.unroute('**/api/settings');
await page.getByText('Profile').first().scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: out('110-profile-sex-group-phone') });
console.log(
  'sex group labelled by:',
  await page.getByRole('radiogroup', { name: 'Sex' }).getAttribute('aria-labelledby'),
);

// (g) Insights year on desktop (weekly bars): the first tick is the range start (1 Jan), not the
// Monday of the aligned week before it.
await d.goto(`${BASE}/insights?range=year`);
await d.getByRole('heading', { name: 'Insights' }).waitFor();
await d.waitForTimeout(1500);
const firstTick = await d.evaluate(
  () =>
    document.querySelector('figure svg .recharts-cartesian-axis-tick-value')?.textContent ?? null,
);
console.log('first weekly tick:', firstTick);
await d.screenshot({ path: out('111-insights-year-desktop') });

// (h) The same year view with a goal on every day, so the goal band and dashed line cover the
// clipped first week too: the band must start at the plot's left edge (after the Y-axis labels),
// never at x = 0 of the SVG.
const goalEveryDay = async (route) => {
  const res = await route.fetch();
  const rows = await res.json();
  return fulfillJson(
    route,
    rows.map((row) => ({
      ...row,
      goalKcal: 2000,
      status: row.entryCount === 0 ? 'not_logged' : 'on_target',
    })),
  );
};
const bandGeometry = () => ({
  plotX: document.querySelector('figure svg defs clipPath rect')?.getAttribute('x') ?? null,
  bandX: document.querySelector('.recharts-reference-area-rect')?.getAttribute('x') ?? null,
  bandWidth: document.querySelector('.recharts-reference-area-rect')?.getAttribute('width') ?? null,
  goalLineX1: document.querySelector('.recharts-reference-line-line')?.getAttribute('x1') ?? null,
});
for (const [who, p, name] of [
  ['desktop', d, '112-insights-year-goal-band-desktop'],
  ['phone', page, '113-insights-year-goal-band-phone'],
]) {
  await p.route('**/api/insights/daily?*', goalEveryDay);
  await p.goto(`${BASE}/insights?range=year`);
  await p.getByRole('heading', { name: 'Insights' }).waitFor();
  await p.locator('.recharts-reference-area-rect').first().waitFor();
  await p.waitForTimeout(800);
  const geometry = await p.evaluate(bandGeometry);
  console.log(`${who} year band (bandX must equal plotX):`, geometry);
  if (geometry.bandX !== geometry.plotX) console.log(`BAND MISPLACED on ${who}`);
  await p.screenshot({ path: out(name) });
  await p.unroute('**/api/insights/daily?*');
}

// ---------- cleanup ----------
await api('DELETE', `/foods/${banana.id}`).catch((e) => console.log('cleanup:', e.message));
await browser.close();
console.log('done');
