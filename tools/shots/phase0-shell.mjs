// Screenshot helper for manual UI verification: node shoot.mjs <scenario> [...]
// Scenarios: login, login-error, app (logs in first), app-light, desktop, more
import { chromium, devices } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
const PASSWORD = process.env.PLATE_PASSWORD ?? 'password';
const out = (name) => `/tmp/plate-shots/${name}.png`;

const browser = await chromium.launch({ channel: 'chrome' });

async function phoneContext(colorScheme = 'dark') {
  return browser.newContext({ ...devices['iPhone 14'], colorScheme });
}
async function desktopContext(colorScheme = 'dark') {
  return browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme });
}

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/today/);
  await page.waitForTimeout(600);
}

const scenarios = {
  async login() {
    const ctx = await phoneContext('dark');
    const page = await ctx.newPage();
    await page.goto(`${BASE}/today`);
    await page.waitForURL(/\/login/);
    await page.waitForTimeout(800);
    await page.screenshot({ path: out('01-login-dark') });
    await page.getByLabel('Password', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('alert').waitFor();
    await page.screenshot({ path: out('02-login-error') });
    await ctx.close();
  },
  async app() {
    for (const scheme of ['dark', 'light']) {
      const ctx = await phoneContext(scheme);
      const page = await ctx.newPage();
      await login(page);
      await page.screenshot({ path: out(`03-today-${scheme}`) });
      await page.getByRole('link', { name: 'More' }).click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: out(`04-more-${scheme}`), fullPage: true });
      await ctx.close();
    }
  },
  async desktop() {
    const ctx = await desktopContext('dark');
    const page = await ctx.newPage();
    await login(page);
    await page.screenshot({ path: out('05-desktop-today') });
    await page.getByRole('link', { name: 'More' }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: out('06-desktop-more') });
    await ctx.close();
  },
  async changepw() {
    const ctx = await phoneContext('dark');
    const page = await ctx.newPage();
    await login(page);
    await page.getByRole('link', { name: 'More' }).click();
    await page.getByLabel('Current password').fill('wrong-current');
    await page.getByLabel('New password', { exact: true }).fill('new-password-123');
    await page.getByLabel('Confirm new password').fill('new-password-123');
    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByRole('alert').first().waitFor();
    await page.waitForTimeout(300);
    await page.getByLabel('Current password').scrollIntoViewIfNeeded();
    await page.screenshot({ path: out('07-changepw-error') });
    await ctx.close();
  },
};

const names = process.argv.slice(2);
for (const name of names.length ? names : Object.keys(scenarios)) {
  await scenarios[name]();
  console.log('done', name);
}
await browser.close();
