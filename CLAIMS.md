# Work Claims

Repo-native companion to the Notion [🔗 Work Claims Ledger](https://app.notion.com/p/63dec393c18546ee9b924a472e9c59a3) and [🤝 Coordination Protocol](https://app.notion.com/p/390829ebf7be81e09866e1cd3a6bed6e). This file exists because Notion is easy to skip; this file is not — anyone building here sees it just by looking at the repo.

**Before starting a new feature build:**
1. Check the table below for an existing claim on the same feature area. If one exists and looks recent/active, don't start a parallel build.
2. `grep -rl <concept> src widget/src` for an existing module before writing a new one — HomeBot has two source trees (repo-root `src/` for pure/testable modules, `widget/src/` for the actual Electron app), so check both.
3. Add a row below before writing code. Update it to "Ready for Integration" when pushed and self-tested.

CI runs `scripts/check-duplicate-exports.mjs` on every PR and will fail the build if a newly added file exports the same top-level identifier as an existing file — usually a sign two features were built in parallel without checking here first, or a scaffold was built without checking the real integration point (see the Step 1 entitlements gate channel-name mismatch, which was a variant of this same failure mode). See that script's header comment for how it works and how to suppress a genuine false positive.

## Active claims

| Feature | Branch | Status | Notes |
|---|---|---|---|
| Model freshness + cloud temperature knob | claude/model-freshness-and-knobs | In progress | Touches custom-llm-client.ts, config-manager.ts, model-lifecycle.ts (new), shared/types.ts, useSettingsState.tsx, CloudProviderSection.tsx. Does NOT touch message-router.ts, model-advisor.ts, media tools, or PrivacySwitch. |
| n8n Auth Guard injection + secret embedding | claude/n8n-auth-guard | Ready for Integration | PR #191, auto-merge on. injectAuthGuards() in widget/src/main/n8n-auth-guard.ts runs inside importWorkflow; guards embed the per-install secret directly (Code nodes see EMPTY process.env — env-based guards were inert). 30 unit tests green locally. |

## Integration notes — 2026-08-2
Five PRs merged today (#152, #162, #164, #165, #168). Four of them change the rules of the road
for every session working here:

1. **`e2e-all` is now a REQUIRED check** (branch protection has six contexts). Two consequences:
   - **A branch created before #165 cannot merge** — it lacks the `e2e-all` job, the context never
     reports, and the PR sits BLOCKED forever. Rebase onto or merge current main first.
   - **Every bot-opened PR parks its `pull_request` runs at `action_required`** — silently; the
     required check simply never appears. This is EVERY auto-opened PR, not just workflow-touching
     ones. After the auto-PR appears, approve the held runs:
     `gh api -X POST repos/kingithegreat/Sadie/actions/runs/<id>/approve`
2. **Floating overlays: portal, don't blocklist.** `chatgpt-theme.css` has a
   `.app-container > *:not(...)` rule at (0,12,0) that silently captures any non-excluded child's
   `position: fixed` (13 of 18 overlay classes were captured and shipped broken). Use
   `widget/src/renderer/components/anchoredOverlay.tsx` / `createPortal(document.body)`. Extend
   the `:not()` list only for something that must genuinely stay a child of `.app-container`.
3. **Dial `127.0.0.1:11434`, never `localhost:11434`.** Docker Desktop's model runner binds
   `0.0.0.0:11434` with an empty model store and wins the IPv6 race — installed models read as
   "not found". Found live on Aden's machine.
4. **Changing the preload surface? Run `npm run docs:write`** (repo root) — `docs/api-reference.md`
   is generated and the root CI job has a drift gate that goes red otherwise.

Also useful: destructive UI actions go through `ConfirmDestructive.tsx` (button text names the
consequence, never "OK"); upstream stable-diffusion.cpp renamed its binary to `sd-cli.exe` and its
mode to `img_gen` (old names handled with fallbacks — don't reintroduce `sd.exe`/`txt2img`
assumptions); live-engine verification tests are gated behind `HOMEBOT_LIVE=1` (see
`media-pipeline.live.test.ts` for the pattern).

Fuller narrative: the 2026-08-13→15 daily log in Aden's Ai-Brain vault, and the Notion Lessons &
Playbook.

## Known non-duplicates

Identifiers intentionally exported by more than one file (add the exact name, one per bullet, to suppress `check-duplicate-exports.mjs` false positives). Pre-registered from the existing codebase so a future file rename doesn't trip the check:

- `UpgradePrompt` — mirrored between `src/entitlements.ts` (pure) and `widget/src/shared/types.ts` (renderer-facing copy)
- `GateBlockedResponse` — same pure/renderer mirror pattern, `src/handlers/featureGate.ts` + `widget/src/shared/types.ts`
- `isGateBlocked` — same pattern, `src/handlers/featureGate.ts` + `widget/src/shared/upgrade.ts`
- `Settings` — legitimately distinct `Settings` shapes in `widget/src/main/config-manager.ts`, `widget/src/renderer/types.ts`, `widget/src/shared/types.ts`
- `StoredConversation`, `ConversationStore`, `ConversationSearchResult` — mirrored between `widget/src/main/memory-manager.ts` and `widget/src/shared/types.ts`
- `ScheduledJob` — mirrored between `widget/src/main/scheduler.ts` and `widget/src/shared/types.ts`
- `searchFilesDef`, `searchFilesHandler` — both `widget/src/main/tools/filesystem.ts` and `widget/src/main/tools/search.ts` (pre-existing, not reviewed as part of this change — verify these are intentional before touching either file)

## Integration notes — 2026-08-22 session handoff

Two PRs were in flight at handoff; both have auto-merge enabled and need no manual merge:

1. **PR #191 (`claude/n8n-auth-guard`)** — Auth Guard injection into every app-deployed
   workflow, with the per-install webhook secret EMBEDDED in the generated guard script.
   Key fact for anyone touching n8n Code nodes: **n8n 1.122.5 gives Code nodes an empty
   `process.env` regardless of `N8N_BLOCK_ENV_ACCESS_IN_NODE`** — any guard reading the
   secret from env silently skips validation. The branch was rebased onto main at handoff
   (`c32479e`); CI re-runs after a rebase, so if it sits BLOCKED with checks pending,
   that is why — wait, don't re-rebase.
2. **PR #187 (`claude/crm-stale-flake`)** — one-line test fix (sleep past the days=0 cutoff
   in the dailyBrief test), rebased onto main as `0383f10`, auto-merge on.

**Still owed after both merge (verify where it RUNS, not in tests):**
- Redeploy workflows through the app's own deploy path to the running n8n container, then
  POST to a deployed webhook WITHOUT `X-HOMEBOT-Auth` and confirm the guard rejects it
  before any node executes. Green CI does not prove the deployed instance has embedded-
  secret guards — old workflows keep their legacy guards until re-imported.
- The `compose-edit-during-test` stash in the main worktree is REDUNDANT (superseded by
  commit e49cc3e on #191) — drop it after #191 merges.
- Worktrees: main tree is `C:\Users\adenk\Desktop\sadie`, the auth-guard branch lives in
  worktree `C:\Users\adenk\Desktop\sadie-n8nguard`.
