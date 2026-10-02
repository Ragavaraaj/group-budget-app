[← Plan overview](PLAN.md)

# Known bugs

Bugs found by the end-to-end tests that are not fixed yet. Each entry says what happens, how to see
it, what should happen, where the cause is, and which test shows it. The test for an open bug is
marked `test.fail(...)` with its id, so the suite stays green while it is open and **fails the
moment the bug is fixed** ("expected to fail, but passed"): remove the annotation and move the entry
to [Fixed](#fixed) then.

When a test turns up a new bug, add an entry here (next free `BUG-nnn`), mark the test the same way,
and say so in the pull request. A test that fails because the _test_ is wrong is not a bug: fix the
test.

| Id | Area | Severity | Status | Summary |
| --- | --- | --- | --- | --- |
| [BUG-001](#bug-001-a-csv-file-with-more-than-500-spending-rows-cannot-be-imported-in-full) | Import | Medium | Open | Rows after the 500th of a statement can never be imported |
| [BUG-002](#bug-002-the-refused-changes-panel-says-saving-a-expense) | Settings | Low | Open | The "Changes the server didn’t accept" panel says "Saving a expense" |

Severity: **High** loses or corrupts data, or blocks sign-in; **Medium** blocks a documented flow
with no way round it in the app; **Low** is wrong wording or presentation.

## Open

### BUG-001: A CSV file with more than 500 spending rows cannot be imported in full

- **Area:** Import from CSV (`apps/web/src/features/import/import-page.tsx`)
- **Severity:** Medium. No data is lost, but the page promises something it cannot do, and the
  rows past 500 can only be added by hand or by editing the file.
- **Test:** `e2e/import-limits.spec.ts`, "shows the first 500, and importing them lets the rest be
  imported by choosing the file again" (marked `test.fail`).

**What happens.** A statement with 501 or more spending rows shows the first 500 and a warning:

> This file has 501 expenses. The first 500 are shown; import them, then choose the file again for
> the rest (the ones you have imported will be unticked).

After importing the 500 and choosing the same file again, the preview says "500 expenses found ·
500 look already recorded, unticked" and lists the **same first 500 rows**, all unticked. Row 501
is not on the page, however many times the file is chosen. The warning is shown again and repeats
the same instruction.

**Steps.**

1. Sign in, open Settings, Import from CSV.
2. Choose a CSV of 501 spending rows (`Date,Description,Amount`, amounts negative, distinct, dated
   today).
3. Press "Import 500 expenses". Wait for the Expenses screen.
4. Open Import from CSV again and choose the same file.
5. Look for the 501st row ("Row 501").

**Expected.** The 500 already imported are recognised as duplicates and set aside, and the
remaining row is shown, ticked, and can be imported, as the warning says.

**Actual.** The remaining row is never shown. The import button says "Import 0 expenses".

**Cause.** `rows` is the first `MAX_IMPORT_ROWS` of the file, taken **before** duplicates are
looked for:

```ts
const rows = useMemo(() => result?.rows.slice(0, MAX_IMPORT_ROWS) ?? [], [result]);
const duplicates = useMemo(() => findDuplicates(rows, existing ?? []), [rows, existing]);
```

So the window is always rows 1 to 500 of the file. Once those are recorded they are all flagged
as duplicates and still fill the window.

**Suggested fix.** Find the duplicates across all of `result.rows` first, then take the window
from the rows that are _not_ already recorded (or cap the number of **ticked** rows at 500 and show
the rest), and word the warning to match. The unit tests for `findDuplicates` do not need to change.

### BUG-002: The "refused changes" panel says "Saving a expense"

- **Area:** Settings, Sync card (`apps/web/src/features/settings/settings-page.tsx`)
- **Severity:** Low. Wording only, on an error path.
- **Test:** `e2e/sync-and-export.spec.ts`, "the explanation reads properly: "Saving an expense""
  (marked `test.fail`).

**What happens.** When the server refuses a change, Settings lists it under "Changes the server
didn’t accept". For a refused expense the line reads:

> Saving a expense: you’re no longer in that group.

**Expected.** "Saving an expense: …".

**Cause.** The line is built as `` `${verb} a ${r.entity}: ${reason}` `` from the entity's internal
name, with a fixed "a". That is wrong for `expense` ("an"), and awkward for `recurring` ("Saving a
recurring: …", where "a recurring expense" is meant). `category`, `settlement` and `budget` read
fine by luck.

**Suggested fix.** A small map from entity to display phrase with its article ("an expense", "a
category", "a payment", "a budget", "a recurring expense"), used for all three verbs. Note that
`settlement` is called a "payment" everywhere else in the app.

### Observation, not a bug: a budget at 99.5% to 99.99% reads "is at 100% of its budget"

The Expenses screen's budget alert rounds the percentage, so ₹999 spent of a ₹1,000 budget says "is
at 100% of its budget" while the budget is not yet over (the "over" wording starts at exactly 100%
by the unrounded figure). It is accurate to the rounding, and the Budgets screen shows "₹1 left",
so it is left as is; it is recorded here because it can look like a contradiction. Not covered by a
test on purpose (a test would pin the rounding, not a requirement).

## Fixed

Nothing yet.
