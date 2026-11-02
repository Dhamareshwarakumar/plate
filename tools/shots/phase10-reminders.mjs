// Phase 10c UI verification: node tools/shots/phase10-reminders.mjs
// More → Reminders: the schedule card (master switch, meal rows with time + "only if empty",
// weigh-in, water, time-zone footer), the devices card in every state (checking → ready, enabled
// with "This device", denied, iPhone-not-installed, unsupported browser, insecure context,
// no service worker), test-notification toasts, remove-device confirm, loading and error states,
// the More page row, and the desktop layout. Phone dark + desktop light.
//
// The dev build has no service worker and Playwright's Chrome has no push service, so an init
// script fakes `navigator.serviceWorker.ready`, `pushManager` and `Notification` (nothing is mocked
// inside the app). The subscriptions it registers are real rows on the dev API (endpoints under
// https://push.example/…); the script deletes them and resets the reminder settings at the end.
// The one `page.route()` mock is a successful `/api/push/test` (the fake endpoint cannot be
// reached); the real call is also made once and its { failed: 1 } result is logged. Expected
// console lines: the mocked requests' `Failed to load resource` (loading/error shots) only.
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
const PASSWORD = process.env.PLATE_PASSWORD ?? 'password';
const DIR = '/tmp/plate-shots';
const out = (name) => `${DIR}/${name}.png`;
mkdirSync(DIR, { recursive: true });

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
// The iPhone 14 preset reports Safari on iPhone; the generic "unsupported" state needs another OS.
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

const browser = await chromium.launch({ channel: 'chrome' });

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/today/);
  await page.waitForTimeout(400);
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
    if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text()))
      console.log('CONSOLE', m.text().slice(0, 200));
  });
};

/**
 * Fakes the push plumbing: a ready service-worker registration whose pushManager hands out one
 * subscription for `endpoint`, and a Notification object with the given permission.
 * `pushApis: false` removes PushManager (what Safari in a tab / an old browser looks like).
 */
const fakePush = ({
  permission = 'default',
  grant = 'granted',
  endpoint,
  pushApis = true,
  insecure = false,
}) => `
(() => {
  const endpoint = ${JSON.stringify(endpoint)};
  // A real subscription survives reloads; remember it per endpoint in localStorage.
  const storageKey = 'plate-shots-push:' + endpoint;
  const makeSub = (options) => ({
    endpoint,
    expirationTime: null,
    options: { applicationServerKey: options?.applicationServerKey?.buffer?.slice(0) ?? null },
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'BFakeP256dhKeyForShots', auth: 'FakeAuthForShots' } }),
    unsubscribe: async () => { state.subscription = null; localStorage.removeItem(storageKey); return true; },
  });
  const state = {
    permission: ${JSON.stringify(permission)},
    subscription: localStorage.getItem(storageKey) ? makeSub({ applicationServerKey: null }) : null,
  };
  const registration = {
    pushManager: {
      getSubscription: async () => state.subscription,
      subscribe: async (options) => { localStorage.setItem(storageKey, '1'); return (state.subscription = makeSub(options)); },
    },
    showNotification: async () => undefined,
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registration), getRegistration: async () => registration, addEventListener() {}, removeEventListener() {} },
  });
  if (${pushApis}) {
    if (!('PushManager' in window)) window.PushManager = function PushManager() {};
  } else {
    delete window.PushManager;
  }
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: {
      get permission() { return state.permission; },
      requestPermission: async () => { state.permission = ${JSON.stringify(grant)}; return state.permission; },
    },
  });
  if (${insecure}) Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
})();
`;

const fulfillJson = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Scrolls the element to the middle of the viewport first: the fixed tab bar covers the bottom. */
async function clickCentered(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await locator.page().waitForTimeout(150);
  await locator.click();
}

async function newPhone(initScript, extra = {}) {
  const context = await browser.newContext({
    ...devices['iPhone 14'],
    colorScheme: 'dark',
    ...extra,
  });
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  wire(page);
  await login(page);
  return { context, page };
}

// ---------- baseline: one authenticated context for data set-up and clean-up ----------
const admin = await browser.newContext();
const adminPage = await admin.newPage();
await login(adminPage);
const api = apiFor(adminPage);

async function cleanup() {
  for (const d of await api('GET', '/push/subscriptions')) {
    if (d.endpoint.startsWith('https://push.example/')) {
      await api('DELETE', `/push/subscriptions/${d.id}`).catch((e) =>
        console.log('cleanup:', e.message),
      );
    }
  }
  const current = await api('GET', '/reminders');
  await api('PUT', '/reminders', {
    enabled: false,
    timezone: current.timezone ?? 'Asia/Kolkata',
    meals: current.meals.map((m) => ({ ...m, enabled: true, onlyIfEmpty: true })),
    weighIn: { enabled: true, minute: 450 },
    water: { enabled: false, minute: 1020 },
  });
}
await cleanup();
const defaults = await api('GET', '/reminders');
console.log('default config:', JSON.stringify({ ...defaults, meals: defaults.meals.length }));

