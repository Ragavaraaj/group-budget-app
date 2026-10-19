# Graph Report - group-budget-app  (2026-10-19)

## Corpus Check
- 271 files · ~165,205 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: (none) 4, .example 1, .jsonc 1)

## Summary
- 1684 nodes · 5702 edges · 74 communities (70 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 73 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f6e0d89d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- e2e/helpers.ts
- reports.ts
- cn
- auth/routes.ts
- push.ts
- expense-form-page.tsx
- groups/repo.ts
- uuidv7
- handleUpdateFound
- shared/src/index.ts
- Button
- database.ts
- LiveChannel
- bank.ts
- biome.json
- package.json
- isStandalone
- schemas/sync.ts
- app.ts
- compilerOptions
- auth-context.tsx
- join-page.tsx
- types.ts
- schemas/api.ts
- server/src/index.ts
- insights-page.tsx
- settings-page.tsx
- insights-page.tsx
- balances-tab.tsx
- generate.test.ts
- entities.ts
- server/test/helpers.ts
- web/package.json
- recurring-form-page.tsx
- schema/index.ts
- engine.ts
- choices.test.ts
- money.ts
- components.json
- filter.test.ts
- shared/package.json
- split-draft.ts
- compilerOptions
- server/package.json
- dependencies
- devDependencies
- scripts
- limits.ts
- CLAUDE.md
- apply.test.ts
- recurring.ts
- scripts
- dependencies
- ids.ts
- devDependencies
- app.test.ts
- defaults.ts
- SignInPanel
- balances.ts
- pages.ts
- server/tsconfig.json
- tsconfig.json
- server/tsconfig.node.json
- web/tsconfig.node.json
- shared/tsconfig.json
- server/vitest.config.ts
- build-id.ts
- open-links.tsx
- periods.ts
- dates.ts
- format.ts
- sync.test.ts
- Logger
- sync-status.tsx

## God Nodes (most connected - your core abstractions)
1. `cn()` - 98 edges
2. `Button()` - 66 edges
3. `uuidv7()` - 54 edges
4. `react` - 50 edges
5. `useDb()` - 50 edges
6. `InsightsPage()` - 45 edges
7. `useMe()` - 39 edges
8. `ImportPage()` - 37 edges
9. `RecurringForm()` - 37 edges
10. `lucide-react` - 34 edges

## Surprising Connections (you probably didn't know these)
- `BUG-004: A long name with no spaces pushes some screens and dialogs sideways` --references--> `CategoryChips()`  [INFERRED]
  docs/known-bugs.md → apps/web/src/features/expenses/form-fields.tsx
- `Where things stand` --references--> `cn()`  [INFERRED]
  docs/roadmap.md → apps/web/src/lib/utils.ts
- `Testing and quality` --references--> `Client`  [INFERRED]
  docs/testing.md → apps/server/test/helpers.ts
- `BUG-005: Some drop-downs are the browser's own `<select>`, not the shadcn Select` --references--> `Checkbox()`  [INFERRED]
  docs/known-bugs.md → apps/web/src/components/ui/checkbox.tsx
- `Sync protocol` --references--> `meta()`  [INFERRED]
  docs/sync.md → apps/web/src/db/repo.ts

## Import Cycles
- None detected.

## Communities (74 total, 4 thin omitted)

### Community 0 - "e2e/helpers.ts"
Cohesion: 0.05
Nodes (60): Testing, Infrastructure and operations (Cloudflare), Api, expenseMutation(), Setup, addDinner(), addExpenseOn(), addPlaceholderMember() (+52 more)

### Community 1 - "reports.ts"
Cohesion: 0.14
Nodes (22): BUDGET_OVER_BP, BUDGET_WARN_BP, budgetLevel, BudgetLike, BudgetStatus, evaluateBudgets(), newestPerCategory(), daysBetween() (+14 more)

### Community 2 - "cn"
Cohesion: 0.10
Nodes (29): items, NavItem, CATEGORY_COLORS, CATEGORY_ICONS, CategoryIconProps, PersonAvatar(), tintFor(), TINTS (+21 more)

### Community 3 - "auth/routes.ts"
Cohesion: 0.10
Nodes (42): loginAttempts, base(), C, clearOauthCookie(), clearSessionCookie(), getOauthCookie(), OAUTH_COOKIE, OAUTH_TTL_MS (+34 more)

### Community 4 - "push.ts"
Cohesion: 0.10
Nodes (43): groups, budgets, categories, expenses, processedMutations, recurringRules, settlements, syncColumns (+35 more)

### Community 5 - "expense-form-page.tsx"
Cohesion: 0.20
Nodes (27): Label(), Select(), SelectContent(), SelectItem(), SelectScrollDownButton(), SelectScrollUpButton(), SelectTrigger(), SelectValue() (+19 more)

### Community 6 - "groups/repo.ts"
Cohesion: 0.14
Nodes (36): reserveSeq(), runBatch(), seqFor(), Statement, acceptInvite(), AcceptInviteResult, activeGroupCount(), activeMemberCount() (+28 more)

### Community 7 - "uuidv7"
Cohesion: 0.09
Nodes (30): Plan, PullQuery, SyncApi, Environment, [asha, bala, chitra], dinner(), G, expenseRow() (+22 more)

### Community 8 - "handleUpdateFound"
Cohesion: 0.09
Nodes (21): NOW(), hasPendingAttempt(), root, STARTED_BY, trackInteraction(), registerPwa(), ACTIVATION_GRACE_MS, handleUpdateFound() (+13 more)

### Community 9 - "shared/src/index.ts"
Cohesion: 0.15
Nodes (30): auditLog, settleNotifications(), db, resetDb(), groupWithEverything(), connect(), Connection, connectRaw() (+22 more)

### Community 10 - "Button"
Cohesion: 0.22
Nodes (28): SignedInContext, useEngine(), useSignedIn(), Button(), Dialog(), DialogContent(), DialogDescription(), DialogFooter() (+20 more)

### Community 11 - "database.ts"
Cohesion: 0.13
Nodes (31): BudgetDb, getDb(), open, wipeDb(), newestFirst(), personName(), LocalBudget, LocalCategory (+23 more)

### Community 12 - "LiveChannel"
Cohesion: 0.10
Nodes (6): LiveChannel, LiveOptions, LiveSocket, channel(), connections, FakeSocket

### Community 13 - "bank.ts"
Cohesion: 0.09
Nodes (30): ALIASES, BANK_PRESETS, DateOrder, detectBank(), detectColumns(), ExistingExpense, Field, findDuplicates() (+22 more)

### Community 14 - "biome.json"
Cohesion: 0.05
Nodes (39): source, assist, actions, noUnusedImports, noUnusedVariables, useExhaustiveDependencies, useHookAtTopLevel, css (+31 more)

### Community 15 - "package.json"
Cohesion: 0.05
Nodes (41): allowScripts, esbuild, workerd, devDependencies, @biomejs/biome, concurrently, @playwright/test, @types/node (+33 more)

### Community 16 - "isStandalone"
Cohesion: 0.36
Nodes (5): isStandalone(), BeforeInstallPromptEvent, InstallPrompt, useInstallPrompt(), install()

### Community 17 - "schemas/sync.ts"
Cohesion: 0.13
Nodes (14): categoryDataSchema, categoryRowSchema, ENTITY_NAMES, groupRowSchema, recurringRowSchema, settlementRowSchema, mutationBase, mutationResultSchema (+6 more)

### Community 18 - "app.ts"
Cohesion: 0.17
Nodes (24): App, AppEnv, createApp(), Config, originCheck(), SAFE_METHODS, requestLogger(), AuthContext (+16 more)

### Community 19 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, jsx, lib, paths, types, extends, include, ../../tsconfig.base.json

### Community 20 - "auth-context.tsx"
Cohesion: 0.11
Nodes (21): ATTEMPT_WINDOW_MS, cancelAttempt(), redeemAttempt(), RedeemResult, redeemSchema, AuthContext, AuthProvider(), AuthState (+13 more)

### Community 21 - "join-page.tsx"
Cohesion: 0.20
Nodes (17): useAuth(), SignedInProvider(), AppShell(), RequireAuth(), dismissed(), NotInstalledBanner(), SessionExpiredBanner(), BottomNav() (+9 more)

### Community 22 - "types.ts"
Cohesion: 0.12
Nodes (29): announce(), baseVersionFor(), deleteBudget(), deleteExpense(), deleteRecurring(), Listener, listeners, onLocalWrite() (+21 more)

### Community 23 - "schemas/api.ts"
Cohesion: 0.08
Nodes (26): googleStartUrl(), RFC-4648, base64url(), digest(), randomToken(), WebCrypto, acceptInviteRequestSchema, addPlaceholderResponseSchema (+18 more)

### Community 24 - "server/src/index.ts"
Cohesion: 0.15
Nodes (18): cache, envSchema, loadConfig(), optionalText, app, fetch(), runScheduled(), scheduled() (+10 more)

### Community 25 - "insights-page.tsx"
Cohesion: 0.14
Nodes (37): App(), InsightsPage, AddExpenseFab(), HeroCard(), HeroStepper(), HeroStepperProps, NotFoundPage(), PageHeader() (+29 more)

### Community 26 - "settings-page.tsx"
Cohesion: 0.16
Nodes (30): AlertDialog(), AlertDialogAction(), AlertDialogCancel(), AlertDialogContent(), AlertDialogDescription(), AlertDialogFooter(), AlertDialogHeader(), AlertDialogMedia() (+22 more)

### Community 27 - "insights-page.tsx"
Cohesion: 0.14
Nodes (27): Checkbox(), ToggleGroup(), ToggleGroupContext, ToggleGroupItem(), Toggle(), toggleVariants, useCategoriesOfGroups(), useExpensesOfGroups() (+19 more)

### Community 28 - "balances-tab.tsx"
Cohesion: 0.25
Nodes (19): Badge(), badgeVariants, Card(), CardContent(), CardDescription(), CardHeader(), CardTitle(), deleteSettlement() (+11 more)

### Community 29 - "generate.test.ts"
Cohesion: 0.15
Nodes (13): createDb(), recurringTombstoneSchedule(), scheduleOf(), beforeBatch(), counting(), ruleData(), today(), ruleData() (+5 more)

### Community 30 - "entities.ts"
Cohesion: 0.14
Nodes (14): allocationAmountSchema, allocationSchema, budgetRowSchema, checkSplit(), expenseBaseSchema, expenseRowSchema, hasDuplicates(), memberRowSchema (+6 more)

### Community 31 - "server/test/helpers.ts"
Cohesion: 0.15
Nodes (14): oauthStates, invites, app, b64url(), Client, EnvOverrides, fakeIdToken(), mockGoogleToken() (+6 more)

### Community 32 - "web/package.json"
Cohesion: 0.09
Nodes (23): @budget/shared, vitest, zod, name, private, type, version, api (+15 more)

### Community 33 - "recurring-form-page.tsx"
Cohesion: 0.17
Nodes (27): useDb(), useMe(), CategoryIcon(), Switch(), useCategories(), useGroups(), useMembers(), useRecurringRule() (+19 more)

### Community 34 - "schema/index.ts"
Cohesion: 0.17
Nodes (10): Db, memberships, sessions, users, inFlight, everyoneStillIn, GenerateResult, db (+2 more)

### Community 35 - "engine.ts"
Cohesion: 0.10
Nodes (14): browserEnvironment, describeError(), endsCycle(), EngineOptions, inStep(), isSessionEnd(), StepDetail, StepFailed (+6 more)

### Community 36 - "choices.test.ts"
Cohesion: 0.16
Nodes (13): BudgetChoice, OVERALL, BreakdownRow, limitRows(), nameCategories(), budget(), category(), food (+5 more)

### Community 37 - "money.ts"
Cohesion: 0.25
Nodes (6): CURRENCY, formatters, MAX_PAISE, PAISE_PER_RUPEE, localDateSchema, paiseSchema

### Community 38 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 39 - "filter.test.ts"
Cohesion: 0.16
Nodes (15): categoryChoices(), filterExpenses(), NO_FILTERS, norm(), SearchFilters, all, categories, chai (+7 more)

### Community 40 - "shared/package.json"
Cohesion: 0.12
Nodes (16): dependencies, zod, devDependencies, fast-check, vitest, exports, vitest, zod (+8 more)

### Community 41 - "split-draft.ts"
Cohesion: 0.12
Nodes (23): newDraft(), parsePercent(), percentToString(), Resolved, resolveSplit(), SplitDraft, withType(), SplitSectionProps (+15 more)

### Community 42 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, esModuleInterop, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+7 more)

### Community 43 - "server/package.json"
Cohesion: 0.17
Nodes (10): @budget/shared, vitest, zod, name, private, type, version, arctic (+2 more)

### Community 44 - "dependencies"
Cohesion: 0.13
Nodes (15): dependencies, @budget/shared, class-variance-authority, clsx, dexie, dexie-react-hooks, lucide-react, radix-ui (+7 more)

### Community 45 - "devDependencies"
Cohesion: 0.15
Nodes (13): devDependencies, fake-indexeddb, tailwindcss, @tailwindcss/vite, tw-animate-css, @types/react, @types/react-dom, vite (+5 more)

### Community 46 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, cf-typegen, db:generate, db:migrate:local, db:migrate:remote, deploy, dev (+3 more)

### Community 47 - "limits.ts"
Cohesion: 0.14
Nodes (13): CATEGORY_NAME_MAX, DISPLAY_NAME_MAX, GROUP_NAME_MAX, INVITE_MAX_USES, INVITE_TTL_DAYS, MAX_BUDGETS_PER_GROUP, MAX_GROUPS_PER_USER, MAX_IMPORT_ROWS (+5 more)

### Community 48 - "CLAUDE.md"
Cohesion: 0.06
Nodes (35): Attachment, CHANGED_MESSAGE, LiveHub, MAX_SOCKETS_PER_USER, tagFor(), settlement(), Commands (run from the repo root), Conventions (+27 more)

### Community 49 - "apply.test.ts"
Cohesion: 0.17
Nodes (14): ApplyOptions, applyPull(), ApplyResult, BACKFILL_PREFIX, purgeGroup(), getMeta(), setMeta(), apply() (+6 more)

### Community 50 - "recurring.ts"
Cohesion: 0.27
Nodes (12): generateDueExpenses(), seqSql(), addDays(), countDue(), daysUntilNext(), nextOccurrence(), nthOccurrence(), occurrencesAfter() (+4 more)

### Community 51 - "scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, icons, preview, test, typecheck

### Community 52 - "dependencies"
Cohesion: 0.33
Nodes (6): dependencies, arctic, @budget/shared, drizzle-orm, hono, zod

### Community 53 - "ids.ts"
Cohesion: 0.47
Nodes (3): isUuid(), RandomSource, uuidv7Timestamp()

### Community 54 - "devDependencies"
Cohesion: 0.40
Nodes (5): devDependencies, @cloudflare/vitest-pool-workers, drizzle-kit, vitest, wrangler

### Community 55 - "app.test.ts"
Cohesion: 0.25
Nodes (3): app, Cloudflare, Env

### Community 57 - "SignInPanel"
Cohesion: 0.29
Nodes (3): AuthApi, SignInPanel(), AuthConfigResponse

### Community 58 - "balances.ts"
Cohesion: 0.24
Nodes (11): ActivityKind, buildActivity(), deriveMoney(), GroupMoney, kindOf(), Allocation, BalanceExpense, BalanceSettlement (+3 more)

### Community 59 - "pages.ts"
Cohesion: 0.50
Nodes (7): confirmPage(), devIdpPage(), escapeHtml(), layout(), messagePage(), PAGE_CSP, Testing and quality

### Community 60 - "server/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, paths, types, extends, include, ../../tsconfig.base.json

### Community 61 - "tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, lib, types, extends, include, ./tsconfig.base.json

### Community 62 - "server/tsconfig.node.json"
Cohesion: 0.33
Nodes (5): compilerOptions, types, extends, include, ../../tsconfig.base.json

### Community 63 - "web/tsconfig.node.json"
Cohesion: 0.33
Nodes (5): compilerOptions, types, extends, include, ../../tsconfig.base.json

### Community 64 - "shared/tsconfig.json"
Cohesion: 0.33
Nodes (5): compilerOptions, types, extends, include, ../../tsconfig.base.json

### Community 67 - "open-links.tsx"
Cohesion: 0.22
Nodes (11): explain(), expiresIn(), OpenLinks(), HealthState, useHealth(), check(), apiCall(), apiGet() (+3 more)

### Community 68 - "periods.ts"
Cohesion: 0.35
Nodes (10): fiscalYearLabel(), fiscalYearOf(), fiscalYearOfPeriod(), fiscalYearPeriodKeys(), fiscalYearRange(), MAX_MONTH_START_DAY, normaliseStartDay(), periodKeyOf() (+2 more)

### Community 69 - "dates.ts"
Cohesion: 0.42
Nodes (9): addMonths(), dateInMonth(), daysInMonth(), formatUtc(), isValidLocalDate(), monthKey(), monthRange(), pad() (+1 more)

### Community 70 - "format.ts"
Cohesion: 0.44
Nodes (7): formatMonth(), formatMonthShort(), formatPeriod(), formatRelative(), fromLocalDate(), parts(), shortDate()

### Community 71 - "sync.test.ts"
Cohesion: 0.25
Nodes (7): budgetDataSchema, expenseDataSchema, settlementDataSchema, pullQuerySchema, pushRequestSchema, [a, b, group, category], expense()

### Community 73 - "sync-status.tsx"
Cohesion: 0.60
Nodes (4): useSyncStatus(), describe(), SyncStatusChip(), dexie-react-hooks

## Knowledge Gaps
- **26 isolated node(s):** `@budget/shared`, `zod`, `vitest`, `wrangler`, `../../tsconfig.base.json` (+21 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 499 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `me()` connect `split-draft.ts` to `e2e/helpers.ts`, `uuidv7`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **What connects `@budget/shared`, `zod`, `vitest` to the rest of the system?**
  _26 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `e2e/helpers.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0545361875637105 - nodes in this community are weakly interconnected._
- **Why does `@playwright/test` connect `e2e/helpers.ts` to `package.json`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Should `reports.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14461538461538462 - nodes in this community are weakly interconnected._
- **Why does `uuidv7()` connect `shared/src/index.ts` to `recurring-form-page.tsx`, `auth/routes.ts`, `choices.test.ts`, `expense-form-page.tsx`, `groups/repo.ts`, `uuidv7`, `sync.test.ts`, `Button`, `CLAUDE.md`, `apply.test.ts`, `ids.ts`, `types.ts`, `insights-page.tsx`, `generate.test.ts`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Should `cn` be split into smaller, more focused modules?**
  _Cohesion score 0.1006006006006006 - nodes in this community are weakly interconnected._