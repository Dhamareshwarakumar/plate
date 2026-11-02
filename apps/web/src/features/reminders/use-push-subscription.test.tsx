import type { PushSubscriptionInfo } from '@plate/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pushKeys } from '@/lib/query-keys';
import { usePushSubscription } from './use-push-subscription';

const VAPID_PUBLIC_KEY =
  'BNbxGYNMhEIi9zrneh7mqV4oUanjLUK3m-mYZBc62frMKrEoMk88r3Lk596T0ck9xlT5-lN5PT5bcUWR-fEOkoM';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/this-browser';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

const device: PushSubscriptionInfo = {
  id: 7,
  endpoint: ENDPOINT,
  deviceLabel: 'Chrome on Android',
  timezone: 'Asia/Kolkata',
  createdAt: '2025-11-02T10:00:00.000Z',
  lastUsedAt: null,
  failures: 0,
};

function fakeSubscription(endpoint = ENDPOINT, applicationServerKey: ArrayBuffer | null = null) {
  return {
    endpoint,
    expirationTime: null,
    options: { applicationServerKey },
    toJSON: () => ({
      endpoint,
      expirationTime: null,
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    }),
    unsubscribe: vi.fn(async () => true),
  };
}

interface BrowserOptions {
  permission?: NotificationPermission;
  requestResult?: NotificationPermission;
  existing?: ReturnType<typeof fakeSubscription> | null;
  pushApis?: boolean;
  userAgent?: string;
}

