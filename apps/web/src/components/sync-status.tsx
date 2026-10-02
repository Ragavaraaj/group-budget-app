import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Check, CloudOff, RefreshCw } from 'lucide-react';
import { useDb, useSyncStatus } from '@/auth/sync-context';
import { cn } from '@/lib/utils';

/**
 * Always visible, so a person always knows whether what they entered has reached the server.
 * "Waiting" counts changes saved on this device that haven't been sent yet.
 */
export function SyncStatusChip({ className }: { className?: string }) {
  const db = useDb();
  const { state } = useSyncStatus();
  const waiting = useLiveQuery(() => db.outbox.count(), [db]) ?? 0;

  const { icon: Icon, label, tone } = describe(state, waiting);
  return (
    <output
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        tone,
        className,
      )}
      aria-live="polite"
    >
      <Icon className={cn('size-3.5', state === 'syncing' && 'animate-spin')} aria-hidden="true" />
      {label}
    </output>
  );
}

function describe(state: ReturnType<typeof useSyncStatus>['state'], waiting: number) {
  const queued = waiting > 0 ? `${waiting} waiting` : null;
  switch (state) {
    case 'syncing':
      return {
        icon: RefreshCw,
        label: queued ? `Syncing · ${queued}` : 'Syncing',
        tone: 'text-muted-foreground',
      };
    case 'offline':
      return {
        icon: CloudOff,
        label: queued ? `Offline · ${queued}` : 'Offline',
        tone: 'text-amber-600 dark:text-amber-400',
      };
    case 'error':
      return {
        icon: AlertTriangle,
        label: queued ? `Sync problem · ${queued}` : 'Sync problem',
        tone: 'text-destructive',
      };
    case 'signed_out':
      return {
        icon: AlertTriangle,
        label: queued ? `Sign in to sync · ${queued}` : 'Sign in to sync',
        tone: 'text-destructive',
      };
    default:
      return queued
        ? { icon: RefreshCw, label: queued, tone: 'text-muted-foreground' }
        : { icon: Check, label: 'Synced', tone: 'text-muted-foreground' };
  }
}
