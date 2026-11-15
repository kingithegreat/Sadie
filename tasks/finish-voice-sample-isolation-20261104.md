# Voice sample isolation — 4 November 2026 NZDT

Task: CORE-5 / Studio animatic playback in the current Drive finishing plan.
Base: main `058f88c723b6ff8677b1080f1479e5706c4b3f58`.
Branch: `claude/finish-voice-sample-isolation-20261104`.

## Reproduced defect and change

Media Studio's voice Sample button and Storyboard → Play Animatic both call
`ttsSampleVoice` → `homebot:tts-sample-voice` → `renderNarrationToFile`.
The IPC handler requested a timestamped MP3 under the shared temp directory.
The installed msedge-tts 2.1.0 implementation instead writes `audio.mp3` in
that directory, so generating a second sample overwrote the first file.
The regression read the first returned path after generating a second sample:
expected `First shot narration.`, received `Second shot narration.`
This is a reproduced file-content failure, not a claim about the historical
animatic-start failure on Aden's Windows machine.

Each request now owns an OS-created unique temporary directory. Successful
files stay available to their existing player; failed requests remove their
own partial output and return the original error. The IPC shape, engine
selection, speech privacy checks and narration decoder clock are unchanged.
No renderer or other owner-held PR implementation was replaced.

## Evidence

Verification level: IPC integration with stubbed synthesis and actual local
filesystem operations; renderer unit tests and compilation. No live provider.

- Original test against unchanged handler failed on the first sample bytes.
- Regression covers concurrent Edge/Kokoro fixed-filename outputs with a frozen
  timestamp, returned-path distinction, retained bytes and engine/voice forwarding.
- A failed partial output is removed; original Online-off error is preserved.
- Root: 18 suites / 233 tests passed.
- Focused pre-final tests: 5 suites / 103 tests passed; later concurrency/cleanup
  cases are included in the final widget run recorded below.
- Widget TypeScript, ESLint and Electron build passed. ESLint retains existing
  React hook warnings; the build retains existing dependency/chunk warnings.
- API docs in sync (290 preload methods, 258 R→M, 38 M→R); all 14 mirrored
  skill files match; whitespace check passed.

Full widget run on Linux/Node 24: 460 suites passed, 6 failed, 19 skipped;
6,131 tests passed, 18 failed, 78 skipped (485 suites total). All five relevant
speech/IPC/renderer suites passed with the final changes: 105 tests, including
13 IPC registration tests. This is not a green full-app qualification.

Unchanged-main comparison of the six failing suites: 115 passed / 15 failed
in four suites; every baseline failure also failed in the full changed run.
They cover Windows-only setup, Windows absolute paths on Linux, unavailable
network-interface enumeration and URL-opening behavior in this host. Three
additional full-run timeouts (URL opening, shell rejection and feed retrieval)
passed on the changed-source isolated recheck. That recheck had 92 passing
and 3 failing tests; URL/exec outcomes remain environment-sensitive, and are
not silently counted as fixed or green. No unrelated test was weakened.
Local detailed JSON/logs: `widget/.kilo/verification/widget-jest.json`,
`widget/.kilo/verification/timeout-recheck.json` and the unchanged-main
`homebot/widget/.kilo/verification/main-baseline.json` (private scratch paths).
The tracked result summary is this receipt; these generated logs are not
repository source or user-profile data.

GitHub draft PR #503 initially published the source at `46f72e2457448b6b0dbc65d97884addd4e155b30`.
`git ls-remote` confirmed that head and the fetched tree matched the local
committed source exactly. Draft=true and auto_merge=null were read back.
This receipt follow-up triggers normal existing CI on the final head; hosted
Windows/current-head required contexts remain pending, with no merge claim.

## Boundaries and remaining acceptance

The latest Drive choice is local-only Windows installer delivery. #502 remains
draft and owned by its existing Windows finishing lane. This cloud host cannot
inspect that local tree or install and exercise its Windows candidate.
No installer uploaded, Windows profile changed, live speech/model request,
paid call, Pro bypass, AP/rig/art change, signing, merge or release.
Real microphone/listening, actual entitled Pro, fresh Windows and complete
Leila/Flappy episode acceptance remain open. Other drafts #500/#501 and parked
#413 retain their owners and holds. Branch-protection API returned 403 to the
integration; no merge readiness is inferred.
