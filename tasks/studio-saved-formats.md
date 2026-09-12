# Saved Studio output formats — STUDIO-03

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

No format implementation or verification is claimed at this planning checkpoint.
Stage lighting/foreground export parity, revision/freshness workspace, complete
approved pilot and installed-release acceptance remain explicitly open.
