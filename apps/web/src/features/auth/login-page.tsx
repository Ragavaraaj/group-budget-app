import { Loader2, LogIn, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { cancelAttempt, googleStartUrl, hasPendingAttempt, isStandalone } from '@/auth/attempt';
import { useAuth } from '@/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ERRORS: Record<string, string> = {
  not_invited:
    'This Google account isn’t invited yet. Ask a group owner to send you an invite link.',
  access_denied: 'Sign-in was cancelled.',
  email_not_verified: 'Google says this email address isn’t verified.',
  invalid_state: 'That sign-in link expired. Please try again.',
  google_error: 'Google sign-in didn’t work. Please try again.',
};

/**
 * Sign-in. Used on its own (`/login`) and inside the join page, which passes the invite so a
 * new person can be admitted by it.
 */
export function SignInPanel({ invite }: { invite?: string }) {
  const { state, config, devLogin, noteAttemptStarted } = useAuth();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('dev@example.com');
  const [waiting, setWaiting] = useState(() => isStandalone() && hasPendingAttempt());

  if (state.status === 'loading') return null;
  const offline = state.status === 'signed_out' && state.offline;
  const error = ERRORS[params.get('error') ?? ''];

  const startGoogle = async () => {
    setBusy(true);
    const url = await googleStartUrl({ invite }); // in the installed app this stores the attempt
    noteAttemptStarted();
    setWaiting(isStandalone());
    window.location.assign(url);
  };

  if (waiting) {
    return (
      <div className="space-y-4 text-center" role="status">
        <Loader2 className="text-primary mx-auto size-8 animate-spin" aria-hidden="true" />
        <p className="font-medium">Finish signing in</p>
        <p className="text-muted-foreground text-sm">
          Complete the Google sign-in. If it opened in your browser, confirm there, then come back
          here. This screen continues by itself.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            cancelAttempt();
            setWaiting(false);
            setBusy(false);
          }}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {error}
        </p>
      ) : null}

      {offline ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <WifiOff className="size-4" aria-hidden="true" />
          You’re offline. Connect to the internet to sign in.
        </p>
      ) : null}

      {config?.google ? (
        <Button size="lg" className="w-full" disabled={busy || offline} onClick={startGoogle}>
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <LogIn aria-hidden="true" />
          )}
          Continue with Google
        </Button>
      ) : null}

      {config && !config.google ? (
        <p className="text-muted-foreground text-sm">Sign-in isn’t set up on this server yet.</p>
      ) : null}

      {config?.devLogin ? (
        <form
          className="space-y-2 border-t pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            void devLogin(email).finally(() => setBusy(false));
          }}
        >
          <Label htmlFor="dev-email">Dev sign-in (only on development servers)</Label>
          <div className="flex gap-2">
            <Input
              id="dev-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={busy}>
              Sign in
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function LoginPage() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'signed_in' && !state.sessionExpired) {
    const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
    return <Navigate to={from ?? '/'} replace />;
  }

  return (
    <div className="mx-auto grid min-h-dvh max-w-sm place-items-center px-4 py-10">
      <Card className="w-full">
        <CardContent className="space-y-6">
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Group Budget</h1>
            <p className="text-muted-foreground text-sm">
              Track your spending and split costs with friends, even offline.
            </p>
          </div>
          {state.status === 'signed_in' && state.sessionExpired ? (
            <p className="bg-muted rounded-md p-3 text-sm">
              Your session ended. Sign in again to keep syncing. Your changes on this device are
              safe.
            </p>
          ) : null}
          <SignInPanel />
        </CardContent>
      </Card>
    </div>
  );
}
