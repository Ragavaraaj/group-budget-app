import { registerSW } from 'virtual:pwa-register';
import { toast } from 'sonner';
import { shouldApplyAtStartup } from './update-policy';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const AUTO_UPDATE_KEY = 'pwa-auto-update-at';

/**
 * Decides whether an update found now is applied without asking (see `update-policy.ts`), and
 * writes down that it was. If that can't be written down (storage blocked) the answer is no: the
 * guard against reloading in a loop could not work.
 */
function claimStartupUpdate(): boolean {
  try {
    const at = Number(sessionStorage.getItem(AUTO_UPDATE_KEY));
    const sinceLastAutoUpdateMs = at > 0 ? Date.now() - at : null;
    if (!shouldApplyAtStartup({ openedForMs: performance.now(), sinceLastAutoUpdateMs })) {
      return false;
    }
    sessionStorage.setItem(AUTO_UPDATE_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/**
 * Registers the service worker. An update found right after the app opens is applied at once
 * (nothing can be half-entered yet). Any other is offered with a "Reload", so a new version
 * can't replace the code in the middle of entering an expense.
 */
export function registerPwa(): void {
  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (claimStartupUpdate()) {
        void updateServiceWorker(true);
        return;
      }
      toast('A new version is available', {
        id: 'pwa-update',
        duration: Infinity,
        action: { label: 'Reload', onClick: () => void updateServiceWorker(true) },
      });
    },
    onOfflineReady() {
      toast.success('Ready to work offline');
    },
    onRegisteredSW(_url, registration) {
      // Installed PWAs can stay open for days; check for a new version hourly.
      if (registration) setInterval(() => void registration.update(), UPDATE_CHECK_INTERVAL_MS);
    },
    onRegisterError(error) {
      console.error('Service worker registration failed', error);
    },
  });
}
