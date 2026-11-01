import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthBootstrapError, AuthService } from '../src/auth/service.js';
import { SessionStore } from '../src/auth/sessions.js';
import { openDb } from '../src/db/index.js';
import { createTestApp, login, TEST_PASSWORD, type TestContext } from './helpers.js';

describe('health', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });
  afterEach(() => ctx.close());

  it('is public and reports the database as reachable', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, version: 'dev', dbOk: true });
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('authentication gate', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });
  afterEach(() => ctx.close());

  it('denies anonymous access to protected routes with an identifiable 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/session' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Session realm="plate"');
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a wrong password', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'not-it' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    expect(res.cookies).toHaveLength(0);
  });

  it('rejects a malformed login body with a validation error', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in with the right password and sets a hardened cookie', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ authenticated: true });

    const cookie = res.cookies.find((c) => c.name === 'plate_session');
    expect(cookie).toBeDefined();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    // Plain HTTP in tests: Secure must not be set or the browser would drop the cookie.
    expect(cookie?.secure).toBeFalsy();
  });

  it('marks the cookie Secure when the request came over HTTPS via a trusted proxy', async () => {
    const secureCtx = await createTestApp({ trustProxy: true });
    try {
      const res = await secureCtx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: TEST_PASSWORD },
        headers: { 'x-forwarded-proto': 'https' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.cookies.find((c) => c.name === 'plate_session')?.secure).toBe(true);
    } finally {
      await secureCtx.close();
    }
  });

  it('accepts the session cookie on protected routes', async () => {
    const cookie = await login(ctx.app);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ authenticated: true });
  });

  it('ignores an unknown session token and clears the cookie', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: 'plate_session=forged' },
    });
    expect(res.statusCode).toBe(401);
    const cleared = res.cookies.find((c) => c.name === 'plate_session');
    expect(cleared?.value).toBe('');
  });

  it('logs out and the session stops working', async () => {
    const cookie = await login(ctx.app);
    const out = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(out.statusCode).toBe(200);
    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie },
    });
    expect(after.statusCode).toBe(401);
  });

  it('blocks cross-site mutating requests', async () => {
    const byOrigin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: TEST_PASSWORD },
      headers: { origin: 'https://evil.example' },
    });
    expect(byOrigin.statusCode).toBe(403);

    const byFetchSite = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: TEST_PASSWORD },
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(byFetchSite.statusCode).toBe(403);
  });

  it('allows same-origin mutating requests, ignoring default-port differences', async () => {
    const explicitPort = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: TEST_PASSWORD },
      headers: {
        origin: 'http://192.168.1.10:8080',
        host: '192.168.1.10:8080',
        'sec-fetch-site': 'same-origin',
      },
    });
    expect(explicitPort.statusCode).toBe(200);

    const defaultPort = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: TEST_PASSWORD },
      headers: { origin: 'http://localhost', host: 'localhost:80' },
    });
    expect(defaultPort.statusCode).toBe(200);
  });

  it('rejects an Origin whose scheme differs from the request scheme', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: TEST_PASSWORD },
      headers: { origin: 'https://localhost', host: 'localhost' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('blocks login after five wrong passwords, even with the right one', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: 'wrong' },
      });
      expect(res.statusCode).toBe(401);
    }
    const sixth = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: TEST_PASSWORD },
    });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error.code).toBe('RATE_LIMITED');
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('never counts successful logins, so many devices can sign in back to back', async () => {
    for (let i = 0; i < 8; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: TEST_PASSWORD },
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('a successful login clears earlier failures', async () => {
    for (let i = 0; i < 4; i++) {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: 'wrong' },
      });
    }
    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: TEST_PASSWORD },
    });
    expect(ok.statusCode).toBe(200);
    for (let i = 0; i < 4; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: 'wrong' },
      });
      expect(res.statusCode).toBe(401);
    }
  });
});

