# Media Studio completion takeover

Owner: Codex, requested by Aden on 2026-09-12. Branch `claude/studio-completion`
started from main `935fb4a` in its own worktree. Original #271 speech/export
worktrees and active workspace-unification work are preserved.

## Narration and export recovery

Recovery source: `claude/studio-narrated-export` at `5cc888d` (#271). Its shared
speech consent checks, Kokoro compatibility adapter, export validation, saved
movie recovery and playback are reconciled with main's newer speech code and
canonical `storyboard-assembly.ts` from #299. No stale manifest read path is
restored. The existing default voice Sample action is visible before online
voice discovery succeeds.

The output validator uses the actual speech file returned by the selected
adapter, pads short narration to each shot, rejects narration that would be
cut off, validates every frame and duration, decodes the full final file, and
stages replacement until tracks/dimensions/duration/audio checks pass. Failure
preserves the previous movie. The UI releases Windows media handles before
replacement and recovers the saved player after reopening.

### Reproduced and verified on Windows

- Before the speech repair: 13 privacy failures, 1 allowed-speech control pass.
  After: 46 tests across four speech suites pass.
- Before export recovery: 18 output-contract failures, 1 intentional-silence
  control pass, using canonical saved shot files. After: 38 main storyboard
  tests and 12 renderer storyboard tests pass.
- Fresh-profile real Electron Sample/voice-discovery privacy test: 1 pass,
  no retries, 25.5 seconds; five transport controls then zero speech requests.
- Real cached Kokoro: 5.5-second 24 kHz mono WAV, RMS 0.0651423, zero observed
  requests, 7.662 seconds; empty-cache check fails locally with zero requests.
- Real Electron Studio export/restart/replacement test: 1 pass, no retries,
  1.3 minutes. H.264/AAC 1920x1080, 30 fps, 8.000 seconds, 131760 bytes.
  SHA-256 `1c810b1f215cba5e1bf905dad64ff081cce51daadbf6be860f54d92e63bcb314`.
  Speech/silence/speech RMS: 0.08743 / 0 / 0.08693. Sampled frames and burned
  captions inspected. Restart decoding/playback, failed-replacement byte
  preservation, and replacement with a loaded player pass.

Tests: `speech-privacy.test.ts`, `kokoro-loader.test.ts`,
`narration-engine.test.ts`, `voice-tools.test.ts`,
`storyboard-export-output.test.ts`, `storyboard-renderer.test.ts`,
`media-storyboard-tools.test.ts`, `media-studio-storyboard.test.tsx`,
`speech-privacy.e2e.spec.ts`, `storyboard-export.live.e2e.spec.ts`.

The live export is opt-in with `HOMEBOT_STUDIO_EXPORT_LIVE=1` and installed
`HOMEBOT_FFMPEG`. `HOMEBOT_KOKORO_TEST_CACHE` can point the standalone speech
check and Electron fixture at an already-prepared isolated model cache. These
checks never download models. The separate preparation in this session was
explicitly network-approved and changed no owner settings/shared dependencies.

### Remaining acceptance

The full Windows widget run passes 301 suites / 4135 tests (19 existing/opt-in
skips); root passes 18 suites / 227 tests. Both typechecks, build and docs pass;
lint has zero errors and eight existing warnings. Durable Git checkpoint and
required remote checks are pending at this entry. This two-shot authored-card test proves
mechanics, not a full episode, two-scene ending, generated-art quality, all
aspect ratios, installed release, publication or owner visual acceptance.
Continue the existing Notion STUDIO-01 through STUDIO-05 queue after recovery.

## Complete saved scenes and restart reliability

The editor now exposes each scene, scopes repeated shot IDs to that scene, and
saves every scene before Render Movie. A failed save stops export. Whole-project
export follows saved scene order; explicit single-scene exports use a separate
filename. Saved shot lists, including empty lists, are authoritative: removing
a card no longer resurrects its retained assets in reopening, project counts,
or export. Adding after removal cannot duplicate a remaining shot ID. Invalid
timing/IDs are rejected before Save Board writes. Shot sheets and timeline cuts
include the whole project. Editing is disabled while saving/rendering.

Five new export regressions and three new UI regressions failed before repair.
The subsequent five-suite run passed 60 tests. An actual two-scene Electron
test (same shot ID in each scene, unsaved last-scene edit) passed without retries
in 1.7 minutes: 8 seconds, 1920x1080, both captions and timed speech, last frame
played through `ended` with loop off, app restart, failed replacement preserving
bytes and playback, then successful replacement with the player loaded. The
encoded output matches the hash above. Raw evidence is retained under
`widget/test-results/storyboard-export.live.e2e-4fcbb-imed-narration-and-captions`.

The first two-scene restart run exposed a real startup settings race: a delayed
hardware probe restored `firstRun: true` after setup dismissal. The actual
startup block also reproduced lost privacy changes and an overwritten chosen
profile. Re-reading settings immediately before the startup write repairs it;
the same protection covers background model fallback, which also respects a
model chosen while discovery was running. Regression tests execute the actual
startup blocks without launching unrelated integrations. Both hardware tests
failed before repair; the concurrent model-choice test also failed before its
guard. The real movie restart passes after the settings repair.

PR #312's workspace integration is now merged on main `0ac2326`; combine it
with this checkpoint and rerun gates before publishing the takeover branch.
Full episode, all aspect ratios, trustworthy export identity, owner visual
acceptance, installer and publication are still separate acceptance work.

## Combined-workspace checkpoint — 2026-09-13 NZ

Integrated #312 at main `0ac2326` (merge checkpoint `269f03b`). A reproduced
late project-load race no longer attaches a previous project's movie to the
new selection. Review requires a real queue job with the matching saved path;
arbitrary navigation text is not treated as a verified export. Single-scene
exports cannot replace the whole-movie review entry. If the queue cannot be
saved, the completed file stays available with an explicit warning, not an
invented successful job ID. These three regressions failed before repair.
The React review informed scoped/functional shot updates and deriving the
matching review job from the current project/file instead of stale UI state.

Final combined Windows checks: **303 passing widget suites / 4,158 tests**,
6 existing skipped suites / 19 skipped tests; root **18 suites / 227 tests**.
Both typechecks, build, docs and duplicate-export guard pass. Lint: zero errors,
eight existing warnings. The guard inspected the new production speech adapter.
The first combined suite had one old banner-label expectation failure; that
test now checks the saved-file contract and queue navigation with persisted
metadata. The complete rerun above is green, not a filtered retry.

Two rebuilt Electron tests pass without retries in 1.8 minutes: default Sample
with Online off, plus the complete two-scene film, reachable Director review
queue, correct saved path after restart, full ending with no looping, and
failed/corrected replacement with the player loaded. No approval or upload was
performed. Encoded dimensions/duration/audio/captions/hash are unchanged.
The latest local movie is retained in the disposable profile
`homebot-storyboard-export-EgKMtM`; portable measurements are in
`docs/evidence/studio-completion.json`. Remote CI is a separate gate, and this
eight-second diagnostic is not a finished episode or full Studio acceptance.

## Recovery merged and bounded handoff — 2026-09-13 NZ

[PR #314](https://github.com/kingithegreat/Sadie/pull/314) merged at
`c90f077f3d3b7886581d5197cfc7219de91dcafc` (12 September 12:38:51 UTC).
Fetched main and verified its entire Git tree matches tested `33bc636`:
`9abc5c0e8047673f8bda4930657bdee624cbd071`. All six live required contexts
are present and green, including `e2e-all`; the recovery claim is released.

The [matrix logs](https://github.com/kingithegreat/Sadie/actions/runs/34693313469)
show actual tests, not a zero-test success. Linux shards passed 20 + 18 + 17
(one opt-in skip). macOS passed 20 + (17 plus one flaky) + 17 (one skip).
Windows passed 20 + 18 + (16 plus one flaky), with one skip; shard 2 required
the workflow's second attempt after a conversation-search overlay retry and
an error outside a test. Its second attempt passed all 18. macOS's context-menu
position test and Windows's visual-mode test also passed after test retries.
These qualifications do not change the green merge gate, but are not evidence
of a no-retry full matrix. No CI thresholds, retries or tests were weakened.
The two scoped local real speech/export tests passed without retries.

The actual MP4, evidence JSON, sampled frames, Studio screenshots and trace
are archived under this checkout's ignored
`.kilo/artifacts/studio-completion-33bc636/`. The copied MP4's SHA-256 matches
the measured hash above. Earlier #271 history and worktrees remain intact;
its production recovery is superseded by #314, not blindly merged.

Antigravity is actively editing `claude/pilot-16-9-acceptance` (#313) in the
shared checkout. No files in that checkout were changed by this session.
The owner has been asked to resolve sole ownership versus continued parallel
integration/testing. Source review at `e948aa7` found its storyboard IPC drops
the UI's aspect ratio, captions remain forced on, and its single-scene/legacy
manifest behavior must not replace this verified all-scene implementation.
Its later `3a6f6d7` repairs the default Sample control and browser `path` import;
that branch has not been runtime-accepted by this session. Preserve its unique
work and this branch's canonical scene, privacy, identity and replacement tests.

Remaining acceptance is unchanged: persisted independent duration/ratio and
output variants, captions off for the approved 16:9 productions, truthful
revision/latest-attempt/latest-good state, stage/export parity, accessible
workspace review, a complete owner-approved pilot, repeatability and an actual
fresh-profile installed build. Eight-second authored cards do not satisfy those
gates. No paid generation, account/credential changes, approval or upload occurred.

Authorship correction: Codex wrote `e8de4aa`, `33bc636` and the retirement
commit `833c40b`. Shared repo-local Git configuration had changed to Antigravity
before those commits. Their published history is preserved; future commits pin
the correct identity on the commit command. This is a metadata correction,
not a change to the tested source or a transfer of Antigravity's #313 work.
