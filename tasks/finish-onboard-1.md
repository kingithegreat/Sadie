# FINISH-ONBOARD-1: local onboarding selects the model it actually installed

Base: `e4628326`. Author: Codex. Date: 2026-09-27 NZ.

The first-run wizard downloaded the hardware-recommended 3B chat model on a 4 GB
GPU, displayed it in the picker, then saved the absent default 7B model. It also
reported local AI ready after a failed model pull, an empty inventory or failed
inventory request, and offered embeddings as chat models.

Five meaningful wizard regression cases failed on the original implementation.
The saved settings assertion received `chatModel: qwen2.5:7b` instead of the
downloaded `qwen2.5:3b`; the three failure cases displayed `Ollama is ready!`;
the final case exposed `nomic-embed-text` as a chat option.

The wizard now waits for hardware detection before choosing a download, matches
exact model tags (with an omitted tag equivalent to `:latest`), checks IPC result
success and verifies the installed inventory. It chooses an installed chat
model, preserving a valid existing choice, and saves the same model it displays.
Embedding models are excluded. Failed/empty setup offers Retry or Continue
anyway without claiming success; a failed optional download can warn while an
existing chat model remains usable.

Reachable path: welcome screen **On this PC** -> local setup -> chat picker ->
Next -> Get Started -> existing `saveSettings` IPC and App settings callback.
Local message routing reads the persisted `settings.chatModel`.

Validation:

- Original implementation: 5 new wizard cases failed (35 pre-existing skipped
  by the targeted reproduction filter).
- Final focused run: **68/68 tests**, 2 suites, no skips or retries. Includes
  recommended model persistence, failure recovery, embedding-only inventories,
  exact tags/latest aliases, delayed hardware detection and explicit picker
  selection persistence.
- Widget `tsc --noEmit`: exit 0.
- ESLint on changed renderer and test files: exit 0.
- `git diff --check`: exit 0.

The focused command is:

```powershell
node node_modules/jest/bin/jest.js --config=jest.config.ts --runInBand --no-coverage --runTestsByPath src/renderer/__tests__/first-run-modal.test.tsx src/shared/__tests__/hardware-presets.test.ts --silent
```

Verification level: React component tests exercise the real wizard with mocked
IPC. They assert the settings payload passed to persistence and the App callback;
they do not prove disk persistence, a real Ollama download or a completed chat
request. No paid request, provider access or real profile change occurred. Full
suite/build and real Electron acceptance remain with the coordinating root agent.

Root independent review and broader checks:

- Production diff reviewed at `e6979acc`; root full widget lint exited 0 with
  7 existing warnings and no errors.
- Full Windows widget run: 335 suites / 4,601 tests passed; 11 suites failed
  because the restricted shell refused home fixtures and subprocess work.
  11 suites / 31 tests were pre-existing skips. Initial log retained at
  `.kilo/finish-20260927/onboarding-widget-suite.log`.
- Escalated rerun of the 11 affected suites in an isolated test home:
  119/120 passed. The remaining non-repository Git control discovered the real
  parent checkout because the test home was inside HomeBot. Moving only that
  fixture outside every checkout gave 5/5 passing Git tests.
- Combined verification covers all 346 executed suites / 4,652 unique tests;
  every initial failure was recovered without changing product code or tests.
  This is a full discovery run plus targeted environment corrections, not a
  single all-green invocation. The 31 intentional skips remain unclaimed.
- Logs: `onboarding-widget-blocked-rerun.log` and
  `onboarding-workspace-git-rerun.log` under the same evidence directory.
