# Graph Report - group-budget-app  (2026-10-03)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1702 nodes · 5759 edges · 57 communities (53 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.84)
- Token cost: 40,258 input · 732 output

## Graph Freshness
- Built from commit: `8bdecce3`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- API Authorization E2E Tests
- Recurring Schedule Descriptions
- Category Icons and Badges
- Login Attempts and Cookies
- Core Database Tables
- Expense Form Controls
- Sync Batching and Invites
- Sync API and Apply Tests
- Insights and Budget Hooks
- Group Management Tests
- Dialog and Button UI
- Local Entity Types
- Live Update Channel
- Bank Import Detection
- Biome Lint Config
- Root Package Config
- Auth Context and App Shell
- Shared Zod Schemas
- App Setup and Origin Check
- TypeScript Project Configs
- Sign-in Attempt Redemption
- Avatar and Split Drafts
- Pull Apply and Local DB
- Crypto Utilities
- Server Config and Entry
- App Routing and Layout
- Alert Dialog Components
- Local Repo Writes
- Cards and Settings Page
- Recurring Expense Generation
- Sync Types and Shared Data
- Auth Tests and Helpers
- Web Package Config
- Expense List and Avatars
- Auth and Sync Schema
- Sync Engine
- Budget Choices
- Money and Health
- shadcn Components Config
- Expense Search Filters
- Shared Package Config
- Split Calculations
- Base TypeScript Config
- Server Package and Vitest
- Web Runtime Dependencies
- Web Dev Dependencies
- Server NPM Scripts
- Shared Limits Constants
- Live Hub Durable Object
- Web Entry and PWA
- Web NPM Scripts
- Server Dependencies
- ID Generation
- Server Dev Dependencies
- Test Environment Setup
- Default Categories

## God Nodes (most connected - your core abstractions)
1. `cn()` - 111 edges
2. `Button()` - 66 edges
3. `uuidv7()` - 54 edges
4. `react` - 52 edges
5. `useDb()` - 48 edges
6. `InsightsPage()` - 45 edges
7. `useMe()` - 39 edges
8. `RecurringForm()` - 37 edges
9. `lucide-react` - 35 edges
10. `ExpenseForm()` - 34 edges

## Surprising Connections (you probably didn't know these)
- `base()` --indirect_call--> `me()`  [INFERRED]
  apps/web/src/features/expenses/split-draft.test.ts → e2e/api-authorization.spec.ts
- `settlement()` --calls--> `uuidv7()`  [EXTRACTED]
  apps/web/src/features/groups/derive.test.ts → packages/shared/src/ids.ts
- `expense()` --calls--> `uuidv7()`  [EXTRACTED]
  apps/web/src/db/repo.test.ts → packages/shared/src/ids.ts
- `currentMonth()` --calls--> `toLocalDate()`  [EXTRACTED]
  apps/web/src/lib/format.ts → packages/shared/src/dates.ts
- `SignedIn` --references--> `MeResponse`  [EXTRACTED]
  apps/web/src/auth/sync-context.tsx → packages/shared/src/schemas/api.ts

## Import Cycles
- None detected.

## Communities (57 total, 4 thin omitted)

### Community 0 - "API Authorization E2E Tests"
Cohesion: 0.07
Nodes (44): Api, expenseMutation(), me(), Setup, addDinner(), addExpenseOn(), addPlaceholderMember(), chooseOption() (+36 more)

### Community 1 - "Recurring Schedule Descriptions"
Cohesion: 0.06
Nodes (57): generateDueExpenses(), seqSql(), describeNext(), describeSchedule(), FREQUENCY_LABELS, ordinal(), parts(), peopleWhoLeft() (+49 more)

### Community 2 - "Category Icons and Badges"
Cohesion: 0.07
Nodes (43): CATEGORY_COLORS, CATEGORY_ICONS, CategoryIcon(), CategoryIconProps, AlertDialogMedia(), Badge(), badgeVariants, buttonVariants (+35 more)

### Community 3 - "Login Attempts and Cookies"
Cohesion: 0.08
Nodes (46): loginAttempts, base(), C, clearOauthCookie(), clearSessionCookie(), getOauthCookie(), OAUTH_COOKIE, OAUTH_TTL_MS (+38 more)

