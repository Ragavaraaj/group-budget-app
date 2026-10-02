[← Plan overview](PLAN.md)

# Data model (server, D1 via Drizzle)

IDs are **UUIDv7** generated on the device (sortable; makes offline creates idempotent). Schema:
`apps/server/src/db/schema/*.ts`; migrations: `apps/server/drizzle/`.

```
users            id, google_sub (unique), email, display_name, avatar_url, created_at, last_login_at, is_placeholder   -- a placeholder has google_sub 'placeholder:<id>' and can never sign in
sessions         id_hash, user_id, expires_at, user_agent, created_at
oauth_states     state_hash, code_verifier, attempt_hash?, invite_token?, created_at, expires_at   -- a Google sign-in in progress
login_attempts   id_hash, user_id?, confirm_hash?, invite_token?, created_at, expires_at, confirmed_at?, consumed_at?   -- installed-app sign-in ([Auth](auth.md))
groups           id, name, is_personal, created_by, created_at, version, server_seq
memberships      group_id, user_id, role (owner|member), joined_at, removed_at?, removed_by?, server_seq   -- pk (group_id, user_id)
invites          id, token_hash (unique), group_id, created_by, created_at, expires_at, max_uses, used_count, revoked_at?
categories       id, group_id, name, icon, color, archived                      (+ sync cols)
expenses         id, group_id, occurred_on (local date), amount_minor, category_id?, note,
                 split_type, payers (JSON), shares (JSON), created_by           (+ sync cols)
settlements      id, group_id, from_user, to_user, amount_minor, occurred_on, note, created_by   (+ sync cols)
budgets          id, group_id, category_id? (null = the whole group), amount_minor              (+ sync cols)   -- a monthly limit
recurring_rules  id, group_id, frequency (weekly|monthly|yearly), start_on, end_on?, active,
                 amount_minor, category_id?, note, split_type, payers (JSON), shares (JSON),
                 created_by, last_generated_on?, next_due_on?                                   (+ sync cols)   -- the last two are the scheduled job's
processed_mutations  mutation_id (primary key), user_id, applied_at            -- idempotency
audit_log        id, mutation_id, user_id, group_id, entity, entity_id, before, after, at   -- append-only
sync_counter     id (=1), value                                                -- see below

(+ sync cols) = version, updated_at, updated_by, deleted_at (tombstone), server_seq
```

`budgets` and `recurring_rules` were added in M3 (migration 0004) and `users.is_placeholder` in M4 (0005). A rule carries the same split an expense does; it is the **template** the scheduled job copies. Which occurrences have been made is the server's to track: `last_generated_on` and `next_due_on` are never in a client's mutation, and the job moves them **without bumping `version`**, so a person editing a rule at the same moment is not told they conflicted with a machine. `next_due_on` is indexed (`recurring_due_idx`), so finding what is due reads only the due rules, and is null for a paused or finished rule.

Rules:

