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
back after a managed-directory lookup failure. `media-render.ts` has only an
adjacent comment correction; its implementation and 10-second default render
probe are unchanged. The resolver's imports are Node builtins and pure geometry/
caption/filter helpers, with no startup side effect or capability import cycle.

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

Dependencies are a read-only junction to the root-owned private integration
tree after four manifests/locks matched exactly. No dependency installation,
native rebuild, Electron GUI, package build, media render, download, provider
request, owner-profile change or merge was performed. Source-level execution
and real FFmpeg CLI behavior are proved; refreshed built/package/installer
acceptance remains separate. Root owns integration and delivery.
