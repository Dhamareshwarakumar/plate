/// <reference lib="webworker" />
// Plate's service worker (built by vite-plugin-pwa in injectManifest mode, see vite.config.ts).
// Caching behaviour is unchanged from the generated worker it replaces: the shell is precached and
// every /api request goes to the network, so nothing data-related is ever served stale. On top of
// that it shows Web Push reminders (FR-N3) and opens the app when one is tapped.
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope;

/** What the API sends (`pushPayloadSchema` in shared); generic wording only, no nutrition data. */
interface ReminderPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

const DEFAULT_URL = '/today';
const ICON = '/pwa-192.png';
const BADGE = '/badge-96.png';

// The Update toast (src/pwa/register.ts) tells the waiting worker to take over.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data: unknown = event.data;
  if (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'SKIP_WAITING'
  ) {
    void self.skipWaiting();
  }
});

// First install takes control of the open page at once (offline-capable from the first visit);
// later builds still wait for the Update toast because skipWaiting is never called on install.
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }),
);

self.addEventListener('push', (event: PushEvent) => {
  const payload = readPayload(event.data);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // One notification per reminder: today's dinner nudge replaces yesterday's, and the
      // replacement still alerts (renotify needs a tag).
      tag: payload.tag,
      renotify: true,
      icon: ICON,
      badge: BADGE,
      data: { url: payload.url },
    } as NotificationOptions),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const data: unknown = event.notification.data;
  const path =
    typeof data === 'object' && data !== null && typeof (data as { url?: unknown }).url === 'string'
      ? (data as { url: string }).url
      : DEFAULT_URL;
  event.waitUntil(focusOrOpen(new URL(path, self.location.origin).href));
});

/** Reuses an open Plate window when there is one (moving it to the target page), else opens one. */
async function focusOrOpen(url: string): Promise<void> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = windows[0];
  if (client) {
    await client.focus();
    if (new URL(client.url).pathname !== new URL(url).pathname) {
      await client.navigate(url).catch(() => undefined);
    }
    return;
  }
  await self.clients.openWindow(url);
}

/** Tolerates a non-JSON push (DevTools' "Push" button sends plain text). */
function readPayload(data: PushMessageData | null): ReminderPayload {
  const fallback: ReminderPayload = { title: 'Plate', body: '', tag: 'plate', url: DEFAULT_URL };
  if (!data) return fallback;
  try {
    const json: unknown = data.json();
    if (typeof json !== 'object' || json === null) return { ...fallback, body: data.text() };
    const record = json as Record<string, unknown>;
    const text = (key: keyof ReminderPayload) => {
      const value = record[key];
      return typeof value === 'string' ? value : fallback[key];
    };
    return { title: text('title'), body: text('body'), tag: text('tag'), url: text('url') };
  } catch {
    return { ...fallback, body: data.text() };
  }
}
