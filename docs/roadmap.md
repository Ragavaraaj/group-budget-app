[← Plan overview](PLAN.md)

# Roadmap

**v1 = M0 + M1 + M2.** Each milestone ends in something usable. M3 and most of M4 are built too.

| #      | Milestone                      | Scope                                                                                                                                                                                                                                                                                                   | Status                                                                                                                                         |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** | Foundations                    | Workspace, tooling, CI; Hono Worker with `/api/healthz`; Drizzle + D1 with the first migration; React shell with shadcn and an installable PWA; one-origin dev and e2e setup; automatic Cloudflare deploy on merge                                                                                       | **Done**, merged to `main`, and the deploy job has run against the real account                                                                  |
| **M1a**| Personal ledger, offline-first | Dexie schema; expenses + categories CRUD; outbox + pull sync (polling) with `db.batch` writes and `server_seq`; indexes + a `rows_read` test; **dev-login**; JSON/CSV export; first deploy to `workers.dev`; **Time Travel restore drill**                                                              | **Built and deployed.** Offline add → offline reload → reconnect → second device works in real Chromium. **Not yet done:** a trial on a real phone, the restore drill |
| **M1b**| Google sign-in                 | Google sign-in + sessions + sign-up gate; **attempt-login for installed apps ([Auth](auth.md)), built and e2e-tested with two browser contexts**; per-user local DB; logout flow; not-installed banner; invite-link join; real-iPhone confirmation run on Chrome's "Add to Home Screen" at the `workers.dev` address | **Built and deployed**; the first real sign-in (Google OAuth client) is being set up. **Not yet done:** a completed real sign-in, the real-iPhone run |
| **M2** | Groups                         | Group create/rename, invites, memberships, split types (equal, exact, percent, shares; several payers), balances, settle-up, activity feed                                                                                                                                                               | **Built and verified locally**: two people run a trip and the balances match a hand calculation (e2e and unit tests). **Not yet done:** a real trip with real people                              |
| **M3** | Insights                       | Monthly/category/trend reports, budgets + alerts, search/filter, CSV import, recurring expenses (Worker Cron Trigger); configurable month start and a yearly view by Indian financial year (Apr–Mar)                                                                                                     | **Built and verified locally** (unit, `workerd` and real-browser tests; the scheduled job also run through `wrangler dev`). **Not yet done:** a month-end review on real data, the job on real Cloudflare |
| **M4** | Extras (pick as needed)        | Live updates over a Durable Object WebSocket hub; nightly `d1 export` to R2; per-link invite revocation, ownership transfer and group delete; placeholder (non-user) members; bank-statement CSV import presets. Left out on purpose: Web Push, the UPI deep link, an in-app allow-list admin, the custom-domain move | **Mostly built and verified locally**; see below for what was left out and why. The Durable Object and the R2 workflow have not met a real Cloudflare account yet |

## Where things stand

**M0–M4 (the selected parts) are built** on branch `insights-budgets-recurring-live`, on top of M0–M2 that are merged to `main` and deployed. Everything below was run, not just written:

- the TS-only guard, Biome, strict typecheck across all workspaces;
- **147 shared, 220 server (inside `workerd`) and 272 web unit tests**, including property tests for splits, balances, settle-up, reporting periods and recurring dates, the whole Google flow with Google's token endpoint mocked, the sync protocol (idempotent and concurrent pushes, delete-vs-edit, authorization, paging, backfill, removal), the guarded join, group delete, ownership hand-over, the recurring job (idempotent, capped at 10 occurrences per run, counted against D1's 50-queries-per-invocation limit), **real WebSockets through the Durable Object hub**, the sync engine against a scripted server, the live channel with a fake socket and fake timers, the CSV and bank-statement reading, and D1 `rows_read` assertions;
- **50 end-to-end tests in real Chromium** against `wrangler dev` serving the built app: offline add → offline reload → reconnect → second device, two people running a trip, every split type, invite → join → remove → refused → added back, stopping one link, handing a group over, deleting a group for everyone, a person without the app in the balances, attempt-login with two browser contexts, insights (month and financial year), search, budgets warning and going over, recurring expenses made by the scheduled job exactly once and seen on a second device, a bank statement imported with duplicates flagged and ticks kept on the right transaction when the dates are read another way, a recurring expense that starts in the past, the month start day, **changes and removals reaching another device within seconds with no reload**, and security headers with zero CSP violations across every screen, the live WebSocket included;
- the Worker bundle builds and the PWA still installs and reloads offline. The Insights screen is its own small chunk (about 9 KB) because the charts are drawn by hand.

