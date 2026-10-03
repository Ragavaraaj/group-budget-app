# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repository. Humans: the
[README](README.md) and [`docs/PLAN.md`](docs/PLAN.md) are the primary docs; this file is the short
version for an agent that has to be useful without reading everything first.

## What this is

Group Budget: an offline-first PWA for personal and shared expenses, Indian rupees only.

- `apps/web` (`@budget/web`): React 19, Vite, Tailwind v4, shadcn/ui, Dexie (IndexedDB) as the source of truth.
- `apps/server` (`@budget/server`): Hono on a Cloudflare Worker, D1 through Drizzle, one Durable Object (live updates), an hourly cron (recurring expenses).
- `packages/shared` (`@budget/shared`): pure TypeScript with no I/O (money in paise, dates, periods, splits, balances, zod schemas), used by both sides.
- `e2e`: Playwright tests that run against `wrangler dev` serving the **built** web app and the API from one origin.

Dependency direction is `web -> shared <- server`. `web` and `server` never import each other; Biome's
`noRestrictedImports` enforces it.

## Use Graphify before reading files

This repo is set up for [Graphify](https://github.com/Graphify-Labs/graphify) (PyPI package
`graphifyy`, command `graphify`), which turns the code into a queryable knowledge graph so you can
find the relevant files without reading the whole tree. That is the main way to keep token use down
here: **query the graph first, then open only the files it points to.**

```sh
uv tool install graphifyy            # once per machine (or: pipx install graphifyy)
graphify extract . --code-only       # build/refresh graphify-out/graph.json (local AST, no API key, ~5 s)

graphify query "how does a push from the outbox reach D1?"   # BFS over the graph, capped at 2000 tokens
graphify path "SyncEngine" "pushMutations"                    # shortest path between two things
graphify explain "LiveHub"                                    # a node and its neighbours in plain language
graphify affected "resolveSplit"                              # what breaks if this changes
graphify god-nodes --top 10                                   # the architectural hubs
```

- `graphify-out/` is generated and **git-ignored**. Rebuild it after pulling or after large changes
  (`graphify extract . --code-only`); a stale graph is worse than none, so if a result disagrees with
  the file you open, trust the file.
- `--code-only` indexes code with tree-sitter on this machine: nothing leaves it and it costs no
  tokens. The docs in `docs/` are not indexed that way; read the relevant one directly (the table below).
- **The graph is refreshed on every commit** by Graphify's git hooks: `post-commit` re-extracts the
  changed code files in the background (code only, no LLM, nothing blocks the commit) and
  `post-checkout` rebuilds on a branch switch. Git hooks live in `.git/hooks` and are not versioned, so
  install them **once per clone**: `graphify hook install` (check with `graphify hook status`; remove
  with `graphify hook uninstall`). Progress and errors go to `~/.cache/graphify-rebuild.log`; skip a
  single commit with `GRAPHIFY_SKIP_HOOK=1 git commit ...`. If the hook is not installed, run
  `graphify update .` yourself after committing.
- `graphify hook install` also writes a `merge=graphify` line to `.gitattributes`. It is for a tracked
  `graph.json`, which this repo does not have, so delete that file instead of committing it.
- Graphify's Claude Code hook (`graphify claude install`, a `PreToolUse` hook plus a CLAUDE.md
  section) is **not** installed here; this section is the reference instead.
- Do not commit `graphify-out/`, and do not edit it by hand.

## Commands (run from the repo root)

