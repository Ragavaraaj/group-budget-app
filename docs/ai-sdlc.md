[← Plan overview](PLAN.md)

# AI SDLC: the board drives Claude in GitHub Actions

A card on the GitHub Project board goes from a title to deployed code with Claude doing the work in
GitHub Actions and the owner deciding at two points: approving the plan, and approving the pull
request. The board shows where every card is. **Plans and bugs live in GitHub issues, never in files
in the repository.**

## The flow

| Column | AI stage (board field) | What happens | Started by |
| --- | --- | --- | --- |
| **Todo** | Queued → Planning → Awaiting plan approval (or Needs input) | A draft card becomes an issue (label `sdlc`). Claude writes the plan into the issue body, between `<!-- sdlc:plan:start -->` and `<!-- sdlc:plan:end -->`, under your own text. | The poller (every 10 min), or `/replan` |
| **In Progress** | Implementing | Claude builds the plan on `<type>/<issue>-<slug>`, runs the checks, updates the docs and the Graphify graph, and opens a pull request that `Closes #<issue>`. | `/approve` (instant), or dragging the card here (next poll) |
| **In Review** | CI running → Fixing CI / AI review → Addressing review / Resolving conflict → Awaiting your approval → Merging | CI runs; the AI review posts findings; red CI, blocking findings, your review comments and merge conflicts are fixed on the branch. | Pull request, CI and review events; the poller |
| **Done** | Merged → Deployed (or Deploy failed) | Once the merge gate is open, the pipeline merges and CI on `main` deploys. | Your approval, CI turning green, or the poller |
| **Blocked** | Blocked | The card needs you: a cap was hit, Claude asked for a decision, or a run stopped. A comment says why. | — |

