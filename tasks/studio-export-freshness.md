# Storyboard export freshness and history — STUDIO-04 checkpoint 1

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

Scene-only export history also needs its own source comparison. A red regression
showed that comparing a scene movie with the full-project hash always reported
it stale. History now uses the matching saved-scene revision, without moving
the complete-project pointer. An edit to another scene leaves that comparison
alone. The actual A/B test now selects both complete and scene exports.
Removed scenes remain Unknown, including IDs such as `constructor` that must
not resolve to an inherited JavaScript property. This case has a red-to-green
renderer regression; the dictionary and lookup both use own entries only.

## Final local evidence — frozen source 7c25de3

Production and real Electron test source: `7c25de3eb2d3f1c15cdfeaf53079a90843b227ee`.
Actual main bundle SHA-256:
`a348f208def93d6626c8064e08ac3a54157b425e1ea200d709cce2770908033b`.
Portable metadata: [studio-export-freshness.json](../docs/evidence/studio-export-freshness.json).
Logs, JUnit, screenshots, sidecars and 18 copied MP4s:
`.kilo/artifacts/studio-freshness-7c25de3/`. Source originals are retained.

- Full Windows widget: 4,228 passing tests / 305 suites; 19 skipped tests.
  Uses the CI forceExit setting for existing open handles, not a zero-leak claim.
- Root: 227 passing tests / 18 suites. Both typechecks and Electron build pass.
- ESLint: zero errors, eight existing unrelated warnings. Docs: 217 preload,
  166 renderer-to-main, 33 main-to-renderer. Export guard checks two new files.
- Real Windows Electron: 15 passed, zero failures/skips/retries, 385.343 seconds.
  Includes A/B edits, failed replacement, restart, playback, retry, complete/scene
  history, exact Open/Reveal paths, visible OS-open error, review without approval,
  eight output-format cases, integer/fractional job audio timing, legacy narrated
  caption-on/off replacement, speech privacy and theme regression.
- All 18 archived movies have verified source/copy hashes, matching sidecars
  where present and ffprobe video/audio metadata. Their encoded hashes exactly
  match the preceding 2b469e2 run; the final hardening changes no rendered bytes.

Playback starts, seeks near the ending, then checks ended/no-loop. This is not
continuous viewing of every 66-second movie; storyboard QA separately decodes
each output fully. File actions execute real preload/IPC/path validation, with
only Electron's OS-launch boundary trapped to avoid opening desktop apps.
Interrupted-attempt recovery has a persisted-record unit test; this run does not
kill the app mid-render. Fixtures are diagnostic images, synthetic timing audio
and cached local Kokoro, not an owner-approved episode or provider-art review.
This is a development bundle, not installed-release or full Studio acceptance.

GitHub required checks and merged-content verification remain integration gates.

## Initial CI failure and corrected unit environment

Both initial CI runs at a7eaebf execute 4,185 passing tests but fail to load the
43-case storyboard contract suite. CI downloads Electron after units; the local
binary hid the suite's unmocked settings/native-image imports. A local import
trap reproduces this. Mocking settings alone still exposes image-output's import,
so the correction explicitly supplies the unit suite's settings and Electron
adapter; native image decoding throws if unexpectedly reached. Nothing in the
production renderer, assertions, workflow or branch protection changed.

Test-only commit `3dd1184ad373b694cd59ebffe67298b1224ebe2a` passes all 43 cases,
then 4,228 widget tests / 305 suites (19 skipped) in 106.885 seconds. Typecheck
and lint pass again (zero errors/eight existing warnings). The main bundle hash
above is unchanged; the prior 15 actual Electron cases still cover the exact
production/E2E source. Red, intermediate and corrected logs are retained in the
same artifact directory. Auto-merge was disabled pending corrected-head CI.
