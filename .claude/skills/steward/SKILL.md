---
name: steward
description: This repository's conventions for driving a pull request to merge, for any Claude session or pipeline run: branch names, the PR template, the board stages, merge commits not rebases, the fix and review caps, the flake policy, and when a card goes to Blocked. Read before acting on a pull request here.
---

# Driving a pull request in this repo

## Conventions

- **Branches**: `<type>/<issue>-<slug>` with type `feat`, `fix`, `test` or `chore`, one branch per
  issue (CLAUDE.md, "Git"). Never work on `main`.
- **Pull requests** fill `.github/pull_request_template.md`, starting with `Closes #<issue>`. The
  plan and the discussion live in the issue; link it, do not copy it.
- **Plans and bugs live in GitHub issues**, never in files in the repository.
- **History**: merge commits. Bring `main` in with `git merge origin/main`; never rebase or
  force-push a branch someone else may have checked out.
- **Lockfile and generated files** are regenerated with the repo's tools (`npm install`,
  `npm run db:generate`, `graphify update .`), never edited by hand.

## The board (the AI SDLC, docs/ai-sdlc.md)

Todo (plan, then `/approve`) → In Progress (implementing) → In Review (CI, AI review, fixes, your
approval) → Done (merged, then deployed). The pipeline merges a board pull request itself once CI is
green on the head, every review thread is resolved, the AI review passed on the head, and the owner
approved the head commit.

## Fixing

- CI red: find the root cause first; "flaky" needs evidence (it passed on the same commit, or died
  before any test ran). One re-run at most. Never skip, disable or loosen a test, never push an
  empty commit to re-trigger CI.
- Review threads: fix blocking findings and small, local requests; reply on every thread (fixed in
  which commit, or why not); large design requests go to the owner.
- Caps: three CI fixes in a row and three review rounds, then the card moves to **Blocked** with a
  comment for the owner, who answers and comments `/resume`.
- A usage limit on the Claude plan is not a failure: the pipeline pauses and resumes after the
  reset, with the work in progress saved as an artifact.
