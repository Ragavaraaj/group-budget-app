import { Download, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { isStandalone } from '@/auth/attempt';
import { useAuth } from '@/auth/auth-context';
import { Button } from '@/components/ui/button';

/** The session ended (for example after 30 days away): the app keeps working, sync waits. */
export function SessionExpiredBanner() {
  const { state } = useAuth();
  if (state.status !== 'signed_in' || !state.sessionExpired) return null;
  return (
    <div
      role="alert"
      className="bg-destructive/10 text-destructive flex items-center justify-between gap-3 rounded-lg p-3 text-sm"
    >
      <span>Your session ended, so changes aren’t syncing. They’re safe on this device.</span>
      <Button asChild size="sm" variant="outline">
        <Link to="/login">Sign in</Link>
      </Button>
    </div>
  );
}

const DISMISS_KEY = 'gb:install-banner-dismissed';

function dismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * On a phone, outside the installed app, browsers may drop offline data after a week and (on iOS
 * Chrome) may not run the service worker at all. Ask people to install before that happens.
 */
export function NotInstalledBanner() {
  const [hidden, setHidden] = useState(dismissed);
  const phone = window.matchMedia('(pointer: coarse)').matches;
  if (hidden || !phone || isStandalone()) return null;
  return (
    <div className="bg-muted flex items-start gap-3 rounded-lg p-3 text-sm">
      <Download className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="flex-1">
        Install this app to your home screen for offline use: open the browser menu, then{' '}
        <strong>Add to Home Screen</strong>.
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => {
          try {
            sessionStorage.setItem(DISMISS_KEY, '1');
          } catch {
            // The banner just comes back next visit.
          }
          setHidden(true);
        }}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