**Not yet verified** (none of it is reachable from the build sandbox):

- **Real Google sign-in**: the token exchange is mocked; `arctic` bundles and runs under `workerd`, but a round trip with Google needs the OAuth client (its redirect URI must be `https://group-budget.<subdomain>.workers.dev/api/auth/google/callback`).
- **The Durable Object on a real account**: the first deploy that carries it also applies its migration. It was verified in `workerd` (tests) and in `wrangler dev` (e2e), not on Cloudflare. SQLite-backed Durable Objects are on the free plan; if a deploy is refused, that is where to look.
- **The scheduled job on real Cloudflare** (it runs hourly there; here it was triggered by hand), and the **R2 backup workflow** (never run; it skips itself until a bucket and its repository variable exist).
- **WebSockets under the CSP in Safari/WebKit**: `connect-src 'self'` allows same-origin WebSockets in current Chromium; WebKit's behaviour should match on current iOS but was not run. If a socket cannot open, the app simply keeps polling as before.
- **Bank statement layouts**: the column names for HDFC, ICICI, SBI, Axis and Kotak were written from how those statements are commonly laid out, and tested on synthetic files in those shapes, not on real statements. The preview before importing is the safeguard.
- **Real iPhones and Safari/WebKit**: only Chromium is tested.
- **Cloudflare behaviour at scale**: `rows_read` and the statement counts are asserted on the local D1; Time Travel restore has not been practised.
- **Rate limiting** at Cloudflare is not configured.

**What was left out of M4, and why**

- **Web Push**: it needs a custom service worker (the app uses a generated one), VAPID keys, subscription storage and encrypted delivery from the Worker, and it cannot be checked here against Apple's push service. Worth doing after the real-iPhone trial shows whether people want it. Budget warnings work without it, on the device, while the app is open.
- **UPI deep link on settle-up** (`upi://pay?…`): the plan said to verify it across apps first, and it can't be verified here; the group uses iPhones, where the generic `upi://` link is the least certain.
- **In-app allow-list admin**: group invite links already let people in without touching the server, so the allow-list only has to hold the first few people.
- **Custom domain**: yours to buy and attach ([Infrastructure](infrastructure.md)).

**Known limits** (deliberate, small to add later): a placeholder member can't be merged into a real person who joins later (their past stays under the placeholder's name); a deleted group is gone for good unless D1 Time Travel is used; the month start day is a setting on each device, not synced; budgets count a group's whole spending, with one limit per category or one overall, each month; a recurring rule waits while its creator, or anyone in its split, is out of the group (the list says so, and editing it takes it over); invite links last 7 days and 20 uses; expenses cannot be moved between groups; dates cannot be in the future; the list is per month rather than virtualised; only Chromium has been driven by tests.

