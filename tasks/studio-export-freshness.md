# Studio export freshness and attempt identity — STUDIO-04

Owner: Codex following Aden's remaining-Studio handoff. Fresh base: main
`afc4cae` (#320). Claim:
https://app.notion.com/p/3d9829ebf7be819f9894c0170ac20c08.

The existing master/acceptance plan now brings this foundation ahead of explicit
Generate both: a failed variant retry needs stable source/attempt identity.
STUDIO-03's remaining requirements are not removed or marked complete.

## Existing seams and contract

- Shared `media-output.ts` already holds saved format and actual export metadata.
- Job rendering persists successful output; storyboard rendering writes a spec
  sidecar and latest-success pointer. Neither records a complete latest attempt.
- The panel retains `renderedMoviePath` after edits/save but has no current-source
  revision comparison or visible previous-success/latest-failure label.
- Reuse existing job/storyboard storage, file/open/review and guarded IPC paths.
  No new renderer/framework, provider, paid service or publication authority.

Add stable source identity, durable attempt status/error, interrupted-run recovery
and output history. The workspace must show current saved/unsaved source versus
the exact displayed export, with time, size, duration and real Open/Reveal/Review
actions. Existing provenance remains Unknown when it cannot be established.
New exports must preserve previous/approved files, including safe legacy handling.

## Verification before completion

Reproduce before wiring: edit a saved movie, fail its replacement, restart and
prove that the previous good file remains playable but is not labelled current.
Cover no-op save, changed source asset, project A/B and late async completion,
per-export identity/history, legacy data, interrupted attempts, permissions and
privacy. Use actual Windows Electron/FFmpeg plus focused and full local gates;
then all required CI and exact merged-content verification.

Preserve separately claimed preview-settings-doctor edits, its running app and
profile, all original projects/assets, and the pending full pilot/installed/owner
visual acceptance gates. No product changes existed at claim time.

## Red evidence before implementation

On merged #320, three new handler tests fail on missing source revision,
attempt/history and changed-asset/interruption state (32 existing pass).
The real Windows Electron/FFmpeg test fails after saving a duration edit because
`Preview out of date` is absent. Its positive control hashes the previous good
MP4 before/after save: the file survives but the workspace misrepresents freshness.
Evidence: `.kilo/artifacts/studio-freshness-red/`; fixture profile
`homebot-freshness-proof-1qeFT7`. No providers or online speech were used.
