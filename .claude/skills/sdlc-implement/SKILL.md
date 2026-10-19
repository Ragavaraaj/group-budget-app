---
name: sdlc-implement
description: Implement an approved plan for the AI SDLC. Builds the change on the given convention branch with the area agents in order, runs the checks, updates docs and the Graphify graph, and opens a pull request that closes the issue. Use when asked to implement issue #n, or by the SDLC implement workflow.
---

# Implement a planned card

Input: an issue number and a branch name (`<type>/<issue>-<slug>`). Output: a pull request that
closes the issue, with the checks green locally.

Agents: `sync-engineer`, `server-engineer`, `ui-engineer`, `test-engineer`, `docs-writer`
Skills: `pre-push-checks`, `codebase-graph`, `report-bug`

## Rules

- The plan in the issue body (between the `sdlc:plan` markers) is what you build; the owner may have
  edited it since it was written. Never copy it into a file, and never commit plans or notes.
- Use exactly the branch you were given. If it exists on `origin` (or is already checked out with
  earlier work restored), continue it; otherwise create it from `origin/main`.
- Never push to `main`, never force-push, never rebase a pushed branch, never skip or weaken a test.
- Follow `CLAUDE.md` throughout: paise, local-first writes, the dependency direction, tests in
  `test/`, TypeScript only.

## Steps

1. `gh issue view <n>` for the plan; read the planning context file if you were given one.
2. Branch: `git fetch origin`, then `git switch <branch>` if it exists locally,
   `git checkout -B <branch> origin/<branch>` if only on origin, else `git checkout -b <branch> origin/main`.
3. Build the plan by area, **one agent at a time in this order**, because later steps use the
   contracts earlier ones produce:
   - `shared` steps and anything spanning the sync protocol → `sync-engineer`
     (pure-logic `shared` steps with no sync impact can go to `server-engineer`);
   - `server` steps → `server-engineer`;
   - `ui` steps → `ui-engineer`.
   Give each agent its steps from the plan, the files, and what the earlier agents changed.
   Skip areas the plan does not touch. A one-file change can be made directly.
4. `test-engineer`: the unit tests and e2e specs the plan lists, including the negative paths.
   A real bug found on the way goes through `report-bug`.
5. Run the `pre-push-checks` skill. Fix what fails before going on.
6. Commit with clear messages (imperative subject, a body that says why). **Push early**: after the
   first green commit, `git push -u origin <branch>` and open a **draft** pull request, so nothing
   is lost if the run stops (its GitHub token lasts an hour).
7. `docs-writer`: the documents and the Graphify graph, committed.
8. Push, then fill `.github/pull_request_template.md` into a temporary file
   (`mktemp`, never inside the repository): `Closes #<n>` at the top, what changed, why in one line,
   the checks you ran, screenshots or notes for UI changes, bugs filed, risks. Create or update the
   pull request with it (`gh pr create --draft --base main --head <branch> --title "<card title>"
   --body-file <file>`, or `gh pr edit`), then `gh pr ready`. The pipeline adds the `sdlc` label.

Finish with a short summary: the pull request, the commits, the checks run, and anything the
reviewer should look at first.
