[← Plan overview](PLAN.md)

# Data model (server, D1 via Drizzle)

IDs are **UUIDv7** generated on the device (sortable; makes offline creates idempotent). Schema:
`apps/server/src/db/schema/*.ts`; migrations: `apps/server/drizzle/`.

```
users            id, google_sub (unique), email, display_name, avatar_url, created_at, last_login_at
sessions         id_hash, user_id, expires_at, user_agent, created_at
oauth_states     state_hash, code_verifier, attempt_hash?, invite_token?, created_at, expires_at   -- a Google sign-in in progress
login_attempts   id_hash, user_id?, confirm_hash?, created_at, expires_at, confirmed_at?, consumed_at?   -- installed-app sign-in ([Auth](auth.md))
groups           id, name, is_personal, created_by, created_at, version, server_seq
memberships      group_id, user_id, role (owner|member), joined_at, removed_at?, server_seq   -- pk (group_id, user_id)
invites          id, token_hash (unique), group_id, created_by, created_at, expires_at, max_uses, used_count, revoked_at?
categories       id, group_id, name, icon, color, archived                      (+ sync cols)
expenses         id, group_id, occurred_on (local date), amount_minor, category_id?, note,
                 split_type, payers (JSON), shares (JSON), created_by           (+ sync cols)
settlements      id, group_id, from_user, to_user, amount_minor, occurred_on, note, created_by   (+ sync cols)
processed_mutations  mutation_id (primary key), user_id, applied_at            -- idempotency
audit_log        id, mutation_id, user_id, group_id, entity, entity_id, before, after, at   -- append-only
sync_counter     id (=1), value                                                -- see below

(+ sync cols) = version, updated_at, updated_by, deleted_at (tombstone), server_seq
```

Not built yet: `budgets` and `recurring_rules` (M3).

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
- Never hard-delete synced rows; tombstone them. A member who leaves keeps their membership row with `removed_at` set (so the change reaches their devices), and stays in old expenses.
- **Drizzle workflow**: schema in `apps/server/src/db/schema/*.ts`, one file per domain; `npm run db:generate` produces SQL migrations committed to `apps/server/drizzle/`; **Wrangler applies them** (`wrangler d1 migrations apply`: locally on `npm run dev`, remotely on deploy). The Worker does not migrate at startup. Migrations are additive and forward-only. Seed data (the `sync_counter` row) is a custom migration (`drizzle-kit generate --custom`).

**Group permissions (as built)**: any member can add, edit or delete any expense, payment or category in the group, as in most shared-expense apps among friends and family; every change is recorded in `audit_log` with who and when, and the row shows who changed it last. Only the owner can rename the group, create invites and remove members. The owner cannot leave (there is no ownership transfer yet). Limits: 50 members per group, 30 groups per person, invites last 7 days and allow 20 uses.
