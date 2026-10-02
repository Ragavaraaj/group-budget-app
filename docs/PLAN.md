# Group Budget App — Architecture & Plan

Status: **draft v1** · Scope: architecture and roadmap only, no code yet.

## 1. Goals and constraints

| | |
|---|---|
| **Product** | Track all expenses: personal spending, plus shared groups with splits, balances and settle-up. |
| **Cost** | No hardware. One small VPS and nothing else that bills monthly (a domain is the only other unavoidable cost). |
| **Client** | PWA, plain React (no Next.js), installable, **usable offline** (entering an expense at the till must never fail). |
| **Server rendering** | Custom React Server Components (RSC). Explicitly *lower priority*, so the architecture must work without it and let it slot in later. |

Assumptions (flip any of these and the plan changes — see §13):
- Users: you, family and friends — dozens, not thousands.
- "Personal" and "group" are the same thing: every user gets a private group of one. One code path, no special cases.
- Single currency per group at first; multi-currency is a later milestone.

## 2. Decisions at a glance

| Area | Choice | Why | Escape hatch |
|---|---|---|---|
| Hosting | 1 small VPS (1 vCPU / 1–2 GB RAM), Caddy in front | Cheapest viable; Caddy gives free auto-HTTPS | Any provider; nothing is provider-specific |
| Server | Node (current LTS) + **Hono** + TypeScript | Tiny, fast, runs the same on any host | Fastify |
| Database | **SQLite** (WAL) via `better-sqlite3`, **Drizzle** for schema and migrations | Zero extra process or RAM, trivially backed up, plenty for this scale | Postgres via Drizzle, kept behind `server/data/*` |
| Backups | **Litestream** → Backblaze B2 / Cloudflare R2 free tier | Continuous, point-in-time restore, ~$0 | Nightly `sqlite3 .backup` + restic |
| Client | React 19 + TypeScript + **Vite**, React Router, Tailwind, Radix primitives | Standard, small, fast to build | — |
| Local data | **Dexie** (IndexedDB) with live queries | Offline source of truth for the UI; mature | SQLite-WASM + OPFS |
| Sync | Custom **outbox + cursor pull**, SSE nudge | Expense data is append-mostly; no CRDT/sync-engine dependency needed | Replicache / PowerSync / Zero if it gets hairy |
| Auth | **Passkeys** (WebAuthn) + password fallback, cookie sessions | No email/SMS provider cost; cookie auth also works for RSC | Magic links via free SMTP tier later |
| RSC | **`@vitejs/plugin-rsc`** on the existing Vite setup, read-only, no Server Functions | Framework-agnostic, you own the entry points | `react-server-dom-parcel` / `-webpack` |
| Validation | **zod** schemas in `shared/`, used on client and server | One definition of every payload | — |
| CI/CD | GitHub Actions → container image on GHCR → SSH deploy | Free, simple | rsync + systemd |

## 3. The central design tension: offline PWA vs. RSC

RSC renders on the server. An offline PWA, by definition, cannot reach the server. These pull in opposite directions, so the app has **two data paths** and each feature picks one deliberately:

```
                        ┌────────────── Browser (PWA) ───────────────┐
                        │  React SPA shell (precached by SW)         │
                        │                                            │
 PATH A — hot path      │  UI ⇄ Dexie (IndexedDB)  ← source of truth │
 offline-first          │        │ outbox                            │
 (all writes, lists,    │        ▼                                   │
  add/edit expense)     │  sync engine ──────────────┐               │
                        │                            │               │
 PATH B — online-only   │  <RscRoute> ◄── Flight ────┼──┐            │
 (reports, archive)     └────────────────────────────┼──┼────────────┘
                                                     │  │
                                          HTTPS (Caddy, HTTP/2+3)
                                                     │  │
                        ┌────────── VPS ─────────────▼──▼────────────┐
                        │ Node + Hono                                │
                        │  /api/sync/push|pull   (JSON + zod)        │
                        │  /api/auth/*           (WebAuthn, session) │
                        │  /api/events           (SSE "changes!")    │
                        │  /rsc/*                (GET-only Flight)   │
                        │            │                               │
                        │      server/data/*  (single data layer)    │
                        │            │                               │
                        │       SQLite (WAL) ── Litestream ──► B2/R2 │
                        │       /data/attachments ── restic ──► B2   │
                        └────────────────────────────────────────────┘
```

