---
name: pre-push-checks
description: Run the checks CI runs, in CI's order, plus the e2e spec for what changed, before any push. Use before every push, and to confirm a fix.
---

# The checks before a push

Run from the repository root. Stop at the first failure, fix it, and start again from that check.

```sh
npm run check:ts-only       # no .js/.jsx/.mjs/.cjs source files
npm run check:test-layout   # unit tests live in each package's test/, never in src/
npm run check:bug-refs      # every test.fail(...) names its bug issue: 'Bug #123: ...'
npm run lint:claude         # .claude agents and skills: frontmatter, references, model and effort
npm run lint                # Biome (npm run lint:fix to apply formatting)
npm run typecheck           # regenerates Worker types, then tsc everywhere
npm test                    # Vitest for every package (the server's inside workerd)
npm run build               # the web app, then a dry-run bundle of the Worker
```

Then the e2e spec(s) the change touches, against that build:

```sh
npx playwright test e2e/<file>.spec.ts            # one spec
npx playwright test e2e/<file>.spec.ts -g "title" # one test
```

- The e2e server needs `apps/server/.dev.vars` (copy `apps/server/.dev.vars.example`); the pipeline's
  runs already have it.
- In a sandbox with a pre-installed Chromium, set `PLAYWRIGHT_CHROMIUM_PATH` to its binary (for
  example `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`); never run `playwright install` there.
- The full suite is sharded in CI; run it locally (`npm run e2e`) only when the change is broad
  (routing, the service worker, sync, the app shell).
- A failing test is a finding, not an obstacle: fix the cause, or if it is a real separate bug,
  use the `report-bug` skill. Never skip or loosen it.
