# HomeBot technical status — 2026-10-03 NZ

This is a dated evidence snapshot, not a work queue. The
[current Drive master](https://docs.google.com/document/d/1gaMqUoQ1jfJcLREqKyMAhVBLiEy1oYZEOnOydZxaQWE/edit)
alone controls priorities and ownership. This snapshot supersedes the earlier
current-source and package-freshness statements in
[FINISHING_HANDOVER.md](FINISHING_HANDOVER.md); its detailed historical receipts
remain valid records and its owner's active edits are preserved.
[USER_TESTING_PLAN.md](USER_TESTING_PLAN.md) retains historical requirements and
acceptance criteria, not a competing live schedule.

## Current source

Fetched main is `c2ea3121b10eded032062586ad4162f6229edef4`. It includes both
bounded finishing fixes below. Their GitHub merge state and final-head checks
were read directly for this update; source completion does not establish a
replacement package or owner acceptance.

| Change | Merged source and evidence | Verification limits |
|---|---|---|
| Code selection, view and undo across Back | [#463](https://github.com/kingithegreat/Sadie/pull/463), merged as `9613c7c7`; reviewed head `5a4d3ef0` has 23 successful checks including all six required contexts and nine OS shards. Tested and merged full-tree diff is empty. Real CodeMirror tests passed 46 cases across seven suites; TypeScript, scoped lint and release build passed. Six actual production-built Windows stages preserve nonzero scroll, selection/caret and keyboard undo/redo, with dirty Close/Cancel, exact-byte Save and owned native exit. The committed navigation regression passed 1/1 with zero retries. | This source fixes the Back view-state reset recorded in the old package. It does not update that package. Retained baseline, harness failures and exact receipts are in [finish-code-view-state.md](../tasks/finish-code-view-state.md). |
| FFmpeg capability diagnosis uses the media renderer's resolver | [#462](https://github.com/kingithegreat/Sadie/pull/462), merged as `c2ea3121`; reviewed head `9072151c` has 23 successful checks including all six required contexts. The integration reviewer verified equal tested/merged trees (`85f9e56845aa3b7ce27b59c763247ed27636b8ac`). The unchanged boundary checker passed after extracting the neutral resolver; source-level real-FFmpeg A/B and 97 affected widget cases are recorded in [app-capability-ffmpeg-1.md](../tasks/app-capability-ffmpeg-1.md). | Matrix run `37105562423` executed all nine OS shards successfully. Windows shard 1 needed a second whole-shard outer attempt after its initial media-feed run reported a flaky case and exited 1. The successful matrix is not retry-free. A post-merge nightly review concern remains under independent investigation below. |

The integration review receipt records the final matrix counts per shard:
Ubuntu and macOS each passed `23 / 28 / 14` with `10 / 4 / 18` skips; Windows
passed `24 / 28 / 14` with `9 / 4 / 18` skips. Windows shard 1's first outer
attempt reported 23 passed, one flaky and nine skipped: media-feed retry 1
failed at 60 seconds, retry 2 passed, but that outer invocation exited 1.
The second outer invocation passed 24 cases with nine skips and exited 0.
The other eight shards passed on their first outer invocation.

Post-merge review [P2 on #462](https://github.com/kingithegreat/Sadie/pull/462#discussion_r4172181544)
reports that the nightly spy may be unable to redefine the direct `findFfmpeg`
re-export. The integration lane checked actual ts-jest 29.4.5/TypeScript 5.9.3:
the getter is configurable, the real spy succeeds and restores, and a deliberate
nonconfigurable negative control throws the claimed error. With `HOMEBOT_LIVE=1`,
the existing missing-FFmpeg case in `media-render.live.test.ts` passed: one case
passed, five skipped, six total; invocation 25.171 seconds, suite 24.605 seconds,
case 67 milliseconds, exit 0. Its source matches the `c2ea3121`/`9072151c`
checkpoint.

The P2 was not reproduced for that installed toolchain; this narrow result
justifies no source correction. The unresolved thread's disposition remains
with the FFmpeg owner. No universal review dismissal, automated-review clearance,
full-nightly run or package acceptance is claimed. The owner retains its
claim-retirement/task update in draft #464; that claim section is not rewritten
by this documentation lane.

Retrospective evidence is retained at
`C:/Users/adenk/.homebot/integration-audit-20261003/ffmpeg-review-triage/receipt.json`,
with `ts-jest-probe.retrospective.txt` and `targeted-test.retrospective.txt` beside
it. These transcribe retained tool responses, not full original raw logs;
truncated registration noise is unavailable. The receipt records the clean
`05f71427` checkout and empty production/test/config diff against `c2ea3121`.
The selected Jest command used `--forceExit`; it does not prove natural full-suite
shutdown. No full nightly, real FFmpeg/TTS, GUI or package was exercised by that
targeted test.

## Verified delivery and refresh

The previously verified and delivered production package is pinned to
`4c78098fa9c4a03fa3cbb33cfed8166a9898bfcf`, at
`C:/Users/adenk/.homebot/final-release-4c78098f-1790933846398`. It predates #463
and #462. Its recorded unsigned installer is 320,489,797 bytes, SHA-256
`3F4F97375AD2D94ECB90858D4A78515BAE237890E2A9B2BE7AAE748F0EF923BF`.

Its preserved receipts cover scanners, actual native Sharp/SQLite/media
export/recovery/restart, packaged Code save/navigation, offline Whisper fixture
transcription and actual offline Kokoro narration/export. They establish those
specific technical scopes. The package's Back cursor/undo/view reset remains a
property of that old artifact even though current source fixes it. See
[the earlier delivery record](FINISHING_HANDOVER.md#verified-final-package-delivery)
for immutable paths, hashes and the distinct Desktop launcher/copy. The delivered
launcher intentionally shares owner `CODEX_HOME`; its profile isolation claim
does not include that store. Existing delivery, previews, profiles, shortcuts,
assets and failed verification receipts remain preserved.

The prepared Code-only test copy at
`C:/Users/adenk/.homebot/code-view-test-5a4d3ef0-20261003` stays pinned to reviewed
head `5a4d3ef07f0fd374e5001e2f56c049a5980128e1`. Its 76 payload files were
independently hash-checked against `test-copy-manifest.json` with zero
mismatches; these include 74 compiled files totaling 5,689,365 bytes. Desktop
`HomeBot - Code State Test (5a4d3ef0).lnk` points to its own launcher; target,
arguments and working directory were read back. Its separately maintained
`STATUS.md` explains that pin and current limitations; this mutable status note
is outside the pinned payload. `test-copy-manifest.json` and
`delivery-receipt.json` retain the fixed payload/verification anchors.
The delivery receipt records preparation/ValidateOnly success, without GUI
acceptance, installer or refreshed-package acceptance. This copy contains the
Code repair but predates FFmpeg #462 and is not combined-current main.

The existing root/release_finish packaging lane owns `APP-PACKAGE-REFRESH-2`.
A source-only preparation checkpoint at `c2ea3121` was observed; final new-package
verification remains pending. The targeted nightly result above and remaining
owner thread disposition do not establish full-nightly or package acceptance,
and this snapshot does not assert that the owning agent stopped a build or
changed its source pin. No verified replacement installer or new owner
installation is recorded here. A later verified package receipt must update
this dated snapshot before a replacement artifact is described as current.

## Remaining owner acceptance

- Approved Leila artwork, the existing owner's rig mechanics proof, and a
  complete saved/reopened/re-exported narrated episode with visual/audio review.
- Spoken microphone transcription and owner voice/listening review. Existing
  fixture transcription and generated offline narration prove separate scopes.
- Actual entitled Pro execution; Free-path preservation does not prove it.
- Installation and the agreed flows on a Windows profile or machine that has
  never used HomeBot.

Existing held provider, Code, rig and other-owner documentation decisions remain
with their owners. This snapshot authorizes no new provider/model downloads,
paid generation, owner-profile replacement, signing or publication.
