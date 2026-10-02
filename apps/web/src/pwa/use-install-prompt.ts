import { useEffect, useState } from 'react';

/** Chromium's install prompt event; not in lib.dom because it isn't standardised. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

export interface InstallPrompt {
  /** Already running as an installed app. */
  installed: boolean;
  /** The browser offered a one-tap install (Chromium on Android/desktop). */
  canInstall: boolean;
  /** iOS Safari has no install prompt; the user must use Share → Add to Home Screen. */
  isIos: boolean;
  install: () => Promise<void>;
}

export function useInstallPrompt(): InstallPrompt {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }

  return {
    installed,
    canInstall: deferred !== null,
    isIos: /iphone|ipad|ipod/i.test(navigator.userAgent),
    install,
  };
}
