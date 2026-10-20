# Graph Report - group-budget-app  (2026-10-19)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2037 nodes · 6662 edges · 66 communities (63 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 88 edges (avg confidence: 0.87)
- Token cost: 50,358 input · 839 output

## Graph Freshness
- Built from commit: `3bb9e6a0`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- E2E Auth and API Tests
- Sign-in Attempt Redemption
- Shared Limits Constants
- Dialog and Category Icons
- Board Card Decisions
- Sync Database Schema
- App Pages and Navigation
- Recurring Expense Generation and Dates
- Navigation and Avatars UI
- Recurring Form Controls
- CSV Export and Pull Tests
- Live Update Hub
- Person Avatar and Alert Dialog
- SDLC CLI Commands
- Server Sync Tests
- Session and OAuth Cookies
- Root Package Config
- App Startup and PWA Updates
- Local Database and Hooks
- Batch Writes and Group Membership
- Server Schema and Test Helpers
- Bank Import Page
- Sync Engine
- Live Channel Client
- Biome Lint Config
- Shared Package Config
- Insights Charts and Budgets
- TypeScript Project Configs
- GitHub Client
- Server Package Config
- Local Repository Writes
- Hono App Middleware
- Context Hooks and Sync Status
- Project Board Doctor
- Repo Checks and Agent Policy
- Server Config and Entry
- Balances and Settlements UI
- Server Test Setup
- Board Events and Merge
- Rate Limit Handling
- Pull Apply Logic
- API Zod Schemas
- Card Polling and Pause
- Web Package Config
- shadcn Components Config
- Branch Naming and Plans
- Crypto and Tokens
- Expense Filtering
- Base TypeScript Config
- Web Dependencies
- Server Vitest and Sessions
- Web Dev Dependencies
- SDLC Package Config
- Auth and Group Schema
- Pull Request Review Posting
- Budget Choices
- Server HTML Pages
- Web Scripts
- Server Node TS Config
- Category Breakdown
- Web Node TS Config
- Vite Config
- Logger
- CSV Parsing
- Build ID
- Default Categories

## God Nodes (most connected - your core abstractions)
1. `cn()` - 98 edges
2. `Button()` - 66 edges
3. `vitest` - 56 edges
4. `useDb()` - 50 edges
5. `react` - 50 edges
6. `InsightsPage()` - 45 edges
7. `useMe()` - 39 edges
8. `RecurringForm()` - 37 edges
9. `ImportPage()` - 34 edges
10. `lucide-react` - 34 edges

## Surprising Connections (you probably didn't know these)
- `Where things stand` --references--> `cn()`  [INFERRED]
  docs/roadmap.md → apps/web/src/lib/utils.ts
- `Frontend` --references--> `resolveSplit()`  [INFERRED]
  docs/frontend.md → apps/web/src/features/expenses/split-draft.ts
- `Testing and quality` --references--> `Client`  [INFERRED]
  docs/testing.md → apps/server/test/helpers.ts
- `Sync protocol` --references--> `NetworkError`  [INFERRED]
  docs/sync.md → apps/web/src/lib/api.ts
- `Sync protocol` --references--> `meta()`  [INFERRED]
  docs/sync.md → apps/web/src/db/repo.ts

## Import Cycles
- None detected.

## Communities (66 total, 3 thin omitted)

### Community 0 - "E2E Auth and API Tests"
Cohesion: 0.06
Nodes (61): Testing, Infrastructure and operations (Cloudflare), Api, expenseMutation(), me(), Setup, addDinner(), addExpenseOn() (+53 more)

### Community 1 - "Sign-in Attempt Redemption"
Cohesion: 0.05
Nodes (52): ATTEMPT_WINDOW_MS, cancelAttempt(), googleStartUrl(), hasPendingAttempt(), redeemAttempt(), RedeemResult, redeemSchema, AuthApi (+44 more)

