---
name: synced-entity
description: Add a field or a whole entity that syncs between devices, through all three packages in the right order. Use when data must be stored locally, pushed, pulled and applied.
---

# A synced field or entity, end to end

Work in this order; each step uses the one before. Read `docs/sync.md` and `docs/data-model.md` first.

1. **Contract** (`packages/shared`): the entity's zod schema in `src/schemas/entities.ts`, its
   mutation and pull shapes in `src/schemas/sync.ts`, limits in `src/limits.ts`, pure rules (money
   in paise, splits, dates) in their modules. Unit and property tests in `packages/shared/test`.
2. **Server table and migration**: the `db-migration` skill.
3. **Server sync** (`apps/server/src/modules/sync`): `mappers.ts` (row ↔ contract), `push.ts`
   (validate, authorize by group membership, upsert: last writer wins, never over a tombstone or
   across groups), `pull.ts` (include it in the paged pull, with tombstones). Keep pushes within the
   statement budget. Tests in `apps/server/test/modules/sync`.
4. **Client database** (`apps/web/src/db`): the table in `tables.ts`, a **new Dexie version** in
   `database.ts` (never change an old `version(n)`), local writes plus the outbox entry in one
   transaction in `repo.ts`, applying pulled rows in `apply.ts` (never over unsent edits or a newer
   row), and a live query in `hooks.ts`. Tests in `apps/web/test/db`.
5. **Engine** (`apps/web/src/sync/engine.ts`) only if the flow itself changes; test it against the
   scripted server in `apps/web/test/helpers.ts`.
6. **UI**: the `ui-feature` skill.
7. **E2E**: a two-device flow (`newPerson`, `waitForSynced`): change on one, see it on the other,
   including offline and after a reload.
8. Docs: `docs/sync.md` and `docs/data-model.md`.
