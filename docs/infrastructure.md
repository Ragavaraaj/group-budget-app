[← Plan overview](PLAN.md)

# Infrastructure and operations (Cloudflare)

```
Internet ─► Cloudflare edge ─► Worker "group-budget"
                                 ├─ static assets (apps/web/dist) ← everything except /api/*
                                 └─ /api/* ─► Hono ─► D1 database "group-budget"
```

- **Deploy**: automatic. A merge to `main` runs the `deploy` job of `.github/workflows/ci.yml` after the checks and e2e tests pass: build the web app, apply D1 migrations (`npm run db:migrate:remote`), then `wrangler deploy` (Worker and static assets in one step, stamped with the commit SHA as `APP_VERSION`). Migrations go first because a new Worker may rely on them; they are additive, so the old Worker keeps working meanwhile. Runs on `main` queue and are never cancelled (cancelling between migration and deploy would strand a migration); PR runs are cancelled when superseded. The job needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets and a real `database_id`; until they exist it skips with a warning instead of failing. "Run workflow" on `main` redeploys by hand, and a `production` environment with required reviewers adds an approval step. Alternative considered: Cloudflare's own Git integration (Workers Builds). The path is **not yet run** against a real account.
- **Worker secrets for sign-in**: set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `ALLOWED_EMAILS` as Worker **secrets** (`npx wrangler secret put <NAME>` from `apps/server`, or type _Secret_ in the dashboard). Do not set them as plain variables: the deploy job runs `wrangler deploy`, which overwrites plain variables that were set in the dashboard (secrets are never deleted by a deploy; `--keep-vars` would change that, per Cloudflare's docs). Until they exist nobody can sign in on the deployed app, because the dev login is off in production. The first deploy after M1/M2 also applies migrations 0001–0002 to the real database.
- **First-time setup** (README has the steps): create the database (`wrangler d1 create group-budget --location apac`; Asia-Pacific is the closest region to India) and paste its `database_id` into `apps/server/wrangler.jsonc`; create an API token (Workers edit plus D1 edit) and store it and the account id as repository secrets. Wrangler can also auto-provision a database on deploy when `database_id` is omitted (open beta, 4.45+); the explicit id is used instead so the `apac` location hint is deliberate and migrations never depend on a beta feature.
- **Backups**: **D1 Time Travel** restores to any minute in the last 7 days (free plan) or 30 days (paid), at no extra cost (Cloudflare's D1 release notes, checked 2026-10-02). **Practice a restore before launch**: `wrangler d1 time-travel info <db>` shows the current bookmark, and `wrangler d1 time-travel restore <db> --timestamp <RFC3339>` rolls back. A restore **overwrites the database in place** and prints a bookmark to undo it. For a copy that doesn't depend on Cloudflare, add a scheduled `wrangler d1 export` to R2 (M4).
- **Observability**: Workers Logs are enabled in `wrangler.jsonc`; the Worker logs one JSON line per request and per error. `/api/healthz` checks the database. Add an external uptime monitor if you want alerts.
- **Updates and rollback**: each deploy is a new Worker version; the dashboard (or `wrangler rollback`) reverts code instantly. Database changes are additive and forward-only, so rollback never needs an un-migrate.

**Limits to watch** (free plan; confirmed against Cloudflare's pricing and limits docs on 2026-10-02; limits can change, so recheck before launch)

| Limit                                  | Free plan                                                                            | Why it matters here                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Worker requests                        | 100,000 / day                                                                       | 100 users polling every 30 s for an hour a day is ~12,000/day; fine, but don't poll while hidden                                 |
| Worker CPU per request                 | 10 ms                                                                               | Handlers are small; time spent waiting on `fetch` (Google's token exchange) or on D1 does **not** count as CPU. Keep batch sizes modest                                    |
| D1 rows read / written per day         | 5 million / 100,000                                                                | Reads count **rows scanned** (a full scan of a 5,000-row table is 5,000 reads), so indexes ([Architecture](architecture.md) rule 6) are required. Exceeding a daily limit **pauses the database** (reads and writes fail) until the daily reset or an upgrade; upgrading lifts it within minutes |
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