### Community 2 - "Shared Limits Constants"
Cohesion: 0.05
Nodes (57): CATEGORY_NAME_MAX, DISPLAY_NAME_MAX, GROUP_NAME_MAX, INVITE_MAX_USES, INVITE_TTL_DAYS, MAX_BUDGETS_PER_GROUP, MAX_GROUP_MEMBERS, MAX_GROUPS_PER_USER (+49 more)

### Community 3 - "Dialog and Category Icons"
Cohesion: 0.16
Nodes (40): useEngine(), CATEGORY_COLORS, CATEGORY_ICONS, CategoryIcon(), CategoryIconProps, Button(), Dialog(), DialogContent() (+32 more)

### Community 4 - "Board Card Decisions"
Cohesion: 0.08
Nodes (47): Card, CardUpdate, Control, Action, CardSnapshot, decideCard(), fixAllowed(), GateResult (+39 more)

### Community 5 - "Sync Database Schema"
Cohesion: 0.08
Nodes (48): auditLog, budgets, categories, expenses, processedMutations, recurringRules, settlements, syncColumns (+40 more)

### Community 6 - "App Pages and Navigation"
Cohesion: 0.14
Nodes (42): App(), InsightsPage, AddExpenseFab(), HeroCard(), HeroStepper(), NotFoundPage(), PageHeader(), PageHeaderProps (+34 more)

### Community 7 - "Recurring Expense Generation and Dates"
Cohesion: 0.10
Nodes (41): everyoneStillIn, generateDueExpenses(), GenerateResult, seqSql(), addDays(), addMonths(), dateInMonth(), daysBetween() (+33 more)

### Community 8 - "Navigation and Avatars UI"
Cohesion: 0.10
Nodes (35): items, NavItem, HeroStepperProps, AlertDialogMedia(), AvatarBadge(), AvatarGroup(), AvatarGroupCount(), badgeVariants (+27 more)

### Community 9 - "Recurring Form Controls"
Cohesion: 0.12
Nodes (41): Select(), SelectItem(), SelectTrigger(), SelectValue(), Switch(), ToggleGroup(), ToggleGroupContext, ToggleGroupItem() (+33 more)

### Community 10 - "CSV Export and Pull Tests"
Cohesion: 0.06
Nodes (32): BACKFILL_PREFIX, csvCell(), expensesToCsv(), rupees(), PullQuery, Environment, G, ME (+24 more)

### Community 11 - "Live Update Hub"
Cohesion: 0.07
Nodes (28): Attachment, CHANGED_MESSAGE, LiveHub, MAX_SOCKETS_PER_USER, tagFor(), settlement(), Commands (run from the repo root), Conventions (+20 more)

### Community 12 - "Person Avatar and Alert Dialog"
Cohesion: 0.10
Nodes (36): PersonAvatar(), tintFor(), TINTS, AlertDialog(), AlertDialogAction(), AlertDialogCancel(), AlertDialogContent(), AlertDialogDescription() (+28 more)

### Community 13 - "SDLC CLI Commands"
Cohesion: 0.13
Nodes (40): changeTypeFor(), blockCard(), deferWork(), main(), repoRoot(), mergeCommand(), afterFix(), afterImplement() (+32 more)

### Community 14 - "Server Sync Tests"
Cohesion: 0.12
Nodes (26): settleNotifications(), groupWithEverything(), connect(), Connection, connectRaw(), pushExpense(), settle(), sharedGroup() (+18 more)

### Community 15 - "Session and OAuth Cookies"
Cohesion: 0.10
Nodes (37): base(), C, clearOauthCookie(), clearSessionCookie(), getOauthCookie(), OAUTH_COOKIE, OAUTH_TTL_MS, SESSION_COOKIE (+29 more)

### Community 16 - "Root Package Config"
Cohesion: 0.05
Nodes (43): allowScripts, esbuild, workerd, devDependencies, @biomejs/biome, concurrently, @playwright/test, @types/node (+35 more)

