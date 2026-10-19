---
name: e2e-spec
description: Write or fix a Playwright end-to-end spec the way this repo does: the shared helpers, fresh users, accessible locators, web-first assertions, negative and offline paths, and the counts in docs/testing.md. Use for any new or changed e2e test.
---

# An e2e spec

Specs live in `e2e/<area>.spec.ts` and run against `wrangler dev` serving the **built** app (Chromium
with the Pixel 7 profile; `ios-sync` and `live` also on WebKit). The e2e database persists between
runs, so every test makes its own people.

## Use the helpers (`e2e/helpers.ts`)

- `uniqueEmail(label)` for every person; `devSignIn(page, email, name?)` after `page.goto('/login')`.
- `newPerson(browser, email, name)` for a second device (its own cookies and local database).
- `waitForSynced(page)` before checking another device; `createGroup`, `addExpenseOn`,
  `openGroupTab`, `createInviteLink`, `joinViaLink`, `groupOfTwo` for group flows.
- `pickDate` and `clearDate` for calendars (they wait for the closing animation).
- `chooseOption`, `dropdownOptions`, `chosenOption` for drop-downs (native or shadcn).
- `runScheduledJob(page)` for recurring expenses; a test that saves a rule and does not run the job
  starts it later with `startRuleLater(page)`, or it starves the tests that do.

## Rules

- Locate by role and label (`getByRole`, `getByLabel`) or an existing `data-testid`.
- Assert with web-first `expect(...)`; never `waitForTimeout`.
- **Do not navigate right after a click that writes**: wait for what the write shows (the saved row,
  a toast, the dialog closing) first.
- Cover the refusals: invalid input, an expired session, someone not allowed in, offline
  (`context.setOffline(true)`), a reload.
- A test that finds a real bug: the `report-bug` skill, then `test.fail(true, 'Bug #n: …')`.
- Run it: `npm run build`, then `npx playwright test e2e/<file>.spec.ts`.
- Update the counts and the list of what is covered in `docs/testing.md`.
