# HomeBot technical status — code complete (2026-10-10 NZ); snapshot 2026-10-04 NZ

> **2026-10-10 NZ — code complete, pending owner checks.** As of main after
> #474 (`bf75c7a0`) and #479 (`8b5e535d`), all planned code work is merged and
> CI is green. HomeBot is complete pending only the owner-only checks in
> [USER_TESTING_CHECKLIST.md](USER_TESTING_CHECKLIST.md): fresh install, voice,
> Pro paid path, PROV-3 live image, IDE-6 speed, Leila art plus the six-second
> rig proof, Flappy anchor, and one full narrated episode. The snapshot below
> is retained as historical evidence.

This is a dated evidence snapshot, not a work queue. The
[current Drive master](https://docs.google.com/document/d/1gaMqUoQ1jfJcLREqKyMAhVBLiEy1oYZEOnOydZxaQWE/edit)
alone controls priorities and ownership. This snapshot supersedes the earlier
current-source and package-freshness statements in
[FINISHING_HANDOVER.md](FINISHING_HANDOVER.md); its detailed historical receipts
remain valid records and its owner's active edits are preserved.
[USER_TESTING_PLAN.md](USER_TESTING_PLAN.md) retains historical requirements and
acceptance criteria, not a competing live schedule.

## Current source

The verified source checkpoint is main
`102b4c562c3545552c08f33a70ffb360b4636e8b`. It includes both
bounded finishing fixes below, the authority/status documentation in #465
(`2a656bc7`), and FFmpeg claim retirement in #464 (`102b4c56`). The primary
`Desktop/sadie` checkout was independently read as clean main equal to
`origin/main` after its fast-forward. The complete `2a656bc7` to `102b4c56`
diff contains only `CLAIMS.md` and `tasks/app-capability-ffmpeg-1.md`; app
production inputs are unchanged. GitHub merge/check evidence and runtime
delivery evidence establish distinct scopes; human acceptance remains open.

| Change | Merged source and evidence | Verification limits |
|---|---|---|
| Code selection, view and undo across Back | [#463](https://github.com/kingithegreat/Sadie/pull/463), merged as `9613c7c7`; reviewed head `5a4d3ef0` has 23 successful checks including all six required contexts and nine OS shards. Tested and merged full-tree diff is empty. Real CodeMirror tests passed 46 cases across seven suites; TypeScript, scoped lint and release build passed. Six actual production-built Windows stages preserve nonzero scroll, selection/caret and keyboard undo/redo, with dirty Close/Cancel, exact-byte Save and owned native exit. The committed navigation regression passed 1/1 with zero retries. | This source fixes the Back view-state reset recorded in the old package. It does not update that package. Retained baseline, harness failures and exact receipts are in [finish-code-view-state.md](../tasks/finish-code-view-state.md). |
| FFmpeg capability diagnosis uses the media renderer's resolver | [#462](https://github.com/kingithegreat/Sadie/pull/462), merged as `c2ea3121`; reviewed head `9072151c` has 23 successful checks including all six required contexts. The integration reviewer verified equal tested/merged trees (`85f9e56845aa3b7ce27b59c763247ed27636b8ac`). The unchanged boundary checker passed after extracting the neutral resolver; source-level real-FFmpeg A/B and 97 affected widget cases are recorded in [app-capability-ffmpeg-1.md](../tasks/app-capability-ffmpeg-1.md). | Matrix run `37105562423` executed all nine OS shards successfully. Windows shard 1 needed a second whole-shard outer attempt after its initial media-feed run reported a flaky case and exited 1. The successful matrix is not retry-free. The post-merge nightly concern was not reproduced by the bounded installed-toolchain check below. |

The integration review receipt records the final matrix counts per shard:
Ubuntu and macOS each passed `23 / 28 / 14` with `10 / 4 / 18` skips; Windows
passed `24 / 28 / 14` with `9 / 4 / 18` skips. Windows shard 1's first outer
attempt reported 23 passed, one flaky and nine skipped: media-feed retry 1
failed at 60 seconds, retry 2 passed, but that outer invocation exited 1.
The second outer invocation passed 24 cases with nine skips and exited 0.
The other eight shards passed on their first outer invocation.

Documentation #465's exact reviewed head `96895326` also completed 23 checks
and nine actual OS test steps before its equal-tree merge as `2a656bc7`.
Windows shard 3 required whole-shard outer attempt 2: streaming and
system-prompt each passed internal retry 1 in the first invocation, which
reported 12 passed, two flaky, 18 skipped and exited 1; the second passed
14 with 18 skips and exited 0. Its retained CI/review packet is
`C:/Users/adenk/.homebot/integration-audit-20261003/pr465-96895326/receipt.json`.
Its older-head NuGet installer failure ran no E2E tests and is retained
separately; it does not qualify the reviewed head.

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
full-nightly run or package acceptance is claimed by that probe. The owner's
claim-retirement/task update subsequently merged in #464. This lane corrects
only its two obsolete pending-check sentences and appends its own status note;
the owner's historical source, test and failed-run records remain preserved.

Retrospective evidence is retained at
`C:/Users/adenk/.homebot/integration-audit-20261003/ffmpeg-review-triage/receipt.json`,
with `ts-jest-probe.retrospective.txt` and `targeted-test.retrospective.txt` beside
it. These transcribe retained tool responses, not full original raw logs;
truncated registration noise is unavailable. The receipt records the clean
`05f71427` checkout and empty production/test/config diff against `c2ea3121`.
The selected Jest command used `--forceExit`; it does not prove natural full-suite
shutdown. No full nightly, real FFmpeg/TTS, GUI or package was exercised by that
targeted test.

The refreshed #464 retirement head `f7f55a9ffe2539f0d8afadfdb15f0dea7d014052`
completed 23 successful checks, including all six strict required contexts
and their duplicates. Matrix run `37115463106` executed all nine actual test
steps: Ubuntu and macOS each passed `23 / 28 / 14` with `10 / 4 / 18` skips;
Windows passed `24 / 28 / 12` with `9 / 4 / 18` skips, plus two flaky cases
in shard 3. Those streaming and visual-check cases each passed retry 1.
Totals were 194 passed, two flaky and 95 skipped; all nine whole-shard outer
invocations exited 0 on attempt 1. This result is not retry-free. The reviewed
head, actual CI checkout and merge share full tree
`3622f54999a018534811ade023a399d46c377181`. The earlier `05f71427` failure and
later passing attempts remain historical evidence, without an asserted cause.

Independent final-head evidence is retained at
`C:/Users/adenk/.homebot/.kilo/pr464-f7f55a9-final-independent-1791024322731.json`
(SHA-256 `DB85A32891FAD2F0F1172F9D54A0AD386119835D2B42D0AD6FADA4007DD79DA1`).
All 20 bound files were hash-verified, including all nine complete matrix logs.
The post-merge cloud review completed against that head and reported a
[documentation P2](https://github.com/kingithegreat/Sadie/pull/464#discussion_r4172846316)
for the obsolete pending-check wording. This snapshot's bounded CLAIMS/task
corrections address that wording. The post-merge P2 was unresolved at the
`102b4c56` source checkpoint; canonical Drive records later thread disposition.
Automated review was not clear at that checkpoint. The read-only audit is
`C:/Users/adenk/.homebot/integration-audit-20261004/integration-queue/readonly-audit.json`.

## Verified delivery and refresh

The independently audited private preview is
`C:/Users/adenk/.homebot/final-release-2a656bc7-1791021962668`. Its package
source is `2a656bc7315be85acc4ba1e43d84095ae6bdc2d8`; compilation remains
bound to `c2ea3121b10eded032062586ad4162f6229edef4`, without relabeling the
build. Its app inputs match current main as described above. The independent
read-only audit verified all 315 frozen runtime hashes, all 74 compiled ASAR
files against original build output, 589 dependency name/version identities,
Sharp/SQLite native bytes and JSZip presence. All 11 genuine cached model
files matched their hashes (385,531,938 bytes); no second model copy was made.

The unsigned installer is 320,739,537 bytes, SHA-256
`4541F3B4B1899CFCCA762F4B7B601B7350DBDBAF7916CA1FB1BBED971A63C6FA`.
Its creation and integrity establish a private preview, without an installation
or signed-update acceptance claim.

| Packaged proof | Actual result | Limits |
|---|---|---|
| Code navigation and save | Nonzero horizontal/vertical scroll, selection/caret, keyboard undo/redo, dirty cancellation and real save retained; recorded native exit 0. | Six controls cover the postlaunch main Node transports reached by this proof, without universal network isolation. |
| Native libraries and media recovery | Actual Sharp/SQLite, original FFmpeg diagnosis/export, real encoder failure preserving the last good movie, restart/playback and successful replacement. Three recorded native exits 0, without fallback. Eight samples across the four-second diagnostic movie were inspected; distinct same-source exports had identical bytes. | Diagnostic media does not establish Leila artwork, rig or episode acceptance; entitled Pro is untested. |
| Offline Whisper | The genuine cached model transcribed a known file-backed capture fixture. Wrapper exit 0; Electron closure was awaited. | No live microphone. Two global/library fetch controls; the exact Electron exit code was not retained. |
| Offline Kokoro | Original local model/tokenizer produced fresh 7.7-second speech (RMS 0.0683138) and an H.264/AAC 1280×720 movie (audio RMS 0.1479051), with full decode and restart playback. The independent reviewer inspected diagnostic frames and the restart player. Wrapper exit 0; Electron closures were awaited. | Online was configured Off; the visible UI toggle helper was unused. Two fetch controls; exact Electron exit codes were not retained. Human listening acceptance remains open. |

The delivered `evidence/final-acceptance-20261004.json` binds the four scope
receipts. Independent sealed-package audit:
`C:/Users/adenk/.homebot/integration-audit-20261004/sealed-package-audit.json`,
SHA-256 `393D75080E8703901BDCE653672A329FC28D9DC9E86450BF7AE1369B4583F182`.
This documentation lane read it and verified its 18 bound evidence-file hashes,
with zero mismatches; it ran no build or product acceptance scope.

Desktop `HomeBot - Packaged Main 2a656bc7.lnk` was independently read back
against its package launcher, with the old shortcut unchanged. Before normal
user launch, the launcher was amended to put movie projects under
`launch-profile/home/projects`; the original sibling path was outside the
production HOME guard. No project data existed or moved. The amended
ValidateOnly invocation exited 0, and independent execution of the exact
compiled guard accepted the new root and rejected the former sibling, a
prefix trick and owner AP path. This changed launcher/finalizer preparation,
without a product/runtime change or finalizer rerun. Evidence:
`evidence/launcher-project-home-amendment-20261004.json` and
`C:/Users/adenk/.homebot/.kilo/delivery-project-home-amendment-review-1791082001009.json`.

Private HomeBot profile, HOME, OS stores and projects are initialized on an
actual launcher run, which this independent audit did not perform. AP is
unconfigured in this preview and no owner AP fallback is used; no AP runtime
proof is inferred. `CODEX_HOME` intentionally shares owner authentication,
configuration and history. This exception is outside profile isolation.

The earlier verified and delivered production package remains pinned to
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

The existing root/release_finish packaging lane retains `APP-PACKAGE-REFRESH-2`
and preview ownership. Its delivered technical scopes above supersede the
earlier source-only preparation checkpoint. The targeted nightly probe remains
a separate bounded result, without full-nightly or human acceptance. Existing
delivery, previews, profiles, shortcuts, assets and failed intermediate package
receipts remain preserved. The failed incomplete dependency package is not
the verified replacement and is not silently treated as passing.

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
