import { formatPaise } from '@budget/shared';
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '@/auth/sync-context';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCategoryLookup, useExpensesInMonth, useMonthStartDay } from '@/db/hooks';
import { BudgetAlerts } from '@/features/budgets/budget-alerts';
import { addMonths, currentPeriod, formatPeriod } from '@/lib/format';
import { ExpenseList } from './expense-list';

/** The personal ledger: this person's own spending, month by month. */
export function HomePage() {
  const { personalGroupId } = useMe();
  const startDay = useMonthStartDay();
  const [picked, setPicked] = useState<string | null>(null);
  const now = currentPeriod(startDay);
  const month = picked ?? now;
  const expenses = useExpensesInMonth(personalGroupId, month, startDay);
  const categories = useCategoryLookup(personalGroupId);

  const total = expenses?.reduce((sum, e) => sum + e.amountMinor, 0) ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expenses"
        actions={
          <Button asChild variant="ghost" size="icon" aria-label="Search expenses">
            <Link to="/search">
              <Search />
            </Link>
          </Button>
        }
      />

      <BudgetAlerts groupId={personalGroupId} />

      <Card>
        <CardContent className="space-y-1">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous month"
              onClick={() => setPicked(addMonths(month, -1))}
            >
              <ChevronLeft />
            </Button>
            <span className="font-medium">{formatPeriod(month, startDay)}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next month"
              disabled={month >= now}
              onClick={() => setPicked(addMonths(month, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
          <p className="text-center text-3xl font-semibold tabular-nums" data-testid="month-total">
            <span className="sr-only">Month total: </span>
            {formatPaise(total)}
          </p>
          <p className="text-muted-foreground text-center text-xs">
            {expenses ? `${expenses.length} expense${expenses.length === 1 ? '' : 's'}` : ' '}
          </p>
        </CardContent>
      </Card>

      {!expenses || !categories ? (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : expenses.length === 0 ? (
        <Card>
          <CardContent className="space-y-1 text-center">
            <p className="font-medium">No expenses in {formatPeriod(month, startDay)}</p>
            <p className="text-muted-foreground text-sm">Tap + to add one. It works offline too.</p>
          </CardContent>
        </Card>
      ) : (
        <ExpenseList expenses={expenses} categories={categories} />
      )}

      <Button
        asChild
        size="icon"
        className="fixed right-4 bottom-20 z-30 size-14 rounded-full shadow-lg"
      >
        <Link to="/add" aria-label="Add expense">
          <Plus className="size-6" />
        </Link>
      </Button>
    </div>
  );
}
