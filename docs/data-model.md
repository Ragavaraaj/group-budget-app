[← Plan overview](PLAN.md)

# Data model (server, D1 via Drizzle)

IDs are **UUIDv7** generated on the device (sortable; makes offline creates idempotent).

```
users            id, google_sub (unique), email, display_name, avatar_url, created_at, last_login_at
sessions         id_hash, user_id, expires_at, user_agent, created_at
login_attempts   id_hash, user_id (null until bound), expires_at, consumed_at   -- installed-app sign-in ([Auth](auth.md))
groups           id, name, is_personal, created_by
memberships      group_id, user_id, role (owner|member), joined_at
invites          id, token_hash, group_id, created_by, expires_at, max_uses, used_count
categories       id, group_id, name, icon, color, archived                     (+ sync cols)
expenses         id, group_id, occurred_on (local date), amount_minor,
                 category_id, note, created_by                                 (+ sync cols)
expense_payers   expense_id, user_id, amount_minor     -- who paid (can be several)
expense_shares   expense_id, user_id, amount_minor     -- who owes what
settlements      id, group_id, from_user, to_user, amount_minor, occurred_on   (+ sync cols)
budgets          id, group_id, category_id?, period, amount_minor              -- M3
recurring_rules  id, group_id, template, rrule, next_run_on                    -- M3
processed_mutations  mutation_id (primary key), user_id, applied_at            -- idempotency
audit_log        id, mutation_id, user_id, entity, entity_id, before, after, at -- append-only
sync_counter     id (=1), value                                                -- see below

(+ sync cols) = version, updated_at, deleted_at (tombstone), server_seq
```

Rules:

- **Money is integer paise** (`amount_minor` = paise; ₹1 = 100). No floats anywhere. The currency is a single constant in `packages/shared`, not a column. Display with `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.
- **Dates**: `occurred_on` is a plain `YYYY-MM-DD` _local_ date (the day the user means), never a UTC instant, so an expense entered at 00:30 IST never lands on the wrong day. `updated_at` and sync metadata are UTC.
- **`server_seq`** (strictly increasing change number, used as the pull cursor). SQLite has no sequences, and D1 batches can't feed one statement's result into the next from JavaScript, so it is done in SQL inside the batch: before each row write the batch runs `UPDATE sync_counter SET value = value + 1 WHERE id = 1`, and the row is written with `(SELECT value FROM sync_counter WHERE id = 1)` as its `server_seq`. D1 executes a batch atomically and serialises writes, so the sequence is strictly increasing and gap-tolerant.
- **Indexes are part of the design** (rule 6 in [Architecture](architecture.md)): every synced table gets an index on `(group_id, server_seq)` (the pull query), `memberships` on `user_id`, `sessions` on `user_id` (already in the first migration), and `expenses` on `(group_id, occurred_on)` for the month views.
- **Splits**: equal / exact / percent / shares. Remainder paise are distributed with the largest-remainder method so `sum(shares) == total` always holds (property-tested).
- **Balances are derived, never stored**: `net(user) = Σ paid − Σ owed ± settlements`.
- **Settle-up** uses greedy debt simplification (min-cash-flow) to minimise the number of transfers.
- **Personal ledger** = a group with `is_personal = true` and a single member, created on first sign-in. One code path for personal and shared.
- Never hard-delete synced rows; tombstone them.
- **Drizzle workflow**: schema in `apps/server/src/db/schema/*.ts`, one file per domain; `npm run db:generate` produces SQL migrations committed to `apps/server/drizzle/`; **Wrangler applies them** (`wrangler d1 migrations apply`: locally on `npm run dev`, remotely on deploy). The Worker does not migrate at startup. Migrations are additive and forward-only.

**Group permissions (default, easy to tighten)**: any member can add, edit or delete any expense in the group, as in most shared-expense apps among friends and family; every change is recorded in `audit_log` with who and when. Only the owner can rename the group, remove members and create invites.