### Community 17 - "App Startup and PWA Updates"
Cohesion: 0.09
Nodes (21): NOW(), root, STARTED_BY, trackInteraction(), registerPwa(), ACTIVATION_GRACE_MS, handleUpdateFound(), LastAutoUpdate (+13 more)

### Community 18 - "Local Database and Hooks"
Cohesion: 0.11
Nodes (34): SignedIn, BudgetDb, getDb(), getMeta(), open, MONTH_START_KEY, newestFirst(), personName() (+26 more)

### Community 19 - "Batch Writes and Group Membership"
Cohesion: 0.14
Nodes (38): reserveSeq(), runBatch(), seqFor(), Statement, provisionUser(), recordLogin(), acceptInvite(), AcceptInviteResult (+30 more)

### Community 20 - "Server Schema and Test Helpers"
Cohesion: 0.09
Nodes (15): app, b64url(), Client, db, EnvOverrides, fakeIdToken(), mockGoogleToken(), ORIGIN (+7 more)

### Community 21 - "Bank Import Page"
Cohesion: 0.10
Nodes (32): Checkbox(), useExpensesOfGroups(), ALIASES, BANK_PRESETS, DateOrder, detectBank(), detectColumns(), ExistingExpense (+24 more)

### Community 22 - "Sync Engine"
Cohesion: 0.10
Nodes (14): SyncApi, browserEnvironment, describeError(), endsCycle(), inStep(), isSessionEnd(), StepDetail, StepFailed (+6 more)

### Community 23 - "Live Channel Client"
Cohesion: 0.10
Nodes (6): LiveChannel, LiveOptions, LiveSocket, channel(), connections, FakeSocket

### Community 24 - "Biome Lint Config"
Cohesion: 0.05
Nodes (39): source, assist, actions, noUnusedImports, noUnusedVariables, useExhaustiveDependencies, useHookAtTopLevel, css (+31 more)

### Community 25 - "Shared Package Config"
Cohesion: 0.07
Nodes (31): dependencies, zod, devDependencies, fast-check, vitest, exports, vitest, zod (+23 more)

### Community 26 - "Insights Charts and Budgets"
Cohesion: 0.13
Nodes (29): useCategoriesOfGroups(), BAR, BudgetBar(), BarDatum, CategoryBars(), TrendChart(), InsightsPage(), View (+21 more)

### Community 27 - "TypeScript Project Configs"
Cohesion: 0.06
Nodes (30): compilerOptions, paths, types, extends, include, compilerOptions, jsx, lib (+22 more)

### Community 28 - "GitHub Client"
Cohesion: 0.12
Nodes (31): Review, Env, createClient(), request(), Fetch, GitHubClient, GitHubError, paginate() (+23 more)

### Community 29 - "Server Package Config"
Cohesion: 0.06
Nodes (32): dependencies, arctic, @budget/shared, drizzle-orm, hono, zod, devDependencies, @cloudflare/vitest-pool-workers (+24 more)

### Community 30 - "Local Repository Writes"
Cohesion: 0.12
Nodes (29): announce(), baseVersionFor(), Listener, listeners, meta(), onLocalWrite(), queue(), saveBudget() (+21 more)

### Community 31 - "Hono App Middleware"
Cohesion: 0.18
Nodes (23): App, AppEnv, createApp(), Config, Db, originCheck(), SAFE_METHODS, requestLogger() (+15 more)

### Community 32 - "Context Hooks and Sync Status"
Cohesion: 0.15
Nodes (21): SignedInContext, useDb(), useMe(), useSignedIn(), useSyncStatus(), describe(), SyncStatusChip(), useExpense() (+13 more)

### Community 33 - "Project Board Doctor"
Cohesion: 0.17
Nodes (26): openProject(), pauseLine(), renderControl(), saveControl(), Check, doctor(), table(), FIELD_STAGE (+18 more)

