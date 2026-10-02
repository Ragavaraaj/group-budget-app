[← Plan overview](PLAN.md)

# Roadmap

**v1 = M0 + M1 + M2.** Each milestone ends in something usable.

| #      | Milestone                      | Scope                                                                                                                                                                                                                                                                                                   | Status                                                                                                                                         |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** | Foundations                    | Workspace, tooling, CI; Hono Worker with `/api/healthz`; Drizzle + D1 with the first migration; React shell with shadcn and an installable PWA; one-origin dev and e2e setup; automatic Cloudflare deploy on merge                                                                                       | **Done**, merged to `main`. The deploy job skips (green) until Cloudflare secrets and a real `database_id` exist; the database id is now set                                         |
| **M1a**| Personal ledger, offline-first | Dexie schema; expenses + categories CRUD; outbox + pull sync (polling) with `db.batch` writes and `server_seq`; indexes + a `rows_read` test; **dev-login**; JSON/CSV export; first deploy to `workers.dev`; **Time Travel restore drill**                                                              | **Built and verified locally.** Offline add → offline reload → reconnect → second device works in real Chromium. **Not yet done:** the first real deploy, a trial on a real phone, the restore drill |
| **M1b**| Google sign-in                 | Google sign-in + sessions + sign-up gate; **attempt-login for installed apps ([Auth](auth.md)), built and e2e-tested with two browser contexts**; per-user local DB; logout flow; not-installed banner; invite-link join; real-iPhone confirmation run on Chrome's "Add to Home Screen" at the `workers.dev` address | **Built and verified locally** against Google's token endpoint mocked in tests and a stand-in that runs the same callback code. **Not yet done:** the Google OAuth client, a real sign-in, the real-iPhone run |
| **M2** | Groups                         | Group create/rename, invites, memberships, split types (equal, exact, percent, shares; several payers), balances, settle-up, activity feed                                                                                                                                                               | **Built and verified locally**: two people run a trip and the balances match a hand calculation (e2e and unit tests). **Not yet done:** a real trip with real people                              |
| **M3** | Insights                       | Monthly/category/trend reports (shadcn charts), budgets + alerts, search/filter, CSV import, recurring expenses (Worker Cron Trigger); configurable month start (calendar month or salary-cycle day) and a yearly view by Indian financial year (Apr–Mar)                                                 | Not started. Month-end review is the exit criterion                                                                                            |
| **M4** | Extras (pick as needed)        | Live updates over a Durable Object WebSocket hub; scheduled `d1 export` to R2; Web Push; bank-statement CSV import presets; UPI deep link on settle-up (`upi://pay?…`; verify it works across apps first); placeholder (non-user) group members; in-app admin for the allowlist; custom domain move; group ownership transfer, group delete, invite revocation | Not started                                                                                                                                    |

## Where things stand

**M0–M2 are built** on branch `google-sso-ledger-groups`. Everything below was run, not just written:

- the TS-only guard, Biome, strict typecheck across all workspaces;
- **84 shared, 122 server (inside `workerd`) and 113 web unit tests**, including property tests for splits, balances and settle-up, the whole Google flow with Google's token endpoint mocked, the sync protocol (idempotent and concurrent pushes, delete-vs-edit, authorization, paging, backfill, removal), the sync engine against a scripted server, and D1 `rows_read` assertions;
- **21 end-to-end tests in real Chromium** against `wrangler dev` serving the built app: offline add → offline reload → reconnect → second device, two people running a trip (balances match a hand calculation), exact/percent/shares splits, invite → join → remove, attempt-login with two browser contexts, a session ending with changes queued, security headers with zero CSP violations;
- the Worker bundle builds (about 1.1 MB, 195 KB gzipped, with `arctic` in it) and the PWA still installs and reloads offline.

Building it found and fixed real bugs that unit tests alone had missed: the sign-in confirmation form was refused because the API's `no-referrer` policy made browsers send `Origin: null` (fixed by aligning the API's `Referrer-Policy` with the static files); the installed app's watcher for its own sign-in did not start when sign-in began; a sync loop that could re-send forever if a server answered nothing; the login screen offered no sign-in after a session expired.

**Not yet verified** (none of it is reachable from the build sandbox):

- **Real Google sign-in**: the token exchange is mocked; `arctic` bundles and runs under `workerd`, but a round trip with Google needs the OAuth client.
- **A real deploy**: the deploy job has not run against a real account. Merging the branch to `main` will apply migrations 0001–0002 to the real D1 and deploy; until Google credentials exist as Worker secrets, nobody can sign in (dev login is off in production by design).
- **Real iPhones and Safari/WebKit**: only Chromium is tested. Attempt-login is proven on desktop with two contexts; the hand-back on a real iPhone installed from Chrome is the M1b confirmation run.
- **Cloudflare behaviour at scale**: `rows_read` is asserted on the local D1; the free-plan 50-queries-per-invocation limit is respected by design (10 mutations per push) but not measured on Cloudflare; Time Travel restore has not been practised.
- **Rate limiting** at Cloudflare is not configured.

**Known limits of v1** (deliberate, small to add later): the owner cannot leave a group or hand it over, and a group cannot be deleted; invites expire but cannot be revoked from the app; a person's new Google name or photo reaches group-mates at their next sign-in; expenses cannot be moved between groups; dates cannot be in the future; no search or filters (M3); the list is per month rather than virtualised; only Chromium has been driven by tests.

M0 notes: `ui.shadcn.com` was unreachable from the build sandbox, so the shadcn sources were copied from the shadcn-ui GitHub repo (the same files the CLI installs, with the CLI's `cn` import rewritten and `next-themes` removed from sonner); `components.json` is configured, so `npx shadcn add` works normally elsewhere.

Out of scope (decided): multi-currency/FX, receipt photos or any attachments, passwords/passkeys. Parked: RSC ([Risks](risks.md#parked-react-server-components)).

## Decisions and open questions

**Decided**: see [Plan overview](PLAN.md#goals-and-constraints).

**Defaults I chose — say so if you want any changed**

- Sign-up gate = `ALLOWED_EMAILS` setting **or** a valid group invite token ([Auth](auth.md)).
- Any group member can edit any expense, payment or category; everything is audit-logged and each row shows who changed it last ([Data model](data-model.md)). Only the owner renames, invites and removes.
- Logout needs a connection and wipes the local database for that user after warning about unsynced changes ([Sync protocol](sync.md)).
- Clients poll for changes (~30 s while visible, backing off to 5 minutes) instead of holding a live connection; a Durable Object WebSocket hub is the M4 upgrade ([Sync protocol](sync.md)).
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

**Still open — yours to do**

1. **Google Cloud OAuth client** ([Auth](auth.md) lists the steps) and the three Worker secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS`). Without them nobody can sign in on the deployed app. After merging, this unlocks the first real sign-in and the real-iPhone run.
2. **Cloudflare rate-limiting rules** for `/api/auth/*` and `/api/invites/preview` (dashboard configuration).
3. **Domain name** — before real users install the app, not before. Decide whether to register it through Cloudflare.
4. **A trial with real people and real phones** (an iPhone installed from Chrome, an Android phone, a friend joining through an invite link), and a **Time Travel restore drill** on the deployed database.
