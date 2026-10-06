import { registerSW } from 'virtual:pwa-register';
import { toast } from 'sonner';
import { hasPendingAttempt } from '@/auth/attempt';
import { lastAutoUpdate } from '@/auth/storage';
import { trackInteraction } from './interaction';
import { handleUpdateFound } from './startup-update';
import { announceTab, otherTabsOpen } from './tab-presence';
import { updateReady } from './update-state';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Registers the service worker. An update found right after the app opens, before anything has
 * been entered and with no other tab open, is applied at once. Any other is offered with a
 * "Reload", so a new version can't replace the code in the middle of entering an expense
 * (src/pwa/update-policy.ts).
 */
export function registerPwa(): void {
  const userHasInteracted = trackInteraction(window);
  announceTab();

  const offer = () =>
    toast('A new version is available', {
      id: 'pwa-update',
      duration: Infinity,
      action: { label: 'Reload', onClick: () => void updateServiceWorker(true) },
    });

  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateReady.set(true);
      void handleUpdateFound({
        openedForMs: () => performance.now(),
        now: () => Date.now(),
        lastAutoUpdate,
        userHasInteracted,
        otherTabsOpen,
        signInPending: () => hasPendingAttempt(),
        activate: () => updateServiceWorker(true),
        offer,
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