// ---------- (a) More page row + reminders page, phone dark, happy path ----------
const PHONE_ENDPOINT = 'https://push.example/phase10-shots-phone';
const { page, context: phone } = await newPhone(fakePush({ endpoint: PHONE_ENDPOINT }));

await page.goto(`${BASE}/more`);
await page.getByRole('link', { name: /Reminders/ }).waitFor();
await page.waitForTimeout(500);
await page.screenshot({ path: out('140-more-reminders-row-phone') });
console.log(
  'More row:',
  (await page.getByRole('link', { name: /Reminders/ }).innerText()).replace(/\n/g, ' · '),
);

await page.getByRole('link', { name: /Reminders/ }).click();
await page.waitForURL(/\/more\/reminders/);
await page.getByRole('button', { name: 'Enable on this device' }).waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: out('141-reminders-initial-phone'), fullPage: true });

// Master switch on → status line changes, rows become fully opaque.
await clickCentered(page.getByRole('switch', { name: 'Reminders' }));
await page.waitForTimeout(600);
await page.screenshot({ path: out('142-reminders-master-on-phone'), fullPage: true });
console.log('status after master on:', await page.getByText(/^On/).first().innerText());

// Enable on this device → permission (faked granted) → subscribe → server row → toast.
await clickCentered(page.getByRole('button', { name: 'Enable on this device' }));
await page.getByText('Reminders are on for this device').waitFor();
await page.waitForTimeout(500);
await page.screenshot({ path: out('143-reminders-enabled-phone') });
const enrolled = await api('GET', '/push/subscriptions');
console.log(
  'enrolled devices:',
  enrolled.map((d) => `${d.deviceLabel} (${d.timezone}) ${d.endpoint.slice(-12)}`),
);

// Real test call (the fake keys are rejected by web-push → failed: 1 → error toast), logged, not shot.
await clickCentered(page.getByRole('button', { name: 'Send test notification' }));
await page.getByText(/push service refused/).waitFor({ timeout: 20_000 });
console.log('real test result toast:', await page.getByText(/push service refused/).innerText());
await page.waitForTimeout(4500);

// Mocked success → the toast the user sees when the push service accepts the message.
await page.route('**/api/push/test', (route) =>
  fulfillJson(route, { sent: 1, failed: 0, removed: 0 }),
);
await clickCentered(page.getByRole('button', { name: 'Send test notification' }));
await page.getByText(/Test notification sent/).waitFor();
await page.waitForTimeout(300);
await page.screenshot({ path: out('144-reminders-test-toast-phone') });
await page.unroute('**/api/push/test');
await page.waitForTimeout(4500);

// Schedule edits: Snacks off, Dinner at 21:30 without the "only if empty" condition, water on.
await clickCentered(page.getByRole('switch', { name: 'Snacks' }));
await page.getByLabel('Dinner reminder time').fill('21:30');
await clickCentered(page.getByRole('switch', { name: 'Water' }));
const dinnerRow = page
  .getByRole('listitem')
  .filter({ has: page.getByRole('switch', { name: 'Dinner' }) });
await clickCentered(dinnerRow.getByRole('checkbox'));
await page.waitForTimeout(800);
const saved = await api('GET', '/reminders');
console.log(
  'saved config:',
  JSON.stringify({
    enabled: saved.enabled,
    timezone: saved.timezone,
    water: saved.water,
    meals: saved.meals.map(
      (m) =>
        `${m.slotId}:${m.enabled ? 'on' : 'off'}@${m.minute}${m.onlyIfEmpty ? ' ifEmpty' : ''}`,
    ),
  }),
);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
await page.screenshot({ path: out('145-reminders-schedule-edited-phone') });

// Remove-device confirm for another device (added through the API).
await api('POST', '/push/subscriptions', {
  subscription: {
    endpoint: 'https://push.example/phase10-shots-laptop',
    keys: { p256dh: 'p', auth: 'a' },
  },
  deviceLabel: 'Firefox on Linux',
  timezone: 'Asia/Kolkata',
});
await page.reload();
await page.getByRole('button', { name: 'Remove Firefox on Linux' }).waitFor();
await clickCentered(page.getByRole('button', { name: 'Remove Firefox on Linux' }));
await page.getByRole('alertdialog').waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: out('146-reminders-remove-confirm-phone') });
await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
await page.getByText('Firefox on Linux removed').waitFor();
console.log('devices after remove:', (await api('GET', '/push/subscriptions')).length);

// Time zone footer: saved for another zone than this device's → offer to switch.
const current = await api('GET', '/reminders');
await api('PUT', '/reminders', { ...current, timezone: 'Europe/Berlin' });
await page.reload();
await page.getByText(/Times are in/).waitFor();
await page.getByText(/Times are in/).scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: out('147-reminders-timezone-footer-phone') });
console.log('footer:', (await page.locator('footer').innerText()).replace(/\n/g, ' '));
await clickCentered(page.getByRole('button', { name: /Use .* this device/ }));
await page.waitForTimeout(600);
console.log('zone after switch:', (await api('GET', '/reminders')).timezone);

