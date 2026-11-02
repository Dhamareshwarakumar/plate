// Phase 10b UI verification: node tools/shots/phase10-scan.mjs
// Camera barcode scanning: the log sheet's scan button and the "Search online" sheet's scan button,
// every scanner state (requesting, scanning + torch, found, denied, no camera, busy, unsupported),
// the scanned step (product → "Add to library and log", library match → quantity, unknown code →
// "Create food manually" with the barcode kept, lookup disabled), the editor's barcode hint and the
// "Keep barcode on this food" path; phone dark + desktop light. PNGs 120–139.
//
// The camera is mocked: an init script replaces navigator.mediaDevices.getUserMedia with a canvas
// `captureStream()` that draws a real EAN-13 barcode (or a blank surface), or rejects with the
// DOMException the browser would raise (denied / no camera / busy). Detection is real: whatever
// engine the browser picks (native BarcodeDetector or zxing-wasm) decodes the drawn bars. Open Food
// Facts answers come from page.route() mocks of /api/off/** so the run is deterministic offline.
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const BASE = 'http://127.0.0.1:5173';
const PASSWORD = process.env.PLATE_PASSWORD ?? 'password';
const DIR = '/tmp/plate-shots';
const out = (name) => `${DIR}/${name}.png`;
mkdirSync(DIR, { recursive: true });

const TWIX_CODE = '5000159484695';
const UNKNOWN_CODE = '96385074'; // valid EAN-8 check digit, not on OFF
const UNKNOWN_EAN13 = '4006381333931'; // valid EAN-13 check digit (the classic test number)

// ---------- camera mock (runs in the page before any app code) ----------
const CAMERA_MOCK = `
(() => {
  const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const R = L.map((s) => s.replace(/[01]/g, (b) => (b === '1' ? '0' : '1')));
  const G = R.map((s) => s.split('').reverse().join(''));
  const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
  function ean13Modules(code) {
    const d = code.split('').map(Number);
    let bits = '101';
    for (let i = 1; i <= 6; i += 1) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
    bits += '01010';
    for (let i = 7; i <= 12; i += 1) bits += R[d[i]];
    return bits + '101';
  }
  function ean8Modules(code) {
    const d = code.split('').map(Number);
    let bits = '101';
    for (let i = 0; i < 4; i += 1) bits += L[d[i]];
    bits += '01010';
    for (let i = 4; i < 8; i += 1) bits += R[d[i]];
    return bits + '101';
  }
  const W = 1280, H = 720;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  let frame = 0;
  function draw() {
    const mock = window.__scanMock ?? { mode: 'blank' };
    frame += 1;
    // A warm "table" surface so the preview looks like a camera, not a white page.
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#6b5a4a'); grad.addColorStop(1, '#3c3128');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    if (mock.code) {
      const bits = mock.code.length === 8 ? ean8Modules(mock.code) : ean13Modules(mock.code);
      const mw = 7, bh = 240, bw = bits.length * mw;
      const x0 = Math.round((W - bw) / 2), y0 = Math.round((H - bh) / 2);
      // Label with quiet zones.
      ctx.fillStyle = '#f7f3ec';
      ctx.fillRect(x0 - 120, y0 - 70, bw + 240, bh + 150);
      ctx.fillStyle = '#111';
      for (let i = 0; i < bits.length; i += 1) {
        if (bits[i] === '1') ctx.fillRect(x0 + i * mw, y0, mw, bh);
      }
      ctx.font = '600 34px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(mock.code.split('').join(' '), W / 2, y0 + bh + 52);
    }
    // Something that changes every frame so captureStream keeps emitting frames.
    ctx.fillStyle = 'rgba(255,255,255,' + (0.03 + (frame % 10) / 400) + ')';
    ctx.fillRect(20 + (frame % 40), 20, 6, 6);
  }
  setInterval(draw, 100);
  const stream = canvas.captureStream(10);
  const domErr = (name, msg) => { try { return new DOMException(msg, name); } catch { const e = new Error(msg); e.name = name; return e; } };
  const fakeGetUserMedia = async () => {
    const mock = window.__scanMock ?? { mode: 'blank' };
    if (mock.mode === 'hold') return new Promise(() => {});
    if (mock.mode === 'denied') throw domErr('NotAllowedError', 'Permission denied');
    if (mock.mode === 'nocamera') throw domErr('NotFoundError', 'Requested device not found');
    if (mock.mode === 'busy') throw domErr('NotReadableError', 'Could not start video source');
    draw();
    const track = stream.getVideoTracks()[0];
    // Pretend the camera has a torch so the toggle is in the pictures.
    track.getCapabilities = () => ({ torch: true });
    track.applyConstraints = async () => undefined;
    track.stop = () => {}; // keep the shared canvas stream alive between opens
    return stream;
  };
  if (navigator.mediaDevices) {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: fakeGetUserMedia });
  }
  window.__scanMockReady = true;
})();
`;
const NO_MEDIA = `Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });`;

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

