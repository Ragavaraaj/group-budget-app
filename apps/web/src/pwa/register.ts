import { registerSW } from 'virtual:pwa-register';
import { toast } from 'sonner';
import { hasPendingAttempt } from '@/auth/attempt';
import { lastAutoUpdate } from '@/auth/storage';
import { trackInteraction } from './interaction';
import { handleUpdateFound } from './startup-update';
import { mayReloadNow } from './update-policy';
import { updateReady } from './update-state';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Registers the service worker. An update found right after the app opens, before anything has
 * been entered, is applied at once. Any other is offered with a "Reload", so a new version can't
 * replace the code in the middle of entering an expense. And when a new version takes over, every
 * open tab is told to reload; a tab that has been used (or is waiting for a sign-in) offers it
 * instead of forcing it (src/pwa/update-policy.ts).
 */
export function registerPwa(): void {
  const userHasInteracted = trackInteraction(window);
  /** The person tapped Reload: that reload they asked for is never held back. */
  let askedToReload = false;

  /**
   * What the "Reload" button does. If a new version is waiting it takes over (and the page then
   * reloads); if it already has, or another tab did, there is nothing waiting to ask, so reload.
   */
  const reload = async () => {
    askedToReload = true;
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.waiting) void updateServiceWorker(true);
    else window.location.reload();
  };

  const offer = () =>
    toast('A new version is available', {
      id: 'pwa-update',
      duration: Infinity,
      action: { label: 'Reload', onClick: () => void reload() },
    });

  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateReady.markReady();
      void handleUpdateFound({
        openedForMs: () => performance.now(),
        now: () => Date.now(),
        lastAutoUpdate,
        userHasInteracted,
        signInPending: () => hasPendingAttempt(),
        activate: () => updateServiceWorker(true),
        offer,
      });
    },
    onNeedReload() {
      // The new version has taken over, and this page is about to be reloaded onto it. Not if the
      // person has started using this one (a form half filled, perhaps in another tab than the
      // one that asked), or is waiting for a sign-in to be collected: then offer it.
      const state = {
        askedToReload,
        userHasInteracted: userHasInteracted(),
        signInPending: hasPendingAttempt(),
      };
      if (mayReloadNow(state)) window.location.reload();
      else offer();
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
