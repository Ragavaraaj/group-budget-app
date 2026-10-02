import { evaluateBudgets, periodRange } from '@budget/shared';
import { TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { Card, CardContent } from '@/components/ui/card';
import { useBudgets, useCategoryLookup, useExpensesInMonth, useMonthStartDay } from '@/db/hooks';
import { currentPeriod } from '@/lib/format';

/**
 * Budgets that are close to their limit or past it this month, shown above a group's expenses.
 * Worked out on the device, so the warning appears even offline. Renders nothing when all is well.
 */
export function BudgetAlerts({ groupId }: { groupId: string }) {
  const startDay = useMonthStartDay();
  const budgets = useBudgets(groupId);
  const categories = useCategoryLookup(groupId);
  const expenses = useExpensesInMonth(groupId, currentPeriod(startDay), startDay);
  if (!budgets || !categories || !expenses || budgets.length === 0) return null;

  const warnings = evaluateBudgets(
    budgets,
    expenses,
    periodRange(currentPeriod(startDay), startDay),
  )
    .filter((s) => s.level !== 'ok')
    .sort((a, b) => b.usedBp - a.usedBp);
  if (warnings.length === 0) return null;

  return (
    <Card className="border-amber-500/50" data-testid="budget-alerts">
      <CardContent>
        <Link to={`/budgets?group=${groupId}`} className="flex gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-500" aria-hidden="true" />
          <ul className="min-w-0 flex-1 space-y-0.5 text-sm">
            {warnings.map((s) => {
              const name =
                s.categoryId === null
                  ? 'Everything'
                  : (categories.get(s.categoryId)?.name ?? 'A category');
              return (
                <li key={s.budgetId}>
                  <span className="font-medium">{name}</span>{' '}
                  {s.level === 'over'
                    ? 'is over its budget this month'
                    : `is at ${Math.round(s.usedBp / 100)}% of its budget`}
                </li>
              );
            })}
          </ul>
        </Link>
      </CardContent>
    </Card>
  );
}
