import { formatPaise } from '@budget/shared';
import { ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '@/auth/sync-context';
import { PageHeader } from '@/components/page-header';
import { PersonAvatar } from '@/components/person-avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAllExpenses, useAllSettlements, useGroups, useMembers } from '@/db/hooks';
import type { LocalGroup } from '@/db/types';
import { cn } from '@/lib/utils';
import { deriveMoney } from './derive';
import { NewGroupDialog } from './group-dialogs';

/** `/groups`: the shared groups you are in, with where you stand in each. */
export function GroupsPage() {
  const groups = useGroups();
  const [creating, setCreating] = useState(false);
  const shared = groups?.filter((g) => !g.isPersonal);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Groups" description="Split expenses with friends and family." />
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> New
        </Button>
      </div>

      {!shared ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : shared.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 text-center">
            <p className="font-medium">No groups yet</p>
            <p className="text-muted-foreground text-sm">
              Create one for a trip or a flat, then invite people with a link. Or open an invite
              link someone sent you.
            </p>
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create a group
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="bg-card divide-y overflow-hidden rounded-2xl shadow-xs">
          {shared.map((group) => (
            <GroupRow key={group.id} group={group} />
          ))}
        </ul>
      )}

      <NewGroupDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function GroupRow({ group }: { group: LocalGroup }) {
  const { user } = useMe();
  const members = useMembers(group.id);
  const expenses = useAllExpenses(group.id);
  const settlements = useAllSettlements(group.id);
  const mine = useMemo(
    () =>
      expenses && settlements
        ? (deriveMoney(expenses, settlements).balances.get(user.id) ?? 0)
        : null,
    [expenses, settlements, user.id],
  );
  const count = members?.filter((m) => m.removedAt === null).length;

  return (
    <li>
      <Link
        to={`/groups/${group.id}`}
        className="hover:bg-accent flex items-center gap-3 p-4 transition-colors"
      >
        <PersonAvatar id={group.id} name={group.name} className="rounded-2xl" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{group.name}</span>
          <span className="text-muted-foreground block text-xs">
            {count === undefined ? ' ' : `${count} ${count === 1 ? 'person' : 'people'}`}
          </span>
        </span>
        {mine !== null ? (
          <span
            className={cn(
              'text-sm font-semibold tabular-nums',
              mine > 0 && 'text-positive',
              mine < 0 && 'text-negative',
              mine === 0 && 'text-muted-foreground',
            )}
          >
            {mine === 0
              ? 'settled up'
              : mine > 0
                ? `owed ${formatPaise(mine)}`
                : `you owe ${formatPaise(-mine)}`}
          </span>
        ) : null}
        <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
      </Link>
    </li>
  );
}