// ---------- mocked Open Food Facts answers (the API's mapped shape) ----------
const TWIX = {
  code: TWIX_CODE,
  name: 'Twix glacé',
  brand: 'Twix',
  quantity: '1 gram',
  per100: {
    kcal: 280.74,
    protein: 2.78,
    carbs: 34.8,
    fat: 14.62,
    fiber: null,
    sugar: 25.52,
    saturatedFat: 9.05,
    sodiumMg: 102,
  },
};
const fulfillJson = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function mockOff(page) {
  await page.route('**/api/off/**', (route) => {
    const url = route.request().url();
    if (url.includes(`/api/off/product/${TWIX_CODE}`)) return fulfillJson(route, TWIX);
    if (url.includes('/api/off/product/'))
      return fulfillJson(
        route,
        { error: { code: 'NOT_FOUND', message: 'Product not found' } },
        404,
      );
    return fulfillJson(route, { items: [] });
  });
}

const setMock = (page, mock) => page.evaluate((m) => void (window.__scanMock = m), mock);
const scanner = (page) => page.getByRole('dialog', { name: 'Scan barcode' });
const scannerState = (page) =>
  page.locator('[data-scanner-state]').first().getAttribute('data-scanner-state');
const waitState = (page, kind, timeout = 20000) =>
  page.locator(`[data-scanner-state="${kind}"]`).first().waitFor({ timeout });

async function openLogSheet(page) {
  await page.goto(`${BASE}/today`);
  await page.getByRole('button', { name: 'Log food' }).first().click();
  await page.getByRole('dialog', { name: 'Log food' }).waitFor();
  await page.waitForTimeout(500);
}
const logSheet = (page) => page.getByRole('dialog').first();

// ---------- contexts ----------
const phone = await browser.newContext({ ...devices['iPhone 14'], colorScheme: 'dark' });
await phone.addInitScript(CAMERA_MOCK);
const page = await phone.newPage();
wire(page);
await login(page);
await mockOff(page);
const api = apiFor(page);

// Free the food name the "Add to library and log" flow will create.
for (const f of (await api('GET', '/foods?query=Twix&includeArchived=true')).items) {
  if (f.name === 'Twix glacé') {
    await api('DELETE', `/foods/${f.id}`).catch((e) => console.log('cleanup:', e.message));
  }
}

// (a) log sheet step 1 with the scan button
await openLogSheet(page);
console.log(
  'log sheet scan button:',
  await logSheet(page).getByRole('button', { name: 'Scan barcode' }).isVisible(),
);
await page.screenshot({ path: out('120-log-pick-scan-button') });

// (b) requesting permission (getUserMedia never answers)
await setMock(page, { mode: 'hold' });
await logSheet(page).getByRole('button', { name: 'Scan barcode' }).click();
await scanner(page).waitFor();
await page.waitForTimeout(600);
console.log('state while holding:', await scannerState(page));
await page.screenshot({ path: out('121-scan-requesting') });
await scanner(page).getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(400);

// (c) scanning: viewfinder, laser, torch
await setMock(page, { mode: 'blank' });
await logSheet(page).getByRole('button', { name: 'Scan barcode' }).click();
await waitState(page, 'scanning');
const engine = await page
  .locator('[data-scanner-state]')
  .first()
  .getAttribute('data-scanner-engine');
