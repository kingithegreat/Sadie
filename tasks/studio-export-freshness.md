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

## Storyboard checkpoint implementation

Source identity hashes ordered saved shots, timing/text/framing, actual image
bytes, output/caption/motion choices and the requested narration engine. No-op
saves leave the content revision alone. Images are copied per attempt; later
edits cannot silently alter its source. Attempts are independent of successful
outputs and incomplete attempts are recovered on reopen. Duplicate attempts in
the same app are refused. Cross-process scheduling remains a separate concern.

All new storyboard exports, including legacy projects, have immutable filenames
and review identities. Exclusive file creation protects a name claimed during
rendering. Legacy encoder geometry/captions stay unchanged. Unknown old files
stay reachable with unknown provenance; malformed sidecars cannot invent it.
The preview shows saved/unsaved source versus the selected export, attempt/error,
times, dimensions, duration, size, history and Open/Reveal/Review. Open now uses
the existing local-file IPC rather than the web-only opener; OS errors propagate.

First real A/B green: `.kilo/artifacts/studio-freshness-surface/`, 54.2 seconds,
zero retries. Two earlier navigation/screenshot timeouts are retained separately.
This is a storyboard checkpoint, not all STUDIO-04: ordinary job history and
freshness remain next, along with the already recorded multi-output/stage/UI/
pilot/installed gates. Final unchanged-source regression evidence follows.

Final review found a reachable legacy-card mismatch: its new MP4 has a recorded
landscape spec, but the review job omitted it and the card inferred portrait
from a short duration. A red handler assertion reproduced this. The bridge now
passes the actual output spec into the review record and IPC response; it does
not change the saved legacy project or encoder filters. The local narrated
caption pair additionally checks that exact review geometry.
