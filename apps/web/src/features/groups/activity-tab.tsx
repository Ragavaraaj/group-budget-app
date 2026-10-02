import { formatPaise } from '@budget/shared';
import { HandCoins, Pencil, Plus, Trash2 } from 'lucide-react';
import { personName } from '@/db/hooks';
import type { LocalCategory, LocalExpense, LocalMember, LocalSettlement } from '@/db/types';
import { formatRelative } from '@/lib/format';
import { type ActivityItem, buildActivity } from './derive';

interface ActivityTabProps {
  members: LocalMember[];
  categories: Map<string, LocalCategory>;
  expenses: LocalExpense[];
  settlements: LocalSettlement[];
  meId: string;
}

const VERB = { added: 'added', edited: 'edited', deleted: 'deleted' } as const;
const ICON = { added: Plus, edited: Pencil, deleted: Trash2 } as const;

/** What happened in the group lately: who added, changed or deleted what. */
export function ActivityTab({
  members,
  categories,
  expenses,
  settlements,
  meId,
}: ActivityTabProps) {
  const items = buildActivity(expenses, settlements);
  const who = (id: string) => (id === meId ? 'You' : personName(members, id));

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        Nothing has happened here yet.
      </p>
    );
  }

  const describe = (item: ActivityItem) => {
    if (item.what === 'payment' && item.settlement) {
      const s = item.settlement;
      return {
        Icon: HandCoins,
        text: `${who(item.by)} ${item.kind === 'deleted' ? 'deleted a payment' : 'recorded a payment'}: ${personName(members, s.fromUser)} paid ${personName(members, s.toUser)}`,
        amount: s.amountMinor,
      };
    }
    const e = item.expense;
    const title = e
      ? e.note || (e.categoryId ? categories.get(e.categoryId)?.name : undefined) || 'an expense'
      : 'an expense';
    return {
      Icon: ICON[item.kind],
      text: `${who(item.by)} ${VERB[item.kind]} “${title}”`,
      amount: e?.amountMinor ?? 0,
    };
  };

  return (
    <ul className="divide-y rounded-lg border">
      {items.map((item) => {
        const { Icon, text, amount } = describe(item);
        return (
          <li key={item.key} className="flex items-center gap-3 p-3">
            <span className="bg-muted grid size-8 shrink-0 place-items-center rounded-full">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{text}</span>
              <span className="text-muted-foreground block text-xs">{formatRelative(item.at)}</span>
            </span>
            <span className="text-sm font-medium tabular-nums">{formatPaise(amount)}</span>
          </li>
        );
      })}
    </ul>
  );
}