console.log('engine:', engine);
await page.waitForTimeout(700);
await page.screenshot({ path: out('122-scan-scanning') });
const torch = scanner(page).getByRole('button', { name: 'Turn torch on' });
console.log('torch button:', await torch.isVisible());
await torch.click();
console.log(
  'torch pressed:',
  await scanner(page).getByRole('button', { name: 'Turn torch off' }).getAttribute('aria-pressed'),
);

// (d) found: draw the Twix barcode into the running stream → two agreeing frames → found → step
await setMock(page, { mode: 'ok', code: TWIX_CODE });
await waitState(page, 'found');
await page.screenshot({ path: out('123-scan-found') });
console.log('found text:', await scanner(page).getByText(/Found/).innerText());

// (e) scanned step: product from OFF
await page.getByRole('heading', { name: `Barcode ${TWIX_CODE}` }).waitFor();
await page.getByText('Twix glacé').waitFor();
await page.waitForTimeout(500);
console.log(
  'scanner closed:',
  (await page.getByRole('dialog', { name: 'Scan barcode' }).count()) === 0,
);
await page.screenshot({ path: out('124-scanned-product') });

// (f) add to library and log → quantity step
const [created] = await Promise.all([
  page.waitForResponse((r) => r.url().endsWith('/api/foods') && r.request().method() === 'POST'),
  page.getByRole('button', { name: 'Add to library and log' }).click(),
]);
console.log('POST /api/foods →', created.status());
const saved = await created.json();
console.log('saved:', saved.name, saved.basis, saved.source, saved.offCode);
await page.getByRole('heading', { name: 'Twix glacé' }).waitFor();
await page.getByLabel('Quantity').waitFor();
await page.waitForTimeout(500);
await page.screenshot({ path: out('125-scanned-quantity') });

// (g) scanning the same code now jumps straight to quantity (library match)
await openLogSheet(page);
await setMock(page, { mode: 'ok', code: TWIX_CODE });
await logSheet(page).getByRole('button', { name: 'Scan barcode' }).click();
await page.getByRole('heading', { name: 'Twix glacé' }).waitFor({ timeout: 20000 });
await page.getByLabel('Quantity').waitFor();
await page.waitForTimeout(400);
console.log(
  'library match skipped the lookup:',
  (await page.getByRole('heading', { name: `Barcode ${TWIX_CODE}` }).count()) === 0,
);
await page.screenshot({ path: out('126-scan-library-match') });

// (h) unknown code (EAN-8) → not on OFF → create manually with the code kept
await openLogSheet(page);
await setMock(page, { mode: 'ok', code: UNKNOWN_CODE });
await logSheet(page).getByRole('button', { name: 'Scan barcode' }).click();
await page.getByText('Not on Open Food Facts').waitFor({ timeout: 20000 });
await page.waitForTimeout(400);
await page.screenshot({ path: out('127-scanned-not-found') });
await page.getByRole('button', { name: 'Create food manually' }).click();
await page.waitForURL(/\/foods\/new\?.*offCode=96385074/);
await page.waitForTimeout(800);
console.log('editor url:', page.url().replace(BASE, ''));
console.log(
  'editor hint:',
  await page
    .getByText(/^Barcode/)
    .first()
    .innerText(),
);
await page.screenshot({ path: out('128-editor-barcode-kept') });

// (i) lookup disabled → scanned step explains it (fresh page so About is refetched)
await page.route('**/api/about', (route) =>
  fulfillJson(route, {
    version: '0.0.0',
    dbSizeBytes: 1,
    dbPath: 'plate.db',
    counts: { foods: 1, entries: 0, days: 0 },
    offEnabled: false,
  }),
);
await openLogSheet(page);
await setMock(page, { mode: 'ok', code: UNKNOWN_EAN13 });
await logSheet(page).getByRole('button', { name: 'Scan barcode' }).click();
await page.getByText('Not in your library', { exact: true }).waitFor({ timeout: 20000 });
await page.waitForTimeout(400);
await page.screenshot({ path: out('129-scanned-lookup-off') });
await page.unroute('**/api/about');

