import { formatPaise } from '@budget/shared';
import { ArrowLeft, ChartColumn, Pencil, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMe } from '@/auth/sync-context';
import { AddExpenseFab } from '@/components/add-expense-fab';
import { HeroCard, HeroStepper } from '@/components/hero-card';
import { NotFoundPage } from '@/components/not-found-page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useAllExpenses,
  useAllSettlements,
  useCategoryLookup,
  useExpensesInMonth,
  useGroup,
  useMembers,
  useMonthStartDay,
} from '@/db/hooks';
import type { LocalMember } from '@/db/types';
import { BudgetAlerts } from '@/features/budgets/budget-alerts';
import { ExpenseList } from '@/features/expenses/expense-list';
import { addMonths, currentPeriod, formatPeriod } from '@/lib/format';
import { ActivityTab } from './activity-tab';
import { BalancesTab } from './balances-tab';
import { deriveMoney } from './derive';
import { RenameGroupDialog } from './group-dialogs';
import { MembersTab } from './members-tab';

const TABS = ['expenses', 'balances', 'activity', 'members'] as const;
type Tab = (typeof TABS)[number];

/** `/groups/:id`: one shared group. */
export function GroupPage() {
  const { id } = useParams();
  const { user } = useMe();
  const group = useGroup(id);
  const members = useMembers(id);
  const [params, setParams] = useSearchParams();
  const [renaming, setRenaming] = useState(false);

  const tab: Tab = TABS.find((t) => t === params.get('tab')) ?? 'expenses';

  if (group === undefined || members === undefined) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-32" />
      </div>
    );
  }
  const mine = members.find((m) => m.userId === user.id && m.removedAt === null);
  if (!id || !group || group.isPersonal || !mine) return <NotFoundPage />;
  const isOwner = mine.role === 'owner';

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to groups">
          <Link to="/groups">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">
          {group.name}
        </h1>
        <Button asChild variant="ghost" size="icon" aria-label="Search this group">
          <Link to={`/search?group=${id}`}>
            <Search />
          </Link>
        </Button>
        <Button asChild variant="ghost" size="icon" aria-label="Insights for this group">
          <Link to={`/insights?group=${id}`}>
            <ChartColumn />
          </Link>
        </Button>
        {isOwner ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Rename group"
            onClick={() => setRenaming(true)}
          >
            <Pencil />
          </Button>
        ) : null}
      </header>

      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value }, { replace: true })}>
        <TabsList className="w-full">
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>

        <TabsContent value="expenses" className="space-y-4 pt-2">
          <ExpensesTab groupId={id} members={members} />
        </TabsContent>
        <TabsContent value="balances" className="pt-2">
          <BalancesLoader groupId={id} members={members} />
        </TabsContent>
        <TabsContent value="activity" className="pt-2">
          <ActivityLoader groupId={id} members={members} meId={user.id} />
        </TabsContent>
        <TabsContent value="members" className="pt-2">
          <MembersTab groupId={id} groupName={group.name} members={members} isOwner={isOwner} />
        </TabsContent>
      </Tabs>

      {tab === 'expenses' || tab === 'balances' ? (
        <AddExpenseFab
          to={`/add?group=${id}&from=${encodeURIComponent(`/groups/${id}?tab=${tab}`)}`}
        />
      ) : null}

      <RenameGroupDialog
        open={renaming}
        onOpenChange={setRenaming}
        groupId={id}
        currentName={group.name}
      />
    </div>
  );
}

function ExpensesTab({ groupId, members }: { groupId: string; members: LocalMember[] }) {
  const startDay = useMonthStartDay();
  const [picked, setPicked] = useState<string | null>(null);
  const now = currentPeriod(startDay);
  const month = picked ?? now;
  const expenses = useExpensesInMonth(groupId, month, startDay);
  const categories = useCategoryLookup(groupId);
  const total = expenses?.reduce((sum, e) => sum + e.amountMinor, 0) ?? 0;

  return (
    <>
      <BudgetAlerts groupId={groupId} />
      <HeroCard>
        <HeroStepper
          label={formatPeriod(month, startDay)}
          previousLabel="Previous month"
          nextLabel="Next month"
          nextDisabled={month >= now}
          onPrevious={() => setPicked(addMonths(month, -1))}
          onNext={() => setPicked(addMonths(month, 1))}
        />
        <div className="text-center">
          <p className="text-hero-foreground/80 text-sm">Group spending</p>
          <p
            className="text-4xl font-bold tracking-tight tabular-nums"
            data-testid="group-month-total"
          >
            <span className="sr-only">Group spending this month: </span>
            {formatPaise(total)}
          </p>
        </div>
      </HeroCard>

      {!expenses || !categories ? (
        <Skeleton className="h-14" />
      ) : expenses.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          No expenses in {formatPeriod(month, startDay)}.
        </p>
      ) : (
        <ExpenseList
          expenses={expenses}
          categories={categories}
          members={members}
          showPayer
          hrefFor={(e) => `/expenses/${e.id}/edit?from=${encodeURIComponent(`/groups/${groupId}`)}`}
        />
      )}
    </>
  );
}

function BalancesLoader({ groupId, members }: { groupId: string; members: LocalMember[] }) {
  const expenses = useAllExpenses(groupId);
  const settlements = useAllSettlements(groupId);
  const money = useMemo(
    () => (expenses && settlements ? deriveMoney(expenses, settlements) : null),
    [expenses, settlements],
  );
  if (!money || !settlements) return <Skeleton className="h-40" />;
  return (
    <BalancesTab groupId={groupId} members={members} money={money} settlements={settlements} />
  );
}

function ActivityLoader({
  groupId,
  members,
  meId,
}: {
  groupId: string;
  members: LocalMember[];
  meId: string;
}) {
  const expenses = useAllExpenses(groupId);
  const settlements = useAllSettlements(groupId);
  const categories = useCategoryLookup(groupId);
  if (!expenses || !settlements || !categories) return <Skeleton className="h-40" />;
  return (
    <ActivityTab
      members={members}
      categories={categories}
      expenses={expenses}
      settlements={settlements}
      meId={meId}
    />
  );
}
