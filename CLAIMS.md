# Work Claims

Repo-native companion to the Notion [🔗 Work Claims Ledger](https://app.notion.com/p/63dec393c18546ee9b924a472e9c59a3) and [🤝 Coordination Protocol](https://app.notion.com/p/390829ebf7be81e09866e1cd3a6bed6e). This file exists because Notion is easy to skip; this file is not — anyone building here sees it just by looking at the repo.

**Before starting a new feature build:**
1. Check the table below for an existing claim on the same feature area. If one exists and looks recent/active, don't start a parallel build.
2. `grep -rl <concept> src widget/src` for an existing module before writing a new one — HomeBot has two source trees (repo-root `src/` for pure/testable modules, `widget/src/` for the actual Electron app), so check both.
3. Add a row below before writing code. Update it to "Ready for Integration" when pushed and self-tested.
4. **Verify a claim against the repo before repeating it** — `gh pr view <n> --json state,mergedAt` is two seconds. The board is a lagging record, not a source of truth: on 2026-08-24 two rows said "Ready for integration" for PRs that had merged 48 hours earlier, and both got repeated as fact. Note that squash-merge means the original branch SHA is never an ancestor of main, so `git branch --contains` lies — check PR **state**, not commits.
5. **Each session works in its own git worktree. `C:\Users\adenk\Desktop\sadie` is nobody's checkout.** Two sessions sharing one HEAD interleaved reflog entries, reset a branch underneath a running merge, and clobbered an uncommitted claim row — three losses on 2026-08-24, one costing a full rebuild, all tracing to this. Aden provisions per-session worktrees (e.g. `Desktop\sadie-ox`, with `node_modules` junctioned so the widget suite runs immediately); ask for yours instead of touching the shared tree. Never run mutating git commands against another session's worktree — `git worktree list` first, every time.

CI runs `scripts/check-duplicate-exports.mjs` on every PR and will fail the build if a newly added file exports the same top-level identifier as an existing file — usually a sign two features were built in parallel without checking here first, or a scaffold was built without checking the real integration point (see the Step 1 entitlements gate channel-name mismatch, which was a variant of this same failure mode). See that script's header comment for how it works and how to suppress a genuine false positive.

4. **Verify a claim against the repo before repeating or trusting it** — the board is a
   LAGGING record, not a source of truth. Check `gh pr view <n> --json state,mergedAt`;
   squash-merge means the original SHA is never an ancestor, so `git branch -r --contains`
   lies. Two agents repeated rows here that had been stale for 48 hours.

## Active claims

| Feature | Branch | Status | Notes |
|---|---|---|---|
| Automation event triggers (Track H) | claude/automation-event-triggers | Ready for integration | ox-alpha, sadie-ox2 worktree. New `file` trigger end to end: an automation runs when a file appears in a watched folder. Tool layer (`tools/automation.ts`) validates the folder at save time — must exist, be a directory, inside the home boundary; pattern is filename-glob only. Firing engine (`scheduler.ts`) watches automations.json itself and reconciles per-folder fs.watchers from what it reads, so chat tools, IPC and hand edits all arm it without coupling; freshness re-checked at fire time; per-event debounce, in-flight guard, arm failures written onto lastResult where the UI already shows them; 30s resync backstops missed rename events. UI (`AutomationCenter.tsx`): trigger option, folder+pattern fields create & edit, card badge, Save gated on non-empty folder. FLAGGED touches outside the exclusive area, both minimal: `ipc-handlers.ts` (create handler coerced every non-schedule trigger to manual — file triggers would have saved as dead manual automations — plus watch-field passthrough) and `shared/types.ts` (SavedAutomation + preload param types). 17 new tests across three suites incl. real fs.watch round-trip; widget tsc/eslint clean; full serial suite 3386 passed / 0 failed; root 213 passed; docs in sync. n8n surface question raised with Aden separately, nothing built on that half. Does NOT touch the automation runner or permissions. |
| Connections catalogue (Track G) | claude/connections-catalogue (#218) | Merged 2026-08-24 09:18Z | New `connections` mode + ConnectionsPanel: one card per curated service (Notion, GitHub, Slack, Brave Search, Web Fetch, Memory), cost stated before connecting, keys linked to where they come from. Every entry goes through the SAME mcpAddServer IPC as the hand-entry form in PrivacySettingsTab — no second storage format or permission path. Chat reaches it via navigate_to_mode ('connections', derived from APP_MODES as designed); navContext.service pre-opens that card. 17 tests across shared catalogue + rendered panel; widget tsc/eslint clean; full serial suite 3349 passed; root 205 passed. Does NOT touch mcp-client.ts, permissions, or message-router. |
| Free-setup guidance in plain language (Track D) | claude/track-d-free-setup (#220) | Merged 2026-08-24 09:51Z | First-run wizard tells the truth about cost: free-tier providers now listed ABOVE paid-only ones in the cloud grid (a newcomer reads top-left first), the selected provider's actual free promise renders instead of an unused freeHint string (dead code — only its truthiness was ever read), and the Online card no longer implies every provider is free. 4 new tests in first-run-modal.test.tsx (35 total pass); tsc + eslint clean. Guidance layer only — does NOT build the doctor screen (#204), does NOT touch mcp-client or permissions. |
| Media job dead states + image-edit ladder rung 1 | claude/media-dead-states | In progress | Aden's tasking, working in sadie-ox worktree. Part 1: media-studio.ts declares 'scheduled' and 'analysing' with transitions INTO them — trace what advances a job OUT; wire the exit or remove the state, never half-real. Part 2: image-editing ladder rung 1 only — a durable result the user can come back to. Verification by numbers per .claude/skills/render-verification. Area exclusive today: widget/src/main/media-*.ts, tools/media.ts, MediaStudioPanel.tsx. |
| Image-edit ladder rung 1 — durable panel results | claude/image-edit-rung-1 | Ready for integration | Companion to claude/media-dead-states (dead-states fix ships separately). The ImageGenerator panel held finished images in React state only: Clear or closing destroyed them forever, while the chat path always wrote to userData/generated-images. New pure module generated-images.ts (saveGeneratedImage) persists every panel generation under the chat path's exact naming; handler returns {filename, savedPath}; ImageGenerator says "Saved with your other generated images" + Show in folder, and promises nothing when persistence fails. No editing yet — rungs 2+ build on this durable handle. 6 fs-only module tests + 3 panel tests; tsc clean; eslint 0 errors; five suites 117/117. |
| Delete a downloaded model | claude/delete-model-ui (#183) | Ready for integration | ModelsSettingsTab.tsx, useSettingsState.tsx, ipc-handlers (delete-ollama-model validation). Does NOT touch media tools or message-router.ts. |
| Kokoro as optional narration provider | claude/kokoro-narration-provider | Ready for integration | Aden picked Kokoro by ear (2026-08-23). voice.ts provider seam (Edge stays default + fallback; result names the engine that actually rendered), media_narrate `engine` arg, jobs record `narratedWith`, MediaStudioPanel engine picker with voice list that follows the engine and sampling routed through the SAME engine. kokoro-js rides the existing @huggingface/transformers stack (onnxruntime already ships for Whisper) — ~1 MB added, no Python. 10 seam tests; full suite serial green; docs regenerated. Does NOT touch message-router or the render graph. |
| Backup import can no longer repoint traffic endpoints | claude/backup-endpoint-guard (#209) | Merged | settings-import.ts (analyzeImportedEndpoints / stripImportedSettings), homebot:import-settings handler (confirm dialog when a backup would move n8nUrl/ollamaUrl/searxngUrl/codeApiUrl/customLLM.baseUrl; skips endpoints when nobody can answer — fail closed). Credentials stay stripped unconditionally. 16 settings-import tests. |
| Tool-surface hardening (audit remediation) | claude/tsh-integration (#230) | PR open — gated 2026-08-25 | grep_code/git via execFile argv (cmd-injection class removed), 14 CRM writes gated (requiresConfirmation + permissions entries), per-hop redirect SSRF revalidation + IPv6 private ranges, api_request POST confirmation, batch allow-once honors requiresConfirmation, shared home-boundary/url-boundary utils replace five drift-prone startsWith guards. New gate: `tool-permissions-parity.test.ts` — every native tool needs a permission entry or requiresConfirmation; every permission key needs a tool. Full widget suite + tsc green on current main. Does NOT touch message-router routing logic or the media pipeline. |
| Visual pass: icons redrawn + chrome polish + indigo-violet theme | claude/visual-pass | Ready for integration | Aden asked for a visual pass, then a full-app theme change. Commit 1: all 35 `IconName` glyphs redrawn to Lucide-grid geometry in components/Icon.tsx (worst offenders: settings gear was a lumpy hand-trace, sparkle read as an asterisk) — union unchanged so ~40 call sites need no edit, no new deps. ICON & CHROME POLISH PASS appended to chatgpt-theme.css: .hb-icon optical alignment, shared hover-lift/press-sink/:focus-visible model across chrome buttons, disabled honesty, on-palette ::selection, reduced-motion respected. Commit 2 (THEME PASS): accent moved from system blue to **indigo-violet** — base oklch tokens hue 250→285, --homebot-blue-* hex values retuned (names kept), Apple-layer --accent #0A84FF→#7C5CFF with tinted glass materials, light-theme accent #6D4AFF, ambient washes re-tinted, composer focus glow, conversation-item active spine, glass mode-bar pill + toast materials, unified quiet scrollbars, last literal blue (.theme-btn.active) fixed. User-friendly preserved: text contrast untouched, white-on-accent ≥4.5:1, zero layout dimensions changed, all passes removable as single blocks. Verified: tsc clean; eslint 0 errors; full serial suite 237 passed / 2 failed suites that fail identically on pristine origin/main. Worktree: Desktop/sadie-visual. |

Merged since the last board refresh, verified against `gh pr view` 2026-08-24: delete-model (#183),
privacy-switch naming (#178), quiz full count (#186), Kokoro narration engine (#214), Code mode
(#201), feeds mode (#202), navigation primitive (#196), backup endpoint guard (#209), and
MCP connect-on-add (#221 — verified merged 10:57Z during this review). The old
per-row claims are retired — do not rebuild any of these.

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

## Known non-duplicates

Identifiers intentionally exported by more than one file (add the exact name, one per bullet, to suppress `check-duplicate-exports.mjs` false positives). Pre-registered from the existing codebase so a future file rename doesn't trip the check:

- `UpgradePrompt` — mirrored between `src/entitlements.ts` (pure) and `widget/src/shared/types.ts` (renderer-facing copy)
- `GateBlockedResponse` — same pure/renderer mirror pattern, `src/handlers/featureGate.ts` + `widget/src/shared/types.ts`
- `isGateBlocked` — same pattern, `src/handlers/featureGate.ts` + `widget/src/shared/upgrade.ts`
- `Settings` — legitimately distinct `Settings` shapes in `widget/src/main/config-manager.ts`, `widget/src/renderer/types.ts`, `widget/src/shared/types.ts`
- `StoredConversation`, `ConversationStore`, `ConversationSearchResult` — mirrored between `widget/src/main/memory-manager.ts` and `widget/src/shared/types.ts`
- `ScheduledJob` — mirrored between `widget/src/main/scheduler.ts` and `widget/src/shared/types.ts`
- `Capability` — unrelated: `src/entitlements.ts` exports the licensing-tier union (what a license allows); `widget/src/shared/capability-report.ts` exports a doctor-screen health row (`id`/`label`/`state`/`detail`/`fix`). Same word, different domains.
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
| F · Coding platform front door | ox-alpha | Code mode shipped (#201, WorkspaceShell destination); the remaining question is what a user can actually DO once they arrive there |
| G · Connections catalogue | ox-alpha | #218 gives it a front door: `connections` mode reachable from the mode bar, dashboard, and chat navigation |
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


## Dependency decisions — 2026-08-23 (do not re-litigate)

Three third-party projects were evaluated this week. Two were rejected for reasons that are
licence- and architecture-shaped, not taste-shaped, so they will look attractive again to
anyone who has not read this.

| Project | Decision | Reason |
|---|---|---|
| **Remotion** (React video rendering) | **No** | Free tier is for-profit orgs of **up to 3 employees**, so Aden qualifies personally today. But the licence forbids shipping a derivative — *"not allowed to copy or modify Remotion code for the purpose of selling, renting, licensing, relicensing, or sublicensing your own derivate"* — and HomeBot is a sold product whose headline feature is making videos. Every user would run Remotion through it, and the free tier is per-company so their headcount may count too. That is a licence negotiation with Remotion, not a code change. |
| **Agent Reach** | **No wrapper** | It has **no fetch, read or search commands at all**. Its verbs are `setup, install, configure, doctor, uninstall, skill, format, transcribe, check-update, watch, version`. It is a playbook plus a dependency installer — the agent reads its SKILL.md and calls `curl r.jina.ai`, `yt-dlp`, `gh` itself. An MCP wrapper would re-implement what `tools/web.ts` and `main/reader-fetch.ts` already do. Run `agent-reach skill --install` instead. |
| **Voicebox** (TTS/STT) | **Yes — optional provider, never bundled** | MIT, local, keyless, and it ships **Kokoro** and **Qwen3-TTS**, which clear the msedge-tts ceiling of 24 kHz / 96 kbps mono that caps narration quality today. It is a Tauri + Python stack, so bundling it would drag a Python runtime into the installer and fight Track A. Detect it, use it, fall back to Edge TTS. **Measure before integrating** — `.claude/skills/render-verification` covers how. **Measured 2026-08-23** (`narration-measure\`): Kokoro-82M hard-codes 24 kHz output, so it does **NOT** clear the rate ceiling — half the assumption above is wrong. What it clears is the codec half: lossless PCM vs Edge's 96 kbps MP3 (+8–9 dB more top-octave energy; one lossy pass into the mux instead of two). Same script: 18.75 s vs 18.94 s, levels within 1.7 dB. A/B samples on disk (`edge-ava.mp3` vs `kokoro-heart.wav`) awaiting Aden's ear call before any wiring. |

### And one idea worth stealing

`agent-reach doctor` enumerates every capability and reports **three** states — works,
installed-but-unconfigured, not installed — printing the literal command that fixes each broken
one. It even refuses to mark something available when it declined to run the check that would
prove it (`gh auth status` writes a device-id, so it is not run and not claimed).

HomeBot does the opposite, measurably. On 2026-08-23 web search was found to return **HTTP 202
with a challenge page** after roughly one query — a success status — so the parser found no
results and the app advised the user to *try different search terms*. Fixed on
`claude/search-blocked-honestly`, which also adds SearXNG (free, unmetered, keyless, a real API
rather than a scrape) as the first provider when configured.

**A `doctor` screen is the next major piece of work** and is claimed by the Claude Code session.
Do not start one in parallel.

### New shared primitives, as of today

- **`shared/navigation.ts` + `navigate_to_mode`** (#196, merged) — the assistant can move the
  user to a mode *with a payload*. Adding a mode is two edits: `APP_MODES` in `shared/modes.ts`
  and `MODE_INFO` in `shared/navigation.ts`. The tool enum, validator and error text all derive
  from that list. **Do not write a second mode-switching mechanism.**
- **`SearchBlockedError` + `isSearchBlockPage`** in `tools/web.ts` — being refused is not the
  same as finding nothing, and only the first can be fixed by the user.

## Rules of the road — agent tooling, 2026-08-24

No product code changed here. This is the per-tool wiring so Cline and Copilot can honour the
rules the other files already state.

**Copilot could not verify anything, and that is why nothing of its landed.** Its entire commit
history in this repo is four `Initial plan` commits and a VS Code session checkpoint; its three
branches sit ~50 commits behind main with nothing merged. Two causes, both environmental:

1. Its ephemeral environment had no `node_modules`, so the verification command in
   `.github/copilot-instructions.md` could not run.
2. Even installed, the widget suite cannot pass on Linux — 43 test files write to `os.tmpdir()`
   and the main-process file tools refuse anything outside `os.homedir()`. `ci.yml` already
   records the cost: 92 failures across 10 suites on ubuntu.

`.github/workflows/copilot-setup-steps.yml` fixes both — both packages installed,
`better-sqlite3` rebuilt against Node, and `TMPDIR` pointed inside `$HOME` (the Linux analogue of
`ci.yml`'s Windows TEMP step). **It does nothing until it is on `main`** — the platform only reads
it from the default branch, and the job must stay named `copilot-setup-steps`.

**The `TMPDIR` fix is measured, not reasoned.** Run on Linux 2026-08-24 against this tree, same
command, only `TMPDIR` differing:

| | Suites failed | Tests failed |
|---|---|---|
| without `TMPDIR` | 4 | 79 |
| `TMPDIR="$HOME/homebot-test-tmp"` | 1 | 5 |

The 74 that flip are `codebase-tool`, `edit-file-tool` and `filesystem` — all denied by the home
boundary, none of them bugs.

The 5 that remain are all `sd-cpp-setup.test.ts` and share one cause: `sd-cpp-setup.ts:177`
throws "Automatic setup currently supports Windows only." That is a product decision, not a
broken test, so **on Linux 5 failures in that one suite is the clean result.** Recorded in the
instruction files so no agent burns a session "fixing" it or reports it as a regression.

Still unobserved: the same run inside an actual Copilot session. The environment is a GitHub
Actions Linux runner either way, so the mechanism is the same, but `copilot-setup-steps` exporting
`TMPDIR` via `GITHUB_ENV` into the agent's own shell is the one link that cannot be checked from
outside. That is why the instructions also pass `TMPDIR` on the command line. First agent to run
there: confirm the count is 5.

**New files, and what reads them:**

| Path | Read by | Holds |
|---|---|---|
| `.github/workflows/copilot-setup-steps.yml` | Copilot agent | Dependency install + `TMPDIR` |
| `.github/instructions/*.instructions.md` | Copilot cloud agent, Copilot code review | Rules scoped by `applyTo` glob — they arrive only when you open matching files |
| `.clinerules/` (now a **folder**) | Cline | All `.md` combined; was a single file |
| `.clinerules/workflows/*.md` | Cline | `/verify.md`, `/claim.md`, `/identity.md` — runnable, not prose |
| `.clineignore` | Cline | Read filter: build output, lockfiles, binaries |

Because `.clinerules/` is now a folder, Cline no longer falls back to `AGENTS.md` on its own —
`01-homebot.md` instructs it to read that first, so keep that line intact.

**Two things only Aden can do**, both one click:

- Turn on the repo setting that skips workflow approval for Copilot coding agent Actions runs.
  Until then the `action_required` loop in `AGENTS.md` has to be run after every bot push — ten
  runs were held in one day, five for three days.
- Nothing else. The rest of this is in the repo.

**Division of labour, because the tools are not interchangeable.** Cline runs on Aden's Windows
box and can run the widget suite, so it owns `widget/` work. Linux-bound agents (Copilot, Claude
Code on the web) are better spent on the root package, pure modules in `src/`, docs, CI and n8n
workflows — and must write "unit tests not run in this environment" rather than implying green.

**Attribution is still broken and this only half-fixes it.** 686 commits share the identity
`kingithegreat <adenk@example.com>`, so `git blame` cannot say which agent wrote a line, and the
Media Studio track credited to ox-alpha above cannot be verified from git at all. Exactly one
commit in repo history is attributable to it. `/identity.md` sets a repo-local `git config
user.name` for Cline; Copilot already signs as `copilot-swe-agent[bot]`. Existing history is not
rewritable — this only fixes commits from here on.
