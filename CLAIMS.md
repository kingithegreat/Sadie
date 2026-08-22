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
| Delete a downloaded model | claude/delete-model-ui (#183) | Ready for integration | ModelsSettingsTab.tsx, useSettingsState.tsx, ipc-handlers (delete-ollama-model validation). Does NOT touch media tools or message-router.ts. |
| Quiz reaches the requested count | claude/quiz-full-count (#186) | Ready for integration | `fillQuiz` in **root** src/quiz/generate.ts, both quiz IPC handlers, QuizPanel.tsx. Does NOT touch media, settings or routing. |
| Privacy switch names the waiting model | claude/privacy-switch-names-provider (#178) | Ready for integration | PrivacySwitch.tsx only. |

*(Model freshness + knobs merged as #182 — claim retired.)*

## Integration notes — 2026-08-22 session (read before your next PR)

Two sessions shipped in parallel all night. These are the rules that CHANGED — the media ones
matter most, because that is where both sessions were working.

1. **Settings has a Simple/Advanced toggle, and Simple is the DEFAULT.**
   `SettingsPanel.tsx` is now a 156-line shell; state lives in `settings/useSettingsState.tsx`
   and controls in `settings/*Tab.tsx`, read through `SettingsContext`.
   **A control you add to `AdvancedSettingsTab` is invisible unless the user switches views.**
   This already cost a live bug: the Claude-subscription provider option vanished from the
   default panel and was reported by Aden within hours. If a setting is something a normal user
   would look for on day one, put it in a tab Simple renders (`ModelsSettingsTab`,
   `VoiceHotkeysTab`, `GeneralSettingsTab`) or beside `PrivacySwitch`.
   Existing tests that reach Diagnostics / System check / API Keys must click **Advanced** first.

2. **`render_qa` now actually inspects the file.** It measures the render with ffmpeg (NOT
   ffprobe — a second binary that is not on Aden's PATH, and a check that cannot run looks
   exactly like one that passed). A render with no audio track, digital silence, the wrong frame
   size, or picture running past the speech now moves the job to **`needs_revision`**, not
   `awaiting_approval`. If you add a render path, expect QA to judge it.

3. **The Media panel offers the action for what a job is MISSING, not for its state.**
   `script_draft` with no script offers "Write script"; `media_production` with no narration
   offers "Record narration". This exists because the generic "Move to …" button advances the
   STATE and does none of the work, which left a job wedged with both exits closed
   (reported live on a job titled "is there a god"). Keep the rule if you touch `stageAction`.

4. **Provider API keys: read through `apiKeyForProvider` in `shared/cloud-llm.ts`.**
   `providerApiKeys` is a map covering all thirteen providers; the four legacy top-level fields
   are still written and read as a fallback. Do not re-derive "is this provider configured?" —
   a second copy of that decision is what previously shipped a header naming one model while
   another answered.

5. **Web fetch is three tiers now** (`tools/web.ts`): plain GET → hidden `BrowserWindow`
   (`main/browser-fetch.ts`) → Jina Reader (`main/reader-fetch.ts`). The reader tier is **off by
   default** because it is the only one that sends the URL off the machine. Measured: the browser
   reads wikipedia/bbc that plain GET cannot, but does NOT beat a JS challenge or a paywall.

6. **Quiz batching lives in `fillQuiz`** (root `src/quiz/generate.ts`) — both IPC handlers use it.
   Do not reimplement the retry loop; the old duplicated one returned short quizzes silently.

7. **A reachability audit ran on 2026-08-22.** Before adding a capability, check it can be
   REACHED — six defects in one session were all "the code works and nothing calls it". Two are
   fixed (#183 delete-model, #185 briefing opt-out); `summarizeWebContent` and `defaultTeam` are
   still dead and safe to delete.

Standing traps that have not changed: bot-opened PRs still park every `pull_request` run at
`action_required` (approve them, or the required checks never report), and with two sessions
merging, a green PR goes `BEHIND` within minutes — `gh pr update-branch <n>` and re-approve.

## Integration notes — 2026-08-15 session (read before your next PR)

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


## Product direction — 2026-08-22, and a shared seam that needs one owner

Aden restated the goal today. It is no longer one product with side features — it is **five
pillars**, and he added two requirements on top:

> "a full assistant, media studio and coding platform, with best option for free or very cheap"
> "should have the option to integrate with any users common external services"
> "be able to make complex automations and run them how a user would need and allow them to edit
> what they need"
> "everything should be able to happen from the chat even if that just means redirected with context"

### Track ownership — claim a row before you build in it

| Track | Owner | Where it actually is |
|---|---|---|
| A · Ship it (signing cert) | Aden | The only launch blocker. **Nobody can work this but him.** |
| B · Media Studio | ox-alpha | Healthiest pillar — 8 of the last 15 PRs. Needs the least right now. |
| C · Platform trust / reachability | this session | Ongoing audit |
| D · Plain language + free-setup guidance | **unowned** | |
| E · Keep the lights on (CI) | shared | |
| F · Coding platform front door | ox-alpha | Workspace, terminal, 14 git tools, CLI bridges all exist; **no Code mode** |
| G · Connections catalogue | this session | MCP works but is buried under Settings → Advanced → Permissions |
| H · Automations people can build | this session | Create/edit/run/schedule work; triggers are manual+schedule only |
| I · Chat as the front door | this session | **No navigation capability exists at all** |

### The seam: chat → panel navigation

Verified, so nobody needs to re-audit it:

- The model has **no navigation capability**. `open_in_browser` and `open_url` leave HomeBot for a
  web browser; nothing moves you between modes.
- `setMode` has exactly one caller family — keyboard shortcuts at `App.tsx:168-185`.
- Those cover chat, automation, image, documents, quiz, dashboard. **Studio and Browser have no
  shortcut. Code has no mode.**
- There is no context handoff anywhere — no prefill, no seeded state, no deep link.

**Three separate features need the same primitive** (a capability the model can call to move to a
mode *with a payload*): Code mode, the Connections catalogue, and the automation editor. If we each
hand-roll it, we get three incompatible mechanisms and Aden's requirement stays half-met.

**If you are about to build chat→panel navigation, claim it in the table above first.** This
session has offered it to ox-alpha and is holding G and H pending an answer. If it is still
unclaimed when you read this, take it and say so — an unowned shared seam blocks three features.

### Two things that will cost you time

- **A control added to `AdvancedSettingsTab` is invisible by default.** Settings opens in Simple.
  This already caused one live bug — Aden could not find the Claude subscription option after the
  Simple/Advanced refactor. Decide deliberately which view a new setting belongs in.
- **Bot-opened `claude/**` PRs park every `pull_request` run at `action_required`,** and nothing
  reports it — required checks simply never appear and it reads as slow CI. Ten runs were held
  today, five of them for three days. Run this after every push:

```bash
gh api "repos/kingithegreat/Sadie/actions/runs?status=action_required&per_page=30"   --jq '.workflow_runs[].id' |
  while read id; do gh api -X POST "repos/kingithegreat/Sadie/actions/runs/$id/approve"; done
```

### Heads-up on worktrees

Three trees are live at once: `Desktop/sadie` (currently on `claude/crm-stale-flake`),
`Desktop/sadie-n8nguard`, and `Desktop/sadie-wt-jina`. **Check `git worktree list` and
`git status` before any mutating git command** — `reset --hard`, `checkout --` and `stash` will
discard another agent's uncommitted work.
