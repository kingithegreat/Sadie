# FINISH-VOICE-CANCEL-1: voice Stop and Close cancel their microphone session

Base: `e4628326`. Author: Codex. Date: 2026-09-27 NZ.

Voice conversation previously stopped text-to-speech but kept microphone
capture running. A delayed transcription after the Close button could still
submit a chat message. Stop during settings lookup or microphone permission
could also let recording begin afterward. Legacy Windows dictation had no
cancellation IPC. The Whisper recording helper delivered its controller before
starting the recorder and installing cleanup, making immediate cancellation
ineffective.

Baseline reproduction: **8 tests failed, 1 positive control passed**, across the
new component and recording suites. The Close-button case submitted `After
close`; the permission-race case showed the mocked microphone track was still
active; the other failures proved missing cancel calls and late capture startup.

Stop, Close, Escape, backdrop dismissal and unmount now invalidate the session.
Whisper uses the existing cancel controller to stop the recorder and release
its microphone tracks, including a controller arriving after permission resolves.
The recording helper installs cleanup and starts before delivering that
controller. Late recognition/status callbacks cannot affect a newer session or
submit text. Stop speaking also prevents an awaited continuous-mode completion
from restarting the microphone.

Windows dictation now retains each renderer's exact PowerShell child. Its new
stop IPC terminates only that child; replacement capture and renderer destruction
also release it. A failed kill reports failure, rejects new capture until the
old one stops, and cannot turn cancelled text into a successful result. The
existing local SAPI script and 20-second process timeout remain. No process-name
kill, online recognition or credential access was added.

Reachable path: existing voice panel microphone -> capture -> Stop/Close ->
Whisper controller or `stopSpeechRecognition` preload -> registered
`homebot:stop-speech-recognition` main handler. The actual main registration is
covered by the existing IPC-registration suite, not only the new module tests.

Validation:

- Final focused run: **45/45 tests**, 6 suites, no skips or retries: component
  cancellation/positive capture, asynchronous permission and track cleanup,
  speech helpers, SAPI child ownership/cleanup/failure handling, existing
  Whisper Online-off/privacy behavior and actual application IPC registration.
- Widget `tsc --noEmit`: exit 0.
- ESLint on changed production/test files: exit 0.
- Root `docs:write` and `docs:check`: in sync (248 preload methods, 183
  renderer-to-main channels, 33 main-to-renderer channels).
- `git diff --check`: exit 0.

Verification level: real React component and registered IPC code with mocked
microphone/MediaRecorder and child processes. The permission-race test inspects
track stop and AudioContext cleanup, not just a controller callback. No actual
microphone, Windows speech profile, provider, model download or paid request was
used. Full suite, packaged Electron and real microphone acceptance remain with
the coordinating root agent. Active CPU transcription can finish after Stop,
but the microphone is already released and its result is ignored.

Current-main integration — 28 September 2026: original PR head `3cfe08b6` was merged with main `f649175f` after the Settings save and FFmpeg fixes, without conflicts. The voice implementation remains the PR delta; IPC and preload changes were inspected after automatic merging. Seven focused Windows suites pass 60/60 tests with a clean process exit, widget typecheck and normal production build pass, lint has zero errors (seven existing warnings), root `docs:check` reports 248 preload methods in sync, and `git diff --check` passes. The tests use mocked microphone and SAPI processes; real microphone and packaged voice acceptance remain open. Current-head CI is required before merge.
