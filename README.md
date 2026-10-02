# Group Budget

Track personal and shared expenses in an installable app that works offline. Indian rupees only.

- **Frontend** — React 19 PWA (Vite, Tailwind v4, shadcn/ui), local-first.
- **Backend** — Node + Hono + Drizzle on SQLite.
- **Shared** — pure TypeScript (money, dates, zod schemas) used by both.

Everything is TypeScript. The full design, roadmap and decisions are in [`docs/PLAN.md`](docs/PLAN.md).

**Status:** M0 (foundations) is done: the workspace, CI, a Hono server with a Drizzle migration and
`/api/healthz`, and an installable PWA shell that reloads and deep-links offline. Expenses, accounts and
groups are the next milestones.

## Quick start

Requires Node 22.12+ (see `.nvmrc`).

```sh
npm install
npm run dev        # server on :3000, web on :5173 (Vite proxies /api to the server)
```

Open <http://localhost:5173>. Optional: copy `.env.example` to `.env` to change server settings.

## Layout

```
apps/web         React PWA            (@budget/web)
apps/server      Hono + Drizzle API   (@budget/server)
packages/shared  pure TS, no I/O      (@budget/shared)
e2e              Playwright tests
deploy           Dockerfile, Caddyfile, compose, Litestream (drafts)
```

Dependency direction is `web → shared ← server`; `shared` imports nothing of ours, and `web` and
`server` never import each other. Biome's `noRestrictedImports` rule (see `biome.json`) enforces it.

## Scripts (run from the repo root)

| Command                                 | What it does                                                           |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `npm run dev`                           | Server and web dev servers together                                    |
| `npm run build`                         | Production build of web (`apps/web/dist`) and server (`dist`)          |
| `npm test`                              | Unit tests (Vitest) in every workspace                                 |
| `npm run e2e`                           | Builds, then runs Playwright against the production build              |
| `npm run typecheck`                     | `tsc` for every workspace and the root config files                    |
| `npm run lint`                          | Biome: lint, format and import-order check (read-only, what CI runs) |
| `npm run lint:fix` / `npm run format`   | Apply Biome's fixes / formatting                                |
| `npm run check:ts-only`                 | Fails if any `.js/.jsx/.mjs/.cjs` source file is tracked               |
| `npm run db:generate`                   | Generate a Drizzle migration after editing `apps/server/src/db/schema` |

Migrations in `apps/server/drizzle` are committed and applied automatically when the server boots.

## Notes

- **TypeScript only.** Config files are `.ts` too (`vite.config.ts`, `tsup.config.ts`,
  `playwright.config.ts`, ...). CI runs `check:ts-only`.
- **Biome** replaces ESLint and Prettier (one fast tool for lint, format and import order). It does not
  format Markdown or YAML, so keep those tidy by hand. `apps/web/src/components/ui` (generated shadcn
  code) is linted but not reformatted.
- **Adding shadcn components.** From `apps/web`: `npx shadcn@latest add <component>`
  (`components.json` is already configured). Generated files land in `src/components/ui`.
- **e2e in a sandbox with a pre-installed Chromium:** set `PLAYWRIGHT_CHROMIUM_PATH` to its binary.
  In CI, Playwright installs its own.
- **Deploying.** The files in `deploy/` are drafts for a single VPS (Caddy + the server image +
  Litestream). The server Dockerfile's steps were verified by hand, but the image has not been built
  with Docker yet. See `docs/PLAN.md` section 9.
