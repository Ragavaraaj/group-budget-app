[← Plan overview](PLAN.md)

# Repository layout

```
group-budget-app/
├─ package.json            npm workspaces: ["apps/*", "packages/*", "tools/*"]; root scripts
├─ tsconfig.base.json · biome.json · playwright.config.ts
├─ docs/PLAN.md            (plus one document per topic)
├─ packages/
│  └─ shared/              @budget/shared — pure TS, no I/O
│     ├─ src/              money · dates · periods (month start day, Indian FY) · ids (UUIDv7) · crypto (token + SHA-256, one copy for both sides) · splits · balances (+ settle-up)
│     │                    reports (summaries, trends) · budgets (status) · recurring (dates, derived ids)
│     │                    limits · defaults (default categories)
│     │                    schemas/ (zod: entities, sync mutations/pull, API payloads) · index.ts
│     └─ test/             unit and property tests (Vitest + fast-check), mirroring src/
├─ apps/
│  ├─ server/              @budget/server — Hono on Cloudflare Workers + Drizzle on D1
│  │  ├─ wrangler.jsonc    Worker config: D1 binding, static assets, vars
│  │  ├─ .dev.vars.example local-only settings/secrets (copy to .dev.vars)
│  │  ├─ drizzle.config.ts · vitest.config.ts
│  │  ├─ drizzle/          generated SQL migrations (committed; applied by Wrangler)
│  │  ├─ test/             unit tests mirroring src/ (run in workerd) · apply-migrations · helpers (cookie-keeping Client) · sync-helpers
│  │  └─ src/
│  │     ├─ index.ts       the Worker: fetch (Hono app, and /api/live), scheduled, exports LiveHub
│  │     ├─ app.ts         Hono app factory (what tests import)
│  │     ├─ config.ts      bindings → validated config (zod); secure-by-default
│  │     ├─ logger.ts      one JSON line per event (Workers Logs)
│  │     ├─ db/            client.ts · batch.ts (atomic batch + server_seq helpers) · schema/*.ts
│  │     ├─ modules/
│  │     │  ├─ auth/       routes (Google, attempt-login, dev) · repo · google (arctic) · pages · cookies · tokens · me
│  │     │  ├─ sync/       routes · push · pull · mappers
│  │     │  ├─ groups/     routes · repo (groups, invites, members, hand-over, delete, placeholders)
│  │     │  ├─ recurring/  generate (the hourly job)
│  │     │  └─ live/       hub (the Durable Object) · connect (/api/live) · notify
│  │     └─ middleware/    request-logger · session · origin-check
│  └─ web/                 @budget/web — React + Vite PWA
│     ├─ index.html · vite.config.ts · vitest.config.ts · components.json (shadcn)
│     ├─ public/           icons, favicon, _headers (CSP + caching)
│     ├─ test/             unit tests mirroring src/ (Node + fake-indexeddb) · helpers (row builders, scripted FakeApi)
│     └─ src/
│        ├─ main.tsx · App.tsx (routes)
│        ├─ components/ui/ shadcn components (copied, ours to edit)
│        ├─ components/    app shell, sync chip, banners, category icons, spinner
│        ├─ lib/           utils (cn) · api client · format · export · local-errors · zod-config.ts
│        ├─ db/            Dexie schema · tables (entity → table) · repo (local writes + outbox) · apply (pulled rows) · hooks (live queries)
│        ├─ sync/          api · engine (push, pull, backfill, polling) · live (WebSocket channel)
│        ├─ auth/          auth context · sync/db provider · attempt-login · storage
│        ├─ features/      auth · expenses · categories · groups · settings · status
│        │                 insights · budgets · search · recurring · import
│        │                 each: pages, components, pure helpers (unit-tested under test/features/)
│        └─ pwa/           SW registration · install prompt · standalone check · update toast · when an update is applied (policy, loop guard, per-tab reload) · build id
├─ e2e/                    Playwright specs, one file per area (listed in testing.md) · helpers
├─ tools/
│  └─ sdlc/                @budget/sdlc — the AI SDLC pipeline's CLI (docs/ai-sdlc.md); no dependencies, run as `node tools/sdlc/src/cli.ts`
│     ├─ src/              decide (board rules, merge gate) · limits (usage limits) · state (progress comment) · plan · branch · review · lint-claude · bug-refs (pure, unit-tested)
│     │                    github · project (Projects v2) · repo · card · wip · env · commands/ (doctor, poll, events, stage, merge, checks) · cli.ts
│     ├─ schemas/          JSON schemas for Claude's structured output (plan, review, fix)
│     └─ test/             unit tests mirroring src/
├─ .claude/
│  ├─ agents/              custom agents: planner, code-reviewer, ui-engineer, server-engineer, sync-engineer, test-engineer, ui-reviewer, security-reviewer, ci-fixer, docs-writer
│  └─ skills/              project skills: the four sdlc-* stages, pre-push-checks, codebase-graph, db-migration, synced-entity, ui-feature, e2e-spec, report-bug, steward
└─ .github/
   ├─ workflows/           ci.yml (checks on PRs, e2e in three shards; merge to main also deploys) · backup.yml (nightly D1 export to R2, gated) · sdlc-*.yml (the AI SDLC: board, plan, implement, review, fix, merge, doctor)
   ├─ actions/             composite actions: claude-run, agent-env, playwright-browsers
   ├─ ISSUE_TEMPLATE/      the Bug form (bugs are issues on the board)
   └─ pull_request_template.md   starts with `Closes #<issue>`; the plan stays in the issue