- **Money is integer paise** (`amount_minor` = paise; ₹1 = 100). No floats anywhere. The currency is a single constant in `packages/shared`, not a column. Display with `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.
- **Dates**: `occurred_on` is a plain `YYYY-MM-DD` _local_ date (the day the user means), never a UTC instant, so an expense entered at 00:30 IST never lands on the wrong day. `updated_at` and the other metadata are UTC epoch milliseconds (plain integers: they travel to the clients as numbers).
- **Who paid and who owes live on the expense row as JSON** (`payers: [{userId, amountMinor}]`, `shares: [{userId, amountMinor, weight?}]`), not in child tables. An expense then changes atomically with its split by writing one row, which also keeps D1 writes low (about four row writes per expense including the sequence counter, audit and idempotency rows, instead of about eleven). `weight` keeps what was typed for percent (basis points) and shares splits so the split can be edited again. Nothing queries by payer in SQL: balances are computed from the rows on the device.
- **`server_seq`** (strictly increasing change number, used as the pull cursor). SQLite has no sequences, and D1 batches can't feed one statement's result into the next from JavaScript, so it is done in SQL inside the batch: the batch first runs `UPDATE sync_counter SET value = value + N` for the N rows it will write, and the i-th row takes `(SELECT value FROM sync_counter WHERE id = 1) - (N - i)`. D1 executes a batch atomically and serialises writes, so the numbers are unique and strictly increasing. `sync_counter` is seeded by a migration. Groups and memberships carry a `server_seq` too, so group changes reach devices through the same pull.
- **Indexes are part of the design** (rule 6 in [Architecture](architecture.md)): every synced table has an index on `(group_id, server_seq)` (the pull query), `memberships` on `(group_id, server_seq)` and `(user_id, server_seq)`, `expenses` also on `(group_id, occurred_on)` (month views), `sessions` on `user_id`, `invites` on `group_id`. A test measures `meta.rows_read` for pulls so a missing index fails a test ([Testing](testing.md)).
- **D1 allows 100 bound parameters per statement.** Reads that take lists of ids stay well under it (a push carries at most 10 mutations); pull uses a subquery for "my groups" rather than a list.
- **Splits**: equal / exact / percent / shares. Remainder paise are distributed with the largest-remainder method so `sum(shares) == total` always holds (property-tested). The server checks that payments and shares each add up to the total and that everyone named belongs (or belonged) to the group; it does not re-derive the split.
- **Balances are derived, never stored**: `net(user) = Σ paid − Σ owed ± settlements`, computed on the device from the synced rows.
- **Settle-up** uses greedy debt simplification (min-cash-flow) to minimise the number of transfers; a payment is recorded as a `settlement` row.
- **Activity feed** is built from the rows themselves: each carries `updated_by`/`updated_at`, a `version` (1 means "added") and a tombstone, so no separate log has to sync. `audit_log` is for diagnosis and recovery only.
- **Personal ledger** = a group with `is_personal = true` and a single member, created with the account at first sign-in, together with ten default categories. One code path for personal and shared groups. Shared groups get the same default categories when created.
- Never hard-delete synced rows; tombstone them. (The one exception is deleting a whole group, below.) A member who leaves or is removed keeps their membership row with `removed_at` set (so the change reaches their devices) and `removed_by` saying who ended it, and stays in old expenses.
- **Drizzle workflow**: schema in `apps/server/src/db/schema/*.ts`, one file per domain; `npm run db:generate` produces SQL migrations committed to `apps/server/drizzle/`; **Wrangler applies them** (`wrangler d1 migrations apply`: locally on `npm run dev`, remotely on deploy). The Worker does not migrate at startup. Migrations are additive and forward-only. Seed data (the `sync_counter` row) is a custom migration (`drizzle-kit generate --custom`).

**Group permissions (as built)**: any member can add, edit or delete any expense, payment, category, budget or recurring rule in the group, as in most shared-expense apps among friends and family; every change is recorded in `audit_log` with who and when, and the row shows who changed it last. Only the owner can rename the group, create invite links and stop them (all at once or one by one), remove members and add them back, add people who don't use the app, hand the group to another member, and delete it. The owner cannot leave: they hand the group over first (to a real member, not a placeholder) or delete it. A group may hold 60 budgets and 50 recurring rules (a push over that is refused as `limit_reached`). **Someone the owner removed cannot come back through an invite link** (`removed_by` is not themselves); the owner re-adds them directly. Someone who left of their own accord can rejoin with a fresh link. Limits: 50 members per group, 30 groups per person, invites last 7 days and allow 20 uses.

**Joining is guarded in the write, not just checked beforehand.** Two people accepting the last use of an invite (or the last place in a group) at the same moment would both pass plain reads, so the join is one D1 batch: it bumps the invite's `used_count` only `WHERE used_count < max_uses` (and not revoked or expired, and the group and the person under their limits), then inserts the membership only `WHERE changes() > 0`, i.e. only if that update took effect. D1 runs a batch in one go, so nobody slips in between; the caller then looks at whether the membership exists. These few statements use the D1 binding's own batch because Drizzle's D1 batch cannot take raw SQL.

**People without the app (placeholders).** The owner can add someone by name. It is a `users` row whose Google id is `placeholder:<id>` (which no real Google account can have) and whose email ends `@placeholder.invalid`, plus an ordinary membership, so splits, payers, balances and settle-up need no special case and the member list shows a "No app" badge. Only members can record what a placeholder paid or owes. They count towards the 50-member limit, can be renamed, removed and added back, and cannot own a group. There is no "merge into a real person" step yet.

**Handing a group over** is one guarded D1 batch (reserve two change numbers; demote the owner only if the new owner is an active member; promote the new owner only if that demotion changed a row, via `changes()`), so a group always has exactly one owner even if two hand-overs race.

**Deleting a group** is one atomic batch: every active member is marked removed (by the owner, each with its own change number, worked out in one statement from the member's rank among the group's membership rows, so a device paging through a pull can't skip any), and the group's expenses, payments, categories, budgets, recurring rules, invite links and audit rows are erased. The group row and the removed memberships stay, because the removal reaching each device is how it learns the group is gone. Nothing short of D1 Time Travel brings it back, and a member's unsent changes to it are lost, as with any removal.
