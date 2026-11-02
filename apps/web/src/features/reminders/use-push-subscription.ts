import type { PushSubscriptionInfo } from '@plate/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { pushKeys } from '@/lib/query-keys';
import { loadVapidPublicKey, useAddPushDevice, useRemovePushDevice } from './api';
import {
  detectPushSupport,
  deviceLabel,
  deviceTimeZone,
  urlBase64ToUint8Array,
  type PushSupport,
} from './push-support';

export type PushDeviceStatus =
  | { kind: 'checking' }
  | { kind: 'unsupported'; reason: Exclude<PushSupport['kind'], 'supported'> | 'no-worker' }
  /** The user blocked notifications for this site; only the browser's site settings can undo that. */
  | { kind: 'denied' }
  /** Push works here. `endpoint` is this browser's subscription when it has one. */
  | { kind: 'ready'; permission: 'default' | 'granted'; endpoint: string | null };

export interface PushSubscriptionControls {
  status: PushDeviceStatus;
  /** A subscribe/unsubscribe is in flight. */
  busy: boolean;
  /** Asks for permission, subscribes with the server's VAPID key and registers the device. */
  enable: () => Promise<boolean>;
  /** Unsubscribes this browser and removes its row on the server. */
  disable: (deviceId?: number) => Promise<void>;
  /** Re-reads permission and subscription state (after the user changed site settings). */
  recheck: () => void;
}

/** How long to wait for the service worker; in dev builds there is none (vite devOptions off). */
const WORKER_TIMEOUT_MS = 4000;

async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), WORKER_TIMEOUT_MS);
  });
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

async function inspect(): Promise<PushDeviceStatus> {
  const support = detectPushSupport();
  if (support.kind !== 'supported') return { kind: 'unsupported', reason: support.kind };
  const registration = await serviceWorkerRegistration();
  if (!registration) return { kind: 'unsupported', reason: 'no-worker' };
  if (Notification.permission === 'denied') return { kind: 'denied' };
  const subscription = await registration.pushManager.getSubscription();
  return {
    kind: 'ready',
    permission: Notification.permission === 'granted' ? 'granted' : 'default',
    endpoint: subscription?.endpoint ?? null,
  };
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  const bytes = new Uint8Array(a);
  return bytes.every((value, i) => value === b[i]);
}

/** Reuses this browser's subscription unless it was made for another server key (a regenerated pair). */
async function subscribeWithKey(
  registration: ServiceWorkerRegistration,
  publicKey: string,
): Promise<PushSubscription> {
  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    if (sameKey(existing.options.applicationServerKey, applicationServerKey)) return existing;
    await existing.unsubscribe();
  }
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
}

/**
 * This browser's side of FR-N2: permission and subscription state, "Enable on this device" and
 * its reverse. Server-side knowledge of the device comes from `usePushDevices()`; the two are
 * matched by endpoint.
 */
export function usePushSubscription(): PushSubscriptionControls {
  const queryClient = useQueryClient();
  const addDevice = useAddPushDevice();
  const removeDevice = useRemovePushDevice();
  const [status, setStatus] = useState<PushDeviceStatus>({ kind: 'checking' });
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void inspect().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, [generation]);

  const recheck = useCallback(() => setGeneration((g) => g + 1), []);

  // Site-settings changes happen in another window; look again when the user comes back.
  useEffect(() => {
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, [recheck]);

  const enable = async (): Promise<boolean> => {
    setBusy(true);
    try {
      const registration = await serviceWorkerRegistration();
      if (!registration) {
        setStatus({ kind: 'unsupported', reason: 'no-worker' });
        return false;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(
          permission === 'denied'
            ? { kind: 'denied' }
            : { kind: 'ready', permission: 'default', endpoint: null },
        );
        return false;
      }
      const publicKey = await loadVapidPublicKey(queryClient);
      const subscription = await subscribeWithKey(registration, publicKey);
      const json = subscription.toJSON();
      try {
        await addDevice.mutateAsync({
          subscription: {
            endpoint: subscription.endpoint,
            expirationTime: subscription.expirationTime,
            keys: { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' },
          },
          deviceLabel: deviceLabel(navigator.userAgent, navigator.maxTouchPoints),
          timezone: deviceTimeZone(),
        });
      } catch (err) {
        // The server does not know this subscription; keep the browser in step with it.
        await subscription.unsubscribe().catch(() => undefined);
        throw err;
      }
      setStatus({ kind: 'ready', permission: 'granted', endpoint: subscription.endpoint });
      return true;
    } finally {
      setBusy(false);
    }
  };

  const disable = async (deviceId?: number): Promise<void> => {
    setBusy(true);
    try {
      const registration = await serviceWorkerRegistration();
      const subscription = (await registration?.pushManager.getSubscription()) ?? null;
      const endpoint = subscription?.endpoint ?? null;
      if (subscription) await subscription.unsubscribe();
      const id =
        deviceId ??
        queryClient
          .getQueryData<PushSubscriptionInfo[]>(pushKeys.devices)
          ?.find((d) => d.endpoint === endpoint)?.id;
      if (id !== undefined) await removeDevice.mutateAsync(id);
      setStatus({
        kind: 'ready',
        permission: Notification.permission === 'granted' ? 'granted' : 'default',
        endpoint: null,
      });
    } finally {
      setBusy(false);
    }
  };

  return { status, busy, enable, disable, recheck };
}
