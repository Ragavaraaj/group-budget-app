import { formatPaise } from '@budget/shared';
import { ArrowRight, HandCoins, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb, useMe } from '@/auth/sync-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { personName } from '@/db/hooks';
import { deleteSettlement, restoreSettlement } from '@/db/repo';
import type { LocalMember, LocalSettlement } from '@/db/types';
import { formatDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { GroupMoney } from './derive';
import { orderMembers } from './derive';
import { type SettleDefaults, SettleDialog } from './settle-dialog';

interface BalancesTabProps {
  groupId: string;
  members: LocalMember[];
  money: GroupMoney;
  settlements: LocalSettlement[];
}

/** Who owes whom, the fewest payments that settle it, and the payments already made. */
export function BalancesTab({ groupId, members, money, settlements }: BalancesTabProps) {
  const db = useDb();
  const { user } = useMe();
  const [dialog, setDialog] = useState<{ defaults?: SettleDefaults } | null>(null);

  const mine = money.balances.get(user.id) ?? 0;
  const activeMembers = members.filter((m) => m.removedAt === null);
  // Anyone with money in play is listed, even if they have since left.
  const listed = orderMembers(
    members.filter((m) => m.removedAt === null || (money.balances.get(m.userId) ?? 0) !== 0),
    user.id,
  );
  const payments = settlements
    .filter((s) => s.deletedAt === null)
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.updatedAt - a.updatedAt);

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-1 text-center">
          <p className="text-muted-foreground text-sm">Your balance</p>
          <p
            data-testid="my-balance"
            className={cn(
              'text-3xl font-semibold tabular-nums',
              mine > 0 && 'text-emerald-600 dark:text-emerald-400',
              mine < 0 && 'text-destructive',
            )}
          >
            {mine === 0
              ? 'All settled up'
              : mine > 0
                ? `You’re owed ${formatPaise(mine)}`
                : `You owe ${formatPaise(-mine)}`}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Everyone</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {listed.map((member) => {
              const balance = money.balances.get(member.userId) ?? 0;
              return (
                <li key={member.userId} className="flex items-center justify-between py-2.5">
                  <span className="truncate">
                    {member.userId === user.id ? 'You' : personName(members, member.userId)}
                  </span>
                  <span
                    className={cn(
                      'text-sm font-medium tabular-nums',
                      balance > 0 && 'text-emerald-600 dark:text-emerald-400',
                      balance < 0 && 'text-destructive',
                      balance === 0 && 'text-muted-foreground',
                    )}
                    data-testid={`balance-${member.displayName}`}
                  >
                    {balance === 0
                      ? 'settled up'
                      : balance > 0
                        ? `is owed ${formatPaise(balance)}`
                        : `owes ${formatPaise(-balance)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settle up</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {money.transfers.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nobody owes anybody. Nice.</p>
          ) : (
            <>
              <p className="text-muted-foreground text-sm">
                The fewest payments that clear everything:
              </p>
              <ul className="space-y-2">
                {money.transfers.map((t) => (
                  <li
                    key={`${t.from}-${t.to}`}
                    className="flex items-center gap-2 rounded-lg border p-3"
                    data-testid="suggested-transfer"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
                      <span className="truncate font-medium">
                        {t.from === user.id ? 'You' : personName(members, t.from)}
                      </span>
                      <ArrowRight className="size-3.5 shrink-0" aria-label="pays" />
                      <span className="truncate font-medium">
                        {t.to === user.id ? 'you' : personName(members, t.to)}
                      </span>
                    </span>
                    <span className="font-medium tabular-nums">{formatPaise(t.amountMinor)}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setDialog({
                          defaults: { from: t.from, to: t.to, amountMinor: t.amountMinor },
                        })
                      }
                    >
                      Record
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Button variant="secondary" size="sm" onClick={() => setDialog({})}>
            <HandCoins /> Record a payment
          </Button>
        </CardContent>
      </Card>

      {payments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Payments made</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {payments.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {personName(members, s.fromUser)} paid {personName(members, s.toUser)}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {formatDay(s.occurredOn)}
                    </span>
                  </span>
                  <span className="font-medium tabular-nums">{formatPaise(s.amountMinor)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete payment"
                    onClick={() => {
                      void deleteSettlement(db, user.id, s.id);
                      toast('Payment deleted', {
                        action: {
                          label: 'Undo',
                          onClick: () => void restoreSettlement(db, user.id, s.id),
                        },
                      });
                    }}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <SettleDialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        groupId={groupId}
        members={activeMembers}
        defaults={dialog?.defaults}
      />
    </div>
  );
}
