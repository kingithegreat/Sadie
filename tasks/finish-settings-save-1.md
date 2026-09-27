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
