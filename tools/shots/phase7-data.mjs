// Phase 7 UI verification: node tools/shots/phase7-data.mjs
// More → Data card (exports, import backup sheet in every state, restore round trip, diary CSV
// range sheet), About card, page order; phone dark + desktop light. Downloads are asserted by name.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** The card (rounded container) that holds the given heading. */
const cardOf = (page, heading) =>
  page
    .getByRole('heading', { name: heading, exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-card")][1]');

/** Clicks a Data-card row and returns the resulting download, asserting its suggested file name. */
async function download(page, label, pattern) {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: label, exact: true }).click(),
  ]);
  const name = dl.suggestedFilename();
  console.log(`${label} →`, name, pattern.test(name) ? 'OK' : 'UNEXPECTED NAME');
  return dl;
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

const aboutBefore = await api('GET', '/about');
console.log('about before:', JSON.stringify(aboutBefore));

// (a) More page order + Data card
await page.goto(`${BASE}/more`);
await page.waitForTimeout(1200);
await page.screenshot({ path: out('70-more-full'), fullPage: true });
await cardOf(page, 'Data').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await cardOf(page, 'Data').screenshot({ path: out('71-data-card') });

// (b) downloads
const backupDl = await download(page, 'Export backup', /^plate-backup-\d{4}-\d{2}-\d{2}\.json$/);
await backupDl.saveAs(`${DIR}/backup.json`);
const backup = JSON.parse(readFileSync(`${DIR}/backup.json`, 'utf8'));
console.log(
  'backup.json:',
  backup.format,
  'v' + backup.version,
  Object.keys(backup.data).length,
  'tables,',
  backup.data.foods.length,
  'foods,',
  backup.data.diaryEntries.length,
  'entries',
);
await download(page, 'Download database snapshot', /^plate-\d{4}-\d{2}-\d{2}\.sqlite$/);
await download(page, 'Export foods CSV', /^plate-foods-\d{4}-\d{2}-\d{2}\.csv$/);

// (c) Import backup sheet: empty → not a backup → preview → confirmed → restored
await page.getByRole('button', { name: 'Import backup…' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: out('72-import-empty') });

const dialog = page.getByRole('dialog');
writeFileSync(`${DIR}/not-a-backup.json`, '{"hello":1}\n');
await dialog.locator('input[type=file]').setInputFiles(`${DIR}/not-a-backup.json`);
await page.waitForTimeout(400);
await page.screenshot({ path: out('73-import-not-a-backup') });
console.log('73 alert:', await dialog.getByRole('alert').innerText());
console.log(
  '73 restore disabled:',
  await dialog.getByRole('button', { name: 'Restore backup' }).isDisabled(),
);

await dialog.locator('input[type=file]').setInputFiles(`${DIR}/backup.json`);
await page.waitForTimeout(800);
await page.screenshot({ path: out('74-import-preview') });
console.log(
  '74 restore disabled before typing:',
  await dialog.getByRole('button', { name: 'Restore backup' }).isDisabled(),
);
await dialog.getByLabel('Type REPLACE to confirm').fill('REPLACE');
await page.waitForTimeout(300);
await dialog.getByLabel('Type REPLACE to confirm').scrollIntoViewIfNeeded();
await page.screenshot({ path: out('75-import-confirmed') });
console.log(
  '75 restore enabled:',
  await dialog.getByRole('button', { name: 'Restore backup' }).isEnabled(),
);
await dialog.getByRole('button', { name: 'Restore backup' }).click();
await page.getByText(/Backup restored/).waitFor({ timeout: 15000 });
await page.waitForTimeout(300);
await page.screenshot({ path: out('76-import-restored-toast') });
console.log('76 toast:', await page.getByText(/Backup restored/).innerText());
const aboutAfter = await api('GET', '/about');
console.log(
  'about after restore:',
  JSON.stringify(aboutAfter.counts),
  JSON.stringify(aboutAfter.counts) === JSON.stringify(aboutBefore.counts)
    ? 'counts unchanged OK'
    : 'COUNTS DIFFER',
);
await page.waitForTimeout(2500);

// (d) Export diary CSV range sheet
await page.getByRole('button', { name: 'Export diary CSV…' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: out('77-export-diary-sheet') });
const from = await page.getByRole('dialog').getByLabel('From').inputValue();
const to = await page.getByRole('dialog').getByLabel('To').inputValue();
console.log('77 default range:', from, '→', to);
await page.getByRole('dialog').getByRole('button', { name: 'This month' }).click();
await page.waitForTimeout(200);
const from2 = await page.getByRole('dialog').getByLabel('From').inputValue();
const to2 = await page.getByRole('dialog').getByLabel('To').inputValue();
console.log('77 this month:', from2, '→', to2);
const [csvDl] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('dialog').getByRole('button', { name: 'Download CSV' }).click(),
]);
const csvName = csvDl.suggestedFilename();
console.log(
  'Export diary CSV →',
  csvName,
  csvName === `plate-diary-${from2}_${to2}.csv` ? 'OK' : 'UNEXPECTED NAME',
);
await page.waitForTimeout(500);
console.log('77 sheet closed after download:', (await page.getByRole('dialog').count()) === 0);

// (e) About card
await cardOf(page, 'About').scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await cardOf(page, 'About').screenshot({ path: out('78-about-card') });
console.log('78 about:', (await cardOf(page, 'About').innerText()).replace(/\n/g, ' | '));

// (f) Library card links
await cardOf(page, 'Library').scrollIntoViewIfNeeded();
console.log(
  'library links:',
  await page.getByRole('link', { name: 'Meal slots' }).getAttribute('href'),
  await page.getByRole('link', { name: 'Categories' }).getAttribute('href'),
);

// (f2) About loading + error state with retry: the route fails until unrouted (the two
// "Failed to load resource" console lines this logs are expected).
await page.route('**/api/about', (route) => route.abort());
await page.goto(`${BASE}/more`);
await page.waitForTimeout(400);
await cardOf(page, 'About').scrollIntoViewIfNeeded();
await cardOf(page, 'About').screenshot({ path: out('79a-about-loading') });
await page.waitForTimeout(4500);
await cardOf(page, 'About').screenshot({ path: out('79b-about-error') });
await page.unroute('**/api/about');
await cardOf(page, 'About').getByRole('button', { name: 'Try again' }).click();
await page.waitForTimeout(800);
console.log(
  '79 retry recovered:',
  (await cardOf(page, 'About').innerText()).includes('Days logged'),
);

// (g) desktop
await d.goto(`${BASE}/more`);
await d.waitForTimeout(1200);
await d.screenshot({ path: out('80-desktop-more'), fullPage: true });
await d.getByRole('button', { name: 'Import backup…' }).click();
await d.waitForTimeout(600);
await d.getByRole('dialog').locator('input[type=file]').setInputFiles(`${DIR}/backup.json`);
await d.waitForTimeout(800);
await d.getByRole('dialog').getByLabel('Type REPLACE to confirm').fill('REPL');
await d.waitForTimeout(200);
await d.screenshot({ path: out('81-desktop-import-preview') });
await d.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
await d.waitForTimeout(400);
await d.getByRole('button', { name: 'Export diary CSV…' }).click();
await d.waitForTimeout(600);
await d.screenshot({ path: out('82-desktop-export-diary') });
await d.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

await phone.close();
await desktop.close();
await browser.close();
console.log('done');
