[← Plan overview](PLAN.md)

# Frontend

- **Shell and routing**: React Router; the whole shell is precached by the service worker. Mobile-first with a bottom tab bar; add/edit expense is a _route_ (not a modal) so the Android back button behaves.
- **State**: Dexie live queries are the source of truth. Local React state for UI only. No Redux. A tiny typed `fetch` wrapper for the online-only calls (auth, groups, invites).
- **UI kit**: **shadcn/ui** components live in `apps/web/src/components/ui` (copied from the shadcn repo, then ours to edit), configured through `components.json` and an `@/` path alias. Tailwind v4 with dark mode following the OS. Added on demand as screens need them (button, input, label, form, select, tabs, card, drawer, dialog, dropdown-menu, sonner, avatar, badge, skeleton, calendar/popover for dates, chart for M3). Forms use react-hook-form with the shared zod schemas.
- **Charts (M3)**: shadcn's chart component (Recharts), loaded lazily with the Insights route so it doesn't weigh down the first load.
- **UX priorities** (this is what makes expense apps stick): amount-first entry in ≤3 taps; defaults from last-used category/payer/group; always-visible sync status; undo on delete (sonner toast with an Undo action); fast list with virtualization once it exceeds a few thousand rows.

**PWA specifics**

- `vite-plugin-pwa`, starting in `generateSW` mode (precache + navigation fallback), switching to `injectManifest` only when the sync engine needs a custom service worker.
- Caching: precache shell + assets; `/api/*` is never cached by the service worker (the sync engine owns it) and the Worker sends `Cache-Control: no-store` on API responses.
- Static-asset headers live in `apps/web/public/_headers` (Cloudflare applies them): hashed `/assets/*` are `immutable`; everything else keeps Cloudflare's default of revalidating, which is what lets installed PWAs pick up new versions.
- Update flow: "New version available — reload" prompt; never auto-reload mid-entry.
- Manifest: `standalone`, 192/512/maskable icons, `apple-touch-icon`, app shortcut "Add expense".
- Call `navigator.storage.persist()`. Safari can evict IndexedDB for non-installed sites; the server remains the source of truth, so eviction is recoverable by re-pulling, but un-synced outbox items would be lost, which is why flush-on-foreground matters.
- iOS caveats: push works only for installed PWAs (16.4+); no Background Sync; sign-in uses attempt-login in standalone mode ([Auth](auth.md)); install from Chrome via Add to Home Screen, since non-installed use loses the service worker and risks storage eviction.
