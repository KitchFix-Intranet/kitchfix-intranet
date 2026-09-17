# Backlog · reword the migration gate for MCP as a first-class apply path

Opened 2026-09-17. Follow-up to R-114 PR 2 (#1165).

## The wording that ships today

`.github/workflows/migration-gate.yml` Job B matches issue comments containing the literal string:

```
applied in Studio: YES
```

The comment ships as an OWNER-only confirmation from Kevin, which flips the `Migration gate` check_run to SUCCESS on the PR head SHA and unblocks the merge. The trigger phrase is baked into the workflow file (`.github/workflows/migration-gate.yml`) — greppable from the CLAUDE.md description of the gate.

## Why the wording is wrong now

R-114 PR 2 (#1165) applied both migration files via **Supabase MCP** (`mcp__claude_ai_Supabase__execute_sql`), not the Studio UI. Kevin approved each write per feedback-round rules. The confirmation on the gate then had to read:

> applied in Studio: YES — applied via Supabase MCP with my approval on each write, not the Studio UI

...which is a lie-with-a-caveat. The literal-string match forces the header to be technically-wrong-and-clarified rather than plainly right.

MCP is not a one-off. The 2026-09-17 discussion confirmed it as a real path for data-load migrations where each write is small, idempotent, and reviewable. Future PRs will use it. The workflow should match that reality.

## Proposed change

Reword the trigger phrase to describe the *outcome* (the migration is applied), not the *tool* used to apply it. Candidates in order of preference:

1. `applied to the database: YES` — plain, tool-agnostic, matches the reality that both Studio and MCP write to the same database.
2. `migration applied: YES` — even shorter; equally tool-agnostic.

Either works. My recommendation: option 1 (clearer that it's a data-plane confirmation, not a "I filed the PR right" confirmation).

## What changes

- `.github/workflows/migration-gate.yml` Job B: swap the string constant in the `contains` check.
- `docs/CLAUDE.md` migration-gate description: reword the surrounding prose.
- Any place the exact literal `applied in Studio: YES` is referenced (grep the repo before shipping).

The workflow uses a `contains` match, so a graceful transition can accept BOTH strings for a window (one release cycle) before dropping the old form.

## Not this incident

The `applied in Studio` phrase has to survive one more use — the R-114 PR 2 (#1165) merge — because that PR was opened under the current gate wording. This backlog entry opens the follow-up PR after #1165 lands.

## PR scope suggestion

Single workflow edit + CLAUDE.md prose edit + this backlog entry marked resolved. No behaviour change beyond the phrase match.
