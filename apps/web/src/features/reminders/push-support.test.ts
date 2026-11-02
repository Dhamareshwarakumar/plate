import { describe, expect, it } from 'vitest';
import {
  detectPushSupport,
  deviceLabel,
  isIos,
  isStandalone,
  urlBase64ToUint8Array,
} from './push-support';

const UA = {
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
};

describe('deviceLabel', () => {
  it('names browser and platform', () => {
    expect(deviceLabel(UA.androidChrome)).toBe('Chrome on Android');
    expect(deviceLabel(UA.iphoneSafari)).toBe('Safari on iPhone');
    expect(deviceLabel(UA.iphoneChrome)).toBe('Chrome on iPhone');
    expect(deviceLabel(UA.macChrome)).toBe('Chrome on Mac');
    expect(deviceLabel(UA.windowsEdge)).toBe('Edge on Windows');
    expect(deviceLabel(UA.linuxFirefox)).toBe('Firefox on Linux');
    expect(deviceLabel(UA.samsung)).toBe('Samsung Internet on Android');
  });

  it('tells an iPad asking for desktop sites from a Mac by its touch screen', () => {
    expect(deviceLabel(UA.ipadDesktop, 5)).toBe('Safari on iPad');
    expect(deviceLabel(UA.ipadDesktop, 0)).toBe('Safari on Mac');
  });

  it('falls back to generic words for an unknown agent', () => {
    expect(deviceLabel('SomethingElse/1.0')).toBe('Browser on this device');
  });
});

describe('isIos / isStandalone', () => {
  it('recognises iPhone, iPad (both user agents) and nothing else', () => {
    expect(isIos(UA.iphoneSafari)).toBe(true);
    expect(isIos(UA.ipadDesktop, 5)).toBe(true);
    expect(isIos(UA.ipadDesktop, 0)).toBe(false);
    expect(isIos(UA.androidChrome)).toBe(false);
  });

  it('reads standalone from the display-mode media query or Safari’s navigator.standalone', () => {
    const win = (matches: boolean, standalone?: boolean) =>
      ({
        matchMedia: () => ({ matches }),
        navigator: { standalone },
      }) as unknown as Window;
    expect(isStandalone(win(true))).toBe(true);
    expect(isStandalone(win(false, true))).toBe(true);
    expect(isStandalone(win(false))).toBe(false);
  });
});

describe('detectPushSupport', () => {
  const win = (overrides: {
    apis?: boolean;
    secure?: boolean;
    ua?: string;
    touch?: number;
    standalone?: boolean;
  }) => {
    const {
      apis = true,
      secure = true,
      ua = UA.androidChrome,
      touch = 0,
      standalone = false,
    } = overrides;
    const w: Record<string, unknown> = {
      isSecureContext: secure,
      navigator: {
        userAgent: ua,
        maxTouchPoints: touch,
        ...(apis ? { serviceWorker: {} } : {}),
      },
      matchMedia: () => ({ matches: standalone }),
    };
    if (apis) {
      w['PushManager'] = class {};
      w['Notification'] = class {};
    }
    return w as unknown as Window;
  };

  it('is supported when the three APIs exist', () => {
    expect(detectPushSupport(win({}))).toEqual({ kind: 'supported' });
  });

  it('blames the missing secure context first', () => {
    expect(detectPushSupport(win({ apis: false, secure: false }))).toEqual({ kind: 'insecure' });
  });

  it('tells iPhone users to install the app when Safari hides the APIs in a tab', () => {
    expect(detectPushSupport(win({ apis: false, ua: UA.iphoneSafari }))).toEqual({
      kind: 'ios-not-installed',
    });
    // Installed but still no API (iOS < 16.4): plainly unsupported.
    expect(detectPushSupport(win({ apis: false, ua: UA.iphoneSafari, standalone: true }))).toEqual({
      kind: 'unsupported',
    });
  });

  it('is unsupported elsewhere', () => {
    expect(detectPushSupport(win({ apis: false }))).toEqual({ kind: 'unsupported' });
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes URL-safe base64 without padding into bytes', () => {
    // "BAEC_-8" → 0x04 0x01 0x02 0xff 0xef
    expect(Array.from(urlBase64ToUint8Array('BAEC_-8'))).toEqual([4, 1, 2, 255, 239]);
    expect(urlBase64ToUint8Array('').length).toBe(0);
  });

  it('decodes a real VAPID public key to the 65 uncompressed point bytes starting with 0x04', () => {
    const key =
      'BNbxGYNMhEIi9zrneh7mqV4oUanjLUK3m-mYZBc62frMKrEoMk88r3Lk596T0ck9xlT5-lN5PT5bcUWR-fEOkoM';
    const bytes = urlBase64ToUint8Array(key);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });
});
