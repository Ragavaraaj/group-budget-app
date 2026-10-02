# Group Budget App — Architecture & Plan

Status: **draft v4** · Scope: architecture and roadmap. M0 is built; M1 is next (§12).

**What changed in v4:** hosting moved from a single VPS (Node, SQLite, Caddy, Litestream, Docker) to **Cloudflare** (one Worker serving the API and the web app, with D1 as the database). The M0 code was ported accordingly. That affects the data-write pattern (D1 has no interactive transactions), live updates (polling instead of SSE), backups, security headers, the dev/test setup, cost and the roadmap. Details are in the sections below.

## 1. Goals and constraints

|              |                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Product**  | Track all expenses: personal spending, plus shared groups with splits, balances and settle-up.                                                     |
| **Cost**     | No hardware and no servers to run. Cloudflare's free tier should cover this at about $0/month (limits in §9); a domain, later, is the only likely cost. |
| **Frontend** | Simple React PWA: installable, **usable offline** (entering an expense at the till must never fail).                                               |
| **Backend**  | Hono on Cloudflare Workers, Drizzle on D1 (SQLite).                                                                                                |

**Confirmed decisions**

- **Hosting: Cloudflare** — Workers (API) + static assets (the PWA) + D1 (database). Everything runs on Cloudflare's infrastructure.
- **v1 = personal + groups** (M0–M2), offline-first.
- **INR only**, integer **paise**. No multi-currency, no FX.
- **No receipt photos** or any attachments.
- **Stack**: React PWA with **shadcn/ui** + Tailwind; **Hono + Drizzle on Workers + D1**.
- **Auth**: **Google sign-in only** (no passwords, no passkeys in v1).
- **Repo**: **npm workspaces monorepo** — `apps/web`, `apps/server`, `packages/shared`.
- **Lint/format**: **Biome** (one tool for lint, format and import order) instead of ESLint + Prettier.
- **Runtime for tooling**: **Node 26** (npm 11), pinned in `.nvmrc` and `engines`; the Worker itself runs on Cloudflare's runtime, not Node.
- **TypeScript everywhere**: all source _and_ config files are `.ts`/`.tsx` (`vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, …). `wrangler.jsonc`, `biome.json` and `tsconfig*.json` are the only non-code config. CI runs `npm run check:ts-only`, which fails if any `.js/.jsx/.mjs/.cjs` file is tracked.
- **Scale**: 50–100 users maximum.
- **iPhones are in use** in the group, and the app is **installed from Chrome** ("Add to Home Screen"; no Safari). All iOS browsers use WebKit, so installed-iOS sign-in is a first-class requirement, solved by attempt-login (§7).
- **Domain**: later. Development and the iPhone confirmation run use the free `*.workers.dev` HTTPS address; buy a domain **before real users install the app** (§9).
- **Google Cloud OAuth client**: you will create it later (§7 has the steps). M1 is split so work isn't blocked on it (§12).
- **RSC**: parked (§15). Nothing in v1 depends on it.

## 2. Decisions at a glance

| Area       | Choice                                                                                                  | Why                                                                                                         | Escape hatch                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Hosting    | **Cloudflare Workers** + static assets; one Worker serves `/api/*` and the built PWA                    | Nothing to patch or restart; global edge; free tier fits; same-origin, so no CORS and cookies just work     | Hono and Drizzle are portable, so a Node host would need only a thin entry point |
| Server     | **Hono** + TypeScript, exported as the Worker's fetch handler                                           | Built for Workers, tiny, typed, easy to test (`app.request()`)                                              | —                                                                                |
| Database   | **D1** (SQLite) via **Drizzle** (`drizzle-orm/d1`); migrations are SQL files applied by Wrangler        | Managed SQLite, nothing to run, plenty for 50–100 users                                                     | Postgres via Drizzle, contained in `apps/server/src/db` and each module's repo   |
| Backups    | **D1 Time Travel** (point-in-time restore: 7 days on the free plan, 30 on paid, no extra cost)          | Built in and always on; replaces Litestream                                                                 | Scheduled `d1 export` to R2 for an off-platform copy (M4)                        |
| Client     | React 19 + TypeScript + **Vite**, React Router                                                          | Standard, small, fast                                                                                       | —                                                                                |
| UI         | **shadcn/ui** (Radix + Tailwind v4), `sonner` toasts, `vaul` drawer, react-hook-form + zod              | Accessible components copied into the repo (we own them); consistent look; mobile-friendly sheets           | —                                                                                |
| Local data | **Dexie** (IndexedDB) with live queries                                                                 | Offline source of truth for the UI                                                                          | SQLite-WASM + OPFS                                                               |
| Sync       | Custom **outbox + cursor pull**; clients **poll** (focus, online, and ~30 s while visible)              | Expense data is append-mostly; polling needs no persistent connections and is cheap at this scale           | Durable Object + WebSocket hub for live updates (M4); Replicache/PowerSync       |
| Writes     | Validate and read first, then one atomic **`db.batch([...])`**                                          | D1 has **no interactive transactions**; batch is its atomic primitive (§4, §5)                              | Durable Objects with SQLite if logic ever needs real transactions                |
| Auth       | **Google sign-in** (OAuth 2.0 authorization-code + PKCE, server-side) via `arctic`; own cookie sessions | No passwords to store, no email provider, no recovery flow; `arctic` uses only `fetch` and Web Crypto      | Add passkeys later                                                               |
| Currency   | **INR only**, integer paise, `Intl.NumberFormat('en-IN')` (lakh/crore grouping)                         | Removes FX and mixed-currency reports entirely                                                              | Add a `currency` column (default `'INR'`) via a normal migration                 |
| Validation | **zod** schemas in `packages/shared`, used by web and server                                            | One definition of every API payload                                                                         | —                                                                                |
| Tooling    | npm workspaces, **Wrangler**, Vitest 4 + Workers test pool, Playwright, **Biome**                       | Tests run in the real Workers runtime (`workerd`), so they catch what only works in Node                    | pnpm if workspaces get painful                                                   |
| CI/CD      | GitHub Actions: checks on every push; manual deploy workflow (`wrangler deploy`)                        | Free, simple                                                                                                | Cloudflare's own Git integration (Workers Builds)                                |

## 3. Architecture and data flow

The UI reads and writes only the **local IndexedDB**. A sync engine reconciles with the server in the background, so everything works offline. The server is the authority for identity, authorization and group membership.

```
        ┌──────────────── Browser (installed PWA) ───────────────────┐
        │  React shell (precached by service worker)                 │
        │  UI ⇄ Dexie (IndexedDB)  ← source of truth for the UI      │
        │        │ outbox                                            │
        │        ▼                                                   │
        │  sync engine ──── fetch /api/* (same-origin, cookie) ──┐   │
        └────────────────────────────────────────────────────────┼───┘
                                      │  ▲ Google sign-in redirect │
                         HTTPS (Cloudflare edge)                   │
        ┌────────────── One Cloudflare Worker ───▼───────────────▼───┐
        │ Static assets (apps/web/dist): the PWA, SPA fallback,       │
        │   headers from public/_headers                              │
        │ /api/* → Hono (Worker code runs only for these paths)       │
        │   /api/auth/google/start|callback  /api/auth/logout  /me    │
        │   /api/sync/push|pull   (JSON + zod)                        │
        │   /api/groups/*  /api/invites/*     (online-only actions)   │
        │            │  modules/*/repo (Drizzle)                      │
        │            ▼                                                │
        │       D1 (SQLite) ── Time Travel backups                    │
        └─────────────────────────────────────────────────────────────┘
```

**Rules that keep the code clean**

1. Reads of business data in the UI come from Dexie. Writes go to Dexie + outbox, then sync. Only auth, group management and invites call the API directly (they need the server's say-so, so they are online-only).
2. Server code touches the database only through each module's `repo`, never from route handlers directly.
3. Pure logic (money, splits, balances, settle-up, zod schemas) lives in `packages/shared` with no I/O, so it runs identically in the browser, the Worker and tests.
4. **Same-origin everywhere**: in production one Worker serves the API and the static files; in development Vite proxies `/api/*` to `wrangler dev`. No CORS, and cookies just work.
5. **D1 has no interactive transactions** (no `BEGIN`/`COMMIT` from the Worker). Do reads and validation first, then write everything in a single `db.batch([...])`, which commits or rolls back as a whole. This is verified by a test (`apps/server/src/db/schema.test.ts`: a failing statement rolls back the other statements in its batch).
6. **Every per-request query must use an index.** D1 limits are counted in rows _scanned_, not rows returned, so an unindexed filter on a growing table is both slow and a quota problem (§9).
7. **Config comes from Worker bindings**, parsed once with zod (`apps/server/src/config.ts`). `ENVIRONMENT` defaults to `production`, so a deployed Worker is safe unless something explicitly says otherwise (only `.dev.vars` and the test config do).

## 4. Data model (server, D1 via Drizzle)

IDs are **UUIDv7** generated on the device (sortable; makes offline creates idempotent).

```
users            id, google_sub (unique), email, display_name, avatar_url, created_at, last_login_at
sessions         id_hash, user_id, expires_at, user_agent, created_at
login_attempts   id_hash, user_id (null until bound), expires_at, consumed_at   -- installed-app sign-in (§7)
groups           id, name, is_personal, created_by
memberships      group_id, user_id, role (owner|member), joined_at
invites          id, token_hash, group_id, created_by, expires_at, max_uses, used_count
categories       id, group_id, name, icon, color, archived                     (+ sync cols)
expenses         id, group_id, occurred_on (local date), amount_minor,
                 category_id, note, created_by                                 (+ sync cols)
expense_payers   expense_id, user_id, amount_minor     -- who paid (can be several)
expense_shares   expense_id, user_id, amount_minor     -- who owes what
settlements      id, group_id, from_user, to_user, amount_minor, occurred_on   (+ sync cols)
budgets          id, group_id, category_id?, period, amount_minor              -- M3
recurring_rules  id, group_id, template, rrule, next_run_on                    -- M3
processed_mutations  mutation_id (primary key), user_id, applied_at            -- idempotency
audit_log        id, mutation_id, user_id, entity, entity_id, before, after, at -- append-only
sync_counter     id (=1), value                                                -- see below

(+ sync cols) = version, updated_at, deleted_at (tombstone), server_seq
```

Rules:

- **Money is integer paise** (`amount_minor` = paise; ₹1 = 100). No floats anywhere. The currency is a single constant in `packages/shared`, not a column. Display with `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.
- **Dates**: `occurred_on` is a plain `YYYY-MM-DD` _local_ date (the day the user means), never a UTC instant, so an expense entered at 00:30 IST never lands on the wrong day. `updated_at` and sync metadata are UTC.
- **`server_seq`** (strictly increasing change number, used as the pull cursor). SQLite has no sequences, and D1 batches can't feed one statement's result into the next from JavaScript, so it is done in SQL inside the batch: before each row write the batch runs `UPDATE sync_counter SET value = value + 1 WHERE id = 1`, and the row is written with `(SELECT value FROM sync_counter WHERE id = 1)` as its `server_seq`. D1 executes a batch atomically and serialises writes, so the sequence is strictly increasing and gap-tolerant.
- **Indexes are part of the design** (rule 6 in §3): every synced table gets an index on `(group_id, server_seq)` (the pull query), `memberships` on `user_id`, `sessions` on `user_id` (already in the first migration), and `expenses` on `(group_id, occurred_on)` for the month views.
- **Splits**: equal / exact / percent / shares. Remainder paise are distributed with the largest-remainder method so `sum(shares) == total` always holds (property-tested).
- **Balances are derived, never stored**: `net(user) = Σ paid − Σ owed ± settlements`.
- **Settle-up** uses greedy debt simplification (min-cash-flow) to minimise the number of transfers.
- **Personal ledger** = a group with `is_personal = true` and a single member, created on first sign-in. One code path for personal and shared.
- Never hard-delete synced rows; tombstone them.
- **Drizzle workflow**: schema in `apps/server/src/db/schema/*.ts`, one file per domain; `npm run db:generate` produces SQL migrations committed to `apps/server/drizzle/`; **Wrangler applies them** (`wrangler d1 migrations apply`: locally on `npm run dev`, remotely on deploy). The Worker does not migrate at startup. Migrations are additive and forward-only.

**Group permissions (default, easy to tighten)**: any member can add, edit or delete any expense in the group, as in most shared-expense apps among friends and family; every change is recorded in `audit_log` with who and when. Only the owner can rename the group, remove members and create invites.

## 5. Sync protocol

Why custom: expenses are append-mostly, edits are rare and rarely concurrent, so last-writer-wins at row level is acceptable and a CRDT is overkill.

**Client**

- Local writes go to Dexie _and_ an `outbox` table `{mutationId, type, payload, baseVersion, createdAt}` in one transaction, so the UI updates instantly.
- Flush triggers: app start, `online` event, `visibilitychange → visible`, after each local write, and Background Sync where supported (Chromium only; iOS Safari lacks it, so foreground triggers are the primary mechanism).
- **Pull by polling**: on the same triggers, plus about every 30 s while the app is visible and online, backing off to a few minutes when nothing has changed and stopping while hidden. A poll with no news is one indexed query and a tiny response.
- **Local DB is scoped per user** (database name includes the user id), so two accounts on one device never mix.
- **Logout** warns if the outbox is non-empty (unsynced changes would be lost), then wipes that user's local database.

**Server**

- `POST /api/sync/push` — array of mutations. Flow: **(1) read** the caller's memberships and any existing rows, **(2) validate and authorize** each mutation, **(3) write everything in one `db.batch`**: row upserts (last-writer-wins, `ON CONFLICT … DO UPDATE … WHERE` the incoming change is newer), the `server_seq` bumps (§4), `audit_log` rows, and one `processed_mutations` insert per mutation. Because `mutation_id` is a primary key, replaying an already-applied mutation violates it and rolls the whole batch back; the handler then reports those mutations as already applied. Per-mutation result: `applied | rejected(reason)`. A member removed between steps (1) and (3) could land one write; that window is tiny and every write is audit-logged, so it's accepted.
- `GET /api/sync/pull?since=<server_seq>&limit=N` — rows from the caller's groups with `server_seq > since`, including tombstones; paginated; returns the new cursor. A newly joined member pulls the group's full history through this same path.

**Conflicts**

- Row-level LWW by server arrival order. Delete wins over a concurrent edit.
- If `baseVersion` is stale the server still applies LWW but flags it; the UI shows a small "edited by X while you were offline" notice.

**Session expiry while offline**: sessions are long-lived (30 days, sliding). If one expires, the app still opens and works from Dexie; the outbox simply waits. Signing in again flushes it.

**Safety nets**

- An append-only `audit_log` (mutation id, user, entity, before/after JSON, timestamp) is written in the same batch as every applied mutation. `server_seq` alone only gives the _latest_ state of each row, so without this a bad merge or a bug can't be diagnosed or undone.
- D1 Time Travel can restore the whole database to any minute within its retention window (§9).
- "Export everything as JSON/CSV" is available from day one.
- Integration tests simulate two offline clients with interleaved edits, replays and tombstones (§10).

## 6. Frontend

- **Shell and routing**: React Router; the whole shell is precached by the service worker. Mobile-first with a bottom tab bar; add/edit expense is a _route_ (not a modal) so the Android back button behaves.
- **State**: Dexie live queries are the source of truth. Local React state for UI only. No Redux. A tiny typed `fetch` wrapper for the online-only calls (auth, groups, invites).
- **UI kit**: **shadcn/ui** components live in `apps/web/src/components/ui` (copied from the shadcn repo, then ours to edit), configured through `components.json` and an `@/` path alias. Tailwind v4 with dark mode following the OS. Added on demand as screens need them (button, input, label, form, select, tabs, card, drawer, dialog, dropdown-menu, sonner, avatar, badge, skeleton, calendar/popover for dates, chart for M3). Forms use react-hook-form with the shared zod schemas.
- **Charts (M3)**: shadcn's chart component (Recharts), loaded lazily with the Insights route so it doesn't weigh down the first load.
- **UX priorities** (this is what makes expense apps stick): amount-first entry in ≤3 taps; defaults from last-used category/payer/group; always-visible sync status; undo on delete (sonner toast with an Undo action); fast list with virtualization once it exceeds a few thousand rows.

**PWA specifics**

- `vite-plugin-pwa`, starting in `generateSW` mode (precache + navigation fallback), switching to `injectManifest` only when the sync engine needs a custom service worker.
- Caching: precache shell + assets; `/api/*` is never cached by the service worker (the sync engine owns it) and the Worker sends `Cache-Control: no-store` on API responses.
- Static-asset headers live in `apps/web/public/_headers` (Cloudflare applies them): hashed `/assets/*` are `immutable`; everything else keeps Cloudflare's default of revalidating, which is what lets installed PWAs pick up new versions.
- Update flow: "New version available — reload" prompt; never auto-reload mid-entry.
- Manifest: `standalone`, 192/512/maskable icons, `apple-touch-icon`, app shortcut "Add expense".
- Call `navigator.storage.persist()`. Safari can evict IndexedDB for non-installed sites; the server remains the source of truth, so eviction is recoverable by re-pulling, but un-synced outbox items would be lost, which is why flush-on-foreground matters.
- iOS caveats: push works only for installed PWAs (16.4+); no Background Sync; sign-in uses attempt-login in standalone mode (§7); install from Chrome via Add to Home Screen, since non-installed use loses the service worker and risks storage eviction.

## 7. Auth: Google sign-in

**Flow** (server-side authorization code + PKCE, using `arctic`, which needs only `fetch` and Web Crypto and so should run on Workers as is — to be confirmed in the M1 spike; no third-party JavaScript in the page, so the CSP can stay strict):

1. `Continue with Google` → full-page navigation to `GET /api/auth/google/start` (optionally carrying an invite token).
2. Worker creates `state` + PKCE verifier, stores them in a short-lived HttpOnly cookie, redirects to Google with scopes `openid email profile`.
3. Google → `GET /api/auth/google/callback?code&state`. Worker checks `state`, exchanges the code, reads the ID token, **requires `email_verified`**, and applies the **sign-up gate** below.
4. Upsert the user by Google `sub` (never by email; emails can change), create the personal group on first sign-in, create a session, set the cookie, redirect to `/`.

**Sessions**: random 256-bit token; only its SHA-256 hash is stored in D1; `HttpOnly; Secure; SameSite=Lax`; 30-day sliding expiry; logout revokes. To stay inside D1's write quota, expiry is only **extended when less than half of it remains**, not on every request. Cookie name/flags differ slightly in dev (`http://localhost`).

**Sign-up gate** (default; the app is not open to the world): a Google account may _create_ an account only if its email is in the `ALLOWED_EMAILS` setting (you, to bootstrap) **or** it arrives with a valid, unexpired group **invite token**. Existing users always sign in. This means a friend you invite to a group can join without you touching the server.

**What you need to set up in Google Cloud Console** (needed to start M1b; localhost works for development):

1. Create a project → _Google Auth Platform_ → configure the consent screen (External).
2. Scopes: only `openid`, `email`, `profile` (non-sensitive; no Google verification needed).
3. **Set publishing status to "In production".** In "Testing" the app is capped at 100 test users and consent expires after 7 days ([Google docs](https://support.google.com/cloud/answer/15549945)).
4. Create an OAuth client ID (type _Web application_). Authorized redirect URIs: `http://localhost:5173/api/auth/google/callback` (dev, through the Vite proxy) and `https://group-budget.<your-subdomain>.workers.dev/api/auth/google/callback` (the free Cloudflare address; real projects use `workers.dev` callbacks with Google). When you buy a domain, add `https://<your-domain>/api/auth/google/callback` too. Google rejects bare IPs and non-public hostnames.
5. Store the credentials as Worker secrets: `wrangler secret put GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (locally they go in the gitignored `apps/server/.dev.vars`). Never in git.

**Known risk — installed iOS web app (the group uses iPhones, and installs the app from Chrome).** Every iOS browser, Chrome included, runs on Apple's WebKit. A home-screen web app, whether added from Chrome or Safari, gets its own cookies and IndexedDB, separate from the browser's tabs, and reports conflict on where a third-party OAuth redirect ends up: the app window, an in-app browser sheet, or the browser ([example thread](https://developer.apple.com/forums/thread/649699), [PocketBase discussion](https://github.com/pocketbase/pocketbase/discussions/2429)). If it ends up outside the app, the user signs in there but the installed app stays signed out. We can't control that, so sign-in is designed **not to depend on where the redirect lands**.

**Attempt-login (used only in standalone mode: `navigator.standalone` or `display-mode: standalone`; browser tabs, Android and desktop use the plain redirect above).** Like a TV sign-in, the installed app polls for its own login:

1. The app creates a random 256-bit `attempt_secret`, keeps it in its own IndexedDB (it survives the app being backgrounded while the user is in the sign-in sheet), and starts sign-in with `GET /api/auth/google/start?attempt=<sha256(secret)>`.
2. Google sign-in completes wherever iOS puts it: the app window, an in-app sheet, or Chrome. If it completes in the app window, the callback signs in normally and the attempt is cleaned up.
3. Otherwise, after the sign-up gate passes, the callback shows a **confirmation page**: "Finish signing in on your installed app? Continue only if you just tapped Sign in there." On Continue it binds the user to the attempt (`login_attempts`, §4) with a 5-minute expiry. The page exists so a friend can't be tricked into approving someone else's attempt.
4. When the installed app regains focus (and on startup) it posts the secret to `POST /api/auth/attempt/redeem`. The server hashes it, finds a bound, unexpired, unconsumed attempt, marks it consumed (single use) and sets the session cookie in the app's own storage. The secret never leaves the device, so a leaked hash is useless.
5. Rate-limit `redeem` at Cloudflare (§8). A typed one-time code is **not** built; add it only if real devices show the polling path failing.

This is testable on desktop: two Playwright browser contexts (separate cookie jars) stand in for the installed app and the browser. What still needs a real iPhone is a confirmation run (in M1b), **using Chrome's "Add to Home Screen"**, to check the hand-back feels right. It is no longer a go/no-go spike. The Google Identity Services ID-token flow is not used: it needs third-party JavaScript, which breaks the strict CSP (§8).

**Not-installed guard.** In a plain iOS Chrome tab, service workers may be unavailable and WebKit caps script-writable storage at 7 days for sites that aren't installed ([MagicBell](https://www.magicbell.com/blog/offline-first-pwas-service-worker-caching-strategies)), which could wipe an unsynced outbox. If the app is not installed (or `serviceWorker` is missing), show an "Install to your home screen for offline use" banner and warn before logout or when un-synced items are old. The group is told to install from Chrome (Share/menu → Add to Home Screen); installed web apps are exempt from the 7-day cap.

**Dev/test only**: a dev-login endpoint (for e2e and local work without Google credentials) exists only when `ENVIRONMENT` is not `production` **and** `ENABLE_DEV_LOGIN=1`. `ENVIRONMENT` defaults to `production`, so it can't be on by accident in a deployed Worker.

## 8. Security

- **Auth**: no passwords exist anywhere in the system. Session tokens are hashed at rest. `state` + PKCE on every OAuth round-trip. See §7 for the sign-up gate.
- **CSRF**: `SameSite=Lax` + `Origin` header check on all non-GET requests.
- **AuthZ**: membership and role checked per request and per mutation, server-side. Never trust a `group_id` from the client.
- **Rate limiting** on auth, `attempt/redeem` and invite endpoints, done at Cloudflare (rate-limiting rules or the Workers rate-limit binding), **not in Worker memory**: isolates are many and short-lived, so an in-memory counter would not hold. Invites are random, expiring, usage-limited, and stored hashed.
- **Input**: zod-validate every inbound payload; Drizzle parameterized queries only.
- **Headers**: strict CSP (`default-src 'self'`, `script-src 'self'`, no inline scripts, no `eval`), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, set by Cloudflare from `apps/web/public/_headers` for the app and by Hono's `secureHeaders` for API responses. `style-src` needs `'unsafe-inline'` because shadcn/sonner inject styles. An e2e test (`e2e/security-headers.spec.ts`) loads the app under the policy the Worker **really serves** and fails on any violation. It already caught one issue: zod 4 compiles validators with `new Function()` at schema-construction time, so `apps/web/src/lib/zod-config.ts` (imported first in `main.tsx`) turns that off rather than allowing `unsafe-eval`.
- **Secrets**: Google client secret and any other secrets only as Worker secrets (`wrangler secret put`) or the gitignored `.dev.vars`. Config is validated at startup of each isolate; the build never contains secrets.
- **No host to harden**: no SSH, firewall or OS patching to do. The Worker runs in Cloudflare's sandbox.
- **Dependencies**: Dependabot on; `npm audit --omit=dev` gates CI. The remaining dev-only advisories (miniflare inside the Workers test pool, esbuild inside drizzle-kit) have no non-breaking fix and never ship; revisit when those tools release updates.

## 9. Infrastructure and operations (Cloudflare)

```
Internet ─► Cloudflare edge ─► Worker "group-budget"
                                 ├─ static assets (apps/web/dist) ← everything except /api/*
                                 └─ /api/* ─► Hono ─► D1 database "group-budget"
```

- **Deploy**: `npm run deploy` builds the web app, then `wrangler deploy` uploads the Worker and the static assets in one step. CI has a manual `deploy.yml` workflow (needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets); alternatively, connect the repo to Cloudflare's Git integration. Order matters: migrations first (`npm run db:migrate:remote`), then the Worker. The deploy path is **drafted but not yet run** against a real account.
- **First-time setup** (README has the commands): `wrangler login`; `wrangler d1 create group-budget --location apac` (Asia-Pacific is the closest region to India); paste the `database_id` into `apps/server/wrangler.jsonc`. (Wrangler can also auto-provision a database on deploy when `database_id` is omitted; create it explicitly so the `apac` location hint is deliberate.)
- **Backups**: **D1 Time Travel** restores to any minute in the last 7 days (free plan) or 30 days (paid), at no extra cost (Cloudflare's D1 release notes, checked 2026-10-02). **Practice a restore before launch**: `wrangler d1 time-travel info <db>` shows the current bookmark, and `wrangler d1 time-travel restore <db> --timestamp <RFC3339>` rolls back. A restore **overwrites the database in place** and prints a bookmark to undo it. For a copy that doesn't depend on Cloudflare, add a scheduled `wrangler d1 export` to R2 (M4).
- **Observability**: Workers Logs are enabled in `wrangler.jsonc`; the Worker logs one JSON line per request and per error. `/api/healthz` checks the database. Add an external uptime monitor if you want alerts.
- **Updates and rollback**: each deploy is a new Worker version; the dashboard (or `wrangler rollback`) reverts code instantly. Database changes are additive and forward-only, so rollback never needs an un-migrate.

**Limits to watch** (free plan; confirmed against Cloudflare's pricing and limits docs on 2026-10-02; limits can change, so recheck before launch)

| Limit                                  | Free plan                                                                            | Why it matters here                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Worker requests                        | 100,000 / day                                                                       | 100 users polling every 30 s for an hour a day is ~12,000/day; fine, but don't poll while hidden                                 |
| Worker CPU per request                 | 10 ms                                                                               | Handlers are small; time spent waiting on `fetch` (Google's token exchange) or on D1 does **not** count as CPU. Keep batch sizes modest                                    |
| D1 rows read / written per day         | 5 million / 100,000                                                                | Reads count **rows scanned** (a full scan of a 5,000-row table is 5,000 reads), so indexes (§3 rule 6) are required. Exceeding a daily limit **pauses the database** (reads and writes fail) until the daily reset or an upgrade; upgrading lifts it within minutes |
| D1 storage                             | 5 GB                                                                                | A ledger for 100 people is megabytes                                                                                             |

If a limit is ever hit, the **$5/month paid plan** raises all of them; nothing else in the design changes.

**Domain and region**

- **Start on `workers.dev`**: free, HTTPS, and accepted by Google for the OAuth redirect, so development and the iPhone confirmation run need no domain.
- **Buy a domain before real users install the app.** An installed PWA and its local data (IndexedDB) belong to an origin, so moving from `*.workers.dev` to a custom domain later means users reinstall and re-sync, and any unsynced outbox on a device would be lost. Compare _renewal_ prices; any mainstream TLD is fine, and Cloudflare's own registrar is worth checking for price and TLD support. Short and neutral beats clever, since the name is permanent.
- **Region**: D1's `--location apac` hint keeps the database near India. The edge Worker is global; the app is offline-first, so latency matters little.

**Cost** (approximate; verify current pricing)

| Item                              | Cost                                                  |
| --------------------------------- | ----------------------------------------------------- |
| Workers + static assets + D1      | $0 on the free plan within the limits above           |
| Cloudflare paid plan (if needed)  | about $5 / month                                      |
| Domain (before real users)        | roughly $10–15 / year                                 |
| TLS, DDoS protection, edge        | included                                              |
| Google sign-in                    | free                                                  |
| CI                                | free GitHub Actions minutes                           |
| Web Push (later)                  | free (VAPID keys; needs a Workers-compatible library) |
| Email                             | none                                                  |

## 10. Testing and quality

- **`packages/shared` (Vitest + fast-check)**: property tests — splits always sum to total; balances across a group sum to zero; settle-up fully clears balances in ≤ n−1 transfers; no float drift; paise parsing/formatting round-trips.
- **`apps/server` (Vitest 4 + `@cloudflare/vitest-pool-workers`)**: tests run **inside `workerd`**, the real Workers runtime, against a simulated D1 that has the real migrations applied (`vitest.config.ts` + `test/apply-migrations.ts`). They call `app.request(path, init, env)` and also `SELF.fetch` through the real Worker entry. Covers (as built) health, headers, config, the schema and the batch-atomicity guarantee, and (as M1 lands) the sign-up gate with the Google exchange mocked, session lifecycle, authorization per mutation, idempotent push, pull cursors and tombstones. It will also assert that the pull query's `meta.rows_read` (D1 reports rows scanned for every query) stays proportional to the rows returned, so a missing index fails a test instead of burning quota in production.
- **`apps/web` (Vitest + `fake-indexeddb`)**: repositories, outbox, sync engine against a mock API (from M1).
- **Sync integration**: real Worker + two simulated clients: offline edits on two devices, duplicate pushes, delete vs. edit, revoked membership.
- **E2E (Playwright, Chromium)**: runs against `wrangler dev` serving the **built** web app and the API from one origin, which is how production behaves. As built: manifest installability, offline reload and deep-link served by the service worker, the real security headers with zero CSP violations, asset caching headers. From M1b: attempt-login with two browser contexts (one as the installed app, one as the browser). From M1: add an expense offline → reload offline → still there → reconnect → appears on a second context, using dev-login (the e2e server will start with `ENVIRONMENT=development` and `ENABLE_DEV_LOGIN=1`).
- **Static**: strict TypeScript and **Biome** (lint, format, import order) with `noRestrictedImports` enforcing the boundaries in §11. Biome replaced ESLint + Prettier; it doesn't format Markdown/YAML.
- **CI gates**: TS-only guard, Biome, typecheck (regenerates Worker types), unit tests, a dry-run bundle of the Worker, production-dependency audit, and the e2e job.

## 11. Repository layout

```
group-budget-app/
├─ package.json            npm workspaces: ["apps/*", "packages/*"]; root scripts
├─ tsconfig.base.json · biome.json
├─ docs/PLAN.md
├─ packages/
│  └─ shared/              @budget/shared — pure TS, no I/O
│     └─ src/              money · dates · splits · balances · settle-up
│                          schemas/ (zod: API payloads, entities) · index.ts
├─ apps/
│  ├─ server/              @budget/server — Hono on Cloudflare Workers + Drizzle on D1
│  │  ├─ wrangler.jsonc    Worker config: D1 binding, static assets, vars
│  │  ├─ .dev.vars.example local-only settings/secrets (copy to .dev.vars)
│  │  ├─ drizzle.config.ts · vitest.config.ts
│  │  ├─ drizzle/          generated SQL migrations (committed; applied by Wrangler)
│  │  ├─ test/             apply-migrations.ts · env.d.ts
│  │  └─ src/
│  │     ├─ index.ts       the Worker: default-exports the Hono app
│  │     ├─ app.ts         Hono app factory (what tests import)
│  │     ├─ config.ts      bindings → validated config (zod); secure-by-default
│  │     ├─ logger.ts      one JSON line per event (Workers Logs)
│  │     ├─ db/            client.ts (Drizzle on D1) · schema/*.ts
│  │     ├─ modules/       auth · sync · groups · invites            (M1+)
│  │     │                 each: routes.ts · service.ts · repo.ts
│  │     └─ middleware/    request-logger · session · origin-check   (M1+)
│  └─ web/                 @budget/web — React + Vite PWA
│     ├─ index.html · vite.config.ts · components.json (shadcn)
│     ├─ public/           icons, favicon, _headers (CSP + caching)
│     └─ src/
│        ├─ main.tsx · App.tsx · routes.tsx
│        ├─ components/ui/ shadcn components (copied, ours to edit)
│        ├─ components/    app-level shared components
│        ├─ lib/           utils.ts (cn) · api client · zod-config.ts
│        ├─ db/            Dexie schema + repositories               (M1)
│        ├─ sync/          outbox · engine · polling                 (M1)
│        ├─ features/      expenses · categories · groups · insights · settings · auth
│        │                 each: pages, components, hooks
│        └─ pwa/           SW registration · install prompt · update toast
├─ e2e/                    Playwright specs
└─ .github/workflows/      ci.yml · deploy.yml (manual)
```

**Dependency rules** (enforced by Biome's `noRestrictedImports`, for both package-name and relative imports):

| Package           | May import                                                |
| ----------------- | --------------------------------------------------------- |
| `packages/shared` | nothing (only external pure libs such as `zod`)           |
| `apps/server`     | `@budget/shared`, its own `src`                           |
| `apps/web`        | `@budget/shared`, its own `src` — **never `apps/server`** |

**Tooling decisions**

- **`@budget/shared` is consumed as TypeScript source** (its `exports` point at `src/index.ts`): Vite compiles it for the web and Wrangler's bundler (esbuild) for the Worker, so there is no build-ordering between packages.
- **Dev**: `npm run dev` applies migrations to a local simulated D1, then starts `wrangler dev` (Worker on 8787, running the real `workerd`) and Vite (5173); Vite proxies `/api` to the Worker.
- **Types for bindings** are generated by `wrangler types` into a gitignored `worker-configuration.d.ts`; `npm run typecheck` regenerates them.
- **Compatibility date** is pinned in `wrangler.jsonc` to `2026-08-01` because the Workers test pool bundles a slightly older `workerd` than Wrangler does; bump it deliberately when both support a newer one.
- **Vitest is pinned to 4.x** because `@cloudflare/vitest-pool-workers` does not support 5 yet.
- **Node 26 (`.nvmrc`) with npm 11.** npm 10, which ships with Node 22, crashes resolving Vitest's peer set. npm 11 also skips dependency install scripts unless approved, so `allowScripts` in the root `package.json` approves `esbuild` and `workerd` (the two that ship native binaries); anything new that needs a script prompts a warning to review. Node 26 is the "Current" line at the time of writing and is expected to enter LTS in October under Node's usual schedule; the whole suite was verified on 26.10 with npm 11.19.
- **npm** (not pnpm) to keep the toolchain minimal.

## 12. Roadmap

**v1 = M0 + M1 + M2.** Each milestone ends in something usable.

| #      | Milestone                      | Scope                                                                                                                                                                                                                                                                                                   | Exit criteria                                                                                                                                  |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** | Foundations — **done**         | Workspace, tooling, CI; Hono Worker with `/api/healthz`; Drizzle + D1 with the first migration; React shell with shadcn and an installable PWA; one-origin dev and e2e setup; drafted Cloudflare deploy                                                                                                  | `npm run dev` runs everything locally; CI green; the production build installs as a PWA and reloads offline against the real Worker runtime    |
| **M1a**| Personal ledger, offline-first | Dexie schema; expenses + categories CRUD; outbox + pull sync (polling) with `db.batch` writes and `server_seq`; indexes from §4; **dev-login** so no Google credentials are needed; JSON/CSV export; first deploy to `workers.dev`; **Time Travel restore drill**                                         | Add expenses in airplane mode on a phone; they appear on a second device after reconnect; a restore has been performed                          |
| **M1b**| Google sign-in                 | Google sign-in + sessions + sign-up gate; **attempt-login for installed apps (§7), built first and e2e-tested with two browser contexts**; per-user local DB; logout flow; not-installed banner; real-iPhone confirmation run on Chrome's "Add to Home Screen" at the `workers.dev` address                  | An iPhone (installed from Chrome) and an Android phone each sign in to the installed app; a friend joins through an invite link                |
| **M2** | Groups                         | Group create/rename, invites, memberships, split types (equal, exact, percent, shares), balances, settle-up, activity feed                                                                                                                                                                              | Two or three people run a trip's expenses and the balances match a hand calculation                                                            |
| **M3** | Insights                       | Monthly/category/trend reports (shadcn charts), budgets + alerts, search/filter, CSV import, recurring expenses (Worker Cron Trigger); configurable month start (calendar month or salary-cycle day) and a yearly view by Indian financial year (Apr–Mar)                                                 | Month-end review is possible without leaving the app                                                                                           |
| **M4** | Extras (pick as needed)        | Live updates over a Durable Object WebSocket hub; scheduled `d1 export` to R2; Web Push; bank-statement CSV import presets; UPI deep link on settle-up (`upi://pay?…`; verify it works across apps first); placeholder (non-user) group members; in-app admin for the allowlist; custom domain move       | —                                                                                                                                              |

M1 is split so build work does not wait on credentials you are creating later: M1a needs no Google setup at all, and M1b begins when the OAuth client exists. The iPhone sign-in risk is handled by design (attempt-login), so it no longer needs a spike before building.

**Status: M0 is done and running on Workers + D1** (branch `migrate-cloudflare`). Verified: TS-only guard, Biome, typecheck, **15 server tests inside `workerd`** and 40 shared tests; a dry-run Worker bundle (about 1 MB, 170 KB gzipped); and **6 end-to-end tests in real Chromium against `wrangler dev`** serving the built app and API from one origin: installable manifest, offline reload and deep-link, real security headers with zero CSP violations, immutable asset caching, `no-store` API responses. A negative control (service worker blocked) confirms the offline test would fail without the service worker. `npm run dev` was smoke-tested end to end (Vite proxying to the Worker).

**Not yet verified:** an actual deploy to a Cloudflare account (none is reachable from the build sandbox), the manual deploy workflow, and `arctic` on Workers. The Workers and D1 limits, Time Travel retention and restore commands, static-assets SPA routing, and `_headers` behaviour (it applies to static-asset responses only, never to Worker responses, which is why the API gets its headers from Hono) were confirmed against Cloudflare's own documentation on 2026-10-02.

M0 notes: `ui.shadcn.com` was unreachable from the build sandbox, so the shadcn sources were copied from the shadcn-ui GitHub repo (the same files the CLI installs, with the CLI's `cn` import rewritten and `next-themes` removed from sonner); `components.json` is configured, so `npx shadcn add` works normally elsewhere.

Out of scope (decided): multi-currency/FX, receipt photos or any attachments, passwords/passkeys. Parked: RSC (§15).

## 13. Decisions and open questions

**Decided**: see §1.

**Defaults I chose — say so if you want any changed**

- Sign-up gate = `ALLOWED_EMAILS` setting **or** a valid group invite token (§7).
- Any group member can edit any expense; everything is audit-logged (§4).
- Logout wipes the local database for that user after warning about unsynced changes (§5).
- Clients poll for changes (~30 s while visible) instead of holding a live connection; a Durable Object WebSocket hub is the M4 upgrade (§5).
- Sessions are extended only when less than half their life remains, to save D1 writes (§7).
- D1 is created with the `apac` location hint (§9).
- Start on the free Cloudflare plan; move to the $5 plan only if a limit is hit (§9).

**Still open**

1. **Google Cloud OAuth client** — yours to create (§7 lists the steps). It gates M1b and the real-iPhone confirmation run, **not M1a**.
2. **Domain name** — before real users install the app, not before. Decide whether to register it through Cloudflare.
3. **Cloudflare account** — a free account is enough to start; I will need you to run `wrangler login` and create the D1 database (README has the commands), since I can't reach your account from here.

## 14. Risks

| Risk                                                                     | Mitigation                                                                                                                                          |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google sign-in lands outside an installed iOS web app (all iOS browsers are WebKit; the group installs from Chrome) | Attempt-login (§7): the app redeems its own session by secret, wherever the redirect ends; desktop-testable; real-iPhone confirmation run in M1b |
| App used in an iOS Chrome tab, not installed (no service worker, 7-day storage cap) | Install banner, unsynced-data warnings, install instructions for the group (§7)                                                         |
| D1 has no interactive transactions                                       | Read/validate first, one atomic `db.batch`; sequence numbers assigned in SQL; batch rollback verified by a test; membership race window accepted and audited |
| Free-plan limits (requests, D1 rows scanned/written) are hit             | Indexes on every hot query (enforced by a `rows_read` test from M1a); cheap polling with backoff; sliding sessions rarely write; a hit pauses the database until the daily reset, and the $5 plan lifts it within minutes; recheck limits before launch         |
| Consent screen left in "Testing" (100-user cap, 7-day expiry)            | Publish to "In production" (basic scopes need no verification)                                                                                      |
| Moving from `workers.dev` to a custom domain strands installed PWAs      | Buy the domain before real users install; the server is the source of truth, so a move costs a reinstall and re-sync                                  |
| Sync bug loses data                                                      | Idempotent mutations, tombstones, audit log, Time Travel, two-client integration tests, always-available export, warn before logout with unsynced data |
| v1 includes groups, so M1+M2 is large                                    | Milestones are independently shippable; M1a is usable alone as a personal ledger                                                                      |
| iOS PWA limits (no Background Sync, storage eviction)                    | Flush on foreground, `storage.persist()`, server as source of truth                                                                                 |
| Vendor lock-in to Cloudflare                                             | Hono and Drizzle are portable; only `wrangler.jsonc`, the D1 client and the entry point are Cloudflare-specific; migrations are plain SQL           |
| Test tooling lags (Vitest pinned to 4.x, older bundled `workerd`)        | Pins documented in §11; revisit on each pool release; dev-only audit advisories tracked in §8                                                        |
| Scope creep                                                              | Milestones with explicit exit criteria; extras live in M4                                                                                           |

## 15. Parked: React Server Components

Not part of v1 or the roadmap. If revisited: `@vitejs/plugin-rsc` on the existing Vite setup, a **read-only** endpoint for reports and history only, and **no Server Functions** (the Dec 2025 critical RCE [CVE-2025-55182](https://github.com/advisories/GHSA-fv66-9v8q-g76r) was in Flight deserialization at Server Function endpoints, and offline mutation replays need a stable JSON API anyway). It would sit beside the offline-first path, not replace it, because an offline PWA cannot render on a server. The earlier, more detailed RSC design is in this file's git history (commit `00dab86`). The earlier VPS design (Node, SQLite, Caddy, Litestream, Docker) is in the history at commit `4c9b373`.