- **Path A (everything that matters day-to-day):** the UI reads and writes only the local IndexedDB. A sync engine reconciles with the server in the background. Works fully offline.
- **Path B (RSC, later):** heavy, read-only, online views — reports, long-range history. Rendered on the server and streamed as a Flight payload; the service worker caches the last payload per user for stale-while-revalidate, and offline falls back to a client-side computation from Dexie.

Honest take on RSC value here: for a few thousand rows, client-side aggregation is fine. RSC earns its place by (1) shipping charts as server-rendered SVG with **zero client JS**, (2) serving history that is too old/large to sync to the device, and (3) being the thing you want to build. That is why it's a later milestone, not a foundation.

**Hard rules that keep the two paths clean**
1. Every mutation goes through the **JSON sync API**, never a Server Function. Offline replays must hit a stable, versioned endpoint (Server Function IDs change between builds), and see the security note in §8.
2. All reads of business data go through `server/data/*` functions, shared by the sync API and (later) RSC. Components never touch the DB directly.
3. Pure logic (money, splits, balances, reports math) lives in `shared/` with no I/O, so it runs identically in the browser, the server and tests.

## 4. Data model (server, SQLite)

IDs are **UUIDv7** generated on the device (sortable, and makes offline creates idempotent).

```
users            id, display_name, created_at
credentials      id, user_id, webauthn_public_key, counter, transports      -- passkeys
password_creds   user_id, argon2id_hash                                      -- fallback
sessions         id_hash, user_id, expires_at, user_agent
groups           id, name, currency, is_personal, created_by
memberships      group_id, user_id, role (owner|member), joined_at
invites          id_hash, group_id, expires_at, used_by            -- signed, single-use
categories       id, group_id, name, icon, color, archived
expenses         id, group_id, occurred_on, amount_minor, currency,
                 category_id, note, created_by,
                 version, updated_at, deleted_at, server_seq
expense_payers   expense_id, user_id, amount_minor      -- who paid (can be several)
expense_shares   expense_id, user_id, amount_minor      -- who owes what
settlements      id, group_id, from_user, to_user, amount_minor, occurred_on, ... (sync cols)
budgets          id, group_id, category_id?, period, amount_minor
recurring_rules  id, group_id, template, rrule, next_run_on
attachments      id, expense_id, path, mime, size_bytes             -- phase 5
processed_mutations  mutation_id, user_id, applied_at                -- idempotency
audit_log        id, mutation_id, user_id, entity, entity_id, before, after, at  -- append-only
```

Rules:
- **Money is integer minor units** (cents/paise) plus an ISO-4217 currency. No floats anywhere. Display with `Intl.NumberFormat`.
- **Splits**: equal / exact / percent / shares. Remainder cents are distributed with the largest-remainder method so `sum(shares) == total` always holds (property-tested).
- **Balances are derived, never stored**: `net(user) = Σ paid − Σ owed ± settlements`. Cached/materialized only if profiling says so.
- **Settle-up** uses greedy debt simplification (min-cash-flow) to minimise the number of transfers.
- Every synced table has `server_seq` (monotonic, assigned by the server on each write), `updated_at`, `deleted_at` (tombstone, never hard-delete synced rows).
- Multi-currency (later): store the original amount + currency and the FX rate captured at entry time; never recompute history from today's rate.

## 5. Sync protocol

Why custom: expenses are append-mostly, edits are rare and rarely concurrent, so last-writer-wins at row level is acceptable and a CRDT is overkill.

**Client**
- Local writes go to Dexie *and* an `outbox` table `{mutationId, type, payload, baseVersion, createdAt}` in one transaction → UI updates instantly (optimistic by construction).
- Flush triggers: app start, `online` event, `visibilitychange → visible`, after each local write, and Background Sync where supported (Chromium only — iOS Safari lacks it, so foreground triggers are the primary mechanism, not a fallback).
- Pull triggers: same as above, plus an SSE `changes-available` nudge.

