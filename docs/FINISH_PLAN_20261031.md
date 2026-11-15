# HomeBot completion plan — 31 October 2026 NZDT

This is the concrete execution checklist for Aden's three-agent finishing request.
The [live Drive plan](https://docs.google.com/document/d/1gaMqUoQ1jfJcLREqKyMAhVBLiEy1oYZEOnOydZxaQWE/edit)
remains the priority and ownership authority. This file records dependencies,
acceptance conditions and the current evidence; it does not declare the app done.

## Finish target

One identified Windows candidate supports the agreed HomeBot workflows through
normal controls. Saved work survives closing, restarting, cancelled work and failed
replacement attempts. Every agreed requirement has evidence or an explicit owner
decision. Source integration, packaged acceptance and Aden's approval are separate.

## Verified starting point

- GitHub main and `git ls-remote` agree on `058f88c723b6ff8677b1080f1479e5706c4b3f58`.
  The Desktop primary checkout is older `ad5a6b96`; it was left untouched.
- The only open PRs returned by the connected GitHub search are #413, #500 and #501.
  Their presence is not acceptance or authorization to retire their holds.
- Core's finishing worktree is clean at the main baseline. Studio's finishing
  worktree contains uncommitted changes and explicitly records an unresolved
  animatic acceptance failure. Release has uncommitted icons and a 16-row report.
  All three were preserved.
- Current-source playback and Storyboard renderer-unit checks passed: two suites,
  68 tests. This is limited unit evidence using the older dependency donor; it
  does not qualify installed/current-runtime speech or the complete episode.
- The installed donor has Electron 42.8.1, msedge-tts 2.0.7 and no node-pty.
  Current locks require Electron 42.11.11, msedge-tts 2.1.0 and node-pty 1.2.0-beta.15.
  The release worktree instead has node-pty 1.1.0-beta34 and no Electron executable.
  Matching repository lockfiles do not prove the installed dependency graph.
- The existing installer workflow builds, installs, waits for a window and
  uninstalls on hosted Windows. It retains no installer and does not exercise
  the full app. Latest inspected run 40557910337 succeeded on head 6082a909,
  whose tree was recorded equal to merged main in the prior Drive evidence.
- Current resource snapshot was about 6.35 GiB free disk / 5.59 GiB free RAM
  after the unit run. These are snapshots. Keep the existing 5/2 preflight and
  exclusive heavy-job lock; increase storage requirements for large installs.

## Ownership and execution order

| Stage | Owner | Work | Exit condition |
|---|---|---|---|
| 1. Reconcile | Integration | Replace broad stale rows with the requirement inventory below; bind claims to actual changes and evidence | No requirement or active owner is lost |
| 2. Core and Code | Agent 1 | Exercise current-main paths; fix only reproduced gaps; inspect already-merged IDE work before rebuilding it | Evidence for core/Code checklist and remaining decisions |
| 3. Studio | Agent 2 | Resolve the animatic acceptance failure without bypassing narration synchronization; finish saved episode editing/export/recovery and metadata | Current-build UI and media evidence; creative approval still explicit |
| 4. Candidate | Integration | Serially review qualified changes; retain one source-pinned hosted Windows installer and receipt | Candidate artifact/hash and install/window/uninstall receipt |
| 5. Installed acceptance | Integration | Exercise the exact candidate through all independent normal-control workflows below | Every case pass/fail with persistent-state evidence |
| 6. Owner acceptance | Aden | One combined session for real microphone/listening, entitled Pro, creative performance and unavailable external setups | Explicit decisions attached to the exact candidate/output |
| 7. Close | Integration | Repair failures, recheck affected scopes, update Drive and release claims | No unaccounted blocker; no public release/signing inferred |

Agents 1 and 2 work independently; Integration alone drives the merge queue.
One defect per PR. A change to shared IPC/contracts must be agreed before editing.
Recheck claims and open PRs before starting each item. Do not send new prompts to
other chats or create extra agents without the applicable user authorization.

## Full requirement inventory

The historical tables in `USER_TESTING_PLAN.md` retain the exact done-when clauses.
The groups below account for every requirement ID in those tables. A recorded
merge is implementation evidence; repeat the affected acceptance on the candidate.

| Requirement IDs | Current disposition and next action | Owner |
|---|---|---|
| G-1, G-2 | Prior scheduled acceptance is recorded. Check latest scheduled release/media runs against candidate source; do not substitute an old green run | Integration |
| G-3 | Isolation correction is recorded merged. Require actual current Windows test execution; do not label unrelated dependency failures product regressions | Integration |
| G-4 | Preserve all nine shards and required aggregate; no context/timeout/retry weakening | Integration |
| MS-RIG-0 | Drive records exact six-second proof accepted and saved in a separate preview. Preserve it; do not repeat the obsolete unidentified-owner wait | Studio / existing creative owner |
| MS-1, MS-2 | Camera motion and transitions recorded merged. Measure movement, post-transition total and audio/caption alignment in an actual candidate export | Studio |
| MS-3, MS-5 | Caption styling and title cards recorded merged. Inspect long text and safe margins in landscape and portrait exports | Studio |
| MS-4 | Music/ducking recorded merged. Measure quiet/loud windows and clipping in the actual export | Studio |
| MS-6, MS-7 | Timeline controls and preview-only Stage labeling recorded merged. Exercise every retained control and confirm its stated effect | Studio |
| MS-8, MS-9 | Shared smooth-motion/GPU-fallback implementation recorded merged. Retain A/B motion, encoder choice, timing and fallback evidence | Studio |
| MS-10 | Undo/redo/autosave recorded merged. Prove edits and restart recovery on the candidate | Studio |
| MS-11 | Live paid Gemini image remains an owner authorization/account gate; fixtures cannot close it | Aden / Studio |
| MS-12 | Stage compositing design remains an explicit owner decision; do not silently omit it or implement a new renderer | Aden / Studio |
| MS-13 | Historical PR dispositions recorded complete. Reopen only a reproduced current regression | Integration |
| PROV-1 | Capability registry recorded merged. Verify available choices, removed account behavior, labels and Online-off refusal | Studio |
| PROV-2, PROV-3 | Signed-in image and paid API live evidence remain distinct from recorded-request tests. Recheck current implementation before any authorized live trial | Aden / Studio |
| PROV-4 | Existing open #413 owns video clips. Review its exact head and retain paid-call hold; qualify fixture clip duration/motion/privacy before integration | Existing PR owner / Integration |
| PROV-5 | Provider-specific coverage remains explicit work. Inventory existing supported providers first; one provider/request contract per change; no unapproved live spend | Studio |
| PROV-6 | Optional vector-art direction remains an owner decision | Aden |
| IDE-1, IDE-2, IDE-3, IDE-5, IDE-9, IDE-10 | Editor/context/review/inline edit/search/Git recorded merged. Prove real file bytes, rejected edits and undo through normal controls | Core/Code |
| IDE-4, IDE-7, IDE-8, IDE-12, IDE-13 | Current requirement table records #474 merged, unlike stale release report FB-006. Verify plans, safe restore, semantic retrieval/rules and approved MCP execution; do not rebuild old branches blindly | Core/Code |
| IDE-6 | Completion reliability recorded merged #490. Real installed local-model p50/quality still needs the actual setup; never substitute mock latency | Core/Code / Aden |
| IDE-11 | Current table records #416 and #474. Verify actual task output, Stop, Problems navigation and native process cleanup | Core/Code |
| IDE-QW1 | Project formatter/linter recorded merged #485. Verify allowed-folder execution, format-on-save and Problems using disposable installed project tools | Core/Code |
| IDE-QW2 | Cap notices recorded merged #488. Verify an over-cap fixture and visible corrective settings | Core/Code |
| IDE-QW3 | JSON settings/keybindings recorded merged #489. Verify valid live change, invalid-value recovery and restart | Core/Code |
| IDE-QW5 | LSP/Python recorded merged #492. Verify completion/hover/diagnostics/definition with an available approved server; unavailable installation remains explicit | Core/Code / Aden |
| REL-1 | Exact installed candidate still needs full agreed app flow; installer window smoke is narrower | Integration |
| REL-2 | Checklist moved into USER_TESTING_PLAN.md. Bind each completed step to the candidate; deliver one combined owner checklist | Integration |
| REL-3, REL-3.1, REL-3.2, REL-3.3, REL-3.5, REL-3.6 | Prior reachability/dead-export/i18n work recorded complete. Sweep current tester-visible controls; no unnecessary removal of live capability | Core/Code / Integration |
| REL-3.4 | Operator-assisted queue recorded merged. Verify project-scoped cancel/retry/late-result handling; do not claim active GPU notebook interruption | Studio |
| REL-4 | Problem reporting recorded merged. Create a local bundle with a seeded fake secret and assert it is absent | Core/Code / Integration |
| #500, #501 | Separate owner-held draft episode-script/model and tooltip PRs. Review exact scope/checks and integrate only once qualified; preserve owner holds | Existing owners / Integration |
| Full episode / series | Existing full Egypt cut and shorter variety proof are separate previews. Complete owner feedback and current-main recipe/metadata/script-edit integration before sequential other episodes | Studio / existing creative owner / Aden |

## Additional core acceptance (not omitted for lacking historical IDs)

| ID | Normal-control acceptance | Owner |
|---|---|---|
| CORE-1 | Fresh first-run; choose local/Online; change choice during pending checks; save/reopen; failed save is visible and retry keeps the edited choice | Core/Code |
| CORE-2 | Local and configured custom chat; streamed answer, Stop, Retry, navigation during pending work and reopen the original stored conversation | Core/Code |
| CORE-3 | Attach image/document, including image-only turn; inspect the assembled provider request and persisted attachment behavior within size budgets | Core/Code |
| CORE-4 | Online Off refuses external processing before any request; unavailable local services give actionable recovery | Core/Code |
| CORE-5 | Real microphone capture/transcription plus local voice playback and stop; fixture bytes and human listening remain separate | Core/Code / Aden |
| CORE-6 | Store/retrieve/remove memory and documents through reachable controls; restart and verify persistence/deletion | Core/Code |
| CORE-7 | Create/edit/run/schedule/cancel/delete automation in a disposable setup; verify the saved execution/result rather than only button state | Core/Code |
| CORE-8 | Entitled Pro feature execution with a real approved entitlement; never fabricate or bypass licensing | Aden / Integration |

## Candidate and owner checklist

The installer receipt must name the checked-out source, workflow/run attempt,
installer SHA-256/bytes and locked Electron/speech/terminal versions. Keep the
prior install/window/uninstall smoke and label it accurately. Retain artifacts
only on successful smoke; never call this full fresh-Windows acceptance.

Installed acceptance: setup; local/custom chat; attachments; microphone/voice;
memory/documents; automation; Code open/edit/save/assistant/task; Studio editing,
save/reopen/narrated export and playback; cancelled/failed replacement and last-good
after restart; Online-off privacy; redacted report bundle; normal native exit.
Use disposable per-store locations and verify them before starting. No owner
profile, account, signing key or old delivery is replaced.

Ask Aden once for the concrete remaining decisions: exact full episode/variety
watch-and-listen; real microphone and voice quality; actual Pro entitlement;
available fresh Windows environment; explicit paid-provider budget/account setup;
Stage compositing and optional vector-art scope. Finish independent work first.

## Do not repeat these false shortcuts

- No compiler installation based solely on the inherited packaging report.
  Establish the exact installed graph and original failure first.
- Do not merge the unfinished Studio tick change. The hook deliberately holds
  narrated pictures while audio loads/stalls. The existing acceptance test still
  describes silent playback and starts with the default engine while Online is off;
  first reconcile that setup with the current real-narration contract.
- Do not use old IDE branches as evidence of a current missing feature. The latest
  requirement table already records the major IDE integration as merged.
- A green first-run window, compiled directory or unit suite is not the complete
  product. No deadline or percent-complete estimate replaces missing evidence.
