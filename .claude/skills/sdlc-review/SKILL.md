---
name: sdlc-review
description: AI review of a pull request for the AI SDLC. Runs the code reviewer and the specialist reviewers for the paths that changed in parallel, verifies and deduplicates their findings, and returns them as structured output for the pipeline to post. Use when asked to review pull request #n, or by the SDLC review workflow.
---

# Review a pull request

Input: a pull request number, its head checked out, the open threads file, and a review depth
(`full` or `light`). Output: findings, earlier AI threads now fixed, and a summary. **Post nothing
yourself**; the pipeline posts one review from your output.

Agents: `code-reviewer`, `ui-reviewer`, `security-reviewer`
Skills: `codebase-graph`

## Steps

1. Look at the change: `git diff --stat origin/main...HEAD` and `gh pr view <n>` (title, body,
   linked issue). Read the plan in the linked issue: the change should do what it says, no more.
2. Pick the reviewers. Always `code-reviewer`. With depth `full`, also:
   - `ui-reviewer` when anything under `apps/web/src` or `apps/web/public` changed;
   - `security-reviewer` when `apps/server/src/modules/auth`, `apps/server/src/middleware`,
     `apps/server/src/config.ts`, any `routes.ts`, `apps/web/public/_headers` or
     `apps/server/wrangler.jsonc` changed.
3. **Spawn them in parallel** (all agent calls in one message). Give each the pull request number,
   the diff command `git diff origin/main...HEAD`, the files in its scope, and the threads file.
4. Merge their findings:
   - drop duplicates (same file and line, same problem), and anything that already has an open thread;
   - verify every 🔴 yourself by reading the code; keep it only with a realistic path to the failure;
   - `line` must be a line of the new file inside the diff; otherwise mention the location in the body.
5. For each open thread with `fromAiReview: true` in the threads file, check whether the new commits
   fix it; list the fixed ones in `resolved_thread_ids`. Never list a person's thread.
6. Return `findings` (`path`, `line`, `severity` blocking or nit, `title`, `body`),
   `resolved_thread_ids`, and a `summary` of two or three sentences.
