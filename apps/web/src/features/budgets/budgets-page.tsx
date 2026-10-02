import { evaluateBudgets, periodRange } from '@budget/shared';
import { ArrowLeft, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useDb, useMe } from '@/auth/sync-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useBudgets,
  useCategories,
  useCategoryLookup,
  useExpensesInMonth,
  useGroups,
  useMonthStartDay,
} from '@/db/hooks';
import { deleteBudget, restoreBudget } from '@/db/repo';
import type { LocalBudget } from '@/db/types';
import { addMonths, currentPeriod, formatPeriod } from '@/lib/format';
import { tryLocal } from '@/lib/local-errors';
import { BudgetBar } from './budget-bar';
import { BudgetDialog } from './budget-dialog';
import { budgetChoices } from './choices';

/** `/budgets` (optionally `?group=<id>`): monthly limits for a group and where each one stands. */
export function BudgetsPage() {
  const { personalGroupId, user } = useMe();
  const db = useDb();
  const groups = useGroups();
  const startDay = useMonthStartDay();
  const [params, setParams] = useSearchParams();
  const requested = params.get('group');
  const groupId = groups?.some((g) => g.id === requested)
    ? (requested ?? personalGroupId)
    : personalGroupId;

  // Go back to wherever the person came from (Settings, a group, Insights); Insights if unknown.
  const from = params.get('from');
  const backTo =
    from?.startsWith('/') && !from.startsWith('//')
      ? from
      : `/insights${groupId === personalGroupId ? '' : `?group=${groupId}`}`;

  const nowPeriod = currentPeriod(startDay);
  const [picked, setPicked] = useState<string | null>(null);
  const period = picked ?? nowPeriod;

  const budgets = useBudgets(groupId);
  const categories = useCategories(groupId);
  const lookup = useCategoryLookup(groupId);
  const expenses = useExpensesInMonth(groupId, period, startDay);
  const [editing, setEditing] = useState<LocalBudget | 'new' | null>(null);

  if (!groups || !budgets || !categories || !lookup || !expenses) {
    return <Skeleton className="h-48" />;
  }

  const statuses = evaluateBudgets(budgets, expenses, periodRange(period, startDay)).sort(
    (a, b) => Number(b.categoryId === null) - Number(a.categoryId === null) || b.usedBp - a.usedBp,
  );
  const byId = new Map(budgets.map((b) => [b.id, b]));
  const nothingLeft = budgetChoices(categories, budgets).length === 0;
  const nameOf = (categoryId: string | null) =>
    categoryId === null ? 'Everything' : (lookup.get(categoryId)?.name ?? 'Category');

  const remove = async (budget: LocalBudget) => {
    if (!(await tryLocal(() => deleteBudget(db, user.id, budget.id)))) return;
    toast('Budget removed', {
      action: {
        label: 'Undo',
        onClick: () => void tryLocal(() => restoreBudget(db, user.id, budget.id)),
      },
    });
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to={backTo}>
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="flex-1 text-xl font-semibold tracking-tight">Budgets</h1>
        <Button size="sm" disabled={nothingLeft} onClick={() => setEditing('new')}>
          <Plus /> Add
        </Button>
      </header>

      {nothingLeft ? (
        <p className="text-muted-foreground text-sm" data-testid="budgets-all-set">
          Everything has a budget. Tap one to change it.
        </p>
      ) : null}

      {groups.length > 1 ? (
        <Select
          value={groupId}
          onValueChange={(value) => {
            setPicked(null);
            setParams(from ? { group: value, from } : { group: value }, { replace: true });
          }}
        >
          <SelectTrigger className="w-full" aria-label="Group">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.isPersonal ? 'Personal' : g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous period"
          onClick={() => setPicked(addMonths(period, -1))}
        >
          <ChevronLeft />
        </Button>
        <span className="font-medium">{formatPeriod(period, startDay)}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next period"
          disabled={period >= nowPeriod}
          onClick={() => setPicked(addMonths(period, 1))}
        >
          <ChevronRight />
        </Button>
      </div>

      {statuses.length === 0 ? (
        <Card>
          <CardContent className="space-y-1 text-center">
            <p className="font-medium">No budgets yet</p>
            <p className="text-muted-foreground text-sm">
              Set a monthly limit for everything, or for a category like Food.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {statuses.map((status) => {
            const budget = byId.get(status.budgetId);
            if (!budget) return null;
            return (
              <li key={status.budgetId}>
                <Card>
                  <CardContent className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <BudgetBar status={status} name={nameOf(status.categoryId)} />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${nameOf(status.categoryId)} budget`}
                      onClick={() => setEditing(budget)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${nameOf(status.categoryId)} budget`}
                      onClick={() => void remove(budget)}
                    >
                      <Trash2 />
                    </Button>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-muted-foreground text-xs">
        A budget counts the whole group’s spending, not one person’s share.
      </p>

      <BudgetDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        groupId={groupId}
        categories={categories}
        budgets={budgets}
        existing={editing && editing !== 'new' ? editing : undefined}
      />
    </div>
  );
}