// (j) denied / no camera / busy
const failures = [
  ['denied', '130-scan-denied', 'Camera access was denied'],
  ['nocamera', '131-scan-no-camera', 'No camera found'],
  ['busy', '132-scan-busy', 'The camera is not available'],
];
await openLogSheet(page);
for (const [mode, name, title] of failures) {
  await setMock(page, { mode });
  await logSheet(page).getByRole('button', { name: 'Scan barcode' }).click();
  await scanner(page).getByText(title).waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  console.log(
    `${mode}:`,
    (await scanner(page).getByRole('alert').innerText()).replace(/\n/g, ' | '),
  );
  await page.screenshot({ path: out(name) });
  if (mode === 'denied') {
    // Try again re-asks: switch the mock to a working camera first.
    await setMock(page, { mode: 'blank' });
    await scanner(page).getByRole('button', { name: 'Try again' }).click();
    await waitState(page, 'scanning');
    console.log('retry after denied → scanning');
  }
  await scanner(page).getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(400);
}

// (k) unsupported browser (no mediaDevices at all)
const noMedia = await phone.newPage();
wire(noMedia);
await noMedia.addInitScript(NO_MEDIA);
await mockOff(noMedia);
await openLogSheet(noMedia);
await logSheet(noMedia).getByRole('button', { name: 'Scan barcode' }).click();
await scanner(noMedia).getByText('This browser cannot access the camera').waitFor();
await noMedia.waitForTimeout(400);
await noMedia.screenshot({ path: out('133-scan-unsupported') });
await noMedia.close();

// (l) entry point 1: food editor → Search online → Scan barcode → product in the results
await page.goto(`${BASE}/foods/new`);
await page.getByRole('button', { name: 'Search online' }).click();
const lookup = page.getByRole('dialog', { name: 'Search online' });
await lookup.waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: out('134-lookup-scan-button') });
await setMock(page, { mode: 'ok', code: TWIX_CODE });
await lookup.getByRole('button', { name: 'Scan barcode' }).click();
await lookup.getByRole('list', { name: 'Results' }).waitFor({ timeout: 20000 });
await page.waitForTimeout(400);
console.log(
  'lookup after scan:',
  await lookup.getByLabel('Search Open Food Facts').inputValue(),
  '→',
  await lookup.getByRole('listitem').count(),
  'row(s)',
);
await page.screenshot({ path: out('135-lookup-scanned-result') });

// (m) entry point 1, unknown code → keep the barcode on the food
await setMock(page, { mode: 'ok', code: UNKNOWN_EAN13 });
await lookup.getByRole('button', { name: 'Scan barcode' }).click();
await lookup.getByText('Not on Open Food Facts').waitFor({ timeout: 20000 });
await page.waitForTimeout(400);
await page.screenshot({ path: out('136-lookup-scanned-unknown') });
await lookup.getByRole('button', { name: 'Keep barcode on this food' }).click();
await page.waitForTimeout(600);
console.log(
  'kept:',
  await page
    .getByText(/^Barcode/)
    .first()
    .innerText(),
);
await page.screenshot({ path: out('137-editor-barcode-from-lookup') });

// ---------- desktop light ----------
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
});
await desktop.addInitScript(CAMERA_MOCK);
const d = await desktop.newPage();
wire(d);
await login(d);
await mockOff(d);
await openLogSheet(d);
await setMock(d, { mode: 'blank' });
await logSheet(d).getByRole('button', { name: 'Scan barcode' }).click();
await waitState(d, 'scanning');
await d.waitForTimeout(700);
await d.screenshot({ path: out('138-desktop-scan-scanning') });
await setMock(d, { mode: 'ok', code: TWIX_CODE });
await d.getByRole('heading', { name: 'Twix glacé' }).waitFor({ timeout: 20000 });
await d.waitForTimeout(500);
console.log('desktop: library match → quantity step');
await d.screenshot({ path: out('139-desktop-scan-library-match') });

// cleanup: the created food (unused, so deletable)
await api('DELETE', `/foods/${saved.id}`);
console.log('deleted food', saved.id);

await phone.close();
await desktop.close();
await browser.close();
console.log('done');
