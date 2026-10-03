[← Plan overview](PLAN.md)

# Known bugs

Bugs found by the end-to-end tests. All of the ones found so far are fixed (see [Fixed](#fixed)).
Each entry says what happens, how to see it, what should happen, where the cause is, and which test
shows it. The test for an open bug is
marked `test.fail(...)` with its id, so the suite stays green while it is open and **fails the
moment the bug is fixed** ("expected to fail, but passed"): remove the annotation and move the entry
to [Fixed](#fixed) then.

When a test turns up a new bug, add an entry here (next free `BUG-nnn`), mark the test the same way,
and say so in the pull request. A test that fails because the _test_ is wrong is not a bug: fix the
test.

| Id | Area | Severity | Status | Summary |
| --- | --- | --- | --- | --- |
| [BUG-001](#bug-001-a-csv-file-with-more-than-500-spending-rows-cannot-be-imported-in-full) | Import | Medium | Fixed | Rows after the 500th of a statement can never be imported |
| [BUG-002](#bug-002-the-refused-changes-panel-says-saving-a-expense) | Settings | Low | Fixed | The "Changes the server didn’t accept" panel says "Saving a expense" |
| [BUG-003](#bug-003-the-version-on-the-settings-screen-overflows-its-card-and-widens-the-page) | Settings | Medium | Fixed | The commit id shown as the version spills out of its card and widens the page on a phone |
| [BUG-004](#bug-004-a-long-name-with-no-spaces-pushes-some-screens-and-dialogs-sideways) | Layout | Low | Fixed | A long name with no spaces widens the add-expense form, the join page and some dialog titles |
| [BUG-005](#bug-005-some-drop-downs-are-the-browsers-own-select-not-the-shadcn-select) | Design system | Low | Fixed | Month start day and the import pickers are native `<select>`s, not the shadcn Select |

Severity: **High** loses or corrupts data, or blocks sign-in; **Medium** blocks a flow, or shows
wrong on a main screen for everyone; **Low** needs unusual input (a very long name with no spaces),
or is wording or consistency.

## Open

None at the moment.

### Observation, not a bug: a budget at 99.5% to 99.99% reads "is at 100% of its budget"

The Expenses screen's budget alert rounds the percentage, so ₹999 spent of a ₹1,000 budget says "is
at 100% of its budget" while the budget is not yet over (the "over" wording starts at exactly 100%
by the unrounded figure). It is accurate to the rounding, and the Budgets screen shows "₹1 left",
so it is left as is; it is recorded here because it can look like a contradiction. Not covered by a
test on purpose (a test would pin the rounding, not a requirement).

## Fixed

### BUG-001: A CSV file with more than 500 spending rows cannot be imported in full

**Fixed:** Rows already recorded no longer count towards the 500-row limit (`import-page.tsx`), so choosing the file again shows the rest. The test no longer carries `test.fail`.

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

**Fixed:** A map from entity to its phrase with article (`ENTITY_PHRASES` in `settings-page.tsx`). The test no longer carries `test.fail`.

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

### BUG-003: The version on the Settings screen overflows its card and widens the page

**Fixed:** `min-w-0 truncate` on the version, with the whole id in a `title` (`server-status-card.tsx`). The test no longer carries `test.fail`.

- **Area:** Settings, Server card (`apps/web/src/features/status/server-status-card.tsx`, the
  `version …` line)
- **Severity:** Medium. Every deployed build reports the commit it was built from as its version
  (CI passes `--var APP_VERSION:${{ github.sha }}`), so everyone on a narrow phone sees it.
- **Test:** `e2e/layout.spec.ts`, "a full commit id is cut short with an ellipsis, inside its card,
  on any phone" (marked `test.fail`).

**What happens.** The version is a 40-character commit id such as
`456a78104d18887ca25906b94e71cdf79d103eee`: one word with nowhere to wrap. It sits in a row next to
the "Online" badge and is wider than what is left of the card:

| Screen width | Where the text ends | Where the card ends | Page width |
| --- | --- | --- | --- |
| 412 px (the tests' Pixel 7) | 402.7 px | 396.5 px | 412 px (text hangs out of the card) |
| 360 px | 403 px | 344 px | 404 px (the page scrolls sideways) |
| 320 px | 403 px | 304 px | 403 px |

On a phone the browser widens the page to fit the overflow, so the whole app looks zoomed out or can
be dragged sideways while Settings is open.

**Steps.** Sign in, open Settings on a phone narrower than about 400 px against a deployed build (or
make `/api/healthz` return that commit id as `version`, as the test does).

**Expected.** The version stays inside its card, shortened with an ellipsis when it does not fit
(`text-overflow: ellipsis`), on every screen width.

**Cause.** `<span className="text-muted-foreground text-sm">version {state.health.version}</span>`
has no `min-w-0` and no `truncate`, and its flex parent can't shrink it below the width of the word.

**Suggested fix.** `min-w-0 truncate` on the span (and `min-w-0` on its flex row); optionally show
the first 7 characters and put the whole id in a `title`.

### BUG-004: A long name with no spaces pushes some screens and dialogs sideways

**Fixed:** `min-w-0`/`truncate` on the add-expense heading and category chips, `overflow-wrap: anywhere` on dialog titles and the join page sentence. The test no longer carries `test.fail`.

- **Area:** layout, several screens
- **Severity:** Low. It needs a name with nothing to wrap at (a pasted link, a long run of
  characters). Group names go up to 60 characters, category names 40 and people's names 100.
- **Tests:** `e2e/layout.spec.ts`, four tests under "long names on a narrow phone" (each marked
  `test.fail`). A fifth, "a long name, note, category and email stay inside the screen on the main
  screens", passes and guards the screens that are fine.

**What happens.** Measured on a 360 px phone, with a 60-character group name or a 40-character
category name made of one word:

| Where | What overflows | By how much |
| --- | --- | --- |
| Add expense, in a group (`expense-form-page.tsx`) | the heading's group name line | page 332 px too wide |
| Add expense and New recurring expense (`form-fields.tsx`, `CategoryChips`) | the category chip | page 115 px too wide |
| Join page (`join-page.tsx`) | "… invited you to **name**" | page 353 px too wide |
| Invite, Delete group and Leave group dialogs | the dialog title | title ends 572 px past the dialog's edge; the page does not scroll, the text is cut off |

The Expenses list, a group's page and tabs, the groups list, Insights, Search, Budgets, Categories,
Recurring, the import preview, and Settings (long name and long email) were checked with the same
long names and are fine.

**Expected.** Long names wrap or are cut short with an ellipsis and never widen the page or leave
their box.

**Suggested fix.** `min-w-0` with `truncate` on the heading and chip labels, and `break-words`
(`overflow-wrap: anywhere`) on dialog titles and the join page's sentence. A shared class for
"a name that may be long" would keep it consistent.

### BUG-005: Some drop-downs are the browser's own `<select>`, not the shadcn Select

**Fixed:** The month start day, the import column pickers and per-row categories use `components/ui/select`; the preview tick boxes use the shadcn `Checkbox`. The test no longer carries `test.fail`.

- **Area:** design system, three places
- **Severity:** Low. They work, but look and behave unlike the rest of the app (the browser's
  picker, its own styling in dark mode and on iOS and Android).
- **Tests:** `e2e/design-system.spec.ts`, two tests (each marked `test.fail`). A third, "everywhere
  else, including every screen that has a group chooser", passes: no other screen has a native
  select, and it keeps it that way.

**Where.**

| Screen | Control | Code |
| --- | --- | --- |
| Settings, Months | "A month starts on day" | `settings-page.tsx`, `<select id="month-start">` |
| Import from CSV, Check the columns | six pickers: Date, Description, Money out, Money in, Amount, Dr / Cr | `import-page.tsx`, `<select id="map-…">` |
| Import from CSV, Preview | "Category for …", one on every row | `import-page.tsx`, `<select aria-label="Category for …">` |

Related, not a select: the preview's tick boxes are native `<input type="checkbox">`, where the
split form uses the shadcn `Checkbox`. It is not covered by a test; change it together with the
selects.

**Expected.** Every drop-down uses `components/ui/select` (as the group, category and budget
choosers already do).

**Notes for the fix.**

- The shadcn Select does not accept an empty string as an item value. "No category" (value `""`)
  and "Not in this file" (value `-1`) need a sentinel, as `ANY` and `OVERALL` already are elsewhere.
- Give each trigger the `id` its `<Label htmlFor>` points at, so labels keep working.
- Three existing tests drive these with `selectOption` and must move to click plus
  `getByRole('option')`: `e2e/planning.spec.ts` ("a month can start on another day"), and
  `e2e/import.spec.ts` ("lets a column be changed when it was guessed wrong" and "keeps a tick on
  the same transaction when the dates are read another way"). The new tests use the `chooseOption`
  helper in `e2e/helpers.ts`, which handles both kinds, so they will not need to change.
