# FINISH-SETTINGS-SAVE-1 — truthful settings persistence

Owner: Codex. Fresh branch `claude/finish-settings-save-20260927` from main `0005f11d`. Root owns Drive, build/release lane and integration.

## Reproduced reachable defect

App opens the real SettingsPanel in Simple by default. Its Online switch modifies the draft; Save reaches App.saveSettings → the actual exposed preload bridge → `homebot:save-settings`.

On an IPC `{success:false,error:'disk read-only'}`, preload returned GET_SETTINGS (old settings), App treated the result as success, and the Settings hook closed before awaiting acknowledgement. Turning Online off therefore discarded the draft and left the previous saved Online policy active. This is lost failure acknowledgement; it is not a claimed policy bypass.

The new actual-preload/mounted-App tests initially failed all three intended assertions: rejection became a resolved old settings object, the failed-save dialog disappeared, and even a pending write closed the dialog. Instrument issues (JSDOM has no structuredClone and App renders two Settings buttons) were corrected before recording these valid red results. Logs are retained locally in widget/settings-save-red.log.

The real main IPC registration has separate baseline controls: returned request data lacked config normalization, and a post-commit refresh exception was reported as a write failure. Baseline: two red, one passing failure control (widget/settings-ipc-red.log).

## Implemented path

- Preload rejects failed/malformed acknowledgements instead of fetching stale settings as success.
- Settings awaits onSave, displays the actual error plus retained-draft/retry guidance, and blocks duplicate writes. App updates settings only after success.
- Main returns persisted readback. Noncritical search refresh exceptions cannot reclassify a committed write as unsaved.
- Existing model selector/suggestion callers wait for persistence and report failure without applying optimistic settings. Setup completion/skip awaits one onSave, retains choices and reports failure. The Studio narration preference catches its intentionally session-local asynchronous failure. Telemetry consent catches into the Settings error.

## Caller audit

Renderer save calls: App (Settings, two model selectors, model suggestion, setup); FirstRunModal (now sole onSave); MediaStudioPanel preference; MessageBubble recovery; PermissionHistory revocation; PermissionModal remembered grants; PrivacySettingsTab telemetry.

MessageBubble and PermissionHistory already await/catch; PermissionModal already catches. Their existing grant semantics are preserved. Main-side config callers remain synchronous and are outside the preload rejection change. Privacy kill-switch and licensing/tier rules are unchanged.

## Storage investigation

Config writes before cache invalidation, with consent logging errors already caught. Its direct target write could truncate before throwing. An isolated real-filesystem negative control writes a partial payload then throws 'disk full'; previous-byte preservation failed on baseline (widget/settings-persistence-red.log). Root approved the bounded correction.

Settings now writes an exclusive sibling temporary file and replaces the destination only after the complete write. Cache invalidation follows replacement. Cleanup targets only that exact temporary path. Failed temporary writes and failed renames preserve the previous bytes, cache and reloaded policy; retry succeeds. The nested customLLM disk copy is cloned before encryption, preserving caller/cache fields even on failure. No owner profile or credentials are accessed. This addresses failed-write integrity; it does not claim power-loss durability or multi-process configuration locking.

## Validation and limits

Final adjacent run: 169/169 tests, eleven suites, normal exit, no skips/retries (widget/settings-final-focused.log). Actual-preload/App failure, delayed acknowledgement, duplicate-save guard, retry/reopen, and setup skip failure/retry are covered. Actual main registration write failure/readback/postcommit refresh is covered. Existing config encryption/recovery/secret-preservation tests and three isolated filesystem failure controls pass.

Widget typecheck passes. Lint passes with zero errors and seven existing warnings. Docs write/check is in sync (247 preload methods, 182 renderer→main, 33 main→renderer); no API additions. Diff check passes. React review checked async acknowledgement/state changes and retry reachability; no unrelated redesign or new UI flow was added.

No full suite, build, Electron launch, provider/account/model/microphone operation, live owner settings or dependency rebuild/install was run. The renderer tests exercise React/JSDOM with the real preload bridge and mocked IPC responses; real built UI acceptance remains root's coordinated follow-up when the release lane is available.

## Integration with merged onboarding

