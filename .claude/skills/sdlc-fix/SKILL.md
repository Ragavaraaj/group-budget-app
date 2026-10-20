---
name: sdlc-fix
description: Fix a pull request for the AI SDLC: a red CI run, review threads (the AI's or a person's), or a merge conflict. Routes the work to the right agent, pushes the fix, and returns replies and resolved threads as structured output. Use when asked to fix pull request #n, or by the SDLC fix workflow.
---

# Fix a pull request

Input: a pull request number, the reason (`ci`, `review` or `conflict`), its branch checked out, CI
evidence (when the reason is `ci`) and the open threads file. Output: a verdict, one reply per
thread handled, the threads the push fixes, and any bug issues filed. **The pipeline posts the
replies and resolves the threads**; do not post comments yourself.

Agents: `ci-fixer`, `sync-engineer`, `server-engineer`, `ui-engineer`, `test-engineer`, `docs-writer`
Skills: `pre-push-checks`, `report-bug`, `codebase-graph`

## Rules

- Push to the pull request's branch only. Never force-push, never rebase, never push an empty
  commit, never skip, disable or loosen a test.
- Keep the fix to what the failure or the comment needs; do not widen the change.

## By reason

- **`ci`**: give the evidence folder to `ci-fixer` and let it find the root cause. Its verdict is
  yours: `fixed`, `flaky`, `unrelated`, `bug_reported` or `needs_human`.
- **`review`**: go through every open thread in the threads file, the AI's and people's alike.
  - A blocking finding, or a person's small, local request (a rename, a test, a one-function
    change): fix it with the agent for its path (`apps/web/src` → `ui-engineer`, `apps/server` →
    `server-engineer`, sync files → `sync-engineer`, tests → `test-engineer`), and reply with what
    changed and the commit.
  - A nit you agree with: fix it in the same push. One you do not: reply why it stays.
  - A large or design-level request from a person (a refactor across files, an API or schema
    change): reply with a short proposal and return `needs_human`, so the owner decides.
- **`conflict`**: `git fetch origin main && git merge origin/main` (a merge commit, never a
  rebase). Resolve each conflict keeping both sides' intent; regenerate `package-lock.json` with
  `npm install` rather than by hand; for `graphify-out/` take either side and rebuild the graph.
  Ask for a person (`needs_human`) only when both sides changed the same logic and one would be lost.

## Then

1. If code changed: run the `pre-push-checks` skill, then `docs-writer` (docs and the graph).
2. Commit and `git push`.
3. Return the structured output: `verdict`; `summary`; `replies` as `{comment_id, body}` (the id of
   the thread's first comment, from the threads file; the body names the commit or says why not);
   `resolved_thread_ids` for the threads the push addresses; `bug_issues` you filed.