**Server**
- `POST /api/sync/push` — array of mutations. One transaction per batch; `processed_mutations` makes retries idempotent. Per-mutation result: `applied | rejected(reason)`. Authorization (membership + role) is checked per mutation; the server is the only authority.
- `GET /api/sync/pull?since=<server_seq>&limit=N` — rows from the user's groups with `server_seq > since`, including tombstones; paginated; returns the new cursor.
- `GET /api/events` — SSE stream that only says "something changed"; the client then pulls. Cheap on a small VPS, no WebSocket infrastructure.

**Conflicts**
- Row-level LWW by server arrival order. Delete wins over concurrent edit.
- If `baseVersion` is stale the server still applies LWW but flags it; the UI shows a small "edited by X while you were offline" notice. Revisit field-level merge only if this proves annoying in practice.

**Safety nets** (sync bugs are the main way this app can lose data)
- An append-only `audit_log` (mutation id, user, entity, before/after JSON, timestamp) is written in the same transaction as every applied mutation. `server_seq` alone only gives the *latest* state of each row, so without this a bad merge or a bug can't be diagnosed or undone.
- "Export everything as JSON/CSV" is available from day one.
- Integration tests simulate two offline clients with interleaved edits, replays, and tombstones (§10).

## 6. Frontend

- **Routing/shell**: React Router; the whole shell is precached by the service worker.
- **State**: Dexie live queries are the source of truth. Local React state for UI only. No Redux. A tiny `fetch` wrapper for non-synced online calls (auth, invites).
- **Forms**: react-hook-form + shared zod schemas.
- **Styling**: Tailwind (mobile-first, dark mode) + Radix primitives for accessible dialogs/selects/popovers.
- **Charts**: hand-written SVG components (bars, donut, line). **They must be pure — no hooks, no browser APIs** — so the same components are valid as Server Components in the RSC phase and as Client Components before it. Avoids a heavy chart library.
- **UX priorities** (this is what makes expense apps stick): amount-first entry in ≤3 taps; defaults from last-used category/payer/group; always-visible sync/offline indicator; undo on delete; fast list with virtualization once it exceeds a few thousand rows.

**PWA specifics**
- `vite-plugin-pwa` in `injectManifest` mode (custom service worker, Workbox modules).
- Caching: precache shell + assets; `/api/*` network-only (the sync engine owns it); `/rsc/*` stale-while-revalidate, **cache key scoped to the user and purged on logout**.
- Update flow: "New version available — reload" prompt; never auto-reload mid-entry.
- Manifest: `standalone`, 192/512/maskable icons, app shortcut "Add expense".
- Call `navigator.storage.persist()`. Safari can evict IndexedDB for non-installed sites; the server remains the source of truth, so eviction is recoverable by re-pulling — but un-synced outbox items would be lost, which is why flush-on-foreground matters.
- iOS caveats: push works only for installed PWAs (16.4+); no Background Sync.

## 7. RSC plan (Phase 4 — deliberately last)

**Integration**: `@vitejs/plugin-rsc`. It is framework-agnostic and built on Vite's Environment API: an `rsc` environment (server components, `react-server` condition), an optional `ssr` environment, and the `client` environment. A minimal template exists (`npm create vite@latest -- --template rsc`). Because the SPA is already on Vite, adoption is additive. "Custom" means you own the three entry points: the **rsc entry** (URL → server component tree → Flight stream), the **ssr entry** (optional) and the **browser entry**.