Out of Blocked: answer on the issue, then comment `/resume` (or drag the card out; dragging it to a
*different* column starts that column's stage instead).

**Paused (usage limit)** is not Blocked: when the Claude plan's usage limit is hit, the card stays
where it is and the work resumes on its own after the reset (see Usage limits).

Each issue also gets one **progress comment** from the pipeline: a checklist (plan written, approved,
PR opened, CI green, AI review passed, approved by you, merged, deployed), the current stage with a
link to its run, the round counters, and a history. The **AI note** field on the board repeats the
latest line and its run link.

**The merge gate** (all of these, on the pull request's current head commit): CI green; no unresolved
review thread; the AI review passed; your approval (an approval of an older commit does not count),
and nobody with push access requesting changes; the pull request closes its board issue; no conflict.
The merge is a merge commit made with `SDLC_TOKEN`, so the push to `main` runs CI and deploys.

## Commands (comments from the owner or a collaborator)

| Where | Command | Effect |
| --- | --- | --- |
| A card's issue | `/approve` | Start implementing the plan as it now stands in the issue |
| A card's issue | `/replan` | Rewrite the plan using the comments since the last one |
| A card's issue | `/resume` | Continue a Blocked card (or retry queued work now) |
| The "AI SDLC control" issue | `/pause` | Stop all AI work until `/resume-now` |
| The "AI SDLC control" issue | `/resume-now` | Clear a pause (manual or usage limit) and start the queued work |

Everything else is done on the board (drag a card) or on the pull request (review it, comment on a
line, approve).

## How it is built

**Workflows** (`.github/workflows/`):

| Workflow | Runs Claude | What it does |
| --- | --- | --- |
| `ci.yml` | no | Checks, then e2e in three shards, then deploy on `main` (below) |
| `sdlc-board.yml` | no | The poller; owner commands; bug issues joining the board; merged-by-hand PRs; marking cards Deployed |
| `sdlc-plan.yml` | yes | Plans a card; the plan goes into the issue |
| `sdlc-implement.yml` | yes | Implements an approved plan and opens the pull request |
| `sdlc-review.yml` | yes | The AI review of every pull request from this repository |
| `sdlc-fix.yml` | yes | Fixes red CI, review findings and conflicts |
| `sdlc-merge.yml` | no | Checks the merge gate and merges |
| `sdlc-doctor.yml` | no | Checks and sets up the board, labels and control issue |

**The CLI** (`tools/sdlc`, the `@budget/sdlc` workspace) does everything around the Claude runs: the
gate before each run (may it run now?), reading how a run ended, pausing, writing the plan into the
issue, posting reviews and replies, resolving threads, the board fields and the progress comment, the
poller's decisions and the merge gate. It has no dependencies and Node runs its TypeScript directly
(`node tools/sdlc/src/cli.ts help`). Its decisions are pure functions with unit tests
(`tools/sdlc/test`). The Claude workflows run the CLI from a checkout of `main` (`.sdlc-cli/`), so a
pull request cannot change the pipeline that is reviewing it.

**Claude** runs through `anthropics/claude-code-action` (the composite `.github/actions/claude-run`),
with the Claude GitHub App's token: its pushes and pull requests start CI, and its pull requests are
authored by `claude[bot]`, so the owner can approve them. Each stage's prompt is one line naming a
skill; the run has a tool allow-list (planning and review can't edit or push) and a deny-list (no
force-push, no rebase, no `gh api`, no merging). Review comments, thread replies and resolutions are
returned as structured output and posted by the CLI with the workflow's token, never by Claude.

### Custom agents and project skills

They live in `.claude/agents` and `.claude/skills`, so local and cloud Claude Code sessions use the
same specialists as the pipeline. On pull request checkouts the action takes `.claude/` and
`CLAUDE.md` from the base branch, so changes to them take effect once merged.
`npm run lint:claude` checks them in CI.

| Agent | Model, effort | Does |
| --- | --- | --- |
| `planner` | opus, xhigh | Card → plan and context, graph first |
| `code-reviewer` | opus, xhigh | The review agent: correctness and this repo's conventions |
| `ui-engineer` | sonnet, high | The UI agent: screens and components in `apps/web` |
| `server-engineer` | sonnet, high | The Worker: routes, D1 schema and migrations, auth, groups, the cron |
| `sync-engineer` | sonnet, high | The sync protocol across shared, web and server |
| `test-engineer` | sonnet, high | Unit and e2e tests, negative paths; bugs become issues |
| `ui-reviewer` | sonnet, high | Accessibility, 360 px layout, design system, copy |
| `security-reviewer` | sonnet, high | Sign-in, sessions, authorization, headers |
| `ci-fixer` | sonnet, high | Red CI from its artifacts: root cause, never a weaker test |
| `docs-writer` | sonnet, high | `docs/` and the Graphify graph, last in every change |

`opus` and `sonnet` are family aliases, which follow each family's newest model; the repository never
pins an exact model id. The policy is enforced by `tools/sdlc/src/agent-policy.ts`. The session that runs a stage skill uses `sonnet` unless the
`CLAUDE_MODEL` variable says otherwise.

| Skill | Use |
| --- | --- |
| `sdlc-plan`, `sdlc-implement`, `sdlc-review`, `sdlc-fix` | The four stages; also usable in a session ("use the sdlc-review skill for #40") |
| `codebase-graph` | Query Graphify before reading files; refresh it after changes |
| `pre-push-checks` | CI's checks in order, plus the affected e2e spec |
| `db-migration`, `synced-entity` | A schema change; a field or entity that syncs, through all three packages |
| `ui-feature`, `e2e-spec` | A screen or component; an e2e spec with the shared helpers |
| `report-bug` | A real bug found by a test: an issue, and `test.fail(true, 'Bug #n: …')` |
| `steward` | How to drive a pull request in this repo |

The review stage runs `code-reviewer` always, plus `ui-reviewer` when `apps/web` changed and
`security-reviewer` when auth, middleware, config, routes or headers changed, **in parallel**.
The implement stage runs the area agents one after another (`sync`/`shared` → `server` → `ui`),
then `test-engineer`, the checks, and `docs-writer`.

### Artifacts: nothing built or explored twice

| Artifact | Made by | Used by | Saves |
| --- | --- | --- | --- |
| `web-dist` | CI `check` | the e2e shards, and deploy | three rebuilds a run; deploy ships the tested build |
| `blob-report-<n>` → `playwright-report`, `e2e-results` | the e2e shards → the `e2e` job | people, and `sdlc-fix` | the fixer starts from the failures instead of re-running the suite |
| `sdlc-plan-<issue>` | `sdlc-plan` | `sdlc-implement` | the implementer resumes the planning session and its context |
| `sdlc-session-<issue>` | implement, fix | fix | each fix round resumes with what came before |
| `sdlc-wip-<issue>` | any Claude run that does not finish | the same stage, after a pause or `/resume` | uncommitted changes, unpushed commits and the session survive |

Dependencies are cached instead (npm through `setup-node`, Playwright's browsers through
`.github/actions/playwright-browsers`). Artifacts of a public repository can be downloaded by any
signed-in GitHub user, so nothing secret goes into them; they are kept 7 days (blob reports 1).

**CI** builds once in `check` and uploads `web-dist`; three `e2e-shard` jobs download it and each run
a third of the suite; the `e2e` job keeps the old job's name, merges the reports and fails if any
shard failed; deploy downloads the same `web-dist` instead of building again.

## Usage limits

The pipeline runs on a Claude subscription (`CLAUDE_CODE_OAUTH_TOKEN`), so it shares the plan's usage
limits with your own use of Claude, and hitting one is expected.

- Every Claude job starts with a **gate** that costs seconds: if the pipeline is paused, or
  `SDLC_MAX_PARALLEL` Claude jobs (default 1) are already running, the work is recorded on the card
  and the job ends green without calling Claude. The poller starts queued work when a slot is free,
  oldest first.
- When a run hits the limit, the pipeline **pauses** until the reset time the message gives (plus two
  minutes), or backs off 30 minutes, 1 hour, 2 hours, then 5 hours when it gives none. The pause is
  shown on the "AI SDLC control" issue and in the board's description. The work in progress is saved
  (`sdlc-wip-<issue>`), and after the reset the same stage resumes from it.
- An overloaded API (529) or a rate limit without a reset time retries that card alone after 10 to 30
  minutes.
- To rehearse it without spending usage, set `SDLC_SIMULATE_LIMIT` to a stage (`implement`): its next
  run counts as limited, with a reset five minutes later.
- To stretch a small plan: keep `SDLC_MAX_PARALLEL=1`; set `SDLC_REVIEW_DEPTH=light` to review with
  `code-reviewer` alone; the two Opus agents run once per card and per review round. If your plan
  does not offer Opus in Claude Code, the run is Blocked with that reason: change `model: opus` to
  `model: sonnet` in `.claude/agents/planner.md` and `code-reviewer.md`, and in
  `tools/sdlc/src/agent-policy.ts`.

## Setup

1. **Claude**: run `claude setup-token` while signed in to your Claude subscription and store the
   token as the repository secret `CLAUDE_CODE_OAUTH_TOKEN` (or use `ANTHROPIC_API_KEY` for the API).
   The Claude GitHub App must be installed on the repository (`/install-github-app` in Claude Code).
2. **The board token**: create a classic personal access token with the `project` and `public_repo`
   scopes and store it as the secret `SDLC_TOKEN`. A personal project cannot be written with
   `GITHUB_TOKEN` or an app token, and merges made with it start CI on `main`.
3. **Variables** (Settings, Secrets and variables, Actions, Variables): `PROJECT_NUMBER` (the number
   in the board's URL). Optional: `SDLC_MAX_PARALLEL`, `SDLC_REVIEW_DEPTH`, `CLAUDE_MODEL`,
   `SDLC_ENABLED` (`false` switches everything off), `SDLC_SIMULATE_LIMIT`, `PROJECT_OWNER` and
   `SDLC_OWNER` (default: the repository owner).
4. **The board's Status field** needs the columns Todo, In Progress, In Review, Blocked and Done
   (names are matched loosely). Keep the board's built-in "Item closed → Done" workflow; turn off
   auto-adding pull requests, so a pull request does not appear as a second card.
5. **Merge to `main`**: scheduled, comment and dispatch triggers only run from the default branch.
6. **Run SDLC doctor** (Actions, SDLC doctor, Run workflow). It creates the AI stage and AI note
   fields, the labels and the control issue, links the repository, brings `bug` issues onto the
   board, and reports anything you must do by hand.
7. Recommended: protect `main` (require a pull request and the CI checks), so nothing reaches it
   without the gate.

## Bugs

Bugs are GitHub issues labelled `bug` (with `severity:*` and `area:*`), on the board; file one with
the **Bug** issue form. A trusted author's bug joins the board in Todo and goes through the same flow.
A test that shows an open bug is marked `test.fail(true, 'Bug #<n>: …')`, and
`npm run check:bug-refs` fails on a mark without an issue number. The bugs found before this
(`BUG-001` to `BUG-005`, all fixed) are closed issues #18 to #22.

## Guardrails

- Only cards on the owner's board are processed, and only comments and reviews from the owner,
  members and collaborators act. Pull requests from forks are not reviewed or fixed (they get no
  secrets).
- Caps: three CI fixes in a row (reset when CI turns green), three review rounds, one re-run of a job
  that looks flaky; then Blocked. Every stage has a turn budget and a time limit.
- One run at a time per issue or pull request.
- `SDLC_TOKEN` is only ever given to the CLI's own steps, never to a Claude step.
- GitHub may delay scheduled runs (a dragged card can wait 10 to 20 minutes; `/approve` does not), and
  turns schedules off after 60 days without activity in the repository.

## Troubleshooting

- **Nothing happens to a new card**: run SDLC doctor, then SDLC board (Run workflow) and read its
  summary: it lists what it decided for every card.
- **A card is stuck in Queued**: a slot is busy (`SDLC_MAX_PARALLEL`), or the pipeline is paused (the
  control issue says until when). A dispatch that never started is sent again after 90 minutes.
- **Blocked**: the card's last comment says why; the run link shows the details. Fix what it asks,
  then `/resume`.
- **The AI review never passes**: three rounds then Blocked; read the open threads, decide, and reply
  or resolve them yourself before `/resume`.
