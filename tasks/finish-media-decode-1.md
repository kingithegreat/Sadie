# FINISH-MEDIA-DECODE-1 — ordinary exports require complete decoding

Fresh branch/worktree `claude/finish-media-decode-1` from main `4d5f4b39`.
Open-PR ownership checked before claim and edits; no competing ordinary decode fix.

## Reproduced and corrected

Normal Studio **Make the video** reaches `homebot:media:run`, `media_render`,
`renderMediaJobAttempt`, output inspection, then immutable output promotion.
`inspectRender` deliberately tolerated FFmpeg errors when metadata was parseable.
That behavior remains unchanged for audio-only callers, but was insufficient to
prove a whole output movie decodes. The source callback control returned QA pass
for healthy, decoder-exit-1 and timeout conditions with readable metadata and
five good sampled frames; see `ordinary-decode-callback-evidence.json`.

Two real-handler/store controls failed before the correction: decoder nonzero
and timeout still returned export success. An initial quoted test filter ran no
tests; it was rejected as evidence, and a corrected single-word filter executed
both negative cases (`decode-baseline-matched.log`, 2 failed).

The output-only helper `validateCompleteMediaDecode` runs FFmpeg with `-xerror`
and explicit first video/audio stream maps to the null sink. It uses a five-minute
timeout, 64KB subprocess output buffer, hidden Windows process, and bounded
1536-character diagnostic excerpts with code/signal retained. These limits were
coordinated with the separate Storyboard FFmpeg failure repair; no Storyboard
subprocess implementation is changed here.

The ordinary handler invokes this gate before output inspection/QA/promotion.
A decoder failure follows the existing rejected-file path: staged rendering
files are removed, failed attempt saved, prior movie/path/hash preserved. A
healthy complete decode still promotes the immutable output. No source-picture,
audio-only inspection, provider, encoder, privacy or payment behavior is changed.

## Verification

Eight targeted helper, ordinary handler, audio inspection, encoder-argument,
tool-reachability, IPC and renderer suites pass **185/185 tests**, exit 0,
37.6 seconds. Widget typecheck passes; full widget lint has zero errors and seven
existing warnings. Logs in shared ignored `media-diagnostics/decode-targeted.log`
and `decode-lint.log`. Handler controls cover nonzero/timeout despite good facts,
previous movie SHA256 preservation, failed status, retained rejected file and no
remaining staging file. Helper controls cover healthy full-stream arguments,
nonzero, timeout and output-buffer failures with bounded diagnostics.

This initial unit checkpoint used no build, real FFmpeg, Electron, provider,
model/voice call, download or AP action. Root owns publication/integration and
nearby ART #430 changes.

Landed image-cost main `c3d8c787` was merged without conflict after this first
verification. The helper/real ordinary handler/background-authority integration
subset passes and widget typecheck passes again. Only this task's two-line
output validation call differs in `media.ts`; authoritative paid/privacy denial
propagation remains intact. Log: `decode-cost-integration.log`.

## Actual artifact and built ordinary UI proof

Real FFmpeg helper control (`decode-real-control.cjs`) passes healthy authored
six-second NVENC movie bytes, then rejects a precisely corrupted copied H264
packet at one second. Corruption preserves readable MP4 metadata, both streams,
six-second duration, 1280 x 720 picture, and all five sampled frames (variation
63.97). The unchanged original inspector still reports QA pass on these actual
corrupt bytes; strict complete decoding rejects them. No rendering was needed
for that control. Evidence `media-diagnostics/decode-real/evidence.json`:
SHA256 `4e857ddd131b141bfcb94c5bba08d2d8ad973db98db70089e81d93b908a78c57`.
Helper source SHA256:
`8962241ee80d32659d8e019973a1131061c6afc159013e6a1880af9b9a7876f1`.
Healthy movie SHA256:
`06bf2a13c85ca36e77fcaa6537a234598d65b90ce53d09929b0a459c0bf2d40c`.
Corrupt movie SHA256:
`e24a0154a5445eec4f39f1f9779c69237934924fdd7f9f617ff79b42133e2197`.

The actual app build exits 0 at `637c02fe` (production unchanged from the
verified implementation). Main bundle SHA256:
`26908e3313d7d0cab44285f2585b4ce181d66e71dae0b6141287ef5fecb74bd2`.
Normal **Make the video** acceptance passes **1/1, zero retries, 16.9 seconds**.
A fresh HOME/profile contains all projects and a valid disposable AP marker,
explicit empty MCP connectors, Online off and no credentials. An own exclusive
CJS entry loads five positively controlled transport guards before the unchanged
main bundle. Two startup Axios attempts were denied; one local inventory reply
was authored. No actual online/provider/model/voice request or default npx child
was launched.

The healthy ordinary UI export uses the real default encoder selection: NVIDIA
NVENC, H264 1280 x 720, 30 fps, 180 frames, six seconds; AAC audio also six seconds.
Its frozen source hash matches the authored detailed image. Existing real IPC
moves the job back to production. A one-shot filesystem fixture targets only
that exact isolated job's `video.rendering-<id>.mp4` post-encode size check,
restores the original I/O function before copying the corrupt fixture, then lets
the unchanged real handler/decoder run. One match and restored=true are asserted.
Strict rejection persists failure/rejected bytes, leaves no staging file, and
keeps the previous path/hash. The previous player advances beyond 0.2 seconds.
The app closes; the exclusive entry shim is removed.

Evidence directory: `media-diagnostics/decode-live-bootstrap/`
`studio-complete-decode.liv-e78cf-vie-and-preserves-last-good/`.
JSON SHA256 `9155c16ab08b3b379f8df71855ccbd554bb9f69b70724bfb44fe653b9447f2cd`.
Viewed prior movie's start/middle/end contact sheet and actual refusal screenshot.
Contact SHA256 `6d5d923dd78d9e8d25b8d39801d3a6626f7357280cab87c6719c7a3f7dc48fd8`;
refusal SHA256 `8cbb3a7fdf954dcfb9adac6fced2f20eb8e7adaecb9d37efc58a5895b011824d`.
JSON also records source/build/input hashes and exact FFprobe stream facts.

First live run remains under `decode-live/` plus `decode-live.log`: healthy
export passed, but installing the fixture failed because Playwright's main
evaluation scope has no CommonJS require. No corrupt attempt occurred. Moving
the installer into the owned pre-entry CJS bootstrap corrected that harness
boundary; one corrected run passed. No production handler replacement, test
hook or unmerged ART source overlay was used. Actual timeout/buffer rejection
is unit-tested; actual corruption is tested with FFmpeg and normal UI. This is
fixture/technical acceptance, not creative art/voice or installed-release proof.
