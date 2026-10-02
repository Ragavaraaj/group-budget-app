[← Plan overview](PLAN.md)

# Sync protocol

Why custom: expenses are append-mostly, edits are rare and rarely concurrent, so last-writer-wins at row level is acceptable and a CRDT is overkill. Code: `apps/web/src/{db,sync}` (client), `apps/server/src/modules/sync` (server).

**Client**

- The UI reads only from the local database (Dexie, one IndexedDB database per signed-in person: `budget-<userId>`), through live queries. Tables: `groups`, `members`, `categories`, `expenses`, `settlements`, `outbox`, `meta` (the pull cursor, pending backfills, recent rejections).
- Every write goes through `db/repo.ts`: it changes the local row **and** appends a mutation to the `outbox` in one transaction, so the screen updates at once and nothing can be lost between "saved" and "queued". A mutation is `{mutationId, entity, op: upsert|delete|restore, baseVersion, data}`. Consecutive queued edits of one row chain their `baseVersion` (3, then 4, then 5), so the server doesn't call the later ones stale.
- **Flush triggers**: app start, the `online` event, the tab becoming visible, right after each local write, and the polling timer. (Background Sync is not used: iOS lacks it, so foreground triggers are the mechanism.) A sync cycle is: **push** the outbox, **pull** until caught up, then run any **backfills**. Triggers that arrive mid-cycle are coalesced into one more cycle.
- **Push** sends the outbox oldest first in requests of at most **10** mutations. A rejected change is dropped from the queue and recorded (Settings shows "Changes the server didn't accept"). If the server refuses a whole request as malformed, the engine retries the changes one at a time to find the culprit, so one bad change can never block the queue. If a request is answered with nothing at all, the cycle stops with an error rather than re-sending forever.
- **Pull by polling**: about every 30 s while the app is visible and online, backing off (doubling) to 5 minutes while nothing changes, going back to 30 s on news, and **stopping while hidden**. A poll with no news is one batched read of a few indexed lookups. After a 401 the engine stops polling and the app keeps working from local data; the queue waits for a new sign-in.
- **Applying pulled rows**: a row the device has unsent edits for is left alone (its own change will be sent, and the server's version comes back afterwards), and a row is never replaced by an older one. A change the server accepted updates the local row's `version` straight away (unless newer edits are queued) so later edits aren't flagged as stale.
- **Local DB is scoped per user**, so two accounts on one device never mix. **Logout** needs a connection, warns if the outbox is non-empty (unsynced changes would be lost), then deletes that user's local database.

**Server**

- `POST /api/sync/push` — array of at most 10 mutations. Flow: **(1) read** the caller's memberships, the rows being changed and anything they reference, **(2) validate and authorize** each mutation in order (a later mutation in the same push sees the effect of an earlier one), **(3) write everything in one `db.batch`**: the sequence reservation, row upserts and tombstones, `audit_log` rows, and one `processed_mutations` insert per accepted mutation. Because `mutation_id` is a primary key, a replay of an already-applied mutation is detected up front and reported as `duplicate`; if two copies race and one batch hits the key, it rolls back whole and the handler re-reads and reports the loser as `duplicate`. Per-mutation result: `applied (+version, +conflict) | duplicate | rejected(reason)`. Reasons: `not_a_member`, `not_found`, `deleted`, `group_mismatch`, `invalid_reference`. A member removed between steps (1) and (3) could land one write; that window is tiny and every write is audit-logged, so it's accepted.
- The upsert is `INSERT … ON CONFLICT(id) DO UPDATE … WHERE deleted_at IS NULL AND group_id = ?`: last writer wins, but never over a tombstone and never across groups, even if two requests race.
- Why 10: the free plan allows 50 D1 queries per Worker invocation, a push uses about three statements per mutation plus a handful of reads, so 10 stays inside even if every statement is counted separately.
- `GET /api/sync/pull?since=<server_seq>&limit=N[&groupId=…]` — everything changed in the caller's groups since the cursor, oldest first, paged, including tombstones. All reads happen in one D1 batch (one consistent snapshot) and every query is index-served. The tables page independently, so the response cursor is the earliest point every table has been read up to; the rest comes on the next page. The returned cursor is the highest `server_seq` the caller has seen (not the global counter).
- The caller's **own membership rows are always included**, even after removal, so being removed reaches their devices (which then delete that group's data and say so) although they can no longer see the group.
- **Joining a group later**: the group's history has older sequence numbers than the joiner's cursor, so the normal pull would skip it. When a pull shows the person has become a member of a group the device doesn't know (and it isn't the very first sync, which fetches everything anyway), the engine queues a **backfill**: it pulls that one group from `since=0` with `groupId=…`, with its own cursor, resumable after an interruption, leaving the global cursor alone. A backfill for a group you're not in answers 403 and is dropped.

**Conflicts**

- Row-level LWW by server arrival order. **Delete wins over a concurrent edit** (an edit of a tombstoned row is rejected as `deleted`); undoing a delete is an explicit `restore`.
- If `baseVersion` is older than the row's current version, the server still applies the edit but flags `conflict`; the device shows a small "someone else also changed an expense you edited; your version was kept" notice.

**Session expiry while offline**: sessions are long-lived (30 days, sliding). If one expires, the app still opens and works from the local database; the outbox simply waits, with a banner and a "Sign in to sync" status. Signing in again flushes it.

**Safety nets**

- An append-only `audit_log` (mutation id, user, group, entity, before/after JSON, timestamp) is written in the same batch as every applied mutation. `server_seq` alone only gives the _latest_ state of each row, so without this a bad merge or a bug can't be diagnosed or undone.
- D1 Time Travel can restore the whole database to any minute within its retention window ([Infrastructure](infrastructure.md)).
- "Export everything as JSON/CSV" is in Settings (CSV cells that start with `=`, `+`, `-` or `@` are defused so a spreadsheet won't run them).
- Tests cover idempotent and concurrent pushes, delete-vs-edit, authorization, paging across tables, backfill, removal, and two real browser contexts end to end ([Testing](testing.md)).
