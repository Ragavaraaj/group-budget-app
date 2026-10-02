[← Plan overview](PLAN.md)

# Architecture and data flow

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
                         HTTPS (Cloudflare edge)                   │
        ┌────────────── One Cloudflare Worker ───▼───────────────▼───┐
        │ Static assets (apps/web/dist): the PWA, SPA fallback,       │
        │   headers from public/_headers                              │
        │ /api/* → Hono (Worker code runs only for these paths)       │
        │   /api/auth/google/start|callback  /attempt/*  /logout  /me │
        │   /api/sync/push|pull   (JSON + zod)                        │
        │   /api/groups/*  /api/invites/*     (online-only actions)   │
        │            │  modules/*/repo (Drizzle)                      │
        │            ▼                                                │
        │       D1 (SQLite) ── Time Travel backups                    │
        └─────────────────────────────────────────────────────────────┘
```

**Rules that keep the code clean**

1. Reads of business data in the UI come from Dexie. Writes go to Dexie + outbox, then sync. Only auth, group management (create, rename, remove/leave) and invites call the API directly (they need the server's say-so, so they are online-only); their results come back through the normal pull.
2. Server code touches the database only through each module's `repo`, never from route handlers directly.
3. Pure logic (money, splits, balances, settle-up, zod schemas) lives in `packages/shared` with no I/O, so it runs identically in the browser, the Worker and tests.
4. **Same-origin everywhere**: in production one Worker serves the API and the static files; in development Vite proxies `/api/*` to `wrangler dev`. No CORS, and cookies just work.
5. **D1 has no interactive transactions** (no `BEGIN`/`COMMIT` from the Worker). Do reads and validation first, then write everything in a single `db.batch([...])`, which commits or rolls back as a whole. This is verified by a test (`apps/server/src/db/schema.test.ts`: a failing statement rolls back the other statements in its batch).
6. **Every per-request query must use an index.** D1 limits are counted in rows _scanned_, not rows returned, so an unindexed filter on a growing table is both slow and a quota problem ([Infrastructure](infrastructure.md)).
7. **Config comes from Worker bindings**, parsed once with zod (`apps/server/src/config.ts`). `ENVIRONMENT` defaults to `production`, so a deployed Worker is safe unless something explicitly says otherwise (only `.dev.vars` and the test config do).
