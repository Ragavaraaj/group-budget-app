# Group Budget App — Architecture & Plan

Status: **draft v3** · Scope: architecture and roadmap. Code starts at M0 (§12).

## 1. Goals and constraints

|              |                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| **Product**  | Track all expenses: personal spending, plus shared groups with splits, balances and settle-up.                |
| **Cost**     | No hardware. One small VPS and nothing else that bills monthly (a domain is the only other unavoidable cost). |
| **Frontend** | Simple React PWA: installable, **usable offline** (entering an expense at the till must never fail).          |
| **Backend**  | Node + Hono + Drizzle (SQLite).                                                                               |

**Confirmed decisions**

- **v1 = personal + groups** (M0–M2), offline-first.
- **INR only**, integer **paise**. No multi-currency, no FX.
- **No receipt photos** or any attachments.
- **Stack**: React PWA with **shadcn/ui** + Tailwind; **Node + Hono + Drizzle**; SQLite.
- **Auth**: **Google sign-in only** (no passwords, no passkeys in v1).
- **Repo**: **npm workspaces monorepo** — `apps/web`, `apps/server`, `packages/shared`.
- **TypeScript everywhere**: all source _and_ config files are `.ts`/`.tsx` (`vite.config.ts`, `eslint.config.ts`, `playwright.config.ts`, …). CI runs `npm run check:ts-only`, which fails if any `.js/.jsx/.mjs/.cjs` file is tracked.
- **Scale**: 50–100 users maximum. One small VPS and one SQLite file are comfortably enough.
- **Domain**: will be bought, before the first real deploy (§9). Google sign-in needs it in production too (§7).
- **RSC**: parked (§15). Nothing in v1 depends on it.

## 2. Decisions at a glance

| Area       | Choice                                                                                                  | Why                                                                                               | Escape hatch                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Hosting    | 1 small VPS (1 vCPU / 1–2 GB), Caddy in front                                                           | Cheapest viable; Caddy gives free auto-HTTPS                                                      | Any provider; nothing is provider-specific                                     |
| Server     | Node (current LTS) + **Hono** + TypeScript                                                              | Tiny, fast, typed, easy to test (`app.request()`)                                                 | —                                                                              |
| Database   | **SQLite** (WAL) via `better-sqlite3`, **Drizzle** for schema + migrations                              | No extra process or RAM, trivial backups, ample for 50–100 users                                  | Postgres via Drizzle, contained in `apps/server/src/db` and each module's repo |
| Backups    | **Litestream** → Backblaze B2 / Cloudflare R2 free tier                                                 | Continuous, point-in-time restore, ~$0                                                            | Nightly `sqlite3 .backup` copied off-box with rclone                           |
| Client     | React 19 + TypeScript + **Vite**, React Router                                                          | Standard, small, fast                                                                             | —                                                                              |
| UI         | **shadcn/ui** (Radix + Tailwind v4), `sonner` toasts, `vaul` drawer, react-hook-form + zod              | Accessible components copied into the repo (we own them); consistent look; mobile-friendly sheets | —                                                                              |
| Local data | **Dexie** (IndexedDB) with live queries                                                                 | Offline source of truth for the UI                                                                | SQLite-WASM + OPFS                                                             |
| Sync       | Custom **outbox + cursor pull**, SSE nudge                                                              | Expense data is append-mostly; no CRDT or sync-engine dependency                                  | Replicache / PowerSync if it gets hairy                                        |
| Auth       | **Google sign-in** (OAuth 2.0 authorization-code + PKCE, server-side) via `arctic`; own cookie sessions | No passwords to store, no email provider, no recovery flow                                        | Add passkeys later                                                             |
| Currency   | **INR only**, integer paise, `Intl.NumberFormat('en-IN')` (lakh/crore grouping)                         | Removes FX and mixed-currency reports entirely                                                    | Add a `currency` column (default `'INR'`) via a normal migration               |
| Validation | **zod** schemas in `packages/shared`, used by web and server                                            | One definition of every API payload                                                               | —                                                                              |
| Tooling    | npm workspaces, `tsx` (server dev), `tsup` (server build), Vitest, Playwright, ESLint (flat), Prettier  | Few moving parts                                                                                  | pnpm if workspaces get painful                                                 |
| CI/CD      | GitHub Actions → server image on GHCR + static web build → SSH deploy                                   | Free, simple                                                                                      | rsync + systemd                                                                |

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
                       HTTPS (Caddy, HTTP/2+3)                     │
        ┌──────────────────── VPS ───▼───────────────────────────▼───┐
        │ Caddy: static apps/web/dist  +  /api/* → Node               │
        │ Node + Hono                                                 │
        │   /api/auth/google/start|callback  /api/auth/logout  /me    │
        │   /api/sync/push|pull   (JSON + zod)                        │
        │   /api/groups/*  /api/invites/*     (online-only actions)   │
        │   /api/events  (SSE "changes available")                    │
        │            │  modules/*/repo (Drizzle)                      │
        │       SQLite (WAL) ── Litestream ──► B2 / R2                │
        └─────────────────────────────────────────────────────────────┘