describe('change password', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });
  afterEach(() => ctx.close());

  it('requires the correct current password', async () => {
    const cookie = await login(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: { currentPassword: 'wrong-wrong', newPassword: 'brand-new-password' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('enforces the new-password policy', async () => {
    const cookie = await login(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: { currentPassword: TEST_PASSWORD, newPassword: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('changes the password, keeps the caller signed in and signs out other devices', async () => {
    const phone = await login(ctx.app);
    const laptop = await login(ctx.app);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie: phone },
      payload: { currentPassword: TEST_PASSWORD, newPassword: 'brand-new-password' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, signedOutOtherDevices: 1 });

    const phoneStill = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: phone },
    });
    expect(phoneStill.statusCode).toBe(200);
    const laptopOut = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: laptop },
    });
    expect(laptopOut.statusCode).toBe(401);

    const oldPw = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: TEST_PASSWORD },
    });
    expect(oldPw.statusCode).toBe(401);
    const newPw = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'brand-new-password' },
    });
    expect(newPw.statusCode).toBe(200);
  });
});

describe('bootstrap', () => {
  it('refuses to start without a stored hash or a bootstrap password', async () => {
    const opened = openDb({ path: ':memory:' });
    try {
      const service = new AuthService(opened.db, new SessionStore(opened.db, 1000));
      await expect(service.bootstrap(undefined)).rejects.toBeInstanceOf(AuthBootstrapError);
      expect(service.hasPassword()).toBe(false);
    } finally {
      opened.close();
    }
  });

  it('seeds once and then ignores the bootstrap value', async () => {
    const opened = openDb({ path: ':memory:' });
    try {
      const service = new AuthService(opened.db, new SessionStore(opened.db, 1000));
      expect(await service.bootstrap('first-password')).toBe('seeded_from_bootstrap');
      expect(await service.bootstrap('second-password')).toBe('already_configured');
      expect(await service.verify('first-password')).toBe(true);
      expect(await service.verify('second-password')).toBe(false);
    } finally {
      opened.close();
    }
  });

  it('rejects a bootstrap password that violates the policy', async () => {
    const opened = openDb({ path: ':memory:' });
    try {
      const service = new AuthService(opened.db, new SessionStore(opened.db, 1000));
      await expect(service.bootstrap('short')).rejects.toBeInstanceOf(AuthBootstrapError);
    } finally {
      opened.close();
    }
  });

  it('reset-from-bootstrap overwrites the password and revokes all sessions', async () => {
    const opened = openDb({ path: ':memory:' });
    try {
      const store = new SessionStore(opened.db, 1000);
      const service = new AuthService(opened.db, store);
      await service.bootstrap('first-password');
      store.create('a');
      store.create('b');
      const result = await service.resetFromBootstrap('reset-password-1');
      expect(result.revokedSessions).toBe(2);
      expect(await service.verify('reset-password-1')).toBe(true);
    } finally {
      opened.close();
    }
  });
});

describe('sessions', () => {
  it('expire and are removed on access', () => {
    const opened = openDb({ path: ':memory:' });
    try {
      let now = new Date('2025-01-01T00:00:00Z');
      const store = new SessionStore(opened.db, 1000, () => now);
      const { token } = store.create(undefined);
      expect(store.resolve(token)).toBeDefined();
      now = new Date('2025-01-01T00:00:01Z');
      expect(store.resolve(token)).toBeUndefined();
      expect(store.resolve(token)).toBeUndefined();
    } finally {
      opened.close();
    }
  });

  it('slide their expiry when used after the touch interval', () => {
    const opened = openDb({ path: ':memory:' });
    try {
      let now = new Date('2025-01-01T00:00:00Z');
      const ttl = 2 * 60 * 60 * 1000;
      const store = new SessionStore(opened.db, ttl, () => now);
      const { token, session } = store.create(undefined);
      now = new Date(now.getTime() + 61 * 60 * 1000);
      const touched = store.resolve(token);
      expect(touched).toBeDefined();
      expect(new Date(touched!.expiresAt).getTime()).toBeGreaterThan(
        new Date(session.expiresAt).getTime(),
      );
    } finally {
      opened.close();
    }
  });
});
