# Work Claims

Repo-native companion to the Notion [√∞≈∏‚Äù‚Äî Work Claims Ledger](https://app.notion.com/p/63dec393c18546ee9b924a472e9c59a3) and [√∞≈∏¬§¬ù Coordination Protocol](https://app.notion.com/p/390829ebf7be81e09866e1cd3a6bed6e). This file exists because Notion is easy to skip; this file is not √¢‚Ç¨‚Äù anyone building here sees it just by looking at the repo.

**Before starting a new feature build:**
1. Check the table below for an existing claim on the same feature area. If one exists and looks recent/active, don't start a parallel build.
2. `grep -rl <concept> src widget/src` for an existing module before writing a new one √¢‚Ç¨‚Äù HomeBot has two source trees (repo-root `src/` for pure/testable modules, `widget/src/` for the actual Electron app), so check both.
3. Add a row below before writing code. Update it to "Ready for Integration" when pushed and self-tested √¢‚Ç¨‚Äù and **strike it into the retired table the moment it merges**. A row's last edit is normally the one that makes it a lie: on 2026-08-26 every one of the nine "active" rows described merged work, because writing a row is part of starting and nobody owns finishing. If you merge a PR, close its row in the same breath; if you find a row whose PR has merged, retire it there and then rather than leaving it for whoever reads next.
4. **Verify a claim against the repo before repeating it** √¢‚Ç¨‚Äù `gh pr view <n> --json state,mergedAt` is two seconds. The board is a lagging record, not a source of truth: on 2026-08-24 two rows said "Ready for integration" for PRs that had merged 48 hours earlier, and both got repeated as fact. Note that squash-merge means the original branch SHA is never an ancestor of main, so `git branch --contains` lies √¢‚Ç¨‚Äù check PR **state**, not commits. **`gh pr list --head <branch>` lies too**, in the opposite direction: it returned "no PR" for `claude/dead-capability-sweep-rebased`, whose content had merged as #118 and is on main today √¢‚Ç¨‚Äù the PR had been opened from the pre-rebase branch name, so the lookup found nothing and the branch looked like stranded work waiting to be rescued. And do not trust a commit SUBJECT either: #228 reads `docs(claims):` but carries the entire Track H file-trigger feature across nine files. When the question is "did this ship?", grep main for the CONTENT.
5. **Each session works in its own git worktree. `C:\Users\adenk\Desktop\sadie` is nobody's checkout.** Two sessions sharing one HEAD interleaved reflog entries, reset a branch underneath a running merge, and clobbered an uncommitted claim row √¢‚Ç¨‚Äù three losses on 2026-08-24, one costing a full rebuild, all tracing to this. Aden provisions per-session worktrees (e.g. `Desktop\sadie-ox`, with `node_modules` junctioned so the widget suite runs immediately); ask for yours instead of touching the shared tree. Never run mutating git commands against another session's worktree √¢‚Ç¨‚Äù `git worktree list` first, every time.

CI runs `scripts/check-duplicate-exports.mjs` on every PR and will fail the build if a newly added file exports the same top-level identifier as an existing file √¢‚Ç¨‚Äù usually a sign two features were built in parallel without checking here first, or a scaffold was built without checking the real integration point (see the Step 1 entitlements gate channel-name mismatch, which was a variant of this same failure mode). See that script's header comment for how it works and how to suppress a genuine false positive.

## Active claims

| Feature | Branch | Status | Notes |
|---|---|---|---|
| Model picker sections ó purpose-grouped catalog, GPU-picked float-up, type-to-filter | claude/model-picker-sections | In progress | Stacked on claude/ui-excitement-pass (#246). Research basis: VS Code groups recommended-first, Raycast/Cursor group by task, all ship type-to-filter. Adds explicit category tags to the 17-model catalog (everyday / coding / reasoning / lightweight / uncensored), an On this PC section with a Best for your PC float-to-top subsection driven by detected VRAM, purpose sub-groups under the download section, a filter box with Escape-to-close, and no-match state. Arrows cycle the filtered subset. Tests updated + new coverage (41/41). |
| Video engine decision recorded ó JSON API first, Remotion deferred | claude/model-picker-sections | Decided | Decision and rationale in `docs/VIDEO_ENGINE_DECISION.md` (carried on this stacked branch): n8n-friendly JSON API (Creatomate/JSON2Video bake-off at build time) with Whisper word-timestamp captions; Remotion explicitly deferred with a written revisit trigger (in-app pixel-level puppet animation, Ancient Pathways-class). Deciding factors: n8n is the automation spine, non-technical audience hides machinery, Remotion's 3+ employee license cliff vs a product that is itself licensed. `video_render` tool is the first scaffold when someone picks this up ó CLAIMS row then, per protocol. |
| Chat avatar excitement pass ó visible glowing orb avatars + atmosphere polish | claude/ui-excitement-pass | In progress | Stacked on claude/visual-pass (#243). Discovery: #243's orb CSS was dead code ó MessageBubble.tsx still rendered the old PNG badges (`HomeBotChatAvatar.png`/`UserChatAvatar.png`) inside `.message-avatar` at `width/height: 100%; object-fit: cover`, completely covering the orb gradient. This pass replaces the PNG `<img>` with pure CSS orbs + Icon-set glyphs (sparkle for HomeBot, user for you), adds a rotating conic shimmer, specular highlight, streaming-state-reactive pulse (wrapper already carries `data-state`), aurora grain overlay, and selection/focus polish. Reduced-motion respected throughout. Dead avatar and logo PNGs removed (~3MB). New e2e spec asserts the orbs in the real renderer (circles, decorative layers, grain below overlays). |
| _(none)_ | ó | ó | Visual pass merged as #233 (2026-08-25, content verified on main); NBA voiceover pipeline merged as #236 (2026-08-26). The reachability row stays until its PR lands. Retired 2026-08-26. Add your row here BEFORE writing code. |
| ~~Narrate my clip ó BYO video narration inside HomeBot (chat-reachable)~~ | claude/narrate-my-clip | ~~Ready for integration~~ ? **MERGED as #242 (2026-08-26)** | Aden redirected the NBA pipeline: he wants it in the app, not in PowerShell/Drive. New native tool `media_narrate_clip` ó give it a video path in chat, it runs the Gemini vision scripter (`scripts/analyze_clip.py`, key read through `apiKeyForProvider(settings,'google-ai-studio')`, never a second lookup), synthesizes narration through the EXISTING engine seam (`renderNarrationToFile`), muxes onto the original clip with ffmpeg (-c:v copy) and hands back the final path beside the source. Home-boundary enforced on input and output; fails closed with plain setup guidance when no Gemini key; analyzer key travels via env, never argv. Verified in sadie-nba3 (own npm ci, not the pnpm-touched shared tree): tsc clean; eslint 0 errors; new suite 13 tests incl. full mocked happy-path asserting key-in-env and copy-only mux args; permission-copy registry entry added (gate caught it ó that is what gates are for); tool-permissions-parity passes; full serial widget suite 242 suites / 3461 tests green; root 213 green. Does NOT touch media-studio state machine, voice.ts internals, or message-router routing logic. Colab/XTTS clone remains rung 2 behind the existing engine picker. Worktree: Desktop/sadie-nba3. **Retired 2026-09-04: PR #242 verified MERGED (2026-08-26 12:48 UTC) ó this row sat "Ready for integration" for nine days after merging, the exact rot rule 4 describes.** |

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
