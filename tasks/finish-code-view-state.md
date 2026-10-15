# FINISH-CODE-VIEW-STATE-1

The current HomeBot Drive master reopened bounded finishing defects. This change
addresses the documented Code cursor, view and undo reset on Back; it does not
reopen held IDE/provider features. Base: main `d22443b1`, private branch
`claude/finish-code-view-state-20261003`.

## Symptom and change

App keeps WorkspaceShell mounted, but its `open=false` path returns null. That
removes CodeEditor, whose next mount previously created a new EditorState from
the retained text. Two selections, the caret, scroll and undo/redo were lost.
The new real App/CodeMirror regression failed on the original source: selection
ranges `(2,7)` and `(20,24)` became a single caret `(0,0)` after Back/reopen.
The failed run is retained in `.kilo/code-view-state-evidence/baseline.log`.

Each open file now owns an in-memory editor session. On unmount the editor saves
its immutable state, scroll snapshot, offsets and consumed search line. On mount
the state is reconfigured with fresh callbacks and language/read-only/theme
compartments while retaining the history fields. The cursor badge initializes
from the restored selection. The session belongs to the open-file object, so
closing a tab discards it without a cleanup-versus-cache-eviction race.

The editor lifecycle uses layout cleanup to capture scroll while its host still
has a layout box. A consumed search request clears from WorkspaceShell, so Back
does not replay it and a later request for the same line still works.

WorkspaceShell continues returning null when hidden. Its browser detach,
terminal close, assistant cleanup and visibility-guarded shortcuts retain their
existing lifecycle. No editor is mounted at initial app startup, and editor
history is never persisted to disk. No dependencies, provider or IPC changes.

## Verification

- Initial focused source check: 3 suites, 24 cases passed after the reproduced
  baseline failure.
- Expanded final source check: 7 suites, 46 cases passed. Real CodeMirror
  regressions cover Back/reopen selections and scroll plumbing, undo/redo,
  current save/edit callbacks, read-only/theme reconfiguration, A/B/A history
  isolation, tab-session disposal, and consumed/new same-line search requests.
  Existing delayed-save, dirty Close/Cancel, navigation, search and handoff
  cases remain included. Log: `.kilo/code-view-state-evidence/focused-final.log`.
- These jsdom checks do not establish real scroll layout. The broader existing
  navigation-consumer suite also emits jsdom Range geometry and React act
  warnings; the asserted cases pass. Actual layout verification is recorded
  separately below.
- Serialized widget TypeScript `--noEmit` passed (exit 0), and final scoped
  ESLint of the two components and two changed Jest files passed (exit 0).
  Logs: `typecheck-final.log` and `lint-final.log` in the same evidence directory.
- Production `build:release` passed (exit 0; renderer build 37.35 seconds).
  The 74 output files total 5,689,365 bytes. The newly built workspace chunk
  contains `editorSession`, `scrollSnapshot` and `onFocusLineConsumed`; its
  SHA-256 is
  `596757F7EB211E0C75C1F6B0F8906D6907EDC313E3D5E578848D2DDAD1A2802C`.
  Capacity was inspected before allocation: 805,146,624 bytes free.
  Exact metadata: `.kilo/code-view-state-evidence/build-receipt.json`;
  build log: `build-final.log`. `git diff --check` passed (exit 0).

React review checked stable per-file session identity, current handler refs,
cleanup ordering and unchanged lazy entry/visibility guards. No network fetches
or component-wide hidden effects were introduced.

## Actual production-built Windows proof

The coordinator exercised the ordinary production-built editor with a long,
wide disposable file, isolated HOME/profile/CODEX/AP paths and an empty MCP
configuration. This is built-app proof, not installer or package acceptance.
Both JSON receipts were read back before recording the following measurements.

The old built application reproduced the symptom: Back/reopen changed
`Ln 121, Col 173` to `Ln 1, Col 1`, vertical scroll `2116` to `0`, and horizontal
scroll `399.20001220703125` to `0`. Receipt:
`.kilo/code-view-built-baseline-serialized-1791009191827/evidence.json`.

The fixed built application passed all six recorded stages. Its 12-character
selection and `Ln 121, Col 285` caret survived Back/reopen, with vertical scroll
`2490.39990234375` and horizontal scroll `1292.800048828125` unchanged. Real
keyboard undo and Windows Ctrl+Y redo updated the dirty state without implicitly
saving. Dirty-tab Close/Cancel retained the file, Ctrl+S saved exactly the
expected source bytes, and native close exited the owned process. The coordinator
inspected the retained `restored-editor.png` screenshot. Receipt:
`.kilo/code-view-built-fixed-network-options-1791009552219/evidence.json`.

Six transport positive controls executed, including an object-options HTTP
request. The retained network receipt identifies every denied real probe as
fixture-local `127.0.0.1:1` or `127.0.0.1:2`; no forbidden or unknown target was
reported. No real provider, owner project, paid request or owner profile was
used for this editor proof.

Retained limitations and failed attempts:

- The first evidence redirection used a widget-relative directory with a
  root-relative destination and did not launch Jest. The corrected command ran
  the failing baseline above; no zero exit from the first attempt is counted.
- An expanded source run hit the search-flow test's 5-second timeout. Its cause
  is unproved. The final run uses the existing exact result test ID, a 15-second
  allowance for that complete navigation flow, and serialized heavy checks.
  Log: `.kilo/code-view-state-evidence/focused-expanded.log`.
- A parallel TypeScript attempt exited 134 with `Zone Allocation failed -
  process out of memory`; a subsequent shell launch also failed with
  `0xC000012D`. This is a resource failure, not a source typecheck result.
  Log: `.kilo/code-view-state-evidence/typecheck.log`.
- The coordinator's initial built baseline launch timed out after renderer
  `ERR_FAILED`, before reaching the editor; it establishes no product symptom.
  Receipt: `.kilo/code-view-built-baseline-1791008792710/evidence.json`.
- Earlier fixed-build probes remain retained: one reached restored selection
  and scroll but timed out at redo (the coordinator corrected the Windows
  shortcut from Ctrl+Shift+Z to Ctrl+Y); one used an instantaneous selection
  precheck; another completed the editor/save stages but failed its network
  classification because object-options URLs became `[object Object]`.
  The corrected probe waits for selection and includes a sixth transport
  positive control plus object-options normalization. These are separate
  harness attempts, not a first-attempt end-to-end pass; the coordinator reports
  no product change between them. Receipts are under
  `.kilo/code-view-built-fixed-1791009236758/`,
  `.kilo/code-view-built-fixed-windows-redo-1791009362689/`, and
  `.kilo/code-view-built-fixed-bounded-selection-1791009455047/`.

The committed standard Electron navigation regression also passed 1/1 in
31.5 seconds with zero retries. It uses a disposable home/profile/Codex/AP
fixture and platform-correct redo. The first local invocation collected zero
tests because Windows backslashes were interpreted in Playwright's path filter;
that attempt is not counted. The first executed fixture timed out waiting for
readiness before dismissing onboarding. Reordering dismissal before readiness
passed; the diagnostic trace is retained in widget/test-results. No product
change was required for either harness correction.

The coordinator owns CLAIMS, Drive, independent review and serial integration.
Current-head CI, merge and refreshed-package acceptance remain unverified at
this checkpoint. No commit, push, merge, owner installation or complete
Code-mode acceptance is claimed here.