Root initiated the merge of main 055f355d (#420). The only conflicts were this claim and the adjacent FirstRun state declarations. Resolution retains both records and the onboarding draftRef, exact downloaded tag, hardware selection, inventory/error/retry logic alongside the single awaited save and retained choices.

The first integration run found three onboarding fixture failures: inert onSave mocks could no longer cause the removed direct duplicate write. Those three fixtures now route their callbacks through mock persistence as App does, retain all selected-model assertions, and additionally require exactly one write. A combined real-component test verifies that a 4GB-recommended downloaded qwen2.5:3b choice survives save failure and is persisted unchanged on retry.

After resolution: 115/115 tests in six affected FirstRun/hardware/settings acknowledgement/main IPC/config suites, no skips/retries; widget typecheck and lint pass (zero errors/seven existing warnings). No build or live-profile lane was used.

## Built acceptance source prepared

Main 1f6fbc7b (#423) merged cleanly; the affected suites plus isolation guard passed 117/117 with per-file temporary roots, and typecheck/docs/diff passed.

The opt-in `settings-save.live.e2e.spec.ts` (`HOMEBOT_SETTINGS_SAVE_LIVE=1`) requires its own fresh compiled main to use a live fs object property for the atomic writer. Inspection of the package-proof bundle confirmed `const fs = require("fs")` and property-based config writes; the spec rejects a stale non-atomic build. Its own rebuilt output subsequently confirmed those imports and atomic temp-write/rename calls.

It seeds only a disposable profile without keys/accounts, intercepts precisely that profile's settings sibling temporary write once, immediately restores fs.writeFileSync, writes a partial disposable temp and throws. Actual Simple Settings → App → preload → main IPC → config writer must retain the draft/error, preserve prior file hash and active theme/policy, retry, close, persist Online-off and light theme, and reopen with saved values. No bridge or private IPC handler is replaced.

An isolated child bootstrap runs before main, blocks actual Node/renderer transports with five positive controls, and fixtures only startup local inventory so startup cannot contact or launch the owner's Ollama. HOME/profile/projects/AP-marker are isolated; evidence records hashes/counters without settings secrets. Playwright collection finds one test; source typecheck/lint pass.

## Actual built proof

Root allocated the lane. The first build was blocked by sandbox directory access; the authorized build succeeded (widget/settings-live-build-authorized.log). No dependency install or rebuild occurred.

Attempt 1 is retained at `.kilo/finish-20260927/settings-live-attempt-1.log` and its results/report/JUnit siblings. It failed before Save because Electron did not execute the NODE_OPTIONS require bootstrap: the network positive-control state was absent. This is a harness failure, not a Settings product failure. It had only a disposable no-key profile and loopback ports 1/2, but startup transport protection is not claimed for that failed run. Its owned Electron exited normally.

The corrected launcher uses an exclusive own CJS shim adjacent to the real compiled main, preserving Electron's app directory. It explicitly requires the isolated bootstrap, then the unchanged actual main bundle. There is no private app API, replacement IPC handler or bridge. Only that exact own shim is removed after the owned process exits.

Attempt 2 passed **1/1, zero retries**, test duration 6.733s (19.058s total), with all assertion and teardown stages complete. Five transport positive controls were observed; two startup axios calls were blocked and five inventory fixture responses supplied. No actual provider transport or key/account was used in this passing proof. The injected partial sibling temp write hit once and restored fs.writeFileSync immediately. The prior file hash stayed unchanged, the off/light draft and actionable error remained, App's active theme stayed dark, retry saved Online-off/light and closed, and reopen matched saved values via UI and actual preload GET_SETTINGS.

The owned process exit request followed two renderer animation frames and completed in about 0.73s. Normal app.exit was sufficient; no forced or global process kill occurred.

Evidence directory: `.kilo/finish-20260927/settings-live-attempt-2-results/settings-save.live.e2e-bui-0de7b-nd-retries-through-real-IPC/`. The failed-draft and reopened screenshots were visually inspected. The JSON includes actual entry path and hashes:

- Compiled main: `c1f67161ca72be87adfaa9d72f51df237cd8c372e407281b79aff961e05f7044`
- Previous settings: `400d0d10ae43be64bc635a45699299a455aacaf57d7bb813308074048836120e`
- Persisted retry: `f9aa1279988fa08f7e204bd8741ac8757d6b8b6d3583ff89687d2a2cb95222bd`

Post-proof environment type filtering (undefined values omitted) typechecks; lint has zero errors/seven existing warnings. Production sources were unchanged throughout acceptance. Full-suite/CI/release packaging remains root's separate integration gate.

## 2026-09-28 independent review correction: pending Save dismissal

At PR head `14497ea9`, a mounted-App test held the Settings IPC write pending, clicked Cancel, and found the dialog closed before the write acknowledged. The same path existed for header Close, backdrop, and Escape (including a separate window-level listener). The write could still commit after the user thought Cancel had discarded it. The negative-control test failed before the correction.

Root delegated this bounded correction on the existing #428 branch. The original owner worktree was clean and its claim had been released; the remote head matched `14497ea9` before edits. Settings now blocks Cancel, Close, backdrop, and both Escape handlers while `saveInFlight` is true. The buttons are visibly disabled during Save. On success the dialog closes; on failure it retains the draft and permits retry or dismissal. The mounted-App/preload regression covers all four routes and passes after the correction.

On the corrected source, four focused Windows suites execute **57/57** tests with normal exit; widget TypeScript passes; changed-file ESLint reports zero errors and three existing hook warnings; `git diff --check` passes. The Electron-Vite production build succeeds. The existing isolated built Simple Settings test passes **1/1, zero retries** outside the command sandbox, through actual UI, preload, IPC and disposable filesystem. It proves failed partial-write preservation, retained draft, successful retry, reopening and five pre-entry network controls. The failed-draft screenshot was inspected. Its canonical empty MCP fixture now prevents optional default npx connectors from becoming part of this Settings proof.

Two sandboxed GUI attempts are retained as environment limits, not product passes: one timed out at hydration after 120 seconds; the second Electron launch exited after repeated GPU-process `-1073741515` failures. The same rebuilt source and test passed with authorized GUI access. The built test does not exercise the new pending-dismissal race; that case is covered at the mounted-App/preload level. Full current-head CI and merged-content verification remain for root's integration queue.

## Current-main integration — 28 September 2026

Merged the review correction `64937678` and current `origin/main` (`92797ebe`, including release-build #426) into the existing branch. The reviewed Settings production files match the corrected PR head exactly; `git diff --check origin/main...HEAD` passed. On Windows, four affected suites passed **57/57**, widget and root TypeScript checks passed, widget lint reported zero errors and seven existing warnings, docs were in sync, and the normal Electron build completed.

The isolated rebuilt Simple Settings test passed **1/1 without retries** through actual UI, preload, main IPC and disposable settings storage. Its five transport positive controls executed; an injected partial sibling-file write kept the previous hash and Online policy, showed the retained draft/error, then retry saved Online-off and Light and reopening read them back. The previous and persisted file hashes matched the reviewed proof. Failed-draft and reopened screenshots were inspected. The pending-save Cancel/Close/Escape/backdrop race is covered by the mounted-App regression, not this built test. Current-head CI, merge and installed-profile acceptance remain separate gates.
