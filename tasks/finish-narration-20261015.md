# FINISH-NARRATION-20261015 — closeout, 19 October 2026

Source branch `claude/finish-narration-20261015` is based on current main
`12b11c385d746ed1908717b314c5415162e1061d`. Closeout code head:
`333e6b6f39da5711afa7d9ea847c328c89de6be2` (PR #496).

## Finding and change

- Nightly run [39106307387](https://github.com/kingithegreat/Sadie/actions/runs/39106307387), job `117612778475`, recorded Edge TTS `Unexpected server response: 403` followed by `Cannot read properties of undefined (reading 'voiceLocale')` on the real Media Studio IPC path.
- The widget pinned `msedge-tts` 2.0.7. Upstream 2.1.0 moves synthesis to the current Edge speech endpoint and hardens optional voice metadata. Updated the dependency to exact 2.1.0 and added `msedge-tts-compat.test.ts` for both regressions.

## Verification

- Focused compatibility and narration-engine tests: 2 suites, 12 tests passed against actual `msedge-tts` 2.1.0. The same regression checks fail against 2.0.7 for the original metadata crash and obsolete endpoint.
- All six live main-protection contexts passed on PR head `333e6b6f`: `build`, `duplicate-export-guard`, `ESLint (React Hooks)`, `Permissions smoke test`, `widget`, and `e2e-all`. The Windows widget job passed typecheck, unit tests, and overlay E2E; the full three-OS widget E2E matrix passed.
- Installer-first-run run [39212516946](https://github.com/kingithegreat/Sadie/actions/runs/39212516946) passed on the same head: unsigned build, silent install, launch, check, and uninstall.
- Real Media Studio run [39214310984](https://github.com/kingithegreat/Sadie/actions/runs/39214310984) passed on the same head. Its Windows logs show Edge TTS initialized with `en-US-AvaNeural`; the real IPC test created `narration.mp3`; the live render produced an 11-second, 0.3 MB video with checks passed. The real-media suites completed 3/3 suites and 69/69 tests. The test used generic fixture text and disposable CI data; no owner credentials, paid services, or private assets were used.
- A full local widget typecheck was not run in this isolated worktree; exact-head hosted Windows typecheck passed.

## Review state and remaining series work

PR [#496](https://github.com/kingithegreat/Sadie/pull/496) remains a draft for owner review, with auto-merge disabled. No installer was published and no code was merged by this task.

The HomeBot code fix and runtime verification are complete. A full Leila/Flappy episode, human listening/art review, Flappy-specific dialogue/flight, and the Leila silent articulation proof are separate content gates in the Drive plan. The next planned media step is the smallest Leila proof after the existing rig owner supplies/verifies the hand-parented prop attachment and accepted source cells; then the full episode follows.
