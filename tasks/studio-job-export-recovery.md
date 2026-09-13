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
