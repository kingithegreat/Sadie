# Provider output trust: render QA fail-closed repair

Status: locally verified bounded repair on `claude/media-qa-trust-fix`.

## Scope

This task repairs the credential-free QA boundary in
`widget/src/main/tools/media.ts`. It is one component of Media Studio task 2
(provider correctness). It does not complete provider validation, run a live
provider, replace a media engine, publish a video, or prove that HomeBot can
produce a playable MP4 end to end.

## Defect and user-visible consequence

After `media_render` wrote `video.mp4`, an exception from `inspectRender` was
converted to `qa.ok = true`. The handler returned success and persisted the job
in `render_qa`, even though duration, streams, dimensions, and loudness had not
been measured. From there the routine advance tool could move the unmeasured
artifact into `awaiting_approval`.

The existing failed-QA branch also attempted the illegal state transition
`media_production -> needs_revision`. A measured QA rejection therefore fell
into the outer render error handler before persisting `renderPath` or the failed
state.

## Repair

- A thrown QA inspection now creates a failed verdict with the adapter error in
  the failure text.
- Rendering is recorded in memory as `render_qa`, then a failed verdict is
  immediately transitioned to `needs_revision`; only that final state is
  persisted.
- The rendered file remains on disk and `renderPath`, `narrationPath`,
  `captionsPath`, and existing `scenePaths` remain on the job.
- A job in `needs_revision` cannot advance directly to `awaiting_approval` and
  cannot be approved. No deletion, automatic approval, provider call, or
  publication was added.
- A successful measured QA verdict keeps the prior `render_qa` behavior and
  still reports non-blocking warnings.

## Reproduction and verification

The regression test invokes the real `media_render` tool handler and uses
the real JSON store and temporary filesystem. FFmpeg rendering and inspection
are mocked at the external adapter boundary. The render mock writes a 12,000
byte stand-in file so preservation and persisted paths are checked on disk; it
is not an actual MP4.

Before the repair:

- `media-render-qa-trust.test.ts`: 1 failed, 1 passed.
- The failing case expected a rejected result but received success after the
  inspection adapter threw `FFmpeg inspection timed out`.
- Evidence: `.kilo/evidence/qa/qa-trust-red.log` (also copied to the disposable
  `widget/test-results/qa-trust-red.log`).

After the repair:

- `media-render-qa-trust.test.ts`: 3 passed (including a measured missing-audio failure).
- The inspection exception persists `needs_revision`, the output file and all
  source paths; both direct approval and advancement to `awaiting_approval` are
  denied.
- The control verifies measured video/audio/dimensions/duration with a clipping
  warning still returns success and persists `render_qa`.
- Evidence: `.kilo/evidence/qa/qa-trust-green.log` (also copied to the disposable
  `widget/test-results/qa-trust-green.log`).
- Related focused suites (`media-render-qa-trust`, `media-qa`, `media-studio`,
  and `media-tools`): 4 suites / 96 tests passed.
- Widget TypeScript: pass (`npx tsc --noEmit`).
- Focused ESLint: pass for the handler and regression file.

Full Windows verification on 2026-09-09 (local time): widget 265 suites /
3,685 tests passed, 15 tests skipped, exit 0 with the existing CI `--forceExit`
command. Root 17 suites / 219 tests passed. Root/widget typechecks, Electron
build and docs check passed; full widget lint has zero errors and eight
pre-existing warnings. Logs and JSON reports are in `.kilo/evidence/qa/`.
Required remote checks and merged-content verification remain pending.

## Remaining acceptance work

An actual FFmpeg render and inspection, live provider outputs, sampled video
frames/audio, privacy routing, and full Task 2 provider acceptance remain
unverified. Those require their own configured/runtime evidence and are not
implied by this mocked-adapter regression.
