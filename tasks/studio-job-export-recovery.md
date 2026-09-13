# Ordinary-job export recovery and identity — STUDIO-04 checkpoint 2

Codex, 13 September 2026 NZ. Base: merged #321/main `3e1fe55`.
Claim: https://app.notion.com/p/3da829ebf7be81f1af37ff296f329099.

## Existing path and bounded contract

The ordinary `MediaJob` store and `media_render` handler already preserve an old
file when QA rejects a replacement, but assign `renderPath` to that rejected
movie. The job card calls every renderPath ready to watch; the central player
and timeline consume the same pointer. A file surviving somewhere on disk is
not enough. Start with a failing persisted-pointer and visible-UI regression.

Extend this existing path, shared output/attempt metadata and export-status UI:

- Separate latest attempt and rejected diagnostic from latest successful movie.
- Preserve new and legacy movie files and addressable output history.
- Compare exact selected output with saved source where provenance is known;
  old/external unknown provenance stays Unknown, never guessed from timestamps.
- Freeze attempt inputs and preserve newer saved edits and project A/B identity.
- Recover persisted interrupted attempts without automatically rendering again.
- Make player, timeline, file actions and review refer to the intended export;
  selecting history cannot approve a different current movie.

Reuse the existing guarded Studio IPC/tool boundary and file/path helpers.
No new pipeline/framework, account, provider or publication authority.
Explicit multi-output and external-renderer parity are separate tasks.

## Verification and preservation

Reproduce before fixing. Unit tests cover early/render/QA failures, immutable
legacy replacement, saved source edits, history and interruption. Real Windows
Electron/FFmpeg must demonstrate A/B, previous-good playback after replacement
failure and restart, successful retry and exact history/file/review actions.
Then full local gates, actual required CI test execution and exact merged
content before release. Diagnostic fixtures are not a full approved pilot.

The separately owner-approved preview/progress patch is local b5aa5cf under
`codex-episode-progress`; its launcher and ui-preview profile are not ours to
repoint or publish. Preserve its disjoint card-progress/doctor/chat-mode edits,
all original projects and the existing Egypt production. Privacy, 4 GB/CPU
strategy, no-caption preference, approval/upload separation and installer gates
remain unchanged. No product code was changed when this claim was created.

## Implementation and local checkpoints

Red regression commit `1b62049` follows claim `219e2f4`. Original mocked store/UI
tests fail at the pointer and ready banner; real FFmpeg reproduces the same
failure in 43.4 seconds (profile `homebot-job-recovery-proof-jfvuja`). The old
movie's bytes survive, but its player pointer becomes a QA-rejected replacement.

The implementation extends the existing renderer and shared export-status UI:

- Every legacy/new attempt has unique frozen inputs, output and diagnostic
  filenames. Only successful QA plus metadata storage changes `renderPath`.
- Last success, latest attempt and rejected diagnostic are separate. Interrupted
  persisted attempts recover without automatically starting generation.
- Byte-based source/output identities, addressable history and per-export slides
  drive the exact player, timeline, stage and Reveal action. Unknown provenance
  remains Unknown; unchanged timestamps cannot hide replaced source bytes.
- Later edits and other jobs survive asynchronous completion; removed jobs are
  not recreated. Known script/narration mismatches require new narration.
- A visible retry uses saved inputs, including music and reusable scene plates.
  Historical selections cannot approve/upload a different current movie. Main
  rechecks the exact displayed path, actual bytes and ordinary-job source before
  review. Immutable storyboard review jobs retain their own source contract.
- Reveal failures are visible; watching, approval and uploading are separate.

Intermediate evidence under `.kilo/artifacts/studio-job-recovery/`:
24 initial regression passes; 67 expanded UI/store/gateway passes; 4,243 full
widget passes / 306 suites (19 opt-in skipped), 227 root passes / 18 suites.
The first full run's only failure expected the retired ready banner; its
replacement asserts legacy Unknown provenance. Final review adds more tests.

Actual `checkpoint` run passes the original rejection case in 27.2 seconds.
The expanded `restart-focused` run passes in 29.7 seconds with no retries/skips:
A/B, failed replacement, full three-second playback before/after restart, visible
retry, immutable history, exact Reveal/timeline and refused stale-path approval.
Profile `homebot-job-recovery-proof-PAK7vi` is retained. OS Reveal is trapped only
at Electron's launch boundary; preload/IPC/path checks are real. No test approves
or uploads a movie. Earlier navigation timeouts are retained, not called media
passes: explicitly focusing only the test window resolved the stable-click issue.

These are intermediate builds, not the final frozen-source result. Final review
passes 71 focused cases and widget typecheck. Full final-source regression, real
media batch, CI and merged-content checks remain required before release.

Limitations: process-local active-attempt lock, not a cross-process scheduler;
interruption proof uses a persisted record, not a mid-encode process kill;
diagnostic stills/synthetic audio and cached local speech, not approved creative
production; development bundle, not installer acceptance. Missing provenance on
old narration is not reconstructed. No snapshot/output garbage collection is
added; retained files intentionally consume disk space. Multi-output remains
the next separate checkpoint, not an implied feature of this recovery work.

## Production freeze aa864ba and focused-window test setup

