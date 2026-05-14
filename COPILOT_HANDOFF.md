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
| Copilot | Active | Release validation, document-routing hardening, handoff setup, and doc sync | `widget/src/main/message-router.ts`, `widget/src/main/__tests__/n8n.integration.test.ts`, `widget/src/main/__tests__/small-model-optimizations.test.ts`, `widget/src/renderer/App.tsx`, `widget/src/renderer/components/MessageBubble.tsx`, `widget/src/renderer/__tests__/retry-flow.test.tsx`, `widget/src/renderer/__tests__/persistence-send.test.tsx`, `COPILOT_HANDOFF.md`, `COPILOT_CONTEXT.md`, `README.md`, `docs/architecture.md`, `docs/setup-guide.md`, `docs/api-reference.md`, `docs/custom-llm-api.md`, `DEVELOPER_BUILD_GUIDE.md`, `TESTING_MATRIX.md`, `CHANGELOG.md`, `n8n-workflows/README.md` |
| Gemini Code Assist | Available | Pick up only after updating this table | none claimed |
| Claude Code | Available | Pick up only after updating this table | none claimed |
| Human | Available | Manual QA, release checks, packaging | not file-bound |

## Current Slice

Release validation, document-routing hardening, multi-agent handoff setup, and documentation sync.

## Owner

Shared repo handoff for Copilot, Gemini Code Assist, Claude Code, and manual contributors.

## Changed In This Slice

- Fixed non-stream document handling in `message-router.ts` so requests with `documents[]` are expanded before routing or forwarding upstream instead of being evaluated from the bare `[Document attached: ...]` marker.
- Fixed renderer retry behavior for document-attached turns so SADIE asks the user to reattach the file instead of retrying with marker-only text.
- Added regression coverage for first-send document uploads, non-stream document forwarding, and document retry behavior.
- Corrected `isSmallModel()` so `gemma2:2b` stays in the compact-model bucket but `gemma2:9b` does not.
- Ran a broader 8-suite regression sweep across router, prompt selection, preprocessing, n8n integration, small-model logic, retry flow, and persistence-send coverage.
- Upgraded the handoff ledger so Gemini and other assistants can share one coordination system without creating parallel handoff files.
- Aligned the canonical docs with current document-routing, retry, model-default, E2E launch, and widget dev-start behavior.

## Files Touched

- `COPILOT_HANDOFF.md`
- `COPILOT_CONTEXT.md`
- `widget/src/main/message-router.ts`
- `widget/src/main/__tests__/n8n.integration.test.ts`
- `widget/src/main/__tests__/small-model-optimizations.test.ts`
- `widget/src/renderer/App.tsx`
- `widget/src/renderer/components/MessageBubble.tsx`
- `widget/src/renderer/__tests__/retry-flow.test.tsx`
- `widget/src/renderer/__tests__/persistence-send.test.tsx`
- `README.md`
- `docs/architecture.md`
- `docs/setup-guide.md`
- `docs/api-reference.md`
- `docs/custom-llm-api.md`
- `DEVELOPER_BUILD_GUIDE.md`
- `TESTING_MATRIX.md`
- `CHANGELOG.md`
- `n8n-workflows/README.md`

## Validation

- `npm --prefix "C:\Users\adenk\Desktop\sadie\widget" run test -- --runTestsByPath "src/renderer/__tests__/retry-flow.test.tsx"` `PASS`
- `npm --prefix "C:\Users\adenk\Desktop\sadie\widget" run test -- --runTestsByPath "src/renderer/__tests__/persistence-send.test.tsx"` `PASS`
- `npm --prefix "C:\Users\adenk\Desktop\sadie\widget" run test -- --runTestsByPath "src/main/__tests__/n8n.integration.test.ts"` `PASS`
- `npm --prefix "C:\Users\adenk\Desktop\sadie\widget" run test -- --runTestsByPath "src/main/__tests__/small-model-optimizations.test.ts"` `PASS`
- `npm --prefix "C:\Users\adenk\Desktop\sadie\widget" run test -- --runTestsByPath "src/main/__tests__/message-router-coverage.test.ts" "src/main/__tests__/routing-gating.test.ts" "src/main/__tests__/model-prompt-selection.test.ts" "src/main/__tests__/preprocess.test.ts" "src/main/__tests__/n8n.integration.test.ts" "src/main/__tests__/small-model-optimizations.test.ts" "src/renderer/__tests__/retry-flow.test.tsx" "src/renderer/__tests__/persistence-send.test.tsx"` `PASS` (8 suites, 174 tests)

## Open Risks

- Windows code signing remains an external release requirement.
- Real Ollama and packaged-release sanity checks still need a manual pass outside Jest.
- Temporary debug artifacts under `widget/.tmp-e2e-*` and report folders still need cleanup before merge.

## Next Safe Step

Run one manual desktop sanity pass with document upload, retry, and Gemma model selection, then delete disposable debug artifacts and package for release validation.

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
