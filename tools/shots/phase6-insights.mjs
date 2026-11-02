// Phase 6 UI verification: node tools/shots/phase6-insights.mjs
// Seeds the demo month first (tools/seed-demo.mjs), then photographs the Insights screen.
import { execFileSync } from 'node:child_process';
import { chromium, devices } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
const PASSWORD = process.env.PLATE_PASSWORD ?? 'password';
const out = (name) => `/tmp/plate-shots/${name}.png`;

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const TODAY = dayKey(now);
const MONTH_START = `${TODAY.slice(0, 7)}-01`;
const LAST_MONTH_START = `${dayKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))}`;
const YEAR_START = `${TODAY.slice(0, 4)}-01-01`;
const daysAgo = (n) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));

if (!process.env.SKIP_SEED) {
  execFileSync(process.execPath, ['tools/seed-demo.mjs'], { stdio: 'inherit' });
}

const browser = await chromium.launch({ channel: 'chrome' });

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/today/);
  await page.waitForTimeout(500);
}

const wire = (page) => {
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('401'))
      console.log('CONSOLE', m.text().slice(0, 200));
  });
};

/** Scrolls a card heading into view with some breathing room above it. */
async function showCard(page, name) {
  const heading = page.getByRole('heading', { name, exact: true });
  await heading.evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -24);
  });
  await page.waitForTimeout(500);
}

// ---------- phone ----------
const phone = await browser.newContext({ ...devices['iPhone 14'], colorScheme: 'dark' });
const page = await phone.newPage();
wire(page);
await login(page);

await page.goto(`${BASE}/insights`);
await page.waitForTimeout(1600);
await page.screenshot({ path: out('60-insights-week') });
console.log('60 url:', page.url());

// The seed covers the last 35 days, so last month is the rich one.
await page.getByRole('radio', { name: 'Month' }).click();
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Previous period' }).click();
await page.waitForTimeout(1400);
console.log('61 url:', page.url());
await page.screenshot({ path: out('61-insights-month'), fullPage: true });

await page.getByRole('radio', { name: 'split' }).click();
await page.waitForTimeout(500);
await showCard(page, 'Macros');
await page.screenshot({ path: out('62-macros-split') });

await showCard(page, 'Calendar');
await page.screenshot({ path: out('63-heatmap') });

await showCard(page, 'Weight vs intake');
await page.screenshot({ path: out('64-weight-vs-intake') });

await page.getByRole('radio', { name: 'kcal' }).click();
await page.waitForTimeout(400);
await showCard(page, 'Top foods');
await page.screenshot({ path: out('65-top-foods-kcal') });

await showCard(page, 'By meal');
await page.screenshot({ path: out('66-by-meal') });

// Custom range sheet, prefilled with the month.
await page.evaluate(() => window.scrollTo(0, 0));
await page.getByRole('button', { name: 'Custom range' }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: out('67-custom-range-sheet') });
const sheet = page.getByRole('dialog', { name: 'Custom range' });
await sheet.getByLabel('From', { exact: true }).fill(daysAgo(20));
await sheet.getByLabel('To', { exact: true }).fill(TODAY);
await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
await page.waitForTimeout(1200);
console.log('67 custom url:', page.url());
await page.screenshot({ path: out('67b-insights-custom') });

// Year: weekly bars and the year strip.
await page.getByRole('radio', { name: 'Year' }).click();
await page.waitForTimeout(1600);
console.log('68 url:', page.url());
await page.screenshot({ path: out('68-insights-year'), fullPage: true });

// 3M: daily bars over ~92 days and one heatmap grid per month.
await page.getByRole('radio', { name: '3M' }).click();
await page.waitForTimeout(1600);
console.log('68b url:', page.url());
await page.screenshot({ path: out('68b-insights-3m'), fullPage: true });

// Empty range.
await page.goto(`${BASE}/insights?range=month&from=2019-01-01`);
await page.waitForTimeout(1200);
await page.screenshot({ path: out('69-insights-empty') });

// Navigation: ‹ moves back a month and the URL follows; › is disabled on the current period.
await page.goto(`${BASE}/insights?range=month&from=${MONTH_START}`);
await page.waitForTimeout(1000);
console.log(
  '69 next disabled on current month:',
  await page.getByRole('button', { name: 'Next period' }).isDisabled(),
);
await page.getByRole('button', { name: 'Previous period' }).click();
await page.waitForTimeout(800);
console.log('69 after ‹:', page.url());

// Last week: the single-row heatmap; then a heatmap cell opens that day in Today.
await page.goto(`${BASE}/insights?range=week&from=${daysAgo(7)}`);
await page.waitForTimeout(1200);
await showCard(page, 'Calendar');
await page.screenshot({ path: out('63b-heatmap-week') });
await page
  .getByRole('link', { name: /: (on target|under|over|no goal|not logged)/ })
  .first()
  .click();
await page.waitForTimeout(800);
console.log('heatmap click →', page.url());

// ---------- desktop ----------
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
});
const d = await desktop.newPage();
wire(d);
await login(d);
await d.goto(`${BASE}/insights?range=month&from=${LAST_MONTH_START}`);
await d.waitForTimeout(1600);
await d.screenshot({ path: out('70-desktop-month') });
await d.screenshot({ path: out('70b-desktop-month-full'), fullPage: true });

// Hover a bar for the tooltip.
const chart = d.locator('figure').first();
const box = await chart.boundingBox();
if (box) {
  await d.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await d.waitForTimeout(400);
  await d.screenshot({ path: out('70c-desktop-tooltip') });
}

await d.goto(
  `${BASE}/insights?range=3m&from=${dayKey(new Date(now.getFullYear(), now.getMonth() - 2, 1))}`,
);
await d.waitForTimeout(1600);
await d.screenshot({ path: out('70d-desktop-3m'), fullPage: true });

await d.goto(`${BASE}/insights?range=year&from=${YEAR_START}`);
await d.waitForTimeout(1600);
await d.screenshot({ path: out('71-desktop-year'), fullPage: true });

// Keyboard: ArrowLeft moves to the previous year.
await d.keyboard.press('ArrowLeft');
await d.waitForTimeout(600);
console.log('71 ArrowLeft →', d.url());

await phone.close();
await desktop.close();
await browser.close();
console.log('done');