// Turn off on this device → back to the enable prompt, server row gone.
await clickCentered(page.getByRole('button', { name: 'Turn off on this device' }));
await page.getByRole('button', { name: 'Enable on this device' }).waitFor();
console.log('devices after turn off:', (await api('GET', '/push/subscriptions')).length);
await phone.close();

// ---------- (b) device-card states ----------
async function stateShot(name, initScript, expectText, extra = {}) {
  const { page: p, context } = await newPhone(initScript, extra);
  await p.goto(`${BASE}/more/reminders`);
  await p.getByText(expectText).waitFor({ timeout: 15_000 });
  await p.waitForTimeout(300);
  await p.getByText(expectText).scrollIntoViewIfNeeded();
  await p.screenshot({ path: out(name) });
  console.log(`${name}: ${expectText}`);
  await context.close();
}

await stateShot(
  '148-reminders-denied-phone',
  fakePush({ permission: 'denied', endpoint: 'https://push.example/denied' }),
  'Notifications are blocked for Plate',
);
await stateShot(
  '149-reminders-ios-not-installed-phone',
  fakePush({ pushApis: false, endpoint: 'https://push.example/ios' }),
  'Add Plate to your Home Screen first',
  { userAgent: IPHONE_UA },
);
await stateShot(
  '150-reminders-unsupported-phone',
  fakePush({ pushApis: false, endpoint: 'https://push.example/none' }),
  "This browser can't receive notifications",
  { userAgent: ANDROID_UA },
);
await stateShot(
  '151-reminders-insecure-phone',
  fakePush({ pushApis: false, insecure: true, endpoint: 'https://push.example/http' }),
  'Reminders need a secure connection',
);
// No init script: the dev build has no service worker, so `ready` never resolves → after 4 s.
await stateShot(
  '152-reminders-no-worker-phone',
  undefined,
  "Plate's background worker is not running",
);

// Permission refused when asked (Block in the prompt).
{
  const { page: p, context } = await newPhone(
    fakePush({ grant: 'denied', endpoint: 'https://push.example/refused' }),
  );
  await p.goto(`${BASE}/more/reminders`);
  await clickCentered(p.getByRole('button', { name: 'Enable on this device' }));
  await p.getByText('Notifications are blocked for Plate').waitFor();
  console.log('refused prompt → denied state shown');
  await context.close();
}

// ---------- (c) loading and error states ----------
{
  const { page: p, context } = await newPhone(fakePush({ endpoint: 'https://push.example/x' }));
  await p.route('**/api/reminders', () => undefined);
  await p.route('**/api/push/subscriptions', (route) =>
    route.request().method() === 'GET' ? undefined : route.continue(),
  );
  await p.goto(`${BASE}/more/reminders`);
  await p.getByRole('heading', { name: 'Reminders', level: 1 }).waitFor();
  await p.waitForTimeout(800);
  await p.screenshot({ path: out('153-reminders-loading-phone'), fullPage: true });
  await context.close();
}
{
  const { page: p, context } = await newPhone(fakePush({ endpoint: 'https://push.example/x' }));
  await p.route('**/api/reminders', (route) => route.abort());
  await p.route('**/api/push/subscriptions', (route) =>
    route.request().method() === 'GET' ? route.abort() : route.continue(),
  );
  await p.goto(`${BASE}/more/reminders`);
  await p.getByRole('alert').first().waitFor();
  await p.waitForTimeout(500);
  const retries = await p.getByRole('button', { name: 'Try again' }).count();
  console.log('error state retry buttons:', retries, retries === 2 ? '' : 'MISSING RETRY');
  await p.screenshot({ path: out('154-reminders-error-phone'), fullPage: true });
  await p.unroute('**/api/reminders');
  await p.unroute('**/api/push/subscriptions');
  await p.getByRole('button', { name: 'Try again' }).first().click();
  await p.getByRole('switch', { name: 'Reminders' }).waitFor();
  console.log('recovered after retry');
  await context.close();
}

// ---------- (d) desktop light ----------
// A dozen page loads in a minute get close to the API's 300 req/min cap; let it reset first.
console.log('waiting out the API rate limit (60 s)…');
await new Promise((resolve) => setTimeout(resolve, 61_000));
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  });
  await context.addInitScript(fakePush({ endpoint: 'https://push.example/phase10-shots-desktop' }));
  const d = await context.newPage();
  wire(d);
  await login(d);
  await d.goto(`${BASE}/more/reminders`);
  await d.getByRole('button', { name: 'Enable on this device' }).click();
  await d.getByText('Reminders are on for this device').waitFor();
  await d.waitForTimeout(600);
  await d.screenshot({ path: out('155-reminders-desktop') });
  await d.goto(`${BASE}/more`);
  await d.getByRole('link', { name: /Reminders/ }).waitFor();
  await d.waitForTimeout(500);
  await d.screenshot({ path: out('156-more-reminders-row-desktop') });
  console.log(
    'More row (desktop):',
    (await d.getByRole('link', { name: /Reminders/ }).innerText()).replace(/\n/g, ' · '),
  );
  await context.close();
}

await cleanup();
console.log('cleaned up; devices left:', (await api('GET', '/push/subscriptions')).length);
await admin.close();
await browser.close();
console.log(`done → ${DIR}`);
