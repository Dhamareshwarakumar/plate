import type { ApiError, PushSendResult, PushSubscriptionInfo } from '@plate/shared';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type webpush from 'web-push';
import { loadConfig } from '../src/config.js';
import { PushService } from '../src/push/service.js';
import { createTestApp, login, type TestContext } from './helpers.js';

// web-push is CommonJS; the service uses the default import, so the mock provides `default`.
const mocks = vi.hoisted(() => ({
  sendNotification: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock('web-push', async () => {
  const actual = await vi.importActual<typeof webpush>('web-push');
  return {
    default: {
      generateVAPIDKeys: actual.generateVAPIDKeys,
      sendNotification: mocks.sendNotification,
    },
  };
});

/** Rejection shaped like web-push's WebPushError. */
const pushError = (statusCode: number) =>
  Object.assign(new Error(`Received unexpected response code ${statusCode}`), { statusCode });

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-one';
const subscription = (endpoint = ENDPOINT) => ({
  subscription: {
    endpoint,
    expirationTime: null,
    keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
  },
  deviceLabel: 'Chrome on Android',
  timezone: 'Asia/Kolkata',
});

let ctx: TestContext;
let cookie: string;

beforeEach(async () => {
  mocks.sendNotification.mockReset();
  mocks.sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  ctx = await createTestApp();
  cookie = await login(ctx.app);
});
afterEach(() => ctx.close());

const api = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) => {
  const options: InjectOptions = { method, url, headers: { cookie } };
  if (payload !== undefined) options.payload = payload as NonNullable<InjectOptions['payload']>;
  return ctx.app.inject(options);
};

const paths = (res: { json: () => { error: { details?: unknown } } }) =>
  (res.json().error.details as { path: string }[]).map((d) => d.path);

async function enrol(endpoint = ENDPOINT): Promise<PushSubscriptionInfo> {
  const res = await api('POST', '/api/push/subscriptions', subscription(endpoint));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<PushSubscriptionInfo>();
}

describe('config', () => {
  it('defaults the VAPID subject to a mailto: address and rejects anything else', () => {
    expect(loadConfig({}).pushVapidSubject).toBe('mailto:plate@localhost');
    expect(loadConfig({ PUSH_VAPID_SUBJECT: 'https://plate.example.com' }).pushVapidSubject).toBe(
      'https://plate.example.com',
    );
    expect(() => loadConfig({ PUSH_VAPID_SUBJECT: 'admin@example.com' })).toThrow(
      /PUSH_VAPID_SUBJECT: must be a mailto: address or an https: URL/,
    );
  });
});

describe('auth gate on push routes', () => {
  it('denies anonymous access on every route', async () => {
    const routes: [NonNullable<InjectOptions['method']>, string, unknown?][] = [
      ['GET', '/api/push/vapid-public-key'],
      ['GET', '/api/push/subscriptions'],
      ['POST', '/api/push/subscriptions', subscription()],
      ['DELETE', '/api/push/subscriptions/1'],
      ['POST', '/api/push/test', {}],
    ];
    for (const [method, url, payload] of routes) {
      const options: InjectOptions = { method, url };
      if (payload !== undefined) options.payload = payload as NonNullable<InjectOptions['payload']>;
      const res = await ctx.app.inject(options);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Session/);
    }
  });
});

describe('VAPID keys', () => {
  it('serves a URL-safe base64 public key that is generated once and reused', async () => {
    const res = await api('GET', '/api/push/vapid-public-key');
    expect(res.statusCode).toBe(200);
    const { publicKey } = res.json<{ publicKey: string }>();
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);

    // A second service on the same database reads the stored pair instead of minting another.
    const again = new PushService(ctx.opened.db, { vapidSubject: 'mailto:test@plate.test' });
    expect(again.publicKey()).toBe(publicKey);
    expect(
      ctx.opened.sqlite
        .prepare("SELECT count(*) AS n FROM settings WHERE key = 'push.vapid'")
        .get(),
    ).toEqual({ n: 1 });
  });
});

