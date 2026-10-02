[← Plan overview](PLAN.md)

# Roadmap

**v1 = M0 + M1 + M2.** Each milestone ends in something usable.

| #      | Milestone                      | Scope                                                                                                                                                                                                                                                                                                   | Exit criteria                                                                                                                                  |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** | Foundations — **done**         | Workspace, tooling, CI; Hono Worker with `/api/healthz`; Drizzle + D1 with the first migration; React shell with shadcn and an installable PWA; one-origin dev and e2e setup; drafted Cloudflare deploy                                                                                                  | `npm run dev` runs everything locally; CI green; the production build installs as a PWA and reloads offline against the real Worker runtime    |
| **M1a**| Personal ledger, offline-first | Dexie schema; expenses + categories CRUD; outbox + pull sync (polling) with `db.batch` writes and `server_seq`; indexes from [Data model](data-model.md); **dev-login** so no Google credentials are needed; JSON/CSV export; first deploy to `workers.dev`; **Time Travel restore drill**                                         | Add expenses in airplane mode on a phone; they appear on a second device after reconnect; a restore has been performed                          |
| **M1b**| Google sign-in                 | Google sign-in + sessions + sign-up gate; **attempt-login for installed apps ([Auth](auth.md)), built first and e2e-tested with two browser contexts**; per-user local DB; logout flow; not-installed banner; real-iPhone confirmation run on Chrome's "Add to Home Screen" at the `workers.dev` address                  | An iPhone (installed from Chrome) and an Android phone each sign in to the installed app; a friend joins through an invite link                |
| **M2** | Groups                         | Group create/rename, invites, memberships, split types (equal, exact, percent, shares), balances, settle-up, activity feed                                                                                                                                                                              | Two or three people run a trip's expenses and the balances match a hand calculation                                                            |
| **M3** | Insights                       | Monthly/category/trend reports (shadcn charts), budgets + alerts, search/filter, CSV import, recurring expenses (Worker Cron Trigger); configurable month start (calendar month or salary-cycle day) and a yearly view by Indian financial year (Apr–Mar)                                                 | Month-end review is possible without leaving the app                                                                                           |
| **M4** | Extras (pick as needed)        | Live updates over a Durable Object WebSocket hub; scheduled `d1 export` to R2; Web Push; bank-statement CSV import presets; UPI deep link on settle-up (`upi://pay?…`; verify it works across apps first); placeholder (non-user) group members; in-app admin for the allowlist; custom domain move       | —                                                                                                                                              |

M1 is split so build work does not wait on credentials you are creating later: M1a needs no Google setup at all, and M1b begins when the OAuth client exists. The iPhone sign-in risk is handled by design (attempt-login), so it no longer needs a spike before building.

**Status: M0 is done and running on Workers + D1** (branch `migrate-cloudflare`). Verified: TS-only guard, Biome, typecheck, **15 server tests inside `workerd`** and 40 shared tests; a dry-run Worker bundle (about 1 MB, 170 KB gzipped); and **6 end-to-end tests in real Chromium against `wrangler dev`** serving the built app and API from one origin: installable manifest, offline reload and deep-link, real security headers with zero CSP violations, immutable asset caching, `no-store` API responses. A negative control (service worker blocked) confirms the offline test would fail without the service worker. `npm run dev` was smoke-tested end to end (Vite proxying to the Worker).

**Not yet verified:** an actual deploy to a Cloudflare account (none is reachable from the build sandbox), the manual deploy workflow, and `arctic` on Workers. The Workers and D1 limits, Time Travel retention and restore commands, static-assets SPA routing, and `_headers` behaviour (it applies to static-asset responses only, never to Worker responses, which is why the API gets its headers from Hono) were confirmed against Cloudflare's own documentation on 2026-10-02.

M0 notes: `ui.shadcn.com` was unreachable from the build sandbox, so the shadcn sources were copied from the shadcn-ui GitHub repo (the same files the CLI installs, with the CLI's `cn` import rewritten and `next-themes` removed from sonner); `components.json` is configured, so `npx shadcn add` works normally elsewhere.

Out of scope (decided): multi-currency/FX, receipt photos or any attachments, passwords/passkeys. Parked: RSC ([Risks](risks.md#parked-react-server-components)).

## Decisions and open questions

**Decided**: see [Plan overview](PLAN.md#goals-and-constraints).

**Defaults I chose — say so if you want any changed**

- Sign-up gate = `ALLOWED_EMAILS` setting **or** a valid group invite token ([Auth](auth.md)).
- Any group member can edit any expense; everything is audit-logged ([Data model](data-model.md)).
- Logout wipes the local database for that user after warning about unsynced changes ([Sync protocol](sync.md)).
- Clients poll for changes (~30 s while visible) instead of holding a live connection; a Durable Object WebSocket hub is the M4 upgrade ([Sync protocol](sync.md)).
- Sessions are extended only when less than half their life remains, to save D1 writes ([Auth](auth.md)).
- D1 is created with the `apac` location hint ([Infrastructure](infrastructure.md)).
- Start on the free Cloudflare plan; move to the $5 plan only if a limit is hit ([Infrastructure](infrastructure.md)).

**Still open**

1. **Google Cloud OAuth client** — yours to create ([Auth](auth.md) lists the steps). It gates M1b and the real-iPhone confirmation run, **not M1a**.
2. **Domain name** — before real users install the app, not before. Decide whether to register it through Cloudflare.
3. **Cloudflare account** — a free account is enough to start; I will need you to run `wrangler login` and create the D1 database (README has the commands), since I can't reach your account from here.