M0 notes: `ui.shadcn.com` was unreachable from the build sandbox, so the shadcn sources were copied from the shadcn-ui GitHub repo (the same files the CLI installs, with the CLI's `cn` import rewritten and `next-themes` removed from sonner); `components.json` is configured, so `npx shadcn add` works normally elsewhere.

Out of scope (decided): multi-currency/FX, receipt photos or any attachments, passwords/passkeys. Parked: RSC ([Risks](risks.md#parked-react-server-components)).

## Decisions and open questions

**Decided**: see [Plan overview](PLAN.md#goals-and-constraints).

**Defaults I chose — say so if you want any changed**

- Sign-up gate = `ALLOWED_EMAILS` setting **or** a valid group invite token ([Auth](auth.md)). The list holds exact email addresses, not domains.
- Any group member can edit any expense, payment, category, budget or recurring rule; everything is audit-logged and each row shows who changed it last ([Data model](data-model.md)). Only the owner renames, invites, removes, hands the group over, deletes it and adds people without the app.
- Logout needs a connection and wipes the local database for that user after warning about unsynced changes ([Sync protocol](sync.md)).
- Clients poll for changes (~30 s while visible, backing off to 5 minutes) and, while the live connection is up, only at the slowest interval ([Sync protocol](sync.md)).
- Sessions are extended only when less than half their life remains, to save D1 writes ([Auth](auth.md)).
- D1 is created with the `apac` location hint ([Infrastructure](infrastructure.md)).
- Start on the free Cloudflare plan; move to the $5 plan only if a limit is hit ([Infrastructure](infrastructure.md)).

**Decisions made while building M1/M2** (each is easy to revisit)

- **An expense's payers and shares are JSON on the expense row**, not child tables: one atomic row write, about a third of the D1 row writes, and nothing needs to query by payer in SQL ([Data model](data-model.md)).
- **The activity feed is derived from the synced rows** (`updated_by`, `version`, tombstone), so no separate log has to sync; `audit_log` stays a diagnostic and recovery tool.
- **Groups and memberships are synced rows** with `server_seq`, written only by the server; a person's own removal always reaches their devices; **joining a group later queues a one-group backfill**, because its history is older than the joiner's cursor ([Sync protocol](sync.md)).
- **The OAuth state and PKCE verifier live in D1**, with a cookie only as proof of "same browser", so the callback works wherever iOS finishes sign-in ([Auth](auth.md)).
- **The installed app keeps its attempt secret and the last signed-in person in `localStorage`**, not IndexedDB (simpler, same per-installed-app scope on iOS).
- **No react-hook-form**: plain state plus the shared zod schemas and the pure split logic ([Frontend](frontend.md)).
- **At most 10 mutations per push**, sized for the free plan's 50 D1 queries per invocation.
- **Worker secrets, not plain variables**, for Google credentials and the allow-list, because a deploy overwrites dashboard variables ([Infrastructure](infrastructure.md)).

**Decisions made while building M3/M4** (each is easy to revisit)

- **Charts are drawn by hand in SVG**, not with Recharts/shadcn charts: the figures need only bars, so it adds no dependency or bundle weight, needs no inline styles (the CSP forbids them), and each chart describes itself to a screen reader ([Frontend](frontend.md)).
- **Reports count your own share** (`shares[me]`), so a ₹900 dinner split three ways is ₹300 of your spending whoever paid; a shared group can also be shown as the whole group's spending. Budgets always count the whole group.
- **A period is named by the month it starts in**, so with a start day of 1 everything is the calendar month it always was, and the financial year (April to March) is twelve consecutive periods ([Frontend](frontend.md)).
- **Budgets and recurring rules are synced entities** like categories and expenses, so they work offline and appear on every device. Two budgets for one category (made offline on two devices) are resolved by taking the newest.
- **Recurring expenses are made by the server**, hourly, not by the device, so they appear even if nobody opens the app. The expense id is derived from the rule and the date, so a repeated run can never duplicate; a new or resumed rule never goes back more than three months; a paused rule that is switched on again starts from today ([Sync protocol](sync.md)).
- **One Durable Object serves every connection**, with hibernation, and carries no data: a "changed" message makes the device pull. A device's own pushes don't wake it. Polling stays underneath as the fallback ([Sync protocol](sync.md)).
- **Deleting a group erases its records** (and removes every member) in one batch, so devices drop it through the normal removal path; the group's own row and the removed memberships stay, since that is how devices learn of it.
- **A person without the app is a real `users` row with an identity no sign-in can match**, so splits and balances need no special case.

**Still open — yours to do**

1. **Google Cloud OAuth client** ([Auth](auth.md) lists the steps; the redirect URI is `https://group-budget.<subdomain>.workers.dev/api/auth/google/callback`) and the three Worker secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS`, as exact email addresses). Without them nobody can sign in on the deployed app.
2. **Cloudflare rate-limiting rules** for `/api/auth/*` and `/api/invites/preview` (dashboard configuration).
3. **Backups to R2** (optional but recommended before real users): create a private bucket, add `Workers R2 Storage: Edit` to the API token, set the repository variable `BACKUP_R2_BUCKET`, and add an R2 lifecycle rule to expire old dumps ([README](../README.md#backups-to-r2)).
4. **Domain name** — before real users install the app, not before.
5. **A trial with real people and real phones** (an iPhone installed from Chrome, an Android phone, a friend joining through an invite link), a **Time Travel restore drill**, and a month-end look at Insights on real data.
