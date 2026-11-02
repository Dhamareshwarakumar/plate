import { toast } from 'sonner';
import { registerSW } from 'virtual:pwa-register';

/** An installed app that stays open for days never re-navigates, so ask for updates on a timer. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;
export const UPDATE_TOAST_ID = 'pwa-update';

/**
 * Registers the service worker in prompt mode (vite.config.ts `registerType: 'prompt'`): a new
 * build waits until the user taps **Update** in a persistent toast, so nothing reloads under an
 * edit in progress. Called once from main.tsx in production builds only.
 */
export function registerPwa(): void {
  const updateSW = registerSW({
    onNeedRefresh() {
      toast('A new version of Plate is available', {
        id: UPDATE_TOAST_ID,
        duration: Infinity,
        description: 'Reloads the app; anything already saved is kept.',
        action: {
          label: 'Update',
          onClick: () => {
            void updateSW(true);
          },
        },
      });
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => {
        registration.update().catch(() => undefined);
      }, UPDATE_CHECK_MS);
    },
    onRegisterError(error: unknown) {
      console.warn('Service worker registration failed', error);
    },
  });
}