describe('POST /api/push/subscriptions', () => {
  it('rejects a non-https endpoint, missing keys, a bad time zone and a blank label with paths', async () => {
    const cases: [unknown, string][] = [
      [
        {
          ...subscription(),
          subscription: { ...subscription().subscription, endpoint: 'http://x/y' },
        },
        'subscription.endpoint',
      ],
      [
        {
          ...subscription(),
          subscription: { endpoint: ENDPOINT, keys: { auth: 'a' } },
        },
        'subscription.keys.p256dh',
      ],
      [{ ...subscription(), timezone: 'Mars/Olympus_Mons' }, 'timezone'],
      [{ ...subscription(), deviceLabel: '   ' }, 'deviceLabel'],
    ];
    for (const [body, path] of cases) {
      const res = await api('POST', '/api/push/subscriptions', body);
      expect(res.statusCode, path).toBe(400);
      expect(res.json<ApiError>().error.code).toBe('VALIDATION_ERROR');
      expect(paths(res), path).toEqual([path]);
    }
  });

  it('creates the device and lists it without its keys', async () => {
    const created = await enrol();
    expect(created).toMatchObject({
      endpoint: ENDPOINT,
      deviceLabel: 'Chrome on Android',
      timezone: 'Asia/Kolkata',
      lastUsedAt: null,
      failures: 0,
    });
    expect(created).not.toHaveProperty('p256dh');
    expect(created).not.toHaveProperty('auth');
    expect(Date.parse(created.createdAt)).not.toBeNaN();

    const list = await api('GET', '/api/push/subscriptions');
    expect(list.statusCode).toBe(200);
    expect(list.json<PushSubscriptionInfo[]>()).toEqual([created]);
  });

  it('re-enabling the same endpoint updates the row instead of adding a second device', async () => {
    const first = await enrol();
    const res = await api('POST', '/api/push/subscriptions', {
      ...subscription(),
      deviceLabel: 'Edge on Windows',
      timezone: 'Europe/Berlin',
    });
    expect(res.statusCode).toBe(201);
    const second = res.json<PushSubscriptionInfo>();
    expect(second.id).toBe(first.id);
    expect(second.deviceLabel).toBe('Edge on Windows');
    expect(second.timezone).toBe('Europe/Berlin');
    expect(
      (await api('GET', '/api/push/subscriptions')).json<PushSubscriptionInfo[]>(),
    ).toHaveLength(1);
  });
});

