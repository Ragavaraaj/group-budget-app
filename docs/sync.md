[← Plan overview](PLAN.md)

# Sync protocol

Why custom: expenses are append-mostly, edits are rare and rarely concurrent, so last-writer-wins at row level is acceptable and a CRDT is overkill.

**Client**

- Local writes go to Dexie _and_ an `outbox` table `{mutationId, type, payload, baseVersion, createdAt}` in one transaction, so the UI updates instantly.
- Flush triggers: app start, `online` event, `visibilitychange → visible`, after each local write, and Background Sync where supported (Chromium only; iOS Safari lacks it, so foreground triggers are the primary mechanism).
- **Pull by polling**: on the same triggers, plus about every 30 s while the app is visible and online, backing off to a few minutes when nothing has changed and stopping while hidden. A poll with no news is one indexed query and a tiny response.
- **Local DB is scoped per user** (database name includes the user id), so two accounts on one device never mix.
- **Logout** warns if the outbox is non-empty (unsynced changes would be lost), then wipes that user's local database.

**Server**

- `POST /api/sync/push` — array of mutations. Flow: **(1) read** the caller's memberships and any existing rows, **(2) validate and authorize** each mutation, **(3) write everything in one `db.batch`**: row upserts (last-writer-wins, `ON CONFLICT … DO UPDATE … WHERE` the incoming change is newer), the `server_seq` bumps ([Data model](data-model.md)), `audit_log` rows, and one `processed_mutations` insert per mutation. Because `mutation_id` is a primary key, replaying an already-applied mutation violates it and rolls the whole batch back; the handler then reports those mutations as already applied. Per-mutation result: `applied | rejected(reason)`. A member removed between steps (1) and (3) could land one write; that window is tiny and every write is audit-logged, so it's accepted.
- `GET /api/sync/pull?since=<server_seq>&limit=N` — rows from the caller's groups with `server_seq > since`, including tombstones; paginated; returns the new cursor. A newly joined member pulls the group's full history through this same path.

**Conflicts**

- Row-level LWW by server arrival order. Delete wins over a concurrent edit.
- If `baseVersion` is stale the server still applies LWW but flags it; the UI shows a small "edited by X while you were offline" notice.

**Session expiry while offline**: sessions are long-lived (30 days, sliding). If one expires, the app still opens and works from Dexie; the outbox simply waits. Signing in again flushes it.

**Safety nets**

- An append-only `audit_log` (mutation id, user, entity, before/after JSON, timestamp) is written in the same batch as every applied mutation. `server_seq` alone only gives the _latest_ state of each row, so without this a bad merge or a bug can't be diagnosed or undone.
- D1 Time Travel can restore the whole database to any minute within its retention window ([Infrastructure](infrastructure.md)).
- "Export everything as JSON/CSV" is available from day one.
- Integration tests simulate two offline clients with interleaved edits, replays and tombstones ([Testing](testing.md)).
