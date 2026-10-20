---
name: ui-feature
description: Add or change a screen or component in the web app the way this repo builds them: a feature folder, a route, shadcn components, live queries, local writes through tryLocal, phone-first layout and an e2e spec. Use for any user-facing change in apps/web.
---

# A screen or a component

1. **Where**: `apps/web/src/features/<area>/` (`auth`, `budgets`, `categories`, `expenses`, `groups`,
   `import`, `insights`, `recurring`, `search`, `settings`, `status`): pages, components and pure
   helpers together. Shared shell pieces live in `apps/web/src/components/`.
2. **Route**: add it in `apps/web/src/App.tsx`, inside `RequireAuth` unless it is public.
3. **Data**: read with the live-query hooks in `db/hooks.ts` (add one if needed); write with
   `db/repo.ts` wrapped in `tryLocal` from `lib/local-errors.ts`, which reports a failed local write
   the way the rest of the app does. Online-only actions go through `lib/api.ts`.
4. **Components**: shadcn from `components/ui` (add one by copying it in; it is linted, not
   reformatted). Use the shadcn `Select`, never a native `<select>`. Icons from `lucide-react`.
5. **Money and dates**: `formatPaise`, `parseRupees`, `toRupeesString` and the date and period helpers
   from `@budget/shared`. Never floats.
6. **Phone first**: check it at 360 px; long unbroken text wraps or truncates (`min-w-0`, `truncate`,
   `break-words`), so nothing widens the page.
7. **Accessible names** for every control and heading, so tests use `getByRole` / `getByLabel`.
8. **Tests**: pure helpers in `apps/web/test/features/<area>/`; behaviour in an e2e spec (the
   `e2e-spec` skill), including refused input and offline.
9. **Docs**: the screen in `docs/frontend.md`.
