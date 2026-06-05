# SADIE Handoff Ledger

Use this file as the single source of truth for active work when multiple coding agents or humans are touching the repo.
This ledger is shared by Copilot, Gemini Code Assist, Claude Code, and manual contributors.

## Rules

1. Read this file and check `git diff --stat` before editing.
2. Claim your agent in `Agent Board` before editing files.
3. Claim one work slice at a time. Do not split ownership by line range inside the same file.
4. If another agent already owns a file you need, hand off instead of editing in parallel.
5. After each meaningful change, update only these sections:
   - `Current Slice`
   - `Changed In This Slice`
   - `Files Touched`
   - `Validation`
   - `Next Safe Step`
6. Use `Open Risks` for unresolved facts, not chat history or side notes.
7. Do not treat chat history as source of truth. This file plus the working tree is the source of truth.

## Agent Board

| Agent | Status | Slice | Files |
| --- | --- | --- | --- |
| Copilot | Available | Pick up only after updating this table | none claimed |
| Gemini Code Assist | Available | Pick up only after updating this table | none claimed |
| Claude Code | Done | Committed Codex handoff + pushed 11 commits to origin/main | `COPILOT_HANDOFF.md`, `CLAUDE_CODE_NEXT_STEPS.md` |
| Human | Available | Pick up only after updating this table | none claimed |

## Current Slice

Codex handoff complete. Ollama URL fix committed and all pending commits pushed to origin/main.

## Owner

Shared repo handoff for Copilot, Gemini Code Assist, Claude Code, and manual contributors.

## Changed In This Slice

- Committed Codex's Ollama URL fix (dynamic resolution replacing stale module-level constant)
- Committed updated docs (AUDIT_SUMMARY, ENVIRONMENT_STATUS, PROGRESS_REPORT)
- Added CLAUDE_CODE_NEXT_STEPS.md (Codex handoff notes)
- Pushed 11 commits to origin/main (branch now up to date with remote)

## Files Touched

- `COPILOT_HANDOFF.md`
- `CLAUDE_CODE_NEXT_STEPS.md`
- `AUDIT_SUMMARY.md`
- `ENVIRONMENT_STATUS.md`
- `PROGRESS_REPORT.md`
- `widget/src/main/message-router.ts`
- `widget/src/main/ipc-handlers.ts`
- `widget/src/main/__tests__/synthesis-guard.test.ts`

## Validation

- `git push origin main` PASS — 11 commits pushed
- Code review of Ollama URL fix PASS — correct dynamic resolution
- `git status` clean — no uncommitted changes

## Open Risks

- MCP server integration: fetch server unreliable due to upstream MCP SDK issue
- Installer/auto-update: packaged-release validation pending before first GitHub Release

## Next Safe Step

Verify chat UI model switching works end-to-end (see CLAUDE_CODE_NEXT_STEPS.md items 1-2).

## Handoff Procedure

1. Read `COPILOT_CONTEXT.md`, this file, and `git diff --stat`.
2. Update `Agent Board` before changing files.
3. Keep one active slice only. If the slice changes, rewrite `Current Slice` instead of appending history.
4. Use `Files Touched` to declare ownership at file granularity.
5. When handing off, leave `Next Safe Step` small enough that the next agent can validate it quickly.
6. If you stop mid-debug, leave the failing command in `Validation` with `FAIL` and put the blocker in `Open Risks`.

## Handoff Entry Template

Copy this block for the next update:

```md
## Agent Board
| Agent | Status | Slice | Files |
| --- | --- | --- | --- |
| <agent> | Active|Blocked|Done | <slice> | `<path>`, `<path>` |

## Current Slice
<one active slice>

## Changed In This Slice
- <change>
- <change>

## Files Touched
- `<path>`
- `<path>`

## Validation
- `<command>` `PASS|FAIL|NOT RUN`

## Open Risks
- <risk>

## Next Safe Step
<smallest validated next step>
```
