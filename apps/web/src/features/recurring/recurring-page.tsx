import { formatPaise } from '@budget/shared';
import { ArrowLeft, Plus, Repeat } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useDb, useMe } from '@/auth/sync-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useGroups, useRecurringRules, useRemovedMembers } from '@/db/hooks';
import { saveRecurring } from '@/db/repo';
import type { LocalRecurring } from '@/db/types';
import { formatDay } from '@/lib/format';
import { tryLocal } from '@/lib/local-errors';
import { describeNext, describeSchedule, joinNames, peopleWhoLeft } from './describe';

/** `/settings/recurring`: expenses that repeat by themselves (rent, subscriptions, a SIP…). */
export function RecurringPage() {
  const db = useDb();
  const { user } = useMe();
  const rules = useRecurringRules();
  const groups = useGroups();
  const removed = useRemovedMembers();

  if (!rules || !groups || !removed) return <Skeleton className="h-40" />;
  const groupName = new Map(groups.map((g) => [g.id, g.isPersonal ? null : g.name]));
  const whoLeft = (rule: LocalRecurring) =>
    peopleWhoLeft(rule, rule.createdBy, removed.get(rule.groupId) ?? []);

  const toggle = (rule: LocalRecurring, active: boolean) => {
    const { inSplit } = whoLeft(rule);
    if (active && inSplit.length > 0) {
      // The server would refuse it, and the switch would flip back later with no explanation.
      toast.error(
        `${joinNames(inSplit)} left the group. Open this rule and take them out of the split first.`,
      );
      return;
    }
    return tryLocal(() =>
      saveRecurring(db, user.id, {
        id: rule.id,
        groupId: rule.groupId,
        frequency: rule.frequency,
        startOn: rule.startOn,
        endOn: rule.endOn,
        active,
        amountMinor: rule.amountMinor,
        categoryId: rule.categoryId,
        note: rule.note,
        splitType: rule.splitType,
        payers: rule.payers,
        shares: rule.shares,
      }),
    );
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to settings">
          <Link to="/settings">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="flex-1 text-xl font-semibold tracking-tight">Recurring expenses</h1>
        <Button asChild size="sm">
          <Link to="/settings/recurring/new">
            <Plus /> Add
          </Link>
        </Button>
      </header>

      <p className="text-muted-foreground text-sm">
        Rent, subscriptions, a monthly investment: they’re added for you on the day, and show up on
        every device. They’re created by the server, so a rule added offline starts once it has
        synced.
      </p>

      {rules.length === 0 ? (
        <Card>
          <CardContent className="space-y-1 text-center">
            <Repeat className="mx-auto size-6" aria-hidden="true" />
            <p className="font-medium">Nothing repeats yet</p>
            <p className="text-muted-foreground text-sm">
              Add the first one with the button above.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3" data-testid="recurring-list">
          {rules.map((rule) => {
            const group = groupName.get(rule.groupId);
            const { inSplit, creator } = whoLeft(rule);
            const waiting =
              rule.active && inSplit.length > 0
                ? `Waiting: ${joinNames(inSplit)} left the group. Open it and take them out of the split.`
                : rule.active && creator !== null
                  ? `Waiting: ${creator}, who set it up, left the group. Open it and save to take it over.`
                  : null;
            return (
              <li key={rule.id}>
                <Card>
                  <CardContent className="flex items-center gap-3">
                    <Link
                      to={`/settings/recurring/${rule.id}`}
                      className="min-w-0 flex-1 space-y-0.5"
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">
                          {rule.note || 'Recurring expense'}
                        </span>
                        {group ? <Badge variant="secondary">{group}</Badge> : null}
                        {rule.version === 0 ? (
                          <Badge variant="outline">Not synced yet</Badge>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {formatPaise(rule.amountMinor)} · {describeSchedule(rule)}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {describeNext(rule, (d) => formatDay(d))}
                      </span>
                      {waiting ? (
                        <span
                          className="block text-xs text-amber-600 dark:text-amber-400"
                          data-testid="rule-waiting"
                        >
                          {waiting}
                        </span>
                      ) : null}
                    </Link>
                    <Switch
                      checked={rule.active}
                      aria-label={`${rule.note || 'Recurring expense'} is ${rule.active ? 'on' : 'paused'}`}
                      onCheckedChange={(active) => void toggle(rule, active)}
                    />
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
