import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, TEST_PASSWORD, type TestContext } from './helpers.js';

// A stand-in for apps/web/dist: the shell, the theme script Vite copies from public/, and one
// content-hashed asset.
const INDEX_HTML =
  '<!doctype html><html><head><script src="/theme-init.js"></script>' +
  '<script type="module" src="/assets/app-abc123.js"></script></head><body><div id="root"></div></body></html>';

describe('static web app serving', () => {
  let distDir: string;
  let ctx: TestContext;

  beforeAll(() => {
    distDir = mkdtempSync(join(tmpdir(), 'plate-dist-'));
    mkdirSync(join(distDir, 'assets'));
    writeFileSync(join(distDir, 'index.html'), INDEX_HTML);
    writeFileSync(join(distDir, 'theme-init.js'), '// theme\n');
    writeFileSync(join(distDir, 'assets', 'app-abc123.js'), 'console.log("app")\n');
  });
  afterAll(() => {
    rmSync(distDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    ctx = await createTestApp({ webDistDir: distDir });
  });
  afterEach(() => ctx.close());

  it('serves the shell at / with a strict CSP and no caching', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe(INDEX_HTML);

    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    // Inline scripts and eval stay forbidden; that is why the theme bootstrap is an external file.
    // The only extra script source is WebAssembly compilation for the barcode scanner (D163).
    const scriptSrc = (/script-src ([^;]*)/.exec(csp)?.[1] ?? '').trim().split(/\s+/);
    expect(scriptSrc).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('serves content-hashed assets as immutable for a year', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['content-type']).toContain('javascript');
  });

  it('serves files outside /assets without caching so they can change between deploys', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/theme-init.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe('// theme\n');
  });

  it('falls back to the shell for client-side routes', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/today/2025-01-01' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe(INDEX_HTML);
  });

  it('keeps JSON 404s for unknown API routes and non-GET requests', async () => {
    const api = await ctx.app.inject({ method: 'GET', url: '/api/nope' });
    expect(api.statusCode).toBe(404);
    expect(api.headers['content-type']).toContain('application/json');
    expect(api.json().error.code).toBe('NOT_FOUND');

    const post = await ctx.app.inject({ method: 'POST', url: '/nope', payload: {} });
    expect(post.statusCode).toBe(404);
    expect(post.json().error.code).toBe('NOT_FOUND');
  });
});

describe('API-only mode', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });
  afterEach(() => ctx.close());

  it('answers 404 JSON for the shell when no web build is configured', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/today/2025-01-01' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('rate limit scope', () => {
  let distDir: string;
  let ctx: TestContext;

  beforeAll(() => {
    distDir = mkdtempSync(join(tmpdir(), 'plate-dist-'));
    writeFileSync(join(distDir, 'index.html'), INDEX_HTML);
  });
  afterAll(() => {
    rmSync(distDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    ctx = await createTestApp({ webDistDir: distDir }, { rateLimitMax: 2 });
  });
  afterEach(() => ctx.close());

  it('limits API routes but not the static shell (service-worker precache bursts)', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await ctx.app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
    }
    // /api/health is exempt by design (container healthcheck); login is an ordinary API route.
    const signIn = () =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: TEST_PASSWORD },
      });
    expect((await signIn()).statusCode).toBe(200);
    expect((await signIn()).statusCode).toBe(200);
    const limited = await signIn();
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect((await ctx.app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
  });
});
