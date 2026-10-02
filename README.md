# Group Budget

Track personal and shared expenses in an installable app that works offline. Indian rupees only.

- **Frontend** — React 19 PWA (Vite, Tailwind v4, shadcn/ui), local-first.
- **Backend** — Hono on **Cloudflare Workers**, with **D1** (SQLite) through Drizzle.
- **Shared** — pure TypeScript (money, dates, zod schemas) used by both.

One Worker serves the API and the built web app from the same origin, so there is no CORS and session
cookies just work. Everything is TypeScript. The design, roadmap and decisions are in
[`docs/PLAN.md`](docs/PLAN.md).

**Status:** M0 (foundations) is done and runs on Workers + D1: an installable PWA shell that reloads
and deep-links offline, a Worker API with `/api/healthz`, and a Drizzle schema with its first
migration. Accounts, expenses and groups are the next milestones.

## Quick start

Requires Node 26 (see `.nvmrc`), which bundles npm 11. No Cloudflare account is needed for local
development.

```sh
npm ci
cp apps/server/.dev.vars.example apps/server/.dev.vars   # local-only settings and secrets
npm run dev     # applies migrations to a local D1, then Worker on :8787 + Vite on :5173
```

Open <http://localhost:5173>. Vite proxies `/api` to the Worker (`wrangler dev`, which runs the real
`workerd` runtime with a simulated D1 kept in `apps/server/.wrangler`).

## Layout

```
apps/web         React PWA                          (@budget/web)
apps/server      Hono Worker + Drizzle + D1          (@budget/server)
packages/shared  pure TS, no I/O                     (@budget/shared)
e2e              Playwright tests
```

Dependency direction is `web → shared ← server`; `shared` imports nothing of ours, and `web` and
`server` never import each other. Biome's `noRestrictedImports` rule (see `biome.json`) enforces it.

## Scripts (run from the repo root)

| Command                                 | What it does                                                              |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `npm run dev`                           | Local D1 migration, then Worker and Vite dev servers together             |
| `npm run build`                         | Builds the web app, then bundles the Worker with a dry-run deploy         |
| `npm test`                              | Unit tests (Vitest); the server's run inside `workerd` against a real D1  |
| `npm run e2e`                           | Builds, then runs Playwright against `wrangler dev` serving the build     |
| `npm run typecheck`                     | Regenerates Worker types, then `tsc` for every workspace                  |
| `npm run lint`                          | Biome: lint, format and import-order check (read-only, what CI runs)      |
| `npm run lint:fix` / `npm run format`   | Apply Biome's fixes / formatting                                          |
| `npm run check:ts-only`                 | Fails if any `.js/.jsx/.mjs/.cjs` source file is tracked                  |
| `npm run db:generate`                   | Generate a Drizzle migration after editing `apps/server/src/db/schema`    |
| `npm run db:migrate:local`              | Apply migrations to the local simulated D1                                |
| `npm run deploy`                        | Build the web app and deploy the Worker (needs a Cloudflare login)        |

Migrations live in `apps/server/drizzle`, are committed, and are applied by Wrangler
(`wrangler d1 migrations apply`), not at Worker startup.

## Deploying to Cloudflare

The deploy path is drafted but has not been run against a real account yet.

1. `npx wrangler login`, then create the database near your users:
   `npx wrangler d1 create group-budget --location apac` (run from `apps/server`).
2. Put the printed `database_id` into `apps/server/wrangler.jsonc`.
3. `npm run db:migrate:remote -w @budget/server`, then `npm run deploy`.
4. The app is live at `https://group-budget.<your-subdomain>.workers.dev`. A custom domain can be
   attached later in the Cloudflare dashboard; note that an installed PWA is tied to its origin.

Secrets are set with `npx wrangler secret put <NAME>` from `apps/server`, never committed. For
automated deploys see `.github/workflows/deploy.yml`.

## Notes

- **TypeScript only.** Config files are `.ts` too (`vite.config.ts`, `vitest.config.ts`,
  `playwright.config.ts`, ...). `wrangler.jsonc`, `biome.json` and `tsconfig*.json` are the only
  non-code config. CI runs `check:ts-only`.
- **Node 26 and npm 11.** npm 10 (Node 22) crashes resolving Vitest's peer set, so changing
  dependencies needs npm 11+. npm 11 also refuses to run dependency install scripts unless they are
  approved; `allowScripts` in `package.json` approves the two that ship native binaries
  (`esbuild`, `workerd`). A new dependency that needs one shows a warning; approve it with
  `npm install-scripts approve <pkg> --no-allow-scripts-pin` after checking it is trustworthy.
- **Vitest is on 4.x** because Cloudflare's Workers test pool does not support 5 yet.
- **Types for the Worker bindings** are generated into `apps/server/worker-configuration.d.ts`
  (gitignored). `npm run typecheck` regenerates them; run `npm run cf-typegen -w @budget/server`
  once so your editor sees them.
- **Biome** replaces ESLint and Prettier. It does not format Markdown or YAML, so keep those tidy by
  hand. `apps/web/src/components/ui` (generated shadcn code) is linted but not reformatted.
- **Adding shadcn components.** From `apps/web`: `npx shadcn@latest add <component>`
  (`components.json` is already configured). Generated files land in `src/components/ui`.
- **e2e in a sandbox with a pre-installed Chromium:** set `PLAYWRIGHT_CHROMIUM_PATH` to its binary.
  In CI, Playwright installs its own.