### Community 4 - "Core Database Tables"
Cohesion: 0.08
Nodes (43): groups, budgets, categories, expenses, settlements, MemberJoinRow, toBudgetRow(), toCategoryRow() (+35 more)

### Community 5 - "Expense Form Controls"
Cohesion: 0.14
Nodes (45): useDb(), useMe(), useSignedIn(), Select(), SelectContent(), SelectItem(), SelectTrigger(), SelectValue() (+37 more)

### Community 6 - "Sync Batching and Invites"
Cohesion: 0.08
Nodes (39): reserveSeq(), runBatch(), seqFor(), Statement, syncCounter, provisionUser(), recordLogin(), acceptInvite() (+31 more)

### Community 7 - "Sync API and Apply Tests"
Cohesion: 0.07
Nodes (33): Plan, G, ME, OTHER, PullQuery, SyncApi, EngineOptions, Environment (+25 more)

### Community 8 - "Insights and Budget Hooks"
Cohesion: 0.12
Nodes (26): HeroCard(), HeroStepper(), HeroStepperProps, newestFirst(), useBudgets(), useCategoryLookup(), useExpensesInMonth(), useMonthStartDay() (+18 more)

### Community 9 - "Group Management Tests"
Cohesion: 0.14
Nodes (31): groupWithEverything(), connect(), Connection, connectRaw(), pushExpense(), settle(), sharedGroup(), until() (+23 more)

### Community 10 - "Dialog and Button UI"
Cohesion: 0.17
Nodes (32): useEngine(), Spinner(), Button(), Dialog(), DialogContent(), DialogDescription(), DialogFooter(), DialogHeader() (+24 more)

### Community 11 - "Local Entity Types"
Cohesion: 0.08
Nodes (35): LocalExpense, LocalGroup, LocalMember, LocalRecurring, LocalSettlement, ExpenseFormProps, ExpenseListProps, ActivityTabProps (+27 more)

### Community 12 - "Live Update Channel"
Cohesion: 0.09
Nodes (7): SignedIn, LiveChannel, LiveOptions, LiveSocket, channel(), connections, FakeSocket

### Community 13 - "Bank Import Detection"
Cohesion: 0.10
Nodes (32): ALIASES, BANK_PRESETS, DateOrder, detectBank(), detectColumns(), ExistingExpense, Field, findDuplicates() (+24 more)

### Community 14 - "Biome Lint Config"
Cohesion: 0.05
Nodes (39): source, assist, actions, noUnusedImports, noUnusedVariables, useExhaustiveDependencies, useHookAtTopLevel, css (+31 more)

### Community 15 - "Root Package Config"
Cohesion: 0.05
Nodes (39): allowScripts, esbuild, workerd, devDependencies, @biomejs/biome, concurrently, @playwright/test, @types/node (+31 more)

### Community 16 - "Auth Context and App Shell"
Cohesion: 0.13
Nodes (29): googleStartUrl(), isStandalone(), useAuth(), SignedInContext, SignedInProvider(), useSyncStatus(), AppShell(), RequireAuth() (+21 more)

### Community 17 - "Shared Zod Schemas"
Cohesion: 0.08
Nodes (33): RECURRENCES, allocationAmountSchema, allocationSchema, budgetDataSchema, budgetRowSchema, categoryDataSchema, categoryRowSchema, checkSplit() (+25 more)

### Community 18 - "App Setup and Origin Check"
Cohesion: 0.10
Nodes (22): App, AppEnv, Config, Logger, originCheck(), SAFE_METHODS, requestLogger(), AuthContext (+14 more)

### Community 19 - "TypeScript Project Configs"
Cohesion: 0.06
Nodes (29): compilerOptions, types, extends, include, compilerOptions, types, extends, include (+21 more)

### Community 20 - "Sign-in Attempt Redemption"
Cohesion: 0.09
Nodes (18): ATTEMPT_WINDOW_MS, cancelAttempt(), hasPendingAttempt(), redeemAttempt(), RedeemResult, redeemSchema, AuthApi, AuthContext (+10 more)

