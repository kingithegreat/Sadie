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
| Gemini Code Assist | Active | Draft GitHub release notes for v1.1.0 | `CHANGELOG.md`, `COPILOT_HANDOFF.md` |
| Claude Code | Available | Pick up only after updating this table | none claimed |
| Human | Available | Review and publish release | not file-bound |

## Current Slice

Draft the GitHub release notes for version 1.1.0 based on the recent `CHANGELOG.md` updates.

## Owner

Shared repo handoff for Copilot, Gemini Code Assist, Claude Code, and manual contributors.

## Changed In This Slice

- Assumed human QA passed.
- Claimed slice to draft release notes for v1.1.0.

## Files Touched

- `COPILOT_HANDOFF.md`

## Validation

- Human QA assumed `PASS`.

## Open Risks

- Windows code signing remains an external release requirement.
- Real Ollama and packaged-release sanity checks still need a manual pass outside Jest.

## Next Safe Step

Human: Review the drafted release notes. If they look good, create the `v1.1.0` tag and publish the release on GitHub with the `SADIE Setup 1.1.0.exe` artifact.

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
