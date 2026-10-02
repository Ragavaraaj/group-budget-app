import { formatPaise } from '@budget/shared';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '@/auth/sync-context';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCategoryLookup, useExpensesInMonth } from '@/db/hooks';
import { addMonths, currentMonth, formatMonth } from '@/lib/format';
import { ExpenseList } from './expense-list';

/** The personal ledger: this person's own spending, month by month. */
export function HomePage() {
  const { personalGroupId } = useMe();
  const [month, setMonth] = useState(currentMonth);
  const expenses = useExpensesInMonth(personalGroupId, month);
  const categories = useCategoryLookup(personalGroupId);

  const total = expenses?.reduce((sum, e) => sum + e.amountMinor, 0) ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Expenses" />

      <Card>
        <CardContent className="space-y-1">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous month"
              onClick={() => setMonth((m) => addMonths(m, -1))}
            >
              <ChevronLeft />
            </Button>
            <span className="font-medium">{formatMonth(month)}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next month"
              disabled={month >= currentMonth()}
              onClick={() => setMonth((m) => addMonths(m, 1))}
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
            <p className="font-medium">No expenses in {formatMonth(month)}</p>
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
