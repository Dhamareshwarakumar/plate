/**
 * Browser-side facts the reminders page needs: can this browser receive Web Push at all, how to
 * describe the device to the server, and the key format `pushManager.subscribe` wants.
 */

export type PushSupport =
  | { kind: 'supported' }
  /** Web Push needs a secure context; plain http on the LAN gets nothing. */
  | { kind: 'insecure' }
  /** iOS/iPadOS Safari delivers push only to apps installed on the Home Screen (16.4+). */
  | { kind: 'ios-not-installed' }
  | { kind: 'unsupported' };

export function isIos(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  // iPadOS asks for desktop sites with a Mac user agent; the touch screen gives it away.
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** Installed to the Home Screen / desktop (standalone display), as opposed to a browser tab. */
export function isStandalone(win: Window = window): boolean {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return win.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

export function detectPushSupport(win: Window = window): PushSupport {
  const nav = win.navigator;
  const hasApis = 'serviceWorker' in nav && 'PushManager' in win && 'Notification' in win;
  if (hasApis) return { kind: 'supported' };
  if (!win.isSecureContext) return { kind: 'insecure' };
  if (isIos(nav.userAgent, nav.maxTouchPoints) && !isStandalone(win)) {
    return { kind: 'ios-not-installed' };
  }
  return { kind: 'unsupported' };
}

/** "Chrome on Android", "Safari on iPhone", "Firefox on Windows"… for the device list. */
export function deviceLabel(userAgent: string, maxTouchPoints = 0): string {
  return `${browserName(userAgent)} on ${osName(userAgent, maxTouchPoints)}`;
}

function browserName(ua: string): string {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

function osName(ua: string, maxTouchPoints: number): string {
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'iPad';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'Mac';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'this device';
}

/** The device's IANA zone ("Asia/Kolkata"); engines always report one. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** VAPID public keys travel URL-safe base64; `subscribe()` wants the raw 65 bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