### Community 21 - "Avatar and Split Drafts"
Cohesion: 0.10
Nodes (22): Avatar(), AvatarBadge(), AvatarFallback(), AvatarGroup(), AvatarGroupCount(), AvatarImage(), Checkbox(), parsePercent() (+14 more)

### Community 22 - "Pull Apply and Local DB"
Cohesion: 0.12
Nodes (22): ApplyOptions, applyPull(), ApplyResult, BACKFILL_PREFIX, purgeGroup(), apply(), BudgetDb, getDb() (+14 more)

### Community 23 - "Crypto Utilities"
Cohesion: 0.07
Nodes (28): RFC-4648, base64url(), digest(), randomToken(), text(), WebCrypto, acceptInviteRequestSchema, addPlaceholderResponseSchema (+20 more)

### Community 24 - "Server Config and Entry"
Cohesion: 0.12
Nodes (27): createApp(), cache, envSchema, loadConfig(), optionalText, createDb(), app, fetch() (+19 more)

### Community 25 - "App Routing and Layout"
Cohesion: 0.16
Nodes (23): App(), InsightsPage, AddExpenseFab(), NotFoundPage(), PageHeader(), PageHeaderProps, Skeleton(), Toaster() (+15 more)

### Community 26 - "Alert Dialog Components"
Cohesion: 0.18
Nodes (21): AlertDialog(), AlertDialogAction(), AlertDialogCancel(), AlertDialogContent(), AlertDialogDescription(), AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay() (+13 more)

### Community 27 - "Local Repo Writes"
Cohesion: 0.16
Nodes (27): announce(), baseVersionFor(), deleteBudget(), deleteCategory(), deleteExpense(), deleteRecurring(), deleteSettlement(), Listener (+19 more)

### Community 28 - "Cards and Settings Page"
Cohesion: 0.24
Nodes (21): Card(), CardContent(), CardDescription(), CardHeader(), CardTitle(), MONTH_START_KEY, BalancesTab(), InstallCard() (+13 more)

### Community 29 - "Recurring Expense Generation"
Cohesion: 0.13
Nodes (10): Db, recurringRules, inFlight, everyoneStillIn, GenerateResult, ruleData(), today(), RECURRING_MAX_BACKFILL_DAYS (+2 more)

### Community 30 - "Sync Types and Shared Data"
Cohesion: 0.10
Nodes (12): OutboxEntry, Rejection, SyncEvents, BudgetData, BudgetRow, CategoryData, CategoryRow, EntityName (+4 more)

### Community 31 - "Auth Tests and Helpers"
Cohesion: 0.16
Nodes (14): location(), signInElsewhere(), start(), app, b64url(), Client, db, EnvOverrides (+6 more)

### Community 32 - "Web Package Config"
Cohesion: 0.10
Nodes (20): vitest, zod, name, private, type, version, api, clsx (+12 more)

### Community 33 - "Expense List and Avatars"
Cohesion: 0.16
Nodes (15): PersonAvatar(), tintFor(), TINTS, personName(), ExpenseList(), ActivityTab(), currentMonth(), formatDay() (+7 more)

### Community 34 - "Auth and Sync Schema"
Cohesion: 0.11
Nodes (10): oauthStates, invites, memberships, auditLog, processedMutations, syncColumns, db, now (+2 more)

### Community 36 - "Budget Choices"
Cohesion: 0.14
Nodes (16): LocalBudget, LocalCategory, BudgetDialogProps, BudgetChoice, budgetChoices(), OVERALL, budget(), category() (+8 more)

### Community 37 - "Money and Health"
Cohesion: 0.12
Nodes (10): app, HealthState, CURRENCY, formatters, MAX_PAISE, PAISE_PER_RUPEE, HealthResponse, healthResponseSchema (+2 more)

### Community 38 - "shadcn Components Config"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 39 - "Expense Search Filters"
Cohesion: 0.16
Nodes (15): categoryChoices(), filterExpenses(), NO_FILTERS, norm(), SearchFilters, all, categories, chai (+7 more)

### Community 40 - "Shared Package Config"
Cohesion: 0.12
Nodes (15): dependencies, zod, devDependencies, fast-check, vitest, exports, vitest, zod (+7 more)

