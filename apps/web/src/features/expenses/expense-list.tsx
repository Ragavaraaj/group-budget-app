import { formatPaise } from '@budget/shared';
import { Link } from 'react-router';
import { CategoryIcon } from '@/components/category-icon';
import { personName } from '@/db/hooks';
import type { LocalCategory, LocalExpense, LocalMember } from '@/db/types';
import { formatDay } from '@/lib/format';

interface ExpenseListProps {
  expenses: LocalExpense[];
  categories: Map<string, LocalCategory>;
  /** Shared groups show who paid; the personal ledger doesn't need to. */
  members?: LocalMember[];
  showPayer?: boolean;
  /** Where tapping a row goes. */
  hrefFor?: (expense: LocalExpense) => string;
}

/** Expenses grouped under their day, as a plain accessible list. */
export function ExpenseList({
  expenses,
  categories,
  members,
  showPayer = false,
  hrefFor = (e) => `/expenses/${e.id}/edit`,
}: ExpenseListProps) {
  const days: { date: string; items: LocalExpense[] }[] = [];
  for (const expense of expenses) {
    const last = days.at(-1);
    if (last?.date === expense.occurredOn) last.items.push(expense);
    else days.push({ date: expense.occurredOn, items: [expense] });
  }

  return (
    <div className="space-y-5">
      {days.map(({ date, items }) => (
        <section key={date} aria-label={formatDay(date)} className="space-y-1">
          <h3 className="text-muted-foreground flex justify-between px-1 text-xs font-medium uppercase tracking-wide">
            <span>{formatDay(date)}</span>
            <span>{formatPaise(items.reduce((sum, e) => sum + e.amountMinor, 0))}</span>
          </h3>
          <ul className="divide-y rounded-lg border">
            {items.map((expense) => {
              const category = expense.categoryId ? categories.get(expense.categoryId) : undefined;
              const title = expense.note || category?.name || 'Expense';
              return (
                <li key={expense.id}>
                  <Link
                    to={hrefFor(expense)}
                    className="hover:bg-accent flex items-center gap-3 p-3 transition-colors"
                  >
                    <CategoryIcon icon={category?.icon} color={category?.color} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{title}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {[
                          expense.note && category ? category.name : null,
                          showPayer
                            ? `Paid by ${expense.payers.map((p) => personName(members, p.userId)).join(', ')}`
                            : null,
                          expense.version === 0 ? 'Not synced yet' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatPaise(expense.amountMinor)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
