import { expect, test } from './fixtures';

interface Manifest {
  id: string;
  start_url: string;
  theme_color: string;
  display: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

test.describe('PWA shell', () => {
  test('serves an installable manifest with reachable icons and theme colour', async ({ page }) => {
    const res = await page.request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('manifest');
    const manifest = (await res.json()) as Manifest;
    expect(manifest).toMatchObject({
      id: '/',
      start_url: '/today',
      theme_color: '#f97316',
      display: 'standalone',
    });
    expect(manifest.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512', '512x512']);
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const img = await page.request.get(`/${icon.src}`);
      expect(img.status(), icon.src).toBe(200);
      expect(img.headers()['content-type']).toBe(icon.type);
    }
  });

  test('ships a service worker that is never cached stale and a CSP-clean shell', async ({
    page,
  }) => {
    const sw = await page.request.get('/sw.js');
    expect(sw.status()).toBe(200);
    expect(sw.headers()['cache-control']).toBe('no-cache');

    const errors: string[] = [];
    page.on('console', (msg) => {
      // The signed-out session probe answers 401 by design; Chrome logs that as an error line.
      if (msg.type() === 'error' && !msg.text().includes('401')) errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));
    // The theme bootstrap is an external file; an inline script would be blocked here (D133).
    const themeInit = page.waitForResponse('**/theme-init.js');
    await page.goto('/login');
    expect((await themeInit).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(errors.filter((e) => /Content Security Policy|Refused to/i.test(e))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('shows the error state with retry while the API is unreachable', async ({
    loggedIn: page,
  }) => {
    await page.route('**/api/**', (route) => route.abort('connectionfailed'));
    await page.goto('/today');
    const error = page.getByRole('alert');
    await expect(error).toContainText("Can't reach Plate");
    const retry = error.getByRole('button', { name: 'Try again' });
    await expect(retry).toBeVisible();

    await page.unroute('**/api/**');
    await retry.click();
    await expect(page).toHaveURL(/\/today\/\d{4}-\d{2}-\d{2}/);
    await expect(page.getByRole('region', { name: 'Day summary' })).toBeVisible();
  });

  test('offline: the precached shell renders the error state and recovers', async ({
    loggedIn: page,
    context,
  }) => {
    await page.goto('/today');
    await expect(page.getByRole('region', { name: 'Day summary' })).toBeVisible();

    // The first install claims the open page (workbox clientsClaim), so a reload is served from
    // the precache without a second visit.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (navigator.serviceWorker.controller) return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('worker never claimed the page')), 10_000);
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    });

    await context.setOffline(true);
    await page.reload();
    const error = page.getByRole('alert');
    await expect(error).toContainText("Can't reach Plate");

    await context.setOffline(false);
    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('region', { name: 'Day summary' })).toBeVisible();
  });
});
