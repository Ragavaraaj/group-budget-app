import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useHealth } from './use-health';

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
          <div className="flex items-center gap-2">
            <Badge>Online</Badge>
            <span className="text-muted-foreground text-sm">version {state.health.version}</span>
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
      </CardContent>
    </Card>
  );
}
