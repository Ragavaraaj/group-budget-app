import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronRight,
  Download,
  FileUp,
  LogOut,
  PiggyBank,
  RefreshCw,
  Repeat,
  Tags,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/auth-context';
import { useDb, useEngine, useMe, useSyncStatus } from '@/auth/sync-context';
import { PageHeader } from '@/components/page-header';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { getMeta, setMeta } from '@/db/database';
import { MONTH_START_KEY, useMonthStartDay } from '@/db/hooks';
import type { Rejection } from '@/db/types';
import { ServerStatusCard } from '@/features/status/server-status-card';
import { download, type ExportBundle, expensesToCsv, exportToJson } from '@/lib/export';
import { initials } from '@/lib/format';
import { InstallCard } from './install-card';

const DAY = 24 * 60 * 60 * 1000;

const REASONS: Record<string, string> = {
  not_a_member: 'you’re no longer in that group',
  deleted: 'it had been deleted',
  group_mismatch: 'it belongs to another group',
  invalid_reference: 'it refers to something that isn’t in the group',
  not_found: 'it no longer exists',
  invalid: 'the server couldn’t read it',
};

export function SettingsPage() {
  const { user } = useMe();
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      <Card>
        <CardContent className="flex items-center gap-3">
          <Avatar className="size-12">
            {user.avatarUrl ? (
              <AvatarImage src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
            ) : null}
            <AvatarFallback>{initials(user.displayName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{user.displayName}</p>
            <p className="text-muted-foreground truncate text-sm">{user.email}</p>
          </div>
        </CardContent>
      </Card>

      <SyncCard />

      <Card>
        <CardContent className="divide-y p-0">
          {[
            { to: '/settings/categories', label: 'Categories', icon: Tags },
            { to: '/budgets', label: 'Budgets', icon: PiggyBank },
            { to: '/settings/recurring', label: 'Recurring expenses', icon: Repeat },
            { to: '/settings/import', label: 'Import from CSV', icon: FileUp },
          ].map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className="hover:bg-accent flex items-center gap-3 p-4">
              <Icon className="size-5" aria-hidden="true" />
              <span className="flex-1 font-medium">{label}</span>
              <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
            </Link>
          ))}
        </CardContent>
      </Card>

      <ReportingCard />

      <ExportCard />
      <InstallCard />
      <ServerStatusCard />
      <SignOut />
    </div>
  );
}

function SyncCard() {
  const db = useDb();
  const engine = useEngine();
  const { state, lastSyncedAt, live } = useSyncStatus();
  const waiting = useLiveQuery(() => db.outbox.count(), [db]) ?? 0;
  const oldest = useLiveQuery(
    async () => (await db.outbox.orderBy('seq').first())?.createdAt,
    [db],
  );
  const rejections =
    useLiveQuery(async () => (await getMeta<Rejection[]>(db, 'rejections')) ?? [], [db]) ?? [];

  const stale = oldest !== undefined && Date.now() - oldest > DAY;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          {state === 'offline'
            ? 'You’re offline. Everything you enter is saved on this device and syncs when you’re back online.'
            : state === 'signed_out'
              ? 'Your session ended. Sign in again to sync.'
              : state === 'error'
                ? 'The server couldn’t be reached properly. Trying again shortly.'
                : lastSyncedAt
                  ? `Last synced at ${new Date(lastSyncedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}.`
                  : 'Syncing…'}
          {waiting > 0 ? ` ${waiting} change${waiting === 1 ? '' : 's'} waiting to be sent.` : ''}
          {live ? ' Live: changes from other people arrive as they happen.' : ''}
        </p>
        {stale ? (
          <p role="alert" className="text-destructive">
            Some changes have been waiting for over a day. Open the app with a connection to send
            them.
          </p>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void engine.trigger()}
          disabled={state === 'syncing'}
        >
          <RefreshCw className={state === 'syncing' ? 'animate-spin' : undefined} /> Sync now
        </Button>

        {rejections.length > 0 ? (
          <div className="space-y-2 border-t pt-3">
            <p className="font-medium">Changes the server didn’t accept</p>
            <ul className="text-muted-foreground list-disc space-y-1 pl-5">
              {rejections.map((r) => (
                <li key={`${r.entityId}-${r.at}`}>
                  {r.op === 'upsert' ? 'Saving' : r.op === 'delete' ? 'Deleting' : 'Restoring'} a{' '}
                  {r.entity}: {REASONS[r.reason] ?? r.reason}.
                </li>
              ))}
            </ul>
            <Button variant="ghost" size="sm" onClick={() => void setMeta(db, 'rejections', [])}>
              Dismiss
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The day a "month" starts on, for the month views, insights and budgets. */
function ReportingCard() {
  const db = useDb();
  const day = useMonthStartDay();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Months</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="month-start">A month starts on day</Label>
        <select
          id="month-start"
          className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
          value={day}
          onChange={(e) => void setMeta(db, MONTH_START_KEY, Number(e.target.value))}
        >
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d === 1 ? '1 (calendar months)' : String(d)}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">
          If your salary arrives on the 25th, pick 25 and a “month” runs from the 25th to the 24th.
          This applies on this device, to your own views.
        </p>
      </CardContent>
    </Card>
  );
}

function ExportCard() {
  const db = useDb();
  const { user } = useMe();

  const bundle = async (): Promise<ExportBundle> => ({
    exportedAt: new Date().toISOString(),
    user: { id: user.id, name: user.displayName, email: user.email },
    groups: await db.groups.toArray(),
    members: await db.members.toArray(),
    categories: await db.categories.toArray(),
    expenses: await db.expenses.toArray(),
    settlements: await db.settlements.toArray(),
    budgets: await db.budgets.toArray(),
    recurring: await db.recurring.toArray(),
  });
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export your data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">
          Everything on this device, including shared groups, as a file you keep.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              download(
                `group-budget-${stamp}.csv`,
                expensesToCsv(await bundle()),
                'text/csv;charset=utf-8',
              );
              toast.success('Expenses exported');
            }}
          >
            <Download /> CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              download(
                `group-budget-${stamp}.json`,
                exportToJson(await bundle()),
                'application/json',
              );
              toast.success('Everything exported');
            }}
          >
            <Download /> JSON
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SignOut() {
  const { signOut } = useAuth();
  const db = useDb();
  const { state } = useSyncStatus();
  const waiting = useLiveQuery(() => db.outbox.count(), [db]) ?? 0;
  const [open, setOpen] = useState(false);
  const offline = state === 'offline' || !navigator.onLine;

  return (
    <>
      <Button variant="outline" className="w-full" disabled={offline} onClick={() => setOpen(true)}>
        <LogOut /> Sign out
      </Button>
      {offline ? (
        <p className="text-muted-foreground text-center text-xs">Signing out needs a connection.</p>
      ) : null}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              {waiting > 0
                ? `${waiting} change${waiting === 1 ? ' hasn’t' : 's haven’t'} reached the server yet. If you sign out now ${waiting === 1 ? 'it' : 'they'} will be lost. Wait for the status to show “Synced” first.`
                : 'This removes your data from this device. Everything is still saved on the server, and comes back when you sign in.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay signed in</AlertDialogCancel>
            <AlertDialogAction
              variant={waiting > 0 ? 'destructive' : 'default'}
              onClick={() => {
                signOut().catch(() =>
                  toast.error('Couldn’t sign out. Check your connection and try again.'),
                );
              }}
            >
              {waiting > 0 ? 'Sign out anyway' : 'Sign out'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
