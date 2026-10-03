# APP-CAPABILITY-FFMPEG-1 — truthful media engine readiness

Baseline: fresh main `d22443b1ddf08e23809fc309bf01cacebce9592d`.
Private branch: `claude/pro-reliability-ffmpeg-readiness-20261003`.

The delivered launcher deliberately supplies a working `HOMEBOT_FFMPEG`.
Actual media discovery supports that explicit binary, the managed installation,
PATH and common Windows locations. The capability probe checked only PATH and
managed storage, so an isolated portable launch could render successfully while
Home's System check claimed the video engine was missing and suggested setup.

Reachability: `CapabilityReport.tsx` calls `getCapabilityReport`; the production
`homebot:capability-report` handler calls `probeCapabilities`; the shared report
maps `ffmpegAvailable` into ready/missing guidance. No renderer behavior changes.

The probe now reuses `findFfmpeg` with its own real runnable version check and
4,000 ms per-process timeout. It preserves rendering's explicit/managed/PATH/
portable search order, validates execution rather than file presence, and falls
back after a managed-directory lookup failure. Executable discovery now lives
in the neutral `ffmpeg-resolver.ts`, importing only Node `fs` and `child_process`.
`media-render.ts` re-exports the same function for existing rendering callers.
The resolver's search behavior and 10-second default render probe are unchanged;
there is no startup side effect or capability import cycle.

Verification:

- Unchanged source baseline: 9 tests executed, 6 failed, 3 existing controls
  passed. Retained `.kilo/evidence/ffmpeg-baseline.log`.
- Final source: 3 suites/78 tests passed, including 11 probe cases covering
  explicit and portable detection, runnable negatives, media search order,
  managed lookup failure and `ETIMEDOUT` fallback with the 4,000 ms bound.
  Retained `.kilo/evidence/ffmpeg-final-focused.log`.
- Widget TypeScript, changed-file ESLint and diff whitespace check passed.
- Actual existing FFmpeg process: a source-level A/B uses the original exported
  probe, controlled network/Electron/managed seams and no PATH engine. Baseline
  reports false; fixed reports true; the unchanged media resolver selects the
  same absolute executable. Real `-version` succeeds and executable SHA-256 is
  unchanged. `.kilo/prove-ffmpeg-readiness.cjs` and
  `.kilo/evidence/ffmpeg-real-source-proof.json` retain that proof.

PR #462's initial `b0a8a5c` failed both root build contexts in the root Jest
module-boundary test: the diagnostic's dynamic import of `media-render.ts`
crossed Core into Production Studio. The unchanged clean `d22443b1` tree passes
the same scanner; `b0a8a5c` produces exactly that one violation. Failed cloud
logs are preserved as `.kilo/evidence/ci-37104075693-failed.log` and
`ci-37104079635-build-job.log`. The boundary checker and its exceptions remain
unchanged. Extracting only the shared executable resolver removes that edge.

The corrected tree passes the actual root boundary Jest suite (8 tests,
including positive controls for forbidden imports) and 4 affected widget suites
(97 tests), including the existing setup/rendering resolver contract tests.
Widget TypeScript and all changed-file ESLint checks pass. Logs are retained as
`resolver-root-boundary-jest.log`, `ffmpeg-resolver-focused.log`,
`resolver-typecheck.log` and `resolver-scoped-lint.log` under `.kilo/evidence`.
The refreshed real-CLI proof is written separately to
`ffmpeg-resolver-real-source-proof.json`, recording the executed source hashes
and commit, renderer/neutral resolver identity, and both real probe bounds.
The original precommit proof remains preserved; its baseline source-head label
does not claim that the later commit was already checked out.

Cloud checks for the corrected commit must complete before integration. This
draft PR remains under root review with automatic merging disabled.

Dependencies are a read-only junction to the root-owned private integration
tree after four manifests/locks matched exactly. No dependency installation,
native rebuild, Electron GUI, package build, media render, download, provider
request, owner-profile change or merge was performed. Source-level execution
and real FFmpeg CLI behavior are proved; refreshed built/package/installer
acceptance remains separate. Root owns integration and delivery.
