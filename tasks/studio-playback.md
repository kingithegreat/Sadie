# Studio playback consistency

Owner: Codex root, with players, animatic and monitor agents. User requested all
reviewed playback fixes from main `79ffc386`.

Acceptance covers one logical transport, explicit voice playback, actionable
native errors, lazy job decoders, accessible stage/review controls, bounded
per-job review volume/resume, narration-locked animatic pause/seek/loading and
timeline fullscreen. Existing clip speed and export audio gain remain unchanged.

Source editing is complete and released to root integration after agent review.
All seven surfaces participate in one logical playback owner, including silent
transports. Native players share accessible errors, retry/open-file actions,
lazy job decoders and bounded per-job volume/resume keyed by output revision.
Animatics follow decoder time, wait for metadata, preserve pause/seek, reject
stale generation/play promises and carry silent timer overflow. Fullscreen has
transport and explicit Escape exit; Electron permits it only for the trusted
main window's top-level app URL. Voice controls remain visible without autoplay.

## Verification checkpoints

- Full widget suite: 377 suites, 4,998 passed / 33 existing skipped tests. Root:
  all 18 suites / 232 passed. This preceded final race/fullscreen corrections;
  hosted CI must qualify the final head.
- After final timer/play guards: 225 affected media tests passed, TypeScript and
  full lint passed (seven existing unrelated warnings, no errors).
- After native fullscreen/Escape correction: 37 permission/monitor tests,
  TypeScript and scoped lint passed; fresh Electron build passed.
- Real Electron: 1/1 passed with zero retries. Native decoders prove exclusive
  playback, voice waiting for Play, visible controls, lazy job selection/source
  release, missing-file errors, fullscreen playback/Escape and narrated animatic
  pause/seek/resume/next/close. Fullscreen and animatic screenshots inspected.
- Unchanged-build A/B reproduced simultaneous advancing voice/video, autoplay
  and collapsed voice controls. An initial harness registration failure was
  corrected before accepting product evidence. Later native tests found denied
  fullscreen permission and absent Escape handling; both now pass.

Evidence under `C:/Users/adenk/.homebot`: `playback-widget-full.json`,
`playback-root-tests.json`, `playback-tests-final.json`,
`playback-baseline-v3-results`, and `playback-escape-results` (live receipt,
diagnostic and screenshots). Intermediate failures are retained.

The isolated runtime is `studio-playback-runtime-20261007`. The live test asserts
fresh HOME/profile/project/AP fixture paths and installs provider fixtures before
IPC registration. Five network-denial positive controls pass; nine background
requests were denied. Local tones and fixture shots prove playback behavior,
not generated speech or artistic quality.

Exact-head hosted CI, configured review, publication and separate launchable
delivery remain root-owned and pending at this source checkpoint. Final landing
evidence belongs in the canonical Drive plan.

Root owns serial guarded tests, build, isolated Electron proof and integration.
The separate runtime uses existing version-matched dependencies read-only; no
owner profiles, media files, model downloads or provider generation are used.
