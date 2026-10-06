import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useHealth } from './use-health';

/** Both are commits (a local or test build says "dev"), and they differ: this app is the old one. */
function isOutOfDate(app: string, server: string): boolean {
  return app !== 'dev' && server !== 'dev' && app !== server;
}

export function ServerStatusCard() {
  const state = useHealth();

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
        {state.kind === 'online' && (
          <>
            <p
              className="text-muted-foreground mt-1 min-w-0 truncate text-xs"
              title={__APP_VERSION__}
            >
              app {__APP_VERSION__.slice(0, 7)}
            </p>
            {isOutOfDate(__APP_VERSION__, state.health.version) && (
              <p className="text-destructive mt-1 text-xs">
                This app is older than the server. Close it and open it again to update.
              </p>
            )}
          </>
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
      </CardContent>
    </Card>
  );
}
