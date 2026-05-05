# SADIE Handoff Ledger

Use this file as the single source of truth for active work when multiple coding agents are touching the repo.

## Rules

1. Read this file and check `git diff --stat` before editing.
2. Claim one work slice at a time. Do not split ownership by line range inside the same file.
3. After each meaningful change, update only these sections:
   - `Current Slice`
   - `Changed In This Slice`
   - `Files Touched`
   - `Validation`
   - `Next Safe Step`
4. If another agent has already claimed a file you need, hand off instead of parallel editing it.
5. Do not treat chat history as source of truth. This file plus the working tree is the source of truth.

## Current Slice

Release trust hardening, onboarding validation, and product roadmap reset.

## Owner

Shared repo handoff for Copilot and Claude Code.

## Changed In This Slice

- Enabled sandbox for the main app window.
- Added a packaged renderer Content Security Policy.
- Restricted web-service session permissions to an allowlist.
- Restricted web-service popup windows to approved HTTPS hosts.
- Disabled auto-updater by default unless `SADIE_ENABLE_AUTO_UPDATE=1` is set for a packaged release.
- Confirmed the redesigned first-run unit tests pass against the current local/cloud onboarding flow.
- Replaced the old completed-phase roadmap with a forward-looking local-first product roadmap.

## Files Touched

- `widget/src/main/window-manager.ts`
- `widget/src/main/web-services.ts`
- `widget/src/main/index.ts`
- `widget/src/main/auto-updater.ts`
- `widget/src/renderer/index.html`
- `widget/src/renderer/components/FirstRunModal.tsx`
- `widget/src/renderer/__tests__/first-run-modal.test.tsx`
- `widget/src/renderer/e2e/first-run.e2e.spec.ts`
- `widget/src/renderer/styles/chatgpt-theme.css`
- `PROJECT_PLAN.md`
- `README.md`

## Validation

- `cd widget && npm run build` `PASS`
- `cd widget && npm run test:file -- first-run-modal.test.tsx` `PASS` `19/19`
- `cd widget && npx playwright test src/renderer/e2e/first-run.e2e.spec.ts` `FAIL` `investigate before more onboarding edits`
- `PROJECT_PLAN.md` and `README.md` Markdown validation `PASS`

## Open Risks

- Windows code signing is still an external release requirement. The repo now avoids unsafe default updater behavior, but signing itself is not solved in code.
- The first-run Playwright spec is currently failing and needs to be debugged against the live onboarding flow before more onboarding changes land.
- `FirstRunModal.tsx` and its tests are active collaboration surfaces. Avoid concurrent edits without updating this file first.

## Next Safe Step

Read the Playwright failure output for `src/renderer/e2e/first-run.e2e.spec.ts`, fix the mismatch in the smallest possible slice, and rerun only that spec before touching broader onboarding UX. After that, align status-heavy docs that still describe the project as fully complete with the new roadmap.

## Handoff Entry Template

Copy this block for the next update:

```md
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
