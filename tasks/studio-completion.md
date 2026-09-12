# Media Studio completion takeover

Owner: Codex, requested by Aden on 2026-09-12. Branch `claude/studio-completion`
started from main `935fb4a` in its own worktree. Original #271 speech/export
worktrees and active workspace-unification work are preserved.

## Narration and export recovery

Recovery source: `claude/studio-narrated-export` at `5cc888d` (#271). Its shared
speech consent checks, Kokoro compatibility adapter, export validation, saved
movie recovery and playback are reconciled with main's newer speech code and
canonical `storyboard-assembly.ts` from #299. No stale manifest read path is
restored. The existing default voice Sample action is visible before online
voice discovery succeeds.

The output validator uses the actual speech file returned by the selected
adapter, pads short narration to each shot, rejects narration that would be
cut off, validates every frame and duration, decodes the full final file, and
stages replacement until tracks/dimensions/duration/audio checks pass. Failure
preserves the previous movie. The UI releases Windows media handles before
replacement and recovers the saved player after reopening.

### Reproduced and verified on Windows

- Before the speech repair: 13 privacy failures, 1 allowed-speech control pass.
  After: 46 tests across four speech suites pass.
- Before export recovery: 18 output-contract failures, 1 intentional-silence
  control pass, using canonical saved shot files. After: 38 main storyboard
  tests and 12 renderer storyboard tests pass.
- Fresh-profile real Electron Sample/voice-discovery privacy test: 1 pass,
  no retries, 25.5 seconds; five transport controls then zero speech requests.
- Real cached Kokoro: 5.5-second 24 kHz mono WAV, RMS 0.0651423, zero observed
  requests, 7.662 seconds; empty-cache check fails locally with zero requests.
- Real Electron Studio export/restart/replacement test: 1 pass, no retries,
  1.3 minutes. H.264/AAC 1920x1080, 30 fps, 8.000 seconds, 131760 bytes.
  SHA-256 `1c810b1f215cba5e1bf905dad64ff081cce51daadbf6be860f54d92e63bcb314`.
  Speech/silence/speech RMS: 0.08743 / 0 / 0.08693. Sampled frames and burned
  captions inspected. Restart decoding/playback, failed-replacement byte
  preservation, and replacement with a loaded player pass.

Tests: `speech-privacy.test.ts`, `kokoro-loader.test.ts`,
`narration-engine.test.ts`, `voice-tools.test.ts`,
`storyboard-export-output.test.ts`, `storyboard-renderer.test.ts`,
`media-storyboard-tools.test.ts`, `media-studio-storyboard.test.tsx`,
`speech-privacy.e2e.spec.ts`, `storyboard-export.live.e2e.spec.ts`.

The live export is opt-in with `HOMEBOT_STUDIO_EXPORT_LIVE=1` and installed
`HOMEBOT_FFMPEG`. `HOMEBOT_KOKORO_TEST_CACHE` can point the standalone speech
check and Electron fixture at an already-prepared isolated model cache. These
checks never download models. The separate preparation in this session was
explicitly network-approved and changed no owner settings/shared dependencies.

### Remaining acceptance

The full Windows widget run passes 301 suites / 4135 tests (19 existing/opt-in
skips); root passes 18 suites / 227 tests. Both typechecks, build and docs pass;
lint has zero errors and eight existing warnings. Durable Git checkpoint and
required remote checks are pending at this entry. This two-shot authored-card test proves
mechanics, not a full episode, two-scene ending, generated-art quality, all
aspect ratios, installed release, publication or owner visual acceptance.
Continue the existing Notion STUDIO-01 through STUDIO-05 queue after recovery.
