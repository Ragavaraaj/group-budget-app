import {
  addMonths,
  changeBetween,
  dailyAverage,
  daysElapsed,
  evaluateBudgets,
  fiscalYearOfPeriod,
  fiscalYearPeriodKeys,
  fiscalYearRange,
  formatPaise,
  periodRange,
  summarise,
  toLocalDate,
  trend,
} from '@budget/shared';
import { ChevronLeft, ChevronRight, PiggyBank } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMe } from '@/auth/sync-context';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  useBudgets,
  useCategoriesOfGroups,
  useExpensesOfGroups,
  useGroups,
  useMonthStartDay,
} from '@/db/hooks';
import { BudgetBar } from '@/features/budgets/budget-bar';
import { currentPeriod, fiscalYearLabel, formatMonthShort, formatPeriod } from '@/lib/format';
import { limitRows, nameCategories } from './breakdown';
import { CategoryBars, TrendChart } from './charts';

type View = 'month' | 'year';
const MAX_CATEGORY_ROWS = 8;

/** `/insights` (optionally `?group=<id>`): where the money went, by month or financial year. */
export function InsightsPage() {
  const { user } = useMe();
  const groups = useGroups();
  const startDay = useMonthStartDay();
  const [params, setParams] = useSearchParams();

  const [view, setView] = useState<View>('month');
  const [pickedPeriod, setPickedPeriod] = useState<string | null>(null);
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  const [wholeGroup, setWholeGroup] = useState(false);

  const nowPeriod = currentPeriod(startDay);
  const periodKey = pickedPeriod ?? nowPeriod;
  const year = pickedYear ?? fiscalYearOfPeriod(nowPeriod);

  const wanted = params.get('group');
  const scoped = groups?.find((g) => g.id === wanted);
  const groupIds = useMemo(
    () => (scoped ? [scoped.id] : groups?.map((g) => g.id)),
    [scoped, groups],
  );
  const expenses = useExpensesOfGroups(groupIds);
  const categories = useCategoriesOfGroups(groupIds);
  const budgets = useBudgets(scoped?.id);

  // "Whole group" only means something for one shared group; otherwise it's your own share.
  const canChooseMeasure = scoped !== undefined && !scoped.isPersonal;
  const measure = canChooseMeasure && wholeGroup ? 'total' : 'mine';

  const report = useMemo(() => {
    if (!expenses) return null;
    const range =
      view === 'month' ? periodRange(periodKey, startDay) : fiscalYearRange(year, startDay);
    const before =
      view === 'month'
        ? periodRange(addMonths(periodKey, -1), startDay)
        : fiscalYearRange(year - 1, startDay);
    const options = { me: user.id, measure } as const;
    const keys =
      view === 'month'
        ? Array.from({ length: 6 }, (_, i) => addMonths(periodKey, i - 5))
        : fiscalYearPeriodKeys(year);
    return {
      range,
      summary: summarise(expenses, { ...options, ...range }),
      previous: summarise(expenses, { ...options, ...before }).totalMinor,
      points: trend(expenses, { ...options, keys, startDay }),
    };
  }, [expenses, view, periodKey, year, startDay, user.id, measure]);

  if (!groups || !report || !categories) {
    return (
      <div className="space-y-4">
        <PageHeader title="Insights" />
        <Skeleton className="h-28" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  const today = toLocalDate();
  const running = today >= report.range.start && today < report.range.endExclusive;
  const { summary } = report;
  const rows = nameCategories(summary.byCategory, categories);
  const tailRows = limitRows(rows, MAX_CATEGORY_ROWS);

  const days = daysElapsed(report.range.start, report.range.endExclusive, today);
  const change = changeBetween(report.previous, summary.totalMinor);
  const atPresent =
    view === 'month' ? periodKey >= nowPeriod : year >= fiscalYearOfPeriod(nowPeriod);
  const label = view === 'month' ? formatPeriod(periodKey, startDay) : fiscalYearLabel(year);
  const previousLabel =
    view === 'month' ? formatPeriod(addMonths(periodKey, -1), startDay) : fiscalYearLabel(year - 1);

  const step = (delta: number) => {
    if (view === 'month') setPickedPeriod(addMonths(periodKey, delta));
    else setPickedYear(year + delta);
  };

  const budgetStatuses =
    view === 'month' && scoped && budgets && budgets.length > 0
      ? evaluateBudgets(budgets, expenses ?? [], report.range)
          .sort((a, b) => b.usedBp - a.usedBp)
          .slice(0, 3)
      : [];

  return (
    <div className="space-y-5">
      <PageHeader title="Insights" description="Where your money went." />

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="insights-group" className="text-sm font-medium">
            Group
          </label>
          <Select
            value={scoped?.id ?? 'all'}
            onValueChange={(value) => {
              if (value === 'all') setParams({}, { replace: true });
              else setParams({ group: value }, { replace: true });
            }}
          >
            <SelectTrigger id="insights-group" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All my groups</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.isPersonal ? 'Personal' : g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Period</span>
          <ToggleGroup
            type="single"
            variant="outline"
            className="w-full"
            value={view}
            onValueChange={(value) => {
              if (value) setView(value as View);
            }}
          >
            <ToggleGroupItem value="month" className="flex-1">
              Month
            </ToggleGroupItem>
            <ToggleGroupItem value="year" className="flex-1">
              Year
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {canChooseMeasure ? (
        <ToggleGroup
          type="single"
          variant="outline"
          className="w-full"
          aria-label="What to count"
          value={wholeGroup ? 'total' : 'mine'}
          onValueChange={(value) => {
            if (value) setWholeGroup(value === 'total');
          }}
        >
          <ToggleGroupItem value="mine" className="flex-1">
            My share
          </ToggleGroupItem>
          <ToggleGroupItem value="total" className="flex-1">
            Whole group
          </ToggleGroupItem>
        </ToggleGroup>
      ) : null}

      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous period"
              onClick={() => step(-1)}
            >
              <ChevronLeft />
            </Button>
            <span className="font-medium" data-testid="insights-period">
              {label}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next period"
              disabled={atPresent}
              onClick={() => step(1)}
            >
              <ChevronRight />
            </Button>
          </div>

          <div className="text-center">
            <p className="text-3xl font-semibold tabular-nums" data-testid="insights-total">
              <span className="sr-only">Total: </span>
              {formatPaise(summary.totalMinor)}
            </p>
            <p className="text-muted-foreground text-xs">
              {summary.count} expense{summary.count === 1 ? '' : 's'}
              {measure === 'mine' ? ' · your share' : ' · whole group'}
              {running ? ' · so far' : ''}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-3 border-t pt-3 text-center text-sm">
            <div>
              <dt className="text-muted-foreground text-xs">
                {view === 'month' ? 'Per day' : 'Per month'}
              </dt>
              <dd className="font-medium tabular-nums" data-testid="insights-average">
                {formatPaise(
                  view === 'month'
                    ? dailyAverage(summary.totalMinor, days)
                    : dailyAverage(summary.totalMinor, Math.max(1, Math.round(days / 30.4))),
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Before: {previousLabel}</dt>
              <dd className="font-medium tabular-nums" data-testid="insights-previous">
                {formatPaise(report.previous)}
              </dd>
            </div>
          </dl>
          {report.previous > 0 || summary.totalMinor > 0 ? (
            <p className="text-muted-foreground text-center text-xs" data-testid="insights-change">
              {change.deltaMinor === 0
                ? 'The same as before.'
                : `${formatPaise(Math.abs(change.deltaMinor))} ${change.deltaMinor > 0 ? 'more' : 'less'} than ${previousLabel}${running ? ' (so far this period)' : ''}.`}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {summary.count === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground text-center text-sm">
            Nothing spent in {label}.
          </CardContent>
        </Card>
      ) : (
        <>
          {budgetStatuses.length > 0 && scoped ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PiggyBank className="size-4" aria-hidden="true" /> Budgets
                </CardTitle>
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/budgets?group=${scoped.id}`}>Manage</Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {budgetStatuses.map((status) => (
                  <BudgetBar
                    key={status.budgetId}
                    status={status}
                    name={
                      status.categoryId === null
                        ? 'Everything'
                        : (categories.get(status.categoryId)?.name ?? 'Category')
                    }
                  />
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {view === 'month' ? 'Last six months' : `Months of ${fiscalYearLabel(year)}`}
              </CardTitle>
            </CardHeader>
            <CardContent data-testid="insights-trend">
              <TrendChart
                caption={view === 'month' ? 'Spending in the last six months' : 'Spending by month'}
                data={report.points.map((p) => ({
                  key: p.key,
                  label: formatMonthShort(p.key),
                  value: p.totalMinor,
                  selected: view === 'month' && p.key === periodKey,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By category</CardTitle>
            </CardHeader>
            <CardContent>
              <CategoryBars rows={tailRows} totalMinor={summary.totalMinor} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