| Command | What it does |
| --- | --- |
| `npm ci` | Install. Needs Node 26 and npm 11 (see `.nvmrc`); Node 22 also installs, with warnings |
| `cp apps/server/.dev.vars.example apps/server/.dev.vars` | Local-only settings; turns on the development sign-in |
| `npm run dev` | Migrates a local D1, then Worker on :8787 and Vite on :5173 |
| `npm run lint` / `npm run lint:fix` | Biome: lint, format, import order (CI runs the read-only one) |
| `npm run typecheck` | Regenerates Worker types, then `tsc` in every workspace |
| `npm test` | Vitest for all three packages (the server's run inside `workerd` against a real D1) |
| `npm run build` | Builds the web app, then bundles the Worker (dry-run deploy) |
| `npm run e2e` | Builds, then runs Playwright (`playwright.config.ts` starts `wrangler dev` itself) |
| `npx playwright test e2e/<file>.spec.ts` | One spec file, against an existing build (`npm run build` first) |
| `npm run check:ts-only` | Fails if a `.js/.jsx/.mjs/.cjs` source file is tracked |

CI (`.github/workflows/ci.yml`) runs: `check:ts-only`, `lint`, `typecheck`, `test`, `build`, `npm audit
--omit=dev --audit-level=high`, then `e2e`. Run the first five before pushing.

In a sandbox with a pre-installed Chromium, set `PLAYWRIGHT_CHROMIUM_PATH` to its binary (for example
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`). Do not run `playwright install` there.

## Conventions

- **TypeScript only**, config files included. No `.js` files.
- **Biome** formats (2 spaces, single quotes, trailing commas, 100 columns, semicolons) and lints.
  `noExplicitAny`, `noNonNullAssertion`, `noUnusedImports` and `useImportType` are errors. It does not
  format Markdown or YAML: keep those tidy by hand.
- **Money is integer paise** end to end; format with `@budget/shared`, never with floats.
- **Local-first**: the UI reads and writes Dexie; the sync engine (`apps/web/src/sync`) pushes an outbox
  and pulls changes. Online-only calls (auth, group management, invites) go through `lib/api.ts`.
  Every UI write to the local database goes through `lib/local-errors.ts`.
- **Migrations** live in `apps/server/drizzle`, are generated with `npm run db:generate`, committed,
  additive and forward-only.
- **shadcn components** are copied into `apps/web/src/components/ui` (linted, not reformatted).
- Prefer a unit test beside the code for pure logic; the React components themselves are covered by e2e.

## Testing

- Unit: `packages/shared` (Vitest + fast-check), `apps/server` (Vitest in `workerd`), `apps/web` (Vitest + fake-indexeddb).
- **E2E (`e2e/*.spec.ts`)**: Chromium with the Pixel 7 profile against the built app and the
  production-like Worker. The e2e server runs with `ENVIRONMENT=development` and `ENABLE_DEV_LOGIN=1`,
  so `POST /api/auth/dev-login` exists and the Google flow has a stand-in page.
  - Use the helpers in `e2e/helpers.ts`: `uniqueEmail` (the e2e database persists between runs, so
    every test needs fresh addresses), `devSignIn`, `newPerson` (a second device with its own cookies
    and local database), `waitForSynced`, `createGroup`, `addExpenseOn`, `pickDate`, `runScheduledJob`.
  - Prefer accessible locators (`getByRole`, `getByLabel`) and the `data-testid`s already in the app;
    assert with web-first `expect(...)`, never `waitForTimeout` to "let something finish".
  - Negative paths matter here: refused input, expired sessions, someone not allowed in, offline.
  - **Do not navigate away right after a click that writes.** Saves go to the local database
    asynchronously, so `click()` then `page.goto()` can drop the write. Wait for what the write
    shows (the saved row, a toast, the dialog closing) first, and be careful with assertions such as
    "no such link", which are also true on the page you are about to leave.
  - **The scheduled job is shared.** `runScheduledJob` runs the hourly job for every person's rules
    and handles only the 10 oldest-due per run. A test that saves a recurring rule and does not run
    the job must start it later (`startRuleLater` in `helpers.ts`), or it can starve the tests that do.
  - A calendar closes with an animation: `pickDate` and `clearDate` wait for it, so use them
    instead of clicking through the picker yourself.
  - Use `chooseOption` for drop-downs, so a test works whether the control is a native select or the
    shadcn Select (see BUG-005 in `docs/known-bugs.md`).
- What is and is not covered, with counts: [`docs/testing.md`](docs/testing.md). Update it when you add specs.
- **When a test finds a real bug**, do not weaken the test. Write the bug up in
  [`docs/known-bugs.md`](docs/known-bugs.md) (steps, expected, actual, cause, the test) and mark the
  test `test.fail(true, 'BUG-nnn: ...')` so it passes while the bug is open and fails when it is
  fixed. A failure caused by the test itself is not a bug: fix the test.

## Where the design lives

| Topic | Document |
| --- | --- |
| Overview and links | [`docs/PLAN.md`](docs/PLAN.md) |
| Architecture, repository layout | [`docs/architecture.md`](docs/architecture.md), [`docs/repository-layout.md`](docs/repository-layout.md) |
| Data model and sync protocol | [`docs/data-model.md`](docs/data-model.md), [`docs/sync.md`](docs/sync.md) |
| Sign-in, sessions, invites | [`docs/auth.md`](docs/auth.md), [`docs/security.md`](docs/security.md) |
| Screens, routes, UX | [`docs/frontend.md`](docs/frontend.md) |
| Hosting, deploy, backups | [`docs/infrastructure.md`](docs/infrastructure.md) |
| Roadmap, risks | [`docs/roadmap.md`](docs/roadmap.md), [`docs/risks.md`](docs/risks.md) |
| Bugs found by the tests, not yet fixed | [`docs/known-bugs.md`](docs/known-bugs.md) |

## Git

Work on a short-lived branch with a descriptive name (`test/...`, `feat/...`, `fix/...`, `chore/...`),
never directly on `main`. `main` deploys to Cloudflare once CI is green.
