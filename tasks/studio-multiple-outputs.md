# Explicit multiple outputs and independent recovery — STUDIO-03 checkpoint 2

Codex, 13 September 2026 NZ. Fresh main #322:
`4da4532848cf2b8afa5edf5ffd512300c6494331`.
Claim: https://app.notion.com/p/3da829ebf7be81c8b63edd4022da7aee.

## Existing path and missing behavior

The shared `StudioOutputSpec` already contains a variants array, but its validator
requires exactly one entry. Both real renderers select `variants[0]` and the
controlled `StudioOutputSettings` advertises one output file. This is the
explicit Generate both requirement in the current Studio acceptance plan, not
permission to make long-form silently produce two files.

Extend the existing settings, job/storyboard renderers, guarded tool/IPC paths,
attempt metadata, review queue and `StudioExportStatus`. No second pipeline.

## Contract

- Explicit landscape + portrait selection independent of content length; each
  variant has saved resolution/framing and its own preview/framing check.
- Honest time/cost/disk preview: measured values or qualified Unknown/Estimate,
  never an unconditional zero-cost promise or universal duration.
- Freeze one batch source; reuse validated narration and accepted assets across
  sequential CPU encodes and retries where their content identity still matches.
- Each variant has an immutable export ID/path, latest attempt and last success.
  Partial failure keeps the successful movie, with a visible independent retry.
- Save/restart, edits during export, A/B selection, history and every file/review
  action stay tied to the exact variant and source. No automatic approval/upload.
- Audit all create/edit/chat/podcast/storyboard callers: none may silently ignore
  an additional variant. Existing single/legacy behavior remains compatible;
  unsupported external-renderer settings remain explicitly unsupported.

## Verification

Start with failing regression tests for the missing contract. Verify real encoded
landscape/portrait files, distinct identities, framing and audio reuse; genuine
partial failure, preservation, visible retry, restart and exact review path.
Run full Windows local checks, required CI with actual executed counts and exact
merged-content verification before claiming completion. Diagnostic fixtures do
not establish approved pilot or art quality. Do not stack on unmerged code.

## Preserved boundaries and remaining work

No new provider/spend, credentials, signing/release, owner profile/launcher change,
source-art overwrite or external Python renderer rewrite. The separate clean
`codex-episode-progress` preview at `b5aa5cf` and its Egypt output remain untouched.
The latest owner visual review reports soft character close-ups and white glasses
artifacts; this task does not fix or approve those assets. Source-generation
geometry, stage parity, workspace/scale/accessibility, creative pilot approval
and fresh-profile installed acceptance remain later parts of the existing plan.

This is a pre-implementation claim and plan. No new source or passing behavior
is asserted by creating it.

## Initial red checkpoint

Before production edits, four new regressions fail and 46 existing cases pass
across `studio-output-formats.test.ts` and `media-studio-storyboard.test.tsx`
(25.658 seconds, Windows). Both short/long job creation rejects two explicit
variants; visible new-video/storyboard output-selection controls are absent.
The cases also specify independent framing and saved choices reaching existing
create/render IPC. `.kilo/artifacts/studio-multiple-outputs/red-widget.log` retains
the result. The earlier `red.log` is only a wrong-working-directory invocation
that ran no tests, not product evidence. Render reuse/partial recovery tests and
implementation follow; no two-format export success is claimed.

## Review and recovery design constraint

Ordinary jobs currently have one state, one current renderPath and one approval
decision. That state cannot stand for two independently reviewed movies. Reuse
the storyboard's immutable per-export review-queue pattern for successful batch
outputs: the source production keeps attempts/history, while each reviewed file
has its own decision. Preserve an existing review entry on retry; do not reset
an approved record or let a parent production approve the whole batch implicitly.
Per-variant current-source revisions must compare only that variant's settings,
not invalidate landscape merely because portrait framing changed. The preparation
and input snapshots are shared; the CPU encode and QA verdict are independent.

## Render red checkpoint

Two new renderer regressions fail and 69 existing cases pass (4.490 seconds,
Windows). Ordinary and storyboard exports reject both formats before encoding;
the tests require shared frozen ordinary inputs and one storyboard narration
preparation for both encodes. Evidence: `render-red-isolated.log` in the same
artifact directory. The first `render-red.log` had three additional failures
caused by unused one-shot mocks leaking from the new early-rejection test.
Scoped cleanup now clears that queue even on assertion failure. That original
run is retained as a test-harness defect, not five product regressions.