### Community 34 - "Repo Checks and Agent Policy"
Cohesion: 0.13
Nodes (18): AGENT_POLICY, AgentPolicy, MODEL_ALIASES, callArgs(), checkBugRefs(), isTestPath(), SourceFile, claudeFiles() (+10 more)

### Community 35 - "Server Config and Entry"
Cohesion: 0.15
Nodes (20): cache, envSchema, loadConfig(), optionalText, createDb(), memberships, app, fetch() (+12 more)

### Community 36 - "Balances and Settlements UI"
Cohesion: 0.27
Nodes (20): Badge(), Card(), CardContent(), CardDescription(), CardHeader(), CardTitle(), deleteSettlement(), restoreSettlement() (+12 more)

### Community 37 - "Server Test Setup"
Cohesion: 0.11
Nodes (7): app, Cloudflare, Env, beforeBatch(), counting(), ruleData(), today()

### Community 38 - "Board Events and Merge"
Cohesion: 0.24
Nodes (20): boardCardForPr(), saveCard(), unblockCard(), boardEvent(), commentCommand(), IssueEvent, trusted(), deployed() (+12 more)

### Community 39 - "Rate Limit Handling"
Cohesion: 0.14
Nodes (19): classifyRun(), DAYS, LIMIT_BACKOFF, LogEntry, MODEL_UNAVAILABLE, nextResume(), nextWallTime(), OVERLOADED (+11 more)

### Community 40 - "Pull Apply Logic"
Cohesion: 0.16
Nodes (14): ApplyOptions, applyPull(), ApplyResult, purgeGroup(), setMeta(), entityTables(), tableFor(), Rejection (+6 more)

### Community 41 - "API Zod Schemas"
Cohesion: 0.10
Nodes (19): acceptInviteRequestSchema, addPlaceholderResponseSchema, attemptRedeemRequestSchema, authConfigResponseSchema, createGroupRequestSchema, CreateInviteResponse, createInviteResponseSchema, devLoginRequestSchema (+11 more)

### Community 42 - "Card Polling and Pause"
Cohesion: 0.22
Nodes (19): isPaused(), loadCard(), loadControl(), describe(), poll(), run(), snapshot(), pause() (+11 more)

### Community 43 - "Web Package Config"
Cohesion: 0.11
Nodes (17): @budget/shared, vitest, zod, name, private, type, version, clsx (+9 more)

### Community 44 - "shadcn Components Config"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 45 - "Branch Naming and Plans"
Cohesion: 0.21
Nodes (14): branchName(), issueOfBranch(), isValidBranch(), slugify(), CHANGE_TYPES, ChangeType, extractPlan(), hasPlan() (+6 more)

### Community 46 - "Crypto and Tokens"
Cohesion: 0.18
Nodes (12): constantTimeEqual(), encoder, createInvite(), RFC-4648, base64url(), digest(), randomToken(), sha256Hex() (+4 more)

### Community 47 - "Expense Filtering"
Cohesion: 0.17
Nodes (14): categoryChoices(), filterExpenses(), NO_FILTERS, norm(), SearchFilters, all, categories, chai (+6 more)

### Community 48 - "Base TypeScript Config"
Cohesion: 0.12
Nodes (15): compilerOptions, esModuleInterop, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+7 more)

### Community 49 - "Web Dependencies"
Cohesion: 0.13
Nodes (15): dependencies, @budget/shared, class-variance-authority, clsx, dexie, dexie-react-hooks, lucide-react, radix-ui (+7 more)

### Community 50 - "Server Vitest and Sessions"
Cohesion: 0.17
Nodes (4): db, now, @cloudflare/vitest-pool-workers, vitest

### Community 51 - "Web Dev Dependencies"
Cohesion: 0.15
Nodes (13): devDependencies, fake-indexeddb, tailwindcss, @tailwindcss/vite, tw-animate-css, @types/react, @types/react-dom, vite (+5 more)

