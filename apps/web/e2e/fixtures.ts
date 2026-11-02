import { test as base, expect, type Page } from '@playwright/test';
import { E2E_PASSWORD } from './constants';

export const PASSWORD = E2E_PASSWORD;

/** Typed JSON call through the page's cookie jar: `api('POST', '/foods', { ... })`. */
export type ApiCall = <T = unknown>(method: string, path: string, data?: unknown) => Promise<T>;

interface Fixtures {
  /** The page after a session cookie was obtained through the API (no login screen). */
  loggedIn: Page;
  api: ApiCall;
}

export const test = base.extend<Fixtures>({
  loggedIn: async ({ page }, use) => {
    const res = await page.request.post('/api/auth/login', { data: { password: PASSWORD } });
    expect(res.ok(), `login: ${res.status()} ${await res.text()}`).toBeTruthy();
    await use(page);
  },
  api: async ({ page }, use) => {
    const call: ApiCall = async <T>(method: string, path: string, data?: unknown) => {
      const res = await page.request.fetch(`/api${path}`, {
        method,
        ...(data !== undefined ? { data } : {}),
      });
      if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
      return (res.status() === 204 ? undefined : await res.json()) as T;
    };
    await use(call);
  },
});

export { expect };

/** Today's day key in the browser's own zone, the way the app computes it (TECH §3). */
export async function browserTodayKey(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  });
}

/** Signs in through the form and lands on Today. */
export async function loginThroughForm(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/today\/\d{4}-\d{2}-\d{2}/);
}