## Ordinary renderer / controls implementation checkpoint

84 tests pass across the ordinary renderer, job export state, output formats and
controlled storyboard UI suites (6.977 seconds, Windows). `ordinary-first.log`
retains the result. One preparation feeds sequential encodes/QA; separate review
entries and attempts preserve successful landscape and its approved fixture
decision across portrait failure/retry. Portrait framing alone does not change
landscape's source revision. Both is explicit and the render button no longer
promises $0.00. An intermediate typecheck is clean. These are adapter/controlled
UI results, not actual media or final validation.

`partial-red.log` first reproduces ordinary silent first-variant-only behavior
after enabling shared validation (2 failed, 26 passed). The new storyboard
partial review/retry/cached-speech test and existing both-encode test remain red:
2 failed, 43 passed, 2.289 seconds (`storyboard-partial-red.log`). Storyboard
batch, recovery UI/IPC, full checks and real Windows files are still in progress.

## Connected batch checkpoint

152 tests pass across seven focused Windows suites (9.879 seconds), with a clean
typecheck. `focused-checkpoint.log` and `checkpoint-types.log` retain the results.
Storyboard batch encodes share copied pictures/assembled speech; text/engine-keyed
local narration cache reuse checks bytes and audible duration. Partial successes
cross IPC into exact-file reviews, and visible portrait-only retry preserves the
landscape movie. Per-format source/status/history controls and Open source project
use the existing Studio paths. Model-facing schemas now describe explicit both.

Additional reproduced/fixed seams: missing failed-format records after shared
preparation failure (`recovery-edges-first.log`, then 75 passing edge/format tests
in `recovery-edges-green.log`); object-valued attempt error metadata that could
crash React (`attempt-fields-red.log`); and narrowing Both to one output allowing
a duplicate parent approval (`narrowed-review-red.log`). The persistent per-export
review rule prevents that last case. All are included in the 152 passing result.

An intermediate lint run reports zero errors and the same eight existing warnings.
Earlier storyboard refactor failures are retained: an over-escaped MP4 regex was
corrected; the concurrency fixture now expects preparing during speech and awaits
its released work in finally. No assertions about encoded files, CI, integration,
installed acceptance or owner art approval are made by these unit results. Next:
full local gates and actual Windows UI-to-FFmpeg both/partial/retry proof.

## Real ordinary export and reachability checkpoint

At 214ac5d, full Windows widget Jest executes 4,275 passing tests across 307
suites, with 19 tests/six suites skipped (127.736s). The late-exit warning is
followed by exit 0 on its own; no runner was stopped. Development build passes.
Root Jest then catches the new review helper outside the Studio-owned directory:
226 passed/one failed. Moving it to `main/movie/studio-export-review.ts` restores
all 227 root tests without changing the boundary guard (5.763s).

The first real Make the video click never starts an export: the image-generator
setup prompt incorrectly blocks saved image/plain-background input. Two new unit
regressions fail before the correction; all four render-action cases pass after,
including the positive control that new scene images still get the setup prompt.
The setup dialog also squeezed output settings into 25.6 pixels; the actual
Electron regression fails before moving the main content onto a full-width grid
row, then measures 1,114.4 pixels within the same 1,144.8-pixel card.

`ordinary-live-second.log`: two actual Windows Electron tests pass in 44.0s,
without retries/skips, using the rebuilt development bundle. Visible Both makes
a 1,280×720 landscape movie while actual placeholder QA rejects a flat centered
720×1,280 portrait crop. Restart retains settings, previous video/player and its
exact review. Change only portrait to Fit and click Retry portrait: its distinct
movie succeeds; landscape bytes, attempt and review stay unchanged. Both decode
fully/play through, run 3s within 0.15s, and wrong-file approval is refused. No
fixture was approved or published. The layout regression passes and screenshots
were inspected. Diagnostic colours/sine audio are not creative acceptance.

Evidence under `.kilo/artifacts/studio-multiple-outputs/`: full-widget-first.log,
root-tests-first/second.log, preflight-red/green.log, setup-layout-red.log,
ordinary-live-first/second.log, and ordinary-live-second-results (JSON, measured
geometry, exact hashes and screenshots). The initial layout-red run establishes
that controls are wide before setup but collapse when it opens; it retains the
same preflight failure, not an additional rendering defect. Types and rebuild
pass. Narrated storyboard Both/restart/input-reuse proof is running next; full
final gates, CI and integration are still unverified. Owner preview is unchanged.