### Community 52 - "SDLC Package Config"
Cohesion: 0.15
Nodes (12): bin, sdlc, description, devDependencies, vitest, name, private, scripts (+4 more)

### Community 53 - "Auth and Group Schema"
Cohesion: 0.26
Nodes (7): loginAttempts, oauthStates, groups, invites, sessions, users, drizzle-orm

### Community 54 - "Pull Request Review Posting"
Cohesion: 0.26
Nodes (10): ReviewOutput, buildReview(), commentableLines(), Finding, findingBody(), REVIEW_MARKER, ReviewPayload, Severity (+2 more)

### Community 55 - "Budget Choices"
Cohesion: 0.27
Nodes (8): LocalBudget, BudgetDialogProps, BudgetChoice, OVERALL, budget(), food, rent, budgetRow()

### Community 56 - "Server HTML Pages"
Cohesion: 0.50
Nodes (7): confirmPage(), devIdpPage(), escapeHtml(), layout(), messagePage(), PAGE_CSP, Testing and quality

### Community 57 - "Web Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, icons, preview, test, typecheck

### Community 58 - "Server Node TS Config"
Cohesion: 0.33
Nodes (5): compilerOptions, types, extends, include, ../../tsconfig.base.json

### Community 59 - "Category Breakdown"
Cohesion: 0.47
Nodes (4): BreakdownRow, limitRows(), nameCategories(), CategoryTotal

### Community 60 - "Web Node TS Config"
Cohesion: 0.33
Nodes (5): compilerOptions, types, extends, include, ../../tsconfig.base.json

### Community 61 - "Vite Config"
Cohesion: 0.33
Nodes (5): api, @tailwindcss/vite, vite, vite-plugin-pwa, @vitejs/plugin-react

### Community 63 - "CSV Parsing"
Cohesion: 0.70
Nodes (3): DELIMITERS, detectDelimiter(), parseCsv()

## Knowledge Gaps
- **22 isolated node(s):** `@biomejs/biome`, `concurrently`, `@types/node`, `typescript`, `vitest` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 596 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `Server Vitest and Sessions` to `Sign-in Attempt Redemption`, `Shared Limits Constants`, `Dialog and Category Icons`, `Board Card Decisions`, `Recurring Expense Generation and Dates`, `Recurring Form Controls`, `CSV Export and Pull Tests`, `Person Avatar and Alert Dialog`, `SDLC CLI Commands`, `Server Sync Tests`, `App Startup and PWA Updates`, `Local Database and Hooks`, `Server Schema and Test Helpers`, `Bank Import Page`, `Live Channel Client`, `Shared Package Config`, `Insights Charts and Budgets`, `Local Repository Writes`, `Context Hooks and Sync Status`, `Repo Checks and Agent Policy`, `Server Config and Entry`, `Server Test Setup`, `Rate Limit Handling`, `Branch Naming and Plans`, `Crypto and Tokens`, `Expense Filtering`, `SDLC Package Config`, `Pull Request Review Posting`, `Budget Choices`, `Category Breakdown`, `CSV Parsing`, `Build ID`?**
  _High betweenness centrality (0.277) - this node is a cross-community bridge._
- **What connects `@biomejs/biome`, `concurrently`, `@types/node` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `E2E Auth and API Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.05555555555555555 - nodes in this community are weakly interconnected._
- **Why does `me()` connect `E2E Auth and API Tests` to `Recurring Form Controls`, `CSV Export and Pull Tests`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **Should `Sign-in Attempt Redemption` be split into smaller, more focused modules?**
  _Cohesion score 0.05307797537619699 - nodes in this community are weakly interconnected._
- **Why does `@playwright/test` connect `E2E Auth and API Tests` to `Root Package Config`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Should `Shared Limits Constants` be split into smaller, more focused modules?**
  _Cohesion score 0.047115384615384615 - nodes in this community are weakly interconnected._