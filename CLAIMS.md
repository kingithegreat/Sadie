# Work Claims

Repo-native companion to the Notion [üîó Work Claims Ledger](https://app.notion.com/p/63dec393c18546ee9b924a472e9c59a3) and [ü§ù Coordination Protocol](https://app.notion.com/p/390829ebf7be81e09866e1cd3a6bed6e). This file exists because Notion is easy to skip; this file is not ‚Äî anyone building here sees it just by looking at the repo.

**Before starting a new feature build:**
1. Check the table below for an existing claim on the same feature area. If one exists and looks recent/active, don't start a parallel build.
2. `grep -rl <concept> src widget/src` for an existing module before writing a new one ‚Äî HomeBot has two source trees (repo-root `src/` for pure/testable modules, `widget/src/` for the actual Electron app), so check both.
3. Add a row below before writing code. Update it to "Ready for Integration" when pushed and self-tested ‚Äî and **strike it into the retired table the moment it merges**. A row's last edit is normally the one that makes it a lie: on 2026-08-26 every one of the nine "active" rows described merged work, because writing a row is part of starting and nobody owns finishing. If you merge a PR, close its row in the same breath; if you find a row whose PR has merged, retire it there and then rather than leaving it for whoever reads next.
4. **Verify a claim against the repo before repeating it** ‚Äî `gh pr view <n> --json state,mergedAt` is two seconds. The board is a lagging record, not a source of truth: on 2026-08-24 two rows said "Ready for integration" for PRs that had merged 48 hours earlier, and both got repeated as fact. Note that squash-merge means the original branch SHA is never an ancestor of main, so `git branch --contains` lies ‚Äî check PR **state**, not commits. **`gh pr list --head <branch>` lies too**, in the opposite direction: it returned "no PR" for `claude/dead-capability-sweep-rebased`, whose content had merged as #118 and is on main today ‚Äî the PR had been opened from the pre-rebase branch name, so the lookup found nothing and the branch looked like stranded work waiting to be rescued. And do not trust a commit SUBJECT either: #228 reads `docs(claims):` but carries the entire Track H file-trigger feature across nine files. When the question is "did this ship?", grep main for the CONTENT.
5. **Each session works in its own git worktree. `C:\Users\adenk\Desktop\sadie` is nobody's checkout.** Two sessions sharing one HEAD interleaved reflog entries, reset a branch underneath a running merge, and clobbered an uncommitted claim row ‚Äî three losses on 2026-08-24, one costing a full rebuild, all tracing to this. Aden provisions per-session worktrees (e.g. `Desktop\sadie-ox`, with `node_modules` junctioned so the widget suite runs immediately); ask for yours instead of touching the shared tree. Never run mutating git commands against another session's worktree ‚Äî `git worktree list` first, every time.

CI runs `scripts/check-duplicate-exports.mjs` on every PR and will fail the build if a newly added file exports the same top-level identifier as an existing file ‚Äî usually a sign two features were built in parallel without checking here first, or a scaffold was built without checking the real integration point (see the Step 1 entitlements gate channel-name mismatch, which was a variant of this same failure mode). See that script's header comment for how it works and how to suppress a genuine false positive.

## Active claims

| Feature | Branch | Status | Notes |
|---|---|---|---|
| PowerShell tool safety hardening + Pester coverage for SafetyValidation, CalendarOps, EmailOps | claude/powershell-pester-coverage | Ready for Integration | Extends #173/#245 coverage to the shared safety gate. SafetyValidation.ps1 had: hardcoded `C:\Users\adenk` paths (portability), the same bare-`StartsWith` allowlist bug fixed for TEMP in 8908863 (`...\Desktop` prefix-matched `...\DesktopEvil` ó allowlist bypass), and `"C:\$Recycle.Bin"` double-quoted so PowerShell interpolated `$Recycle` to empty ó the Recycle Bin was silently NOT blocked. Fixed with the same `Test-UnderDirectory` separator-boundary helper as ArchiveOps, `$USERPROFILE`-based lists, and a single-quoted Recycle Bin entry; local-URL warning regex anchored so `http://evil.com/?x=localhost` no longer reads as local. Merged origin/main's parallel hardening of the same gate (string-param normalisation, config-file loading, fail-closed missing-path guard) and kept `Test-UnderDirectory` as the boundary check ó main's normalization layer + my separator-boundary comparisons. Three new Pester suites; no Outlook COM in the deterministic paths. |

(No open claims as of this writing ó Pro monetization Steps 1 & 2 are merged; see Notion ledger for history.)

## Integration notes ó 2026-08-15 session (read before your next PR)

Five PRs merged today (#152, #162, #164, #165, #168). Four of them change the rules of the road
for every session working here:

1. **`e2e-all` is now a REQUIRED check** (branch protection has six contexts). Two consequences:
   - **A branch created before #165 cannot merge** ó it lacks the `e2e-all` job, the context never
     reports, and the PR sits BLOCKED forever. Rebase onto or merge current main first.
   - **Every bot-opened PR parks its `pull_request` runs at `action_required`** ó silently; the
     required check simply never appears. This is EVERY auto-opened PR, not just workflow-touching
     ones. After the auto-PR appears, approve the held runs:
     `gh api -X POST repos/kingithegreat/Sadie/actions/runs/<id>/approve`
2. **Floating overlays: portal, don't blocklist.** `chatgpt-theme.css` has a
   `.app-container > *:not(...)` rule at (0,12,0) that silently captures any non-excluded child's
   `position: fixed` (13 of 18 overlay classes were captured and shipped broken). Use
   `widget/src/renderer/components/anchoredOverlay.tsx` / `createPortal(document.body)`. Extend
   the `:not()` list only for something that must genuinely stay a child of `.app-container`.
3. **Dial `127.0.0.1:11434`, never `localhost:11434`.** Docker Desktop's model runner binds
   `0.0.0.0:11434` with an empty model store and wins the IPv6 race ó installed models read as
   "not found". Found live on Aden's machine.
4. **Changing the preload surface? Run `npm run docs:write`** (repo root) ó `docs/api-reference.md`
   is generated and the root CI job has a drift gate that goes red otherwise.

Also useful: destructive UI actions go through `ConfirmDestructive.tsx` (button text names the
consequence, never "OK"); upstream stable-diffusion.cpp renamed its binary to `sd-cli.exe` and its
mode to `img_gen` (old names handled with fallbacks ó don't reintroduce `sd.exe`/`txt2img`
assumptions); live-engine verification tests are gated behind `HOMEBOT_LIVE=1` (see
`media-pipeline.live.test.ts` for the pattern).

Fuller narrative: the 2026-08-13?15 daily log in Aden's Ai-Brain vault, and the Notion Lessons &
Playbook.

## Known non-duplicates

Identifiers intentionally exported by more than one file (add the exact name, one per bullet, to suppress `check-duplicate-exports.mjs` false positives). Pre-registered from the existing codebase so a future file rename doesn't trip the check:

- `UpgradePrompt` ó mirrored between `src/entitlements.ts` (pure) and `widget/src/shared/types.ts` (renderer-facing copy)
- `GateBlockedResponse` ó same pure/renderer mirror pattern, `src/handlers/featureGate.ts` + `widget/src/shared/types.ts`
- `isGateBlocked` ó same pattern, `src/handlers/featureGate.ts` + `widget/src/shared/upgrade.ts`
- `Settings` ó legitimately distinct `Settings` shapes in `widget/src/main/config-manager.ts`, `widget/src/renderer/types.ts`, `widget/src/shared/types.ts`
- `StoredConversation`, `ConversationStore`, `ConversationSearchResult` ó mirrored between `widget/src/main/memory-manager.ts` and `widget/src/shared/types.ts`
- `ScheduledJob` ó mirrored between `widget/src/main/scheduler.ts` and `widget/src/shared/types.ts`
- `searchFilesDef`, `searchFilesHandler` ó both `widget/src/main/tools/filesystem.ts` and `widget/src/main/tools/search.ts` (pre-existing, not reviewed as part of this change ó verify these are intentional before touching either file)