```

**Rules that keep the code clean**

1. Reads of business data in the UI come from Dexie. Writes go to Dexie + outbox, then sync. Only auth, group management and invites call the API directly (they need the server's say-so, so they are online-only).
2. Server code touches the database only through each module's `repo`, never from route handlers directly.
3. Pure logic (money, splits, balances, settle-up, zod schemas) lives in `packages/shared` with no I/O, so it runs identically in the browser, the server and tests.
4. Same-origin everywhere: Caddy in production and Vite's dev proxy in development route `/api/*` to Node. No CORS, and cookies just work.

## 4. Data model (server, SQLite via Drizzle)

IDs are **UUIDv7** generated on the device (sortable; makes offline creates idempotent).

```
users            id, google_sub (unique), email, display_name, avatar_url, created_at, last_login_at
sessions         id_hash, user_id, expires_at, user_agent, created_at
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
processed_mutations  mutation_id, user_id, applied_at                          -- idempotency
audit_log        id, mutation_id, user_id, entity, entity_id, before, after, at -- append-only
sync_counter     id (=1), value                                                -- see below

(+ sync cols) = version, updated_at, deleted_at (tombstone), server_seq
```

Rules:

- **Money is integer paise** (`amount_minor` = paise; ₹1 = 100). No floats anywhere. The currency is a single constant in `packages/shared`, not a column. Display with `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.
- **Dates**: `occurred_on` is a plain `YYYY-MM-DD` _local_ date (the day the user means), never a UTC instant, so an expense entered at 00:30 IST never lands on the wrong day. `updated_at` and sync metadata are UTC.
- **`server_seq`**: SQLite has no sequences, so a single-row `sync_counter` is incremented (`UPDATE … SET value = value + 1 RETURNING value`) inside the same write transaction that applies a mutation. SQLite serialises writers, so the sequence is gap-tolerant and strictly increasing.
- **Splits**: equal / exact / percent / shares. Remainder paise are distributed with the largest-remainder method so `sum(shares) == total` always holds (property-tested).
- **Balances are derived, never stored**: `net(user) = Σ paid − Σ owed ± settlements`.
- **Settle-up** uses greedy debt simplification (min-cash-flow) to minimise the number of transfers.
- **Personal ledger** = a group with `is_personal = true` and a single member, created on first sign-in. One code path for personal and shared.
- Never hard-delete synced rows; tombstone them.
- **Drizzle workflow**: schema in `apps/server/src/db/schema/*.ts`, one file per domain; `drizzle-kit generate` produces SQL migrations committed to `apps/server/drizzle/`; the server applies pending migrations on boot with Drizzle's migrator.

**Group permissions (default, easy to tighten)**: any member can add, edit or delete any expense in the group, as in most shared-expense apps among friends and family; every change is recorded in `audit_log` with who and when. Only the owner can rename the group, remove members and create invites.

## 5. Sync protocol

Why custom: expenses are append-mostly, edits are rare and rarely concurrent, so last-writer-wins at row level is acceptable and a CRDT is overkill.

**Client**

- Local writes go to Dexie _and_ an `outbox` table `{mutationId, type, payload, baseVersion, createdAt}` in one transaction, so the UI updates instantly.
- Flush triggers: app start, `online` event, `visibilitychange → visible`, after each local write, and Background Sync where supported (Chromium only; iOS Safari lacks it, so foreground triggers are the primary mechanism).
- Pull triggers: same, plus an SSE `changes-available` nudge.
- **Local DB is scoped per user** (database name includes the user id), so two accounts on one device never mix.
- **Logout** warns if the outbox is non-empty (unsynced changes would be lost), then wipes that user's local database.

**Server**

- `POST /api/sync/push` — array of mutations. One transaction per batch; `processed_mutations` makes retries idempotent. Per-mutation result: `applied | rejected(reason)`. Membership and role are checked per mutation; the server is the only authority.
- `GET /api/sync/pull?since=<server_seq>&limit=N` — rows from the caller's groups with `server_seq > since`, including tombstones; paginated; returns the new cursor. A newly joined member pulls the group's full history through this same path.
- `GET /api/events` — SSE stream that only says "something changed"; the client then pulls.

**Conflicts**

- Row-level LWW by server arrival order. Delete wins over a concurrent edit.
- If `baseVersion` is stale the server still applies LWW but flags it; the UI shows a small "edited by X while you were offline" notice.

**Session expiry while offline**: sessions are long-lived (30 days, sliding). If one expires, the app still opens and works from Dexie; the outbox simply waits. Signing in again flushes it.

**Safety nets**

- An append-only `audit_log` (mutation id, user, entity, before/after JSON, timestamp) is written in the same transaction as every applied mutation. `server_seq` alone only gives the _latest_ state of each row, so without this a bad merge or a bug can't be diagnosed or undone.
- "Export everything as JSON/CSV" is available from day one.
- Integration tests simulate two offline clients with interleaved edits, replays and tombstones (§10).

## 6. Frontend

- **Shell and routing**: React Router; the whole shell is precached by the service worker. Mobile-first with a bottom tab bar; add/edit expense is a _route_ (not a modal) so the Android back button behaves.
- **State**: Dexie live queries are the source of truth. Local React state for UI only. No Redux. A tiny typed `fetch` wrapper for the online-only calls (auth, groups, invites).
- **UI kit**: **shadcn/ui** components live in `apps/web/src/components/ui` (generated by the shadcn CLI, then ours to edit), configured through `components.json` and an `@/` path alias. Tailwind v4 with dark mode. Added on demand as screens need them (button, input, label, form, select, tabs, card, drawer, dialog, dropdown-menu, sonner, avatar, badge, skeleton, calendar/popover for dates, chart for M3). Forms use react-hook-form with the shared zod schemas.
- **Charts (M3)**: shadcn's chart component (Recharts), loaded lazily with the Insights route so it doesn't weigh down the first load.
- **UX priorities** (this is what makes expense apps stick): amount-first entry in ≤3 taps; defaults from last-used category/payer/group; always-visible sync status; undo on delete (sonner toast with an Undo action); fast list with virtualization once it exceeds a few thousand rows.

**PWA specifics**

- `vite-plugin-pwa`, starting in `generateSW` mode (precache + navigation fallback), switching to `injectManifest` only when the sync engine needs a custom service worker.
- Caching: precache shell + assets; `/api/*` is never cached by the service worker (the sync engine owns it).
- Update flow: "New version available — reload" prompt; never auto-reload mid-entry.
- Manifest: `standalone`, 192/512/maskable icons, `apple-touch-icon`, app shortcut "Add expense".
- Call `navigator.storage.persist()`. Safari can evict IndexedDB for non-installed sites; the server remains the source of truth, so eviction is recoverable by re-pulling, but un-synced outbox items would be lost, which is why flush-on-foreground matters.
- iOS caveats: push works only for installed PWAs (16.4+); no Background Sync; sign-in needs care (§7).

## 7. Auth: Google sign-in

**Flow** (server-side authorization code + PKCE, using `arctic`; no third-party JavaScript in the page, so the CSP can stay strict):

1. `Continue with Google` → full-page navigation to `GET /api/auth/google/start` (optionally carrying an invite token).
2. Server creates `state` + PKCE verifier, stores them in a short-lived HttpOnly cookie, redirects to Google with scopes `openid email profile`.
3. Google → `GET /api/auth/google/callback?code&state`. Server checks `state`, exchanges the code, reads the ID token, **requires `email_verified`**, and applies the **sign-up gate** below.
4. Upsert the user by Google `sub` (never by email; emails can change), create the personal group on first sign-in, create a session, set the cookie, redirect to `/`.

**Sessions**: random 256-bit token; only its hash is stored; `HttpOnly; Secure; SameSite=Lax`; 30-day sliding expiry; logout revokes. Cookie name/flags differ slightly in dev (`http://localhost`).

**Sign-up gate** (default; the app is not open to the world): a Google account may _create_ an account only if its email is in the `ALLOWED_EMAILS` env list (you, to bootstrap) **or** it arrives with a valid, unexpired group **invite token**. Existing users always sign in. This means a friend you invite to a group can join without you touching the server.

**What you need to set up in Google Cloud Console** (needed at the start of M1; localhost works for development):

1. Create a project → _Google Auth Platform_ → configure the consent screen (External).
2. Scopes: only `openid`, `email`, `profile` (non-sensitive; no Google verification needed).
3. **Set publishing status to "In production".** In "Testing" the app is capped at 100 test users and consent expires after 7 days ([Google docs](https://support.google.com/cloud/answer/15549945)).
4. Create an OAuth client ID (type _Web application_). Authorized redirect URIs: `http://localhost:5173/api/auth/google/callback` (dev, through the Vite proxy) and `https://<your-domain>/api/auth/google/callback` (production). Production redirect URIs need a real domain, not a bare IP.
5. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the server's environment (never in git).

**Known risk — installed iOS PWA.** On iOS, a home-screen web app gets its own storage, separate from Safari, and reports say iOS can hand a third-party OAuth redirect to Safari instead of keeping it in the app window ([example thread](https://developer.apple.com/forums/thread/649699)). If that happens, the user signs in in Safari but the installed app stays signed out. This is untestable on desktop, so **M1 starts with a real-iPhone spike** (a temporary HTTPS tunnel is enough). If it fails, fallbacks in order of preference: (a) open the auth flow via `window.open` so it stays in the app, (b) a one-time **device-link code**: sign in with Google in Safari, receive a short code, type it into the installed app to mint a session there, (c) the Google Identity Services ID-token flow (no redirect). Android and desktop installs are not affected.

**Dev/test only**: a dev-login endpoint (for e2e and local work without Google credentials) is compiled in only when `NODE_ENV !== 'production'` **and** `ENABLE_DEV_LOGIN=1`, and refuses to start if both that flag and production mode are set.

## 8. Security

- **Auth**: no passwords exist anywhere in the system. Session tokens are hashed at rest. `state` + PKCE on every OAuth round-trip. See §7 for the sign-up gate.
- **CSRF**: `SameSite=Lax` + `Origin` header check on all non-GET requests.
- **AuthZ**: membership and role checked per request and per mutation, server-side. Never trust a `group_id` from the client.
- **Rate limiting** on auth and invite endpoints; invites are random, expiring, usage-limited, and stored hashed.
- **Input**: zod-validate every inbound payload; Drizzle parameterized queries only.
- **Headers**: strict CSP (`default-src 'self'`, `script-src 'self'`, no inline scripts, no `eval`), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, all set by Caddy (`deploy/Caddyfile`). `style-src` needs `'unsafe-inline'` because shadcn/sonner inject styles. An e2e test (`e2e/csp.spec.ts`) loads the app under the exact policy parsed from the Caddyfile and fails on any violation. It already caught one: zod 4 compiles validators with `new Function()` at schema-construction time, so `apps/web/src/lib/zod-config.ts` (imported first in `main.tsx`) turns that off rather than allowing `unsafe-eval`.
- **Secrets**: Google client secret and any other secrets only via environment; a startup check refuses to boot in production if they're missing.
- **Host**: SSH keys only, `ufw` (22/80/443), `unattended-upgrades`, app runs as a non-root user.
- **Dependencies**: Dependabot on; `npm audit` in CI.

## 9. Infrastructure and operations (single VPS)

```
Internet ─► Caddy :443 (auto-TLS) ─┬─► static files (apps/web/dist)
                                   └─► /api/* ─► Node app :3000 ─► SQLite /data/app.db
                                                     │
                                        Litestream sidecar ──► B2/R2 bucket
```

- **Caddy**: serves the web build with SPA fallback to `index.html`; `index.html`, `sw.js` and `manifest.webmanifest` are `no-cache`, hashed `/assets/*` are `immutable` (this is what makes PWA updates reliable); `/api/*` reverse-proxied with response flushing enabled for the SSE stream.
- **Process management**: Docker Compose (`app`, `caddy`, `litestream`). Reproducible, and one-command rollback by image tag.
- **Deploy**: push to `main` → CI (typecheck, lint, tests, build) → server image to GHCR + web build artifact → SSH `docker compose pull && up -d`. Migrations run on boot. A ~1 s restart is acceptable because clients are offline-tolerant.
- **Backups**: Litestream continuous replication; **practice a restore** into a scratch directory before launch (an untested backup is not a backup). Weekly cron verifies the replica is fresh.
- **Observability**: pino JSON logs, `/api/healthz`, healthchecks.io (free) pinged by cron; UptimeRobot (free) on the public URL.
- **Capacity**: Node ≈ 100–200 MB, Caddy ≈ 20–40 MB, Litestream ≈ 30 MB — fits 1 GB with headroom. SQLite single-writer is fine for 50–100 users.

**Domain and region**

- **When to buy the domain**: not before you start coding — `localhost` counts as a secure context, so service workers, PWA install and Google sign-in all work in local development. Buy it before the **first real deploy**, which must be **no later than the iPhone sign-in spike and production use in M1**: Google needs an HTTPS domain for the production redirect URI.
- **What to buy**: any mainstream TLD (`.com`, `.in`, `.app`, …). Compare the _renewal_ price, not just the first-year price. Short and neutral beats clever, since it's permanent (it's baked into the Google OAuth client and users' installed apps).
- **VPS region**: pick one near you (check whether your provider offers Mumbai, Bangalore or Singapore). The app is offline-first, so latency matters far less than usual.

**Cost** (approximate, verify current pricing; most overseas VPS providers bill in USD, so check the INR amount at checkout)

| Item                | Cost                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| VPS 1 vCPU / 1–2 GB | roughly $4–6 / month (or an always-free ARM tier if you can get one) |
| Domain              | roughly $10–15 / year                                                |
| TLS                 | free (Caddy / Let's Encrypt)                                         |
| Google sign-in      | free                                                                 |
| Backups             | free tier (B2 10 GB; R2 free tier)                                   |
| CI                  | free GitHub Actions minutes                                          |
| Web Push (later)    | free (self-hosted VAPID)                                             |
| Email               | none                                                                 |

## 10. Testing and quality

- **`packages/shared` (Vitest + fast-check)**: property tests — splits always sum to total; balances across a group sum to zero; settle-up fully clears balances in ≤ n−1 transfers; no float drift; paise parsing/formatting round-trips.
- **`apps/server` (Vitest)**: Hono `app.request()` against a real in-memory SQLite with the actual Drizzle migrations applied. Covers the sign-up gate (allowlist / invite / neither) with the Google token exchange mocked, session lifecycle, authorization per mutation, idempotent push, pull cursors and tombstones.
- **`apps/web` (Vitest + `fake-indexeddb`)**: repositories, outbox, sync engine against a mock API.
- **Sync integration**: real server + two simulated clients: offline edits on two devices, duplicate pushes, delete vs. edit, revoked membership.
- **E2E (Playwright, Chromium)** against the production build with dev-login: add an expense offline (`context.setOffline`) → reload offline → still there → reconnect → appears on a second context; PWA installability checks.
- **Static**: strict TypeScript, ESLint (flat config) with `no-restricted-imports` enforcing the boundaries in §11, Prettier.
- **CI gates**: typecheck, lint, unit, e2e, build.

## 11. Repository layout

```
group-budget-app/
├─ package.json            npm workspaces: ["apps/*", "packages/*"]; root scripts
├─ tsconfig.base.json · eslint.config.js · .prettierrc
├─ docs/PLAN.md
├─ packages/
│  └─ shared/              @budget/shared — pure TS, no I/O
│     └─ src/              money · dates · splits · balances · settle-up
│                          schemas/ (zod: API payloads, entities) · index.ts
├─ apps/
│  ├─ server/              @budget/server — Node + Hono + Drizzle
│  │  ├─ drizzle.config.ts
│  │  ├─ drizzle/          generated SQL migrations (committed)
│  │  └─ src/
│  │     ├─ index.ts       bootstrap: config → migrate → listen
│  │     ├─ app.ts         Hono app factory (what tests import)
│  │     ├─ config.ts      env parsing + production safety checks (zod)
│  │     ├─ db/            client.ts · migrate.ts · schema/*.ts
│  │     ├─ modules/       auth · sync · groups · invites · events
│  │     │                 each: routes.ts · service.ts · repo.ts
│  │     └─ middleware/    session · origin-check · rate-limit · security-headers
│  └─ web/                 @budget/web — React + Vite PWA
│     ├─ index.html · vite.config.ts · components.json (shadcn)
│     ├─ public/           icons, favicon
│     └─ src/
│        ├─ main.tsx · App.tsx · routes.tsx
│        ├─ components/ui/ shadcn components (generated, ours to edit)
│        ├─ components/    app-level shared components
│        ├─ lib/           utils.ts (cn) · api client · format helpers
│        ├─ db/            Dexie schema + repositories
│        ├─ sync/          outbox · engine · SSE client
│        ├─ features/      expenses · categories · groups · insights · settings · auth
│        │                 each: pages, components, hooks
│        └─ pwa/           SW registration · install prompt · update toast
├─ deploy/                 Caddyfile · docker-compose.yml · litestream.yml · Dockerfile (server)
├─ e2e/                    Playwright specs + config
└─ .github/workflows/      ci.yml
```

**Dependency rules** (enforced by ESLint `no-restricted-imports`):

| Package           | May import                                                |
| ----------------- | --------------------------------------------------------- |
| `packages/shared` | nothing (only external pure libs such as `zod`)           |
| `apps/server`     | `@budget/shared`, its own `src`                           |
| `apps/web`        | `@budget/shared`, its own `src` — **never `apps/server`** |

**Tooling decisions**

- **`@budget/shared` is consumed as TypeScript source** (its `exports` point at `src/index.ts`): Vite compiles it for the web; `tsx` runs it in server dev; `tsup` bundles it into the server build (`noExternal`), so there is no build-ordering between packages.
- **Dev**: `npm run dev` at the root starts Vite (5173) and `tsx watch` for the server (3000) together; Vite proxies `/api` to Node.
- **Typecheck/lint/test** run per workspace from root scripts.
- **Server build**: `tsup` → single `dist/index.js` + the `drizzle/` migrations folder; native `better-sqlite3` stays external and is installed in the Docker image.
- **npm** (not pnpm) to keep the toolchain minimal.

## 12. Roadmap

**v1 = M0 + M1 + M2.** Each milestone ends in something usable.

| #      | Milestone                      | Scope                                                                                                                                                                                                                                     | Exit criteria                                                                                                                 |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **M0** | Foundations                    | Workspace skeleton and tooling; CI; Hono app with `/api/healthz`; Drizzle + first migration applied on boot; React shell with shadcn initialised and an **installable PWA** that opens offline; Vite→Node dev proxy; drafted deploy files | `npm run dev` runs both apps; CI is green; the production build installs as a PWA on localhost and reloads offline            |
| **M1** | Personal ledger, offline-first | **iPhone sign-in spike first (§7)**; Google sign-in + sessions + sign-up gate; Dexie schema; expenses + categories CRUD; outbox + pull sync; SSE; JSON/CSV export; **go live** (domain, VPS, Caddy, Litestream, restore drill)            | Add expenses in airplane mode on a phone; they appear on a second device after reconnect; a backup restore has been performed |
| **M2** | Groups                         | Group create/rename, invites, memberships, split types (equal, exact, percent, shares), balances, settle-up, activity feed                                                                                                                | Two or three people run a trip's expenses and the balances match a hand calculation                                           |
| **M3** | Insights                       | Monthly/category/trend reports (shadcn charts), budgets + alerts, search/filter, CSV import, recurring expenses; configurable month start (calendar month or salary-cycle day) and a yearly view by Indian financial year (Apr–Mar)       | Month-end review is possible without leaving the app                                                                          |
| **M4** | Extras (pick as needed)        | Web Push, bank-statement CSV import presets, UPI deep link on settle-up (`upi://pay?…`; verify it works across apps first), placeholder (non-user) group members, in-app admin for the allowlist                                          | —                                                                                                                             |

**Status: M0 is done.** Verified: lint, typecheck and 53 unit tests pass; the production build installs as a PWA and reloads and deep-links offline in real Chromium (e2e, with a negative control that fails when the service worker is blocked); the built server boots, applies its migration and shuts down cleanly. Not yet verified: the Docker image (no Docker daemon was available; its steps were replayed by hand) and the Litestream/Compose drafts, which wait for the VPS.

M0 notes: `ui.shadcn.com` was unreachable from the build sandbox, so the shadcn component sources were copied from the shadcn-ui GitHub repo (the same files the CLI installs, with the CLI's `cn` import rewritten and `next-themes` removed from sonner). `components.json` is configured, so `npx shadcn add` works normally elsewhere. The remaining `npm audit` findings are moderate esbuild dev-server advisories inside `tsup` and `drizzle-kit` (build-time tools that never ship), so CI audits production dependencies only.

Out of scope (decided): multi-currency/FX, receipt photos or any attachments, passwords/passkeys. Parked: RSC (§15).

## 13. Decisions and open questions

**Decided**: see §1.

**Defaults I chose — say so if you want any changed**

- Sign-up gate = `ALLOWED_EMAILS` env **or** a valid group invite token (§7).
- Any group member can edit any expense; everything is audit-logged (§4).
- Logout wipes the local database for that user after warning about unsynced changes (§5).

**Still open**

1. **Domain name and VPS provider/region.** Needed by the time M1 goes live (the Google production redirect URI depends on it), not before.
2. **Does anyone in your group use an iPhone?** If yes, the M1 sign-in spike is critical-path; if everyone is on Android, it drops to a nice-to-have.
3. **Google Cloud OAuth client**: you create it (§7 lists the steps). Needed at the start of M1; M0 doesn't touch it.

## 14. Risks

| Risk                                                          | Mitigation                                                                                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Google sign-in fails inside an installed iOS PWA              | First task in M1 is a real-iPhone spike; three fallbacks listed in §7                                                                     |
| Consent screen left in "Testing" (100-user cap, 7-day expiry) | Publish to "In production" (basic scopes need no verification)                                                                            |
| Sync bug loses data                                           | Idempotent mutations, tombstones, audit log, two-client integration tests, always-available export, warn before logout with unsynced data |
| v1 now includes groups, so M1+M2 is large                     | Milestones are independently shippable; M1 is usable alone as a personal ledger                                                           |
| iOS PWA limits (no Background Sync, storage eviction)         | Flush on foreground, `storage.persist()`, server as source of truth                                                                       |
| Single VPS is a single point of failure                       | Litestream point-in-time restore; the app keeps working offline during an outage                                                          |
| SQLite single writer                                          | Fine for 50–100 users; Postgres swap path preserved by module `repo` boundaries                                                           |
| Scope creep                                                   | Milestones with explicit exit criteria; extras live in M4                                                                                 |

## 15. Parked: React Server Components

Not part of v1 or the roadmap. If revisited: `@vitejs/plugin-rsc` on the existing Vite setup, a **read-only** endpoint for reports and history only, and **no Server Functions** (the Dec 2025 critical RCE [CVE-2025-55182](https://github.com/advisories/GHSA-fv66-9v8q-g76r) was in Flight deserialization at Server Function endpoints, and offline mutation replays need a stable JSON API anyway). It would sit beside the offline-first path, not replace it, because an offline PWA cannot render on a server. The earlier, more detailed RSC design is in this file's git history (commit `00dab86`).
