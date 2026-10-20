---
name: codebase-graph
description: Find code through the committed Graphify knowledge graph before opening files, and refresh the graph after changing code. Use at the start of any task that needs to find where something lives, and after committing code changes.
---

# Query the graph first, then open only what it points to

This repo commits a Graphify graph (`graphify-out/graph.json`, `GRAPH_REPORT.md`) so any session can
find the relevant files without reading the tree. Graphify is the PyPI package `graphifyy`, command
`graphify` (installed in the pipeline's runs; locally `uv tool install graphifyy`).

## Finding code

```sh
graphify query "how does a push from the outbox reach D1?"   # BFS over the graph, about 2000 tokens
graphify path "SyncEngine" "pushMutations"                    # the shortest path between two things
graphify explain "LiveHub"                                    # a node and its neighbours
graphify affected "resolveSplit"                              # what breaks if this changes
graphify god-nodes --top 10                                   # the architectural hubs
```

Open the files the result names; if a result disagrees with the file, trust the file (the graph may
be stale). The docs in `docs/` are not in the graph: read the one for the area directly (CLAUDE.md,
"Where the design lives").

## Refreshing it

`graphify-out/` must match the code it describes.

- After committing code changes: `graphify update .` (incremental, local, no LLM, seconds).
- After a large change (new folders, many files, renames) or a merge that touched the graph:
  `graphify extract . --code-only && graphify cluster-only .`.
- Commit `graphify-out/` with the change. Never edit it by hand; resolve a conflict in it by
  rebuilding, not by merging the JSON.