**Decisions**
- **No SSR HTML at first.** The shell is static and precached; RSC payloads are fetched client-side with `createFromFetch` and rendered inside a client `<RscRoute>` boundary in the SPA. Fewer moving parts, and it fits the offline model. Add SSR later only if first-paint online matters.
- **Read-only RSC endpoint**: `GET /rsc/<route>?…`, authenticated by session cookie, `Cache-Control: private`, `Vary: Cookie`.
- **No Server Functions / `"use server"`** for expenses (see §3 rule 1 and §8).
- **Candidate server components**: Reports (monthly summary, category breakdown, trends as SVG), History archive (paginated, beyond the local sync window), group-wide "who owes whom over time".
- **Spike required first**: validate that mounting an RSC subtree inside a client-routed SPA (hybrid) works cleanly with the plugin's browser entry, including client navigation, and that the SW stale-while-revalidate cache plays well with Flight streams. If the hybrid fights the tooling, fall back to RSC-only for `/reports/*` as a separate document served by the same server.
- **Prep work in earlier phases** (cheap, avoids a rewrite): keep route components split into a *data-shaping* part and an *interactive* part; keep DB access behind `server/data/*`; keep charts pure.

## 8. Security

- **Auth**: passkeys via SimpleWebAuthn + argon2id password fallback. No email provider needed initially; account recovery via one-time recovery codes shown at signup. The WebAuthn RP ID is bound to your domain — **pick the domain before anyone registers a passkey**.
- **Sessions**: random 256-bit token, only its hash stored; `HttpOnly; Secure; SameSite=Lax`; sliding expiry; revoke-all on password change.
- **CSRF**: `SameSite` + `Origin` header check on all non-GET requests.
- **AuthZ**: membership and role checked per request and per mutation, server-side. Never trust a `group_id` from the client.
- **Rate limiting** on auth and invite endpoints; invites are signed, expiring and single-use.
- **Input**: zod-validate every inbound payload; Drizzle parameterized queries only.
- **Headers**: strict CSP (no inline scripts; hash/nonce the service-worker bootstrap), HSTS (Caddy), `X-Content-Type-Options`, `Referrer-Policy`.
- **RSC-specific**: in Dec 2025 a critical pre-auth RCE ([CVE-2025-55182](https://github.com/advisories/GHSA-fv66-9v8q-g76r), "React2Shell") was found in the Flight deserialization used by Server Function endpoints in `react-server-dom-*` (19.0.0–19.2.0; fixed in 19.0.1 / 19.1.2 / 19.2.1). Since "custom RSC" means you own that surface: (1) don't expose Server Function endpoints at all (our design), (2) pin patched-or-newer versions and verify against current advisories when starting Phase 4, (3) enable Dependabot.
- **Host**: SSH keys only, `ufw` (22/80/443), `unattended-upgrades`, app runs as a non-root user.

## 9. Infrastructure and operations (single VPS)

```
Internet ─► Caddy :443 (auto-TLS) ─► Node app :3000 ─► SQLite /data/app.db
                                          │
                              Litestream sidecar ──► B2/R2 bucket
                              restic (nightly, attachments) ──► B2
```

- **Process management**: Docker Compose (`app`, `caddy`, `litestream`) or three systemd units. Compose recommended — reproducible and one-command rollback by image tag.
- **Deploy**: push to `main` → CI (typecheck, lint, tests, build) → image to GHCR → SSH `docker compose pull && up -d`. Migrations run on boot. A ~1 s restart is acceptable because clients are offline-tolerant.
- **Backups**: Litestream continuous replication; **practice a restore** into a scratch directory in M0 (an untested backup is not a backup). Weekly cron verifies the replica is fresh.
- **Observability**: pino JSON logs, `/healthz`, healthchecks.io (free) pinged by cron and by Litestream health; UptimeRobot (free) on the public URL.
- **Capacity sanity check**: Node ≈ 100–200 MB, Caddy ≈ 20–40 MB, Litestream ≈ 30 MB — fits 1 GB with headroom. SQLite single-writer is fine for this user count.

**Cost** (approximate, verify current pricing)

| Item | Cost |
|---|---|
| VPS 1 vCPU / 1–2 GB | roughly $4–6 / month (or an always-free ARM tier if you can get one) |
| Domain (needed for HTTPS, WebAuthn, PWA install) | roughly $10–15 / year |
| TLS | free (Caddy / Let's Encrypt) |
| Backups | free tier (B2 10 GB; R2 free tier) |
| CI | free GitHub Actions minutes |
| Web Push | free (self-hosted VAPID) |
| Email | none in v1 |

## 10. Testing and quality

- **`shared/` (Vitest + fast-check)**: property tests — splits always sum to total; balances across a group sum to zero; settle-up fully clears balances in ≤ n−1 transfers; no float drift.
- **Sync (Vitest)**: server against in-memory SQLite plus `fake-indexeddb` clients. Scenarios: offline edits on two devices, duplicate pushes (idempotency), delete vs. edit, pagination cursors, revoked membership.
- **E2E (Playwright, Chromium)**: add expense offline (`context.setOffline`) → reconnect → appears on second context; PWA installability checks.
- **Static**: strict TypeScript, ESLint (flat config) with `no-restricted-imports` enforcing boundaries (`client` ↛ `server`, `shared` ↛ both), Prettier.
- **CI gates**: typecheck, lint, unit, e2e, build. Dependabot on.

## 11. Repository layout

One package to start (the Vite RSC plugin wants a single Vite config anyway); split into workspaces only when something genuinely needs it.

```
group-budget-app/
├─ docs/PLAN.md
├─ src/
│  ├─ shared/     # pure TS, zero I/O: money, splits, balances, settle-up, zod schemas
│  ├─ client/     # SPA: routes, components, db (Dexie), sync (outbox), service worker
│  ├─ server/     # Hono app: auth, sync API, data/* access layer, jobs, healthz
│  └─ rsc/        # Phase 4: rsc entry, server components (reports, archive)
├─ migrations/    # Drizzle SQL migrations
├─ deploy/        # docker-compose.yml, Caddyfile, litestream.yml
├─ e2e/           # Playwright
└─ .github/workflows/
```

## 12. Roadmap

Each milestone ends in something you can use on your phone.

| # | Milestone | Scope | Exit criteria |
|---|---|---|---|
| **M0** | Foundations | Vite+React+TS scaffold, lint/test/CI, installable PWA shell, VPS + Caddy + domain, Litestream backups | App installable at your domain; **a backup restore has been performed successfully** |
| **M1** | Personal ledger, offline-first | Auth (passkey + password), Dexie schema, expense CRUD, categories, outbox + pull sync, SSE | Add expenses in airplane mode on phone; they appear on a second device after reconnect |
| **M2** | Groups | Invites, memberships, split types, balances, settle-up, activity feed | Two people run a trip's expenses and the balances match a hand calculation |
| **M3** | Insights | Client-side monthly/category/trend reports (pure SVG), budgets + alerts, search/filter, CSV import/export, recurring expenses | Month-end review is possible without leaving the app |
| **M4** | **RSC** | Spike (§7) → server-rendered reports and history archive; measure payload sizes and JS shipped | Reports render from RSC online and degrade to client-side offline |
| **M5** | Extras (pick as needed) | Receipt photos (client-side compression, stored on VPS disk), multi-currency with stored FX rates, Web Push, bank-CSV import presets | — |

## 13. Open questions

1. **Personal only, or shared groups too?** The repo name suggests groups; I assumed both. Personal-only would drop M2's balance/settle-up work (roughly a third of the domain logic).
2. **Multi-currency early?** It touches the data model and every report. If travel is a main use case, pull it into M2.
3. **Domain**: do you own one, or will you register one? It must be permanent (passkeys are bound to it).
4. **Receipt photos in v1?** Adds storage, backup and upload-size concerns; I put them in M5.
5. **RSC end state**: is "reports via RSC" enough, or do you eventually want the whole app server-rendered (which conflicts with offline-first)?

## 14. Risks

| Risk | Mitigation |
|---|---|
| Sync bug loses data | Idempotent mutations, tombstones, server-authoritative log, two-client integration tests, always-available export |
| iOS PWA limits (no Background Sync, storage eviction) | Flush on foreground, `storage.persist()`, server as source of truth |
| Single VPS is a single point of failure | Litestream point-in-time restore; app keeps working offline during an outage |
| RSC churn and security | Isolated in M4, pinned versions, no Server Functions, read-only endpoint |
| SQLite single writer | Fine at this scale; Postgres swap path preserved by the `server/data/*` boundary |
| Scope creep | Milestones with explicit exit criteria; extras live in M5 |
