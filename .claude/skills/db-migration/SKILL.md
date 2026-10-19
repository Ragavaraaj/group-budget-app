---
name: db-migration
description: Change the D1 database schema the way this repo does it: Drizzle schema first, a generated, additive, forward-only migration, and a test that runs against it. Use for any new table, column or index in apps/server.
---

# A schema change

1. Edit the table in `apps/server/src/db/schema/*.ts` (exported from `schema/index.ts`). Add; do
   not rename or drop. A new column is nullable or has a default, so rows written by the previous
   Worker stay valid while the deploy runs (migrations are applied before the new Worker).
2. Generate the migration: `npm run db:generate`. It writes `apps/server/drizzle/NNNN_<name>.sql`
   and updates `drizzle/meta`. Read the SQL: it must only add (`CREATE TABLE`, `ALTER TABLE … ADD`,
   `CREATE INDEX`). Never edit a migration that is already on `main`.
3. Mind the free plan: a query the sync pull runs needs an index, or the `rows_read` assertions in
   the pull tests fail.
4. Test it: the server tests apply every migration to a fresh D1 (`test/apply-migrations.ts`), so
   `npm test -w @budget/server` proves it applies; add a test for the behaviour the column enables.
   Locally, `npm run db:migrate:local` applies it to the dev database.
5. If the data syncs to devices, continue with the `synced-entity` skill.
6. Update `docs/data-model.md` (the table, its columns and why).

Deploy applies migrations with `wrangler d1 migrations apply DB --remote` before `wrangler deploy`.
