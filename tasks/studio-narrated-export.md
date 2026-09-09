# Narration privacy and saved storyboard export — HB-M2

Branch: `claude/studio-narrated-export`, from main `e408384` (#269).

## Reachable behavior

Studio's default **Sample** button now remains visible before online voices have
loaded. Edge metadata, voice listing, synthesis, retries and Kokoro-to-Edge
fallback require the existing persisted Online consent. System speech fallback
selects only explicitly local voices. A caller cannot grant consent through
speech arguments.

Kokoro uses cached CPU/q8 resources while Online is off. Both its model and
tokenizer receive `local_files_only`; missing resources produce setup guidance.
The installed `kokoro-js` 1.2.1 convenience loader drops that option, so a small
adapter constructs the model using Kokoro's own Transformers runtime. It avoids
mixing different Tensor classes and never changes global network policy.
Remove this compatibility adapter when the installed provider forwards per-load
options, retaining the offline transport and real speech regressions. Codex owns
this compatibility checkpoint.

**Studio → Storyboard → Render Movie → registered Studio IPC/tool → configured
speech adapter + managed FFmpeg → saved MP4 → in-app player** is the export path.
The main tool reads the same saved shot files as Studio, including scene order,
removed shots, edited narration/duration and current image files. The initial
director manifest no longer overrides those edits. Older manifest-only scenes
remain supported.

Export requires every image, valid shot timing and real non-silent narration
for each spoken shot. It uses the speech adapter's returned WAV/MP3 path, pads
short speech to the shot boundary and rejects speech that would be cut off.
It renders into a temporary directory on the destination filesystem, fully
decodes the result and checks tracks, 1920×1080 dimensions, total duration and
narration level before replacing the previous movie. Intentional silent shots
remain valid. Codec/level checks do not constitute a speech intelligibility or
creative-quality evaluation.

Reopening a project recovers its existing export path and displays a **Saved
movie** player. This label refers to a saved file, not new QC or publication
approval. Before re-export, the player releases its Windows file handle; a
failure restores the previous player and preserves the previous movie.

## Reproduced defects

- The existing main voice implementation failed eight restricted-speech cases
  while the explicitly allowed case passed. The new export contract failed
  18 cases while the intentional-silence control passed. The same source files
  were restored byte-for-byte before final verification.
- The first actual Electron export produced an 8-second movie, but reopening
  Studio lost its control even though the movie remained on disk.
- After reopening was fixed, the next real UI test saved a 1-second shot and
  tried to render its longer narration. Export incorrectly succeeded using
  the original 4-second manifest. Its trace and stale manifest were retained.
  The fix uses the canonical saved board through the existing tool seam.

## Verification

- Full Windows widget Jest: **278 suites / 3,907 tests passed**, with 5 suites /
  15 existing tests skipped and the existing CI force-exit setting. Root:
  **18 suites / 227 tests passed**. Both typechecks, build and docs pass; lint
  has zero errors and eight existing warnings. The first sandboxed widget run
  was stopped after fixture permission errors; the normal-access run passed.
- Both actual Electron speech/export cases pass without retries in 4.4 minutes.
  The final MP4 is 131,760 bytes, H.264/AAC, 1920×1080, 30 fps, 8.000 seconds.
  SHA-256: `1c810b1f215cba5e1bf905dad64ff081cce51daadbf6be860f54d92e63bcb314`.
  Sampled speech/silence/speech RMS: 0.08743 / 0 / 0.08693. The two frames and
  restored player were visually inspected. Restart playback, failed replacement
  byte preservation and successful replacement with a loaded player all pass.
- Standalone cached Kokoro produces a 5.5-second 24 kHz mono WAV, RMS 0.06514,
  in 8,918 ms on Windows / Node 24.13.0. Cached and empty-cache runs observe zero
  requests after all five transport controls. This is one local measurement,
  not a performance guarantee.
- Redacted measurements: `docs/evidence/studio-narrated-export.json`. Raw traces,
  sample frames, WAV and `demo.mp4` are retained locally under
  `.kilo/artifacts/studio-narrated-export/` in the integration worktree.

Latest-main integration, the complete Electron suite and remote checks remain
pending at this implementation checkpoint.

Committed regression paths:

- `widget/src/main/__tests__/speech-privacy.test.ts`
- `widget/src/main/__tests__/kokoro-loader.test.ts`
- `widget/src/main/__tests__/narration-engine.test.ts`
- `widget/src/main/__tests__/voice-tools.test.ts`
- `widget/src/main/__tests__/storyboard-export-output.test.ts`
- `widget/src/main/__tests__/storyboard-renderer.test.ts`
- `widget/src/main/__tests__/media-storyboard-tools.test.ts`
- `widget/src/renderer/__tests__/media-studio-storyboard.test.tsx`
- `widget/src/renderer/e2e/speech-privacy.e2e.spec.ts`
- `widget/src/renderer/e2e/storyboard-export.live.e2e.spec.ts`

From `widget`, standalone offline verification:

```powershell
node scripts/check-speech-offline.cjs
node scripts/check-speech-offline.cjs --empty-cache
```

The actual local movie test is opt-in because it requires installed FFmpeg,
ffprobe and cached Kokoro resources. It never downloads them. Ordinary CI runs
the speech UI test and the export failure contracts; its explicit live-test
skip must not be described as live media generation on CI.

```powershell
$env:HOMEBOT_STUDIO_EXPORT_LIVE = '1'
$env:HOMEBOT_FFMPEG = 'C:\ffmpeg\bin\ffmpeg.exe'
node node_modules/@playwright/test/cli.js test speech-privacy.e2e.spec.ts storyboard-export.live.e2e.spec.ts --retries=0 --trace=on
```

The local fixture uses two authored image cards with HomeBot's repository icon
and real CPU-generated speech. It proves visible frames/captions, timed audio,
file decoding, restart playback and replacement behavior. It does not prove
live AI image/video generation, Ancient Pathways character animation, a full
episode, Shorts, fresh installer behavior, human voice preference or the full
M2 pilot. No provider credentials, paid calls or publication were used.

## Integration provenance

Aden authorized completing the existing speech/export work together. Source
snapshots came from `codex-speech-privacy` at `1e3b064` and
`codex-studio-export` at `a88404a`, including their uncommitted implementation.
The new branch started from fresh main rather than either unfinished branch.
Both original worktrees and the concurrently owned lazy-runtime/YouTube work
were preserved. The integration adds the missing settings type, saved movie
recovery/player and canonical saved-board export connection.
