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

No build, real FFmpeg, Electron, provider/model/voice call, download or AP action
was performed. Actual encoded corruption acceptance remains pending root's
coordinated lane. Root owns publication/integration and nearby ART #430 changes.

Landed image-cost main `c3d8c787` was merged without conflict after this first
verification. The helper/real ordinary handler/background-authority integration
subset passes and widget typecheck passes again. Only this task's two-line
output validation call differs in `media.ts`; authoritative paid/privacy denial
propagation remains intact. Log: `decode-cost-integration.log`.
