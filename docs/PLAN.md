# Group Budget App — Plan

Status: **draft v6** · Scope: architecture and roadmap, split into the documents below. **M0 to M3 and most of M4 are built and verified locally** (unit, `workerd` and real-browser end-to-end tests); M0–M2 are deployed. What is left before real use is Google sign-in setup, a trial on real phones, and the first real run of the Durable Object, the scheduled job and the R2 backup ([Roadmap](roadmap.md)).

**What changed in v6:** insights (month and Indian financial year, hand-drawn SVG charts), search, budgets with warnings, recurring expenses made by an hourly Worker job, bank-statement CSV import, a configurable month start day, live updates over a Durable Object WebSocket hub, stopping invite links one by one, handing a group over, deleting a group, people added by name who don't use the app, and a gated nightly export to R2. Web Push, the UPI deep link and an in-app allow-list admin were left out on purpose, with reasons in the [Roadmap](roadmap.md#where-things-stand).

**What changed in v5:** the plan was filled in with what was actually built. The offline ledger (local database, outbox, sync engine), Google sign-in with the installed-app hand-back, groups with four split types, balances and settle-up exist and are tested end to end. Documents now describe the real design; the main departures from v4 are an expense's split stored as JSON on the expense row, an activity feed derived from the rows, one-group backfill when joining a group, OAuth state kept in D1, and plain React state instead of react-hook-form (all recorded in the [Roadmap](roadmap.md#decisions-and-open-questions)).

**What changed in v4:** hosting moved from a single VPS (Node, SQLite, Caddy, Litestream, Docker) to **Cloudflare** (one Worker serving the API and the web app, with D1 as the database). The M0 code was ported accordingly. That affects the data-write pattern (D1 has no interactive transactions), live updates (polling instead of SSE), backups, security headers, the dev/test setup, cost and the roadmap. Details are in the documents below.

## Documents

| Document | What it covers |
| --- | --- |
| [Architecture](architecture.md) | Components, data flow, the rules that keep the code clean |
| [Data model](data-model.md) | D1 tables, money and date rules, splits, balances, permissions, Drizzle workflow |
| [Sync protocol](sync.md) | Outbox, polling pull, push flow, conflicts, safety nets |
| [Frontend](frontend.md) | React shell, state, UI kit, UX priorities, PWA specifics |
| [Auth](auth.md) | Google sign-in, sessions, sign-up gate, installed-iOS attempt-login |
| [Security](security.md) | CSRF, authorization, rate limiting, headers, secrets, dependencies |
| [Infrastructure](infrastructure.md) | Cloudflare deploy, backups, limits, domain, cost |
| [Testing](testing.md) | Test layers, e2e, static checks, CI gates |
| [Repository layout](repository-layout.md) | Folder structure, dependency rules, tooling decisions |
| [Roadmap](roadmap.md) | Milestones M0–M4, status, decisions and open questions |
| [Risks](risks.md) | Risk register and mitigations; parked React Server Components |

## Goals and constraints

|              |                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Product**  | Track all expenses: personal spending, plus shared groups with splits, balances and settle-up.                                                     |
| **Cost**     | No hardware and no servers to run. Cloudflare's free tier should cover this at about $0/month (limits in [Infrastructure](infrastructure.md)); a domain, later, is the only likely cost. |
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
- **iPhones are in use** in the group, and the app is **installed from Chrome** ("Add to Home Screen"; no Safari). All iOS browsers use WebKit, so installed-iOS sign-in is a first-class requirement, solved by attempt-login ([Auth](auth.md)).
- **Domain**: later. Development and the iPhone confirmation run use the free `*.workers.dev` HTTPS address; buy a domain **before real users install the app** ([Infrastructure](infrastructure.md)).
- **Google Cloud OAuth client**: yours to create ([Auth](auth.md) has the steps); the app is built and tested without it (a stand-in runs the same callback code), but nobody can sign in on the deployed app until it and the Worker secrets exist ([Roadmap](roadmap.md)).
- **RSC**: parked ([Risks](risks.md#parked-react-server-components)). Nothing in v1 depends on it.

## Decisions at a glance

| Area       | Choice                                                                                                  | Why                                                                                                         | Escape hatch                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Hosting    | **Cloudflare Workers** + static assets + one Durable Object + an hourly cron; one Worker serves `/api/*` and the built PWA | Nothing to patch or restart; global edge; free tier fits; same-origin, so no CORS and cookies just work     | Hono and Drizzle are portable, so a Node host would need only a thin entry point |
| Server     | **Hono** + TypeScript, exported as the Worker's fetch handler                                           | Built for Workers, tiny, typed, easy to test (`app.request()`)                                              | —                                                                                |
| Database   | **D1** (SQLite) via **Drizzle** (`drizzle-orm/d1`); migrations are SQL files applied by Wrangler        | Managed SQLite, nothing to run, plenty for 50–100 users                                                     | Postgres via Drizzle, contained in `apps/server/src/db` and each module's repo   |
| Backups    | **D1 Time Travel** (point-in-time restore: 7 days on the free plan, 30 on paid, no extra cost), plus a nightly `d1 export` to a private R2 bucket (optional) | Time Travel is built in and always on; the export is the copy that lasts longer and doesn't depend on D1 | The R2 workflow skips itself until a bucket is set up                              |
| Client     | React 19 + TypeScript + **Vite**, React Router                                                          | Standard, small, fast                                                                                       | —                                                                                |
| UI         | **shadcn/ui** (Radix + Tailwind v4), `sonner` toasts; plain React state + shared zod schemas for forms  | Accessible components copied into the repo (we own them); consistent look; the one complex form is pure, tested logic | react-hook-form if forms multiply                                      |
| Local data | **Dexie** (IndexedDB) with live queries, one database per signed-in person                              | Offline source of truth for the UI                                                                          | SQLite-WASM + OPFS                                                               |
| Sync       | Custom **outbox + cursor pull**; clients **poll** (~30 s while visible, backing off), with a **Durable Object WebSocket hub** that says "pull now" while connected; one-group backfill when joining | Expense data is append-mostly; polling needs no persistent connections and is cheap at this scale; the hub makes it feel live and never carries data | Shard the hub by group; Replicache/PowerSync       |
| Writes     | Validate and read first, then one atomic **`db.batch([...])`**                                          | D1 has **no interactive transactions**; batch is its atomic primitive ([Data model](data-model.md), [Sync protocol](sync.md))                              | Durable Objects with SQLite if logic ever needs real transactions                |
| Auth       | **Google sign-in** (OAuth 2.0 authorization-code + PKCE, server-side) via `arctic`; own cookie sessions | No passwords to store, no email provider, no recovery flow; `arctic` uses only `fetch` and Web Crypto      | Add passkeys later                                                               |
| Currency   | **INR only**, integer paise, `Intl.NumberFormat('en-IN')` (lakh/crore grouping)                         | Removes FX and mixed-currency reports entirely                                                              | Add a `currency` column (default `'INR'`) via a normal migration                 |
| Validation | **zod** schemas in `packages/shared`, used by web and server                                            | One definition of every API payload                                                                         | —                                                                                |
| Tooling    | npm workspaces, **Wrangler**, Vitest 4 + Workers test pool, Playwright, **Biome**                       | Tests run in the real Workers runtime (`workerd`), so they catch what only works in Node                    | pnpm if workspaces get painful                                                   |
| CI/CD      | GitHub Actions: checks on every PR; a merge to `main` re-checks, migrates D1 and deploys (`wrangler`)   | Free, simple                                                                                                | Cloudflare's own Git integration (Workers Builds)                                |