### Community 41 - "Split Calculations"
Cohesion: 0.20
Nodes (11): allocateByWeights(), BASIS_POINTS_TOTAL, computeShares(), isPositiveInt(), Share, SPLIT_TYPES, SplitError, SplitParticipant (+3 more)

### Community 42 - "Base TypeScript Config"
Cohesion: 0.12
Nodes (15): compilerOptions, esModuleInterop, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+7 more)

### Community 43 - "Server Package and Vitest"
Cohesion: 0.13
Nodes (10): vitest, zod, name, private, type, version, @budget/shared, @cloudflare/vitest-pool-workers (+2 more)

### Community 44 - "Web Runtime Dependencies"
Cohesion: 0.13
Nodes (15): dependencies, @budget/shared, class-variance-authority, clsx, dexie, dexie-react-hooks, lucide-react, radix-ui (+7 more)

### Community 45 - "Web Dev Dependencies"
Cohesion: 0.15
Nodes (13): devDependencies, fake-indexeddb, tailwindcss, @tailwindcss/vite, tw-animate-css, @types/react, @types/react-dom, vite (+5 more)

### Community 46 - "Server NPM Scripts"
Cohesion: 0.18
Nodes (11): scripts, build, cf-typegen, db:generate, db:migrate:local, db:migrate:remote, deploy, dev (+3 more)

### Community 47 - "Shared Limits Constants"
Cohesion: 0.18
Nodes (10): CATEGORY_NAME_MAX, DISPLAY_NAME_MAX, GROUP_NAME_MAX, INVITE_MAX_USES, INVITE_TTL_DAYS, MAX_GROUPS_PER_USER, MAX_IMPORT_ROWS, NOTE_MAX (+2 more)

### Community 48 - "Live Hub Durable Object"
Cohesion: 0.22
Nodes (5): Attachment, CHANGED_MESSAGE, LiveHub, MAX_SOCKETS_PER_USER, tagFor()

### Community 50 - "Web Entry and PWA"
Cohesion: 0.29
Nodes (3): root, registerPwa(), react-dom

### Community 51 - "Web NPM Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, icons, preview, test, typecheck

### Community 52 - "Server Dependencies"
Cohesion: 0.33
Nodes (6): dependencies, arctic, @budget/shared, drizzle-orm, hono, zod

### Community 53 - "ID Generation"
Cohesion: 0.47
Nodes (3): isUuid(), RandomSource, uuidv7Timestamp()

### Community 54 - "Server Dev Dependencies"
Cohesion: 0.40
Nodes (5): devDependencies, @cloudflare/vitest-pool-workers, drizzle-kit, vitest, wrangler

## Knowledge Gaps
- **369 isolated node(s):** `Api`, `ManifestIcon`, `BudgetLike`, `Measure`, `PeriodSummary` (+364 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 524 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `me()` connect `API Authorization E2E Tests` to `Avatar and Split Drafts`, `Sync API and Apply Tests`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Why does `uuidv7()` connect `Group Management Tests` to `Login Attempts and Cookies`, `Budget Choices`, `Expense Form Controls`, `Sync Batching and Invites`, `Sync API and Apply Tests`, `Dialog and Button UI`, `Local Entity Types`, `Bank Import Detection`, `Group Management and Invites`, `Shared Zod Schemas`, `ID Generation`, `Local Repo Writes`, `Recurring Expense Generation`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `react` connect `Category Icons and Badges` to `Web Package Config`, `Expense Form Controls`, `Money and Health`, `Insights and Budget Hooks`, `Dialog and Button UI`, `Bank Import Detection`, `Auth Context and App Shell`, `Web Entry and PWA`, `Sign-in Attempt Redemption`, `Avatar and Split Drafts`, `App Routing and Layout`, `Alert Dialog Components`, `Cards and Settings Page`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **What connects `Api`, `ManifestIcon`, `BudgetLike` to the rest of the system?**
  _369 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `API Authorization E2E Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.07305061559507524 - nodes in this community are weakly interconnected._
- **Should `Recurring Schedule Descriptions` be split into smaller, more focused modules?**
  _Cohesion score 0.05985915492957746 - nodes in this community are weakly interconnected._
- **Should `Category Icons and Badges` be split into smaller, more focused modules?**
  _Cohesion score 0.06919945725915876 - nodes in this community are weakly interconnected._