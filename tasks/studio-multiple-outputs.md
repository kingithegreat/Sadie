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
