[← Plan overview](PLAN.md)

# Frontend

- **Shell and routing**: React Router; the whole shell is precached by the service worker. Mobile-first with a bottom tab bar (Expenses, Groups, Settings) and an always-visible sync-status chip on top. Add/edit expense is a _route_ (not a modal) so the Android back button behaves.
- **Routes**: `/login`, `/join/:token` (outside the sign-in gate; the join page works before sign-in), and behind it: `/` (personal ledger by month), `/add` (`?group=`), `/expenses/:id/edit`, `/groups`, `/groups/:id` (tabs: Expenses, Balances, Activity, Members, kept in `?tab=`), `/settings`, `/settings/categories`. Behind the gate, a provider opens the person's own local database and starts their sync engine; signed out, everything redirects to `/login`.
- **State**: Dexie live queries are the source of truth (`db/hooks.ts`). Local React state for UI only. No Redux. A tiny typed `fetch` wrapper (`lib/api.ts`, distinguishing "the network failed" from "the server said no") for the online-only calls: auth, group management, invites.
- **UI kit**: **shadcn/ui** components live in `apps/web/src/components/ui` (copied from the shadcn repo, then ours to edit), configured through `components.json` and an `@/` path alias. Tailwind v4 with dark mode following the OS. In use: button, card, badge, skeleton, sonner, input, label, select, tabs, dialog, alert-dialog, avatar, checkbox, switch, toggle-group (separator, dropdown-menu and textarea are copied in but not used yet; calendar/popover are not used: dates use the native date input; chart is for M3). **Forms use plain React state plus the shared zod schemas and the pure split logic**, not react-hook-form: the one complex form (the split editor) keeps what was typed as text and resolves it with `resolveSplit` (`features/expenses/split-draft.ts`, unit-tested), and the simple ones didn't need a form library.
- **Charts (M3)**: shadcn's chart component (Recharts), loaded lazily with the Insights route so it doesn't weigh down the first load.
- **UX priorities** (this is what makes expense apps stick), and where they stand:
  - amount-first entry in ≤3 taps: **done** (the amount field has focus on open; category is one tap and remembered per group; date defaults to today);
  - always-visible sync status ("Synced", "Syncing", "Offline · 2 waiting", "Sync problem", "Sign in to sync"): **done**;
  - undo on delete (toast with Undo, for expenses and payments): **done**;
  - defaults from last-used category: **done**; last-used payer/group: not done;
  - fast list with virtualization once it exceeds a few thousand rows: not done (the list is per month, so it stays short);
  - search and filters: M3.

**Screens as built**

- _Expenses_ (personal ledger): month navigator, month total, expenses grouped by day, floating add button. A row not yet sent says "Not synced yet".
- _Add / edit expense_: amount, category chips, date, note, group (when in more than one). In a shared group also **Paid by** (one person, or several with amounts), and **Split**: Equally (tick who is in), Exact amounts, Percent, Shares, with live feedback ("₹600 left to assign") and each person's resulting amount. Everything is saved to the local database first.
- _Groups_: your groups with where you stand in each; create a group (needs a connection). _Group_: expenses by month; **Balances** (your balance, everyone's, the fewest payments that settle up, record a payment, payments made with undo); **Activity** (who added, edited or deleted what); **Members** (invite link, remove, leave).
- _Join_: shows who invited you to which group, signs you in if needed (the invite carries through Google), then "Join group".
- _Settings_: account, sync (last synced, waiting count, "Sync now", changes the server refused), categories, export (CSV, JSON), install, server status, sign out.

**PWA specifics**

- `vite-plugin-pwa`, starting in `generateSW` mode (precache + navigation fallback), switching to `injectManifest` only when the sync engine needs a custom service worker. It hasn't needed to.
- Caching: precache shell + assets; `/api/*` is never cached by the service worker (the sync engine owns it) and the Worker sends `Cache-Control: no-store` on API responses.
- Static-asset headers live in `apps/web/public/_headers` (Cloudflare applies them): hashed `/assets/*` are `immutable`; everything else keeps Cloudflare's default of revalidating, which is what lets installed PWAs pick up new versions.
- Update flow: "New version available — reload" prompt; never auto-reload mid-entry.
- Manifest: `standalone`, 192/512/maskable icons, `apple-touch-icon`. (The app shortcut "Add expense" is not added yet.)
- `navigator.storage.persist()` is requested on sign-in. Safari can evict IndexedDB for non-installed sites; the server remains the source of truth, so eviction is recoverable by re-pulling, but un-synced outbox items would be lost, which is why flush-on-foreground matters.
- iOS caveats: push works only for installed PWAs (16.4+); no Background Sync; sign-in uses attempt-login in standalone mode ([Auth](auth.md)); install from Chrome via Add to Home Screen, since non-installed use loses the service worker and risks storage eviction.