```

**Dependency rules** (enforced by Biome's `noRestrictedImports`, for both package-name and relative imports):

| Package           | May import                                                |
| ----------------- | --------------------------------------------------------- |
| `packages/shared` | nothing (only external pure libs such as `zod`)           |
| `apps/server`     | `@budget/shared`, its own `src`                           |
| `apps/web`        | `@budget/shared`, its own `src` — **never `apps/server`** |
| `tools/sdlc`      | Node built-ins and its own `src` — **nothing from `apps/*` or `packages/*`** |

**Tooling decisions**

- **`@budget/shared` is consumed as TypeScript source** (its `exports` point at `src/index.ts`): Vite compiles it for the web and Wrangler's bundler (esbuild) for the Worker, so there is no build-ordering between packages.
- **Dev**: `npm run dev` applies migrations to a local simulated D1, then starts `wrangler dev` (Worker on 8787, running the real `workerd`) and Vite (5173); Vite proxies `/api` to the Worker.
- **Types for bindings** are generated by `wrangler types` into a gitignored `worker-configuration.d.ts`; `npm run typecheck` regenerates them.
- **Compatibility date** is pinned in `wrangler.jsonc` to `2026-08-01` because the Workers test pool bundles a slightly older `workerd` than Wrangler does; bump it deliberately when both support a newer one.
- **Web unit tests** run in Node with `fake-indexeddb` (`apps/web/vitest.config.ts`, separate from `vite.config.ts` so the PWA plugin isn't loaded); the e2e server is started by `npm run e2e:server -w @budget/server` with `ENVIRONMENT=development` and `ENABLE_DEV_LOGIN=1` and a persisted local D1.
- **Vitest is pinned to 4.x** because `@cloudflare/vitest-pool-workers` does not support 5 yet.
- **Node 26 (`.nvmrc`) with npm 11.** npm 10, which ships with Node 22, crashes resolving Vitest's peer set. npm 11 also skips dependency install scripts unless approved, so `allowScripts` in the root `package.json` approves `esbuild` and `workerd` (the two that ship native binaries); anything new that needs a script prompts a warning to review. Node 26 is the "Current" line at the time of writing and is expected to enter LTS in October under Node's usual schedule; the whole suite was verified on 26.10 with npm 11.19.
- **npm** (not pnpm) to keep the toolchain minimal.