/** A browser as jsdom does not provide it: service worker, push manager and Notification. */
function stubBrowser(options: BrowserOptions = {}) {
  const {
    permission = 'default',
    requestResult = 'granted',
    existing = null,
    pushApis = true,
    userAgent = ANDROID_UA,
  } = options;
  const subscribe = vi.fn(async (_init: PushSubscriptionOptionsInit) => fakeSubscription());
  const getSubscription = vi.fn(async () => existing);
  const registration = { pushManager: { subscribe, getSubscription } };
  const requestPermission = vi.fn(async () => requestResult);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', {
    userAgent,
    maxTouchPoints: 0,
    ...(pushApis ? { serviceWorker: { ready: Promise.resolve(registration) } } : {}),
  });
  if (pushApis) {
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', { permission, requestPermission });
  }
  return { subscribe, getSubscription, requestPermission };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function stubApi(subscribeStatus = 201) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/push/vapid-public-key') return json({ publicKey: VAPID_PUBLIC_KEY });
    if (url === '/api/push/subscriptions' && init?.method === 'POST') {
      return subscribeStatus === 201
        ? json(device, 201)
        : json({ error: { code: 'VALIDATION_ERROR', message: 'Bad subscription' } }, 400);
    }
    if (url.startsWith('/api/push/subscriptions/') && init?.method === 'DELETE') {
      return json({ ok: true });
    }
    throw new Error(`unexpected request ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => usePushSubscription(), { wrapper }) };
}

const sentBody = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;

afterEach(() => vi.unstubAllGlobals());

describe('usePushSubscription', () => {
  it('starts as checking, then reports a ready browser without a subscription', async () => {
    stubBrowser();
    stubApi();
    const { result } = setup();
    expect(result.current.status).toEqual({ kind: 'checking' });
    await waitFor(() =>
      expect(result.current.status).toEqual({
        kind: 'ready',
        permission: 'default',
        endpoint: null,
      }),
    );
  });

  it('enable(): asks permission, subscribes with the server key and registers the device', async () => {
    const browser = stubBrowser();
    const fetchMock = stubApi();
    const { result, client } = setup();
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));

    let enabled = false;
    await act(async () => {
      enabled = await result.current.enable();
    });
    expect(enabled).toBe(true);
    expect(browser.requestPermission).toHaveBeenCalledTimes(1);

    expect(browser.subscribe).toHaveBeenCalledTimes(1);
    const init = browser.subscribe.mock.calls[0]![0];
    expect(init.userVisibleOnly).toBe(true);
    const key = init.applicationServerKey as Uint8Array;
    expect(key.byteLength).toBe(65);
    expect(key[0]).toBe(4);

    const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST');
    expect(post?.[0]).toBe('/api/push/subscriptions');
    expect(sentBody(post?.[1])).toEqual({
      subscription: {
        endpoint: ENDPOINT,
        expirationTime: null,
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      },
      deviceLabel: 'Chrome on Android',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(result.current.status).toEqual({
      kind: 'ready',
      permission: 'granted',
      endpoint: ENDPOINT,
    });
    expect(client.getQueryData<PushSubscriptionInfo[]>(pushKeys.devices)).toEqual([device]);
  });

  it('enable(): a refused permission ends in the denied state without subscribing', async () => {
    const browser = stubBrowser({ requestResult: 'denied' });
    const fetchMock = stubApi();
    const { result } = setup();
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));

    await act(async () => {
      expect(await result.current.enable()).toBe(false);
    });
    expect(result.current.status).toEqual({ kind: 'denied' });
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
  });

  it('enable(): unsubscribes again when the server rejects the subscription', async () => {
    const browser = stubBrowser();
    stubApi(400);
    const { result } = setup();
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));

    await act(async () => {
      await expect(result.current.enable()).rejects.toThrow('Bad subscription');
    });
    const created = await browser.subscribe.mock.results[0]!.value;
    expect(created.unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current.status).toEqual({ kind: 'ready', permission: 'default', endpoint: null });
    expect(result.current.busy).toBe(false);
  });

  it('enable(): replaces a subscription made for another server key', async () => {
    const stale = fakeSubscription('https://push.example/stale', new Uint8Array([1, 2, 3]).buffer);
    const browser = stubBrowser({ permission: 'granted', existing: stale });
    stubApi();
    const { result } = setup();
    await waitFor(() =>
      expect(result.current.status).toEqual({
        kind: 'ready',
        permission: 'granted',
        endpoint: 'https://push.example/stale',
      }),
    );
    await act(async () => {
      await result.current.enable();
    });
    expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
    expect(browser.subscribe).toHaveBeenCalledTimes(1);
    expect(result.current.status).toMatchObject({ endpoint: ENDPOINT });
  });

  it('reports a blocked permission and a browser without push', async () => {
    stubBrowser({ permission: 'denied' });
    stubApi();
    const blocked = setup();
    await waitFor(() => expect(blocked.result.current.status).toEqual({ kind: 'denied' }));
    blocked.unmount();

    vi.unstubAllGlobals();
    stubBrowser({ pushApis: false });
    stubApi();
    const none = setup();
    await waitFor(() =>
      expect(none.result.current.status).toEqual({ kind: 'unsupported', reason: 'unsupported' }),
    );
    none.unmount();

    vi.unstubAllGlobals();
    stubBrowser({
      pushApis: false,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const iphone = setup();
    await waitFor(() =>
      expect(iphone.result.current.status).toEqual({
        kind: 'unsupported',
        reason: 'ios-not-installed',
      }),
    );
  });

  it('disable(): unsubscribes the browser and deletes the device on the server', async () => {
    const existing = fakeSubscription();
    stubBrowser({ permission: 'granted', existing });
    const fetchMock = stubApi();
    const { result, client } = setup();
    client.setQueryData(pushKeys.devices, [device]);
    await waitFor(() => expect(result.current.status).toMatchObject({ endpoint: ENDPOINT }));

    await act(async () => {
      await result.current.disable();
    });
    expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
    const del = fetchMock.mock.calls.find(([, i]) => i?.method === 'DELETE');
    expect(del?.[0]).toBe('/api/push/subscriptions/7');
    expect(result.current.status).toEqual({ kind: 'ready', permission: 'granted', endpoint: null });
  });
});