Exact production commit `aa864ba0c5f8a2f4de791438c76f9822ed3b3b5a` passes 4,253
widget tests / 306 suites, 19 opt-in tests skipped, in 129.132 seconds. Both
typechecks, build, lint and docs pass. Main bundle SHA-256 is
`be5849b583249339fa5e82532aa97f5e2ae8697096413165ce995b5b9f82d9a4`.

The first 16-case compatibility batch had three failures around 40 seconds
each and was stopped, not treated as a clean media result. The isolated privacy
diagnostic then passed unchanged assertions in 5.7 seconds. The exact cause of
every aborted-batch failure is not established. Earlier recovery diagnostics
show a stable-click timeout, and explicitly restoring/showing/focusing the
test's own native window already passed the recovery test. That test-only setup
is now shared by these seven Studio compatibility files, with window diagnostics
retained for a privacy failure. Generic app launch, production code, assertions,
privacy gates and the owner's preview are unchanged. The next batch stops on its
first failure, has zero retries, and retains separate reports/results.

## Cross-source review metadata regression

The ordinary history reader initially omitted known metadata for an immutable
storyboard review job because its exact movie lives outside media-assets.
An added regression records one failure/five passes, then six passes after the
shared candidate validator preserves that exact verified movie without scanning
another project's history. Its saved export revision remains known; only the
board can compare its current source. The actual narrated storyboard cases now
check the IPC record and Director message too. This production correction follows
aa864ba; that running compatibility batch is intermediate, not final-source proof.
Red/green logs are retained in its artifact directory. A rebuilt final run is
required before publication of the branch.

## Final local verification report — eec6796

Story: retry a failed ordinary-job export, recover after restart, and inspect the
exact saved movie without losing a prior success or approving a different file.
The full-flow verification checklist is applied to Electron/preload/IPC and disk,
not a web deployment. React review retains derived state, functional updates and
cancellation of late project-A responses when project B is selected.

Exact production and test source: `eec67961446d973ed9493cef2075dc459b4064bf`.
Actual main bundle SHA-256:
`8e6662b5d37a3cd3060efcbab4ce140bcb9ad90dc68159c83e00ca1fdf71ef97`.
Windows widget: **4,254 tests / 306 suites pass**, 19 opt-in tests skipped,
99.055 seconds. Root: 227 / 18 pass, root source unchanged since that check.
Both typechecks, build, docs (218 preload / 167 renderer-to-main / 33 main-to-renderer)
and duplicate guard pass; the guard positively checks one new production helper.
Lint has zero errors and eight existing unrelated warnings.

Final real Electron batch: **16 pass, zero failures/errors/skips/retries**, 369.278
seconds. This includes the new 32.5-second ordinary recovery flow, storyboard A/B
freshness/history, eight encoded geometry cases, 3.0/3.49-second ordinary audio
timing, cached local narrated caption-on/off exports, speech privacy and theme.
Retained artifacts: `.kilo/artifacts/studio-job-recovery-eec6796/`, including
`focused-junit.xml`, logs, screenshots, original profiles and `exports/`.

| Boundary | Status | Evidence |
|---|---|---|
| Visible UI → preload/guarded IPC | Verified | Visible Retry and history controls; real IPC plus foreign-sender, malformed-argument and permission regressions |
| IPC → render/data | Verified | Real flat-content QA rejection (variation 0.3); old successful pointer/bytes retained; distinct successful retry and immutable input/output metadata |
| Persistent data → response/UI | Verified | Restart, A/B selection, source/attempt labels and exact history movie; full three-second ending with no loop or media error |
| Review → intended movie | Verified | Historical Approve disabled, direct stale-path approval refused, state remains awaiting approval; storyboard review preserves its independently verified metadata |
| File action → OS boundary | Verified with adapter limit | Exact selected path crosses actual preload/IPC checks; Electron shell launch is trapped to avoid opening unrelated desktop apps |

The initial pointer/banner regressions and the later storyboard-review metadata
regression are red-to-green. Final recovery profile is
`homebot-job-recovery-proof-CoY2qP`. Original and repaired-source retry are distinct
files with the same expected bytes, SHA-256
`7e1493be086413b6adb696468d317c64742a260852a89e1751f84dd0dbca5188`.
No movie was approved, uploaded or published.

Archive verification copies **22 MP4s: 21 successful exports and one deliberately
QA-rejected diagnostic**. Every source/copy hash matches; sidecar hashes match
where present; ffprobe finds actual video and audio tracks. The final encoded
hash multiset exactly matches the intermediate aa864ba/70b0fcb batch. Portable
measurements: [studio-job-export-recovery.json](../docs/evidence/studio-job-export-recovery.json).

Inspected screenshots show the reopened captioned storyboard and the historical
movie at 0:03 with disabled Approve and explicit read-only guidance. The initial
failure screenshot is before playback (black at 0:00), so it is not used alone as
playback proof. Element screenshots have capture/scroll cropping; this is not
1280/1920 workspace, scaling or owner visual acceptance. Compatibility tests seek
to the ending of longer movies rather than continuously watching every 66-second
case. Other limits above remain in force.

Local implementation is ready for normal branch publication. Required remote CI
and exact merged-content verification are still pending; no main/installed or
complete-Studio claim. Next after integration: explicit landscape/portrait outputs
with shared accepted inputs and independently truthful failure/retry status.
