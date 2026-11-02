import type { RegisterSWOptions } from 'virtual:pwa-register';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateSW: vi.fn(async (_reload?: boolean) => undefined),
  registerSW: vi.fn((_options?: RegisterSWOptions) => mocks.updateSW),
  toast: vi.fn(),
}));

vi.mock('virtual:pwa-register', () => ({ registerSW: mocks.registerSW }));
vi.mock('sonner', () => ({ toast: mocks.toast }));

import { registerPwa, UPDATE_TOAST_ID } from './register';

interface ToastOptions {
  id: string;
  duration: number;
  action: { label: string; onClick: () => void };
}

function registeredOptions(): RegisterSWOptions {
  const options = mocks.registerSW.mock.calls[0]?.[0];
  if (!options) throw new Error('registerSW was not called');
  return options;
}

/** jsdom has no service worker container; a bare EventTarget stands in for it. */
function stubServiceWorkerContainer(): EventTarget {
  const container = new EventTarget();
  vi.stubGlobal('navigator', { ...navigator, serviceWorker: container });
  return container;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('registerPwa', () => {
  it('shows a persistent toast whose Update action activates the waiting worker', () => {
    stubServiceWorkerContainer();
    registerPwa();
    expect(mocks.registerSW).toHaveBeenCalledTimes(1);
    expect(mocks.toast).not.toHaveBeenCalled();

    registeredOptions().onNeedRefresh?.();

    expect(mocks.toast).toHaveBeenCalledTimes(1);
    const [message, options] = mocks.toast.mock.calls[0] as [string, ToastOptions];
    expect(message).toBe('A new version of Plate is available');
    expect(options.id).toBe(UPDATE_TOAST_ID);
    expect(options.duration).toBe(Infinity);
    expect(options.action.label).toBe('Update');

    options.action.onClick();
    expect(mocks.updateSW).toHaveBeenCalledWith(true);
  });

  it('reloads once the new worker controls the page, and only once', () => {
    const container = stubServiceWorkerContainer();
    const reload = vi.fn();
    registerPwa({ reload });
    registeredOptions().onNeedRefresh?.();
    const [, options] = mocks.toast.mock.calls[0] as [string, ToastOptions];

    options.action.onClick();
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event('controllerchange'));
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('polls the registration for a new build every hour', () => {
    vi.useFakeTimers();
    registerPwa();
    const update = vi.fn(async () => undefined);
    registeredOptions().onRegisteredSW?.('/sw.js', {
      update,
    } as unknown as ServiceWorkerRegistration);

    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('tolerates a missing registration', () => {
    registerPwa();
    expect(() => registeredOptions().onRegisteredSW?.('/sw.js', undefined)).not.toThrow();
  });
});
