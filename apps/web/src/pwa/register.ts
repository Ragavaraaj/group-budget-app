import { registerSW } from 'virtual:pwa-register';
import { toast } from 'sonner';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Registers the service worker. Updates are never applied silently: the user is offered a
 * "Reload" so a new version can't replace the code in the middle of entering an expense.
 */
export function registerPwa(): void {
  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
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
