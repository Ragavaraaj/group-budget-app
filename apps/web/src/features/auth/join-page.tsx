import { groupResponseSchema } from '@budget/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { useAuth } from '@/auth/auth-context';
import { SignedInProvider, useDb, useEngine } from '@/auth/sync-context';
import { Spinner, SplashScreen } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError, apiGet, apiSend } from '@/lib/api';
import { SignInPanel } from './login-page';

const previewSchema = z.union([
  z.object({ valid: z.literal(true), groupName: z.string(), invitedBy: z.string() }),
  z.object({ valid: z.literal(false) }),
]);

type Preview = z.infer<typeof previewSchema> | 'error' | null;

const ACCEPT_ERRORS: Record<string, string> = {
  invite_invalid: 'This invite has expired or been used up. Ask for a new one.',
  removed: 'The group owner removed you from this group. Ask them to add you back.',
  group_full: 'This group is full.',
  too_many_groups: 'You’re in the maximum number of groups.',
};

/** `/join/:token`: what an invite link opens. Works before sign-in (to show who invited you). */
export function JoinPage() {
  const { token = '' } = useParams();
  const { state } = useAuth();
  const [preview, setPreview] = useState<Preview>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiGet(
      `/api/invites/preview?token=${encodeURIComponent(token)}`,
      previewSchema,
      controller.signal,
    )
      .then(setPreview)
      .catch((error) => {
        if (!(error instanceof DOMException)) setPreview('error');
      });
    return () => controller.abort();
  }, [token]);

  if (state.status === 'loading') return <SplashScreen />;

  return (
    <div className="mx-auto grid min-h-dvh max-w-sm grid-cols-[minmax(0,1fr)] place-items-center px-4 py-10">
      <Card className="w-full">
        <CardContent className="space-y-6">
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Join a group</h1>
            {preview === null ? (
              <Spinner className="text-muted-foreground mx-auto" />
            ) : preview !== 'error' && preview.valid ? (
              <p className="text-muted-foreground text-sm [overflow-wrap:anywhere]">
                {preview.invitedBy} invited you to <strong>{preview.groupName}</strong>.
              </p>
            ) : (
              <p className="text-destructive text-sm" role="alert">
                {preview === 'error'
                  ? 'Couldn’t check this invite. Are you online?'
                  : 'This invite has expired or been used up. Ask for a new one.'}
              </p>
            )}
          </div>

          {preview !== null && preview !== 'error' && preview.valid ? (
            state.status === 'signed_in' && !state.sessionExpired ? (
              <SignedInProvider me={state.me}>
                <AcceptInvite token={token} />
              </SignedInProvider>
            ) : (
              <SignInPanel invite={token} />
            )
          ) : (
            <Button asChild variant="outline" className="w-full">
              <Link to="/">Go to the app</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AcceptInvite({ token }: { token: string }) {
  const engine = useEngine();
  const db = useDb();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the server has taken us in. The invite may be used up by then, so a second try must
  // only fetch the group, never accept again.
  const [joinedId, setJoinedId] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    let groupId = joinedId;
    if (groupId === null) {
      try {
        ({ groupId } = await apiSend(
          'POST',
          '/api/invites/accept',
          { token },
          groupResponseSchema,
        ));
        setJoinedId(groupId);
      } catch (e) {
        setBusy(false);
        setError(
          e instanceof ApiError
            ? (ACCEPT_ERRORS[e.code ?? ''] ?? 'Couldn’t join the group. Please try again.')
            : 'You seem to be offline. Connect to the internet to join.',
        );
        return;
      }
    }

    // `trigger` never throws: a failed sync only shows in the status. So check that the group
    // is here, and that the sync which fetched it finished (the group's row can be written
    // before a later page of the pull, or its history, fails). Otherwise the person lands on a
    // group that is empty or only partly there.
    const arrived = await engine
      .trigger() // pull the group (and its history) before showing it
      .then(
        async () => engine.getSnapshot().caughtUp && (await db.groups.get(groupId)) !== undefined,
      )
      .catch(() => false);
    if (arrived) {
      navigate(`/groups/${groupId}`, { replace: true });
      return;
    }
    setBusy(false);
    setError(
      'You’re in the group, but it hasn’t all reached this phone yet. Check your connection, then try again. It will also appear under Groups once syncing works. Settings shows what went wrong.',
    );
  };

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button size="lg" className="w-full" disabled={busy} onClick={join}>
        {busy ? <Spinner /> : null}
        {joinedId ? 'Try again' : 'Join group'}
      </Button>
    </div>
  );
}
