# Saved Studio output formats — STUDIO-03 checkpoint 1

Owner: Codex following Aden's Studio handoff. Base: main `8a8372f` (#318).
Existing acceptance: https://app.notion.com/p/3d6829ebf7be8196973af95a4365f965.
Claim: https://app.notion.com/p/3d9829ebf7be818d9e4ed4d1b5f409bb.

## Contract and checkpoints

Extend `shared/media-output.ts`, not another renderer. Persist a versioned
output specification with duration intent independent of picture shape,
validated dimensions/frame rate, fit/pad or crop framing and selected variants.
Keep the existing caption setting authoritative. New productions default to
landscape; missing legacy fields retain prior job/storyboard geometry.

First checkpoint: one selected output reaches creation/editing, actual IPC,
saved jobs/storyboards, both FFmpeg paths, captions and QA. Portrait and square
are not accepted merely because the stage preview has buttons. Bound dimensions
and reject unsupported settings before changing files. Keep reviewed/approved
and in-flight jobs protected. Explicit multi-output and per-variant recovery
follow as another verified checkpoint; do not silently duplicate a render.

Next: distinct variant IDs/paths/status, explicit both with honest time/cost
guidance, source/audio reuse, per-variant framing and partial-failure proof.
The full STUDIO-03 matrix includes short/long crossed with landscape/portrait,
legacy, chat/podcast, save/restart and malformed settings. Verify encoded pixels
and playback through the real app, not only mocked arguments.

## Source observations

- `media-render.ts` maps job `short/long` directly to portrait/landscape.
- `tools/media.ts` uses that mapping for images, FFmpeg and expected QA size.
- `storyboard-renderer.ts` hard-codes 1920x1080 in motion/static filters and QA.
- Storyboard naming/reload assumes `-1080p.mp4`; a format must have durable
  identity that survives restart, not only a different filter string.
- `MediaStudioPanel.tsx` stage ratio is local preview state. Its existing
  doctor handler belongs to `claude/preview-settings-doctor` and is untouched.
- Chat and podcast creation both flow through the same job creation boundary.
- External Ancient Pathways has its own renderer; do not imply options reach
  it when its actual bridge cannot accept them.

## Local implementation checkpoint

Strict format validation and controlled UI now reach new jobs, existing editable
jobs and storyboard save/render. Both FFmpeg paths take the saved geometry,
frame rate and fit/crop. New-spec exports use unique filenames and immutable
settings sidecars. Storyboard exports get distinct review records and reopen
through the project's latest-success pointer. Legacy exports retain their prior
geometry and naming; external renderer settings remain explicitly unsupported.

- Red contract checkpoint `4878d22`: 17 missing-behavior failures, two controls.
- New storyboard round-trip cases: three failed before handler wiring; all 32
  passed afterwards with a simulated encoder.
- Five focused suites: 98 tests passed, TypeScript clean, Electron build passed.
- First actual Windows Electron case passed without retries: four seconds,
  1280x720 H.264, 30 fps/120 frames, SAR 1:1, fit framing. The diagnostic square
  marker retained its proportions; restart reopened the same video and review
  record, and playback reached its end without looping. SHA-256:
  `809782be8cc2928dd62f767ae515646fbebb5f5ddeee4aa32d563f90c5d6cde2`.
  Evidence: `.kilo/artifacts/studio-formats-first/` (local retained fixture).

The eight-case encoded matrix passed without retries in 5.1 minutes; portable
measurements/hashes are in `docs/evidence/studio-output-formats.json`. It covers
4s/66s landscape/portrait 720p fit, square 720p crop, landscape/portrait 1080p crop
and square 1080p fit. All eight survive restart and play to their ending.

The full widget suite initially found one stale new-project fixed-filename
assertion. Its replacement verifies actual crop motion and immutable metadata;
the rerun passed 4211 tests. An additional real ordinary-job test then caught
3-second input producing 4.1 seconds of video. New-format job export now measures
audio length before generation, uses it for the timeline and encoder duration
cap (one frame of headroom), and rejects QA drift over 0.15 seconds. Three unit
expectations failed before this change; the 91 related tests pass afterwards.
Actual corrected outputs: 3.0s input → 3.0s video/audio; 3.49s input with a rounded
3s job label → 3.5s video/audio, without cutting the source. These and the theme
check pass without retries, with retained artifacts under
`.kilo/artifacts/studio-formats-timing/`. The original failing output is retained.
The portrait/captions-on fractional-audio case also passes: 720x1280, clear caption
side margins and no clipped speech. Full widget verification on the correction:
4212 passed, 19 skipped, 305 passing suites. TypeScript, lint (eight existing
warnings, no errors), and the rebuilt Electron app pass.
FFmpeg output-duration semantics: https://ffmpeg.org/ffmpeg.html#Main-options.

Final combined verification on `a49c1a8` passed all 14 actual Electron cases in
7.4 minutes, without retries or skips. Eight saved formats, both ordinary-job
duration cases, paired legacy captions, Online-off voice preview and theme UI
all pass. The eight format hashes and both legacy caption hashes are unchanged.
All 12 generated MP4s are archived under
`.kilo/artifacts/studio-formats-final/exports/`; source and copied hashes match.
The geometry playback check starts the reopened file, then seeks near its end
and asserts ended/no loop; the storyboard QA separately decodes the whole file.
Both typechecks, root 227 tests, docs parity and positive one-file export guard
are green. Remote CI/merge is the next gate, not yet asserted by this local proof.

The real geometry test
uses deliberately unnarrated diagnostic cards; the separate caption test covers
actual local speech. Neither is approval of a creative pilot or installed release.
Stage lighting/foreground export parity, revision/freshness workspace, complete
approved pilot and installed-release acceptance remain explicitly open.

Checkpoint 2 will handle explicit multiple outputs, reuse and independent
failure/retry status. Storyboard source-image generation also still uses its
existing generation size; selected fit/crop reaches export, not every provider's
source-generation geometry. Keep that distinction visible until verified.

## Merged checkpoint

PR #320 merged 2026-09-12 23:17:02 UTC as
`afc4cae374ea296755d63372df7f17afb6781af1`. Its full tree matches tested/published
`f67826ba6576b9b3ebc31456578f843efcb511d9`:
`15d4fc58fc57487aba8ca79b13fa9cef30522176`. All six required contexts were
present/green under live strict protection and the expected GitHub Actions app.
Windows CI executes 4212 widget/227 root/13 overlays. Every platform's matrix
executes 23 + 22 + 11 passing tests with 12 deliberate opt-in media skips;
no flaky/retry result is reported. The actual-media proof is the separate local
14-case run above, not those skipped CI cases.

The checkpoint claim is released. The master records a dependency adjustment:
STUDIO-04 source-revision/latest-attempt/previous-good visibility comes before
explicit multi-output retries. This does not remove any remaining STUDIO-03/05,
full approved pilot, owner visual or installed-release acceptance requirement.

Read-only device inventory: Windows 11 Home build 26200, RTX 2050 4096 MiB VRAM,
driver 610.62, 16866664448 bytes system RAM. Current Updated Preview launches
the separate `codex-preview-repairs/widget` build with `.kilo/profiles/ui-preview`,
not this checkout. Its media-tool fingerprint is present but the new format
validation fingerprint is absent. The running app, shortcuts and profile were
not changed. Standard local Programs/uninstall records show no HomeBot/Sadie
installation; this is not an exhaustive portable-install search or peak-resource
measurement. Keep the final launch/install acceptance separate.
