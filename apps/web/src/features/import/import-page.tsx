import { formatPaise, MAX_IMPORT_ROWS, toLocalDate, uuidv7 } from '@budget/shared';
import { ArrowLeft, FileUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useDb, useMe } from '@/auth/sync-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useCategories, useExpensesOfGroups } from '@/db/hooks';
import { saveExpense } from '@/db/repo';
import { formatDay } from '@/lib/format';
import { tryLocal } from '@/lib/local-errors';
import {
  type DateOrder,
  detectBank,
  detectColumns,
  type Field,
  findDuplicates,
  findHeaderRow,
  guessSpendingSign,
  type ImportRow,
  type InterpretOptions,
  interpretRows,
  type Mapping,
  suggestCategory,
} from './bank';
import { parseCsv } from './csv';

const MAX_FILE_BYTES = 2_000_000;

const FIELD_LABELS: Record<Field, string> = {
  date: 'Date',
  description: 'Description',
  debit: 'Money out (debit / withdrawal)',
  credit: 'Money in (credit / deposit)',
  amount: 'Amount (one column)',
  type: 'Dr / Cr marker',
};

interface Loaded {
  name: string;
  /** Every row of the file. */
  rows: string[][];
  headerAt: number;
}

/** `/settings/import`: bring in a bank statement exported as CSV. */
export function ImportPage() {
  const db = useDb();
  const navigate = useNavigate();
  const { personalGroupId, user } = useMe();
  const categories = useCategories(personalGroupId);
  const existing = useExpensesOfGroups([personalGroupId]);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [dateOrder, setDateOrder] = useState<DateOrder>('dmy');
  const [spendingIs, setSpendingIs] = useState<InterpretOptions['spendingIs']>('negative');
  // What the person ticked and chose, by each row's line in the file. A row's position in the
  // list changes when the columns, the date order or the sign change (rows come and go), but its
  // line does not, so their choices stay with the same transaction.
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [chosen, setChosen] = useState<Record<number, string | null>>({});
  const [importing, setImporting] = useState<number | null>(null);

  const header = loaded ? (loaded.rows[loaded.headerAt] ?? []) : [];
  const body = useMemo(() => (loaded ? loaded.rows.slice(loaded.headerAt + 1) : []), [loaded]);

  const result = useMemo(() => {
    if (!loaded || !mapping) return null;
    const interpreted = interpretRows(body, loaded.headerAt + 2, mapping, {
      dateOrder,
      spendingIs,
    });
    const today = toLocalDate();
    const past = interpreted.rows.filter((r) => r.date <= today);
    return {
      ...interpreted,
      unreadable: interpreted.unreadable + (interpreted.rows.length - past.length),
      rows: past,
    };
  }, [loaded, mapping, body, dateOrder, spendingIs]);

  const rows = useMemo(() => result?.rows.slice(0, MAX_IMPORT_ROWS) ?? [], [result]);
  const duplicates = useMemo(() => findDuplicates(rows, existing ?? []), [rows, existing]);
  const bank = loaded ? detectBank(header) : null;

  if (!categories || !existing) return <Skeleton className="h-40" />;

  const isIncluded = (row: ImportRow, index: number) => picked[row.line] ?? !duplicates.has(index);
  const categoryOf = (row: ImportRow): string | null =>
    row.line in chosen ? (chosen[row.line] ?? null) : suggestCategory(row.note, categories);

  const selected = rows.filter(isIncluded);
  const totalMinor = selected.reduce((sum, row) => sum + row.amountMinor, 0);

  const load = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      toast.error('That file is too big. A statement for a few months is usually well under 1 MB.');
      return;
    }
    const text = await file.text();
    const all = parseCsv(text);
    const headerAt = findHeaderRow(all);
    if (headerAt === -1) {
      toast.error(
        'Couldn’t find the table in that file. It needs a date column and an amount column.',
      );
      return;
    }
    const detected = detectColumns(all[headerAt] ?? []);
    setLoaded({ name: file.name, rows: all, headerAt });
    setMapping(detected);
    setSpendingIs(guessSpendingSign(all.slice(headerAt + 1), detected));
    setPicked({});
    setChosen({});
  };

  const run = async () => {
    setImporting(0);
    let done = 0;
    for (const row of selected) {
      const saved = await tryLocal(() =>
        saveExpense(db, user.id, {
          id: uuidv7(),
          groupId: personalGroupId,
          occurredOn: row.date,
          amountMinor: row.amountMinor,
          categoryId: categoryOf(row),
          note: row.note.slice(0, 200),
          splitType: 'equal',
          payers: [{ userId: user.id, amountMinor: row.amountMinor }],
          shares: [{ userId: user.id, amountMinor: row.amountMinor }],
        }),
      );
      if (!saved) {
        setImporting(null);
        toast.error(`Stopped after ${done} of ${selected.length}. What was imported is kept.`);
        return;
      }
      done++;
      setImporting(done);
    }
    setImporting(null);
    toast.success(`Imported ${done} expense${done === 1 ? '' : 's'}`);
    navigate('/', { replace: true });
  };

  const setField = (field: Field, index: number) =>
    setMapping((m) => (m ? { ...m, [field]: index } : m));
  const showSign =
    mapping !== null &&
    mapping.amount !== -1 &&
    mapping.debit === -1 &&
    mapping.credit === -1 &&
    mapping.type === -1;

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to settings">
          <Link to="/settings">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="flex-1 text-xl font-semibold tracking-tight">Import from CSV</h1>
      </header>

      <Card>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Download a statement from your bank’s website or app as CSV, then choose it here. The
            file is read on this device and never uploaded. Spending goes into your personal ledger;
            money coming in is left out.
          </p>
          <Label
            htmlFor="statement-file"
            className="hover:bg-accent flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-sm font-medium"
          >
            <FileUp className="size-4" aria-hidden="true" />
            {loaded ? `Chosen: ${loaded.name}` : 'Choose a CSV file'}
          </Label>
          <input
            id="statement-file"
            data-testid="statement-file"
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void load(file);
              event.target.value = '';
            }}
          />
        </CardContent>
      </Card>

      {loaded && mapping && result ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Check the columns</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground text-sm">
                {bank
                  ? `This looks like a ${bank} statement.`
                  : 'Couldn’t tell which bank this is, so check that each column is right.'}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(Object.keys(FIELD_LABELS) as Field[]).map((field) => (
                  <div key={field} className="space-y-1">
                    <Label htmlFor={`map-${field}`} className="text-xs">
                      {FIELD_LABELS[field]}
                    </Label>
                    <select
                      id={`map-${field}`}
                      className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                      value={mapping[field]}
                      onChange={(e) => setField(field, Number(e.target.value))}
                    >
                      <option value={-1}>Not in this file</option>
                      {header.map((name, i) => (
                        // The header's position is its identity; two columns can share a name.
                        // biome-ignore lint/suspicious/noArrayIndexKey: see above
                        <option key={i} value={i}>
                          {name || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <span className="text-sm font-medium">Dates are written</span>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  className="w-full"
                  value={dateOrder}
                  onValueChange={(value) => value && setDateOrder(value as DateOrder)}
                >
                  <ToggleGroupItem value="dmy" className="flex-1">
                    Day first (02/10/2026)
                  </ToggleGroupItem>
                  <ToggleGroupItem value="mdy" className="flex-1">
                    Month first
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              {showSign ? (
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">Spending is shown as</span>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    className="w-full"
                    value={spendingIs}
                    onValueChange={(value) =>
                      value && setSpendingIs(value as 'negative' | 'positive')
                    }
                  >
                    <ToggleGroupItem value="negative" className="flex-1">
                      Negative numbers
                    </ToggleGroupItem>
                    <ToggleGroupItem value="positive" className="flex-1">
                      Positive numbers
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground text-sm" data-testid="import-summary">
                {rows.length} expense{rows.length === 1 ? '' : 's'} found
                {result.credits > 0 ? ` · ${result.credits} money in, left out` : ''}
                {duplicates.size > 0 ? ` · ${duplicates.size} look already recorded, unticked` : ''}
                {result.unreadable > 0
                  ? ` · ${result.unreadable} line${result.unreadable === 1 ? '' : 's'} skipped`
                  : ''}
              </p>
              {result.rows.length > MAX_IMPORT_ROWS ? (
                <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">
                  This file has {result.rows.length} expenses. The first {MAX_IMPORT_ROWS} are
                  shown; import them, then choose the file again for the rest (the ones you have
                  imported will be unticked).
                </p>
              ) : null}

              {rows.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No spending found. If the columns above look wrong, change them.
                </p>
              ) : (
                <ul className="divide-y rounded-lg border" data-testid="import-rows">
                  {rows.map((row, index) => (
                    <li key={row.line} className="flex items-start gap-3 p-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-4"
                        checked={isIncluded(row, index)}
                        aria-label={`Import ${row.note || 'expense'} on ${formatDay(row.date)}`}
                        onChange={(e) => setPicked((p) => ({ ...p, [row.line]: e.target.checked }))}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="flex justify-between gap-3 text-sm">
                          <span className="truncate font-medium">{row.note || 'Expense'}</span>
                          <span className="shrink-0 tabular-nums">
                            {formatPaise(row.amountMinor)}
                          </span>
                        </p>
                        <p className="text-muted-foreground flex justify-between gap-3 text-xs">
                          <span>{formatDay(row.date)}</span>
                          {duplicates.has(index) ? <span>Looks already recorded</span> : null}
                        </p>
                        <select
                          aria-label={`Category for ${row.note || 'expense'}`}
                          className="border-input bg-background h-8 w-full rounded-md border px-2 text-xs"
                          value={categoryOf(row) ?? ''}
                          onChange={(e) =>
                            setChosen((c) => ({ ...c, [row.line]: e.target.value || null }))
                          }
                        >
                          <option value="">No category</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Button
            size="lg"
            className="w-full"
            disabled={selected.length === 0 || importing !== null}
            onClick={() => void run()}
          >
            {importing !== null
              ? `Importing… ${importing} of ${selected.length}`
              : `Import ${selected.length} expense${selected.length === 1 ? '' : 's'} (${formatPaise(totalMinor)})`}
          </Button>
          <p className="text-muted-foreground text-center text-xs">
            Check the preview before importing: banks lay out their files differently. Imported
            expenses can be edited or deleted like any other.
          </p>
        </>
      ) : null}
    </div>
  );
}
