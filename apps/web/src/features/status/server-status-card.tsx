import { useMemo, useSyncExternalStore } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { runningBuildId } from '@/pwa/build-id';
import { updateReady } from '@/pwa/update-state';
import { useHealth } from './use-health';

export function ServerStatusCard() {
  const state = useHealth();
  // Which build of the app this is. Shown whatever the server says: when it can't be reached is
  // when someone most needs to know which version they are running.
  const buildId = useMemo(() => runningBuildId(), []);
  const newerReady = useSyncExternalStore(updateReady.subscribe, updateReady.getSnapshot);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Server</CardTitle>
        <CardDescription>Your data syncs here when you're connected.</CardDescription>
      </CardHeader>
      <CardContent aria-live="polite">
        {state.kind === 'checking' && <Skeleton className="h-6 w-24" />}
        {state.kind === 'online' && (
          <div className="flex min-w-0 items-center gap-2">
            <Badge>Online</Badge>
            <span
              className="text-muted-foreground min-w-0 truncate text-sm"
              title={state.health.version}
            >
              version {state.health.version}
            </span>
          </div>
        )}
        {state.kind === 'unreachable' && state.deviceOffline && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Offline</Badge>
            <span className="text-muted-foreground text-sm">Working from this device</span>
          </div>
        )}
        {state.kind === 'unreachable' && !state.deviceOffline && (
          <div className="flex items-center gap-2">
            <Badge variant="destructive">Unreachable</Badge>
            <span className="text-muted-foreground text-sm">The server isn't responding</span>
          </div>
        )}
        <p className="text-muted-foreground mt-1 min-w-0 truncate text-xs" title={buildId}>
          app {buildId}
        </p>
        {newerReady && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            A newer version of the app is ready. Close the app and open it again to update.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