describe('DELETE /api/push/subscriptions/:id', () => {
  it('removes the device and answers 404 afterwards', async () => {
    const device = await enrol();
    const res = await api('DELETE', `/api/push/subscriptions/${device.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect((await api('GET', '/api/push/subscriptions')).json()).toEqual([]);

    const gone = await api('DELETE', `/api/push/subscriptions/${device.id}`);
    expect(gone.statusCode).toBe(404);
    expect(gone.json<ApiError>().error.code).toBe('NOT_FOUND');
  });

  it('rejects a non-numeric id with path id', async () => {
    const res = await api('DELETE', '/api/push/subscriptions/abc');
    expect(res.statusCode).toBe(400);
    expect(paths(res)).toEqual(['id']);
  });
});

describe('POST /api/push/test', () => {
  it('answers 404 when no device is enrolled, or when the named endpoint is unknown', async () => {
    let res = await api('POST', '/api/push/test', {});
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiError>().error.message).toBe('No device is enabled for reminders');
    await enrol();
    res = await api('POST', '/api/push/test', { endpoint: 'https://push.example/unknown' });
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiError>().error.message).toBe('Device not found');
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('rejects a non-string endpoint with path endpoint', async () => {
    const res = await api('POST', '/api/push/test', { endpoint: 123 });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiError>().error.code).toBe('VALIDATION_ERROR');
    expect(paths(res)).toEqual(['endpoint']);
  });

  it('sends an encrypted generic payload with VAPID, high urgency and a short TTL, then marks the device used', async () => {
    const device = await enrol();
    const res = await api('POST', '/api/push/test');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<PushSendResult>()).toEqual({ sent: 1, failed: 0, removed: 0 });

    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    const [target, payload, options] = mocks.sendNotification.mock.calls[0] as [
      { endpoint: string; keys: { p256dh: string; auth: string } },
      string,
      Record<string, unknown>,
    ];
    expect(target).toEqual({
      endpoint: ENDPOINT,
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    });
    expect(JSON.parse(payload)).toEqual({
      title: 'Test notification',
      body: 'Reminders are working on this device.',
      tag: 'test',
      url: '/more/reminders',
    });
    expect(options).toMatchObject({
      TTL: 60,
      urgency: 'high',
      topic: 'test',
      vapidDetails: { subject: 'mailto:test@plate.test', publicKey: expect.any(String) as string },
    });

    const [after] = (await api('GET', '/api/push/subscriptions')).json<PushSubscriptionInfo[]>();
    expect(after!.id).toBe(device.id);
    expect(after!.lastUsedAt).not.toBeNull();
  });

  it('targets one device when given its endpoint', async () => {
    await enrol();
    await enrol('https://updates.push.services.mozilla.com/wpush/v2/device-two');
    const res = await api('POST', '/api/push/test', { endpoint: ENDPOINT });
    expect(res.statusCode).toBe(200);
    expect(res.json<PushSendResult>()).toEqual({ sent: 1, failed: 0, removed: 0 });
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('forgets a device the push service reports gone (410) and counts other failures', async () => {
    const gone = await enrol('https://push.example/gone');
    const flaky = await enrol('https://push.example/flaky');
    const fine = await enrol('https://push.example/fine');
    mocks.sendNotification.mockImplementation((target: unknown) => {
      const { endpoint } = target as { endpoint: string };
      if (endpoint.endsWith('/gone')) return Promise.reject(pushError(410));
      if (endpoint.endsWith('/flaky')) return Promise.reject(pushError(500));
      return Promise.resolve({ statusCode: 201, body: '', headers: {} });
    });

    const res = await api('POST', '/api/push/test');
    expect(res.statusCode).toBe(200);
    expect(res.json<PushSendResult>()).toEqual({ sent: 1, failed: 1, removed: 1 });

    const list = (await api('GET', '/api/push/subscriptions')).json<PushSubscriptionInfo[]>();
    expect(list.map((d) => d.id)).toEqual([flaky.id, fine.id]);
    expect(list.find((d) => d.id === gone.id)).toBeUndefined();
    expect(list.find((d) => d.id === flaky.id)).toMatchObject({ failures: 1, lastUsedAt: null });
    expect(list.find((d) => d.id === fine.id)?.failures).toBe(0);

    // 404 is treated like 410; a success resets the failure count.
    mocks.sendNotification.mockImplementation((target: unknown) => {
      const { endpoint } = target as { endpoint: string };
      if (endpoint.endsWith('/fine')) return Promise.reject(pushError(404));
      return Promise.resolve({ statusCode: 201, body: '', headers: {} });
    });
    expect((await api('POST', '/api/push/test')).json<PushSendResult>()).toEqual({
      sent: 1,
      failed: 0,
      removed: 1,
    });
    const after = (await api('GET', '/api/push/subscriptions')).json<PushSubscriptionInfo[]>();
    expect(after.map((d) => d.id)).toEqual([flaky.id]);
    expect(after[0]!.failures).toBe(0);
  });

  it('counts a network failure (no status code) as a failed delivery', async () => {
    await enrol();
    mocks.sendNotification.mockRejectedValue(new Error('socket hang up'));
    const res = await api('POST', '/api/push/test');
    expect(res.statusCode).toBe(200);
    expect(res.json<PushSendResult>()).toEqual({ sent: 0, failed: 1, removed: 0 });
    expect(
      (await api('GET', '/api/push/subscriptions')).json<PushSubscriptionInfo[]>()[0]!.failures,
    ).toBe(1);
  });
});
