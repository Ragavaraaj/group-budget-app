---
name: sdlc-plan
description: Plan a board card for the AI SDLC. Turns an issue (often just a title) into an approvable plan with the planner agent and returns it as structured output; the pipeline puts it in the issue body. Use when asked to plan issue #n, or by the SDLC plan workflow.
---

# Plan a card

Input: an issue number. Output: the plan and its context. **The plan lives only in the issue**:
never write it, or notes about it, to a file in the repository.

Agents: `planner`
Skills: `codebase-graph`

## Steps

1. Read the card: `gh issue view <n> --comments`. The body holds the owner's text and, between
   `<!-- sdlc:plan:start -->` and `<!-- sdlc:plan:end -->`, any earlier plan. Comments after the
   last plan (and a `/replan`) are changes the owner wants.
2. Spawn the `planner` agent with the issue's title, body and comments, and ask for the plan and
   context it describes. Give it the earlier plan if there is one, so it revises rather than restarts.
3. Read its plan as the owner will. It must name files and tests, put steps in the order
   `shared` → `server`/`sync` → `ui`, include negative and offline tests where the change has them,
   say which docs change, and fit the size it claims. Send it back to the planner once if not.
4. Return the structured output:
   - `plan_markdown`: the plan (Goal, Approach, Steps, Tests, Docs, Risks and rollback, Out of scope);
   - `type`: `feat`, `fix`, `test` or `chore` (a `bug` issue is always `fix`);
   - `size` (S, M, L) and `risk` (low, medium, high);
   - `questions`: only what changes what gets built; empty otherwise;
   - `context`: `areas`, `files`, `tests`, `graph_notes`, which the implementer starts from.

Outside the pipeline (a person asking in a session), show the plan and offer to put it into the
issue with `gh issue edit`, between the same markers, keeping the owner's text above them.
