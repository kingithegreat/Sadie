# FINISH-SHARP-1: native Sharp survives the built Studio export

## Reproduced symptom

On fresh main e4628326, built Electron opens Studio but the first real export fails before any MP4. `movie/text-cards.ts` imports Sharp at module load; widget/package.json did not declare it as a runtime dependency, so Electron Vite bundled its transitive native loader. Rollup replaces the dynamic win32 binding require with an unsupported dynamic-require error. Startup success does not exercise this lazy renderer import.

Before evidence: `.kilo/finish-20260927/recovery-freshness.log`, `recovery-freshness/studio-export-freshness.li-70586-ch-good-movie-after-restart/failure-surface.json` and inspected PNG. The initial harness waited until its 360-second timeout and then hit 60-second teardown timeout; these failures remain retained, with no last-good claim.

## Change

Declare existing locked Sharp `^0.34.5` directly in widget runtime dependencies and the package-lock root entry. The dependency externalization plugin now emits `require("sharp")` and Electron Builder has a declared production dependency to retain. No config bypass, dependency install or shared native rebuild.

## Verification so far

- Raw installed Sharp loads version 0.34.5; @img/sharp-win32-x64 native binary exists.
- Lock root range matches manifest; Sharp and optional win32 package already locked.
- Isolated build exits 0: `.kilo/finish-20260927/sharp-build.log`.
- Before/after built-artifact positive control: `sharp-build-control.json` identifies bundled loader before and external require after; no bundled loader remains in the new main chunks.
- Actual rebuilt Electron export and packaged-installer inclusion remain pending.

The modified freshness spec in this worktree is temporary verification replay from #417, including isolated HOME/AP marker and fast failure on the actual alert. It is not part of the product dependency patch; root decides integration of the separate recovery harness. No owner profile, API key, paid provider or model download.

## Actual built acceptance

Final corrected fixture run: sharp-freshness-home.log, 1/1 PASS, zero retries, 2.8 minutes, exit 0. It exported real originals, injected corrupt-frame failure, preserved prior path/SHA through restart and player advancement, repaired to a new immutable movie, exercised guarded Open/Reveal IPC and scene-only export. A failed intermediate run remains sharp-freshness.log: isolated-home projects were mistakenly a sibling outside the allowed home; the product correctly rejected Open/Reveal. Fixture geometry changed to home/projects; no guard weakened.

Archived originals/replacement and hashes: .kilo/finish-20260927/sharp-media/. Decoded four-frame contact sheet inspected: blue diagnostic first scene and amber diagnostic second scene, each with visible white rectangle. FFprobe reports H264 1280x720, 4 seconds, and AAC 4 seconds. Narration is empty/silent in this proof; no Kokoro/quality-film acceptance claimed. Export freshness screenshot inspected. Source-error fix is proven in the real built app; packaged-installer inclusion remains pending.
