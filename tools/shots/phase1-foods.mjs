// Phase 1 UI verification: node shoot-foods.mjs
import { chromium, devices } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:5173';
const PASSWORD = process.env.PLATE_PASSWORD ?? 'password';
const out = (name) => `/tmp/plate-shots/${name}.png`;

const browser = await chromium.launch({ channel: 'chrome' });

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/today/);
  await page.waitForTimeout(500);
}

const phone = await browser.newContext({ ...devices['iPhone 14'], colorScheme: 'dark' });
const page = await phone.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200));
});

await login(page);
await page.screenshot({ path: out('10-today-banner') });

// Foods: empty state
await page.getByRole('link', { name: 'Foods' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: out('11-foods-empty') });

// New food form, filled with a sanity warning
await page.getByRole('link', { name: 'Add your first food' }).click();
await page.waitForURL(/\/foods\/new/);
await page.getByLabel('Name', { exact: true }).fill('Banana');
await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Fruit' });
await page.getByLabel('Calories', { exact: true }).fill('89');
await page.getByLabel('Protein', { exact: true }).fill('1.1');
await page.getByLabel('Carbs', { exact: true }).fill('22.8');
await page.getByLabel('Fat', { exact: true }).fill('0.3');
await page.getByRole('button', { name: 'Add portion' }).click();
await page.getByLabel('Portion 1 label').fill('1 medium');
await page.getByLabel('Portion 1 amount in g').fill('118');
await page.waitForTimeout(300);
await page.screenshot({ path: out('12-food-form'), fullPage: true });

// Trigger the macro sanity warning
await page.getByLabel('Calories', { exact: true }).fill('300');
await page.waitForTimeout(300);
await page.getByLabel('Calories', { exact: true }).scrollIntoViewIfNeeded();
await page.screenshot({ path: out('13-food-form-warning') });
await page.getByLabel('Calories', { exact: true }).fill('89');

// Save & add another, then add more foods quickly
await page.getByRole('button', { name: 'Save & add another' }).click();
await page.waitForTimeout(600);
const more = [
  ['Oats', 'Grain & Bread', '389', '16.9', '66.3', '6.9'],
  ['Chicken breast', 'Protein', '165', '31', '0', '3.6'],
  ['Greek yogurt', 'Dairy', '59', '10', '3.6', '0.4'],
  ['Peanut butter', 'Nuts & Seeds', '588', '25', '20', '50'],
];
for (const [name, cat, kcal, p, c, f] of more) {
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Category', { exact: true }).selectOption({ label: cat });
  await page.getByLabel('Calories', { exact: true }).fill(kcal);
  await page.getByLabel('Protein', { exact: true }).fill(p);
  await page.getByLabel('Carbs', { exact: true }).fill(c);
  await page.getByLabel('Fat', { exact: true }).fill(f);
  await page.getByRole('button', { name: 'Save & add another' }).click();
  await page.waitForTimeout(500);
}
await page.goto(`${BASE}/foods`);
await page.waitForTimeout(800);
await page.screenshot({ path: out('14-foods-list') });

// Search with typo
await page.getByLabel('Search foods').fill('yogrt');
await page.waitForTimeout(400);
await page.screenshot({ path: out('15-foods-search-typo') });
await page.getByLabel('Search foods').fill('mango');
await page.waitForTimeout(400);
await page.screenshot({ path: out('16-foods-search-none') });
await page.getByLabel('Clear search').click();

// Edit page
await page.getByRole('link', { name: /Peanut butter/ }).click();
await page.waitForURL(/\/foods\/\d+/);
await page.waitForTimeout(600);
await page.screenshot({ path: out('17-food-edit'), fullPage: true });

// Import sheet with preview
await page.goto(`${BASE}/foods`);
await page.getByRole('button', { name: 'More actions' }).click();
await page.getByRole('menuitem', { name: 'Import CSV…' }).click();
await page.waitForTimeout(500);
const csvPath = '/tmp/plate-shots/sample.csv';
writeFileSync(
  csvPath,
  'name,brand,category,basis,kcal,protein,carbs,fat,fiber,sugar,saturated_fat,sodium_mg,portions\n' +
    'Banana,,Fruit,g,89,1.1,22.8,0.3,2.6,12.2,,1,1 medium=118\n' +
    '"Milk, whole",Arla,Dairy,ml,64,3.3,4.8,3.6,,,2.3,44,1 cup=240\n' +
    'Mystery,,Nope,g,10,1,1,1,,,,,\n' +
    'Brown rice,,Grain & Bread,g,112,2.3,23.5,0.8,1.8,,,,1 cup cooked=195\n',
);
await page.locator('input[type=file]').setInputFiles(csvPath);
await page.waitForTimeout(900);
await page.screenshot({ path: out('18-import-preview') });
await page.getByRole('button', { name: /Import \d+ foods?/ }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: out('19-after-import') });

// Categories manager
await page.goto(`${BASE}/more/categories`);
await page.waitForTimeout(700);
await page.screenshot({ path: out('20-categories') });
await phone.close();

// Desktop: list + editor side by side, light theme
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
});
const d = await desktop.newPage();
d.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await login(d);
await d.goto(`${BASE}/foods`);
await d.waitForTimeout(700);
await d.screenshot({ path: out('21-desktop-foods') });
await d.getByRole('link', { name: /Oats/ }).click();
await d.waitForTimeout(700);
await d.screenshot({ path: out('22-desktop-foods-editor') });
await desktop.close();

await browser.close();
console.log('done');
