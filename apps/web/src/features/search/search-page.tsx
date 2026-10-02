import { formatPaise, parseRupees } from '@budget/shared';
import { ArrowLeft, Search, X } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCategoriesOfGroups, useExpensesOfGroups, useGroups } from '@/db/hooks';
import { ExpenseList } from '@/features/expenses/expense-list';
import { categoryChoices, filterExpenses, isEmptySearch } from './filter';

/** Results are drawn in full only up to this many, so a broad search stays quick on a phone. */
const SHOWN = 200;
const ANY = 'any';

/** `/search` (optionally `?group=<id>`): find expenses by words, category, dates or amount. */
export function SearchPage() {
  const groups = useGroups();
  const [params, setParams] = useSearchParams();
  const scoped = groups?.find((g) => g.id === params.get('group'));
  const groupIds = useMemo(
    () => (scoped ? [scoped.id] : groups?.map((g) => g.id)),
    [scoped, groups],
  );
  const expenses = useExpensesOfGroups(groupIds);
  const categories = useCategoriesOfGroups(groupIds);

  const [text, setText] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');

  const filters = useDeferredValue({
    text,
    category,
    from,
    to,
    minMinor: min.trim() === '' ? null : parseRupees(min),
    maxMinor: max.trim() === '' ? null : parseRupees(max),
  });

  const results = useMemo(
    () => (expenses && categories ? filterExpenses(expenses, filters, categories) : null),
    [expenses, categories, filters],
  );
  const choices = useMemo(() => categoryChoices(categories?.values() ?? []), [categories]);

  const searching = !isEmptySearch(filters);
  const total = results?.reduce((sum, e) => sum + e.amountMinor, 0) ?? 0;
  const clear = () => {
    setText('');
    setCategory(null);
    setFrom('');
    setTo('');
    setMin('');
    setMax('');
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to={scoped ? `/groups/${scoped.id}` : '/'}>
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="flex-1 text-xl font-semibold tracking-tight">
          Search
          {scoped ? (
            <span className="text-muted-foreground block text-sm font-normal">
              {scoped.isPersonal ? 'Personal' : scoped.name}
            </span>
          ) : null}
        </h1>
      </header>

      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          type="search"
          autoFocus
          aria-label="Search expenses"
          placeholder="Words, a category, an amount…"
          className="pl-9"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="search-category">Category</Label>
          <Select
            value={category ?? ANY}
            onValueChange={(value) => setCategory(value === ANY ? null : value)}
          >
            <SelectTrigger id="search-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any</SelectItem>
              <SelectItem value="none">No category</SelectItem>
              {choices.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {groups && groups.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor="search-group">Group</Label>
            <Select
              value={scoped?.id ?? ANY}
              onValueChange={(value) =>
                value === ANY
                  ? setParams({}, { replace: true })
                  : setParams({ group: value }, { replace: true })
              }
            >
              <SelectTrigger id="search-group" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All my groups</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.isPersonal ? 'Personal' : g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="search-from">From</Label>
          <Input
            id="search-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="search-to">To</Label>
          <Input id="search-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="search-min">At least (₹)</Label>
          <Input
            id="search-min"
            inputMode="decimal"
            autoComplete="off"
            value={min}
            onChange={(e) => setMin(e.target.value)}
            aria-invalid={min.trim() !== '' && parseRupees(min) === null}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="search-max">At most (₹)</Label>
          <Input
            id="search-max"
            inputMode="decimal"
            autoComplete="off"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            aria-invalid={max.trim() !== '' && parseRupees(max) === null}
          />
        </div>
      </div>

      {searching ? (
        <Button variant="ghost" size="sm" onClick={clear}>
          <X /> Clear search
        </Button>
      ) : null}

      {!results || !categories ? (
        <Skeleton className="h-24" />
      ) : !searching ? (
        <Card>
          <CardContent className="text-muted-foreground text-center text-sm">
            Type something above, or pick a category, dates or an amount.
          </CardContent>
        </Card>
      ) : results.length === 0 ? (
        <Card>
          <CardContent className="text-center text-sm" data-testid="search-empty">
            Nothing matches.
          </CardContent>
        </Card>
      ) : (
        <>
          <p
            className="text-muted-foreground text-sm"
            data-testid="search-summary"
            aria-live="polite"
          >
            {results.length} expense{results.length === 1 ? '' : 's'} · {formatPaise(total)}
            {results.length > SHOWN ? ` · showing the newest ${SHOWN}` : ''}
          </p>
          <ExpenseList
            expenses={results.slice(0, SHOWN)}
            categories={categories}
            hrefFor={(e) => `/expenses/${e.id}/edit?from=${encodeURIComponent('/search')}`}
          />
        </>
      )}
    </div>
  );
}
